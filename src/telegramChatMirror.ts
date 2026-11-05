/**
 * Telegram Live Q&A Chat Mirror & Throttled Response Deliverer.
 *
 * Orchestrates real-time synchronization between Antigravity IDE and Telegram.
 * Handles typing indicator lifecycles, Markdown entity-safe chunking, and rate-limited
 * throttled response delivery with automatic retry on Telegram 429 Too Many Requests.
 */

import * as fs from 'fs';
import { splitMarkdownSafely, DEFAULT_MAX_CHUNK_LENGTH } from './smartMarkdownChunker';
import {
  markdownToTelegramHtml,
  splitHtmlMessage,
  stripMarkdownToPlainText,
  isEntityParseError
} from './telegramUtils';
import { TypingActionManager, typingActionManager as defaultTypingManager } from './typingActionManager';
import {
  PromptOriginTracker,
  promptOriginTracker as defaultOriginTracker,
  formatPcPrompt,
  formatNudgePrompt,
  PromptOrigin
} from './promptOriginTracker';
import {
  TranscriptTailEngine,
  UserInputEvent,
  PlannerResponseEvent,
  AgentActivityEvent
} from './transcriptTailEngine';

export const DEFAULT_AI_RESPONSE_HEADER = '🤖 Antigravity:';
export const DEFAULT_MIN_CHUNK_DELAY_MS = 1000;
export const DEFAULT_MAX_DELIVERY_RETRIES = 3;

/**
 * Checks whether an error from Telegram is a 429 Too Many Requests rate limit error.
 */
export function isRateLimitError(err: any): boolean {
  if (!err) {
    return false;
  }
  if (err.error_code === 429) {
    return true;
  }
  if (err.parameters && typeof err.parameters.retry_after === 'number') {
    return true;
  }
  const desc = String(err.description || err.message || '').toLowerCase();
  return desc.includes('429') || desc.includes('too many requests') || desc.includes('retry after');
}

/**
 * Extracts retry_after duration in milliseconds from a Telegram API error.
 */
export function extractRetryAfterMs(err: any): number {
  if (err?.parameters?.retry_after && typeof err.parameters.retry_after === 'number') {
    return err.parameters.retry_after * 1000;
  }
  if (err?.retry_after && typeof err.retry_after === 'number') {
    return err.retry_after * 1000;
  }
  const desc = String(err?.description || err?.message || '');
  const match = desc.match(/retry\s+after\s+(\d+)/i);
  if (match) {
    const secs = parseInt(match[1], 10);
    if (!isNaN(secs) && secs > 0) {
      return secs * 1000;
    }
  }
  return 1000;
}

/**
 * Re-export isEntityParseError from telegramUtils for backwards compatibility.
 */
export { isEntityParseError } from './telegramUtils';

export interface ThrottledDelivererOptions {
  minChunkDelayMs?: number;
  maxRetries?: number;
  sleepFn?: (ms: number) => Promise<void>;
  logger?: any;
}

/**
 * ThrottledResponseDeliverer sends response chunks to Telegram with minimum delays
 * between consecutive chunks and automatic handling for rate limits (429) and entity parse errors.
 */
export class ThrottledResponseDeliverer {
  private minChunkDelayMs: number;
  private maxRetries: number;
  private sleepFn: (ms: number) => Promise<void>;
  private logger?: any;
  private lastDeliveryPerChat = new Map<string | number, number>();

  constructor(options?: ThrottledDelivererOptions) {
    this.minChunkDelayMs = options?.minChunkDelayMs ?? DEFAULT_MIN_CHUNK_DELAY_MS;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_DELIVERY_RETRIES;
    this.sleepFn =
      options?.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.logger = options?.logger;
  }

  public getMinChunkDelayMs(): number {
    return this.minChunkDelayMs;
  }

  public setMinChunkDelayMs(ms: number): void {
    this.minChunkDelayMs = Math.max(0, ms);
  }

