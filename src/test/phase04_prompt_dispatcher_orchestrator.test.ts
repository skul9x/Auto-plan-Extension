// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
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
          writeText: async () => {},
          readText: async () => ''
        }
      },
      commands: {
        executeCommand: async () => {}
      },
      window: {
        showWarningMessage: () => {}
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { PromptDispatcher, DispatchResult, DispatchTier } from '../promptDispatcher';
import { BridgeServer } from '../bridgeServer';
import { KeyboardManager } from '../keyboardManager';
import { Orchestrator, PhaseItem } from '../orchestrator';
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

async function runPhase04DispatcherTests() {
  console.log('=== Running Phase 04: Unified 3-Tier Prompt Dispatcher & Orchestrator Tests ===\n');

  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-test-'));
  const tempPlanDir = path.join(tempBaseDir, 'plans');
  const tempBrainDir = path.join(tempBaseDir, 'brain');

  fs.mkdirSync(tempPlanDir, { recursive: true });
  fs.mkdirSync(tempBrainDir, { recursive: true });

  const phase1Path = path.join(tempPlanDir, 'phase-01-dom.md');
  const phase2Path = path.join(tempPlanDir, 'phase-02-native.md');
  const phase3Path = path.join(tempPlanDir, 'phase-03-fallback.md');

  fs.writeFileSync(phase1Path, '# Phase 1: DOM Bridge\nObjective: Fast focus-free send', 'utf-8');
  fs.writeFileSync(phase2Path, '# Phase 2: Native Command\nObjective: VS Code Command API', 'utf-8');
  fs.writeFileSync(phase3Path, '# Phase 3: Keyboard Fallback\nObjective: OS SendKeys', 'utf-8');

  try {
    // -------------------------------------------------------------
    // Test 1: Tier 1 Direct Success (DOM Bridge)
    // -------------------------------------------------------------
    console.log('[Test 1] Verifying Tier 1 DOM Bridge prompt dispatch & acknowledgment...');

    const server1 = new BridgeServer({
      portStart: 49100,
      portEnd: 49120,
      windowKey: 'test-dom-win-1'
    });
    const port1 = await server1.start();

    // Start background simulated DOM renderer client polling the server
    let domClientRunning = true;
    const clientPollInterval = setInterval(async () => {
      if (!domClientRunning) return;
      try {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: port1,
            path: '/autoplan-status?windowKey=test-dom-win-1',
            method: 'GET'
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
              try {
                const parsed = JSON.parse(data);
                if (parsed.pendingCommands && parsed.pendingCommands.length > 0) {
                  for (const cmd of parsed.pendingCommands) {
                    // Send ACK
                    const ackReq = http.request({
                      hostname: '127.0.0.1',
                      port: port1,
                      path: '/autoplan-ack',
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' }
                    });
                    ackReq.write(
                      JSON.stringify({
                        commandId: cmd.id,
                        status: 'submitClicked',
                        windowKey: 'test-dom-win-1',
                        metadata: { promptLength: cmd.text?.length }
                      })
                    );
                    ackReq.end();
                  }
                }
              } catch {}
            });
          }
        );
        req.on('error', () => {});
        req.end();
      } catch {}
    }, 20);

    // Give client 50ms to register in bridge server status
    await sleep(60);

    const dispatcher1 = new PromptDispatcher({
      bridgeServer: server1,
      configProvider: () => ({
        ...({} as any),
        executionMode: 'auto',
        bridgeTimeoutMs: 2000
      })
    });

    const result1 = await dispatcher1.dispatchPrompt('Implement Tier 1 DOM Bridge feature');

    assert.strictEqual(result1.success, true, 'Tier 1 dispatch must succeed');
    assert.strictEqual(result1.tier, 'domBridge', 'Tier must be domBridge');
    assert.strictEqual(result1.status, 'submitClicked', 'Status should be submitClicked');
    assert.ok(result1.commandId, 'Command ID should be present');
    assert.ok(result1.durationMs >= 0, 'Duration should be recorded');
    assert.strictEqual(result1.metadata?.promptLength, 'Implement Tier 1 DOM Bridge feature'.length);

    domClientRunning = false;
    clearInterval(clientPollInterval);
    await server1.stop();

    console.log('✓ Test 1 Passed: Tier 1 DOM Bridge prompt dispatch succeeded.');

    // -------------------------------------------------------------
    // Test 2: Tier 2 Command Fallback (DOM Bridge fails -> VS Code Command)
    // -------------------------------------------------------------
    console.log('[Test 2] Verifying Tier 2 fallback to VS Code Command API...');

    const executedCommands: { command: string; args: any[] }[] = [];
    const mockCommandExecutor = async (command: string, ...args: any[]) => {
      executedCommands.push({ command, args });
      return true;
    };

    const serverDown = new BridgeServer({
      portStart: 49130,
      portEnd: 49140,
      windowKey: 'unconnected-win'
    });

    const dispatcher2 = new PromptDispatcher({
      bridgeServer: serverDown, // No client connected -> Tier 1 fails fast
      commandExecutor: mockCommandExecutor,
      configProvider: () => ({
        ...({} as any),
        executionMode: 'auto',
        bridgeTimeoutMs: 1000
      })
    });

    const result2 = await dispatcher2.dispatchPrompt('Implement Tier 2 Command feature');

    assert.strictEqual(result2.success, true, 'Tier 2 dispatch must succeed');
    assert.strictEqual(result2.tier, 'nativeCommand', 'Tier must be nativeCommand');
    assert.ok(result2.fallbackHistory, 'Fallback history must be present');
    assert.strictEqual(result2.fallbackHistory?.length, 1, 'Should have 1 fallback recorded');
    assert.strictEqual(result2.fallbackHistory?.[0].tier, 'domBridge', 'Fallback should record domBridge failure');

    const sendCmd = executedCommands.find((c) => c.command === 'antigravity.sendTextToChat');
    assert.ok(sendCmd, 'antigravity.sendTextToChat must have been invoked');
    assert.strictEqual(sendCmd?.args[0], 'Implement Tier 2 Command feature');

    console.log('✓ Test 2 Passed: Tier 2 fallback to VS Code Command API succeeded.');

    // -------------------------------------------------------------
    // Test 3: Tier 3 Keyboard Fallback (DOM Bridge & Command API fail -> SendKeys)
    // -------------------------------------------------------------
    console.log('[Test 3] Verifying Tier 3 fallback to KeyboardManager simulation...');

    let keyboardBatchScript = '';
    let warningMessages: string[] = [];

    const mockKeyboard = new KeyboardManager({
      customBatchSender: async (batchScript) => {
        keyboardBatchScript = batchScript;
      }
    });

    const mockFailingCommandExecutor = async (command: string) => {
      throw new Error(`Command '${command}' not found in registry`);
    };

    const dispatcher3 = new PromptDispatcher({
      bridgeServer: serverDown,
      commandExecutor: mockFailingCommandExecutor,
      keyboardManager: mockKeyboard,
      warningNotifier: (msg) => {
        warningMessages.push(msg);
      },
      configProvider: () => ({
        ...({} as any),
        executionMode: 'auto',
        bridgeTimeoutMs: 500,
        focusDelayMs: 50
      })
    });

    const result3 = await dispatcher3.dispatchPrompt('Implement Tier 3 Keyboard Fallback');

    assert.strictEqual(result3.success, true, 'Tier 3 dispatch must succeed');
    assert.strictEqual(result3.tier, 'keyboard', 'Tier must be keyboard');
    assert.ok(result3.fallbackHistory, 'Fallback history must be present');
    assert.strictEqual(result3.fallbackHistory?.length, 2, 'Should record 2 tier failures (domBridge and nativeCommand)');
    assert.strictEqual(result3.fallbackHistory?.[0].tier, 'domBridge');
    assert.strictEqual(result3.fallbackHistory?.[1].tier, 'nativeCommand');

    assert.ok(warningMessages.length > 0, 'Warning notification should be emitted for Tier 3 fallback');
    assert.ok(keyboardBatchScript.length > 0, 'Keyboard batch script should have been executed');

    console.log('✓ Test 3 Passed: Tier 3 fallback to KeyboardManager succeeded.');

    // -------------------------------------------------------------
    // Test 4: Execution Mode Override (Strict mode enforcement)
    // -------------------------------------------------------------
    console.log('[Test 4] Verifying forced executionMode overrides...');

    // 4A: Forced domBridge failure (must NOT fall back to Tier 2 or 3)
    const dispatcherForcedDom = new PromptDispatcher({
      bridgeServer: serverDown,
      commandExecutor: mockCommandExecutor,
      keyboardManager: mockKeyboard,
      configProvider: () => ({
        ...({} as any),
        executionMode: 'domBridge',
        bridgeTimeoutMs: 300
      })
    });

    let domError: Error | null = null;
    try {
      await dispatcherForcedDom.dispatchPrompt('Forced DOM Bridge Prompt');
    } catch (err: any) {
      domError = err;
    }
    assert.ok(domError, 'Forced domBridge mode should throw when bridge is unavailable');
    assert.ok(
      domError?.message.includes('DOM Bridge Transport Failed'),
      `Error message should indicate DOM Bridge transport failure: ${domError?.message}`
    );

    // 4B: Forced keyboard mode (must use keyboard directly without trying Tier 1 or 2)
    let forcedKeyboardExecuted = false;
    const mockKeyboardForced = new KeyboardManager({
      customBatchSender: async () => {
        forcedKeyboardExecuted = true;
      }
    });

    const dispatcherForcedKeyboard = new PromptDispatcher({
      bridgeServer: serverDown,
      commandExecutor: mockCommandExecutor,
      keyboardManager: mockKeyboardForced,
      configProvider: () => ({
        ...({} as any),
        executionMode: 'keyboard'
      })
    });

    const resultForcedKey = await dispatcherForcedKeyboard.dispatchPrompt('Forced Keyboard Prompt');
    assert.strictEqual(resultForcedKey.tier, 'keyboard');
    assert.strictEqual(forcedKeyboardExecuted, true, 'Keyboard sender was invoked');
    assert.strictEqual(resultForcedKey.fallbackHistory, undefined, 'No fallback history in direct mode');

    console.log('✓ Test 4 Passed: Execution mode enforcement verified.');

    // -------------------------------------------------------------
    // Test 5: Orchestrator End-to-End Execution with Multi-Tier Tracking
    // -------------------------------------------------------------
    console.log('[Test 5] Verifying Orchestrator integration with PromptDispatcher across phases...');

    let phaseExecutionIndex = 0;
    const phaseDispatches: { phaseIndex: number; tier: DispatchTier; prompt: string }[] = [];

    // Custom mock dispatcher for Orchestrator test:
    // Phase 1 -> uses DOM Bridge
    // Phase 2 -> uses Native Command
    // Phase 3 -> uses Keyboard
    const customTestDispatcher = new PromptDispatcher({
      configProvider: () => ({
        ...({} as any),
        executionMode: 'auto'
      })
    });

    customTestDispatcher.dispatchPrompt = async (promptText: string) => {
      const idx = phaseExecutionIndex++;
      let tier: DispatchTier = 'domBridge';
      if (idx === 1) tier = 'nativeCommand';
      if (idx === 2) tier = 'keyboard';

      phaseDispatches.push({ phaseIndex: idx, tier, prompt: promptText });

      // Simulate conversation trigger
      const currentConvId = `conv-p04-${Date.now()}-${idx + 1}`;
      const convDir = path.join(tempBrainDir, currentConvId);
      fs.mkdirSync(convDir, { recursive: true });

      const stepJson = JSON.stringify({
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: `Phase completed successfully! ${DEFAULT_COMPLETION_KEYWORD}`
      });
      writeTranscriptLog(convDir, stepJson, 20);

      return {
        success: true,
        tier,
        durationMs: 45,
        commandId: `cmd-test-${idx + 1}`,
        status: 'completed',
        metadata: { phaseIndex: idx }
      };
    };

    const testWatcher = new TranscriptWatcher({
      brainDir: tempBrainDir,
      keyword: DEFAULT_COMPLETION_KEYWORD,
      timeoutMs: 4000,
      pollIntervalMs: 20,
      settleQuietPeriodMs: 30
    });

    const completedPhases: PhaseItem[] = [];

    const orchestratorE2E = new Orchestrator({
      promptDispatcher: customTestDispatcher,
      transcriptWatcher: testWatcher,
      configProvider: () => ({
        promptText: 'Implement {xxx}',
        promptTemplate: 'Execute {path} - Done skul9x.',
        repeatCount: 3,
        completionKeyword: DEFAULT_COMPLETION_KEYWORD,
        delayBetweenLoopsMs: 30,
        timeoutPerLoopMinutes: 1,
        defaultPlanFolder: tempPlanDir,
        executionMode: 'auto',
        bridgeTimeoutMs: 3000
      }),
      onPhaseComplete: (phase) => {
        completedPhases.push({ ...phase });
      }
    });

    const startSuccess = await orchestratorE2E.startFolder(tempPlanDir);

    assert.strictEqual(startSuccess, true, 'Orchestrator run should succeed');
    assert.strictEqual(completedPhases.length, 3, 'All 3 phases must complete');

    const finalPhases = orchestratorE2E.getPhases();
    assert.strictEqual(finalPhases.length, 3);

    // Verify Phase 1 Tier Tracking (DOM Bridge)
    assert.strictEqual(finalPhases[0].status, 'Completed');
    assert.strictEqual(finalPhases[0].dispatchResult?.tier, 'domBridge');
    assert.strictEqual(finalPhases[0].result?.metadata?.dispatch?.tier, 'domBridge');

    // Verify Phase 2 Tier Tracking (Native Command)
    assert.strictEqual(finalPhases[1].status, 'Completed');
    assert.strictEqual(finalPhases[1].dispatchResult?.tier, 'nativeCommand');
    assert.strictEqual(finalPhases[1].result?.metadata?.dispatch?.tier, 'nativeCommand');

    // Verify Phase 3 Tier Tracking (Keyboard)
    assert.strictEqual(finalPhases[2].status, 'Completed');
    assert.strictEqual(finalPhases[2].dispatchResult?.tier, 'keyboard');
    assert.strictEqual(finalPhases[2].result?.metadata?.dispatch?.tier, 'keyboard');

    orchestratorE2E.dispose();
    console.log('✓ Test 5 Passed: Orchestrator multi-phase execution & tier tracking verified.');

    console.log('\n=== ALL PHASE 04 PROMPT DISPATCHER & ORCHESTRATOR TESTS PASSED ===\n');
  } finally {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  }
}

// Run test suite
runPhase04DispatcherTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Phase 04 Test Suite Failed with error:', err);
    process.exit(1);
  });
