// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let createdStatusBarItems: any[] = [];
let shownInfoMessages: string[] = [];
let shownErrorMessages: string[] = [];
let configStore: { [key: string]: any } = {
  promptText: 'Hãy trả lời tôi với câu trả lời là "Done skul9x.", ngoài ra không nói gì thêm',
  repeatCount: 5,
  completionKeyword: 'Done skul9x.',
  delayBetweenLoopsMs: 100,
  timeoutPerLoopMinutes: 15
};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key: string, defaultValue: any) =>
            configStore[key] !== undefined ? configStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            configStore[key] = val;
          }
        }),
        onDidChangeConfiguration: (cb: any) => ({
          dispose: () => {}
        })
      },
      window: {
        createStatusBarItem: (alignment: number, priority: number) => {
          const item = {
            alignment,
            priority,
            text: '',
            tooltip: '',
            command: undefined as string | undefined,
            visible: false,
            show() {
              this.visible = true;
            },
            hide() {
              this.visible = false;
            },
            dispose() {}
          };
          createdStatusBarItems.push(item);
          return item;
        },
        showInformationMessage: async (msg: string) => {
          shownInfoMessages.push(msg);
          return msg;
        },
        showErrorMessage: async (msg: string) => {
          shownErrorMessages.push(msg);
          return msg;
        },
        showWarningMessage: async (msg: string) => msg,
        showInputBox: async (opts: any) => 'Custom new prompt text'
      },
      commands: {
        registerCommand: (command: string, callback: (...args: any[]) => any) => {
          registeredCommands[command] = callback;
          return {
            dispose: () => {
              delete registeredCommands[command];
            }
          };
        }
      },
      StatusBarAlignment: {
        Left: 1,
        Right: 2
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Orchestrator, OrchestratorProgressInfo } from '../orchestrator';
import { KeyboardManager } from '../keyboardManager';
import { TranscriptWatcher } from '../transcriptWatcher';
import { activate, deactivate } from '../extension';

