import { Bot, Context, NextFunction, GrammyError, HttpError, InlineKeyboard } from 'grammy';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as http from 'http';
import { getConfig, getTelegramConfig, TelegramConfig, SecretStorageManager, secretStorageManager } from './config';
import { debugLogger, DebugLogger } from './debugLogger';
import { PORT_REGISTRY_FILENAME, PortRegistryData, TelegramLeaderEntry } from './bridgeServer';
import { getWorkbenchPath } from './workbenchInjector';
import { TelegramPlanManager, telegramPlanManager } from './telegramPlanManager';
import { PromptDispatcher, promptDispatcher as defaultPromptDispatcher } from './promptDispatcher';
import { KeyboardManager, keyboardManager as defaultKeyboardManager } from './keyboardManager';
import { splitMessage, sanitizeTelegramInput, stripMarkdownToPlainText } from './telegramUtils';
import { ThrottledNotifier, ThrottledNotifierOptions } from './telegramNotifier';
import { getDefaultBrainDir, getTranscriptPath, findLatestConversation, findLatestConversationAsync } from './transcriptWatcher';
import {
  PromptOriginTracker,
  promptOriginTracker as defaultPromptOriginTracker,
  formatPcPrompt,
  PromptOrigin,
  PromptOriginResult
} from './promptOriginTracker';
import {
  TelegramChatMirror,
  TelegramChatMirrorOptions,
  DEFAULT_AI_RESPONSE_HEADER
} from './telegramChatMirror';
import { TranscriptTailEngine } from './transcriptTailEngine';

export const INTERNAL_BOT_COMMANDS = new Set<string>([
  'start',
  'help',
  'plans',
  'plan_start',
  'plan_status',
  'plan_skip',
  'plan_stop',
  'screen',
  'new_chat',
  'newchat',
  'new-chat',
  'workspaces',
  'workspace',
  'ws'
]);

export interface TelegramBotCommandItem {
  command: string;
  description: string;
}

/**
 * Complete catalog of Antigravity IDE workflow slash commands with localized Vietnamese descriptions and icons.
 */
export const WORKFLOW_COMMAND_CATALOG: TelegramBotCommandItem[] = [
  { command: 'init', description: '✨ Khởi tạo dự án mới' },
  { command: 'brainstorm', description: '💡 Bàn ý tưởng, research' },
  { command: 'plan', description: '📋 Lên kế hoạch tính năng' },
  { command: 'design', description: '🎨 Thiết kế kỹ thuật (DB, API, Flow)' },
  { command: 'visualize', description: '🖼️ Thiết kế UI/UX mockup' },
  { command: 'code', description: '💻 Viết code' },
  { command: 'run', description: '▶️ Chạy ứng dụng' },
  { command: 'debug', description: '🐛 Sửa lỗi' },
  { command: 'test', description: '🧪 Kiểm thử' },
  { command: 'audit', description: '🔒 Kiểm tra bảo mật' },
  { command: 'deploy', description: '🚀 Deploy production' },
  { command: 'next', description: '➡️ Gợi ý bước tiếp theo' },
  { command: 'recap', description: '📖 Khôi phục ngữ cảnh' },
  { command: 'help', description: '❓ Trợ giúp & Hướng dẫn' },
  { command: 'review', description: '👀 Review code' },
  { command: 'refactor', description: '🔧 Tái cấu trúc code' },
  { command: 'customize', description: '⚙️ Cá nhân hóa AI' },
  { command: 'rollback', description: '⏪ Rollback deployment' },
  { command: 'save_brain', description: '🧠 Lưu kiến thức (/save-brain)' },
  { command: 'awf_update', description: '📦 Cập nhật AWF (/awf-update)' },
  { command: 'cloudflare_tunnel', description: '🌐 Quản lý tunnel (/cloudflare-tunnel)' }
];

/**
 * Management commands for plan execution, screen capture, and session control.
 */
export const MANAGEMENT_COMMAND_CATALOG: TelegramBotCommandItem[] = [
  { command: 'plans', description: '📋 Danh sách kế hoạch' },
  { command: 'plan_status', description: '📊 Trạng thái thực thi kế hoạch' },
  { command: 'plan_skip', description: '⏭️ Bỏ qua phase hiện tại' },
  { command: 'plan_stop', description: '🛑 Dừng thực thi kế hoạch' },
  { command: 'screen', description: '📸 Chụp màn hình máy tính' },
  { command: 'new_chat', description: '💬 Tạo phiên chat mới' }
];

/**
 * Combined catalog of all 27 slash commands registered with Telegram via `setMyCommands`.
 */
export const FULL_BOT_COMMAND_CATALOG: TelegramBotCommandItem[] = [
  ...WORKFLOW_COMMAND_CATALOG,
  ...MANAGEMENT_COMMAND_CATALOG
];

export const BOT_COMMAND_CATALOG = FULL_BOT_COMMAND_CATALOG;
export const TELEGRAM_BOT_COMMANDS = FULL_BOT_COMMAND_CATALOG;

/**
 * Mapping from Telegram underscore command names to Antigravity IDE hyphenated workflow commands.
 */
export const WORKFLOW_COMMAND_MAP: Record<string, string> = {
  save_brain: 'save-brain',
  awf_update: 'awf-update',
  cloudflare_tunnel: 'cloudflare-tunnel'
};

/**
 * Mapping from Antigravity IDE hyphenated workflow commands to Telegram underscore commands.
 */
export const WORKFLOW_COMMAND_REVERSE_MAP: Record<string, string> = {
  'save-brain': 'save_brain',
  'awf-update': 'awf_update',
  'cloudflare-tunnel': 'cloudflare_tunnel'
};

/**
 * Complete set of recognized workflow command names (including both underscore and hyphen forms).
 */
export const WORKFLOW_COMMAND_NAMES = new Set<string>([
  'init',
  'brainstorm',
  'plan',
  'design',
  'visualize',
  'code',
  'run',
  'debug',
  'test',
  'audit',
  'deploy',
  'next',
  'recap',
  'help',
  'review',
  'refactor',
  'customize',
  'rollback',
  'save_brain',
  'save-brain',
  'awf_update',
  'awf-update',
  'cloudflare_tunnel',
  'cloudflare-tunnel'
]);

/**
 * Normalizes a Telegram workflow command (or prompt starting with a workflow command)
 * by converting Telegram underscore aliases back to IDE hyphenated commands
 * (e.g., `/save_brain` -> `/save-brain`, `save_brain` -> `save-brain`).
 */
export function normalizeTelegramWorkflowCommand(cmd: string): string {
  if (!cmd || typeof cmd !== 'string') {
    return '';
  }
  const hasSlash = cmd.startsWith('/');
  const trimmed = cmd.trim();
  const withoutSlash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;

  const match = withoutSlash.match(/^([a-zA-Z0-9_-]+)(?:@[a-zA-Z0-9_]+)?(\s*[\s\S]*)?$/);
  if (!match) {
    return cmd;
  }

  const token = match[1].toLowerCase();
  const rest = match[2] || '';
  const mappedToken = WORKFLOW_COMMAND_MAP[token] || token;

  const prefix = hasSlash ? '/' : '';
  return prefix + mappedToken + rest;
}

/**
 * Bidirectional counterpart: converts an IDE hyphenated workflow command
 * to a Telegram-compliant underscore command (e.g., `/save-brain` -> `/save_brain`).
 */
export function toTelegramWorkflowCommand(cmd: string): string {
  if (!cmd || typeof cmd !== 'string') {
    return '';
  }
  const hasSlash = cmd.startsWith('/');
  const trimmed = cmd.trim();
  const withoutSlash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;

  const match = withoutSlash.match(/^([a-zA-Z0-9_-]+)(?:@[a-zA-Z0-9_]+)?(\s*[\s\S]*)?$/);
  if (!match) {
    return cmd;
  }

  const token = match[1].toLowerCase();
  const rest = match[2] || '';
  const mappedToken = WORKFLOW_COMMAND_REVERSE_MAP[token] || token;

  const prefix = hasSlash ? '/' : '';
  return prefix + mappedToken + rest;
}

/**
 * Checks whether the given command is an Antigravity IDE workflow command,
 * distinguishing it from internal bot administration commands.
 */
export function isWorkflowCommand(cmd: string): boolean {
  if (!cmd || typeof cmd !== 'string') {
    return false;
  }
  const clean = cmd.trim().replace(/^\//, '').toLowerCase();
  const rawToken = clean.split(/\s+/)[0];
  const token = rawToken.split('@')[0];
  return WORKFLOW_COMMAND_NAMES.has(token);
}

export interface ParsedWorkflowCommand {
  isWorkflow: boolean;
  command: string;          // Normalized command name (e.g., 'save-brain')
  rawCommand: string;       // Original command name before mapping (e.g., 'save_brain')
  args: string;             // Preserved trailing argument string
  normalizedPrompt: string; // Complete normalized prompt ready for dispatch (e.g., '/save-brain custom note')
}

/**
 * Parses an incoming text message to detect and extract workflow slash command and its arguments.
 * Distinguishes AWF workflow commands from internal bot administration commands.
 */
export function parseWorkflowCommand(text: string): ParsedWorkflowCommand | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:@[a-zA-Z0-9_]+)?(?:\s+([\s\S]*))?$/);
  if (!match) {
    return null;
  }

  const rawToken = match[1].toLowerCase();

  // Internal bot commands (e.g., /plans, /screen, /new_chat) are not workflow commands
  if (INTERNAL_BOT_COMMANDS.has(rawToken)) {
    return null;
  }

  // Must match known AWF workflow commands
  if (!WORKFLOW_COMMAND_NAMES.has(rawToken)) {
    return null;
  }

  const normalizedCommand = WORKFLOW_COMMAND_MAP[rawToken] || rawToken;
  const rawArgs = match[2] ? match[2].trim() : '';

  const normalizedPrompt = rawArgs.length > 0
    ? `/${normalizedCommand} ${rawArgs}`
    : `/${normalizedCommand}`;

  return {
    isWorkflow: true,
    command: normalizedCommand,
    rawCommand: match[1],
    args: rawArgs,
    normalizedPrompt
  };
}

/**
 * Synchronizes the full catalog of workflow and management slash commands
 * with the Telegram Bot API via `setMyCommands`.
 */
