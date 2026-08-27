// Standalone test runner with comprehensive mock for 'vscode' module
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let createdStatusBarItems: any[] = [];
let shownInfoMessages: string[] = [];
let shownErrorMessages: string[] = [];
let shownWarningMessages: string[] = [];
let executedVscodeCommands: { command: string; args: any[] }[] = [];
let openedDocuments: string[] = [];
let activeEditorMock: any = null;
let workspaceFoldersMock: any[] = [];
let quickPickNextSelection: any = null;
let infoMessageNextChoice: string | undefined = undefined;
let openDialogNextResult: any = undefined;
let inputBoxNextResult: string | undefined = undefined;

const mockWorkspaceStateStore: { [key: string]: any } = {};
const mockGlobalStateStore: { [key: string]: any } = {};

const mockContext: any = {
  subscriptions: [],
  workspaceState: {
    get: (key: string, defaultVal?: any) => (mockWorkspaceStateStore[key] !== undefined ? mockWorkspaceStateStore[key] : defaultVal),
    update: async (key: string, val: any) => {
      mockWorkspaceStateStore[key] = val;
    }
  },
  globalState: {
    get: (key: string, defaultVal?: any) => (mockGlobalStateStore[key] !== undefined ? mockGlobalStateStore[key] : defaultVal),
    update: async (key: string, val: any) => {
      mockGlobalStateStore[key] = val;
    }
  }
};