async function runPhase04Tests() {
  console.log('=== Running Phase 04 Loop Orchestrator & Status Bar UI Tests ===');

  const testTempDir = path.join(os.tmpdir(), `antigravity_orchestrator_test_${Date.now()}`);
  fs.mkdirSync(testTempDir, { recursive: true });

  try {
    // -------------------------------------------------------------
    // Test 1: Full Multi-Loop Execution Flow (3 loops)
    // -------------------------------------------------------------
    console.log('-> Test 1: Multi-Loop Execution (Prompt -> Watch -> Delay -> Next Loop)');

    const promptSentLog: string[] = [];
    const mockKeyboard = new KeyboardManager({
      focusDelayMs: 10,
      selectDelayMs: 5,
      pasteDelayMs: 5,
      submitDelayMs: 10,
      customKeySender: async (keys: string) => {
        // Record keystrokes
      },
      customClipboardSetter: async (text: string) => {
        promptSentLog.push(text);
      }
    });

    const mockWatcher = new TranscriptWatcher({
      brainDir: testTempDir,
      keyword: 'Done skul9x.',
      pollIntervalMs: 20,
      settleQuietPeriodMs: 20
    });

    const stateTransitions: OrchestratorProgressInfo[] = [];
    const iterationCompletedList: number[] = [];
    let allCompletedTotal = 0;

    const orchestratorInstance = new Orchestrator({
      configProvider: () => ({
        promptText: 'Test iteration prompt',
        repeatCount: 3,
        completionKeyword: 'Done skul9x.',
        delayBetweenLoopsMs: 100,
        timeoutPerLoopMinutes: 1
      }),
      keyboardManager: mockKeyboard,
      transcriptWatcher: mockWatcher,
      onStateChange: (info) => {
        stateTransitions.push({ ...info });
      },
      onIterationComplete: (iter, total) => {
        iterationCompletedList.push(iter);
      },
      onAllComplete: (total) => {
        allCompletedTotal = total;
      }
    });

    // Create simulated background transcript generation as loop progresses
    let simulatedConvCount = 0;
    const simulateAgentResponse = () => {
      simulatedConvCount++;
      const convFolder = path.join(testTempDir, `conv_sim_${simulatedConvCount}_${Date.now()}`);
      const logDir = path.join(convFolder, '.system_generated', 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      const transcriptPath = path.join(logDir, 'transcript.jsonl');
      fs.writeFileSync(
        transcriptPath,
        JSON.stringify({ step_index: 1, type: 'USER_INPUT', content: 'Test iteration prompt' }) + '\n' +
        JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', content: 'Processing... Done skul9x.' }) + '\n',
        'utf-8'
      );
    };

    // Trigger simulation whenever watcher starts looking or periodically
    const simulationInterval = setInterval(() => {
      if (orchestratorInstance.getState() === 'waiting' || orchestratorInstance.getState() === 'sending') {
        simulateAgentResponse();
      }
    }, 150);

    const startSuccess = await orchestratorInstance.start();
    clearInterval(simulationInterval);

    assert.strictEqual(startSuccess, true, 'Orchestrator should successfully complete all loops');
    assert.strictEqual(allCompletedTotal, 3, 'allComplete callback should report 3 iterations');
    assert.deepStrictEqual(iterationCompletedList, [1, 2, 3], 'Should have completed iterations 1, 2, and 3');
    assert.strictEqual(promptSentLog.length, 3, 'Prompt should have been sent exactly 3 times');
    assert.strictEqual(orchestratorInstance.getState(), 'completed');
    console.log('✓ Test 1: Full Multi-Loop Execution verified (3/3 loops executed, prompts sent, completions tracked)');

    // -------------------------------------------------------------
    // Test 2: Instant Stop/Abort during Delay & Waiting
    // -------------------------------------------------------------
    console.log('-> Test 2: Instant Abort & Stop mechanism');

    let stopCallbackFired = false;
    const abortOrchestrator = new Orchestrator({
      configProvider: () => ({
        promptText: 'Abort test prompt',
        repeatCount: 5,
        completionKeyword: 'Done skul9x.',
        delayBetweenLoopsMs: 10000, // long delay
        timeoutPerLoopMinutes: 1
      }),
      keyboardManager: mockKeyboard,
      transcriptWatcher: mockWatcher,
      onStopped: () => {
        stopCallbackFired = true;
      }
    });

    // Start in background and stop immediately when running
    const startAbortPromise = abortOrchestrator.start();

    // Give a small tick for it to enter sending/waiting
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(abortOrchestrator.isRunning(), true, 'Orchestrator should be running before stop');

    const stopTime = Date.now();
    abortOrchestrator.stop();

    const abortResult = await startAbortPromise;
    const stopDuration = Date.now() - stopTime;

    assert.strictEqual(abortResult, false, 'Start promise should return false on abort');
    assert.strictEqual(abortOrchestrator.getState(), 'stopped');
    assert.strictEqual(stopCallbackFired, true, 'Stopped event must fire');
    assert.ok(stopDuration < 300, `Stop must interrupt immediately (took ${stopDuration}ms, expected < 300ms)`);
    console.log(`✓ Test 2: Instant Abort mechanism verified (Stopped in ${stopDuration}ms)`);

    // -------------------------------------------------------------
    // Test 3: Extension Activation, Status Bar UI & Command Handlers
    // -------------------------------------------------------------
    console.log('-> Test 3: Extension Status Bar UI and Commands Integration');

    const extensionContext: any = {
      subscriptions: []
    };

    activate(extensionContext);

    // Verify status bar items created
    assert.ok(createdStatusBarItems.length >= 1, 'Should create main status bar item');
    const mainItem = createdStatusBarItems[0];

    // Check Idle UI
    assert.ok(mainItem.text.includes('Auto-Plan'), 'Idle main item text should include Auto-Plan');
    assert.strictEqual(mainItem.command, 'autoplan.start');
    assert.strictEqual(mainItem.visible, true);
    console.log('  - Idle Status Bar Item verified:', mainItem.text);

    // Verify commands registered
    assert.ok(typeof registeredCommands['autoplan.start'] === 'function', 'autoplan.start command registered');
    assert.ok(typeof registeredCommands['autoplan.stop'] === 'function', 'autoplan.stop command registered');
    assert.ok(typeof registeredCommands['autoplan.setPrompt'] === 'function', 'autoplan.setPrompt command registered');

    // Test 'autoplan.setPrompt' command
    await registeredCommands['autoplan.setPrompt']();
    assert.strictEqual(configStore.promptText, 'Custom new prompt text', 'Prompt text should be updated in config');
    assert.ok(shownInfoMessages.some((m) => m.includes('Prompt updated')), 'Notification for prompt update shown');
    console.log('  - SetPrompt command verified');

    // Test 'autoplan.stop' when not running
    await registeredCommands['autoplan.stop']();
    assert.ok(shownInfoMessages.some((m) => m.includes('not currently running')), 'Notification shown when stopping idle');

    // Test UI update on running state change
    const runningInfo: OrchestratorProgressInfo = {
      state: 'waiting',
      currentIteration: 2,
      totalIterations: 5,
      message: 'Waiting for Agent...'
    };
    orchestratorInstance.emit('stateChange', runningInfo);

    // Test deactivate cleanup
    deactivate();
    console.log('✓ Test 3: Extension UI, Status Bar, Commands & Lifecycle verified');

    console.log('\n=== All Phase 04 Tests Passed Successfully! ===');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase04Tests().catch((err) => {
  console.error('Phase 04 Test Failed:', err);
  process.exit(1);
});
