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
import { Bot } from 'grammy';
import {
  renderTextProgressBar,
  escapeTelegramMarkdown,
  formatSafePlanText
} from '../telegramUtils';
import {
  TelegramPlanManager,
  DiscoveredPlanFolder
} from '../telegramPlanManager';

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
      editedMessages.push({ method, payload: anyPayload });
      return {
        ok: true,
        result: {
          message_id: anyPayload.message_id || 999,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id || 777, type: 'private' },
          text: anyPayload.text
        }
      } as any;
    }
    if (method === 'editMessageReplyMarkup') {
      editedMessages.push({ method, payload: anyPayload });
      return {
        ok: true,
        result: true
      } as any;
    }
    if (method === 'answerCallbackQuery') {
      answeredCallbacks.push(anyPayload);
      return {
        ok: true,
        result: true
      } as any;
    }
    return { ok: true, result: {} } as any;
  });

  return { bot, sentMessages, editedMessages, answeredCallbacks };
}

async function runPhase01Tests() {
  console.log('================================================================');
  console.log(' Phase 01: Visual Progress Bar & Safe Vietnamese Localization');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // Suite 1: renderTextProgressBar Milestones, Edge Cases, Styles & Performance
  // ---------------------------------------------------------------------------
  console.log('[Suite 1] Verifying renderTextProgressBar milestones and edge cases...');
  {
    // 1.1 Milestones at default length (8 chars)
    const bar0 = renderTextProgressBar(0, 8);
    assert.strictEqual(bar0, '▱▱▱▱▱▱▱▱ 0%', '0% milestone should render 8 empty blocks with 0%');

    const bar25 = renderTextProgressBar(2, 8);
    assert.strictEqual(bar25, '▰▰▱▱▱▱▱▱ 25%', '25% milestone should render 2 filled blocks, 6 empty blocks');

    const bar50 = renderTextProgressBar(4, 8);
    assert.strictEqual(bar50, '▰▰▰▰▱▱▱▱ 50%', '50% milestone should render 4 filled blocks, 4 empty blocks');

    const bar75 = renderTextProgressBar(6, 8);
    assert.strictEqual(bar75, '▰▰▰▰▰▰▱▱ 75%', '75% milestone should render 6 filled blocks, 2 empty blocks');

    const bar100 = renderTextProgressBar(8, 8);
    assert.strictEqual(bar100, '▰▰▰▰▰▰▰▰ 100%', '100% milestone should render 8 filled blocks');

    // 1.2 Edge cases
    const barTotalZero = renderTextProgressBar(0, 0);
    assert.strictEqual(barTotalZero, '▱▱▱▱▱▱▱▱ 0%', 'total = 0 must clamp safely to 0% and never produce NaN%');

    const barNegativeTotal = renderTextProgressBar(5, -1);
    assert.strictEqual(barNegativeTotal, '▱▱▱▱▱▱▱▱ 0%', 'negative total must clamp safely to 0%');

    const barCompletedGreaterThanTotal = renderTextProgressBar(12, 8);
    assert.strictEqual(barCompletedGreaterThanTotal, '▰▰▰▰▰▰▰▰ 100%', 'completed > total must clamp to 100%');

    const barNegativeCompleted = renderTextProgressBar(-4, 8);
    assert.strictEqual(barNegativeCompleted, '▱▱▱▱▱▱▱▱ 0%', 'completed < 0 must clamp to 0%');

    // 1.3 Custom options: Length & Style & showPercent
    const barLen10 = renderTextProgressBar(5, 10, { length: 10 });
    assert.strictEqual(barLen10, '▰▰▰▰▰▱▱▱▱▱ 50%', 'length: 10 should render 10 characters total');

    const barAscii = renderTextProgressBar(2, 4, { style: 'ascii' });
    assert.strictEqual(barAscii, '####---- 50%', 'style: ascii should use # and -');

    const barNoPercent = renderTextProgressBar(2, 4, { showPercent: false });
    assert.strictEqual(barNoPercent, '▰▰▰▰▱▱▱▱', 'showPercent: false should omit percentage label');

    // 1.4 Non-functional: Execution Performance (< 0.05ms per call)
    const tStart = process.hrtime.bigint();
    for (let i = 0; i < 5000; i++) {
      renderTextProgressBar(i % 10, 10);
    }
    const tElapsedNs = Number(process.hrtime.bigint() - tStart);
    const avgMs = tElapsedNs / (5000 * 1_000_000);
    assert.ok(avgMs < 0.05, `renderTextProgressBar must run in < 0.05ms (actual: ${avgMs.toFixed(5)}ms)`);

    console.log('  ✔ All milestone renders, edge cases, styles, and execution speed verified.');
  }

  // ---------------------------------------------------------------------------
  // Suite 2: Telegram Markdown Escaping & Safe Text Formatting
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 2] Verifying escapeTelegramMarkdown & formatSafePlanText...');
  {
    // 2.1 escapeTelegramMarkdown
    const escapedName = escapeTelegramMarkdown('feature_auth_2026');
    assert.strictEqual(escapedName, 'feature\\_auth\\_2026', 'escapeTelegramMarkdown should escape underscore');

    const specialChars = escapeTelegramMarkdown('*bold* [link] `code` \\slash');
    assert.strictEqual(
      specialChars,
      '\\*bold\\* \\[link\\] \\`code\\` \\\\slash',
      'escapeTelegramMarkdown should escape all V1 special markers'
    );

    assert.strictEqual(escapeTelegramMarkdown(''), '', 'Empty string should return empty');
    assert.strictEqual((escapeTelegramMarkdown as any)(null), '', 'Null input should return empty');

    // 2.2 formatSafePlanText
    const planText = formatSafePlanText('Folder: feature_auth_2026 with 2 phases');
    assert.strictEqual(
      planText,
      'Folder: feature\\_auth\\_2026 with 2 phases',
      'formatSafePlanText should escape unescaped underscores outside code spans'
    );

    const withCodeSpan = formatSafePlanText('📁 Kế hoạch: `feature_auth_2026`');
    assert.strictEqual(
      withCodeSpan,
      '📁 Kế hoạch: `feature_auth_2026`',
      'formatSafePlanText must leave code spans untouched'
    );

    const mixedContent = formatSafePlanText(
      'Kế hoạch `plan_v1` có file phase_01_init.md và code:\n```ts\nconst my_var = 1;\n```'
    );
    assert.strictEqual(
      mixedContent,
      'Kế hoạch `plan_v1` có file phase\\_01\\_init.md và code:\n```ts\nconst my_var = 1;\n```',
      'formatSafePlanText must escape underscores outside fences and preserve code blocks'
    );

    console.log('  ✔ Telegram Markdown escaping and code-fence protection verified.');
  }

  // ---------------------------------------------------------------------------
  // Suite 3: TelegramPlanManager Localization & Backward Compatible Tokens
  // ---------------------------------------------------------------------------
  console.log('\n[Suite 3] Verifying TelegramPlanManager Vietnamese localization & bilingual tokens...');
  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan_phase01_test_'));

  try {
    // Scaffold test plan folders, including one with underscores in name
    const folder1 = path.join(testTempDir, 'plans', 'feature_auth_2026');
    const folder2 = path.join(testTempDir, 'plans', 'payment-system');
    fs.mkdirSync(folder1, { recursive: true });
    fs.mkdirSync(folder2, { recursive: true });

    // folder1: 2 completed, 2 pending (50% progress)
    fs.writeFileSync(path.join(folder1, 'phase-01-scaffold.md'), '# Phase 1\nStatus: ✅ Completed\n');
    fs.writeFileSync(path.join(folder1, 'phase-02-jwt.md'), '# Phase 2\nStatus: [x] Done\n');
    fs.writeFileSync(path.join(folder1, 'phase-03-refresh.md'), '# Phase 3\nStatus: ⬜ Pending\n');
    fs.writeFileSync(path.join(folder1, 'phase-04-oauth.md'), '# Phase 4\nStatus: ⬜ Pending\n');

    // folder2: 3 completed (100% progress)
    fs.writeFileSync(path.join(folder2, 'phase-01-stripe.md'), '# Phase 1\nStatus: Completed\n');
    fs.writeFileSync(path.join(folder2, 'phase-02-paypal.md'), '# Phase 2\nStatus: Completed\n');
    fs.writeFileSync(path.join(folder2, 'phase-03-webhook.md'), '# Phase 3\nStatus: Completed\n');

    const planManager = new TelegramPlanManager({
      workspaceRoots: [testTempDir]
    });

    const { bot, sentMessages, editedMessages } = createMockBot();
    planManager.registerWithBot(bot);

    // 3.1 Verify /plans command lists folders with bilingual header
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 777, type: 'private', first_name: 'Tester' },
        from: { id: 777, is_bot: false, first_name: 'Tester' },
        text: '/plans',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    });

    assert.strictEqual(sentMessages.length, 1, '/plans should trigger 1 response message');
    const plansReply = sentMessages[0];

    // Must satisfy Phase 01 Vietnamese localization requirement
    assert.ok(
      plansReply.text.includes('QUẢN LÝ KẾ HOẠCH'),
      'Title must include Vietnamese header "QUẢN LÝ KẾ HOẠCH"'
    );
    // Must satisfy existing test assertions
    assert.ok(
      plansReply.text.includes('Plan Folders'),
      'Title must retain bilingual token "Plan Folders"'
    );
    assert.ok(
      plansReply.text.includes('Available Plan Folders'),
      'Title must retain bilingual token "Available Plan Folders"'
    );

    // 3.2 Verify Active Editor Plan prompt localization and progress bar
    sentMessages.length = 0;
    mockActiveTextEditor = {
      document: {
        uri: {
          fsPath: path.join(folder1, 'phase-03-refresh.md')
        }
      }
    };

    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 11,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 777, type: 'private', first_name: 'Tester' },
        from: { id: 777, is_bot: false, first_name: 'Tester' },
        text: '/plans',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    });

    assert.strictEqual(sentMessages.length, 1, 'Active editor prompt should be sent');
    const activeReply = sentMessages[0];
    assert.ok(
      activeReply.text.includes('KẾ HOẠCH ĐANG MỞ'),
      'Active prompt must include Vietnamese "KẾ HOẠCH ĐANG MỞ"'
    );
    assert.ok(
      activeReply.text.includes('Active Plan Detected'),
      'Active prompt must retain bilingual token "Active Plan Detected"'
    );
    // Verify progress bar in active prompt
    assert.ok(
      activeReply.text.includes('▰▰▰▰▱▱▱▱ 50%'),
      'Active prompt must render 50% visual progress bar'
    );

    // Check active buttons
    const activeButtons = activeReply.reply_markup.inline_keyboard.flat();
    assert.ok(
      activeButtons.some((b: any) => b.text.includes('Run Active Plan')),
      'Active buttons must retain "Run Active Plan"'
    );
    assert.ok(
      activeButtons.some((b: any) => b.text.includes('Browse Other Plan Folders')),
      'Active buttons must retain "Browse Other Plan Folders"'
    );

    mockActiveTextEditor = undefined; // Reset active editor

    // 3.3 Verify Execution Mode selection menu layout and button labels
    const discovered = planManager.discoverPlanFolders();
    const targetFolder = discovered.find((f) => f.displayName.includes('feature_auth_2026'))!;
    assert.ok(targetFolder, 'Must discover feature_auth_2026 folder');

    const modeKb = planManager.buildExecutionModeKeyboard(targetFolder);
    const modeButtons = modeKb.inline_keyboard.flat();

    // Check Button 1: Run Only Pending / Chạy các Phase còn lại
    const btn1 = modeButtons[0];
    assert.ok(
      btn1.text.includes('Chạy các Phase còn lại') && btn1.text.includes('Run Only Pending'),
      'Button 1 must be bilingual [⚡ Chạy các Phase còn lại / Run Only Pending]'
    );
    assert.strictEqual((btn1 as any).callback_data, `mode:pending:${targetFolder.id}`);

    // Check Button 2: Run All Phases / Chạy lại toàn bộ từ đầu
    const btn2 = modeButtons[1];
    assert.ok(
      btn2.text.includes('Chạy lại toàn bộ từ đầu') && btn2.text.includes('Run All Phases'),
      'Button 2 must be bilingual [🚀 Chạy lại toàn bộ từ đầu / Run All Phases]'
    );
    assert.strictEqual((btn2 as any).callback_data, `mode:all:${targetFolder.id}`);

    // Check Button 3: Select Phases Manually / Tùy chọn từng Phase thủ công
    const btn3 = modeButtons[2];
    assert.ok(
      btn3.text.includes('Tùy chọn từng Phase thủ công') && btn3.text.includes('Select Phases Manually'),
      'Button 3 must be bilingual [📋 Tùy chọn từng Phase thủ công / Select Phases Manually]'
    );
    assert.strictEqual((btn3 as any).callback_data, `mode:manual:${targetFolder.id}`);

    // Check Button 4: Back to Folders / Quay lại danh sách
    const btn4 = modeButtons[3];
    assert.ok(
      btn4.text.includes('Quay lại danh sách') && btn4.text.includes('Back to Folders'),
      'Button 4 must be bilingual [🔙 Quay lại danh sách / Back to Folders]'
    );
    assert.strictEqual((btn4 as any).callback_data, 'nav:folders');

    // 3.4 Verify Interactive Folder Selection Callback
    editedMessages.length = 0;
    await bot.handleUpdate({
      update_id: 3,
      callback_query: {
        id: 'cb_query_folder',
        from: { id: 777, is_bot: false, first_name: 'Tester' },
        chat_instance: 'inst_1',
        data: `fld:${targetFolder.id}`,
        message: {
          message_id: 10,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private', first_name: 'Tester' },
          text: 'Plans List'
        }
      }
    });

    assert.strictEqual(editedMessages.length, 1, 'Folder callback must edit message to show execution mode');
    const modeEditMsg = editedMessages[0].payload;
    assert.ok(
      modeEditMsg.text.includes('Kế hoạch: `plans/feature_auth_2026`'),
      'Message should show safe plan name'
    );
    assert.ok(
      modeEditMsg.text.includes('Tiến độ: ▰▰▰▰▱▱▱▱ 50% (2/4 phase)'),
      'Message must render exact requirement progress bar format: ▰▰▰▰▱▱▱▱ 50% (2/4 phase)'
    );
    assert.ok(
      modeEditMsg.text.includes('Chọn chế độ thực thi (Choose execution mode):'),
      'Message must include bilingual prompt "Chọn chế độ thực thi (Choose execution mode):"'
    );

    // 3.5 Verify Empty States
    // Scenario A: All folders completed
    const emptyTestDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan_all_done_'));
    const allDoneFolder = path.join(emptyTestDir1, 'plans', 'all-done');
    fs.mkdirSync(allDoneFolder, { recursive: true });
    fs.writeFileSync(path.join(allDoneFolder, 'phase-01.md'), '# P1\nStatus: Completed\n');

    const mgrAllDone = new TelegramPlanManager({ workspaceRoots: [emptyTestDir1] });
    const { bot: botDone, sentMessages: msgsDone } = createMockBot();
    mgrAllDone.registerWithBot(botDone);

    await botDone.handleUpdate({
      update_id: 4,
      message: {
        message_id: 12,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 777, type: 'private', first_name: 'Tester' },
        from: { id: 777, is_bot: false, first_name: 'Tester' },
        text: '/plans',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    });

    assert.strictEqual(msgsDone.length, 1);
    assert.ok(
      msgsDone[0].text.includes('Tất cả kế hoạch trong workspace đã hoàn thành 100%! (0 pending phases)'),
      'All-completed state must match requirement string'
    );

    // Scenario B: No folders in workspace
    const emptyTestDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan_no_plans_'));
    const mgrNoPlans = new TelegramPlanManager({ workspaceRoots: [emptyTestDir2] });
    const { bot: botNone, sentMessages: msgsNone } = createMockBot();
    mgrNoPlans.registerWithBot(botNone);

    await botNone.handleUpdate({
      update_id: 5,
      message: {
        message_id: 13,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 777, type: 'private', first_name: 'Tester' },
        from: { id: 777, is_bot: false, first_name: 'Tester' },
        text: '/plans',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    });

    assert.strictEqual(msgsNone.length, 1);
    assert.ok(
      msgsNone[0].text.includes('Không tìm thấy thư mục kế hoạch nào trong workspace. (No plan folders found)'),
      'Empty workspace state must match requirement string'
    );

    // Clean up temporary folders
    fs.rmSync(emptyTestDir1, { recursive: true, force: true });
    fs.rmSync(emptyTestDir2, { recursive: true, force: true });

    console.log('  ✔ TelegramPlanManager Vietnamese localization and bilingual tokens fully verified.');
  } finally {
    fs.rmSync(testTempDir, { recursive: true, force: true });
  }

  console.log('\n================================================================');
  console.log(' 🎉 ALL PHASE 01 TESTS PASSED SUCCESSFULLY! (100% Verified)');
  console.log('================================================================');
}

runPhase01Tests().catch((err) => {
  console.error('\n❌ Phase 01 Test Failed:', err);
  process.exit(1);
});
