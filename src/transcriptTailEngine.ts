import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { EventEmitter } from 'events';
import { getDefaultBrainDir } from './transcriptWatcher';

export interface UserInputEvent {
  convId: string;
  prompt: string;
  stepIndex: number;
  timestamp: number;
}

export interface PlannerResponseEvent {
  convId: string;
  response: string;
  stepIndex: number;
  timestamp: number;
}

export interface AgentActivityEvent {
  convId: string;
  activity: string;
  stepIndex: number;
}

export interface ConversationChangedEvent {
  oldConvId: string;
  newConvId: string;
}

export interface TranscriptTailEngineOptions {
  brainDir?: string;
  activeConvId?: string;
  transcriptPath?: string;
  pollIntervalMs?: number;
  readOffset?: number;
  startFromEnd?: boolean;
  discoveryThrottleMs?: number;
  maxDiscoveryCandidates?: number;
}

export interface TranscriptStep {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  content?: string;
  response?: string;
  text?: string;
  prompt?: string;
  tool_calls?: any[] | null;
  activity?: string;
  timestamp?: number;
  [key: string]: any;
}

/**
 * Extracts clean user prompt text from raw content, stripping <USER_REQUEST> tags,
 * conversation history summaries, and XML/metadata wrappers.
 */
export function extractUserPrompt(rawContent: string): string {
  if (!rawContent || typeof rawContent !== 'string') {
    return '';
  }

  // Fast-path: if rawContent contains no XML tag delimiters ('<'), return rawContent.trim() immediately
  if (!rawContent.includes('<')) {
    return rawContent.trim();
  }

  // Locate the last <USER_REQUEST>...</USER_REQUEST> block directly
  const openTagUpper = '<USER_REQUEST>';
  let lastOpenIdx = rawContent.lastIndexOf(openTagUpper);
  let openTagLen = openTagUpper.length;

  if (lastOpenIdx === -1) {
    const openTagLower = '<user_request>';
    lastOpenIdx = rawContent.toLowerCase().lastIndexOf(openTagLower);
    openTagLen = openTagLower.length;
  }

  if (lastOpenIdx !== -1) {
    const afterOpen = lastOpenIdx + openTagLen;
    const closeTagUpper = '</USER_REQUEST>';
    let closeIdx = rawContent.indexOf(closeTagUpper, afterOpen);
    if (closeIdx === -1) {
      closeIdx = rawContent.toLowerCase().indexOf('</user_request>', afterOpen);
    }

    let extracted = closeIdx !== -1 ? rawContent.substring(afterOpen, closeIdx) : rawContent.substring(afterOpen);

    // Strip internal/nested metadata blocks solely on the isolated snippet
    if (extracted.includes('<')) {
      extracted = extracted
        .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
        .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '')
        .replace(/<system(?:_information)?>[\s\S]*?<\/system(?:_information)?>/gi, '')
        .replace(/<conversation_summaries>[\s\S]*?<\/conversation_summaries>/gi, '');
    }

    return extracted.trim();
  }

  // If no <USER_REQUEST> tags are present, strip known wrappers from outer content
  let cleaned = rawContent
    .replace(/# Conversation History[\s\S]*?(?=<conversation_summaries>|<USER_REQUEST>|$)/gi, '')
    .replace(/<conversation_summaries>[\s\S]*?<\/conversation_summaries>/gi, '')
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '')
    .replace(/<system(?:_information)?>[\s\S]*?<\/system(?:_information)?>/gi, '')
    .replace(/<identity>[\s\S]*?<\/identity>/gi, '')
    .replace(/<user_rules>[\s\S]*?<\/user_rules>/gi, '');

  return cleaned.trim();
}

/**
 * Continuous background transcript tailing engine that monitors Antigravity IDE's
 * transcript.jsonl using persistent byte-offset streaming via fs.createReadStream and readline.
 */
export class TranscriptTailEngine extends EventEmitter {
  private brainDir: string;
  private activeConvId: string;
  private explicitTranscriptPath?: string;
  private pollIntervalMs: number;
  private readOffset: number;
  private startFromEnd: boolean;
  private discoveryThrottleMs: number;
  private maxDiscoveryCandidates: number;
  private lastDiscoveryTimestamp: number = 0;
  private brainDirDebounceTimer: NodeJS.Timeout | null = null;

