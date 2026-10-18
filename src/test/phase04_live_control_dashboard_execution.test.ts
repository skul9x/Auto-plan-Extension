// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockActiveTextEditor: any = undefined;
let mockWorkspaceFolders: any[] = [];
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
        executeCommand: async (cmd: string) => {}
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
import { Bot, InlineKeyboard } from 'grammy';
import {
  TelegramPlanManager,
  DiscoveredPlanFolder,
  buildExecutionDashboard,
  DashboardThrottler,
  isMessageNotModifiedError,
  ExecutionDashboardOptions
} from '../telegramPlanManager';
import { PhaseFile } from '../planScanner';

/**
 * Creates a mock GrammY bot capturing outgoing API requests without network calls.
 */
function createMockBot(
  token: string = '123456:TEST_TOKEN',
  options?: { shouldFailEditWithNotModified?: boolean; shouldFailEditWithMessageNotFound?: boolean }
): {
  bot: Bot;
  sentMessages: any[];
  editedMessages: any[];
  answeredCallbacks: any[];
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

  const sentMessages: any[] = [];
  const editedMessages: any[] = [];
  const answeredCallbacks: any[] = [];

  bot.api.config.use(async (prev, method, payload, signal) => {
    const anyPayload = payload as any;
    if (method === 'sendMessage') {
      sentMessages.push(anyPayload);
      return {
        ok: true,
        result: {
          message_id: 100 + sentMessages.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id, type: 'private' },
          text: anyPayload.text
        }
      } as any;
    }
    if (method === 'editMessageText') {
      if (options?.shouldFailEditWithNotModified) {
        const error: any = new Error(
          'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message'
        );
        error.description =
          'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message';
        error.error_code = 400;
        throw error;
      }
      if (options?.shouldFailEditWithMessageNotFound) {
        const error: any = new Error('Bad Request: message to edit not found');
        error.description = 'Bad Request: message to edit not found';
        error.error_code = 400;
        throw error;
      }
      editedMessages.push(anyPayload);
      return {
        ok: true,
        result: {
          message_id: anyPayload.message_id || 101,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id || 777, type: 'private' },
          text: anyPayload.text
        }
      } as any;
    }
    if (method === 'editMessageReplyMarkup') {
      editedMessages.push(anyPayload);
      return {
        ok: true,
        result: {
          message_id: anyPayload.message_id || 101,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id || 777, type: 'private' }
        }
      } as any;
    }
    if (method === 'answerCallbackQuery') {
      answeredCallbacks.push(anyPayload);
      return { ok: true, result: true } as any;
    }
    return { ok: true, result: true } as any;
  });

  return { bot, sentMessages, editedMessages, answeredCallbacks };
}

/**
 * Creates dummy phase markdown files inside a directory.
 */
function createDummyPhase(
  dir: string,
  fileName: string,
  status: 'Completed' | 'Pending',
  title?: string
): string {
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, fileName);
  const heading = title ? `# ${title}` : `# Phase File: ${fileName}`;
  const content = `${heading}\n\nStatus: ${status === 'Completed' ? '✅ Completed' : '⬜ Pending'}\n\n## Content\nSample phase test content.`;
  fs.writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

