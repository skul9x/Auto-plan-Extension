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
        }
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import { PhaseFile } from '../planScanner';
import { Orchestrator, PhaseItem } from '../orchestrator';
import {
  activate,
  deactivate,
  executePhases,
  getMainStatusBarItem,
  getCurrentPlanFolder,
  setCurrentPlanFolder,
  buildRunningTooltip,
  updateStatusBar,
  formatElapsedTime
} from '../extension';

async function runPhase03Tests() {
  console.log('=== Running Phase 03: Orchestrator & Status Bar Integration Tests ===\n');

  // Activate extension to initialize status bar and event listeners
  activate(mockContext);

  const sampleSelectedPhases: PhaseFile[] = [
    {
      fileName: 'phase-02-api-design.md',
      nativePath: 'C:/project/plans/phase-02-api-design.md',
      normalizedPath: 'C:/project/plans/phase-02-api-design.md',
      filePath: 'C:/project/plans/phase-02-api-design.md',
      relativePath: 'phase-02-api-design.md',
      index: 2,
      status: 'Pending',
      isCompleted: false
    },
    {
      fileName: 'phase-05-performance.md',
      nativePath: 'C:/project/plans/phase-05-performance.md',
      normalizedPath: 'C:/project/plans/phase-05-performance.md',
      filePath: 'C:/project/plans/phase-05-performance.md',
      relativePath: 'phase-05-performance.md',
      index: 5,
      status: 'Pending',
      isCompleted: false
    }
  ];

  try {
    // ----------------------------------------------------------------------
    // Test 1: Sequential Execution of Custom Subset & 1-based Progress [1/2], [2/2]
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying sequential execution of custom phase subset and progress events...');

    const promptCalls: string[] = [];
    const mockKeyboardManager: any = {
      executeBatchPromptFlow: async (prompt: string) => {
        promptCalls.push(prompt);
      },
      executePromptFlow: async (prompt: string) => {
        promptCalls.push(prompt);
      }
    };

    let watchCount = 0;
    const mockTranscriptWatcher: any = {
      getOptions: () => ({ brainDir: 'C:/mock/brain', pollIntervalMs: 10 }),
      waitForNewConversation: async () => `conv-${++watchCount}`,
      watchFile: async (_path: string, convId: string) => ({
        success: true,
        conversationId: convId,
        completionTimeMs: 100
      }),
      watchLatest: async () => ({
        success: true,
        conversationId: `conv-${watchCount}`,
        completionTimeMs: 100
      }),
      stop: () => {}
    };

    const testOrchestrator = new Orchestrator({
      configProvider: () => ({
        promptText: 'Implement: {phaseFilePath}',
        promptTemplate: 'Implement: {phaseFilePath}',
        repeatCount: 1,
        completionKeyword: 'DONE',
        delayBetweenLoopsMs: 10,
        timeoutPerLoopMinutes: 1,
        defaultPlanFolder: ''
      }),
      keyboardManager: mockKeyboardManager,
      transcriptWatcher: mockTranscriptWatcher
    });

    const phaseStartEvents: { phase: PhaseItem; index: number; total: number }[] = [];
    const phaseCompleteEvents: { phase: PhaseItem; total: number }[] = [];
    let allCompleteTotal = 0;

    testOrchestrator.on('phaseStart', (phase, idx, total) => {
      phaseStartEvents.push({ phase, index: idx, total });
    });

    testOrchestrator.on('phaseComplete', (phase, _result, _idx, total) => {
      phaseCompleteEvents.push({ phase, total });
    });

    testOrchestrator.on('allComplete', (total) => {
      allCompleteTotal = total;
    });

    const runResult = await testOrchestrator.startPhases(sampleSelectedPhases);
    assert.strictEqual(runResult, true, 'startPhases should return true on successful completion');

    // Assert Phase mapping: indices 0..K-1, retaining original metadata
    const phases = testOrchestrator.getPhases();
    assert.strictEqual(phases.length, 2);
    assert.strictEqual(phases[0].index, 0);
    assert.strictEqual(phases[0].phaseNumber, 2);
    assert.strictEqual(phases[0].fileName, 'phase-02-api-design.md');
    assert.strictEqual(phases[0].filePath, 'C:/project/plans/phase-02-api-design.md');
    assert.strictEqual(phases[0].nativePath, 'C:/project/plans/phase-02-api-design.md');
    assert.strictEqual(phases[0].status, 'Completed');

    assert.strictEqual(phases[1].index, 1);
    assert.strictEqual(phases[1].phaseNumber, 5);
    assert.strictEqual(phases[1].fileName, 'phase-05-performance.md');
    assert.strictEqual(phases[1].filePath, 'C:/project/plans/phase-05-performance.md');
    assert.strictEqual(phases[1].status, 'Completed');

    // Assert Events
    assert.strictEqual(phaseStartEvents.length, 2);
    assert.strictEqual(phaseStartEvents[0].index, 0);
    assert.strictEqual(phaseStartEvents[0].total, 2);
    assert.strictEqual(phaseStartEvents[1].index, 1);
    assert.strictEqual(phaseStartEvents[1].total, 2);

    assert.strictEqual(phaseCompleteEvents.length, 2);
    assert.strictEqual(phaseCompleteEvents[0].total, 2);
    assert.strictEqual(phaseCompleteEvents[1].total, 2);

    assert.strictEqual(allCompleteTotal, 2, 'allComplete must report exact selected count (2)');
    assert.strictEqual(promptCalls.length, 2);
    console.log('  -> Passed: Sequential execution of custom subset mapped indices and fired 1-based events.');

    // ----------------------------------------------------------------------
    // Test 2: Status Bar & Tooltip Formatting
    // ----------------------------------------------------------------------
    console.log('[Test 2] Verifying Status Bar formatting & Tooltip content...');
    setCurrentPlanFolder('C:/Users/Admin/workspace/plans/auth-feature');

    // Simulate Phase 1 of 2 running
    updateStatusBar({
      state: 'waiting',
      currentIteration: 1,
      totalIterations: 2,
      currentPhaseIndex: 0,
      totalPhases: 2,
      currentPhase: phases[0],
      message: 'Waiting for Agent completion...'
    });

    const sb = getMainStatusBarItem();
    assert.ok(
      sb.text.includes('$(sync~spin) Auto-Plan: [1/2] phase-02-api-design.md'),
      `Status Bar text expected to be "[1/2] phase-02-api-design.md", got: "${sb.text}"`
    );

    const tooltip = buildRunningTooltip(
      'auth-feature',
      0,
      2,
      'phase-02-api-design.md',
      'Waiting for Agent...',
      65000
    );
    const tooltipVal = tooltip.value;
    assert.ok(tooltipVal.includes('**Folder:** `auth-feature`'), 'Tooltip should include folder name');
    assert.ok(tooltipVal.includes('**Progress:** Phase 1 of 2 (0%)'), 'Tooltip should report Phase 1 of 2 (0%)');
    assert.ok(tooltipVal.includes('**Current Phase:** `phase-02-api-design.md`'), 'Tooltip should report current phase');
    assert.ok(tooltipVal.includes('**Elapsed Time:** 01:05'), 'Tooltip should format 65000ms as 01:05');

    // Simulate Phase 2 of 2 running
    const tooltip2 = buildRunningTooltip(
      'auth-feature',
      1,
      2,
      'phase-05-performance.md',
      'Waiting for Agent...',
      120000
    );
    assert.ok(tooltip2.value.includes('**Progress:** Phase 2 of 2 (50%)'), 'Tooltip should report Phase 2 of 2 (50%)');
    console.log('  -> Passed: Status Bar text [1/K] and rich Tooltip correctly reflect subset and folder context.');

    // ----------------------------------------------------------------------
    // Test 3: Phase Skipping in Custom Subset
    // ----------------------------------------------------------------------
    console.log('[Test 3] Verifying Skip Current Phase advances to next selected phase...');

    let skipTriggered = false;
    let orchestratorSkippingRef: Orchestrator;

    const skippingKeyboardManager: any = {
      executeBatchPromptFlow: async () => {
        // Trigger skip during the first phase
        if (!skipTriggered) {
          skipTriggered = true;
          // Asynchronously trigger skip
          setImmediate(() => {
            orchestratorSkippingRef.skipCurrentPhase();
          });
        }
      }
    };

    let cancelWatcher: (() => void) | null = null;
    const skippingWatcher: any = {
      getOptions: () => ({ brainDir: 'C:/mock/brain', pollIntervalMs: 10 }),
      waitForNewConversation: async () => {
        return new Promise<string>((resolve) => {
          cancelWatcher = () => resolve('conv-hang');
          setTimeout(() => resolve('conv-hang'), 100);
        });
      },
      watchFile: async () => ({ success: true, conversationId: 'conv-hang' }),
      watchLatest: async () => ({ success: true, conversationId: 'conv-hang' }),
      stop: () => {
        if (cancelWatcher) {
          cancelWatcher();
          cancelWatcher = null;
        }
      }
    };

    orchestratorSkippingRef = new Orchestrator({
      configProvider: () => ({
        promptText: '{phaseFilePath}',
        promptTemplate: '{phaseFilePath}',
        repeatCount: 1,
        completionKeyword: 'DONE',
        delayBetweenLoopsMs: 5,
        timeoutPerLoopMinutes: 1,
        defaultPlanFolder: ''
      }),
      keyboardManager: skippingKeyboardManager,
      transcriptWatcher: skippingWatcher
    });

    const skippedPhases: PhaseItem[] = [];
    orchestratorSkippingRef.on('skipped', (p) => {
      skippedPhases.push(p);
    });

    const skipCompletePromise = orchestratorSkippingRef.startPhases(sampleSelectedPhases);
    await skipCompletePromise;

    assert.strictEqual(skippedPhases.length, 1, 'Phase 1 should be marked as skipped');
    assert.strictEqual(skippedPhases[0].fileName, 'phase-02-api-design.md');
    assert.strictEqual(skippedPhases[0].status, 'Skipped');

    const finalPhases = orchestratorSkippingRef.getPhases();
    assert.strictEqual(finalPhases[0].status, 'Skipped');
    assert.strictEqual(finalPhases[1].status, 'Completed');
    console.log('  -> Passed: Skip Current Phase advanced cleanly to the next phase in the selected list.');

    // ----------------------------------------------------------------------
    // Test 4: Stop Auto-Plan Action Halts Immediately & Resets Status Bar
    // ----------------------------------------------------------------------
    console.log('[Test 4] Verifying Stop Auto-Plan cleanly aborts and stops further execution...');

    let stopOrchestratorRef: Orchestrator;
    const stoppingKeyboardManager: any = {
      executeBatchPromptFlow: async () => {
        setImmediate(() => {
          stopOrchestratorRef.stop();
        });
      }
    };

    stopOrchestratorRef = new Orchestrator({
      configProvider: () => ({
        promptText: '{phaseFilePath}',
        promptTemplate: '{phaseFilePath}',
        repeatCount: 1,
        completionKeyword: 'DONE',
        delayBetweenLoopsMs: 10,
        timeoutPerLoopMinutes: 1,
        defaultPlanFolder: ''
      }),
      keyboardManager: stoppingKeyboardManager,
      transcriptWatcher: skippingWatcher
    });

    let stopEventFired = false;
    stopOrchestratorRef.on('stopped', () => {
      stopEventFired = true;
    });

    const stopResult = await stopOrchestratorRef.startPhases(sampleSelectedPhases);
    assert.strictEqual(stopResult, false, 'startPhases should return false when aborted');
    assert.strictEqual(stopEventFired, true, 'stopped event must fire');
    assert.strictEqual(stopOrchestratorRef.getState(), 'stopped');

    // Verify status bar resets to idle
    updateStatusBar({ state: 'stopped', currentIteration: 0, totalIterations: 0 });
    assert.strictEqual(sb.text, '$(rocket) Auto-Plan');
    assert.strictEqual(sb.command, 'autoplan.start');
    console.log('  -> Passed: Stop Auto-Plan cleanly halts execution and resets status bar.');

    // ----------------------------------------------------------------------
    // Test 5: executePhases Integration with Context & Status Bar
    // ----------------------------------------------------------------------
    console.log('[Test 5] Verifying executePhases integrates selected phases, folder context, and recents...');

    const { orchestrator: globalOrchestrator } = require('../orchestrator');
    let executedPhasesReceived: any[] = [];
    const origGlobalStartPhases = globalOrchestrator.startPhases.bind(globalOrchestrator);
    globalOrchestrator.startPhases = async (p: any) => {
      executedPhasesReceived = p;
      return true;
    };

    shownInfoMessages = [];
    await executePhases(mockContext, 'C:/project/plans/feature-x', sampleSelectedPhases);

    assert.strictEqual(getCurrentPlanFolder(), 'C:/project/plans/feature-x');
    assert.strictEqual(mockWorkspaceStateStore['lastPlanFolder'], 'C:/project/plans/feature-x');
    assert.strictEqual(executedPhasesReceived.length, 2);
    assert.ok(
      shownInfoMessages.some(m => m.includes('Starting execution of 2 phases in "feature-x"...')),
      'Should display informational message with phase count and folder name'
    );
    globalOrchestrator.startPhases = origGlobalStartPhases;
    console.log('  -> Passed: executePhases preserves folder context and persists recents.');

    deactivate();
    console.log('\n=== ALL PHASE 03 TESTS PASSED SUCCESSFULLY ===\n');
  } catch (err) {
    deactivate();
    throw err;
  }
}

runPhase03Tests().catch(err => {
  console.error(err);
  process.exit(1);
});
