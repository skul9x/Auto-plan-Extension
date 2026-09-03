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

async function runPhase03ArbitrationGuardTests() {
  console.log('=== Running Phase 03: Transcript Arbitration Guard & Real-Time Completion Verification Tests ===\n');

  // --------------------------------------------------------------------------
  // Subtest 1: Verify default arbitrationTimeoutMs is 15000ms
  // --------------------------------------------------------------------------
  console.log('[Test 1] Verifying default arbitrationTimeoutMs is raised to 15000ms...');
  const defaultWatcher = new TranscriptWatcher();
  assert.strictEqual(
    defaultWatcher.getOptions().arbitrationTimeoutMs,
    15000,
    'default arbitrationTimeoutMs must be 15000ms'
  );
  defaultWatcher.dispose();
  console.log('  -> PASSED: default arbitrationTimeoutMs is 15000ms');

  // --------------------------------------------------------------------------
  // Subtest 2: Verify isValidCompletionStep minTimestamp validation
  // --------------------------------------------------------------------------
  console.log('\n[Test 2] Verifying isValidCompletionStep temporal validation...');
  const keyword = 'Done skul9x.';
  const now = Date.now();
  const pastTime = now - 10000;
  const futureTime = now + 1000;

  // Step with past timestamp should be rejected when minTimestamp is now
  const staleStep = {
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    tool_calls: null,
    content: 'Completed earlier. Done skul9x.',
    timestamp: pastTime
  };
  assert.strictEqual(
    isValidCompletionStep(staleStep, keyword, now),
    false,
    'Stale step with timestamp < minTimestamp must be rejected'
  );

  // Step with createdAt in the past should be rejected
  const staleCreatedAtStep = {
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    tool_calls: null,
    content: 'Completed earlier. Done skul9x.',
    createdAt: new Date(pastTime).toISOString()
  };
  assert.strictEqual(
    isValidCompletionStep(staleCreatedAtStep, keyword, now),
    false,
    'Stale step with createdAt < minTimestamp must be rejected'
  );

  // Step with valid timestamp >= minTimestamp should be accepted
  const validCurrentStep = {
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    tool_calls: null,
    content: 'Phase finished! Done skul9x.',
    timestamp: futureTime
  };
  assert.strictEqual(
    isValidCompletionStep(validCurrentStep, keyword, now),
    true,
    'Valid step with timestamp >= minTimestamp must be accepted'
  );

  // Step with no timestamp property should be accepted for backward compatibility
  const noTsStep = {
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    tool_calls: null,
    content: 'Phase finished! Done skul9x.'
  };
  assert.strictEqual(
    isValidCompletionStep(noTsStep, keyword, now),
    true,
    'Step without timestamp must be accepted for backwards compatibility'
  );
  console.log('  -> PASSED: isValidCompletionStep temporal validation works as expected');

  // --------------------------------------------------------------------------
  // Subtest 3: Core Scenario: Historical Transcript Arbitration Guard
  // 1. Brain dir with historical conversation containing old "Done skul9x."
  // 2. Initialize TranscriptWatcher with sinceTimestamp = Date.now()
  // 3. Simulate an LLM thinking delay of 4 seconds (exceeding arbitration timeout)
  // 4. Verify watcher does NOT rebind to historical conversation or emit false completion
  // 5. Write brand new completion step to a new transcript file with timestamp >= sinceTimestamp
  // 6. Verify watcher detects genuine completion and resolves successfully
  // --------------------------------------------------------------------------
  console.log('\n[Test 3] Verifying Historical Transcript Arbitration Guard during 4s LLM delay...');
  const brainDir = createTempBrainDir();

  try {
    // 1. Create historical conversation with old completion token
    const histConvId = 'hist_conv_older_phase';
    const histLogsDir = path.join(brainDir, histConvId, '.system_generated', 'logs');
    fs.mkdirSync(histLogsDir, { recursive: true });
    const histTranscriptPath = path.join(histLogsDir, 'transcript.jsonl');

    const historicalStep = JSON.stringify({
      step_index: 10,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      tool_calls: null,
      content: 'Old Phase finished! Done skul9x.',
      timestamp: Date.now() - 30000
    }) + '\n';
    fs.writeFileSync(histTranscriptPath, historicalStep, 'utf-8');

    // Force mtime and atime to 30 seconds ago
    const pastSec = (Date.now() - 30000) / 1000;
    fs.utimesSync(histTranscriptPath, pastSec, pastSec);
    fs.utimesSync(path.join(brainDir, histConvId), pastSec, pastSec);

    await sleep(100);

    // 2. Phase start boundary: sinceTimestamp
    const sinceTimestamp = Date.now();

    // Active stalled conversation (waiting for LLM response)
    const activeConvId = 'active_conv_current_phase';
    const activeLogsDir = path.join(brainDir, activeConvId, '.system_generated', 'logs');
    fs.mkdirSync(activeLogsDir, { recursive: true });
    const activeTranscriptPath = path.join(activeLogsDir, 'transcript.jsonl');
    fs.writeFileSync(activeTranscriptPath, '', 'utf-8');

    // Set arbitrationTimeoutMs to 2000ms so arbitration runs during the 4s delay
    const watcher = new TranscriptWatcher({
      brainDir,
      keyword: 'Done skul9x.',
      sinceTimestamp,
      pollIntervalMs: 50,
      settleQuietPeriodMs: 50,
      arbitrationTimeoutMs: 2000,
      timeoutMs: 15000
    });

    let reboundToHistorical = false;
    let reboundConversations: string[] = [];

    watcher.on('conversationRebound', (_oldId, newId) => {
      reboundConversations.push(newId);
      if (newId === histConvId) {
        reboundToHistorical = true;
      }
    });

    let isCompleted = false;
    let completionResult: any = null;

    const watchPromise = watcher.watchFile(
      activeTranscriptPath,
      activeConvId,
      0,
      sinceTimestamp
    ).then((res) => {
      isCompleted = true;
      completionResult = res;
      return res;
    });

    // 3. Simulate LLM thinking delay of 4 seconds (exceeds 2s arbitration timeout)
    console.log('  Simulating LLM thinking delay of 4 seconds...');
    await sleep(4000);

    // 4. Verify watcher did NOT rebind to historical conversation or emit false completion
    assert.strictEqual(
      reboundToHistorical,
      false,
      'Watcher must NEVER rebind to historical conversation during arbitration'
    );
    assert.strictEqual(
      isCompleted,
      false,
      'Watcher must NOT emit false completion while LLM is still thinking'
    );
    console.log('  -> Verified: No false rebind and no premature completion during 4s thinking delay');

    // 5. Write genuine completion step to a new conversation created for this phase
    const genuineConvId = 'genuine_conv_active_response';
    const genuineLogsDir = path.join(brainDir, genuineConvId, '.system_generated', 'logs');
    fs.mkdirSync(genuineLogsDir, { recursive: true });
    const genuineTranscriptPath = path.join(genuineLogsDir, 'transcript.jsonl');

    const genuineStep = JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      tool_calls: null,
      content: 'Current phase successfully implemented! Done skul9x.',
      timestamp: Date.now()
    }) + '\n';

    fs.writeFileSync(genuineTranscriptPath, genuineStep, 'utf-8');

    // 6. Verify watcher detects the genuine completion step and resolves successfully
    console.log('  Awaiting genuine completion resolution...');
    const result = await watchPromise;

    assert.strictEqual(result.success, true, 'Result must be success: true');
    assert.strictEqual(
      result.conversationId,
      genuineConvId,
      `Result conversationId must be genuine conv ID (${genuineConvId})`
    );
    assert.ok(
      result.matchedContent?.includes('Done skul9x.'),
      'Matched content must contain completion keyword'
    );
    assert.strictEqual(
      reboundToHistorical,
      false,
      'Watcher must never have rebound to historical conversation'
    );
    console.log('  -> PASSED: Genuine completion detected and resolved successfully');

    watcher.dispose();

    // --------------------------------------------------------------------------
    // Subtest 4: Initial Offset Preservation on Candidate Rebind
    // When rebinding to a pre-existing conversation, readOffset must fast-forward
    // past the pre-existing content so old completion tokens are ignored.
    // --------------------------------------------------------------------------
    console.log('\n[Test 4] Verifying Initial Offset Preservation on Candidate Rebind...');
    const preExistingConvId = 'pre_existing_conv';
    const preExistingLogs = path.join(brainDir, preExistingConvId, '.system_generated', 'logs');
    fs.mkdirSync(preExistingLogs, { recursive: true });
    const preExistingTranscript = path.join(preExistingLogs, 'transcript.jsonl');

    // Write pre-existing completed step from older phase
    const oldStep = JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      tool_calls: null,
      content: 'Old completed phase! Done skul9x.',
      timestamp: Date.now() - 20000
    }) + '\n';
    fs.writeFileSync(preExistingTranscript, oldStep, 'utf-8');
    const baselineSize = Buffer.byteLength(oldStep, 'utf-8');

    const pastTimeSec = (Date.now() - 20000) / 1000;
    fs.utimesSync(preExistingTranscript, pastTimeSec, pastTimeSec);

    await sleep(50);
    const phase2Since = Date.now();

    // Create watcher for a ghost stream with rapid arbitration
    const offsetWatcher = new TranscriptWatcher({
      brainDir,
      keyword: 'Done skul9x.',
      sinceTimestamp: phase2Since,
      pollIntervalMs: 50,
      settleQuietPeriodMs: 50,
      arbitrationTimeoutMs: 150,
      timeoutMs: 5000
    });

    const ghostConvId = 'ghost_stream_placeholder';
    const ghostLogs = path.join(brainDir, ghostConvId, '.system_generated', 'logs');
    fs.mkdirSync(ghostLogs, { recursive: true });
    const ghostTranscript = path.join(ghostLogs, 'transcript.jsonl');
    fs.writeFileSync(ghostTranscript, '', 'utf-8');

    let reboundToPreExisting = false;
    offsetWatcher.on('conversationRebound', (_oldId, newId) => {
      if (newId === preExistingConvId) {
        reboundToPreExisting = true;
      }
    });

    const offsetWatchPromise = offsetWatcher.watchFile(
      ghostTranscript,
      ghostConvId,
      0,
      phase2Since
    );

    // Wait 250ms with no new data in preExistingTranscript
    await sleep(250);
    assert.strictEqual(
      reboundToPreExisting,
      false,
      'Must NOT rebind to pre-existing file when no byte growth occurred'
    );

    // Now append genuine new work and completion step to preExistingTranscript
    const newStep = JSON.stringify({
      step_index: 2,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      tool_calls: null,
      content: 'Phase 2 newly implemented! Done skul9x.',
      timestamp: Date.now()
    }) + '\n';
    fs.appendFileSync(preExistingTranscript, newStep, 'utf-8');

    const offsetResult = await offsetWatchPromise;
    assert.strictEqual(offsetResult.success, true);
    assert.strictEqual(offsetResult.conversationId, preExistingConvId);
    assert.ok(
      offsetResult.matchedContent?.includes('Phase 2 newly implemented!'),
      'Must match newly appended step, not the old pre-existing step'
    );

    offsetWatcher.dispose();
    console.log('  -> PASSED: Initial offset was preserved and only newly appended tokens were processed');
  } finally {
    // 7. Clean up test files
    cleanupDir(brainDir);
  }

  console.log('\n=== All Phase 03 Transcript Arbitration Guard Tests Passed! ===');
}

runPhase03ArbitrationGuardTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
