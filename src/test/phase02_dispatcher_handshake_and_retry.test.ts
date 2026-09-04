// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      commands: {
        executeCommand: async (_cmd: string, ..._args: any[]) => undefined
      },
      window: {
        showWarningMessage: (_msg: string) => undefined
      },
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue
        })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

declare const describe: any;
declare const it: any;

import * as assert from 'assert';
import * as http from 'http';
import { PromptDispatcher } from '../promptDispatcher';
import { BridgeServer, DEFAULT_COMMAND_TIMEOUT_MS } from '../bridgeServer';
import { AutoPlanConfig } from '../config';
import { DebugLogger } from '../debugLogger';

function createMockConfig(overrides: Partial<AutoPlanConfig> = {}): AutoPlanConfig {
  return {
    promptText: 'test prompt',
    promptTemplate: 'test prompt',
    defaultPromptTemplate: 'test prompt',
    repeatCount: 1,
    completionKeyword: 'Done skul9x.',
    delayBetweenLoopsMs: 100,
    timeoutPerLoopMinutes: 1,
    focusDelayMs: 100,
    defaultPlanFolder: '',
    executionMode: 'domBridge',
    allowTierFallback: false,
    strictMode: true,
    bridgeTimeoutMs: 6000,
    staleClientMs: 120000,
    autoApprovePermissions: true,
    autoInjectWorkbench: false,
    suppressFallbackWarnings: true,
    enableVerboseBridgeLogs: false,
    enablePhaseAuditLogging: false,
    maxLogEntries: 100,
    autoOpenBridgeLogOnError: false,
    ...overrides
  };
}