  /**
   * Delivers an array of text chunks sequentially to target chat ID.
   */
  public async deliverChunks(
    bot: any,
    chatId: string | number,
    chunks: string[],
    options?: {
      parse_mode?: string;
      onChunkSent?: (chunk: string, index: number, total: number) => void;
      sleepFn?: (ms: number) => Promise<void>;
      nowFn?: () => number;
      minChunkDelayMs?: number;
    }
  ): Promise<any[]> {
    const results: any[] = [];
    const total = chunks.length;
    const sleepFunc = options?.sleepFn ?? this.sleepFn;
    const minDelay = options?.minChunkDelayMs ?? this.minChunkDelayMs;
    const parseMode = options && 'parse_mode' in options ? options.parse_mode : 'HTML';

    for (let i = 0; i < total; i++) {
      const chunk = chunks[i];

      // Throttle: Enforce minChunkDelayMs between chunks for the same chat
      const lastSent = this.lastDeliveryPerChat.get(chatId) ?? 0;
      const now = options?.nowFn ? options.nowFn() : Date.now();
      if (lastSent > 0) {
        const elapsed = now - lastSent;
        const waitMs = minDelay - elapsed;
        if (waitMs > 0) {
          await sleepFunc(waitMs);
        }
      }

      const res = await this.sendSingleChunkWithRetry(
        bot,
        chatId,
        chunk,
        parseMode
      );
      const sentTime = options?.nowFn ? options.nowFn() : Date.now();
      this.lastDeliveryPerChat.set(chatId, sentTime);
      results.push(res);

      if (options?.onChunkSent) {
        options.onChunkSent(chunk, i, total);
      }
    }

    return results;
  }

  private async sendSingleChunkWithRetry(
    bot: any,
    chatId: string | number,
    chunk: string,
    initialParseMode: string | undefined = 'HTML'
  ): Promise<any> {
    let parseMode: string | undefined = initialParseMode;
    let currentChunk = chunk;
    let attempts = 0;

    while (attempts < this.maxRetries) {
      try {
        const sendOpts: any = {};
        if (parseMode) {
          sendOpts.parse_mode = parseMode;
        }

        if (bot?.api && typeof bot.api.sendMessage === 'function') {
          return await bot.api.sendMessage(chatId, currentChunk, sendOpts);
        } else if (typeof bot?.sendMessage === 'function') {
          return await bot.sendMessage(chatId, currentChunk, sendOpts);
        } else {
          throw new Error('Bot does not expose sendMessage or bot.api.sendMessage');
        }
      } catch (err: any) {
        attempts++;

        // 1. Rate Limit handling (HTTP 429)
        if (isRateLimitError(err)) {
          const retryAfterMs = extractRetryAfterMs(err);
          const warnMsg = `Telegram 429 Too Many Requests for chat ${chatId}. Waiting ${retryAfterMs}ms before retry (${attempts}/${this.maxRetries})`;
          if (this.logger?.warn) {
            this.logger.warn(warnMsg);
          } else {
            console.warn(warnMsg);
          }
          if (attempts >= this.maxRetries) {
            throw err;
          }
          await this.sleepFn(retryAfterMs);
          continue;
        }

        // 2. Entity Parse Error handling: retry once as plain text
        if (isEntityParseError(err) && parseMode) {
          const warnMsg = `Telegram entity parse error for chat ${chatId}: ${err?.message || err?.description || err}. Falling back to plain text delivery.`;
          if (this.logger?.warn) {
            this.logger.warn(warnMsg);
          } else {
            console.warn(warnMsg);
          }
          parseMode = undefined;
          currentChunk = stripMarkdownToPlainText(currentChunk);
          continue;
        }

        // Other errors
        if (attempts >= this.maxRetries) {
          throw err;
        }
        await this.sleepFn(300);
      }
    }
  }
}

export let defaultResponseDeliverer = new ThrottledResponseDeliverer();
export function resetDefaultResponseDeliverer(): void {
  defaultResponseDeliverer = new ThrottledResponseDeliverer();
}

