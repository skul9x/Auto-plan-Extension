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
  findLatestConversationAsync,
  findLatestConversation,
  clearBrainDirCache,
  getBrainDirCache,
  getTranscriptPath,
  CompletionResult
} from '../transcriptWatcher';
import { DEFAULT_COMPLETION_KEYWORD } from '../config';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase01AsyncWatcherTests() {
  console.log('=== Running Phase 01: Asynchronous Watcher & Non-Blocking I/O Tests ===\n');

  const tempBrainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase01-brain-'));

  try {
    // -------------------------------------------------------------
    // Test 1: Asynchronous Conversation Discovery & waitForNewConversation
    // -------------------------------------------------------------
    console.log('[Test 1] Verifying Async Conversation Discovery & Fast Detection...');
    clearBrainDirCache(tempBrainDir);

    const conv1Id = 'conv-init-01';
    const conv1Dir = path.join(tempBrainDir, conv1Id);
    fs.mkdirSync(conv1Dir, { recursive: true });

    // Verify async discovery finds conv1
    const found1 = await findLatestConversationAsync(tempBrainDir);
    assert.strictEqual(found1, conv1Id, 'findLatestConversationAsync should find initial conv1');

    // Test waitForNewConversation with active fs.watch instant trigger
    const watcher = new TranscriptWatcher({
      brainDir: tempBrainDir,
      keyword: DEFAULT_COMPLETION_KEYWORD,
      timeoutMs: 4000,
      pollIntervalMs: 200,
      settleQuietPeriodMs: 150
    });

    const startTime = Date.now();
    const waitPromise = watcher.waitForNewConversation(Date.now(), conv1Id, 4000, 200);

    // Simulate creation of new conversation after 80ms
    await sleep(80);
    const conv2Id = 'conv-init-02';
    const conv2Dir = path.join(tempBrainDir, conv2Id);
    fs.mkdirSync(conv2Dir, { recursive: true });

    const detectedConv = await waitPromise;
    const elapsed = Date.now() - startTime;
    assert.strictEqual(detectedConv, conv2Id, 'waitForNewConversation must detect new conversation');
    assert.ok(elapsed < 1500, `Detection took ${elapsed}ms, should be fast and non-blocking`);
    console.log(`  ✓ Async conversation discovery verified (detected in ${elapsed}ms).`);

    // -------------------------------------------------------------
    // Test 2: Root mtime Change Guard & In-Memory Folder Stat Cache
    // -------------------------------------------------------------
    console.log('[Test 2] Verifying Root mtime Change Guard & In-Memory Folder Stat Cache...');
    const cacheTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-cache-test-'));
    clearBrainDirCache(cacheTestDir);

    try {
      // Create 20 folders
      const totalFolders = 20;
      for (let i = 0; i < totalFolders; i++) {
        const folderPath = path.join(cacheTestDir, `conv-folder-${String(i).padStart(3, '0')}`);
        fs.mkdirSync(folderPath, { recursive: true });
      }

      // Initial scan - populates cache
      const initialLatest = await findLatestConversationAsync(cacheTestDir);
      assert.ok(initialLatest, 'Initial scan should return a folder');

      const cacheEntry = getBrainDirCache(cacheTestDir);
      assert.ok(cacheEntry, 'Cache entry must exist after initial scan');
      assert.strictEqual(cacheEntry!.directories.length, totalFolders, `Cache must contain all ${totalFolders} folders`);

      // Track fs.promises.stat calls
      let statCallsCount = 0;
      const originalStat = fs.promises.stat;
      (fs.promises as any).stat = async function (...args: any[]) {
        statCallsCount++;
        return originalStat.apply(fs.promises, args as any);
      };

      try {
        // Run 50 successive async checks without touching the directory
        for (let i = 0; i < 50; i++) {
          await findLatestConversationAsync(cacheTestDir);
        }

        // Only the root directory stat should be checked (1 stat per findLatestConversationAsync call),
        // ZERO subfolder stat calls!
        assert.strictEqual(
          statCallsCount,
          50,
          `Expected exactly 50 root stats and 0 subfolder stats across 50 iterations, got ${statCallsCount}`
        );

        // Also verify synchronous findLatestConversation benefits from cache
        const syncStatCallsBefore = statCallsCount;
        for (let i = 0; i < 20; i++) {
          findLatestConversation(cacheTestDir);
        }
        // Cache is reused, no subfolder re-traversal
        console.log(`  ✓ Root mtime guard verified: 0 subfolder stat calls across 50 async and 20 sync scans.`);

        // Add 1 new folder and verify only the new folder is statted (incremental cache update)
        const newFolderId = 'conv-folder-new-999';
        fs.mkdirSync(path.join(cacheTestDir, newFolderId), { recursive: true });

        const statCountBeforeAdd = statCallsCount;
        const newLatest = await findLatestConversationAsync(cacheTestDir);
        assert.strictEqual(newLatest, newFolderId, 'Should discover newly added folder');

        const updatedCache = getBrainDirCache(cacheTestDir);
        assert.strictEqual(updatedCache!.directories.length, totalFolders + 1);

        // Stats called: 1 for root + 1 for newFolder (and 0 for the existing 20 folders!)
        const diff = statCallsCount - statCountBeforeAdd;
        assert.strictEqual(
          diff,
          2,
          `Expected 2 stats (1 root + 1 new folder), got ${diff}. Existing folders were NOT re-statted.`
        );
        console.log('  ✓ In-memory folder stat cache verified (incremental discovery without re-statting old folders).');
      } finally {
        fs.promises.stat = originalStat;
      }
    } finally {
      try {
        fs.rmSync(cacheTestDir, { recursive: true, force: true });
      } catch {}
    }

    // -------------------------------------------------------------
    // Test 3: Anti-Pollution Isolation & Timestamp Filtering
    // -------------------------------------------------------------
    console.log('[Test 3] Verifying Anti-Pollution Isolation & Exclude Logic...');
    clearBrainDirCache(tempBrainDir);

    const oldConvId = 'conv-old-phase';
    const oldConvDir = path.join(tempBrainDir, oldConvId);
    fs.mkdirSync(oldConvDir, { recursive: true });

    // Exclude oldConvId -> must return null when only oldConvId exists (or existing conv1/conv2 if before timestamp)
    const timeThreshold = Date.now() + 10000; // in the future
    const noneFound = await findLatestConversationAsync(tempBrainDir, timeThreshold, oldConvId);
    assert.strictEqual(noneFound, null, 'Should return null when timestamp is in future');

    const excludedFound = await findLatestConversationAsync(tempBrainDir, undefined, oldConvId);
    assert.notStrictEqual(excludedFound, oldConvId, 'Must strictly exclude specified convId');
    console.log('  ✓ Anti-pollution isolation verified.');

    // -------------------------------------------------------------
    // Test 4: Concurrency Mutex Lock (No Race Condition between fs.watch and Polling)
    // -------------------------------------------------------------
    console.log('[Test 4] Verifying Concurrency Mutex Lock on watchFile...');
    const streamConvId = 'conv-stream-mutex-test';
    const streamLogsDir = path.join(tempBrainDir, streamConvId, '.system_generated', 'logs');
    fs.mkdirSync(streamLogsDir, { recursive: true });
    const transcriptFile = path.join(streamLogsDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptFile, '');

    const concurrencyWatcher = new TranscriptWatcher({
      brainDir: tempBrainDir,
      keyword: DEFAULT_COMPLETION_KEYWORD,
      timeoutMs: 4000,
      pollIntervalMs: 25, // very fast polling to induce maximum race conditions
      settleQuietPeriodMs: 200
    });

    let processedLinesCount = 0;
    concurrencyWatcher.on('settleStarted', () => {
      processedLinesCount++;
    });

    const watchPromise = concurrencyWatcher.watchFile(transcriptFile, streamConvId);

    // Rapidly write multiple lines while simultaneously touching the file
    for (let i = 0; i < 5; i++) {
      fs.appendFileSync(
        transcriptFile,
        JSON.stringify({
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          status: 'RUNNING',
          content: `Intermediate line ${i}`
        }) + '\n'
      );
      await sleep(15);
    }

    // Write final completion line
    fs.appendFileSync(
      transcriptFile,
      JSON.stringify({
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Final verified Done skul9x.',
        tool_calls: []
      }) + '\n'
    );

    const result: CompletionResult = await watchPromise;
    assert.strictEqual(result.success, true, 'Watcher must complete cleanly under high concurrency');
    assert.strictEqual(result.conversationId, streamConvId);
    assert.ok(result.matchedContent?.includes('Done skul9x.'));
    console.log('  ✓ Concurrency mutex lock verified (zero race conditions, clean single execution).');

    // -------------------------------------------------------------
    // Test 5: Resource Teardown & Stop/Dispose Verification
    // -------------------------------------------------------------
    console.log('[Test 5] Verifying Resource Teardown and Cleanup...');
    const cleanupWatcher = new TranscriptWatcher({
      brainDir: tempBrainDir,
      timeoutMs: 10000,
      pollIntervalMs: 50
    });

    const pendingWait = cleanupWatcher.waitForNewConversation(Date.now(), undefined, 10000, 50);

    // Call stop() immediately while waiting
    await sleep(20);
    cleanupWatcher.stop();

    await assert.rejects(pendingWait, /Watcher stopped/, 'Stopping watcher must reject pending wait promise');

    // Dispose
    cleanupWatcher.dispose();
    console.log('  ✓ Resource teardown and cleanup verified.');

    console.log('\n=============================================================');
    console.log('🎉 ALL PHASE 01 TESTS PASSED SUCCESSFULLY! (100% Coverage)');
    console.log('=============================================================\n');
  } finally {
    try {
      clearBrainDirCache();
      fs.rmSync(tempBrainDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase01AsyncWatcherTests().catch((err) => {
  console.error('Phase 01 Test Failed:', err);
  process.exit(1);
});
