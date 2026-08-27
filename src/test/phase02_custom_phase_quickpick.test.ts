// Standalone test runner with comprehensive mock for 'vscode' module
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let shownInfoMessages: string[] = [];
let shownErrorMessages: string[] = [];
let shownWarningMessages: string[] = [];
let createdQuickPicks: MockQuickPick<any>[] = [];

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

class MockQuickPick<T extends any> {
  public title: string = '';
  public placeholder: string = '';
  public step: number | undefined = undefined;
  public totalSteps: number | undefined = undefined;
  public canSelectMany: boolean = false;
  public items: readonly T[] = [];
  public selectedItems: readonly T[] = [];
  public buttons: readonly any[] = [];
  public visible: boolean = false;
  public disposed: boolean = false;

  public acceptListeners: (() => void)[] = [];
  public buttonListeners: ((btn: any) => void)[] = [];
  public itemButtonListeners: ((e: { item: T; button: any }) => void)[] = [];
  public hideListeners: (() => void)[] = [];

  public onDidAccept(listener: () => void) {
    this.acceptListeners.push(listener);
    return {
      dispose: () => {
        this.acceptListeners = this.acceptListeners.filter(l => l !== listener);
      }
    };
  }

  public onDidTriggerButton(listener: (btn: any) => void) {
    this.buttonListeners.push(listener);
    return {
      dispose: () => {
        this.buttonListeners = this.buttonListeners.filter(l => l !== listener);
      }
    };
  }

  public onDidTriggerItemButton(listener: (e: { item: T; button: any }) => void) {
    this.itemButtonListeners.push(listener);
    return {
      dispose: () => {
        this.itemButtonListeners = this.itemButtonListeners.filter(l => l !== listener);
      }
    };
  }

  public onDidHide(listener: () => void) {
    this.hideListeners.push(listener);
    return {
      dispose: () => {
        this.hideListeners = this.hideListeners.filter(l => l !== listener);
      }
    };
  }

  public show() {
    this.visible = true;
  }

  public hide() {
    this.visible = false;
    for (const listener of [...this.hideListeners]) {
      listener();
    }
  }

  public dispose() {
    this.disposed = true;
    this.acceptListeners = [];
    this.buttonListeners = [];
    this.itemButtonListeners = [];
    this.hideListeners = [];
  }

  public triggerAccept() {
    for (const listener of [...this.acceptListeners]) {
      listener();
    }
  }

  public triggerButton(button: any) {
    for (const listener of [...this.buttonListeners]) {
      listener(button);
    }
  }

  public triggerItemButton(item: T, button: any) {
    for (const listener of [...this.itemButtonListeners]) {
      listener({ item, button });
    }
  }
}

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      ThemeIcon: MockThemeIcon,
      QuickInputButtons: MockQuickInputButtons,
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
        createStatusBarItem: (_arg1: any, _arg2?: any, _arg3?: any) => ({
          text: '',
          tooltip: '',
          command: undefined,
          visible: false,
          show() { this.visible = true; },
          hide() { this.visible = false; },
          dispose() {}
        }),
        createQuickPick: () => {
          const qp = new MockQuickPick<any>();
          createdQuickPicks.push(qp);
          return qp;
        },
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
        }
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import { PhaseFile } from '../planScanner';
import { orchestrator } from '../orchestrator';
import {
  showPlanActionMenu,
  showRunFromPhaseMenu,
  showCustomSelectPhasesMenu,
  executePhases
} from '../extension';

