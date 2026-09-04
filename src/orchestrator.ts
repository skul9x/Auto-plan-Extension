import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AutoPlanConfig, getConfig, DEFAULT_PROMPT_TEMPLATE } from './config';
import { KeyboardManager, keyboardManager as defaultKeyboardManager } from './keyboardManager';
import {
  PromptDispatcher,
  promptDispatcher as defaultPromptDispatcher,
  DispatchResult,
  DispatchOptions,
  DispatchReadinessResult
} from './promptDispatcher';
import {
  TranscriptWatcher,
  transcriptWatcher as defaultTranscriptWatcher,
  CompletionResult,
  getTranscriptPath,
  NewConversationTimeoutError
} from './transcriptWatcher';

export { NewConversationTimeoutError };
import {
  PhaseFile,
  scanPlanFolder,
  scanPlanFolderAsync,
  renderPromptTemplate,
  normalizePath,
  analyzePhaseStallReason,
  PhaseDiagnosticInfo,
  PlanPhasesAuditReport,
  PhaseExecutionContext,
  PhaseStallReason
} from './planScanner';
import { debugLogger as defaultDebugLogger, DebugLogger } from './debugLogger';

export type OrchestratorState =
  | 'idle'
  | 'scanning'
  | 'sending'
  | 'waiting'
  | 'delaying'
  | 'stopped'
  | 'completed'
  | 'error';

export type PhaseStatus = 'Pending' | 'Running' | 'Completed' | 'Failed' | 'Skipped' | 'Stopped';

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
  /** Initial file byte offset before prompt dispatch */
  startOffset?: number;
  /** Initial number of transcript lines before prompt dispatch */
  initialTranscriptLength?: number;
  /** Execution start timestamp */
  startTime?: number;
  /** Execution end timestamp */
  endTime?: number;
  /** Error message if failed */
  error?: string;
  /** Completion result metadata */
  result?: CompletionResult;
  /** Prompt dispatch result details */
  dispatchResult?: DispatchResult;
  /** Diagnostic stall reason if phase is blocked/stalled/failed */
  stallReason?: PhaseStallReason;
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

export type ActionableErrorNotifier = (
  errorMessage: string,
  ...items: string[]
) => Promise<string | undefined> | Thenable<string | undefined>;

export interface OrchestratorOptions {
  configProvider?: () => AutoPlanConfig;
  keyboardManager?: KeyboardManager;
  transcriptWatcher?: TranscriptWatcher;
  promptDispatcher?: PromptDispatcher;
  debugLogger?: DebugLogger;
  stallTimeoutMs?: number;
  stallWatchdogThresholdMs?: number;
  actionableErrorNotifier?: ActionableErrorNotifier;
  onStateChange?: (info: OrchestratorProgressInfo) => void;
  onIterationComplete?: (iteration: number, total: number, result: CompletionResult) => void;
  onPhaseStart?: (phase: PhaseItem, index: number, total: number) => void;
  onPhaseComplete?: (phase: PhaseItem, result: CompletionResult) => void;
  onAllComplete?: (total: number) => void;
  onError?: (error: Error) => void;
  onWarning?: (message: string) => void;
  onStopped?: () => void;
  onSkipped?: (phase: PhaseItem) => void;
}

export class Orchestrator extends EventEmitter {
  private state: OrchestratorState = 'idle';
  private currentIteration: number = 0;
  private totalIterations: number = 0;
  private currentPhaseIndex: number = -1;
  private phases: PhaseItem[] = [];
  private currentPlanFolder: string | null = null;
  private isAborted: boolean = false;
  private isSkippingCurrentPhase: boolean = false;
  private delayReject: ((reason?: any) => void) | null = null;
  private delayTimer: NodeJS.Timeout | null = null;
  private stallWatchdogTimer: NodeJS.Timeout | null = null;
  private stallWatchdogThresholdMs: number = 120000;
  private lastConversationId: string | undefined = undefined;
  private lastPreflightResult: DispatchReadinessResult | null = null;

  private configProvider: () => AutoPlanConfig;
  private keyboardManager: KeyboardManager;
  private transcriptWatcher: TranscriptWatcher;
  private promptDispatcher: PromptDispatcher;
  private debugLogger: DebugLogger;
  private actionableErrorNotifier: ActionableErrorNotifier;

  constructor(options?: OrchestratorOptions) {
    super();
    this.setMaxListeners(50);
    this.configProvider = options?.configProvider ?? getConfig;
    this.keyboardManager = options?.keyboardManager ?? defaultKeyboardManager;
    this.transcriptWatcher = options?.transcriptWatcher ?? defaultTranscriptWatcher;
    this.debugLogger = options?.debugLogger ?? defaultDebugLogger;
    this.stallWatchdogThresholdMs =
      options?.stallTimeoutMs ?? options?.stallWatchdogThresholdMs ?? 120000;

    this.promptDispatcher =
      options?.promptDispatcher ??
      (options?.keyboardManager
        ? new PromptDispatcher({
            keyboardManager: options.keyboardManager,
            configProvider: options?.configProvider ?? getConfig
          })
        : defaultPromptDispatcher);

    // Register this orchestrator instance as the Plan Audit provider for DebugLogger
    this.debugLogger.registerPlanAuditProvider(() => this.getPhaseAuditReport());

    this.actionableErrorNotifier =
      options?.actionableErrorNotifier ??
      (async (errorMessage: string, ...items: string[]) => {
        try {
          if (typeof vscode !== 'undefined' && vscode?.window?.showErrorMessage) {
            const selection = await vscode.window.showErrorMessage(errorMessage, ...items);
            if (selection === '⚙️ Open Settings Panel') {
              await vscode.commands?.executeCommand('autoplan.openSettings');
            } else if (selection === '⚡ 1-Click DOM Bridge Setup') {
              await vscode.commands?.executeCommand('autoplan.oneClickSetup');
            } else if (selection === 'Install Guide') {
              await vscode.window?.showInformationMessage(
                'To configure prompt automation, enable the DOM Automation Bridge in settings or ensure OS prerequisites (e.g. xdotool on Linux) are installed.'
              );
            }
            return selection;
          } else {
            console.error(`[Auto-Plan Orchestrator] ${errorMessage}`);
          }
        } catch {
          console.error(`[Auto-Plan Orchestrator] ${errorMessage}`);
        }
        return undefined;
      });

    // Prevent unhandled error event crash when caller has not attached an error listener
    this.on('error', (err) => {
      if (this.listenerCount('error') <= 1) {
        console.error(`[Auto-Plan Orchestrator Error] ${err?.message || err}`);
      }
    });

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
    if (options?.onWarning) {
      this.on('warning', options.onWarning);
    }
    if (options?.onStopped) {
      this.on('stopped', options.onStopped);
    }
    if (options?.onSkipped) {
      this.on('skipped', options.onSkipped);
    }
  }

