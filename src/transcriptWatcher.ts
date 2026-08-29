import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { StringDecoder } from 'string_decoder';
import { DEFAULT_CONFIG } from './config';

export interface WatcherOptions {
  brainDir?: string;
  keyword?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  settleQuietPeriodMs?: number;
}

export interface CompletionEventData {
  conversationId: string;
  matchedLine: string;
  matchedContent: string;
  parsed?: any;
  timestamp: number;
}

export interface CompletionResult {
  success: boolean;
  conversationId: string;
  matchedContent?: string;
  matchedLine?: string;
  parsed?: any;
  timestamp?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface TranscriptStep {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  content?: string;
  response?: string;
  text?: string;
  tool_calls?: any[] | null;
  [key: string]: any;
}

export interface ConversationDirEntry {
  name: string;
  fullPath: string;
  time: number;
}

export interface BrainDirCacheEntry {
  rootMtimeMs: number;
  directories: ConversationDirEntry[];
  dirMap: Map<string, { time: number }>;
}

export const MAX_CHUNK_SIZE = 64 * 1024; // 64KB
export const MAX_LINE_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_CACHED_CONVERSATIONS = 100;

// In-Memory Directory Stat Cache Map
const brainDirCacheMap = new Map<string, BrainDirCacheEntry>();

/**
 * Clears the in-memory directory stat cache for a specific brain directory or all directories.
 */
export function clearBrainDirCache(brainDir?: string): void {
  if (brainDir) {
    brainDirCacheMap.delete(brainDir);
  } else {
    brainDirCacheMap.clear();
  }
}

/**
 * Returns the cached directory stat entry for a given brain directory, if available.
 */
export function getBrainDirCache(brainDir: string): BrainDirCacheEntry | undefined {
  return brainDirCacheMap.get(brainDir);
}

/**
 * Returns default Antigravity brain directory path based on environment or user home.
 */
export function getDefaultBrainDir(): string {
  if (process.env.ANTIGRAVITY_BRAIN_DIR) {
    return process.env.ANTIGRAVITY_BRAIN_DIR;
  }
  return path.join(os.homedir(), '.gemini', 'antigravity-ide', 'brain');
}

/**
 * Helper to select the matching conversation from a sorted list of conversation entries.
 */
function selectMatchingConversation(
  directories: ConversationDirEntry[],
  sinceTimestamp?: number,
  excludeConvId?: string
): string | null {
  const filtered = directories.filter(
    (d) => d.name !== 'scratch' && (!excludeConvId || d.name !== excludeConvId)
  );

  if (filtered.length === 0) {
    return null;
  }

  if (sinceTimestamp !== undefined && sinceTimestamp > 0) {
    const matching = filtered.find((d) => d.time >= sinceTimestamp);
    return matching ? matching.name : null;
  }

  return filtered[0].name;
}

/**
 * Finds the latest conversation directory asynchronously using non-blocking I/O,
 * protected by root mtime guard and in-memory directory stat caching.
 */
export async function findLatestConversationAsync(
  brainDir: string,
  sinceTimestamp?: number,
  excludeConvId?: string
): Promise<string | null> {
  try {
    const exists = await fs.promises
      .access(brainDir, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return null;
    }

    const rootStats = await fs.promises.stat(brainDir);
    const rootMtime = rootStats.mtimeMs;
    const cached = brainDirCacheMap.get(brainDir);

    // Root mtime Change Guard: if root mtime hasn't changed and cached directory list has a match, return it
    if (cached && cached.rootMtimeMs === rootMtime) {
      const match = selectMatchingConversation(cached.directories, sinceTimestamp, excludeConvId);
      if (match) {
        return match;
      }
    }

    // Read directory non-blockingly
    const entries = await fs.promises.readdir(brainDir, { withFileTypes: true });
    const dirMap = cached ? cached.dirMap : new Map<string, { time: number }>();
    const newDirMap = new Map<string, { time: number }>();
    let directories: ConversationDirEntry[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'scratch') {
        continue;
      }
      const fullPath = path.join(brainDir, entry.name);
      let time: number;
      if (dirMap.has(entry.name)) {
        time = dirMap.get(entry.name)!.time;
      } else {
        try {
          const stats = await fs.promises.stat(fullPath);
          time = Math.max(stats.birthtimeMs || 0, stats.mtimeMs || 0, stats.ctimeMs || 0);
        } catch {
          continue;
        }
      }
      newDirMap.set(entry.name, { time });
      directories.push({ name: entry.name, fullPath, time });
    }

    // Sort newest first
    directories.sort((a, b) => b.time - a.time);

    // Prune to top MAX_CACHED_CONVERSATIONS entries
    if (directories.length > MAX_CACHED_CONVERSATIONS) {
      directories = directories.slice(0, MAX_CACHED_CONVERSATIONS);
      const retainedNames = new Set(directories.map((d) => d.name));
      for (const key of newDirMap.keys()) {
        if (!retainedNames.has(key)) {
          newDirMap.delete(key);
        }
      }
    }

    brainDirCacheMap.set(brainDir, {
      rootMtimeMs: rootMtime,
      directories,
      dirMap: newDirMap
    });

    return selectMatchingConversation(directories, sinceTimestamp, excludeConvId);
  } catch (err) {
    return null;
  }
}