export async function syncBotCommands(
  bot: Bot,
  catalog: TelegramBotCommandItem[] = FULL_BOT_COMMAND_CATALOG,
  logger: DebugLogger = debugLogger
): Promise<boolean> {
  if (!bot || !bot.api || typeof bot.api.setMyCommands !== 'function') {
    logger.warn('TELEGRAM', 'Cannot sync bot commands: Bot instance or bot.api.setMyCommands is unavailable');
    return false;
  }

  // Telegram API constraints: max 100 commands, regex ^[a-z0-9_]{1,32}$
  const TELEGRAM_CMD_REGEX = /^[a-z0-9_]{1,32}$/;
  const validCommands: TelegramBotCommandItem[] = [];

  for (const item of catalog) {
    if (!item || !item.command || !item.description) {
      continue;
    }
    const rawCmd = item.command.trim();
    if (!TELEGRAM_CMD_REGEX.test(rawCmd)) {
      logger.warn(
        'TELEGRAM',
        `Skipping invalid command name '${item.command}' - must match ^[a-z0-9_]{1,32}$`
      );
      continue;
    }
    validCommands.push({
      command: rawCmd,
      description: item.description.slice(0, 256)
    });
    if (validCommands.length >= 100) {
      logger.warn('TELEGRAM', 'Reached maximum limit of 100 commands for setMyCommands; truncating remaining');
      break;
    }
  }

  const maxRetries = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await bot.api.setMyCommands(validCommands);
      logger.info(
        'TELEGRAM',
        `Successfully registered ${validCommands.length} slash commands via bot.api.setMyCommands`
      );
      return true;
    } catch (err: any) {
      lastError = err;
      logger.warn(
        'TELEGRAM',
        `bot.api.setMyCommands failed (attempt ${attempt}/${maxRetries}): ${err?.message || err}`
      );
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      }
    }
  }

  logger.error(
    'TELEGRAM',
    `Failed to register bot commands after ${maxRetries} attempts: ${lastError?.message || lastError}`,
    lastError
  );
  return false;
}

import {
  TelegramScreenManager,
  telegramScreenManager as defaultScreenManager,
  ScreenCaptureOptions,
  renderProgressBar,
  mapOrchestratorState,
  formatPlanStatus,
  PlanStatusInfo
} from './telegramScreen';

export {
  renderProgressBar,
  mapOrchestratorState,
  formatPlanStatus,
  PlanStatusInfo,
  TelegramScreenManager,
  ScreenCaptureOptions
};

function getVscodeSafe(): any {
  try {
    return require('vscode');
  } catch {
    return null;
  }
}

export interface TelegramBridgeOptions {
  token?: string;
  enabled?: boolean;
  allowedUsers?: (number | string)[];
  throttleMs?: number;
  registryPath?: string;
  windowKey?: string;
  logger?: DebugLogger;
  heartbeatIntervalMs?: number;
  standbyIntervalMs?: number;
  leaderStaleTimeoutMs?: number;
  botFactory?: (token: string, options?: any) => Bot;
  planManager?: TelegramPlanManager;
  promptDispatcher?: PromptDispatcher;
  keyboardManager?: KeyboardManager;
  orchestrator?: any;
  transcriptWatcher?: any;
  notifier?: ThrottledNotifier;
  screenManager?: TelegramScreenManager;
  screenCaptureOptions?: ScreenCaptureOptions;
  secretStorageManager?: SecretStorageManager;
  secretManager?: SecretStorageManager;
  promptOriginTracker?: PromptOriginTracker;
  chatMirror?: TelegramChatMirror;
  allowFreeChat?: boolean;
  enableChatMirror?: boolean;
  mirrorIncludePcPrompts?: boolean;
  chatMirrorPrefix?: string;
  tailEngine?: TranscriptTailEngine;
  workspaceName?: string;
  isMultiWorkspace?: boolean | (() => boolean);
  port?: number;
}

/**
 * Checks if a process with the specified PID is currently running.
 */
export function isProcessAlive(pid: number): boolean {
  if (!pid || typeof pid !== 'number' || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // ESRCH means process does not exist
    // EPERM means process exists but belongs to another user
    return err && err.code === 'EPERM';
  }
}

/**
 * Core Telegram Bot Bridge managing bot instance, security whitelist authorization,
 * multi-window leader election, and lifecycle hooks.
 */
export class TelegramBridge {
  private bot: Bot | null = null;
  private isRunning: boolean = false;
  private isPolling: boolean = false;
  private isLeader: boolean = false;
  private token: string = '';
  private enabled: boolean = true;
  private allowedUsers: (number | string)[] = [];
  private throttleMs: number = 2500;
  private windowKey: string;
  private customRegistryPath?: string;
  private logger: DebugLogger;
  private heartbeatIntervalMs: number = 3000;
  private standbyIntervalMs: number = 3000;
  private leaderStaleTimeoutMs: number = 10000;
  private botFactory?: (token: string, options?: any) => Bot;
  private planManager: TelegramPlanManager;
  private promptDispatcher: PromptDispatcher;
  private keyboardManager: KeyboardManager;
  private notifier: ThrottledNotifier | null = null;
  private orchestrator: any = null;
  private phaseNudgedListener?: (...args: any[]) => void;
  private transcriptWatcher: any = null;
  private screenManager: TelegramScreenManager;
  private screenCaptureOptions?: ScreenCaptureOptions;
  private secretManager: SecretStorageManager;
  private promptOriginTracker: PromptOriginTracker;
  private chatMirror: TelegramChatMirror | null = null;
  public allowFreeChat: boolean = true;
  private enableChatMirror: boolean = true;
  private mirrorIncludePcPrompts: boolean = true;
  private chatMirrorPrefix: string = DEFAULT_AI_RESPONSE_HEADER;
  private tailEngine?: TranscriptTailEngine;
  private workspaceName?: string;
  private isMultiWorkspace?: boolean | (() => boolean);
  private port?: number;
  private targetPort?: number;
  private targetWorkspaceName?: string;

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private standbyPollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pollingPromise: Promise<void> | null = null;
  private activeWaiters: Set<{ abort: () => void }> = new Set();