  private isRunning: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private transcriptWatcher: fs.FSWatcher | null = null;
  private brainDirWatcher: fs.FSWatcher | null = null;
  private isReading: boolean = false;
  private pendingRead: boolean = false;

  constructor(options: TranscriptTailEngineOptions = {}) {
    super();
    this.brainDir = options.brainDir || getDefaultBrainDir();
    this.activeConvId = options.activeConvId || '';
    this.explicitTranscriptPath = options.transcriptPath;
    this.pollIntervalMs = options.pollIntervalMs ?? 300;
    this.readOffset = options.readOffset ?? 0;
    this.startFromEnd = options.startFromEnd ?? false;
    this.discoveryThrottleMs = options.discoveryThrottleMs ?? 5000;
    this.maxDiscoveryCandidates = options.maxDiscoveryCandidates ?? 25;
  }

  // Typed EventEmitter overloads
  override on(event: 'userInput', listener: (e: UserInputEvent) => void): this;
  override on(event: 'plannerResponse', listener: (e: PlannerResponseEvent) => void): this;
  override on(event: 'agentActivity', listener: (e: AgentActivityEvent) => void): this;
  override on(event: 'conversationChanged', listener: (e: ConversationChangedEvent) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  override emit(event: 'userInput', data: UserInputEvent): boolean;
  override emit(event: 'plannerResponse', data: PlannerResponseEvent): boolean;
  override emit(event: 'agentActivity', data: AgentActivityEvent): boolean;
  override emit(event: 'conversationChanged', data: ConversationChangedEvent): boolean;
  override emit(event: string | symbol, ...args: any[]): boolean;
  override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Returns current byte offset pointer.
   */
  public getReadOffset(): number {
    return this.readOffset;
  }

  /**
   * Sets current byte offset pointer.
   */
  public setReadOffset(offset: number): void {
    this.readOffset = Math.max(0, offset);
  }

  /**
   * Returns current active conversation ID.
   */
  public getActiveConvId(): string {
    return this.activeConvId;
  }

  /**
   * Returns configured brain directory path.
   */
  public getBrainDir(): string {
    return this.brainDir;
  }

  /**
   * Checks whether the engine is actively running.
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Returns the discovery throttling interval in milliseconds.
   */
  public getDiscoveryThrottleMs(): number {
    return this.discoveryThrottleMs;
  }

  /**
   * Returns the timestamp of the last discovery scan.
   */
  public getLastDiscoveryTimestamp(): number {
    return this.lastDiscoveryTimestamp;
  }

  /**
   * Extracts clean user prompt text.
   */
  public extractUserPrompt(rawContent: string): string {
    return extractUserPrompt(rawContent);
  }

  /**
   * Resolves the full path to transcript.jsonl for the given or active conversation.
   */
  public resolveTranscriptPath(convId?: string): string | null {
    if (this.explicitTranscriptPath && (!convId || convId === this.activeConvId)) {
      return this.explicitTranscriptPath;
    }

    const targetConvId = convId || this.activeConvId;
    if (!targetConvId) {
      return this.explicitTranscriptPath || null;
    }

    const convDir = path.join(this.brainDir, targetConvId);
    const possiblePaths = [
      path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl'),
      path.join(convDir, '.system_generated', 'logs', 'transcript_full.jsonl'),
      path.join(convDir, 'transcript.jsonl'),
      path.join(convDir, 'transcript_full.jsonl')
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    // Default primary standard location
    return possiblePaths[0];
  }

  private readLockQueue: Promise<void> = Promise.resolve();

  private async acquireReadLock(): Promise<() => void> {
    let release: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const currentLock = this.readLockQueue;
    this.readLockQueue = this.readLockQueue.then(() => nextLock);
    await currentLock;
    return release!;
  }

  /**
   * Reads only newly appended lines using byte-offset streaming via fs.createReadStream and readline.
   * Maintains persistent readOffset and emits events for parsed steps.
   */
  public async readAppendedLines(filePath: string): Promise<string[]> {
    const release = await this.acquireReadLock();
    try {
      return await this.executeReadStream(filePath);
    } finally {
      release();
    }
  }

  private async executeReadStream(filePath: string): Promise<string[]> {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return [];
    }

    // Handle file rotation or truncation
    if (stat.size < this.readOffset) {
      this.readOffset = 0;
    }

    if (stat.size === this.readOffset) {
      return [];
    }

    const initialOffset = this.readOffset;
    const targetEnd = stat.size;

    return new Promise<string[]>((resolve, reject) => {
      const linesRead: string[] = [];
      let bytesRead = 0;
      let lastByteEndsWithNewline = false;

      const stream = fs.createReadStream(filePath, {
        start: initialOffset,
        end: targetEnd - 1
      });

      stream.on('data', (chunk: Buffer | string) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        bytesRead += buf.length;
        if (buf.length > 0) {
          const lastByte = buf[buf.length - 1];
          lastByteEndsWithNewline = (lastByte === 0x0A || lastByte === 0x0D);
        }
      });

      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
      });

      rl.on('line', (line: string) => {
        linesRead.push(line);
      });

      rl.on('close', () => {
        // If the stream did not end with a newline, the last line was incomplete (partial write)
        if (!lastByteEndsWithNewline && linesRead.length > 0) {
          const partialLine = linesRead.pop()!;
          const partialBytes = Buffer.byteLength(partialLine, 'utf8');
          this.readOffset = initialOffset + bytesRead - partialBytes;
        } else {
          this.readOffset = initialOffset + bytesRead;
        }

        // Parse and emit events for complete lines
        for (const line of linesRead) {
          const trimmed = line.trim();
          if (trimmed) {
            this.parseAndEmitStep(trimmed);
          }
        }

        resolve(linesRead);
      });

      stream.on('error', (err) => {
        try {
          rl.close();
        } catch {}
        reject(err);
      });

      rl.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Parses a single JSON line and emits typed events.
   */
  public parseAndEmitStep(rawLine: string): void {
    let step: TranscriptStep;
    try {
      step = JSON.parse(rawLine);
    } catch {
      return; // Skip malformed non-JSON lines
    }

    if (!step || typeof step !== 'object') {
      return;
    }

    const convId = this.activeConvId;
    const stepIndex = typeof step.step_index === 'number' ? step.step_index : 0;
    const timestamp = typeof step.timestamp === 'number' ? step.timestamp : Date.now();

    // 1. User Input Event
    if (step.type === 'USER_INPUT') {
      const rawPrompt = step.content || step.prompt || step.text || '';
      const cleanPrompt = extractUserPrompt(rawPrompt);
      if (cleanPrompt.length > 0) {
        this.emit('userInput', {
          convId,
          prompt: cleanPrompt,
          stepIndex,
          timestamp
        });
      }
      return;
    }

    // 2. Planner Response or Intermediate Activity Event
    if (step.type === 'PLANNER_RESPONSE') {
      const isModel = !step.source || step.source === 'MODEL';
      if (!isModel) {
        return;
      }

      // Check if tool calls exist
      if (Array.isArray(step.tool_calls) && step.tool_calls.length > 0) {
        const toolCalls = step.tool_calls;
        const activities: string[] = [];
        for (const tc of toolCalls) {
          if (!tc) continue;
          const act = tc.toolAction || tc.toolSummary || tc.name || tc.function?.name || 'tool_call';
          activities.push(act);
        }
        const activityDesc = activities.join(', ') || 'Executing tools';
        this.emit('agentActivity', {
          convId,
          activity: activityDesc,
          stepIndex
        });
        return;
      }

      // Final assistant response
      const response = step.content || step.response || step.text || '';
      if (response.length > 0) {
        this.emit('plannerResponse', {
          convId,
          response,
          stepIndex,
          timestamp
        });
      }
      return;
    }

    // 3. Standalone Tool / Activity Events
    if (step.type === 'TOOL_CALL' || step.type === 'TOOL_EXECUTION' || step.type === 'THINKING') {
      const activityDesc = step.activity || step.content || step.name || 'Agent working';
      this.emit('agentActivity', {
        convId,
        activity: activityDesc,
        stepIndex
      });
      return;
    }
  }

  /**
   * Switches the active conversation to newConvId, resetting readOffset and rebinding watchers.
   */
  public switchConversation(newConvId: string): void {
    if (!newConvId || newConvId === this.activeConvId) {
      return;
    }

    const oldConvId = this.activeConvId;
    this.cleanupTranscriptWatcher();

    this.activeConvId = newConvId;
    this.readOffset = 0;

    this.setupTranscriptWatcher();
    this.emit('conversationChanged', { oldConvId, newConvId });

    // Perform immediate read on the newly selected conversation
    this.checkAndRead();
  }

  /**
   * Asynchronously discovers the latest conversation directory in brainDir.
   * Prunes candidate folders to avoid sequential stats over hundreds of historical sessions.
   */
  public async findLatestConversation(): Promise<string | null> {
    if (!fs.existsSync(this.brainDir)) {
      return null;
    }

    try {
      const entries = await fs.promises.readdir(this.brainDir, { withFileTypes: true });
      const dirEntries = entries.filter(
        (entry) => entry.isDirectory() && entry.name !== 'scratch' && !entry.name.startsWith('.')
      );

      if (dirEntries.length === 0) {
        return null;
      }

      // Stat candidate directories in parallel
      const dirStats = await Promise.all(
        dirEntries.map(async (entry) => {
          const convDir = path.join(this.brainDir, entry.name);
          try {
            const stat = await fs.promises.stat(convDir);
            return {
              convId: entry.name,
              convDir,
              dirMtime: stat.mtimeMs || stat.birthtimeMs || 0
            };
          } catch {
            return {
              convId: entry.name,
              convDir,
              dirMtime: 0
            };
          }
        })
      );

      // Prune candidates: sort by folder directory mtime descending
      dirStats.sort((a, b) => b.dirMtime - a.dirMtime);

      // Limit candidates to avoid sequential stats over hundreds of historical sessions
      const pruneLimit = this.maxDiscoveryCandidates;
      let candidatesToInspect = dirStats.length > pruneLimit ? dirStats.slice(0, pruneLimit) : dirStats;

      // Ensure active conversation is included in inspection if present
      if (this.activeConvId && !candidatesToInspect.some((c) => c.convId === this.activeConvId)) {
        const activeEntry = dirStats.find((c) => c.convId === this.activeConvId);
        if (activeEntry) {
          candidatesToInspect.push(activeEntry);
        }
      }

      // Stat transcript files in parallel for the pruned candidate set
      const evaluatedCandidates = await Promise.all(
        candidatesToInspect.map(async (candidate) => {
          let mtime = 0;
          const transcriptPath = this.resolveTranscriptPath(candidate.convId);
          if (transcriptPath && fs.existsSync(transcriptPath)) {
            try {
              const stat = await fs.promises.stat(transcriptPath);
              mtime = stat.mtimeMs || stat.birthtimeMs || 0;
            } catch {}
          }

          if (mtime === 0) {
            mtime = candidate.dirMtime;
          }

          return {
            convId: candidate.convId,
            mtime
          };
        })
      );

      evaluatedCandidates.sort((a, b) => b.mtime - a.mtime);
      return evaluatedCandidates.length > 0 ? evaluatedCandidates[0].convId : null;
    } catch {
      return null;
    }
  }

  /**
   * Starts continuous monitoring and background tailing.
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    // Discover active conversation if not explicitly provided
    if (!this.activeConvId && !this.explicitTranscriptPath) {
      const latest = await this.findLatestConversation();
      if (latest) {
        this.activeConvId = latest;
        this.lastDiscoveryTimestamp = Date.now();
      }
    }

    const transcriptPath = this.resolveTranscriptPath();
    if (this.startFromEnd && transcriptPath && fs.existsSync(transcriptPath)) {
      try {
        const stat = await fs.promises.stat(transcriptPath);
        this.readOffset = stat.size;
      } catch {}
    }

    // Attach watchers
    this.setupTranscriptWatcher();
    this.setupBrainDirWatcher();

    // Start resilient polling fallback (300ms by default)
    this.pollTimer = setInterval(async () => {
      await this.pollTick();
    }, this.pollIntervalMs);

    // Initial read
    await this.checkAndRead();
  }

  /**
   * Gracefully stops the tail engine, clearing timers and releasing file watchers.
   */
  public stop(): void {
    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.cleanupTranscriptWatcher();
    this.cleanupBrainDirWatcher();
  }

  /**
   * Periodic polling tick: inspects brainDir for new conversations and checks active transcript for appended bytes.
   */
  private async pollTick(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    const now = Date.now();
    const shouldCheckDiscovery =
      !this.explicitTranscriptPath &&
      fs.existsSync(this.brainDir) &&
      (!this.activeConvId || now - this.lastDiscoveryTimestamp >= this.discoveryThrottleMs);

    if (shouldCheckDiscovery) {
      this.lastDiscoveryTimestamp = now;
      const latestConv = await this.findLatestConversation();
      if (latestConv && latestConv !== this.activeConvId) {
        this.switchConversation(latestConv);
        return;
      }
    }

    // Ensure transcript watcher is active if file was recently created
    if (!this.transcriptWatcher) {
      this.setupTranscriptWatcher();
    }

    // Always inspect active transcript for appended bytes (1 stat call only)
    await this.checkAndRead();
  }

  /**
   * Safely serializes reading to avoid concurrent overlapping file reads.
   */
  private async checkAndRead(): Promise<void> {
    if (this.isReading || !this.isRunning) {
      if (this.isReading) {
        this.pendingRead = true;
      }
      return;
    }

    this.isReading = true;
    try {
      const transcriptPath = this.resolveTranscriptPath();
      if (transcriptPath && fs.existsSync(transcriptPath)) {
        await this.readAppendedLines(transcriptPath);
      }
    } catch {
      // Graceful error isolation
    } finally {
      this.isReading = false;
      if (this.pendingRead && this.isRunning) {
        this.pendingRead = false;
        setImmediate(() => {
          this.checkAndRead();
        });
      }
    }
  }

  private setupTranscriptWatcher(): void {
    if (this.transcriptWatcher) {
      return;
    }

    const transcriptPath = this.resolveTranscriptPath();
    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      return;
    }

    try {
      this.transcriptWatcher = fs.watch(transcriptPath, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          this.checkAndRead();
        }
      });
      this.transcriptWatcher.on('error', () => {
        this.cleanupTranscriptWatcher();
      });
    } catch {
      this.transcriptWatcher = null;
    }
  }

  private cleanupTranscriptWatcher(): void {
    if (this.transcriptWatcher) {
      try {
        this.transcriptWatcher.close();
      } catch {}
      this.transcriptWatcher = null;
    }
  }

  private setupBrainDirWatcher(): void {
    if (this.brainDirWatcher || this.explicitTranscriptPath) {
      return;
    }

    if (!fs.existsSync(this.brainDir)) {
      return;
    }

    try {
      this.brainDirWatcher = fs.watch(this.brainDir, () => {
        if (this.brainDirDebounceTimer) {
          clearTimeout(this.brainDirDebounceTimer);
        }
        this.brainDirDebounceTimer = setTimeout(async () => {
          this.brainDirDebounceTimer = null;
          this.lastDiscoveryTimestamp = 0;
          await this.pollTick();
        }, 100);
      });
      this.brainDirWatcher.on('error', () => {
        this.cleanupBrainDirWatcher();
      });
    } catch {
      this.brainDirWatcher = null;
    }
  }

  private cleanupBrainDirWatcher(): void {
    if (this.brainDirDebounceTimer) {
      clearTimeout(this.brainDirDebounceTimer);
      this.brainDirDebounceTimer = null;
    }
    if (this.brainDirWatcher) {
      try {
        this.brainDirWatcher.close();
      } catch {}
      this.brainDirWatcher = null;
    }
  }
}
