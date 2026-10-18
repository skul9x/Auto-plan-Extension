import { Bot, GrammyError, HttpError } from 'grammy';
import * as path from 'path';
import { debugLogger, DebugLogger } from './debugLogger';
import { getTelegramConfig } from './config';
import { splitMessage, stripMarkdownToPlainText } from './telegramUtils';

/**
 * Checks whether an error represents a Telegram 429 Too Many Requests response.
 */
export function isRateLimitError(err: any): boolean {
  if (!err) {
    return false;
  }
  if (err.error_code === 429) {
    return true;
  }
  if (err.status === 429 || err.statusCode === 429) {
    return true;
  }
  if (typeof err.description === 'string' && err.description.toLowerCase().includes('too many requests')) {
    return true;
  }
  if (typeof err.message === 'string' && (err.message.includes('429') || err.message.toLowerCase().includes('too many requests'))) {
    return true;
  }
  if (err.parameters && typeof err.parameters.retry_after === 'number') {
    return true;
  }
  return false;
}

/**
 * Extracts retry_after duration in milliseconds from Telegram error or headers.
 */
export function extractRetryAfter(err: any): number {
  if (err?.parameters?.retry_after && typeof err.parameters.retry_after === 'number') {
    return err.parameters.retry_after * 1000;
  }
  if (err?.retry_after && typeof err.retry_after === 'number') {
    return err.retry_after * 1000;
  }
  if (err?.response?.headers) {
    const header = typeof err.response.headers.get === 'function'
      ? err.response.headers.get('retry-after')
      : err.response.headers['retry-after'];
    if (header) {
      const parsed = parseInt(String(header), 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed * 1000;
      }
    }
  }
  if (typeof err?.description === 'string') {
    const match = err.description.match(/retry\s+after\s+(\d+)/i);
    if (match) {
      return parseInt(match[1], 10) * 1000;
    }
  }
  if (typeof err?.message === 'string') {
    const match = err.message.match(/retry\s+after\s+(\d+)/i);
    if (match) {
      return parseInt(match[1], 10) * 1000;
    }
  }
  return 5000;
}

/**
 * Formats transcript updates into a concise user-friendly activity preview.
 * e.g. "⏳ Reading src/auth.ts...", "🛠️ Editing controllers..."
 */
export function formatActivityPreview(data: any): string {
  if (!data) {
    return '⏳ In progress...';
  }

  let obj = data;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed) {
      return '⏳ In progress...';
    }
    let parsed: any = null;
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = null;
      }
    }
    if (parsed) {
      obj = parsed;
    } else {
      if (/read|view/i.test(trimmed)) {
        return `⏳ ${trimmed.slice(0, 100)}`;
      }
      if (/edit|write|replac/i.test(trimmed)) {
        return `🛠️ ${trimmed.slice(0, 100)}`;
      }
      if (/run|exec|command/i.test(trimmed)) {
        return `💻 ${trimmed.slice(0, 100)}`;
      }
      return `⏳ ${trimmed.slice(0, 100)}`;
    }
  }

  if (obj && typeof obj === 'object') {
    const toolCalls = obj.tool_calls || obj.toolCalls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const tc = toolCalls[toolCalls.length - 1];
      const action = tc.toolAction || tc.tool_action || tc.action;
      const toolName = tc.tool_name || tc.toolName || tc.name || '';
      const params = tc.parameters || tc.params || tc.args || {};

      if (action && typeof action === 'string') {
        const actLower = action.toLowerCase();
        if (actLower.includes('read') || actLower.includes('view')) {
          return `⏳ ${action}...`;
        }
        if (actLower.includes('edit') || actLower.includes('writ') || actLower.includes('mod') || actLower.includes('replac')) {
          return `🛠️ ${action}...`;
        }
        if (actLower.includes('run') || actLower.includes('command') || actLower.includes('terminal')) {
          return `💻 ${action}...`;
        }
        if (actLower.includes('search') || actLower.includes('grep')) {
          return `🔍 ${action}...`;
        }
        return `⚙️ ${action}...`;
      }

      const nameLower = toolName.toLowerCase();
      if (nameLower.includes('view') || nameLower.includes('read')) {
        const target = params.AbsolutePath || params.path || params.file || '';
        const base = target ? path.basename(String(target)) : '';
        return `⏳ Reading ${base || 'file'}...`;
      }
      if (nameLower.includes('replace') || nameLower.includes('write') || nameLower.includes('edit')) {
        const target = params.TargetFile || params.path || params.file || '';
        const base = target ? path.basename(String(target)) : '';
        return `🛠️ Editing ${base || 'file'}...`;
      }
      if (nameLower.includes('command') || nameLower.includes('bash') || nameLower.includes('terminal') || nameLower.includes('run')) {
        const cmd = params.CommandLine || params.cmd || params.command || '';
        const snippet = cmd ? String(cmd).slice(0, 40) : '';
        return `💻 Running ${snippet || 'command'}...`;
      }
      if (nameLower.includes('search') || nameLower.includes('grep')) {
        const q = params.Query || params.query || '';
        return `🔍 Searching ${q ? `"${q.slice(0, 30)}"` : 'codebase'}...`;
      }
      if (toolName) {
        return `⚙️ Executing ${toolName}...`;
      }
    }

    const content = obj.content || obj.response || obj.text;
    if (typeof content === 'string' && content.trim()) {
      const firstLine = content.trim().split('\n')[0].trim();
      if (firstLine) {
        const cleanFirstLine = stripMarkdownToPlainText(firstLine);
        return `💭 ${cleanFirstLine.slice(0, 100)}...`;
      }
    }
  }

  return '⏳ In progress...';
}