export interface DeliverChunkedResponseOptions {
  header?: string;
  prefix?: string;
  maxChunkLength?: number;
  minChunkDelayMs?: number;
  parse_mode?: string;
  sleepFn?: (ms: number) => Promise<void>;
  nowFn?: () => number;
  logger?: any;
  onChunkSent?: (chunk: string, index: number, total: number) => void;
  deliverer?: ThrottledResponseDeliverer;
}

/**
 * Formats, chunks, and delivers an assistant response to Telegram with rich HTML formatting
 * (or specified parse_mode) and rate-limited throttling.
 *
 * @param bot The Telegram bot instance (Bot or mock).
 * @param chatId Target chat ID.
 * @param text The markdown text to send.
 * @param options Delivery customization options.
 */
export async function deliverChunkedResponse(
  bot: any,
  chatId: string | number,
  text: string,
  options?: DeliverChunkedResponseOptions
): Promise<void> {
  if (!text || typeof text !== 'string') {
    return;
  }

  const prefix =
    options?.prefix !== undefined
      ? options.prefix
      : options?.header !== undefined
      ? options.header
      : DEFAULT_AI_RESPONSE_HEADER;

  const maxChunkLength = options?.maxChunkLength ?? DEFAULT_MAX_CHUNK_LENGTH;
  const parseMode = options && 'parse_mode' in options ? options.parse_mode : 'HTML';

  let fullText = text.trim();
  if (prefix && prefix.length > 0) {
    if (!fullText.startsWith(prefix)) {
      fullText = `${prefix}\n\n${fullText}`;
    }
  }

  let chunks: string[];
  if (parseMode === 'HTML') {
    const htmlContent = markdownToTelegramHtml(fullText);
    chunks = splitHtmlMessage(htmlContent, maxChunkLength);
  } else {
    chunks = splitMarkdownSafely(fullText, maxChunkLength);
  }

  if (chunks.length === 0) {
    return;
  }

  const deliverer = options?.deliverer ?? defaultResponseDeliverer;
  if (options?.sleepFn) {
    (deliverer as any).sleepFn = options.sleepFn;
  }
  if (options?.logger) {
    (deliverer as any).logger = options.logger;
  }
  if (options?.minChunkDelayMs !== undefined) {
    deliverer.setMinChunkDelayMs(options.minChunkDelayMs);
  }

  await deliverer.deliverChunks(bot, chatId, chunks, {
    parse_mode: parseMode,
    onChunkSent: options?.onChunkSent,
    sleepFn: options?.sleepFn,
    nowFn: options?.nowFn,
    minChunkDelayMs: options?.minChunkDelayMs
  });
}

export interface TelegramChatMirrorOptions {
  bot?: any;
  allowedUsers?: (string | number)[];
  prefix?: string;
  enableChatMirror?: boolean;
  mirrorIncludePcPrompts?: boolean;
  minChunkDelayMs?: number;
  typingIntervalMs?: number;
  promptOriginTracker?: PromptOriginTracker;
  typingActionManager?: TypingActionManager;
  tailEngine?: TranscriptTailEngine;
  brainDir?: string;
  activeConvId?: string;
  transcriptPath?: string;
  workspaceName?: string;
  workspacePath?: string;
  isMultiWorkspace?: boolean | (() => boolean);
  registryPath?: string;
  registryTtlMs?: number;
  logger?: any;
  isLeader?: boolean;
  isLeaderFn?: () => boolean;
}

/**
 * Top-level coordinator for Live Clean Q&A Mirror between Antigravity IDE and Telegram.
 */