/**
 * Synchronously finds the latest conversation directory created or modified after sinceTimestamp,
 * explicitly skipping excludeConvId (anti-pollution guard), backed by in-memory directory cache.
 */
export function findLatestConversation(
  brainDir: string,
  sinceTimestamp?: number,
  excludeConvId?: string
): string | null {
  if (!fs.existsSync(brainDir)) {
    return null;
  }

  try {
    const rootStats = fs.statSync(brainDir);
    const rootMtime = rootStats.mtimeMs;
    const cached = brainDirCacheMap.get(brainDir);

    // Root mtime Change Guard
    if (cached && cached.rootMtimeMs === rootMtime) {
      const match = selectMatchingConversation(cached.directories, sinceTimestamp, excludeConvId);
      if (match) {
        return match;
      }
    }

    const entries = fs.readdirSync(brainDir, { withFileTypes: true });
    const dirMap = cached ? cached.dirMap : new Map<string, { time: number }>();
    const newDirMap = new Map<string, { time: number }>();
    let directories: ConversationDirEntry[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'scratch') {
        continue;
      }
      const fullPath = path.join(brainDir, entry.name);
      let time: number;
      if (dirMap.has(entry.name)) {
        time = dirMap.get(entry.name)!.time;
      } else {
        try {
          const stats = fs.statSync(fullPath);
          time = Math.max(stats.birthtimeMs || 0, stats.mtimeMs || 0, stats.ctimeMs || 0);
        } catch {
          continue;
        }
      }
      newDirMap.set(entry.name, { time });
      directories.push({ name: entry.name, fullPath, time });
    }

    directories.sort((a, b) => b.time - a.time);

    // Prune to top MAX_CACHED_CONVERSATIONS entries
    if (directories.length > MAX_CACHED_CONVERSATIONS) {
      directories = directories.slice(0, MAX_CACHED_CONVERSATIONS);
      const retainedNames = new Set(directories.map((d) => d.name));
      for (const key of newDirMap.keys()) {
        if (!retainedNames.has(key)) {
          newDirMap.delete(key);
        }
      }
    }

    brainDirCacheMap.set(brainDir, {
      rootMtimeMs: rootMtime,
      directories,
      dirMap: newDirMap
    });

    return selectMatchingConversation(directories, sinceTimestamp, excludeConvId);
  } catch (err) {
    return null;
  }
}

/**
 * Resolves the transcript log file path for a given conversation directory.
 */
