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
  brainDir: string,
  convId: string,
  step: any,
  delayMs: number = 0
): Promise<void> {
  return new Promise((resolve) => {
    const doWrite = () => {
      const convLogsDir = path.join(brainDir, convId, '.system_generated', 'logs');
      fs.mkdirSync(convLogsDir, { recursive: true });
      const transcriptPath = path.join(convLogsDir, 'transcript.jsonl');
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

async function runPhase03OrchestratorDynamicSyncE2ETests() {
  console.log('=== Running Phase 03: Orchestrator Dynamic Sync & End-to-End Phase Progression Test ===\n');

  const baseDir = createTempDir('autoplan_phase03_e2e');
  const plansDir = path.join(baseDir, 'plans');
  const brainDir = path.join(baseDir, 'brain');

  fs.mkdirSync(plansDir, { recursive: true });
  fs.mkdirSync(brainDir, { recursive: true });

  // 1. Create simulated multi-phase plan files (phase-01.md and phase-02.md)
  const phase1Path = path.join(plansDir, 'phase-01-core-scaffold.md');
  const phase2Path = path.join(plansDir, 'phase-02-feature-extension.md');

  fs.writeFileSync(phase1Path, '# Phase 01: Core Scaffold\nTask: Setup project layout', 'utf-8');
  fs.writeFileSync(phase2Path, '# Phase 02: Feature Extension\nTask: Add secondary features', 'utf-8');

  try {
    console.log('[Test 1] Verifying Dynamic Conversation Rebound & Seamless Multi-Phase Progression...');

    let phaseCount = 0;
    const dispatchedPrompts: string[] = [];

    // Mock Keyboard Manager to simulate user/bridge prompt injection and trigger conversations
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

    // Override dispatchPrompt to simulate ghost/active conversation creation per phase
    mockPromptDispatcher.dispatchPrompt = async (promptText, _options) => {
      phaseCount++;
      dispatchedPrompts.push(promptText);

      if (phaseCount === 1) {
        // Phase 1 Simulation:
        // 1. First create a stalled "ghost" conversation (0 bytes or empty transcript)
        const ghostConvId = 'conv_ghost_phase1';
        const ghostLogsDir = path.join(brainDir, ghostConvId, '.system_generated', 'logs');
        fs.mkdirSync(ghostLogsDir, { recursive: true });
        fs.writeFileSync(path.join(ghostLogsDir, 'transcript.jsonl'), '', 'utf-8');

        // 2. Shortly after (120ms), active conversation starts emitting output in sibling conversation
        const activeConvId1 = 'conv_active_phase1';
        setTimeout(async () => {
          await writeTranscriptStep(brainDir, activeConvId1, {
            step_index: 1,
            source: 'MODEL',
            type: 'PLANNER_RESPONSE',
            status: 'IN_PROGRESS',
            content: 'Working on phase 1 scaffolding...'
          });

          setTimeout(async () => {
            await writeTranscriptStep(brainDir, activeConvId1, {
              step_index: 2,
              source: 'MODEL',
              type: 'PLANNER_RESPONSE',
              status: 'DONE',
              tool_calls: [],
              content: `Phase 1 scaffolding finished successfully! ${DEFAULT_COMPLETION_KEYWORD}`
            });
          }, 60);
        }, 120);
      } else if (phaseCount === 2) {
        // Phase 2 Simulation:
        // Direct active conversation execution
        const activeConvId2 = 'conv_active_phase2';
        setTimeout(async () => {
          await writeTranscriptStep(brainDir, activeConvId2, {
            step_index: 1,
            source: 'MODEL',
            type: 'PLANNER_RESPONSE',
            status: 'IN_PROGRESS',
            content: 'Working on phase 2 feature extensions...'
          });

          setTimeout(async () => {
            await writeTranscriptStep(brainDir, activeConvId2, {
              step_index: 2,
              source: 'MODEL',
              type: 'PLANNER_RESPONSE',
              status: 'DONE',
              tool_calls: [],
              content: `Phase 2 complete! All work finished. ${DEFAULT_COMPLETION_KEYWORD}`
            });
          }, 60);
        }, 80);
      }

      return {
        success: true,
        tier: 'domBridge',
        durationMs: 15
      };
    };

    const transcriptWatcher = new TranscriptWatcher({
      brainDir,
      keyword: DEFAULT_COMPLETION_KEYWORD,
      pollIntervalMs: 25,
      arbitrationTimeoutMs: 100, // Rapid arbitration for test responsiveness
      settleQuietPeriodMs: 50,
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
      delayBetweenLoopsMs: 40,
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

    // Start executing the 2-phase sequence from plans folder
    const runResult = await orchestrator.startFolder(plansDir);

    // =========================================================================
    // Verify Assertions
    // =========================================================================
    assert.strictEqual(runResult, true, 'startFolder execution must return true on completion');
    assert.strictEqual(orchestrator.getState(), 'completed', 'Orchestrator final state must be "completed"');

    // 1. Verify Phase list & statuses
    const phases = orchestrator.getPhases();
    assert.strictEqual(phases.length, 2, 'Must have discovered exactly 2 phases');
    assert.strictEqual(phases[0].status, 'Completed', 'Phase 1 status must be Completed');
    assert.strictEqual(phases[1].status, 'Completed', 'Phase 2 status must be Completed');

    // 2. Verify Conversation ID resolution & Dynamic Rebound tracking
    assert.strictEqual(
      phases[0].conversationId,
      'conv_active_phase1',
      'Phase 1 conversationId must rebound from ghost to active conversation conv_active_phase1'
    );
    assert.strictEqual(
      phases[1].conversationId,
      'conv_active_phase2',
      'Phase 2 conversationId must be conv_active_phase2'
    );
    assert.strictEqual(
      orchestrator.getLastConversationId(),
      'conv_active_phase2',
      'lastConversationId must reflect the active conversation of the latest completed phase'
    );

    // 3. Verify Timestamps & Results
    assert.ok(phases[0].startTime && phases[0].endTime, 'Phase 1 must have valid startTime and endTime');
    assert.ok(phases[0].endTime! >= phases[0].startTime!, 'Phase 1 endTime must be >= startTime');
    assert.ok(phases[0].result?.success, 'Phase 1 result must have success: true');
    assert.ok(
      phases[0].result?.matchedContent?.includes(DEFAULT_COMPLETION_KEYWORD),
      'Phase 1 result must contain matched completion keyword'
    );

    assert.ok(phases[1].startTime && phases[1].endTime, 'Phase 2 must have valid startTime and endTime');
    assert.ok(phases[1].endTime! >= phases[1].startTime!, 'Phase 2 endTime must be >= startTime');
    assert.ok(phases[1].result?.success, 'Phase 2 result must have success: true');
    assert.ok(
      phases[1].result?.matchedContent?.includes(DEFAULT_COMPLETION_KEYWORD),
      'Phase 2 result must contain matched completion keyword'
    );

    // 4. Verify Event Dispatches
    assert.strictEqual(phaseStartEvents.length, 2, 'Must have emitted 2 phaseStart events');
    assert.strictEqual(phaseStartEvents[0].fileName, 'phase-01-core-scaffold.md');
    assert.strictEqual(phaseStartEvents[1].fileName, 'phase-02-feature-extension.md');

    assert.strictEqual(phaseCompleteEvents.length, 2, 'Must have emitted 2 phaseComplete events');
    assert.strictEqual(phaseCompleteEvents[0].phase.conversationId, 'conv_active_phase1');
    assert.strictEqual(phaseCompleteEvents[1].phase.conversationId, 'conv_active_phase2');

    assert.strictEqual(iterationCompleteEvents.length, 2, 'Must have emitted 2 iterationComplete events');
    assert.strictEqual(allCompleteTotal, 2, 'allComplete event must receive total 2');

    // 5. Verify No Listener Leaks on TranscriptWatcher
    const reboundListenerCount = transcriptWatcher.listenerCount('conversationRebound');
    assert.strictEqual(
      reboundListenerCount,
      0,
      'Dynamic conversationRebound listeners must be cleanly removed in finally block'
    );

    console.log('  ✓ Verified: Dynamic conversation rebound seamlessly resolved in Phase 1.');
    assert.ok(stateLog.includes('waiting') && stateLog.includes('delaying'), 'State transitions verified');
    console.log('  ✓ Verified: Instant transition from Phase 1 to Phase 2 with full lifecycle events.');
    console.log('  ✓ Verified: All phases completed successfully with no listener leaks.\n');
  } finally {
    cleanupDir(baseDir);
  }

  console.log('========================================================================');
  console.log('✅ ALL PHASE 03 ORCHESTRATOR DYNAMIC SYNC E2E TESTS PASSED!');
  console.log('========================================================================\n');
}

runPhase03OrchestratorDynamicSyncE2ETests().catch((err) => {
  console.error('Phase 03 Test Suite Failed:', err);
  process.exit(1);
});
