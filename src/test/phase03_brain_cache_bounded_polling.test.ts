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
  getCandidateConversationsAsync,
  getBrainDirCache,
  clearBrainDirCache
} from '../transcriptWatcher';
import { DEFAULT_COMPLETION_KEYWORD } from '../config';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase03Verification(): Promise<void> {
  console.log('================================================================');
  console.log(' Phase 03 Verification: Brain Directory Cache & Bounded Polling');
  console.log('================================================================\n');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-verify-'));
  const brainDir = path.join(tempRoot, 'brain');
  fs.mkdirSync(brainDir, { recursive: true });

  try {
    // -----------------------------------------------------------------------
    // Test 1: Bounded Polling & Cold/Hot Filtering (0 redundant readdir/stat)
    // -----------------------------------------------------------------------
    console.log('[Test 1] Testing 0 redundant readdir and stat calls on unchanged brainDir...');
    clearBrainDirCache(brainDir);

    // Create 15 cold conversations created before sinceTimestamp
    const coldConvIds: string[] = [];
    for (let i = 1; i <= 15; i++) {
      const convId = `cold-conv-${String(i).padStart(3, '0')}`;
      coldConvIds.push(convId);
      const convDir = path.join(brainDir, convId);
      fs.mkdirSync(convDir, { recursive: true });
      const logsDir = path.join(convDir, '.system_generated', 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      const transcriptFile = path.join(logsDir, 'transcript.jsonl');
      fs.writeFileSync(
        transcriptFile,
        JSON.stringify({ step: 1, content: `Historic message for ${convId}` }) + '\n',
        'utf8'
      );
    }

    await sleep(50);
    const sinceTimestamp = Date.now();
    await sleep(20);

    // Polling cycle 1: Initial discovery and cache population
    const initialCandidates = await getCandidateConversationsAsync(brainDir, sinceTimestamp);
    assert.strictEqual(initialCandidates.length, 0, 'No hot candidates should be returned for cold conversations');

    const cacheEntry = getBrainDirCache(brainDir);
    assert.ok(cacheEntry, 'brainDirCacheEntry should be populated in brainDirCacheMap');
    assert.strictEqual(cacheEntry!.directories.length, 15, 'All 15 directories should be cached');

    for (const convId of coldConvIds) {
      const info = cacheEntry!.dirMap.get(convId);
      assert.ok(info, `dirMap should contain info for ${convId}`);
      assert.strictEqual(info!.isCold, true, `${convId} should be marked as cold`);
    }

    // Spy on fs.promises.readdir and fs.promises.stat to count calls in cycle 2
    let readdirCalls = 0;
    let coldStatCalls = 0;
    let rootStatCalls = 0;

    const originalReaddir = fs.promises.readdir;
    const originalStat = fs.promises.stat;

    fs.promises.readdir = (async (...args: any[]) => {
      readdirCalls++;
      return (originalReaddir as any)(...args);
    }) as any;

    fs.promises.stat = (async (targetPath: any, ...args: any[]) => {
      const p = String(targetPath);
      if (p === brainDir) {
        rootStatCalls++;
      } else if (coldConvIds.some((id) => p.includes(id))) {
        coldStatCalls++;
      }
      return (originalStat as any)(targetPath, ...args);
    }) as any;

    try {
      // Polling cycle 2: Subsequent cycle with unchanged brainDir
      const cycle2Candidates = await getCandidateConversationsAsync(brainDir, sinceTimestamp);
      assert.strictEqual(cycle2Candidates.length, 0, 'Subsequent cycle should return 0 candidates');
      assert.strictEqual(readdirCalls, 0, 'Subsequent polling cycle must make 0 readdir calls when brainDir is unchanged');
      assert.strictEqual(coldStatCalls, 0, 'Subsequent polling cycle must make 0 stat calls on cold conversations');
      assert.strictEqual(rootStatCalls, 1, 'Exactly 1 stat call on root brainDir to verify mtimeMs');
      console.log('  -> Passed: Subsequent cycle executed with 0 redundant readdir and 0 cold stat calls.\n');
    } finally {
      fs.promises.readdir = originalReaddir;
      fs.promises.stat = originalStat;
    }

    // -----------------------------------------------------------------------
    // Test 2: Cache Invalidation & Discovery on New Conversation Directory
    // -----------------------------------------------------------------------
    console.log('[Test 2] Testing cache invalidation and new conversation discovery...');
    await sleep(20);

    const newConvId = 'conv-hot-active-001';
    const newConvDir = path.join(brainDir, newConvId);
    fs.mkdirSync(newConvDir, { recursive: true });
    const newLogsDir = path.join(newConvDir, '.system_generated', 'logs');
    fs.mkdirSync(newLogsDir, { recursive: true });
    const newTranscript = path.join(newLogsDir, 'transcript.jsonl');
    fs.writeFileSync(
      newTranscript,
      JSON.stringify({ step: 1, content: 'Active prompt', type: 'USER_INPUT' }) + '\n',
      'utf8'
    );

    // Run candidate discovery - should detect new directory because brainDir mtime changed
    const activeCandidates = await getCandidateConversationsAsync(brainDir, sinceTimestamp);
    assert.strictEqual(activeCandidates.length, 1, 'New hot conversation directory should be discovered');
    assert.strictEqual(activeCandidates[0].convId, newConvId, 'Discovered candidate should match new conversation');

    // Test programmatic cache clearing via clearBrainDirCache
    clearBrainDirCache(brainDir);
    assert.strictEqual(getBrainDirCache(brainDir), undefined, 'Cache entry should be deleted after clearBrainDirCache');
    console.log('  -> Passed: Root cache successfully invalidated upon new directory creation & clearBrainDirCache works.\n');

    // -----------------------------------------------------------------------
    // Test 3: High-Volume Candidate Benchmark (< 15ms for 100+ Conversations)
    // -----------------------------------------------------------------------
    console.log('[Test 3] High-volume candidate benchmark (100+ historic conversations)...');
    clearBrainDirCache(brainDir);

    const benchmarkBrainDir = path.join(tempRoot, 'benchmark_brain');
    fs.mkdirSync(benchmarkBrainDir, { recursive: true });

    // Generate 110 historic cold conversations
    for (let i = 1; i <= 110; i++) {
      const dirName = `hist-conv-${String(i).padStart(4, '0')}`;
      const dPath = path.join(benchmarkBrainDir, dirName);
      fs.mkdirSync(dPath, { recursive: true });
      const tPath = path.join(dPath, 'transcript.jsonl');
      fs.writeFileSync(tPath, '{"step":0}\n', 'utf8');
    }

    await sleep(50);
    const benchSinceTime = Date.now();
    await sleep(20);

    // Create 1 active conversation modified recently
    const benchActiveId = 'hist-active-hot';
    const activeDirPath = path.join(benchmarkBrainDir, benchActiveId);
    fs.mkdirSync(activeDirPath, { recursive: true });
    const activeTranscript = path.join(activeDirPath, 'transcript.jsonl');
    fs.writeFileSync(activeTranscript, '{"step":1,"content":"active run"}\n', 'utf8');

    // Warm-up initial cycle
    await getCandidateConversationsAsync(benchmarkBrainDir, benchSinceTime);

    // Benchmark subsequent cycle
    const startBench = process.hrtime.bigint();
    const discovered = await getCandidateConversationsAsync(benchmarkBrainDir, benchSinceTime);
    const endBench = process.hrtime.bigint();
    const durationMs = Number(endBench - startBench) / 1_000_000;

    console.log(`  -> Processed 111 conversations in ${durationMs.toFixed(2)}ms`);
    assert.ok(
      durationMs < 15,
      `High-volume discovery took ${durationMs.toFixed(2)}ms, must be < 15ms`
    );
    assert.strictEqual(discovered.length, 1, 'Should discover exactly 1 active candidate');
    assert.strictEqual(discovered[0].convId, benchActiveId, 'Candidate must be the active conversation');
    console.log('  -> Passed: High-volume benchmark completed well under 15ms target.\n');

    // -----------------------------------------------------------------------
    // Test 4: initializeBaselineCandidatesAsync & Watcher Discovery Integration
    // -----------------------------------------------------------------------
    console.log('[Test 4] Testing initializeBaselineCandidatesAsync & Watcher discovery integration...');

    const watcher = new TranscriptWatcher({
      brainDir: benchmarkBrainDir,
      pollIntervalMs: 100,
      keyword: DEFAULT_COMPLETION_KEYWORD
    });

    await sleep(30);
    const waitStartTime = Date.now();
    const waitPromise = watcher.waitForNewConversation(waitStartTime, benchActiveId, 3000, 100);

    // After 80ms, create a new conversation
    await sleep(80);
    const triggeredConvId = 'conv-triggered-002';
    const triggeredDir = path.join(benchmarkBrainDir, triggeredConvId);
    fs.mkdirSync(triggeredDir, { recursive: true });
    const triggeredTranscript = path.join(triggeredDir, 'transcript.jsonl');
    fs.writeFileSync(triggeredTranscript, '{"content":"Watcher detected me!"}\n', 'utf8');

    const discoveredId = await waitPromise;
    assert.strictEqual(discoveredId, triggeredConvId, 'Watcher should discover newly created conversation');
    watcher.stop();
    console.log('  -> Passed: initializeBaselineCandidatesAsync and waitForNewConversation integrated seamlessly.\n');

    console.log('================================================================');
    console.log(' ALL PHASE 03 TESTS PASSED SUCCESSFULLY!');
    console.log('================================================================');
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

runPhase03Verification().catch((err) => {
  console.error('Phase 03 Verification failed:', err);
  process.exit(1);
});
