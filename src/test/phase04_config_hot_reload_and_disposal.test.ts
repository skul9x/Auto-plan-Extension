// Standalone test runner for Phase 04: Dynamic Configuration Hot-Reload & Extension Lifecycle Cleanup
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {
  defaultPromptTemplate: 'Implement the code closely following the file {xxx}',
  promptTemplate: 'Implement the code closely following the file {xxx}',
  promptText: 'Default Prompt',
  repeatCount: 5,
  completionKeyword: 'Done skul9x.',
  delayBetweenLoopsMs: 100,
  timeoutPerLoopMinutes: 0,
  focusDelayMs: 100,
  executionMode: 'auto',
  allowTierFallback: true,
  bridgeTimeoutMs: 500,
  autoInjectWorkbench: false,
  suppressFallbackWarnings: true,
  telegramEnabled: true,
  telegramBotToken: '123456789:MockInitialTelegramToken',
  telegramAllowedUsers: [111111, 222222],
  telegramThrottleMs: 2500
};

const activeConfigListeners: ((e: any) => void)[] = [];
const allRegisteredConfigListeners: ((e: any) => void)[] = [];
let mockAppRoot = '';

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          {
            uri: { fsPath: '/mock/workspace/path' },
            name: 'mock-workspace',
            index: 0
          }
        ],
        name: 'mock-workspace-title',
        getConfiguration: (section?: string) => ({
          get: (key: string, defaultValue?: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            if (mockConfigStore[fullKey] !== undefined) {
              return mockConfigStore[fullKey];
            }
            if (mockConfigStore[key] !== undefined) {
              return mockConfigStore[key];
            }
            return defaultValue;
          },
          update: async (key: string, val: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            mockConfigStore[fullKey] = val;
            mockConfigStore[key] = val;
            for (const listener of activeConfigListeners) {
              listener({
                affectsConfiguration: (targetKey: string) =>
                  targetKey === 'autoplan' ||
                  targetKey === fullKey ||
                  targetKey === `autoplan.${key}` ||
                  fullKey.startsWith(`${targetKey}.`)
              });
            }
          }
        }),
        onDidChangeConfiguration: (cb: (e: any) => void) => {
          activeConfigListeners.push(cb);
          allRegisteredConfigListeners.push(cb);
          return {
            dispose: () => {
              const idx = activeConfigListeners.indexOf(cb);
              if (idx >= 0) {
                activeConfigListeners.splice(idx, 1);
              }
            }
          };
        },
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
        openTextDocument: async () => ({})
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      env: {
        get appRoot() {
          return mockAppRoot;
        },
        clipboard: {
          writeText: async () => {},
          readText: async () => ''
        }
      },
      commands: {
        executeCommand: async () => {},
        registerCommand: () => ({ dispose: () => {} })
      },
      window: {
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {},
          text: '',
          tooltip: '',
          command: ''
        }),
        registerWebviewViewProvider: () => ({ dispose: () => {} }),
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showInputBox: async () => undefined,
        showQuickPick: async () => undefined,
        createOutputChannel: () => ({
          appendLine: () => {},
          append: () => {},
          clear: () => {},
          show: () => {},
          hide: () => {},
          dispose: () => {}
        })
      },
      StatusBarAlignment: {
        Left: 1,
        Right: 2
      },
      Uri: {
        file: (p: string) => ({ fsPath: p }),
        parse: (s: string) => ({ fsPath: s })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { activate, deactivate, bridgeServer } from '../extension';
import { telegramBridge } from '../telegramBridge';

async function runPhase04ConfigHotReloadAndDisposalTests(): Promise<void> {
  console.log('=== Running Phase 04: Dynamic Configuration Hot-Reload & Extension Lifecycle Cleanup Tests ===\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-test-'));
  mockAppRoot = testTempDir;

  const mockContext: any = {
    subscriptions: [],
    extensionUri: { fsPath: testTempDir },
    globalState: {
      get: () => [],
      update: async () => {}
    },
    workspaceState: {
      get: () => '',
      update: async () => {}
    },
    secrets: {
      get: async () => undefined,
      store: async () => {},
      delete: async () => {}
    }
  };

  try {
    // --------------------------------------------------------------------------
    // Test 1: Extension Activation & Subscriptions Registration
    // --------------------------------------------------------------------------
    console.log('[Test 1] Verifying extension activation and context.subscriptions registration...');
    {
      const initialSubCount = mockContext.subscriptions.length;
      assert.strictEqual(initialSubCount, 0, 'context.subscriptions should initially be empty');

      await activate(mockContext);

      assert.ok(
        mockContext.subscriptions.length > 0,
        `Expected items in context.subscriptions after activation, got ${mockContext.subscriptions.length}`
      );

      // Verify bridgeServer lifecycle disposal wrapper in context.subscriptions
      let bridgeStopCalled = false;
      const originalBridgeStop = bridgeServer.stop.bind(bridgeServer);
      bridgeServer.stop = async () => {
        bridgeStopCalled = true;
      };

      // Specifically find the disposable wrapper for bridgeServer
      // Looking from the end of context.subscriptions where lifecycle wrappers are pushed
      let bridgeServerDisposable: any = null;
      for (let i = mockContext.subscriptions.length - 1; i >= 0; i--) {
        const item = mockContext.subscriptions[i];
        if (item && typeof item.dispose === 'function') {
          bridgeStopCalled = false;
          item.dispose();
          if (bridgeStopCalled) {
            bridgeServerDisposable = item;
            break;
          }
        }
      }
      bridgeServer.stop = originalBridgeStop;

      assert.ok(
        bridgeServerDisposable,
        'context.subscriptions must contain a disposable wrapper calling bridgeServer.stop()'
      );

      // Verify telegramBridge lifecycle disposal wrapper in context.subscriptions
      let telegramStopCalled = false;
      const originalTelegramStop = telegramBridge.stop.bind(telegramBridge);
      telegramBridge.stop = async () => {
        telegramStopCalled = true;
      };

      let telegramDisposable: any = null;
      for (let i = mockContext.subscriptions.length - 1; i >= 0; i--) {
        const item = mockContext.subscriptions[i];
        if (item && typeof item.dispose === 'function') {
          telegramStopCalled = false;
          item.dispose();
          if (telegramStopCalled) {
            telegramDisposable = item;
            break;
          }
        }
      }
      telegramBridge.stop = originalTelegramStop;

      assert.ok(
        telegramDisposable,
        'context.subscriptions must contain a disposable wrapper calling telegramBridge.stop()'
      );

      console.log('  ✓ context.subscriptions successfully registers disposal wrappers for both bridgeServer and telegramBridge');
    }

    // --------------------------------------------------------------------------
    // Test 2: Configuration Hot-Reload for All 4 Telegram Configuration Keys
    // --------------------------------------------------------------------------
    console.log('\n[Test 2] Verifying configuration change listener for all 4 Telegram setting keys...');
    {
      assert.ok(
        allRegisteredConfigListeners.length > 0,
        'onDidChangeConfiguration must have registered at least one configuration change listener'
      );

      const targetKeys = [
        'autoplan.telegramEnabled',
        'autoplan.telegramBotToken',
        'autoplan.telegramAllowedUsers',
        'autoplan.telegramThrottleMs'
      ];

      for (const key of targetKeys) {
        let reloadCalled = false;
        const originalReload = telegramBridge.reloadConfig.bind(telegramBridge);
        telegramBridge.reloadConfig = async () => {
          reloadCalled = true;
        };

        try {
          const fakeEvent = {
            affectsConfiguration: (section: string) => section === key
          };

          for (const listener of allRegisteredConfigListeners) {
            listener(fakeEvent);
          }

          assert.strictEqual(
            reloadCalled,
            true,
            `Changing setting '${key}' must immediately trigger telegramBridge.reloadConfig()`
          );
          console.log(`  ✓ Setting '${key}' correctly triggers telegramBridge.reloadConfig()`);
        } finally {
          telegramBridge.reloadConfig = originalReload;
        }
      }

      // Verify that unrelated configuration keys do NOT trigger telegramBridge.reloadConfig()
      const unrelatedKeys = [
        'autoplan.repeatCount',
        'autoplan.completionKeyword',
        'autoplan.delayBetweenLoopsMs',
        'editor.fontSize',
        'workbench.colorTheme'
      ];

      for (const key of unrelatedKeys) {
        let reloadCalled = false;
        const originalReload = telegramBridge.reloadConfig.bind(telegramBridge);
        telegramBridge.reloadConfig = async () => {
          reloadCalled = true;
        };

        try {
          const fakeEvent = {
            affectsConfiguration: (section: string) => section === key
          };

          for (const listener of allRegisteredConfigListeners) {
            listener(fakeEvent);
          }

          assert.strictEqual(
            reloadCalled,
            false,
            `Changing unrelated setting '${key}' must NOT trigger telegramBridge.reloadConfig()`
          );
        } finally {
          telegramBridge.reloadConfig = originalReload;
        }
      }
      console.log('  ✓ Unrelated configuration keys safely ignored by telegramBridge reloader');
    }

    // --------------------------------------------------------------------------
    // Test 3: Disposable Error Resilience (Wrapper Catches Errors Without Crashing)
    // --------------------------------------------------------------------------
    console.log('\n[Test 3] Verifying disposal wrappers handle unexpected errors/rejections gracefully...');
    {
      const originalBridgeStop = bridgeServer.stop.bind(bridgeServer);
      const originalTelegramStop = telegramBridge.stop.bind(telegramBridge);

      // Force stop() to reject with an error
      bridgeServer.stop = async () => {
        throw new Error('Forced BridgeServer stop rejection for testing');
      };
      telegramBridge.stop = async () => {
        throw new Error('Forced TelegramBridge stop rejection for testing');
      };

      try {
        for (const item of mockContext.subscriptions) {
          if (item && typeof item.dispose === 'function') {
            assert.doesNotThrow(() => {
              item.dispose();
            }, 'Disposable item.dispose() must never throw or surface unhandled rejection');
          }
        }
        console.log('  ✓ Disposable wrappers safely swallowed stop rejections without uncaught errors');
      } finally {
        bridgeServer.stop = originalBridgeStop;
        telegramBridge.stop = originalTelegramStop;
      }
    }

    // --------------------------------------------------------------------------
    // Test 4: Graceful and Idempotent Extension Deactivation
    // --------------------------------------------------------------------------
    console.log('\n[Test 4] Verifying deactivate() terminates bridgeServer & telegramBridge cleanly & idempotently...');
    {
      let bridgeStopCallCount = 0;
      let telegramStopCallCount = 0;

      const originalBridgeStop = bridgeServer.stop.bind(bridgeServer);
      const originalTelegramStop = telegramBridge.stop.bind(telegramBridge);

      bridgeServer.stop = async () => {
        bridgeStopCallCount++;
        await originalBridgeStop();
      };
      telegramBridge.stop = async () => {
        telegramStopCallCount++;
        await originalTelegramStop();
      };

      try {
        // First deactivation call
        await deactivate();

        assert.strictEqual(
          bridgeStopCallCount,
          1,
          'deactivate() must invoke bridgeServer.stop()'
        );
        assert.strictEqual(
          telegramStopCallCount,
          1,
          'deactivate() must invoke telegramBridge.stop()'
        );

        // Second deactivation call (verifying idempotency)
        await deactivate();

        assert.strictEqual(
          bridgeStopCallCount,
          2,
          'Second deactivate() call must safely invoke bridgeServer.stop() again'
        );
        assert.strictEqual(
          telegramStopCallCount,
          2,
          'Second deactivate() call must safely invoke telegramBridge.stop() again'
        );

        console.log('  ✓ deactivate() cleanly stops both servers and is fully idempotent');
      } finally {
        bridgeServer.stop = originalBridgeStop;
        telegramBridge.stop = originalTelegramStop;
      }

      // Verify deactivate() resilience against component teardown rejections
      bridgeServer.stop = async () => {
        throw new Error('Simulated bridgeServer teardown crash');
      };
      telegramBridge.stop = async () => {
        throw new Error('Simulated telegramBridge teardown crash');
      };

      try {
        await assert.doesNotReject(
          async () => {
            await deactivate();
          },
          'deactivate() must safely swallow teardown rejections from child subsystems'
        );
        console.log('  ✓ deactivate() handles unhandled stop rejections without throwing or unhandled rejections');
      } finally {
        bridgeServer.stop = originalBridgeStop;
        telegramBridge.stop = originalTelegramStop;
      }
    }

    console.log('\nAll Phase 04 configuration hot-reload and lifecycle cleanup tests passed successfully! 🎉');
  } finally {
    if (fs.existsSync(testTempDir)) {
      try {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

runPhase04ConfigHotReloadAndDisposalTests().catch((err) => {
  console.error('\n❌ Phase 04 test suite failed with error:', err);
  process.exit(1);
});