export interface ThrottledNotifierOptions {
  bot?: Bot | null;
  chatId?: number | string | (number | string)[];
  chatIds?: (number | string)[];
  throttleMs?: number;
  logger?: DebugLogger;
  transcriptWatcher?: any;
  orchestrator?: any;
}

/**
 * Controller for debounced live status message updates, lifecycle events,
 * and Telegram rate-limiting backoff.
 */
export class ThrottledNotifier {
  private bot: Bot | null = null;
  private chatIds: Set<string | number> = new Set();
  private throttleMs: number = 2500;
  private logger: DebugLogger;
  private liveMessageIds: Map<string | number, number> = new Map();
  private lastEditTime: number = 0;
  private throttleTimer: NodeJS.Timeout | null = null;
  private isEditing: boolean = false;
  private pendingUpdate: boolean = false;
  private pausedUntil: number = 0;
  private currentPhaseName: string = '';
  private latestActivityPreview: string = '';

  private orchestrator: any = null;
  private transcriptWatcher: any = null;

  private orchListeners: { [evt: string]: (...args: any[]) => void } = {};
  private watcherListeners: { [evt: string]: (...args: any[]) => void } = {};

  constructor(options?: ThrottledNotifierOptions) {
    this.logger = options?.logger || debugLogger;
    this.bot = options?.bot || null;
    this.throttleMs = options?.throttleMs ?? getTelegramConfig().throttleMs ?? 2500;

    if (options?.chatId !== undefined) {
      if (Array.isArray(options.chatId)) {
        options.chatId.forEach((id) => this.chatIds.add(id));
      } else {
        this.chatIds.add(options.chatId);
      }
    }
    if (options?.chatIds !== undefined) {
      options.chatIds.forEach((id) => this.chatIds.add(id));
    }

    if (options?.orchestrator) {
      this.attachOrchestrator(options.orchestrator);
    }
    if (options?.transcriptWatcher) {
      this.attachTranscriptWatcher(options.transcriptWatcher);
    }
  }

  public setBot(bot: Bot | null): void {
    this.bot = bot;
  }

  public getBot(): Bot | null {
    return this.bot;
  }

  public setThrottleMs(ms: number): void {
    if (ms > 0) {
      this.throttleMs = ms;
    }
  }

  public getThrottleMs(): number {
    return this.throttleMs;
  }

  public setChatIds(chatIds: (number | string)[]): void {
    this.chatIds.clear();
    chatIds.forEach((id) => this.chatIds.add(id));
  }

  public addChatId(chatId: number | string): void {
    if (chatId !== undefined && chatId !== null) {
      this.chatIds.add(chatId);
    }
  }

  public removeChatId(chatId: number | string): void {
    this.chatIds.delete(chatId);
  }

