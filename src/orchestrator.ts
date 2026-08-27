import { EventEmitter } from 'events';
import * as path from 'path';
import { AutoPlanConfig, getConfig, DEFAULT_PROMPT_TEMPLATE } from './config';
import { KeyboardManager, keyboardManager as defaultKeyboardManager } from './keyboardManager';
import {
  TranscriptWatcher,
  transcriptWatcher as defaultTranscriptWatcher,
  CompletionResult,
  getTranscriptPath
} from './transcriptWatcher';
import {
  PhaseFile,
  scanPlanFolder,
  renderPromptTemplate,
  normalizePath
} from './planScanner';

export type OrchestratorState =
  | 'idle'
  | 'scanning'
  | 'sending'
  | 'waiting'
  | 'delaying'
  | 'stopped'
  | 'completed'
  | 'error';

export type PhaseStatus = 'Pending' | 'Running' | 'Completed' | 'Failed' | 'Skipped';

export interface PhaseItem {
  /** 0-based sequence index */
  index: number;
  /** 1-based display number */
  phaseNumber: number;
  /** File basename, e.g. 'phase-01-scaffold.md' */
  fileName: string;
  /** Primary normalized file path */
  filePath: string;
  /** Native OS file path */
  nativePath: string;
  /** Normalized forward-slash file path */
  normalizedPath: string;
  /** Current phase lifecycle status */
  status: PhaseStatus;
  /** Associated conversation ID if detected */
  conversationId?: string;
  /** Execution start timestamp */
  startTime?: number;
  /** Execution end timestamp */
  endTime?: number;
  /** Error message if failed */
  error?: string;
  /** Completion result metadata */
  result?: CompletionResult;
}

export interface OrchestratorProgressInfo {
  state: OrchestratorState;
  currentIteration: number;
  totalIterations: number;
  currentPhaseIndex?: number;
  totalPhases?: number;
  currentPhase?: PhaseItem;
  message?: string;
  conversationId?: string;
}

export interface OrchestratorOptions {
  configProvider?: () => AutoPlanConfig;
  keyboardManager?: KeyboardManager;
  transcriptWatcher?: TranscriptWatcher;
  onStateChange?: (info: OrchestratorProgressInfo) => void;
  onIterationComplete?: (iteration: number, total: number, result: CompletionResult) => void;
  onPhaseStart?: (phase: PhaseItem, index: number, total: number) => void;
  onPhaseComplete?: (phase: PhaseItem, result: CompletionResult) => void;
  onAllComplete?: (total: number) => void;
  onError?: (error: Error) => void;
  onStopped?: () => void;
  onSkipped?: (phase: PhaseItem) => void;
}

export class Orchestrator extends EventEmitter {
  private state: OrchestratorState = 'idle';
  private currentIteration: number = 0;
  private totalIterations: number = 0;
  private currentPhaseIndex: number = -1;
  private phases: PhaseItem[] = [];
  private isAborted: boolean = false;
  private isSkippingCurrentPhase: boolean = false;
  private delayReject: ((reason?: any) => void) | null = null;
  private delayTimer: NodeJS.Timeout | null = null;
  private lastConversationId: string | undefined = undefined;

  private configProvider: () => AutoPlanConfig;
  private keyboardManager: KeyboardManager;
  private transcriptWatcher: TranscriptWatcher;

  constructor(options?: OrchestratorOptions) {
    super();
    this.setMaxListeners(50);
    this.configProvider = options?.configProvider ?? getConfig;
    this.keyboardManager = options?.keyboardManager ?? defaultKeyboardManager;
    this.transcriptWatcher = options?.transcriptWatcher ?? defaultTranscriptWatcher;

    if (options?.onStateChange) {
      this.on('stateChange', options.onStateChange);
    }
    if (options?.onIterationComplete) {
      this.on('iterationComplete', options.onIterationComplete);
    }
    if (options?.onPhaseStart) {
      this.on('phaseStart', options.onPhaseStart);
    }
    if (options?.onPhaseComplete) {
      this.on('phaseComplete', options.onPhaseComplete);
    }
    if (options?.onAllComplete) {
      this.on('allComplete', options.onAllComplete);
    }
    if (options?.onError) {
      this.on('error', options.onError);
    }
    if (options?.onStopped) {
      this.on('stopped', options.onStopped);
    }
    if (options?.onSkipped) {
      this.on('skipped', options.onSkipped);
    }
  }

  /**
   * Detaches transient run-time event listeners to prevent listener leaks.
   */
  public clearRunListeners(): void {
    this.removeAllListeners('stateChange');
    this.removeAllListeners('iterationComplete');
    this.removeAllListeners('phaseStart');
    this.removeAllListeners('phaseComplete');
    this.removeAllListeners('allComplete');
    this.removeAllListeners('error');
    this.removeAllListeners('stopped');
    this.removeAllListeners('skipped');
  }