  public getPromptDispatcher(): PromptDispatcher {
    return this.promptDispatcher;
  }

  public getDebugLogger(): DebugLogger {
    return this.debugLogger;
  }

  public getLastPreflightResult(): DispatchReadinessResult | null {
    return this.lastPreflightResult;
  }

  public get config(): AutoPlanConfig {
    return this.configProvider();
  }

  /**
   * Converts a PhaseItem into enriched PhaseDiagnosticInfo.
   */
  public toPhaseDiagnosticInfo(phase: PhaseItem): PhaseDiagnosticInfo {
    const phaseNum = phase.phaseNumber || phase.index + 1;
    const isCompleted = phase.status === 'Completed';
    const isSelected = phase.status !== 'Skipped';
    let executionTimeMs: number | undefined = undefined;
    if (phase.startTime && phase.endTime) {
      executionTimeMs = phase.endTime - phase.startTime;
    } else if (phase.startTime) {
      executionTimeMs = Date.now() - phase.startTime;
    }

    return {
      index: phase.index,
      phaseNumber: phaseNum,
      fileName: phase.fileName,
      filePath: phase.filePath,
      status: phase.status,
      isCompleted,
      isSelected,
      error: phase.error,
      stallReason: phase.stallReason,
      conversationId: phase.conversationId,
      executionTimeMs
    };
  }

  /**
   * Starts the proactive stall watchdog timer for the currently executing phase.
   */
  private startStallWatchdog(phase: PhaseItem, phaseIndex: number, thresholdMs: number): void {
    this.stopStallWatchdog();
    if (thresholdMs <= 0) return;

    this.stallWatchdogTimer = setTimeout(() => {
      if (
        this.isRunning() &&
        this.currentPhaseIndex === phaseIndex &&
        (phase.status === 'Running' || this.state === 'waiting')
      ) {
        const diag = this.toPhaseDiagnosticInfo(phase);
        const stallReason: PhaseStallReason = {
          code: 'AI_RESPONSE_TIMEOUT',
          description: `Phase ${phase.phaseNumber || phaseIndex + 1} (${phase.fileName}) has been waiting for AI response for > ${(thresholdMs / 1000).toFixed(0)}s without completion.`,
          remediationAction: 'Check AI output transcript or increase timeoutPerLoopMinutes setting'
        };
        this.debugLogger.logPhaseStall(diag, stallReason);
        this.emit(
          'warning',
          `[Watchdog] Phase ${phase.phaseNumber || phaseIndex + 1} (${phase.fileName}) wait duration exceeded ${(thresholdMs / 1000).toFixed(0)}s`
        );
      }
    }, thresholdMs);

    if (this.stallWatchdogTimer && typeof this.stallWatchdogTimer.unref === 'function') {
      this.stallWatchdogTimer.unref();
    }
  }

  /**
   * Stops the proactive stall watchdog timer.
   */
  private stopStallWatchdog(): void {
    if (this.stallWatchdogTimer) {
      clearTimeout(this.stallWatchdogTimer);
      this.stallWatchdogTimer = null;
    }
  }

  /**
   * Diagnoses and logs cascade blockers for subsequent phases when an active phase errors.
   */
  private diagnoseSubsequentPhasesOnFailure(failedIndex: number, failedError?: string): void {
    const failedPhase = this.phases[failedIndex];
    const phaseNum = failedPhase ? failedPhase.phaseNumber || failedIndex + 1 : failedIndex + 1;
    const phaseName = failedPhase ? failedPhase.fileName : `Phase ${phaseNum}`;

    for (let j = failedIndex + 1; j < this.phases.length; j++) {
      const nextPhase = this.phases[j];
      const stallReason: PhaseStallReason = {
        code: 'BLOCKED_BY_PREVIOUS_FAILURE',
        description: `Blocked by failure in previous Phase ${phaseNum} (${phaseName})${failedError ? `: ${failedError}` : ''}`,
        blockedByPhaseIndex: failedIndex,
        blockedByPhaseName: phaseName,
        remediationAction: `Fix error in Phase ${phaseNum} (${phaseName}) or restart automation`
      };
      this.debugLogger.logPhaseStall(this.toPhaseDiagnosticInfo(nextPhase), stallReason);
    }
  }

