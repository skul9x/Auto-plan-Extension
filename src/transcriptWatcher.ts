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
  relaxedPollIntervalMs?: number;
  settleQuietPeriodMs?: number;
  arbitrationTimeoutMs?: number;
  sinceTimestamp?: number;
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

export interface CandidateConversation {
  convId: string;
  fullPath: string;
  time: number;
  transcriptPath: string | null;
  transcriptMtime: number;
  transcriptSize: number;
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
 * Asynchronously retrieves and evaluates all candidate conversations in brainDir matching sinceTimestamp,
 * sorted by:
 * 1. Most recent transcript modification time (transcriptMtime)
 * 2. Active transcript file size growth (transcriptSize)
 * 3. Directory creation/modification time (newest first)
 */
export async function getCandidateConversationsAsync(
  brainDir: string,
  sinceTimestamp?: number,
  excludeConvId?: string
): Promise<CandidateConversation[]> {
  try {
    const exists = await fs.promises
      .access(brainDir, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return [];
    }

    const entries = await fs.promises.readdir(brainDir, { withFileTypes: true });
    const candidates: CandidateConversation[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'scratch') {
        continue;
      }
      if (excludeConvId && entry.name === excludeConvId) {
        continue;
      }

      const fullPath = path.join(brainDir, entry.name);
      let dirTime = 0;
      try {
        const stats = await fs.promises.stat(fullPath);
        dirTime = Math.max(stats.birthtimeMs || 0, stats.mtimeMs || 0, stats.ctimeMs || 0);
      } catch {
        continue;
      }

      if (sinceTimestamp !== undefined && sinceTimestamp > 0 && dirTime < sinceTimestamp) {
        continue;
      }

      const transcriptPath = getTranscriptPath(fullPath);
      let transcriptMtime = 0;
      let transcriptSize = 0;

      if (transcriptPath) {
        try {
          const tStats = await fs.promises.stat(transcriptPath);
          transcriptMtime = tStats.mtimeMs;
          transcriptSize = tStats.size;
        } catch {
          // File might not exist yet
        }
      }

      candidates.push({
        convId: entry.name,
        fullPath,
        time: dirTime,
        transcriptPath,
        transcriptMtime,
        transcriptSize
      });
    }

    // Sort candidates:
    // 1. Most recent transcript modification time (if > 0)
    // 2. Active file size growth (larger size)
    // 3. Directory creation/modification time (newest first)
    candidates.sort((a, b) => {
      if (a.transcriptMtime !== b.transcriptMtime) {
        return b.transcriptMtime - a.transcriptMtime;
      }
      if (a.transcriptSize !== b.transcriptSize) {
        return b.transcriptSize - a.transcriptSize;
      }
      return b.time - a.time;
    });

    return candidates;
  } catch {
    return [];
  }
}

/**
 * Finds the latest conversation directory asynchronously using non-blocking I/O,
 * evaluating multi-candidate activities and backed by in-memory directory cache.
 */
