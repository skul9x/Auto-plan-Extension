// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockActiveTextEditor: any = undefined;
let mockWorkspaceFolders: any[] = [];
const mockConfigStore: Record<string, any> = {};
let executedCommands: string[] = [];

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
        get workspaceFolders() {
          return mockWorkspaceFolders;
        }
      },
      window: {
        get activeTextEditor() {
          return mockActiveTextEditor;
        },
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
        executeCommand: async (cmd: string, ...args: any[]) => {
          executedCommands.push(cmd);
          return true;
        }
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 },
      StatusBarAlignment: { Left: 1, Right: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { EventEmitter } from 'events';
import { Bot, Context } from 'grammy';
import {
  ThrottledNotifier,
  formatActivityPreview,
  isRateLimitError,
  extractRetryAfter
} from '../telegramNotifier';
import { TelegramBridge } from '../telegramBridge';
import { DebugLogger } from '../debugLogger';

interface MockApiCall {
  method: string;
  payload: any;
  timestamp: number;
}

function createMockBot(token: string = '123456:TEST_TOKEN'): {
  bot: Bot;
  apiCalls: MockApiCall[];
  sentMessages: any[];
  editedMessages: any[];
  unpinnedMessages: any[];
  setSimulate429Once: (retryAfterSec: number) => void;
} {
  const bot = new Bot(token, {
    botInfo: {
      id: 8930752011,
      is_bot: true,
      first_name: 'AutoPlanTestBot',
      username: 'autoplan_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false
    } as any
  });

  const apiCalls: MockApiCall[] = [];
  const sentMessages: any[] = [];
  const editedMessages: any[] = [];
  const unpinnedMessages: any[] = [];
  let simulate429AfterSec: number | null = null;
  let nextMessageId = 100;

  bot.api.config.use(async (prev, method, payload, signal) => {
    const record: MockApiCall = {
      method,
      payload: JSON.parse(JSON.stringify(payload || {})),
      timestamp: Date.now()
    };
    apiCalls.push(record);

    if (simulate429AfterSec !== null) {
      const wait = simulate429AfterSec;
      simulate429AfterSec = null;
      const err: any = new Error(`Too Many Requests: retry after ${wait}`);
      err.error_code = 429;
      err.description = `Too Many Requests: retry after ${wait}`;
      err.parameters = { retry_after: wait };
      throw err;
    }

    if (method === 'sendMessage') {
      const msgId = ++nextMessageId;
      sentMessages.push({ ...record.payload, message_id: msgId });
      return {
        ok: true,
        result: {
          message_id: msgId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: record.payload.chat_id, type: 'private', first_name: 'Chat' },
          text: record.payload.text
        }
      } as any;
    }

    if (method === 'editMessageText') {
      editedMessages.push(record.payload);
      return {
        ok: true,
        result: {
          message_id: record.payload.message_id,
          date: Math.floor(Date.now() / 1000),
          chat: { id: record.payload.chat_id, type: 'private', first_name: 'Chat' },
          text: record.payload.text
        }
      } as any;
    }

    if (method === 'unpinChatMessage') {
      unpinnedMessages.push(record.payload);
      return { ok: true, result: true } as any;
    }

    return { ok: true, result: {} } as any;
  });

  return {
    bot,
    apiCalls,
    sentMessages,
    editedMessages,
    unpinnedMessages,
    setSimulate429Once: (sec: number) => {
      simulate429AfterSec = sec;
    }
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase04StreamNotificationsThrottleTest() {
  console.log('================================================================');
  console.log(' Phase 04: Real-Time Transcript Stream & Throttled Notifications');
  console.log('================================================================\n');

  const testLogger = new DebugLogger(100);

  try {
    // ------------------------------------------------------------------------
    // SUITE 1: Preview Formatting & 429 Error Detection Utilities
    // ------------------------------------------------------------------------
    console.log('[Suite 1] Preview Formatting & Rate Limit Utilities');

    // 1.1 formatActivityPreview with structured tool calls
    const readStep = JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      tool_calls: [{ toolAction: 'Reading src/auth.ts' }]
    });
    const editStep = JSON.stringify({
      step_index: 2,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      tool_calls: [{ toolAction: 'Editing controllers' }]
    });
    const runStep = JSON.stringify({
      step_index: 3,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      tool_calls: [{ tool_name: 'run_command', parameters: { CommandLine: 'npm test' } }]
    });
    const viewStep = JSON.stringify({
      step_index: 4,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      tool_calls: [{ tool_name: 'view_file', parameters: { AbsolutePath: '/app/src/user.ts' } }]
    });
    const contentStep = JSON.stringify({
      step_index: 5,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      content: 'Refactoring database models to support pooling'
    });

    assert.ok(formatActivityPreview(readStep).includes('Reading src/auth.ts'), 'Should format reading toolAction');
    assert.ok(formatActivityPreview(editStep).includes('Editing controllers'), 'Should format editing toolAction');
    assert.ok(formatActivityPreview(runStep).includes('npm test'), 'Should format command execution');
    assert.ok(formatActivityPreview(viewStep).includes('user.ts'), 'Should format view_file target');
    assert.ok(formatActivityPreview(contentStep).includes('Refactoring database models'), 'Should format thinking/content');

    // 1.2 Plain text fallback
    assert.ok(formatActivityPreview('Reading src/auth.ts...').includes('Reading src/auth.ts...'), 'Plain string reading');
    assert.ok(formatActivityPreview('Editing controllers...').includes('Editing controllers...'), 'Plain string editing');
    assert.strictEqual(formatActivityPreview(''), '⏳ In progress...', 'Empty input fallback');

    // 1.3 isRateLimitError and extractRetryAfter
    const err429A = { error_code: 429, parameters: { retry_after: 6 } };
    assert.strictEqual(isRateLimitError(err429A), true, 'Should detect error_code 429');
    assert.strictEqual(extractRetryAfter(err429A), 6000, 'Should extract 6 seconds as 6000ms');

    const err429B = { message: 'Telegram API Too Many Requests: retry after 2', status: 429 };
    assert.strictEqual(isRateLimitError(err429B), true, 'Should detect status 429 in message');
    assert.strictEqual(extractRetryAfter(err429B), 2000, 'Should extract 2 seconds from message text');

    const err500 = { error_code: 500, description: 'Internal Server Error' };
    assert.strictEqual(isRateLimitError(err500), false, '500 error should not be rate limit');

    console.log('  ✔ Suite 1 passed: Activity previews and 429 utilities verified\n');

    // ------------------------------------------------------------------------
    // SUITE 2: Throttled Live Updates under Rapid Event Bursts
    // ------------------------------------------------------------------------
    console.log('[Suite 2] Throttled Live Stream & Debounced Progress Updates');

    const mock2 = createMockBot();
    const watcherEmitter = new EventEmitter();
    const notifier2 = new ThrottledNotifier({
      bot: mock2.bot,
      chatId: 11111,
      throttleMs: 150,
      logger: testLogger
    });
    notifier2.attachTranscriptWatcher(watcherEmitter);

    // Rapid burst of 20 updates within a few milliseconds
    const burstCount = 20;
    for (let i = 1; i <= burstCount; i++) {
      watcherEmitter.emit('logUpdate', JSON.stringify({
        tool_calls: [{ toolAction: `Reading component_${i}.tsx` }]
      }));
    }

    // Immediately after the burst, exactly 1 send call should have created the live container
    assert.strictEqual(mock2.sentMessages.length, 1, 'Initial update should create live container');
    assert.strictEqual(mock2.editedMessages.length, 0, 'No edits should have fired immediately during burst');

    // Wait 200ms to allow debounce / throttle quiet window to elapse
    await sleep(220);

    // After throttle interval, exactly 1 debounced edit should have been sent containing the latest burst update
    assert.strictEqual(mock2.editedMessages.length, 1, 'Debounced edit should fire once after throttle interval');
    const lastEdit = mock2.editedMessages[0];
    assert.ok(
      lastEdit.text.includes(`component_${burstCount}.tsx`),
      'Debounced edit must contain the latest buffered update'
    );

    // Emitting settleStarted should also debounce into live progress
    watcherEmitter.emit('settleStarted', { quietPeriodMs: 2000 });
    await sleep(200);
    assert.strictEqual(mock2.editedMessages.length, 2, 'settleStarted should trigger another throttled edit');
    assert.ok(
      mock2.editedMessages[1].text.includes('Verifying completion stability'),
      'Edit should reflect settle quiet period'
    );

    notifier2.dispose();
    console.log('  ✔ Suite 2 passed: Rapid bursts throttled strictly to configured interval\n');

    // ------------------------------------------------------------------------
    // SUITE 3: Orchestrator Lifecycle Events Formatting
    // ------------------------------------------------------------------------
    console.log('[Suite 3] Orchestrator Lifecycle Event Notifications');

    const mock3 = createMockBot();
    const orchEmitter = new EventEmitter();
    const notifier3 = new ThrottledNotifier({
      bot: mock3.bot,
      chatId: 22222,
      throttleMs: 100,
      logger: testLogger
    });
    notifier3.attachOrchestrator(orchEmitter);

    // 3.1 phaseStart event
    orchEmitter.emit('phaseStart', { fileName: 'phase-01-scaffold.md' }, 0, 4);
    await sleep(30);
    assert.ok(
      mock3.sentMessages.some((m) => m.text.includes('🚀 Phase Started: phase-01-scaffold.md (1/4)')),
      'Must format phaseStart with phase name and index/total'
    );

    // 3.2 phaseComplete event
    orchEmitter.emit(
      'phaseComplete',
      { fileName: 'phase-01-scaffold.md' },
      { durationMs: 4200, summary: 'All 8 unit tests passed' },
      0,
      4
    );
    await sleep(30);
    assert.ok(
      mock3.sentMessages.some(
        (m) =>
          m.text.includes('✅ Phase Completed: phase-01-scaffold.md') &&
          m.text.includes('Iteration 1/4') &&
          m.text.includes('All 8 unit tests passed')
      ),
      'Must format phaseComplete with iteration summary'
    );

    // 3.3 skipped event
    orchEmitter.emit('skipped', { fileName: 'phase-02-optional.md' });
    await sleep(30);
    assert.ok(
      mock3.sentMessages.some((m) => m.text.includes('⏭️ Phase Skipped: phase-02-optional.md')),
      'Must format skipped phase notification'
    );

    // 3.4 stopped event
    orchEmitter.emit('stopped');
    await sleep(30);
    assert.ok(
      mock3.sentMessages.some((m) => m.text.includes('🛑 Plan Execution Stopped')),
      'Must format stopped notification'
    );

    // 3.5 allComplete event
    orchEmitter.emit('allComplete', 4);
    await sleep(30);
    assert.ok(
      mock3.sentMessages.some((m) => m.text.includes('🎉 All Phases Completed Successfully!')),
      'Must format allComplete notification'
    );

    // 3.6 error event
    orchEmitter.emit('error', new Error('Bridge DOM Injection Timeout'));
    await sleep(30);
    assert.ok(
      mock3.sentMessages.some((m) => m.text.includes('❌ Error: Bridge DOM Injection Timeout')),
      'Must format error notification'
    );

    notifier3.dispose();
    console.log('  ✔ Suite 3 passed: All orchestrator lifecycle events correctly formatted\n');

    // ------------------------------------------------------------------------
    // SUITE 4: Completion Keyword ('Done skul9x.') & Large Output Delivery
    // ------------------------------------------------------------------------
    console.log('[Suite 4] Completion Keyword & Message Chunking Delivery');

    const mock4 = createMockBot();
    const watcher4 = new EventEmitter();
    const notifier4 = new ThrottledNotifier({
      bot: mock4.bot,
      chatId: 33333,
      throttleMs: 100,
      logger: testLogger
    });
    notifier4.attachTranscriptWatcher(watcher4);

    // 4.1 Keyword completion flushes buffer and delivers summary
    watcher4.emit('logUpdate', 'Reading file config.json');
    watcher4.emit('onCompletionDetected', {
      conversationId: 'conv_999',
      matchedContent: 'Done skul9x. Phase completed with zero errors and 100% test coverage.'
    });

    await sleep(50);
    const completionMsg = mock4.sentMessages.find((m) =>
      m.text.includes('Completion Detected') && m.text.includes('Done skul9x.')
    );
    assert.ok(completionMsg, 'Must deliver completion summary message upon detection of Done skul9x.');
    assert.ok(
      completionMsg.text.includes('Phase completed with zero errors and 100% test coverage.'),
      'Completion message must contain final output excerpt'
    );

    // 4.2 Lengthy output (> 3800 chars) chunks and sends sequentially
    const initialSentCount = mock4.sentMessages.length;
    const longOutput = 'A'.repeat(2500) + '\n\n' + 'B'.repeat(2500); // 5002 chars total
    watcher4.emit('onCompletionDetected', {
      conversationId: 'conv_long',
      matchedContent: longOutput
    });

    await sleep(50);
    const chunksSent = mock4.sentMessages.length - initialSentCount;
    assert.ok(chunksSent >= 2, `Long output must be split into multiple chunks, got ${chunksSent}`);
    for (let i = initialSentCount; i < mock4.sentMessages.length; i++) {
      assert.ok(
        mock4.sentMessages[i].text.length <= 3850,
        `Chunk length must not exceed 3850 chars, got ${mock4.sentMessages[i].text.length}`
      );
    }

    notifier4.dispose();
    console.log('  ✔ Suite 4 passed: Completion keyword flush and chunked output delivery verified\n');

    // ------------------------------------------------------------------------
    // SUITE 5: Telegram Rate Limit (429) Backoff & Uncaught Rejection Guard
    // ------------------------------------------------------------------------
    console.log('[Suite 5] Rate Limit (429) Backoff & Error Recovery');

    const mock5 = createMockBot();
    const watcher5 = new EventEmitter();
    const notifier5 = new ThrottledNotifier({
      bot: mock5.bot,
      chatId: 44444,
      throttleMs: 100,
      logger: testLogger
    });
    notifier5.attachTranscriptWatcher(watcher5);

    // Initial message to obtain live container ID
    watcher5.emit('logUpdate', 'Step 1: Init');
    await sleep(30);
    assert.strictEqual(mock5.sentMessages.length, 1);

    // Arm mock bot to reject next edit with HTTP 429 (retry_after: 0.25 seconds = 250ms)
    mock5.setSimulate429Once(0.25);

    // Trigger update that will hit 429
    watcher5.emit('logUpdate', 'Step 2: Burst update triggers 429');
    await sleep(120);

    // Verify notifier caught error and entered pause state
    assert.strictEqual(notifier5.isPaused(), true, 'Notifier must be paused after receiving 429');
    const pausedUntil = notifier5.getPausedUntil();
    assert.ok(pausedUntil > Date.now(), 'pausedUntil must be in the future');

    // Send another update while paused; must NOT trigger immediate API call
    const editCountBefore = mock5.editedMessages.length;
    watcher5.emit('logUpdate', 'Step 3: Update while paused');
    await sleep(50);
    assert.strictEqual(
      mock5.editedMessages.length,
      editCountBefore,
      'No API edits should be made during rate-limited pause'
    );

    // Wait for the 250ms backoff window to expire
    await sleep(250);
    assert.strictEqual(notifier5.isPaused(), false, 'Notifier pause should expire after retry_after duration');

    // New update after backoff should resume edits without issue
    watcher5.emit('logUpdate', 'Step 4: Resumed after 429 backoff');
    await sleep(150);
    assert.ok(
      mock5.editedMessages.some((m) => m.text.includes('Resumed after 429 backoff')),
      'Edits must resume normally after backoff expires'
    );

    notifier5.dispose();
    console.log('  ✔ Suite 5 passed: Rate limit (429) backoff handled cleanly without rejections\n');

    // ------------------------------------------------------------------------
    // SUITE 6: Message History Hygiene & Container Recycling
    // ------------------------------------------------------------------------
    console.log('[Suite 6] Message History Hygiene & Container Recycling');

    const mock6 = createMockBot();
    const orch6 = new EventEmitter();
    const watcher6 = new EventEmitter();
    const notifier6 = new ThrottledNotifier({
      bot: mock6.bot,
      chatId: 55555,
      throttleMs: 100,
      logger: testLogger
    });
    notifier6.attachOrchestrator(orch6);
    notifier6.attachTranscriptWatcher(watcher6);

    // Start Phase 1
    orch6.emit('phaseStart', { fileName: 'phase-01.md', phaseNumber: 1 }, 0, 2);
    await sleep(20);
    watcher6.emit('logUpdate', 'Executing phase 1...');
    await sleep(20);

    const phase1LiveId = notifier6.getLiveMessageId(55555);
    assert.ok(phase1LiveId, 'Phase 1 must have an active live container message ID');

    // Complete Phase 1: must unpin message and clean container
    orch6.emit('phaseComplete', { fileName: 'phase-01.md' }, { summary: 'Done' }, 0, 2);
    await sleep(30);

    assert.strictEqual(
      notifier6.getLiveMessageId(55555),
      undefined,
      'Live container ID must be cleared after phase completion'
    );
    assert.ok(
      mock6.unpinnedMessages.some((p) => p.chat_id === 55555 && p.message_id === phase1LiveId),
      'Phase 1 live message must be unpinned upon completion'
    );

    // Start Phase 2: must spawn a brand-new live container with fresh message ID
    orch6.emit('phaseStart', { fileName: 'phase-02.md', phaseNumber: 2 }, 1, 2);
    await sleep(30);
    watcher6.emit('logUpdate', 'Executing phase 2...');
    await sleep(50);

    const phase2LiveId = notifier6.getLiveMessageId(55555);
    assert.ok(phase2LiveId, 'Phase 2 must generate a fresh active live container ID');
    assert.notStrictEqual(phase1LiveId, phase2LiveId, 'Phase 2 must have a different container ID than Phase 1');

    notifier6.dispose();
    console.log('  ✔ Suite 6 passed: Message history hygiene and container recycling verified\n');

    // ------------------------------------------------------------------------
    // SUITE 7: TelegramBridge Wire-up Integration
    // ------------------------------------------------------------------------
    console.log('[Suite 7] TelegramBridge Wire-up & Lifecycle Integration');

    const mock7 = createMockBot();
    const tempDir7 = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-tg-phase04-'));
    const registryPath7 = path.join(tempDir7, 'ag-autoplan-ports.json');

    const bridgeOrch = new EventEmitter();
    const bridgeWatcher = new EventEmitter();

    const bridge = new TelegramBridge({
      botFactory: () => mock7.bot,
      token: '123456:TEST_TOKEN',
      allowedUsers: [77777],
      throttleMs: 100,
      registryPath: registryPath7,
      logger: testLogger,
      orchestrator: bridgeOrch,
      transcriptWatcher: bridgeWatcher
    });

    await bridge.start();

    const bridgeNotifier = bridge.getNotifier();
    assert.ok(bridgeNotifier, 'TelegramBridge must initialize a ThrottledNotifier instance');
    assert.deepStrictEqual(bridgeNotifier.getEffectiveChatIds(), [77777], 'Notifier must inherit allowedUsers');

    // Emit phaseStart through bridge-attached orchestrator
    bridgeOrch.emit('phaseStart', { fileName: 'phase-01-scaffold.md', phaseNumber: 1 }, 0, 1);
    await sleep(30);

    assert.ok(
      mock7.sentMessages.some((m) => m.chat_id === 77777 && m.text.includes('🚀 Phase Started: phase-01-scaffold.md')),
      'Bridge notifier must broadcast lifecycle events to allowed users'
    );

    // Stop bridge and verify cleanup
    await bridge.stop();
    assert.strictEqual(bridge.getIsRunning(), false, 'Bridge should be stopped');

    try {
      fs.rmSync(tempDir7, { recursive: true, force: true });
    } catch {}

    console.log('  ✔ Suite 7 passed: TelegramBridge notifier integration verified\n');

    console.log('================================================================');
    console.log(' ALL SUITES PASSED! Phase 04 requirements 100% verified.');
    console.log('================================================================\n');
  } catch (err) {
    console.error('❌ Phase 04 test failed:', err);
    process.exit(1);
  }
}

runPhase04StreamNotificationsThrottleTest().catch((err) => {
  console.error('Fatal error running Phase 04 test:', err);
  process.exit(1);
});