export class TelegramChatMirror {
  private bot: any;
  private allowedUsers: Set<string | number> = new Set();
  private prefix: string;
  private enableChatMirror: boolean;
  private mirrorIncludePcPrompts: boolean;
  private typingManager: TypingActionManager;
  private originTracker: PromptOriginTracker;
  private deliverer: ThrottledResponseDeliverer;
  private tailEngine: TranscriptTailEngine | null = null;
  private brainDir?: string;
  private activeConvId?: string;
  private transcriptPath?: string;
  private workspaceName?: string;
  private workspacePath?: string;
  private isMultiWorkspace?: boolean | (() => boolean);
  private registryPath?: string;
  private registryTtlMs: number = 5000;
  private _cachedIsMultiWorkspace: boolean | null = null;
  private _cachedWorkspaceCheckTimestamp: number = 0;
  private boundTailListeners: { event: string; listener: (...args: any[]) => any }[] = [];
  private logger?: any;
  private _isLeader: boolean = true;
  private isLeaderFn?: () => boolean;

  constructor(options?: TelegramChatMirrorOptions) {
    this.bot = options?.bot;
    if (options?.allowedUsers) {
      for (const u of options.allowedUsers) {
        this.allowedUsers.add(u);
      }
    }
    this.prefix = options?.prefix ?? DEFAULT_AI_RESPONSE_HEADER;
    this.enableChatMirror = options?.enableChatMirror ?? true;
    this.mirrorIncludePcPrompts = options?.mirrorIncludePcPrompts ?? true;
    this.typingManager =
      options?.typingActionManager ??
      (options?.bot ? new TypingActionManager({ bot: options.bot }) : defaultTypingManager);
    this.originTracker = options?.promptOriginTracker ?? defaultOriginTracker;
    this.deliverer = new ThrottledResponseDeliverer({
      minChunkDelayMs: options?.minChunkDelayMs ?? DEFAULT_MIN_CHUNK_DELAY_MS,
      logger: options?.logger
    });
    this.brainDir = options?.brainDir;
    this.activeConvId = options?.activeConvId;
    this.transcriptPath = options?.transcriptPath;
    this.workspaceName = options?.workspaceName;
    this.workspacePath = options?.workspacePath;
    this.isMultiWorkspace = options?.isMultiWorkspace;
    this.registryPath = options?.registryPath;
    this.registryTtlMs = options?.registryTtlMs ?? 5000;
    this.logger = options?.logger;

    if (this.registryPath) {
      this.refreshWorkspaceRegistryAsync().catch(() => {});
    }

    if (options?.tailEngine) {
      this.attachTailEngine(options.tailEngine);
    }
    if (options?.isLeader !== undefined) {
      this._isLeader = options.isLeader;
    }
    if (options?.isLeaderFn) {
      this.isLeaderFn = options.isLeaderFn;
    }
  }

  public setBot(bot: any): void {
    this.bot = bot;
    this.typingManager.setBot(bot);
  }

  public setAllowedUsers(users: (string | number)[]): void {
    this.allowedUsers.clear();
    for (const u of users) {
      this.allowedUsers.add(u);
    }
  }

  public getTypingManager(): TypingActionManager {
    return this.typingManager;
  }

  public getOriginTracker(): PromptOriginTracker {
    return this.originTracker;
  }

  public getDeliverer(): ThrottledResponseDeliverer {
    return this.deliverer;
  }

  public isEnabled(): boolean {
    return this.enableChatMirror;
  }

  public setEnabled(enabled: boolean): void {
    this.enableChatMirror = enabled;
  }

  public getIsLeader(): boolean {
    if (this.isLeaderFn) {
      return Boolean(this.isLeaderFn());
    }
    return this._isLeader;
  }

  public get isLeader(): boolean {
    return this.getIsLeader();
  }

  public set isLeader(val: boolean) {
    this.setLeader(val);
  }

  public setLeader(leader: boolean): void {
    this._isLeader = leader;
    if (!leader) {
      this.typingManager.stopAll();
    }
  }

  public setIsLeaderFn(fn: () => boolean): void {
    this.isLeaderFn = fn;
  }

  public getPrefix(): string {
    return this.prefix;
  }

  public setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  public isMirrorIncludePcPrompts(): boolean {
    return this.mirrorIncludePcPrompts;
  }

  public setMirrorIncludePcPrompts(include: boolean): void {
    this.mirrorIncludePcPrompts = include;
  }

