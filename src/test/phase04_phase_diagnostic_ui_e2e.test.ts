// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

const shownErrorMessages: Array<{ message: string; items: string[] }> = [];
const executedCommands: string[] = [];
let clipboardText = '';

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [{ uri: { fsPath: os.tmpdir() } }],
        getConfiguration: () => ({
          get: (_k: string, defaultValue: any) => defaultValue,
          update: async () => {}
        }),
        openTextDocument: async () => ({})
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      window: {
        createOutputChannel: (name: string) => ({
          name,
          appendLine: () => {},
          show: () => {},
          dispose: () => {}
        }),
        createWebviewPanel: (viewType: string, title: string, showOptions: any, options: any) => ({
          viewType,
          title,
          webview: {
            html: '',
            postMessage: async () => true,
            onDidReceiveMessage: () => ({ dispose: () => {} }),
            asWebviewUri: (uri: any) => uri
          },
          reveal: () => {},
          dispose: () => {},
          onDidDispose: () => ({ dispose: () => {} })
        }),
        showErrorMessage: async (msg: string, ...items: string[]) => {
          shownErrorMessages.push({ message: msg, items });
          return items[0];
        },
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showTextDocument: async () => undefined,
        showSaveDialog: async () => undefined,
        activeTextEditor: undefined
      },
      commands: {
        executeCommand: async (cmd: string, ...args: any[]) => {
          executedCommands.push(cmd);
          return undefined;
        }
      },
      env: {
        clipboard: {
          writeText: async (text: string) => {
            clipboardText = text;
          }
        },
        appName: 'VS Code'
      },
      Uri: {
        file: (f: string) => ({ fsPath: f, scheme: 'file' }),
        joinPath: (base: any, ...segments: string[]) => ({
          fsPath: path.join(base.fsPath || base.path || '', ...segments),
          toString: () => path.join(base.fsPath || base.path || '', ...segments)
        })
      },
      ViewColumn: {
        Active: 1
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SidebarProvider } from '../sidebarProvider';
import { SettingsProvider } from '../settingsProvider';
import {
  copyDebugLog,
  exportDebugLog,
  showFailureNotificationWithDiagnostics,
  setCurrentPlanFolder
} from '../extension';
import { orchestrator } from '../orchestrator';
import { debugLogger } from '../debugLogger';
import { auditPlanPhases } from '../planScanner';

