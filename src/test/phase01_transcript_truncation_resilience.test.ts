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
        })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TranscriptWatcher, CompletionResult } from '../transcriptWatcher';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase01TranscriptTruncationResilienceTests() {
  console.log('=== Running Phase 01: Transcript Truncation & Rotation Resilience Tests ===\n');

  const tempBrainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-truncation-test-'));

  try {
    // -------------------------------------------------------------------------
    // Test 1: Active file truncation (~4KB down to ~300 bytes) with clean reset
    // -------------------------------------------------------------------------
    console.log('[Test 1] Verifying truncation detection, readOffset reset, settle timer cleanup, and immediate parsing from byte 0...');
    const conv1Id = 'conv-truncation-test';
    const conv1LogsDir = path.join(tempBrainDir, conv1Id, '.system_generated', 'logs');
    fs.mkdirSync(conv1LogsDir, { recursive: true });
    const transcriptPath1 = path.join(conv1LogsDir, 'transcript.jsonl');

    // Create initial file with ~4KB of content (e.g. 40 intermediate lines)
    let initialLines = '';
    for (let i = 0; i < 40; i++) {
      initialLines += JSON.stringify({
        step_index: i,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'IN_PROGRESS',
        content: `Progress line #${i} generating data stream filling buffer bytes... [padding: ${'x'.repeat(60)}]`,
        tool_calls: []
      }) + '\n';
    }
    fs.writeFileSync(transcriptPath1, initialLines, 'utf8');
    const initialFileSize = fs.statSync(transcriptPath1).size;
    assert.ok(initialFileSize >= 4000, `Initial file size must be >= 4000 bytes (got ${initialFileSize})`);

    const keyword = 'TASK_FINISHED_SIGNAL';
    const watcher1 = new TranscriptWatcher({
      brainDir: tempBrainDir,
      keyword,
      timeoutMs: 8000,
      pollIntervalMs: 50,
      settleQuietPeriodMs: 300
    });

    // Track truncation event and offset when truncation is handled
    let truncationEventData: any = null;
    let offsetAtTruncation = -1;
    watcher1.on('fileTruncated', (data) => {
      truncationEventData = data;
      offsetAtTruncation = watcher1.getReadOffset();
    });

    // Track offset when the new completion settles
    let offsetAtSettle = -1;
    watcher1.on('settleStarted', () => {
      offsetAtSettle = watcher1.getReadOffset();
    });

    const watchPromise1 = watcher1.watchFile(transcriptPath1, conv1Id);

    // Allow watcher to read and consume the initial 4KB
    let attempts = 0;
    while (watcher1.getReadOffset() < initialFileSize && attempts < 50) {
      await sleep(30);
      attempts++;
    }
    assert.strictEqual(
      watcher1.getReadOffset(),
      initialFileSize,
      `Watcher readOffset must catch up to initial file size (${initialFileSize})`
    );

    // Simulate an initial keyword match that triggers a settleTimer (quiet period of 300ms)
    const oldPendingStep = JSON.stringify({
      step_index: 99,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: `Pre-truncation stale keyword ${keyword}`,
      tool_calls: []
    }) + '\n';
    fs.appendFileSync(transcriptPath1, oldPendingStep, 'utf8');

    // Wait briefly (60ms) for settleStarted to fire but well before 300ms settle expiry
    await sleep(60);

    // Now simulate transcript truncation/rotation: rewrite the file down to ~300 bytes
    // with a brand new completion step that should be resolved instead of the old one
    const newCompletionContent = `Brand new post-truncation completion ${keyword} successfully parsed from offset 0`;
    const truncatedContent = JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: newCompletionContent,
      tool_calls: []
    }) + '\n';

    fs.writeFileSync(transcriptPath1, truncatedContent, 'utf8');
    const newSize = fs.statSync(transcriptPath1).size;
    assert.ok(newSize < 500 && newSize > 100, `Truncated file size must be ~300 bytes (got ${newSize})`);

    // Await completion result from watchPromise
    const result1: CompletionResult = await watchPromise1;

    // Verify assertions:
    // 1. Truncation was detected cleanly with fileTruncated event
    assert.ok(truncationEventData, 'fileTruncated event must have been emitted');
    assert.strictEqual(truncationEventData.filePath, transcriptPath1);
    assert.ok(truncationEventData.previousOffset >= initialFileSize, 'previousOffset must reflect pre-truncation offset');
    assert.strictEqual(truncationEventData.newSize, newSize, 'newSize must reflect truncated file size');

    // 2. readOffset was reset to 0 upon truncation
    assert.strictEqual(offsetAtTruncation, 0, 'readOffset must reset to 0 upon file truncation');

    // 3. The watcher immediately read new content from byte 0 in the same cycle
    assert.strictEqual(
      offsetAtSettle,
      newSize,
      `Watcher must immediately read new content from byte 0 in the same cycle (${newSize})`
    );

    // 4. The watcher resolved with the NEW content from offset 0, NOT the pre-truncation stale content
    assert.strictEqual(result1.success, true, 'Watcher must succeed');
    assert.strictEqual(result1.conversationId, conv1Id);
    assert.strictEqual(
      result1.matchedContent,
      newCompletionContent,
      'Watcher must resolve with the new post-truncation content'
    );

    watcher1.stop();
    console.log('  ✓ File truncation from ~4KB to ~300 bytes handled cleanly in a single cycle.');

    // -------------------------------------------------------------------------
    // Test 2: Zero-byte file truncation edge case & subsequent recovery
    // -------------------------------------------------------------------------
    console.log('[Test 2] Verifying zero-byte truncation handling and recovery when content is appended 200ms later...');
    const conv2Id = 'conv-zero-byte-truncation';
    const conv2LogsDir = path.join(tempBrainDir, conv2Id, '.system_generated', 'logs');
    fs.mkdirSync(conv2LogsDir, { recursive: true });
    const transcriptPath2 = path.join(conv2LogsDir, 'transcript.jsonl');

    // Initial content of ~2KB
    let conv2Initial = '';
    for (let i = 0; i < 20; i++) {
      conv2Initial += JSON.stringify({
        step_index: i,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'IN_PROGRESS',
        content: `Initial data line #${i} for zero-byte test ${'y'.repeat(70)}`,
        tool_calls: []
      }) + '\n';
    }
    fs.writeFileSync(transcriptPath2, conv2Initial, 'utf8');
    const conv2InitialSize = fs.statSync(transcriptPath2).size;

    const zeroByteKeyword = 'ZERO_BYTE_RECOVERY_KEYWORD';
    const watcher2 = new TranscriptWatcher({
      brainDir: tempBrainDir,
      keyword: zeroByteKeyword,
      timeoutMs: 8000,
      pollIntervalMs: 50,
      settleQuietPeriodMs: 150
    });

    let zeroByteTruncationDetected = false;
    let offsetAtZeroByteTruncation = -1;
    watcher2.on('fileTruncated', (data) => {
      if (data.newSize === 0) {
        zeroByteTruncationDetected = true;
        offsetAtZeroByteTruncation = watcher2.getReadOffset();
      }
    });

    let offsetAtRecoveredSettle = -1;
    watcher2.on('settleStarted', () => {
      offsetAtRecoveredSettle = watcher2.getReadOffset();
    });

    const watchPromise2 = watcher2.watchFile(transcriptPath2, conv2Id);

    // Allow watcher to consume initial 2KB
    attempts = 0;
    while (watcher2.getReadOffset() < conv2InitialSize && attempts < 50) {
      await sleep(30);
      attempts++;
    }
    assert.strictEqual(watcher2.getReadOffset(), conv2InitialSize);

    // Truncate file to 0 bytes
    fs.writeFileSync(transcriptPath2, '', 'utf8');
    assert.strictEqual(fs.statSync(transcriptPath2).size, 0);

    // Wait 200ms as required by technical specification
    await sleep(200);

    // Verify watcher recognized 0-byte truncation and reset readOffset to 0
    assert.strictEqual(zeroByteTruncationDetected, true, 'Zero-byte truncation event must be emitted');
    assert.strictEqual(offsetAtZeroByteTruncation, 0, 'readOffset at zero-byte truncation must be 0');
    assert.strictEqual(watcher2.getReadOffset(), 0, 'readOffset must remain 0 while file is 0 bytes');

    // Write new completion step into the previously 0-byte file
    const recoveredStepContent = `Successfully recovered after zero byte truncation ${zeroByteKeyword}`;
    const recoveredStep = JSON.stringify({
      step_index: 0,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: recoveredStepContent,
      tool_calls: []
    }) + '\n';
    fs.writeFileSync(transcriptPath2, recoveredStep, 'utf8');
    const recoveredSize = fs.statSync(transcriptPath2).size;

    // Await completion
    const result2: CompletionResult = await watchPromise2;
    assert.strictEqual(result2.success, true, 'Watcher must succeed in recovery after zero-byte truncation');
    assert.strictEqual(result2.matchedContent, recoveredStepContent);
    assert.strictEqual(offsetAtRecoveredSettle, recoveredSize, 'Watcher must read recovered file up to its full size');

    watcher2.stop();
    console.log('  ✓ Zero-byte truncation cleanly resets readOffset to 0 and recovers on new data.');

    console.log('\n=== All Phase 01 Truncation Resilience Tests PASSED! ===\n');
  } finally {
    // Clean up temporary test files
    try {
      fs.rmSync(tempBrainDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase01TranscriptTruncationResilienceTests().catch((err) => {
  console.error('Phase 01 test failed:', err);
  process.exit(1);
});
