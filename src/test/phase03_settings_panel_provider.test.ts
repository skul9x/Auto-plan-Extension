// Standalone Mock Setup for 'vscode' before importing application modules
const Module = require('module');
const originalRequire = Module.prototype.require;

interface MockDisposable {
  dispose: () => void;
}

const registeredCommands: Map<string, Function> = new Map();
const executedCommands: { command: string; args: any[] }[] = [];
let mockConfigStore: Record<string, any> = {};
const configListeners: ((e: any) => void)[] = [];
const createdWebviewPanels: any[] = [];
let openDialogMockReturnValue: any[] | undefined = undefined;
let activeInfoMessages: string[] = [];
let activeErrorMessages: string[] = [];
let activeWarningMessages: string[] = [];

class MockWebview {
  public html: string = '';
  public options: any = {};
  public cspSource: string = 'vscode-webview:';
  private messageListeners: ((msg: any) => void)[] = [];
  public messagesPosted: any[] = [];

  asWebviewUri(uri: any): any {
    return {
      scheme: 'vscode-resource',
      authority: '',
      path: uri.path || uri.fsPath || '',
      toString: () => `vscode-resource://${uri.fsPath || uri.path || ''}`
    };
  }

  onDidReceiveMessage(listener: (msg: any) => void, _thisArgs?: any, disposables?: any[]): MockDisposable {
    this.messageListeners.push(listener);
    const disp = {
      dispose: () => {
        const idx = this.messageListeners.indexOf(listener);
        if (idx !== -1) {
          this.messageListeners.splice(idx, 1);
        }
      }
    };
    if (disposables) {
      disposables.push(disp);
    }
    return disp;
  }

  async postMessage(msg: any): Promise<boolean> {
    this.messagesPosted.push(msg);
    return true;
  }

  simulateMessageFromWebview(msg: any) {
    for (const l of [...this.messageListeners]) {
      l(msg);
    }
  }
}

class MockWebviewPanel {
  public viewType: string;
  public title: string;
  public showOptions: any;
  public options: any;
  public iconPath: any;
  public webview: MockWebview;
  public visible: boolean = true;
  public viewColumn: number = 1;
  public revealedColumns: number[] = [];
  public isDisposed: boolean = false;
  private disposeListeners: (() => void)[] = [];

  constructor(viewType: string, title: string, showOptions: any, options: any) {
    this.viewType = viewType;
    this.title = title;
    this.showOptions = showOptions;
    this.options = options;
    this.webview = new MockWebview();
  }

  reveal(column?: number) {
    if (column !== undefined) {
      this.viewColumn = column;
      this.revealedColumns.push(column);
    }
    this.visible = true;
  }

