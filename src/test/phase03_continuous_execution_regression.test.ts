// Standalone mock for 'vscode' module when run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (_section: string) => ({
          get: (_key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      env: {
        clipboard: {
          writeText: async (_text: string) => {},
          readText: async () => ''
        }
      },
      window: {
        showErrorMessage: async () => undefined,
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined
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
import { Orchestrator, PhaseItem, OrchestratorProgressInfo } from '../orchestrator';
import { KeyboardManager } from '../keyboardManager';
import { PromptDispatcher } from '../promptDispatcher';
import { TranscriptWatcher, CompletionResult } from '../transcriptWatcher';
import { AutoPlanConfig, DEFAULT_COMPLETION_KEYWORD } from '../config';
import { debugLogger, DebugLogger } from '../debugLogger';

function createTempDir(prefix: string): string {
  const dir = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

function writeTranscriptStep(
  transcriptPath: string,
  step: any,
  delayMs: number = 0
): Promise<void> {
  return new Promise((resolve) => {
    const doWrite = () => {
      fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
      fs.appendFileSync(transcriptPath, JSON.stringify(step) + '\n', 'utf-8');
      resolve();
    };

    if (delayMs > 0) {
      setTimeout(doWrite, delayMs);
    } else {
      doWrite();
    }
  });
}

async function runPhase03ContinuousExecutionRegressionTests() {
  console.log('=== Running Phase 03: End-to-End Multi-Phase Continuous Execution & Full Regression Verification ===\n');

  const baseDir = createTempDir('autoplan_phase03_regression');
  const plansDir = path.join(baseDir, 'plans');
  const brainDir = path.join(baseDir, 'brain');

  fs.mkdirSync(plansDir, { recursive: true });
  fs.mkdirSync(brainDir, { recursive: true });

  const phase1Path = path.join(plansDir, 'phase-01.md');
  const phase2Path = path.join(plansDir, 'phase-02.md');
  const phase3Path = path.join(plansDir, 'phase-03.md');

  fs.writeFileSync(phase1Path, '# Phase 01: Scaffolding\nTask: Setup project foundation', 'utf-8');
  fs.writeFileSync(phase2Path, '# Phase 02: Core Feature\nTask: Implement continuous logic', 'utf-8');
  fs.writeFileSync(phase3Path, '# Phase 03: Finalization\nTask: Verification and cleanup', 'utf-8');

  try {
    // -------------------------------------------------------------------------
    // Test 1: 3-Phase Automated Sequential Execution in Single Conversation
    // -------------------------------------------------------------------------
    console.log('[Test 1] Verifying 3-Phase Automated Sequential Execution in Single Conversation...');

    const singleConvId = 'conv_continuous_3phase_e2e';
    const convLogsDir = path.join(brainDir, singleConvId, '.system_generated', 'logs');
    fs.mkdirSync(convLogsDir, { recursive: true });
    const transcriptFilePath = path.join(convLogsDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptFilePath, '', 'utf-8');

    let phaseCount = 0;
    const dispatchedPrompts: string[] = [];
    let phase1EndSize = 0;
    let phase2EndSize = 0;

    const mockKeyboard = new KeyboardManager({
      focusDelayMs: 2,
      selectDelayMs: 2,
      pasteDelayMs: 2,
      submitDelayMs: 2,
      customKeySender: async () => {},
      customClipboardSetter: async (text) => {
        dispatchedPrompts.push(text);
      },
      customBatchSender: async (_batchScript, _actions) => {}
    });

    const testConfig: AutoPlanConfig = {
      promptText: 'Execute {path}',
      promptTemplate: 'Execute phase {path}',
      repeatCount: 3,
      completionKeyword: DEFAULT_COMPLETION_KEYWORD,
      delayBetweenLoopsMs: 25,
      timeoutPerLoopMinutes: 1,
      defaultPlanFolder: plansDir,
      executionMode: 'domBridge'
    };

    const mockPromptDispatcher = new PromptDispatcher({
      keyboardManager: mockKeyboard,
      configProvider: () => testConfig
    });

    // Simulate AI streaming response steps into the SAME transcript file for each phase
    mockPromptDispatcher.dispatchPrompt = async (promptText, _options) => {
      phaseCount++;
      dispatchedPrompts.push(promptText);

      if (phaseCount === 1) {
        // Phase 1 streaming simulation
        setTimeout(async () => {
          await writeTranscriptStep(transcriptFilePath, {
            step_index: 1,
            source: 'MODEL',
            type: 'PLANNER_RESPONSE',
            status: 'IN_PROGRESS',
            content: 'Phase 1: Starting foundation setup...'
          });

          setTimeout(async () => {
            await writeTranscriptStep(transcriptFilePath, {
              step_index: 2,
              source: 'MODEL',
              type: 'PLANNER_RESPONSE',
              status: 'DONE',
              tool_calls: [],
              content: `Phase 1 foundation complete! ${DEFAULT_COMPLETION_KEYWORD}`
            });
            phase1EndSize = fs.statSync(transcriptFilePath).size;
          }, 30);
        }, 30);
      } else if (phaseCount === 2) {
        // Phase 2 streaming simulation
        setTimeout(async () => {
          await writeTranscriptStep(transcriptFilePath, {
            step_index: 3,
            source: 'MODEL',
            type: 'PLANNER_RESPONSE',
            status: 'IN_PROGRESS',
            content: 'Phase 2: Implementing continuous execution engine...'
          });

          setTimeout(async () => {
            await writeTranscriptStep(transcriptFilePath, {
              step_index: 4,
              source: 'MODEL',
              type: 'PLANNER_RESPONSE',
              status: 'DONE',
              tool_calls: [],
              content: `Phase 2 implementation complete! ${DEFAULT_COMPLETION_KEYWORD}`
            });
            phase2EndSize = fs.statSync(transcriptFilePath).size;
          }, 30);
        }, 30);
      } else if (phaseCount === 3) {
        // Phase 3 streaming simulation
        setTimeout(async () => {
          await writeTranscriptStep(transcriptFilePath, {
            step_index: 5,
            source: 'MODEL',
            type: 'PLANNER_RESPONSE',
            status: 'IN_PROGRESS',
            content: 'Phase 3: Running final regression tests...'
          });

          setTimeout(async () => {
            await writeTranscriptStep(transcriptFilePath, {
              step_index: 6,
              source: 'MODEL',
              type: 'PLANNER_RESPONSE',
              status: 'DONE',
              tool_calls: [],
              content: `Phase 3 verification complete! ${DEFAULT_COMPLETION_KEYWORD}`
            });
          }, 30);
        }, 30);
      }

      return {
        success: true,
        tier: 'domBridge',
        durationMs: 10
      };
    };

    const transcriptWatcher = new TranscriptWatcher({
      brainDir,
      keyword: DEFAULT_COMPLETION_KEYWORD,
      pollIntervalMs: 15,
      relaxedPollIntervalMs: 30,
      arbitrationTimeoutMs: 150,
      settleQuietPeriodMs: 25,
      timeoutMs: 8000
    });

    const testLogger = new DebugLogger(200);

    const phaseStartEvents: PhaseItem[] = [];
    const phaseCompleteEvents: { phase: PhaseItem; result: CompletionResult }[] = [];
    const iterationCompleteEvents: { iteration: number; total: number; result: CompletionResult }[] = [];
    const eventTimeline: string[] = [];
    let allCompleteTotal: number | null = null;

    const orchestrator = new Orchestrator({
      configProvider: () => testConfig,
      keyboardManager: mockKeyboard,
      transcriptWatcher,
      promptDispatcher: mockPromptDispatcher,
      debugLogger: testLogger,
      onStateChange: (info: OrchestratorProgressInfo) => {
        eventTimeline.push(`stateChange:${info.state}`);
      },
      onPhaseStart: (phase: PhaseItem) => {
        eventTimeline.push(`phaseStart:${phase.fileName}`);
        phaseStartEvents.push({ ...phase });
      },
      onPhaseComplete: (phase: PhaseItem, result: CompletionResult) => {
        eventTimeline.push(`phaseComplete:${phase.fileName}`);
        phaseCompleteEvents.push({ phase: { ...phase }, result });
      },
      onIterationComplete: (iteration: number, total: number, result: CompletionResult) => {
        eventTimeline.push(`iterationComplete:${iteration}/${total}`);
        iterationCompleteEvents.push({ iteration, total, result });
      },
      onAllComplete: (total: number) => {
        eventTimeline.push(`allComplete:${total}`);
        allCompleteTotal = total;
      }
    });

    const startTime = Date.now();
    const result = await orchestrator.startPhases([phase1Path, phase2Path, phase3Path]);
    const durationMs = Date.now() - startTime;

    console.log(`  -> 3-Phase execution completed in ${durationMs}ms`);

    // Verification 1: Overall Run Success
    assert.strictEqual(result, true, 'startPhases must return true for 3-phase complete run');
    assert.strictEqual(orchestrator.getState(), 'completed', 'Orchestrator state must reach "completed"');
    assert.strictEqual(allCompleteTotal, 3, 'onAllComplete total count must be 3');

    // Verification 2: All 3 Phases Completed with Accurate Status
    const phases = orchestrator.getPhases();
    assert.strictEqual(phases.length, 3, 'Must have 3 phases');
    assert.strictEqual(phases[0].status, 'Completed', 'Phase 1 must be Completed');
    assert.strictEqual(phases[1].status, 'Completed', 'Phase 2 must be Completed');
    assert.strictEqual(phases[2].status, 'Completed', 'Phase 3 must be Completed');

    // Verification 3: Start Offsets for Non-Overlapping Streaming Sync
    assert.strictEqual(phases[0].startOffset, 0, 'Phase 1 startOffset must be 0');
    assert.ok(phases[1].startOffset !== undefined && phases[1].startOffset > 0, 'Phase 2 startOffset must be > 0');
    assert.strictEqual(phases[1].startOffset, phase1EndSize, 'Phase 2 startOffset must match Phase 1 end byte size');
    assert.ok(phases[2].startOffset !== undefined && phases[2].startOffset > phase1EndSize, 'Phase 3 startOffset must be > Phase 1 end size');
    assert.strictEqual(phases[2].startOffset, phase2EndSize, 'Phase 3 startOffset must match Phase 2 end byte size');

    // Verification 4: Conversation Continuity
    assert.strictEqual(phases[0].conversationId, singleConvId, 'Phase 1 conversationId must match');
    assert.strictEqual(phases[1].conversationId, singleConvId, 'Phase 2 conversationId must match');
    assert.strictEqual(phases[2].conversationId, singleConvId, 'Phase 3 conversationId must match');
    assert.strictEqual(orchestrator.getLastConversationId(), singleConvId, 'lastConversationId must match');

    // Verification 5: Matched Content Accuracy
    assert.ok(phases[0].result?.matchedContent?.includes('Phase 1 foundation complete!'), 'Phase 1 matched content verified');
    assert.ok(phases[1].result?.matchedContent?.includes('Phase 2 implementation complete!'), 'Phase 2 matched content verified');
    assert.ok(phases[2].result?.matchedContent?.includes('Phase 3 verification complete!'), 'Phase 3 matched content verified');

    // Verification 6: Event Ordering
    assert.strictEqual(phaseStartEvents.length, 3, 'Must emit exactly 3 phaseStart events');
    assert.strictEqual(phaseCompleteEvents.length, 3, 'Must emit exactly 3 phaseComplete events');
    assert.strictEqual(iterationCompleteEvents.length, 3, 'Must emit exactly 3 iterationComplete events');

    // Check timeline sequence
    const expectedSubsequence = [
      'phaseStart:phase-01.md',
      'phaseComplete:phase-01.md',
      'iterationComplete:1/3',
      'phaseStart:phase-02.md',
      'phaseComplete:phase-02.md',
      'iterationComplete:2/3',
      'phaseStart:phase-03.md',
      'phaseComplete:phase-03.md',
      'iterationComplete:3/3',
      'allComplete:3'
    ];

    let lastIdx = -1;
    for (const expectedEvent of expectedSubsequence) {
      const idx = eventTimeline.indexOf(expectedEvent, lastIdx + 1);
      assert.ok(idx > lastIdx, `Event "${expectedEvent}" must occur in expected sequential order (found at index ${idx}, previous index ${lastIdx})`);
      lastIdx = idx;
    }

    // Verification 7: Diagnostic Report Generation & Telemetry
    console.log('  -> Verifying DebugLogger Diagnostic Report generation...');
    const auditReport = orchestrator.getPhaseAuditReport();
    assert.strictEqual(auditReport.totalPhases, 3, 'Audit report totalPhases must be 3');
    assert.strictEqual(auditReport.completedCount, 3, 'Audit report completedCount must be 3');
    assert.strictEqual(auditReport.failedCount, 0, 'Audit report failedCount must be 0');
    assert.strictEqual(auditReport.hasBlockers, false, 'Audit report hasBlockers must be false');

    const diagMarkdown = testLogger.exportDiagnosticReportToString(100, undefined, auditReport);
    assert.ok(diagMarkdown.includes('# Auto-Plan DOM Bridge Diagnostic Report'), 'Report must contain title header');
    assert.ok(diagMarkdown.includes('3 total phases (3 Completed'), 'Report must summarize 3 Completed phases');
    assert.ok(diagMarkdown.includes('`phase-01.md`'), 'Report must list phase-01.md');
    assert.ok(diagMarkdown.includes('`phase-02.md`'), 'Report must list phase-02.md');
    assert.ok(diagMarkdown.includes('`phase-03.md`'), 'Report must list phase-03.md');
    assert.ok(diagMarkdown.includes('[PHASE_START]'), 'Report log traces must include [PHASE_START]');
    assert.ok(diagMarkdown.includes('[PHASE_COMPLETE]'), 'Report log traces must include [PHASE_COMPLETE]');

    console.log('  ✓ Test 1 Passed: 3-phase automated sequential execution in a single conversation succeeded 100%.\n');

    // -------------------------------------------------------------------------
    // Test 2: Lifecycle Control & Abort Simulation Midway Through Phase 2
    // -------------------------------------------------------------------------
    console.log('[Test 2] Verifying Lifecycle Control & Abort Simulation midway through Phase 2...');

    const abortConvId = 'conv_abort_simulation';
    const abortLogsDir = path.join(brainDir, abortConvId, '.system_generated', 'logs');
    fs.mkdirSync(abortLogsDir, { recursive: true });
    const abortTranscriptPath = path.join(abortLogsDir, 'transcript.jsonl');
    fs.writeFileSync(abortTranscriptPath, '', 'utf-8');

    let abortPhaseCount = 0;
    let stoppedEventFired = false;

    const mockAbortKeyboard = new KeyboardManager({
      focusDelayMs: 2,
      selectDelayMs: 2,
      pasteDelayMs: 2,
      submitDelayMs: 2,
      customKeySender: async () => {},
      customClipboardSetter: async () => {},
      customBatchSender: async () => {}
    });

    const mockAbortDispatcher = new PromptDispatcher({
      keyboardManager: mockAbortKeyboard,
      configProvider: () => testConfig
    });

    const abortTranscriptWatcher = new TranscriptWatcher({
      brainDir,
      keyword: DEFAULT_COMPLETION_KEYWORD,
      pollIntervalMs: 15,
      timeoutMs: 5000
    });

    const abortLogger = new DebugLogger(200);

    const abortOrchestrator = new Orchestrator({
      configProvider: () => testConfig,
      keyboardManager: mockAbortKeyboard,
      transcriptWatcher: abortTranscriptWatcher,
      promptDispatcher: mockAbortDispatcher,
      debugLogger: abortLogger,
      onStopped: () => {
        stoppedEventFired = true;
      }
    });

    mockAbortDispatcher.dispatchPrompt = async (promptText, _options) => {
      abortPhaseCount++;

      if (abortPhaseCount === 1) {
        // Phase 1 completes normally
        setTimeout(async () => {
          await writeTranscriptStep(abortTranscriptPath, {
            step_index: 1,
            source: 'MODEL',
            type: 'PLANNER_RESPONSE',
            status: 'DONE',
            tool_calls: [],
            content: `Phase 1 done! ${DEFAULT_COMPLETION_KEYWORD}`
          });
        }, 20);
      } else if (abortPhaseCount === 2) {
        // Phase 2 triggers user stop midway
        setTimeout(() => {
          abortOrchestrator.stop();
        }, 30);
      }

      return {
        success: true,
        tier: 'domBridge',
        durationMs: 5
      };
    };

    const abortResult = await abortOrchestrator.startPhases([phase1Path, phase2Path, phase3Path]);

    assert.strictEqual(abortResult, false, 'startPhases must return false when aborted');
    assert.strictEqual(abortOrchestrator.getState(), 'stopped', 'Orchestrator state must be "stopped"');
    assert.strictEqual(stoppedEventFired, true, 'onStopped event must have fired');

    const abortPhases = abortOrchestrator.getPhases();
    assert.strictEqual(abortPhases.length, 3, 'Must have 3 loaded phases');
    assert.strictEqual(abortPhases[0].status, 'Completed', 'Phase 1 must be Completed');
    assert.strictEqual(abortPhases[1].status, 'Stopped', 'Executing Phase 2 must transition to "Stopped"');
    assert.ok(abortPhases[1].endTime && abortPhases[1].endTime > 0, 'Phase 2 must have recorded endTime');
    assert.strictEqual(abortPhases[2].status, 'Pending', 'Subsequent Phase 3 must remain "Pending"');

    // Verify watcher and listeners are cleanly unbound
    assert.strictEqual(abortTranscriptWatcher.listenerCount('conversationRebound'), 0, 'No dangling conversationRebound listeners');

    console.log('  ✓ Test 2 Passed: User stop midway through Phase 2 cleanly marks Phase 2 as Stopped without leaks.\n');

  } finally {
    cleanupDir(baseDir);
  }

  console.log('========================================================================');
  console.log('✅ ALL PHASE 03 CONTINUOUS EXECUTION REGRESSION TESTS PASSED!');
  console.log('========================================================================\n');
}

runPhase03ContinuousExecutionRegressionTests().catch((err) => {
  console.error('Phase 03 Test Suite Failed:', err);
  process.exit(1);
});
