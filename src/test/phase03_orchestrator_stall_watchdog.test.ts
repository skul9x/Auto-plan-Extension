// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

const channelLines: string[] = [];
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_k: string, defaultValue: any) => defaultValue,
          update: async () => {}
        })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
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
        showErrorMessage: async () => undefined,
        showInformationMessage: async () => undefined
      },
      commands: {
        executeCommand: async () => undefined
      }
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
import { AutoPlanConfig, DEFAULT_CONFIG } from '../config';
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
import {
  PhaseFile,
  PlanPhasesAuditReport,
  PhaseDiagnosticInfo
} from '../planScanner';

// Mock PromptDispatcher
class MockPromptDispatcher extends EventEmitter {
  public shouldFail: boolean = false;
  public failErrorMessage: string = 'Simulated dispatch failure';
  public readinessResult: DispatchReadinessResult = {
    ready: true,
    selectedTier: 'domBridge',
    isFocusFree: true,
    requiresForegroundFocus: false,
    details: {
      connectedClientsCount: 1,
      os: 'win32'
    }
  };
  public dispatchCalls: Array<{ prompt: string; options?: DispatchOptions }> = [];

  public validateDispatchReadiness(): DispatchReadinessResult {
    return this.readinessResult;
  }

  public async ensureBridgeReadinessWithWakeup(): Promise<DispatchReadinessResult> {
    return this.readinessResult;
  }

  public async dispatchPrompt(prompt: string, options?: DispatchOptions): Promise<DispatchResult> {
    this.dispatchCalls.push({ prompt, options });
    if (this.shouldFail) {
      return {
        success: false,
        tier: 'domBridge',
        durationMs: 45,
        error: this.failErrorMessage
      };
    }
    return {
      success: true,
      tier: 'domBridge',
      durationMs: 85
    };
  }
}

// Mock TranscriptWatcher
class MockTranscriptWatcher extends EventEmitter {
  public delayMs: number = 20;
  public shouldFail: boolean = false;
  public failErrorMessage: string = 'Simulated watcher failure';
  public matchedKeyword: string = 'Done skul9x.';
  private isStopped: boolean = false;

  public getOptions() {
    return {
      brainDir: os.tmpdir(),
      pollIntervalMs: 50
    };
  }

  public async waitForNewConversation(): Promise<string> {
    if (this.delayMs > 0) {
      await new Promise(r => setTimeout(r, this.delayMs));
    }
    if (this.isStopped) {
      throw new Error('Watcher stopped');
    }
    return 'mock-conv-12345';
  }

  public async watchFile(): Promise<CompletionResult> {
    if (this.delayMs > 0) {
      await new Promise(r => setTimeout(r, this.delayMs));
    }
    if (this.isStopped) {
      return { success: false, conversationId: 'mock-conv-12345', error: 'Stopped' };
    }
    if (this.shouldFail) {
      return {
        success: false,
        conversationId: 'mock-conv-12345',
        error: this.failErrorMessage
      };
    }
    return {
      success: true,
      conversationId: 'mock-conv-12345',
      matchedContent: this.matchedKeyword
    };
  }

  public async watchLatest(): Promise<CompletionResult> {
    return this.watchFile();
  }

  public stop(): void {
    this.isStopped = true;
  }

  public reset(): void {
    this.isStopped = false;
  }
}