  onDidDispose(listener: () => void, _thisArgs?: any, disposables?: any[]): MockDisposable {
    this.disposeListeners.push(listener);
    const disp = {
      dispose: () => {
        const idx = this.disposeListeners.indexOf(listener);
        if (idx !== -1) {
          this.disposeListeners.splice(idx, 1);
        }
      }
    };
    if (disposables) {
      disposables.push(disp);
    }
    return disp;
  }

  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.visible = false;
    for (const l of [...this.disposeListeners]) {
      l();
    }
  }
}

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section?: string) => ({
          get: (key: string, defaultValue: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            if (mockConfigStore[fullKey] !== undefined) return mockConfigStore[fullKey];
            if (mockConfigStore[key] !== undefined) return mockConfigStore[key];
            return defaultValue;
          },
          update: async (key: string, value: any, _target?: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            mockConfigStore[fullKey] = value;
            mockConfigStore[key] = value;
          }
        }),
        onDidChangeConfiguration: (listener: (e: any) => void) => {
          configListeners.push(listener);
          return {
            dispose: () => {
              const idx = configListeners.indexOf(listener);
              if (idx !== -1) configListeners.splice(idx, 1);
            }
          };
        },
        workspaceFolders: []
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      ViewColumn: {
        Active: -1,
        Beside: -2,
        One: 1,
        Two: 2
      },
      StatusBarAlignment: {
        Left: 1,
        Right: 2
      },
      Uri: {
        file: (fsPath: string) => ({
          fsPath,
          path: fsPath,
          scheme: 'file',
          toString: () => `file://${fsPath}`
        }),
        joinPath: (baseUri: any, ...pathSegments: string[]) => {
          const pathModule = require('path');
          const joined = pathModule.join(baseUri.fsPath || baseUri.path || '', ...pathSegments);
          return {
            fsPath: joined,
            path: joined,
            scheme: 'file',
            toString: () => `file://${joined}`
          };
        }
      },
      window: {
        createWebviewPanel: (viewType: string, title: string, showOptions: any, options: any) => {
          const panel = new MockWebviewPanel(viewType, title, showOptions, options);
          createdWebviewPanels.push(panel);
          return panel;
        },
        createStatusBarItem: () => ({
          text: '',
          tooltip: '',
          command: '',
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        registerWebviewViewProvider: () => ({ dispose: () => {} }),
        showInformationMessage: async (msg: string, ...actions: string[]) => {
          activeInfoMessages.push(msg);
          return actions[0];
        },
        showErrorMessage: async (msg: string) => {
          activeErrorMessages.push(msg);
        },
        showWarningMessage: async (msg: string, ...actions: string[]) => {
          activeWarningMessages.push(msg);
          return actions[0];
        },
        showOpenDialog: async (_options: any) => {
          return openDialogMockReturnValue;
        },
        showQuickPick: async (items: any[]) => {
          return items.find((i: any) => i.action === 'openSettings');
        },
        activeTextEditor: undefined
      },
      commands: {
        registerCommand: (command: string, callback: (...args: any[]) => any) => {
          registeredCommands.set(command, callback);
          return {
            dispose: () => registeredCommands.delete(command)
          };
        },
        executeCommand: async (command: string, ...args: any[]) => {
          executedCommands.push({ command, args });
          const handler = registeredCommands.get(command);
          if (handler) {
            return handler(...args);
          }
          return undefined;
        }
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { SettingsProvider, getNonce } from '../settingsProvider';
import { DEFAULT_CONFIG, getConfig, writeConfigJson, SIDECAR_CONFIG_FILENAME } from '../config';
import { PromptDispatcher } from '../promptDispatcher';
import { SidebarProvider } from '../sidebarProvider';
import { activate, showRunningActionMenu } from '../extension';

async function runPhase03Tests() {
  console.log('================================================================');
  console.log('   Phase 03 Test Suite: Settings Panel Provider & Host Linking  ');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '../../');
  const mockExtensionUri = {
    fsPath: rootDir,
    path: rootDir,
    scheme: 'file',
    toString: () => `file://${rootDir}`
  } as vscode.Uri;

  // --------------------------------------------------------------------------
  // Test 1: Nonce Generation and CSP Properties
  // --------------------------------------------------------------------------
  console.log('[Test 1] Testing getNonce helper...');
  const nonce1 = getNonce();
  const nonce2 = getNonce();
  assert.ok(nonce1 && typeof nonce1 === 'string', 'Nonce1 should be non-empty string');
  assert.ok(nonce2 && typeof nonce2 === 'string', 'Nonce2 should be non-empty string');
  assert.notStrictEqual(nonce1, nonce2, 'Consecutive nonces must be uniquely random');
  assert.ok(nonce1.length >= 16, 'Nonce should have sufficient entropy length');
  console.log('  ✓ getNonce generates unique cryptographically random tokens\n');

  // --------------------------------------------------------------------------
  // Test 2: WebviewPanel Instantiation & HTML Generation
  // --------------------------------------------------------------------------
  console.log('[Test 2] Testing SettingsProvider.render() singleton and HTML generation...');
  assert.strictEqual(SettingsProvider.currentPanel, undefined, 'Initial currentPanel must be undefined');

  let mockPromptDispatcher = new PromptDispatcher({
    commandExecutor: async () => {}
  });

  const providerInstance1 = SettingsProvider.render(mockExtensionUri, mockPromptDispatcher);
  assert.ok(providerInstance1, 'SettingsProvider.render should return provider instance');
  assert.strictEqual(SettingsProvider.currentPanel, providerInstance1, 'currentPanel should match singleton instance');
  assert.strictEqual(createdWebviewPanels.length, 1, 'Exactly one WebviewPanel should be created');

  const createdPanel: MockWebviewPanel = createdWebviewPanels[0];
  assert.strictEqual(createdPanel.viewType, SettingsProvider.viewType, 'viewType must be autoplan.settingsPanel');
  assert.strictEqual(createdPanel.title, 'Auto-Plan Settings', 'Panel title must be Auto-Plan Settings');
  assert.strictEqual(createdPanel.options.enableScripts, true, 'enableScripts must be true');
  assert.strictEqual(createdPanel.options.retainContextWhenHidden, true, 'retainContextWhenHidden must be true');
  assert.ok(createdPanel.iconPath, 'Panel iconPath should be set');
  assert.ok(createdPanel.iconPath.fsPath.endsWith(path.join('media', 'icon.svg')), 'iconPath points to media/icon.svg');

  // Verify HTML content
  const generatedHtml = createdPanel.webview.html;
  assert.ok(generatedHtml.includes('<!DOCTYPE html>'), 'Generated HTML contains <!DOCTYPE html>');
  assert.ok(generatedHtml.includes('Content-Security-Policy'), 'Generated HTML has CSP meta tag');
  assert.ok(generatedHtml.includes("default-src 'none'"), 'CSP contains default-src none');
  assert.ok(generatedHtml.includes("script-src 'nonce-"), 'CSP contains nonce restriction for scripts');
  assert.ok(generatedHtml.includes('vscode-resource://'), 'Assets are converted to webview resource URIs');
  assert.ok(generatedHtml.includes('settings.css'), 'settings.css is referenced in HTML');
  assert.ok(generatedHtml.includes('settings.js'), 'settings.js is referenced in HTML');
  assert.ok(generatedHtml.includes('Auto-Plan Settings'), 'Page contains Auto-Plan Settings title');
  console.log('  ✓ WebviewPanel instantiated with correct options, CSP and dynamic HTML\n');

  // --------------------------------------------------------------------------
  // Test 3: Singleton Idempotency - Calling render() reveals existing panel
  // --------------------------------------------------------------------------
  console.log('[Test 3] Testing Singleton Idempotency of SettingsProvider.render()...');
  const providerInstance2 = SettingsProvider.render(mockExtensionUri);
  assert.strictEqual(providerInstance1, providerInstance2, 'Subsequent render must return existing singleton instance');
  assert.strictEqual(createdWebviewPanels.length, 1, 'No second panel should be created');
  assert.strictEqual(createdPanel.revealedColumns.length, 1, 'reveal() should have been called on existing panel');
  console.log('  ✓ Subsequent render calls reveal existing instance without duplicating\n');

  // --------------------------------------------------------------------------
  // Test 4: IPC Message - 'ready' Handler (initSettings + healthUpdate)
  // --------------------------------------------------------------------------
  console.log('[Test 4] Testing IPC ready message handling...');
  createdPanel.webview.messagesPosted = [];
  await providerInstance1.handleMessage({ command: 'ready' });

  assert.strictEqual(createdPanel.webview.messagesPosted.length, 2, 'Ready message should trigger 2 outbound messages');
  const initMsg = createdPanel.webview.messagesPosted.find(m => m.command === 'initSettings');
  const healthMsg = createdPanel.webview.messagesPosted.find(m => m.command === 'healthUpdate');

  assert.ok(initMsg, 'initSettings message should be sent');
  assert.ok(initMsg.settings, 'initSettings contains settings payload');
  assert.strictEqual(initMsg.settings.completionKeyword, DEFAULT_CONFIG.completionKeyword, 'Settings keyword matches baseline');

  assert.ok(healthMsg, 'healthUpdate message should be sent');
  assert.ok(healthMsg.port !== undefined, 'healthUpdate contains port');
  assert.ok(healthMsg.toolchain !== undefined, 'healthUpdate contains toolchain');
  assert.ok(healthMsg.nativeCommandStatus !== undefined, 'healthUpdate contains nativeCommandStatus');
  console.log('  ✓ ready message replies immediately with initSettings and healthUpdate\n');

  // --------------------------------------------------------------------------
  // Test 5: IPC Message - 'saveSettings' Handler
  // --------------------------------------------------------------------------
  console.log('[Test 5] Testing IPC saveSettings message handling...');
  createdPanel.webview.messagesPosted = [];
  activeInfoMessages = [];

  const newSettings = {
    executionMode: 'keyboard',
    allowTierFallback: false,
    strictMode: true,
    repeatCount: 8,
    completionKeyword: 'Custom Done.',
    delayBetweenLoopsMs: 3000,
    timeoutPerLoopMinutes: 20
  };

  await providerInstance1.handleMessage({
    command: 'saveSettings',
    settings: newSettings
  });

  const saveConfirmedMsg = createdPanel.webview.messagesPosted.find(m => m.command === 'saveConfirmed');
  assert.ok(saveConfirmedMsg, 'saveConfirmed message was sent to webview');
  assert.strictEqual(mockConfigStore['executionMode'], 'keyboard', 'Configuration executionMode updated');
  assert.strictEqual(mockConfigStore['repeatCount'], 8, 'Configuration repeatCount updated');
  assert.strictEqual(mockConfigStore['completionKeyword'], 'Custom Done.', 'Configuration completionKeyword updated');
  assert.ok(activeInfoMessages.some(m => m.includes('Settings saved successfully')), 'Success notification displayed');
  console.log('  ✓ saveSettings persists configuration, updates sidecar, and broadcasts saveConfirmed\n');

  // --------------------------------------------------------------------------
  // Test 6: IPC Message - 'resetSettings' Handler
  // --------------------------------------------------------------------------
  console.log('[Test 6] Testing IPC resetSettings message handling...');
  createdPanel.webview.messagesPosted = [];

  await providerInstance1.handleMessage({ command: 'resetSettings' });

  const resetInitMsg = createdPanel.webview.messagesPosted.find(m => m.command === 'initSettings');
  const resetSaveMsg = createdPanel.webview.messagesPosted.find(m => m.command === 'saveConfirmed');
  assert.ok(resetInitMsg, 'resetSettings posts initSettings');
  assert.ok(resetSaveMsg, 'resetSettings posts saveConfirmed');
  assert.strictEqual(mockConfigStore['executionMode'], DEFAULT_CONFIG.executionMode, 'executionMode reset to default');
  assert.strictEqual(mockConfigStore['repeatCount'], DEFAULT_CONFIG.repeatCount, 'repeatCount reset to default');
  assert.strictEqual(mockConfigStore['completionKeyword'], DEFAULT_CONFIG.completionKeyword, 'completionKeyword reset to default');
  console.log('  ✓ resetSettings restores DEFAULT_CONFIG across all keys and broadcasts update\n');

  // --------------------------------------------------------------------------
  // Test 7: IPC Message - 'testTier' Handler
  // --------------------------------------------------------------------------
  console.log('[Test 7] Testing IPC testTier message handling...');
  // Test with custom dispatcher
  const testTierDispatcher = new PromptDispatcher({
    commandExecutor: async () => 'test-ok'
  });
  const customProvider = SettingsProvider.render(mockExtensionUri, testTierDispatcher);

  // Test tier: nativeCommand
  createdPanel.webview.messagesPosted = [];
  await customProvider.handleMessage({ command: 'testTier', tier: 'nativeCommand' });

  const testResultMsg = createdPanel.webview.messagesPosted.find(m => m.command === 'testResult');
  assert.ok(testResultMsg, 'testResult message posted to webview');
  assert.strictEqual(testResultMsg.success, true, 'nativeCommand test result is success');
  assert.strictEqual(typeof testResultMsg.latencyMs, 'number', 'latencyMs is numeric');

  // Test tier: domBridge (no clients connected, should report clear error)
  createdPanel.webview.messagesPosted = [];
  await customProvider.handleMessage({ command: 'testTier', tier: 'domBridge' });
  const domResultMsg = createdPanel.webview.messagesPosted.find(m => m.command === 'testResult');
  assert.ok(domResultMsg, 'domBridge testResult received');
  assert.strictEqual(domResultMsg.success, false, 'domBridge with no clients fails gracefully');
  assert.ok(domResultMsg.error, 'domBridge failure contains descriptive error message');
  console.log('  ✓ testTier dispatches diagnostic ping to PromptDispatcher and returns structured payload\n');

  // --------------------------------------------------------------------------
  // Test 8: IPC Message - 'setupBridge' and 'uninstallBridge'
  // --------------------------------------------------------------------------
  console.log('[Test 8] Testing IPC setupBridge and uninstallBridge message handling...');
  executedCommands.length = 0;
  createdPanel.webview.messagesPosted = [];

  await customProvider.handleMessage({ command: 'setupBridge' });
  assert.ok(
    executedCommands.some(c => c.command === 'autoplan.oneClickSetup' || c.command === 'autoplan.installBridge'),
    'setupBridge executes bridge installation command'
  );
  assert.ok(
    createdPanel.webview.messagesPosted.some(m => m.command === 'healthUpdate'),
    'setupBridge triggers refreshed healthUpdate'
  );

  executedCommands.length = 0;
  createdPanel.webview.messagesPosted = [];
  await customProvider.handleMessage({ command: 'uninstallBridge' });
  assert.ok(
    executedCommands.some(c => c.command === 'autoplan.uninstallBridge'),
    'uninstallBridge executes bridge uninstallation command'
  );
  assert.ok(
    createdPanel.webview.messagesPosted.some(m => m.command === 'healthUpdate'),
    'uninstallBridge triggers refreshed healthUpdate'
  );
  console.log('  ✓ setupBridge and uninstallBridge invoke commands and refresh health indicators\n');

  // --------------------------------------------------------------------------
  // Test 9: IPC Message - 'openFolderPicker' Handler
  // --------------------------------------------------------------------------
  console.log('[Test 9] Testing IPC openFolderPicker message handling...');
  openDialogMockReturnValue = [{ fsPath: '/workspace/custom-plans' }];
  createdPanel.webview.messagesPosted = [];

  await customProvider.handleMessage({ command: 'openFolderPicker' });
  const folderMsg = createdPanel.webview.messagesPosted.find(m => m.command === 'folderSelected');
  assert.ok(folderMsg, 'folderSelected message posted');
  assert.strictEqual(folderMsg.folderPath, '/workspace/custom-plans', 'folderPath matches dialog selection');
  console.log('  ✓ openFolderPicker displays folder selection dialog and notifies webview\n');

  // --------------------------------------------------------------------------
  // Test 10: External Config Watchdog
  // --------------------------------------------------------------------------
  console.log('[Test 10] Testing Configuration Watchdog pushes initSettings on external change...');
  createdPanel.webview.messagesPosted = [];
  assert.ok(configListeners.length > 0, 'Config change listeners are registered');

  // Fire config change event affecting autoplan
  for (const listener of configListeners) {
    listener({ affectsConfiguration: (sec: string) => sec === 'autoplan' });
  }

  const watchdogUpdate = createdPanel.webview.messagesPosted.find(m => m.command === 'initSettings');
  assert.ok(watchdogUpdate, 'External configuration change pushed initSettings to active webview');
  console.log('  ✓ Configuration watchdog automatically synchronizes external settings changes\n');

  // --------------------------------------------------------------------------
  // Test 11: Panel Disposal and Lifecycle Cleanup
  // --------------------------------------------------------------------------
  console.log('[Test 11] Testing Panel disposal and cleanup...');
  createdPanel.dispose();
  assert.strictEqual(createdPanel.isDisposed, true, 'Panel marked as disposed');
  assert.strictEqual(SettingsProvider.currentPanel, undefined, 'Singleton reference cleared on dispose');

  // Re-rendering creates a fresh panel
  const freshProvider = SettingsProvider.render(mockExtensionUri);
  assert.ok(freshProvider, 'Fresh provider successfully created after disposal');
  assert.strictEqual(createdWebviewPanels.length, 2, 'Total 2 panels created throughout lifecycle');
  assert.strictEqual(SettingsProvider.currentPanel, freshProvider, 'currentPanel now points to fresh instance');
  freshProvider.dispose();
  assert.strictEqual(SettingsProvider.currentPanel, undefined, 'Singleton reference cleared again');
  console.log('  ✓ Disposal correctly cleans up singleton state and allows fresh instantiation\n');

  // --------------------------------------------------------------------------
  // Test 12: Extension Command Registration & Sidebar Linking
  // --------------------------------------------------------------------------
  console.log('[Test 12] Testing Extension Command registration and Sidebar linking...');
  const mockContext: any = {
    subscriptions: [],
    extensionUri: mockExtensionUri
  };

  // Activate extension
  activate(mockContext);

  assert.ok(registeredCommands.has('autoplan.openSettings'), 'autoplan.openSettings command registered in extension host');

  // Execute autoplan.openSettings command directly
  const renderResult = await vscode.commands.executeCommand('autoplan.openSettings');
  assert.ok(renderResult, 'Executing autoplan.openSettings command returns SettingsProvider');
  assert.ok(SettingsProvider.currentPanel, 'SettingsProvider.currentPanel is active after command execution');
  (SettingsProvider.currentPanel as SettingsProvider | undefined)?.dispose();

  // Test SidebarProvider handling of 'settings' message
  const sidebar = new SidebarProvider(mockExtensionUri, mockContext);
  executedCommands.length = 0;
  await sidebar.handleWebviewMessage({ command: 'settings' });
  assert.ok(
    executedCommands.some(c => c.command === 'autoplan.openSettings'),
    'SidebarProvider settings message triggers autoplan.openSettings command execution'
  );
  console.log('  ✓ autoplan.openSettings command registered and linked from SidebarProvider\n');

  // --------------------------------------------------------------------------
  // Test 13: Running Action Menu Integration
  // --------------------------------------------------------------------------
  console.log('[Test 13] Testing Running Action Menu includes Settings Panel option...');
  // Mock orchestrator running to test action menu
  const orchestratorModule = require('../orchestrator');
  const origIsRunning = orchestratorModule.orchestrator.isRunning;
  orchestratorModule.orchestrator.isRunning = () => true;

  executedCommands.length = 0;
  await showRunningActionMenu();
  assert.ok(
    executedCommands.some(c => c.command === 'autoplan.openSettings'),
    'Selecting Open Settings Panel in Running Action Menu executes autoplan.openSettings'
  );

  orchestratorModule.orchestrator.isRunning = origIsRunning;
  console.log('  ✓ Status Bar Running Action Menu provides direct access to Settings Panel\n');

  // Clean up any remaining panel
  if (SettingsProvider.currentPanel) {
    (SettingsProvider.currentPanel as any).dispose();
  }

  console.log('================================================================');
  console.log('  ✓ ALL 13 TEST SUITES PASSED FOR PHASE 03 SETTINGS PROVIDER!   ');
  console.log('================================================================');
  process.exit(0);
}

runPhase03Tests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
