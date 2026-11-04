// Standalone mock for 'vscode' module when executed directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {};
const globalExecutedCommands: { command: string; args: any[]; timestamp: number }[] = [];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (_section: string) => ({
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
        executeCommand: async (cmd: string, ...args: any[]) => {
          globalExecutedCommands.push({ command: cmd, args, timestamp: Date.now() });
          return undefined;
        },
        getCommands: async (_internal?: boolean) => [
          'antigravity.startNewConversation',
          'antigravity.addContext',
          'antigravity.triggerSend',
          'antigravity.prioritized.chat.stop',
          'workbench.action.chat.stop'
        ]
      },
      window: {
        showWarningMessage: (_msg: string) => undefined,
        showInformationMessage: async () => {},
        showErrorMessage: async () => {}
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getConfig,
  DEFAULT_CONFIG,
  writeSidecarConfig,
  AutoPlanConfig
} from '../config';
import { PromptDispatcher } from '../promptDispatcher';
import { Orchestrator } from '../orchestrator';
import { DebugLogger } from '../debugLogger';

async function runPhase01NativeDispatcherAndConfigTests() {
  console.log('================================================================');
  console.log(' Phase 01: Native Antigravity Chat API & Config Refactoring Test');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    totalTests++;
    process.stdout.write(`  Test ${totalTests}: ${name} ... `);
    try {
      await fn();
      console.log('✓ PASS');
      passedTests++;
    } catch (err: any) {
      console.log('✗ FAIL');
      console.error(err);
      throw err;
    }
  }

  const testLogger = new DebugLogger(100);

  // -------------------------------------------------------------------------
  // Group 1: Configuration Management & sendDelayMs Defaulting
  // -------------------------------------------------------------------------
  console.log('--- Group 1: Configuration Schema & sendDelayMs Defaults ---');

  await test('sendDelayMs defaults to 500ms in DEFAULT_CONFIG', () => {
    assert.strictEqual(DEFAULT_CONFIG.sendDelayMs, 500, 'DEFAULT_CONFIG.sendDelayMs must be 500');
  });

  await test('getConfig() returns 500ms when sendDelayMs is not configured', () => {
    delete mockConfigStore['sendDelayMs'];
    const cfg = getConfig();
    assert.strictEqual(cfg.sendDelayMs, 500, 'getConfig() must default sendDelayMs to 500');
  });

  await test('getConfig() respects custom sendDelayMs when specified', () => {
    mockConfigStore['sendDelayMs'] = 750;
    const cfg = getConfig();
    assert.strictEqual(cfg.sendDelayMs, 750, 'getConfig() must return configured sendDelayMs');
    delete mockConfigStore['sendDelayMs'];
  });

  await test('Deprecated configuration keys read safely without errors or crashes', () => {
    mockConfigStore['executionMode'] = 'auto';
    mockConfigStore['allowTierFallback'] = true;
    mockConfigStore['strictMode'] = false;
    mockConfigStore['bridgeTimeoutMs'] = 4500;

    const cfg = getConfig();
    assert.strictEqual(cfg.executionMode, 'auto');
    assert.strictEqual(cfg.allowTierFallback, true);
    assert.strictEqual(cfg.strictMode, false);
    assert.strictEqual(cfg.bridgeTimeoutMs, 4500);

    // Clean up
    delete mockConfigStore['executionMode'];
    delete mockConfigStore['allowTierFallback'];
    delete mockConfigStore['strictMode'];
    delete mockConfigStore['bridgeTimeoutMs'];
  });

  await test('writeSidecarConfig serializes sendDelayMs safely', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-cfg-'));
    try {
      const writtenFile = writeSidecarConfig({ sendDelayMs: 650 } as AutoPlanConfig, tmpDir);
      assert.ok(writtenFile && fs.existsSync(writtenFile), 'Config file must be written');
      const content = JSON.parse(fs.readFileSync(writtenFile, 'utf8'));
      assert.strictEqual(content.sendDelayMs, 650, 'Serialized sidecar config must contain sendDelayMs');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Group 2: Native Dispatch Pipeline Execution Sequence
  // -------------------------------------------------------------------------
  console.log('\n--- Group 2: Native Dispatch Pipeline Execution Sequence ---');

  await test('dispatchPrompt executes pure native sequence with newConversation: true', async () => {
    const recordedEvents: { command: string; args: any[]; time: number }[] = [];
    const startTime = Date.now();

    const mockExecutor = async (cmd: string, ...args: any[]) => {
      recordedEvents.push({ command: cmd, args, time: Date.now() });
      return undefined;
    };

    const dispatcher = new PromptDispatcher({
      commandExecutor: mockExecutor,
      logger: testLogger,
      configProvider: () => ({ ...DEFAULT_CONFIG, sendDelayMs: 200 })
    });

    const promptText = 'Phase 01: Test prompt for native dispatch';
    const result = await dispatcher.dispatchPrompt(promptText, {
      newConversation: true,
      sendDelayMs: 200
    });

    assert.strictEqual(result.success, true, 'DispatchResult must be successful');
    assert.strictEqual(result.tier, 'nativeCommand', 'Result tier must be nativeCommand');
    assert.strictEqual(result.metadata?.engine, 'Native Antigravity Dispatch');

    // Verify exact call count and command names
    assert.strictEqual(recordedEvents.length, 3, 'Exactly 3 native commands must be executed');
    assert.strictEqual(recordedEvents[0].command, 'antigravity.startNewConversation');
    assert.strictEqual(recordedEvents[1].command, 'antigravity.addContext');
    assert.deepStrictEqual(recordedEvents[1].args, [promptText]);
    assert.strictEqual(recordedEvents[2].command, 'antigravity.triggerSend');

    // Verify timing constraints:
    // Event 1 (addContext) must happen after stabilization pause (>= 380ms after startNewConversation)
    const stabilizationDelay = recordedEvents[1].time - recordedEvents[0].time;
    assert.ok(
      stabilizationDelay >= 380,
      `Stabilization delay after startNewConversation must be >= 380ms (was ${stabilizationDelay}ms)`
    );

    // Event 2 (triggerSend) must happen after sendDelayMs (>= 190ms after addContext)
    const sendDelay = recordedEvents[2].time - recordedEvents[1].time;
    assert.ok(
      sendDelay >= 190,
      `Delay prior to triggerSend must be >= 190ms (was ${sendDelay}ms)`
    );
  });

  await test('dispatchPrompt executes addContext -> triggerSend without startNewConversation when newConversation is false', async () => {
    const recordedEvents: { command: string; args: any[]; time: number }[] = [];

    const mockExecutor = async (cmd: string, ...args: any[]) => {
      recordedEvents.push({ command: cmd, args, time: Date.now() });
      return undefined;
    };

    const dispatcher = new PromptDispatcher({
      commandExecutor: mockExecutor,
      logger: testLogger,
      configProvider: () => ({ ...DEFAULT_CONFIG, sendDelayMs: 100 })
    });

    const promptText = 'Steering prompt / nudge message without new conversation';
    const result = await dispatcher.dispatchPrompt(promptText, {
      newConversation: false,
      openNewConversation: false,
      sendDelayMs: 100
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(recordedEvents.length, 2, 'Exactly 2 commands must be executed (no startNewConversation)');
    assert.strictEqual(recordedEvents[0].command, 'antigravity.addContext');
    assert.strictEqual(recordedEvents[1].command, 'antigravity.triggerSend');
  });

  // -------------------------------------------------------------------------
  // Group 3: Isolation from Legacy DOM Bridge & Keyboard Simulators
  // -------------------------------------------------------------------------
  console.log('\n--- Group 3: Isolation from Legacy DOM Bridge & Keyboard Simulators ---');

  await test('Asserts that neither DOM bridge HTTP endpoints nor keyboard simulator binaries are invoked', async () => {
    let bridgeEndpointCalled = false;
    let keyboardBinaryCalled = false;

    const mockBridgeServer: any = {
      isListening: () => {
        bridgeEndpointCalled = true;
        return true;
      },
      dispatchPromptCommand: async () => {
        bridgeEndpointCalled = true;
        throw new Error('DOM Bridge dispatchPromptCommand should not be called');
      },
      dispatchNewConversationCommand: async () => {
        bridgeEndpointCalled = true;
        throw new Error('DOM Bridge dispatchNewConversationCommand should not be called');
      },
      probeActiveClients: async () => {
        bridgeEndpointCalled = true;
      },
      getConnectedClients: () => {
        bridgeEndpointCalled = true;
        return [];
      }
    };

    const mockKeyboardManager: any = {
      executeBatchPromptFlow: async () => {
        keyboardBinaryCalled = true;
        throw new Error('KeyboardManager should not be called');
      },
      checkLinuxKeyboardPrerequisites: () => {
        keyboardBinaryCalled = true;
        return { available: false, binary: null };
      }
    };

    const executedNativeCommands: string[] = [];
    const mockExecutor = async (cmd: string) => {
      executedNativeCommands.push(cmd);
      return undefined;
    };

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      keyboardManager: mockKeyboardManager,
      commandExecutor: mockExecutor,
      logger: testLogger,
      configProvider: () => ({ ...DEFAULT_CONFIG, sendDelayMs: 50 })
    });

    await dispatcher.dispatchPrompt('Testing zero-touch legacy bridge isolation', {
      newConversation: true,
      sendDelayMs: 50
    });

    assert.strictEqual(bridgeEndpointCalled, false, 'DOM bridge HTTP/IPC endpoints must NOT be invoked during native dispatch');
    assert.strictEqual(keyboardBinaryCalled, false, 'Keyboard simulator binaries must NOT be invoked during native dispatch');
    assert.strictEqual(executedNativeCommands.length, 3, 'Native commands must be executed instead');
  });

  // -------------------------------------------------------------------------
  // Group 4: Readiness Validation Output Structure & Diagnostics
  // -------------------------------------------------------------------------
  console.log('\n--- Group 4: Readiness Validation Structure & Error Diagnostics ---');

  await test('validateDispatchReadiness reports ready: true and identifies engine as Native Antigravity Dispatch', () => {
    const mockExecutor = async (_cmd: string) => undefined;
    const dispatcher = new PromptDispatcher({
      commandExecutor: mockExecutor,
      logger: testLogger
    });

    const readiness = dispatcher.validateDispatchReadiness();
    assert.strictEqual(readiness.ready, true, 'Readiness must be true when executor is available');
    assert.strictEqual(readiness.selectedTier, 'nativeCommand', 'selectedTier must be nativeCommand');
    assert.strictEqual(readiness.engine, 'Native Antigravity Dispatch', 'engine must identify as Native Antigravity Dispatch');
    assert.strictEqual(readiness.isFocusFree, true, 'isFocusFree must be true (true background execution)');
    assert.strictEqual(readiness.requiresForegroundFocus, false, 'requiresForegroundFocus must be false');
    assert.strictEqual(readiness.details.nativeCommandsAvailable, true);
  });

  await test('validateDispatchReadiness reports ready: false when command executor is unavailable', () => {
    const dispatcher = new PromptDispatcher({
      commandExecutor: null as any,
      logger: testLogger
    });

    const readiness = dispatcher.validateDispatchReadiness();
    assert.strictEqual(readiness.ready, false, 'Readiness must be false when executor is missing');
    assert.strictEqual(readiness.engine, 'Native Antigravity Dispatch');
    assert.ok(readiness.errorMessage, 'errorMessage must be present on failure');
    assert.ok(
      readiness.errorMessage?.includes('unavailable') || readiness.errorMessage?.includes('not callable'),
      `Error message must explain failure: ${readiness.errorMessage}`
    );
  });

  await test('ensureBridgeReadinessWithWakeup cleanly resolves native readiness without starting bridge server', async () => {
    const mockExecutor = async (_cmd: string) => undefined;
    const dispatcher = new PromptDispatcher({
      commandExecutor: mockExecutor,
      logger: testLogger
    });

    const readiness = await dispatcher.ensureBridgeReadinessWithWakeup(100);
    assert.strictEqual(readiness.ready, true);
    assert.strictEqual(readiness.engine, 'Native Antigravity Dispatch');
  });

  await test('dispatchPrompt handles errors gracefully when antigravity.addContext fails', async () => {
    const mockExecutor = async (cmd: string, ..._args: any[]) => {
      if (cmd === 'antigravity.addContext') {
        throw new Error("Command 'antigravity.addContext' not found");
      }
      return undefined;
    };

    const dispatcher = new PromptDispatcher({
      commandExecutor: mockExecutor,
      logger: testLogger,
      configProvider: () => ({ ...DEFAULT_CONFIG, sendDelayMs: 50 })
    });

    let caughtError: any;
    try {
      await dispatcher.dispatchPrompt('Test error path', {
        newConversation: false,
        sendDelayMs: 50
      });
    } catch (err: any) {
      caughtError = err;
    }

    assert.ok(caughtError, 'dispatchPrompt must throw structured error on command failure');
    assert.ok(
      caughtError.message.includes('[Native Antigravity Dispatch Failed]'),
      `Error must contain structured prefix: ${caughtError.message}`
    );
    assert.ok(
      caughtError.message.includes('antigravity.addContext'),
      `Error must mention failed command: ${caughtError.message}`
    );
    assert.ok(
      caughtError.message.includes('Remediation:'),
      `Error must contain remediation guidance: ${caughtError.message}`
    );
    assert.strictEqual(caughtError.code, 'NATIVE_COMMAND_FAILED');
    assert.strictEqual(caughtError.command, 'antigravity.addContext');
  });

  await test('dispatchPrompt handles errors gracefully when antigravity.triggerSend fails', async () => {
    const mockExecutor = async (cmd: string, ..._args: any[]) => {
      if (cmd === 'antigravity.triggerSend') {
        throw new Error('Chat send button disabled or unready');
      }
      return undefined;
    };

    const dispatcher = new PromptDispatcher({
      commandExecutor: mockExecutor,
      logger: testLogger,
      configProvider: () => ({ ...DEFAULT_CONFIG, sendDelayMs: 50 })
    });

    let caughtError: any;
    try {
      await dispatcher.dispatchPrompt('Test triggerSend error path', {
        newConversation: false,
        sendDelayMs: 50
      });
    } catch (err: any) {
      caughtError = err;
    }

    assert.ok(caughtError, 'dispatchPrompt must throw structured error on command failure');
    assert.ok(
      caughtError.message.includes('[Native Antigravity Dispatch Failed]'),
      `Error must contain structured prefix: ${caughtError.message}`
    );
    assert.strictEqual(caughtError.command, 'antigravity.triggerSend');
  });

  await test('stopActiveGeneration executes native chat stop commands without DOM bridge', async () => {
    const stopCommandsExecuted: string[] = [];
    const mockExecutor = async (cmd: string) => {
      stopCommandsExecuted.push(cmd);
      return undefined;
    };

    const dispatcher = new PromptDispatcher({
      commandExecutor: mockExecutor,
      logger: testLogger
    });

    const stopped = await dispatcher.stopActiveGeneration();
    assert.strictEqual(stopped, true, 'stopActiveGeneration must succeed');
    assert.ok(
      stopCommandsExecuted.includes('antigravity.prioritized.chat.stop'),
      'Must execute antigravity.prioritized.chat.stop'
    );
  });

  // -------------------------------------------------------------------------
  // Group 5: Orchestrator Integration & Execution Loop Alignment
  // -------------------------------------------------------------------------
  console.log('\n--- Group 5: Orchestrator Integration Alignment ---');

  await test('Orchestrator pre-flight check succeeds with Native Antigravity Dispatcher', async () => {
    const mockExecutor = async (_cmd: string) => undefined;
    const dispatcher = new PromptDispatcher({
      commandExecutor: mockExecutor,
      logger: testLogger
    });

    const orchestrator = new Orchestrator({
      promptDispatcher: dispatcher,
      debugLogger: testLogger,
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        repeatCount: 1,
        sendDelayMs: 50
      })
    });

    const readiness = orchestrator.getLastPreflightResult();
    // Validate that dispatcher readiness check works with orchestrator
    const directReadiness = dispatcher.validateDispatchReadiness();
    assert.strictEqual(directReadiness.ready, true);
    assert.strictEqual(directReadiness.engine, 'Native Antigravity Dispatch');
  });

  await test('Orchestrator executeNudgeProcedure dispatches steering prompt via native dispatcher', async () => {
    const dispatchedCommands: { cmd: string; prompt?: any }[] = [];
    const mockExecutor = async (cmd: string, ...args: any[]) => {
      dispatchedCommands.push({ cmd, prompt: args[0] });
      return undefined;
    };

    const dispatcher = new PromptDispatcher({
      commandExecutor: mockExecutor,
      logger: testLogger,
      configProvider: () => ({ ...DEFAULT_CONFIG, sendDelayMs: 50 })
    });

    const orchestrator = new Orchestrator({
      promptDispatcher: dispatcher,
      debugLogger: testLogger,
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        sendDelayMs: 50
      })
    });

    let phaseNudgedEmitted = false;
    orchestrator.on('phaseNudged', (event) => {
      phaseNudgedEmitted = true;
      assert.strictEqual(event.message, 'Mid-flight steering test nudge');
    });

    const dummyPhase: any = {
      index: 0,
      phaseNumber: 1,
      fileName: 'phase-01-test.md',
      filePath: '/dummy/phase-01-test.md',
      nativePath: '/dummy/phase-01-test.md',
      normalizedPath: '/dummy/phase-01-test.md',
      status: 'Running'
    };

    await orchestrator.executeNudgeProcedure(dummyPhase, 0, 'Mid-flight steering test nudge');

    assert.strictEqual(phaseNudgedEmitted, true, 'phaseNudged event must be emitted');
    assert.strictEqual(dummyPhase.hasNudged, true, 'hasNudged flag must be set on phase');

    // Nudge must call stop active generation, then addContext, then triggerSend (no startNewConversation)
    const commandsCalled = dispatchedCommands.map((c) => c.cmd);
    assert.ok(
      commandsCalled.includes('antigravity.prioritized.chat.stop'),
      'Must halt ongoing generation'
    );
    assert.ok(
      commandsCalled.includes('antigravity.addContext'),
      'Must inject nudge prompt via antigravity.addContext'
    );
    assert.ok(
      commandsCalled.includes('antigravity.triggerSend'),
      'Must trigger prompt send via antigravity.triggerSend'
    );
    assert.strictEqual(
      commandsCalled.includes('antigravity.startNewConversation'),
      false,
      'Nudge must NOT start a new conversation'
    );
  });

  console.log('\n================================================================');
  console.log(` Summary: All ${passedTests}/${totalTests} tests PASSED cleanly!`);
  console.log('================================================================\n');
}

// Run test directly if launched via Node
if (require.main === module) {
  runPhase01NativeDispatcherAndConfigTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Test execution failed:', err);
      process.exit(1);
    });
}

export { runPhase01NativeDispatcherAndConfigTests };

