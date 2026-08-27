// Standalone test runner with comprehensive mock for 'vscode' module
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let createdStatusBarItems: any[] = [];
let shownInfoMessages: string[] = [];
let shownErrorMessages: string[] = [];
let shownWarningMessages: string[] = [];
let activeEditorMock: any = null;
let workspaceFoldersMock: any[] = [];

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
        get workspaceFolders() {
          return workspaceFoldersMock;
        },
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        }),
        onDidChangeConfiguration: (_cb: any) => ({
          dispose: () => {}
        }),
        openTextDocument: async (uri: any) => ({ uri }),
        asRelativePath: (p: string) => p
      },
      window: {
        get activeTextEditor() {
          return activeEditorMock;
        },
        createStatusBarItem: (_alignment?: any, _priority?: number) => {
          const item = {
            text: '',
            tooltip: '' as any,
            command: '',
            show: () => {},
            hide: () => {},
            dispose: () => {}
          };
          createdStatusBarItems.push(item);
          return item;
        },
        showInformationMessage: async (msg: string, ...choices: any[]) => {
          shownInfoMessages.push(msg);
          return choices[0];
        },
        showWarningMessage: async (msg: string) => {
          shownWarningMessages.push(msg);
        },
        showErrorMessage: async (msg: string) => {
          shownErrorMessages.push(msg);
        },
        showQuickPick: async () => undefined,
        showOpenDialog: async () => undefined,
        showInputBox: async () => undefined,
        showTextDocument: async () => {}
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
      commands: {
        registerCommand: (cmd: string, callback: (...args: any[]) => any) => {
          registeredCommands[cmd] = callback;
          return {
            dispose: () => {
              delete registeredCommands[cmd];
            }
          };
        },
        executeCommand: async () => {}
      },
      MarkdownString: MockMarkdownString,
      Uri: {
        file: (f: string) => ({ fsPath: f, scheme: 'file' })
      },
      env: {
        clipboard: {
          writeText: async () => {},
          readText: async () => ''
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
import { Orchestrator, PhaseItem } from '../orchestrator';
import { KeyboardManager, BatchAction } from '../keyboardManager';
import { TranscriptWatcher, clearBrainDirCache } from '../transcriptWatcher';
import {
  getCachedRunningTooltip,
  clearTooltipCache,
  discoverWorkspacePlanFolders,
  clearPlanDiscoveryCache,
  getPlanDiscoveryCache,
  deactivate
} from '../extension';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase04AuditE2EVerificationTests() {
  console.log('=== Running Phase 04: Orchestrator Integration & E2E Verification Tests ===\n');

  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-test-'));
  const tempPlansDir = path.join(tempBaseDir, 'plans');
  const tempBrainDir = path.join(tempBaseDir, 'brain');

  fs.mkdirSync(tempPlansDir, { recursive: true });
  fs.mkdirSync(tempBrainDir, { recursive: true });

  workspaceFoldersMock = [
    {
      uri: { fsPath: tempBaseDir, scheme: 'file' },
      name: 'test-workspace',
      index: 0
    }
  ];

  try {
    // -------------------------------------------------------------
    // Test 1: Full E2E Multi-Phase Simulation (3 Consecutive Phases)
    // -------------------------------------------------------------
    console.log('[Test 1] Multi-Phase E2E Execution with Batch Keyboard & Async Watcher...');
    {
      clearBrainDirCache();
      clearTooltipCache();
      clearPlanDiscoveryCache();

      const phaseFiles = [
        'phase-01-setup.md',
        'phase-02-core-logic.md',
        'phase-03-cleanup.md'
      ];

      for (let i = 0; i < phaseFiles.length; i++) {
        const filePath = path.join(tempPlansDir, phaseFiles[i]);
        fs.writeFileSync(filePath, `# Phase 0${i + 1}\nTask details for phase ${i + 1}`, 'utf-8');
      }

      const executedBatches: { script: string; actions: BatchAction[] }[] = [];
      const copiedPrompts: string[] = [];

      const customKeyboardManager = new KeyboardManager({
        focusDelayMs: 5,
        selectDelayMs: 5,
        pasteDelayMs: 5,
        submitDelayMs: 5,
        customClipboardSetter: async (text: string) => {
          copiedPrompts.push(text);
        },
        customBatchSender: async (batchScript: string, actions: BatchAction[]) => {
          executedBatches.push({ script: batchScript, actions });
        }
      });

      const customWatcher = new TranscriptWatcher({
        brainDir: tempBrainDir,
        keyword: 'Done.',
        pollIntervalMs: 15,
        settleQuietPeriodMs: 40,
        timeoutMs: 3000
      });

      const phaseStartEvents: PhaseItem[] = [];
      const phaseCompleteEvents: PhaseItem[] = [];
      const stateChanges: string[] = [];

      const testOrchestrator = new Orchestrator({
        keyboardManager: customKeyboardManager,
        transcriptWatcher: customWatcher,
        configProvider: () => ({
          repeatCount: 3,
          keyword: 'Done.',
          completionKeyword: 'Done.',
          promptText: 'Execute phase: {{PHASE_PATH}}',
          promptTemplate: 'Execute phase: {{PHASE_PATH}}',
          defaultPlanFolder: tempPlansDir,
          delayBetweenLoopsMs: 20,
          timeoutPerLoopMinutes: 1,
          autoStartOnOpen: false
        }),
        onStateChange: (info) => {
          stateChanges.push(info.state);
        },
        onPhaseStart: (phase) => {
          phaseStartEvents.push(phase);

          // Simulate Antigravity IDE creating conversation folder and writing completion
          const convId = `conv_phase_${phase.index + 1}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const convDir = path.join(tempBrainDir, convId);
          const logsDir = path.join(convDir, '.system_generated', 'logs');
          fs.mkdirSync(logsDir, { recursive: true });

          const transcriptFile = path.join(logsDir, 'transcript.jsonl');
          const promptStep = JSON.stringify({
            step_index: 0,
            source: 'USER_INPUT',
            type: 'USER_INPUT',
            content: `Execute phase: ${phase.filePath}`
          }) + '\n';
          fs.writeFileSync(transcriptFile, promptStep, 'utf-8');

          setTimeout(() => {
            const responseStep = JSON.stringify({
              step_index: 1,
              source: 'MODEL',
              type: 'PLANNER_RESPONSE',
              status: 'DONE',
              tool_calls: null,
              content: `Completed work for ${phase.fileName}. Done.`
            }) + '\n';
            fs.appendFileSync(transcriptFile, responseStep, 'utf-8');
          }, 30);
        },
        onPhaseComplete: (phase) => {
          phaseCompleteEvents.push(phase);
        }
      });

      const success = await testOrchestrator.startFolder(tempPlansDir);

      assert.strictEqual(success, true, 'Orchestrator must return true for successful completion');
      assert.strictEqual(phaseStartEvents.length, 3, 'Should have emitted 3 phaseStart events');
      assert.strictEqual(phaseCompleteEvents.length, 3, 'Should have emitted 3 phaseComplete events');
      assert.strictEqual(executedBatches.length, 3, 'Should have executed 3 batch prompt sequences');
      assert.strictEqual(copiedPrompts.length, 3, 'Should have copied 3 prompts to clipboard');

      for (let i = 0; i < 3; i++) {
        assert.strictEqual(phaseCompleteEvents[i].status, 'Completed', `Phase ${i + 1} status must be Completed`);
        assert.ok(phaseCompleteEvents[i].conversationId, `Phase ${i + 1} must record conversationId`);
        assert.strictEqual(phaseCompleteEvents[i].result?.success, true, `Phase ${i + 1} result must be success`);
      }

      assert.ok(stateChanges.includes('scanning'), 'Must transition through scanning state');
      assert.ok(stateChanges.includes('sending'), 'Must transition through sending state');
      assert.ok(stateChanges.includes('waiting'), 'Must transition through waiting state');
      assert.ok(stateChanges.includes('completed'), 'Must transition to completed state');

      testOrchestrator.dispose();
      customWatcher.dispose();
      console.log('  -> PASS: 3 consecutive phases executed seamlessly via batch runner & async watcher.');
    }

    // -------------------------------------------------------------
    // Test 2: Status Bar Tooltip Render Throttling & Memoization
    // -------------------------------------------------------------
    console.log('[Test 2] Status Bar Tooltip Render Throttling...');
    {
      clearTooltipCache();

      const folderName = '260828-0045-audit';
      const currentPhaseIndex = 1;
      const totalPhases = 4;
      const phaseFileName = 'phase-02-core.md';
      const stateMessage = 'Waiting for Agent...';
      const baseElapsedMs = 12500; // 12.5 seconds -> 12 seconds floor

      const tooltip1 = getCachedRunningTooltip(
        folderName,
        currentPhaseIndex,
        totalPhases,
        phaseFileName,
        stateMessage,
        baseElapsedMs
      );
      assert.ok(tooltip1, 'Tooltip 1 must be created');
      assert.ok(tooltip1.value.includes('phase-02-core.md'));

      // Call within the same second (12.8s) -> returns the exact same object reference
      const tooltip2 = getCachedRunningTooltip(
        folderName,
        currentPhaseIndex,
        totalPhases,
        phaseFileName,
        stateMessage,
        baseElapsedMs + 300
      );
      assert.strictEqual(tooltip1, tooltip2, 'Tooltip reference must be identical within the same elapsed second');

      // Call in the next second (13.3s) -> returns a new MarkdownString instance
      const tooltip3 = getCachedRunningTooltip(
        folderName,
        currentPhaseIndex,
        totalPhases,
        phaseFileName,
        stateMessage,
        baseElapsedMs + 800
      );
      assert.notStrictEqual(tooltip1, tooltip3, 'Tooltip instance should change when second changes');
      assert.ok(tooltip3.value.includes('00:13'), 'Tooltip 3 must format elapsed time 00:13');

      // State message change returns new instance
      const tooltip4 = getCachedRunningTooltip(
        folderName,
        currentPhaseIndex,
        totalPhases,
        phaseFileName,
        'Sending Prompt...',
        baseElapsedMs + 800
      );
      assert.notStrictEqual(tooltip3, tooltip4, 'Tooltip instance should change when message changes');

      // Clear cache resets memoization
      clearTooltipCache();
      const tooltip5 = getCachedRunningTooltip(
        folderName,
        currentPhaseIndex,
        totalPhases,
        phaseFileName,
        'Sending Prompt...',
        baseElapsedMs + 800
      );
      assert.notStrictEqual(tooltip4, tooltip5, 'Clearing cache creates new instance');

      console.log('  -> PASS: Status bar tooltip rendering throttled and cached efficiently.');
    }

    // -------------------------------------------------------------
    // Test 3: Plan Discovery Caching
    // -------------------------------------------------------------
    console.log('[Test 3] Plan Discovery In-Memory Caching...');
    {
      clearPlanDiscoveryCache();
      assert.strictEqual(getPlanDiscoveryCache(), null, 'Initial cache should be null');

      const results1 = discoverWorkspacePlanFolders();
      const cached = getPlanDiscoveryCache();
      assert.ok(cached, 'Cache must be populated after first discovery call');
      assert.strictEqual(results1, cached.results, 'Returned results array should match cached array');

      // Second call returns cached reference
      const results2 = discoverWorkspacePlanFolders();
      assert.strictEqual(results1, results2, 'Repeated call must return cached array reference');

      // Force refresh bypasses cache
      const results3 = discoverWorkspacePlanFolders(true);
      assert.ok(results3, 'Forced refresh must return results');

      clearPlanDiscoveryCache();
      assert.strictEqual(getPlanDiscoveryCache(), null, 'Cache must be null after clearing');

      console.log('  -> PASS: Plan folder discovery in-memory caching verified.');
    }

    // -------------------------------------------------------------
    // Test 4: Clean Teardown and Disposable Lifecycle
    // -------------------------------------------------------------
    console.log('[Test 4] Clean Teardown and Lifecycle Registration...');
    {
      const watcher = new TranscriptWatcher({ brainDir: tempBrainDir, pollIntervalMs: 50 });
      const orchestrator = new Orchestrator({ transcriptWatcher: watcher });

      assert.strictEqual(orchestrator.isRunning(), false);

      let cleanTeardown = true;
      try {
        orchestrator.stop();
        orchestrator.dispose();
        watcher.dispose();
        deactivate();
      } catch (err) {
        cleanTeardown = false;
      }

      assert.strictEqual(cleanTeardown, true, 'Teardown, dispose, and deactivate must execute cleanly');
      assert.strictEqual(orchestrator.getState(), 'stopped');

      console.log('  -> PASS: Clean stop, teardown, and lifecycle disposal verified.');
    }

    console.log('\n======================================================');
    console.log('🎉 ALL PHASE 04 AUDIT & E2E VERIFICATION TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    clearBrainDirCache();
    clearTooltipCache();
    clearPlanDiscoveryCache();
    try {
      if (fs.existsSync(tempBaseDir)) {
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

if (require.main === module) {
  runPhase04AuditE2EVerificationTests().catch((err) => {
    console.error('Phase 04 Tests Failed:', err);
    process.exit(1);
  });
}

export { runPhase04AuditE2EVerificationTests };