  public setWorkspace(
    workspaceName?: string,
    isMulti?: boolean | (() => boolean),
    workspacePath?: string,
    registryPath?: string
  ): void {
    this.workspaceName = workspaceName;
    if (isMulti !== undefined) {
      this.isMultiWorkspace = isMulti;
    }
    if (workspacePath !== undefined) {
      this.workspacePath = workspacePath;
    }
    if (registryPath !== undefined) {
      this.registryPath = registryPath;
      this.invalidateWorkspaceCache();
      this.refreshWorkspaceRegistryAsync().catch(() => {});
    }
  }

  public invalidateWorkspaceCache(): void {
    this._cachedIsMultiWorkspace = null;
    this._cachedWorkspaceCheckTimestamp = 0;
  }

  public async refreshWorkspaceRegistryAsync(): Promise<boolean> {
    if (!this.registryPath) {
      this._cachedIsMultiWorkspace = false;
      this._cachedWorkspaceCheckTimestamp = Date.now();
      return false;
    }
    try {
      if (!fs.existsSync(this.registryPath)) {
        this._cachedIsMultiWorkspace = false;
        this._cachedWorkspaceCheckTimestamp = Date.now();
        return false;
      }
      const raw = await fs.promises.readFile(this.registryPath, 'utf8');
      if (!raw || !raw.trim()) {
        this._cachedIsMultiWorkspace = false;
        this._cachedWorkspaceCheckTimestamp = Date.now();
        return false;
      }
      const data = JSON.parse(raw);
      const isMulti = !!(data?.ports && Object.keys(data.ports).length > 1);
      this._cachedIsMultiWorkspace = isMulti;
      this._cachedWorkspaceCheckTimestamp = Date.now();
      return isMulti;
    } catch {
      this._cachedIsMultiWorkspace = false;
      this._cachedWorkspaceCheckTimestamp = Date.now();
      return false;
    }
  }

  public isMultiWorkspaceRegistered(): boolean {
    if (typeof this.isMultiWorkspace === 'function') {
      try {
        return this.isMultiWorkspace();
      } catch {
        return false;
      }
    }
    if (typeof this.isMultiWorkspace === 'boolean') {
      return this.isMultiWorkspace;
    }
    try {
      const vscode = require('vscode');
      if (vscode.workspace?.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
        return true;
      }
    } catch {}

    const now = Date.now();
    if (this._cachedIsMultiWorkspace !== null && (now - this._cachedWorkspaceCheckTimestamp < this.registryTtlMs)) {
      return this._cachedIsMultiWorkspace;
    }

    if (this.registryPath) {
      this.refreshWorkspaceRegistryAsync().catch(() => {});
    }

    if (this._cachedIsMultiWorkspace !== null) {
      return this._cachedIsMultiWorkspace;
    }

    return false;
  }

  public getWorkspaceTag(): string {
    if (this.isMultiWorkspaceRegistered() && this.workspaceName) {
      return `[📁 ${this.workspaceName.trim()}]`;
    }
    return '';
  }

  public updateConfig(config: {
    enableChatMirror?: boolean;
    mirrorIncludePcPrompts?: boolean;
    chatMirrorPrefix?: string;
    minChunkDelayMs?: number;
  }): void {
    if (config.enableChatMirror !== undefined) {
      this.enableChatMirror = config.enableChatMirror;
    }
    if (config.mirrorIncludePcPrompts !== undefined) {
      this.mirrorIncludePcPrompts = config.mirrorIncludePcPrompts;
    }
    if (config.chatMirrorPrefix !== undefined) {
      this.prefix = config.chatMirrorPrefix;
    }
    if (config.minChunkDelayMs !== undefined) {
      this.deliverer.setMinChunkDelayMs(config.minChunkDelayMs);
    }
  }

