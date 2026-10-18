// Self-healing ESM require guard for JSDOM in Node < 20.19 CommonJS
if (!process.env.__PHASE01_NUDGE_REEXEC__) {
  try {
    require('jsdom');
  } catch (e: any) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      const { execFileSync } = require('child_process');
      const env = {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-require-module`.trim(),
        __PHASE01_NUDGE_REEXEC__: '1'
      };
      try {
        execFileSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
          stdio: 'inherit',
          env
        });
        process.exit(0);
      } catch (err: any) {
        process.exit(err.status || 1);
      }
    }
    throw e;
  }
}

// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

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
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { JSDOM } from 'jsdom';
import {
  getConfig,
  getLongPhaseNudgeConfig,
  DEFAULT_CONFIG,
  DEFAULT_LONG_PHASE_NUDGE_MESSAGE
} from '../config';
import { BridgeServer } from '../bridgeServer';
import { PromptDispatcher } from '../promptDispatcher';
import { DebugLogger } from '../debugLogger';

function loadDomBridge() {
  const candidatePaths = [
    path.resolve(__dirname, '../../media/autoplan-dom-bridge.js'),
    path.resolve(__dirname, '../media/autoplan-dom-bridge.js'),
    path.resolve(process.cwd(), 'media/autoplan-dom-bridge.js')
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      delete require.cache[require.resolve(p)];
      return require(p);
    }
  }
  throw new Error('Could not locate media/autoplan-dom-bridge.js');
}

async function runPhase01NudgeConfigAndBridgeStopTest() {
  console.log('================================================================');
  console.log(' Phase 01: Nudge Configuration & DOM Bridge Stop Command Subsystem Test');
  console.log('================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-phase01-nudge-'));
  const testLogger = new DebugLogger(100);

  try {
    // -------------------------------------------------------------
    // Test 1: Configuration Schema & Default Values
    // -------------------------------------------------------------
    console.log('[Test 1] Verifying AutoPlan configuration defaults and schema...');

    // Clean mock config
    for (const key of Object.keys(mockConfigStore)) {
      delete mockConfigStore[key];
    }

    const cfg = getConfig();
    assert.strictEqual(cfg.longPhaseNudgeEnabled, true, 'Default longPhaseNudgeEnabled must be true');
    assert.strictEqual(cfg.longPhaseThresholdSeconds, 180, 'Default longPhaseThresholdSeconds must be 180 (3 min)');
    assert.strictEqual(
      cfg.longPhaseNudgeMessage,
      DEFAULT_LONG_PHASE_NUDGE_MESSAGE,
      'Default longPhaseNudgeMessage must match DEFAULT_LONG_PHASE_NUDGE_MESSAGE'
    );
    assert.strictEqual(cfg.longPhaseNudgeRecurring, false, 'Default longPhaseNudgeRecurring must be false');
    assert.strictEqual(cfg.longPhaseNotifyTelegram, true, 'Default longPhaseNotifyTelegram must be true');

    const nudgeCfg = getLongPhaseNudgeConfig();
    assert.strictEqual(nudgeCfg.enabled, true, 'getLongPhaseNudgeConfig().enabled must be true');
    assert.strictEqual(nudgeCfg.thresholdSeconds, 180, 'getLongPhaseNudgeConfig().thresholdSeconds must be 180');
    assert.strictEqual(nudgeCfg.nudgeMessage, DEFAULT_LONG_PHASE_NUDGE_MESSAGE);
    assert.strictEqual(nudgeCfg.recurring, false);
    assert.strictEqual(nudgeCfg.notifyTelegram, true);

    // Test overrides
    mockConfigStore['longPhaseNudgeEnabled'] = false;
    mockConfigStore['longPhaseThresholdSeconds'] = 240;
    mockConfigStore['longPhaseNudgeMessage'] = 'Custom nudge message';
    mockConfigStore['longPhaseNudgeRecurring'] = true;
    mockConfigStore['longPhaseNotifyTelegram'] = false;

    const overriddenCfg = getConfig();
    assert.strictEqual(overriddenCfg.longPhaseNudgeEnabled, false);
    assert.strictEqual(overriddenCfg.longPhaseThresholdSeconds, 240);
    assert.strictEqual(overriddenCfg.longPhaseNudgeMessage, 'Custom nudge message');
    assert.strictEqual(overriddenCfg.longPhaseNudgeRecurring, true);
    assert.strictEqual(overriddenCfg.longPhaseNotifyTelegram, false);

    const overriddenNudgeCfg = getLongPhaseNudgeConfig();
    assert.strictEqual(overriddenNudgeCfg.enabled, false);
    assert.strictEqual(overriddenNudgeCfg.thresholdSeconds, 240);
    assert.strictEqual(overriddenNudgeCfg.nudgeMessage, 'Custom nudge message');
    assert.strictEqual(overriddenNudgeCfg.recurring, true);
    assert.strictEqual(overriddenNudgeCfg.notifyTelegram, false);

    // Clean mock config after test
    for (const key of Object.keys(mockConfigStore)) {
      delete mockConfigStore[key];
    }
    console.log('  ✓ Configuration retrieval, defaults, and overrides verified.');

    // -------------------------------------------------------------
    // Test 2: package.json Manifest Contribution Declarations
    // -------------------------------------------------------------
    console.log('\n[Test 2] Verifying package.json configuration property declarations...');
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const props = pkgJson?.contributes?.configuration?.properties;
    assert.ok(props, 'package.json contributes.configuration.properties must exist');

    assert.strictEqual(props['autoplan.longPhaseNudgeEnabled']?.type, 'boolean');
    assert.strictEqual(props['autoplan.longPhaseNudgeEnabled']?.default, true);

    assert.strictEqual(props['autoplan.longPhaseThresholdSeconds']?.type, 'number');
    assert.strictEqual(props['autoplan.longPhaseThresholdSeconds']?.default, 180);

    assert.strictEqual(props['autoplan.longPhaseNudgeMessage']?.type, 'string');
    assert.strictEqual(props['autoplan.longPhaseNudgeMessage']?.default, DEFAULT_LONG_PHASE_NUDGE_MESSAGE);

    assert.strictEqual(props['autoplan.longPhaseNudgeRecurring']?.type, 'boolean');
    assert.strictEqual(props['autoplan.longPhaseNudgeRecurring']?.default, false);

    assert.strictEqual(props['autoplan.longPhaseNotifyTelegram']?.type, 'boolean');
    assert.strictEqual(props['autoplan.longPhaseNotifyTelegram']?.default, true);
    console.log('  ✓ package.json manifests declared with exact defaults and types.');

    // -------------------------------------------------------------
    // Test 3: DOM Bridge Client Cancel Button Detection & Click Cascade
    // -------------------------------------------------------------
    console.log('\n[Test 3] Verifying DOM Bridge findCancelButton and stopActiveGeneration...');
    const bridge = loadDomBridge();
    const { findCancelButton, stopActiveGeneration, DomBridgeClient } = bridge;

    assert.strictEqual(typeof findCancelButton, 'function', 'findCancelButton must be an exported function');
    assert.strictEqual(typeof stopActiveGeneration, 'function', 'stopActiveGeneration must be an exported function');

    // Case 3A: Cancel button present during active AI generation
    const domWithCancel = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div class="chat-widget">
            <div class="chat-input-toolbar">
              <button
                id="cancel-btn"
                aria-label="Cancel AI generation"
                data-tooltip-id="input-send-button-cancel-tooltip">
                <span class="bg-red-500">Stop</span>
              </button>
            </div>
          </div>
        </body>
      </html>
    `, { pretendToBeVisual: true });

    const cancelElem = domWithCancel.window.document.getElementById('cancel-btn') as HTMLButtonElement;
    const eventsFired: string[] = [];
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evtType => {
      cancelElem.addEventListener(evtType, () => eventsFired.push(evtType));
    });

    const foundBtn = findCancelButton(domWithCancel.window.document);
    assert.strictEqual(foundBtn, cancelElem, 'findCancelButton must locate the active Cancel button');

    const stopResult = await stopActiveGeneration({
      document: domWithCancel.window.document,
      window: domWithCancel.window,
      timeoutMs: 100,
      intervalMs: 10
    });

    assert.strictEqual(stopResult.success, true, 'stopActiveGeneration must return success: true');
    assert.strictEqual(stopResult.status, 'stopped', 'stopActiveGeneration must return status: stopped');
    assert.strictEqual(stopResult.stopped, true, 'stopActiveGeneration must return stopped: true');
    assert.ok(eventsFired.includes('click'), 'Click event cascade must trigger click on Cancel button');
    assert.ok(eventsFired.includes('pointerdown'), 'Pointerdown event must be dispatched');
    assert.ok(eventsFired.includes('mousedown'), 'Mousedown event must be dispatched');
    console.log('  ✓ Active Cancel button located and click cascade dispatched successfully.');

    // Case 3B: Idle state (no Cancel button present)
    const domIdle = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div class="chat-widget">
            <button data-testid="send-button" aria-label="Send message">Send</button>
          </div>
        </body>
      </html>
    `, { pretendToBeVisual: true });

    const idleBtn = findCancelButton(domIdle.window.document);
    assert.strictEqual(idleBtn, null, 'findCancelButton must return null when agent is idle');

    const idleResult = await stopActiveGeneration({
      document: domIdle.window.document,
      window: domIdle.window,
      timeoutMs: 50,
      intervalMs: 10
    });
    assert.strictEqual(idleResult.success, true);
    assert.strictEqual(idleResult.status, 'idle', 'stopActiveGeneration must return status: idle when no button is found');
    assert.strictEqual(idleResult.stopped, false);
    console.log('  ✓ Idle state correctly identified without unexpected clicks.');

    // -------------------------------------------------------------
    // Test 4: DomBridgeClient Command Handling ('stopGeneration')
    // -------------------------------------------------------------
    console.log('\n[Test 4] Verifying DomBridgeClient handleCommand routing for stopGeneration...');
    const client = new DomBridgeClient({
      port: 48999,
      windowKey: 'test-nudge-window',
      document: domWithCancel.window.document,
      window: domWithCancel.window
    });

    const acksSent: any[] = [];
    client.sendAck = async (commandId: string, status: string, errorMsg: string | null, metadata: any) => {
      acksSent.push({ commandId, status, errorMsg, metadata });
      return true;
    };

    // Dispatch stopGeneration with Cancel button present
    await client.handleCommand({
      id: 'cmd_test_stop_active',
      type: 'stopGeneration'
    });

    assert.strictEqual(acksSent.length, 1);
    assert.strictEqual(acksSent[0].commandId, 'cmd_test_stop_active');
    assert.strictEqual(acksSent[0].status, 'stopped', 'ACK status must be "stopped" when Cancel button is clicked');

    // Switch client document to idle DOM
    client.customDocument = domIdle.window.document;
    client.customWindow = domIdle.window;

    await client.handleCommand({
      id: 'cmd_test_stop_idle',
      type: 'stopGeneration'
    });

    assert.strictEqual(acksSent.length, 2);
    assert.strictEqual(acksSent[1].commandId, 'cmd_test_stop_idle');
    assert.strictEqual(acksSent[1].status, 'idle', 'ACK status must be "idle" when agent is already idle');
    console.log('  ✓ DomBridgeClient command routing and ACK emission verified.');

    // -------------------------------------------------------------
    // Test 5: BridgeServer dispatchStopGenerationCommand Subsystem
    // -------------------------------------------------------------
    console.log('\n[Test 5] Verifying BridgeServer dispatchStopGenerationCommand...');
    const testPortsPath = path.join(testTempDir, 'ag-autoplan-ports.json');
    const server = new BridgeServer({
      portStart: 48870,
      portEnd: 48880,
      host: '127.0.0.1',
      windowKey: 'test-server-win',
      portsRegistryPath: testPortsPath,
      logger: testLogger
    });

    await server.start();
    const port = server.getPort();
    assert.ok(port && port > 0, 'BridgeServer must be listening on a valid port');

    // Test dispatch with ACK 'stopped'
    const stopPromise = server.dispatchStopGenerationCommand({ timeoutMs: 3000 });
    const pendingCmds = (server as any).queuedCommands as any[];
    assert.strictEqual(pendingCmds.length, 1, 'BridgeServer must queue 1 pending command');
    assert.strictEqual(pendingCmds[0].type, 'stopGeneration', 'Pending command type must be "stopGeneration"');

    // Simulate DOM client ACK
    const ackPayload = {
      commandId: pendingCmds[0].id,
      status: 'stopped',
      metadata: { stopped: true }
    };

    const http = require('http');
    await new Promise<void>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/autoplan-ack',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bridge-Auth': server.getAuthToken()
        }
      }, (res: any) => {
        assert.strictEqual(res.statusCode, 200);
        resolve();
      });
      req.on('error', reject);
      req.write(JSON.stringify(ackPayload));
      req.end();
    });

    const ackResult = await stopPromise;
    assert.strictEqual(ackResult.success, true);
    assert.strictEqual(ackResult.status, 'stopped');

    // Test dispatch with ACK 'idle'
    const idlePromise = server.dispatchStopGenerationCommand({ timeoutMs: 3000 });
    const pendingIdleCmds = (server as any).queuedCommands as any[];
    assert.strictEqual(pendingIdleCmds.length, 1);
    assert.strictEqual(pendingIdleCmds[0].type, 'stopGeneration');

    await new Promise<void>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/autoplan-ack',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bridge-Auth': server.getAuthToken()
        }
      }, (res: any) => {
        assert.strictEqual(res.statusCode, 200);
        resolve();
      });
      req.on('error', reject);
      req.write(JSON.stringify({
        commandId: pendingIdleCmds[0].id,
        status: 'idle',
        metadata: { idle: true }
      }));
      req.end();
    });

    const idleAckResult = await idlePromise;
    assert.strictEqual(idleAckResult.success, true);
    assert.strictEqual(idleAckResult.status, 'idle');

    await server.stop();
    console.log('  ✓ BridgeServer stop command dispatch and stopped/idle ACK resolutions verified.');

    // -------------------------------------------------------------
    // Test 6: PromptDispatcher stopActiveGeneration Coordination & Fallback
    // -------------------------------------------------------------
    console.log('\n[Test 6] Verifying PromptDispatcher.stopActiveGeneration (Tier 1 & Tier 2 Fallback)...');

    // Case 6A: Tier 1 DOM Bridge Succeeded
    let tier1Dispatched = false;
    const mockBridgeServer = {
      isListening: () => true,
      getConnectedClients: () => [{ windowKey: 'client-1', lastSeenAt: Date.now() }],
      dispatchStopGenerationCommand: async () => {
        tier1Dispatched = true;
        return { success: true, commandId: 'c1', status: 'stopped', durationMs: 25 };
      }
    } as any;

    const commandsExecuted: string[] = [];
    const mockCommandExecutor = async (cmd: string, ...args: any[]) => {
      commandsExecuted.push(cmd);
      return undefined;
    };

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      commandExecutor: mockCommandExecutor,
      logger: testLogger
    });

    const tier1Success = await dispatcher.stopActiveGeneration();
    assert.strictEqual(tier1Success, true, 'Tier 1 must return true when BridgeServer succeeds');
    assert.strictEqual(tier1Dispatched, true, 'dispatchStopGenerationCommand must be invoked');
    assert.strictEqual(commandsExecuted.length, 0, 'No native commands should be executed if Tier 1 succeeds');

    // Case 6B: Tier 2 Fallback (BridgeServer has 0 connected clients)
    tier1Dispatched = false;
    const mockBridgeServerEmpty = {
      isListening: () => true,
      getConnectedClients: () => [],
      dispatchStopGenerationCommand: async () => {
        throw new Error('No clients');
      }
    } as any;

    const dispatcherTier2 = new PromptDispatcher({
      bridgeServer: mockBridgeServerEmpty,
      commandExecutor: mockCommandExecutor,
      logger: testLogger
    });

    const tier2Success = await dispatcherTier2.stopActiveGeneration();
    assert.strictEqual(tier2Success, true, 'Tier 2 must return true on native command success');
    assert.ok(
      commandsExecuted.includes('antigravity.prioritized.chat.stop'),
      'Must execute antigravity.prioritized.chat.stop'
    );

    // Case 6C: Tier 2 Secondary Native Fallback
    // When antigravity.prioritized.chat.stop fails, workbench.action.chat.stop succeeds
    commandsExecuted.length = 0;
    const mockFailingExecutor = async (cmd: string) => {
      commandsExecuted.push(cmd);
      if (cmd === 'antigravity.prioritized.chat.stop') {
        throw new Error('Command antigravity.prioritized.chat.stop not found');
      }
      return undefined;
    };

    const dispatcherSecondary = new PromptDispatcher({
      bridgeServer: mockBridgeServerEmpty,
      commandExecutor: mockFailingExecutor,
      logger: testLogger
    });

    const secondarySuccess = await dispatcherSecondary.stopActiveGeneration();
    assert.strictEqual(secondarySuccess, true);
    assert.ok(commandsExecuted.includes('antigravity.prioritized.chat.stop'));
    assert.ok(commandsExecuted.includes('workbench.action.chat.stop'));

    // Case 6D: Both Native Commands Fail
    commandsExecuted.length = 0;
    const mockAllFailingExecutor = async (cmd: string) => {
      commandsExecuted.push(cmd);
      throw new Error(`Command ${cmd} failed`);
    };

    const dispatcherAllFail = new PromptDispatcher({
      bridgeServer: mockBridgeServerEmpty,
      commandExecutor: mockAllFailingExecutor,
      logger: testLogger
    });

    const failResult = await dispatcherAllFail.stopActiveGeneration();
    assert.strictEqual(failResult, false, 'stopActiveGeneration must return false when all tiers fail');

    // Case 6E: Strict DOM Bridge Mode without Fallback
    commandsExecuted.length = 0;
    const strictResult = await dispatcherTier2.stopActiveGeneration({
      mode: 'domBridge',
      allowFallback: false
    });
    assert.strictEqual(strictResult, false, 'Strict domBridge mode must fail fast without fallback');
    assert.strictEqual(commandsExecuted.length, 0, 'No native commands should be executed in strict domBridge mode');

    console.log('  ✓ PromptDispatcher stopActiveGeneration Tier 1 & Tier 2 fallbacks fully verified.');

    console.log('\n================================================================');
    console.log(' ALL Phase 01 Nudge Config & Bridge Stop Subsystem Tests PASSED!');
    console.log('================================================================\n');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

// Execute test
runPhase01NudgeConfigAndBridgeStopTest()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Phase 01 test FAILED with error:', err);
    process.exit(1);
  });
