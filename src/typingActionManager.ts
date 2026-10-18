/**
 * Typing Action Manager for Telegram Live Q&A Mirror.
 *
 * Periodically sends Telegram `sendChatAction(chatId, 'typing')` indicators
 * every 4000ms while agent tools or thinking steps are in progress.
 * Automatically cancels typing intervals immediately upon completion (PLANNER_RESPONSE)
 * or upon encountering errors.
 */

export const DEFAULT_TYPING_INTERVAL_MS = 4000;

export interface TypingSessionStats {
  startTime: number;
  callCount: number;
  lastCallTime: number;
}

export interface TypingActionManagerOptions {
  bot?: any;
  intervalMs?: number;
  logger?: any;
  onSendError?: (chatId: string | number, err: any) => void;
}

export class TypingActionManager {
  private bot: any;
  private intervalMs: number;
  private logger?: any;
  private onSendError?: (chatId: string | number, err: any) => void;

  private activeTimers: Map<string | number, NodeJS.Timeout> = new Map();
  private activeStats: Map<string | number, TypingSessionStats> = new Map();

  constructor(options?: TypingActionManagerOptions | any) {
    if (options && typeof options.sendChatAction === 'function') {
      this.bot = options;
      this.intervalMs = DEFAULT_TYPING_INTERVAL_MS;
    } else if (options && typeof options === 'object') {
      this.bot = options.bot;
      this.intervalMs = options.intervalMs ?? DEFAULT_TYPING_INTERVAL_MS;
      this.logger = options.logger;
      this.onSendError = options.onSendError;
    } else {
      this.intervalMs = DEFAULT_TYPING_INTERVAL_MS;
    }
  }

  public setBot(bot: any): void {
    this.bot = bot;
  }

  public setIntervalMs(ms: number): void {
    this.intervalMs = Math.max(100, ms);
  }

  public getIntervalMs(): number {
    return this.intervalMs;
  }

  /**
   * Checks whether a typing indicator is currently active for the given chat ID.
   */
  public isTyping(chatId: string | number): boolean {
    return this.activeTimers.has(chatId);
  }

  /**
   * Returns all chat IDs with an active typing indicator.
   */
  public getActiveChatIds(): (string | number)[] {
    return Array.from(this.activeTimers.keys());
  }

  /**
   * Returns count of active typing sessions.
   */
  public getActiveCount(): number {
    return this.activeTimers.size;
  }

  /**
   * Returns usage statistics for a specific chat ID.
   */
  public getStats(chatId: string | number): TypingSessionStats | undefined {
    return this.activeStats.get(chatId);
  }

  /**
   * Starts periodic typing indicators for a target chatId.
   * If a timer is already running for this chatId, does not spawn redundant timers.
   */
  public startTyping(chatId: string | number): void {
    if (this.activeTimers.has(chatId)) {
      return;
    }

    this.activeStats.set(chatId, {
      startTime: Date.now(),
      callCount: 0,
      lastCallTime: 0
    });

    // Invoke immediately upon agent activation
    this.sendAction(chatId);

    // Schedule recurring pulses
    const timer = setInterval(() => {
      this.sendAction(chatId);
    }, this.intervalMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    this.activeTimers.set(chatId, timer);
  }

  /**
   * Convenience hook triggered by agent activity events.
   */
  public onAgentActivity(chatId: string | number): void {
    this.startTyping(chatId);
  }

  /**
   * Starts typing for multiple authorized chat IDs.
   */
  public startTypingForMultiple(chatIds: (string | number)[]): void {
    for (const id of chatIds) {
      this.startTyping(id);
    }
  }

  /**
   * Stops the typing indicator for a specific chatId immediately.
   */
  public stopTyping(chatId: string | number): void {
    const timer = this.activeTimers.get(chatId);
    if (timer) {
      clearInterval(timer);
      this.activeTimers.delete(chatId);
      this.activeStats.delete(chatId);
    }
  }

  /**
   * Stops typing indicators for all active chat IDs.
   */
  public stopAll(): void {
    for (const timer of this.activeTimers.values()) {
      clearInterval(timer);
    }
    this.activeTimers.clear();
    this.activeStats.clear();
  }

  /**
   * Lifecycle hook called when PLANNER_RESPONSE arrives.
   * Cancels typing indicators immediately.
   */
  public onPlannerResponse(chatId?: string | number): void {
    if (chatId !== undefined) {
      this.stopTyping(chatId);
    } else {
      this.stopAll();
    }
  }

  /**
   * Lifecycle hook called when an error occurs during execution.
   * Cancels typing indicators immediately.
   */
  public onError(chatId?: string | number): void {
    if (chatId !== undefined) {
      this.stopTyping(chatId);
    } else {
      this.stopAll();
    }
  }

  /**
   * Cleans up all resources and timers.
   */
  public dispose(): void {
    this.stopAll();
  }

  private async sendAction(chatId: string | number): Promise<void> {
    if (!this.bot) {
      return;
    }

    try {
      const stats = this.activeStats.get(chatId);
      if (stats) {
        stats.callCount++;
        stats.lastCallTime = Date.now();
      }

      if (this.bot.api && typeof this.bot.api.sendChatAction === 'function') {
        await this.bot.api.sendChatAction(chatId, 'typing');
      } else if (typeof this.bot.sendChatAction === 'function') {
        await this.bot.sendChatAction(chatId, 'typing');
      }
    } catch (err: any) {
      this.logger?.warn?.(`Typing action failed for chatId ${chatId}: ${err?.message || err}`);
      if (this.onSendError) {
        this.onSendError(chatId, err);
      }

      // Check if the chat is permanently unreachable to avoid useless timer leaks
      const desc = String(err?.description || err?.message || '').toLowerCase();
      if (
        desc.includes('chat not found') ||
        desc.includes('bot was blocked') ||
        desc.includes('user is deactivated') ||
        desc.includes('forbidden')
      ) {
        this.stopTyping(chatId);
      }
    }
  }
}

export const typingActionManager = new TypingActionManager();