async function runPhase02Tests() {
  console.log('=== Running Phase 02: Interactive QuickPick Selection Tests ===\n');

  // Intercept orchestrator startPhases for assertions
  let startedPhases: (string | PhaseFile)[] = [];
  const originalStartPhases = orchestrator.startPhases.bind(orchestrator);
  orchestrator.startPhases = async (phases: (string | PhaseFile)[]) => {
    startedPhases = phases;
    return true;
  };

  const samplePhases: PhaseFile[] = [
    {
      fileName: 'phase-01-scaffold.md',
      nativePath: 'C:/project/plans/phase-01-scaffold.md',
      normalizedPath: 'C:/project/plans/phase-01-scaffold.md',
      filePath: 'C:/project/plans/phase-01-scaffold.md',
      relativePath: 'phase-01-scaffold.md',
      index: 1,
      status: 'Completed',
      isCompleted: true
    },
    {
      fileName: 'phase-02-api.md',
      nativePath: 'C:/project/plans/phase-02-api.md',
      normalizedPath: 'C:/project/plans/phase-02-api.md',
      filePath: 'C:/project/plans/phase-02-api.md',
      relativePath: 'phase-02-api.md',
      index: 2,
      status: 'Completed',
      isCompleted: true
    },
    {
      fileName: 'phase-03-ui.md',
      nativePath: 'C:/project/plans/phase-03-ui.md',
      normalizedPath: 'C:/project/plans/phase-03-ui.md',
      filePath: 'C:/project/plans/phase-03-ui.md',
      relativePath: 'phase-03-ui.md',
      index: 3,
      status: 'Pending',
      isCompleted: false
    },
    {
      fileName: 'phase-04-deploy.md',
      nativePath: 'C:/project/plans/phase-04-deploy.md',
      normalizedPath: 'C:/project/plans/phase-04-deploy.md',
      filePath: 'C:/project/plans/phase-04-deploy.md',
      relativePath: 'phase-04-deploy.md',
      index: 4,
      status: 'Pending',
      isCompleted: false
    }
  ];

  try {
    // ----------------------------------------------------------------------
    // Test 1: Step 1 Menu Options & Run All Flow
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying Step 1 Action Menu choices & "Run All" action...');
    createdQuickPicks = [];
    startedPhases = [];

    const planActionMenu = showPlanActionMenu(mockContext, 'C:/project/plans', samplePhases) as any as MockQuickPick<any>;
    assert.strictEqual(planActionMenu.step, 1);
    assert.strictEqual(planActionMenu.totalSteps, 2);
    assert.strictEqual(planActionMenu.items.length, 4);

    const labels = planActionMenu.items.map(i => i.label);
    assert.ok(labels[0].includes('Run All (4 phases)'), 'Option 1 should be Run All (4 phases)');
    assert.ok(labels[1].includes('Resume Unfinished (2 phases)'), 'Option 2 should be Resume Unfinished (2 phases)');
    assert.ok(labels[2].includes('Run from Phase... to End'), 'Option 3 should be Run from Phase... to End');
    assert.ok(labels[3].includes('Custom Select Phases...'), 'Option 4 should be Custom Select Phases...');

    // Select "Run All"
    planActionMenu.selectedItems = [planActionMenu.items[0]];
    planActionMenu.triggerAccept();

    // Allow promise to complete
    await new Promise(r => setImmediate(r));
    assert.strictEqual(startedPhases.length, 4, 'Run All must execute all 4 phases');
    assert.strictEqual(planActionMenu.visible, false, 'Step 1 QuickPick should be hidden after accept');
    assert.strictEqual(planActionMenu.disposed, true, 'Step 1 QuickPick should be disposed on hide');
    console.log('  -> Passed: Step 1 menu items populated correctly and "Run All" dispatches all phases.');

    // ----------------------------------------------------------------------
    // Test 2: Step 1 - Resume Unfinished & 0 Pending Guard
    // ----------------------------------------------------------------------
    console.log('[Test 2] Verifying "Resume Unfinished" action & 0 pending guard...');
    startedPhases = [];
    shownInfoMessages = [];

    // Case A: Resume with 2 pending phases
    const resumeMenu = showPlanActionMenu(mockContext, 'C:/project/plans', samplePhases) as any as MockQuickPick<any>;
    resumeMenu.selectedItems = [resumeMenu.items[1]]; // Resume Unfinished
    resumeMenu.triggerAccept();
    await new Promise(r => setImmediate(r));

    assert.strictEqual(startedPhases.length, 2, 'Resume Unfinished should dispatch only pending phases');
    assert.deepStrictEqual(
      startedPhases.map(p => (p as PhaseFile).fileName),
      ['phase-03-ui.md', 'phase-04-deploy.md']
    );

    // Case B: All phases completed guard
    const allCompletedPhases: PhaseFile[] = samplePhases.map(p => ({ ...p, status: 'Completed', isCompleted: true }));
    startedPhases = [];
    shownInfoMessages = [];

    const completedMenu = showPlanActionMenu(mockContext, 'C:/project/plans', allCompletedPhases) as any as MockQuickPick<any>;
    assert.strictEqual(completedMenu.items[1].detail, '(All 4 phases completed)');
    completedMenu.selectedItems = [completedMenu.items[1]];
    completedMenu.triggerAccept();
    await new Promise(r => setImmediate(r));

    assert.strictEqual(startedPhases.length, 0, 'No phases should be started when all completed');
    assert.ok(
      shownInfoMessages.some(m => m.includes('All phases in this plan are already completed.')),
      'Should display informational message when all phases completed'
    );
    console.log('  -> Passed: Resume Unfinished runs pending phases and guards gracefully when 0 pending.');

    // ----------------------------------------------------------------------
    // Test 3: Step 2 Multi-Select QuickPick & Smart Pre-selection
    // ----------------------------------------------------------------------
    console.log('[Test 3] Verifying Multi-Select QuickPick smart pre-selection and labels...');
    const customPick = showCustomSelectPhasesMenu(mockContext, 'C:/project/plans', samplePhases) as any as MockQuickPick<any>;

    assert.strictEqual(customPick.canSelectMany, true, 'canSelectMany must be true');
    assert.strictEqual(customPick.step, 2);
    assert.strictEqual(customPick.totalSteps, 2);
    assert.strictEqual(customPick.title, 'Auto-Plan: Select Phases');
    assert.strictEqual(customPick.items.length, 4);

    // Check item formatting
    assert.strictEqual(customPick.items[0].label, '$(check) phase-01-scaffold.md');
    assert.strictEqual(customPick.items[0].detail, '[Completed]');
    assert.strictEqual(customPick.items[2].label, '$(circle-outline) phase-03-ui.md');
    assert.strictEqual(customPick.items[2].detail, '[Pending]');

    // Check Smart Pre-selection: only pending items selected
    assert.strictEqual(customPick.selectedItems.length, 2);
    assert.deepStrictEqual(
      customPick.selectedItems.map((i: any) => i.phase.fileName),
      ['phase-03-ui.md', 'phase-04-deploy.md']
    );
    console.log('  -> Passed: Smart pre-selection programmatically marks only pending phases.');

    // ----------------------------------------------------------------------
    // Test 4: Title Bar Buttons (Select All / Deselect All / Back)
    // ----------------------------------------------------------------------
    console.log('[Test 4] Verifying Title Bar buttons (Select All, Deselect All, Back)...');
    assert.strictEqual(customPick.buttons.length, 3);
    const [backBtn, selectAllBtn, deselectAllBtn] = customPick.buttons;

    // Test Select All
    customPick.triggerButton(selectAllBtn);
    assert.strictEqual(customPick.selectedItems.length, 4, 'Select All must select all 4 items');

    // Test Deselect All
    customPick.triggerButton(deselectAllBtn);
    assert.strictEqual(customPick.selectedItems.length, 0, 'Deselect All must clear selectedItems');

    // Test Back Button
    createdQuickPicks = [];
    customPick.triggerButton(backBtn);
    assert.strictEqual(customPick.visible, false, 'Custom QuickPick should be hidden after clicking Back');
    assert.strictEqual(customPick.disposed, true, 'Custom QuickPick should be disposed');
    assert.strictEqual(createdQuickPicks.length, 1, 'Should navigate back to Step 1 menu');
    assert.strictEqual(createdQuickPicks[0].step, 1, 'Navigated back menu must be Step 1');
    console.log('  -> Passed: Select All, Deselect All, and Back buttons work as expected.');

    // ----------------------------------------------------------------------
    // Test 5: Item-Level Action Button ("Run from this phase to end")
    // ----------------------------------------------------------------------
    console.log('[Test 5] Verifying item-level $(run-below) button trigger...');
    startedPhases = [];
    const itemPick = showCustomSelectPhasesMenu(mockContext, 'C:/project/plans', samplePhases) as any as MockQuickPick<any>;
    const targetItem = itemPick.items[1]; // Phase 2
    const runBelowBtn = targetItem.buttons[0];

    itemPick.triggerItemButton(targetItem, runBelowBtn);
    await new Promise(r => setImmediate(r));

    assert.strictEqual(itemPick.visible, false, 'QuickPick should hide on item button trigger');
    assert.strictEqual(startedPhases.length, 3, 'Should slice from Phase 2 to end (phases 2, 3, 4)');
    assert.deepStrictEqual(
      startedPhases.map(p => (p as PhaseFile).fileName),
      ['phase-02-api.md', 'phase-03-ui.md', 'phase-04-deploy.md']
    );
    console.log('  -> Passed: Item-level "Run from this phase to end" slices and dispatches correctly.');

    // ----------------------------------------------------------------------
    // Test 6: Empty Selection Validation Guard
    // ----------------------------------------------------------------------
    console.log('[Test 6] Verifying empty selection validation guard on accept...');
    startedPhases = [];
    shownWarningMessages = [];

    const emptyPick = showCustomSelectPhasesMenu(mockContext, 'C:/project/plans', samplePhases) as any as MockQuickPick<any>;
    emptyPick.selectedItems = []; // Deselect all
    emptyPick.triggerAccept();
    await new Promise(r => setImmediate(r));

    assert.strictEqual(startedPhases.length, 0, 'No phases should be executed on empty selection');
    assert.strictEqual(emptyPick.visible, true, 'QuickPick must remain active on empty selection');
    assert.strictEqual(emptyPick.disposed, false, 'QuickPick must NOT be disposed on empty selection');
    assert.ok(
      shownWarningMessages.some(m => m.includes('Please select at least one phase to execute.')),
      'Should display warning message on empty selection'
    );
    console.log('  -> Passed: Empty selection shows warning and prevents dismissal.');

    // ----------------------------------------------------------------------
    // Test 7: Natural Order Collation on Custom Selection Accept
    // ----------------------------------------------------------------------
    console.log('[Test 7] Verifying natural order collation before orchestrator hand-off...');
    startedPhases = [];

    const orderPick = showCustomSelectPhasesMenu(mockContext, 'C:/project/plans', samplePhases) as any as MockQuickPick<any>;
    // User picked out of order: Phase 4, then Phase 1
    orderPick.selectedItems = [orderPick.items[3], orderPick.items[0]];
    orderPick.triggerAccept();
    await new Promise(r => setImmediate(r));

    assert.strictEqual(startedPhases.length, 2);
    assert.deepStrictEqual(
      startedPhases.map(p => (p as PhaseFile).fileName),
      ['phase-01-scaffold.md', 'phase-04-deploy.md'],
      'Phases must be dispatched in natural sorted order regardless of user click order'
    );
    console.log('  -> Passed: Selected phases are guaranteed to be sorted before execution.');

    // ----------------------------------------------------------------------
    // Test 8: Single-Pick "Run from Phase... to End" Menu & Navigation
    // ----------------------------------------------------------------------
    console.log('[Test 8] Verifying "Run from Phase... to End" menu and Back button...');
    startedPhases = [];
    const runFromMenu = showRunFromPhaseMenu(mockContext, 'C:/project/plans', samplePhases) as any as MockQuickPick<any>;

    assert.strictEqual(runFromMenu.canSelectMany, false);
    assert.strictEqual(runFromMenu.step, 2);
    assert.strictEqual(runFromMenu.buttons.length, 1);
    assert.strictEqual(runFromMenu.buttons[0], MockQuickInputButtons.Back);

    // Accept phase 3
    runFromMenu.selectedItems = [runFromMenu.items[2]];
    runFromMenu.triggerAccept();
    await new Promise(r => setImmediate(r));

    assert.strictEqual(startedPhases.length, 2);
    assert.deepStrictEqual(
      startedPhases.map(p => (p as PhaseFile).fileName),
      ['phase-03-ui.md', 'phase-04-deploy.md']
    );

    // Test Back button on RunFrom menu
    const runFromBack = showRunFromPhaseMenu(mockContext, 'C:/project/plans', samplePhases) as any as MockQuickPick<any>;
    createdQuickPicks = [];
    runFromBack.triggerButton(MockQuickInputButtons.Back);
    assert.strictEqual(runFromBack.visible, false);
    assert.strictEqual(createdQuickPicks.length, 1);
    assert.strictEqual(createdQuickPicks[0].step, 1);
    console.log('  -> Passed: "Run from Phase... to End" executes correctly and supports Back navigation.');

    // Restore orchestrator
    orchestrator.startPhases = originalStartPhases;

    console.log('\n=== ALL PHASE 02 TESTS PASSED SUCCESSFULLY ===\n');
  } catch (err) {
    orchestrator.startPhases = originalStartPhases;
    throw err;
  }
}

runPhase02Tests().catch(err => {
  console.error(err);
  process.exit(1);
});
