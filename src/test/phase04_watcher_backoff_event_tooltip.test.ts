// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      Uri: {
        file: (f: string) => ({ fsPath: f }),
        joinPath: (...args: any[]) => ({ fsPath: args.join('/') })
      },
      WebviewViewProvider: class {},
      window: {
        showWarningMessage: () => {},
        showInformationMessage: () => {},
        showErrorMessage: () => {},
        createStatusBarItem: () => ({
          text: '',
          tooltip: '',
          command: '',
          show: () => {},
          hide: () => {},
          dispose: () => {}
        })
      },
      MarkdownString: class {
        public value: string;
        public isTrusted: boolean = false;
        constructor(val: string) {
          this.value = val;
        }
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
      commands: {
        executeCommand: async () => {}
      },
      workspace: {
        workspaceFolders: []
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TranscriptWatcher } from '../transcriptWatcher';
import {
  updateStatusBar,
  setMainStatusBarItem,
  clearTooltipCache,
  updateTooltipFromInfo
} from '../extension';

async function runPhase04Tests() {
  console.log('=== Running Phase 04: Watcher Polling Backoff & Event-Driven Tooltip Tests ===\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-test-'));
  const dummyTranscript = path.join(tmpDir, 'transcript.jsonl');
  fs.writeFileSync(dummyTranscript, '{"source":"SYSTEM","content":"test"}\n', 'utf8');

  try {
    // ----------------------------------------------------------------------
    // Test 1: TranscriptWatcher Adaptive Polling Backoff Test
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying TranscriptWatcher Adaptive Polling Backoff...');

    const watcher = new TranscriptWatcher({
      brainDir: tmpDir,
      pollIntervalMs: 300,
      relaxedPollIntervalMs: 1200
    });

    // Start watching file
    const watchPromise = watcher.watchFile(dummyTranscript, 'conv-test-1');

    // Assert that activePollIntervalMs relaxed to 1200ms when native fs.watch is active
    assert.strictEqual(
      watcher.getActivePollIntervalMs(),
      1200,
      'Active backup polling interval must relax to 1200ms when native fs.watch is active'
    );
    assert.strictEqual(
      watcher.activePollIntervalMs,
      1200,
      'Property activePollIntervalMs must equal 1200ms'
    );

    // Simulate native fs.watch emitting an error event
    const internalFsWatcher = (watcher as any).fsWatcher;
    assert.ok(internalFsWatcher, 'fsWatcher should be created for valid target file');
    internalFsWatcher.emit('error', new Error('Simulated fs.watch error'));

    // Assert that polling interval adaptively falls back to 300ms
    assert.strictEqual(
      watcher.getActivePollIntervalMs(),
      300,
      'Active polling interval must fall back to 300ms when fsWatcher emits an error'
    );

    watcher.stop();
    await watchPromise.catch(() => {}); // catch promise resolution on stop

    console.log('  -> Passed: Watcher active polling interval relaxes to 1200ms during native fs.watch and degrades to 300ms on error.');

    // ----------------------------------------------------------------------
    // Test 2: Event-Driven Tooltip Caching & Update Test
    // ----------------------------------------------------------------------
    console.log('\n[Test 2] Verifying Event-Driven Tooltip Caching & Update Behavior...');

    // Mock status bar item
    const mockItem: any = {
      text: '',
      tooltip: undefined,
      command: '',
      showCalled: false,
      show() { this.showCalled = true; }
    };
    setMainStatusBarItem(mockItem);
    clearTooltipCache();

    const infoState1: any = {
      state: 'running',
      currentPhaseIndex: 0,
      totalPhases: 4,
      currentPhase: { fileName: 'phase-01-setup.md' },
      message: 'Running initial phase step 1'
    };

    // 1. Initial state update
    updateStatusBar(infoState1);
    assert.ok(mockItem.tooltip, 'Tooltip must be generated for running status');
    const cachedTooltip1 = mockItem.tooltip;

    // 2. Call again with identical state and time offset (simulating no state change within 500ms)
    updateTooltipFromInfo(infoState1);
    const cachedTooltip2 = mockItem.tooltip;
    assert.strictEqual(
      cachedTooltip2,
      cachedTooltip1,
      'Cached tooltip MarkdownString object reference must be returned when state is unchanged'
    );

    // 3. State update event
    const infoState2: any = {
      ...infoState1,
      message: 'Running initial phase step 2'
    };
    updateStatusBar(infoState2);
    const updatedTooltip = mockItem.tooltip;
    assert.notStrictEqual(
      updatedTooltip,
      cachedTooltip1,
      'Tooltip must immediately update upon state change event notification'
    );

    // 4. Test status bar reset on stop/idle
    updateStatusBar({ state: 'idle' } as any);
    assert.strictEqual(mockItem.text, '$(rocket) Auto-Plan', 'Status bar text resets on idle');
    assert.strictEqual(mockItem.tooltip, 'Auto-Plan: Click to select plan folder and run', 'Tooltip resets on idle');

    console.log('  -> Passed: Status bar tooltip caches during steady state and updates immediately on progress events.');

    console.log('\n======================================================');
    console.log('✅ ALL PHASE 04 WATCHER BACKOFF & TOOLTIP TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase04Tests().catch(err => {
  console.error('Phase 04 Test Suite Failed:', err);
  process.exit(1);
});
