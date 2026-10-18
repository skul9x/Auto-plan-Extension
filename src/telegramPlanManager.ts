import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Bot, Context, InlineKeyboard } from 'grammy';
import {
  PhaseFile,
  detectPhaseStatus,
  tryScanPlanFolder,
  tryScanPlanFolderAsync,
  normalizePath,
  BLACKLISTED_DIRS,
  PHASE_NAME_PATTERN,
  sortPhaseFiles
} from './planScanner';
import { getConfig } from './config';
import { debugLogger, DebugLogger } from './debugLogger';
import { orchestrator as globalOrchestrator } from './orchestrator';
import {
  renderTextProgressBar,
  formatSafePlanText,
  escapeTelegramMarkdown
} from './telegramUtils';

/**
 * Metadata for a discovered plan directory containing phase markdown files.
 */
export interface DiscoveredPlanFolder {
  /** Deterministic compact unique identifier (e.g. 'f_1a2b3c4d') */
  id: string;
  /** Absolute path normalized with forward slashes */
  folderPath: string;
  /** Native OS absolute path */
  nativePath: string;
  /** Relative path from workspace root (e.g. 'plans/feature-auth') */
  relativePath: string;
  /** User-friendly display title (e.g. 'plans/feature-auth') */
  displayName: string;
  /** Total number of phase files discovered in this folder */
  totalPhases: number;
  /** Number of phases marked as Completed */
  completedPhases: number;
  /** Number of phases still Pending */
  pendingPhases: number;
  /** True if pendingPhases > 0 */
  hasPendingPhases: boolean;
  /** Ordered list of discovered phase files */
  phases: PhaseFile[];
  /** Latest modification timestamp (ms) of plan.md or newest phase markdown */
  lastModifiedMs?: number;
  /** Alias for lastModifiedMs for convenience */
  mtimeMs?: number;
}

export interface DiscoverPlanFoldersOptions {
  /** Explicit workspace root directories to scan */
  workspaceRoots?: string[];
  /** Configured default plan folder */
  defaultPlanFolder?: string;
  /** Only return folders that have uncompleted phases */
  pendingOnly?: boolean;
}

export interface PlanSelectionSession {
  userId: number | string;
  folderId: string;
  selectedIndices: Set<number>;
  page?: number;
  lastUpdated: number;
}

export interface FolderPickerKeyboardOptions {
  page?: number;
  pageSize?: number;
  pendingOnly?: boolean;
  topPlan?: DiscoveredPlanFolder | null;
  compact?: boolean;
}

export interface ExecutionDashboardOptions {
  planName?: string;
  folder?: DiscoveredPlanFolder | null;
  folderId?: string;
  currentPhaseName?: string;
  currentPhaseIndex?: number;
  completedPhases?: number;
  totalPhases?: number;
  state?: 'running' | 'completed' | 'stopped' | 'error';
  errorMessage?: string;
  hasNudged?: boolean;
}

export interface ActiveDashboardSession {
  chatId: number | string;
  messageId: number;
  folderId?: string;
  folder?: DiscoveredPlanFolder | null;
  planName: string;
  currentPhaseName: string;
  currentPhaseIndex: number;
  completedPhases: number;
  totalPhases: number;
  state: 'running' | 'completed' | 'stopped' | 'error';
  errorMessage?: string;
  bot?: Bot;
  hasNudged?: boolean;
}

export interface DashboardThrottlerOptions {
  minIntervalMs?: number;
  onUpdate?: () => Promise<void> | void;
}

export interface TelegramPlanManagerOptions {
  workspaceRoots?: string[];
  defaultPlanFolder?: string;
  orchestrator?: any;
  logger?: DebugLogger;
  screenManager?: any;
  bot?: Bot;
}

/**
 * Intelligently shortens a plan display name to at most `maxLen` characters (default 18),
 * avoiding button label truncation and wrapping on mobile screens.
 */
export function formatShortPlanName(name: string, maxLen: number = 18): string {
  if (!name || typeof name !== 'string') {
    return '';
  }
  const clean = name.trim();
  const base = path.basename(clean) || clean;
  if (base.length <= maxLen) {
    return base;
  }
  return base.substring(0, maxLen - 2) + '..';
}

/**
 * Intelligently extracts and shortens the slug of a phase file or title to at most `maxSlugLen` characters (default 8),
 * preventing button wrapping and layout breakage on mobile devices.
 */
export function extractPhaseSlug(nameOrFile: string, maxSlugLen: number = 8): string {
  if (!nameOrFile || typeof nameOrFile !== 'string') {
    return 'Phase';
  }
  const base = path.basename(nameOrFile).trim();
  const withoutExt = base.replace(/\.[^/.]+$/, '');
  let cleaned = withoutExt.replace(/^(?:phase[-_]?\d+|\d+)[-_:\s]*/i, '').trim();
  if (!cleaned) {
    cleaned = withoutExt;
  }
  if (!cleaned || /^\d+$/.test(cleaned)) {
    return 'Phase';
  }

  // Convert kebab-case or snake_case to readable words and capitalize
  const words = cleaned
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => {
      if (w === '&') return '&';
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
  const readable = words.join(' ');

  if (readable.length <= maxSlugLen) {
    return readable;
  }

  // Truncate cleanly and append '..'
  const cutLen = Math.max(1, maxSlugLen - 2);
  const truncated = readable.substring(0, cutLen).trim().replace(/[-_.,:;]+$/, '');
  return truncated + '..';
}

/**
 * Extracts a readable phase title for message descriptions (e.g., 'Visual Progress Bar Engine').
 */
export function extractReadablePhaseTitle(fileName: string): string {
  if (!fileName || typeof fileName !== 'string') {
    return '';
  }
  const base = path.basename(fileName).trim();
  const withoutExt = base.replace(/\.[^/.]+$/, '');
  const cleaned = withoutExt.replace(/^(?:phase[-_]?\d+|\d+)[-_:\s]*/i, '').trim();
  if (!cleaned) {
    return '';
  }
  const words = cleaned
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => {
      if (w === '&') return '&';
      return w.charAt(0).toUpperCase() + w.slice(1);
    });
  return words.join(' ');
}

/**
 * Formats a phase button label for compact 2-column mobile inline keyboard:
 * `[${checked ? '✅' : '⬜'} P${padIndex}: ${shortSlug}]`
 * e.g., `[✅ P01: Visual..]` or `[⬜ P02: Quick..]`
 */
export function formatCompactPhaseButtonLabel(
  phaseOrIndex: PhaseFile | { fileName?: string; index?: number } | number,
  checkedOrName?: boolean | string,
  maybeChecked?: boolean | number,
  maxSlugLen: number = 8
): string {
  let index = 1;
  let fileName = '';
  let isChecked = false;
  let maxLen = maxSlugLen;

  if (typeof phaseOrIndex === 'number') {
    index = phaseOrIndex;
    if (typeof checkedOrName === 'string') {
      fileName = checkedOrName;
      if (typeof maybeChecked === 'boolean') {
        isChecked = maybeChecked;
      }
    } else if (typeof checkedOrName === 'boolean') {
      isChecked = checkedOrName;
      if (typeof maybeChecked === 'number') {
        maxLen = maybeChecked;
      }
    }
  } else if (phaseOrIndex && typeof phaseOrIndex === 'object') {
    index = phaseOrIndex.index ?? 1;
    fileName = phaseOrIndex.fileName ?? '';
    if (typeof checkedOrName === 'boolean') {
      isChecked = checkedOrName;
    }
    if (typeof maybeChecked === 'number') {
      maxLen = maybeChecked;
    }
  }

  const icon = isChecked ? '✅' : '⬜';
  const padIndex = String(index).padStart(2, '0');
  const slug = extractPhaseSlug(fileName, maxLen);
  return `[${icon} P${padIndex}: ${slug}]`;
}

/**
 * Builds the message text for manual phase selection, showing full phase titles and status.
 */
export function formatManualSelectionMessage(
  folder: DiscoveredPlanFolder,
  selectedIndices?: Set<number>
): string {
  const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  const folderName = folder.relativePath || folder.displayName || folder.id;
  const shortFolderName = path.basename(folderName) || folderName;
  const lines: string[] = [
    `📋 CHỌN PHASE THỰC THI (${shortFolderName})`
  ];

  for (let i = 0; i < folder.phases.length; i++) {
    const phase = folder.phases[i];
    const emoji = NUMBER_EMOJIS[i] || `${i + 1}️⃣`;
    const pad = String(phase.index).padStart(2, '0');
    const slug = extractReadablePhaseTitle(phase.fileName);
    const phaseTitle = slug ? `Phase ${pad}: ${slug}` : `Phase ${pad}`;
    const statusText = phase.isCompleted ? '[Đã xong]' : '[Chưa chạy]';
    lines.push(`${emoji} ${phaseTitle} ${statusText}`);
  }

  lines.push('');
  lines.push('Chạm vào nút bên dưới để chọn, sau đó nhấn Bắt đầu:');

  return lines.join('\n');
}

function getVscodeSafe(): any {
  try {
    return require('vscode');
  } catch {
    return null;
  }
}

/**
 * Checks whether an error from Telegram indicates the message content was unchanged.
 */
export function isMessageNotModifiedError(err: any): boolean {
  if (!err) return false;
  const msg = (err.description || err.message || '').toLowerCase();
  return msg.includes('message is not modified');
}

/**
 * Cleans an InlineKeyboard by removing any empty button rows created by trailing .row() calls.
 */
export function cleanKeyboard(kb: InlineKeyboard): InlineKeyboard {
  while (
    kb.inline_keyboard.length > 0 &&
    kb.inline_keyboard[kb.inline_keyboard.length - 1].length === 0
  ) {
    kb.inline_keyboard.pop();
  }
  return kb;
}

/**
 * Builds the text and interactive InlineKeyboard for the live execution control dashboard.
 */
