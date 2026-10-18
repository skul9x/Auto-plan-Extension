import * as crypto from 'crypto';

export type PromptOrigin = 'pc' | 'telegram' | 'system_nudge' | 'pc_ide';

export const Origin = {
  PC: 'pc' as const,
  TELEGRAM: 'telegram' as const,
  SYSTEM_NUDGE: 'system_nudge' as const,
  PC_IDE: 'pc_ide' as const
} as const;

export const PromptOrigin = Origin;

export interface PromptOriginResult {
  origin: PromptOrigin;
  matched: boolean;
  formattedText?: string;
}

export interface PromptFingerprintEntry {
  hash: string;
  prompt: string;
  timestamp: number;
  origin?: PromptOrigin;
}

export interface PromptOriginTrackerOptions {
  /** Maximum number of entries retained in the ring buffer (default: 100) */
  capacity?: number;
  /** Time to live in milliseconds before entries expire (default: 60000ms = 60s) */
  ttlMs?: number;
  /** Periodic interval in milliseconds to sweep expired entries (default: 15000ms) */
  pruneIntervalMs?: number;
  /** Whether to automatically run periodic pruning (default: true) */
  autoPrune?: boolean;
}

/**
 * Normalizes prompt text by:
 * 1. Normalizing newlines (\r\n and \r to \n)
 * 2. Trimming leading and trailing whitespace per line and overall
 * 3. Collapsing redundant horizontal whitespace per line
 * 4. Lowercasing to eliminate casing discrepancies
 */
export function normalizePromptText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/[ \t]+/g, ' '))
    .join('\n')
    .trim()
    .toLowerCase();
}

/**
 * Generates a SHA-256 canonical hex hash of the normalized prompt string.
 */