  public getChatIds(): (number | string)[] {
    return Array.from(this.chatIds);
  }

  public getLiveMessageId(chatId?: number | string): number | undefined {
    if (chatId !== undefined) {
      return this.liveMessageIds.get(chatId);
    }
    const firstKey = this.liveMessageIds.keys().next().value;
    return firstKey !== undefined ? this.liveMessageIds.get(firstKey) : undefined;
  }

  public setLiveMessageId(chatId: number | string, messageId: number): void {
    this.liveMessageIds.set(chatId, messageId);
  }

  public getLiveMessageMap(): Map<string | number, number> {
    return new Map(this.liveMessageIds);
  }

  public isPaused(): boolean {
    return Date.now() < this.pausedUntil;
  }

  public getPausedUntil(): number {
    return this.pausedUntil;
  }

  public getCurrentPhaseName(): string {
    return this.currentPhaseName;
  }

  public getLatestActivityPreview(): string {
    return this.latestActivityPreview;
  }

  public getEffectiveChatIds(): (number | string)[] {
    if (this.chatIds.size > 0) {
      return Array.from(this.chatIds);
    }
    const config = getTelegramConfig();
    if (config.allowedUsers && config.allowedUsers.length > 0) {
      return config.allowedUsers;
    }
    return [];
  }

  /**
   * Builds the live progress update status message string.
   */
  public buildLiveStatusText(): string {
    const phaseHeader = this.currentPhaseName ? `🔄 Live Progress: ${this.currentPhaseName}` : '🔄 Auto-Plan Live Progress';
    const activity = this.latestActivityPreview || '⏳ Initializing...';
    return `${phaseHeader}\n${activity}`;
  }

  /**
   * Attaches lifecycle listeners to an AutoPlanOrchestrator instance.
   */
  public attachOrchestrator(orch: any): void {
    if (!orch || typeof orch.on !== 'function') {
      return;
    }
    this.orchestrator = orch;

    this.orchListeners['phaseStart'] = (phase: any, index?: number, total?: number, fileName?: string, filePath?: string) => {
      this.handlePhaseStart(phase, index, total, fileName, filePath).catch((err) => {
        this.logger.warn('TELEGRAM', `Error in handlePhaseStart: ${err?.message || err}`);
      });
    };
    this.orchListeners['phaseComplete'] = (phase: any, completionResult?: any, index?: number, total?: number) => {
      this.handlePhaseComplete(phase, completionResult, index, total).catch((err) => {
        this.logger.warn('TELEGRAM', `Error in handlePhaseComplete: ${err?.message || err}`);
      });
    };
    this.orchListeners['skipped'] = (phase: any) => {
      this.handleSkipped(phase).catch((err) => {
        this.logger.warn('TELEGRAM', `Error in handleSkipped: ${err?.message || err}`);
      });
    };
    this.orchListeners['allComplete'] = (total?: number) => {
      this.handleAllComplete(total).catch((err) => {
        this.logger.warn('TELEGRAM', `Error in handleAllComplete: ${err?.message || err}`);
      });
    };
    this.orchListeners['stopped'] = () => {
      this.handleStopped().catch((err) => {
        this.logger.warn('TELEGRAM', `Error in handleStopped: ${err?.message || err}`);
      });
    };
    this.orchListeners['error'] = (err: any) => {
      this.handleError(err).catch((e) => {
        this.logger.warn('TELEGRAM', `Error in handleError: ${e?.message || e}`);
      });
    };

    for (const [evt, handler] of Object.entries(this.orchListeners)) {
      orch.on(evt, handler);
    }
  }

  /**
   * Attaches streaming and completion listeners to a TranscriptWatcher instance.
   */
  public attachTranscriptWatcher(watcher: any): void {
    if (!watcher || typeof watcher.on !== 'function') {
      return;
    }
    this.transcriptWatcher = watcher;

    this.watcherListeners['logUpdate'] = (line: string) => {
      this.handleLogUpdate(line);
    };
    this.watcherListeners['settleStarted'] = (data: any) => {
      this.handleSettleStarted(data);
    };
    this.watcherListeners['onCompletionDetected'] = (eventData: any) => {
      this.handleCompletionDetected(eventData).catch((err) => {
        this.logger.warn('TELEGRAM', `Error in handleCompletionDetected: ${err?.message || err}`);
      });
    };

    for (const [evt, handler] of Object.entries(this.watcherListeners)) {
      watcher.on(evt, handler);
    }
  }