export async function findLatestConversationAsync(
  brainDir: string,
  sinceTimestamp?: number,
  excludeConvId?: string
): Promise<string | null> {
  try {
    const candidates = await getCandidateConversationsAsync(brainDir, sinceTimestamp, excludeConvId);
    if (candidates.length > 0) {
      return candidates[0].convId;
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Synchronously finds the latest conversation directory created or modified after sinceTimestamp,
 * explicitly evaluating active candidates and skipping excludeConvId.
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
    const entries = fs.readdirSync(brainDir, { withFileTypes: true });
    const candidates: CandidateConversation[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'scratch') {
        continue;
      }
      if (excludeConvId && entry.name === excludeConvId) {
        continue;
      }

      const fullPath = path.join(brainDir, entry.name);
      let dirTime = 0;
      try {
        const stats = fs.statSync(fullPath);
        dirTime = Math.max(stats.birthtimeMs || 0, stats.mtimeMs || 0, stats.ctimeMs || 0);
      } catch {
        continue;
      }

      if (sinceTimestamp !== undefined && sinceTimestamp > 0 && dirTime < sinceTimestamp) {
        continue;
      }

      const transcriptPath = getTranscriptPath(fullPath);
      let transcriptMtime = 0;
      let transcriptSize = 0;

      if (transcriptPath && fs.existsSync(transcriptPath)) {
        try {
          const tStats = fs.statSync(transcriptPath);
          transcriptMtime = tStats.mtimeMs;
          transcriptSize = tStats.size;
        } catch {}
      }

      candidates.push({
        convId: entry.name,
        fullPath,
        time: dirTime,
        transcriptPath,
        transcriptMtime,
        transcriptSize
      });
    }

    candidates.sort((a, b) => {
      if (a.transcriptMtime !== b.transcriptMtime) {
        return b.transcriptMtime - a.transcriptMtime;
      }
      if (a.transcriptSize !== b.transcriptSize) {
        return b.transcriptSize - a.transcriptSize;
      }
      return b.time - a.time;
    });

    return candidates.length > 0 ? candidates[0].convId : null;
  } catch (err) {
    return null;
  }
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
 * Real-time Transcript Watcher Engine with Multi-Conversation Discovery & Dynamic Stream Arbitration
 */
export class TranscriptWatcher extends EventEmitter {
  private options: Required<WatcherOptions>;
  private isWatching: boolean = false;
  public activePollIntervalMs: number = 300;
  private sinceTimestamp: number = 0;
  private lastActivityTime: number = Date.now();
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
  private isArbitrating: boolean = false;

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
      relaxedPollIntervalMs: options?.relaxedPollIntervalMs || 1200,
      settleQuietPeriodMs: options?.settleQuietPeriodMs ?? 1500,
      arbitrationTimeoutMs: options?.arbitrationTimeoutMs ?? 3000,
      sinceTimestamp: options?.sinceTimestamp ?? 0
    };
    this.sinceTimestamp = this.options.sinceTimestamp;
    this.activePollIntervalMs = this.options.pollIntervalMs;
  }

  public getActivePollIntervalMs(): number {
    return this.activePollIntervalMs;
  }

  public getSinceTimestamp(): number {
    return this.sinceTimestamp;
  }

  /**
   * Detaches transient run-time event listeners to prevent listener accumulation.
   */
  public clearRunListeners(): void {
    this.removeAllListeners('completion');
    this.removeAllListeners('onCompletionDetected');
    this.removeAllListeners('conversationDetected');
    this.removeAllListeners('conversationRebound');
    this.removeAllListeners('settleStarted');
    this.removeAllListeners('settleCancelled');
    this.removeAllListeners('timeout');
    this.removeAllListeners('error');
    this.removeAllListeners('logUpdate');
  }

  public getOptions(): Required<WatcherOptions> {
    return { ...this.options };
  }

  /**
   * Waits for a new conversation directory to appear after sinceTimestamp asynchronously,
   * evaluating all matching candidates and picking the most active.
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
    this.sinceTimestamp = sinceTimestamp;

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
          const candidates = await getCandidateConversationsAsync(
            this.options.brainDir,
            sinceTimestamp,
            excludeConvId
          );

          if (candidates.length > 0) {
            const best = candidates[0];
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
            this.emit('conversationDetected', best.convId, best.fullPath);
            resolve(best.convId);
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
      let brainWatcherSuccess = false;
      try {
        if (fs.existsSync(this.options.brainDir)) {
          this.brainFsWatcher = fs.watch(this.options.brainDir, (eventType) => {
            if (eventType === 'rename' || eventType === 'change') {
              check();
            }
          });
          this.brainFsWatcher.on('error', () => {
            this.activePollIntervalMs = this.options.pollIntervalMs;
            if (this.convPollTimer) {
              clearInterval(this.convPollTimer);
              this.convPollTimer = setInterval(check, this.activePollIntervalMs);
            }
          });
          brainWatcherSuccess = true;
        }
      } catch (e) {
        brainWatcherSuccess = false;
      }

      // Adaptive polling interval backup (relaxed when fsWatcher is active)
      this.activePollIntervalMs = brainWatcherSuccess
        ? (this.options.relaxedPollIntervalMs || 1200)
        : (actualPollIntervalMs || this.options.pollIntervalMs);

      this.convPollTimer = setInterval(check, this.activePollIntervalMs);

      // Initial check immediately
      check();
    });
  }

  /**
   * Starts watching a transcript file for the strict completion keyword with non-blocking I/O,
   * active stream activity monitoring, and dynamic arbitration across sibling conversations.
   */
  public watchFile(
    filePath: string,
    conversationId: string = 'unknown',
    initialOffset: number = 0,
    sinceTimestamp?: number
  ): Promise<CompletionResult> {
    this.stop();
    this.isWatching = true;
    this.currentFilePath = filePath;
    this.activeConvId = conversationId;
    this.readOffset = initialOffset >= 0 ? initialOffset : 0;
    this.lineBuffer = '';
    this.stringDecoder = new StringDecoder('utf8');
    this.isCheckingFile = false;
    this.isArbitrating = false;
    this.lastActivityTime = Date.now();

    if (sinceTimestamp !== undefined && sinceTimestamp > 0) {
      this.sinceTimestamp = sinceTimestamp;
    } else if (this.sinceTimestamp <= 0) {
      try {
        const stats = fs.statSync(filePath);
        this.sinceTimestamp = Math.max(stats.birthtimeMs || 0, stats.ctimeMs || 0, Date.now() - 60000);
      } catch {
        this.sinceTimestamp = this.options.sinceTimestamp || (Date.now() - 60000);
      }
    }

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
              conversationId: this.activeConvId || conversationId,
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
          const targetFile = this.currentFilePath;
          if (!targetFile) return;

          const exists = await fs.promises
            .access(targetFile, fs.constants.F_OK)
            .then(() => true)
            .catch(() => false);

          if (exists && this.isWatching) {
            const stats = await fs.promises.stat(targetFile);
            if (this.isWatching && stats.size > this.readOffset) {
              const fileHandle = await fs.promises.open(targetFile, 'r');
              try {
                const chunkBuffer = Buffer.allocUnsafe(MAX_CHUNK_SIZE);
                let hadLines = false;
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

                    hadLines = true;
                    this.lastActivityTime = Date.now();
                    this.processLine(trimmed, this.activeConvId || conversationId, resolve);
                    if (!this.isWatching) {
                      break;
                    }
                  }
                }
                if (hadLines) {
                  this.lastActivityTime = Date.now();
                }
              } finally {
                await fileHandle.close();
              }
            }
          }

          // Active Transcript Arbitration Check:
          // If no new lines for >= arbitrationTimeoutMs, look for active sibling candidate streams
          if (
            this.isWatching &&
            !this.isArbitrating &&
            Date.now() - this.lastActivityTime >= this.options.arbitrationTimeoutMs
          ) {
            await this.performArbitrationCheck(checkFileAndProcess);
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
      let watcherSuccess = false;
      try {
        const watchTarget = fs.existsSync(filePath) ? filePath : path.dirname(filePath);
        if (fs.existsSync(watchTarget)) {
          this.fsWatcher = fs.watch(watchTarget, (eventType) => {
            if (eventType === 'change' || eventType === 'rename') {
              checkFileAndProcess();
            }
          });
          this.fsWatcher.on('error', () => {
            this.activePollIntervalMs = this.options.pollIntervalMs;
            if (this.pollInterval) {
              clearInterval(this.pollInterval);
              this.pollInterval = setInterval(checkFileAndProcess, this.activePollIntervalMs);
            }
          });
          watcherSuccess = true;
        }
      } catch (e) {
        watcherSuccess = false;
      }

      // Adaptive polling interval backup (relaxed when fsWatcher is active)
      this.activePollIntervalMs = watcherSuccess
        ? (this.options.relaxedPollIntervalMs || 1200)
        : this.options.pollIntervalMs;

      this.pollInterval = setInterval(checkFileAndProcess, this.activePollIntervalMs);

      // Initial check immediately
      checkFileAndProcess();
    });
  }

  /**
   * Performs dynamic conversation stream arbitration when the current stream is stalled.
   * Discovers sibling candidates in brainDir created >= sinceTimestamp, and rebinds if an active stream is found.
   */
  private async performArbitrationCheck(checkFileAndProcess: () => Promise<void>): Promise<void> {
    if (this.isArbitrating || !this.isWatching) return;
    this.isArbitrating = true;

    try {
      let brainDir = this.options.brainDir;
      if (this.currentFilePath && (!brainDir || !fs.existsSync(brainDir))) {
        const normalized = path.normalize(this.currentFilePath);
        const parts = normalized.split(path.sep);
        const brainIdx = parts.lastIndexOf('brain');
        if (brainIdx !== -1) {
          brainDir = parts.slice(0, brainIdx + 1).join(path.sep);
        } else {
          brainDir = path.dirname(path.dirname(normalized));
        }
      }

      const candidates = await getCandidateConversationsAsync(
        brainDir,
        this.sinceTimestamp > 0 ? this.sinceTimestamp : undefined,
        this.activeConvId || undefined
      );

      // Look for candidates that are active (transcriptSize > 0 or transcriptMtime >= lastActivityTime)
      const activeCandidates = candidates.filter(
        (c) =>
          c.convId !== this.activeConvId &&
          c.transcriptPath &&
          (c.transcriptSize > 0 || c.transcriptMtime >= this.lastActivityTime)
      );

      if (activeCandidates.length > 0) {
        const best = activeCandidates[0];
        if (best.transcriptPath && best.transcriptPath !== this.currentFilePath) {
          const oldConvId = this.activeConvId || 'unknown';
          const newConvId = best.convId;
          const newFilePath = best.transcriptPath;

          // Re-bind to the active stream!
          if (this.fsWatcher) {
            try {
              this.fsWatcher.close();
            } catch {}
            this.fsWatcher = null;
          }

          this.activeConvId = newConvId;
          this.currentFilePath = newFilePath;
          this.readOffset = 0;
          this.lineBuffer = '';
          this.stringDecoder = new StringDecoder('utf8');
          this.lastActivityTime = Date.now();

          this.emit('conversationRebound', oldConvId, newConvId, newFilePath);

          // Attach fs.watch to new file/dir
          try {
            const watchTarget = fs.existsSync(newFilePath) ? newFilePath : path.dirname(newFilePath);
            if (fs.existsSync(watchTarget)) {
              this.fsWatcher = fs.watch(watchTarget, (eventType) => {
                if (eventType === 'change' || eventType === 'rename') {
                  checkFileAndProcess();
                }
              });
              this.fsWatcher.on('error', () => {
                this.activePollIntervalMs = this.options.pollIntervalMs;
              });
            }
          } catch {}

          // Immediately process new file
          setImmediate(() => {
            if (this.isWatching) {
              checkFileAndProcess();
            }
          });
        }
      }
    } catch {
      // Ignore arbitration errors and retry on next interval
    } finally {
      this.isArbitrating = false;
    }
  }

  /**
   * Watches the latest conversation transcript, evaluating candidates and excluding excludeConvId if provided.
   */
  public async watchLatest(sinceTimestamp?: number, excludeConvId?: string): Promise<CompletionResult> {
    const candidates = await getCandidateConversationsAsync(this.options.brainDir, sinceTimestamp, excludeConvId);
    let convId: string | null = null;
    let transcriptPath: string | null = null;

    if (candidates.length > 0) {
      convId = candidates[0].convId;
      transcriptPath = candidates[0].transcriptPath || getTranscriptPath(candidates[0].fullPath);
    } else {
      convId = await findLatestConversationAsync(this.options.brainDir, sinceTimestamp, excludeConvId);
      if (convId) {
        transcriptPath = getTranscriptPath(path.join(this.options.brainDir, convId));
      }
    }

    if (!convId || !transcriptPath) {
      throw new Error(`No conversation found in brain directory: ${this.options.brainDir}`);
    }

    return this.watchFile(transcriptPath, convId, 0, sinceTimestamp);
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
    this.isArbitrating = false;
    this.activePollIntervalMs = this.options.pollIntervalMs;

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
