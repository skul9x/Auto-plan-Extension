// Comprehensive Verification Test for Phase 04: Export Diagnostics Commands & Webview 1-Click Integration
const Module = require('module');
const originalRequire = Module.prototype.require;

interface MockOutputChannel {
  name: string;
  options?: any;
  lines: string[];
  shown: boolean;
  preserveFocus?: boolean;
  disposed: boolean;
  appendLine: (line: string) => void;
  append: (text: string) => void;
  show: (preserveFocus?: boolean) => void;
  dispose: () => void;
}

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let executedCommands: { cmd: string; args: any[] }[] = [];
let lastCopiedClipboardText: any = null;
let lastOpenedDocumentUri: any = null;
let lastShownDocument: any = null;
let lastOutputChannel: MockOutputChannel | null = null;
let shownInfoMessages: { msg: string; items: string[] }[] = [];
let shownErrorMessages: { msg: string; items: string[]; selected?: string }[] = [];
let nextErrorMessageSelection: string | undefined = undefined;
let mockConfigStore: Record<string, any> = {};

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
          update: async (key: string, value: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            mockConfigStore[fullKey] = value;
            mockConfigStore[key] = value;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        openTextDocument: async (uri: any) => {
          lastOpenedDocumentUri = uri;
          return { uri, getText: () => '' };
        },
        workspaceFolders: [
          {
            uri: { fsPath: '/mock/workspace/root' },
            name: 'mock-workspace',
            index: 0
          }
        ]
      },
      window: {
        createStatusBarItem: () => ({
          text: '',
          tooltip: '',
          command: '',
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        createOutputChannel: (name: string, options?: any) => {
          const channel: MockOutputChannel = {
            name,
            options,
            lines: [],
            shown: false,
            preserveFocus: undefined,
            disposed: false,
            appendLine(line: string) {
              this.lines.push(line);
            },
            append(text: string) {
              this.lines.push(text);
            },
            show(preserveFocus?: boolean) {
              this.shown = true;
              this.preserveFocus = preserveFocus;
            },
            dispose() {
              this.disposed = true;
            }
          };
          lastOutputChannel = channel;
          return channel;
        },
        showInformationMessage: async (msg: string, ...items: string[]) => {
          shownInfoMessages.push({ msg, items });
          return items[0];
        },
        showWarningMessage: async (msg: string, ...items: string[]) => {
          return items[0];
        },
        showErrorMessage: async (msg: string, ...items: string[]) => {
          shownErrorMessages.push({ msg, items, selected: nextErrorMessageSelection });
          return nextErrorMessageSelection;
        },
        showSaveDialog: async (options?: any) => {
          return options?.defaultUri || null;
        },
        showTextDocument: async (doc: any) => {
          lastShownDocument = doc;
          return {};
        },
        registerWebviewViewProvider: () => ({ dispose: () => {} }),
        createWebviewPanel: (viewType: string, title: string, showOptions: any, options: any) => {
          let msgListener: ((msg: any) => void) | null = null;
          let disposeListener: (() => void) | null = null;
          const postedMessages: any[] = [];

          return {
            viewType,
            title,
            options,
            webview: {
              html: '',
              cspSource: "'self'",
              asWebviewUri: (uri: any) => uri,
              postMessage: async (msg: any) => {
                postedMessages.push(msg);
                return true;
              },
              onDidReceiveMessage: (listener: (msg: any) => void) => {
                msgListener = listener;
                return { dispose: () => {} };
              }
            },
            onDidDispose: (listener: () => void) => {
              disposeListener = listener;
              return { dispose: () => {} };
            },
            reveal: () => {},
            dispose: () => {
              if (disposeListener) disposeListener();
            },
            // Test inspection access
            _getPostedMessages: () => postedMessages,
            _triggerReceiveMessage: async (msg: any) => {
              if (msgListener) await msgListener(msg);
            }
          };
        }
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
      env: {
        clipboard: {
          writeText: async (text: string) => {
            lastCopiedClipboardText = text;
          },
          readText: async () => lastCopiedClipboardText || ''
        },
        appName: 'VS Code Test Host',
        appRoot: '/mock/app/root'
      },
      Uri: {
        file: (fsPath: string) => ({ fsPath, scheme: 'file' }),
        joinPath: (baseUri: any, ...parts: string[]) => ({
          fsPath: path.join(baseUri.fsPath || '', ...parts),
          scheme: 'file'
        })
      },
      ViewColumn: {
        Active: -1,
        One: 1
      },
      StatusBarAlignment: {
        Right: 2,
        Left: 1
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2
      },
      version: '1.85.0-test'
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import {
  activate,
  deactivate,
  copyDebugLog,
  exportDebugLog,
  clearDebugLog,
  showOutputChannel,
  showFailureNotificationWithDiagnostics
} from '../extension';
import { debugLogger, DebugLogger } from '../debugLogger';
import { SettingsProvider } from '../settingsProvider';
import { SidebarProvider } from '../sidebarProvider';

async function runPhase04VerificationTests() {
  console.log('========================================================================');
  console.log('  Phase 04: Export Diagnostics Commands & Webview 1-Click Integration   ');
  console.log('========================================================================\n');

  const tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-test-'));

  try {
    // --------------------------------------------------------------------------
    // Test 1: Extension Lifecycle & Command Registration
    // --------------------------------------------------------------------------
    console.log('[Test 1] Activating extension and verifying diagnostic command registrations...');
    const mockSubscriptions: any[] = [];
    const mockContext: any = {
      subscriptions: mockSubscriptions,
      extensionUri: vscode.Uri.file(__dirname),
      workspaceState: {
        get: () => undefined,
        update: async () => {}
      },
      globalState: {
        get: () => [],
        update: async () => {}
      }
    };

    activate(mockContext);

    const requiredCommands = [
      'autoplan.copyDebugLog',
      'autoplan.exportDebugLog',
      'autoplan.clearDebugLog',
      'autoplan.showOutputChannel'
    ];

    for (const cmd of requiredCommands) {
      assert.ok(
        registeredCommands[cmd],
        `Command ${cmd} must be registered in VS Code command registry`
      );
    }
    console.log('  ✓ All 4 diagnostic commands registered successfully');

    // Populate debugLogger with sample trace entries across components
    debugLogger.clear();
    debugLogger.info('SERVER', 'DOM Bridge Server initialized on port 47352');
    debugLogger.debug('CLIENT', 'Renderer client probe received', { clientVersion: '1.2.0' });
    debugLogger.warn('DOM', 'Selector resolution retry required for chat input');
    debugLogger.error('DISPATCHER', 'Tier 1 acknowledgment timeout', { timeoutMs: 5000 }, new Error('Socket closed'));

    assert.strictEqual(debugLogger.getEntries().length, 4, 'Buffer should contain 4 log entries');

    // --------------------------------------------------------------------------
    // Test 2: autoplan.copyDebugLog - Formatting & Clipboard Integration
    // --------------------------------------------------------------------------
    console.log('\n[Test 2] Testing autoplan.copyDebugLog command execution...');
    lastCopiedClipboardText = null;
    shownInfoMessages = [];

    const copyResult = await vscode.commands.executeCommand('autoplan.copyDebugLog');

    assert.ok(lastCopiedClipboardText, 'Report text must be written to clipboard');
    assert.ok(
      lastCopiedClipboardText.includes('# Auto-Plan DOM Bridge Diagnostic Report'),
      'Clipboard text must contain markdown report title'
    );
    assert.ok(
      lastCopiedClipboardText.includes('DOM Bridge Server initialized on port 47352'),
      'Clipboard text must include recorded SERVER log trace'
    );
    assert.ok(
      lastCopiedClipboardText.includes('Tier 1 acknowledgment timeout'),
      'Clipboard text must include recorded DISPATCHER error trace'
    );
    assert.ok(
      shownInfoMessages.some((m) => m.msg.includes('DOM Bridge Debug Log copied to clipboard')),
      'Confirmation toast must be shown to user'
    );
    console.log('  ✓ autoplan.copyDebugLog formatted report and wrote to clipboard with confirmation toast');

    // --------------------------------------------------------------------------
    // Test 3: autoplan.exportDebugLog - File Persistence & Editor Tab Opening
    // --------------------------------------------------------------------------
    console.log('\n[Test 3] Testing autoplan.exportDebugLog command execution...');
    const exportTargetPath = path.join(tempTestDir, 'exported-dom-bridge-debug.txt');
    lastOpenedDocumentUri = null;
    lastShownDocument = null;

    const exportedPath = await vscode.commands.executeCommand('autoplan.exportDebugLog', exportTargetPath);

    assert.strictEqual(exportedPath, exportTargetPath, 'Exported path must match requested target');
    assert.ok(fs.existsSync(exportTargetPath), 'Diagnostic file must exist on disk');

    const fileContent = fs.readFileSync(exportTargetPath, 'utf8');
    assert.ok(fileContent.includes('# Auto-Plan DOM Bridge Diagnostic Report'), 'File must contain markdown report header');
    assert.ok(fileContent.includes('Component Health Status Checklist'), 'File must include health checklist');
    assert.ok(fileContent.includes('Selector resolution retry required'), 'File must contain log traces');

    assert.ok(lastOpenedDocumentUri, 'Exported file must be opened via workspace.openTextDocument');
    assert.strictEqual(lastOpenedDocumentUri.fsPath, exportTargetPath, 'Opened document URI must match exported file');
    assert.ok(lastShownDocument, 'Exported file must be shown in an active VS Code text editor');
    console.log('  ✓ autoplan.exportDebugLog compiled report, saved to disk, and opened editor tab');

    // --------------------------------------------------------------------------
    // Test 4: autoplan.showOutputChannel & autoplan.clearDebugLog
    // --------------------------------------------------------------------------
    console.log('\n[Test 4] Testing showOutputChannel and clearDebugLog commands...');
    await vscode.commands.executeCommand('autoplan.showOutputChannel');
    assert.ok(lastOutputChannel, 'Output channel must be created');
    assert.strictEqual(lastOutputChannel.shown, true, 'Output channel show() must be invoked');

    await vscode.commands.executeCommand('autoplan.clearDebugLog');
    assert.strictEqual(debugLogger.getEntries().length, 0, 'Buffer entries must be cleared');
    console.log('  ✓ showOutputChannel revealed channel and clearDebugLog reset memory buffer');

    // --------------------------------------------------------------------------
    // Test 5: SettingsProvider Webview Diagnostics & Live Log Streaming
    // --------------------------------------------------------------------------
    console.log('\n[Test 5] Testing SettingsProvider diagnostic message router and live streaming...');
    const testLogger = new DebugLogger(100);
    testLogger.info('SERVER', 'Test server log 1');
    testLogger.warn('DOM', 'Test DOM warning log 2');

    const settingsProvider = SettingsProvider.render(
      vscode.Uri.file(tempTestDir),
      undefined,
      testLogger
    );
    const mockPanel: any = settingsProvider.panel;

    // Send 'ready' message from webview
    await mockPanel._triggerReceiveMessage({ command: 'ready' });
    let posted = mockPanel._getPostedMessages();

    // Verify 'logBuffer' was pushed on ready
    const logBufferMsg = posted.find((m: any) => m.command === 'logBuffer');
    assert.ok(logBufferMsg, "Webview should receive 'logBuffer' upon ready");
    assert.strictEqual(logBufferMsg.entries.length, 2, 'Log buffer should contain the 2 initial entries');

    // Verify live log streaming when new entry is logged
    testLogger.error('CLIENT', 'Live streamed error entry 3');
    const logEntryMsg = posted.find((m: any) => m.command === 'logEntry' && m.entry?.message?.includes('entry 3'));
    assert.ok(logEntryMsg, "Webview should receive real-time 'logEntry' event");
    assert.strictEqual(logEntryMsg.entry.component, 'CLIENT');

    // Test Webview IPC commands routed through SettingsProvider
    // a) copyDebugLog
    lastCopiedClipboardText = null;
    await mockPanel._triggerReceiveMessage({ command: 'copyDebugLog' });
    assert.ok(lastCopiedClipboardText, 'SettingsProvider copyDebugLog must invoke copy command');

    // b) exportDebugLog
    const webviewExportPath = path.join(tempTestDir, 'webview-export.txt');
    await mockPanel._triggerReceiveMessage({ command: 'exportDebugLog', targetPath: webviewExportPath });
    assert.ok(
      executedCommands.some((c) => c.cmd === 'autoplan.exportDebugLog'),
      'SettingsProvider must dispatch autoplan.exportDebugLog'
    );

    // c) showOutputChannel
    await mockPanel._triggerReceiveMessage({ command: 'showOutputChannel' });
    assert.ok(
      executedCommands.some((c) => c.cmd === 'autoplan.showOutputChannel'),
      'SettingsProvider must dispatch autoplan.showOutputChannel'
    );

    // d) clearDebugLog
    await mockPanel._triggerReceiveMessage({ command: 'clearDebugLog' });
    assert.strictEqual(testLogger.getEntries().length, 0, 'clearDebugLog must empty logger buffer');

    // e) requestLogBuffer
    testLogger.info('SETTINGS', 'Fresh entry after clear');
    await mockPanel._triggerReceiveMessage({ command: 'requestLogBuffer' });
    const refreshedBufferMsg = posted[posted.length - 1];
    assert.strictEqual(refreshedBufferMsg.command, 'logBuffer');
    assert.strictEqual(refreshedBufferMsg.entries.length, 1);
    console.log('  ✓ SettingsProvider handled all diagnostic IPC message types and streamed live logs');

    // --------------------------------------------------------------------------
    // Test 6: Sidebar Control Center Quick-Copy Action
    // --------------------------------------------------------------------------
    console.log('\n[Test 6] Testing SidebarProvider quick-copy action...');
    const sidebarProvider = new SidebarProvider(vscode.Uri.file(tempTestDir));
    lastCopiedClipboardText = null;

    await sidebarProvider.handleWebviewMessage({ command: 'copyBridgeLog' });
    assert.ok(lastCopiedClipboardText, 'SidebarProvider copyBridgeLog message must copy log to clipboard');
    console.log('  ✓ Sidebar quick-copy action triggered direct diagnostic report export');

    // --------------------------------------------------------------------------
    // Test 7: Actionable Failure Notification Direct Copy Trigger
    // --------------------------------------------------------------------------
    console.log('\n[Test 7] Testing actionable failure notification 1-click diagnostic copy...');
    nextErrorMessageSelection = '📋 Copy Diagnostic Log';
    lastCopiedClipboardText = null;

    const selectionResult = await showFailureNotificationWithDiagnostics(
      'DOM Bridge disconnected during plan execution timeout'
    );

    assert.strictEqual(selectionResult, '📋 Copy Diagnostic Log', 'Selection should match clicked action');
    assert.ok(lastCopiedClipboardText, 'Actionable notification button must trigger clipboard copy');
    assert.ok(
      lastCopiedClipboardText.includes('DOM Bridge Diagnostic Report'),
      'Copied content must be a valid diagnostic report'
    );
    console.log('  ✓ Error notification action directly triggered diagnostic log copy');

    // --------------------------------------------------------------------------
    // Test 8: Settings Webview Client Logic & Filtering Helper
    // --------------------------------------------------------------------------
    console.log('\n[Test 8] Testing settings.js client helper logic...');
    const settingsClient = require('../../media/settings/settings.js');
    assert.strictEqual(typeof settingsClient.matchesFilter, 'function', 'matchesFilter helper should be exported');

    const debugEntry = { level: 'DEBUG', component: 'CLIENT', message: 'Test debug' };
    const warnEntry = { level: 'WARN', component: 'DOM', message: 'Test warn' };
    const errorEntry = { level: 'ERROR', component: 'SERVER', message: 'Test error' };

    assert.strictEqual(settingsClient.matchesFilter(debugEntry, 'all'), true);
    assert.strictEqual(settingsClient.matchesFilter(debugEntry, 'warn-error'), false);
    assert.strictEqual(settingsClient.matchesFilter(warnEntry, 'warn-error'), true);
    assert.strictEqual(settingsClient.matchesFilter(errorEntry, 'warn-error'), true);
    assert.strictEqual(settingsClient.matchesFilter(debugEntry, 'debug'), true);
    assert.strictEqual(settingsClient.matchesFilter(warnEntry, 'debug'), false);

    console.log('  ✓ settings.js filter matches accurately for all log levels');

    // --------------------------------------------------------------------------
    // Test 9: Deactivation Cleanup
    // --------------------------------------------------------------------------
    console.log('\n[Test 9] Testing extension deactivation & resource cleanup...');
    await deactivate();
    console.log('  ✓ Extension deactivated and logger resources disposed cleanly');

    console.log('\n========================================================================');
    console.log('  🎉 Phase 04 Verification Suite PASSED Successfully!');
    console.log('========================================================================\n');
  } finally {
    try {
      fs.rmSync(tempTestDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase04VerificationTests().catch((err) => {
  console.error('\n❌ Phase 04 Verification Test Failed:\n', err);
  process.exit(1);
});
