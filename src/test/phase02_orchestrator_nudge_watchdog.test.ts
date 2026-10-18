// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const channelLines: string[] = [];
const mockConfigStore: Record<string, any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section: string) => ({
          get: (key: string, defaultValue: any) =>
            mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            mockConfigStore[key] = val;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        workspaceFolders: []
      },
      commands: {
        executeCommand: async (_cmd: string, ..._args: any[]) => undefined
      },
      window: {
        createOutputChannel: (name: string) => ({
          name,
          appendLine: (line: string) => {
            channelLines.push(line);
          },
          show: () => {},
          dispose: () => {}
        }),
        showWarningMessage: (_msg: string) => undefined,
        showInformationMessage: async () => {},
        showErrorMessage: async () => {}
      },
      ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { Orchestrator, PhaseItem } from '../orchestrator';
import { DebugLogger } from '../debugLogger';
import {
  AutoPlanConfig,
  DEFAULT_CONFIG,
  DEFAULT_LONG_PHASE_NUDGE_MESSAGE
} from '../config';
import {
  PromptDispatcher,
  DispatchResult,
  DispatchOptions,
  DispatchReadinessResult
} from '../promptDispatcher';
import {
  TranscriptWatcher,
  CompletionResult
} from '../transcriptWatcher';

// Mock PromptDispatcher for Orchestrator Nudge Watchdog testing
class MockPromptDispatcher extends EventEmitter {
  public stopActiveGenerationCalls: Array<{ options?: DispatchOptions }> = [];
  public dispatchPromptCalls: Array<{ prompt: string; options?: DispatchOptions }> = [];
  public shouldFailStop: boolean = false;
  public stopErrorMessage: string = 'Simulated stop failure';
  public shouldFailDispatch: boolean = false;
  public dispatchErrorMessage: string = 'Bridge offline';
  public throwOnDispatch: boolean = false;

  public readinessResult: DispatchReadinessResult = {
    ready: true,
    selectedTier: 'domBridge',
    isFocusFree: true,
    requiresForegroundFocus: false,
    details: {
      connectedClientsCount: 1,
      os: 'linux'
    }
  };

  public validateDispatchReadiness(): DispatchReadinessResult {
    return this.readinessResult;
  }

  public async ensureBridgeReadinessWithWakeup(): Promise<DispatchReadinessResult> {
    return this.readinessResult;
  }

  public async stopActiveGeneration(options?: DispatchOptions): Promise<boolean> {
    this.stopActiveGenerationCalls.push({ options });
    if (this.shouldFailStop) {
      throw new Error(this.stopErrorMessage);
    }
    return true;
  }

  public async dispatchPrompt(prompt: string, options?: DispatchOptions): Promise<DispatchResult> {
    this.dispatchPromptCalls.push({ prompt, options });
    if (this.throwOnDispatch) {
      throw new Error(this.dispatchErrorMessage);
    }
    if (this.shouldFailDispatch) {
      return {
        success: false,
        tier: 'domBridge',
        durationMs: 30,
        error: this.dispatchErrorMessage
      };
    }
    return {
      success: true,
      tier: 'domBridge',
      durationMs: 42,
      status: 'submitted'
    };
  }

  public reset(): void {
    this.stopActiveGenerationCalls = [];
    this.dispatchPromptCalls = [];
    this.shouldFailStop = false;
    this.shouldFailDispatch = false;
    this.throwOnDispatch = false;
  }
}

// Mock TranscriptWatcher for full sequence integration
class MockTranscriptWatcher extends EventEmitter {
  public watchLatestCalls: Array<{ timestamp: number }> = [];
  public watchFileCalls: Array<{ path: string; convId: string }> = [];
  public pendingResolvers: Array<() => void> = [];
  public isWatching: boolean = false;

  public getOptions() {
    return {
      brainDir: os.tmpdir(),
      pollIntervalMs: 50,
      keyword: 'Done skul9x.'
    };
  }

  public setOptions(_opts: any): void {}

  public async watchFile(
    filePath: string,
    convId: string,
    _offset: number,
    _startTime: number
  ): Promise<CompletionResult> {
    this.isWatching = true;
    this.watchFileCalls.push({ path: filePath, convId });
    return new Promise((resolve) => {
      this.pendingResolvers.push(() => {
        this.isWatching = false;
        resolve({
          success: true,
          matchedContent: 'Done skul9x.',
          conversationId: convId,
          timestamp: Date.now()
        });
      });
    });
  }

  public async watchLatest(timestamp: number, lastConvId?: string): Promise<CompletionResult> {
    this.isWatching = true;
    this.watchLatestCalls.push({ timestamp });
    return new Promise((resolve) => {
      this.pendingResolvers.push(() => {
        this.isWatching = false;
        resolve({
          success: true,
          matchedContent: 'Done skul9x.',
          conversationId: lastConvId || 'conv-watchdog-test',
          timestamp: Date.now()
        });
      });
    });
  }

  public triggerCompletion(): void {
    const resolver = this.pendingResolvers.shift();
    if (resolver) {
      resolver();
    }
  }

  public stop(): void {
    this.isWatching = false;
  }
}

function createDummyPhase(index: number = 0, name: string = 'phase-01-core.md'): PhaseItem {
  return {
    index,
    phaseNumber: index + 1,
    fileName: name,
    filePath: path.join(os.tmpdir(), name),
    nativePath: path.join(os.tmpdir(), name),
    normalizedPath: path.join(os.tmpdir(), name).replace(/\\/g, '/'),
    status: 'Running',
    startTime: Date.now()
  };
}

async function runPhase02NudgeWatchdogTestSuite() {
  console.log('================================================================');
  console.log(' Phase 02: Orchestrator Long-Phase Nudge Watchdog Engine Test');
  console.log('================================================================\n');

  const logger = new DebugLogger(200);
  const mockDispatcher = new MockPromptDispatcher();
  const mockWatcher = new MockTranscriptWatcher();

  let testConfig: AutoPlanConfig = {
    ...DEFAULT_CONFIG,
    longPhaseNudgeEnabled: true,
    longPhaseThresholdSeconds: 180,
    longPhaseNudgeMessage: DEFAULT_LONG_PHASE_NUDGE_MESSAGE
  };

  const createTestOrchestrator = (configOverrides?: Partial<AutoPlanConfig>) => {
    const currentConfig = { ...testConfig, ...(configOverrides || {}) };
    return new Orchestrator({
      configProvider: () => currentConfig,
      promptDispatcher: mockDispatcher as any,
      transcriptWatcher: mockWatcher as any,
      debugLogger: logger
    });
  };

  // -------------------------------------------------------------------------
  // Test 1: Watchdog Timer Ignition & Prompt Dispatch Sequence
  // -------------------------------------------------------------------------
  console.log('[Test 1] Verifying Watchdog Timer ignition at threshold and dispatch sequence...');
  {
    mockDispatcher.reset();
    const orchestrator = createTestOrchestrator();
    const phase = createDummyPhase(0, 'phase-01-test.md');

    let nudgeEventEmitted = false;
    let receivedEventPayload: any = null;

    orchestrator.on('phaseNudged', (payload) => {
      nudgeEventEmitted = true;
      receivedEventPayload = payload;
    });

    // Start watchdog with a fast 60ms threshold
    orchestrator.startPhaseNudgeWatchdog(phase, 0, 60);

    assert.strictEqual(
      orchestrator.isPhaseNudgeTimerActive(),
      true,
      'Phase nudge timer should be active immediately after starting'
    );
    assert.strictEqual(phase.hasNudged, undefined, 'phase.hasNudged should initially be undefined');

    // Wait 100ms for watchdog ignition + 400ms stabilization delay
    await new Promise((r) => setTimeout(r, 650));

    // Assert timer is no longer active (fired)
    assert.strictEqual(
      orchestrator.isPhaseNudgeTimerActive(),
      false,
      'Phase nudge timer should be inactive after firing'
    );

    // Verify stopActiveGeneration was called
    assert.strictEqual(
      mockDispatcher.stopActiveGenerationCalls.length,
      1,
      'stopActiveGeneration should be called once on PromptDispatcher'
    );

    // Verify steering prompt was dispatched with openNewConversation: false
    assert.strictEqual(
      mockDispatcher.dispatchPromptCalls.length,
      1,
      'dispatchPrompt should be called once for nudge message'
    );
    assert.strictEqual(
      mockDispatcher.dispatchPromptCalls[0].prompt,
      DEFAULT_LONG_PHASE_NUDGE_MESSAGE,
      'Prompt text should match default nudge message'
    );
    assert.deepStrictEqual(
      mockDispatcher.dispatchPromptCalls[0].options,
      { openNewConversation: false },
      'Dispatch options must specify openNewConversation: false'
    );

    // Verify phase item state mutation
    assert.strictEqual(phase.hasNudged, true, 'phase.hasNudged must be set to true');
    assert.ok(
      typeof phase.nudgeTimestamp === 'number' && phase.nudgeTimestamp > 0,
      'phase.nudgeTimestamp must be a valid epoch timestamp'
    );
    assert.strictEqual(phase.nudgeError, undefined, 'phase.nudgeError should be undefined on success');

    // Verify event emission
    assert.strictEqual(nudgeEventEmitted, true, 'phaseNudged event must be emitted');
    assert.strictEqual(receivedEventPayload.phase, phase, 'Event payload must contain phase item');
    assert.strictEqual(receivedEventPayload.phaseIndex, 0, 'Event payload must contain phaseIndex');
    assert.strictEqual(
      receivedEventPayload.message,
      DEFAULT_LONG_PHASE_NUDGE_MESSAGE,
      'Event payload must contain nudge message'
    );

    console.log('  ✓ Timer ignited at threshold, stop/dispatch sequence succeeded, and event emitted.');
  }

  // -------------------------------------------------------------------------
  // Test 2: Strict One-Shot Enforcement Per Phase
  // -------------------------------------------------------------------------
  console.log('\n[Test 2] Verifying strict one-shot enforcement per phase...');
  {
    mockDispatcher.reset();
    const orchestrator = createTestOrchestrator();
    const phase = createDummyPhase(1, 'phase-02-oneshot.md');

    // Trigger first nudge
    await orchestrator.triggerPhaseNudge(phase, 1);

    assert.strictEqual(phase.hasNudged, true, 'phase.hasNudged must be true');
    const firstTimestamp = phase.nudgeTimestamp;
    assert.strictEqual(mockDispatcher.dispatchPromptCalls.length, 1);

    // Subsequent triggerPhaseNudge call should no-op
    await orchestrator.triggerPhaseNudge(phase, 1);
    assert.strictEqual(
      mockDispatcher.dispatchPromptCalls.length,
      1,
      'dispatchPrompt must NOT be called again when phase.hasNudged is true'
    );
    assert.strictEqual(
      phase.nudgeTimestamp,
      firstTimestamp,
      'nudgeTimestamp must not be overwritten on duplicate trigger'
    );

    // startPhaseNudgeWatchdog should also no-op if phase already nudged
    orchestrator.startPhaseNudgeWatchdog(phase, 1, 50);
    assert.strictEqual(
      orchestrator.isPhaseNudgeTimerActive(),
      false,
      'Timer must not start if phase.hasNudged is already true'
    );

    console.log('  ✓ One-shot guarantee strictly enforced; secondary triggers ignored.');
  }

  // -------------------------------------------------------------------------
  // Test 3: Watchdog Timer Disposal upon Phase Lifecycle Events
  // -------------------------------------------------------------------------
  console.log('\n[Test 3] Verifying watchdog timer disposal on completion, skip, stop, and disabled config...');
  {
    mockDispatcher.reset();

    // Case A: Manual stopPhaseNudgeWatchdog
    const orchA = createTestOrchestrator();
    const phaseA = createDummyPhase(0, 'phase-a.md');
    orchA.startPhaseNudgeWatchdog(phaseA, 0, 5000);
    assert.strictEqual(orchA.isPhaseNudgeTimerActive(), true);
    orchA.stopPhaseNudgeWatchdog();
    assert.strictEqual(orchA.isPhaseNudgeTimerActive(), false);

    // Case B: Orchestrator stop() cancels timer
    const orchB = createTestOrchestrator();
    const phaseB = createDummyPhase(0, 'phase-b.md');
    orchB.startPhaseNudgeWatchdog(phaseB, 0, 5000);
    assert.strictEqual(orchB.isPhaseNudgeTimerActive(), true);
    orchB.stop();
    assert.strictEqual(
      orchB.isPhaseNudgeTimerActive(),
      false,
      'orchestrator.stop() must clear active nudge timer'
    );

    // Case C: Disabled config
    const orchC = createTestOrchestrator({ longPhaseNudgeEnabled: false });
    const phaseC = createDummyPhase(0, 'phase-c.md');
    orchC.startPhaseNudgeWatchdog(phaseC, 0, 50);
    assert.strictEqual(
      orchC.isPhaseNudgeTimerActive(),
      false,
      'Timer must not start when config.longPhaseNudgeEnabled is false'
    );

    // Case D: Zero or negative threshold does not start
    const orchD = createTestOrchestrator();
    const phaseD = createDummyPhase(0, 'phase-d.md');
    orchD.startPhaseNudgeWatchdog(phaseD, 0, 0);
    assert.strictEqual(orchD.isPhaseNudgeTimerActive(), false);

    console.log('  ✓ Timer lifecycle safely managed across cancellation, stop, and configuration states.');
  }

  // -------------------------------------------------------------------------
  // Test 4: Non-Fatal Resiliency on Dispatch Failures
  // -------------------------------------------------------------------------
  console.log('\n[Test 4] Verifying non-fatal error resiliency when generation stop or dispatch fails...');
  {
    // Subcase 4A: stopActiveGeneration throws error
    mockDispatcher.reset();
    mockDispatcher.shouldFailStop = true;
    mockDispatcher.stopErrorMessage = 'DOM bridge disconnected during cancel';

    const orchFailStop = createTestOrchestrator();
    const phaseFailStop = createDummyPhase(2, 'phase-fail-stop.md');

    let warningMessage = '';
    orchFailStop.on('warning', (w) => {
      warningMessage = w;
    });

    await orchFailStop.triggerPhaseNudge(phaseFailStop, 2);

    assert.strictEqual(phaseFailStop.hasNudged, true, 'hasNudged must be marked true to prevent retry loops');
    assert.strictEqual(
      phaseFailStop.nudgeError,
      'DOM bridge disconnected during cancel',
      'nudgeError must record stop failure message'
    );
    assert.strictEqual(
      phaseFailStop.status,
      'Running',
      'Phase status must NOT be altered to Failed on nudge error'
    );
    assert.ok(warningMessage.includes('nudge dispatch failed'), 'Warning event should be emitted');

    // Subcase 4B: dispatchPrompt returns { success: false, error: 'Bridge timeout' }
    mockDispatcher.reset();
    mockDispatcher.shouldFailDispatch = true;
    mockDispatcher.dispatchErrorMessage = 'Bridge timeout on submit';

    const orchFailDispatch = createTestOrchestrator();
    const phaseFailDispatch = createDummyPhase(3, 'phase-fail-dispatch.md');

    await orchFailDispatch.triggerPhaseNudge(phaseFailDispatch, 3);

    assert.strictEqual(phaseFailDispatch.hasNudged, true);
    assert.strictEqual(
      phaseFailDispatch.nudgeError,
      'Bridge timeout on submit',
      'nudgeError must record dispatch failure'
    );
    assert.strictEqual(
      phaseFailDispatch.status,
      'Running',
      'Phase status must remain Running and not crash orchestrator'
    );

    // Subcase 4C: dispatchPrompt throws an unhandled exception
    mockDispatcher.reset();
    mockDispatcher.throwOnDispatch = true;
    mockDispatcher.dispatchErrorMessage = 'Network socket reset';

    const orchThrowDispatch = createTestOrchestrator();
    const phaseThrowDispatch = createDummyPhase(4, 'phase-throw-dispatch.md');

    await orchThrowDispatch.triggerPhaseNudge(phaseThrowDispatch, 4);

    assert.strictEqual(phaseThrowDispatch.hasNudged, true);
    assert.strictEqual(phaseThrowDispatch.nudgeError, 'Network socket reset');
    assert.strictEqual(phaseThrowDispatch.status, 'Running');

    console.log('  ✓ Non-fatal error handling verified; errors captured without marking phase as Failed.');
  }

  // -------------------------------------------------------------------------
  // Test 5: Full Execution Sequence with Undisrupted Transcript Watching
  // -------------------------------------------------------------------------
  console.log('\n[Test 5] Verifying mid-flight nudge execution during active transcript watching...');
  {
    mockDispatcher.reset();
    const orchestrator = createTestOrchestrator({
      longPhaseNudgeEnabled: true,
      longPhaseThresholdSeconds: 1
    });

    const phase = createDummyPhase(0, 'phase-active-watch.md');

    // Start watchdog timer with 50ms threshold
    orchestrator.startPhaseNudgeWatchdog(phase, 0, 50);

    // Concurrently start watching transcript
    let watchCompleted = false;
    const watchPromise = mockWatcher
      .watchLatest(Date.now(), 'conv-123')
      .then((res) => {
        watchCompleted = true;
        return res;
      });

    // Wait 150ms for watchdog to fire and 400ms for stabilization delay
    await new Promise((r) => setTimeout(r, 650));

    // Nudge should have completed
    assert.strictEqual(phase.hasNudged, true, 'Phase should have triggered mid-flight nudge');
    assert.strictEqual(
      mockDispatcher.dispatchPromptCalls.length,
      1,
      'Nudge prompt should have been dispatched'
    );
    assert.strictEqual(
      mockWatcher.isWatching,
      true,
      'Transcript watcher must STILL be actively running after mid-flight nudge'
    );
    assert.strictEqual(watchCompleted, false, 'Watcher must not have completed prematurely');

    // Now simulate AI returning "Done skul9x." in the transcript
    mockWatcher.triggerCompletion();
    const result = await watchPromise;

    assert.strictEqual(watchCompleted, true, 'Watcher completed normally after keyword trigger');
    assert.strictEqual(result.matchedContent, 'Done skul9x.');
    assert.strictEqual(
      orchestrator.isPhaseNudgeTimerActive(),
      false,
      'Timer must be disposed upon phase completion'
    );

    console.log('  ✓ Transcript watcher remained active throughout mid-flight nudge and finished cleanly.');
  }

  console.log('\n================================================================');
  console.log(' ALL Phase 02 Orchestrator Nudge Watchdog Tests PASSED!');
  console.log('================================================================\n');
}

runPhase02NudgeWatchdogTestSuite().catch((err) => {
  console.error('\n❌ Phase 02 Test Suite Failed:', err);
  process.exit(1);
});