async function runTests() {
  console.log('=== Starting Phase 02 Dispatcher Handshake & Retry Suite ===\n');

  // Test 1: BridgeServer Configuration & Protocol Verification
  console.log('▶ Test 1: BridgeServer Default Timeout & Protocol Readiness...');
  {
    assert.strictEqual(DEFAULT_COMMAND_TIMEOUT_MS, 6000, 'DEFAULT_COMMAND_TIMEOUT_MS must be 6000ms');

    const server = new BridgeServer({ portStart: 49200, portEnd: 49220 });
    assert.strictEqual(typeof server.dispatchNewConversationCommand, 'function', 'BridgeServer must expose dispatchNewConversationCommand');

    // Test that dispatchNewConversationCommand generates a command with type 'openNewConversation'
    const cmdPromise = server.dispatchNewConversationCommand({ timeoutMs: 1000 });
    const pendingCommands = (server as any).queuedCommands;
    assert.ok(pendingCommands.length > 0, 'Command must be queued');
    const cmd = pendingCommands[0];
    assert.strictEqual(cmd.type, 'openNewConversation', 'Command type must be openNewConversation');

    // Clean up
    cmdPromise.catch(() => {});
    (server as any).pendingCommands.delete(cmd.id);
    (server as any).queuedCommands = [];
    console.log('  ✓ BridgeServer timeout is 6000ms and dispatchNewConversationCommand creates proper command');
  }

  // Test 2: BridgeServer /ack Handling of Failed Status with Diagnostics
  console.log('\n▶ Test 2: BridgeServer /ack Rejection of Status "failed" with Diagnostics...');
  {
    const server = new BridgeServer({ portStart: 49230, portEnd: 49250 });
    await server.start();
    const port = server.getPort()!;

    // Queue a command
    const cmdPromise = server.dispatchPromptCommand('test prompt', { timeoutMs: 3000 });
    const queuedCmd = (server as any).queuedCommands[0];
    assert.ok(queuedCmd, 'Queued command must exist');

    // Simulate DOM Bridge client acknowledging with status: 'failed' and code: 'BUTTON_DISABLED_TIMEOUT'
    const ackPayload = JSON.stringify({
      commandId: queuedCmd.id,
      status: 'failed',
      error: 'Send button remained disabled after 2500ms',
      metadata: {
        code: 'BUTTON_DISABLED_TIMEOUT',
        rejectionReason: 'button_disabled_timeout',
        buttonClass: 'codicon-send disabled',
        buttonWaitDurationMs: 2504
      }
    });

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-ack',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(ackPayload)
      }
    });
    req.write(ackPayload);
    req.end();

    let caughtErr: any;
    try {
      await cmdPromise;
    } catch (e: any) {
      caughtErr = e;
    }

    assert.ok(caughtErr, 'Promise must reject when ACK status is failed');
    assert.strictEqual(caughtErr.code, 'BUTTON_DISABLED_TIMEOUT', 'Error code must be BUTTON_DISABLED_TIMEOUT');
    assert.strictEqual(caughtErr.rejectionReason, 'button_disabled_timeout', 'Rejection reason must match');
    assert.strictEqual(caughtErr.status, 'failed', 'Status must be failed');
    assert.ok(caughtErr.metadata, 'Metadata must be preserved');
    assert.strictEqual(caughtErr.metadata.buttonClass, 'codicon-send disabled');

    await server.stop();
    console.log('  ✓ BridgeServer handles status "failed" and preserves code & metadata');
  }

  // Test 3: Stabilization Delay after openNewConversation
  console.log('\n▶ Test 3: Stabilization Delay (450ms) after openNewConversation before sendPrompt...');
  {
    const timestamps: { event: string; time: number }[] = [];

    const mockBridgeServer: any = {
      isListening: () => true,
      getConnectedClients: () => [{ windowKey: 'win_test', lastSeenAt: Date.now() }],
      getActiveWindowKey: () => 'win_test',
      getWindowKey: () => 'win_test',
      getPort: () => 49200,
      dispatchNewConversationCommand: async () => {
        timestamps.push({ event: 'newConversationCompleted', time: Date.now() });
        return { success: true, commandId: 'conv_1', status: 'completed', durationMs: 20 };
      },
      dispatchPromptCommand: async (text: string, opts: any) => {
        timestamps.push({ event: 'sendPromptInvoked', time: Date.now() });
        return { success: true, commandId: 'prompt_1', status: 'submitClicked', durationMs: 30 };
      }
    };

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      configProvider: () => createMockConfig({ allowTierFallback: false, strictMode: true }),
      commandExecutor: async () => { throw new Error('Command unavailable'); }
    });

    const result = await dispatcher.dispatchTier1('Hello world', { openNewConversation: true });
    assert.ok(result.success, 'Tier 1 dispatch should succeed');

    const convEvent = timestamps.find(e => e.event === 'newConversationCompleted');
    const sendEvent = timestamps.find(e => e.event === 'sendPromptInvoked');
    assert.ok(convEvent, 'newConversationCompleted event must be recorded');
    assert.ok(sendEvent, 'sendPromptInvoked event must be recorded');

    const delay = sendEvent.time - convEvent.time;
    console.log(`  Measured stabilization delay: ${delay}ms (target: ~450ms)`);
    assert.ok(delay >= 400, `Stabilization delay must be >= 400ms (got ${delay}ms)`);
    console.log('  ✓ Mandatory stabilization delay properly enforced before sendPrompt');
  }

  // Test 4: openNewConversation: false skips stabilization delay
  console.log('\n▶ Test 4: openNewConversation: false Skips Handshake and Delay...');
  {
    let newConvCalled = false;
    let sendPromptTime = 0;
    const startTime = Date.now();

    const mockBridgeServer: any = {
      isListening: () => true,
      getConnectedClients: () => [{ windowKey: 'win_test', lastSeenAt: Date.now() }],
      getActiveWindowKey: () => 'win_test',
      getWindowKey: () => 'win_test',
      getPort: () => 49200,
      dispatchNewConversationCommand: async () => {
        newConvCalled = true;
        return { success: true, commandId: 'conv_1', status: 'completed', durationMs: 10 };
      },
      dispatchPromptCommand: async () => {
        sendPromptTime = Date.now();
        return { success: true, commandId: 'prompt_1', status: 'submitClicked', durationMs: 10 };
      }
    };

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      configProvider: () => createMockConfig(),
      commandExecutor: async () => { throw new Error('Command unavailable'); }
    });

    const result = await dispatcher.dispatchTier1('Hello world', { openNewConversation: false });
    assert.ok(result.success);
    assert.strictEqual(newConvCalled, false, 'openNewConversation should not be called');
    const elapsed = sendPromptTime - startTime;
    assert.ok(elapsed < 200, `Dispatch without openNewConversation must not incur 450ms delay (took ${elapsed}ms)`);
    console.log('  ✓ Skipped stabilization delay when openNewConversation is false');
  }

  // Test 5: Transient BUTTON_DISABLED_TIMEOUT Retries & Succeeds on Attempt 2
  console.log('\n▶ Test 5: Transient BUTTON_DISABLED_TIMEOUT Triggers Retry & Succeeds...');
  {
    let attempts = 0;
    const warningLogs: string[] = [];
    const attemptTimestamps: number[] = [];

    const mockBridgeServer: any = {
      isListening: () => true,
      getConnectedClients: () => [{ windowKey: 'win_test', lastSeenAt: Date.now() }],
      getActiveWindowKey: () => 'win_test',
      getWindowKey: () => 'win_test',
      getPort: () => 49200,
      dispatchNewConversationCommand: async () => ({
        success: true,
        commandId: 'conv_1',
        status: 'completed',
        durationMs: 10
      }),
      dispatchPromptCommand: async (text: string, opts: any) => {
        attempts++;
        attemptTimestamps.push(Date.now());
        if (attempts === 1) {
          const err: any = new Error('Send button remained disabled after 2500ms');
          err.code = 'BUTTON_DISABLED_TIMEOUT';
          err.rejectionReason = 'button_disabled_timeout';
          err.status = 'failed';
          err.metadata = { code: 'BUTTON_DISABLED_TIMEOUT', buttonClass: 'disabled' };
          throw err;
        }
        return {
          success: true,
          commandId: 'prompt_attempt_2',
          status: 'submitClicked',
          durationMs: 40,
          metadata: { isBackgroundSubmission: true }
        };
      }
    };

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      configProvider: () => createMockConfig({ allowTierFallback: false, strictMode: true }),
      warningNotifier: (msg: string) => warningLogs.push(msg),
      commandExecutor: async () => { throw new Error('Command unavailable'); }
    });

    const result = await dispatcher.dispatchTier1('Retry test prompt', { openNewConversation: false });
    assert.strictEqual(attempts, 2, 'Should have dispatched prompt exactly 2 times (1 failure + 1 retry)');
    assert.strictEqual(result.success, true, 'Result must be success');
    assert.strictEqual(result.metadata?.retries, 1, 'Metadata retries must be 1');

    // Check backoff timing
    const backoff = attemptTimestamps[1] - attemptTimestamps[0];
    console.log(`  Measured retry backoff: ${backoff}ms (target: ~500ms)`);
    assert.ok(backoff >= 450, `Retry backoff must be >= 450ms (got ${backoff}ms)`);

    // Verify warning notification was emitted
    const expectedWarning = 'DOM send button temporarily unready, retrying (attempt 1/2)...';
    assert.ok(
      warningLogs.some(msg => msg.includes(expectedWarning)),
      `Warning log must include "${expectedWarning}"`
    );
    console.log('  ✓ Automatic retry on BUTTON_DISABLED_TIMEOUT succeeded with backoff and warning');
  }

  // Test 6: Retries up to 2 times (3 attempts total) and Exhaustion Throws Descriptive Error (allowFallback: false)
  console.log('\n▶ Test 6: Persistent BUTTON_DISABLED_TIMEOUT Exhausts Retries & Throws Diagnostic Error...');
  {
    let attempts = 0;
    const warningLogs: string[] = [];

    const mockBridgeServer: any = {
      isListening: () => true,
      getConnectedClients: () => [{ windowKey: 'win_test', lastSeenAt: Date.now() }],
      getActiveWindowKey: () => 'win_test',
      getWindowKey: () => 'win_test',
      getPort: () => 49200,
      dispatchPromptCommand: async (text: string, opts: any) => {
        attempts++;
        const err: any = new Error('Send button remained disabled after 2500ms');
        err.code = 'BUTTON_DISABLED_TIMEOUT';
        err.rejectionReason = 'button_disabled_timeout';
        err.status = 'failed';
        err.metadata = {
          code: 'BUTTON_DISABLED_TIMEOUT',
          buttonClass: 'codicon-send monaco-button disabled',
          buttonWaitDurationMs: 2502
        };
        throw err;
      }
    };

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      configProvider: () => createMockConfig({ allowTierFallback: false, strictMode: true }),
      warningNotifier: (msg: string) => warningLogs.push(msg),
      commandExecutor: async () => { throw new Error('Command unavailable'); }
    });

    let caughtErr: any;
    try {
      await dispatcher.sendPromptWithFallback('Exhaustion test prompt', {
        allowFallback: false,
        openNewConversation: false
      });
    } catch (e: any) {
      caughtErr = e;
    }

    assert.ok(caughtErr, 'Should throw error after retries are exhausted');
    // Total attempts: Initial attempt (1) + retry 1 (2) + retry 2 (3) = 3 total attempts
    assert.strictEqual(attempts, 3, `Must make exactly 3 attempts (1 initial + 2 retries), got ${attempts}`);

    // Check warning logs for both retry attempts
    assert.ok(warningLogs.some(m => m.includes('attempt 1/2')), 'Must log warning for attempt 1/2');
    assert.ok(warningLogs.some(m => m.includes('attempt 2/2')), 'Must log warning for attempt 2/2');

    // Check diagnostic details on thrown error
    assert.strictEqual(caughtErr.code, 'BUTTON_DISABLED_TIMEOUT', 'Error code must be BUTTON_DISABLED_TIMEOUT');
    assert.ok(caughtErr.message.includes('DOM Bridge Transport Failed'), 'Message must indicate transport failure');
    assert.ok(caughtErr.message.includes('Send button remained disabled'), 'Message must contain diagnostic error text');
    assert.ok(caughtErr.metadata, 'Diagnostic metadata must be attached');
    assert.strictEqual(caughtErr.metadata.buttonClass, 'codicon-send monaco-button disabled');
    console.log('  ✓ Persistent failure exhausts 2 retries (3 attempts total) and throws descriptive error');
  }

  // Test 7: Fallback to Tier 2 when allowFallback: true after Retries Exhausted
  console.log('\n▶ Test 7: Fallback to Tier 2 when allowFallback: true after DOM Retries Exhausted...');
  {
    let domAttempts = 0;
    let nativeCommandExecuted = false;

    const mockBridgeServer: any = {
      isListening: () => true,
      getConnectedClients: () => [{ windowKey: 'win_test', lastSeenAt: Date.now() }],
      getActiveWindowKey: () => 'win_test',
      getWindowKey: () => 'win_test',
      getPort: () => 49200,
      dispatchPromptCommand: async () => {
        domAttempts++;
        const err: any = new Error('Send button remained disabled after 2500ms');
        err.code = 'BUTTON_DISABLED_TIMEOUT';
        err.metadata = { code: 'BUTTON_DISABLED_TIMEOUT' };
        throw err;
      }
    };

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      configProvider: () => createMockConfig({ allowTierFallback: true, strictMode: false }),
      commandExecutor: async (cmd: string) => {
        if (cmd === 'antigravity.sendTextToChat') {
          nativeCommandExecuted = true;
          return true;
        }
        return true;
      }
    });

    const result = await dispatcher.sendPromptWithFallback('Fallback test prompt', {
      allowFallback: true,
      openNewConversation: false
    });

    assert.strictEqual(domAttempts, 3, 'DOM bridge should have tried 3 times before fallback');
    assert.strictEqual(nativeCommandExecuted, true, 'Native command tier must be invoked');
    assert.strictEqual(result.tier, 'nativeCommand', 'Result tier should be nativeCommand');
    assert.ok(result.fallbackHistory && result.fallbackHistory.length === 1, 'Fallback history must record domBridge failure');
    assert.strictEqual(result.fallbackHistory![0].tier, 'domBridge');
    console.log('  ✓ Exhausted DOM retries successfully cascade to Tier 2 when fallback is enabled');
  }

  // Test 8: Method aliases dispatchViaTier1 and sendPromptWithFallback
  console.log('\n▶ Test 8: Method Aliases dispatchViaTier1 and sendPromptWithFallback...');
  {
    const mockBridgeServer: any = {
      isListening: () => true,
      getConnectedClients: () => [{ windowKey: 'win_test', lastSeenAt: Date.now() }],
      getActiveWindowKey: () => 'win_test',
      getWindowKey: () => 'win_test',
      getPort: () => 49200,
      dispatchPromptCommand: async () => ({
        success: true,
        commandId: 'alias_cmd',
        status: 'submitClicked',
        durationMs: 15
      })
    };

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      configProvider: () => createMockConfig()
    });

    const t1Res = await dispatcher.dispatchViaTier1('via tier 1', { openNewConversation: false });
    assert.strictEqual(t1Res.tier, 'domBridge');
    assert.strictEqual(t1Res.commandId, 'alias_cmd');

    const fallbackRes = await dispatcher.sendPromptWithFallback('via fallback', { openNewConversation: false });
    assert.strictEqual(fallbackRes.tier, 'domBridge');
    assert.strictEqual(fallbackRes.commandId, 'alias_cmd');
    console.log('  ✓ dispatchViaTier1 and sendPromptWithFallback aliases function properly');
  }

  console.log('\n=== All Phase 02 Dispatcher Handshake & Retry Tests Passed! ===\n');
}

runTests().catch((err) => {
  console.error('\n❌ Phase 02 Test Failed:', err);
  process.exit(1);
});