  /**
   * Binds a TranscriptTailEngine instance to chat mirror event handlers.
   */
  public attachTailEngine(engine: TranscriptTailEngine): void {
    if (this.tailEngine === engine) {
      return;
    }
    this.detachTailEngine();
    this.tailEngine = engine;

    const userInputListener = async (e: UserInputEvent) => {
      if (!this.enableChatMirror) {
        try {
          if (typeof this.originTracker.getOrigin === 'function') {
            this.originTracker.getOrigin(e.prompt);
          } else {
            this.originTracker.checkAndConsume(e.prompt);
          }
        } catch {}
        return;
      }
      try {
        await this.handleUserInput(e.prompt);
      } catch (err: any) {
        this.logger?.warn?.(`[ChatMirror] Error handling userInput: ${err?.message || err}`);
      }
    };

    const agentActivityListener = (_e: AgentActivityEvent) => {
      if (!this.enableChatMirror) {
        return;
      }
      try {
        this.handleAgentActivity();
      } catch (err: any) {
        this.logger?.warn?.(`[ChatMirror] Error handling agentActivity: ${err?.message || err}`);
      }
    };

    const plannerResponseListener = async (e: PlannerResponseEvent) => {
      if (!this.enableChatMirror) {
        return;
      }
      try {
        await this.handlePlannerResponse(e.response);
      } catch (err: any) {
        this.logger?.warn?.(`[ChatMirror] Error handling plannerResponse: ${err?.message || err}`);
      }
    };

    engine.on('userInput', userInputListener);
    engine.on('agentActivity', agentActivityListener);
    engine.on('plannerResponse', plannerResponseListener);

    this.boundTailListeners = [
      { event: 'userInput', listener: userInputListener },
      { event: 'agentActivity', listener: agentActivityListener },
      { event: 'plannerResponse', listener: plannerResponseListener }
    ];
  }

  public detachTailEngine(): void {
    if (this.tailEngine && this.boundTailListeners.length > 0) {
      for (const { event, listener } of this.boundTailListeners) {
        this.tailEngine.removeListener(event, listener);
      }
    }
    this.boundTailListeners = [];
    this.tailEngine = null;
  }

  public getTailEngine(): TranscriptTailEngine | null {
    return this.tailEngine;
  }

  /**
   * Starts background continuous monitoring and tailing.
   */
  public async start(): Promise<void> {
    if (!this.tailEngine) {
      const engine = new TranscriptTailEngine({
        brainDir: this.brainDir,
        activeConvId: this.activeConvId,
        transcriptPath: this.transcriptPath,
        workspacePath: this.workspacePath,
        workspaceName: this.workspaceName,
        startFromEnd: true
      });
      this.attachTailEngine(engine);
    }

    if (this.tailEngine && !this.tailEngine.isActive()) {
      await this.tailEngine.start();
    }
  }

  /**
   * Stops background monitoring and cleans up typing timers.
   */
  public stop(): void {
    this.typingManager.stopAll();
    if (this.tailEngine && this.tailEngine.isActive()) {
      this.tailEngine.stop();
    }
  }

  /**
   * Called when agent tools/thinking activities occur: triggers typing action.
   */
  public handleAgentActivity(targetChatId?: string | number): void {
    if (!this.enableChatMirror || !this.bot || !this.getIsLeader()) {
      return;
    }
    try {
      if (targetChatId !== undefined) {
        this.typingManager.startTyping(targetChatId);
      } else {
        for (const chatId of this.allowedUsers) {
          this.typingManager.startTyping(chatId);
        }
      }
    } catch (err: any) {
      this.logger?.warn?.(`[ChatMirror] Error starting typing indicator: ${err?.message || err}`);
    }
  }