export function getTranscriptPath(conversationDir: string): string | null {
  const possiblePaths = [
    path.join(conversationDir, '.system_generated', 'logs', 'transcript.jsonl'),
    path.join(conversationDir, '.system_generated', 'logs', 'transcript_full.jsonl'),
    path.join(conversationDir, 'transcript.jsonl'),
    path.join(conversationDir, 'transcript_full.jsonl')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Return primary standard location even if not created yet
  return possiblePaths[0];
}

/**
 * Validates whether a transcript step meets the strict completion criteria:
 * 1. source === 'MODEL'
 * 2. type === 'PLANNER_RESPONSE'
 * 3. status === 'DONE'
 * 4. tool_calls is empty / null / undefined (no active tools)
 * 5. content / response includes completion keyword (case-insensitive)
 */
export function isValidCompletionStep(step: any, keyword: string): boolean {
  if (!step || typeof step !== 'object') {
    return false;
  }

  // Strictly require source === 'MODEL' and type === 'PLANNER_RESPONSE'
  // Discard USER_INPUT, USER_EXPLICIT, SYSTEM, CONVERSATION_HISTORY, CHECKPOINT, etc.
  if (step.source !== 'MODEL' || step.type !== 'PLANNER_RESPONSE') {
    return false;
  }

  // Require status === 'DONE'
  if (step.status !== 'DONE') {
    return false;
  }

  // Guard against active tool calls: tool_calls must be null, undefined, or empty []
  if (step.tool_calls !== undefined && step.tool_calls !== null) {
    if (Array.isArray(step.tool_calls) && step.tool_calls.length > 0) {
      return false;
    }
    if (!Array.isArray(step.tool_calls)) {
      return false;
    }
  }

  // Case-insensitive trimmed keyword check
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return false;
  }

  if (typeof step.content === 'string' && step.content.toLowerCase().includes(normalizedKeyword)) {
    return true;
  }
  if (typeof step.response === 'string' && step.response.toLowerCase().includes(normalizedKeyword)) {
    return true;
  }
  if (typeof step.text === 'string' && step.text.toLowerCase().includes(normalizedKeyword)) {
    return true;
  }

  return false;
}

/**
 * Real-time Transcript Watcher Engine with Root mtime Guards, Async Discovery & Concurrency Mutex Locks
 */
export class TranscriptWatcher extends EventEmitter {
  private options: Required<WatcherOptions>;
  private isWatching: boolean = false;
  private activeTimer: NodeJS.Timeout | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private fsWatcher: fs.FSWatcher | null = null;
  private brainFsWatcher: fs.FSWatcher | null = null;
  private readOffset: number = 0;
  private lineBuffer: string = '';
  private stringDecoder: StringDecoder | null = null;
  private currentFilePath: string | null = null;
  private activeConvId: string | null = null;
  private activeResolve: ((res: CompletionResult) => void) | null = null;
  private convPollTimer: NodeJS.Timeout | null = null;
  private convReject: ((err: Error) => void) | null = null;

  // Concurrency Mutex Locks
  private isCheckingConv: boolean = false;
  private isCheckingFile: boolean = false;

  // Dynamic debounce quiet-period state
  private settleTimer: NodeJS.Timeout | null = null;
  private pendingCompletion: {
    eventData: CompletionEventData;
    result: CompletionResult;
    resolve: (res: CompletionResult) => void;
  } | null = null;

  constructor(options?: WatcherOptions) {
    super();
    this.setMaxListeners(50);
    this.options = {
      brainDir: options?.brainDir || getDefaultBrainDir(),
      keyword: options?.keyword || DEFAULT_CONFIG.completionKeyword,
      timeoutMs: options?.timeoutMs || DEFAULT_CONFIG.timeoutPerLoopMinutes * 60 * 1000,
      pollIntervalMs: options?.pollIntervalMs || 300,
      settleQuietPeriodMs: options?.settleQuietPeriodMs ?? 1500
    };
  }

  /**
   * Detaches transient run-time event listeners to prevent listener accumulation.
   */
  public clearRunListeners(): void {
    this.removeAllListeners('completion');
    this.removeAllListeners('onCompletionDetected');
    this.removeAllListeners('conversationDetected');
    this.removeAllListeners('settleStarted');
    this.removeAllListeners('settleCancelled');
    this.removeAllListeners('timeout');
    this.removeAllListeners('error');
  }

