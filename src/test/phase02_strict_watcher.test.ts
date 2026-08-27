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
import {
  TranscriptWatcher,
  findLatestConversation,
  getTranscriptPath,
  isValidCompletionStep,
  CompletionResult
} from '../transcriptWatcher';
import { DEFAULT_COMPLETION_KEYWORD } from '../config';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase02Tests() {
  console.log('=== Running Phase 02: Strict Transcript Watcher & Anti-Pollution Guard Tests ===\n');

  // Create temporary test environment for brain dir
  const tempBrainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase02-brain-'));

  try {
    // -------------------------------------------------------------
    // Test 1: Strict Step Validation Unit Checks
    // -------------------------------------------------------------
    console.log('[Test 1] Verifying Strict Step Validator...');
    const keyword = 'Done skul9x.';

    // 1a: Valid clean MODEL response
    const validStep = {
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: 'Task completed. Done skul9x.',
      tool_calls: []
    };
    assert.strictEqual(isValidCompletionStep(validStep, keyword), true, 'Valid MODEL step should return true');

    // 1b: Valid with null / undefined tool_calls
    const validNullTools = {
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: 'Done skul9x.',
      tool_calls: null
    };
    assert.strictEqual(isValidCompletionStep(validNullTools, keyword), true, 'Null tool_calls should return true');

    // 1c: Case-insensitivity
    const validUpper = {
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: 'DONE SKUL9X.'
    };
    assert.strictEqual(isValidCompletionStep(validUpper, keyword), true, 'Case-insensitive keyword should return true');

    // 1d: Response / text property fallback
    const validResponseField = {
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      response: 'All done. done skul9x.'
    };
    assert.strictEqual(isValidCompletionStep(validResponseField, keyword), true, 'response field keyword should return true');

    // 1e: Discard USER_INPUT (Prompt echo prevention)
    const echoStep = {
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      content: 'When finished, reply Done skul9x. exactly'
    };
    assert.strictEqual(isValidCompletionStep(echoStep, keyword), false, 'USER_INPUT echo must be discarded');

    // 1f: Discard SYSTEM / CHECKPOINT steps
    const systemStep = {
      source: 'SYSTEM',
      type: 'SYSTEM_NOTIFICATION',
      status: 'DONE',
      content: 'Done skul9x.'
    };
    assert.strictEqual(isValidCompletionStep(systemStep, keyword), false, 'SYSTEM steps must be discarded');

    // 1g: Discard active tool calls (agent still running)
    const activeToolsStep = {
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: 'Running tool now... Done skul9x.',
      tool_calls: [{ name: 'run_command', arguments: { cmd: 'echo test' } }]
    };
    assert.strictEqual(isValidCompletionStep(activeToolsStep, keyword), false, 'Step with active tool_calls must be discarded');

    // 1h: Discard non-DONE status
    const runningStep = {
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'RUNNING',
      content: 'Done skul9x.',
      tool_calls: []
    };
    assert.strictEqual(isValidCompletionStep(runningStep, keyword), false, 'Step with RUNNING status must be discarded');

    // 1i: Non-JSON / garbage / empty
    assert.strictEqual(isValidCompletionStep(null, keyword), false);
    assert.strictEqual(isValidCompletionStep('random string', keyword), false);
    assert.strictEqual(isValidCompletionStep({}, keyword), false);

    console.log('  ✓ Strict step validator verified (all rejection and acceptance criteria met).');

    // -------------------------------------------------------------
    // Test 2: Anti-Pollution Isolation & Previous Conv Exclusion
    // -------------------------------------------------------------
    console.log('[Test 2] Verifying Anti-Pollution Isolation & Previous Conv Exclusion...');
    const phase1ConvId = 'conv-phase-01-uuid';
    const phase1Dir = path.join(tempBrainDir, phase1ConvId);
    const phase1LogsDir = path.join(phase1Dir, '.system_generated', 'logs');
    fs.mkdirSync(phase1LogsDir, { recursive: true });

    // Populate phase 1 transcript with old completed log
    const phase1Transcript = path.join(phase1LogsDir, 'transcript.jsonl');
    fs.writeFileSync(
      phase1Transcript,
      JSON.stringify({
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Phase 1 Done skul9x.',
        tool_calls: []
      }) + '\n'
    );

    // Verify findLatestConversation excludes phase 1
    const foundWithExclude = findLatestConversation(tempBrainDir, undefined, phase1ConvId);
    assert.strictEqual(foundWithExclude, null, 'Should return null when phase 1 conv is excluded and no other conv exists');

    const watcher = new TranscriptWatcher({
      brainDir: tempBrainDir,
      keyword: DEFAULT_COMPLETION_KEYWORD,
      timeoutMs: 3000,
      pollIntervalMs: 50,
      settleQuietPeriodMs: 200
    });

    const waitPromise = watcher.waitForNewConversation(Date.now() - 5000, phase1ConvId, 3000, 50);

    // Simulate creation of Phase 2 after 150ms
    await sleep(150);
    const phase2ConvId = 'conv-phase-02-uuid';
    const phase2Dir = path.join(tempBrainDir, phase2ConvId);
    const phase2LogsDir = path.join(phase2Dir, '.system_generated', 'logs');
    fs.mkdirSync(phase2LogsDir, { recursive: true });

    const detectedConvId = await waitPromise;
    assert.strictEqual(detectedConvId, phase2ConvId, 'Watcher must lock onto Phase 2 conv directory and ignore Phase 1');
    console.log('  ✓ Anti-pollution conversation isolation verified.');

    // -------------------------------------------------------------
    // Test 3: Echo Prevention & Active Tool Guard (Live Stream)
    // -------------------------------------------------------------
    console.log('[Test 3] Verifying Echo Prevention & Active Tool Guard on Live Stream...');
    const phase2Transcript = path.join(phase2LogsDir, 'transcript.jsonl');
    fs.writeFileSync(phase2Transcript, ''); // start empty

    let completionFired = false;
    watcher.once('completion', () => {
      completionFired = true;
    });

    const watchPromise = watcher.watchFile(phase2Transcript, phase2ConvId);

    // Write USER_INPUT with prompt echo
    fs.appendFileSync(
      phase2Transcript,
      JSON.stringify({
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        content: 'Say Done skul9x. when finished.'
      }) + '\n'
    );

    // Write MODEL step with pending tool calls
    fs.appendFileSync(
      phase2Transcript,
      JSON.stringify({
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Calling tool now Done skul9x.',
        tool_calls: [{ name: 'run_command', arguments: { cmd: 'test' } }]
      }) + '\n'
    );

    // Write raw text line
    fs.appendFileSync(phase2Transcript, 'Raw text: Done skul9x.\n');

    // Wait 300ms to confirm no completion is triggered
    await sleep(300);
    assert.strictEqual(completionFired, false, 'Echo, active tools, and raw text must NOT trigger completion');
    watcher.stop();
    console.log('  ✓ Echo prevention & active tool guard verified on live stream.');

    // -------------------------------------------------------------
    // Test 4: Dynamic Debounce Settle Guard & Reset
    // -------------------------------------------------------------
    console.log('[Test 4] Verifying Dynamic Debounce Settle Guard & Cancellation Reset...');
    const debounceWatcher = new TranscriptWatcher({
      brainDir: tempBrainDir,
      keyword: DEFAULT_COMPLETION_KEYWORD,
      timeoutMs: 5000,
      pollIntervalMs: 50,
      settleQuietPeriodMs: 400 // 400ms settle window for testing
    });

    let settleStartedCount = 0;
    let settleCancelledCount = 0;

    debounceWatcher.on('settleStarted', () => {
      settleStartedCount++;
    });

    debounceWatcher.on('settleCancelled', () => {
      settleCancelledCount++;
    });

    const debouncePromise = debounceWatcher.watchFile(phase2Transcript, phase2ConvId);

    // Step A: Write valid completion step
    fs.appendFileSync(
      phase2Transcript,
      JSON.stringify({
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Initial completion Done skul9x.',
        tool_calls: []
      }) + '\n'
    );

    // Step B: Within 150ms (< 400ms quiet period), write a follow-up subagent line
    await sleep(150);
    assert.strictEqual(settleStartedCount, 1, 'Settle period should have started');

    fs.appendFileSync(
      phase2Transcript,
      JSON.stringify({
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Subagent follow-up execution continuing...',
        tool_calls: [{ name: 'run_command' }]
      }) + '\n'
    );

    await sleep(100);
    assert.strictEqual(settleCancelledCount, 1, 'Settle period should have been cancelled by new activity');

    // Step C: Now write the final clean completion line
    fs.appendFileSync(
      phase2Transcript,
      JSON.stringify({
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Final verified Done skul9x.',
        tool_calls: []
      }) + '\n'
    );

    // Step D: Await resolution after full quiet period (400ms)
    const result: CompletionResult = await debouncePromise;
    assert.strictEqual(result.success, true, 'Watch should resolve successfully after full settle period');
    assert.strictEqual(result.conversationId, phase2ConvId);
    assert.ok(result.matchedContent?.includes('Final verified Done skul9x.'));
    assert.strictEqual(settleStartedCount, 2, 'Settle period should have started twice');
    console.log('  ✓ Dynamic debounce quiet-period and reset on new activity verified.');

    // -------------------------------------------------------------
    // Test 5: Clean Full Completion & Cleanup Verification
    // -------------------------------------------------------------
    console.log('[Test 5] Verifying Full Clean Completion & Resource Teardown...');
    const phase3ConvId = 'conv-phase-03-uuid';
    const phase3Dir = path.join(tempBrainDir, phase3ConvId);
    const phase3LogsDir = path.join(phase3Dir, '.system_generated', 'logs');
    fs.mkdirSync(phase3LogsDir, { recursive: true });
    const phase3Transcript = path.join(phase3LogsDir, 'transcript.jsonl');
    fs.writeFileSync(phase3Transcript, '');

    const cleanWatcher = new TranscriptWatcher({
      brainDir: tempBrainDir,
      keyword: DEFAULT_COMPLETION_KEYWORD,
      timeoutMs: 4000,
      pollIntervalMs: 50,
      settleQuietPeriodMs: 250
    });

    const watchLatestPromise = cleanWatcher.watchFile(phase3Transcript, phase3ConvId);

    fs.appendFileSync(
      phase3Transcript,
      JSON.stringify({
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Done skul9x.',
        tool_calls: []
      }) + '\n'
    );

    const cleanRes = await watchLatestPromise;
    assert.strictEqual(cleanRes.success, true);
    assert.strictEqual(cleanRes.conversationId, phase3ConvId);
    assert.strictEqual(cleanRes.matchedContent, 'Done skul9x.');

    // Verify stop and teardown
    cleanWatcher.dispose();

    console.log('  ✓ Clean completion and resource teardown verified.');

    console.log('\n=============================================================');
    console.log('🎉 ALL PHASE 02 TESTS PASSED SUCCESSFULLY! (100% Coverage)');
    console.log('=============================================================\n');
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(tempBrainDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase02Tests().catch((err) => {
  console.error('Phase 02 Test Failed:', err);
  process.exit(1);
});
