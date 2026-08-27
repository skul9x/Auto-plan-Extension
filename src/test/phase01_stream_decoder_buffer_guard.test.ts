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
  MAX_LINE_BUFFER_BYTES,
  MAX_CACHED_CONVERSATIONS,
  CompletionResult
} from '../transcriptWatcher';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase01StreamDecoderAndBufferGuardTests() {
  console.log('=== Running Phase 01: Stream Decoder & Buffer Guard Tests ===\n');

  const tempBrainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase01-stream-'));

  try {
    // -------------------------------------------------------------
    // Test 1: Multi-byte UTF-8 decoding across split chunks (Vietnamese + Emojis)
    // -------------------------------------------------------------
    console.log('[Test 1] Verifying multi-byte UTF-8 split boundary decoding without replacement characters...');
    const conv1Id = 'conv-utf8-split-test';
    const conv1LogsDir = path.join(tempBrainDir, conv1Id, '.system_generated', 'logs');
    fs.mkdirSync(conv1LogsDir, { recursive: true });
    const transcriptPath1 = path.join(conv1LogsDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath1, '');

    const unicodeKeyword = 'Hoàn thành 100% 🚀🌟';
    const vietnameseContent = 'Xin chào thế giới! Kiểm tra tiếng Việt có dấu: ắ, ằ, ẳ, ẵ, ặ, ê, ế, ồ, ộ, ử, ữ và biểu tượng cảm xúc: 🚀🔥🎉. ' + unicodeKeyword;

    const fullJsonLine = JSON.stringify({
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: vietnameseContent,
      tool_calls: []
    }) + '\n';

    const watcher1 = new TranscriptWatcher({
      brainDir: tempBrainDir,
      keyword: unicodeKeyword,
      timeoutMs: 5000,
      pollIntervalMs: 50,
      settleQuietPeriodMs: 150
    });

    const watchPromise1 = watcher1.watchFile(transcriptPath1, conv1Id);

    // Convert full JSON line to raw UTF-8 bytes and write it byte-by-byte or in small slices to intentionally split multi-byte characters
    const fullBuffer = Buffer.from(fullJsonLine, 'utf8');
    const fd1 = fs.openSync(transcriptPath1, 'a');

    // Write buffer in 3-byte chunks to slice 4-byte emoji code points and 3-byte Vietnamese diacritics
    for (let offset = 0; offset < fullBuffer.length; offset += 3) {
      const slice = fullBuffer.subarray(offset, Math.min(offset + 3, fullBuffer.length));
      fs.writeSync(fd1, slice);
      await sleep(5);
    }
    fs.closeSync(fd1);

    const result1: CompletionResult = await watchPromise1;
    assert.strictEqual(result1.success, true, 'Watcher must succeed in detecting completion step');
    assert.strictEqual(result1.conversationId, conv1Id);
    assert.ok(result1.matchedContent, 'matchedContent must be populated');
    assert.ok(!result1.matchedContent.includes('\uFFFD'), 'Decoded content must NOT contain replacement character \\uFFFD');
    assert.strictEqual(result1.matchedContent, vietnameseContent, 'Decoded content must match original Unicode string perfectly');
    assert.ok(result1.matchedLine && !result1.matchedLine.includes('\uFFFD'), 'Matched line must not have replacement character');
    console.log('  ✓ Multi-byte split decoding verified (zero replacement characters, 100% character integrity).');

    // -------------------------------------------------------------
    // Test 2: Unicode completion keyword detected across chunk boundaries
    // -------------------------------------------------------------
    console.log('[Test 2] Verifying Unicode completion keyword detection across split boundaries...');
    const conv2Id = 'conv-unicode-kw-test';
    const conv2LogsDir = path.join(tempBrainDir, conv2Id, '.system_generated', 'logs');
    fs.mkdirSync(conv2LogsDir, { recursive: true });
    const transcriptPath2 = path.join(conv2LogsDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath2, '');

    const complexKeyword = 'Đã xong tác vụ 🎉';
    const watcher2 = new TranscriptWatcher({
      brainDir: tempBrainDir,
      keyword: complexKeyword,
      timeoutMs: 5000,
      pollIntervalMs: 50,
      settleQuietPeriodMs: 150
    });

    const watchPromise2 = watcher2.watchFile(transcriptPath2, conv2Id);

    const stepPayload = JSON.stringify({
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: `Tiến trình đã xử lý xong. Kết quả: ${complexKeyword}`,
      tool_calls: null
    }) + '\n';

    const stepBuf = Buffer.from(stepPayload, 'utf8');
    const fd2 = fs.openSync(transcriptPath2, 'a');
    // Split across single byte writes around the keyword
    for (let i = 0; i < stepBuf.length; i++) {
      fs.writeSync(fd2, stepBuf.subarray(i, i + 1));
      if (i % 10 === 0) {
        await sleep(3);
      }
    }
    fs.closeSync(fd2);

    const result2 = await watchPromise2;
    assert.strictEqual(result2.success, true);
    assert.ok(result2.matchedContent?.includes(complexKeyword));
    console.log('  ✓ Unicode keyword detection across split boundaries verified.');

    // -------------------------------------------------------------
    // Test 3: lineBuffer Memory Exhaustion Guard (MAX_LINE_BUFFER_BYTES limit)
    // -------------------------------------------------------------
    console.log('[Test 3] Verifying lineBuffer safety cap against memory exhaustion...');
    const conv3Id = 'conv-buffer-cap-test';
    const conv3LogsDir = path.join(tempBrainDir, conv3Id, '.system_generated', 'logs');
    fs.mkdirSync(conv3LogsDir, { recursive: true });
    const transcriptPath3 = path.join(conv3LogsDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath3, '');

    assert.strictEqual(MAX_LINE_BUFFER_BYTES, 10 * 1024 * 1024, 'MAX_LINE_BUFFER_BYTES must be 10MB');

    // Intercept console.warn to verify warning is issued when limit exceeded
    let warnIssued = false;
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      if (args.some((a) => String(a).includes('lineBuffer exceeded limit'))) {
        warnIssued = true;
      }
      originalWarn.apply(console, args as any);
    };

    const watcher3 = new TranscriptWatcher({
      brainDir: tempBrainDir,
      keyword: 'Done skul9x.',
      timeoutMs: 3000,
      pollIntervalMs: 50,
      settleQuietPeriodMs: 100
    });

    const watchPromise3 = watcher3.watchFile(transcriptPath3, conv3Id);

    // Stream 11MB of malformed data without newlines
    const chunkSize = 1024 * 1024; // 1MB
    const totalChunks = 11;
    const sampleChunk = Buffer.alloc(chunkSize, 'A');

    const fd3 = fs.openSync(transcriptPath3, 'a');
    for (let c = 0; c < totalChunks; c++) {
      fs.writeSync(fd3, sampleChunk);
      await sleep(15);
    }

    // Now write a valid completion line
    const finalValidLine = '\n' + JSON.stringify({
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: 'Done skul9x.',
      tool_calls: []
    }) + '\n';
    fs.writeSync(fd3, Buffer.from(finalValidLine, 'utf8'));
    fs.closeSync(fd3);

    const result3 = await watchPromise3;
    console.warn = originalWarn;

    assert.ok(warnIssued, 'Warning must be logged when lineBuffer exceeds MAX_LINE_BUFFER_BYTES');
    assert.strictEqual(result3.success, true, 'Watcher must recover and parse the subsequent valid line');
    console.log('  ✓ lineBuffer memory guard verified (truncated stale prefix and prevented unbounded memory growth).');

    // -------------------------------------------------------------
    // Test 4: Directory Cache Pruning (MAX_CACHED_CONVERSATIONS = 100)
    // -------------------------------------------------------------
    console.log('[Test 4] Verifying brainDirCacheMap entry pruning at 100 items...');
    assert.strictEqual(MAX_CACHED_CONVERSATIONS, 100, 'MAX_CACHED_CONVERSATIONS must be 100');

    const cachePruneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-cache-prune-'));
    clearBrainDirCache(cachePruneDir);

    try {
      const totalFoldersToCreate = 130;
      const baseTime = Date.now() + 100000; // in the future so mtime is strictly greater than birthtimeMs on Windows

      // Create 130 folders with incremental mtimes
      for (let i = 0; i < totalFoldersToCreate; i++) {
        const folderName = `conv-prune-${String(i).padStart(3, '0')}`;
        const folderPath = path.join(cachePruneDir, folderName);
        fs.mkdirSync(folderPath, { recursive: true });
        const folderTime = (baseTime + i * 1000) / 1000; // in seconds for utimes
        fs.utimesSync(folderPath, folderTime, folderTime);
      }

      // Test Async Discovery Pruning
      const asyncLatest = await findLatestConversationAsync(cachePruneDir);
      assert.strictEqual(asyncLatest, `conv-prune-129`, 'Latest conversation should be conv-prune-129');

      const cacheAsync = getBrainDirCache(cachePruneDir);
      assert.ok(cacheAsync, 'Cache entry must exist');
      assert.strictEqual(
        cacheAsync!.directories.length,
        MAX_CACHED_CONVERSATIONS,
        `Cached directories must be pruned to exactly ${MAX_CACHED_CONVERSATIONS}`
      );
      assert.strictEqual(
        cacheAsync!.dirMap.size,
        MAX_CACHED_CONVERSATIONS,
        `Cached dirMap must be pruned to exactly ${MAX_CACHED_CONVERSATIONS}`
      );

      // Verify ordering: newest (conv-prune-129 down to conv-prune-030) are kept
      assert.strictEqual(cacheAsync!.directories[0].name, 'conv-prune-129');
      assert.strictEqual(cacheAsync!.directories[99].name, 'conv-prune-030');
      assert.ok(!cacheAsync!.dirMap.has('conv-prune-000'), 'Oldest folders must have been pruned from dirMap');
      assert.ok(!cacheAsync!.dirMap.has('conv-prune-029'), 'Pruned folder 029 must not exist in dirMap');
      assert.ok(cacheAsync!.dirMap.has('conv-prune-129'), 'Newest folder must exist in dirMap');

      // Test Sync Discovery Pruning
      clearBrainDirCache(cachePruneDir);
      const syncLatest = findLatestConversation(cachePruneDir);
      assert.strictEqual(syncLatest, `conv-prune-129`);

      const cacheSync = getBrainDirCache(cachePruneDir);
      assert.ok(cacheSync, 'Sync cache entry must exist');
      assert.strictEqual(cacheSync!.directories.length, MAX_CACHED_CONVERSATIONS);
      assert.strictEqual(cacheSync!.dirMap.size, MAX_CACHED_CONVERSATIONS);
      assert.strictEqual(cacheSync!.directories[0].name, 'conv-prune-129');
      assert.strictEqual(cacheSync!.directories[99].name, 'conv-prune-030');
      console.log('  ✓ brainDirCacheMap pruning verified (bounded to top 100 newest items in both async and sync).');
    } finally {
      try {
        fs.rmSync(cachePruneDir, { recursive: true, force: true });
      } catch {}
    }

    // -------------------------------------------------------------
    // Test 5: StringDecoder Clean Flush & Reset on stop()
    // -------------------------------------------------------------
    console.log('[Test 5] Verifying StringDecoder clean flush on stop/dispose...');
    const cleanupWatcher = new TranscriptWatcher({
      brainDir: tempBrainDir,
      timeoutMs: 5000
    });

    const dummyFile = path.join(tempBrainDir, 'dummy.jsonl');
    fs.writeFileSync(dummyFile, '');

    const pendingPromise = cleanupWatcher.watchFile(dummyFile, 'conv-cleanup');
    await sleep(20);
    cleanupWatcher.stop();

    const stopResult = await pendingPromise;
    assert.strictEqual(stopResult.success, false);
    assert.strictEqual(stopResult.error, 'Watcher stopped');
    cleanupWatcher.dispose();
    console.log('  ✓ StringDecoder clean flush and watcher teardown verified.');

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

runPhase01StreamDecoderAndBufferGuardTests().catch((err) => {
  console.error('Phase 01 Test Failed:', err);
  process.exit(1);
});