async function runPhase03OrchestratorStallWatchdogTests() {
  console.log('=== Running Phase 03: Orchestrator Real-Time Phase Lifecycle Tracing & Stall Watchdog Tests ===\n');

  const testBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-watchdog-test-'));

  try {
    // Setup dummy plan folder with 3 phases
    const planFolder = path.join(testBaseDir, 'test-plan');
    fs.mkdirSync(planFolder, { recursive: true });

    const phase1Path = path.join(planFolder, 'phase-01-scaffold.md');
    const phase2Path = path.join(planFolder, 'phase-02-api.md');
    const phase3Path = path.join(planFolder, 'phase-03-ui.md');

    fs.writeFileSync(phase1Path, '# Phase 01: Scaffold\n\nStatus: ⬜ Pending\n\nTask details.', 'utf8');
    fs.writeFileSync(phase2Path, '# Phase 02: API\n\nStatus: ⬜ Pending\n\nTask details.', 'utf8');
    fs.writeFileSync(phase3Path, '# Phase 03: UI\n\nStatus: ⬜ Pending\n\nTask details.', 'utf8');

    // ----------------------------------------------------------------------
    // Test 1: Real-Time Phase Lifecycle Event Tracing ([PHASE_START], dispatch, [PHASE_COMPLETE])
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying real-time phase lifecycle logging and event emission...');

    const customLogger1 = new DebugLogger(100);
    const mockDispatcher1 = new MockPromptDispatcher();
    const mockWatcher1 = new MockTranscriptWatcher();
    mockWatcher1.delayMs = 10;

    const orchestrator1 = new Orchestrator({
      debugLogger: customLogger1,
      promptDispatcher: mockDispatcher1 as any,
      transcriptWatcher: mockWatcher1 as any,
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        delayBetweenLoopsMs: 10,
        completionKeyword: 'Done skul9x.'
      })
    });

    const completedPhases: PhaseItem[] = [];
    orchestrator1.on('phaseComplete', (p) => completedPhases.push(p));

    const runResult = await orchestrator1.startFolder(planFolder);
    assert.strictEqual(runResult, true, 'startFolder should succeed for all phases');
    assert.strictEqual(completedPhases.length, 3, 'All 3 phases must complete');

    const logs1 = customLogger1.getEntries();
    
    // Check Phase Start logging
    const startEntries = logs1.filter(l => l.component === 'PHASE' && l.message.includes('[PHASE_START]'));
    assert.strictEqual(startEntries.length, 3, 'Must record 3 [PHASE_START] entries');
    assert.ok(startEntries[0].details.promptPreview, 'Phase start must log rendered prompt preview');
    assert.strictEqual(startEntries[0].details.phaseNumber, 1);

    // Check Prompt Dispatcher logging
    const dispatchLogs = logs1.filter(l => l.component === 'DISPATCHER' && l.message.includes('Prompt dispatched'));
    assert.strictEqual(dispatchLogs.length, 3, 'Must record 3 DISPATCHER logs');
    assert.strictEqual(dispatchLogs[0].details.tier, 'domBridge');

    // Check Transcript Watching logging
    const watchLogs = logs1.filter(l => l.component === 'ORCHESTRATOR' && l.message.includes('Watching transcript'));
    assert.strictEqual(watchLogs.length, 3, 'Must record 3 ORCHESTRATOR transcript watch logs');

    // Check Phase Completion logging
    const completeEntries = logs1.filter(l => l.component === 'PHASE' && l.message.includes('[PHASE_COMPLETE]'));
    assert.strictEqual(completeEntries.length, 3, 'Must record 3 [PHASE_COMPLETE] entries');
    assert.ok(completeEntries[0].details.durationMs !== undefined, 'Phase complete must include duration');
    assert.strictEqual(completeEntries[0].details.matchedKeyword, 'Done skul9x.');

    console.log('  -> Passed: Real-time phase lifecycle logging records [PHASE_START], dispatch, and [PHASE_COMPLETE] with complete metadata.');

    // ----------------------------------------------------------------------
    // Test 2: Proactive Stall Watchdog Timer (Triggers AI_RESPONSE_TIMEOUT warning)
    // ----------------------------------------------------------------------
    console.log('[Test 2] Verifying proactive stall watchdog timer triggering AI_RESPONSE_TIMEOUT...');

    const customLogger2 = new DebugLogger(100);
    const mockDispatcher2 = new MockPromptDispatcher();
    const mockWatcher2 = new MockTranscriptWatcher();
    // Simulate long AI response wait of 150ms
    mockWatcher2.delayMs = 150;

    const warnings: string[] = [];
    const orchestrator2 = new Orchestrator({
      debugLogger: customLogger2,
      promptDispatcher: mockDispatcher2 as any,
      transcriptWatcher: mockWatcher2 as any,
      stallWatchdogThresholdMs: 40, // Short threshold of 40ms to trigger watchdog
      onWarning: (w) => warnings.push(w),
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        delayBetweenLoopsMs: 10
      })
    });

    const runResult2 = await orchestrator2.startFolder(planFolder);
    assert.strictEqual(runResult2, true);

    // Verify watchdog triggered diagnostic warnings
    assert.ok(warnings.length >= 1, 'Watchdog should emit warning when wait duration exceeds threshold');
    assert.ok(warnings.some(w => w.includes('[Watchdog]') && w.includes('wait duration exceeded')));

    // Verify debugLogger recorded [PHASE_STALL] with code 'AI_RESPONSE_TIMEOUT'
    const stallLogs = customLogger2.getEntries().filter(l => l.component === 'PHASE' && l.message.includes('[PHASE_STALL]'));
    assert.ok(stallLogs.length >= 1, 'DebugLogger must record [PHASE_STALL] events');
    const timeoutStall = stallLogs.find(l => l.details?.stallReason?.code === 'AI_RESPONSE_TIMEOUT');
    assert.ok(timeoutStall, 'Stall reason code must be AI_RESPONSE_TIMEOUT');
    assert.ok(timeoutStall!.details.stallReason.remediationAction.includes('transcript'));

    console.log('  -> Passed: Proactive stall watchdog detects long wait and logs AI_RESPONSE_TIMEOUT diagnostics.');

    // ----------------------------------------------------------------------
    // Test 3: Cascade Blocker Diagnosis on Active Phase Failure
    // ----------------------------------------------------------------------
    console.log('[Test 3] Verifying cascade blocker diagnosis on active phase failure...');

    const customLogger3 = new DebugLogger(100);
    const mockDispatcher3 = new MockPromptDispatcher();
    const mockWatcher3 = new MockTranscriptWatcher();
    mockWatcher3.delayMs = 10;
    // Make watcher fail on Phase 1
    mockWatcher3.shouldFail = true;
    mockWatcher3.failErrorMessage = 'AI model hallucinated without completion token';

    let caughtError: Error | null = null;
    const orchestrator3 = new Orchestrator({
      debugLogger: customLogger3,
      promptDispatcher: mockDispatcher3 as any,
      transcriptWatcher: mockWatcher3 as any,
      onError: (err) => { caughtError = err; },
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        delayBetweenLoopsMs: 10
      })
    });

    const runResult3 = await orchestrator3.startFolder(planFolder);
    assert.strictEqual(runResult3, false, 'startFolder should return false on error');
    assert.ok(caughtError, 'Error event should be emitted');

    const logs3 = customLogger3.getEntries();

    // Check [PHASE_FAIL] on Phase 1
    const failLogs = logs3.filter(l => l.component === 'PHASE' && l.message.includes('[PHASE_FAIL]'));
    assert.strictEqual(failLogs.length, 1);
    assert.ok(failLogs[0].message.includes('phase-01-scaffold.md'));
    assert.ok(failLogs[0].error?.includes('AI model hallucinated'));

    // Check cascade [PHASE_STALL] on subsequent phases (Phase 2 and Phase 3)
    const cascadeStallLogs = logs3.filter(l => l.component === 'PHASE' && l.message.includes('[PHASE_STALL]'));
    assert.ok(cascadeStallLogs.length >= 2, 'Subsequent phases must receive stall diagnosis');
    const blockedPhases = cascadeStallLogs.filter(l => l.details?.stallReason?.code === 'BLOCKED_BY_PREVIOUS_FAILURE');
    assert.strictEqual(blockedPhases.length, 2, 'Phase 2 and Phase 3 must be diagnosed as BLOCKED_BY_PREVIOUS_FAILURE');
    assert.strictEqual(blockedPhases[0].details.stallReason.blockedByPhaseIndex, 0);
    assert.strictEqual(blockedPhases[0].details.stallReason.blockedByPhaseName, 'phase-01-scaffold.md');

    console.log('  -> Passed: Failing phase immediately cascades BLOCKED_BY_PREVIOUS_FAILURE to all subsequent phases.');

    // ----------------------------------------------------------------------
    // Test 4: Preflight Transport Failure Logging
    // ----------------------------------------------------------------------
    console.log('[Test 4] Verifying PREFLIGHT_TRANSPORT_FAILURE diagnostics on transport failure...');

    const customLogger4 = new DebugLogger(100);
    const mockDispatcher4 = new MockPromptDispatcher();
    mockDispatcher4.readinessResult = {
      ready: false,
      selectedTier: 'domBridge',
      isFocusFree: true,
      errorMessage: 'DOM Bridge client disconnected from port 49152',
      requiresForegroundFocus: false,
      details: {
        connectedClientsCount: 0,
        os: 'win32'
      }
    };

    const orchestrator4 = new Orchestrator({
      debugLogger: customLogger4,
      promptDispatcher: mockDispatcher4 as any,
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        executionMode: 'domBridge',
        allowTierFallback: false
      })
    });

    const runResult4 = await orchestrator4.startFolder(planFolder);
    assert.strictEqual(runResult4, false, 'Should fail immediately on preflight failure');

    const logs4 = customLogger4.getEntries();
    const preflightWarnings = logs4.filter(l => l.component === 'DISPATCHER' && l.level === 'WARN');
    assert.ok(preflightWarnings.length >= 1, 'Must log preflight warning');
    assert.ok(preflightWarnings[0].message.includes('Pre-flight check failed'));
    assert.strictEqual(preflightWarnings[0].details?.stallCode, 'PREFLIGHT_TRANSPORT_FAILURE');

    console.log('  -> Passed: Pre-flight transport failure is immediately caught and logged as PREFLIGHT_TRANSPORT_FAILURE.');

    // ----------------------------------------------------------------------
    // Test 5: Real-Time getPhaseAuditReport() Telemetry State
    // ----------------------------------------------------------------------
    console.log('[Test 5] Verifying getPhaseAuditReport() telemetry fidelity...');

    const customLogger5 = new DebugLogger(100);
    const mockDispatcher5 = new MockPromptDispatcher();
    const mockWatcher5 = new MockTranscriptWatcher();
    mockWatcher5.delayMs = 80;

    const orchestrator5 = new Orchestrator({
      debugLogger: customLogger5,
      promptDispatcher: mockDispatcher5 as any,
      transcriptWatcher: mockWatcher5 as any,
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        delayBetweenLoopsMs: 10
      })
    });

    // Before starting
    const preReport = orchestrator5.getPhaseAuditReport();
    assert.strictEqual(preReport.totalPhases, 0);

    // Start execution asynchronously
    const startPromise = orchestrator5.startFolder(planFolder);

    // Wait a brief moment for Phase 1 to enter 'Running'
    await new Promise(r => setTimeout(r, 20));

    const runningReport = orchestrator5.getPhaseAuditReport();
    assert.strictEqual(runningReport.totalPhases, 3);
    assert.ok(runningReport.runningPhase, 'Should have active running phase');
    assert.strictEqual(runningReport.runningPhase!.fileName, 'phase-01-scaffold.md');
    
    // Check pending phases stall reason
    const phase2Diag = runningReport.phases[1];
    assert.strictEqual(phase2Diag.fileName, 'phase-02-api.md');
    assert.ok(phase2Diag.stallReason);
    assert.strictEqual(phase2Diag.stallReason!.code, 'WAITING_FOR_PREVIOUS_PHASE');

    // Wait for full completion
    await startPromise;

    const finalReport = orchestrator5.getPhaseAuditReport();
    assert.strictEqual(finalReport.totalPhases, 3);
    assert.strictEqual(finalReport.completedCount, 3);
    assert.strictEqual(finalReport.pendingCount, 0);
    assert.strictEqual(finalReport.failedCount, 0);
    assert.strictEqual(finalReport.hasBlockers, false);

    // Verify DebugLogger integration via registered provider
    const envReport = customLogger5.buildEnvironmentReport();
    assert.ok(envReport.planPhases, 'Environment report must contain planPhases from Orchestrator provider');
    assert.strictEqual(envReport.planPhases!.totalPhases, 3);
    assert.strictEqual(envReport.planPhases!.completedCount, 3);

    console.log('  -> Passed: getPhaseAuditReport() reflects accurate real-time state across pending, running, and completed phases.');

    // ----------------------------------------------------------------------
    // Test 6: Skip Current Phase & Resource Cleanup
    // ----------------------------------------------------------------------
    console.log('[Test 6] Verifying phase skipping and watchdog cleanup...');

    const customLogger6 = new DebugLogger(100);
    const mockDispatcher6 = new MockPromptDispatcher();
    const mockWatcher6 = new MockTranscriptWatcher();
    mockWatcher6.delayMs = 500; // Intentionally long

    const skippedPhases: PhaseItem[] = [];
    const orchestrator6 = new Orchestrator({
      debugLogger: customLogger6,
      promptDispatcher: mockDispatcher6 as any,
      transcriptWatcher: mockWatcher6 as any,
      onSkipped: (p) => skippedPhases.push(p),
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        delayBetweenLoopsMs: 10
      })
    });

    // Start execution and skip Phase 1 mid-flight
    const runPromise6 = orchestrator6.startFolder(planFolder);

    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(orchestrator6.getState(), 'waiting');

    // Skip Phase 1
    const skipped = orchestrator6.skipCurrentPhase();
    assert.strictEqual(skipped, true, 'skipCurrentPhase should return true');

    // Speed up remaining phases
    mockWatcher6.delayMs = 10;

    await runPromise6;

    assert.strictEqual(skippedPhases.length, 1, 'Phase 1 must be recorded as skipped');
    assert.strictEqual(skippedPhases[0].fileName, 'phase-01-scaffold.md');

    const logs6 = customLogger6.getEntries();
    const skipLogs = logs6.filter(l => l.component === 'PHASE' && l.message.includes('[PHASE_SKIP]'));
    assert.ok(skipLogs.length >= 1, 'Must record [PHASE_SKIP] in logs');

    // Cleanup resources
    orchestrator1.dispose();
    orchestrator2.dispose();
    orchestrator3.dispose();
    orchestrator4.dispose();
    orchestrator5.dispose();
    orchestrator6.dispose();

    fs.rmSync(testBaseDir, { recursive: true, force: true });
    console.log('\n=== ALL PHASE 03 ORCHESTRATOR STALL WATCHDOG TESTS PASSED SUCCESSFULLY ===\n');
  } catch (err) {
    fs.rmSync(testBaseDir, { recursive: true, force: true });
    throw err;
  }
}

runPhase03OrchestratorStallWatchdogTests().catch(err => {
  console.error('[Test Failure]', err);
  process.exit(1);
});