  /**
   * Called when PLANNER_RESPONSE arrives: cancels typing and delivers chunked response.
   */
  public async handlePlannerResponse(
    responseText: string,
    targetChatId?: string | number,
    options?: DeliverChunkedResponseOptions
  ): Promise<void> {
    if (!this.enableChatMirror || !this.bot || !this.getIsLeader()) {
      return;
    }

    // Immediately stop typing indicator
    try {
      if (targetChatId !== undefined) {
        this.typingManager.stopTyping(targetChatId);
      } else {
        this.typingManager.stopAll();
      }
    } catch {}

    const targets =
      targetChatId !== undefined ? [targetChatId] : Array.from(this.allowedUsers);

    const tag = this.getWorkspaceTag();
    const effectivePrefix = tag ? `${tag} ${this.prefix}` : this.prefix;

    for (const chatId of targets) {
      try {
        await deliverChunkedResponse(this.bot, chatId, responseText, {
          prefix: effectivePrefix,
          minChunkDelayMs: this.deliverer.getMinChunkDelayMs(),
          deliverer: this.deliverer,
          logger: this.logger,
          ...options
        });
      } catch (err: any) {
        this.logger?.warn?.(`[ChatMirror] Error delivering planner response to ${chatId}: ${err?.message || err}`);
      }
    }
  }

  /**
   * Called when user prompt is detected: checks deduplication origin and forwards:
   * - If 'system_nudge': mirrors with clear system attribution '🤖 [Auto-Plan Nudge]: <text>'
   * - If 'telegram': suppresses mirror (already posted by user in Telegram)
   * - If 'pc' / 'pc_ide': forwards with provenance '💻 You (on PC):\n<text>'
   */
  public async handleUserInput(
    promptText: string,
    targetChatId?: string | number
  ): Promise<{ forwarded: boolean; origin: PromptOrigin; text?: string }> {
    const origin: PromptOrigin =
      typeof (this.originTracker as any).getOrigin === 'function'
        ? (this.originTracker as any).getOrigin(promptText)
        : (this.originTracker.checkAndConsume(promptText).origin as PromptOrigin);

    if (!this.enableChatMirror || !this.bot || !this.getIsLeader()) {
      return { forwarded: false, origin };
    }

    if (origin === 'telegram') {
      // Prompt originated from Telegram, already visible to user in chat -> skip forwarding
      return { forwarded: false, origin: 'telegram' };
    }

    if (origin === 'system_nudge') {
      // Prompt originated from automated system steering nudge -> mirror with clear system attribution
      const targets =
        targetChatId !== undefined ? [targetChatId] : Array.from(this.allowedUsers);

      const tag = this.getWorkspaceTag();
      const baseText = formatNudgePrompt(promptText);
      const textToSend = tag ? `${tag} ${baseText}` : baseText;

      for (const chatId of targets) {
        try {
          if (this.bot?.api?.sendMessage) {
            await this.bot.api.sendMessage(chatId, textToSend);
          } else if (typeof this.bot?.sendMessage === 'function') {
            await this.bot.sendMessage(chatId, textToSend);
          }
        } catch (err: any) {
          this.logger?.warn?.(`[ChatMirror] Error forwarding system nudge to ${chatId}: ${err?.message || err}`);
        }
      }

      return { forwarded: true, origin: 'system_nudge', text: textToSend };
    }

    // Origin is 'pc' or 'pc_ide'
    if (!this.mirrorIncludePcPrompts) {
      return { forwarded: false, origin };
    }

    // Prompt originated from PC IDE keyboard -> forward with clear provenance
    const targets =
      targetChatId !== undefined ? [targetChatId] : Array.from(this.allowedUsers);

    const tag = this.getWorkspaceTag();
    const formatted = formatPcPrompt(promptText);
    const textToSend = tag ? `${tag} ${formatted}` : formatted;

    for (const chatId of targets) {
      try {
        if (this.bot?.api?.sendMessage) {
          await this.bot.api.sendMessage(chatId, textToSend);
        } else if (typeof this.bot?.sendMessage === 'function') {
          await this.bot.sendMessage(chatId, textToSend);
        }
      } catch (err: any) {
        this.logger?.warn?.(`[ChatMirror] Error forwarding PC prompt to ${chatId}: ${err?.message || err}`);
      }
    }

    return { forwarded: true, origin: 'pc_ide', text: textToSend };
  }

  public dispose(): void {
    this.stop();
    this.detachTailEngine();
  }
}
