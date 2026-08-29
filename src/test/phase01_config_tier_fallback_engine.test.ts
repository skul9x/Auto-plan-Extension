// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockConfigStore: Record<string, any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key: string, defaultValue: any) => {
            return mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue;
          },
          update: async (key: string, value: any) => {
            mockConfigStore[key] = value;
          }
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
import {
  getConfig,
  updateConfig,
  writeConfigJson,
  DEFAULT_CONFIG,
  SIDECAR_CONFIG_FILENAME,
  AutoPlanConfig
} from '../config';
import {
  PromptDispatcher,
  DispatchTier,
  DispatchReadinessResult
} from '../promptDispatcher';
import { BridgeServer } from '../bridgeServer';
import { KeyboardManager } from '../keyboardManager';

async function runPhase01TestSuite() {
  console.log('=== Running Phase 01: Configuration Schema & Strict Tier Fallback Engine Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase01-config-'));

  try {
    // --------------------------------------------------------------------------
    // 1. Configuration Defaults & Serialization
    // --------------------------------------------------------------------------
    console.log('[Test 1] Verifying Configuration Defaults & Serialization...');
    {
      mockConfigStore = {};
      const config = getConfig();

      assert.strictEqual(config.executionMode, 'auto', 'Default executionMode should be auto');
      assert.strictEqual(config.allowTierFallback, true, 'Default allowTierFallback should be true');
      assert.strictEqual(config.strictMode, false, 'Default strictMode should be false for auto mode');

      // Test derived strictMode when allowTierFallback is false and mode is domBridge
      mockConfigStore['executionMode'] = 'domBridge';
      mockConfigStore['allowTierFallback'] = false;
      const strictConfig = getConfig();
      assert.strictEqual(strictConfig.executionMode, 'domBridge');
      assert.strictEqual(strictConfig.allowTierFallback, false);
      assert.strictEqual(strictConfig.strictMode, true, 'strictMode should derive to true when allowTierFallback is false');

      // Test writeConfigJson serialization
      const writtenPath = writeConfigJson(
        {
          executionMode: 'nativeCommand',
          allowTierFallback: false,
          promptText: 'Test custom prompt',
          repeatCount: 3,
          completionKeyword: 'Done.',
          delayBetweenLoopsMs: 1000,
          timeoutPerLoopMinutes: 10
        },
        tempDir
      );

      assert.ok(writtenPath, 'writeConfigJson should return file path');
      assert.strictEqual(fs.existsSync(writtenPath!), true, 'Serialized config file must exist');

      const fileContent = JSON.parse(fs.readFileSync(writtenPath!, 'utf-8'));
      assert.strictEqual(fileContent.executionMode, 'nativeCommand', 'Serialized executionMode matches');
      assert.strictEqual(fileContent.allowTierFallback, false, 'Serialized allowTierFallback matches');
      assert.strictEqual(fileContent.strictMode, true, 'Serialized strictMode derived correctly');
      assert.strictEqual(fileContent.promptText, 'Test custom prompt');

      // Test writeConfigJson with defaults
      mockConfigStore = {};
      const defaultWrittenPath = writeConfigJson(undefined, tempDir);
      assert.ok(defaultWrittenPath);
      const defaultContent = JSON.parse(fs.readFileSync(defaultWrittenPath!, 'utf-8'));
      assert.strictEqual(defaultContent.executionMode, 'auto');
      assert.strictEqual(defaultContent.allowTierFallback, true);
      assert.strictEqual(defaultContent.strictMode, false);
    }
    console.log('  -> Passed: Configuration Defaults & Serialization verified.\n');

    // --------------------------------------------------------------------------
    // 2. Strict Pre-Flight Evaluation
    // --------------------------------------------------------------------------
    console.log('[Test 2] Verifying Strict Pre-Flight Readiness Validation...');
    {
      const emptyServer = new BridgeServer({
        portStart: 49400,
        portEnd: 49410,
        windowKey: 'test-win-strict-preflight'
      });

      const dispatcher = new PromptDispatcher({
        bridgeServer: emptyServer,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          executionMode: 'auto',
          allowTierFallback: true
        })
      });

      // 2a. Strict DOM Bridge without connected client -> Fails fast
      const resDomStrictNoClients = dispatcher.validateDispatchReadiness(undefined, 'domBridge', false);
      assert.strictEqual(resDomStrictNoClients.ready, false, 'Strict domBridge with 0 clients must fail');
      assert.strictEqual(resDomStrictNoClients.selectedTier, 'domBridge');
      assert.strictEqual(
        resDomStrictNoClients.errorMessage,
        'Strict Tier 1 (DOM Bridge) requires active Electron bridge injection.'
      );
      assert.strictEqual(resDomStrictNoClients.remediationAction, 'activateBridge');

      // 2b. Strict DOM Bridge with connected client -> Succeeds
      const activeServer = new BridgeServer({
        portStart: 49420,
        portEnd: 49430,
        windowKey: 'test-win-active-dom'
      });
      const activePort = await activeServer.start();

      const heartbeatReq = http.request(
        {
          hostname: '127.0.0.1',
          port: activePort,
          path: '/autoplan-status?clientVersion=2.0.0&windowKey=test-win-active-dom',
          method: 'GET'
        },
        () => {}
      );
      heartbeatReq.on('error', () => {});
      heartbeatReq.end();
      await new Promise((r) => setTimeout(r, 100));

      const activeDispatcher = new PromptDispatcher({
        bridgeServer: activeServer
      });

      const resDomStrictConnected = activeDispatcher.validateDispatchReadiness(undefined, 'domBridge', false);
      assert.strictEqual(resDomStrictConnected.ready, true, 'Strict domBridge with connected client must be ready');
      assert.strictEqual(resDomStrictConnected.selectedTier, 'domBridge');
      assert.strictEqual(resDomStrictConnected.isFocusFree, true);
      assert.strictEqual(resDomStrictConnected.requiresForegroundFocus, false);

      await activeServer.stop();

      // 2c. Strict Native Command -> Ready immediately
      const resNativeStrict = dispatcher.validateDispatchReadiness(undefined, 'nativeCommand', false);
      assert.strictEqual(resNativeStrict.ready, true, 'Strict nativeCommand must be ready');
      assert.strictEqual(resNativeStrict.selectedTier, 'nativeCommand');
      assert.strictEqual(resNativeStrict.isFocusFree, false);
      assert.strictEqual(resNativeStrict.requiresForegroundFocus, true);

      // 2d. Strict Keyboard on Linux without xdotool -> Fails fast
      const mockKmNoXdotool = {
        checkLinuxKeyboardPrerequisites: () => ({
          available: false,
          binary: null,
          error: 'xdotool not found'
        })
      } as any;

      const dispatcherNoXdotool = new PromptDispatcher({
        bridgeServer: emptyServer,
        keyboardManager: mockKmNoXdotool
      });

      const resLinuxNoXdotool = dispatcherNoXdotool.validateDispatchReadiness('linux', 'keyboard', false);
      assert.strictEqual(resLinuxNoXdotool.ready, false, 'Strict keyboard without xdotool must fail');
      assert.strictEqual(resLinuxNoXdotool.selectedTier, 'keyboard');
      assert.strictEqual(
        resLinuxNoXdotool.errorMessage,
        'Strict Tier 3 (Keyboard Simulation) on Linux requires xdotool to be installed.'
      );
      assert.strictEqual(resLinuxNoXdotool.remediationAction, 'installXdotool');

      // 2e. Strict Keyboard on Linux with xdotool -> Ready
      const mockKmWithXdotool = {
        checkLinuxKeyboardPrerequisites: () => ({
          available: true,
          binary: '/usr/bin/xdotool'
        })
      } as any;

      const dispatcherWithXdotool = new PromptDispatcher({
        bridgeServer: emptyServer,
        keyboardManager: mockKmWithXdotool
      });

      const resLinuxWithXdotool = dispatcherWithXdotool.validateDispatchReadiness('linux', 'keyboard', false);
      assert.strictEqual(resLinuxWithXdotool.ready, true, 'Strict keyboard with xdotool on Linux must be ready');
      assert.strictEqual(resLinuxWithXdotool.selectedTier, 'keyboard');

      // 2f. Strict Keyboard on Windows -> Ready
      const resWinKeyboard = dispatcher.validateDispatchReadiness('win32', 'keyboard', false);
      assert.strictEqual(resWinKeyboard.ready, true, 'Strict keyboard on Windows must be ready');
      assert.strictEqual(resWinKeyboard.selectedTier, 'keyboard');

      // 2g. Auto mode with at least one valid tier succeeds
      const resAutoWin = dispatcher.validateDispatchReadiness('win32', 'auto');
      assert.strictEqual(resAutoWin.ready, true, 'Auto mode on Windows should be ready via fallback');
      assert.strictEqual(resAutoWin.selectedTier, 'keyboard');

      const resAutoLinux = dispatcherWithXdotool.validateDispatchReadiness('linux', 'auto');
      assert.strictEqual(resAutoLinux.ready, true, 'Auto mode on Linux with xdotool should be ready');
      assert.strictEqual(resAutoLinux.selectedTier, 'keyboard');
    }
    console.log('  -> Passed: Strict Pre-Flight Readiness Validation verified.\n');

    // --------------------------------------------------------------------------
    // 3. Strict Dispatch vs Fallback Dispatch Execution
    // --------------------------------------------------------------------------
    console.log('[Test 3] Verifying Strict Dispatch vs Fallback Dispatch Execution...');
    {
      const emptyServer = new BridgeServer({
        portStart: 49440,
        portEnd: 49450,
        windowKey: 'test-win-dispatch'
      });

      let tier2Invoked = false;
      let tier3Invoked = false;

      const mockCommandExecutor = async (cmd: string, ...args: any[]) => {
        tier2Invoked = true;
        return true;
      };

      const mockKeyboardManager = {
        executeBatchPromptFlow: async () => {
          tier3Invoked = true;
        },
        checkLinuxKeyboardPrerequisites: () => ({ available: true, binary: '/usr/bin/xdotool' })
      } as any;

      // 3a. allowFallback = false (Strict Tier 1 fails fast without invoking Tier 2 or 3)
      const strictDispatcher = new PromptDispatcher({
        bridgeServer: emptyServer, // no clients connected -> Tier 1 fails fast
        commandExecutor: mockCommandExecutor,
        keyboardManager: mockKeyboardManager,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          executionMode: 'domBridge',
          allowTierFallback: false
        })
      });

      tier2Invoked = false;
      tier3Invoked = false;
      let strictError: any = null;

      try {
        await strictDispatcher.dispatchPrompt('Strict prompt test', { allowFallback: false });
      } catch (err) {
        strictError = err;
      }

      assert.ok(strictError, 'Strict dispatch must throw when Tier 1 fails');
      assert.ok(
        strictError.message.includes('[DOM Bridge Transport Failed]'),
        `Error message must contain formatted prefix: ${strictError.message}`
      );
      assert.strictEqual(tier2Invoked, false, 'Tier 2 must NOT be invoked when fallback is disallowed');
      assert.strictEqual(tier3Invoked, false, 'Tier 3 must NOT be invoked when fallback is disallowed');

      // 3b. allowFallback = true (Smooth fallback to Tier 2)
      const fallbackDispatcher = new PromptDispatcher({
        bridgeServer: emptyServer, // Tier 1 fails
        commandExecutor: mockCommandExecutor,
        keyboardManager: mockKeyboardManager,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          executionMode: 'auto',
          allowTierFallback: true
        })
      });

      tier2Invoked = false;
      tier3Invoked = false;

      const fallbackResult = await fallbackDispatcher.dispatchPrompt('Fallback prompt test', { allowFallback: true });

      assert.strictEqual(fallbackResult.success, true, 'Fallback dispatch must succeed');
      assert.strictEqual(fallbackResult.tier, 'nativeCommand', 'Result tier should be nativeCommand');
      assert.strictEqual(tier2Invoked, true, 'Tier 2 must be invoked when Tier 1 fails with fallback enabled');
      assert.strictEqual(tier3Invoked, false, 'Tier 3 should not be invoked when Tier 2 succeeds');
      assert.ok(fallbackResult.fallbackHistory, 'Fallback history must be present');
      assert.strictEqual(fallbackResult.fallbackHistory.length, 1);
      assert.strictEqual(fallbackResult.fallbackHistory[0].tier, 'domBridge');

      // 3c. allowFallback = true (Tier 1 fails, Tier 2 fails, falls back to Tier 3)
      const failingCommandExecutor = async () => {
        throw new Error('Command API crashed');
      };

      const deepFallbackDispatcher = new PromptDispatcher({
        bridgeServer: emptyServer,
        commandExecutor: failingCommandExecutor,
        keyboardManager: mockKeyboardManager,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          executionMode: 'auto',
          allowTierFallback: true,
          suppressFallbackWarnings: true
        })
      });

      tier3Invoked = false;
      const deepFallbackResult = await deepFallbackDispatcher.dispatchPrompt('Deep fallback prompt test');

      assert.strictEqual(deepFallbackResult.success, true);
      assert.strictEqual(deepFallbackResult.tier, 'keyboard');
      assert.strictEqual(tier3Invoked, true, 'Tier 3 must be invoked when Tier 1 and Tier 2 fail');
      assert.ok(deepFallbackResult.fallbackHistory);
      assert.strictEqual(deepFallbackResult.fallbackHistory.length, 2);
      assert.strictEqual(deepFallbackResult.fallbackHistory[0].tier, 'domBridge');
      assert.strictEqual(deepFallbackResult.fallbackHistory[1].tier, 'nativeCommand');
    }
    console.log('  -> Passed: Strict Dispatch vs Fallback Dispatch Execution verified.\n');

    // --------------------------------------------------------------------------
    // 4. Live Tier Test Ping
    // --------------------------------------------------------------------------
    console.log('[Test 4] Verifying Live Tier Test Diagnostics (testTierDispatch)...');
    {
      const server = new BridgeServer({
        portStart: 49460,
        portEnd: 49470,
        windowKey: 'test-win-ping'
      });
      const port = await server.start();

      let pingDispatcher = new PromptDispatcher({
        bridgeServer: server,
        commandExecutor: async (cmd: string) => {
          if (cmd === 'error-command') {
            throw new Error('Command execution failed');
          }
          return true;
        },
        keyboardManager: {
          checkLinuxKeyboardPrerequisites: () => ({
            available: true,
            binary: '/usr/bin/xdotool'
          })
        } as any
      });

      // 4a. DOM Bridge ping with no clients -> reports clean failure
      const pingNoClients = await pingDispatcher.testTierDispatch('domBridge');
      assert.strictEqual(pingNoClients.success, false);
      assert.strictEqual(pingNoClients.tier, 'domBridge');
      assert.strictEqual(pingNoClients.error, 'DOM Bridge has no active connected clients');
      assert.ok(typeof pingNoClients.latencyMs === 'number');

      // 4b. DOM Bridge ping with connected client acknowledging ping
      // Simulate connected client polling and acknowledging commands
      let activePoll = true;
      const clientPollInterval = setInterval(() => {
        if (!activePoll) return;
        const pollReq = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/autoplan-status?windowKey=test-win-ping',
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
                    const ackReq = http.request(
                      {
                        hostname: '127.0.0.1',
                        port,
                        path: '/autoplan-ack',
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                      },
                      () => {}
                    );
                    ackReq.write(
                      JSON.stringify({
                        commandId: cmd.id,
                        status: 'completed',
                        windowKey: 'test-win-ping'
                      })
                    );
                    ackReq.end();
                  }
                }
              } catch {}
            });
          }
        );
        pollReq.on('error', () => {});
        pollReq.end();
      }, 50);

      // Initial heartbeat to register client
      const hb = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/autoplan-status?clientVersion=2.0.0&windowKey=test-win-ping',
          method: 'GET'
        },
        () => {}
      );
      hb.on('error', () => {});
      hb.end();
      await new Promise((r) => setTimeout(r, 100));

      const pingSuccess = await pingDispatcher.testTierDispatch('domBridge', 'ping');
      assert.strictEqual(pingSuccess.success, true, 'DOM Bridge ping should succeed with active client');
      assert.strictEqual(pingSuccess.tier, 'domBridge');
      assert.strictEqual(pingSuccess.status, 'completed');
      assert.ok(pingSuccess.latencyMs >= 0);

      activePoll = false;
      clearInterval(clientPollInterval);
      await server.stop();

      // 4c. Native Command live test -> success & failure paths
      const nativeSuccess = await pingDispatcher.testTierDispatch('nativeCommand', 'ping');
      assert.strictEqual(nativeSuccess.success, true);
      assert.strictEqual(nativeSuccess.tier, 'nativeCommand');
      assert.strictEqual(nativeSuccess.status, 'commandApiReady');
      assert.ok(typeof nativeSuccess.latencyMs === 'number');

      const nativeFail = await pingDispatcher.testTierDispatch('nativeCommand', 'error-command');
      assert.strictEqual(nativeFail.success, false);
      assert.strictEqual(nativeFail.tier, 'nativeCommand');
      assert.strictEqual(nativeFail.error, 'Command execution failed');

      // 4d. Keyboard live test -> platform checks
      const kbWin = await pingDispatcher.testTierDispatch('keyboard', undefined, 'win32');
      assert.strictEqual(kbWin.success, true);
      assert.strictEqual(kbWin.tier, 'keyboard');
      assert.strictEqual(kbWin.status, 'powershellReady');

      const kbLinuxOk = await pingDispatcher.testTierDispatch('keyboard', undefined, 'linux');
      assert.strictEqual(kbLinuxOk.success, true);
      assert.strictEqual(kbLinuxOk.tier, 'keyboard');
      assert.ok(kbLinuxOk.status && kbLinuxOk.status.includes('xdotoolReady'));

      const failingKbDispatcher = new PromptDispatcher({
        keyboardManager: {
          checkLinuxKeyboardPrerequisites: () => ({
            available: false,
            binary: null,
            error: 'xdotool is missing on Linux'
          })
        } as any
      });
      const kbLinuxFail = await failingKbDispatcher.testTierDispatch('keyboard', undefined, 'linux');
      assert.strictEqual(kbLinuxFail.success, false);
      assert.strictEqual(kbLinuxFail.tier, 'keyboard');
      assert.strictEqual(kbLinuxFail.error, 'xdotool is missing on Linux');
    }
    console.log('  -> Passed: Live Tier Test Diagnostics verified.\n');

    console.log('===================================================================');
    console.log('🎉 ALL PHASE 01 TESTS PASSED SUCCESSFULLY! (100% Assertions Passed)');
    console.log('===================================================================\n');
  } finally {
    // Cleanup temporary files
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

runPhase01TestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Phase 01 Test Suite Failed with error:');
    console.error(err);
    process.exit(1);
  });
