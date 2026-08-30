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
import { Orchestrator, PhaseItem, OrchestratorProgressInfo } from '../orchestrator';
import { KeyboardManager } from '../keyboardManager';
import { PromptDispatcher } from '../promptDispatcher';
import { TranscriptWatcher, CompletionResult } from '../transcriptWatcher';
import { AutoPlanConfig, DEFAULT_COMPLETION_KEYWORD } from '../config';

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

async function runPhase01MultiPhaseContinuousSyncTests() {
  console.log('=== Running Phase 01: Multi-Phase Continuous Transcript Synchronization Test ===\n');

  const baseDir = createTempDir('autoplan_phase01_continuous_sync');
  const plansDir = path.join(baseDir, 'plans');
  const brainDir = path.join(baseDir, 'brain');

  fs.mkdirSync(plansDir, { recursive: true });
  fs.mkdirSync(brainDir, { recursive: true });

  const phase1Path = path.join(plansDir, 'phase-01-scaffold.md');
  const phase2Path = path.join(plansDir, 'phase-02-extension.md');

  fs.writeFileSync(phase1Path, '# Phase 01: Scaffold\nTask: Setup project foundation', 'utf-8');
  fs.writeFileSync(phase2Path, '# Phase 02: Extension\nTask: Extend project features', 'utf-8');

  try {
    console.log('[Test 1] Verifying Multi-Phase Continuous Sync in Same Conversation Transcript File...');

    const singleConvId = 'conv_continuous_single_stream';
    const convLogsDir = path.join(brainDir, singleConvId, '.system_generated', 'logs');
    fs.mkdirSync(convLogsDir, { recursive: true });
    const transcriptFilePath = path.join(convLogsDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptFilePath, '', 'utf-8');

    let phaseCount = 0;
    const dispatchedPrompts: string[] = [];
    let phase1ByteSizeAfterComplete = 0;

    const mockKeyboard = new KeyboardManager({
      focusDelayMs: 5,
      selectDelayMs: 5,
      pasteDelayMs: 5,
      submitDelayMs: 5,
      customKeySender: async () => {},
      customClipboardSetter: async (text) => {
        dispatchedPrompts.push(text);
      },
      customBatchSender: async (_batchScript, _actions) => {}
    });

    const mockPromptDispatcher = new PromptDispatcher({
      keyboardManager: mockKeyboard,
      configProvider: () => testConfig
    });

    // Simulate Agent responses appended into the exact same transcript file
    mockPromptDispatcher.dispatchPrompt = async (promptText, _options) => {
      phaseCount++;
      dispatchedPrompts.push(promptText);

      if (phaseCount === 1) {
        // Phase 1 response steps written to transcript
        setTimeout(async () => {
          await writeTranscriptStep(transcriptFilePath, {
            step_index: 1,
            source: 'MODEL',
            type: 'PLANNER_RESPONSE',
            status: 'IN_PROGRESS',
            content: 'Working on phase 1 scaffolding...'
          });

          setTimeout(async () => {
            await writeTranscriptStep(transcriptFilePath, {
              step_index: 2,
              source: 'MODEL',
              type: 'PLANNER_RESPONSE',
              status: 'DONE',
              tool_calls: [],
              content: `Phase 1 completed! ${DEFAULT_COMPLETION_KEYWORD}`
            });
            phase1ByteSizeAfterComplete = fs.statSync(transcriptFilePath).size;
          }, 40);
        }, 50);
      } else if (phaseCount === 2) {
        // Phase 2 response steps written to SAME transcript file after a brief delay
        setTimeout(async () => {
          await writeTranscriptStep(transcriptFilePath, {
            step_index: 3,
            source: 'MODEL',
            type: 'PLANNER_RESPONSE',
            status: 'IN_PROGRESS',
            content: 'Working on phase 2 feature extension...'
          });

          setTimeout(async () => {
            await writeTranscriptStep(transcriptFilePath, {
              step_index: 4,
              source: 'MODEL',
              type: 'PLANNER_RESPONSE',
              status: 'DONE',
              tool_calls: [],
              content: `Phase 2 fully done! ${DEFAULT_COMPLETION_KEYWORD}`
            });
          }, 40);
        }, 80);
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
      pollIntervalMs: 20,
      relaxedPollIntervalMs: 40,
      arbitrationTimeoutMs: 200,
      settleQuietPeriodMs: 40,
      timeoutMs: 8000
    });

    const phaseStartEvents: PhaseItem[] = [];
    const phaseCompleteEvents: { phase: PhaseItem; result: CompletionResult }[] = [];
    const iterationCompleteEvents: { iteration: number; total: number; result: CompletionResult }[] = [];
    const stateLog: string[] = [];
    let allCompleteTotal: number | null = null;

    const testConfig: AutoPlanConfig = {
      promptText: 'Execute {path}',
      promptTemplate: 'Execute phase file {path} and output Done skul9x.',
      repeatCount: 2,
      completionKeyword: DEFAULT_COMPLETION_KEYWORD,
      delayBetweenLoopsMs: 30,
      timeoutPerLoopMinutes: 1,
      defaultPlanFolder: plansDir,
      executionMode: 'domBridge'
    };

    const orchestrator = new Orchestrator({
      configProvider: () => testConfig,
      keyboardManager: mockKeyboard,
      transcriptWatcher,
      promptDispatcher: mockPromptDispatcher,
      onStateChange: (info: OrchestratorProgressInfo) => {
        stateLog.push(info.state);
      },
      onPhaseStart: (phase: PhaseItem) => {
        phaseStartEvents.push({ ...phase });
      },
      onPhaseComplete: (phase: PhaseItem, result: CompletionResult) => {
        phaseCompleteEvents.push({ phase: { ...phase }, result });
      },
      onIterationComplete: (iteration: number, total: number, result: CompletionResult) => {
        iterationCompleteEvents.push({ iteration, total, result });
      },
      onAllComplete: (total: number) => {
        allCompleteTotal = total;
      }
    });

    const testStartTime = Date.now();
    const runResult = await orchestrator.startFolder(plansDir);
    const testTotalDurationMs = Date.now() - testStartTime;

    console.log(`  -> Multi-phase continuous execution finished in ${testTotalDurationMs}ms`);

    // =========================================================================
    // Verification Assertions
    // =========================================================================
    assert.strictEqual(runResult, true, 'startFolder execution must return true on completion');
    assert.strictEqual(orchestrator.getState(), 'completed', 'Orchestrator state must be "completed"');
    assert.ok(
      testTotalDurationMs < 10000,
      `Total execution time across both phases must be < 10s (actual: ${testTotalDurationMs}ms)`
    );

    // 1. Verify Phase List
    const phases = orchestrator.getPhases();
    assert.strictEqual(phases.length, 2, 'Must have discovered 2 phases');
    assert.strictEqual(phases[0].status, 'Completed', 'Phase 1 must be Completed');
    assert.strictEqual(phases[1].status, 'Completed', 'Phase 2 must be Completed');

    // 2. Verify Pre-Dispatch Start Offsets
    assert.strictEqual(phases[0].startOffset, 0, 'Phase 1 startOffset must be 0 for initial transcript');
    assert.ok(
      phases[1].startOffset !== undefined && phases[1].startOffset > 0,
      `Phase 2 startOffset must be > 0 (actual: ${phases[1].startOffset})`
    );
    assert.strictEqual(
      phases[1].startOffset,
      phase1ByteSizeAfterComplete,
      'Phase 2 startOffset must precisely match the file size captured after Phase 1 completion'
    );

    // 3. Verify Same Conversation Continuity
    assert.strictEqual(
      phases[0].conversationId,
      singleConvId,
      'Phase 1 must be associated with single continuous conversation'
    );
    assert.strictEqual(
      phases[1].conversationId,
      singleConvId,
      'Phase 2 must continue in the exact same conversation ID'
    );
    assert.strictEqual(
      orchestrator.getLastConversationId(),
      singleConvId,
      'lastConversationId must match single continuous conversation'
    );

    // 4. Verify Phase Results and Matched Contents
    assert.ok(phases[0].result?.success, 'Phase 1 result success must be true');
    assert.ok(
      phases[0].result?.matchedContent?.includes('Phase 1 completed!'),
      'Phase 1 result content must match Phase 1 text'
    );

    assert.ok(phases[1].result?.success, 'Phase 2 result success must be true');
    assert.ok(
      phases[1].result?.matchedContent?.includes('Phase 2 fully done!'),
      'Phase 2 result content must match Phase 2 text (must NOT re-match Phase 1 text)'
    );

    // 5. Verify Event Logs & Lifecycle
    assert.strictEqual(phaseStartEvents.length, 2, 'Must emit 2 phaseStart events');
    assert.strictEqual(phaseCompleteEvents.length, 2, 'Must emit 2 phaseComplete events');
    assert.strictEqual(iterationCompleteEvents.length, 2, 'Must emit 2 iterationComplete events');
    assert.strictEqual(allCompleteTotal, 2, 'allComplete event total must be 2');

    // 6. Verify No Listener Leaks
    const reboundCount = transcriptWatcher.listenerCount('conversationRebound');
    assert.strictEqual(reboundCount, 0, 'No conversationRebound listener leaks');

    console.log('  ✓ Verified: Pre-dispatch startOffset calculated accurately for multi-phase continuation.');
    console.log('  ✓ Verified: Phase 2 smoothly executed in existing transcript without re-matching Phase 1 keyword.');
    console.log('  ✓ Verified: Fast discovery timeout and non-blocking execution under 10s total.\n');
  } finally {
    cleanupDir(baseDir);
  }

  console.log('========================================================================');
  console.log('✅ ALL PHASE 01 MULTI-PHASE CONTINUOUS SYNC TESTS PASSED!');
  console.log('========================================================================\n');
}

runPhase01MultiPhaseContinuousSyncTests().catch((err) => {
  console.error('Phase 01 Test Suite Failed:', err);
  process.exit(1);
});