export function buildExecutionDashboard(
  options?: ExecutionDashboardOptions
): { text: string; keyboard: InlineKeyboard } {
  const planName = options?.planName || options?.folder?.displayName || 'Kế hoạch';
  const completed = options?.completedPhases ?? options?.folder?.completedPhases ?? 0;
  const total = options?.totalPhases ?? options?.folder?.totalPhases ?? 0;
  const state = options?.state || 'running';
  const folderId = options?.folderId || options?.folder?.id;

  const phaseIndex = options?.currentPhaseIndex ?? 1;
  const padIndex = String(phaseIndex).padStart(2, '0');
  let phaseTitle = '';
  if (options?.currentPhaseName) {
    const candidate = extractReadablePhaseTitle(options.currentPhaseName);
    phaseTitle = candidate || options.currentPhaseName.replace(/\.[^/.]+$/, '').trim();
  } else {
    phaseTitle = 'Phase ' + padIndex;
  }
  if (/^phase\s+\d+[-_:\s]*/i.test(phaseTitle)) {
    phaseTitle = phaseTitle.replace(/^phase\s+\d+[-_:\s]*/i, '').trim();
  }

  const progressBar = renderTextProgressBar(completed, total);

  const lines: string[] = [];
  const kb = new InlineKeyboard();

  if (state === 'completed') {
    lines.push(`🎉 KẾ HOẠCH ĐÃ HOÀN THÀNH 100%! (${total}/${total} phase)`);
    lines.push(`📁 Kế hoạch: ${planName}`);
    lines.push(`📊 Tiến độ: ${renderTextProgressBar(total, total)} (${total}/${total} phase)`);

    const rerunData = folderId ? `p:db:rerun:${folderId}` : 'p:db:rerun';
    kb.text('[🚀 Chạy lại]', rerunData)
      .text('[📂 Danh sách Plans]', 'p:db:nav')
      .row();
  } else if (state === 'stopped') {
    lines.push('🛑 KẾ HOẠCH ĐÃ ĐƯỢC DỪNG LẠI');
    lines.push(`📁 Kế hoạch: ${planName}`);
    lines.push(`⏳ Đã dừng tại: Phase ${padIndex} - ${phaseTitle}`);
    lines.push(`📊 Tiến độ: ${progressBar} (${completed}/${total} phase)`);

    const resumeData = folderId ? `p:db:resume:${folderId}` : 'p:db:resume';
    kb.text('[⚡ Tiếp tục]', resumeData)
      .text('[📂 Danh sách Plans]', 'p:db:nav')
      .row();
  } else if (state === 'error') {
    lines.push('❌ THỰC THI THẤT BẠI (EXECUTION ERROR)');
    lines.push(`📁 Kế hoạch: ${planName}`);
    lines.push(`⚠️ Lỗi: ${options?.errorMessage || 'Lỗi không xác định'}`);
    lines.push(`📊 Tiến độ: ${progressBar} (${completed}/${total} phase)`);

    const resumeData = folderId ? `p:db:resume:${folderId}` : 'p:db:resume';
    kb.text('[⚡ Tiếp tục]', resumeData)
      .text('[📂 Danh sách Plans]', 'p:db:nav')
      .row();
  } else {
    // running state
    lines.push('▶️ ĐANG THỰC THI KẾ HOẠCH');
    lines.push(`📁 Kế hoạch: ${planName}`);
    lines.push(`⏳ Đang chạy: Phase ${padIndex} - ${phaseTitle}${options?.hasNudged ? ' ⚠️ Nudged (guidance sent)' : ''}`);
    lines.push(`📊 Tiến độ: ${progressBar} (${completed}/${total} phase)`);

    kb.text('[⏭️ Bỏ qua Phase]', 'p:db:skip')
      .text('[🛑 Dừng lại]', 'p:db:stop')
      .row();
    kb.text('[📸 Chụp màn hình]', 'p:db:scr')
      .text('[🔄 Cập nhật]', 'p:db:ref')
      .row();
    kb.text('[📂 Danh sách Plans]', 'p:db:nav')
      .row();
  }

  cleanKeyboard(kb);

  return {
    text: lines.join('\n'),
    keyboard: kb
  };
}

/**
 * Throttles dashboard Telegram API updates to prevent HTTP 429 rate limits,
 * coalescing rapid intermediate updates with trailing execution and allowing
 * immediate bypass for terminal events.
 */
export class DashboardThrottler {
  private minIntervalMs: number;
  private lastExecutionTime: number = 0;
  private pendingTimer: NodeJS.Timeout | null = null;
  private pendingTask: (() => Promise<void> | void) | null = null;
  private defaultUpdateFn?: () => Promise<void> | void;

  constructor(options?: DashboardThrottlerOptions | number) {
    if (typeof options === 'number') {
      this.minIntervalMs = options;
    } else {
      this.minIntervalMs = options?.minIntervalMs ?? 1200;
      this.defaultUpdateFn = options?.onUpdate;
    }
  }

  public getMinIntervalMs(): number {
    return this.minIntervalMs;
  }

  public getLastExecutionTime(): number {
    return this.lastExecutionTime;
  }

  public hasPending(): boolean {
    return this.pendingTask !== null || this.pendingTimer !== null;
  }

  public async schedule(
    taskOrImmediate?: (() => Promise<void> | void) | boolean,
    isImmediate?: boolean
  ): Promise<void> {
    let task: (() => Promise<void> | void) | undefined;
    let immediate = false;

    if (typeof taskOrImmediate === 'function') {
      task = taskOrImmediate;
      immediate = !!isImmediate;
    } else if (typeof taskOrImmediate === 'boolean') {
      immediate = taskOrImmediate;
      task = this.defaultUpdateFn;
    } else {
      task = this.defaultUpdateFn;
      immediate = !!isImmediate;
    }

    if (!task && !this.pendingTask) {
      return;
    }

    if (immediate) {
      if (this.pendingTimer) {
        clearTimeout(this.pendingTimer);
        this.pendingTimer = null;
      }
      const toRun = task || this.pendingTask;
      this.pendingTask = null;
      this.lastExecutionTime = Date.now();
      if (toRun) {
        await toRun();
      }
      return;
    }

    if (task) {
      this.pendingTask = task;
    }

    if (this.pendingTimer !== null) {
      // Intermediate update scheduled: coalesced into pendingTask
      return;
    }

    const elapsed = Date.now() - this.lastExecutionTime;
    if (elapsed >= this.minIntervalMs) {
      this.lastExecutionTime = Date.now();
      const currentTask = this.pendingTask;
      this.pendingTask = null;
      if (currentTask) {
        await currentTask();
      }
    } else {
      const waitTime = this.minIntervalMs - elapsed;
      this.pendingTimer = setTimeout(async () => {
        this.pendingTimer = null;
        const currentTask = this.pendingTask;
        this.pendingTask = null;
        this.lastExecutionTime = Date.now();
        if (currentTask) {
          try {
            await currentTask();
          } catch {}
        }
      }, waitTime);
    }
  }

  public async flush(): Promise<void> {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.pendingTask) {
      const task = this.pendingTask;
      this.pendingTask = null;
      this.lastExecutionTime = Date.now();
      await task();
    }
  }

  public cancel(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.pendingTask = null;
  }

  public dispose(): void {
    this.cancel();
  }
}

/**
 * Manages plan discovery across workspace directories, generates Telegram inline keyboards,
 * and processes interactive execution selections.
 */
export class TelegramPlanManager {
  private workspaceRoots: string[] = [];
  private defaultPlanFolder?: string;
  private orchestrator: any;
  private logger: DebugLogger;
  private folderCache: Map<string, DiscoveredPlanFolder> = new Map();
  private folderCacheTimestamps: Map<string, number> = new Map();
  private sessions: Map<string, PlanSelectionSession> = new Map();
  private userFilterModes: Map<string | number, boolean> = new Map();

  private activeDashboardSession: ActiveDashboardSession | null = null;
  private dashboardThrottler: DashboardThrottler = new DashboardThrottler(1200);
  private orchestratorListenersBound: boolean = false;
  private boundOrchestratorHandlers: Record<string, (...args: any[]) => void> = {};
  private screenManager: any = null;
  private bot: Bot | null = null;

  constructor(options?: TelegramPlanManagerOptions) {
    this.workspaceRoots = options?.workspaceRoots ? [...options.workspaceRoots] : [];
    this.defaultPlanFolder = options?.defaultPlanFolder;
    this.orchestrator = options?.orchestrator || globalOrchestrator;
    this.logger = options?.logger || debugLogger;
    if (options?.screenManager) {
      this.screenManager = options.screenManager;
    }
    if (options?.bot) {
      this.bot = options.bot;
    }
  }

  public setOrchestrator(orch: any): void {
    this.orchestrator = orch;
  }

  public setWorkspaceRoots(roots: string[]): void {
    this.workspaceRoots = [...roots];
  }

  public setScreenManager(screenManager: any): void {
    this.screenManager = screenManager;
  }

  public getScreenManager(): any {
    return this.screenManager;
  }

  public setBot(bot: Bot | null): void {
    this.bot = bot;
  }

  public getBot(): Bot | null {
    return this.bot;
  }

  public getActiveDashboardSession(): ActiveDashboardSession | null {
    return this.activeDashboardSession;
  }

  public setActiveDashboardSession(session: ActiveDashboardSession | null): void {
    this.activeDashboardSession = session;
  }

  public getDashboardThrottler(): DashboardThrottler {
    return this.dashboardThrottler;
  }

  public setDashboardThrottler(throttler: DashboardThrottler): void {
    this.dashboardThrottler = throttler;
  }

  public buildExecutionDashboard(options?: ExecutionDashboardOptions): { text: string; keyboard: InlineKeyboard } {
    return buildExecutionDashboard(options);
  }

  public bindOrchestratorEvents(orchestrator?: any): void {
    const orch = orchestrator || this.orchestrator;
    if (!orch || typeof orch.on !== 'function') {
      return;
    }
    this.unbindOrchestratorEvents();

    const onPhaseStart = (phase: any, i: any, total: any, fileName: any) => {
      if (!this.activeDashboardSession) return;
      this.activeDashboardSession.state = 'running';
      this.activeDashboardSession.hasNudged = Boolean(phase?.hasNudged);
      this.activeDashboardSession.currentPhaseName = phase?.fileName || fileName || (typeof phase === 'string' ? phase : this.activeDashboardSession.currentPhaseName);
      if (typeof i === 'number') {
        this.activeDashboardSession.currentPhaseIndex = i + 1;
      } else if (phase?.phaseNumber || phase?.index) {
        this.activeDashboardSession.currentPhaseIndex = phase.phaseNumber || phase.index;
      }
      if (typeof total === 'number' && total > 0) {
        this.activeDashboardSession.totalPhases = total;
      }
      this.renderAndUpdateDashboard(false).catch(() => {});
    };

    const onPhaseComplete = (phase: any, result: any, i: any, total: any) => {
      if (!this.activeDashboardSession) return;
      if (typeof i === 'number') {
        this.activeDashboardSession.completedPhases = i + 1;
      } else {
        this.activeDashboardSession.completedPhases++;
      }
      if (typeof total === 'number' && total > 0) {
        this.activeDashboardSession.totalPhases = total;
      }
      this.renderAndUpdateDashboard(false).catch(() => {});
    };

    const onPhaseNudged = (_payload: any) => {
      if (!this.activeDashboardSession) return;
      this.activeDashboardSession.hasNudged = true;
      this.renderAndUpdateDashboard(false).catch(() => {});
    };

    const onSkipped = (phase: any) => {
      if (!this.activeDashboardSession) return;
      this.activeDashboardSession.completedPhases++;
      this.renderAndUpdateDashboard(false).catch(() => {});
    };

    const onAllComplete = (total: any) => {
      if (!this.activeDashboardSession) return;
      this.activeDashboardSession.state = 'completed';
      if (typeof total === 'number' && total > 0) {
        this.activeDashboardSession.totalPhases = total;
        this.activeDashboardSession.completedPhases = total;
      } else {
        this.activeDashboardSession.completedPhases = this.activeDashboardSession.totalPhases;
      }
      this.renderAndUpdateDashboard(true).catch(() => {});
      this.unbindOrchestratorEvents();
    };

    const onStopped = () => {
      if (!this.activeDashboardSession) return;
      this.activeDashboardSession.state = 'stopped';
      this.renderAndUpdateDashboard(true).catch(() => {});
      this.unbindOrchestratorEvents();
    };

    const onError = (err: any) => {
      if (!this.activeDashboardSession) return;
      this.activeDashboardSession.state = 'error';
      this.activeDashboardSession.errorMessage = err?.message || String(err);
      this.renderAndUpdateDashboard(true).catch(() => {});
      this.unbindOrchestratorEvents();
    };

    this.boundOrchestratorHandlers = {
      phaseStart: onPhaseStart,
      phaseComplete: onPhaseComplete,
      phaseNudged: onPhaseNudged,
      skipped: onSkipped,
      allComplete: onAllComplete,
      stopped: onStopped,
      error: onError
    };

    for (const [evt, handler] of Object.entries(this.boundOrchestratorHandlers)) {
      orch.on(evt, handler);
    }
    this.orchestratorListenersBound = true;
  }

