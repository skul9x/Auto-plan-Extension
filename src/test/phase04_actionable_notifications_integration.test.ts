// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let executedCommands: { cmd: string; args: any[] }[] = [];
let createdStatusBarItems: any[] = [];
let shownInfoMessages: { msg: string; items: string[]; selected?: string }[] = [];
let shownWarningMessages: { msg: string; items: string[]; selected?: string }[] = [];
let shownErrorMessages: { msg: string; items: string[]; selected?: string }[] = [];
let mockNotificationSelection: string | undefined = undefined;

let configStore: { [key: string]: any } = {
  promptText: 'Hãy trả lời tôi với câu trả lời là "Done skul9x.", ngoài ra không nói gì thêm',
  repeatCount: 5,
  completionKeyword: 'Done skul9x.',
  delayBetweenLoopsMs: 100,
  timeoutPerLoopMinutes: 15,
  autoInjectWorkbench: true
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
        registerWebviewViewProvider: (viewId: string, provider: any) => {
          return {
            dispose: () => {}
          };
        },
        showInformationMessage: async (msg: string, ...items: string[]) => {
          shownInfoMessages.push({ msg, items, selected: mockNotificationSelection });
          return mockNotificationSelection || items[0];
        },
        showWarningMessage: async (msg: string, ...items: string[]) => {
          shownWarningMessages.push({ msg, items, selected: mockNotificationSelection });
          return mockNotificationSelection || items[0];
        },
        showErrorMessage: async (msg: string, ...items: string[]) => {
          shownErrorMessages.push({ msg, items, selected: mockNotificationSelection });
          return mockNotificationSelection || items[0];
        },
        showInputBox: async (opts: any) => 'Custom prompt'
      },
      commands: {
        registerCommand: (command: string, callback: (...args: any[]) => any) => {
          registeredCommands[command] = callback;
          return {
            dispose: () => {
              delete registeredCommands[command];
            }
          };
        },
        executeCommand: async (command: string, ...args: any[]) => {
          executedCommands.push({ cmd: command, args });
          if (registeredCommands[command]) {
            return registeredCommands[command](...args);
          }
          return undefined;
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
      },
      Uri: {
        file: (p: string) => ({ fsPath: p, scheme: 'file' }),
        joinPath: (base: any, ...segments: string[]) => ({
          fsPath: path.join(base.fsPath || base, ...segments),
          scheme: 'file'
        })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  activate,
  deactivate,
  sidebarProvider,
  showBridgeMissingNotification,
  showLinuxPreflightErrorNotification,
  installBridge
} from '../extension';
import { orchestrator } from '../orchestrator';
import { transcriptWatcher } from '../transcriptWatcher';
import * as workbenchInjector from '../workbenchInjector';

async function runPhase04IntegrationTests() {
  console.log('=== Running Phase 04 Actionable Notifications & System Integration Tests ===');

  try {
    // -------------------------------------------------------------
    // Test 1: Manifest Schema Compliance Verification
    // -------------------------------------------------------------
    console.log('-> Test 1: Manifest Schema Compliance Verification in package.json');
    const pkgPath = path.join(__dirname, '..', '..', 'package.json');
    assert.strictEqual(fs.existsSync(pkgPath), true, 'package.json must exist');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // 1. viewsContainers
    assert.ok(pkg.contributes?.viewsContainers?.activitybar, 'package.json must contribute viewsContainers.activitybar');
    const container = pkg.contributes.viewsContainers.activitybar.find(
      (c: any) => c.id === 'autoplan-sidebar-container'
    );
    assert.ok(container, 'activitybar container with id "autoplan-sidebar-container" must exist');
    assert.strictEqual(container.title, 'Auto-Plan Control Center');

    // 2. views
    assert.ok(pkg.contributes?.views?.['autoplan-sidebar-container'], 'views for "autoplan-sidebar-container" must exist');
    const view = pkg.contributes.views['autoplan-sidebar-container'].find(
      (v: any) => v.id === 'autoplan.sidebarView'
    );
    assert.ok(view, 'view with id "autoplan.sidebarView" must exist');
    assert.strictEqual(view.name, 'Plan Execution Dashboard');

    // 3. commands
    const commandIds = pkg.contributes?.commands?.map((c: any) => c.command) || [];
    assert.ok(commandIds.includes('autoplan.openSidebar'), 'autoplan.openSidebar command must be registered');
    assert.ok(commandIds.includes('autoplan.oneClickSetup'), 'autoplan.oneClickSetup command must be registered');
    assert.ok(commandIds.includes('autoplan.checkStatus'), 'autoplan.checkStatus command must be registered');

    // 4. activationEvents
    assert.ok(
      pkg.activationEvents?.includes('onView:autoplan.sidebarView'),
      'activationEvents must include "onView:autoplan.sidebarView"'
    );
    console.log('✓ Test 1: Manifest Schema Compliance verified (viewsContainers, views, commands, activationEvents)');

    // -------------------------------------------------------------
    // Test 2: Actionable Notification Handling with Interactive Buttons
    // -------------------------------------------------------------
    console.log('-> Test 2: Actionable Notification Handlers & Interactive Buttons');

    // Setup Extension activation
    const extensionContext: any = {
      extensionUri: { fsPath: path.join(__dirname, '..', '..') },
      subscriptions: [],
      workspaceState: {
        get: () => undefined,
        update: async () => {}
      },
      globalState: {
        get: () => [],
        update: async () => {}
      }
    };
    activate(extensionContext);

    // Case A: Missing DOM Bridge Warning Notification
    executedCommands = [];
    shownWarningMessages = [];
    mockNotificationSelection = '⚡ 1-Click Setup';
    const warningRes = await showBridgeMissingNotification();
    assert.strictEqual(warningRes, '⚡ 1-Click Setup');
    assert.ok(
      shownWarningMessages.some((w) => w.msg.includes('Auto-Plan DOM Bridge is not active')),
      'Warning message must notify about inactive DOM Bridge'
    );
    assert.ok(
      executedCommands.some((c) => c.cmd === 'autoplan.oneClickSetup'),
      'Selecting "⚡ 1-Click Setup" must execute autoplan.oneClickSetup command'
    );
    console.log('  - Missing DOM Bridge notification button handler verified');

    // Case B: Linux Pre-Flight Failure Error Notification
    executedCommands = [];
    shownErrorMessages = [];
    mockNotificationSelection = '⚡ Activate Bridge (Recommended)';
    const errorRes = await showLinuxPreflightErrorNotification();
    assert.strictEqual(errorRes, '⚡ Activate Bridge (Recommended)');
    assert.ok(
      shownErrorMessages.some((e) => e.msg.includes('Linux Pre-Flight Failed')),
      'Error message must specify Linux Pre-Flight failure'
    );
    assert.ok(
      executedCommands.some((c) => c.cmd === 'autoplan.oneClickSetup'),
      'Selecting "⚡ Activate Bridge (Recommended)" must execute autoplan.oneClickSetup'
    );
    console.log('  - Linux Pre-Flight error notification button handler verified');

    // Case C: Patch Complete Info Notification
    shownInfoMessages = [];
    executedCommands = [];
    mockNotificationSelection = '🔄 Reload Window';
    const origInstall = workbenchInjector.installBridgeScript;
    (workbenchInjector as any).installBridgeScript = () => ({ success: true, path: '/tmp/mock/workbench.html' });
    try {
      await installBridge();
      assert.ok(
        shownInfoMessages.some((i) => i.msg.includes('DOM Bridge injected successfully. Reload IDE to apply.')),
        'Information message must notify DOM Bridge injected successfully'
      );
      assert.ok(
        executedCommands.some((c) => c.cmd === 'workbench.action.reloadWindow'),
        'Selecting "🔄 Reload Window" must execute workbench.action.reloadWindow'
      );
      console.log('  - Patch complete notification handler verified');
    } finally {
      (workbenchInjector as any).installBridgeScript = origInstall;
    }

    console.log('✓ Test 2: Actionable Notification Handlers fully verified');

    // -------------------------------------------------------------
    // Test 3: Orchestrator & TranscriptWatcher Event Hooks to Sidebar
    // -------------------------------------------------------------
    console.log('-> Test 3: Orchestrator & TranscriptWatcher Event Hooks Propagation');

    assert.ok(sidebarProvider, 'SidebarProvider instance must be active after activation');

    // Mock webview postMessage
    const postedMessages: any[] = [];
    (sidebarProvider as any)._view = {
      webview: {
        postMessage: async (msg: any) => {
          postedMessages.push(msg);
        }
      }
    };

    // Fire phaseStart
    postedMessages.length = 0;
    orchestrator.emit('phaseStart', { index: 0, fileName: 'phase-01.md' }, 0, 3);
    assert.ok(
      postedMessages.some((m) => m.type === 'progress' || m.type === 'stateUpdate'),
      'phaseStart event must trigger webview updates'
    );

    // Fire phaseComplete
    postedMessages.length = 0;
    orchestrator.emit('phaseComplete', { index: 0, fileName: 'phase-01.md' }, { success: true }, 0, 3);
    assert.ok(
      postedMessages.some((m) => m.type === 'progress' || m.type === 'stateUpdate'),
      'phaseComplete event must advance progress and trigger webview update'
    );

    // Fire transcriptWatcher logUpdate
    postedMessages.length = 0;
    transcriptWatcher.emit('logUpdate', '{"step_index":1,"content":"Testing log streaming"}');
    assert.ok(
      postedMessages.some((m) => m.type === 'transcriptLog' && m.log.includes('Testing log streaming')),
      'logUpdate event must forward log snippets to sidebarProvider'
    );

    console.log('✓ Test 3: Event Hooks & Webview event propagation verified');

    // -------------------------------------------------------------
    // Test 4: Command Execution Integration
    // -------------------------------------------------------------
    console.log('-> Test 4: Command Execution (autoplan.openSidebar & autoplan.oneClickSetup)');

    executedCommands = [];
    assert.ok(typeof registeredCommands['autoplan.openSidebar'] === 'function', 'autoplan.openSidebar handler registered');
    await registeredCommands['autoplan.openSidebar']();
    assert.ok(
      executedCommands.some((c) => c.cmd === 'autoplan.sidebarView.focus'),
      'autoplan.openSidebar must call autoplan.sidebarView.focus'
    );

    assert.ok(typeof registeredCommands['autoplan.oneClickSetup'] === 'function', 'autoplan.oneClickSetup handler registered');
    mockNotificationSelection = 'Later';
    const setupResult = await registeredCommands['autoplan.oneClickSetup']();
    assert.strictEqual(typeof setupResult, 'boolean', 'autoplan.oneClickSetup should return boolean status');

    assert.ok(typeof registeredCommands['autoplan.checkStatus'] === 'function', 'autoplan.checkStatus handler registered');

    deactivate();
    console.log('✓ Test 4: Command execution verified');

    console.log('\n=== All Phase 04 Integration Tests Passed 100%! ===');
  } catch (err) {
    console.error('Phase 04 Integration Test Failed:', err);
    process.exit(1);
  }
}

runPhase04IntegrationTests();
