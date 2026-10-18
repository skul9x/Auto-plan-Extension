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
import { Bot, InlineKeyboard } from 'grammy';
import {
  TelegramPlanManager,
  DiscoveredPlanFolder,
  formatShortPlanName
} from '../telegramPlanManager';
import { renderTextProgressBar } from '../telegramUtils';

/**
 * Creates a mock GrammY bot capturing outgoing API requests without network calls.
 */
function createMockBot(token: string = '123456:TEST_TOKEN'): {
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
  mtimeMs?: number
): string {
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, fileName);
  const content = `# Phase File: ${fileName}\n\nStatus: ${status === 'Completed' ? '✅ Completed' : '⬜ Pending'}\n\n## Content\nSample phase test content.`;
  fs.writeFileSync(fullPath, content, 'utf8');
  if (mtimeMs) {
    const sec = mtimeMs / 1000;
    fs.utimesSync(fullPath, sec, sec);
  }
  return fullPath;
}

async function runPhase02QuickResumeAndFolderPickerTest(): Promise<void> {
  console.log('================================================================');
  console.log(' Phase 02: One-Click Quick Resume & Enhanced Folder Picker Test ');
  console.log('================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan_p2_test_'));
  mockWorkspaceFolders = [{ uri: { fsPath: testTempDir } }];

  try {
    // -------------------------------------------------------------------------
    // Suite 1: Smart Top Plan Resolution (Priority 1: Active Editor) & Quick Resume Button
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Verifying Top Plan Resolution for Active Editor & Quick Resume Button...');
    {
      const planADir = path.join(testTempDir, 'plans', '261011-security-fix');
      createDummyPhase(planADir, 'plan.md', 'Pending');
      createDummyPhase(planADir, 'phase-01-scaffold.md', 'Completed');
      createDummyPhase(planADir, 'phase-02-auth.md', 'Pending');

      const planManager = new TelegramPlanManager({ workspaceRoots: [testTempDir] });

      // 1.1 Test with active editor open on plan.md
      mockActiveTextEditor = {
        document: {
          uri: { fsPath: path.join(planADir, 'plan.md') }
        }
      };

      const t0 = Date.now();
      const topPlanFromPlanMd = planManager.resolveTopPlan();
      const resolutionTimeMs = Date.now() - t0;

      assert.ok(topPlanFromPlanMd, 'Top plan must be resolved when plan.md is open in editor');
      assert.strictEqual(
        topPlanFromPlanMd!.displayName,
        'plans/261011-security-fix',
        'Resolved plan must match active editor folder'
      );
      assert.strictEqual(topPlanFromPlanMd!.pendingPhases, 1, 'Plan A has 1 pending phase');
      assert.ok(resolutionTimeMs < 15, `Resolution time (${resolutionTimeMs}ms) must be < 15ms`);

      // 1.2 Test with active editor open on phase-02-auth.md
      mockActiveTextEditor = {
        document: {
          uri: { fsPath: path.join(planADir, 'phase-02-auth.md') }
        }
      };
      const topPlanFromPhaseMd = planManager.resolveTopPlan();
      assert.ok(topPlanFromPhaseMd, 'Top plan must be resolved when phase-02-auth.md is open');
      assert.strictEqual(
        topPlanFromPhaseMd!.displayName,
        'plans/261011-security-fix',
        'Resolved plan must match phase file parent folder'
      );

      // 1.3 Test Quick Resume button generation at row 0
      const folders = planManager.discoverPlanFolders({ pendingOnly: true });
      const kb = planManager.buildFolderPickerKeyboard(folders, { topPlan: topPlanFromPhaseMd });
      const firstRow = kb.inline_keyboard[0];
      assert.ok(firstRow && firstRow.length === 1, 'Row 0 must contain exactly 1 button for Quick Resume');
      const resumeBtn = firstRow[0];

      assert.ok(
        resumeBtn.text.startsWith('⚡ Tiếp tục:'),
        `Quick Resume button text "${resumeBtn.text}" must start with "⚡ Tiếp tục:"`
      );
      assert.strictEqual(
        (resumeBtn as any).callback_data,
        `p:res:${topPlanFromPhaseMd!.id}`,
        'Quick Resume button callback_data must follow compact prefix "p:res:<folderId>"'
      );

      // 1.4 Test smart name shortening (< 18 chars)
      const longName = 'very-long-feature-plan-module-2026';
      const shortened = formatShortPlanName(longName, 18);
      assert.ok(shortened.length <= 18, `Shortened name "${shortened}" must be <= 18 chars`);
      assert.ok(shortened.endsWith('..'), 'Truncated name must end with ".."');

      const regularName = 'short-fix';
      assert.strictEqual(formatShortPlanName(regularName, 18), 'short-fix', 'Short names should remain untouched');

      console.log('  ✔ Suite 1 passed: Editor plan detected and Quick Resume button placed at row 0.\n');
    }

    // -------------------------------------------------------------------------
    // Suite 2: Fallback to Most Recently Modified Pending Plan (Priority 2)
    // -------------------------------------------------------------------------
    console.log('[Suite 2] Verifying Fallback to Most Recently Modified Pending Plan...');
    {
      // No file open in editor
      mockActiveTextEditor = undefined;

      const planBDir = path.join(testTempDir, 'plans', 'old-feature');
      const planCDir = path.join(testTempDir, 'plans', 'recent-hotfix');

      const olderTime = Date.now() - 100000;
      const newerTime = Date.now() + 50000;

      createDummyPhase(planBDir, 'phase-01.md', 'Pending', olderTime);
      createDummyPhase(planCDir, 'phase-01.md', 'Pending', newerTime);

      const planManager = new TelegramPlanManager({ workspaceRoots: [testTempDir] });
      const topPlan = planManager.resolveTopPlan();

      assert.ok(topPlan, 'Top plan must be resolved via Priority 2 fallback');
      assert.strictEqual(
        topPlan!.displayName,
        'plans/recent-hotfix',
        'Top plan must be the most recently modified pending plan (Plan C)'
      );

      const kb = planManager.buildFolderPickerKeyboard(planManager.discoverPlanFolders({ pendingOnly: true }));
      const firstRow = kb.inline_keyboard[0];
      assert.ok(firstRow[0].text.includes('recent-hotfix'), 'Quick Resume must point to most recent Plan C');
      assert.strictEqual((firstRow[0] as any).callback_data, `p:res:${topPlan!.id}`);

      console.log('  ✔ Suite 2 passed: Fallback successfully picked the most recently modified pending plan.\n');
    }

    // -------------------------------------------------------------------------
    // Suite 3: Eligibility Guard (No Quick Resume when 100% Completed)
    // -------------------------------------------------------------------------
    console.log('[Suite 3] Verifying Eligibility Guard (No Quick Resume when Completed)...');
    {
      const completedDir = path.join(testTempDir, 'plans', 'all-done-feature');
      createDummyPhase(completedDir, 'phase-01.md', 'Completed');
      createDummyPhase(completedDir, 'phase-02.md', 'Completed');

      // 3.1 When open in active editor
      mockActiveTextEditor = {
        document: {
          uri: { fsPath: path.join(completedDir, 'phase-01.md') }
        }
      };

      const planManager = new TelegramPlanManager({ workspaceRoots: [testTempDir] });
      const completedTopPlan = planManager.resolveTopPlan();
      assert.ok(completedTopPlan, 'Editor plan discovered');
      assert.strictEqual(completedTopPlan!.pendingPhases, 0, 'Plan is 100% completed');

      // Keyboard with topPlan passed: Eligibility Guard must prevent Quick Resume button
      const kb = planManager.buildFolderPickerKeyboard([], { topPlan: completedTopPlan });
      const hasResumeButton = kb.inline_keyboard.some((row) =>
        row.some((b: any) => b.callback_data && b.callback_data.startsWith('p:res:'))
      );
      assert.strictEqual(
        hasResumeButton,
        false,
        'Eligibility Guard: Quick Resume button must NOT be present when plan is 100% completed'
      );

      // 3.2 Active file prompt keyboard also applies Eligibility Guard
      const activeKb = planManager.buildActiveFilePromptKeyboard(completedTopPlan!, 'phase-01.md');
      const activeHasResume = activeKb.inline_keyboard.some((row) =>
        row.some((b: any) => b.callback_data && b.callback_data.startsWith('p:res:'))
      );
      assert.strictEqual(
        activeHasResume,
        false,
        'Active Prompt Keyboard: Must NOT render Quick Resume when completed'
      );

      console.log('  ✔ Suite 3 passed: Eligibility Guard accurately blocks Quick Resume for completed plans.\n');
    }

    // -------------------------------------------------------------------------
    // Suite 4: Concurrency Guard (Prevent Duplicate Runs)
    // -------------------------------------------------------------------------
    console.log('[Suite 4] Verifying Concurrency Guard...');
    {
      mockActiveTextEditor = undefined;
      const { bot, sentMessages, editedMessages, answeredCallbacks } = createMockBot();

      let isRunningState = true;
      let executedPhasesList: any[] = [];

      const mockOrchestrator = {
        isRunning: () => isRunningState,
        getState: () => 'executing_phase',
        getCurrentPhase: () => ({ fileName: 'phase-02-auth.md' }),
        getProgress: () => ({ completedPhases: 1, totalPhases: 3 }),
        startCustomExecution: async (phases: any[]) => {
          executedPhasesList = phases;
          return true;
        }
      };

      const planManager = new TelegramPlanManager({
        workspaceRoots: [testTempDir],
        orchestrator: mockOrchestrator
      });
      planManager.registerWithBot(bot);

      const targetFolder = planManager.discoverPlanFolders({ pendingOnly: true })[0];
      assert.ok(targetFolder, 'Must have target folder with pending phases');

      // 4.1 Trigger Quick Resume callback while orchestrator is running
      await (bot as any).handleUpdate({
        update_id: 101,
        callback_query: {
          id: 'cb_query_1',
          from: { id: 777, is_bot: false, first_name: 'Tester' },
          data: `p:res:${targetFolder.id}`,
          message: {
            message_id: 50,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private' }
          }
        }
      });

      // Assert popup alert warning
      assert.strictEqual(answeredCallbacks.length, 1, 'Must answer callback query');
      assert.strictEqual(
        answeredCallbacks[0].text,
        '⚠️ Đang có kế hoạch khác đang chạy!',
        'Alert text must match Concurrency Guard requirement'
      );
      assert.strictEqual(answeredCallbacks[0].show_alert, true, 'show_alert must be true');

      // Assert Live Dashboard message is edited/displayed
      assert.ok(editedMessages.length >= 1, 'Must update message with Live Dashboard');
      const liveDashboardText = editedMessages[editedMessages.length - 1].text;
      assert.ok(
        liveDashboardText.includes('LIVE DASHBOARD'),
        'Must display Live Dashboard when execution is blocked'
      );
      assert.ok(
        liveDashboardText.includes('phase-02-auth.md'),
        'Live Dashboard must display currently running phase'
      );
      assert.strictEqual(executedPhasesList.length, 0, 'No execution must be dispatched');

      // 4.2 When orchestrator is idle, Quick Resume dispatches successfully
      isRunningState = false;
      await (bot as any).handleUpdate({
        update_id: 102,
        callback_query: {
          id: 'cb_query_2',
          from: { id: 777, is_bot: false, first_name: 'Tester' },
          data: `p:res:${targetFolder.id}`,
          message: {
            message_id: 50,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private' }
          }
        }
      });

      assert.ok(executedPhasesList.length > 0, 'Phases must be dispatched when orchestrator is idle');
      console.log('  ✔ Suite 4 passed: Concurrency Guard popup alert and Live Dashboard verified.\n');
    }

    // -------------------------------------------------------------------------
    // Suite 5: Mobile Pagination (5 items/page), Mini Progress Bars & Filter Toggle
    // -------------------------------------------------------------------------
    console.log('[Suite 5] Verifying 5 items/page Pagination, Mini Progress Bars, and Filter Toggle...');
    {
      const dummyFolders: DiscoveredPlanFolder[] = Array.from({ length: 12 }, (_, i) => ({
        id: `f_p2_${i}`,
        folderPath: `/dummy/folder_${i}`,
        nativePath: `/dummy/folder_${i}`,
        relativePath: `plans/module-${String(i).padStart(2, '0')}`,
        displayName: `module-${String(i).padStart(2, '0')}`,
        totalPhases: 4,
        completedPhases: i % 4,
        pendingPhases: 4 - (i % 4),
        hasPendingPhases: (4 - (i % 4)) > 0,
        phases: []
      }));

      const planManager = new TelegramPlanManager({ workspaceRoots: [testTempDir] });

      // 5.1 Page 0 verification (Default 5 items/page)
      const page0Kb = planManager.buildFolderPickerKeyboard(dummyFolders, { page: 0, pageSize: 5, pendingOnly: true, topPlan: null });
      const page0Buttons = page0Kb.inline_keyboard;

      // 5 folder buttons + 1 nav row + 1 filter row = 7 rows
      const folderRows = page0Buttons.slice(0, 5);
      assert.strictEqual(folderRows.length, 5, 'Page 0 must have exactly 5 folder item rows');

      // Check first folder button mini progress bar & number emoji
      const firstBtn = folderRows[0][0];
      assert.ok(firstBtn.text.startsWith('1️⃣ module-00'), 'Folder 1 must start with 1️⃣');
      assert.ok(firstBtn.text.includes('▱'), 'Folder button must render mini progress bar');
      assert.strictEqual((firstBtn as any).callback_data, 'p:fld:f_p2_0');

      // Pagination navigation row: [Trang 1/3] [Sau ▶️]
      const navRow0 = page0Buttons[5];
      assert.strictEqual(navRow0.length, 2, 'Nav row on page 0 must have 2 buttons (Indicator and Next)');
      assert.strictEqual(navRow0[0].text, 'Trang 1/3');
      assert.strictEqual(navRow0[1].text, 'Sau ▶️');
      assert.strictEqual((navRow0[1] as any).callback_data, 'p:pg:1');

      // Filter & Refresh row: [📑 Xem tất cả] [🔄 Quét lại]
      const actionRow0 = page0Buttons[6];
      assert.strictEqual(actionRow0[0].text, '📑 Xem tất cả');
      assert.strictEqual((actionRow0[0] as any).callback_data, 'p:flt:all');
      assert.strictEqual(actionRow0[1].text, '🔄 Quét lại');
      assert.strictEqual((actionRow0[1] as any).callback_data, 'p:ref');

      // 5.2 Page 1 verification
      const page1Kb = planManager.buildFolderPickerKeyboard(dummyFolders, { page: 1, pageSize: 5, pendingOnly: true, topPlan: null });
      const navRow1 = page1Kb.inline_keyboard[5];
      assert.strictEqual(navRow1.length, 3, 'Nav row on page 1 must have 3 buttons (Prev, Indicator, Next)');
      assert.strictEqual(navRow1[0].text, '◀️ Trước');
      assert.strictEqual((navRow1[0] as any).callback_data, 'p:pg:0');
      assert.strictEqual(navRow1[1].text, 'Trang 2/3');
      assert.strictEqual(navRow1[2].text, 'Sau ▶️');
      assert.strictEqual((navRow1[2] as any).callback_data, 'p:pg:2');

      // 5.3 Page 2 (last page, 2 items)
      const page2Kb = planManager.buildFolderPickerKeyboard(dummyFolders, { page: 2, pageSize: 5, pendingOnly: true, topPlan: null });
      assert.strictEqual(page2Kb.inline_keyboard.slice(0, 2).length, 2, 'Page 2 must have remaining 2 items');
      const navRow2 = page2Kb.inline_keyboard[2];
      assert.strictEqual(navRow2.length, 2, 'Nav row on page 2 must have Prev and Indicator');
      assert.strictEqual(navRow2[0].text, '◀️ Trước');
      assert.strictEqual(navRow2[1].text, 'Trang 3/3');

      // 5.4 Filter mode toggle label
      const allModeKb = planManager.buildFolderPickerKeyboard(dummyFolders, { page: 0, pageSize: 5, pendingOnly: false, topPlan: null });
      const allFilterBtn = allModeKb.inline_keyboard[6][0];
      assert.strictEqual(allFilterBtn.text, '⚡ Chỉ chưa xong', 'When viewing all, button must offer "⚡ Chỉ chưa xong"');
      assert.strictEqual((allFilterBtn as any).callback_data, 'p:flt:pnd');

      console.log('  ✔ Suite 5 passed: 5 items/page mobile pagination, mini bars, and filter toggles verified.\n');
    }

    // -------------------------------------------------------------------------
    // Suite 6: Session & Cache TTL Pruning (Anti Memory Leak)
    // -------------------------------------------------------------------------
    console.log('[Suite 6] Verifying Session & Cache TTL and Capacity Pruning...');
    {
      const planManager = new TelegramPlanManager({ workspaceRoots: [testTempDir] });

      // Add 110 sessions, some fresh and some expired (> 2 hours old)
      const now = Date.now();
      const expiredTime = now - 3 * 3600 * 1000; // 3 hours ago

      for (let i = 0; i < 110; i++) {
        const dummyFolder: DiscoveredPlanFolder = {
          id: `f_cache_${i}`,
          folderPath: `/dummy/${i}`,
          nativePath: `/dummy/${i}`,
          relativePath: `dummy/${i}`,
          displayName: `dummy/${i}`,
          totalPhases: 1,
          completedPhases: 0,
          pendingPhases: 1,
          hasPendingPhases: true,
          phases: []
        };
        const s = planManager.initSession(`user_${i}`, dummyFolder);
        if (i < 20) {
          s.lastUpdated = expiredTime;
        }
      }

      assert.strictEqual(planManager.getSessionCount(), 110, 'Initial sessions count must be 110');

      // Run pruning
      const pruneResult = planManager.pruneStaleSessions(2 * 3600 * 1000, 100);
      assert.ok(pruneResult.prunedSessions >= 20, 'At least 20 expired sessions must be pruned');
      assert.ok(
        planManager.getSessionCount() <= 100,
        `Session count after pruning (${planManager.getSessionCount()}) must be <= 100`
      );

      // Verify clearFolderCache resets cache
      planManager.clearFolderCache();
      assert.strictEqual(planManager.getCachedFolderCount(), 0, 'clearFolderCache must empty folder cache');

      console.log('  ✔ Suite 6 passed: Memory leak pruning cleans up stale entries and caps capacity.\n');
    }

    // -------------------------------------------------------------------------
    // Suite 7: Telegram Payload Constraint (100% callback_data <= 64 bytes)
    // -------------------------------------------------------------------------
    console.log('[Suite 7] Verifying 100% callback_data <= 64 Bytes Constraint...');
    {
      const planManager = new TelegramPlanManager({ workspaceRoots: [testTempDir] });
      const folders = planManager.discoverPlanFolders({ pendingOnly: false });

      const keyboardsToTest: InlineKeyboard[] = [];

      // Add folder picker keyboards across pages
      for (let p = 0; p < 3; p++) {
        keyboardsToTest.push(planManager.buildFolderPickerKeyboard(folders, { page: p, pageSize: 5, pendingOnly: true }));
        keyboardsToTest.push(planManager.buildFolderPickerKeyboard(folders, { page: p, pageSize: 5, pendingOnly: false }));
      }

      // Add active prompt keyboards
      for (const f of folders) {
        keyboardsToTest.push(planManager.buildActiveFilePromptKeyboard(f, 'phase-01.md'));
        keyboardsToTest.push(planManager.buildExecutionModeKeyboard(f));
        keyboardsToTest.push(planManager.buildManualPhaseSelectionKeyboard(f, new Set([0, 1])));
      }

      let totalButtonsChecked = 0;

      for (const kb of keyboardsToTest) {
        for (const row of kb.inline_keyboard) {
          for (const btn of row) {
            const data = (btn as any).callback_data;
            if (data) {
              totalButtonsChecked++;
              const byteLength = Buffer.byteLength(data, 'utf8');
              assert.ok(
                byteLength <= 64,
                `Callback data "${data}" exceeds 64 bytes (actual: ${byteLength} bytes)`
              );
            }
          }
        }
      }

      assert.ok(totalButtonsChecked > 30, `Must verify a substantial button set (checked: ${totalButtonsChecked})`);
      console.log(`  ✔ Suite 7 passed: Verified ${totalButtonsChecked} buttons, all <= 64 bytes.\n`);
    }

    console.log('================================================================');
    console.log(' 🎉 ALL PHASE 02 TESTS PASSED SUCCESSFULLY! (100% Verified)     ');
    console.log('================================================================');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase02QuickResumeAndFolderPickerTest().catch((err) => {
  console.error('\n❌ Phase 02 Test Suite failed with error:', err);
  process.exit(1);
});