async function runPhase04LiveControlDashboardTest(): Promise<void> {
  console.log('================================================================');
  console.log(' Phase 04: Interactive Live Control Dashboard during Execution ');
  console.log('================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan_p4_test_'));
  mockWorkspaceFolders = [{ uri: { fsPath: testTempDir } }];

  try {
    // -------------------------------------------------------------------------
    // Suite 1: Live Control Dashboard Format & Block Progress Bar
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Verifying Live Control Dashboard Format & Block Progress Bar...');

    const runningDashboard = buildExecutionDashboard({
      planName: 'plans/telegram-ux',
      currentPhaseIndex: 2,
      currentPhaseName: 'phase-02-auth-engine.md',
      completedPhases: 3,
      totalPhases: 5,
      state: 'running'
    });

    assert.ok(runningDashboard.text.includes('▶️ ĐANG THỰC THI KẾ HOẠCH'), 'Must include running header');
    assert.ok(runningDashboard.text.includes('📁 Kế hoạch: plans/telegram-ux'), 'Must include plan name');
    assert.ok(
      runningDashboard.text.includes('⏳ Đang chạy: Phase 02 - Auth Engine'),
      'Must format current phase index and readable title'
    );
    assert.ok(
      runningDashboard.text.includes('📊 Tiến độ: ▰▰▰▰▰▱▱▱ 60% (3/5 phase)'),
      'Must format block progress bar with percentage and phase counter'
    );

    // Verify keyboard layout for running state (3 rows)
    const kbRows = runningDashboard.keyboard.inline_keyboard;
    assert.strictEqual(kbRows.length, 3, 'Running dashboard must have exactly 3 button rows');

    // Row 1: Operations: [⏭️ Bỏ qua Phase], [🛑 Dừng lại]
    assert.strictEqual(kbRows[0].length, 2, 'Row 1 must have 2 operation buttons');
    assert.strictEqual(kbRows[0][0].text, '[⏭️ Bỏ qua Phase]');
    assert.strictEqual((kbRows[0][0] as any).callback_data, 'p:db:skip');
    assert.strictEqual(kbRows[0][1].text, '[🛑 Dừng lại]');
    assert.strictEqual((kbRows[0][1] as any).callback_data, 'p:db:stop');

    // Row 2: Utilities: [📸 Chụp màn hình], [🔄 Cập nhật]
    assert.strictEqual(kbRows[1].length, 2, 'Row 2 must have 2 utility buttons');
    assert.strictEqual(kbRows[1][0].text, '[📸 Chụp màn hình]');
    assert.strictEqual((kbRows[1][0] as any).callback_data, 'p:db:scr');
    assert.strictEqual(kbRows[1][1].text, '[🔄 Cập nhật]');
    assert.strictEqual((kbRows[1][1] as any).callback_data, 'p:db:ref');

    // Row 3: Navigation: [📂 Danh sách Plans]
    assert.strictEqual(kbRows[2].length, 1, 'Row 3 must have 1 navigation button');
    assert.strictEqual(kbRows[2][0].text, '[📂 Danh sách Plans]');
    assert.strictEqual((kbRows[2][0] as any).callback_data, 'p:db:nav');

    // Verify callback_data payload lengths <= 64 bytes
    for (let r = 0; r < kbRows.length; r++) {
      for (let c = 0; c < kbRows[r].length; c++) {
        const btn = kbRows[r][c];
        const byteLen = Buffer.byteLength((btn as any).callback_data || '', 'utf8');
        assert.ok(
          byteLen <= 64,
          `Button "${btn.text}" callback_data exceeds 64 bytes (${byteLen} bytes)`
        );
      }
    }

    console.log('  ✔ Suite 1 passed: Dashboard formatting, progress bar, and keyboard rows verified.\n');

    // -------------------------------------------------------------------------
    // Suite 2: DashboardThrottler Rate-Limit Protection & Coalescing
    // -------------------------------------------------------------------------
    console.log('[Suite 2] Verifying DashboardThrottler Anti-Spam (1200ms) & Trailing Edge...');

    const throttler = new DashboardThrottler(100); // Use 100ms for fast reliable testing
    assert.strictEqual(throttler.getMinIntervalMs(), 100, 'Throttler must store minimum interval');

    let executionCount = 0;
    let lastExecutedValue = '';

    // First call executes immediately (leading edge)
    await throttler.schedule(async () => {
      executionCount++;
      lastExecutedValue = 'call_1';
    });
    assert.strictEqual(executionCount, 1, 'Call 1 must execute immediately on idle throttler');
    assert.strictEqual(lastExecutedValue, 'call_1');

    // Rapid calls 2, 3, 4 within the interval must be throttled & coalesced
    throttler.schedule(async () => {
      executionCount++;
      lastExecutedValue = 'call_2';
    });
    throttler.schedule(async () => {
      executionCount++;
      lastExecutedValue = 'call_3';
    });
    throttler.schedule(async () => {
      executionCount++;
      lastExecutedValue = 'call_4';
    });

    assert.strictEqual(
      executionCount,
      1,
      'Calls 2-4 must not execute immediately before timer expires'
    );
    assert.ok(throttler.hasPending(), 'Throttler must report pending task');

    // Wait for throttler trailing edge timer to fire
    await new Promise((resolve) => setTimeout(resolve, 140));

    assert.strictEqual(
      executionCount,
      2,
      'Exactly 1 trailing update must have executed for calls 2-4'
    );
    assert.strictEqual(
      lastExecutedValue,
      'call_4',
      'Trailing update must execute the latest coalesced state (call_4)'
    );

    // Test immediate bypass (isImmediate = true for terminal states)
    await throttler.schedule(async () => {
      executionCount++;
      lastExecutedValue = 'terminal_immediate';
    }, true);

    assert.strictEqual(
      executionCount,
      3,
      'Immediate schedule must bypass throttling interval completely'
    );
    assert.strictEqual(lastExecutedValue, 'terminal_immediate');

    // Test default 1200ms constructor
    const defaultThrottler = new DashboardThrottler();
    assert.strictEqual(
      defaultThrottler.getMinIntervalMs(),
      1200,
      'Default throttler interval must be 1200ms per requirements'
    );

    console.log('  ✔ Suite 2 passed: Rate-limit protection, trailing coalescing, and immediate bypass verified.\n');

    // -------------------------------------------------------------------------
    // Suite 3: Skip Phase Button (p:db:skip) & Orchestrator Integration
    // -------------------------------------------------------------------------
    console.log('[Suite 3] Verifying [⏭️ Bỏ qua Phase] triggers orchestrator.skipCurrentPhase()...');

    let skipCalled = false;
    const mockOrchestrator: any = new EventEmitter();
    mockOrchestrator.isRunning = () => true;
    mockOrchestrator.skipCurrentPhase = () => {
      skipCalled = true;
      return true;
    };
    mockOrchestrator.stop = () => {};

    const planManager = new TelegramPlanManager({
      workspaceRoots: [testTempDir],
      orchestrator: mockOrchestrator
    });
    const { bot: botSkip, answeredCallbacks: cbSkip } = createMockBot();
    planManager.registerWithBot(botSkip);

    await (botSkip as any).handleUpdate({
      update_id: 301,
      callback_query: {
        id: 'cb_skip_1',
        from: { id: 777, is_bot: false, first_name: 'Tester' },
        data: 'p:db:skip',
        message: {
          message_id: 200,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private' }
        }
      }
    });

    assert.ok(skipCalled, 'orchestrator.skipCurrentPhase must be called');
    assert.ok(cbSkip.length >= 1, 'Must answer callback query');
    assert.strictEqual(
      cbSkip[cbSkip.length - 1].text,
      '⏭️ Đang bỏ qua phase...',
      'Toast must confirm phase skip'
    );

    console.log('  ✔ Suite 3 passed: Skip Phase callback triggers orchestrator successfully.\n');

    // -------------------------------------------------------------------------
    // Suite 4: Stop Button (p:db:stop) & Dashboard State Transition
    // -------------------------------------------------------------------------
    console.log('[Suite 4] Verifying [🛑 Dừng lại] triggers stop & transitions to Stopped Dashboard...');

    let stopCalled = false;
    mockOrchestrator.stop = () => {
      stopCalled = true;
    };

    const { bot: botStop, editedMessages: editsStop, answeredCallbacks: cbStop } = createMockBot();
    planManager.setBot(botStop);
    planManager.registerWithBot(botStop);

    // Setup active dashboard session
    planManager.setActiveDashboardSession({
      chatId: 777,
      messageId: 200,
      planName: 'plans/telegram-ux',
      currentPhaseName: 'phase-03-picker.md',
      currentPhaseIndex: 3,
      completedPhases: 2,
      totalPhases: 5,
      state: 'running',
      bot: botStop
    });

    await (botStop as any).handleUpdate({
      update_id: 302,
      callback_query: {
        id: 'cb_stop_1',
        from: { id: 777, is_bot: false, first_name: 'Tester' },
        data: 'p:db:stop',
        message: {
          message_id: 200,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private' }
        }
      }
    });

    assert.ok(stopCalled, 'orchestrator.stop must be called');
    assert.ok(cbStop.length >= 1, 'Must answer callback query');
    assert.strictEqual(
      cbStop[cbStop.length - 1].text,
      '🛑 Đang dừng kế hoạch...',
      'Toast must confirm stop action'
    );

    const activeSession = planManager.getActiveDashboardSession();
    assert.strictEqual(activeSession?.state, 'stopped', 'Dashboard session state must become stopped');

    assert.ok(editsStop.length >= 1, 'Must edit message to stopped state');
    const stoppedText = editsStop[editsStop.length - 1].text;
    assert.ok(
      stoppedText.includes('🛑 KẾ HOẠCH ĐÃ ĐƯỢC DỪNG LẠI'),
      'Must render stopped header in dashboard'
    );

    const stoppedKb = editsStop[editsStop.length - 1].reply_markup.inline_keyboard;
    assert.strictEqual(stoppedKb[0][0].text, '[⚡ Tiếp tục]', 'Must present resume button when stopped');
    assert.strictEqual(stoppedKb[0][1].text, '[📂 Danh sách Plans]', 'Must present nav button when stopped');

    console.log('  ✔ Suite 4 passed: Stop button stopped orchestrator and updated dashboard controls.\n');

    // -------------------------------------------------------------------------
    // Suite 5: Soft Handling of "message is not modified"
    // -------------------------------------------------------------------------
    console.log('[Suite 5] Verifying Soft Error Handling for "message is not modified"...');

    // Test error predicate
    const notModErr = new Error('Bad Request: message is not modified: ...');
    assert.ok(isMessageNotModifiedError(notModErr), 'Must detect "message is not modified" in Error');
    assert.ok(
      isMessageNotModifiedError({ description: 'message is not modified' }),
      'Must detect "message is not modified" in Grammy description'
    );
    assert.ok(!isMessageNotModifiedError(new Error('Network failure')), 'Must not flag other errors');

    // Test bot callback handling when Telegram rejects with 400 not modified
    const { bot: botNotMod, answeredCallbacks: cbNotMod } = createMockBot(undefined, {
      shouldFailEditWithNotModified: true
    });

    const planManagerNotMod = new TelegramPlanManager({
      workspaceRoots: [testTempDir],
      orchestrator: mockOrchestrator
    });
    planManagerNotMod.setBot(botNotMod);
    planManagerNotMod.registerWithBot(botNotMod);

    planManagerNotMod.setActiveDashboardSession({
      chatId: 777,
      messageId: 200,
      planName: 'plans/telegram-ux',
      currentPhaseName: 'phase-03-picker.md',
      currentPhaseIndex: 3,
      completedPhases: 2,
      totalPhases: 5,
      state: 'running',
      bot: botNotMod
    });

    // Dispatch [🔄 Cập nhật] callback query
    let thrownError: any = null;
    try {
      await (botNotMod as any).handleUpdate({
        update_id: 303,
        callback_query: {
          id: 'cb_ref_1',
          from: { id: 777, is_bot: false, first_name: 'Tester' },
          data: 'p:db:ref',
          message: {
            message_id: 200,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private' }
          }
        }
      });
    } catch (err) {
      thrownError = err;
    }

    assert.strictEqual(thrownError, null, 'Must swallow "message is not modified" without crashing');
    assert.ok(cbNotMod.length >= 1, 'Must answer callback query');
    const toastNotMod = cbNotMod[cbNotMod.length - 1];
    assert.strictEqual(
      toastNotMod.text,
      '⚡ Trạng thái đã là mới nhất',
      'Toast must reassure user that state is latest'
    );

    console.log('  ✔ Suite 5 passed: "message is not modified" handled softly with reassuring toast.\n');

    // -------------------------------------------------------------------------
    // Suite 6: Screenshot Button (p:db:scr) & Uninterrupted Dashboard
    // -------------------------------------------------------------------------
    console.log('[Suite 6] Verifying [📸 Chụp màn hình] invokes screenManager without disrupting dashboard...');

    let screenSent = false;
    let screenChatId: any = null;
    const mockScreenManager = {
      send: async (botInstance: any, chatId: any) => {
        screenSent = true;
        screenChatId = chatId;
      }
    };

    const { bot: botScr, editedMessages: editsScr, answeredCallbacks: cbScr } = createMockBot();
    const planManagerScr = new TelegramPlanManager({
      workspaceRoots: [testTempDir],
      orchestrator: mockOrchestrator,
      screenManager: mockScreenManager,
      bot: botScr
    });
    planManagerScr.registerWithBot(botScr);

    planManagerScr.setActiveDashboardSession({
      chatId: 777,
      messageId: 200,
      planName: 'plans/telegram-ux',
      currentPhaseName: 'phase-03-picker.md',
      currentPhaseIndex: 3,
      completedPhases: 2,
      totalPhases: 5,
      state: 'running',
      bot: botScr
    });

    await (botScr as any).handleUpdate({
      update_id: 304,
      callback_query: {
        id: 'cb_scr_1',
        from: { id: 777, is_bot: false, first_name: 'Tester' },
        data: 'p:db:scr',
        message: {
          message_id: 200,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private' }
        }
      }
    });

    assert.ok(screenSent, 'screenManager.send must be invoked');
    assert.strictEqual(screenChatId, 777, 'screenManager must receive correct chatId');
    assert.ok(cbScr.length >= 1, 'Must answer callback query');
    assert.strictEqual(
      cbScr[cbScr.length - 1].text,
      '📸 Đang chụp màn hình desktop...',
      'Toast must confirm screenshot dispatch'
    );
    assert.strictEqual(
      editsScr.length,
      0,
      'Live control dashboard message must NOT be edited or overwritten by screenshot action'
    );

    console.log('  ✔ Suite 6 passed: Screenshot dispatched cleanly with dashboard intact.\n');

    // -------------------------------------------------------------------------
    // Suite 7: Orchestrator allComplete Event & 100% Completion Badge
    // -------------------------------------------------------------------------
    console.log('[Suite 7] Verifying allComplete Orchestrator event & 100% completion badge...');

    const orchEmitter: any = new EventEmitter();
    orchEmitter.isRunning = () => false;

    const { bot: botComplete, editedMessages: editsComplete } = createMockBot();
    const planManagerComplete = new TelegramPlanManager({
      workspaceRoots: [testTempDir],
      orchestrator: orchEmitter,
      bot: botComplete
    });
    planManagerComplete.registerWithBot(botComplete);

    planManagerComplete.setActiveDashboardSession({
      chatId: 777,
      messageId: 200,
      planName: 'plans/telegram-ux',
      currentPhaseName: 'phase-05-release.md',
      currentPhaseIndex: 5,
      completedPhases: 4,
      totalPhases: 5,
      state: 'running',
      bot: botComplete
    });

    // Bind event listeners
    planManagerComplete.bindOrchestratorEvents(orchEmitter);

    // Emit allComplete event
    orchEmitter.emit('allComplete', 5);

    // Wait microtask
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(editsComplete.length >= 1, 'Must edit message upon allComplete');
    const completeText = editsComplete[editsComplete.length - 1].text;
    assert.ok(
      completeText.includes('🎉 KẾ HOẠCH ĐÃ HOÀN THÀNH 100%! (5/5 phase)'),
      'Must display 100% complete badge in dashboard'
    );
    assert.ok(
      completeText.includes('▰▰▰▰▰▰▰▰ 100%'),
      'Progress bar must be completely filled at 100%'
    );

    const completeKb = editsComplete[editsComplete.length - 1].reply_markup.inline_keyboard;
    assert.strictEqual(completeKb[0][0].text, '[🚀 Chạy lại]', 'Must provide rerun button on completion');
    assert.strictEqual(completeKb[0][1].text, '[📂 Danh sách Plans]', 'Must provide nav button on completion');

    // Verify listeners were cleaned up
    assert.strictEqual(
      orchEmitter.listenerCount('allComplete'),
      0,
      'Listeners must be cleanly unbound upon completion to prevent leaks'
    );

    console.log('  ✔ Suite 7 passed: allComplete event rendered 100% badge and unbound listeners.\n');

    // -------------------------------------------------------------------------
    // Suite 8: Navigation to Plans List & Graceful Message Fallback
    // -------------------------------------------------------------------------
    console.log('[Suite 8] Verifying [📂 Danh sách Plans] (p:db:nav) and Graceful Send Fallback...');

    // Create a plan folder so nav finds something
    const folderDir = path.join(testTempDir, 'plans', 'plan-alpha');
    createDummyPhase(folderDir, '01-first.md', 'Pending');
    createDummyPhase(folderDir, '02-second.md', 'Pending');

    const { bot: botNav, editedMessages: editsNav } = createMockBot();
    const planManagerNav = new TelegramPlanManager({
      workspaceRoots: [testTempDir],
      bot: botNav
    });
    planManagerNav.registerWithBot(botNav);

    await (botNav as any).handleUpdate({
      update_id: 305,
      callback_query: {
        id: 'cb_nav_1',
        from: { id: 777, is_bot: false, first_name: 'Tester' },
        data: 'p:db:nav',
        message: {
          message_id: 200,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private' }
        }
      }
    });

    assert.ok(editsNav.length >= 1, 'Must edit message back to folder list');
    assert.ok(
      editsNav[editsNav.length - 1].text.includes('QUẢN LÝ KẾ HOẠCH'),
      'Must navigate back to /plans folder selector'
    );

    // Verify Graceful Fallback: when editMessageText fails because message was deleted
    const { bot: botFallback, sentMessages: fallbackSent } = createMockBot(undefined, {
      shouldFailEditWithMessageNotFound: true
    });
    const planManagerFallback = new TelegramPlanManager({
      workspaceRoots: [testTempDir],
      bot: botFallback
    });

    planManagerFallback.setActiveDashboardSession({
      chatId: 777,
      messageId: 999, // Non-existent message
      planName: 'plans/telegram-ux',
      currentPhaseName: 'phase-01-intro.md',
      currentPhaseIndex: 1,
      completedPhases: 1,
      totalPhases: 3,
      state: 'running',
      bot: botFallback
    });

    await planManagerFallback.renderAndUpdateDashboard(true);

    assert.ok(
      fallbackSent.length >= 1,
      'Must gracefully fallback to bot.api.sendMessage when editMessageText fails'
    );
    assert.ok(
      fallbackSent[0].text.includes('▶️ ĐANG THỰC THI KẾ HOẠCH'),
      'Fallback message must contain live control dashboard'
    );
    assert.strictEqual(
      planManagerFallback.getActiveDashboardSession()?.messageId,
      fallbackSent[0].message_id || 101,
      'Dashboard session must adopt new messageId to maintain single message discipline'
    );

    console.log('  ✔ Suite 8 passed: Navigation and graceful send fallback fully verified.\n');

    console.log('================================================================');
    console.log(' 🎉 ALL PHASE 04 TESTS PASSED SUCCESSFULLY! (100% Verified)     ');
    console.log('================================================================\n');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase04LiveControlDashboardTest().catch((err) => {
  console.error('\n❌ Phase 04 test failed with error:', err);
  process.exit(1);
});