  /**
   * Returns a real-time PlanPhasesAuditReport reflecting current execution and phase states.
   */
  public getPhaseAuditReport(): PlanPhasesAuditReport {
    const folder =
      this.currentPlanFolder ||
      (this.phases.length > 0
        ? path.dirname(this.phases[0].nativePath || this.phases[0].filePath)
        : '');
    const normFolder = normalizePath(folder ? path.resolve(folder) : '');

    if (this.phases.length === 0) {
      return {
        folderPath: normFolder,
        totalPhases: 0,
        completedCount: 0,
        pendingCount: 0,
        failedCount: 0,
        skippedCount: 0,
        phases: [],
        hasBlockers: false
      };
    }

    const executionContext: PhaseExecutionContext = {
      orchestratorState: this.state,
      currentPhaseIndex: this.currentPhaseIndex,
      preflightReady: this.lastPreflightResult ? this.lastPreflightResult.ready : undefined,
      preflightError: this.lastPreflightResult?.errorMessage,
      activePhases: this.phases.map((p) => ({
        index: p.index,
        phaseNumber: p.phaseNumber,
        fileName: p.fileName,
        status: p.status,
        error: p.error,
        conversationId: p.conversationId,
        startTime: p.startTime,
        endTime: p.endTime,
        executionTimeMs:
          p.startTime && p.endTime
            ? p.endTime - p.startTime
            : p.startTime
            ? Date.now() - p.startTime
            : undefined
      }))
    };

    const diagnosticPhases: PhaseDiagnosticInfo[] = this.phases.map((p, idx) => {
      const isSelected = p.status !== 'Skipped';
      const diag: PhaseDiagnosticInfo = {
        index: p.index,
        phaseNumber: p.phaseNumber || idx + 1,
        fileName: p.fileName,
        filePath: p.filePath,
        status: p.status,
        isCompleted: p.status === 'Completed',
        isSelected,
        error: p.error,
        stallReason: p.stallReason,
        conversationId: p.conversationId,
        executionTimeMs:
          p.startTime && p.endTime
            ? p.endTime - p.startTime
            : p.startTime
            ? Date.now() - p.startTime
            : undefined
      };
      return diag;
    });

    for (let i = 0; i < diagnosticPhases.length; i++) {
      if (!diagnosticPhases[i].stallReason) {
        diagnosticPhases[i].stallReason = analyzePhaseStallReason(
          diagnosticPhases[i],
          diagnosticPhases,
          i,
          executionContext
        );
      }
    }

    const totalPhases = diagnosticPhases.length;
    const completedCount = diagnosticPhases.filter((p) => p.status === 'Completed').length;
    const pendingCount = diagnosticPhases.filter((p) => p.status === 'Pending').length;
    const failedCount = diagnosticPhases.filter((p) => p.status === 'Failed').length;
    const skippedCount = diagnosticPhases.filter((p) => p.status === 'Skipped').length;
    const runningPhase = diagnosticPhases.find((p) => p.status === 'Running');

    const hasBlockers =
      failedCount > 0 ||
      executionContext.preflightReady === false ||
      diagnosticPhases.some(
        (p) =>
          p.stallReason?.code === 'BLOCKED_BY_PREVIOUS_FAILURE' ||
          p.stallReason?.code === 'PREFLIGHT_TRANSPORT_FAILURE' ||
          p.stallReason?.code === 'UNRECOGNIZED_HEADER_SYNTAX'
      );

    let primaryBlockerReason: string | undefined = undefined;
    if (executionContext.preflightReady === false || executionContext.preflightError) {
      primaryBlockerReason =
        executionContext.preflightError || 'Pre-flight transport readiness check failed';
    } else if (failedCount > 0) {
      const failed = diagnosticPhases.find((p) => p.status === 'Failed');
      primaryBlockerReason = failed?.error || `Phase ${failed?.phaseNumber || ''} failed`;
    } else {
      const blockerPhase = diagnosticPhases.find(
        (p) =>
          p.stallReason?.code === 'BLOCKED_BY_PREVIOUS_FAILURE' ||
          p.stallReason?.code === 'PREFLIGHT_TRANSPORT_FAILURE' ||
          p.stallReason?.code === 'UNRECOGNIZED_HEADER_SYNTAX'
      );
      if (blockerPhase) {
        primaryBlockerReason = blockerPhase.stallReason?.description;
      }
    }

    return {
      folderPath: normFolder,
      totalPhases,
      completedCount,
      pendingCount,
      failedCount,
      skippedCount,
      runningPhase,
      phases: diagnosticPhases,
      hasBlockers,
      primaryBlockerReason
    };
  }