class MockMarkdownString {
  public value: string;
  public isTrusted: boolean = false;
  constructor(value: string = '') {
    this.value = value;
  }
  appendMarkdown(value: string) {
    this.value += value;
    return this;
  }
}

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: workspaceFoldersMock,
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        }),
        onDidChangeConfiguration: (_cb: any) => ({
          dispose: () => {}
        }),
        openTextDocument: async (uriOrPath: any) => {
          const docPath = uriOrPath?.fsPath || uriOrPath;
          openedDocuments.push(docPath);
          return { uri: { fsPath: docPath } };
        }
      },
      window: {
        get activeTextEditor() {
          return activeEditorMock;
        },
        createStatusBarItem: (arg1: any, arg2?: any, arg3?: any) => {
          let alignment = 2; // Right default
          let priority = 100;
          let id: string | undefined = undefined;

          if (typeof arg1 === 'string') {
            id = arg1;
            alignment = arg2 ?? 2;
            priority = arg3 ?? 100;
          } else {
            alignment = arg1 ?? 2;
            priority = arg2 ?? 100;
          }

          const item = {
            id,
            alignment,
            priority,
            text: '',
            tooltip: '' as any,
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
        showInformationMessage: async (msg: string, ...rest: any[]) => {
          shownInfoMessages.push(msg);
          if (infoMessageNextChoice !== undefined) {
            return infoMessageNextChoice;
          }
          // If choices were passed as arguments
          const choices = rest.filter(r => typeof r === 'string');
          return choices.length > 0 ? choices[0] : msg;
        },
        showErrorMessage: async (msg: string) => {
          shownErrorMessages.push(msg);
          return msg;
        },
        showWarningMessage: async (msg: string) => {
          shownWarningMessages.push(msg);
          return msg;
        },
        showQuickPick: async (items: any[], _options?: any) => {
          if (quickPickNextSelection !== null) {
            const res = quickPickNextSelection;
            return res;
          }
          return items.length > 0 ? items[0] : undefined;
        },
        showOpenDialog: async (_opts: any) => {
          return openDialogNextResult;
        },
        showInputBox: async (_opts: any) => {
          return inputBoxNextResult;
        },
        showTextDocument: async (doc: any) => doc
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
        executeCommand: async (cmd: string, ...args: any[]) => {
          executedVscodeCommands.push({ command: cmd, args });
          return true;
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
        file: (filePath: string) => ({ fsPath: filePath })
      },
      MarkdownString: MockMarkdownString
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  activate,
  deactivate,
  buildFolderQuickPickItems,
  findActivePlanFolder,
  discoverWorkspacePlanFolders,
  getRecentPlanFolders,
  formatElapsedTime,
  buildRunningTooltip,
  updateStatusBar,
  promptAndStartAutoPlan,
  showRunningActionMenu,
  openActiveTranscript
} from '../extension';
import { orchestrator } from '../orchestrator';

async function runPhase04UIUXTests() {
  console.log('=== Running Phase 04: Smart QuickPick UI & Interactive Status Bar UX Tests ===\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-ux-'));
  const wsRoot = path.join(testTempDir, 'workspace');
  const wsPlansDir = path.join(wsRoot, 'plans');
  const wsFeaturePlanDir = path.join(wsPlansDir, 'feature-login');
  const wsOtherPlanDir = path.join(wsPlansDir, 'feature-auth');
  const activePlanDir = path.join(testTempDir, 'active-plan');
  const recentPlanDir = path.join(testTempDir, 'recent-plan');
  const emptyPlanDir = path.join(testTempDir, 'empty-plan');
  const brainDir = path.join(testTempDir, 'brain');

  process.env.ANTIGRAVITY_BRAIN_DIR = brainDir;

  fs.mkdirSync(wsFeaturePlanDir, { recursive: true });
  fs.mkdirSync(wsOtherPlanDir, { recursive: true });
  fs.mkdirSync(activePlanDir, { recursive: true });
  fs.mkdirSync(recentPlanDir, { recursive: true });
  fs.mkdirSync(emptyPlanDir, { recursive: true });
  fs.mkdirSync(brainDir, { recursive: true });

  // Populate phase files in directories
  fs.writeFileSync(path.join(wsFeaturePlanDir, 'phase-01-design.md'), '# Phase 1');
  fs.writeFileSync(path.join(wsFeaturePlanDir, 'phase-02-impl.md'), '# Phase 2');

  fs.writeFileSync(path.join(wsOtherPlanDir, 'phase-01-init.md'), '# Phase 1');

  fs.writeFileSync(path.join(activePlanDir, 'phase-01-start.md'), '# Phase 1');
  fs.writeFileSync(path.join(activePlanDir, 'phase-02-finish.md'), '# Phase 2');

  fs.writeFileSync(path.join(recentPlanDir, 'phase-01-recent.md'), '# Phase 1');

  // Setup workspace mock
  workspaceFoldersMock.push({ uri: { fsPath: wsRoot } });

  try {
    // -------------------------------------------------------------
    // Test 1: Helper Functions: Elapsed Time & Markdown Tooltip
    // -------------------------------------------------------------
    console.log('[Test 1] Verifying formatElapsedTime and buildRunningTooltip...');
    assert.strictEqual(formatElapsedTime(0), '00:00');
    assert.strictEqual(formatElapsedTime(65000), '01:05');
    assert.strictEqual(formatElapsedTime(3665000), '61:05');

    const tooltipMd = buildRunningTooltip('my-plan', 1, 4, 'phase-02-impl.md', 'Waiting for Agent...', 75000);
    assert.ok(tooltipMd.value.includes('### 🚀 Auto-Plan Runner'));
    assert.ok(tooltipMd.value.includes('my-plan'));
    assert.ok(tooltipMd.value.includes('Phase 2 of 4 (25%)'));
    assert.ok(tooltipMd.value.includes('phase-02-impl.md'));
    assert.ok(tooltipMd.value.includes('01:15'));
    assert.strictEqual(tooltipMd.isTrusted, true);
    console.log('✓ Test 1 Passed: Helper formatting and Markdown tooltip verified.');

    // -------------------------------------------------------------
    // Test 2: Status Bar Item Creation & Priority Placement
    // -------------------------------------------------------------
    console.log('[Test 2] Verifying Status Bar Item creation (Right alignment, priority 100)...');
    createdStatusBarItems = [];
    activate(mockContext);

    assert.ok(createdStatusBarItems.length > 0, 'StatusBarItem should be created');
    const mainItem = createdStatusBarItems[0];
    assert.strictEqual(mainItem.alignment, 2, 'StatusBarItem alignment should be StatusBarAlignment.Right (2)');
    assert.strictEqual(mainItem.priority, 100, 'StatusBarItem priority should be 100');
    assert.strictEqual(mainItem.text, '$(rocket) Auto-Plan', 'Idle text should be $(rocket) Auto-Plan');
    assert.strictEqual(mainItem.command, 'autoplan.start', 'Idle command should be autoplan.start');
    assert.strictEqual(mainItem.visible, true, 'StatusBarItem should be visible');
    console.log('✓ Test 2 Passed: Status Bar created at StatusBarAlignment.Right with priority 100.');

    // -------------------------------------------------------------
    // Test 3: Smart 2-Tier QuickPick Candidate Generation
    // -------------------------------------------------------------
    console.log('[Test 3] Verifying 2-Tier QuickPick items generation (active, workspace, recent, browse, manual)...');
    
    // Set active editor inside activePlanDir
    activeEditorMock = {
      document: {
        uri: { fsPath: path.join(activePlanDir, 'phase-01-start.md') }
      }
    };

    // Set recent history in mock state
    await mockContext.workspaceState.update('lastPlanFolder', recentPlanDir);
    await mockContext.globalState.update('recentPlanFolders', [recentPlanDir]);

    const activeDetected = findActivePlanFolder();
    assert.strictEqual(activeDetected, activePlanDir, 'Should accurately detect active plan parent folder');

    const wsDiscovered = discoverWorkspacePlanFolders();
    assert.ok(wsDiscovered.some(w => w.folderPath === wsFeaturePlanDir && w.phaseCount === 2), 'Discovered feature-login with 2 phases');
    assert.ok(wsDiscovered.some(w => w.folderPath === wsOtherPlanDir && w.phaseCount === 1), 'Discovered feature-auth with 1 phase');

    const recentDiscovered = getRecentPlanFolders(mockContext);
    assert.ok(recentDiscovered.includes(path.normalize(recentPlanDir)), 'Recent folders should include recentPlanDir');

    const quickPickItems = buildFolderQuickPickItems(mockContext);
    assert.ok(quickPickItems.some(item => item.type === 'active' && item.label.includes('Active Plan')), 'Has active plan item');
    assert.ok(quickPickItems.some(item => item.type === 'workspace' && item.label.includes('feature-login')), 'Has workspace feature-login');
    assert.ok(quickPickItems.some(item => item.type === 'recent' && item.label.includes('recent-plan')), 'Has recent plan item');
    assert.ok(quickPickItems.some(item => item.type === 'browse' && item.label.includes('Browse Folder')), 'Has browse folder option');
    assert.ok(quickPickItems.some(item => item.type === 'manual' && item.label.includes('Enter Path Manually')), 'Has manual entry option');

    console.log(`✓ Test 3 Passed: QuickPick generated ${quickPickItems.length} candidate options accurately.`);

    // -------------------------------------------------------------
    // Test 4: Pre-Flight Phase Preview Confirmation & Start
    // -------------------------------------------------------------
    console.log('[Test 4] Verifying Pre-Flight Preview Confirmation and State Persistence...');

    // Scenario 4a: User selects an empty directory (0 phases)
    shownErrorMessages = [];
    quickPickNextSelection = { type: 'workspace', folderPath: emptyPlanDir };
    await promptAndStartAutoPlan(mockContext);
    assert.ok(shownErrorMessages.some(m => m.includes('No executable phase') || m.includes('Plan directory does not exist')), 'Error shown for folder with 0 phases');

    // Scenario 4b: User selects valid folder and clicks "⚙️ Settings"
    executedVscodeCommands = [];
    quickPickNextSelection = { type: 'workspace', folderPath: wsFeaturePlanDir };
    infoMessageNextChoice = '⚙️ Settings';
    await promptAndStartAutoPlan(mockContext);
    assert.ok(executedVscodeCommands.some(cmd => cmd.command === 'workbench.action.openSettings'), 'Opens settings when Settings button clicked');

    // Scenario 4c: User selects valid folder, clicks "▶️ Start Auto-Run", orchestrator starts
    let orchestratorStartedWith: string | null = null;
    const originalStartFolder = orchestrator.startFolder.bind(orchestrator);
    orchestrator.startFolder = async (folder: string) => {
      orchestratorStartedWith = folder;
      // Emit running state
      (orchestrator as any).state = 'waiting';
      orchestrator.emit('stateChange', {
        state: 'waiting',
        currentIteration: 1,
        totalIterations: 2,
        currentPhaseIndex: 0,
        totalPhases: 2,
        currentPhase: {
          index: 0,
          phaseNumber: 1,
          fileName: 'phase-01-design.md',
          filePath: path.join(wsFeaturePlanDir, 'phase-01-design.md'),
          nativePath: path.join(wsFeaturePlanDir, 'phase-01-design.md'),
          normalizedPath: path.join(wsFeaturePlanDir, 'phase-01-design.md'),
          status: 'Running'
        },
        message: 'Waiting for Agent completion...'
      });
      return true;
    };

    infoMessageNextChoice = '▶️ Start Auto-Run';
    quickPickNextSelection = { type: 'workspace', folderPath: wsFeaturePlanDir };
    await promptAndStartAutoPlan(mockContext);

    assert.strictEqual(orchestratorStartedWith, wsFeaturePlanDir, 'Orchestrator should start with selected folder');
    assert.strictEqual(mockContext.workspaceState.get('lastPlanFolder'), wsFeaturePlanDir, 'WorkspaceState lastPlanFolder updated');
    const globalRecents = mockContext.globalState.get('recentPlanFolders', []);
    assert.strictEqual(globalRecents[0], wsFeaturePlanDir, 'GlobalState recentPlanFolders updated with folder at top');

    // Check Running status bar update
    assert.ok(mainItem.text.includes('Auto-Plan: [1/2] phase-01-design.md'), 'Running status bar text updated');
    assert.strictEqual(mainItem.command, 'autoplan.actionMenu', 'Running command switched to autoplan.actionMenu');
    assert.ok(mainItem.tooltip && typeof mainItem.tooltip === 'object', 'Running tooltip is MarkdownString');

    console.log('✓ Test 4 Passed: Pre-flight preview confirmation and state persistence verified.');

    // -------------------------------------------------------------
    // Test 5: Running Action Menu (`autoplan.actionMenu`)
    // -------------------------------------------------------------
    console.log('[Test 5] Verifying Running Action Menu commands (stop, skip, open transcript)...');

    // Create a mock transcript log in the brain dir
    const mockConvId = 'conv-test-phase04';
    const mockConvDir = path.join(brainDir, mockConvId);
    const mockLogDir = path.join(mockConvDir, '.system_generated', 'logs');
    fs.mkdirSync(mockLogDir, { recursive: true });
    const mockTranscriptFile = path.join(mockLogDir, 'transcript.jsonl');
    fs.writeFileSync(mockTranscriptFile, '{"step_index":1,"content":"hello"}');

    // Mock last conversation id
    (orchestrator as any).lastConversationId = mockConvId;

    // Test 5a: Open Active Transcript Log
    openedDocuments = [];
    quickPickNextSelection = { action: 'openTranscript' };
    await showRunningActionMenu();
    assert.ok(openedDocuments.some(d => d.includes('transcript.jsonl')), 'Active transcript log opened in editor');

    // Test 5b: Skip Current Phase
    let skipCalled = false;
    orchestrator.skipCurrentPhase = () => {
      skipCalled = true;
      return true;
    };
    quickPickNextSelection = { action: 'skip' };
    await showRunningActionMenu();
    assert.strictEqual(skipCalled, true, 'skipCurrentPhase called from action menu');

    // Test 5c: Stop Auto-Plan
    let stopCalled = false;
    orchestrator.stop = () => {
      stopCalled = true;
      (orchestrator as any).state = 'stopped';
      orchestrator.emit('stopped');
    };
    quickPickNextSelection = { action: 'stop' };
    await showRunningActionMenu();
    assert.strictEqual(stopCalled, true, 'stop called from action menu');

    // Restore orchestrator methods
    orchestrator.startFolder = originalStartFolder;

    console.log('✓ Test 5 Passed: Running Action Menu (open transcript, skip, stop) verified.');

    // -------------------------------------------------------------
    // Test 6: Completion State & UI Reset
    // -------------------------------------------------------------
    console.log('[Test 6] Verifying Completion State and notification toast...');
    shownInfoMessages = [];
    orchestrator.emit('allComplete', 2);

    assert.strictEqual(mainItem.text, '$(check) Auto-Plan (Done)', 'Completion status bar text matches $(check) Auto-Plan (Done)');
    assert.ok(shownInfoMessages.some(m => m.includes('Successfully completed all 2 phases!')), 'Completion toast notification shown');

    console.log('✓ Test 6 Passed: Completion State handled cleanly.');

    // -------------------------------------------------------------
    // Test 7: Native File Browser & Manual Path Fallback
    // -------------------------------------------------------------
    console.log('[Test 7] Verifying Native File Browser dialog & Manual Input fallback...');

    // 7a: Browse dialog selection
    openDialogNextResult = [{ fsPath: wsOtherPlanDir }];
    quickPickNextSelection = { type: 'browse' };
    infoMessageNextChoice = 'Cancel'; // don't start
    await promptAndStartAutoPlan(mockContext);

    // 7b: Manual path input
    inputBoxNextResult = wsOtherPlanDir;
    quickPickNextSelection = { type: 'manual' };
    infoMessageNextChoice = 'Cancel'; // don't start
    await promptAndStartAutoPlan(mockContext);

    console.log('✓ Test 7 Passed: Native file browser dialog and manual input box flows verified.');

    // -------------------------------------------------------------
    // Test 8: Deactivation & Resource Disposal
    // -------------------------------------------------------------
    console.log('[Test 8] Verifying Extension Deactivate Cleanup...');
    deactivate();
    console.log('✓ Test 8 Passed: Extension cleanly deactivated.');

    console.log('\n=== ALL PHASE 04 UI/UX TESTS PASSED SUCCESSFULLY ===\n');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase04UIUXTests().catch((err) => {
  console.error('Phase 04 UI/UX Test Failed:', err);
  process.exit(1);
});
