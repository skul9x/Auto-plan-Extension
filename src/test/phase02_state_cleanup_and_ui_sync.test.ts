// Standalone mock for 'vscode' module when run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockStatusBarText = '';
let mockStatusBarTooltip: any = '';
let mockStatusBarCommand = '';
let mockStatusBarVisible = false;

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (_section: string) => ({
          get: (_key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      env: {
        clipboard: {
          writeText: async (_text: string) => {},
          readText: async () => ''
        }
      },
      window: {
        showErrorMessage: async () => undefined,
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        createStatusBarItem: (_alignment?: any, _priority?: any) => ({
          get text() {
            return mockStatusBarText;
          },
          set text(val: string) {
            mockStatusBarText = val;
          },
          get tooltip() {
            return mockStatusBarTooltip;
          },
          set tooltip(val: any) {
            mockStatusBarTooltip = val;
          },
          get command() {
            return mockStatusBarCommand;
          },
          set command(val: string) {
            mockStatusBarCommand = val;
          },
          show: () => {
            mockStatusBarVisible = true;
          },
          hide: () => {
            mockStatusBarVisible = false;
          },
          dispose: () => {}
        })
      },
      commands: {
        executeCommand: async () => undefined
      },
      StatusBarAlignment: {
        Left: 1,
        Right: 2
      },
      MarkdownString: class {
        public value: string;
        public isTrusted: boolean = false;
        constructor(val: string) {
          this.value = val;
        }
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Orchestrator, PhaseItem } from '../orchestrator';
import { KeyboardManager } from '../keyboardManager';
import { PromptDispatcher } from '../promptDispatcher';
import { TranscriptWatcher } from '../transcriptWatcher';
import { AutoPlanConfig, DEFAULT_COMPLETION_KEYWORD } from '../config';
import { updateStatusBar, setMainStatusBarItem } from '../extension';

function createTempDir(prefix: string): string {
  const dir = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

/**
 * Pure simulation of sidebar.js renderPhaseList logic to verify DOM model output.
 */
function simulateSidebarRenderPhaseList(phases: any[], selectedSet: Set<number>, currentIdx: number, currentState: string) {
  const renderedItems: Array<{
    fileName: string;
    isCurrent: boolean;
    isDone: boolean;
    isFailed: boolean;
    isStopped: boolean;
    isSkipped: boolean;
    tagClass: string;
    tagText: string;
    tooltipText: string;
  }> = [];

  phases.forEach((phase, index) => {
    const isSelected = selectedSet.has(index);

    const isCurrent = currentState === 'running' && (index === currentIdx || phase.status === 'Running');
    const isDone = phase.isCompleted || phase.status === 'Completed';
    const isFailed = phase.status === 'Failed' || phase.status === 'failed';
    const isStopped = phase.status === 'Stopped' || phase.status === 'stopped';
    const isSkipped = phase.status === 'Skipped' || phase.status === 'skipped';

    let tagClass = 'status-tag ';
    let tagText = '';
    let tooltipText = '';

    if (isCurrent) {
      tagClass += 'tag-running';
      tagText = '🔄 Running';
      tooltipText = 'Phase is currently executing...';
    } else if (isDone) {
      tagClass += 'tag-done';
      tagText = '✅ Completed';
      tooltipText = 'Phase marked as completed.';
    } else if (isFailed) {
      tagClass += 'tag-failed';
      tagText = '❌ Failed';
      tooltipText = phase.error || (phase.stallReason ? phase.stallReason.description : 'Phase execution failed.');
    } else if (isStopped) {
      tagClass += 'tag-stopped';
      tagText = '⏹️ Stopped';
      tooltipText = 'Execution was stopped.';
    } else if (isSkipped) {
      tagClass += 'tag-skipped';
      tagText = '⏭️ Skipped';
      tooltipText = phase.stallReason ? phase.stallReason.description : 'Phase was skipped.';
    } else {
      tagClass += 'tag-pending';
      tagText = '⏳ Pending';
      tooltipText = phase.stallReason?.description || 'Waiting for execution.';
    }

    renderedItems.push({
      fileName: phase.fileName,
      isCurrent,
      isDone,
      isFailed,
      isStopped,
      isSkipped,
      tagClass,
      tagText,
      tooltipText
    });
  });

  return renderedItems;
}

async function runPhase02StateCleanupAndUISyncTests() {
  console.log('=== Running Phase 02: Execution State Cleanup & UI Synchronization Test ===\n');

  const baseDir = createTempDir('autoplan_phase02_cleanup');
  const plansDir = path.join(baseDir, 'plans');
  const brainDir = path.join(baseDir, 'brain');

  fs.mkdirSync(plansDir, { recursive: true });
  fs.mkdirSync(brainDir, { recursive: true });

  const phase1Path = path.join(plansDir, 'phase-01-initial.md');
  const phase2Path = path.join(plansDir, 'phase-02-secondary.md');

  fs.writeFileSync(phase1Path, '# Phase 01: Initial\nTask: Test stop during run', 'utf-8');
  fs.writeFileSync(phase2Path, '# Phase 02: Secondary\nTask: Should remain pending', 'utf-8');

  try {
    // -------------------------------------------------------------------------
    // Test 1: Orchestrator Stop & Phase State Cleanup
    // -------------------------------------------------------------------------
    console.log('[Test 1] Verifying Orchestrator Stop cleanly transitions Running phases to Stopped...');

    let orchestratorStoppedEmitted = false;
    let dispatchStarted = false;

    const mockKeyboard = new KeyboardManager({
      focusDelayMs: 2,
      selectDelayMs: 2,
      pasteDelayMs: 2,
      submitDelayMs: 2,
      customKeySender: async () => {},
      customClipboardSetter: async () => {},
      customBatchSender: async () => {}
    });

    const mockPromptDispatcher = new PromptDispatcher({
      keyboardManager: mockKeyboard,
      configProvider: () => testConfig
    });

    const transcriptWatcher = new TranscriptWatcher({
      brainDir,
      keyword: DEFAULT_COMPLETION_KEYWORD,
      pollIntervalMs: 20,
      timeoutMs: 5000
    });

    const testConfig: AutoPlanConfig = {
      promptText: 'Execute {path}',
      promptTemplate: 'Execute phase {path}',
      repeatCount: 2,
      completionKeyword: DEFAULT_COMPLETION_KEYWORD,
      delayBetweenLoopsMs: 50,
      timeoutPerLoopMinutes: 1,
      defaultPlanFolder: plansDir,
      executionMode: 'domBridge'
    };

    const orchestrator = new Orchestrator({
      configProvider: () => testConfig,
      keyboardManager: mockKeyboard,
      transcriptWatcher,
      promptDispatcher: mockPromptDispatcher,
      onStopped: () => {
        orchestratorStoppedEmitted = true;
      }
    });

    // Mock dispatchPrompt to pause while phase 1 is running, then call stop()
    mockPromptDispatcher.dispatchPrompt = async () => {
      dispatchStarted = true;
      setTimeout(() => {
        orchestrator.stop();
      }, 50);

      return {
        success: true,
        tier: 'domBridge',
        durationMs: 10
      };
    };

    const runPromise = orchestrator.startFolder(plansDir);
    const result = await runPromise;

    assert.strictEqual(result, false, 'startFolder must return false when stopped by user');
    assert.strictEqual(orchestrator.getState(), 'stopped', 'Orchestrator state must be "stopped"');
    assert.strictEqual(orchestratorStoppedEmitted, true, 'onStopped event must have been emitted');

    const phases = orchestrator.getPhases();
    assert.strictEqual(phases.length, 2, 'Must have loaded 2 phases');
    assert.strictEqual(phases[0].status, 'Stopped', 'Active Phase 1 status must be transitioned to "Stopped"');
    assert.ok(phases[0].endTime && phases[0].endTime > 0, 'Phase 1 endTime must be recorded upon stopping');
    assert.strictEqual(phases[1].status, 'Pending', 'Subsequent Phase 2 status must remain "Pending"');

    console.log('  ✓ Verified: Running phase status cleanly transitioned to "Stopped" with valid endTime.');
    console.log('  ✓ Verified: Orchestrator state reached "stopped" and emitted onStopped event.\n');

    // -------------------------------------------------------------------------
    // Test 2: Status Bar Item Reset Behavior
    // -------------------------------------------------------------------------
    console.log('[Test 2] Verifying Status Bar Item resets from $(sync~spin) to $(rocket) Auto-Plan...');

    const vscodeMock = require('vscode');
    const statusBarItem = vscodeMock.window.createStatusBarItem();
    setMainStatusBarItem(statusBarItem);

    // 1. Simulate running update
    updateStatusBar({
      state: 'waiting',
      currentIteration: 1,
      totalIterations: 2,
      currentPhaseIndex: 0,
      currentPhase: phases[0],
      message: 'Executing phase-01-initial.md'
    });

    assert.ok(
      mockStatusBarText.includes('$(sync~spin)'),
      `Status bar text during execution must contain spinner, got: "${mockStatusBarText}"`
    );
    assert.ok(
      mockStatusBarText.includes('phase-01-initial.md'),
      `Status bar text during execution must display phase name, got: "${mockStatusBarText}"`
    );

    // 2. Simulate stopped update
    updateStatusBar({
      state: 'stopped',
      currentIteration: 0,
      totalIterations: 0
    });

    assert.strictEqual(
      mockStatusBarText,
      '$(rocket) Auto-Plan',
      `Status bar text after stop must be reset to '$(rocket) Auto-Plan', got: "${mockStatusBarText}"`
    );
    assert.strictEqual(
      mockStatusBarCommand,
      'autoplan.start',
      'Status bar command after stop must be reset to "autoplan.start"'
    );

    console.log('  ✓ Verified: Running status bar with $(sync~spin) cleanly reset to $(rocket) Auto-Plan.\n');

    // -------------------------------------------------------------------------
    // Test 3: Sidebar Webview DOM Rendering Simulation
    // -------------------------------------------------------------------------
    console.log('[Test 3] Verifying Sidebar View rendering for Stopped phases and fixed isCurrent predicate...');

    const simulatedPhases: PhaseItem[] = [
      {
        index: 0,
        phaseNumber: 1,
        fileName: 'phase-01-initial.md',
        filePath: phase1Path,
        nativePath: phase1Path,
        normalizedPath: phase1Path,
        status: 'Stopped'
      },
      {
        index: 1,
        phaseNumber: 2,
        fileName: 'phase-02-secondary.md',
        filePath: phase2Path,
        nativePath: phase2Path,
        normalizedPath: phase2Path,
        status: 'Pending'
      }
    ];

    const rendered = simulateSidebarRenderPhaseList(simulatedPhases, new Set([0, 1]), 0, 'stopped');

    assert.strictEqual(rendered.length, 2, 'Must render 2 phase items');

    // Phase 1 (Stopped):
    assert.strictEqual(
      rendered[0].isCurrent,
      false,
      'Stopped phase must NOT have isCurrent: true when currentState is "stopped"'
    );
    assert.strictEqual(rendered[0].isStopped, true, 'Phase 1 must have isStopped: true');
    assert.strictEqual(rendered[0].tagText, '⏹️ Stopped', 'Phase 1 tag text must be "⏹️ Stopped"');
    assert.ok(rendered[0].tagClass.includes('tag-stopped'), 'Phase 1 tagClass must include "tag-stopped"');
    assert.strictEqual(rendered[0].tooltipText, 'Execution was stopped.', 'Phase 1 tooltip must be "Execution was stopped."');

    // Phase 2 (Pending):
    assert.strictEqual(rendered[1].isCurrent, false, 'Pending phase must NOT have isCurrent: true');
    assert.strictEqual(rendered[1].tagText, '⏳ Pending', 'Phase 2 tag text must be "⏳ Pending"');

    console.log('  ✓ Verified: isCurrent predicate respects currentState === "running".');
    console.log('  ✓ Verified: tag-stopped badge with ⏹️ Stopped label and tooltip rendered correctly.\n');
  } finally {
    cleanupDir(baseDir);
  }

  console.log('========================================================================');
  console.log('✅ ALL PHASE 02 STATE CLEANUP & UI SYNC TESTS PASSED!');
  console.log('========================================================================\n');
}

runPhase02StateCleanupAndUISyncTests().catch((err) => {
  console.error('Phase 02 Test Suite Failed:', err);
  process.exit(1);
});