  public getState(): OrchestratorState {
    return this.state;
  }

  public isRunning(): boolean {
    return (
      this.state !== 'idle' &&
      this.state !== 'stopped' &&
      this.state !== 'completed' &&
      this.state !== 'error'
    );
  }

  public getProgress(): { current: number; total: number } {
    return {
      current: this.currentIteration,
      total: this.totalIterations
    };
  }

  public getPhases(): PhaseItem[] {
    return [...this.phases];
  }

  public getCurrentPhase(): PhaseItem | null {
    if (this.currentPhaseIndex >= 0 && this.currentPhaseIndex < this.phases.length) {
      return this.phases[this.currentPhaseIndex];
    }
    return null;
  }

  public getLastConversationId(): string | undefined {
    return this.lastConversationId;
  }

  private setState(state: OrchestratorState, message?: string, conversationId?: string): void {
    this.state = state;
    const currentPhase = this.getCurrentPhase() || undefined;
    const info: OrchestratorProgressInfo = {
      state: this.state,
      currentIteration: this.currentIteration,
      totalIterations: this.totalIterations,
      currentPhaseIndex: this.currentPhaseIndex >= 0 ? this.currentPhaseIndex : undefined,
      totalPhases: this.phases.length > 0 ? this.phases.length : undefined,
      currentPhase,
      message,
      conversationId: conversationId || this.lastConversationId
    };
    this.emit('stateChange', info);
  }