  public getOptions(): Required<WatcherOptions> {
    return { ...this.options };
  }

  /**
   * Waits for a new conversation directory to appear after sinceTimestamp asynchronously,
   * with root mtime change guard, active fs.watch on brain directory, and concurrency lock.
   */
  public async waitForNewConversation(
    sinceTimestamp: number,
    excludeConvIdOrTimeout?: string | number,
    timeoutMs: number = 10000,
    pollIntervalMs: number = 300
  ): Promise<string> {
    let excludeConvId: string | undefined;
    let actualTimeoutMs = timeoutMs;
    let actualPollIntervalMs = pollIntervalMs;

    if (typeof excludeConvIdOrTimeout === 'number') {
      actualTimeoutMs = excludeConvIdOrTimeout;
      if (arguments.length > 2 && typeof arguments[2] === 'number') {
        actualPollIntervalMs = arguments[2];
      }
    } else if (typeof excludeConvIdOrTimeout === 'string') {
      excludeConvId = excludeConvIdOrTimeout;
    }

    this.stop();
    this.isWatching = true;
    this.isCheckingConv = false;

    const startTime = Date.now();
    return new Promise<string>((resolve, reject) => {
      this.convReject = reject;

      const check = async () => {
        if (!this.isWatching) {
          reject(new Error('Watcher stopped'));
          return;
        }

        if (this.isCheckingConv) {
          return;
        }
        this.isCheckingConv = true;

        try {
          const conv = await findLatestConversationAsync(
            this.options.brainDir,
            sinceTimestamp,
            excludeConvId
          );

          if (conv) {
            if (this.convPollTimer) {
              clearInterval(this.convPollTimer);
              this.convPollTimer = null;
            }
            if (this.brainFsWatcher) {
              try {
                this.brainFsWatcher.close();
              } catch {}
              this.brainFsWatcher = null;
            }
            this.convReject = null;
            this.emit('conversationDetected', conv, path.join(this.options.brainDir, conv));
            resolve(conv);
            return;
          }

          if (Date.now() - startTime >= actualTimeoutMs) {
            if (this.convPollTimer) {
              clearInterval(this.convPollTimer);
              this.convPollTimer = null;
            }
            if (this.brainFsWatcher) {
              try {
                this.brainFsWatcher.close();
              } catch {}
              this.brainFsWatcher = null;
            }
            this.convReject = null;
            reject(new Error(`Timeout waiting for new conversation after ${actualTimeoutMs}ms`));
            return;
          }
        } catch (err) {
          // Keep waiting until timeout
        } finally {
          this.isCheckingConv = false;
        }
      };

      // Native fs.watch on brain directory for instant detection
      try {
        if (fs.existsSync(this.options.brainDir)) {
          this.brainFsWatcher = fs.watch(this.options.brainDir, (eventType) => {
            if (eventType === 'rename' || eventType === 'change') {
              check();
            }
          });
        }
      } catch (e) {
        // Fallback to polling
      }

      // Fast polling interval backup
      this.convPollTimer = setInterval(check, actualPollIntervalMs);

      // Initial check immediately
      check();
    });
  }