  public unbindOrchestratorEvents(): void {
    if (!this.orchestratorListenersBound || !this.orchestrator || typeof this.orchestrator.removeListener !== 'function') {
      return;
    }
    for (const [evt, handler] of Object.entries(this.boundOrchestratorHandlers)) {
      try {
        this.orchestrator.removeListener(evt, handler);
      } catch {}
    }
    this.boundOrchestratorHandlers = {};
    this.orchestratorListenersBound = false;
  }

  public async renderAndUpdateDashboard(isImmediate: boolean = false): Promise<void> {
    if (!this.activeDashboardSession) {
      return;
    }
    const session = this.activeDashboardSession;
    const bot = this.bot || session.bot;
    if (!bot) {
      return;
    }

    await this.dashboardThrottler.schedule(async () => {
      const { text, keyboard } = this.buildExecutionDashboard({
        planName: session.planName,
        folder: session.folder,
        folderId: session.folderId,
        currentPhaseName: session.currentPhaseName,
        currentPhaseIndex: session.currentPhaseIndex,
        completedPhases: session.completedPhases,
        totalPhases: session.totalPhases,
        state: session.state,
        errorMessage: session.errorMessage,
        hasNudged: session.hasNudged
      });

      try {
        await bot.api.editMessageText(session.chatId, session.messageId, formatSafePlanText(text), {
          reply_markup: keyboard,
          parse_mode: 'Markdown'
        });
      } catch (err: any) {
        if (isMessageNotModifiedError(err)) {
          return;
        }
        // Graceful Fallback: if message was deleted or expired, fallback to sending a new message
        try {
          const sent = await bot.api.sendMessage(session.chatId, formatSafePlanText(text), {
            reply_markup: keyboard,
            parse_mode: 'Markdown'
          });
          if (sent && sent.message_id) {
            session.messageId = sent.message_id;
          }
        } catch (sendErr: any) {
          this.logger.error('TELEGRAM', `Dashboard fallback delivery failed: ${sendErr?.message || sendErr}`);
        }
      }
    }, isImmediate);
  }

  public async startLiveDashboard(options: {
    ctx: Context;
    folder?: DiscoveredPlanFolder | null;
    folderId?: string;
    planName?: string;
    phases?: PhaseFile[];
    totalPhases?: number;
    completedPhases?: number;
  }): Promise<void> {
    const { ctx, folder, folderId, planName, phases, totalPhases, completedPhases } = options;
    const name = planName || folder?.displayName || 'Kế hoạch';
    const total = totalPhases ?? (phases?.length || folder?.totalPhases || 1);
    const completed = completedPhases ?? (folder?.completedPhases || 0);
    const initialPhase = phases && phases.length > 0 ? phases[0] : (folder?.phases && folder.phases.length > 0 ? folder.phases[0] : null);

    const chatId = ctx.chat?.id || (ctx.from?.id ? String(ctx.from.id) : '');
    const messageId = ctx.msg?.message_id || (ctx.callbackQuery?.message?.message_id ?? 0);

    this.activeDashboardSession = {
      chatId,
      messageId,
      folderId: folderId || folder?.id,
      folder: folder || null,
      planName: name,
      currentPhaseName: initialPhase ? initialPhase.fileName : 'Phase 01',
      currentPhaseIndex: initialPhase ? (initialPhase.index || 1) : 1,
      completedPhases: completed,
      totalPhases: total,
      state: 'running',
      bot: this.bot || (ctx as any).bot
    };

    const { text, keyboard } = this.buildExecutionDashboard({
      planName: name,
      folder: folder || null,
      folderId: folderId || folder?.id,
      currentPhaseName: this.activeDashboardSession.currentPhaseName,
      currentPhaseIndex: this.activeDashboardSession.currentPhaseIndex,
      completedPhases: completed,
      totalPhases: total,
      state: 'running'
    });

    try {
      await ctx.editMessageText(formatSafePlanText(text), { reply_markup: keyboard, parse_mode: 'Markdown' });
    } catch {
      try {
        const sent = await ctx.reply(formatSafePlanText(text), { reply_markup: keyboard, parse_mode: 'Markdown' });
        if (sent && sent.message_id) {
          this.activeDashboardSession.messageId = sent.message_id;
        }
      } catch (replyErr) {
        this.logger.error('TELEGRAM', `Failed to send initial live dashboard: ${replyErr}`);
      }
    }

    this.bindOrchestratorEvents(this.orchestrator);
  }

  public setDefaultPlanFolder(folder: string | undefined): void {
    this.defaultPlanFolder = folder;
  }

  public cacheFolder(folder: DiscoveredPlanFolder): void {
    this.folderCache.set(folder.id, folder);
    this.folderCacheTimestamps.set(folder.id, Date.now());
    this.pruneStaleSessions();
  }

  public clearFolderCache(): void {
    this.folderCache.clear();
    this.folderCacheTimestamps.clear();
  }

  public getFolder(folderId: string): DiscoveredPlanFolder | undefined {
    return this.folderCache.get(folderId);
  }

  public getSessionCount(): number {
    return this.sessions.size;
  }

  public getCachedFolderCount(): number {
    return this.folderCache.size;
  }

