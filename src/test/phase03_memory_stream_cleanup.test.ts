// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section: string) => ({
          get: (key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} })
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
        showInformationMessage: async () => {},
        showWarningMessage: async () => {},
        showErrorMessage: async () => {}
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
        registerCommand: () => ({ dispose: () => {} })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  TranscriptWatcher,
  MAX_CHUNK_SIZE,
  CompletionResult
} from '../transcriptWatcher';
import { Orchestrator } from '../orchestrator';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase03MemoryStreamCleanupTests() {
  console.log('=== Running Phase 03: Chunked Stream Processing & Listener Leak Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-stream-'));

  try {
    // -------------------------------------------------------------
    // Test 1: Bounded Stream Chunking with Large Transcript File (10MB+)
    // -------------------------------------------------------------
    console.log('[Test 1] Verifying Bounded Chunk Streaming on 10MB+ Transcript...');
    const largeFilePath = path.join(tempDir, 'large_transcript.jsonl');
    const fileStream = fs.createWriteStream(largeFilePath, { flags: 'w' });

    // Generate ~10MB+ of dummy steps
    // 10MB / ~100 bytes = ~100,000 steps
    const dummyLine = JSON.stringify({
      step_index: 0,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'IN_PROGRESS',
      content: 'Working on phase tasks and checking repository structures...'
    }) + '\n';

    const targetSteps = 100000;
    for (let i = 0; i < targetSteps; i++) {
      fileStream.write(dummyLine);
    }

    // Append the final completion step
    const completionStep = JSON.stringify({
      step_index: targetSteps,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: 'All tasks completed successfully. Done skul9x.'
    }) + '\n';
    fileStream.write(completionStep);

    await new Promise((resolve) => fileStream.end(resolve));

    const fileStats = fs.statSync(largeFilePath);
    console.log(`Generated mock file size: ${(fileStats.size / (1024 * 1024)).toFixed(2)} MB`);
    assert.ok(fileStats.size >= 10 * 1024 * 1024, 'Mock file must be at least 10MB');

    // Watch the large file with bounded chunk streaming
    const watcher = new TranscriptWatcher({
      keyword: 'Done skul9x.',
      pollIntervalMs: 50,
      settleQuietPeriodMs: 50
    });

    const memBefore = process.memoryUsage().heapUsed;
    const watchPromise = watcher.watchFile(largeFilePath, 'conv-large-01', 0);

    const result = await watchPromise;
    const memAfter = process.memoryUsage().heapUsed;
    const memDiffMB = (memAfter - memBefore) / (1024 * 1024);
    console.log(`Memory heap delta during streaming: ${memDiffMB.toFixed(2)} MB`);

    assert.strictEqual(result.success, true, 'Stream watcher must detect completion keyword in 10MB+ file');
    assert.strictEqual(result.conversationId, 'conv-large-01');
    assert.ok(result.matchedContent?.includes('Done skul9x.'), 'Matched content must contain completion keyword');
    watcher.dispose();
    console.log('✓ Test 1 Passed: Bounded chunk streaming processed 10MB+ file accurately.\n');

    // -------------------------------------------------------------
    // Test 2: Partial Line Boundary Handling Across 64KB Chunk Boundaries
    // -------------------------------------------------------------
    console.log('[Test 2] Verifying Partial Line Boundary Splitting across 64KB Chunks...');
    const splitFilePath = path.join(tempDir, 'split_transcript.jsonl');

    // Create padding so that a valid JSON step splits exactly across the 64KB boundary
    const paddingSize = MAX_CHUNK_SIZE - 25; // 25 bytes before 64KB boundary
    const padding = 'x'.repeat(paddingSize);
    const splitObjPart1 = '{"source":"MODEL","type":"PLANNER_';
    const splitObjPart2 = 'RESPONSE","status":"DONE","content":"Split Completion. Done skul9x."}\n';

    // Chunk 1 will contain padding + splitObjPart1 (spans beyond 64KB)
    // Chunk 2 will contain splitObjPart2
    fs.writeFileSync(splitFilePath, padding + '\n' + splitObjPart1 + splitObjPart2);

    const splitWatcher = new TranscriptWatcher({
      keyword: 'Done skul9x.',
      pollIntervalMs: 50,
      settleQuietPeriodMs: 50
    });

    const splitResult = await splitWatcher.watchFile(splitFilePath, 'conv-split-01', 0);
    assert.strictEqual(splitResult.success, true, 'Should seamlessly reconstruct line split across 64KB chunks');
    assert.strictEqual(splitResult.parsed?.type, 'PLANNER_RESPONSE');
    assert.strictEqual(splitResult.parsed?.status, 'DONE');
    assert.ok(splitResult.matchedContent?.includes('Split Completion. Done skul9x.'));
    splitWatcher.dispose();
    console.log('✓ Test 2 Passed: Partial line boundaries seamlessly reconstructed.\n');

    // -------------------------------------------------------------
    // Test 3: EventEmitter Listener Leak Prevention (100+ Iterations)
    // -------------------------------------------------------------
    console.log('[Test 3] Verifying EventEmitter Listener Leak Prevention across 100+ Iterations...');
    let warningEmitted = false;
    const warningListener = (warning: Error) => {
      if (warning.name === 'MaxListenersExceededWarning') {
        warningEmitted = true;
      }
    };
    process.on('warning', warningListener);

    const testWatcher = new TranscriptWatcher();
    const testOrchestrator = new Orchestrator({ transcriptWatcher: testWatcher });

    // Verify initial maxListeners configuration
    assert.strictEqual(testWatcher.getMaxListeners(), 50, 'Watcher maxListeners should be 50');
    assert.strictEqual(testOrchestrator.getMaxListeners(), 50, 'Orchestrator maxListeners should be 50');

    // Simulate 120 rapid listener attach/detach lifecycles
    for (let i = 0; i < 120; i++) {
      const dummyCallback = () => {};

      testWatcher.on('completion', dummyCallback);
      testWatcher.on('settleStarted', dummyCallback);
      testWatcher.on('conversationDetected', dummyCallback);
      testWatcher.on('error', dummyCallback);

      testOrchestrator.on('stateChange', dummyCallback);
      testOrchestrator.on('phaseStart', dummyCallback);
      testOrchestrator.on('phaseComplete', dummyCallback);
      testOrchestrator.on('iterationComplete', dummyCallback);

      // Explicit detachment / lifecycle cleanup
      testWatcher.clearRunListeners();
      testOrchestrator.clearRunListeners();
    }

    assert.strictEqual(testWatcher.listenerCount('completion'), 0, 'Watcher completion listeners should be 0');
    assert.strictEqual(testOrchestrator.listenerCount('phaseStart'), 0, 'Orchestrator phaseStart listeners should be 0');
    assert.strictEqual(warningEmitted, false, 'No MaxListenersExceededWarning should be emitted during 120 iterations');

    process.removeListener('warning', warningListener);
    testWatcher.dispose();
    testOrchestrator.dispose();
    console.log('✓ Test 3 Passed: Zero listener leaks across 120 iterations.\n');

    // -------------------------------------------------------------
    // Test 4: Thorough Disposal and Teardown Contract
    // -------------------------------------------------------------
    console.log('[Test 4] Verifying Complete Disposal & Teardown...');
    const disposeWatcher = new TranscriptWatcher({ pollIntervalMs: 50 });
    const dummyWatchPath = path.join(tempDir, 'dispose_transcript.jsonl');
    fs.writeFileSync(dummyWatchPath, '{"status":"STARTED"}\n');

    // Start watching
    const pendingWatch = disposeWatcher.watchFile(dummyWatchPath, 'conv-dispose-01');

    // Attach listeners
    disposeWatcher.on('completion', () => {});
    disposeWatcher.on('error', () => {});

    // Dispose
    disposeWatcher.dispose();

    // Verify watcher stopped and listeners cleared
    assert.strictEqual(disposeWatcher.eventNames().length, 0, 'All event listeners must be removed upon dispose()');
    const disposeRes = await pendingWatch;
    assert.strictEqual(disposeRes.success, false, 'Pending watch must resolve with success=false when disposed');
    assert.strictEqual(disposeRes.error, 'Watcher stopped');

    const disposeOrchestrator = new Orchestrator();
    disposeOrchestrator.on('stateChange', () => {});
    disposeOrchestrator.on('error', () => {});
    disposeOrchestrator.dispose();
    assert.strictEqual(disposeOrchestrator.eventNames().length, 0, 'Orchestrator event listeners must be removed upon dispose()');
    assert.strictEqual(disposeOrchestrator.isRunning(), false, 'Orchestrator should not be running after dispose');

    console.log('✓ Test 4 Passed: Disposal contract cleanly terminates all resources.\n');

    console.log('🎉 All Phase 03 Chunked Stream & Listener Leak Tests Passed Successfully!');
  } finally {
    // Cleanup temporary test directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase03MemoryStreamCleanupTests().catch((err) => {
  console.error('Phase 03 Test Failure:', err);
  process.exit(1);
});