  /**
   * Starts watching a transcript file for the strict completion keyword with non-blocking I/O
   * and concurrency mutex locks to prevent overlapping reads.
   */
  public watchFile(
    filePath: string,
    conversationId: string = 'unknown',
    initialOffset: number = 0
  ): Promise<CompletionResult> {
    this.stop();
    this.isWatching = true;
    this.currentFilePath = filePath;
    this.activeConvId = conversationId;
    this.readOffset = initialOffset >= 0 ? initialOffset : 0;
    this.lineBuffer = '';
    this.stringDecoder = new StringDecoder('utf8');
    this.isCheckingFile = false;

    return new Promise<CompletionResult>((resolve) => {
      this.activeResolve = resolve;

      // Setup timeout
      if (this.options.timeoutMs > 0) {
        this.activeTimer = setTimeout(() => {
          const timeoutErr = new Error(
            `TranscriptWatcher timed out after ${this.options.timeoutMs}ms waiting for keyword "${this.options.keyword}"`
          );
          this.emit('timeout', timeoutErr);
          const savedResolve = this.activeResolve;
          this.activeResolve = null;
          this.stop();
          if (savedResolve) {
            savedResolve({
              success: false,
              conversationId,
              error: timeoutErr.message
            });
          }
        }, this.options.timeoutMs);
      }

      const checkFileAndProcess = async () => {
        if (!this.isWatching) return;
        if (this.isCheckingFile) return;
        this.isCheckingFile = true;

        try {
          if (!this.isWatching) return;
          const exists = await fs.promises
            .access(filePath, fs.constants.F_OK)
            .then(() => true)
            .catch(() => false);
          if (!exists || !this.isWatching) return;

          const stats = await fs.promises.stat(filePath);
          if (!this.isWatching) return;

          if (stats.size > this.readOffset) {
            const fileHandle = await fs.promises.open(filePath, 'r');
            try {
              const chunkBuffer = Buffer.allocUnsafe(MAX_CHUNK_SIZE);
              while (this.isWatching && this.readOffset < stats.size) {
                const bytesToRead = Math.min(stats.size - this.readOffset, MAX_CHUNK_SIZE);
                const { bytesRead } = await fileHandle.read(chunkBuffer, 0, bytesToRead, this.readOffset);
                if (bytesRead === 0) break;
                this.readOffset += bytesRead;

                const chunkStr = this.stringDecoder
                  ? this.stringDecoder.write(chunkBuffer.subarray(0, bytesRead))
                  : chunkBuffer.toString('utf-8', 0, bytesRead);
                this.lineBuffer += chunkStr;

                if (Buffer.byteLength(this.lineBuffer, 'utf8') > MAX_LINE_BUFFER_BYTES) {
                  console.warn(
                    `[TranscriptWatcher] lineBuffer exceeded limit (${MAX_LINE_BUFFER_BYTES} bytes). Truncating stale prefix.`
                  );
                  this.lineBuffer = this.lineBuffer.slice(-Math.floor(MAX_LINE_BUFFER_BYTES / 2));
                }

                // Zero-array index-based line parsing
                let newlineIndex: number;
                while ((newlineIndex = this.lineBuffer.indexOf('\n')) !== -1) {
                  let line = this.lineBuffer.substring(0, newlineIndex);
                  this.lineBuffer = this.lineBuffer.substring(newlineIndex + 1);

                  if (line.endsWith('\r')) {
                    line = line.slice(0, -1);
                  }
                  const trimmed = line.trim();
                  if (!trimmed) continue;

                  this.processLine(trimmed, conversationId, resolve);
                  if (!this.isWatching) {
                    break;
                  }
                }
              }
            } finally {
              await fileHandle.close();
            }
          }
        } catch (err: any) {
          if (this.isWatching && err.code !== 'ENOENT') {
            this.emit('error', err);
          }
        } finally {
          this.isCheckingFile = false;
        }
      };

      // Native fs.watch on directory or file if possible
      try {
        const watchTarget = fs.existsSync(filePath) ? filePath : path.dirname(filePath);
        if (fs.existsSync(watchTarget)) {
          this.fsWatcher = fs.watch(watchTarget, (eventType) => {
            if (eventType === 'change' || eventType === 'rename') {
              checkFileAndProcess();
            }
          });
        }
      } catch (e) {
        // Fallback to polling
      }

      // Fast polling interval backup
      this.pollInterval = setInterval(checkFileAndProcess, this.options.pollIntervalMs);

      // Initial check immediately
      checkFileAndProcess();
    });
  }

