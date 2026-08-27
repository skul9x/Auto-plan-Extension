// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section: string) => ({
          get: (key: string, defaultValue: any) => defaultValue,
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
import { TranscriptWatcher, CompletionResult } from '../transcriptWatcher';
import { AutoPlanConfig, DEFAULT_COMPLETION_KEYWORD } from '../config';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function writeTranscriptLog(convDir: string, content: string, delayMs: number = 0) {
  const logsDir = path.join(convDir, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const transcriptPath = path.join(logsDir, 'transcript.jsonl');

  if (delayMs > 0) {
    setTimeout(() => {
      fs.appendFileSync(transcriptPath, content + '\n', 'utf-8');
    }, delayMs);
  } else {
    fs.appendFileSync(transcriptPath, content + '\n', 'utf-8');
  }
}

async function runPhase03Tests() {
  console.log('=== Running Phase 03: Orchestrator Sequential Runner & Lifecycle Tests ===\n');

  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-base-'));
  const tempPlanDir = path.join(tempBaseDir, 'plans');
  const tempBrainDir = path.join(tempBaseDir, 'brain');

  fs.mkdirSync(tempPlanDir, { recursive: true });
  fs.mkdirSync(tempBrainDir, { recursive: true });

  // Create 3 mock phase files
  const phase1Path = path.join(tempPlanDir, 'phase-01-scaffold.md');
  const phase2Path = path.join(tempPlanDir, 'phase-02-core.md');
  const phase3Path = path.join(tempPlanDir, 'phase-03-verify.md');

  fs.writeFileSync(phase1Path, '# Phase 1 Scaffold\nObjective: Setup structure', 'utf-8');
  fs.writeFileSync(phase2Path, '# Phase 2 Core\nObjective: Implement engine', 'utf-8');
  fs.writeFileSync(phase3Path, '# Phase 3 Verify\nObjective: Run tests', 'utf-8');

  try {
    // -------------------------------------------------------------
    // Test 1: Sequential Flow Test (3 Phases End-to-End)
    // -------------------------------------------------------------
    console.log('[Test 1] Verifying 3-phase sequential end-to-end execution...');

    let sentPrompts: string[] = [];
    let executedKeyCommands: string[] = [];
    let convCounter = 1;

    const triggerNewConversation = () => {
      const currentConvId = `conv-${Date.now()}-${convCounter++}`;
      const convDir = path.join(tempBrainDir, currentConvId);
      fs.mkdirSync(convDir, { recursive: true });

      const stepJson = JSON.stringify({
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: `Phase done! ${DEFAULT_COMPLETION_KEYWORD}`
      });
      writeTranscriptLog(convDir, stepJson, 30);
      return currentConvId;
    };

    const mockKeyboard = new KeyboardManager({
      focusDelayMs: 10,
      selectDelayMs: 5,
      pasteDelayMs: 5,
      submitDelayMs: 10,
      customKeySender: async (keys) => {
        executedKeyCommands.push(keys);
      },
      customClipboardSetter: async (text) => {
        sentPrompts.push(text);
      },
      customBatchSender: async (_batchScript, actions) => {
        for (const action of actions) {
          if (action.type === 'sendKeys') {
            executedKeyCommands.push(action.value as string);
          }
        }
        triggerNewConversation();
      }
    });

    const originalOpenNewConv = mockKeyboard.openNewConversation.bind(mockKeyboard);
    mockKeyboard.openNewConversation = async (delayMs) => {
      await originalOpenNewConv(delayMs);
      triggerNewConversation();
    };

    const testWatcher = new TranscriptWatcher({
      brainDir: tempBrainDir,
      keyword: DEFAULT_COMPLETION_KEYWORD,
      timeoutMs: 5000,
      pollIntervalMs: 20,
      settleQuietPeriodMs: 50
    });

    const phaseStartEvents: PhaseItem[] = [];
    const phaseCompleteEvents: { phase: PhaseItem; result: CompletionResult }[] = [];
    let allCompleteCalledWith: number | null = null;
    let stateTransitions: string[] = [];

    const testConfig: AutoPlanConfig = {
      promptText: 'Implement {xxx}',
      promptTemplate: 'Run phase {path} and reply Done skul9x.',
      repeatCount: 3,
      completionKeyword: DEFAULT_COMPLETION_KEYWORD,
      delayBetweenLoopsMs: 50,
      timeoutPerLoopMinutes: 1,
      defaultPlanFolder: tempPlanDir
    };

    const orchestrator1 = new Orchestrator({
      configProvider: () => testConfig,
      keyboardManager: mockKeyboard,
      transcriptWatcher: testWatcher,
      onStateChange: (info: OrchestratorProgressInfo) => {
        stateTransitions.push(info.state);
      },
      onPhaseStart: (phase) => {
        phaseStartEvents.push({ ...phase });
      },
      onPhaseComplete: (phase, result) => {
        phaseCompleteEvents.push({ phase: { ...phase }, result });
      },
      onAllComplete: (total) => {
        allCompleteCalledWith = total;
      }
    });

    const startResult = await orchestrator1.startFolder(tempPlanDir);

    assert.strictEqual(startResult, true, 'startFolder should succeed');
    assert.strictEqual(phaseStartEvents.length, 3, 'Should have emitted 3 phaseStart events');
    assert.strictEqual(phaseCompleteEvents.length, 3, 'Should have emitted 3 phaseComplete events');
    assert.strictEqual(allCompleteCalledWith, 3, 'allComplete should receive total count 3');
    assert.strictEqual(orchestrator1.getState(), 'completed', 'Final state should be completed');

    const phases = orchestrator1.getPhases();
    assert.strictEqual(phases.length, 3, 'Should have 3 phases registered');
    assert.strictEqual(phases[0].status, 'Completed', 'Phase 1 should be Completed');
    assert.strictEqual(phases[1].status, 'Completed', 'Phase 2 should be Completed');
    assert.strictEqual(phases[2].status, 'Completed', 'Phase 3 should be Completed');

    assert.strictEqual(sentPrompts.length, 3, 'Should have sent 3 prompts');
    assert.ok(sentPrompts[0].includes('phase-01-scaffold.md'), 'Prompt 1 contains phase 1 path');
    assert.ok(sentPrompts[1].includes('phase-02-core.md'), 'Prompt 2 contains phase 2 path');
    assert.ok(sentPrompts[2].includes('phase-03-verify.md'), 'Prompt 3 contains phase 3 path');

    console.log('✓ Test 1 Passed: 3-phase sequential execution successfully completed.');

    // -------------------------------------------------------------
    // Test 2: Conversation Handoff & Anti-Pollution Test
    // -------------------------------------------------------------
    console.log('[Test 2] Verifying conversation isolation and lastConversationId handoff...');

    assert.ok(phases[0].conversationId, 'Phase 1 has conversationId');
    assert.ok(phases[1].conversationId, 'Phase 2 has conversationId');
    assert.ok(phases[2].conversationId, 'Phase 3 has conversationId');
    assert.notStrictEqual(
      phases[0].conversationId,
      phases[1].conversationId,
      'Phase 1 and 2 must have distinct conversations'
    );
    assert.notStrictEqual(
      phases[1].conversationId,
      phases[2].conversationId,
      'Phase 2 and 3 must have distinct conversations'
    );
    assert.strictEqual(
      orchestrator1.getLastConversationId(),
      phases[2].conversationId,
      'Last conversation ID must match Phase 3 conversation ID'
    );

    console.log('✓ Test 2 Passed: Conversation isolation verified across phase transitions.');

    // -------------------------------------------------------------
    // Test 3: Skip Current Phase Test
    // -------------------------------------------------------------
    console.log('[Test 3] Verifying skipCurrentPhase() behaviour...');

    const skippedEvents: PhaseItem[] = [];
    const orchestratorSkip = new Orchestrator({
      configProvider: () => testConfig,
      keyboardManager: mockKeyboard,
      transcriptWatcher: testWatcher,
      onSkipped: (phase) => {
        skippedEvents.push({ ...phase });
      }
    });

    // Custom flow where Phase 1 gets skipped mid-execution
    let phase1Started = false;
    orchestratorSkip.on('phaseStart', (phase) => {
      if (phase.index === 0 && !phase1Started) {
        phase1Started = true;
        // Trigger skip shortly after phase 1 starts
        setTimeout(() => {
          orchestratorSkip.skipCurrentPhase();
        }, 15);
      }
    });

    const skipResult = await orchestratorSkip.startFolder(tempPlanDir);
    assert.strictEqual(skipResult, true, 'Execution should finish successfully after skipping Phase 1');
    assert.strictEqual(skippedEvents.length, 1, 'Should have emitted 1 skipped event');
    assert.strictEqual(skippedEvents[0].fileName, 'phase-01-scaffold.md', 'Skipped event should be for phase 1');

    const skipPhases = orchestratorSkip.getPhases();
    assert.strictEqual(skipPhases[0].status, 'Skipped', 'Phase 1 status should be Skipped');
    assert.strictEqual(skipPhases[1].status, 'Completed', 'Phase 2 status should be Completed');
    assert.strictEqual(skipPhases[2].status, 'Completed', 'Phase 3 status should be Completed');

    console.log('✓ Test 3 Passed: skipCurrentPhase() properly skipped active phase and resumed flow.');

    // -------------------------------------------------------------
    // Test 4: Stop Execution Immediately Test
    // -------------------------------------------------------------
    console.log('[Test 4] Verifying stop() immediate halt and timer cancellation...');

    let stoppedFired = false;
    const orchestratorStop = new Orchestrator({
      configProvider: () => testConfig,
      keyboardManager: mockKeyboard,
      transcriptWatcher: testWatcher,
      onStopped: () => {
        stoppedFired = true;
      }
    });

    orchestratorStop.on('phaseStart', () => {
      // Trigger stop immediately upon first phase start
      setTimeout(() => {
        orchestratorStop.stop();
      }, 5);
    });

    const stopResult = await orchestratorStop.startFolder(tempPlanDir);
    assert.strictEqual(stopResult, false, 'startFolder should return false when stopped');
    assert.strictEqual(orchestratorStop.getState(), 'stopped', 'State must be stopped');
    assert.strictEqual(stoppedFired, true, 'onStopped listener must have fired');

    console.log('✓ Test 4 Passed: stop() cleanly halted execution.');

    // -------------------------------------------------------------
    // Test 5: Resume Execution from Specific Index (startFromIndex / resumeFrom)
    // -------------------------------------------------------------
    console.log('[Test 5] Verifying resumeFrom() and startFromIndex options...');

    const resumedPhaseStarts: PhaseItem[] = [];
    const orchestratorResume = new Orchestrator({
      configProvider: () => testConfig,
      keyboardManager: mockKeyboard,
      transcriptWatcher: testWatcher,
      onPhaseStart: (phase) => {
        resumedPhaseStarts.push({ ...phase });
      }
    });

    // Start with startFromIndex: 1 (skips Phase 1, runs Phase 2 and 3)
    const resumeResult = await orchestratorResume.startFolder(tempPlanDir, { startFromIndex: 1 });
    assert.strictEqual(resumeResult, true, 'Resume execution should succeed');
    assert.strictEqual(resumedPhaseStarts.length, 2, 'Only 2 phases should have started');
    assert.strictEqual(resumedPhaseStarts[0].fileName, 'phase-02-core.md', 'First started phase is Phase 2');
    assert.strictEqual(resumedPhaseStarts[1].fileName, 'phase-03-verify.md', 'Second started phase is Phase 3');

    const resPhases = orchestratorResume.getPhases();
    assert.strictEqual(resPhases[0].status, 'Pending', 'Phase 1 should remain Pending');
    assert.strictEqual(resPhases[1].status, 'Completed', 'Phase 2 should be Completed');
    assert.strictEqual(resPhases[2].status, 'Completed', 'Phase 3 should be Completed');

    // Test resumeFrom(2) on existing loaded instance
    const resumeFrom2Result = await orchestratorResume.resumeFrom(2);
    assert.strictEqual(resumeFrom2Result, true, 'resumeFrom(2) should succeed');
    assert.strictEqual(orchestratorResume.getPhases()[2].status, 'Completed');

    console.log('✓ Test 5 Passed: resume execution from arbitrary phase index verified.');

    // -------------------------------------------------------------
    // Test 6: Explicit String Array Paths via startPhases API
    // -------------------------------------------------------------
    console.log('[Test 6] Verifying startPhases() with explicit path list...');

    const orchestratorPhases = new Orchestrator({
      configProvider: () => testConfig,
      keyboardManager: mockKeyboard,
      transcriptWatcher: testWatcher
    });

    const explicitPathsResult = await orchestratorPhases.startPhases([phase1Path, phase3Path]);
    assert.strictEqual(explicitPathsResult, true, 'startPhases with string array should succeed');
    assert.strictEqual(orchestratorPhases.getPhases().length, 2, 'Should have exactly 2 phases');
    assert.strictEqual(orchestratorPhases.getPhases()[0].fileName, 'phase-01-scaffold.md');
    assert.strictEqual(orchestratorPhases.getPhases()[1].fileName, 'phase-03-verify.md');
    assert.strictEqual(orchestratorPhases.getPhases()[0].status, 'Completed');
    assert.strictEqual(orchestratorPhases.getPhases()[1].status, 'Completed');

    console.log('✓ Test 6 Passed: startPhases() works properly with explicit path array.');

    console.log('\n=== ALL PHASE 03 ORCHESTRATOR TESTS PASSED SUCCESSFULLY ===\n');
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  }
}

// Run tests
runPhase03Tests().catch((err) => {
  console.error('Phase 03 Test Failed with error:', err);
  process.exit(1);
});
