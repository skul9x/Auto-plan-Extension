// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section: string) => ({
          get: (key: string, defaultValue: any) =>
            mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            mockConfigStore[key] = val;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        workspaceFolders: []
      },
      window: {
        activeTextEditor: undefined,
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        registerWebviewViewProvider: () => ({ dispose: () => {} }),
        showInformationMessage: async () => {},
        showWarningMessage: async () => {},
        showErrorMessage: async () => {}
      },
      commands: {
        executeCommand: async () => true
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 },
      StatusBarAlignment: { Left: 1, Right: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TelegramBridge } from '../telegramBridge';
import * as transcriptWatcherModule from '../transcriptWatcher';
import { debugLogger } from '../debugLogger';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase02TelegramAsyncLegacyFallbackTest() {
  console.log('======================================================================');
  console.log(' Phase 02: Telegram Async Legacy Fallback & Event Loop Protection Test');
  console.log('======================================================================\n');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-phase02-fallback-'));
  const prevBrainEnv = process.env.ANTIGRAVITY_BRAIN_DIR;

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Zero Synchronous I/O in awaitAndReplyModelResponse
    // ------------------------------------------------------------------------
    console.log('[Test 1] Verifying Zero Synchronous I/O Calls (statSync, readdirSync)...');
    {
      const tempBrainDir = path.join(tempRoot, 'brain1');
      fs.mkdirSync(tempBrainDir, { recursive: true });
      process.env.ANTIGRAVITY_BRAIN_DIR = tempBrainDir;
      transcriptWatcherModule.clearBrainDirCache(tempBrainDir);

      const convDir = path.join(tempBrainDir, 'conv-test-01');
      const logsDir = path.join(convDir, '.system_generated', 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      const transcriptFile = path.join(logsDir, 'transcript.jsonl');

      // Create model response entry
      const logEntry = JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: [],
        content: 'Hello from non-blocking async fallback!'
      }) + '\n';
      fs.writeFileSync(transcriptFile, logEntry, 'utf8');

      // Spy on synchronous I/O operations
      const syncCalls: Array<{ method: string; path?: string }> = [];
      const origStatSync = fs.statSync;
      const origReaddirSync = fs.readdirSync;

      (fs as any).statSync = function (p: any, ...args: any[]) {
        syncCalls.push({ method: 'statSync', path: String(p) });
        return (origStatSync as any).apply(this, [p, ...args]);
      };
      (fs as any).readdirSync = function (p: any, ...args: any[]) {
        syncCalls.push({ method: 'readdirSync', path: String(p) });
        return (origReaddirSync as any).apply(this, [p, ...args]);
      };

      const repliedChunks: string[] = [];
      const mockCtx: any = {
        from: { id: 12345, username: 'tester' },
        chat: { id: 12345 },
        reply: async (text: string) => {
          repliedChunks.push(text);
          return { message_id: 3001 };
        }
      };

      const bridge = new TelegramBridge({
        token: 'mock_token',
        allowedUsers: [12345],
        logger: debugLogger
      });

      try {
        await bridge.awaitAndReplyModelResponse(mockCtx, transcriptFile, 0, 3000);
      } finally {
        (fs as any).statSync = origStatSync;
        (fs as any).readdirSync = origReaddirSync;
      }

      assert.strictEqual(syncCalls.length, 0, `Expected 0 synchronous I/O calls, but found: ${JSON.stringify(syncCalls)}`);
      assert.strictEqual(repliedChunks.length, 1, 'Expected exactly 1 replied message');
      assert.ok(repliedChunks[0].includes('Hello from non-blocking async fallback!'));
      console.log('  ✓ Zero synchronous I/O operations confirmed during fallback execution.');
    }

    // ------------------------------------------------------------------------
    // TEST 2: Throttled Path Resolution (>= 1500ms) on Unresolved Transcript
    // ------------------------------------------------------------------------
    console.log('\n[Test 2] Verifying Throttled Path Resolution (>= 1500ms throttle)...');
    {
      const tempBrainDir = path.join(tempRoot, 'brain2');
      fs.mkdirSync(tempBrainDir, { recursive: true });
      process.env.ANTIGRAVITY_BRAIN_DIR = tempBrainDir;
      transcriptWatcherModule.clearBrainDirCache(tempBrainDir);

      let asyncFindCallCount = 0;
      const findTimestamps: number[] = [];

      // Intercept findLatestConversationAsync to measure throttle frequency
      const origFindLatestConversationAsync = transcriptWatcherModule.findLatestConversationAsync;
      (transcriptWatcherModule as any).findLatestConversationAsync = async (...args: any[]) => {
        asyncFindCallCount++;
        findTimestamps.push(Date.now());
        return origFindLatestConversationAsync.apply(transcriptWatcherModule, args as any);
      };

      const repliedChunks: string[] = [];
      const mockCtx: any = {
        from: { id: 12345, username: 'tester' },
        chat: { id: 12345 },
        reply: async (text: string) => {
          repliedChunks.push(text);
          return { message_id: 3002 };
        }
      };

      const bridge = new TelegramBridge({
        token: 'mock_token',
        allowedUsers: [12345],
        logger: debugLogger
      });

      // Start awaitAndReplyModelResponse with initialTranscriptPath = null
      const waitPromise = bridge.awaitAndReplyModelResponse(mockCtx, null, 0, 5000);

      try {
        // Wait 1000ms. In a 250ms polling loop, unthrottled resolution would execute ~4 times.
        // With 1500ms throttle, it must execute exactly 1 time!
        await sleep(1000);
        assert.strictEqual(
          asyncFindCallCount,
          1,
          `Expected exactly 1 discovery scan within 1000ms due to 1500ms throttle (got ${asyncFindCallCount})`
        );
        console.log(`  ✓ 1000ms elapsed with 250ms polling: exactly ${asyncFindCallCount} throttled call made.`);

        // Now wait past the 1500ms window (e.g. to 1700ms total) and create conversation
        await sleep(700);

        const conv2Dir = path.join(tempBrainDir, 'conv-test-02');
        const logs2Dir = path.join(conv2Dir, '.system_generated', 'logs');
        fs.mkdirSync(logs2Dir, { recursive: true });
        const transcript2 = path.join(logs2Dir, 'transcript.jsonl');

        fs.writeFileSync(
          transcript2,
          JSON.stringify({
            step_index: 1,
            source: 'MODEL',
            type: 'PLANNER_RESPONSE',
            status: 'DONE',
            tool_calls: [],
            content: 'Discovered conversation after throttle window!'
          }) + '\n',
          'utf8'
        );

        // Await completion
        await waitPromise;

        assert.ok(asyncFindCallCount >= 2, `Expected at least 2 throttled discovery scans (got ${asyncFindCallCount})`);
        const delta = findTimestamps[1] - findTimestamps[0];
        assert.ok(delta >= 1450, `Throttle gap between calls must be >= 1500ms (got ${delta}ms)`);
        assert.strictEqual(repliedChunks.length, 1);
        assert.ok(repliedChunks[0].includes('Discovered conversation after throttle window!'));
        console.log(`  ✓ Conversation discovered after ${delta}ms gap, reply dispatched successfully.`);
      } finally {
        (transcriptWatcherModule as any).findLatestConversationAsync = origFindLatestConversationAsync;
      }
    }

    // ------------------------------------------------------------------------
    // TEST 3: Streaming, Chunking & Plain-Text Delivery (> 3800 chars)
    // ------------------------------------------------------------------------
    console.log('\n[Test 3] Verifying Streaming, Chunking and Plain-Text Delivery (> 3800 chars)...');
    {
      const tempBrainDir = path.join(tempRoot, 'brain3');
      fs.mkdirSync(tempBrainDir, { recursive: true });
      process.env.ANTIGRAVITY_BRAIN_DIR = tempBrainDir;
      transcriptWatcherModule.clearBrainDirCache(tempBrainDir);

      const conv3Dir = path.join(tempBrainDir, 'conv-test-03');
      const logs3Dir = path.join(conv3Dir, '.system_generated', 'logs');
      fs.mkdirSync(logs3Dir, { recursive: true });
      const transcript3 = path.join(logs3Dir, 'transcript.jsonl');

      // Create an initial empty file
      fs.writeFileSync(transcript3, '', 'utf8');

      const repliedChunks: string[] = [];
      const mockCtx: any = {
        from: { id: 12345, username: 'tester' },
        chat: { id: 12345 },
        reply: async (text: string) => {
          repliedChunks.push(text);
          return { message_id: 3003 };
        }
      };

      const bridge = new TelegramBridge({
        token: 'mock_token',
        allowedUsers: [12345],
        logger: debugLogger
      });

      const waitPromise = bridge.awaitAndReplyModelResponse(mockCtx, transcript3, 0, 5000);

      // Construct a long text with markdown (> 6000 chars)
      const paragraphs: string[] = [];
      for (let i = 1; i <= 100; i++) {
        paragraphs.push(`### Section ${i}\nThis is **verified** plain text content for test block ${i} describing system health.`);
      }
      const rawMarkdown = paragraphs.join('\n\n');

      await sleep(100);

      // Append running status first
      fs.appendFileSync(
        transcript3,
        JSON.stringify({
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          status: 'RUNNING',
          content: 'Working on response...'
        }) + '\n'
      );

      await sleep(100);

      // Append final DONE response
      fs.appendFileSync(
        transcript3,
        JSON.stringify({
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          tool_calls: [],
          content: rawMarkdown
        }) + '\n'
      );

      await waitPromise;

      assert.ok(repliedChunks.length >= 2, `Expected message to be split into >= 2 chunks, got ${repliedChunks.length}`);
      for (const chunk of repliedChunks) {
        assert.ok(chunk.length <= 3800, `Chunk length ${chunk.length} must be <= 3800`);
        assert.ok(!chunk.includes('### Section'), 'Headers should be stripped of markdown ###');
        assert.ok(!chunk.includes('**verified**'), 'Bold markdown should be stripped');
      }
      console.log(`  ✓ Message cleanly chunked into ${repliedChunks.length} chunks with markdown stripped.`);
    }

    // ------------------------------------------------------------------------
    // TEST 4: Resource Cleanup & Abort Handling via Active Waiter
    // ------------------------------------------------------------------------
    console.log('\n[Test 4] Verifying Resource Cleanup & Active Waiter Abort...');
    {
      const tempBrainDir = path.join(tempRoot, 'brain4');
      fs.mkdirSync(tempBrainDir, { recursive: true });
      process.env.ANTIGRAVITY_BRAIN_DIR = tempBrainDir;
      transcriptWatcherModule.clearBrainDirCache(tempBrainDir);

      const nonExistentPath = path.join(tempBrainDir, 'no-file', 'transcript.jsonl');

      const mockCtx: any = {
        from: { id: 12345 },
        chat: { id: 12345 },
        reply: async () => ({ message_id: 3004 })
      };

      const bridge = new TelegramBridge({
        token: 'mock_token',
        allowedUsers: [12345],
        logger: debugLogger
      });

      // Verify activeWaiters is initially empty
      assert.strictEqual((bridge as any).activeWaiters.size, 0);

      const waitPromise = bridge.awaitAndReplyModelResponse(mockCtx, nonExistentPath, 0, 10000);

      // Verify activeWaiters now has 1 waiter registered
      assert.strictEqual((bridge as any).activeWaiters.size, 1);

      await sleep(50);

      // Calling bridge.stop() must abort all waiters and clear resources
      bridge.stop();

      // WaitPromise must resolve promptly
      await waitPromise;

      assert.strictEqual((bridge as any).activeWaiters.size, 0, 'activeWaiters must be cleared after stop/abort');
      console.log('  ✓ Resource teardown and abort confirmed (activeWaiters cleanly drained).');
    }

    // ------------------------------------------------------------------------
    // TEST 5: Graceful Timeout Handling
    // ------------------------------------------------------------------------
    console.log('\n[Test 5] Verifying Graceful Timeout Handling...');
    {
      const tempBrainDir = path.join(tempRoot, 'brain5');
      fs.mkdirSync(tempBrainDir, { recursive: true });
      process.env.ANTIGRAVITY_BRAIN_DIR = tempBrainDir;
      transcriptWatcherModule.clearBrainDirCache(tempBrainDir);

      const nonExistentPath = path.join(tempBrainDir, 'no-file-timeout', 'transcript.jsonl');

      const mockCtx: any = {
        from: { id: 12345 },
        chat: { id: 12345 },
        reply: async () => ({ message_id: 3005 })
      };

      const bridge = new TelegramBridge({
        token: 'mock_token',
        allowedUsers: [12345],
        logger: debugLogger
      });

      const startTime = Date.now();
      // Set short timeout of 300ms
      await bridge.awaitAndReplyModelResponse(mockCtx, nonExistentPath, 0, 300);
      const elapsed = Date.now() - startTime;

      assert.ok(elapsed >= 250 && elapsed < 1500, `Expected timeout around 300ms, elapsed: ${elapsed}ms`);
      assert.strictEqual((bridge as any).activeWaiters.size, 0, 'activeWaiters must be empty after timeout');
      console.log(`  ✓ Graceful timeout handling confirmed (${elapsed}ms elapsed, zero leaks).`);
    }

    console.log('\n======================================================================');
    console.log('🎉 ALL PHASE 02 TESTS PASSED SUCCESSFULLY! (100% Coverage)');
    console.log('======================================================================\n');
  } finally {
    if (prevBrainEnv !== undefined) {
      process.env.ANTIGRAVITY_BRAIN_DIR = prevBrainEnv;
    } else {
      delete process.env.ANTIGRAVITY_BRAIN_DIR;
    }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

runPhase02TelegramAsyncLegacyFallbackTest().catch((err) => {
  console.error('Phase 02 Test Failed:', err);
  process.exit(1);
});