  /**
   * Watches the latest conversation transcript, excluding excludeConvId if provided.
   */
  public async watchLatest(sinceTimestamp?: number, excludeConvId?: string): Promise<CompletionResult> {
    const convId = await findLatestConversationAsync(this.options.brainDir, sinceTimestamp, excludeConvId);
    if (!convId) {
      throw new Error(`No conversation found in brain directory: ${this.options.brainDir}`);
    }

    const convDir = path.join(this.options.brainDir, convId);
    const transcriptPath = getTranscriptPath(convDir);
    if (!transcriptPath) {
      throw new Error(`Cannot determine transcript path in ${convDir}`);
    }

    return this.watchFile(transcriptPath, convId);
  }

  /**
   * Process a single line from the transcript.
   * Enforces strict validation and dynamic debounce quiet period.
   */
  private processLine(
    line: string,
    conversationId: string,
    resolve: (res: CompletionResult) => void
  ): void {
    if (line && line.trim()) {
      this.emit('logUpdate', line.trim());
    }

    // If a settle quiet-period is currently active, any new line cancels it immediately!
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
      this.pendingCompletion = null;
      this.emit('settleCancelled', { conversationId, line });
    }

    let isJson = false;
    let parsed: any = null;
    try {
      parsed = JSON.parse(line);
      isJson = true;
    } catch {
      isJson = false;
    }

    if (isJson && parsed && isValidCompletionStep(parsed, this.options.keyword)) {
      const eventData: CompletionEventData = {
        conversationId,
        matchedLine: line,
        matchedContent: parsed.content || parsed.response || parsed.text || line,
        parsed,
        timestamp: Date.now()
      };

      const result: CompletionResult = {
        success: true,
        conversationId,
        matchedContent: eventData.matchedContent,
        matchedLine: line,
        parsed,
        timestamp: eventData.timestamp
      };

      this.pendingCompletion = {
        eventData,
        result,
        resolve
      };

      // Enter dynamic debounce quiet period
      this.emit('settleStarted', {
        conversationId,
        quietPeriodMs: this.options.settleQuietPeriodMs
      });

      this.settleTimer = setTimeout(() => {
        if (!this.isWatching || !this.pendingCompletion) return;

        const { eventData: finalEvent, result: finalRes, resolve: finalResolve } = this.pendingCompletion;
        this.settleTimer = null;
        this.pendingCompletion = null;
        this.activeResolve = null;

        this.emit('onCompletionDetected', finalEvent);
        this.emit('completion', finalEvent);

        this.stop();
        finalResolve(finalRes);
      }, this.options.settleQuietPeriodMs);
    }
  }

  /**
   * Stops watching and clears all timers, buffers, and listeners.
   */
  public stop(): void {
    this.isWatching = false;
    this.isCheckingConv = false;
    this.isCheckingFile = false;

    if (this.convPollTimer) {
      clearInterval(this.convPollTimer);
      this.convPollTimer = null;
    }
    if (this.convReject) {
      this.convReject(new Error('Watcher stopped'));
      this.convReject = null;
    }

    if (this.activeResolve) {
      const resolve = this.activeResolve;
      this.activeResolve = null;
      resolve({
        success: false,
        conversationId: this.activeConvId || 'stopped',
        error: 'Watcher stopped'
      });
    }

    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.pendingCompletion = null;

    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.fsWatcher) {
      try {
        this.fsWatcher.close();
      } catch {}
      this.fsWatcher = null;
    }
    if (this.brainFsWatcher) {
      try {
        this.brainFsWatcher.close();
      } catch {}
      this.brainFsWatcher = null;
    }

    if (this.stringDecoder) {
      try {
        this.stringDecoder.end();
      } catch {}
      this.stringDecoder = null;
    }

    this.lineBuffer = '';
    this.readOffset = 0;
    this.currentFilePath = null;
    this.activeConvId = null;
  }

  /**
   * Alias for cleanup
   */
  public dispose(): void {
    this.stop();
    this.removeAllListeners();
  }
}

export const transcriptWatcher = new TranscriptWatcher();