export function hashPrompt(text: string): string {
  const normalized = normalizePromptText(text);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Formats a prompt originated from the PC keyboard for mirroring to Telegram.
 */
export function formatPcPrompt(promptText: string): string {
  return `💻 You (on PC):\n${promptText}`;
}

/**
 * Formats a system steering nudge prompt for mirroring to Telegram.
 */
export function formatNudgePrompt(promptText: string): string {
  return `🤖 [Auto-Plan Nudge]: ${promptText}`;
}

/**
 * Deduplication ring buffer and prompt origin tracker.
 * Tracks prompts originating from Telegram with a 60-second TTL to prevent
 * duplicate messages when mirroring Antigravity IDE transcript events back to Telegram.
 */
export class PromptOriginTracker {
  private capacity: number;
  private ttlMs: number;
  private entries: PromptFingerprintEntry[] = [];
  private hashCounts: Map<string, number> = new Map();
  private pruneTimer: NodeJS.Timeout | null = null;

  constructor(options: PromptOriginTrackerOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? 100);
    this.ttlMs = Math.max(1, options.ttlMs ?? 60000);

    if (options.autoPrune !== false) {
      const pruneInterval = Math.max(10, options.pruneIntervalMs ?? 15000);
      this.pruneTimer = setInterval(() => {
        this.pruneExpired();
      }, pruneInterval);
      if (this.pruneTimer.unref) {
        this.pruneTimer.unref();
      }
    }
  }

  /**
   * Registers a prompt dispatched from Telegram into the ring buffer.
   * If capacity is reached, the oldest entry is evicted (FIFO).
   * @param prompt The prompt text sent by the user
   * @param customTimestamp Optional timestamp for deterministic testing
   * @returns Canonical SHA-256 hash of the normalized prompt, or empty string if invalid
   */
  public registerTelegramPrompt(prompt: string, customTimestamp?: number): string {
    if (!prompt || typeof prompt !== 'string') {
      return '';
    }

    const normalized = normalizePromptText(prompt);
    if (!normalized) {
      return '';
    }

    const timestamp = customTimestamp ?? Date.now();
    this.pruneExpired(timestamp);

    const hash = hashPrompt(normalized);

    // Enforce ring buffer capacity with FIFO eviction
    while (this.entries.length >= this.capacity) {
      this.evictOldest();
    }

    const entry: PromptFingerprintEntry = {
      hash,
      prompt,
      timestamp,
      origin: 'telegram'
    };

    this.entries.push(entry);
    this.hashCounts.set(hash, (this.hashCounts.get(hash) || 0) + 1);

    return hash;
  }

  /**
   * Registers a mid-flight steering nudge prompt into the ring buffer with 60-second TTL
   * and origin 'system_nudge' to prevent duplicate mirroring and false PC attribution.
   * @param prompt The steering prompt text
   * @param customTimestamp Optional timestamp for deterministic testing
   * @returns Canonical SHA-256 hash of the normalized prompt, or empty string if invalid
   */
  public trackNudgePrompt(prompt: string, customTimestamp?: number): string {
    if (!prompt || typeof prompt !== 'string') {
      return '';
    }

    const normalized = normalizePromptText(prompt);
    if (!normalized) {
      return '';
    }

    const timestamp = customTimestamp ?? Date.now();
    this.pruneExpired(timestamp);

    const hash = hashPrompt(normalized);

    // Enforce ring buffer capacity with FIFO eviction
    while (this.entries.length >= this.capacity) {
      this.evictOldest();
    }

    const entry: PromptFingerprintEntry = {
      hash,
      prompt,
      timestamp,
      origin: 'system_nudge'
    };

    this.entries.push(entry);
    this.hashCounts.set(hash, (this.hashCounts.get(hash) || 0) + 1);

    return hash;
  }

  /**
   * Resolves origin for a prompt extracted from transcript and consumes matching entry.
   * - If registered via trackNudgePrompt: returns 'system_nudge'
   * - If registered via registerTelegramPrompt: returns 'telegram'
   * - If not matched / expired: returns 'pc'
   */
  public getOrigin(
    prompt: string,
    currentTime: number = Date.now()
  ): PromptOrigin {
    if (!prompt || typeof prompt !== 'string') {
      return 'pc';
    }

    this.pruneExpired(currentTime);

    const hash = hashPrompt(prompt);
    const count = this.hashCounts.get(hash) || 0;

    if (count > 0) {
      const matchIndex = this.entries.findIndex((e) => e.hash === hash);
      if (matchIndex !== -1) {
        const entry = this.entries[matchIndex];
        this.entries.splice(matchIndex, 1);
        if (count <= 1) {
          this.hashCounts.delete(hash);
        } else {
          this.hashCounts.set(hash, count - 1);
        }

        return entry.origin || 'telegram';
      }
    }

    return 'pc';
  }

  /**
   * Inspects origin status without consuming the entry.
   */
  public peekOrigin(
    prompt: string,
    currentTime: number = Date.now()
  ): PromptOrigin {
    if (!prompt || typeof prompt !== 'string') {
      return 'pc';
    }

    this.pruneExpired(currentTime);

    const hash = hashPrompt(prompt);
    const entry = this.entries.find((e) => e.hash === hash);
    if (entry) {
      return entry.origin || 'telegram';
    }

    return 'pc';
  }

  /**
   * Checks whether a prompt originated from Telegram or system nudge and consumes the matching entry.
   * If matched: marks origin accordingly ('telegram' or 'system_nudge'), decrements counter, consumes the entry.
   * If not matched: marks origin as 'pc_ide', formats message with PC header.
   * @param prompt The prompt text extracted from transcript
   * @param currentTime Optional reference timestamp for testing
   */
  public checkAndConsume(
    prompt: string,
    currentTime: number = Date.now()
  ): PromptOriginResult {
    if (!prompt || typeof prompt !== 'string') {
      return {
        origin: 'pc_ide',
        matched: false,
        formattedText: formatPcPrompt(prompt || '')
      };
    }

    this.pruneExpired(currentTime);

    const hash = hashPrompt(prompt);
    const count = this.hashCounts.get(hash) || 0;

    if (count > 0) {
      // Find and consume the oldest matching entry
      const matchIndex = this.entries.findIndex((e) => e.hash === hash);
      if (matchIndex !== -1) {
        const entry = this.entries[matchIndex];
        this.entries.splice(matchIndex, 1);
        if (count <= 1) {
          this.hashCounts.delete(hash);
        } else {
          this.hashCounts.set(hash, count - 1);
        }

        const origin = entry.origin || 'telegram';
        return {
          origin,
          matched: true,
          formattedText: origin === 'system_nudge' ? formatNudgePrompt(prompt) : undefined
        };
      }
    }

    return {
      origin: 'pc_ide',
      matched: false,
      formattedText: formatPcPrompt(prompt)
    };
  }

  /**
   * Inspects origin status without consuming the entry.
   */
  public peek(
    prompt: string,
    currentTime: number = Date.now()
  ): PromptOriginResult {
    if (!prompt || typeof prompt !== 'string') {
      return {
        origin: 'pc_ide',
        matched: false,
        formattedText: formatPcPrompt(prompt || '')
      };
    }

    this.pruneExpired(currentTime);

    const hash = hashPrompt(prompt);
    const count = this.hashCounts.get(hash) || 0;

    if (count > 0) {
      const entry = this.entries.find((e) => e.hash === hash);
      const origin = entry?.origin || 'telegram';
      return {
        origin,
        matched: true,
        formattedText: origin === 'system_nudge' ? formatNudgePrompt(prompt) : undefined
      };
    }

    return {
      origin: 'pc_ide',
      matched: false,
      formattedText: formatPcPrompt(prompt)
    };
  }

  /**
   * Returns the count of active pending registered entries matching the prompt.
   */
  public getPendingCount(
    prompt: string,
    currentTime: number = Date.now()
  ): number {
    if (!prompt || typeof prompt !== 'string') {
      return 0;
    }

    this.pruneExpired(currentTime);
    const hash = hashPrompt(prompt);
    return this.hashCounts.get(hash) || 0;
  }

  /**
   * Prunes all entries whose age exceeds the TTL.
   * @param now Current timestamp
   * @returns Number of pruned entries
   */
  public pruneExpired(now: number = Date.now()): number {
    const initialCount = this.entries.length;
    if (initialCount === 0) {
      return 0;
    }

    const surviving: PromptFingerprintEntry[] = [];
    this.hashCounts.clear();

    for (const entry of this.entries) {
      if (now - entry.timestamp <= this.ttlMs) {
        surviving.push(entry);
        this.hashCounts.set(entry.hash, (this.hashCounts.get(entry.hash) || 0) + 1);
      }
    }

    this.entries = surviving;
    return initialCount - surviving.length;
  }

  /**
   * Evicts the oldest entry in the buffer (FIFO).
   */
  private evictOldest(): PromptFingerprintEntry | undefined {
    const oldest = this.entries.shift();
    if (oldest) {
      const count = this.hashCounts.get(oldest.hash) || 0;
      if (count <= 1) {
        this.hashCounts.delete(oldest.hash);
      } else {
        this.hashCounts.set(oldest.hash, count - 1);
      }
    }
    return oldest;
  }

  /**
   * Returns current count of entries in the ring buffer.
   */
  public size(): number {
    return this.entries.length;
  }

  /**
   * Returns configured buffer capacity limit.
   */
  public getCapacity(): number {
    return this.capacity;
  }

  /**
   * Returns configured TTL in milliseconds.
   */
  public getTtlMs(): number {
    return this.ttlMs;
  }

  /**
   * Clears all buffer entries.
   */
  public clear(): void {
    this.entries = [];
    this.hashCounts.clear();
  }

  /**
   * Releases background timers and clears buffer.
   */
  public dispose(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.clear();
  }
}

/**
 * Singleton default instance for the extension.
 */
export const promptOriginTracker = new PromptOriginTracker();

/**
 * Convenience helper to register a Telegram prompt on the default singleton tracker.
 */
export function registerTelegramPrompt(prompt: string): string {
  return promptOriginTracker.registerTelegramPrompt(prompt);
}

/**
 * Convenience helper to register a system steering nudge prompt on the default singleton tracker.
 */
export function trackNudgePrompt(prompt: string): void {
  promptOriginTracker.trackNudgePrompt(prompt);
}

/**
 * Convenience helper to resolve and consume prompt origin on the default singleton tracker.
 */
export function getOrigin(prompt: string): PromptOrigin {
  return promptOriginTracker.getOrigin(prompt);
}

/**
 * Convenience helper to check and consume prompt origin on the default singleton tracker.
 */
export function checkAndConsume(prompt: string): PromptOriginResult {
  return promptOriginTracker.checkAndConsume(prompt);
}