  constructor(options?: TelegramBridgeOptions) {
    this.secretManager = options?.secretStorageManager || options?.secretManager || secretStorageManager;
    this.logger = options?.logger || debugLogger;
    this.windowKey = options?.windowKey || `win_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.customRegistryPath = options?.registryPath;
    this.botFactory = options?.botFactory;
    this.planManager = options?.planManager || telegramPlanManager;
    this.promptDispatcher = options?.promptDispatcher || defaultPromptDispatcher;
    this.keyboardManager = options?.keyboardManager || defaultKeyboardManager;
    this.screenManager = options?.screenManager || defaultScreenManager;
    this.promptOriginTracker = options?.promptOriginTracker || defaultPromptOriginTracker;
    this.screenCaptureOptions = options?.screenCaptureOptions;
    if (options?.notifier) {
      this.notifier = options.notifier;
    }
    if (options?.orchestrator) {
      this.attachOrchestrator(options.orchestrator);
    }
    if (options?.transcriptWatcher) {
      this.transcriptWatcher = options.transcriptWatcher;
    }

    if (this.screenManager && typeof (this.planManager as any)?.setScreenManager === 'function') {
      (this.planManager as any).setScreenManager(this.screenManager);
    }

    if (options?.heartbeatIntervalMs) {
      this.heartbeatIntervalMs = options.heartbeatIntervalMs;
    }
    if (options?.standbyIntervalMs) {
      this.standbyIntervalMs = options.standbyIntervalMs;
    }
    if (options?.leaderStaleTimeoutMs) {
      this.leaderStaleTimeoutMs = options.leaderStaleTimeoutMs;
    }

    if (options) {
      this.applyOptions(options);
    } else {
      this.reloadConfig().catch(() => {});
    }
  }

  /**
   * Applies explicit options to the bridge.
   */
  public applyOptions(options: TelegramBridgeOptions): void {
    if (options.token !== undefined) {
      this.token = options.token;
    }
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
    if (options.allowedUsers !== undefined) {
      this.allowedUsers = [...options.allowedUsers];
    }
    if (options.throttleMs !== undefined) {
      this.throttleMs = options.throttleMs;
    }
    if (options.registryPath !== undefined) {
      this.customRegistryPath = options.registryPath;
    }
    if (options.windowKey !== undefined) {
      this.windowKey = options.windowKey;
    }
    if (options.logger !== undefined) {
      this.logger = options.logger;
    }
    if (options.heartbeatIntervalMs !== undefined) {
      this.heartbeatIntervalMs = options.heartbeatIntervalMs;
    }
    if (options.standbyIntervalMs !== undefined) {
      this.standbyIntervalMs = options.standbyIntervalMs;
    }
    if (options.leaderStaleTimeoutMs !== undefined) {
      this.leaderStaleTimeoutMs = options.leaderStaleTimeoutMs;
    }
    if (options.botFactory !== undefined) {
      this.botFactory = options.botFactory;
    }
    if (options.planManager !== undefined) {
      this.planManager = options.planManager;
    }
    if (options.promptDispatcher !== undefined) {
      this.promptDispatcher = options.promptDispatcher;
    }
    if (options.keyboardManager !== undefined) {
      this.keyboardManager = options.keyboardManager;
    }
    if (options.notifier !== undefined) {
      this.notifier = options.notifier;
    }
    if (options.orchestrator !== undefined) {
      this.attachOrchestrator(options.orchestrator);
    }
    if (options.transcriptWatcher !== undefined) {
      this.transcriptWatcher = options.transcriptWatcher;
      if (this.notifier) {
        this.notifier.attachTranscriptWatcher(this.transcriptWatcher);
      }
    }
    if (options.throttleMs !== undefined && this.notifier) {
      this.notifier.setThrottleMs(options.throttleMs);
    }
    if (options.allowedUsers !== undefined && this.notifier) {
      this.notifier.setChatIds(options.allowedUsers);
    }
    if (options.screenManager !== undefined) {
      this.screenManager = options.screenManager;
      if (typeof (this.planManager as any)?.setScreenManager === 'function') {
        (this.planManager as any).setScreenManager(this.screenManager);
      }
    }
    if (options.screenCaptureOptions !== undefined) {
      this.screenCaptureOptions = options.screenCaptureOptions;
    }
    if (options.secretStorageManager !== undefined) {
      this.secretManager = options.secretStorageManager;
    }
    if (options.secretManager !== undefined) {
      this.secretManager = options.secretManager;
    }
    if (options.promptOriginTracker !== undefined) {
      this.promptOriginTracker = options.promptOriginTracker;
    }
    if (options.chatMirror !== undefined) {
      this.chatMirror = options.chatMirror;
    }
    if (options.tailEngine !== undefined) {
      this.tailEngine = options.tailEngine;
    }
    if (options.workspaceName !== undefined) {
      this.workspaceName = options.workspaceName;
    }
    if (options.isMultiWorkspace !== undefined) {
      this.isMultiWorkspace = options.isMultiWorkspace;
    }
    if (options.port !== undefined) {
      this.port = options.port;
    }
    if (options.allowFreeChat !== undefined) {
      this.allowFreeChat = options.allowFreeChat;
    }
    if (options.enableChatMirror !== undefined) {
      this.enableChatMirror = options.enableChatMirror;
    }
    if (options.mirrorIncludePcPrompts !== undefined) {
      this.mirrorIncludePcPrompts = options.mirrorIncludePcPrompts;
    }
    if (options.chatMirrorPrefix !== undefined) {
      this.chatMirrorPrefix = options.chatMirrorPrefix;
    }
    if (this.chatMirror) {
      this.chatMirror.setWorkspace(this.workspaceName, this.isMultiWorkspace);
      this.chatMirror.updateConfig({
        enableChatMirror: this.enableChatMirror,
        mirrorIncludePcPrompts: this.mirrorIncludePcPrompts,
        chatMirrorPrefix: this.chatMirrorPrefix
      });
      if (this.bot) {
        this.chatMirror.setBot(this.bot);
      }
      if (this.allowedUsers) {
        this.chatMirror.setAllowedUsers(this.allowedUsers);
      }
    }
  }

  public getAllowFreeChat(): boolean {
    return this.allowFreeChat;
  }

  public getChatMirror(): TelegramChatMirror | null {
    return this.chatMirror;
  }

  public setChatMirror(mirror: TelegramChatMirror | null): void {
    this.chatMirror = mirror;
  }

  /**
   * Reloads configuration values from SecretStorageManager with fallback to extension configuration store.
   */
  public async reloadConfig(): Promise<void> {
    const config = getTelegramConfig();
    this.enabled = config.enabled;
    this.token = config.botToken || '';
    this.allowedUsers = [...config.allowedUsers];
    this.throttleMs = config.throttleMs;
    this.allowFreeChat = config.allowFreeChat ?? true;
    this.enableChatMirror = config.enableChatMirror ?? true;
    this.mirrorIncludePcPrompts = config.mirrorIncludePcPrompts ?? true;
    this.chatMirrorPrefix = config.chatMirrorPrefix || DEFAULT_AI_RESPONSE_HEADER;
    if (this.notifier) {
      this.notifier.setThrottleMs(this.throttleMs);
      this.notifier.setChatIds(this.allowedUsers);
    }
    if (this.chatMirror) {
      this.chatMirror.setAllowedUsers(this.allowedUsers);
      this.chatMirror.updateConfig({
        enableChatMirror: this.enableChatMirror,
        mirrorIncludePcPrompts: this.mirrorIncludePcPrompts,
        chatMirrorPrefix: this.chatMirrorPrefix
      });
    }

    try {
      const secureToken = await this.secretManager.getTelegramToken();
      if (secureToken) {
        this.token = secureToken;
      }
    } catch {}
  }

  /**
   * Gets the currently loaded Telegram bot token.
   */
  public getToken(): string {
    return this.token;
  }

  /**
   * Gets the SecretStorageManager instance backing this bridge.
   */
  public getSecretManager(): SecretStorageManager {
    return this.secretManager;
  }

  /**
   * Sets the SecretStorageManager instance backing this bridge.
   */
  public setSecretManager(manager: SecretStorageManager): void {
    this.secretManager = manager;
  }

  /**
   * Resolves the target file path for `ag-autoplan-ports.json`.
   */
  public getPortRegistryPath(): string {
    if (this.customRegistryPath) {
      return this.customRegistryPath;
    }
    const wbPath = getWorkbenchPath();
    if (wbPath && fs.existsSync(wbPath)) {
      return path.join(path.dirname(wbPath), PORT_REGISTRY_FILENAME);
    }
    return path.join(os.tmpdir(), PORT_REGISTRY_FILENAME);
  }

  /**
   * Retrieves the local BridgeServer port for this window.
   */
  public getOwnPort(): number | undefined {
    if (this.port) {
      return this.port;
    }
    const workspaces = this.getActiveWorkspaces();
    const own = workspaces.find((w) => w.windowKey === this.windowKey);
    if (own) {
      this.port = own.port;
      return this.port;
    }
    return undefined;
  }

  /**
   * Returns all currently active IDE workspaces registered in `ag-autoplan-ports.json`.
   */
  public getActiveWorkspaces(): Array<{
    port: number;
    pid: number;
    windowKey: string;
    workspaceName: string;
    workspacePath: string;
    authToken?: string;
    isCurrent: boolean;
  }> {
    let registryPath = this.getPortRegistryPath();
    if (!fs.existsSync(registryPath)) {
      const fallbackTmp = path.join(os.tmpdir(), PORT_REGISTRY_FILENAME);
      if (fs.existsSync(fallbackTmp)) {
        registryPath = fallbackTmp;
      }
    }

    const result: Array<{
      port: number;
      pid: number;
      windowKey: string;
      workspaceName: string;
      workspacePath: string;
      authToken?: string;
      isCurrent: boolean;
    }> = [];

    try {
      if (!fs.existsSync(registryPath)) {
        return result;
      }
      const raw = fs.readFileSync(registryPath, 'utf8');
      const data: PortRegistryData = JSON.parse(raw);
      if (!data.ports) return result;

      const now = Date.now();
      for (const key of Object.keys(data.ports)) {
        const entry = data.ports[key];
        if (!entry || !entry.port || !entry.pid) continue;

        // Verify process is alive
        if (!isProcessAlive(entry.pid)) continue;

        // Skip entries older than 2 hours
        if (entry.updatedAt && (now - entry.updatedAt > 7200000)) continue;

        const isCurrent = (entry.windowKey && this.windowKey ? entry.windowKey === this.windowKey : false) ||
                          (this.port !== undefined ? entry.port === this.port : false) ||
                          (!this.windowKey && this.port === undefined && entry.pid === process.pid);

        result.push({
          port: entry.port,
          pid: entry.pid,
          windowKey: entry.windowKey || '',
          workspaceName: entry.workspaceName || (entry.workspacePath ? path.basename(entry.workspacePath) : `Workspace-${entry.port}`),
          workspacePath: entry.workspacePath || '',
          authToken: entry.authToken,
          isCurrent
        });
      }
    } catch (err: any) {
      this.logger.warn('TELEGRAM', `Failed to read active workspaces from registry: ${err?.message || err}`);
    }

    // Sort: current window first, then by port
    result.sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      return a.port - b.port;
    });

    return result;
  }

  /**
   * Forwards a command payload via HTTP POST to a remote workspace BridgeServer instance.
   */
  public async forwardCommandToRemoteWorkspace(
    port: number,
    payload: { type?: string; text?: string; windowKey?: string; options?: any; timeoutMs?: number },
    authToken?: string
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    return new Promise((resolve) => {
      const dataStr = JSON.stringify(payload);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(dataStr))
      };
      if (authToken) {
        headers['x-bridge-auth'] = authToken;
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/autoplan-command',
          method: 'POST',
          headers,
          timeout: payload.timeoutMs || 15000
        },
        (res) => {
          let respBody = '';
          res.on('data', (chunk) => {
            respBody += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(respBody);
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve({ success: true, data: parsed });
              } else {
                resolve({ success: false, error: parsed.error || `HTTP ${res.statusCode}` });
              }
            } catch (e: any) {
              resolve({ success: false, error: `Invalid JSON response: ${respBody.slice(0, 100)}` });
            }
          });
        }
      );

      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, error: 'Request timeout' });
      });

      req.write(dataStr);
      req.end();
    });
  }

  /**
   * Registers workspace switching commands (/workspaces, /workspace, /ws) and inline buttons.
   */
  public registerWorkspaceCommands(bot: Bot): void {
    bot.command(['workspaces', 'workspace', 'ws'], async (ctx: Context) => {
      try {
        const workspaces = this.getActiveWorkspaces();
        if (workspaces.length === 0) {
          await ctx.reply('⚠️ Không tìm thấy cửa sổ Antigravity IDE nào đang mở.');
          return;
        }

        const ownPort = this.getOwnPort();
        const currentSelectedPort = this.targetPort || ownPort;

        const lines = ['📁 **Cửa sổ Antigravity IDE đang mở:**', ''];
        const keyboard = new InlineKeyboard();

        for (const ws of workspaces) {
          const isSelected = ws.port === currentSelectedPort;
          const statusTag = isSelected ? ' 🟢 [Đang chọn]' : '';
          const roleTag = ws.isCurrent ? ' (Leader)' : '';
          lines.push(`• 📂 **${ws.workspaceName}** (Port ${ws.port})${roleTag}${statusTag}`);

          keyboard.text(
            `${isSelected ? '✅ ' : '📂 '}${ws.workspaceName}`,
            `ws:${ws.port}`
          ).row();
        }

        lines.push('');
        lines.push('Bấm vào nút bên dưới để chọn cửa sổ IDE nhận lệnh từ Telegram:');

        await ctx.reply(lines.join('\n'), {
          reply_markup: keyboard
        });
      } catch (err: any) {
        this.logger.error('TELEGRAM', `Failed to execute /workspaces command: ${err?.message || err}`, err);
        await ctx.reply(`❌ Lỗi khi lấy danh sách workspace: ${err?.message || err}`);
      }
    });

    bot.callbackQuery(/^ws:(\d+)$/, async (ctx: Context) => {
      try {
        const portStr = ctx.match ? ctx.match[1] : '';
        const selectedPort = parseInt(portStr, 10);
        if (!selectedPort) {
          await ctx.answerCallbackQuery({ text: 'Port không hợp lệ' });
          return;
        }

        const workspaces = this.getActiveWorkspaces();
        const target = workspaces.find((w) => w.port === selectedPort);

        if (!target) {
          await ctx.answerCallbackQuery({ text: 'Workspace này không còn tồn tại hoặc đã đóng', show_alert: true });
          return;
        }

        this.targetPort = target.port;
        this.targetWorkspaceName = target.workspaceName;

        await ctx.answerCallbackQuery({ text: `Đã chọn: ${target.workspaceName}` });

        const lines = ['📁 **Cửa sổ Antigravity IDE đang mở:**', ''];
        const keyboard = new InlineKeyboard();

        for (const ws of workspaces) {
          const isSelected = ws.port === this.targetPort;
          const statusTag = isSelected ? ' 🟢 [Đang chọn]' : '';
          const roleTag = ws.isCurrent ? ' (Leader)' : '';
          lines.push(`• 📂 **${ws.workspaceName}** (Port ${ws.port})${roleTag}${statusTag}`);

          keyboard.text(
            `${isSelected ? '✅ ' : '📂 '}${ws.workspaceName}`,
            `ws:${ws.port}`
          ).row();
        }

        lines.push('');
        lines.push(`✅ **Đã chuyển điều khiển sang:** 📂 **${target.workspaceName}** (Port ${target.port})`);
        lines.push('Tất cả tin nhắn prompt từ điện thoại sẽ được gửi đến cửa sổ này.');

        try {
          await ctx.editMessageText(lines.join('\n'), {
            reply_markup: keyboard
          });
        } catch {
          await ctx.reply(`✅ Đã chuyển điều khiển sang workspace: **${target.workspaceName}** (Port ${target.port})`);
        }
      } catch (err: any) {
        this.logger.error('TELEGRAM', `Failed to handle workspace selection callback: ${err?.message || err}`, err);
        try {
          await ctx.answerCallbackQuery({ text: 'Lỗi khi chuyển workspace' });
        } catch {}
      }
    });
  }

  /**
   * Checks whether a given Telegram user ID is whitelisted.
   */
  public isUserAuthorized(userId: number | string | undefined | null): boolean {
    if (userId === undefined || userId === null) {
      return false;
    }
    const target = String(userId).trim();
    if (!target) {
      return false;
    }
    return this.allowedUsers.some((u) => String(u).trim() === target);
  }

  /**
   * Gets the current whitelist of allowed Telegram users.
   */
  public getAllowedUsers(): (number | string)[] {
    return [...this.allowedUsers];
  }

  /**
   * Updates the whitelist of allowed Telegram users.
   */
  public setAllowedUsers(users: (number | string)[]): void {
    this.allowedUsers = [...users];
  }

  /**
   * Gets whether this bridge instance currently holds the leader role.
   */
  public getIsLeader(): boolean {
    return this.isLeader;
  }

  /**
   * Gets whether the bridge lifecycle is currently active.
   */
  public getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Gets whether the bot is currently polling for updates.
   */
  public getIsPolling(): boolean {
    return this.isPolling;
  }

  /**
   * Gets the underlying grammY Bot instance if initialized.
   */
  public getBot(): Bot | null {
    return this.bot;
  }

  /**
   * Gets the TelegramPlanManager instance associated with this bridge.
   */
  public getPlanManager(): TelegramPlanManager {
    return this.planManager;
  }

  /**
   * Sets a custom TelegramPlanManager instance and registers handlers if bot is initialized.
   */
  public setPlanManager(manager: TelegramPlanManager): void {
    this.planManager = manager;
    if (this.screenManager && typeof (this.planManager as any).setScreenManager === 'function') {
      (this.planManager as any).setScreenManager(this.screenManager);
    }
    if (this.orchestrator && typeof (this.planManager as any).setOrchestrator === 'function') {
      (this.planManager as any).setOrchestrator(this.orchestrator);
    }
    if (this.bot) {
      if (typeof (this.planManager as any).setBot === 'function') {
        (this.planManager as any).setBot(this.bot);
      }
      this.planManager.registerWithBot(this.bot);
    }
  }

  /**
   * Gets the PromptDispatcher instance associated with this bridge.
   */
  public getPromptDispatcher(): PromptDispatcher {
    return this.promptDispatcher;
  }

  /**
   * Sets a custom PromptDispatcher instance.
   */
  public setPromptDispatcher(dispatcher: PromptDispatcher): void {
    this.promptDispatcher = dispatcher;
  }

  /**
   * Gets the KeyboardManager instance associated with this bridge.
   */
  public getKeyboardManager(): KeyboardManager {
    return this.keyboardManager;
  }

  /**
   * Sets a custom KeyboardManager instance.
   */
  public setKeyboardManager(manager: KeyboardManager): void {
    this.keyboardManager = manager;
  }

  /**
   * Gets the ThrottledNotifier instance associated with this bridge.
   */
  public getNotifier(): ThrottledNotifier | null {
    return this.notifier;
  }

  /**
   * Sets a custom ThrottledNotifier instance.
   */
  public setNotifier(notifier: ThrottledNotifier): void {
    this.notifier = notifier;
    if (this.bot) {
      this.notifier.setBot(this.bot);
    }
    if (this.orchestrator) {
      this.notifier.attachOrchestrator(this.orchestrator);
    }
    if (this.transcriptWatcher) {
      this.notifier.attachTranscriptWatcher(this.transcriptWatcher);
    }
  }

  /**
   * Gets the PromptOriginTracker instance associated with this bridge.
   */
  public getPromptOriginTracker(): PromptOriginTracker {
    return this.promptOriginTracker;
  }

  /**
   * Sets a custom PromptOriginTracker instance.
   */
  public setPromptOriginTracker(tracker: PromptOriginTracker): void {
    this.promptOriginTracker = tracker;
  }

  /**
   * Resolves the origin of a prompt (e.g. emitted by TranscriptTailEngine).
   * If originated from Telegram, marks origin as 'telegram' and consumes the entry.
   * If originated from PC IDE, marks origin as 'pc_ide' and formats with PC header.
   */
  public resolvePromptOrigin(promptText: string): PromptOriginResult {
    return this.promptOriginTracker.checkAndConsume(promptText);
  }

  /**
   * Handles a userInput event from TranscriptTailEngine and determines
   * origin and whether it should be mirrored to Telegram.
   */
  public handleTranscriptUserInput(event: { prompt: string; [key: string]: any }): PromptOriginResult & {
    shouldMirrorToTelegram: boolean;
  } {
    const check = this.resolvePromptOrigin(event.prompt);
    const shouldMirrorToTelegram = !check.matched;
    if (check.matched) {
      this.logger.info(
        'TELEGRAM',
        `Prompt origin resolved to 'telegram'. Suppressing mirror for: "${event.prompt.slice(0, 50)}..."`
      );
    } else {
      this.logger.info(
        'TELEGRAM',
        `Prompt origin resolved to 'pc_ide'. Will mirror to Telegram: "${event.prompt.slice(0, 50)}..."`
      );
    }
    return {
      ...check,
      shouldMirrorToTelegram
    };
  }

  /**
   * Attaches an orchestrator instance to the bridge and notifier,
   * wiring up phaseNudged event notifications.
   */
  public attachOrchestrator(orch: any): void {
    if (this.orchestrator && this.phaseNudgedListener) {
      const remove = typeof this.orchestrator.off === 'function' ? 'off' : 'removeListener';
      if (typeof this.orchestrator[remove] === 'function') {
        this.orchestrator[remove]('phaseNudged', this.phaseNudgedListener);
      }
      this.phaseNudgedListener = undefined;
    }

    this.orchestrator = orch;

    if (this.orchestrator && typeof this.orchestrator.on === 'function') {
      this.phaseNudgedListener = (payload: any) => {
        this.handlePhaseNudged(payload).catch((err) => {
          this.logger.warn('TELEGRAM', `Error in handlePhaseNudged: ${err?.message || err}`);
        });
      };
      this.orchestrator.on('phaseNudged', this.phaseNudgedListener);
    }

    if (typeof (this.planManager as any)?.setOrchestrator === 'function') {
      (this.planManager as any).setOrchestrator(this.orchestrator);
    }
    if (this.notifier) {
      this.notifier.attachOrchestrator(this.orchestrator);
    }
  }

  /**
   * Handles orchestrator phaseNudged event and dispatches notification to Telegram users.
   */
  public async handlePhaseNudged(payload: { phase: any; phaseIndex?: number; message?: string }): Promise<boolean> {
    if (!payload || !payload.phase) {
      return false;
    }
    const { phase, phaseIndex, message } = payload;
    const cfg = getConfig();
    const isTelegramEnabled = this.enabled && (cfg.telegramEnabled ?? true);
    const isLongPhaseNotify = cfg.longPhaseNotifyTelegram ?? true;

    if (!isTelegramEnabled || !isLongPhaseNotify) {
      this.logger.info(
        'TELEGRAM',
        `Phase nudge notification skipped (telegramEnabled=${isTelegramEnabled}, longPhaseNotifyTelegram=${isLongPhaseNotify})`
      );
      return false;
    }

    const phaseNumber = phase.phaseNumber || (typeof phaseIndex === 'number' ? phaseIndex + 1 : 1);
    const fileName = phase.fileName || `phase-${String(phaseNumber).padStart(2, '0')}.md`;
    const notificationText = [
      `⏱️ [Auto-Plan Nudge]`,
      `Phase ${phaseNumber} (${fileName}) running > 3 minutes.`,
      `Automatically paused AI and injected online search guidance into IDE chat.`
    ].join('\n');

    try {
      if (this.notifier && typeof (this.notifier as any).sendInfo === 'function') {
        await (this.notifier as any).sendInfo(notificationText);
      } else if (this.notifier && typeof (this.notifier as any).broadcastMessage === 'function') {
        await (this.notifier as any).broadcastMessage(notificationText);
      }
      return true;
    } catch (err: any) {
      this.logger.warn('TELEGRAM', `Failed to send phase nudge notification: ${err?.message || err}`);
      return false;
    }
  }

  /**
   * Attaches a transcriptWatcher instance to the bridge and notifier.
   */
  public attachTranscriptWatcher(watcher: any): void {
    this.transcriptWatcher = watcher;
    if (this.notifier) {
      this.notifier.attachTranscriptWatcher(watcher);
    }
  }

  /**
   * Gets the TelegramScreenManager instance associated with this bridge.
   */
  public getScreenManager(): TelegramScreenManager {
    return this.screenManager;
  }

  /**
   * Sets a custom TelegramScreenManager instance.
   */
  public setScreenManager(manager: TelegramScreenManager): void {
    this.screenManager = manager;
  }

  /**
   * Gets the current screen capture options if set.
   */
  public getScreenCaptureOptions(): ScreenCaptureOptions | undefined {
    return this.screenCaptureOptions;
  }

  /**
   * Sets custom screen capture options.
   */
  public setScreenCaptureOptions(options: ScreenCaptureOptions | undefined): void {
    this.screenCaptureOptions = options;
  }

  /**
   * Builds the formatted plan status dashboard string for `/plan_status`.
   */
  public buildStatusDashboard(): string {
    let rawState = 'idle';
    let isRunning = false;
    let currentPhaseName = 'None';
    let currentIteration = 0;
    let totalIterations = 0;
    let completedPhases = 0;
    let totalPhases = 0;

    if (this.orchestrator) {
      if (typeof this.orchestrator.getState === 'function') {
        rawState = this.orchestrator.getState();
      } else if (this.orchestrator.state) {
        rawState = this.orchestrator.state;
      }

      if (typeof this.orchestrator.isRunning === 'function') {
        isRunning = this.orchestrator.isRunning();
      } else if (this.orchestrator.isRunning !== undefined) {
        isRunning = Boolean(this.orchestrator.isRunning);
      }

      const phase =
        typeof this.orchestrator.getCurrentPhase === 'function'
          ? this.orchestrator.getCurrentPhase()
          : this.orchestrator.currentPhase;
      const hasNudged = Boolean(phase && phase.hasNudged);
      if (phase && phase.fileName) {
        currentPhaseName = phase.fileName;
      }

      const progress =
        typeof this.orchestrator.getProgress === 'function'
          ? this.orchestrator.getProgress()
          : null;
      if (progress) {
        currentIteration = progress.current ?? 0;
        totalIterations = progress.total ?? 0;
      } else {
        currentIteration = this.orchestrator.currentIteration ?? 0;
        totalIterations = this.orchestrator.totalIterations ?? 0;
      }

      const phases =
        typeof this.orchestrator.getPhases === 'function'
          ? this.orchestrator.getPhases()
          : this.orchestrator.phases || [];
      if (Array.isArray(phases)) {
        totalPhases = phases.length;
        completedPhases = phases.filter(
          (p: any) => p && (p.status === 'Completed' || p.status === 'completed')
        ).length;
        if (
          completedPhases === 0 &&
          typeof this.orchestrator.currentPhaseIndex === 'number' &&
          this.orchestrator.currentPhaseIndex > 0
        ) {
          completedPhases = this.orchestrator.currentPhaseIndex;
        }
      }
    }

    const state = mapOrchestratorState(rawState, isRunning);
    return formatPlanStatus({
      state,
      currentPhaseName,
      currentIteration,
      totalIterations,
      completedPhases,
      totalPhases,
      hasNudged: this.orchestrator ? Boolean(
        typeof this.orchestrator.getCurrentPhase === 'function'
          ? this.orchestrator.getCurrentPhase()?.hasNudged
          : this.orchestrator.currentPhase?.hasNudged
      ) : false
    });
  }

  /**
   * Captures desktop screen and dispatches to given chatId or all authorized users.
   */
  public async sendScreenCapture(chatId?: number | string): Promise<any[]> {
    if (!this.bot) {
      throw new Error('Telegram bot is not initialized');
    }
    const targets = chatId !== undefined ? [chatId] : this.allowedUsers;
    const results: any[] = [];
    for (const target of targets) {
      const res = await this.screenManager.send(this.bot, target, this.screenCaptureOptions);
      results.push(res);
    }
    return results;
  }

  /**
   * Gets the current window identifier.
   */
  public getWindowKey(): string {
    return this.windowKey;
  }

  /**
   * Synchronizes the full catalog of workflow and management commands with Telegram API via setMyCommands.
   */
  public async syncBotCommands(bot?: Bot | null): Promise<boolean> {
    const targetBot = bot || this.bot;
    if (!targetBot) {
      this.logger.warn('TELEGRAM', 'Cannot sync commands: No active bot instance');
      return false;
    }
    return syncBotCommands(targetBot, FULL_BOT_COMMAND_CATALOG, this.logger);
  }

  /**
   * Creates the security whitelist authorization middleware for grammY.
   */
  public createAuthMiddleware() {
    return async (ctx: Context, next: NextFunction): Promise<void> => {
      const fromId = ctx.from?.id;
      if (fromId === undefined) {
        // Updates without a user sender (e.g. channel post) are ignored
        return;
      }

      if (!this.isUserAuthorized(fromId)) {
        this.logger.warn(
          'TELEGRAM',
          `⛔ Unauthorized Telegram access rejected from user ID ${fromId} (@${ctx.from?.username || 'unknown'})`
        );
        try {
          await ctx.reply(`⛔ Unauthorized: Your Telegram ID ${fromId} is not permitted.`);
        } catch (replyErr: any) {
          this.logger.warn('TELEGRAM', `Failed to send unauthorized denial message to ${fromId}`, replyErr);
        }
        // Do not call next(), cleanly stopping middleware execution for unauthorized sender
        return;
      }

      if (this.notifier && ctx.chat?.id) {
        this.notifier.addChatId(ctx.chat.id);
      }

      await next();
    };
  }

  /**
   * Reads registry data from `ag-autoplan-ports.json`.
   */
  private readRegistry(targetPath: string): PortRegistryData {
    if (fs.existsSync(targetPath)) {
      try {
        const raw = fs.readFileSync(targetPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (!parsed.ports || typeof parsed.ports !== 'object') {
            parsed.ports = {};
          }
          return parsed as PortRegistryData;
        }
      } catch {
        // Fallback to fresh registry on parse error
      }
    }
    return { version: 1, ports: {} };
  }

  /**
   * Safely writes registry data to `ag-autoplan-ports.json`.
   */
  private writeRegistry(targetPath: string, data: PortRegistryData): void {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Attempts to acquire Telegram polling leadership across IDE windows.
   * Returns true if leadership is held or acquired, false otherwise.
   */
  public tryAcquireLeadership(): boolean {
    const registryPath = this.getPortRegistryPath();
    try {
      const data = this.readRegistry(registryPath);
      const now = Date.now();
      const currentLeader = data.telegramLeader;

      if (currentLeader) {
        // Check if current instance already holds leadership
        const isSelf =
          currentLeader.pid === process.pid &&
          (!this.windowKey || !currentLeader.windowKey || currentLeader.windowKey === this.windowKey);

        if (isSelf) {
          currentLeader.updatedAt = now;
          this.writeRegistry(registryPath, data);
          return true;
        }

        // Leader is another instance; check if it is still alive and not stale
        const alive = isProcessAlive(currentLeader.pid);
        const stale = now - currentLeader.updatedAt > this.leaderStaleTimeoutMs;

        if (alive && !stale) {
          // Primary window is active; standby
          return false;
        }
      }

      // No active leader or existing leader has closed/stalled; acquire leadership
      data.telegramLeader = {
        pid: process.pid,
        windowKey: this.windowKey,
        acquiredAt: now,
        updatedAt: now
      };

      this.writeRegistry(registryPath, data);
      return true;
    } catch (err: any) {
      this.logger.warn('TELEGRAM', `Failed during leader election check: ${err?.message || err}`, err);
      return false;
    }
  }

  /**
   * Releases Telegram polling leadership in `ag-autoplan-ports.json`.
   */
  public releaseLeadership(): void {
    const registryPath = this.getPortRegistryPath();
    try {
      if (fs.existsSync(registryPath)) {
        const data = this.readRegistry(registryPath);
        if (data.telegramLeader) {
          const isSelf =
            data.telegramLeader.pid === process.pid &&
            (!this.windowKey || !data.telegramLeader.windowKey || data.telegramLeader.windowKey === this.windowKey);

          if (isSelf) {
            delete data.telegramLeader;
            this.writeRegistry(registryPath, data);
            this.logger.info('TELEGRAM', `Released Telegram leader ownership for window ${this.windowKey}`);
          }
        }
      }
    } catch (err: any) {
      this.logger.warn('TELEGRAM', `Failed to release leader ownership: ${err?.message || err}`, err);
    }
  }

  /**
   * Starts periodic heartbeat updating `updatedAt` for the leader in `ag-autoplan-ports.json`.
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(() => {
      if (!this.isRunning || !this.isLeader) {
        return;
      }
      const registryPath = this.getPortRegistryPath();
      try {
        if (fs.existsSync(registryPath)) {
          const data = this.readRegistry(registryPath);
          if (data.telegramLeader && data.telegramLeader.pid === process.pid) {
            data.telegramLeader.updatedAt = Date.now();
            this.writeRegistry(registryPath, data);
          }
        }
      } catch {
        // Non-fatal background heartbeat error
      }
    }, this.heartbeatIntervalMs);
  }

  /**
   * Stops heartbeat interval.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Starts periodic standby polling to takeover leadership if primary closes.
   */
  private startStandbyPolling(): void {
    if (this.standbyPollTimer) {
      clearInterval(this.standbyPollTimer);
    }
    this.standbyPollTimer = setInterval(() => {
      if (!this.isRunning) {
        return;
      }
      if (this.tryAcquireLeadership()) {
        this.stopStandbyPolling();
        this.isLeader = true;
        this.logger.info(
          'TELEGRAM',
          `Standby instance successfully acquired Telegram leader role (window: ${this.windowKey})`
        );
        this.startHeartbeat();
        this.syncBotCommands(this.bot).catch((err) => {
          this.logger.warn('TELEGRAM', `Standby takeover command registration error: ${err?.message || err}`);
        });
        this.startPolling();
      }
    }, this.standbyIntervalMs);
  }

  /**
   * Stops standby polling interval.
   */
  private stopStandbyPolling(): void {
    if (this.standbyPollTimer) {
      clearInterval(this.standbyPollTimer);
      this.standbyPollTimer = null;
    }
  }

  /**
   * Schedules reconnection attempt if polling terminates unexpectedly.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.isRunning || !this.isLeader) {
      return;
    }
    this.logger.info('TELEGRAM', 'Scheduling Telegram polling reconnection in 5000ms...');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isRunning && this.isLeader && !this.isPolling) {
        this.startPolling();
      }
    }, 5000);
  }

  /**
   * Initializes the grammY Bot instance, whitelist authorization, and global error boundary.
   */
  public initBot(): void {
    if (this.bot) {
      return;
    }
    if (!this.token) {
      this.logger.warn('TELEGRAM', 'Cannot initialize Telegram Bot: missing token');
      return;
    }

    try {
      if (this.botFactory) {
        this.bot = this.botFactory(this.token);
      } else {
        this.bot = new Bot(this.token);
      }

      // 1. Register global error boundary to isolate errors and prevent extension crashes
      this.bot.catch((err) => {
        const ctx = err.ctx;
        const e = err.error;
        let errMsg = 'Unknown error';
        if (e instanceof GrammyError) {
          errMsg = `Telegram API error [${e.error_code}]: ${e.description}`;
        } else if (e instanceof HttpError) {
          errMsg = `Telegram Network/HTTP error: ${e.message}`;
        } else if (e instanceof Error) {
          errMsg = e.message;
        } else {
          errMsg = String(e);
        }

        this.logger.error(
          'TELEGRAM',
          `Error while processing Telegram update ${ctx?.update?.update_id || 'unknown'}: ${errMsg}`,
          {
            updateId: ctx?.update?.update_id,
            error: String(e),
            stack: e instanceof Error ? e.stack : undefined
          }
        );
      });

      // 2. Register security whitelist authorization middleware
      this.bot.use(this.createAuthMiddleware());

      // 3. Register plan discovery and execution commands & callback handlers
      if (typeof (this.planManager as any).setBot === 'function') {
        (this.planManager as any).setBot(this.bot);
      }
      if (this.screenManager && typeof (this.planManager as any).setScreenManager === 'function') {
        (this.planManager as any).setScreenManager(this.screenManager);
      }
      if (this.orchestrator && typeof (this.planManager as any).setOrchestrator === 'function') {
        (this.planManager as any).setOrchestrator(this.orchestrator);
      }
      this.planManager.registerWithBot(this.bot);

      // 4. Register session management commands (/new_chat)
      this.registerSessionCommands(this.bot);

      // Register workspace management commands (/workspaces, /ws)
      this.registerWorkspaceCommands(this.bot);

      // 5. Register plan control commands (/plan_status, /plan_skip, /plan_stop, /help)
      this.registerControlCommands(this.bot);

      // 6. Register screen capture command (/screen)
      this.registerScreenCommand(this.bot);

      // 7. Register free-form text message prompt dispatcher
      this.registerTextDispatcher(this.bot);

      // 8. Initialize ThrottledNotifier and connect listeners
      if (!this.notifier) {
        this.notifier = new ThrottledNotifier({
          bot: this.bot,
          chatIds: this.allowedUsers,
          throttleMs: this.throttleMs,
          logger: this.logger
        });
      } else {
        this.notifier.setBot(this.bot);
        this.notifier.setThrottleMs(this.throttleMs);
        this.notifier.setChatIds(this.allowedUsers);
      }

      if (this.orchestrator) {
        this.notifier.attachOrchestrator(this.orchestrator);
      }
      if (this.transcriptWatcher) {
        this.notifier.attachTranscriptWatcher(this.transcriptWatcher);
      }

      // 9. Register slash commands autocomplete via Telegram Bot API setMyCommands
      this.syncBotCommands(this.bot).catch((err) => {
        this.logger.warn('TELEGRAM', `Initial command registration error: ${err?.message || err}`);
      });

      // 10. Initialize TelegramChatMirror for clean live Q&A mirroring
      if (!this.chatMirror) {
        this.chatMirror = new TelegramChatMirror({
          bot: this.bot,
          allowedUsers: this.allowedUsers,
          enableChatMirror: this.enableChatMirror,
          mirrorIncludePcPrompts: this.mirrorIncludePcPrompts,
          prefix: this.chatMirrorPrefix,
          promptOriginTracker: this.promptOriginTracker,
          tailEngine: this.tailEngine,
          workspaceName: this.workspaceName,
          isMultiWorkspace: this.isMultiWorkspace,
          registryPath: this.getPortRegistryPath(),
          logger: this.logger
        });
      } else {
        this.chatMirror.setBot(this.bot);
        this.chatMirror.setAllowedUsers(this.allowedUsers);
        this.chatMirror.setWorkspace(this.workspaceName, this.isMultiWorkspace);
      }

      this.logger.info('TELEGRAM', 'Telegram Bot initialized successfully with security middleware, plan handlers, chat dispatchers, throttled notifier, and chat mirror');
    } catch (err: any) {
      this.logger.error('TELEGRAM', `Failed to construct Telegram bot: ${err?.message || err}`, err);
      this.bot = null;
    }
  }

  /**
   * Dispatches a request to spawn a fresh conversation using the prioritized 3-Tier architecture:
   * Tier 1: Focus-Free DOM Automation Bridge (BridgeServer -> autoplan-dom-bridge.js)
   * Tier 2: Native VS Code Command API (executeCommand)
   * Tier 3: OS-level keyboard shortcut fallback (Ctrl+Shift+L)
   */
  public async handleNewChatCommand(ctx: Context): Promise<void> {
    try {
      this.logger.info('TELEGRAM', `Received /new_chat command from user ${ctx.from?.id}`);

      // If a remote target workspace is selected:
      const ownPort = this.getOwnPort();
      if (this.targetPort && ownPort && this.targetPort !== ownPort) {
        const workspaces = this.getActiveWorkspaces();
        const targetWs = workspaces.find((w) => w.port === this.targetPort);
        if (targetWs) {
          this.logger.info('TELEGRAM', `Forwarding /new_chat command to workspace ${targetWs.workspaceName} (port ${this.targetPort})`);
          const fwd = await this.forwardCommandToRemoteWorkspace(
            this.targetPort,
            { type: 'openNewConversation' },
            targetWs.authToken
          );
          if (fwd.success) {
            await ctx.reply(`🆕 New conversation initialized in workspace: **${targetWs.workspaceName}**`);
          } else {
            await ctx.reply(`❌ Could not initialize new conversation in ${targetWs.workspaceName}: ${fwd.error}`);
          }
          return;
        }
      }

      let triggered = false;
      let tierUsed = '';

      // 1. Tier 1: Focus-Free DOM Automation Bridge via BridgeServer
      const bridgeServer = typeof (this.promptDispatcher as any)?.getBridgeServer === 'function'
        ? (this.promptDispatcher as any).getBridgeServer()
        : null;

      if (bridgeServer && typeof bridgeServer.dispatchNewConversationCommand === 'function') {
        try {
          const clients = typeof bridgeServer.getConnectedClients === 'function'
            ? bridgeServer.getConnectedClients()
            : [];
          if (clients.length > 0) {
            const ack = await bridgeServer.dispatchNewConversationCommand({ timeoutMs: 5000 });
            if (ack && ack.status !== 'error' && ack.status !== 'aborted') {
              triggered = true;
              tierUsed = 'DOM Bridge (Tier 1)';
              this.logger.info('TELEGRAM', `New conversation created via DOM Bridge (Tier 1) in ${ack.durationMs || 0}ms`);
            } else {
              this.logger.warn('TELEGRAM', `DOM Bridge new conversation failed (${ack?.status}): ${ack?.error}`);
            }
          }
        } catch (domErr: any) {
          this.logger.warn('TELEGRAM', `DOM Bridge dispatchNewConversationCommand error: ${domErr?.message || domErr}`);
        }
      }

      // 2. Tier 2: Native VS Code Command API
      if (!triggered) {
        const vs = getVscodeSafe();
        if (vs?.commands?.executeCommand) {
          const candidateCommands = [
            'antigravity.prioritized.chat.openNewConversation',
            'workbench.action.chat.newChat',
            'antigravity.newConversation'
          ];
          for (const cmd of candidateCommands) {
            try {
              await vs.commands.executeCommand(cmd);
              triggered = true;
              tierUsed = `Command API (${cmd})`;
              this.logger.info('TELEGRAM', `New conversation triggered via VS Code command: ${cmd}`);
              break;
            } catch (cmdErr: any) {
              this.logger.debug('TELEGRAM', `VS Code command ${cmd} failed: ${cmdErr?.message || cmdErr}`);
            }
          }
        }
      }

      // 3. Tier 3: OS Keyboard shortcut fallback
      if (!triggered) {
        if (this.keyboardManager && typeof this.keyboardManager.sendNewConversationShortcut === 'function') {
          try {
            await this.keyboardManager.sendNewConversationShortcut();
            triggered = true;
            tierUsed = 'Keyboard Shortcut (Tier 3)';
            this.logger.info('TELEGRAM', 'New conversation triggered via keyboardManager.sendNewConversationShortcut');
          } catch (kmErr: any) {
            this.logger.warn('TELEGRAM', `keyboardManager.sendNewConversationShortcut error: ${kmErr?.message || kmErr}`);
          }
        } else if (this.keyboardManager && typeof (this.keyboardManager as any).openNewConversation === 'function') {
          try {
            await (this.keyboardManager as any).openNewConversation();
            triggered = true;
            tierUsed = 'Keyboard Shortcut (Tier 3)';
            this.logger.info('TELEGRAM', 'New conversation triggered via keyboardManager.openNewConversation');
          } catch (kmErr: any) {
            this.logger.warn('TELEGRAM', `keyboardManager.openNewConversation error: ${kmErr?.message || kmErr}`);
          }
        }
      }

      if (triggered) {
        await ctx.reply(`🆕 New conversation initialized${tierUsed ? ` via ${tierUsed}` : ''}`);
      } else {
        this.logger.error('TELEGRAM', 'All tiers failed to initialize new conversation');
        await ctx.reply('❌ Could not initialize new conversation. Please ensure Antigravity IDE is open and DOM Bridge is connected.');
      }
    } catch (err: any) {
      this.logger.error('TELEGRAM', `Failed to initialize new conversation: ${err?.message || err}`, err);
      await ctx.reply(`❌ Failed to initialize new conversation: ${err?.message || err}`);
    }
  }

  /**
   * Registers session management commands such as `/new_chat` to spawn a fresh conversation.
   */
  public registerSessionCommands(bot: Bot): void {
    bot.command(['new_chat', 'newchat'], async (ctx: Context) => {
      await this.handleNewChatCommand(ctx);
    });
  }

  /**
   * Registers free-form text message handler to dispatch incoming prompts into Antigravity IDE
   * while preserving conversation continuity and safely reporting acknowledgments and errors.
   */
  public registerTextDispatcher(bot: Bot): void {
    bot.on('message:text', async (ctx: Context) => {
      const rawText = ctx.message?.text || '';
      const trimmed = rawText.trim();

      if (!trimmed) {
        return;
      }

      // Check for /new_chat, /newchat, or /new-chat commands (including hyphenated form)
      if (/^\/(new[-_]?chat)(?:@[a-zA-Z0-9_]+)?$/i.test(trimmed)) {
        await this.handleNewChatCommand(ctx);
        return;
      }

      // If message starts with '/', check if it is a registered internal bot command.
      // Internal commands are handled by their respective bot.command() handlers.
      let isInternalCommand = false;
      if (trimmed.startsWith('/')) {
        const cmdMatch = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:@[a-zA-Z0-9_]+)?/);
        if (cmdMatch && INTERNAL_BOT_COMMANDS.has(cmdMatch[1].toLowerCase())) {
          isInternalCommand = true;
          return;
        }
      }

      // Check if message matches an AWF workflow command (e.g., /brainstorm, /code, /save_brain, /recap)
      const parsedWorkflow = parseWorkflowCommand(rawText);

      if (!this.allowFreeChat && !isInternalCommand && !parsedWorkflow) {
        this.logger.debug(
          'TELEGRAM',
          `Silent dropping free-text message from user ${ctx.from?.id} (allowFreeChat is false)`
        );
        return;
      }

      let text: string;

      if (parsedWorkflow) {
        text = parsedWorkflow.normalizedPrompt;
        this.logger.info(
          'TELEGRAM',
          `Parsed workflow command '/${parsedWorkflow.rawCommand}' normalized to '${parsedWorkflow.command}' (prompt: "${text.slice(0, 60)}")`
        );
      } else {
        // Sanitize input to prevent shell escaping issues if Tier 3 OS keyboard simulation is used
        text = sanitizeTelegramInput(rawText);
      }

      this.logger.info('TELEGRAM', `Received prompt from user ${ctx.from?.id}: "${text.slice(0, 50)}..."`);

      // If a remote target workspace is selected:
      const ownPort = this.getOwnPort();
      if (this.targetPort && ownPort && this.targetPort !== ownPort) {
        const workspaces = this.getActiveWorkspaces();
        const targetWs = workspaces.find((w) => w.port === this.targetPort);
        if (targetWs) {
          try {
            await ctx.reply(`⏳ Prompt sent to Antigravity IDE (📁 ${targetWs.workspaceName})...`);
          } catch (ackErr: any) {
            this.logger.warn('TELEGRAM', `Failed to send immediate receipt acknowledgment: ${ackErr?.message || ackErr}`);
          }

          const fwdResult = await this.forwardCommandToRemoteWorkspace(
            this.targetPort,
            { text, options: { openNewConversation: false } },
            targetWs.authToken
          );

          if (!fwdResult.success) {
            this.logger.error('TELEGRAM', `Prompt dispatch to ${targetWs.workspaceName} unsuccessful: ${fwdResult.error}`);
            await ctx.reply(`❌ Prompt dispatch failed: ${fwdResult.error}`);
          } else {
            this.logger.info('TELEGRAM', `Prompt successfully dispatched to ${targetWs.workspaceName} (port ${this.targetPort})`);
          }
          return;
        } else {
          await ctx.reply(`⚠️ Workspace '${this.targetWorkspaceName || this.targetPort}' không còn hoạt động. Chuyển về workspace hiện tại.`);
          this.targetPort = undefined;
          this.targetWorkspaceName = undefined;
        }
      }

      // Immediately acknowledge receipt in Telegram
      try {
        await ctx.reply('⏳ Prompt sent to Antigravity IDE...');
      } catch (ackErr: any) {
        this.logger.warn('TELEGRAM', `Failed to send immediate receipt acknowledgment: ${ackErr?.message || ackErr}`);
      }

      // Capture initial transcript offset before dispatching prompt
      const brainDir = getDefaultBrainDir();
      let activeTranscriptPath: string | null = null;
      let initialTranscriptOffset = 0;
      try {
        const latestConv = await findLatestConversationAsync(brainDir);
        if (latestConv) {
          activeTranscriptPath = getTranscriptPath(path.join(brainDir, latestConv));
          if (activeTranscriptPath) {
            try {
              const stat = await fs.promises.stat(activeTranscriptPath);
              initialTranscriptOffset = stat.size;
            } catch {}
          }
        }
      } catch {}

      // Register outbound prompt with PromptOriginTracker to suppress redundant mirroring in Telegram
      this.promptOriginTracker.registerTelegramPrompt(text);

      // Dispatch into Antigravity IDE maintaining conversation continuity (openNewConversation: false)
      try {
        const result = await this.promptDispatcher.dispatchPrompt(text, {
          timeoutMs: 15000,
          openNewConversation: false
        });

        if (!result || !result.success) {
          const errDetail = result?.error || 'Prompt dispatch was rejected without error details';
          this.logger.error('TELEGRAM', `Prompt dispatch unsuccessful: ${errDetail}`);
          await ctx.reply(`❌ Prompt dispatch failed: ${errDetail}`);
          return;
        }

        this.logger.info('TELEGRAM', `Prompt dispatched successfully via tier ${result.tier} in ${result.durationMs}ms`);

        if (result.fallbackHistory && result.fallbackHistory.length > 0) {
          const fallbackSummary = result.fallbackHistory
            .map((f: any) => `• ${f.tier}: ${f.error}`)
            .join('\n');
          await ctx.reply(`⚠️ Note: Delivered via fallback tier (${result.tier}):\n${fallbackSummary}`);
        }

        // When running in free-chat mode (not inside an active orchestrator plan runner),
        // await the model's response and stream / send it back to Telegram if chat mirror is not enabled.
        const isOrchRunning = this.orchestrator && typeof this.orchestrator.isRunning === 'function' && this.orchestrator.isRunning();
        if (!isOrchRunning && (!this.chatMirror || !this.chatMirror.isEnabled())) {
          this.awaitAndReplyModelResponse(ctx, activeTranscriptPath, initialTranscriptOffset).catch((respErr: any) => {
            this.logger.warn('TELEGRAM', `Background model response waiter finished with error: ${respErr?.message || respErr}`);
          });
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        this.logger.error('TELEGRAM', `Prompt dispatch threw error: ${errMsg}`, err);
        await ctx.reply(`❌ Prompt dispatch failed: ${errMsg}`);
      }
    });
  }

  /**
   * Monitors the active transcript file until the assistant generates a complete PLANNER_RESPONSE
   * and sends the full content answer back to the Telegram chat.
   */
  public async awaitAndReplyModelResponse(
    ctx: Context,
    initialTranscriptPath: string | null,
    initialOffset: number,
    timeoutMs: number = 300000
  ): Promise<void> {
    const startTime = Date.now();
    let currentPath = initialTranscriptPath;
    let readOffset = Math.max(0, initialOffset);
    let lineBuffer = '';
    let lastContent = '';
    let quietTimer: NodeJS.Timeout | null = null;
    let pollInterval: NodeJS.Timeout | null = null;
    let currentStream: fs.ReadStream | null = null;

    const brainDir = getDefaultBrainDir();
    let lastPathResolutionAttempt = 0;
    const RESOLVE_PATH_THROTTLE_MS = 1500;

    const resolvePathAsync = async (): Promise<string | null> => {
      if (currentPath) {
        try {
          await fs.promises.stat(currentPath);
          return currentPath;
        } catch {
          currentPath = null;
        }
      }

      const now = Date.now();
      if (now - lastPathResolutionAttempt < RESOLVE_PATH_THROTTLE_MS) {
        return null;
      }
      lastPathResolutionAttempt = now;

      try {
        const latestConv = await findLatestConversationAsync(brainDir, startTime - 5000);
        if (latestConv) {
          const found = getTranscriptPath(path.join(brainDir, latestConv));
          if (found) {
            await fs.promises.stat(found);
            currentPath = found;
            readOffset = 0;
            return found;
          }
        }
      } catch {}

      return null;
    };

    return new Promise<void>((resolve) => {
      let resolved = false;

      const cleanupResources = () => {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        if (quietTimer) {
          clearTimeout(quietTimer);
          quietTimer = null;
        }
        if (currentStream) {
          try {
            currentStream.destroy();
          } catch {}
          currentStream = null;
        }
      };

      const waiter = {
        abort: () => {
          if (!resolved) {
            resolved = true;
            cleanupResources();
            this.activeWaiters.delete(waiter);
            resolve();
          }
        }
      };
      this.activeWaiters.add(waiter);

      const finishAndReply = async (contentToSend: string) => {
        if (resolved) return;
        resolved = true;
        this.activeWaiters.delete(waiter);
        cleanupResources();

        if (contentToSend && contentToSend.trim()) {
          const plainText = stripMarkdownToPlainText(contentToSend);
          if (plainText && plainText.trim()) {
            const chunks = splitMessage(plainText, 3800);
            for (const chunk of chunks) {
              try {
                await ctx.reply(chunk);
              } catch (replyErr: any) {
                this.logger.warn('TELEGRAM', `Failed to send response chunk: ${replyErr?.message || replyErr}`);
              }
            }
          }
        }
        resolve();
      };

      let isChecking = false;
      const checkTranscript = async () => {
        if (resolved || isChecking) return;
        isChecking = true;

        try {
          if (Date.now() - startTime > timeoutMs) {
            this.activeWaiters.delete(waiter);
            cleanupResources();
            if (lastContent) {
              await finishAndReply(lastContent);
            } else {
              resolved = true;
              resolve();
            }
            return;
          }

          const tPath = await resolvePathAsync();
          if (!tPath || resolved) return;

          let stats: fs.Stats;
          try {
            stats = await fs.promises.stat(tPath);
          } catch {
            return;
          }

          if (stats.size <= readOffset || resolved) return;

          const stream = fs.createReadStream(tPath, {
            start: readOffset,
            end: stats.size - 1,
            encoding: 'utf8'
          });
          currentStream = stream;

          let chunkData = '';
          try {
            for await (const chunk of stream) {
              if (resolved) {
                stream.destroy();
                return;
              }
              chunkData += chunk;
            }
          } finally {
            if (currentStream === stream) {
              currentStream = null;
            }
          }

          readOffset = stats.size;
          lineBuffer += chunkData;
          let nlIdx: number;
          while ((nlIdx = lineBuffer.indexOf('\n')) !== -1) {
            const line = lineBuffer.slice(0, nlIdx).trim();
            lineBuffer = lineBuffer.slice(nlIdx + 1);
            if (!line) continue;

            try {
              const step = JSON.parse(line);
              if (step && step.source === 'MODEL' && step.type === 'PLANNER_RESPONSE') {
                const text = step.content || step.response || '';
                const hasNoTools = !step.tool_calls || (Array.isArray(step.tool_calls) && step.tool_calls.length === 0);

                if (text && text.trim()) {
                  lastContent = text;
                }

                if (step.status === 'DONE' && hasNoTools && lastContent) {
                  if (quietTimer) clearTimeout(quietTimer);
                  quietTimer = setTimeout(() => {
                    finishAndReply(lastContent).catch(() => {});
                  }, 600);
                } else if (quietTimer) {
                  clearTimeout(quietTimer);
                  quietTimer = null;
                }
              }
            } catch {}
          }
        } catch (err: any) {
          this.logger.warn('TELEGRAM', `Error reading transcript in awaitAndReplyModelResponse: ${err?.message || err}`);
        } finally {
          isChecking = false;
        }
      };

      pollInterval = setInterval(checkTranscript, 250);
      checkTranscript().catch(() => {});
    });
  }

  /**
   * Registers plan control commands (/plan_status, /plan_skip, /plan_stop, /help, /start).
   */
  public registerControlCommands(bot: Bot): void {
    bot.command('plan_status', async (ctx: Context) => {
      try {
        this.logger.info('TELEGRAM', `Received /plan_status command from user ${ctx.from?.id}`);
        const statusText = this.buildStatusDashboard();
        await ctx.reply(statusText);
      } catch (err: any) {
        this.logger.error('TELEGRAM', `Failed to execute /plan_status: ${err?.message || err}`, err);
        await ctx.reply(`❌ Failed to retrieve plan status: ${err?.message || err}`);
      }
    });

    bot.command('plan_skip', async (ctx: Context) => {
      try {
        this.logger.info('TELEGRAM', `Received /plan_skip command from user ${ctx.from?.id}`);
        const vs = getVscodeSafe();
        let triggered = false;
        if (vs?.commands?.executeCommand) {
          try {
            await vs.commands.executeCommand('autoplan.skipPhase');
            triggered = true;
          } catch (cmdErr: any) {
            this.logger.warn('TELEGRAM', `vscode autoplan.skipPhase failed: ${cmdErr?.message || cmdErr}`);
          }
        }
        if (!triggered && this.orchestrator && typeof this.orchestrator.skipCurrentPhase === 'function') {
          try {
            this.orchestrator.skipCurrentPhase();
            triggered = true;
          } catch (orchErr: any) {
            this.logger.warn('TELEGRAM', `orchestrator.skipCurrentPhase failed: ${orchErr?.message || orchErr}`);
          }
        }
        await ctx.reply('⏭️ Skipping current phase...');
      } catch (err: any) {
        this.logger.error('TELEGRAM', `Failed to execute /plan_skip: ${err?.message || err}`, err);
        await ctx.reply(`❌ Failed to skip phase: ${err?.message || err}`);
      }
    });

    bot.command('plan_stop', async (ctx: Context) => {
      try {
        this.logger.info('TELEGRAM', `Received /plan_stop command from user ${ctx.from?.id}`);
        const vs = getVscodeSafe();
        let triggered = false;
        if (vs?.commands?.executeCommand) {
          try {
            await vs.commands.executeCommand('autoplan.stop');
            triggered = true;
          } catch (cmdErr: any) {
            this.logger.warn('TELEGRAM', `vscode autoplan.stop failed: ${cmdErr?.message || cmdErr}`);
          }
        }
        if (!triggered && this.orchestrator && typeof this.orchestrator.stop === 'function') {
          try {
            this.orchestrator.stop();
            triggered = true;
          } catch (orchErr: any) {
            this.logger.warn('TELEGRAM', `orchestrator.stop failed: ${orchErr?.message || orchErr}`);
          }
        }
        await ctx.reply('🛑 Plan execution stopped.');
      } catch (err: any) {
        this.logger.error('TELEGRAM', `Failed to execute /plan_stop: ${err?.message || err}`, err);
        await ctx.reply(`❌ Failed to stop plan: ${err?.message || err}`);
      }
    });

    bot.command(['help', 'start'], async (ctx: Context) => {
      const helpText = [
        '🤖 Antigravity Remote Control Guide',
        '',
        '📋 Plan Management:',
        '• /plans - Browse available plan directories & select phases',
        '• /plan_start - Start executing discovered plan phases',
        '• /plan_status - Check orchestrator state & execution progress bar',
        '• /plan_skip - Skip currently running phase',
        '• /plan_stop - Stop active plan execution',
        '',
        '💻 Session & Screen:',
        '• /screen - Capture and receive desktop screenshot',
        '• /new_chat - Open fresh conversation in Antigravity IDE',
        '• /workspaces - Switch active IDE workspace window (/ws)',
        '• /help - Display this command quick reference guide',
        '',
        '💬 Free Chat Prompting:',
        'Send any regular text message to dispatch directly into Antigravity IDE.'
      ].join('\n');
      await ctx.reply(helpText);
    });
  }

  /**
   * Registers desktop screen capture command (/screen).
   */
  public registerScreenCommand(bot: Bot): void {
    bot.command('screen', async (ctx: Context) => {
      const chatId = ctx.chat?.id;
      if (!chatId) {
        return;
      }
      try {
        this.logger.info('TELEGRAM', `Received /screen capture request from user ${ctx.from?.id}`);
        await this.screenManager.send(bot, chatId, this.screenCaptureOptions);
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        this.logger.error('TELEGRAM', `Screen capture dispatch failed: ${errMsg}`, err);
        await ctx.reply(`❌ Screen capture failed: ${errMsg}`);
      }
    });
  }

  /**
   * Sends a long message to a Telegram chat, automatically chunking into safe segments (<= 3800 chars)
   * and preserving fenced code blocks across chunk boundaries.
   */
  public async sendSplitMessage(
    chatId: number | string,
    text: string,
    other?: any
  ): Promise<any[]> {
    if (!this.bot) {
      throw new Error('Telegram bot is not initialized');
    }
    const chunks = splitMessage(text, 3800);
    const results: any[] = [];
    for (const chunk of chunks) {
      const res = await this.bot.api.sendMessage(chatId, chunk, other);
      results.push(res);
    }
    return results;
  }

  /**
   * Begins long-polling for updates when this instance is leader.
   */
  public startPolling(): void {
    if (!this.bot || this.isPolling || !this.isRunning || !this.isLeader) {
      return;
    }

    this.isPolling = true;
    this.logger.info('TELEGRAM', `Initiating Telegram long polling for leader instance (PID ${process.pid})`);

    this.pollingPromise = this.bot
      .start({
        onStart: (botInfo) => {
          this.logger.info('TELEGRAM', `Telegram bot @${botInfo.username} polling active`);
        }
      })
      .catch((err: any) => {
        this.logger.error('TELEGRAM', `Telegram polling loop terminated with error: ${err?.message || err}`, err);
      })
      .finally(() => {
        this.isPolling = false;
        this.pollingPromise = null;
        if (this.isRunning && this.isLeader) {
          this.scheduleReconnect();
        }
      });
  }

  /**
   * Activates the Telegram bridge, checks leader election, and starts polling if leader.
   */
  public async start(options?: TelegramBridgeOptions): Promise<void> {
    if (options) {
      this.applyOptions(options);
    }

    if (!this.enabled) {
      this.logger.info('TELEGRAM', 'Telegram remote control is disabled in configuration. Standing by.');
      return;
    }

    if (!this.token) {
      try {
        const secureToken = await this.secretManager.getTelegramToken();
        if (secureToken) {
          this.token = secureToken;
        }
      } catch {}
      if (!this.token) {
        this.token = getTelegramConfig().botToken || '';
      }
    }

    if (!this.token) {
      this.logger.warn('TELEGRAM', 'Telegram bot token is not configured. Standing by.');
      return;
    }

    this.isRunning = true;
    this.initBot();

    if (this.chatMirror) {
      this.chatMirror.setBot(this.bot);
      this.chatMirror.setAllowedUsers(this.allowedUsers);
      if (this.enableChatMirror) {
        this.chatMirror.start().catch((err: any) => {
          this.logger.warn('TELEGRAM', `Chat mirror failed to start: ${err?.message || err}`);
        });
      }
    }

    // Perform leader election guard
    const acquired = this.tryAcquireLeadership();
    if (acquired) {
      this.isLeader = true;
      this.logger.info(
        'TELEGRAM',
        `Acquired primary Telegram leader ownership (window: ${this.windowKey}, PID: ${process.pid})`
      );
      this.startHeartbeat();
      this.syncBotCommands(this.bot).catch((err) => {
        this.logger.warn('TELEGRAM', `Leader command registration error: ${err?.message || err}`);
      });
      this.startPolling();
    } else {
      this.isLeader = false;
      this.logger.info(
        'TELEGRAM',
        `Standing by as Telegram follower; another instance holds active polling ownership.`
      );
      this.startStandbyPolling();
    }
  }

  /**
   * Gracefully shuts down the Telegram bridge, stops polling, and releases leadership.
   */
  public async stop(): Promise<void> {
    this.isRunning = false;

    this.stopHeartbeat();
    this.stopStandbyPolling();

    if (this.chatMirror) {
      try {
        this.chatMirror.stop();
      } catch {}
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.isLeader) {
      this.releaseLeadership();
      this.isLeader = false;
    }

    if (this.bot && this.isPolling) {
      try {
        await this.bot.stop();
      } catch (err: any) {
        this.logger.warn('TELEGRAM', `Error during bot.stop(): ${err?.message || err}`, err);
      }
      if (this.pollingPromise) {
        try {
          await this.pollingPromise;
        } catch {}
        this.pollingPromise = null;
      }
      this.isPolling = false;
    }

    if (this.notifier) {
      this.notifier.dispose();
    }

    if (this.orchestrator && this.phaseNudgedListener) {
      const remove = typeof this.orchestrator.off === 'function' ? 'off' : 'removeListener';
      if (typeof this.orchestrator[remove] === 'function') {
        this.orchestrator[remove]('phaseNudged', this.phaseNudgedListener);
      }
      this.phaseNudgedListener = undefined;
    }

    for (const waiter of this.activeWaiters) {
      try {
        waiter.abort();
      } catch {}
    }
    this.activeWaiters.clear();

    this.logger.info('TELEGRAM', `Telegram bridge successfully stopped for window ${this.windowKey}`);
  }
}

export const telegramBridge = new TelegramBridge();
export { PromptOriginTracker, formatPcPrompt, TelegramChatMirror };
