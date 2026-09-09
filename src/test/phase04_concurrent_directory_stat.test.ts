// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue,
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
  asyncPool,
  clearBrainDirCache
} from '../transcriptWatcher';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase04Verification(): Promise<void> {
  console.log('================================================================');
  console.log(' Phase 04 Verification: Concurrent Directory Stat Scanning (PERF-05)');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // Test 1: Unit test asyncPool concurrency boundedness
  // -------------------------------------------------------------------------
  console.log('[Test 1] Testing asyncPool concurrency boundedness (max <= 16)...');
  const items = Array.from({ length: 64 }, (_, i) => i);
  let activePromises = 0;
  let maxConcurrent = 0;

  const results = await asyncPool(16, items, async (item) => {
    activePromises++;
    if (activePromises > maxConcurrent) {
      maxConcurrent = activePromises;
    }
    await sleep(8);
    activePromises--;
    return item * 2;
  });

  assert.strictEqual(results.length, 64, 'asyncPool should return results for all items');
  assert.strictEqual(maxConcurrent, 16, `Expected maximum concurrency to hit limit 16, got ${maxConcurrent}`);
  assert.ok(maxConcurrent <= 16, `Maximum concurrency strictly must not exceed 16`);

  // Verify empty list handling
  const emptyRes = await asyncPool(16, [], async () => 1);
  assert.deepStrictEqual(emptyRes, [], 'asyncPool with empty input should return empty array');

  // Verify robust error isolation when worker throws or catches
  let errorCaught = false;
  try {
    await asyncPool(4, [1, 2, 3], async (n) => {
      if (n === 2) {
        throw new Error('boom');
      }
      return n;
    });
  } catch (err: any) {
    errorCaught = true;
    assert.strictEqual(err.message, 'boom');
  }
  assert.ok(errorCaught, 'asyncPool properly propagates unhandled errors when needed');

  console.log(`  -> Passed: asyncPool strictly bounded concurrency to ${maxConcurrent}/16.\n`);

  // -------------------------------------------------------------------------
  // Test 2: Setup 80 conversation directories with transcripts and 2 missing files
  // -------------------------------------------------------------------------
  console.log('[Test 2] Setting up 80 simulated conversation directories...');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-verify-'));
  const brainDir = path.join(tempRoot, 'brain');
  fs.mkdirSync(brainDir, { recursive: true });
  clearBrainDirCache(brainDir);

  try {
    const expectedOldPaths = new Set<string>();
    const expectedAllPaths = new Map<string, number>();

    // Step A: Create 40 "old" conversations before sinceTimestamp
    for (let i = 0; i < 40; i++) {
      const convId = `conv-old-${String(i).padStart(3, '0')}`;
      const convDir = path.join(brainDir, convId);
      fs.mkdirSync(convDir, { recursive: true });

      // Simulate missing transcript for conv-old-010
      if (i !== 10) {
        const logsDir = path.join(convDir, '.system_generated', 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        const transcriptFile = path.join(logsDir, 'transcript.jsonl');
        const content = JSON.stringify({ convId, content: 'A'.repeat(50 + i * 10) }) + '\n';
        fs.writeFileSync(transcriptFile, content, 'utf8');
        const stat = fs.statSync(transcriptFile);
        expectedOldPaths.add(transcriptFile);
        expectedAllPaths.set(transcriptFile, stat.size);
      }
    }

    // Wait a brief tick to demarcate timestamps
    await sleep(60);
    const sinceTimestamp = Date.now();
    await sleep(60);

    // Step B: Create 40 "new" conversations after sinceTimestamp
    for (let i = 0; i < 40; i++) {
      const convId = `conv-new-${String(i).padStart(3, '0')}`;
      const convDir = path.join(brainDir, convId);
      fs.mkdirSync(convDir, { recursive: true });

      // Simulate missing transcript for conv-new-025
      if (i !== 25) {
        const logsDir = path.join(convDir, '.system_generated', 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        const transcriptFile = path.join(logsDir, 'transcript.jsonl');
        const content = JSON.stringify({ convId, content: 'B'.repeat(80 + i * 15) }) + '\n';
        fs.writeFileSync(transcriptFile, content, 'utf8');
        const stat = fs.statSync(transcriptFile);
        expectedAllPaths.set(transcriptFile, stat.size);
      }
    }

    assert.strictEqual(expectedAllPaths.size, 78, 'Expected 78 valid transcript files on disk');
    assert.strictEqual(expectedOldPaths.size, 39, 'Expected 39 valid pre-existing transcript files');

    // -------------------------------------------------------------------------
    // Test 3: Trigger _initializeCandidateBaseline and verify latency & accuracy
    // -------------------------------------------------------------------------
    console.log('[Test 3] Triggering _initializeCandidateBaseline() on cold cache...');
    const watcher = new TranscriptWatcher({
      brainDir,
      sinceTimestamp
    });

    const startTime = performance.now();
    await watcher._initializeCandidateBaseline();
    const elapsedMs = performance.now() - startTime;

    console.log(`  -> Baseline scan of 80 directories completed in ${elapsedMs.toFixed(2)}ms (target: < 60ms)`);
    assert.ok(
      elapsedMs < 60,
      `Concurrent directory and transcript stat took ${elapsedMs.toFixed(2)}ms, expected < 60ms`
    );

    const baselineSizes = watcher.getCandidateBaselineSizes();
    const preExisted = watcher.getCandidatePreExisted();

    // Verify 100% accuracy of baseline sizes
    assert.strictEqual(
      baselineSizes.size,
      78,
      `Expected baselineSizes to contain exactly 78 entries, found ${baselineSizes.size}`
    );

    for (const [tPath, expectedSize] of expectedAllPaths.entries()) {
      assert.ok(baselineSizes.has(tPath), `Missing baseline size for ${tPath}`);
      assert.strictEqual(
        baselineSizes.get(tPath),
        expectedSize,
        `Mismatched size for ${tPath}: expected ${expectedSize}, got ${baselineSizes.get(tPath)}`
      );
    }

    // Verify 100% accuracy of preExisted set
    assert.strictEqual(
      preExisted.size,
      39,
      `Expected preExisted to contain exactly 39 entries, found ${preExisted.size}`
    );

    for (const tPath of expectedOldPaths) {
      assert.ok(
        preExisted.has(tPath),
        `Expected preExisted to contain pre-existing transcript ${tPath}`
      );
    }

    // Verify missing transcripts (conv-old-010 and conv-new-025) are not present
    const missingOld = path.join(brainDir, 'conv-old-010', '.system_generated', 'logs', 'transcript.jsonl');
    const missingNew = path.join(brainDir, 'conv-new-025', '.system_generated', 'logs', 'transcript.jsonl');
    assert.strictEqual(baselineSizes.has(missingOld), false, 'Missing old file should not be in baselineSizes');
    assert.strictEqual(baselineSizes.has(missingNew), false, 'Missing new file should not be in baselineSizes');
    assert.strictEqual(preExisted.has(missingOld), false, 'Missing old file should not be in preExisted');
    assert.strictEqual(preExisted.has(missingNew), false, 'Missing new file should not be in preExisted');

    console.log('  -> Passed: Baseline sizes and pre-existing sets verified with 100% accuracy.\n');

    // -------------------------------------------------------------------------
    // Test 4: Verify initializeBaselineCandidatesAsync compatibility alias
    // -------------------------------------------------------------------------
    console.log('[Test 4] Verifying initializeBaselineCandidatesAsync() compatibility alias...');
    await watcher.initializeBaselineCandidatesAsync();
    assert.strictEqual(watcher.getCandidateBaselineSizes().size, 78);
    assert.strictEqual(watcher.getCandidatePreExisted().size, 39);
    console.log('  -> Passed: initializeBaselineCandidatesAsync() alias works seamlessly.\n');

    console.log('================================================================');
    console.log(' ALL PHASE 04 TESTS PASSED SUCCESSFULLY!');
    console.log('================================================================');
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

runPhase04Verification().catch((err) => {
  console.error('Phase 04 Test failed:', err);
  process.exit(1);
});
