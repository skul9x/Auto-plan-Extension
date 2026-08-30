// Standalone test runner with comprehensive mock for 'vscode' module
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let shownInfoMessages: string[] = [];
let shownErrorMessages: string[] = [];
let shownWarningMessages: string[] = [];
let mockStatusBarItem: any = null;

const mockWorkspaceStateStore: { [key: string]: any } = {};
const mockGlobalStateStore: { [key: string]: any } = {};

const mockContext: any = {
  subscriptions: [],
  workspaceState: {
    get: (key: string, defaultVal?: any) =>
      mockWorkspaceStateStore[key] !== undefined ? mockWorkspaceStateStore[key] : defaultVal,
    update: async (key: string, val: any) => {
      mockWorkspaceStateStore[key] = val;
    }
  },
  globalState: {
    get: (key: string, defaultVal?: any) =>
      mockGlobalStateStore[key] !== undefined ? mockGlobalStateStore[key] : defaultVal,
    update: async (key: string, val: any) => {
      mockGlobalStateStore[key] = val;
    }
  }
};

class MockThemeIcon {
  constructor(public id: string) {}
}

const MockQuickInputButtons = {
  Back: { iconPath: new MockThemeIcon('arrow-left'), tooltip: 'Back' }
};

class MockMarkdownString {
  public value: string;
  public isTrusted: boolean = false;
  constructor(value: string) {
    this.value = value;
  }
}

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      ThemeIcon: MockThemeIcon,
      QuickInputButtons: MockQuickInputButtons,
      MarkdownString: MockMarkdownString,
      StatusBarAlignment: { Left: 1, Right: 2 },
      workspace: {
        workspaceFolders: [],
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        }),
        onDidChangeConfiguration: (_cb: any) => ({
          dispose: () => {}
        })
      },
      window: {
        activeTextEditor: undefined,
        createStatusBarItem: (_arg1: any, _arg2?: any, _arg3?: any) => {
          mockStatusBarItem = {
            text: '',
            tooltip: '',
            command: undefined,
            visible: false,
            show() { this.visible = true; },
            hide() { this.visible = false; },
            dispose() {}
          };
          return mockStatusBarItem;
        },
        createQuickPick: () => ({
          title: '',
          placeholder: '',
          items: [],
          selectedItems: [],
          buttons: [],
          visible: false,
          show() { this.visible = true; },
          hide() { this.visible = false; },
          dispose() {},
          onDidAccept: () => ({ dispose: () => {} }),
          onDidTriggerButton: () => ({ dispose: () => {} }),
          onDidTriggerItemButton: () => ({ dispose: () => {} }),
          onDidHide: () => ({ dispose: () => {} })
        }),
        showInformationMessage: async (msg: string, ..._items: any[]) => {
          shownInfoMessages.push(msg);
          return undefined;
        },
        showWarningMessage: async (msg: string, ..._items: any[]) => {
          shownWarningMessages.push(msg);
          return undefined;
        },
        showErrorMessage: async (msg: string, ..._items: any[]) => {
          shownErrorMessages.push(msg);
          return undefined;
        }
      },
      commands: {
        registerCommand: (cmd: string, handler: (...args: any[]) => any) => {
          registeredCommands[cmd] = handler;
          return { dispose: () => { delete registeredCommands[cmd]; } };
        },
        executeCommand: async (_cmd: string, ..._args: any[]) => {}
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import {
  scanPlanFolder,
  scanPlanFolderAsync,
  auditPlanPhases,
  auditPlanPhasesAsync,
  PhaseFile
} from '../planScanner';
import { Orchestrator, PhaseItem, OrchestratorProgressInfo } from '../orchestrator';
import {
  findActivePlanFolderAsync,
  discoverWorkspacePlanFoldersAsync,
  selectPlanFolder
} from '../extension';

async function runPhase02AsyncScannerTests() {
  console.log('=== Running Phase 02: Async Plan Scanning Orchestrator Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase02-async-scan-'));

  try {
    // ----------------------------------------------------------------------
    // Setup: Create test phase files with various completion statuses
    // ----------------------------------------------------------------------
    const file1 = path.join(tempDir, 'phase-01-core-setup.md');
    const file2 = path.join(tempDir, 'phase-02-api-services.md');
    const file3 = path.join(tempDir, 'phase-03-ui-components.md');

    fs.writeFileSync(
      file1,
      '# Phase 01: Core Setup\n\nStatus: ✅ Completed\nDependencies: None\n\nContent here.\n'
    );
    fs.writeFileSync(
      file2,
      '# Phase 02: API Services\n\nStatus: ⬜ Pending\nDependencies: Phase 01\n\nContent here.\n'
    );
    fs.writeFileSync(
      file3,
      '# Phase 03: UI Components\n\nStatus: ⬜ Pending\nDependencies: Phase 02\n\nContent here.\n'
    );

    // Also create a non-phase artifact to verify exclusion
    fs.writeFileSync(
      path.join(tempDir, 'plan.md'),
      '# Overall Master Plan\nOverview details\n'
    );

    // ----------------------------------------------------------------------
    // Test 1: scanPlanFolderAsync parity with synchronous scanPlanFolder
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying scanPlanFolderAsync returns exact metadata matching scanPlanFolder...');
    const syncPhases = scanPlanFolder(tempDir);
    const asyncPhases = await scanPlanFolderAsync(tempDir);

    assert.strictEqual(asyncPhases.length, 3, 'Async scan must find exactly 3 phase files');
    assert.strictEqual(syncPhases.length, asyncPhases.length, 'Sync and Async scans must return identical count');

    for (let i = 0; i < syncPhases.length; i++) {
      const s = syncPhases[i];
      const a = asyncPhases[i];
      assert.strictEqual(a.fileName, s.fileName, `Phase ${i} fileName mismatch`);
      assert.strictEqual(a.index, s.index, `Phase ${i} index mismatch`);
      assert.strictEqual(a.status, s.status, `Phase ${i} status mismatch`);
      assert.strictEqual(a.isCompleted, s.isCompleted, `Phase ${i} isCompleted mismatch`);
      assert.strictEqual(a.normalizedPath, s.normalizedPath, `Phase ${i} normalizedPath mismatch`);
    }

    assert.strictEqual(asyncPhases[0].isCompleted, true, 'Phase 1 should be marked completed');
    assert.strictEqual(asyncPhases[1].isCompleted, false, 'Phase 2 should be marked pending');
    assert.strictEqual(asyncPhases[2].isCompleted, false, 'Phase 3 should be marked pending');
    console.log('-> scanPlanFolderAsync parity validated successfully.');

    // ----------------------------------------------------------------------
    // Test 2: Orchestrator.startPlanFolder async resolution and execution
    // ----------------------------------------------------------------------
    console.log('[Test 2] Verifying Orchestrator.startPlanFolder resolves asynchronously...');

    const dispatchedPrompts: string[] = [];
    const mockDispatcher: any = {
      validateDispatchReadiness: () => ({ ready: true, transport: 'dom-bridge' }),
      dispatchPrompt: async (promptText: string) => {
        dispatchedPrompts.push(promptText);
        return {
          success: true,
          transport: 'dom-bridge',
          durationMs: 50,
          windowKey: 'test-win'
        };
      }
    };

    let watchIteration = 0;
    const mockTranscriptWatcher: any = Object.assign(new EventEmitter(), {
      getOptions: () => ({ brainDir: 'C:/mock/brain', pollIntervalMs: 10 }),
      waitForNewConversation: async () => `conv-${++watchIteration}`,
      watchFile: async (_path: string, convId: string) => ({
        success: true,
        conversationId: convId,
        completionTimeMs: 50
      }),
      watchLatest: async () => ({
        success: true,
        conversationId: `conv-${watchIteration}`,
        completionTimeMs: 50
      }),
      stop: () => {}
    });

    const progressStates: string[] = [];
    const orchestrator = new Orchestrator({
      promptDispatcher: mockDispatcher,
      transcriptWatcher: mockTranscriptWatcher,
      configProvider: () => ({
        promptText: 'Execute: {phaseFilePath}',
        promptTemplate: 'Execute: {phaseFilePath}',
        repeatCount: 1,
        completionKeyword: 'DONE',
        delayBetweenLoopsMs: 10,
        timeoutPerLoopMinutes: 1,
        executionMode: 'domBridge'
      }),
      onStateChange: (info: OrchestratorProgressInfo) => {
        progressStates.push(info.state);
      }
    });

    const runPromise = orchestrator.startPlanFolder(tempDir);
    assert.strictEqual(orchestrator.isRunning(), true, 'Orchestrator should be running immediately');

    const result = await runPromise;
    assert.strictEqual(result, true, 'startPlanFolder should resolve to true on completion');

    const phases = orchestrator.getPhases();
    assert.strictEqual(phases.length, 3, 'Orchestrator should have indexed all 3 phases');
    assert.strictEqual(phases[0].fileName, 'phase-01-core-setup.md');
    assert.strictEqual(phases[1].fileName, 'phase-02-api-services.md');
    assert.strictEqual(phases[2].fileName, 'phase-03-ui-components.md');

    assert.strictEqual(dispatchedPrompts.length, 3, 'All 3 phases should have been dispatched');
    assert.ok(progressStates.includes('scanning'), 'State transitions should include scanning');
    assert.ok(progressStates.includes('running') || progressStates.includes('sending'), 'State transitions should include running/sending');
    console.log('-> Orchestrator.startPlanFolder executed successfully.');

    // ----------------------------------------------------------------------
    // Test 3: Error propagation on non-existent directory
    // ----------------------------------------------------------------------
    console.log('[Test 3] Verifying clean error propagation on non-existent folder...');
    const nonExistentDir = path.join(tempDir, 'does-not-exist');
    let caughtErr: Error | null = null;
    try {
      await orchestrator.startPlanFolder(nonExistentDir);
    } catch (err: any) {
      caughtErr = err;
    }
    assert.ok(caughtErr !== null, 'Should throw error when plan directory does not exist');
    assert.ok(caughtErr!.message.includes('does not exist'), 'Error message should indicate missing directory');
    console.log('-> Error propagation validated successfully.');

    // ----------------------------------------------------------------------
    // Test 4: auditPlanPhasesAsync parity
    // ----------------------------------------------------------------------
    console.log('[Test 4] Verifying auditPlanPhasesAsync parity...');
    const syncAudit = auditPlanPhases(tempDir);
    const asyncAudit = await auditPlanPhasesAsync(tempDir);

    assert.strictEqual(asyncAudit.totalPhases, 3);
    assert.strictEqual(asyncAudit.completedCount, 1);
    assert.strictEqual(asyncAudit.pendingCount, 2);
    assert.strictEqual(asyncAudit.failedCount, 0);
    assert.strictEqual(asyncAudit.totalPhases, syncAudit.totalPhases);
    assert.strictEqual(asyncAudit.completedCount, syncAudit.completedCount);
    console.log('-> auditPlanPhasesAsync validated successfully.');

    // ----------------------------------------------------------------------
    // Test 5: Extension helper exports check
    // ----------------------------------------------------------------------
    console.log('[Test 5] Verifying findActivePlanFolderAsync and selectPlanFolder exports...');
    assert.strictEqual(typeof findActivePlanFolderAsync, 'function', 'findActivePlanFolderAsync must be exported');
    assert.strictEqual(typeof discoverWorkspacePlanFoldersAsync, 'function', 'discoverWorkspacePlanFoldersAsync must be exported');
    assert.strictEqual(typeof selectPlanFolder, 'function', 'selectPlanFolder must be exported');
    console.log('-> Extension async functions validated successfully.');

    console.log('\n✅ All Phase 02 Async Plan Scanning Orchestrator tests passed successfully!');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase02AsyncScannerTests().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