  /**
   * Shows actionable error notification for pre-flight failures offering settings and setup options.
   */
  public async showPreflightActionableNotification(errorMessage: string): Promise<string | undefined> {
    return this.actionableErrorNotifier(
      errorMessage,
      '⚙️ Open Settings Panel',
      '⚡ 1-Click DOM Bridge Setup',
      'Install Guide'
    );
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
    this.removeAllListeners('warning');
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

  public setLastConversationId(id?: string): void {
    this.lastConversationId = id;
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

    this.currentPlanFolder = folderPath;
    this.setState('scanning', `Scanning plan folder: ${folderPath}`);
    this.debugLogger.info('ORCHESTRATOR', `Scanning plan folder: ${folderPath}`);

    const phaseFiles = await scanPlanFolderAsync(folderPath);

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
   * Alias for startFolder for discovering and executing a plan folder asynchronously.
   */
  public async startPlanFolder(
    folderPath: string,
    options?: { startFromIndex?: number; overrideConfig?: Partial<AutoPlanConfig> }
  ): Promise<boolean> {
    return this.startFolder(folderPath, options);
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

    const firstItem = phaseFiles[0];
    const firstPath = typeof firstItem === 'string' ? firstItem : firstItem.filePath;
    this.currentPlanFolder = path.dirname(path.resolve(firstPath));

    // Pre-flight health guard check (< 100ms fail-fast)
    const baseConfig = this.configProvider();
    const config: AutoPlanConfig = {
      ...baseConfig,
      ...options?.overrideConfig
    };

    let readiness = this.promptDispatcher.validateDispatchReadiness(
      undefined,
      config.executionMode,
      config.allowTierFallback
    );
    if (!readiness.ready && (config.executionMode === 'auto' || config.executionMode === 'domBridge')) {
      readiness = await this.promptDispatcher.ensureBridgeReadinessWithWakeup(
        200,
        undefined,
        config.executionMode,
        config.allowTierFallback
      );
    }
    this.lastPreflightResult = readiness;
    if (!readiness.ready) {
      const mode = config.executionMode || 'auto';
      const detail = readiness.errorMessage || 'No usable prompt transport available.';
      const errorMsg = `Pre-flight check failed for selected mode '${mode}'. ${detail}`;
      this.debugLogger.warn('DISPATCHER', errorMsg, {
        stallCode: 'PREFLIGHT_TRANSPORT_FAILURE',
        executionMode: mode,
        readiness
      });
      this.setState('error', errorMsg);
      this.emit('error', new Error(errorMsg));
      await this.showPreflightActionableNotification(errorMsg);
      return false;
    }

    if (readiness.warningMessage && readiness.requiresForegroundFocus) {
      this.debugLogger.warn('DISPATCHER', readiness.warningMessage);
      this.emit('warning', readiness.warningMessage);
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
    this.stopStallWatchdog();

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
   * Waits for a new conversation to appear after phaseStartTime.
   * If expectNew is true, a timeout throws NewConversationTimeoutError rather than returning stale conversation IDs.
   */
  public async waitForNewConversation(
    phaseStartTime: number,
    lastConvId?: string,
    timeoutMs: number = 8000,
    pollIntervalMs?: number,
    expectNew: boolean = true,
    diagnosticContext?: { phaseIndex?: number; fileName?: string }
  ): Promise<string> {
    const actualTimeoutMs = timeoutMs ?? 8000;
    const heartbeatTimers: NodeJS.Timeout[] = [];
    const clearHeartbeats = () => {
      for (const timer of heartbeatTimers) {
        clearTimeout(timer);
      }
      heartbeatTimers.length = 0;
    };

    if (actualTimeoutMs > 3000) {
      const t3 = setTimeout(() => {
        this.debugLogger.info(
          'ORCHESTRATOR',
          `Conversation directory detection in progress (elapsed: 3000ms, timeout: ${actualTimeoutMs}ms)${diagnosticContext?.fileName ? ` for ${diagnosticContext.fileName}` : ''}...`,
          {
            phaseIndex: diagnosticContext?.phaseIndex,
            fileName: diagnosticContext?.fileName,
            elapsedMs: 3000,
            timeoutMs: actualTimeoutMs
          }
        );
      }, 3000);
      if (typeof t3.unref === 'function') {
        t3.unref();
      }
      heartbeatTimers.push(t3);
    }

    if (actualTimeoutMs > 4000) {
      const t4 = setTimeout(() => {
        this.debugLogger.warn(
          'ORCHESTRATOR',
          `Conversation discovery is taking longer than expected (${diagnosticContext?.fileName || 'phase'}). Awaiting backend filesystem creation (elapsed: 4000ms)...`,
          {
            phaseIndex: diagnosticContext?.phaseIndex,
            fileName: diagnosticContext?.fileName,
            elapsedMs: 4000,
            timeoutMs: actualTimeoutMs
          }
        );
      }, 4000);
      if (typeof t4.unref === 'function') {
        t4.unref();
      }
      heartbeatTimers.push(t4);
    }

    if (actualTimeoutMs > 6000) {
      const t6 = setTimeout(() => {
        this.debugLogger.info(
          'ORCHESTRATOR',
          `Still awaiting conversation directory detection (elapsed: 6000ms, timeout: ${actualTimeoutMs}ms)${diagnosticContext?.fileName ? ` for ${diagnosticContext.fileName}` : ''}...`,
          {
            phaseIndex: diagnosticContext?.phaseIndex,
            fileName: diagnosticContext?.fileName,
            elapsedMs: 6000,
            timeoutMs: actualTimeoutMs
          }
        );
      }, 6000);
      if (typeof t6.unref === 'function') {
        t6.unref();
      }
      heartbeatTimers.push(t6);
    }

    try {
      return await this.transcriptWatcher.waitForNewConversation(
        phaseStartTime,
        lastConvId,
        actualTimeoutMs,
        pollIntervalMs
      );
    } catch (err: any) {
      if (!expectNew) {
        return lastConvId || 'current_conversation';
      }
      const baseMessage = `Timeout waiting for new conversation after ${actualTimeoutMs}ms. Verify prompt submission status in chat panel.`;
      const timeoutMessage = lastConvId ? `${baseMessage} (stale conversation: ${lastConvId})` : baseMessage;
      if (err instanceof NewConversationTimeoutError) {
        throw new NewConversationTimeoutError(timeoutMessage, {
          phaseIndex: diagnosticContext?.phaseIndex ?? err.phaseIndex,
          fileName: diagnosticContext?.fileName ?? err.fileName,
          lastConversationId: lastConvId ?? err.lastConversationId,
          timeoutMs: actualTimeoutMs ?? err.timeoutMs,
          diagnosticInfo: {
            phaseStartTime,
            lastConversationId: lastConvId,
            ...err.diagnosticInfo
          }
        });
      }
      throw new NewConversationTimeoutError(
        timeoutMessage,
        {
          phaseIndex: diagnosticContext?.phaseIndex,
          fileName: diagnosticContext?.fileName,
          lastConversationId: lastConvId,
          timeoutMs: actualTimeoutMs,
          diagnosticInfo: {
            phaseStartTime,
            lastConversationId: lastConvId,
            originalError: err?.message
          }
        }
      );
    } finally {
      clearHeartbeats();
    }
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

    // Pre-flight health guard check (< 100ms fail-fast)
    let readiness = this.promptDispatcher.validateDispatchReadiness(
      undefined,
      config.executionMode,
      config.allowTierFallback
    );
    if (!readiness.ready && (config.executionMode === 'auto' || config.executionMode === 'domBridge')) {
      readiness = await this.promptDispatcher.ensureBridgeReadinessWithWakeup(
        200,
        undefined,
        config.executionMode,
        config.allowTierFallback
      );
    }
    this.lastPreflightResult = readiness;
    if (!readiness.ready) {
      const mode = config.executionMode || 'auto';
      const detail = readiness.errorMessage || 'No usable prompt transport available.';
      const errorMsg = `Pre-flight check failed for selected mode '${mode}'. ${detail}`;
      this.debugLogger.warn('DISPATCHER', errorMsg, {
        stallCode: 'PREFLIGHT_TRANSPORT_FAILURE',
        executionMode: mode,
        readiness
      });
      if (this.phases.length > 0) {
        this.debugLogger.logPhaseStall(this.toPhaseDiagnosticInfo(this.phases[0]), {
          code: 'PREFLIGHT_TRANSPORT_FAILURE',
          description: errorMsg,
          remediationAction: 'Run 1-Click DOM Bridge Setup or check transport settings'
        });
      }
      this.setState('error', errorMsg);
      this.emit('error', new Error(errorMsg));
      await this.showPreflightActionableNotification(errorMsg);
      return false;
    }

    if (readiness.warningMessage && readiness.requiresForegroundFocus) {
      this.debugLogger.warn('DISPATCHER', readiness.warningMessage);
      this.emit('warning', readiness.warningMessage);
    }

    this.isAborted = false;
    this.isSkippingCurrentPhase = false;
    this.totalIterations = this.phases.length;

    // Reset statuses of phases from startIndex onwards
    for (let i = startIndex; i < this.phases.length; i++) {
      this.phases[i].status = 'Pending';
      this.phases[i].error = undefined;
      this.phases[i].result = undefined;
      this.phases[i].dispatchResult = undefined;
      this.phases[i].startOffset = undefined;
    }

    try {
      for (let i = startIndex; i < this.phases.length; i++) {
        if (this.isAborted) break;

        const phase = this.phases[i];
        this.currentPhaseIndex = i;
        this.currentIteration = i + 1;
        phase.status = 'Running';
        phase.startTime = Date.now();

        // Measure pre-dispatch offset if lastConversationId is known
        let initialOffset = 0;
        let initialTranscriptLength = 0;
        if (this.lastConversationId && this.lastConversationId !== 'current_conversation') {
          const convDir = path.join(this.transcriptWatcher.getOptions().brainDir, this.lastConversationId);
          const transcriptPath = getTranscriptPath(convDir);
          if (transcriptPath && fs.existsSync(transcriptPath)) {
            try {
              initialOffset = fs.statSync(transcriptPath).size;
              const content = fs.readFileSync(transcriptPath, 'utf8');
              initialTranscriptLength = content.split('\n').filter(l => l.trim().length > 0).length;
            } catch {
              initialOffset = 0;
              initialTranscriptLength = 0;
            }
          }
        }
        phase.startOffset = initialOffset;
        phase.initialTranscriptLength = initialTranscriptLength;

        // 1. Render Prompt Template & Emit Phase Start Event
        const template = config.promptTemplate || config.promptText || DEFAULT_PROMPT_TEMPLATE;
        const renderedPrompt = renderPromptTemplate(template, phase.filePath);

        this.debugLogger.logPhaseEvent(
          this.toPhaseDiagnosticInfo(phase),
          'START',
          `Starting execution for ${phase.fileName}`,
          {
            phaseIndex: i,
            filePath: phase.filePath,
            promptPreview: this.debugLogger.sanitizePrompt(renderedPrompt)
          }
        );

        this.emit('phaseStart', phase, i, this.phases.length, phase.fileName, phase.filePath);

        // 2. Timestamp & Reset
        const phaseStartTime = Date.now();

        // 3. New Conversation Trigger, Focus, Paste & Submit via PromptDispatcher (3-Tier)
        this.setState('sending', `Phase ${i + 1}/${this.phases.length}: Sending prompt for ${phase.fileName}`);

        const dispatchOptions: DispatchOptions = {
          mode: config.executionMode,
          allowFallback: config.allowTierFallback,
          timeoutMs: config.bridgeTimeoutMs,
          openNewConversation: true,
          keyboardOptions: {
            focusDelayMs: config.focusDelayMs
          }
        };

        let dispatchResult: DispatchResult;
        try {
          dispatchResult = await this.promptDispatcher.dispatchPrompt(renderedPrompt, dispatchOptions);
          phase.dispatchResult = dispatchResult;
        } catch (dispatchErr: any) {
          phase.status = 'Failed';
          phase.endTime = Date.now();
          const errMsg = dispatchErr?.message || String(dispatchErr);
          phase.error = errMsg;
          phase.dispatchResult = {
            success: false,
            tier: (config.executionMode === 'auto' ? 'domBridge' : config.executionMode) as any,
            durationMs: 0,
            error: errMsg
          };
          this.debugLogger.logPhaseEvent(
            this.toPhaseDiagnosticInfo(phase),
            'FAIL',
            `Prompt dispatch failed for ${phase.fileName}: ${errMsg}`,
            {
              phaseIndex: i,
              error: errMsg,
              stack: dispatchErr?.stack
            }
          );
          this.diagnoseSubsequentPhasesOnFailure(i, errMsg);
          throw dispatchErr;
        }

        if (!dispatchResult.success) {
          phase.status = 'Failed';
          phase.endTime = Date.now();
          phase.error = dispatchResult.error || 'Prompt dispatch failed';
          phase.dispatchResult = dispatchResult;
          this.debugLogger.logPhaseEvent(
            this.toPhaseDiagnosticInfo(phase),
            'FAIL',
            `Prompt dispatch failed for ${phase.fileName}: ${phase.error}`,
            { phaseIndex: i, dispatchResult }
          );
          this.diagnoseSubsequentPhasesOnFailure(i, phase.error);
          throw new Error(phase.error);
        }

        this.debugLogger.info(
          'DISPATCHER',
          `Prompt dispatched for ${phase.fileName} via ${dispatchResult.tier} tier in ${dispatchResult.durationMs}ms`,
          {
            phaseIndex: i,
            fileName: phase.fileName,
            tier: dispatchResult.tier,
            durationMs: dispatchResult.durationMs,
            success: dispatchResult.success
          }
        );

        if (this.isAborted) break;
        if (this.isSkippingCurrentPhase) {
          this.stopStallWatchdog();
          phase.status = 'Skipped';
          phase.endTime = Date.now();
          this.debugLogger.logPhaseEvent(
            this.toPhaseDiagnosticInfo(phase),
            'SKIP',
            `Phase ${phase.phaseNumber || i + 1} (${phase.fileName}) skipped by user`,
            { phaseIndex: i }
          );
          this.emit('skipped', phase);
          this.isSkippingCurrentPhase = false;
          continue;
        }

        // 6. Anti-Pollution Watcher & Proactive Stall Watchdog
        this.setState('waiting', `Phase ${i + 1}/${this.phases.length}: Waiting for completion of ${phase.fileName}`);
        this.debugLogger.info(
          'ORCHESTRATOR',
          `Watching transcript for ${phase.fileName} starting from timestamp ${phaseStartTime}`,
          {
            phaseIndex: i,
            fileName: phase.fileName,
            phaseStartTime,
            pollIntervalMs: this.transcriptWatcher.getOptions().pollIntervalMs
          }
        );

        const watchdogThreshold = config.timeoutPerLoopMinutes
          ? Math.min(this.stallWatchdogThresholdMs, config.timeoutPerLoopMinutes * 60 * 1000 * 0.5)
          : this.stallWatchdogThresholdMs;
        this.startStallWatchdog(phase, i, watchdogThreshold);

        const onPhaseRebound = (oldConvId: string, newConvId: string, newFilePath: string) => {
          phase.conversationId = newConvId;
          this.lastConversationId = newConvId;
          this.debugLogger.info(
            'ORCHESTRATOR',
            `Dynamic conversation rebound for ${phase.fileName}: ${oldConvId} -> ${newConvId} (${newFilePath})`,
            {
              phaseIndex: i,
              fileName: phase.fileName,
              oldConvId,
              newConvId,
              newFilePath
            }
          );
          this.setState(this.state, undefined, newConvId);
        };
        this.transcriptWatcher.on('conversationRebound', onPhaseRebound);

        let convId: string;
        let completionResult: CompletionResult;
        const convTimeoutMs = config.newConversationTimeoutMs || 8000;

        try {
          try {
            convId = await this.waitForNewConversation(
              phaseStartTime,
              this.lastConversationId,
              convTimeoutMs,
              this.transcriptWatcher.getOptions().pollIntervalMs,
              dispatchOptions.openNewConversation !== false,
              { phaseIndex: i, fileName: phase.fileName }
            );
          } catch (err: any) {
            if (this.isSkippingCurrentPhase) {
              this.stopStallWatchdog();
              phase.status = 'Skipped';
              phase.endTime = Date.now();
              this.debugLogger.logPhaseEvent(
                this.toPhaseDiagnosticInfo(phase),
                'SKIP',
                `Phase ${phase.phaseNumber || i + 1} (${phase.fileName}) skipped during conversation wait`,
                { phaseIndex: i }
              );
              this.emit('skipped', phase);
              this.isSkippingCurrentPhase = false;
              continue;
            }
            if (this.isAborted) break;

            if (err instanceof NewConversationTimeoutError) {
              this.stopStallWatchdog();
              phase.status = 'Failed';
              phase.endTime = Date.now();
              phase.error = err.message;
              const stallReason: PhaseStallReason = {
                code: 'AI_RESPONSE_TIMEOUT',
                description: `Timeout waiting for new conversation after ${convTimeoutMs}ms. Verify prompt submission status in chat panel.`,
                remediationAction: 'Verify prompt submission status in chat panel.'
              };
              phase.stallReason = stallReason;
              this.debugLogger.logPhaseStall(this.toPhaseDiagnosticInfo(phase), stallReason);
              this.debugLogger.logPhaseEvent(
                this.toPhaseDiagnosticInfo(phase),
                'FAIL',
                `New conversation timeout for ${phase.fileName}: ${err.message}`,
                {
                  phaseIndex: i,
                  error: err.message,
                  stack: err.stack,
                  diagnosticInfo: err.diagnosticInfo
                }
              );
              this.diagnoseSubsequentPhasesOnFailure(i, err.message);
              throw err;
            }

            convId = this.lastConversationId || 'current_conversation';
          }

          if (convId && convId !== 'current_conversation') {
            phase.conversationId = convId;
            this.debugLogger.info('ORCHESTRATOR', `Detected conversation ${convId} for ${phase.fileName}`, {
              phaseIndex: i,
              fileName: phase.fileName,
              conversationId: convId
            });
          }

          if (this.isAborted) break;
          if (this.isSkippingCurrentPhase) {
            this.stopStallWatchdog();
            phase.status = 'Skipped';
            phase.endTime = Date.now();
            this.debugLogger.logPhaseEvent(
              this.toPhaseDiagnosticInfo(phase),
              'SKIP',
              `Phase ${phase.phaseNumber || i + 1} (${phase.fileName}) skipped by user`,
              { phaseIndex: i }
            );
            this.emit('skipped', phase);
            this.isSkippingCurrentPhase = false;
            continue;
          }

          // 7. Strict Completion Await
          if (convId !== 'current_conversation') {
            const convDir = path.join(this.transcriptWatcher.getOptions().brainDir, convId);
            const transcriptPath = getTranscriptPath(convDir);
            let offsetToUse = 0;
            if (convId === this.lastConversationId) {
              if (phase.startOffset !== undefined && phase.startOffset > 0) {
                offsetToUse = phase.startOffset;
              } else if (transcriptPath && fs.existsSync(transcriptPath)) {
                try {
                  offsetToUse = fs.statSync(transcriptPath).size;
                  phase.startOffset = offsetToUse;
                } catch {
                  offsetToUse = 0;
                }
              }
            } else {
              offsetToUse = phase.startOffset !== undefined ? phase.startOffset : 0;
            }

            if (transcriptPath) {
              completionResult = await this.transcriptWatcher.watchFile(
                transcriptPath,
                convId,
                offsetToUse,
                phaseStartTime,
                phase.initialTranscriptLength
              );
            } else {
              completionResult = await this.transcriptWatcher.watchLatest(phaseStartTime, this.lastConversationId, phase.initialTranscriptLength);
            }
          } else {
            if (this.lastConversationId) {
              const convDir = path.join(this.transcriptWatcher.getOptions().brainDir, this.lastConversationId);
              const transcriptPath = getTranscriptPath(convDir);
              let offsetToUse = phase.startOffset;
              if ((offsetToUse === undefined || offsetToUse === 0) && transcriptPath && fs.existsSync(transcriptPath)) {
                try {
                  offsetToUse = fs.statSync(transcriptPath).size;
                  phase.startOffset = offsetToUse;
                } catch {
                  offsetToUse = 0;
                }
              }
              if (transcriptPath && fs.existsSync(transcriptPath)) {
                completionResult = await this.transcriptWatcher.watchFile(
                  transcriptPath,
                  this.lastConversationId,
                  offsetToUse || 0,
                  phaseStartTime,
                  phase.initialTranscriptLength
                );
              } else {
                completionResult = await this.transcriptWatcher.watchLatest(phaseStartTime, this.lastConversationId, phase.initialTranscriptLength);
              }
            } else {
              completionResult = await this.transcriptWatcher.watchLatest(phaseStartTime, this.lastConversationId, phase.initialTranscriptLength);
            }
          }
        } finally {
          this.transcriptWatcher.removeListener('conversationRebound', onPhaseRebound);
        }

        this.stopStallWatchdog();

        if (this.isSkippingCurrentPhase) {
          phase.status = 'Skipped';
          phase.endTime = Date.now();
          this.debugLogger.logPhaseEvent(
            this.toPhaseDiagnosticInfo(phase),
            'SKIP',
            `Phase ${phase.phaseNumber || i + 1} (${phase.fileName}) skipped by user`,
            { phaseIndex: i }
          );
          this.emit('skipped', phase);
          this.isSkippingCurrentPhase = false;
          continue;
        }

        if (this.isAborted) break;

        if (!completionResult.success) {
          phase.status = 'Failed';
          phase.endTime = Date.now();
          phase.error = completionResult.error || `Phase ${phase.fileName} failed`;
          this.debugLogger.logPhaseEvent(
            this.toPhaseDiagnosticInfo(phase),
            'FAIL',
            `Phase ${phase.fileName} failed: ${phase.error}`,
            { phaseIndex: i, error: phase.error }
          );
          this.diagnoseSubsequentPhasesOnFailure(i, phase.error);
          throw new Error(phase.error);
        }

        // 8. Update Tracking & Log Phase Completion
        this.lastConversationId =
          completionResult.conversationId ||
          (convId !== 'current_conversation' ? convId : this.lastConversationId);
        phase.conversationId = this.lastConversationId;
        phase.status = 'Completed';
        phase.endTime = Date.now();
        phase.result = {
          ...completionResult,
          metadata: {
            ...completionResult.parsed,
            dispatch: dispatchResult
          }
        };

        const phaseDuration = phase.endTime - (phase.startTime || phaseStartTime);
        const keywordMatched = completionResult.matchedContent || config.completionKeyword;
        this.debugLogger.logPhaseEvent(
          this.toPhaseDiagnosticInfo(phase),
          'COMPLETE',
          `Phase ${phase.phaseNumber || i + 1} (${phase.fileName}) completed in ${(phaseDuration / 1000).toFixed(1)}s (keyword: "${keywordMatched}")`,
          {
            phaseIndex: i,
            fileName: phase.fileName,
            durationMs: phaseDuration,
            conversationId: phase.conversationId,
            matchedKeyword: keywordMatched
          }
        );

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

      this.stopStallWatchdog();

      if (this.isAborted) {
        for (const phase of this.phases) {
          if (phase.status === 'Running') {
            phase.status = 'Stopped';
            phase.endTime = Date.now();
          }
        }
        this.setState('stopped', 'Stopped by user');
        this.debugLogger.info('ORCHESTRATOR', 'Orchestration execution stopped by user');
        this.emit('stopped');
        return false;
      }

      this.setState('completed', 'All phases completed');
      this.debugLogger.info('ORCHESTRATOR', `All ${this.phases.length} phases completed successfully`);
      this.emit('allComplete', this.phases.length);
      return true;
    } catch (err: any) {
      this.stopStallWatchdog();
      if (this.isAborted) {
        for (const phase of this.phases) {
          if (phase.status === 'Running') {
            phase.status = 'Stopped';
            phase.endTime = Date.now();
          }
        }
        this.setState('stopped', 'Stopped by user');
        this.debugLogger.info('ORCHESTRATOR', 'Orchestration execution stopped by user');
        this.emit('stopped');
        return false;
      }
      if (this.currentPhaseIndex >= 0 && this.currentPhaseIndex < this.phases.length) {
        const curPhase = this.phases[this.currentPhaseIndex];
        if (curPhase.status === 'Running') {
          curPhase.status = 'Failed';
          curPhase.endTime = Date.now();
          curPhase.error = err?.message || String(err);
        }
      }
      const errMsg = err.message || String(err);
      this.setState('error', errMsg);
      this.debugLogger.error('ORCHESTRATOR', `Orchestrator sequence error: ${errMsg}`, undefined, err);
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

    // Pre-flight health guard check (< 100ms fail-fast)
    let readiness = this.promptDispatcher.validateDispatchReadiness(
      undefined,
      config.executionMode,
      config.allowTierFallback
    );
    if (!readiness.ready && (config.executionMode === 'auto' || config.executionMode === 'domBridge')) {
      readiness = await this.promptDispatcher.ensureBridgeReadinessWithWakeup(
        200,
        undefined,
        config.executionMode,
        config.allowTierFallback
      );
    }
    this.lastPreflightResult = readiness;
    if (!readiness.ready) {
      const mode = config.executionMode || 'auto';
      const detail = readiness.errorMessage || 'No usable prompt transport available.';
      const errorMsg = `Pre-flight check failed for selected mode '${mode}'. ${detail}`;
      this.debugLogger.warn('DISPATCHER', errorMsg, {
        stallCode: 'PREFLIGHT_TRANSPORT_FAILURE',
        executionMode: mode,
        readiness
      });
      this.setState('error', errorMsg);
      this.emit('error', new Error(errorMsg));
      await this.showPreflightActionableNotification(errorMsg);
      return false;
    }

    if (readiness.warningMessage && readiness.requiresForegroundFocus) {
      this.debugLogger.warn('DISPATCHER', readiness.warningMessage);
      this.emit('warning', readiness.warningMessage);
    }

    this.isAborted = false;
    this.totalIterations = config.repeatCount;
    this.currentIteration = 0;
    this.currentPhaseIndex = -1;

    try {
      for (let i = 1; i <= this.totalIterations; i++) {
        if (this.isAborted) break;

        this.currentIteration = i;

        // Measure pre-dispatch offset if lastConversationId is known
        let preDispatchOffset = 0;
        if (this.lastConversationId && this.lastConversationId !== 'current_conversation') {
          const convDir = path.join(this.transcriptWatcher.getOptions().brainDir, this.lastConversationId);
          const transcriptPath = getTranscriptPath(convDir);
          if (transcriptPath && fs.existsSync(transcriptPath)) {
            try {
              preDispatchOffset = fs.statSync(transcriptPath).size;
            } catch {
              preDispatchOffset = 0;
            }
          }
        }

        // Step 1: Sending prompt via PromptDispatcher
        this.setState('sending', 'Sending Prompt...');
        this.debugLogger.info('ORCHESTRATOR', `Sending prompt for iteration ${i}/${this.totalIterations}`);
        const timestampBeforeSend = Date.now();

        const dispatchOptions: DispatchOptions = {
          mode: config.executionMode,
          allowFallback: config.allowTierFallback,
          timeoutMs: config.bridgeTimeoutMs,
          openNewConversation: true,
          keyboardOptions: {
            focusDelayMs: config.focusDelayMs
          }
        };

        await this.promptDispatcher.dispatchPrompt(config.promptText, dispatchOptions);

        if (this.isAborted) break;

        // Step 2: Listening for completion keyword
        this.setState('waiting', 'Waiting for Agent...');
        this.debugLogger.info('ORCHESTRATOR', `Waiting for agent response for iteration ${i}/${this.totalIterations}`);

        const onIterationRebound = (oldConvId: string, newConvId: string, newFilePath: string) => {
          this.lastConversationId = newConvId;
          this.debugLogger.info(
            'ORCHESTRATOR',
            `Dynamic conversation rebound in loop ${i}: ${oldConvId} -> ${newConvId} (${newFilePath})`,
            {
              iteration: i,
              oldConvId,
              newConvId,
              newFilePath
            }
          );
          this.setState(this.state, undefined, newConvId);
        };
        this.transcriptWatcher.on('conversationRebound', onIterationRebound);

        let convId: string;
        let completionResult: CompletionResult;

        try {
          try {
            const convTimeoutMs = config.newConversationTimeoutMs || 8000;
            convId = await this.waitForNewConversation(
              timestampBeforeSend,
              this.lastConversationId,
              convTimeoutMs,
              100,
              dispatchOptions.openNewConversation !== false
            );
          } catch (err: any) {
            if (this.isAborted) break;
            if (err instanceof NewConversationTimeoutError) {
              this.debugLogger.error('ORCHESTRATOR', `New conversation timeout in run loop: ${err.message}`, {
                iteration: i,
                error: err.message
              });
              throw err;
            }
            convId = this.lastConversationId || 'current_conversation';
          }

          if (this.isAborted) break;

          // Watch conversation transcript
          if (convId !== 'current_conversation') {
            const convDir = path.join(this.transcriptWatcher.getOptions().brainDir, convId);
            const transcriptPath = getTranscriptPath(convDir);
            let offsetToUse = 0;
            if (convId === this.lastConversationId) {
              offsetToUse = preDispatchOffset;
              if (offsetToUse === 0 && transcriptPath && fs.existsSync(transcriptPath)) {
                try {
                  offsetToUse = fs.statSync(transcriptPath).size;
                } catch {
                  offsetToUse = 0;
                }
              }
            }
            if (transcriptPath) {
              completionResult = await this.transcriptWatcher.watchFile(transcriptPath, convId, offsetToUse, timestampBeforeSend);
            } else {
              completionResult = await this.transcriptWatcher.watchLatest(timestampBeforeSend, this.lastConversationId);
            }
          } else {
            if (this.lastConversationId) {
              const convDir = path.join(this.transcriptWatcher.getOptions().brainDir, this.lastConversationId);
              const transcriptPath = getTranscriptPath(convDir);
              let offsetToUse = preDispatchOffset;
              if (offsetToUse === 0 && transcriptPath && fs.existsSync(transcriptPath)) {
                try {
                  offsetToUse = fs.statSync(transcriptPath).size;
                } catch {
                  offsetToUse = 0;
                }
              }
              if (transcriptPath && fs.existsSync(transcriptPath)) {
                completionResult = await this.transcriptWatcher.watchFile(
                  transcriptPath,
                  this.lastConversationId,
                  offsetToUse,
                  timestampBeforeSend
                );
              } else {
                completionResult = await this.transcriptWatcher.watchLatest(timestampBeforeSend, this.lastConversationId);
              }
            } else {
              completionResult = await this.transcriptWatcher.watchLatest(timestampBeforeSend, this.lastConversationId);
            }
          }
        } finally {
          this.transcriptWatcher.removeListener('conversationRebound', onIterationRebound);
        }

        if (this.isAborted) break;

        if (!completionResult.success) {
          this.debugLogger.error('ORCHESTRATOR', `Iteration ${i}/${this.totalIterations} failed`, {
            error: completionResult.error
          });
          throw new Error(completionResult.error || 'Loop iteration failed or timed out');
        }

        this.lastConversationId =
          completionResult.conversationId ||
          (convId !== 'current_conversation' ? convId : this.lastConversationId);
        this.debugLogger.info('ORCHESTRATOR', `Iteration ${i}/${this.totalIterations} completed successfully`);
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
        this.debugLogger.info('ORCHESTRATOR', 'Loop execution stopped by user');
        this.emit('stopped');
        return false;
      }

      this.setState('completed', 'All iterations completed');
      this.debugLogger.info('ORCHESTRATOR', 'All iterations completed successfully');
      this.emit('allComplete', this.totalIterations);
      return true;
    } catch (err: any) {
      if (this.isAborted) {
        this.setState('stopped', 'Stopped by user');
        this.debugLogger.info('ORCHESTRATOR', 'Loop execution stopped by user');
        this.emit('stopped');
        return false;
      }
      const errMsg = err.message || String(err);
      this.setState('error', errMsg);
      this.debugLogger.error('ORCHESTRATOR', `Loop iteration error: ${errMsg}`, undefined, err);
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  /**
   * Stops the orchestrator immediately.
   */
  public stop(): void {
    this.isAborted = true;
    this.stopStallWatchdog();

    for (const phase of this.phases) {
      if (phase.status === 'Running') {
        phase.status = 'Stopped';
        phase.endTime = Date.now();
      }
    }

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