  /**
   * Enqueues a debounced and throttled live message update.
   */
  public queueThrottledUpdate(): void {
    this.pendingUpdate = true;
    const now = Date.now();

    if (now < this.pausedUntil) {
      if (!this.throttleTimer) {
        this.throttleTimer = setTimeout(() => {
          this.throttleTimer = null;
          this.flushThrottleBuffer().catch(() => {});
        }, this.pausedUntil - now);
      }
      return;
    }

    const elapsed = now - this.lastEditTime;
    if (elapsed >= this.throttleMs && !this.isEditing) {
      if (this.throttleTimer) {
        clearTimeout(this.throttleTimer);
        this.throttleTimer = null;
      }
      this.flushThrottleBuffer().catch(() => {});
    } else if (!this.throttleTimer) {
      const wait = Math.max(50, this.throttleMs - elapsed);
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        this.flushThrottleBuffer().catch(() => {});
      }, wait);
    }
  }

  /**
   * Flushes any buffered live updates immediately to Telegram.
   */
  public async flushThrottleBuffer(): Promise<void> {
    if (!this.bot || !this.pendingUpdate) {
      return;
    }

    if (this.isEditing) {
      this.pendingUpdate = true;
      return;
    }

    const now = Date.now();
    if (now < this.pausedUntil) {
      if (!this.throttleTimer) {
        this.throttleTimer = setTimeout(() => {
          this.throttleTimer = null;
          this.flushThrottleBuffer().catch(() => {});
        }, this.pausedUntil - now);
      }
      return;
    }

    this.isEditing = true;
    this.pendingUpdate = false;

    const text = this.buildLiveStatusText();
    const chatIds = this.getEffectiveChatIds();

    try {
      for (const chatId of chatIds) {
        const existingMessageId = this.liveMessageIds.get(chatId);
        if (existingMessageId) {
          await this.safeEditMessage(chatId, existingMessageId, text);
          this.lastEditTime = Date.now();
        } else {
          const sent = await this.safeSendMessage(chatId, text);
          if (sent && sent.message_id) {
            this.liveMessageIds.set(chatId, sent.message_id);
            this.lastEditTime = Date.now();
          }
        }
      }
    } catch (err: any) {
      this.logger.warn('TELEGRAM', `Error during flushThrottleBuffer: ${err?.message || err}`);
    } finally {
      this.isEditing = false;
      if (this.pendingUpdate && !this.throttleTimer) {
        const elapsed = Date.now() - this.lastEditTime;
        const wait = Math.max(0, this.throttleMs - elapsed);
        this.throttleTimer = setTimeout(() => {
          this.throttleTimer = null;
          this.flushThrottleBuffer().catch(() => {});
        }, wait);
      }
    }
  }

  /**
   * Finalizes and unpins live progress messages upon phase completion,
   * ensuring subsequent phases generate fresh containers.
   */
  public async finalizeLiveMessage(finalText?: string): Promise<void> {
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.pendingUpdate = false;

    for (const [chatId, messageId] of this.liveMessageIds.entries()) {
      if (finalText) {
        await this.safeEditMessage(chatId, messageId, finalText).catch(() => {});
      }
      if (this.bot) {
        try {
          await this.bot.api.unpinChatMessage(chatId, messageId);
        } catch {
          // Ignore unpin failures (e.g. message was not pinned)
        }
      }
    }

    this.liveMessageIds.clear();
    this.latestActivityPreview = '';
    this.lastEditTime = 0;
  }

  /**
   * Broadcasts a new message to all active / authorized chats.
   */
  public async broadcastMessage(text: string, options?: any): Promise<any[]> {
    const cleanText = stripMarkdownToPlainText(text);
    const chatIds = this.getEffectiveChatIds();
    const results: any[] = [];
    if (cleanText.length > 3800) {
      const chunks = splitMessage(cleanText, 3800);
      for (const chatId of chatIds) {
        for (const chunk of chunks) {
          const res = await this.safeSendMessage(chatId, chunk, options);
          if (res) {
            results.push(res);
          }
        }
      }
    } else {
      for (const chatId of chatIds) {
        const res = await this.safeSendMessage(chatId, cleanText, options);
        if (res) {
          results.push(res);
        }
      }
    }
    return results;
  }

  /**
   * Sends an informative notification to all authorized Telegram users.
   */
  public async sendInfo(text: string, options?: any): Promise<any[]> {
    return this.broadcastMessage(text, options);
  }

  public handleLogUpdate(line: string): void {
    const preview = formatActivityPreview(line);
    this.latestActivityPreview = preview;
    this.queueThrottledUpdate();
  }

  public handleSettleStarted(data?: any): void {
    const quietMs = data?.quietPeriodMs;
    this.latestActivityPreview = quietMs
      ? `⏳ Verifying completion stability (${quietMs}ms quiet period)...`
      : '⏳ Verifying completion stability...';
    this.queueThrottledUpdate();
  }

  public async handlePhaseStart(
    phase: any,
    index?: number,
    total?: number,
    fileName?: string,
    filePath?: string
  ): Promise<void> {
    await this.finalizeLiveMessage();

    const rawPhaseName = phase?.fileName || phase?.name || phase?.title || (typeof phase === 'string' ? phase : 'Phase');
    const phaseName = stripMarkdownToPlainText(rawPhaseName);
    this.currentPhaseName = phaseName;

    let idx = 1;
    let tot = total ?? (phase && typeof phase === 'object' && phase.total ? phase.total : 1);

    if (typeof index === 'number') {
      if (phase && typeof phase === 'object' && typeof phase.phaseNumber === 'number') {
        idx = phase.phaseNumber;
      } else if (index === 0) {
        idx = 1;
      } else {
        idx = index;
      }
    } else if (phase && typeof phase === 'object' && typeof phase.phaseNumber === 'number') {
      idx = phase.phaseNumber;
    }

    const messageText = `🚀 Phase Started: ${phaseName} (${idx}/${tot})`;
    await this.broadcastMessage(messageText);
  }

  public async handlePhaseComplete(
    phase: any,
    completionResult?: any,
    index?: number,
    total?: number
  ): Promise<void> {
    await this.flushThrottleBuffer();
    await this.finalizeLiveMessage();

    const rawPhaseName = phase?.fileName || phase?.name || phase?.title || (typeof phase === 'string' ? phase : 'Phase');
    const phaseName = stripMarkdownToPlainText(rawPhaseName);

    const summaryParts: string[] = [];
    if (index !== undefined && total !== undefined) {
      const idx = index === 0 ? 1 : index;
      summaryParts.push(`Iteration ${idx}/${total}`);
    }
    if (completionResult) {
      if (typeof completionResult === 'string') {
        const cleanResult = stripMarkdownToPlainText(completionResult);
        if (cleanResult) {
          summaryParts.push(cleanResult);
        }
      } else if (typeof completionResult === 'object') {
        if (completionResult.summary) {
          const cleanSummary = stripMarkdownToPlainText(String(completionResult.summary));
          if (cleanSummary) {
            summaryParts.push(cleanSummary);
          }
        }
        if (completionResult.durationMs) {
          summaryParts.push(`Duration: ${Math.round(completionResult.durationMs / 1000)}s`);
        }
      }
    }

    const summaryText = summaryParts.length > 0 ? `\n• ${summaryParts.join(' • ')}` : '';
    const messageText = `✅ Phase Completed: ${phaseName}${summaryText}`;
    await this.broadcastMessage(messageText);
  }

  public async handleSkipped(phase: any): Promise<void> {
    await this.finalizeLiveMessage();
    const rawPhaseName = phase?.fileName || phase?.name || phase?.title || (typeof phase === 'string' ? phase : 'Phase');
    const phaseName = stripMarkdownToPlainText(rawPhaseName);
    const messageText = `⏭️ Phase Skipped: ${phaseName}`;
    await this.broadcastMessage(messageText);
  }

  public async handleAllComplete(total?: number): Promise<void> {
    await this.finalizeLiveMessage();
    const messageText = '🎉 All Phases Completed Successfully!';
    await this.broadcastMessage(messageText);
  }

  public async handleStopped(): Promise<void> {
    await this.finalizeLiveMessage();
    const messageText = '🛑 Plan Execution Stopped';
    await this.broadcastMessage(messageText);
  }

  public async handleError(err: any): Promise<void> {
    await this.finalizeLiveMessage();
    const rawErrMsg = err?.message || String(err);
    const errMsg = stripMarkdownToPlainText(rawErrMsg);
    const messageText = `❌ Error: ${errMsg}`;
    await this.broadcastMessage(messageText);
  }

  public async handleCompletionDetected(eventData: any): Promise<void> {
    await this.flushThrottleBuffer();
    await this.finalizeLiveMessage();

    const rawContent =
      eventData?.matchedContent ||
      eventData?.content ||
      eventData?.response ||
      eventData?.parsed?.content ||
      (typeof eventData === 'string' ? eventData : '');

    const header = `🏁 Completion Detected (Done skul9x.):\n\n`;
    const cleanContent = stripMarkdownToPlainText(rawContent || 'Done skul9x.');
    const fullText = header + cleanContent;

    const chatIds = this.getEffectiveChatIds();
    if (fullText.length > 3800) {
      const chunks = splitMessage(fullText, 3800);
      for (const chatId of chatIds) {
        for (const chunk of chunks) {
          await this.safeSendMessage(chatId, chunk);
        }
      }
    } else {
      for (const chatId of chatIds) {
        await this.safeSendMessage(chatId, fullText);
      }
    }
  }

  private handleRateLimit(err: any): void {
    const retryAfterMs = extractRetryAfter(err);
    this.pausedUntil = Date.now() + retryAfterMs;
    this.logger.warn(
      'TELEGRAM',
      `Telegram 429 Too Many Requests rate limit encountered. Pausing edits for ${retryAfterMs}ms.`
    );
  }

  private async safeSendMessage(chatId: number | string, text: string, other?: any): Promise<any> {
    if (!this.bot) {
      return null;
    }
    const cleanText = stripMarkdownToPlainText(text);
    const options = { ...other, parse_mode: undefined };
    try {
      return await this.bot.api.sendMessage(chatId, cleanText, options);
    } catch (err: any) {
      if (isRateLimitError(err)) {
        this.handleRateLimit(err);
      } else {
        this.logger.warn('TELEGRAM', `safeSendMessage failed for chat ${chatId}: ${err?.message || err}`);
      }
      return null;
    }
  }

  private async safeEditMessage(chatId: number | string, messageId: number, text: string, other?: any): Promise<any> {
    if (!this.bot) {
      return null;
    }
    const cleanText = stripMarkdownToPlainText(text);
    const options = { ...other, parse_mode: undefined };
    try {
      return await this.bot.api.editMessageText(chatId, messageId, cleanText, options);
    } catch (err: any) {
      if (
        err?.description?.includes('message is not modified') ||
        err?.message?.includes('message is not modified')
      ) {
        return null;
      }
      if (
        err?.description?.includes('message to edit not found') ||
        err?.message?.includes('message to edit not found')
      ) {
        this.liveMessageIds.delete(chatId);
        return null;
      }
      if (isRateLimitError(err)) {
        this.handleRateLimit(err);
        return null;
      }
      this.logger.warn('TELEGRAM', `safeEditMessage failed for chat ${chatId}: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Cleans up all pending timers and event listeners.
   */
  public dispose(): void {
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }

    if (this.orchestrator) {
      const remove = typeof this.orchestrator.off === 'function' ? 'off' : 'removeListener';
      if (typeof (this.orchestrator as any)[remove] === 'function') {
        for (const [evt, handler] of Object.entries(this.orchListeners)) {
          (this.orchestrator as any)[remove](evt, handler);
        }
      }
      this.orchListeners = {};
      this.orchestrator = null;
    }

    if (this.transcriptWatcher) {
      const remove = typeof this.transcriptWatcher.off === 'function' ? 'off' : 'removeListener';
      if (typeof (this.transcriptWatcher as any)[remove] === 'function') {
        for (const [evt, handler] of Object.entries(this.watcherListeners)) {
          (this.transcriptWatcher as any)[remove](evt, handler);
        }
      }
      this.watcherListeners = {};
      this.transcriptWatcher = null;
    }
  }
}

export { ThrottledNotifier as TelegramNotifier };