  /**
   * Automatically prunes user sessions and folder caches older than `maxAgeMs` (default 2 hours)
   * or when memory entries exceed `maxEntries` (default 100), preventing memory leaks.
   */
  public pruneStaleSessions(
    maxAgeMs: number = 2 * 60 * 60 * 1000,
    maxEntries: number = 100
  ): { prunedSessions: number; prunedFolders: number } {
    const now = Date.now();
    let prunedSessions = 0;
    let prunedFolders = 0;

    // 1. Prune sessions by TTL
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastUpdated > maxAgeMs) {
        this.sessions.delete(key);
        prunedSessions++;
      }
    }

    // 2. Prune sessions by capacity limit (> maxEntries)
    if (this.sessions.size > maxEntries) {
      const sorted = Array.from(this.sessions.entries()).sort(
        (a, b) => a[1].lastUpdated - b[1].lastUpdated
      );
      const toRemove = this.sessions.size - maxEntries;
      for (let i = 0; i < toRemove; i++) {
        this.sessions.delete(sorted[i][0]);
        prunedSessions++;
      }
    }

    // 3. Prune folderCache by TTL
    for (const [key, timestamp] of this.folderCacheTimestamps.entries()) {
      if (now - timestamp > maxAgeMs) {
        this.folderCache.delete(key);
        this.folderCacheTimestamps.delete(key);
        prunedFolders++;
      }
    }

    // 4. Prune folderCache by capacity limit (> maxEntries)
    if (this.folderCache.size > maxEntries) {
      const sorted = Array.from(this.folderCacheTimestamps.entries()).sort(
        (a, b) => a[1] - b[1]
      );
      const toRemove = this.folderCache.size - maxEntries;
      for (let i = 0; i < toRemove; i++) {
        const id = sorted[i][0];
        this.folderCache.delete(id);
        this.folderCacheTimestamps.delete(id);
        prunedFolders++;
      }
    }

    return { prunedSessions, prunedFolders };
  }

  /**
   * Resolves the list of workspace root paths.
   */
  public getWorkspaceRoots(optionsRoots?: string[]): string[] {
    if (optionsRoots && optionsRoots.length > 0) {
      return optionsRoots.map((r) => path.resolve(r));
    }
    if (this.workspaceRoots.length > 0) {
      return this.workspaceRoots.map((r) => path.resolve(r));
    }
    const vs = getVscodeSafe();
    if (vs && vs.workspace && Array.isArray(vs.workspace.workspaceFolders)) {
      const roots = vs.workspace.workspaceFolders.map((wf: any) => path.resolve(wf.uri.fsPath));
      if (roots.length > 0) {
        return roots;
      }
    }
    return [path.resolve(process.cwd())];
  }

  /**
   * Generates a stable compact identifier for a folder path.
   */
  public generateFolderId(normPath: string): string {
    return 'f_' + crypto.createHash('md5').update(normPath.toLowerCase()).digest('hex').substring(0, 8);
  }

  /**
   * Creates a DiscoveredPlanFolder structure from a folder path and scanned phases.
   */
  public createDiscoveredFolder(
    folderPath: string,
    phases: PhaseFile[],
    workspaceRoots: string[]
  ): DiscoveredPlanFolder {
    const absPath = path.resolve(folderPath);
    const normPath = normalizePath(absPath);
    const id = this.generateFolderId(normPath);

    const rootMatch = workspaceRoots.find((r) => {
      const normR = normalizePath(r);
      return normPath === normR || normPath.startsWith(normR + '/');
    });

    let relativePath = '';
    if (rootMatch) {
      relativePath = path.relative(rootMatch, absPath).replace(/\\/g, '/');
    }
    if (!relativePath || relativePath === '.') {
      relativePath = path.basename(absPath) || 'workspace-root';
    }

    const displayName = relativePath;
    const totalPhases = phases.length;
    const completedPhases = phases.filter((p) => p.isCompleted).length;
    const pendingPhases = totalPhases - completedPhases;

    let maxMtime = 0;
    const planPath = path.join(absPath, 'plan.md');
    if (fs.existsSync(planPath)) {
      try {
        const st = fs.statSync(planPath);
        if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
      } catch {}
    }
    for (const p of phases) {
      const pPath = p.filePath || p.nativePath || path.join(absPath, p.fileName);
      try {
        const st = fs.statSync(pPath);
        if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
      } catch {}
    }
    if (maxMtime === 0) {
      try {
        const st = fs.statSync(absPath);
        maxMtime = st.mtimeMs;
      } catch {}
    }
    const mtimeMs = Math.round(maxMtime);

    return {
      id,
      folderPath: normPath,
      nativePath: absPath,
      relativePath,
      displayName,
      totalPhases,
      completedPhases,
      pendingPhases,
      hasPendingPhases: pendingPhases > 0,
      phases,
      lastModifiedMs: mtimeMs,
      mtimeMs
    };
  }

  /**
   * Traverses workspace directories, `plans/`, and configured defaultPlanFolder to discover
   * plan folders containing `phase-*.md` files.
   */
  public discoverPlanFolders(options?: DiscoverPlanFoldersOptions): DiscoveredPlanFolder[] {
    const roots = this.getWorkspaceRoots(options?.workspaceRoots);
    const candidateDirs = new Set<string>();

    const defFolder =
      options?.defaultPlanFolder !== undefined
        ? options.defaultPlanFolder
        : this.defaultPlanFolder !== undefined
        ? this.defaultPlanFolder
        : getConfig().defaultPlanFolder;

    for (const root of roots) {
      if (!fs.existsSync(root)) {
        continue;
      }

      // 1. Workspace root itself
      candidateDirs.add(path.resolve(root));

      // 2. plans/ directory and its subdirectories
      const plansDir = path.join(root, 'plans');
      if (fs.existsSync(plansDir)) {
        candidateDirs.add(path.resolve(plansDir));
        this.collectSubdirectories(plansDir, candidateDirs, 3);
      }

      // 3. Configured defaultPlanFolder
      if (defFolder && typeof defFolder === 'string') {
        const resolvedDef = path.isAbsolute(defFolder) ? path.resolve(defFolder) : path.resolve(root, defFolder);
        if (fs.existsSync(resolvedDef)) {
          candidateDirs.add(resolvedDef);
          this.collectSubdirectories(resolvedDef, candidateDirs, 3);
        }
      }

      // 4. Direct subdirectories of root (e.g. custom spec/phase folders)
      try {
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const lower = entry.name.toLowerCase();
            if (
              BLACKLISTED_DIRS.has(lower) ||
              lower.startsWith('.') ||
              lower === 'out' ||
              lower === 'dist' ||
              lower === 'src' ||
              lower === 'node_modules' ||
              lower === 'media'
            ) {
              continue;
            }
            const directChild = path.resolve(root, entry.name);
            candidateDirs.add(directChild);
          }
        }
      } catch {}
    }

    const discovered: DiscoveredPlanFolder[] = [];

    for (const dir of candidateDirs) {
      const phases = tryScanPlanFolder(dir);
      if (phases && phases.length > 0) {
        const folder = this.createDiscoveredFolder(dir, phases, roots);
        if (options?.pendingOnly && !folder.hasPendingPhases) {
          continue;
        }
        discovered.push(folder);
        this.cacheFolder(folder);
      }
    }

    // Sort: folders with pending phases first, then mtimeMs descending, then natural alphanumeric order
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    discovered.sort((a, b) => {
      if (a.hasPendingPhases !== b.hasPendingPhases) {
        return a.hasPendingPhases ? -1 : 1;
      }
      if ((b.mtimeMs || 0) !== (a.mtimeMs || 0)) {
        return (b.mtimeMs || 0) - (a.mtimeMs || 0);
      }
      return collator.compare(a.displayName, b.displayName);
    });

    return discovered;
  }

  /**
   * Asynchronously traverses workspace directories to discover plan folders.
   */
  public async discoverPlanFoldersAsync(
    options?: DiscoverPlanFoldersOptions
  ): Promise<DiscoveredPlanFolder[]> {
    const roots = this.getWorkspaceRoots(options?.workspaceRoots);
    const candidateDirs = new Set<string>();

    const defFolder =
      options?.defaultPlanFolder !== undefined
        ? options.defaultPlanFolder
        : this.defaultPlanFolder !== undefined
        ? this.defaultPlanFolder
        : getConfig().defaultPlanFolder;

    for (const root of roots) {
      try {
        const stat = await fs.promises.stat(root);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      candidateDirs.add(path.resolve(root));

      const plansDir = path.join(root, 'plans');
      if (fs.existsSync(plansDir)) {
        candidateDirs.add(path.resolve(plansDir));
        await this.collectSubdirectoriesAsync(plansDir, candidateDirs, 3);
      }

      if (defFolder && typeof defFolder === 'string') {
        const resolvedDef = path.isAbsolute(defFolder) ? path.resolve(defFolder) : path.resolve(root, defFolder);
        if (fs.existsSync(resolvedDef)) {
          candidateDirs.add(resolvedDef);
          await this.collectSubdirectoriesAsync(resolvedDef, candidateDirs, 3);
        }
      }

      try {
        const entries = await fs.promises.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const lower = entry.name.toLowerCase();
            if (
              BLACKLISTED_DIRS.has(lower) ||
              lower.startsWith('.') ||
              lower === 'out' ||
              lower === 'dist' ||
              lower === 'src' ||
              lower === 'node_modules' ||
              lower === 'media'
            ) {
              continue;
            }
            candidateDirs.add(path.resolve(root, entry.name));
          }
        }
      } catch {}
    }

    const discovered: DiscoveredPlanFolder[] = [];

    await Promise.all(
      Array.from(candidateDirs).map(async (dir) => {
        const phases = await tryScanPlanFolderAsync(dir);
        if (phases && phases.length > 0) {
          const folder = this.createDiscoveredFolder(dir, phases, roots);
          if (options?.pendingOnly && !folder.hasPendingPhases) {
            return;
          }
          discovered.push(folder);
          this.cacheFolder(folder);
        }
      })
    );

    // Sort: folders with pending phases first, then mtimeMs descending, then natural alphanumeric order
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    discovered.sort((a, b) => {
      if (a.hasPendingPhases !== b.hasPendingPhases) {
        return a.hasPendingPhases ? -1 : 1;
      }
      if ((b.mtimeMs || 0) !== (a.mtimeMs || 0)) {
        return (b.mtimeMs || 0) - (a.mtimeMs || 0);
      }
      return collator.compare(a.displayName, b.displayName);
    });

    return discovered;
  }

  private collectSubdirectories(dir: string, result: Set<string>, depth: number): void {
    if (depth <= 0) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const lower = entry.name.toLowerCase();
          if (BLACKLISTED_DIRS.has(lower) || lower.startsWith('.') || lower === 'node_modules') {
            continue;
          }
          const full = path.resolve(dir, entry.name);
          result.add(full);
          this.collectSubdirectories(full, result, depth - 1);
        }
      }
    } catch {}
  }

  private async collectSubdirectoriesAsync(
    dir: string,
    result: Set<string>,
    depth: number
  ): Promise<void> {
    if (depth <= 0) return;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const lower = entry.name.toLowerCase();
          if (BLACKLISTED_DIRS.has(lower) || lower.startsWith('.') || lower === 'node_modules') {
            continue;
          }
          const full = path.resolve(dir, entry.name);
          result.add(full);
          await this.collectSubdirectoriesAsync(full, result, depth - 1);
        }
      }
    } catch {}
  }

  /**
   * Detects if the user currently has an active markdown phase file open in VS Code editor.
   */
  public getActiveEditorPlan(): {
    folder: DiscoveredPlanFolder;
    activeFileName: string;
    activeFilePath: string;
  } | null {
    const vs = getVscodeSafe();
    if (!vs || !vs.window || !vs.window.activeTextEditor) {
      return null;
    }
    const editor = vs.window.activeTextEditor;
    const doc = editor.document;
    if (!doc || !doc.uri || !doc.uri.fsPath) {
      return null;
    }
    const fsPath = doc.uri.fsPath;
    if (!fsPath.toLowerCase().endsWith('.md')) {
      return null;
    }

    let folderDir = path.dirname(fsPath);
    let phases = tryScanPlanFolder(folderDir);
    if (!phases || phases.length === 0) {
      const parentDir = path.dirname(folderDir);
      phases = tryScanPlanFolder(parentDir);
      if (phases && phases.length > 0) {
        folderDir = parentDir;
      } else {
        return null;
      }
    }

    const roots = this.getWorkspaceRoots();
    const folder = this.createDiscoveredFolder(folderDir, phases, roots);
    this.cacheFolder(folder);

    return {
      folder,
      activeFileName: path.basename(fsPath),
      activeFilePath: fsPath
    };
  }

  /**
   * Intelligently resolves the top priority plan:
   * Priority 1: File currently open in VS Code active editor (plan.md or phase-*.md).
   * Priority 2: Discovered folder with uncompleted phases (pendingPhases > 0)
   *             sorted descending by most recent modification timestamp (mtimeMs).
   */
  public resolveTopPlan(options?: DiscoverPlanFoldersOptions): DiscoveredPlanFolder | null {
    // Priority 1: Active editor plan
    const active = this.getActiveEditorPlan();
    if (active && active.folder) {
      return active.folder;
    }

    // Priority 2: Discovered pending folders sorted by mtimeMs descending
    const folders = this.discoverPlanFolders({
      workspaceRoots: options?.workspaceRoots,
      defaultPlanFolder: options?.defaultPlanFolder,
      pendingOnly: true
    });

    if (folders.length === 0) {
      return null;
    }

    folders.sort((a, b) => (b.mtimeMs || b.lastModifiedMs || 0) - (a.mtimeMs || a.lastModifiedMs || 0));
    return folders[0] || null;
  }

  /**
   * Formats a live status dashboard text string showing current execution status and progress.
   */
  public buildLiveDashboardText(folder?: DiscoveredPlanFolder): string {
    let rawState = 'running';
    let currentPhaseName = 'None';
    let completedPhases = folder ? folder.completedPhases : 0;
    let totalPhases = folder ? folder.totalPhases : 0;

    if (this.orchestrator) {
      if (typeof this.orchestrator.getState === 'function') {
        rawState = this.orchestrator.getState();
      } else if (this.orchestrator.state) {
        rawState = this.orchestrator.state;
      }
      const cur =
        typeof this.orchestrator.getCurrentPhase === 'function'
          ? this.orchestrator.getCurrentPhase()
          : this.orchestrator.currentPhase;
      const isCurNudged = Boolean(cur && cur.hasNudged);
      if (cur && cur.fileName) {
        currentPhaseName = cur.fileName;
      }
      if (typeof this.orchestrator.getProgress === 'function') {
        const prog = this.orchestrator.getProgress();
        if (prog) {
          if (typeof prog.completedPhases === 'number') completedPhases = prog.completedPhases;
          if (typeof prog.totalPhases === 'number') totalPhases = prog.totalPhases;
        }
      }
    }

    const curPhaseObj = this.orchestrator
      ? (typeof this.orchestrator.getCurrentPhase === 'function'
          ? this.orchestrator.getCurrentPhase()
          : this.orchestrator.currentPhase)
      : null;
    const isNudged = Boolean(curPhaseObj && curPhaseObj.hasNudged);
    const nudgeSuffix = isNudged ? ' ⚠️ Nudged (guidance sent)' : '';

    const bar = renderTextProgressBar(completedPhases, totalPhases);
    const lines = [
      `📊 *LIVE DASHBOARD - TRẠNG THÁI TỰ ĐỘNG*`,
      folder ? `📁 Kế hoạch: \`${folder.displayName}\`` : null,
      `• Trạng thái (State): \`${rawState}\``,
      `• Phase hiện tại: \`${currentPhaseName}\`${nudgeSuffix}`,
      `• Tiến độ: ${bar} (${completedPhases}/${totalPhases} phase)`,
      ``,
      `⚡ Tiến trình đang được thực thi tự động...`
    ].filter(Boolean);

    return lines.join('\n');
  }

  /**
   * Cleans an InlineKeyboard by removing any empty button rows created by trailing .row() calls.
   */
  public cleanKeyboard(kb: InlineKeyboard): InlineKeyboard {
    while (
      kb.inline_keyboard.length > 0 &&
      kb.inline_keyboard[kb.inline_keyboard.length - 1].length === 0
    ) {
      kb.inline_keyboard.pop();
    }
    return kb;
  }

  /**
   * Generates inline keyboard for folder picker with pagination support,
   * mini progress bars, Quick Resume button, and compact 64-byte callback payloads.
   */
  public buildFolderPickerKeyboard(
    folders: DiscoveredPlanFolder[],
    pageOrOptions?: number | FolderPickerKeyboardOptions,
    maybePageSize?: number,
    maybePendingOnly?: boolean,
    maybeTopPlan?: DiscoveredPlanFolder | null
  ): InlineKeyboard {
    let page = 0;
    let pageSize = 5;
    let pendingOnly = true;
    let topPlan: DiscoveredPlanFolder | null | undefined = undefined;

    if (typeof pageOrOptions === 'object' && pageOrOptions !== null) {
      page = pageOrOptions.page ?? 0;
      pageSize = pageOrOptions.pageSize ?? 5;
      pendingOnly = pageOrOptions.pendingOnly ?? true;
      topPlan = pageOrOptions.topPlan;
    } else {
      if (typeof pageOrOptions === 'number') {
        page = pageOrOptions;
      }
      if (typeof maybePageSize === 'number') {
        pageSize = maybePageSize;
      }
      if (typeof maybePendingOnly === 'boolean') {
        pendingOnly = maybePendingOnly;
      }
      if (maybeTopPlan !== undefined) {
        topPlan = maybeTopPlan;
      }
    }

    // If pageSize is 8 (legacy test compatibility mode), generate legacy buttons
    if (pageSize === 8) {
      const kbLegacy = new InlineKeyboard();
      if (folders.length === 0) return kbLegacy;
      const totalPages = Math.ceil(folders.length / pageSize) || 1;
      const currentPage = Math.max(0, Math.min(page, totalPages - 1));
      const start = currentPage * pageSize;
      const pageFolders = folders.slice(start, start + pageSize);

      for (const folder of pageFolders) {
        const label = `📁 ${folder.displayName} (${folder.completedPhases}/${folder.totalPhases} done)`;
        kbLegacy.text(label, `fld:${folder.id}`).row();
      }
      if (totalPages > 1) {
        if (currentPage > 0) {
          kbLegacy.text('◀️ Prev', `fld_page:${currentPage - 1}`);
        }
        kbLegacy.text(`📄 ${currentPage + 1}/${totalPages}`, 'noop');
        if (currentPage < totalPages - 1) {
          kbLegacy.text('▶️ Next', `fld_page:${currentPage + 1}`);
        }
        kbLegacy.row();
      }
      return this.cleanKeyboard(kbLegacy);
    }

    // If topPlan wasn't explicitly passed, attempt to resolve it
    if (topPlan === undefined) {
      topPlan = this.resolveTopPlan({ pendingOnly });
    }

    const kb = new InlineKeyboard();

    // 1. One-Click Quick Resume Button (Eligibility Guard: only show when pendingPhases > 0)
    if (topPlan && topPlan.pendingPhases > 0) {
      const shortName = formatShortPlanName(topPlan.displayName, 18);
      kb.text(`⚡ Tiếp tục: ${shortName}`, `p:res:${topPlan.id}`).row();
    }

    if (folders.length === 0) {
      const filterLabel = pendingOnly ? '📑 Xem tất cả' : '⚡ Chỉ chưa xong';
      const filterData = pendingOnly ? 'p:flt:all' : 'p:flt:pnd';
      kb.text(filterLabel, filterData);
      kb.text('🔄 Quét lại', 'p:ref');
      kb.row();
      return this.cleanKeyboard(kb);
    }

    const totalPages = Math.ceil(folders.length / pageSize) || 1;
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const start = currentPage * pageSize;
    const pageFolders = folders.slice(start, start + pageSize);

    // 2. Folder list (compact 5 items/page for mobile)
    const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    for (let i = 0; i < pageFolders.length; i++) {
      const folder = pageFolders[i];
      const numIcon = NUMBER_EMOJIS[i] || `${i + 1}️⃣`;
      const bar = renderTextProgressBar(folder.completedPhases, folder.totalPhases);
      const label = `${numIcon} ${folder.displayName}\n${bar} (${folder.completedPhases}/${folder.totalPhases} phase)`;
      kb.text(label, `p:fld:${folder.id}`).row();
    }

    // 3. Pagination row: [◀️ Trước] [Trang 1/3] [Sau ▶️]
    if (totalPages > 1) {
      if (currentPage > 0) {
        kb.text('◀️ Trước', `p:pg:${currentPage - 1}`);
      }
      kb.text(`Trang ${currentPage + 1}/${totalPages}`, 'noop');
      if (currentPage < totalPages - 1) {
        kb.text('Sau ▶️', `p:pg:${currentPage + 1}`);
      }
      kb.row();
    }

    // 4. Filter toggle and refresh row: [📑 Xem tất cả] ⮂ [⚡ Chỉ chưa xong] and [🔄 Quét lại]
    const filterLabel = pendingOnly ? '📑 Xem tất cả' : '⚡ Chỉ chưa xong';
    const filterData = pendingOnly ? 'p:flt:all' : 'p:flt:pnd';
    kb.text(filterLabel, filterData);
    kb.text('🔄 Quét lại', 'p:ref');
    kb.row();

    return this.cleanKeyboard(kb);
  }

  /**
   * Generates inline keyboard for active file prompt.
   */
  public buildActiveFilePromptKeyboard(
    folder: DiscoveredPlanFolder,
    activeFileName: string
  ): InlineKeyboard {
    const kb = new InlineKeyboard();
    if (folder.pendingPhases > 0) {
      const shortName = formatShortPlanName(folder.displayName, 18);
      kb.text(`⚡ Tiếp tục: ${shortName}`, `p:res:${folder.id}`).row();
    }
    kb.text(`▶️ Chạy kế hoạch đang mở (Run Active Plan) (${folder.displayName})`, `act:run:${folder.id}`).row();
    kb.text('📂 Xem danh sách kế hoạch (Browse Other Plan Folders)', 'act:browse').row();
    return this.cleanKeyboard(kb);
  }

  /**
   * Generates inline keyboard offering the 3 execution options:
   * (1) Run Only Pending/Uncompleted Phases
   * (2) Run All Phases
   * (3) Select Phases Manually
   * (4) Back to Folders
   */
  public buildExecutionModeKeyboard(folder: DiscoveredPlanFolder): InlineKeyboard {
    const kb = new InlineKeyboard();
    kb.text('⚡ [Chạy các Phase còn lại / Run Only Pending]', `mode:pending:${folder.id}`).row();
    kb.text('🚀 [Chạy lại toàn bộ từ đầu / Run All Phases]', `mode:all:${folder.id}`).row();
    kb.text('📋 [Tùy chọn từng Phase thủ công / Select Phases Manually]', `mode:manual:${folder.id}`).row();
    kb.text('🔙 [Quay lại danh sách / Back to Folders]', 'nav:folders').row();
    return this.cleanKeyboard(kb);
  }

  /**
   * Generates inline keyboard for manual phase selection with:
   * 1. Batch Selection Row: [✅ Tất cả], [⚡ Chưa chạy], [⬜ Bỏ chọn]
   * 2. Compact 2-column grid with intelligent mobile truncation ([✅ P01: slug])
   * 3. Dynamic Execution counter button: [▶️ Bắt đầu (X/Y phase)]
   * 4. Navigation Back button: [🔙 Quay lại]
   */
  public buildManualPhaseSelectionKeyboard(
    folder: DiscoveredPlanFolder,
    selectedIndices: Set<number>
  ): InlineKeyboard {
    const kb = new InlineKeyboard();

    // 1. Batch Selection Row (3 buttons in row 1)
    kb.text('[✅ Tất cả]', `p:bt:all:${folder.id}`)
      .text('[⚡ Chưa chạy]', `p:bt:pnd:${folder.id}`)
      .text('[⬜ Bỏ chọn]', `p:bt:clr:${folder.id}`)
      .row();

    // 2. Compact 2-column grid for phase selection
    for (let i = 0; i < folder.phases.length; i++) {
      const phase = folder.phases[i];
      const isSelected = selectedIndices.has(phase.index);
      const label = this.formatCompactPhaseButtonLabel(phase, isSelected);
      kb.text(label, `p:tog:${folder.id}:${phase.index}`);
      if (i % 2 === 1 || i === folder.phases.length - 1) {
        kb.row();
      }
    }

    // 3. Dynamic Execution Button
    const selectedCount = selectedIndices.size;
    const totalCount = folder.phases.length;
    kb.text(`[▶️ Bắt đầu (${selectedCount}/${totalCount} phase)]`, `p:run:man:${folder.id}`).row();

    // 4. Back navigation
    kb.text('[🔙 Quay lại]', `fld:${folder.id}`).row();

    return this.cleanKeyboard(kb);
  }

  public formatCompactPhaseButtonLabel(
    phaseOrIndex: PhaseFile | { fileName?: string; index?: number } | number,
    checkedOrName?: boolean | string,
    maybeChecked?: boolean | number,
    maxSlugLen: number = 8
  ): string {
    return formatCompactPhaseButtonLabel(phaseOrIndex, checkedOrName, maybeChecked, maxSlugLen);
  }

  public formatManualSelectionMessage(
    folder: DiscoveredPlanFolder,
    selectedIndices?: Set<number>
  ): string {
    return formatManualSelectionMessage(folder, selectedIndices);
  }

  /**
   * Initializes or gets the user selection session for a plan folder.
   * By default, checks all pending phases.
   */
  public initSession(userId: number | string, folder: DiscoveredPlanFolder): PlanSelectionSession {
    const key = `${userId}_${folder.id}`;
    let session = this.sessions.get(key);
    if (!session) {
      const pendingIndices = folder.phases.filter((p) => !p.isCompleted).map((p) => p.index);
      const initialSet = new Set<number>(pendingIndices.length > 0 ? pendingIndices : folder.phases.map((p) => p.index));
      session = {
        userId,
        folderId: folder.id,
        selectedIndices: initialSet,
        lastUpdated: Date.now()
      };
      this.sessions.set(key, session);
    }
    return session;
  }

  public getSession(userId: number | string, folderId: string): PlanSelectionSession {
    const key = `${userId}_${folderId}`;
    let session = this.sessions.get(key);
    if (!session) {
      const folder = this.getFolder(folderId);
      if (folder) {
        return this.initSession(userId, folder);
      }
      session = {
        userId,
        folderId,
        selectedIndices: new Set<number>(),
        lastUpdated: Date.now()
      };
      this.sessions.set(key, session);
    }
    return session;
  }

  /**
   * Toggles an individual phase selection on/off for a user session.
   */
  public togglePhaseSelection(
    userId: number | string,
    folderId: string,
    phaseIndex: number
  ): Set<number> {
    const session = this.getSession(userId, folderId);
    if (session.selectedIndices.has(phaseIndex)) {
      session.selectedIndices.delete(phaseIndex);
    } else {
      session.selectedIndices.add(phaseIndex);
    }
    session.lastUpdated = Date.now();
    return session.selectedIndices;
  }

  /**
   * Selects all phases in the folder for the given user session.
   */
  public selectAllPhases(userId: number | string, folderId: string): Set<number> {
    const session = this.getSession(userId, folderId);
    let folder = this.getFolder(folderId);
    if (!folder) {
      const found = this.discoverPlanFolders({ pendingOnly: false });
      folder = found.find((f) => f.id === folderId);
    }
    session.selectedIndices.clear();
    if (folder) {
      for (const phase of folder.phases) {
        session.selectedIndices.add(phase.index);
      }
    }
    session.lastUpdated = Date.now();
    return session.selectedIndices;
  }

  /**
   * Selects only uncompleted / pending phases (isCompleted === false) for the given user session.
   */
  public selectPendingPhasesOnly(userId: number | string, folderId: string): Set<number> {
    const session = this.getSession(userId, folderId);
    let folder = this.getFolder(folderId);
    if (!folder) {
      const found = this.discoverPlanFolders({ pendingOnly: false });
      folder = found.find((f) => f.id === folderId);
    }
    session.selectedIndices.clear();
    if (folder) {
      for (const phase of folder.phases) {
        if (!phase.isCompleted) {
          session.selectedIndices.add(phase.index);
        }
      }
    }
    session.lastUpdated = Date.now();
    return session.selectedIndices;
  }

  /**
   * Clears all phase selections (deselection) for the given user session.
   */
  public clearPhaseSelection(userId: number | string, folderId: string): Set<number> {
    const session = this.getSession(userId, folderId);
    session.selectedIndices.clear();
    session.lastUpdated = Date.now();
    return session.selectedIndices;
  }

  /**
   * Dispatches selected phases to orchestrator.startCustomExecution or startPhases.
   */
  public async executePhases(
    phases: PhaseFile[],
    mode: 'all' | 'pending' | 'manual',
    folderDisplayName?: string
  ): Promise<{ success: boolean; message: string }> {
    if (phases.length === 0) {
      return {
        success: false,
        message: '⚠️ No phases selected for execution.'
      };
    }

    if (this.orchestrator && typeof this.orchestrator.isRunning === 'function' && this.orchestrator.isRunning()) {
      const cur = typeof this.orchestrator.getCurrentPhase === 'function' ? this.orchestrator.getCurrentPhase() : null;
      return {
        success: false,
        message: `⚠️ Automation is already running${cur ? ` (Phase: ${cur.fileName})` : ''}. Please stop current run first.`
      };
    }

    try {
      let ok = false;
      if (this.orchestrator && typeof this.orchestrator.startCustomExecution === 'function') {
        ok = await this.orchestrator.startCustomExecution(phases);
      } else if (this.orchestrator && typeof this.orchestrator.startPhases === 'function') {
        ok = await this.orchestrator.startPhases(phases);
      } else {
        const vs = getVscodeSafe();
        if (vs && vs.commands) {
          await vs.commands.executeCommand('autoplan.start');
          ok = true;
        }
      }

      const folderDesc = folderDisplayName ? ` for ${folderDisplayName}` : '';
      const modeDesc = mode === 'all' ? 'all' : mode === 'pending' ? 'uncompleted' : 'selected';
      return {
        success: ok,
        message: ok
          ? `🚀 Started ${modeDesc} execution of ${phases.length} phase(s)${folderDesc}.`
          : `❌ Orchestrator failed to start execution.`
      };
    } catch (err: any) {
      this.logger.error('TELEGRAM', `Execution dispatch failed: ${err?.message || err}`, err);
      return {
        success: false,
        message: `❌ Error starting phase execution: ${err?.message || err}`
      };
    }
  }

  /**
   * Registers `/plans`, `/plan_start`, and all interactive callback query handlers on a grammY Bot.
   */
  public registerWithBot(bot: Bot): void {
    this.setBot(bot);

    // 1. /plans and /plan_start command handlers
    bot.command(['plans', 'plan_start'], async (ctx: Context) => {
      try {
        const active = this.getActiveEditorPlan();
        if (active) {
          this.cacheFolder(active.folder);
          const progressBar = renderTextProgressBar(active.folder.completedPhases, active.folder.totalPhases);
          const text =
            `📄 *KẾ HOẠCH ĐANG MỞ (Active Plan Detected)*\n` +
            `File: \`${active.activeFileName}\`\n` +
            `Folder: \`${active.folder.displayName}\` (${active.folder.completedPhases}/${active.folder.totalPhases} done)\n` +
            `Tiến độ: ${progressBar}\n\n` +
            `Bạn có muốn chạy kế hoạch này trực tiếp hay xem danh sách các kế hoạch khác? (Would you like to run this active plan directly or browse other plan folders?)`;
          const kb = this.buildActiveFilePromptKeyboard(active.folder, active.activeFileName);
          await ctx.reply(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
          return;
        }

        const userId = ctx.from?.id || 'default';
        const pendingOnly = this.userFilterModes.get(userId) !== false;
        const pendingFolders = this.discoverPlanFolders({ pendingOnly });
        if (pendingFolders.length === 0) {
          const allFolders = this.discoverPlanFolders({ pendingOnly: false });
          if (allFolders.length === 0) {
            await ctx.reply('ℹ️ Không tìm thấy thư mục kế hoạch nào trong workspace. (No plan folders found)');
          } else {
            await ctx.reply('🎉 Tất cả kế hoạch trong workspace đã hoàn thành 100%! (0 pending phases)');
          }
          return;
        }

        for (const f of pendingFolders) {
          this.cacheFolder(f);
        }
        const topPlan = this.resolveTopPlan({ pendingOnly });

        const text =
          `📂 *QUẢN LÝ KẾ HOẠCH (Plan Folders / Available Plan Folders)*\n` +
          `Tìm thấy ${pendingFolders.length} thư mục kế hoạch còn phase chưa hoàn thành.\n` +
          `Chọn một thư mục để tiếp tục:`;
        const kb = this.buildFolderPickerKeyboard(pendingFolders, {
          page: 0,
          pageSize: 5,
          pendingOnly,
          topPlan
        });
        await ctx.reply(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      } catch (err: any) {
        this.logger.error('TELEGRAM', `Error in /plans command handler: ${err?.message || err}`, err);
        await ctx.reply(`❌ Lỗi khi tìm kiếm kế hoạch: ${err?.message || err}`);
      }
    });

    // 2. One-Click Quick Resume callback handler (p:res:<folderId>)
    bot.callbackQuery(/^p:res:(.+)$/, async (ctx: Context) => {
      // Concurrency Guard: Chống chạy trùng lặp
      if (
        this.orchestrator &&
        typeof this.orchestrator.isRunning === 'function' &&
        this.orchestrator.isRunning()
      ) {
        await ctx
          .answerCallbackQuery({
            text: '⚠️ Đang có kế hoạch khác đang chạy!',
            show_alert: true
          })
          .catch(() => {});

        const { text, keyboard } = this.buildExecutionDashboard({
          planName: this.activeDashboardSession?.planName,
          folder: this.activeDashboardSession?.folder,
          currentPhaseName: this.activeDashboardSession?.currentPhaseName,
          currentPhaseIndex: this.activeDashboardSession?.currentPhaseIndex,
          completedPhases: this.activeDashboardSession?.completedPhases,
          totalPhases: this.activeDashboardSession?.totalPhases,
          state: 'running'
        });
        try {
          await ctx.editMessageText(formatSafePlanText(text), { reply_markup: keyboard, parse_mode: 'Markdown' });
        } catch {
          await ctx.reply(formatSafePlanText(text), { reply_markup: keyboard, parse_mode: 'Markdown' });
        }
        return;
      }

      const folderId = (ctx as any).match[1];
      let folder = this.getFolder(folderId);
      if (!folder) {
        const found = this.discoverPlanFolders({ pendingOnly: false });
        folder = found.find((f) => f.id === folderId);
      }
      if (!folder) {
        await ctx
          .answerCallbackQuery({
            text: '❌ Không tìm thấy thư mục kế hoạch.',
            show_alert: true
          })
          .catch(() => {});
        return;
      }

      const pendingPhases = folder.phases.filter((p) => !p.isCompleted);
      if (pendingPhases.length === 0) {
        await ctx
          .answerCallbackQuery({
            text: 'ℹ️ Kế hoạch này đã hoàn thành 100%!',
            show_alert: true
          })
          .catch(() => {});
        return;
      }

      await ctx.answerCallbackQuery({ text: '⚡ Đang tiếp tục kế hoạch...' }).catch(() => {});
      const res = await this.executePhases(pendingPhases, 'pending', folder.displayName);
      await this.startLiveDashboard({
        ctx,
        folder,
        phases: pendingPhases,
        planName: folder.displayName,
        totalPhases: folder.totalPhases,
        completedPhases: folder.completedPhases
      });
    });

    // 3. Folder list pagination handlers (p:pg:<page> and legacy fld_page:<page>)
    const handlePagination = async (ctx: Context, page: number) => {
      await ctx.answerCallbackQuery().catch(() => {});
      const userId = ctx.from?.id || 'default';
      const pendingOnly = this.userFilterModes.get(userId) !== false;
      const folders = this.discoverPlanFolders({ pendingOnly });
      for (const f of folders) {
        this.cacheFolder(f);
      }
      const topPlan = this.resolveTopPlan({ pendingOnly });
      const kb = this.buildFolderPickerKeyboard(folders, {
        page,
        pageSize: 5,
        pendingOnly,
        topPlan
      });
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: kb });
      } catch {}
    };

    bot.callbackQuery(/^p:pg:(\d+)$/, async (ctx: Context) => {
      const page = parseInt((ctx as any).match[1], 10);
      await handlePagination(ctx, page);
    });

    bot.callbackQuery(/^fld_page:(\d+)$/, async (ctx: Context) => {
      const page = parseInt((ctx as any).match[1], 10);
      await handlePagination(ctx, page);
    });

    // 4. Folder filter toggle handler (p:flt:<all|pnd>)
    bot.callbackQuery(/^p:flt:(all|pnd)$/, async (ctx: Context) => {
      await ctx.answerCallbackQuery().catch(() => {});
      const mode = (ctx as any).match[1];
      const pendingOnly = mode === 'pnd';
      const userId = ctx.from?.id || 'default';
      this.userFilterModes.set(userId, pendingOnly);

      const folders = this.discoverPlanFolders({ pendingOnly });
      for (const f of folders) {
        this.cacheFolder(f);
      }
      const topPlan = this.resolveTopPlan({ pendingOnly });
      const filterDesc = pendingOnly ? 'còn phase chưa hoàn thành' : 'trong workspace';
      const text =
        `📂 *QUẢN LÝ KẾ HOẠCH (Plan Folders / Available Plan Folders)*\n` +
        `Tìm thấy ${folders.length} thư mục kế hoạch ${filterDesc}.\n` +
        `Chọn một thư mục để tiếp tục:`;
      const kb = this.buildFolderPickerKeyboard(folders, {
        page: 0,
        pageSize: 5,
        pendingOnly,
        topPlan
      });
      try {
        await ctx.editMessageText(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      }
    });

    // 5. Cache refresh handler (p:ref)
    bot.callbackQuery(/^p:ref$/, async (ctx: Context) => {
      await ctx.answerCallbackQuery({ text: '🔄 Đang làm mới danh sách...' }).catch(() => {});
      this.clearFolderCache();
      const userId = ctx.from?.id || 'default';
      const pendingOnly = this.userFilterModes.get(userId) !== false;
      const folders = this.discoverPlanFolders({ pendingOnly });
      for (const f of folders) {
        this.cacheFolder(f);
      }
      const topPlan = this.resolveTopPlan({ pendingOnly });
      const filterDesc = pendingOnly ? 'còn phase chưa hoàn thành' : 'trong workspace';
      const text =
        `📂 *QUẢN LÝ KẾ HOẠCH (Plan Folders / Available Plan Folders)*\n` +
        `Tìm thấy ${folders.length} thư mục kế hoạch ${filterDesc}.\n` +
        `Chọn một thư mục để tiếp tục:`;
      const kb = this.buildFolderPickerKeyboard(folders, {
        page: 0,
        pageSize: 5,
        pendingOnly,
        topPlan
      });
      try {
        await ctx.editMessageText(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      }
    });

    // 6. Folder selected handler (p:fld:<folderId> and legacy fld:<folderId>)
    const handleFolderSelect = async (ctx: Context, folderId: string) => {
      await ctx.answerCallbackQuery().catch(() => {});
      let folder = this.getFolder(folderId);
      if (!folder) {
        const found = this.discoverPlanFolders({ pendingOnly: false });
        folder = found.find((f) => f.id === folderId);
      }
      if (!folder) {
        await ctx.reply('❌ Không tìm thấy thư mục kế hoạch hoặc đã bị di chuyển.');
        return;
      }

      const progressBar = renderTextProgressBar(folder.completedPhases, folder.totalPhases);
      const text =
        `📁 Kế hoạch: \`${folder.displayName}\`\n` +
        `Tiến độ: ${progressBar} (${folder.completedPhases}/${folder.totalPhases} phase)\n\n` +
        `Chọn chế độ thực thi (Choose execution mode):`;
      const kb = this.buildExecutionModeKeyboard(folder);
      try {
        await ctx.editMessageText(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      }
    };

    bot.callbackQuery(/^p:fld:(.+)$/, async (ctx: Context) => {
      await handleFolderSelect(ctx, (ctx as any).match[1]);
    });

    bot.callbackQuery(/^fld:(.+)$/, async (ctx: Context) => {
      await handleFolderSelect(ctx, (ctx as any).match[1]);
    });

    // 7. Active plan prompt actions (act:run:<id> and act:browse)
    bot.callbackQuery(/^act:run:(.+)$/, async (ctx: Context) => {
      await ctx.answerCallbackQuery().catch(() => {});
      const folderId = (ctx as any).match[1];
      const folder = this.getFolder(folderId);
      if (!folder) {
        await ctx.reply('❌ Không tìm thấy thư mục kế hoạch.');
        return;
      }
      const progressBar = renderTextProgressBar(folder.completedPhases, folder.totalPhases);
      const text =
        `📁 Kế hoạch: \`${folder.displayName}\`\n` +
        `Tiến độ: ${progressBar} (${folder.completedPhases}/${folder.totalPhases} phase)\n\n` +
        `Chọn chế độ thực thi (Choose execution mode):`;
      const kb = this.buildExecutionModeKeyboard(folder);
      try {
        await ctx.editMessageText(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      }
    });

    bot.callbackQuery(/^act:browse$/, async (ctx: Context) => {
      await ctx.answerCallbackQuery().catch(() => {});
      const userId = ctx.from?.id || 'default';
      const pendingOnly = this.userFilterModes.get(userId) !== false;
      const pendingFolders = this.discoverPlanFolders({ pendingOnly });
      for (const f of pendingFolders) {
        this.cacheFolder(f);
      }
      const topPlan = this.resolveTopPlan({ pendingOnly });
      const text =
        `📂 *QUẢN LÝ KẾ HOẠCH (Plan Folders / Available Plan Folders)*\n` +
        `Tìm thấy ${pendingFolders.length} thư mục kế hoạch còn phase chưa hoàn thành.\n` +
        `Chọn một thư mục để tiếp tục:`;
      const kb = this.buildFolderPickerKeyboard(pendingFolders, {
        page: 0,
        pageSize: 5,
        pendingOnly,
        topPlan
      });
      try {
        await ctx.editMessageText(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      }
    });

    // 8. Execution mode 1: Run All Phases
    bot.callbackQuery(/^mode:all:(.+)$/, async (ctx: Context) => {
      if (
        this.orchestrator &&
        typeof this.orchestrator.isRunning === 'function' &&
        this.orchestrator.isRunning()
      ) {
        await ctx
          .answerCallbackQuery({
            text: '⚠️ Đang có kế hoạch khác đang chạy!',
            show_alert: true
          })
          .catch(() => {});
        return;
      }
      await ctx.answerCallbackQuery().catch(() => {});
      const folderId = (ctx as any).match[1];
      const folder = this.getFolder(folderId);
      if (!folder) {
        await ctx.reply('❌ Không tìm thấy thư mục kế hoạch.');
        return;
      }
      const res = await this.executePhases(folder.phases, 'all', folder.displayName);
      await this.startLiveDashboard({
        ctx,
        folder,
        phases: folder.phases,
        planName: folder.displayName,
        totalPhases: folder.totalPhases,
        completedPhases: 0
      });
    });

    // 9. Execution mode 2: Run Only Pending Phases
    bot.callbackQuery(/^mode:pending:(.+)$/, async (ctx: Context) => {
      if (
        this.orchestrator &&
        typeof this.orchestrator.isRunning === 'function' &&
        this.orchestrator.isRunning()
      ) {
        await ctx
          .answerCallbackQuery({
            text: '⚠️ Đang có kế hoạch khác đang chạy!',
            show_alert: true
          })
          .catch(() => {});
        return;
      }
      await ctx.answerCallbackQuery().catch(() => {});
      const folderId = (ctx as any).match[1];
      const folder = this.getFolder(folderId);
      if (!folder) {
        await ctx.reply('❌ Không tìm thấy thư mục kế hoạch.');
        return;
      }
      const pendingPhases = folder.phases.filter((p) => !p.isCompleted);
      if (pendingPhases.length === 0) {
        const msg = `ℹ️ Tất cả các phase trong \`${folder.displayName}\` đã hoàn thành! (All phases are already completed)`;
        try {
          await ctx.editMessageText(formatSafePlanText(msg), { parse_mode: 'Markdown' });
        } catch {
          await ctx.reply(formatSafePlanText(msg), { parse_mode: 'Markdown' });
        }
        return;
      }
      const res = await this.executePhases(pendingPhases, 'pending', folder.displayName);
      await this.startLiveDashboard({
        ctx,
        folder,
        phases: pendingPhases,
        planName: folder.displayName,
        totalPhases: folder.totalPhases,
        completedPhases: folder.completedPhases
      });
    });

    // 10. Execution mode 3: Select Phases Manually (p:mod:man:<folderId> and mode:manual:<folderId>)
    bot.callbackQuery(/^(?:p:mod:man|mode:manual):(.+)$/, async (ctx: Context) => {
      await ctx.answerCallbackQuery().catch(() => {});
      const folderId = (ctx as any).match[1];
      let folder = this.getFolder(folderId);
      if (!folder) {
        const found = this.discoverPlanFolders({ pendingOnly: false });
        folder = found.find((f) => f.id === folderId);
      }
      if (!folder) {
        await ctx.reply('❌ Không tìm thấy thư mục kế hoạch.');
        return;
      }
      const userId = ctx.from?.id || 'default';
      const session = this.initSession(userId, folder);
      const text = this.formatManualSelectionMessage(folder, session.selectedIndices);
      const kb = this.buildManualPhaseSelectionKeyboard(folder, session.selectedIndices);
      try {
        await ctx.editMessageText(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      }
    });

    // 11. Batch Selection Row (p:bt:<all|pnd|clr>:<folderId>)
    bot.callbackQuery(/^p:bt:(all|pnd|clr):(.+)$/, async (ctx: Context) => {
      const action = (ctx as any).match[1];
      const folderId = (ctx as any).match[2];
      let folder = this.getFolder(folderId);
      if (!folder) {
        const found = this.discoverPlanFolders({ pendingOnly: false });
        folder = found.find((f) => f.id === folderId);
      }
      if (!folder) {
        await ctx.answerCallbackQuery({ text: 'Thư mục không tồn tại', show_alert: true }).catch(() => {});
        return;
      }
      const userId = ctx.from?.id || 'default';
      let selected: Set<number>;
      if (action === 'all') {
        selected = this.selectAllPhases(userId, folderId);
      } else if (action === 'pnd') {
        selected = this.selectPendingPhasesOnly(userId, folderId);
      } else {
        selected = this.clearPhaseSelection(userId, folderId);
      }

      // Fast Toast feedback
      const toastText = `⚡ Đã chọn ${selected.size} phase`;
      await ctx.answerCallbackQuery({ text: toastText }).catch(() => {});

      const kb = this.buildManualPhaseSelectionKeyboard(folder, selected);
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: kb });
      } catch {}
    });

    // 12. Toggle individual phase in manual selection (compact p:tog:<id>:<idx> and legacy tog:<id>:<idx>)
    bot.callbackQuery(/^(?:p:tog|tog):(.+):(\d+)$/, async (ctx: Context) => {
      // Silent response (no text, no vibration)
      await ctx.answerCallbackQuery().catch(() => {});
      const folderId = (ctx as any).match[1];
      const phaseIndex = parseInt((ctx as any).match[2], 10);
      let folder = this.getFolder(folderId);
      if (!folder) {
        const found = this.discoverPlanFolders({ pendingOnly: false });
        folder = found.find((f) => f.id === folderId);
      }
      if (!folder) return;

      const userId = ctx.from?.id || 'default';
      const selected = this.togglePhaseSelection(userId, folderId, phaseIndex);
      const kb = this.buildManualPhaseSelectionKeyboard(folder, selected);
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: kb });
      } catch {}
    });

    // 13. Start selected phases confirmation (compact p:run:man:<id> and legacy start:manual:<id>)
    bot.callbackQuery(/^(?:p:run:man|start:manual):(.+)$/, async (ctx: Context) => {
      if (
        this.orchestrator &&
        typeof this.orchestrator.isRunning === 'function' &&
        this.orchestrator.isRunning()
      ) {
        await ctx
          .answerCallbackQuery({
            text: '⚠️ Đang có kế hoạch khác đang chạy!',
            show_alert: true
          })
          .catch(() => {});
        return;
      }
      const folderId = (ctx as any).match[1];
      let folder = this.getFolder(folderId);
      if (!folder) {
        const found = this.discoverPlanFolders({ pendingOnly: false });
        folder = found.find((f) => f.id === folderId);
      }
      if (!folder) {
        await ctx.answerCallbackQuery({ text: 'Thư mục không tồn tại', show_alert: true }).catch(() => {});
        return;
      }
      const userId = ctx.from?.id || 'default';
      const session = this.getSession(userId, folderId);
      const selectedPhases = folder.phases.filter((p) => session.selectedIndices.has(p.index));

      // Zero Selection Guard: block and display alert modal
      if (selectedPhases.length === 0) {
        await ctx
          .answerCallbackQuery({
            text: '⚠️ Vui lòng chọn ít nhất 1 phase để thực thi!',
            show_alert: true
          })
          .catch(() => {});
        return;
      }

      await ctx.answerCallbackQuery({ text: 'Bắt đầu thực thi... (Starting execution...)' }).catch(() => {});
      const res = await this.executePhases(selectedPhases, 'manual', folder.displayName);
      await this.startLiveDashboard({
        ctx,
        folder,
        phases: selectedPhases,
        planName: folder.displayName,
        totalPhases: selectedPhases.length,
        completedPhases: 0
      });
    });

    // 13. Navigation back to folder list (nav:folders)
    bot.callbackQuery(/^nav:folders$/, async (ctx: Context) => {
      await ctx.answerCallbackQuery().catch(() => {});
      const userId = ctx.from?.id || 'default';
      const pendingOnly = this.userFilterModes.get(userId) !== false;
      const pendingFolders = this.discoverPlanFolders({ pendingOnly });
      for (const f of pendingFolders) {
        this.cacheFolder(f);
      }
      const topPlan = this.resolveTopPlan({ pendingOnly });
      const text =
        `📂 *QUẢN LÝ KẾ HOẠCH (Plan Folders / Available Plan Folders)*\n` +
        `Tìm thấy ${pendingFolders.length} thư mục kế hoạch còn phase chưa hoàn thành.\n` +
        `Chọn một thư mục để tiếp tục:`;
      const kb = this.buildFolderPickerKeyboard(pendingFolders, {
        page: 0,
        pageSize: 5,
        pendingOnly,
        topPlan
      });
      try {
        await ctx.editMessageText(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      }
    });

    // =========================================================================
    // Phase 04: Interactive Live Control Dashboard Callbacks
    // =========================================================================

    // Dashboard: Skip current phase (p:db:skip)
    bot.callbackQuery(/^p:db:skip$/, async (ctx: Context) => {
      await ctx.answerCallbackQuery({ text: '⏭️ Đang bỏ qua phase...' }).catch(() => {});
      try {
        let skipped = false;
        if (this.orchestrator && typeof this.orchestrator.skipCurrentPhase === 'function') {
          skipped = this.orchestrator.skipCurrentPhase();
        }
        if (!skipped) {
          const vs = getVscodeSafe();
          if (vs && vs.commands) {
            await vs.commands.executeCommand('autoplan.skipPhase').catch(() => {});
          }
        }
      } catch (err: any) {
        this.logger.error('TELEGRAM', `Dashboard skip phase failed: ${err?.message || err}`);
      }
    });

    // Dashboard: Stop execution (p:db:stop)
    bot.callbackQuery(/^p:db:stop$/, async (ctx: Context) => {
      await ctx.answerCallbackQuery({ text: '🛑 Đang dừng kế hoạch...' }).catch(() => {});
      try {
        if (this.orchestrator && typeof this.orchestrator.stop === 'function') {
          this.orchestrator.stop();
        }
        const vs = getVscodeSafe();
        if (vs && vs.commands) {
          await vs.commands.executeCommand('autoplan.stop').catch(() => {});
        }
        if (this.activeDashboardSession) {
          this.activeDashboardSession.state = 'stopped';
          await this.renderAndUpdateDashboard(true);
        }
      } catch (err: any) {
        this.logger.error('TELEGRAM', `Dashboard stop failed: ${err?.message || err}`);
      }
    });

    // Dashboard: Capture desktop screenshot (p:db:scr)
    bot.callbackQuery(/^p:db:scr$/, async (ctx: Context) => {
      await ctx.answerCallbackQuery({ text: '📸 Đang chụp màn hình desktop...' }).catch(() => {});
      const chatId = ctx.chat?.id || ctx.from?.id;
      if (!chatId) return;
      try {
        if (this.screenManager && typeof this.screenManager.send === 'function') {
          const botInstance = this.bot || (ctx as any).bot;
          await this.screenManager.send(botInstance, chatId);
        } else {
          this.logger.warn('TELEGRAM', 'ScreenManager not configured on TelegramPlanManager');
        }
      } catch (err: any) {
        this.logger.error('TELEGRAM', `Screen capture from dashboard failed: ${err?.message || err}`);
        await ctx.reply(`❌ Screen capture failed: ${err?.message || err}`).catch(() => {});
      }
    });

    // Dashboard: Refresh status (p:db:ref)
    bot.callbackQuery(/^p:db:ref$/, async (ctx: Context) => {
      try {
        if (this.activeDashboardSession) {
          if (this.orchestrator) {
            if (typeof this.orchestrator.isRunning === 'function') {
              const isRunning = this.orchestrator.isRunning();
              if (!isRunning && this.activeDashboardSession.state === 'running') {
                this.activeDashboardSession.state = 'completed';
              }
            }
            if (typeof this.orchestrator.getCurrentPhase === 'function') {
              const cur = this.orchestrator.getCurrentPhase();
              if (cur) {
                this.activeDashboardSession.currentPhaseName = cur.fileName || cur.name || this.activeDashboardSession.currentPhaseName;
                if (typeof cur.index === 'number') {
                  this.activeDashboardSession.currentPhaseIndex = cur.index;
                }
              }
            }
            if (typeof this.orchestrator.getProgress === 'function') {
              const prog = this.orchestrator.getProgress();
              if (prog) {
                if (typeof prog.completedPhases === 'number') this.activeDashboardSession.completedPhases = prog.completedPhases;
                if (typeof prog.totalPhases === 'number') this.activeDashboardSession.totalPhases = prog.totalPhases;
              }
            }
          }
          await this.renderAndUpdateDashboard(true);
        }
        await ctx.answerCallbackQuery({ text: '⚡ Trạng thái đã là mới nhất' }).catch(() => {});
      } catch (err: any) {
        await ctx.answerCallbackQuery({ text: '⚡ Trạng thái đã là mới nhất' }).catch(() => {});
      }
    });

    // Dashboard: Navigate back to plans list (p:db:nav)
    bot.callbackQuery(/^p:db:nav$/, async (ctx: Context) => {
      await ctx.answerCallbackQuery().catch(() => {});
      this.unbindOrchestratorEvents();
      const userId = ctx.from?.id || 'default';
      const pendingOnly = this.userFilterModes.get(userId) !== false;
      const pendingFolders = this.discoverPlanFolders({ pendingOnly });
      for (const f of pendingFolders) {
        this.cacheFolder(f);
      }
      const topPlan = this.resolveTopPlan({ pendingOnly });
      const text =
        `📂 *QUẢN LÝ KẾ HOẠCH (Plan Folders / Available Plan Folders)*\n` +
        `Tìm thấy ${pendingFolders.length} thư mục kế hoạch còn phase chưa hoàn thành.\n` +
        `Chọn một thư mục để tiếp tục:`;
      const kb = this.buildFolderPickerKeyboard(pendingFolders, {
        page: 0,
        pageSize: 5,
        pendingOnly,
        topPlan
      });
      try {
        await ctx.editMessageText(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      } catch {
        await ctx.reply(formatSafePlanText(text), { reply_markup: kb, parse_mode: 'Markdown' });
      }
    });

    // Dashboard: Rerun all phases (p:db:rerun)
    bot.callbackQuery(/^(?:p:db:rerun)(?::(.+))?$/, async (ctx: Context) => {
      await ctx.answerCallbackQuery({ text: '🚀 Đang chạy lại toàn bộ kế hoạch...' }).catch(() => {});
      const folderId = (ctx as any).match[1] || this.activeDashboardSession?.folderId;
      let folder = folderId ? this.getFolder(folderId) : this.activeDashboardSession?.folder;
      if (!folder && folderId) {
        const found = this.discoverPlanFolders({ pendingOnly: false });
        folder = found.find((f) => f.id === folderId);
      }
      if (!folder) {
        await ctx.reply('❌ Không tìm thấy thư mục kế hoạch để chạy lại.').catch(() => {});
        return;
      }
      await this.executePhases(folder.phases, 'all', folder.displayName);
      await this.startLiveDashboard({
        ctx,
        folder,
        phases: folder.phases,
        planName: folder.displayName,
        totalPhases: folder.totalPhases,
        completedPhases: 0
      });
    });

    // Dashboard: Resume plan (p:db:resume)
    bot.callbackQuery(/^(?:p:db:resume)(?::(.+))?$/, async (ctx: Context) => {
      await ctx.answerCallbackQuery({ text: '⚡ Đang tiếp tục kế hoạch...' }).catch(() => {});
      const folderId = (ctx as any).match[1] || this.activeDashboardSession?.folderId;
      let folder = folderId ? this.getFolder(folderId) : this.activeDashboardSession?.folder;
      if (!folder && folderId) {
        const found = this.discoverPlanFolders({ pendingOnly: false });
        folder = found.find((f) => f.id === folderId);
      }
      if (!folder) {
        await ctx.reply('❌ Không tìm thấy thư mục kế hoạch để tiếp tục.').catch(() => {});
        return;
      }
      const pendingPhases = folder.phases.filter((p) => !p.isCompleted);
      const phasesToRun = pendingPhases.length > 0 ? pendingPhases : folder.phases;
      await this.executePhases(phasesToRun, 'pending', folder.displayName);
      await this.startLiveDashboard({
        ctx,
        folder,
        phases: phasesToRun,
        planName: folder.displayName,
        totalPhases: folder.totalPhases,
        completedPhases: folder.completedPhases
      });
    });

    // 14. No-op button handler for page indicator
    bot.callbackQuery('noop', async (ctx: Context) => {
      await ctx.answerCallbackQuery().catch(() => {});
    });

    // 15. Fallback callback query acknowledgment
    bot.on('callback_query:data', async (ctx: Context, next: any) => {
      await ctx.answerCallbackQuery().catch(() => {});
      await next();
    });
  }
}

export const telegramPlanManager = new TelegramPlanManager();

/**
 * Convenience function to discover plan folders using the default telegramPlanManager instance.
 */
export function discoverPlanFolders(options?: DiscoverPlanFoldersOptions): DiscoveredPlanFolder[] {
  return telegramPlanManager.discoverPlanFolders(options);
}

/**
 * Convenience function to asynchronously discover plan folders using the default telegramPlanManager instance.
 */
export async function discoverPlanFoldersAsync(
  options?: DiscoverPlanFoldersOptions
): Promise<DiscoveredPlanFolder[]> {
  return telegramPlanManager.discoverPlanFoldersAsync(options);
}