  /**
   * Helper delay that can be immediately cancelled when stop() or skipCurrentPhase() is called.
   */
  private cancellableDelay(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.delayReject = reject;
      this.delayTimer = setTimeout(() => {
        this.delayTimer = null;
        this.delayReject = null;
        resolve();
      }, ms);
    });
  }

  /**
   * Automatically scans a target plan folder and sequentially executes all discovered phases.
   */
  public async startFolder(
    folderPath: string,
    options?: { startFromIndex?: number; overrideConfig?: Partial<AutoPlanConfig> }
  ): Promise<boolean> {
    if (this.isRunning()) {
      return false;
    }

    this.setState('scanning', `Scanning plan folder: ${folderPath}`);
    const phaseFiles = scanPlanFolder(folderPath);

    this.phases = phaseFiles.map((pf, idx) => ({
      index: idx,
      phaseNumber: pf.index,
      fileName: pf.fileName,
      filePath: pf.filePath,
      nativePath: pf.nativePath,
      normalizedPath: pf.normalizedPath,
      status: 'Pending'
    }));

    const startIndex = options?.startFromIndex ?? 0;
    return this.runPhaseSequence(startIndex, options?.overrideConfig);
  }

  /**
   * Sequentially executes an explicit list of phase files.
   */
  public async startPhases(
    phaseFiles: (string | PhaseFile)[],
    options?: { startFromIndex?: number; overrideConfig?: Partial<AutoPlanConfig> }
  ): Promise<boolean> {
    if (this.isRunning()) {
      return false;
    }

    if (phaseFiles.length === 0) {
      throw new Error('phaseFiles array must not be empty');
    }

    this.phases = phaseFiles.map((item, idx) => {
      if (typeof item === 'string') {
        const norm = normalizePath(path.resolve(item));
        const nat = path.normalize(norm);
        return {
          index: idx,
          phaseNumber: idx + 1,
          fileName: path.basename(norm),
          filePath: norm,
          nativePath: nat,
          normalizedPath: norm,
          status: 'Pending'
        };
      } else {
        return {
          index: idx,
          phaseNumber: item.index || idx + 1,
          fileName: item.fileName,
          filePath: item.filePath,
          nativePath: item.nativePath,
          normalizedPath: item.normalizedPath,
          status: 'Pending'
        };
      }
    });

    const startIndex = options?.startFromIndex ?? 0;
    return this.runPhaseSequence(startIndex, options?.overrideConfig);
  }

  /**
   * Resumes execution from a specific phase index using the currently loaded phase list.
   */
  public async resumeFrom(
    phaseIndex: number,
    overrideConfig?: Partial<AutoPlanConfig>
  ): Promise<boolean> {
    if (this.isRunning()) {
      return false;
    }
    if (!this.phases || this.phases.length === 0) {
      throw new Error('No phases loaded to resume from. Call startFolder or startPhases first.');
    }
    if (phaseIndex < 0 || phaseIndex >= this.phases.length) {
      throw new Error(`Invalid phaseIndex ${phaseIndex}. Must be between 0 and ${this.phases.length - 1}`);
    }

    return this.runPhaseSequence(phaseIndex, overrideConfig);
  }

  /**
   * Skips the currently executing phase and immediately proceeds to the next.
   */
  public skipCurrentPhase(): boolean {
    if (!this.isRunning() || this.currentPhaseIndex < 0 || this.currentPhaseIndex >= this.phases.length) {
      return false;
    }

    this.isSkippingCurrentPhase = true;

    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = null;
    }
    if (this.delayReject) {
      this.delayReject(new Error('Phase skipped'));
      this.delayReject = null;
    }

    this.transcriptWatcher.stop();
    return true;
  }

  /**
   * Executes the sequential phase loop starting at a specific index.
   */
  private async runPhaseSequence(
    startIndex: number = 0,
    overrideConfig?: Partial<AutoPlanConfig>
  ): Promise<boolean> {
    if (this.phases.length === 0) {
      this.setState('error', 'No phases to execute');
      this.emit('error', new Error('No phases to execute'));
      return false;
    }

    const baseConfig = this.configProvider();
    const config: AutoPlanConfig = {
      ...baseConfig,
      ...overrideConfig
    };

    this.isAborted = false;
    this.isSkippingCurrentPhase = false;
    this.totalIterations = this.phases.length;

    // Reset statuses of phases from startIndex onwards
    for (let i = startIndex; i < this.phases.length; i++) {
      this.phases[i].status = 'Pending';
      this.phases[i].error = undefined;
      this.phases[i].result = undefined;
    }

    try {
      for (let i = startIndex; i < this.phases.length; i++) {
        if (this.isAborted) break;

        const phase = this.phases[i];
        this.currentPhaseIndex = i;
        this.currentIteration = i + 1;
        phase.status = 'Running';
        phase.startTime = Date.now();

        // 1. Emit Phase Start
        this.emit('phaseStart', phase, i, this.phases.length, phase.fileName, phase.filePath);

        // 2. Timestamp & Reset
        const phaseStartTime = Date.now();

        // 3. New Conversation Trigger, Focus, Paste & Submit via Batch Flow
        this.setState('sending', `Phase ${i + 1}/${this.phases.length}: Sending prompt for ${phase.fileName}`);
        
        const template = config.promptTemplate || config.promptText || DEFAULT_PROMPT_TEMPLATE;
        const renderedPrompt = renderPromptTemplate(template, phase.filePath);

        await this.keyboardManager.executeBatchPromptFlow(renderedPrompt);

        if (this.isAborted) break;
        if (this.isSkippingCurrentPhase) {
          phase.status = 'Skipped';
          phase.endTime = Date.now();
          this.emit('skipped', phase);
          this.isSkippingCurrentPhase = false;
          continue;
        }

        // 6. Anti-Pollution Watcher: wait for new conversation created after phaseStartTime
        this.setState('waiting', `Phase ${i + 1}/${this.phases.length}: Waiting for completion of ${phase.fileName}`);

        let convId: string;
        try {
          convId = await this.transcriptWatcher.waitForNewConversation(
            phaseStartTime - 1000,
            this.lastConversationId,
            config.timeoutPerLoopMinutes * 60 * 1000,
            this.transcriptWatcher.getOptions().pollIntervalMs
          );
        } catch (err: any) {
          if (this.isSkippingCurrentPhase) {
            phase.status = 'Skipped';
            phase.endTime = Date.now();
            this.emit('skipped', phase);
            this.isSkippingCurrentPhase = false;
            continue;
          }
          if (this.isAborted) break;
          convId = 'current_conversation';
        }

        if (this.isAborted) break;
        if (this.isSkippingCurrentPhase) {
          phase.status = 'Skipped';
          phase.endTime = Date.now();
          this.emit('skipped', phase);
          this.isSkippingCurrentPhase = false;
          continue;
        }

        // 7. Strict Completion Await
        let completionResult: CompletionResult;
        if (convId !== 'current_conversation') {
          const convDir = path.join(this.transcriptWatcher.getOptions().brainDir, convId);
          const transcriptPath = getTranscriptPath(convDir);
          if (transcriptPath) {
            completionResult = await this.transcriptWatcher.watchFile(transcriptPath, convId);
          } else {
            completionResult = await this.transcriptWatcher.watchLatest(phaseStartTime - 1000, this.lastConversationId);
          }
        } else {
          completionResult = await this.transcriptWatcher.watchLatest(phaseStartTime - 1000, this.lastConversationId);
        }

        if (this.isSkippingCurrentPhase) {
          phase.status = 'Skipped';
          phase.endTime = Date.now();
          this.emit('skipped', phase);
          this.isSkippingCurrentPhase = false;
          continue;
        }

        if (this.isAborted) break;

        if (!completionResult.success) {
          phase.status = 'Failed';
          phase.endTime = Date.now();
          phase.error = completionResult.error || `Phase ${phase.fileName} failed`;
          throw new Error(phase.error);
        }

        // 8. Update Tracking
        this.lastConversationId = convId !== 'current_conversation' ? convId : completionResult.conversationId || this.lastConversationId;
        phase.conversationId = this.lastConversationId;
        phase.status = 'Completed';
        phase.endTime = Date.now();
        phase.result = completionResult;

        this.emit('phaseComplete', phase, completionResult, i, this.phases.length);
        this.emit('iterationComplete', i + 1, this.phases.length, completionResult);

        // 9. Inter-Phase Delay
        if (i < this.phases.length - 1) {
          this.setState('delaying', `Waiting before next phase...`);
          try {
            await this.cancellableDelay(config.delayBetweenLoopsMs);
          } catch {
            if (this.isAborted) break;
            if (this.isSkippingCurrentPhase) {
              this.isSkippingCurrentPhase = false;
            }
          }
        }
      }

      if (this.isAborted) {
        this.setState('stopped', 'Stopped by user');
        this.emit('stopped');
        return false;
      }

      this.setState('completed', 'All phases completed');
      this.emit('allComplete', this.phases.length);
      return true;
    } catch (err: any) {
      if (this.isAborted) {
        this.setState('stopped', 'Stopped by user');
        this.emit('stopped');
        return false;
      }
      this.setState('error', err.message || String(err));
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  /**
   * Starts the count-based orchestration loop (retained for backward compatibility).
   */
  public async start(overrideConfig?: Partial<AutoPlanConfig>): Promise<boolean> {
    if (this.isRunning()) {
      return false;
    }

    const baseConfig = this.configProvider();
    const config: AutoPlanConfig = {
      ...baseConfig,
      ...overrideConfig
    };

    this.isAborted = false;
    this.totalIterations = config.repeatCount;
    this.currentIteration = 0;
    this.currentPhaseIndex = -1;

    try {
      for (let i = 1; i <= this.totalIterations; i++) {
        if (this.isAborted) break;

        this.currentIteration = i;

        // Step 1: Sending prompt
        this.setState('sending', 'Sending Prompt...');
        const timestampBeforeSend = Date.now();

        await this.keyboardManager.executePromptFlow(config.promptText);

        if (this.isAborted) break;

        // Step 2: Listening for completion keyword
        this.setState('waiting', 'Waiting for Agent...');

        let convId: string;
        try {
          convId = await this.transcriptWatcher.waitForNewConversation(
            timestampBeforeSend - 1000,
            this.lastConversationId,
            5000,
            100
          );
        } catch {
          convId = 'current_conversation';
        }

        if (this.isAborted) break;

        // Watch conversation transcript
        let completionResult: CompletionResult;
        if (convId !== 'current_conversation') {
          const convDir = path.join(this.transcriptWatcher.getOptions().brainDir, convId);
          const transcriptPath = getTranscriptPath(convDir);
          if (transcriptPath) {
            completionResult = await this.transcriptWatcher.watchFile(transcriptPath, convId);
          } else {
            completionResult = await this.transcriptWatcher.watchLatest(timestampBeforeSend - 1000, this.lastConversationId);
          }
        } else {
          completionResult = await this.transcriptWatcher.watchLatest(timestampBeforeSend - 1000, this.lastConversationId);
        }

        if (this.isAborted) break;

        if (!completionResult.success) {
          throw new Error(completionResult.error || 'Loop iteration failed or timed out');
        }

        this.lastConversationId = convId !== 'current_conversation' ? convId : completionResult.conversationId || this.lastConversationId;
        this.emit('iterationComplete', i, this.totalIterations, completionResult);

        // Step 3: Check if further iterations remain and delay
        if (i < this.totalIterations) {
          this.setState('delaying', 'Waiting next loop...');
          try {
            await this.cancellableDelay(config.delayBetweenLoopsMs);
          } catch {
            if (this.isAborted) break;
          }
        }
      }

      if (this.isAborted) {
        this.setState('stopped', 'Stopped by user');
        this.emit('stopped');
        return false;
      }

      this.setState('completed', 'All iterations completed');
      this.emit('allComplete', this.totalIterations);
      return true;
    } catch (err: any) {
      if (this.isAborted) {
        this.setState('stopped', 'Stopped by user');
        this.emit('stopped');
        return false;
      }
      this.setState('error', err.message || String(err));
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  /**
   * Stops the orchestrator immediately.
   */
  public stop(): void {
    this.isAborted = true;

    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = null;
    }

    if (this.delayReject) {
      this.delayReject(new Error('Orchestrator stopped'));
      this.delayReject = null;
    }

    this.transcriptWatcher.stop();
    this.setState('stopped', 'Stopped by user');
    this.emit('stopped');
  }

  /**
   * Disposes resources.
   */
  public dispose(): void {
    this.stop();
    this.removeAllListeners();
  }
}

export const orchestrator = new Orchestrator();
