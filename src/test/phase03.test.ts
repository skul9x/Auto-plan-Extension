// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
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
  transcriptWatcher,
  getDefaultBrainDir,
  findLatestConversation,
  getTranscriptPath,
  CompletionEventData
} from '../transcriptWatcher';

async function runPhase03Tests() {
  console.log('=== Running Phase 03 Transcript Watcher Engine Tests ===');

  const testTempDir = path.join(os.tmpdir(), `antigravity_watcher_test_${Date.now()}`);
  fs.mkdirSync(testTempDir, { recursive: true });

  try {
    // Test 1: Brain directory resolution and default instance options
    const defaultBrainDir = getDefaultBrainDir();
    assert.ok(typeof defaultBrainDir === 'string' && defaultBrainDir.length > 0, 'Default brain dir should resolve');
    
    const watcherOpts = transcriptWatcher.getOptions();
    assert.strictEqual(watcherOpts.keyword, 'Done skul9x.', 'Default keyword should be "Done skul9x."');
    assert.strictEqual(watcherOpts.pollIntervalMs, 300);
    console.log('✓ Test 1: Directory discovery & default instance options verified');

    // Test 2: Conversation directory detection (findLatestConversation & waitForNewConversation)
    const conv1Name = 'conv_001_old';
    const conv1Path = path.join(testTempDir, conv1Name);
    fs.mkdirSync(conv1Path, { recursive: true });

    const foundLatest1 = findLatestConversation(testTempDir);
    assert.strictEqual(foundLatest1, conv1Name, 'Should find single existing conversation');

    // Wait for new conversation created after timestamp
    const watcher = new TranscriptWatcher({
      brainDir: testTempDir,
      keyword: 'Done skul9x.',
      pollIntervalMs: 50,
      settleQuietPeriodMs: 50
    });

    await new Promise((r) => setTimeout(r, 100));
    const timestampBeforeConv2 = Date.now();

    const conv2Name = 'conv_002_new';
    const conv2Path = path.join(testTempDir, conv2Name);
    
    // Asynchronously create folder
    setTimeout(() => {
      fs.mkdirSync(conv2Path, { recursive: true });
    }, 100);

    const detectedConv = await watcher.waitForNewConversation(timestampBeforeConv2, conv1Name, 2000, 50);
    assert.strictEqual(detectedConv, conv2Name, 'Should detect newly created conversation folder');
    console.log('✓ Test 2: Conversation folder detection & waitForNewConversation verified');

    // Test 3: Transcript path resolution
    const logDir = path.join(conv2Path, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const transcriptFilePath = path.join(logDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptFilePath, '', 'utf-8');

    const resolvedTranscript = getTranscriptPath(conv2Path);
    assert.strictEqual(resolvedTranscript, transcriptFilePath, 'Should resolve standard transcript.jsonl path');
    console.log('✓ Test 3: Transcript path resolution verified');

    // Test 4: Real-time keyword detection, event emission & latency < 200ms
    let eventReceived: CompletionEventData | null = null;
    watcher.on('onCompletionDetected', (data: CompletionEventData) => {
      eventReceived = data;
    });

    const watchPromise = watcher.watchFile(transcriptFilePath, conv2Name);

    // Initial dummy logs that should NOT trigger completion
    fs.appendFileSync(
      transcriptFilePath,
      JSON.stringify({ step_index: 1, type: 'USER_INPUT', content: 'Execute auto plan prompt' }) + '\n',
      'utf-8'
    );
    fs.appendFileSync(
      transcriptFilePath,
      JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'RUNNING', content: 'Thinking about the request...' }) + '\n',
      'utf-8'
    );

    // Wait a brief tick, ensure no false completion
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(eventReceived, null, 'Should not trigger completion for normal steps');

    // Append completion log and measure trigger latency
    const appendTime = Date.now();
    const completionJson = {
      step_index: 3,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      status: 'DONE',
      content: 'I have finished all tasks. Done skul9x.'
    };
    fs.appendFileSync(transcriptFilePath, JSON.stringify(completionJson) + '\n', 'utf-8');

    const result = await watchPromise;
    const latency = Date.now() - appendTime;

    assert.strictEqual(result.success, true, 'Watch result should be successful');
    assert.strictEqual(result.conversationId, conv2Name);
    assert.ok(result.matchedContent?.includes('Done skul9x.'), 'Matched content must contain keyword');
    assert.ok(eventReceived !== null, 'onCompletionDetected event should have fired');
    assert.strictEqual((eventReceived as any)?.conversationId, conv2Name);
    assert.ok(latency <= 200, `Keyword detection latency (${latency}ms) must be <= 200ms`);
    console.log(`✓ Test 4: Real-time keyword detection verified (Latency: ${latency}ms, < 200ms criterion met)`);

    // Test 5: Timeout safety mechanism
    const timeoutWatcher = new TranscriptWatcher({
      brainDir: testTempDir,
      keyword: 'NonExistentKeyword',
      timeoutMs: 300,
      pollIntervalMs: 50
    });

    let timeoutEventFired = false;
    timeoutWatcher.on('timeout', () => {
      timeoutEventFired = true;
    });

    const timeoutResult = await timeoutWatcher.watchFile(transcriptFilePath, 'test_timeout');
    assert.strictEqual(timeoutResult.success, false, 'Timeout should result in success = false');
    assert.ok(timeoutResult.error?.includes('timed out'), 'Error message should indicate timeout');
    assert.strictEqual(timeoutEventFired, true, 'Timeout event should be emitted');
    console.log('✓ Test 5: Timeout safety mechanism verified');

    // Test 6: Cleanup & Dispose
    timeoutWatcher.dispose();
    watcher.dispose();
    console.log('✓ Test 6: Watcher cleanup & resource disposal verified');

    console.log('\n=== All Phase 03 Tests Passed Successfully! ===');
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase03Tests().catch((err) => {
  console.error('Phase 03 Test Failed:', err);
  process.exit(1);
});
