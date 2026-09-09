// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          {
            uri: { fsPath: '/home/skul9x/Desktop/Code/TramsacEV' },
            name: 'TramsacEV'
          }
        ],
        name: 'TramsacEV'
      },
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
  verifyConversationOwnershipAsync,
  getCandidateConversationsAsync,
  clearConversationOwnershipCache,
  getConversationOwnershipCacheStats,
  MAX_OWNERSHIP_CACHE_SIZE,
  ConversationOwnershipCriteria
} from '../transcriptWatcher';

function createTempBrainDir(): string {
  const tempDir = path.join(
    os.tmpdir(),
    `agy_brain_cache_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function cleanupDir(dirPath: string) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

function writeTranscriptFile(convDir: string, lines: any[]) {
  const logDir = path.join(convDir, '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const tPath = path.join(logDir, 'transcript.jsonl');
  const content = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(tPath, content, 'utf8');
  return tPath;
}

async function runTests() {
  console.log('=== Running Phase 02: Transcript Ownership Stat & Content Cache Tests ===\n');

  // Test 1: Simulation across 100 ticks with 5 candidate transcript files
  console.log('[Test 1] Simulating 100 polling ticks across 5 candidate transcript files...');
  clearConversationOwnershipCache();
  const brainDir = createTempBrainDir();

  try {
    const candidatePaths: string[] = [];
    for (let i = 0; i < 5; i++) {
      const convDir = path.join(brainDir, `conv_${i}`);
      fs.mkdirSync(convDir, { recursive: true });
      const tPath = writeTranscriptFile(convDir, [
        {
          type: 'USER_INPUT',
          content: `Task for candidate ${i} working on /home/skul9x/Desktop/Code/TramsacEV`
        }
      ]);
      candidatePaths.push(tPath);
    }

    const criteria: ConversationOwnershipCriteria = {
      expectedPromptSnippet: 'candidate 0',
      workspacePath: '/home/skul9x/Desktop/Code/TramsacEV'
    };

    // Track fs.promises.open calls
    let openCount = 0;
    const originalOpen = fs.promises.open;
    (fs.promises as any).open = async function (...args: any[]) {
      openCount++;
      return (originalOpen as any).apply(this, args);
    };

    try {
      // 100 polling ticks
      for (let tick = 0; tick < 100; tick++) {
        // Evaluate candidate conversations
        const candidates = await getCandidateConversationsAsync(brainDir, 0, undefined, criteria);
        assert.strictEqual(candidates.length, 1, `Tick ${tick} should yield exactly 1 matching candidate`);
        assert.strictEqual(candidates[0].convId, 'conv_0');
      }

      const stats = getConversationOwnershipCacheStats();
      console.log(`  File open count: ${openCount}`);
      console.log(`  Cache stats: size=${stats.size}, hits=${stats.hits}, misses=${stats.misses}`);

      // Tick 1 checks 5 candidate files -> 5 misses, 5 fs.open
      // Ticks 2..100 (99 ticks * 5 files = 495 calls) -> all 495 are cache hits, 0 fs.open
      assert.strictEqual(openCount, 5, `Expected exactly 5 disk open reads, got ${openCount}`);
      assert.strictEqual(stats.misses, 5, `Expected 5 cache misses, got ${stats.misses}`);
      assert.strictEqual(stats.hits, 495, `Expected 495 cache hits, got ${stats.hits}`);
      assert.strictEqual(stats.size, 5, `Expected cache size to be 5, got ${stats.size}`);
      console.log('✓ Test 1: 99% disk read reduction (5 reads instead of 500) verified cleanly.\n');
    } finally {
      (fs.promises as any).open = originalOpen;
    }

    // Test 2: Invalidation upon file content / mtime modification
    console.log('[Test 2] Modifying 1 file and verifying immediate cache invalidation and re-read...');
    let openCountMod = 0;
    const originalOpen2 = fs.promises.open;
    (fs.promises as any).open = async function (...args: any[]) {
      openCountMod++;
      return (originalOpen2 as any).apply(this, args);
    };

    try {
      const statsBefore = getConversationOwnershipCacheStats();
      const missesBefore = statsBefore.misses;

      // Mutate candidate 1 (which previously didn't match snippet)
      // Change mtime and content
      const conv1File = candidatePaths[1];
      const newContent = JSON.stringify({
        type: 'USER_INPUT',
        content: `Updated candidate 0 snippet matching now /home/skul9x/Desktop/Code/TramsacEV`
      }) + '\n';
      fs.writeFileSync(conv1File, newContent, 'utf8');

      // Touch mtime explicitly forward by 2 seconds to ensure mtime change is detected
      const newTime = (Date.now() + 2000) / 1000;
      fs.utimesSync(conv1File, newTime, newTime);

      const candidates = await getCandidateConversationsAsync(brainDir, 0, undefined, criteria);
      // Both conv_0 and conv_1 match now
      assert.strictEqual(candidates.length, 2, 'Expected 2 matching candidates after file update');

      const statsAfter = getConversationOwnershipCacheStats();
      console.log(`  File open count on tick after update: ${openCountMod}`);
      console.log(`  Cache misses delta: ${statsAfter.misses - missesBefore}`);

      // Only conv_1 was modified, so exactly 1 disk read should occur; the other 4 candidates hit cache
      assert.strictEqual(openCountMod, 1, `Expected exactly 1 re-read for modified file, got ${openCountMod}`);
      assert.strictEqual(statsAfter.misses - missesBefore, 1, 'Expected exactly 1 cache miss');
      console.log('✓ Test 2: Invalidation and re-read on file mutation verified cleanly.\n');
    } finally {
      (fs.promises as any).open = originalOpen2;
    }
  } finally {
    cleanupDir(brainDir);
  }

  // Test 3: 0-byte file handling and non-existent file handling
  console.log('[Test 3] Testing 0-byte file and missing file handling...');
  const tempDir3 = createTempBrainDir();
  try {
    const zeroByteFile = path.join(tempDir3, 'empty.jsonl');
    fs.writeFileSync(zeroByteFile, Buffer.alloc(0));

    const criteria: ConversationOwnershipCriteria = {
      expectedPromptSnippet: 'something'
    };

    // statHint provided with size 0
    const zeroResultWithHint = await verifyConversationOwnershipAsync(zeroByteFile, criteria, { mtimeMs: Date.now(), size: 0 });
    assert.strictEqual(zeroResultWithHint, false, 'Expected 0-byte file with statHint to return false');

    // statHint omitted with size 0
    const zeroResultNoHint = await verifyConversationOwnershipAsync(zeroByteFile, criteria);
    assert.strictEqual(zeroResultNoHint, false, 'Expected 0-byte file without statHint to return false');

    // Missing file without statHint
    const missingFile = path.join(tempDir3, 'non_existent.jsonl');
    const missingResult = await verifyConversationOwnershipAsync(missingFile, criteria);
    assert.strictEqual(missingResult, false, 'Expected missing file to return false');

    console.log('✓ Test 3: 0-byte and missing file edge cases verified cleanly.\n');
  } finally {
    cleanupDir(tempDir3);
  }

  // Test 4: LRU eviction bounding when cache exceeds MAX_OWNERSHIP_CACHE_SIZE (500)
  console.log('[Test 4] Testing LRU cache bounding at capacity (500 entries)...');
  clearConversationOwnershipCache();
  const tempDir4 = createTempBrainDir();
  try {
    // Generate 505 unique files
    const fileCount = 505;
    const dummyCriteria: ConversationOwnershipCriteria = { expectedPromptSnippet: 'lru-test' };

    for (let i = 0; i < fileCount; i++) {
      const fPath = path.join(tempDir4, `file_${i}.jsonl`);
      fs.writeFileSync(fPath, JSON.stringify({ type: 'USER_INPUT', content: `lru-test ${i}` }) + '\n');
      const stat = fs.statSync(fPath);
      const isOwner = await verifyConversationOwnershipAsync(fPath, dummyCriteria, {
        mtimeMs: stat.mtimeMs,
        size: stat.size
      });
      assert.strictEqual(isOwner, true);
    }

    const stats = getConversationOwnershipCacheStats();
    console.log(`  Total inserted: ${fileCount}, Cache size: ${stats.size}`);
    assert.strictEqual(stats.size, MAX_OWNERSHIP_CACHE_SIZE, `Cache size should not exceed ${MAX_OWNERSHIP_CACHE_SIZE}`);

    // Verify oldest entries (file_0 to file_4) were evicted
    // If we re-check file_0, it should be a cache miss
    const missesBefore = stats.misses;
    const f0Path = path.join(tempDir4, 'file_0.jsonl');
    const f0Stat = fs.statSync(f0Path);
    await verifyConversationOwnershipAsync(f0Path, dummyCriteria, {
      mtimeMs: f0Stat.mtimeMs,
      size: f0Stat.size
    });
    const statsAfterF0 = getConversationOwnershipCacheStats();
    assert.strictEqual(statsAfterF0.misses, missesBefore + 1, 'Re-querying evicted file_0 should trigger a cache miss');

    // file_504 was the most recent, querying it should be a cache hit
    const hitsBefore = statsAfterF0.hits;
    const f504Path = path.join(tempDir4, 'file_504.jsonl');
    const f504Stat = fs.statSync(f504Path);
    await verifyConversationOwnershipAsync(f504Path, dummyCriteria, {
      mtimeMs: f504Stat.mtimeMs,
      size: f504Stat.size
    });
    const statsAfterF504 = getConversationOwnershipCacheStats();
    assert.strictEqual(statsAfterF504.hits, hitsBefore + 1, 'Querying recent file_504 should trigger a cache hit');

    console.log('✓ Test 4: LRU eviction at maximum 500 entries verified cleanly.\n');
  } finally {
    cleanupDir(tempDir4);
  }

  // Test 5: Callers omitting statHint (backward compatibility)
  console.log('[Test 5] Verifying backward compatibility when statHint is omitted...');
  clearConversationOwnershipCache();
  const tempDir5 = createTempBrainDir();
  try {
    const fPath = path.join(tempDir5, 'test_compat.jsonl');
    fs.writeFileSync(fPath, JSON.stringify({ type: 'USER_INPUT', content: 'hello backward compatibility' }) + '\n');
    const criteria: ConversationOwnershipCriteria = { expectedPromptSnippet: 'hello backward' };

    // First call without statHint (cache miss, reads disk stat and contents)
    const res1 = await verifyConversationOwnershipAsync(fPath, criteria);
    assert.strictEqual(res1, true);

    // Second call without statHint (should hit cache since file mtime/size unmutated)
    const res2 = await verifyConversationOwnershipAsync(fPath, criteria);
    assert.strictEqual(res2, true);

    const stats = getConversationOwnershipCacheStats();
    assert.strictEqual(stats.misses, 1, 'Expected 1 miss');
    assert.strictEqual(stats.hits, 1, 'Expected 1 hit');

    console.log('✓ Test 5: Backward compatibility without statHint verified cleanly.\n');
  } finally {
    cleanupDir(tempDir5);
  }

  console.log('======================================================================');
  console.log('🎉 All Phase 02 Transcript Ownership Cache Tests PASSED cleanly!');
  console.log('======================================================================');
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
