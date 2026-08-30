// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      env: {
        appRoot: undefined
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  TranscriptWatcher,
  getCandidateConversationsAsync,
  findLatestConversationAsync,
  findLatestConversation,
  isValidCompletionStep
} from '../transcriptWatcher';

function createTempBrainDir(): string {
  const tempDir = path.join(os.tmpdir(), `agy_test_brain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function cleanupDir(dirPath: string) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase02TranscriptSyncTests() {
  console.log('=== Running Phase 02: Transcript Watcher Multi-Conversation Activity Arbitration Tests ===\n');

  // ==========================================================================
  // Test 1: Multi-Candidate Evaluation & Discovery Sorting
  // When multiple conversation directories exist at the same timestamp:
  // - Candidates with active transcript size & recent mtime are prioritized
  // ==========================================================================
  console.log('[Test 1] Verifying Multi-Candidate Conversation Evaluation & Active Stream Selection...');
  const brainDir1 = createTempBrainDir();
  try {
    const baseTime = Date.now() - 5000;

    // Conv A: Empty directory, no transcript file
    const convADir = path.join(brainDir1, 'conv_a_stalled');
    fs.mkdirSync(convADir, { recursive: true });

    // Conv B: Has 0-byte transcript file
    const convBDir = path.join(brainDir1, 'conv_b_empty');
    const convBLogs = path.join(convBDir, '.system_generated', 'logs');
    fs.mkdirSync(convBLogs, { recursive: true });
    fs.writeFileSync(path.join(convBLogs, 'transcript.jsonl'), '', 'utf-8');

    // Conv C: Has active growing transcript with recent mtime
    const convCDir = path.join(brainDir1, 'conv_c_active');
    const convCLogs = path.join(convCDir, '.system_generated', 'logs');
    fs.mkdirSync(convCLogs, { recursive: true });
    const stepC = JSON.stringify({
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'IN_PROGRESS',
      content: 'Initializing plan...'
    }) + '\n';
    fs.writeFileSync(path.join(convCLogs, 'transcript.jsonl'), stepC, 'utf-8');

    const candidates = await getCandidateConversationsAsync(brainDir1, baseTime);
    assert.strictEqual(candidates.length, 3, 'Should discover all 3 candidates');
    assert.strictEqual(candidates[0].convId, 'conv_c_active', 'Active conversation with transcript growth must be sorted first');

    const latestConvAsync = await findLatestConversationAsync(brainDir1, baseTime);
    assert.strictEqual(latestConvAsync, 'conv_c_active', 'findLatestConversationAsync must select active conversation');

    const latestConvSync = findLatestConversation(brainDir1, baseTime);
    assert.strictEqual(latestConvSync, 'conv_c_active', 'findLatestConversation (sync) must select active conversation');

    // Test waitForNewConversation selecting the active candidate
    const watcher1 = new TranscriptWatcher({ brainDir: brainDir1, pollIntervalMs: 50 });
    const detectedConv = await watcher1.waitForNewConversation(baseTime, undefined, 2000, 50);
    assert.strictEqual(detectedConv, 'conv_c_active', 'waitForNewConversation must return the active candidate');
    watcher1.stop();

    console.log('  ✓ Verified: Multi-candidate evaluation prioritizes active transcript streams over stalled directories.');
  } finally {
    cleanupDir(brainDir1);
  }

  // ==========================================================================
  // Test 2: Dynamic Stream Arbitration & Re-binding (watchFile)
  // When watching a stalled ghost conversation, and a sibling active conversation
  // writes steps concurrently:
  // - Watcher detects activity on sibling conversation
  // - Emits conversationRebound event
  // - Re-binds stream and resolves completion with success: true
  // ==========================================================================
  console.log('\n[Test 2] Verifying Dynamic Stream Arbitration & Automatic Re-binding...');
  const brainDir2 = createTempBrainDir();
  try {
    const sinceTimestamp = Date.now() - 1000;

    // Stalled Ghost Conversation
    const ghostConvDir = path.join(brainDir2, 'ghost_conv_123');
    const ghostLogs = path.join(ghostConvDir, '.system_generated', 'logs');
    fs.mkdirSync(ghostLogs, { recursive: true });
    const ghostTranscript = path.join(ghostLogs, 'transcript.jsonl');
    fs.writeFileSync(ghostTranscript, '', 'utf-8');

    // Active Target Conversation
    const activeConvDir = path.join(brainDir2, 'active_conv_456');
    const activeLogs = path.join(activeConvDir, '.system_generated', 'logs');
    fs.mkdirSync(activeLogs, { recursive: true });
    const activeTranscript = path.join(activeLogs, 'transcript.jsonl');
    fs.writeFileSync(activeTranscript, '', 'utf-8');

    const watcher2 = new TranscriptWatcher({
      brainDir: brainDir2,
      keyword: 'Done skul9x.',
      pollIntervalMs: 50,
      arbitrationTimeoutMs: 150, // Rapid arbitration for test
      settleQuietPeriodMs: 50,
      timeoutMs: 5000,
      sinceTimestamp
    });

    let reboundFired = false;
    let reboundOldId = '';
    let reboundNewId = '';
    let reboundNewPath = '';

    watcher2.on('conversationRebound', (oldId, newId, newPath) => {
      reboundFired = true;
      reboundOldId = oldId;
      reboundNewId = newId;
      reboundNewPath = newPath;
    });

    // Start watching the stalled ghost transcript
    const watchPromise = watcher2.watchFile(ghostTranscript, 'ghost_conv_123', 0, sinceTimestamp);

    // Concurrently write active stream into sibling conversation after 200ms
    setTimeout(() => {
      const step1 = JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'IN_PROGRESS',
        content: 'Executing task in active conversation...'
      }) + '\n';
      fs.appendFileSync(activeTranscript, step1, 'utf-8');

      setTimeout(() => {
        const step2 = JSON.stringify({
          step_index: 2,
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          tool_calls: null,
          content: 'Task completed successfully! Done skul9x.'
        }) + '\n';
        fs.appendFileSync(activeTranscript, step2, 'utf-8');
      }, 50);
    }, 200);

    const result2 = await watchPromise;

    assert.strictEqual(reboundFired, true, 'conversationRebound event must be fired');
    assert.strictEqual(reboundOldId, 'ghost_conv_123', 'Old conversation ID must match stalled conv');
    assert.strictEqual(reboundNewId, 'active_conv_456', 'New conversation ID must match active sibling conv');
    assert.strictEqual(path.normalize(reboundNewPath), path.normalize(activeTranscript), 'New file path must match active transcript');

    assert.strictEqual(result2.success, true, 'Watch result must succeed');
    assert.strictEqual(result2.conversationId, 'active_conv_456', 'Result conversationId must be updated to active conv');
    assert.ok(result2.matchedContent?.includes('Done skul9x.'), 'Matched content must contain completion keyword');

    watcher2.stop();
    console.log('  ✓ Verified: Automatic stream arbitration gracefully re-bound from stalled stream to active sibling stream.');
  } finally {
    cleanupDir(brainDir2);
  }

  // ==========================================================================
  // Test 3: Strict Turn Validation & Discard Rules on Active / Re-bound Stream
  // ==========================================================================
  console.log('\n[Test 3] Verifying Strict Turn Validation & Tool Call Discard Rules...');
  assert.strictEqual(
    isValidCompletionStep(
      { source: 'USER', type: 'USER_INPUT', status: 'DONE', content: 'Done skul9x.' },
      'Done skul9x.'
    ),
    false,
    'USER_INPUT with keyword must be rejected'
  );

  assert.strictEqual(
    isValidCompletionStep(
      { source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'IN_PROGRESS', content: 'Done skul9x.' },
      'Done skul9x.'
    ),
    false,
    'IN_PROGRESS status must be rejected'
  );

  assert.strictEqual(
    isValidCompletionStep(
      {
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: [{ name: 'run_command' }],
        content: 'Done skul9x.'
      },
      'Done skul9x.'
    ),
    false,
    'Active tool_calls must be rejected'
  );

  assert.strictEqual(
    isValidCompletionStep(
      {
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: [],
        content: 'Task completed. Done skul9x.'
      },
      'Done skul9x.'
    ),
    true,
    'Valid MODEL DONE step with empty tool_calls must be accepted'
  );
  console.log('  ✓ Verified: Strict turn validation rules strictly enforce completion step integrity.');

  // ==========================================================================
  // Test 4: Settle Quiet Period Cancellation on Stream
  // When a completion keyword arrives but subsequent activity occurs before quiet
  // period settles:
  // - settleCancelled event is fired
  // - Final settle restarts on actual final completion step
  // ==========================================================================
  console.log('\n[Test 4] Verifying Settle Quiet Period Debouncing & Stream Continuity...');
  const brainDir3 = createTempBrainDir();
  try {
    const convDir = path.join(brainDir3, 'conv_settle_test');
    const logsDir = path.join(convDir, '.system_generated', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const transcriptPath = path.join(logsDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, '', 'utf-8');

    const watcher3 = new TranscriptWatcher({
      brainDir: brainDir3,
      keyword: 'Done skul9x.',
      pollIntervalMs: 30,
      settleQuietPeriodMs: 120,
      timeoutMs: 4000
    });

    let settleStartedCount = 0;
    let settleCancelledCount = 0;

    watcher3.on('settleStarted', () => { settleStartedCount++; });
    watcher3.on('settleCancelled', () => { settleCancelledCount++; });

    const watchPromise = watcher3.watchFile(transcriptPath, 'conv_settle_test', 0);

    // Write premature completion step
    setTimeout(() => {
      const prematureStep = JSON.stringify({
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: null,
        content: 'Premature done. Done skul9x.'
      }) + '\n';
      fs.appendFileSync(transcriptPath, prematureStep, 'utf-8');

      // Interrupt with intermediate tool or model log within quiet period (after 40ms < 120ms)
      setTimeout(() => {
        const intermediateStep = JSON.stringify({
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          status: 'IN_PROGRESS',
          content: 'Wait, doing one more task...'
        }) + '\n';
        fs.appendFileSync(transcriptPath, intermediateStep, 'utf-8');

        // Write final genuine completion step after 60ms
        setTimeout(() => {
          const finalStep = JSON.stringify({
            source: 'MODEL',
            type: 'PLANNER_RESPONSE',
            status: 'DONE',
            tool_calls: [],
            content: 'Truly finished now! Done skul9x.'
          }) + '\n';
          fs.appendFileSync(transcriptPath, finalStep, 'utf-8');
        }, 60);
      }, 40);
    }, 50);

    const result3 = await watchPromise;
    assert.strictEqual(result3.success, true);
    assert.ok(settleStartedCount >= 2, 'settleStarted should fire for both premature and final steps');
    assert.strictEqual(settleCancelledCount, 1, 'settleCancelled must fire when intermediate activity arrives');
    assert.ok(result3.matchedContent?.includes('Truly finished now!'));

    watcher3.stop();
    console.log('  ✓ Verified: Settle quiet period cleanly cancelled on intervening activity and completed on genuine final step.');
  } finally {
    cleanupDir(brainDir3);
  }

  console.log('\n========================================================================');
  console.log('✅ ALL PHASE 02 TRANSCRIPT WATCHER MULTI-CONVERSATION SYNC TESTS PASSED!');
  console.log('========================================================================\n');
}

runPhase02TranscriptSyncTests().catch((err) => {
  console.error('Phase 02 Test Suite Failed:', err);
  process.exit(1);
});
