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
  countTranscriptLinesAsync,
  MAX_CHUNK_SIZE
} from '../transcriptWatcher';
import { DEFAULT_COMPLETION_KEYWORD } from '../config';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase02Verification(): Promise<void> {
  console.log('================================================================');
  console.log(' Phase 02 Verification: Transcript Non-blocking Stream & Line Counter');
  console.log('================================================================\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase02-verify-'));

  try {
    // -------------------------------------------------------------
    // Test 1: Line counting accuracy across various file sizes
    // -------------------------------------------------------------
    console.log('[Test 1] Testing countTranscriptLinesAsync accuracy on Small, Medium, and 10MB+ JSONL files...');

    // 1a. Small file with various whitespace / empty lines / trailing newline variations
    const smallFilePath = path.join(tempDir, 'small.jsonl');
    const smallContent = [
      '{"step":1,"content":"first"}',
      '',
      '   ',
      '{"step":2,"content":"second"}',
      '\t\t',
      '{"step":3,"content":"third"}',
      ''
    ].join('\n');
    fs.writeFileSync(smallFilePath, smallContent, 'utf8');

    const expectedSmallLines = smallContent.split('\n').filter(l => l.trim().length > 0).length;
    assert.strictEqual(expectedSmallLines, 3);
    const countedSmallLines = await countTranscriptLinesAsync(smallFilePath);
    assert.strictEqual(countedSmallLines, expectedSmallLines, `Small file count must be exactly ${expectedSmallLines}, got ${countedSmallLines}`);
    console.log(`  -> Passed: Small file counted accurately (${countedSmallLines} non-empty lines).`);

    // 1b. Medium file (5000 lines, mixed content)
    const mediumFilePath = path.join(tempDir, 'medium.jsonl');
    const mediumLinesArray: string[] = [];
    for (let i = 0; i < 5000; i++) {
      if (i % 7 === 0) {
        mediumLinesArray.push('   \t  '); // whitespace-only line
      } else if (i % 13 === 0) {
        mediumLinesArray.push(''); // empty line
      } else {
        mediumLinesArray.push(JSON.stringify({ step: i, text: `Step message index ${i} with payload data.` }));
      }
    }
    const mediumContent = mediumLinesArray.join('\n');
    fs.writeFileSync(mediumFilePath, mediumContent, 'utf8');

    const expectedMediumLines = mediumContent.split('\n').filter(l => l.trim().length > 0).length;
    const countedMediumLines = await countTranscriptLinesAsync(mediumFilePath);
    assert.strictEqual(countedMediumLines, expectedMediumLines, `Medium file count must be ${expectedMediumLines}, got ${countedMediumLines}`);
    console.log(`  -> Passed: Medium file (5,000 lines) counted accurately (${countedMediumLines} non-empty lines).`);

    // 1c. Large file (10MB+ synthetic JSONL) & Memory/Throughput test
    const largeFilePath = path.join(tempDir, 'large_10mb.jsonl');
    const writeStream = fs.createWriteStream(largeFilePath, { encoding: 'utf8' });

    let expectedLargeLines = 0;
    const sampleRecord = JSON.stringify({
      step_index: 9999,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      content: 'Antigravity line counter benchmark payload testing chunked streams without buffer overflow '.repeat(4)
    }) + '\n';

    // Target ~12MB
    const targetBytes = 12 * 1024 * 1024;
    let writtenBytes = 0;
    while (writtenBytes < targetBytes) {
      writeStream.write(sampleRecord);
      writtenBytes += Buffer.byteLength(sampleRecord, 'utf8');
      expectedLargeLines++;
      if (expectedLargeLines % 10 === 0) {
        // Interleave some blank lines to ensure trim semantics hold over chunk boundaries
        writeStream.write('  \n\n');
        writtenBytes += 4;
      }
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end(resolve);
      writeStream.on('error', reject);
    });

    const fileStat = fs.statSync(largeFilePath);
    assert.ok(fileStat.size >= targetBytes, `File size should be at least 12MB, got ${(fileStat.size / (1024 * 1024)).toFixed(2)} MB`);

    const tStart = Date.now();
    const countedLargeLines = await countTranscriptLinesAsync(largeFilePath);
    const durationMs = Math.max(Date.now() - tStart, 1);
    const throughputMBps = (fileStat.size / (1024 * 1024)) / (durationMs / 1000);

    assert.strictEqual(countedLargeLines, expectedLargeLines, `Large 10MB+ file line count must match expected ${expectedLargeLines}, got ${countedLargeLines}`);
    console.log(`  -> Passed: Large file (${(fileStat.size / (1024 * 1024)).toFixed(2)} MB, ${countedLargeLines} lines) processed in ${durationMs}ms (~${throughputMBps.toFixed(1)} MB/s).\n`);

    // -------------------------------------------------------------
    // Test 2: Bounded maxOffset calculations matching sliced content
    // -------------------------------------------------------------
    console.log('[Test 2] Testing bounded maxOffset calculations matching exact sliced content...');

    // Test zero offset
    const zeroOffsetCount = await countTranscriptLinesAsync(mediumFilePath, 0);
    assert.strictEqual(zeroOffsetCount, 0, 'maxOffset 0 should result in 0 lines');

    // Test partial offsets at various byte boundaries (across chunk boundaries)
    const testOffsets = [
      128,
      1024,
      MAX_CHUNK_SIZE - 5,
      MAX_CHUNK_SIZE,
      MAX_CHUNK_SIZE + 17,
      Math.floor(mediumContent.length / 2),
      mediumContent.length - 10
    ];

    for (const offset of testOffsets) {
      const slice = mediumContent.slice(0, offset);
      const expectedSliceCount = slice.split('\n').filter(l => l.trim().length > 0).length;
      const actualOffsetCount = await countTranscriptLinesAsync(mediumFilePath, offset);
      assert.strictEqual(
        actualOffsetCount,
        expectedSliceCount,
        `Line count at offset ${offset} must match sliced content (${expectedSliceCount}), got ${actualOffsetCount}`
      );
    }
    console.log('  -> Passed: All bounded maxOffset test points matched exact sliced line count semantics.\n');

    // -------------------------------------------------------------
    // Test 3: Event Loop Responsiveness during watchFile & switchActiveConversation
    // -------------------------------------------------------------
    console.log('[Test 3] Testing watchFile & performArbitrationCheck non-blocking initialization...');

    const brainDir = path.join(tempDir, 'brain');
    fs.mkdirSync(brainDir, { recursive: true });

    // Initial conversation directory with pre-existing transcript
    const conv1Dir = path.join(brainDir, 'conv-01', '.system_generated', 'logs');
    fs.mkdirSync(conv1Dir, { recursive: true });
    const conv1Transcript = path.join(conv1Dir, 'transcript.jsonl');
    fs.writeFileSync(conv1Transcript, mediumContent, 'utf8');

    // Setup an event loop heartbeat timer to detect thread freezing
    let eventLoopHeartbeats = 0;
    const heartbeatInterval = setInterval(() => {
      eventLoopHeartbeats++;
    }, 10);

    const watcher = new TranscriptWatcher({
      brainDir,
      keyword: DEFAULT_COMPLETION_KEYWORD,
      timeoutMs: 5000,
      pollIntervalMs: 100,
      relaxedPollIntervalMs: 200,
      arbitrationTimeoutMs: 300,
      settleQuietPeriodMs: 100
    });

    const preHeartbeats = eventLoopHeartbeats;
    // watchFile with offset
    const watchPromise = watcher.watchFile(conv1Transcript, 'conv-01', Math.floor(mediumContent.length / 2));

    // Allow event loop to cycle
    await sleep(60);
    assert.ok(
      eventLoopHeartbeats > preHeartbeats,
      'Event loop must continue firing timers during watchFile initialization without blocking'
    );
    assert.strictEqual(watcher['initialTranscriptLength'], await countTranscriptLinesAsync(conv1Transcript, Math.floor(mediumContent.length / 2)));
    console.log('  -> Passed: watchFile initialized asynchronously with non-blocking line counting.');

    // Now test switchActiveConversation / performArbitrationCheck rebind with non-blocking line counting
    const conv2Dir = path.join(brainDir, 'conv-02', '.system_generated', 'logs');
    fs.mkdirSync(conv2Dir, { recursive: true });
    const conv2Transcript = path.join(conv2Dir, 'transcript.jsonl');
    // Write pre-existing content to conv2
    fs.writeFileSync(conv2Transcript, smallContent, 'utf8');

    // Mark candidate baseline for conv2
    watcher['candidateBaselineSizes'].set(conv2Transcript, Buffer.byteLength(smallContent, 'utf8'));
    watcher['candidatePreExisted'].add(conv2Transcript);

    // Append new line to conv2 to trigger arbitration rebind
    const appendContent = JSON.stringify({
      step_index: 99,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      tool_calls: null,
      content: `Done task! ${DEFAULT_COMPLETION_KEYWORD}`,
      timestamp: Date.now()
    }) + '\n';
    fs.appendFileSync(conv2Transcript, appendContent, 'utf8');

    let reboundFired = false;
    watcher.once('conversationRebound', (oldId, newId, newPath) => {
      reboundFired = true;
      assert.strictEqual(newId, 'conv-02');
      assert.strictEqual(newPath, conv2Transcript);
    });

    // Wait for arbitration and completion
    const result = await watchPromise;
    clearInterval(heartbeatInterval);

    assert.ok(reboundFired, 'Watcher should have rebound to active conversation conv-02');
    assert.ok(result.success, 'Watcher should successfully detect keyword after arbitration rebind');
    assert.strictEqual(result.conversationId, 'conv-02');

    watcher.stop();
    console.log('  -> Passed: switchActiveConversation / arbitration check successfully executed asynchronously.\n');

    console.log('================================================================');
    console.log(' ALL PHASE 02 TESTS PASSED SUCCESSFULLY!');
    console.log('================================================================');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase02Verification().catch((err) => {
  console.error('Phase 02 Verification failed:', err);
  process.exit(1);
});
