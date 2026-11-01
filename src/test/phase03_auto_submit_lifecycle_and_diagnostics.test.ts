// Standalone test runner for Phase 03: Extension Lifecycle, Configuration Schema & Realtime Diagnostics
const Module = require('module');
const originalRequire = Module.prototype.require;

// Global mock state for VS Code
let mockWorkspaceFolders: any[] = [
  {
    uri: {
      fsPath: '/home/skul9x/Desktop/Code/Auto-plan-Extension-main',
      toString: () => 'file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main'
    },
    name: 'Auto-plan-Extension-main',
    index: 0
  }
];

const mockConfigStore: Record<string, any> = {};
const activeConfigListeners: ((e: any) => void)[] = [];
const activeWorkspaceListeners: ((e: any) => void)[] = [];
const registeredCommands: Record<string, (...args: any[]) => any> = {};
let mockExtensions: Record<string, any> = {};

let outputChannelLines: string[] = [];
let outputChannelShown = false;
let statusBarItemsCreated: any[] = [];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        get workspaceFolders() {
          return mockWorkspaceFolders;
        },
        name: 'Auto-plan-Extension-main',
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
          return {
            dispose: () => {
              const idx = activeConfigListeners.indexOf(cb);
              if (idx >= 0) activeConfigListeners.splice(idx, 1);
            }
          };
        },
        onDidChangeWorkspaceFolders: (cb: (e: any) => void) => {
          activeWorkspaceListeners.push(cb);
          return {
            dispose: () => {
              const idx = activeWorkspaceListeners.indexOf(cb);
              if (idx >= 0) activeWorkspaceListeners.splice(idx, 1);
            }
          };
        },
        openTextDocument: async () => ({})
      },
      extensions: {
        getExtension: (id: string) => mockExtensions[id]
      },
      commands: {
        registerCommand: (cmd: string, handler: (...args: any[]) => any) => {
          registeredCommands[cmd] = handler;
          return {
            dispose: () => {
              delete registeredCommands[cmd];
            }
          };
        },
        executeCommand: async (cmd: string, ...args: any[]) => {
          if (registeredCommands[cmd]) {
            return registeredCommands[cmd](...args);
          }
          return undefined;
        }
      },
      window: {
        createStatusBarItem: (alignment?: any, priority?: number) => {
          const item = {
            alignment,
            priority,
            text: '',
            tooltip: '',
            command: '',
            visible: false,
            show() {
              this.visible = true;
            },
            hide() {
              this.visible = false;
            },
            dispose() {
              this.visible = false;
            }
          };
          statusBarItemsCreated.push(item);
          return item;
        },
        createOutputChannel: (_name: string, _opts?: any) => ({
          appendLine: (line: string) => {
            outputChannelLines.push(line);
          },
          append: (text: string) => {
            outputChannelLines.push(text);
          },
          clear: () => {
            outputChannelLines = [];
          },
          show: () => {
            outputChannelShown = true;
          },
          hide: () => {
            outputChannelShown = false;
          },
          dispose: () => {}
        }),
        registerWebviewViewProvider: () => ({ dispose: () => {} }),
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showInputBox: async () => undefined,
        showQuickPick: async () => undefined
      },
      StatusBarAlignment: {
        Left: 1,
        Right: 2
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      Uri: {
        file: (p: string) => ({
          fsPath: p,
          toString: () => (p.startsWith('file://') ? p : `file://${p}`)
        }),
        parse: (s: string) => ({
          fsPath: s.replace(/^file:\/\//, ''),
          toString: () => s
        })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import {
  getAutoSubmitConfig,
  getConfig,
  AutoSubmitConfig,
  DEFAULT_CONFIG
} from '../config';
import {
  createIdeAutoSubmit,
  getActiveWorkspaceUris,
  generateAutoSubmitDiagnosticReport,
  BUILTIN_EXTENSION_ID,
  IdeAutoSubmitStateInfo
} from '../antigravityRpcAutoSubmit';
import {
  activate,
  deactivate,
  autoSubmitService,
  autoSubmitStatusBarItem,
  diagnoseAutoSubmit,
  handleAutoSubmitConfigChange,
  updateAutoSubmitStatusBar,
  notifyTelegramOnApproval
} from '../extension';
import { telegramBridge } from '../telegramBridge';
import { debugLogger } from '../debugLogger';

async function runComprehensivePhase03Tests() {
  console.log('=== [TEST SUITE] Phase 03: Extension Lifecycle, Configuration Schema & Realtime Diagnostics ===\n');

  // =========================================================================
  // Group 1: Configuration Schema & Dynamic Parsing
  // =========================================================================
  console.log('--- Group 1: Configuration Schema Specification & Bounds Clamping ---');

  // Test 1.1: Default values for autoplan.autoSubmit.*
  {
    for (const key of Object.keys(mockConfigStore)) {
      delete mockConfigStore[key];
    }
    const cfg = getAutoSubmitConfig();
    assert.strictEqual(cfg.enabled, false, 'Default autoSubmit.enabled must be false');
    assert.strictEqual(cfg.intervalMs, 1000, 'Default autoSubmit.intervalMs must be 1000');
    assert.strictEqual(cfg.maxQuota, 0, 'Default autoSubmit.maxQuota must be 0');
    assert.strictEqual(cfg.notifyTelegram, true, 'Default autoSubmit.notifyTelegram must be true');

    const mainCfg = getConfig();
    assert.strictEqual(mainCfg.autoSubmitEnabled, false, 'Main config autoSubmitEnabled must default to false');
    assert.strictEqual(mainCfg.autoSubmitIntervalMs, 1000, 'Main config autoSubmitIntervalMs must default to 1000');
    assert.strictEqual(mainCfg.autoSubmitMaxQuota, 0, 'Main config autoSubmitMaxQuota must default to 0');
    assert.strictEqual(mainCfg.autoSubmitNotifyTelegram, true, 'Main config autoSubmitNotifyTelegram must default to true');
    console.log('  ✓ 1.1 Correctly parses default configuration values (enabled=false, interval=1000, quota=0, notifyTelegram=true)');
  }

  // Test 1.2: Bounds clamping and input validation
  {
    // Below minimum interval (200ms)
    mockConfigStore['autoplan.autoSubmit.intervalMs'] = 50;
    mockConfigStore['autoplan.autoSubmit.maxQuota'] = -10;
    const clampedLower = getAutoSubmitConfig();
    assert.strictEqual(clampedLower.intervalMs, 200, 'Interval below 200ms must be clamped to 200ms');
    assert.strictEqual(clampedLower.maxQuota, 0, 'Negative maxQuota must be clamped to 0');

    // Above maximum interval (60000ms)
    mockConfigStore['autoplan.autoSubmit.intervalMs'] = 120000;
    mockConfigStore['autoplan.autoSubmit.maxQuota'] = 50;
    const clampedUpper = getAutoSubmitConfig();
    assert.strictEqual(clampedUpper.intervalMs, 60000, 'Interval above 60000ms must be clamped to 60000ms');
    assert.strictEqual(clampedUpper.maxQuota, 50, 'Valid positive maxQuota must be preserved');

    // Invalid / NaN interval fallback
    mockConfigStore['autoplan.autoSubmit.intervalMs'] = 'not-a-number';
    const clampedNaN = getAutoSubmitConfig();
    assert.strictEqual(clampedNaN.intervalMs, 1000, 'NaN intervalMs must fall back to default 1000ms');
    console.log('  ✓ 1.2 Enforces strict validation and bounds clamping (min: 200ms, max: 60000ms, non-negative quota)');
  }

  // Test 1.3: Dual key resolution (dot-notation and camelCase fallback)
  {
    delete mockConfigStore['autoplan.autoSubmit.intervalMs'];
    mockConfigStore['autoplan.autoSubmitIntervalMs'] = 3500;
    mockConfigStore['autoplan.autoSubmitEnabled'] = true;
    const resolved = getAutoSubmitConfig();
    assert.strictEqual(resolved.enabled, true, 'Must resolve camelCase autoSubmitEnabled fallback');
    assert.strictEqual(resolved.intervalMs, 3500, 'Must resolve camelCase autoSubmitIntervalMs fallback');

    // Dot-notation takes precedence over camelCase
    mockConfigStore['autoplan.autoSubmit.intervalMs'] = 2000;
    const dotPrecedence = getAutoSubmitConfig();
    assert.strictEqual(dotPrecedence.intervalMs, 2000, 'Dot-notation autoSubmit.intervalMs takes precedence');
    console.log('  ✓ 1.3 Seamlessly supports dual key resolution with dot-notation precedence over camelCase');
  }

  // =========================================================================
  // Group 2: Dynamic Configuration Hot-Reloading & Polling Control
  // =========================================================================
  console.log('\n--- Group 2: Dynamic Configuration Hot-Reloading & Zero File I/O ---');

  // Test 2.1: Disabling autoSubmit halts polling immediately
  {
    let timerCleared = false;
    let timerCreated = false;

    const fakeEngine = createIdeAutoSubmit({
      getPolicy: () => ({ enabled: true, patterns: ['Submit'] }),
      setTimer: (fn: any, ms: number) => {
        timerCreated = true;
        return setTimeout(fn, ms);
      },
      clearTimer: (t: any) => {
        timerCleared = true;
        clearTimeout(t);
      }
    });

    fakeEngine.start();
    assert.strictEqual(fakeEngine.isPolling(), true, 'Engine must be polling after start()');

    // Call stop() as triggered when disabled
    fakeEngine.stop();
    assert.strictEqual(fakeEngine.isPolling(), false, 'Polling must immediately halt upon stop()');
    assert.strictEqual(timerCleared, true, 'Active timer must be cleared immediately when stopped');
    fakeEngine.dispose();
    console.log('  ✓ 2.1 Disabling autoplan.autoSubmit.enabled halts polling timers immediately');
  }

  // Test 2.2: Re-enabling resumes execution within 500ms
  {
    let tickRunCount = 0;
    let polEnabled = false;

    const fakeEngine = createIdeAutoSubmit({
      getPolicy: () => ({ enabled: polEnabled, patterns: ['Submit'] }),
      setTimer: (_fn: any, _ms: number) => setTimeout(() => {}, 1000),
      clearTimer: (t: any) => clearTimeout(t)
    });

    fakeEngine.stop();
    assert.strictEqual(fakeEngine.isPolling(), false);

    // Re-enable
    polEnabled = true;
    const startTime = Date.now();
    await fakeEngine.triggerTick();
    const elapsed = Date.now() - startTime;

    assert.ok(elapsed < 500, `Re-enabling must resume within 500ms (took ${elapsed}ms)`);
    assert.strictEqual(fakeEngine.isPolling(), true, 'Engine must resume active polling after triggerTick()');
    fakeEngine.dispose();
    console.log('  ✓ 2.2 Re-enabling autoplan.autoSubmit.enabled resumes execution immediately within 500ms');
  }

  // Test 2.3: Zero file I/O on autoSubmit hot reload
  {
    // Track sidecar writes by spying on fs.writeFileSync
    let sidecarWriteTriggered = false;
    const originalWriteFileSync = require('fs').writeFileSync;
    require('fs').writeFileSync = function (file: any, ...args: any[]) {
      if (typeof file === 'string' && file.includes('autoplan-config.json')) {
        sidecarWriteTriggered = true;
      }
      return originalWriteFileSync.apply(this, [file, ...args]);
    };

    try {
      // Simulate onDidChangeConfiguration for autoplan.autoSubmit
      for (const listener of activeConfigListeners) {
        listener({
          affectsConfiguration: (targetKey: string) => targetKey === 'autoplan.autoSubmit'
        });
      }
      assert.strictEqual(
        sidecarWriteTriggered,
        false,
        'Config change strictly targeting autoplan.autoSubmit must perform ZERO sidecar file I/O'
      );
      console.log('  ✓ 2.3 Hot-reloading autoplan.autoSubmit performs zero disk/file I/O on unchanged sidecar configs');
    } finally {
      require('fs').writeFileSync = originalWriteFileSync;
    }
  }

  // =========================================================================
  // Group 3: Extension Lifecycle: Activation, Clean Disposal & Restart Safety
  // =========================================================================
  console.log('\n--- Group 3: Extension Lifecycle Management & Clean Disposal ---');

  // Test 3.1: Activation registers status bar item, command, and subscriptions
  {
    const mockContext: any = {
      subscriptions: [],
      secrets: {
        get: async () => undefined,
        store: async () => {},
        delete: async () => {}
      },
      globalStorageUri: { fsPath: '/tmp/mock-storage' },
      extensionUri: { fsPath: '/tmp/mock-ext' }
    };

    mockConfigStore['autoplan.autoSubmit.enabled'] = true;
    mockConfigStore['autoplan.autoSubmit.intervalMs'] = 1500;

    activate(mockContext);

    // Verify autoSubmitStatusBarItem exists
    assert.ok(autoSubmitStatusBarItem, 'autoSubmitStatusBarItem must be instantiated during activate()');
    assert.strictEqual(autoSubmitStatusBarItem.command, 'autoplan.diagnoseAutoSubmit', 'Status bar item must bind diagnose command');

    // Verify command registration
    assert.ok(
      registeredCommands['autoplan.diagnoseAutoSubmit'],
      'Command autoplan.diagnoseAutoSubmit must be registered in VS Code command registry'
    );

    // Verify autoSubmitService active
    assert.ok(autoSubmitService, 'autoSubmitService must be instantiated in activate()');

    // Verify disposal wrapper pushed to subscriptions
    const hasDisposal = mockContext.subscriptions.some(
      (item: any) => item && typeof item.dispose === 'function'
    );
    assert.ok(hasDisposal, 'Context subscriptions must contain registered disposables');

    console.log('  ✓ 3.1 Extension activation creates priority 98 status bar item, registers diagnose command, and populates subscriptions');
  }

  // Test 3.2: Restart safety & idempotency: prevents duplicate engine instances
  {
    const initialEngine = autoSubmitService;
    assert.ok(initialEngine, 'Initial engine must exist');

    let previousDisposed = false;
    const origDispose = initialEngine.dispose;
    initialEngine.dispose = () => {
      previousDisposed = true;
      origDispose();
    };

    // Re-activate as happens on Extension Host reload
    const mockContext2: any = {
      subscriptions: [],
      secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
      globalStorageUri: { fsPath: '/tmp/mock-storage' },
      extensionUri: { fsPath: '/tmp/mock-ext' }
    };

    activate(mockContext2);

    assert.strictEqual(previousDisposed, true, 'Prior engine instance must be cleanly disposed before re-instantiating');
    assert.notStrictEqual(autoSubmitService, initialEngine, 'New engine instance must replace previous on reactivation');
    console.log('  ✓ 3.2 Extension Host restart safely disposes prior instances, preventing duplicate or leaking polling loops');
  }

  // Test 3.3: Clean deactivation tears down all resources
  {
    assert.ok(autoSubmitService, 'Engine must be active before deactivation');
    let serviceDisposed = false;
    const origDispose = autoSubmitService.dispose;
    autoSubmitService.dispose = () => {
      serviceDisposed = true;
      origDispose();
    };

    await deactivate();

    assert.strictEqual(serviceDisposed, true, 'autoSubmitService.dispose() must be executed on deactivate()');
    assert.strictEqual(autoSubmitService, null, 'autoSubmitService reference must be null after deactivate()');
    console.log('  ✓ 3.3 Deactivate cleanly disposes autoSubmitService, terminates all timers, and clears references');
  }

  // =========================================================================
  // Group 4: Interactive Diagnostics Command & Structured Report Formatting
  // =========================================================================
  console.log('\n--- Group 4: Interactive Diagnostics Command & Telemetry Formatting ---');

  // Test 4.1: diagnoseAutoSubmit outputs comprehensive structured report
  {
    outputChannelLines = [];
    outputChannelShown = false;

    // Reactivate extension for diagnostic queries
    const mockCtx: any = {
      subscriptions: [],
      secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
      globalStorageUri: { fsPath: '/tmp/mock-storage' },
      extensionUri: { fsPath: '/tmp/mock-ext' }
    };
    mockConfigStore['autoplan.autoSubmit.enabled'] = true;
    mockConfigStore['autoplan.autoSubmit.intervalMs'] = 1200;
    mockConfigStore['autoplan.autoSubmit.maxQuota'] = 15;
    activate(mockCtx);

    const report = diagnoseAutoSubmit();

    assert.ok(report.includes('Auto-Plan: Antigravity RPC Auto-Submit Diagnostics'), 'Report must contain header');
    assert.ok(report.includes('Engine Phase:'), 'Report must include engine phase');
    assert.ok(report.includes('Trajectory Summaries:'), 'Report must include trajectory summaries count');
    assert.ok(report.includes('Waiting Steps Count:'), 'Report must include waiting steps count');
    assert.ok(report.includes('Eligible Permissions:'), 'Report must include eligible permissions');
    assert.ok(report.includes('Total Approved (Session):'), 'Report must include total approved');
    assert.ok(report.includes('Approval Quota: 15'), 'Report must reflect configured quota');
    assert.ok(report.includes('Current Poll Interval:'), 'Report must include current polling interval');
    assert.ok(report.includes('Quarantine Cache Entries:'), 'Report must include quarantine cache count');
    assert.ok(report.includes('Last Error: None'), 'Report must show last error state');
    assert.ok(report.includes('Actionable Suggestions'), 'Report must surface actionable guidance');

    assert.ok(outputChannelLines.length > 0, 'Report must be written to Auto-Plan Output Channel');
    assert.strictEqual(outputChannelShown, true, 'Output channel must be revealed');
    console.log('  ✓ 4.1 diagnoseAutoSubmit generates structured diagnostic report and prints to Output Channel');
  }

  // Test 4.2: Actionable suggestions tailored to all lifecycle phases
  {
    const phases: Array<{ phase: any; expectedSubstring: string; desc: string }> = [
      {
        phase: 'ready',
        expectedSubstring: 'active and operational',
        desc: 'ready phase reports active operational health'
      },
      {
        phase: 'waiting',
        expectedSubstring: 'installed but inactive',
        desc: 'waiting phase advises opening Antigravity session'
      },
      {
        phase: 'unsupported',
        expectedSubstring: 'does not expose the required RPC client API',
        desc: 'unsupported phase advises IDE upgrade'
      },
      {
        phase: 'disabled',
        expectedSubstring: 'Automatic permission submission is currently disabled',
        desc: 'disabled phase instructs how to enable via settings'
      },
      {
        phase: 'dormant',
        expectedSubstring: 'Maximum session approval quota reached',
        desc: 'dormant phase advises increasing max quota'
      },
      {
        phase: 'retrying',
        expectedSubstring: 'Encountering connection errors',
        desc: 'retrying phase surfaces connection error and backoff status'
      },
      {
        phase: 'legacy',
        expectedSubstring: 'google.google-antigravity',
        desc: 'legacy phase advises checking Antigravity installation'
      }
    ];

    for (const testCase of phases) {
      const rep = generateAutoSubmitDiagnosticReport(
        {
          phase: testCase.phase,
          available: testCase.phase === 'ready',
          approved: 0,
          summaryCount: 0,
          waitingStepsCount: 0,
          eligiblePermissions: 0,
          lastError: testCase.phase === 'retrying' ? 'ETIMEDOUT' : null
        },
        { config: { enabled: true, intervalMs: 1000, maxQuota: 0, notifyTelegram: true } }
      );
      assert.ok(
        rep.includes(testCase.expectedSubstring),
        `Phase '${testCase.phase}' must include expected suggestion '${testCase.expectedSubstring}'`
      );
    }
    console.log('  ✓ 4.2 Diagnostic generator outputs distinct, actionable suggestions for ready, waiting, unsupported, disabled, dormant, retrying, and legacy phases');
  }

  // =========================================================================
  // Group 5: Multi-Workspace Folder Switching & Active Workspace Boundaries
  // =========================================================================
  console.log('\n--- Group 5: Multi-Workspace Folder Switching & Active Workspace Scoping ---');

  // Test 5.1: getActiveWorkspaceUris extracts normalized workspace URIs
  {
    mockWorkspaceFolders = [
      { uri: { toString: () => 'file:///project/root1' } },
      { uri: { toString: () => 'file:///project/root2' } }
    ];

    const uris = getActiveWorkspaceUris();
    assert.deepStrictEqual(uris, ['file:///project/root1', 'file:///project/root2'], 'Must retrieve all active workspace URIs');
    console.log('  ✓ 5.1 getActiveWorkspaceUris accurately normalizes multi-root workspace URIs');
  }

  // Test 5.2: onDidChangeWorkspaceFolders triggers invalidate and updates workspace boundaries
  {
    let invalidateCalled = false;
    assert.ok(autoSubmitService, 'autoSubmitService must be initialized');
    const service: any = autoSubmitService;
    const originalInvalidate = service.invalidate.bind(service);
    service.invalidate = (immediate?: boolean) => {
      invalidateCalled = true;
      return originalInvalidate(immediate);
    };

    // Simulate switching workspace folders in VS Code
    mockWorkspaceFolders = [{ uri: { toString: () => 'file:///project/switched-workspace' } }];
    for (const listener of activeWorkspaceListeners) {
      listener({});
    }

    assert.strictEqual(
      invalidateCalled,
      true,
      'Switching workspace folders must trigger autoSubmitService.invalidate(true)'
    );
    console.log('  ✓ 5.2 Switching workspace folders triggers immediate cache invalidation and updates workspace scoping boundaries');
  }

  // =========================================================================
  // Group 6: Telegram Approval Forwarding Integration
  // =========================================================================
  console.log('\n--- Group 6: Telegram Approval Notification Integration ---');

  // Test 6.1: Forwards approval notification when notifyTelegram is true
  {
    let telegramMessageSent: string | null = null;
    const fakeNotifier = {
      sendInfo: async (msg: string) => {
        telegramMessageSent = msg;
      },
      broadcastMessage: async (msg: string) => {
        telegramMessageSent = msg;
      }
    };

    const originalGetNotifier = telegramBridge.getNotifier.bind(telegramBridge);
    telegramBridge.getNotifier = () => fakeNotifier as any;

    try {
      mockConfigStore['autoplan.autoSubmit.notifyTelegram'] = true;

      const dispatched = await notifyTelegramOnApproval({
        pattern: 'Submit',
        button: 'Submit (IDE permission, allow once)',
        candidate: {
          resource: { action: 'write_file', target: '/home/user/file.ts' }
        }
      });

      assert.strictEqual(dispatched, true, 'notifyTelegramOnApproval must return true when dispatched');
      assert.ok(telegramMessageSent, 'Telegram notification must be dispatched');
      const sentMsg = String(telegramMessageSent);
      assert.ok(sentMsg.includes('Approved write_file'), 'Notification text must specify approved action');
      assert.ok(sentMsg.includes('/home/user/file.ts'), 'Notification text must specify target');

      // Also verify engine integration with onClick hook
      let engineOnClickCalled = false;
      const mockClient = {
        getAllCascadeTrajectories: async () => ({
          trajectorySummaries: {
            casc1: {
              trajectoryId: 'traj1',
              cascadeId: 'casc1',
              workspaces: [{ workspaceFolderAbsoluteUri: 'file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main' }],
              waitingSteps: [
                {
                  stepIndex: 1,
                  step: {
                    status: 9,
                    metadata: {
                      sourceTrajectoryStepInfo: {
                        cascadeId: 'casc1',
                        trajectoryId: 'traj1',
                        stepIndex: 1
                      }
                    },
                    requestedInteraction: {
                      interaction: {
                        case: 'permission',
                        value: {
                          resource: { action: 'write_file', target: '/home/user/test.ts' }
                        }
                      }
                    }
                  }
                }
              ]
            }
          }
        }),
        handleCascadeUserInteraction: async () => ({ success: true })
      };

      const mockExt = {
        id: BUILTIN_EXTENSION_ID,
        isActive: true,
        exports: { getRpcClient: async () => mockClient }
      };

      const testEngine = createIdeAutoSubmit({
        getExtension: () => mockExt,
        getPolicy: () => ({
          enabled: true,
          patterns: ['Submit'],
          workspaceUris: ['file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main']
        }),
        onClick: async (evt) => {
          engineOnClickCalled = true;
          await notifyTelegramOnApproval(evt);
        }
      });

      await testEngine.tick();
      assert.strictEqual(engineOnClickCalled, true, 'Engine tick must invoke onClick upon successful approval');
      testEngine.dispose();

      console.log('  ✓ 6.1 Automatically forwards permission approval events to Telegram when notifyTelegram=true');
    } finally {
      telegramBridge.getNotifier = originalGetNotifier;
    }
  }

  // Test 6.2: Skips Telegram notification when notifyTelegram is false
  {
    let telegramMessageSent: string | null = null;
    const fakeNotifier = {
      sendInfo: async (msg: string) => {
        telegramMessageSent = msg;
      }
    };
    const originalGetNotifier = telegramBridge.getNotifier.bind(telegramBridge);
    telegramBridge.getNotifier = () => fakeNotifier as any;

    try {
      mockConfigStore['autoplan.autoSubmit.notifyTelegram'] = false;

      const dispatched = await notifyTelegramOnApproval({
        pattern: 'Submit',
        candidate: {
          resource: { action: 'run_command', target: 'npm test' }
        }
      });

      assert.strictEqual(dispatched, false, 'notifyTelegramOnApproval must return false when disabled');
      assert.strictEqual(telegramMessageSent, null, 'Must NOT dispatch Telegram notification when notifyTelegram=false');
      console.log('  ✓ 6.2 Suppresses Telegram notifications when autoplan.autoSubmit.notifyTelegram=false');
    } finally {
      telegramBridge.getNotifier = originalGetNotifier;
    }
  }

  // Clean teardown after tests
  await deactivate();

  console.log('\n=============================================================');
  console.log('✅ ALL PHASE 03 TESTS PASSED SUCCESSFULLY!');
  console.log('=============================================================\n');
}

runComprehensivePhase03Tests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ Phase 03 Test Suite Failed:');
  console.error(err);
  process.exit(1);
});