async function runTests() {
  console.log('=== Starting Phase 04: UI Webview Diagnostics & Actionable Commands E2E Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-test-'));

  try {
    // Scaffold test plan folder with multiple phases
    const planFolder = path.join(tempDir, '260830-test-plan');
    fs.mkdirSync(planFolder, { recursive: true });

    fs.writeFileSync(
      path.join(planFolder, 'phase-01-scaffold.md'),
      '# Phase 01: Scaffold\n\nStatus: ✅ Completed\n'
    );
    fs.writeFileSync(
      path.join(planFolder, 'phase-02-core.md'),
      '# Phase 02: Core\n\nStatus: ⬜ Pending\n'
    );
    fs.writeFileSync(
      path.join(planFolder, 'phase-03-api.md'),
      '# Phase 03: API\n\nStatus: ⬜ Pending\n'
    );

    setCurrentPlanFolder(planFolder);

    // =========================================================================
    // Test 1: SidebarProvider Webview State & Stall Reason Telemetry
    // =========================================================================
    console.log('Test 1: SidebarProvider Webview State & Stall Reason Telemetry');

    let postedMessages: any[] = [];
    const mockWebview: any = {
      options: {},
      html: '',
      postMessage: async (msg: any) => {
        postedMessages.push(msg);
      },
      onDidReceiveMessage: () => ({ dispose: () => {} }),
      asWebviewUri: (uri: any) => uri
    };

    const mockWebviewView: any = {
      webview: mockWebview
    };

    const extUri = { fsPath: path.resolve(__dirname, '../../'), scheme: 'file' } as any;
    const sidebar = new SidebarProvider(extUri);
    sidebar.resolveWebviewView(mockWebviewView, {} as any, {} as any);

    await sidebar.refreshAndSendState();

    const stateUpdate = postedMessages.find((m) => m.command === 'stateUpdate' || m.type === 'stateUpdate');
    assert.ok(stateUpdate, 'SidebarProvider must post stateUpdate message');
    assert.strictEqual(stateUpdate.activePlanPath, planFolder, 'State update must reference active plan folder');
    assert.strictEqual(stateUpdate.phases.length, 3, 'State update must include all 3 phases');

    // Phase 1 is completed -> stallReason is undefined
    assert.strictEqual(stateUpdate.phases[0].status, 'Completed');
    assert.strictEqual(stateUpdate.phases[0].stallReason, undefined);

    // Phase 2 is pending and idle -> has stallReason
    assert.strictEqual(stateUpdate.phases[1].status, 'Pending');
    assert.ok(stateUpdate.phases[1].stallReason, 'Pending Phase 2 must contain stallReason');
    assert.strictEqual(
      stateUpdate.phases[1].stallReason.code,
      'ORCHESTRATOR_NOT_RUNNING',
      'Pending phase 2 stall code should be ORCHESTRATOR_NOT_RUNNING when idle'
    );

    // Phase 3 is waiting for Phase 2 -> WAITING_FOR_PREVIOUS_PHASE
    assert.strictEqual(stateUpdate.phases[2].status, 'Pending');
    assert.ok(stateUpdate.phases[2].stallReason, 'Pending Phase 3 must contain stallReason');
    assert.strictEqual(
      stateUpdate.phases[2].stallReason.code,
      'WAITING_FOR_PREVIOUS_PHASE',
      'Phase 3 must be waiting for Phase 2'
    );

    console.log('  ✓ SidebarProvider Webview State & Stall Reason Telemetry passed.\n');

    // =========================================================================
    // Test 2: SettingsProvider Plan Diagnostics Telemetry & Webview IPC
    // =========================================================================
    console.log('Test 2: SettingsProvider Plan Diagnostics Telemetry & Webview IPC');

    let settingsPosted: any[] = [];
    const mockSettingsPanel: any = {
      webview: {
        html: '',
        postMessage: async (msg: any) => {
          settingsPosted.push(msg);
        },
        onDidReceiveMessage: () => ({ dispose: () => {} }),
        asWebviewUri: (uri: any) => uri
      },
      reveal: () => {},
      dispose: () => {},
      onDidDispose: () => ({ dispose: () => {} })
    };

    (SettingsProvider as any).currentPanel = undefined;
    const settingsProvider = SettingsProvider.render(extUri);
    (settingsProvider as any)._panel = mockSettingsPanel;

    settingsPosted = [];
    await settingsProvider.handleMessage({ command: 'ready' });

    const phaseDiagMsg = settingsPosted.find(
      (m) => m.command === 'phaseDiagnostics' || m.type === 'phaseDiagnostics'
    );
    assert.ok(phaseDiagMsg, 'SettingsProvider must post phaseDiagnostics on ready');
    assert.ok(phaseDiagMsg.planPhases, 'Message must contain planPhases audit');
    assert.strictEqual(phaseDiagMsg.planPhases.totalPhases, 3);
    assert.strictEqual(phaseDiagMsg.planPhases.completedCount, 1);
    assert.strictEqual(phaseDiagMsg.planPhases.pendingCount, 2);

    // Test settings.js updatePhaseDiagnostics helper logic
    const settingsJs = require('../../media/settings/settings.js');
    assert.ok(typeof settingsJs.updatePhaseDiagnostics === 'function', 'settings.js must export updatePhaseDiagnostics');

    console.log('  ✓ SettingsProvider Plan Diagnostics Telemetry passed.\n');

    // =========================================================================
    // Test 3: Commands `autoplan.copyDebugLog` and `autoplan.exportDebugLog`
    // =========================================================================
    console.log('Test 3: Commands copyDebugLog & exportDebugLog with Phase Telemetry');

    clipboardText = '';
    const copiedLog = await copyDebugLog();
    assert.ok(copiedLog.includes('## 2. Phase Execution & Stall Diagnostics'), 'Report must contain Section 2');
    assert.ok(copiedLog.includes('phase-01-scaffold.md'), 'Report must list phase-01-scaffold.md');
    assert.ok(copiedLog.includes('phase-02-core.md'), 'Report must list phase-02-core.md');
    assert.ok(copiedLog.includes('✅ Completed'), 'Report must show Completed status for phase 1');
    assert.ok(copiedLog.includes('⏳ Pending'), 'Report must show Pending status for phase 2');
    assert.strictEqual(clipboardText, copiedLog, 'Clipboard must receive full report text');

    const exportFilePath = path.join(tempDir, 'exported-diagnostics.txt');
    const returnedPath = await exportDebugLog(exportFilePath);
    assert.strictEqual(returnedPath, exportFilePath);
    assert.ok(fs.existsSync(exportFilePath), 'Exported file must exist on disk');
    const exportedContent = fs.readFileSync(exportFilePath, 'utf8');
    assert.ok(exportedContent.includes('## 2. Phase Execution & Stall Diagnostics'), 'Export file must contain Phase Diagnostics section');

    console.log('  ✓ Commands copyDebugLog & exportDebugLog passed.\n');

    // =========================================================================
    // Test 4: Actionable Failure Notifications & Retry Options
    // =========================================================================
    console.log('Test 4: Actionable Failure Notifications & Retry Options');

    shownErrorMessages.length = 0;
    executedCommands.length = 0;

    await showFailureNotificationWithDiagnostics('Test phase failure in phase 2', 1);
    assert.strictEqual(shownErrorMessages.length, 1);
    assert.strictEqual(shownErrorMessages[0].message, 'Auto-Plan Error: Test phase failure in phase 2');
    assert.ok(shownErrorMessages[0].items.includes('📋 Copy Diagnostic Log'), 'Must offer Copy Diagnostic Log');
    assert.ok(shownErrorMessages[0].items.includes('⚙️ Open Settings'), 'Must offer Open Settings');

    console.log('  ✓ Actionable Failure Notifications passed.\n');

    // =========================================================================
    // Test 5: Documentation Verification in README.md
    // =========================================================================
    console.log('Test 5: Documentation Verification in README.md');

    const readmePath = path.join(extUri.fsPath, 'README.md');
    assert.ok(fs.existsSync(readmePath), 'README.md must exist');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');

    assert.ok(
      readmeContent.includes('Phase Diagnostics & Stall Analyzer') ||
        readmeContent.includes('Chẩn đoán Phase & Bộ phân tích Tắc nghẽn'),
      'README.md must document Phase Diagnostics & Stall Analyzer'
    );
    assert.ok(
      readmeContent.includes('autoplan.copyDebugLog'),
      'README.md must document autoplan.copyDebugLog command'
    );
    assert.ok(
      readmeContent.includes('autoplan.exportDebugLog'),
      'README.md must document autoplan.exportDebugLog command'
    );
    assert.ok(
      readmeContent.includes('Stall Root-Cause Analysis') ||
        readmeContent.includes('nguyên nhân tắc nghẽn'),
      'README.md must document stall root causes'
    );

    console.log('  ✓ Documentation Verification in README.md passed.\n');

    console.log('🎉 All Phase 04 Tests Passed Successfully!');
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
