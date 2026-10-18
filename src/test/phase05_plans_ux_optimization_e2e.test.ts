// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockActiveTextEditor: any = undefined;
let mockWorkspaceFolders: any[] = [];
const mockConfigStore: Record<string, any> = {};
const executedCommands: string[] = [];

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
import { Bot, Context, InlineKeyboard } from 'grammy';
import {
  TelegramPlanManager,
  DiscoveredPlanFolder,
  buildExecutionDashboard,
  DashboardThrottler,
  isMessageNotModifiedError,
  formatCompactPhaseButtonLabel,
  formatManualSelectionMessage,
  formatShortPlanName,
  extractPhaseSlug
} from '../telegramPlanManager';
import { PhaseFile } from '../planScanner';
import {
  renderTextProgressBar,
  formatSafePlanText,
  escapeTelegramMarkdown
} from '../telegramUtils';

/**
 * Creates a mock GrammY bot capturing outgoing API calls without real network requests.
 */
function createMockBot(
  token: string = '123456:TEST_TOKEN',
  options?: { shouldFailEditWithNotModified?: boolean; shouldFailEditWithMessageNotFound?: boolean }
): {
  bot: Bot;
  sentMessages: any[];
  editedMessages: any[];
  editedMarkups: any[];
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
  const editedMarkups: any[] = [];
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
          chat: { id: anyPayload.chat_id, type: 'private', first_name: 'Skul9x' },
          text: anyPayload.text,
          reply_markup: anyPayload.reply_markup
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
          chat: { id: anyPayload.chat_id || 777, type: 'private', first_name: 'Skul9x' },
          text: anyPayload.text,
          reply_markup: anyPayload.reply_markup
        }
      } as any;
    }
    if (method === 'editMessageReplyMarkup') {
      editedMarkups.push(anyPayload);
      return {
        ok: true,
        result: {
          message_id: anyPayload.message_id || 101,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id || 777, type: 'private', first_name: 'Skul9x' },
          reply_markup: anyPayload.reply_markup
        }
      } as any;
    }
    if (method === 'answerCallbackQuery') {
      answeredCallbacks.push(anyPayload);
      return { ok: true, result: true } as any;
    }
    return { ok: true, result: true } as any;
  });

  return { bot, sentMessages, editedMessages, editedMarkups, answeredCallbacks };
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

/**
 * Mock Orchestrator with EventEmitter support for Live Dashboard event-driven testing.
 */
class MockOrchestrator extends EventEmitter {
  public running: boolean = false;
  public currentPhase: any = null;
  public progress: any = { completedPhases: 0, totalPhases: 5 };
  public customExecutionCallCount: number = 0;
  public executedPhasesList: PhaseFile[][] = [];
  public skipCount: number = 0;
  public stopCount: number = 0;

  public isRunning(): boolean {
    return this.running;
  }

  public getCurrentPhase(): any {
    return this.currentPhase;
  }

  public getProgress(): any {
    return this.progress;
  }

  public async startCustomExecution(phases: PhaseFile[]): Promise<boolean> {
    this.customExecutionCallCount++;
    this.executedPhasesList.push([...phases]);
    this.running = true;
    this.progress = { completedPhases: 0, totalPhases: phases.length };
    this.currentPhase = phases[0] || null;
    return true;
  }

  public skipCurrentPhase(): boolean {
    this.skipCount++;
    this.emit('skipped');
    return true;
  }

  public stop(): void {
    this.stopCount++;
    this.running = false;
    this.emit('stopped');
  }
}

/**
 * Mock ScreenManager to test desktop screenshot capture integration.
 */
class MockScreenManager {
  public captureCount: number = 0;
  public lastChatId: any = null;

  public async send(bot: any, chatId: any): Promise<boolean> {
    this.captureCount++;
    this.lastChatId = chatId;
    return true;
  }
}

async function runPhase05E2EIntegrationAndReleaseTest(): Promise<void> {
  console.log('================================================================');
  console.log(' Phase 05: E2E Integration, Safety Audit & Release Verification ');
  console.log('================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan_p5_e2e_'));
  mockWorkspaceFolders = [{ uri: { fsPath: testTempDir } }];

  try {
    // -------------------------------------------------------------------------
    // Setup Test Plan Directory Structures
    // -------------------------------------------------------------------------
    const authDir = path.join(testTempDir, 'plans', 'feature-auth');
    createDummyPhase(authDir, 'phase-01-scaffold.md', 'Completed', 'Scaffold Project');
    createDummyPhase(authDir, 'phase-02-database.md', 'Completed', 'Database Schema');
    createDummyPhase(authDir, 'phase-03-jwt.md', 'Completed', 'JWT Authentication');
    createDummyPhase(authDir, 'phase-04-oauth.md', 'Pending', 'OAuth Integration');
    createDummyPhase(authDir, 'phase-05-audit.md', 'Pending', 'Security Audit');

    // Folder with underscores to test parse mode safety
    const underscoreDir = path.join(testTempDir, 'plans', 'feature_test_user_flow_v2');
    createDummyPhase(underscoreDir, 'phase-01-init_setup.md', 'Completed', 'Init Setup');
    createDummyPhase(underscoreDir, 'phase-02-run_core_engine.md', 'Pending', 'Core Engine');

    // -------------------------------------------------------------------------
    // Suite 1: Full 4-Screen E2E User Journey
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Verifying 4-Screen E2E User Journey (/plans -> Modes -> Picker -> Dashboard)...');
    {
      const { bot, sentMessages, editedMessages, editedMarkups, answeredCallbacks } = createMockBot();
      const mockOrch = new MockOrchestrator();
      const mockScreen = new MockScreenManager();
      const planManager = new TelegramPlanManager({
        workspaceRoots: [testTempDir],
        defaultPlanFolder: 'plans',
        orchestrator: mockOrch,
        screenManager: mockScreen
      });
      planManager.registerWithBot(bot);

      // --- Screen 1: Main Screen (Scenario A: Active Editor Open) ---
      mockActiveTextEditor = {
        document: {
          uri: { fsPath: path.join(authDir, 'phase-04-oauth.md') }
        }
      };

      await bot.handleUpdate({
        update_id: 201,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private', first_name: 'Skul9x' },
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          text: '/plans',
          entities: [{ type: 'bot_command', offset: 0, length: 6 }]
        }
      } as any);

      assert.strictEqual(sentMessages.length, 1, 'Screen 1: /plans should respond with active plan prompt');
      const activePromptMsg = sentMessages[0];
      assert.ok(
        activePromptMsg.text.includes('KẾ HOẠCH ĐANG MỞ') || activePromptMsg.text.includes('Active Plan Detected'),
        'Screen 1: Must detect active plan in editor'
      );
      assert.ok(
        activePromptMsg.text.includes('phase-04-oauth.md'),
        'Screen 1: Must show active file name'
      );
      const activePromptBtns = activePromptMsg.reply_markup.inline_keyboard.flat();
      assert.ok(
        activePromptBtns.some((b: any) => b.text.includes('Tiếp tục') || b.text.includes('Chạy')),
        'Screen 1: First button must offer Quick Resume/Run'
      );

      // --- Screen 1: Main Screen (Scenario B: No Active Editor -> Pending Folders List with Quick Resume) ---
      mockActiveTextEditor = undefined;
      sentMessages.length = 0;

      await bot.handleUpdate({
        update_id: 202,
        message: {
          message_id: 2,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private', first_name: 'Skul9x' },
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          text: '/plans',
          entities: [{ type: 'bot_command', offset: 0, length: 6 }]
        }
      } as any);

      assert.strictEqual(sentMessages.length, 1, 'Screen 1: Should respond with available plan folders list');
      const mainFolderMsg = sentMessages[0];
      assert.ok(
        mainFolderMsg.text.includes('QUẢN LÝ KẾ HOẠCH') || mainFolderMsg.text.includes('Plan Folders'),
        'Screen 1: Must show plan manager header'
      );
      const folderListRows = mainFolderMsg.reply_markup.inline_keyboard;
      // First button in folder list when topPlan exists is the Quick Resume button: [⚡ Tiếp tục: <Tên>]
      const topQuickResumeBtn = folderListRows[0][0];
      assert.ok(
        topQuickResumeBtn.text.startsWith('⚡ Tiếp tục:') || topQuickResumeBtn.text.includes('Tiếp tục:'),
        `Screen 1: Quick Resume button must appear first, found "${topQuickResumeBtn.text}"`
      );
      assert.ok(
        (topQuickResumeBtn as any).callback_data.startsWith('p:res:'),
        'Screen 1: Quick Resume button must use p:res:<id> callback'
      );

      // Verify folder button contains visual progress indicators
      const allDiscovered = planManager.discoverPlanFolders({ pendingOnly: false });
      const authFolder = allDiscovered.find((f) => f.displayName.includes('feature-auth'))!;
      assert.ok(authFolder, 'Must find feature-auth folder');
      const folderBtn = folderListRows.flat().find((b: any) => (b.callback_data === `p:fld:${authFolder.id}` || b.callback_data === `fld:${authFolder.id}`));
      assert.ok(folderBtn, 'Screen 1: Must render folder select button');
      assert.ok(
        folderBtn.text.includes('(3/5 phase)') || folderBtn.text.includes('(3/5 done)'),
        `Screen 1: Must show folder completion progress, got "${folderBtn.text}"`
      );

      // --- Screen 2: Mode Selector ---
      editedMessages.length = 0;
      answeredCallbacks.length = 0;

      await bot.handleUpdate({
        update_id: 203,
        callback_query: {
          id: 'cb_select_folder',
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          chat_instance: 'inst_1',
          data: `p:fld:${authFolder.id}`,
          message: {
            message_id: 2,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Skul9x' },
            text: mainFolderMsg.text
          }
        }
      } as any);

      assert.strictEqual(answeredCallbacks.length, 1, 'Screen 2: Callback must be answered');
      assert.strictEqual(editedMessages.length, 1, 'Screen 2: Message must be edited in-place');
      const modeMsg = editedMessages[0];
      assert.ok(modeMsg.text.includes('Tiến độ:') || modeMsg.text.includes('Progress:'), 'Screen 2: Must display overall progress');
      const modeBtns = modeMsg.reply_markup.inline_keyboard.flat();
      const modePending = modeBtns.find((b: any) => b.callback_data === `mode:pending:${authFolder.id}`);
      const modeAll = modeBtns.find((b: any) => b.callback_data === `mode:all:${authFolder.id}`);
      const modeManual = modeBtns.find((b: any) => b.callback_data === `p:mod:man:${authFolder.id}` || b.callback_data === `mode:manual:${authFolder.id}`);
      assert.ok(modePending, 'Screen 2: Must provide "Run Only Pending" mode button');
      assert.ok(modeAll, 'Screen 2: Must provide "Run All Phases" mode button');
      assert.ok(modeManual, 'Screen 2: Must provide "Manual Selection" mode button');

      // --- Screen 3: Smart Phase Picker with Batch Selection & 2-Column Grid ---
      editedMessages.length = 0;
      answeredCallbacks.length = 0;

      await bot.handleUpdate({
        update_id: 204,
        callback_query: {
          id: 'cb_select_manual_mode',
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          chat_instance: 'inst_1',
          data: `p:mod:man:${authFolder.id}`,
          message: {
            message_id: 2,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Skul9x' },
            text: modeMsg.text
          }
        }
      } as any);

      assert.strictEqual(editedMessages.length, 1, 'Screen 3: Message must be edited to phase picker');
      const pickerMsg = editedMessages[0];
      const pickerRows = pickerMsg.reply_markup.inline_keyboard;
      // Row 0: Batch buttons [✅ Tất cả], [⚡ Chưa chạy], [⬜ Bỏ chọn]
      assert.strictEqual(pickerRows[0].length, 3, 'Screen 3: Row 0 must have exactly 3 batch buttons');
      assert.strictEqual(pickerRows[0][0].text, '[✅ Tất cả]');
      assert.strictEqual(pickerRows[0][1].text, '[⚡ Chưa chạy]');
      assert.strictEqual(pickerRows[0][2].text, '[⬜ Bỏ chọn]');

      // Test batch select pending button: p:bt:pnd:<folderId>
      editedMarkups.length = 0;
      answeredCallbacks.length = 0;
      await bot.handleUpdate({
        update_id: 205,
        callback_query: {
          id: 'cb_batch_pending',
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          chat_instance: 'inst_1',
          data: `p:bt:pnd:${authFolder.id}`,
          message: {
            message_id: 2,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Skul9x' }
          }
        }
      } as any);

      assert.strictEqual(answeredCallbacks.length, 1, 'Screen 3: Batch click must be answered');
      assert.ok(
        answeredCallbacks[0].text.includes('Đã chọn 2 phase'),
        `Screen 3: Must return toast indicating 2 pending phases selected, got "${answeredCallbacks[0].text}"`
      );
      assert.strictEqual(editedMarkups.length, 1, 'Screen 3: Markup must be updated for batch selection');

      // Test toggle individual phase: toggle Phase 1 (index 1)
      answeredCallbacks.length = 0;
      editedMarkups.length = 0;
      await bot.handleUpdate({
        update_id: 206,
        callback_query: {
          id: 'cb_toggle_phase_1',
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          chat_instance: 'inst_1',
          data: `p:tog:${authFolder.id}:1`,
          message: {
            message_id: 2,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Skul9x' }
          }
        }
      } as any);

      assert.strictEqual(answeredCallbacks.length, 1, 'Screen 3: Toggle must be answered silently');
      assert.strictEqual(answeredCallbacks[0].text, undefined, 'Screen 3: Toggle must be silent without vibration');
      const sessionAfterToggle = planManager.getSession(777, authFolder.id);
      assert.ok(sessionAfterToggle.selectedIndices.has(1), 'Screen 3: Phase 1 must now be selected');
      assert.strictEqual(sessionAfterToggle.selectedIndices.size, 3, 'Screen 3: 3 phases selected in total');

      // Verify dynamic count button text
      const latestMarkupRows = editedMarkups[0].reply_markup.inline_keyboard;
      const dynamicRunBtn = latestMarkupRows.flat().find((b: any) => b.callback_data === `p:run:man:${authFolder.id}`);
      assert.ok(dynamicRunBtn, 'Screen 3: Dynamic run button must exist');
      assert.strictEqual(dynamicRunBtn.text, '[▶️ Bắt đầu (3/5 phase)]', 'Screen 3: Dynamic button must show (3/5 phase)');

      // Test Zero Selection Guard: clear all phases, then click Start
      await bot.handleUpdate({
        update_id: 207,
        callback_query: {
          id: 'cb_batch_clear',
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          chat_instance: 'inst_1',
          data: `p:bt:clr:${authFolder.id}`,
          message: {
            message_id: 2,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Skul9x' }
          }
        }
      } as any);
      answeredCallbacks.length = 0;

      await bot.handleUpdate({
        update_id: 208,
        callback_query: {
          id: 'cb_start_empty_guard',
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          chat_instance: 'inst_1',
          data: `p:run:man:${authFolder.id}`,
          message: {
            message_id: 2,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Skul9x' }
          }
        }
      } as any);

      assert.strictEqual(answeredCallbacks.length, 1, 'Screen 3: Zero selection guard must trigger alert callback');
      assert.strictEqual(answeredCallbacks[0].show_alert, true, 'Screen 3: Zero selection guard must show alert modal');
      assert.ok(answeredCallbacks[0].text.includes('ít nhất 1 phase'), 'Screen 3: Alert message must warn to select >= 1 phase');

      // Re-select pending phases before starting Screen 4
      await bot.handleUpdate({
        update_id: 209,
        callback_query: {
          id: 'cb_batch_reselect_pending',
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          chat_instance: 'inst_1',
          data: `p:bt:pnd:${authFolder.id}`,
          message: {
            message_id: 2,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Skul9x' }
          }
        }
      } as any);

      // --- Screen 4: Live Control Dashboard Execution ---
      editedMessages.length = 0;
      answeredCallbacks.length = 0;

      await bot.handleUpdate({
        update_id: 210,
        callback_query: {
          id: 'cb_start_manual_run',
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          chat_instance: 'inst_1',
          data: `p:run:man:${authFolder.id}`,
          message: {
            message_id: 2,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Skul9x' }
          }
        }
      } as any);

      assert.strictEqual(mockOrch.customExecutionCallCount, 1, 'Screen 4: Orchestrator must be started');
      assert.strictEqual(editedMessages.length, 1, 'Screen 4: Message must be edited in-place to Live Dashboard');
      const dashboardMsg = editedMessages[0];
      assert.ok(
        dashboardMsg.text.includes('ĐANG THỰC THI KẾ HOẠCH'),
        'Screen 4: Dashboard must contain running header'
      );
      assert.ok(
        dashboardMsg.text.includes('📁 Kế hoạch: feature-auth') || dashboardMsg.text.includes('plans/feature-auth'),
        'Screen 4: Dashboard must contain plan name'
      );
      assert.ok(
        dashboardMsg.text.includes('📊 Tiến độ:'),
        'Screen 4: Dashboard must contain visual progress bar'
      );
      assert.ok(
        dashboardMsg.text.includes('▱') || dashboardMsg.text.includes('▰'),
        'Screen 4: Dashboard must contain Unicode progress blocks'
      );

      // Verify Dashboard Control Keyboard Rows:
      // Row 1: [⏭️ Bỏ qua Phase], [🛑 Dừng lại]
      // Row 2: [📸 Chụp màn hình], [🔄 Cập nhật]
      // Row 3: [📂 Danh sách Plans]
      const dbRows = dashboardMsg.reply_markup.inline_keyboard;
      assert.strictEqual(dbRows.length, 3, 'Screen 4: Dashboard keyboard must have 3 rows');
      assert.strictEqual(dbRows[0][0].text, '[⏭️ Bỏ qua Phase]');
      assert.strictEqual(dbRows[0][0].callback_data, 'p:db:skip');
      assert.strictEqual(dbRows[0][1].text, '[🛑 Dừng lại]');
      assert.strictEqual(dbRows[0][1].callback_data, 'p:db:stop');
      assert.strictEqual(dbRows[1][0].text, '[📸 Chụp màn hình]');
      assert.strictEqual(dbRows[1][0].callback_data, 'p:db:scr');
      assert.strictEqual(dbRows[1][1].text, '[🔄 Cập nhật]');
      assert.strictEqual(dbRows[1][1].callback_data, 'p:db:ref');
      assert.strictEqual(dbRows[2][0].text, '[📂 Danh sách Plans]');
      assert.strictEqual(dbRows[2][0].callback_data, 'p:db:nav');

      // --- Interactive Live Control Dashboard Actions ---
      // 1. Skip Phase Action (p:db:skip)
      answeredCallbacks.length = 0;
      await bot.handleUpdate({
        update_id: 211,
        callback_query: {
          id: 'cb_db_skip',
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          chat_instance: 'inst_1',
          data: 'p:db:skip',
          message: { message_id: 2, chat: { id: 777, type: 'private', first_name: 'Skul9x' } }
        }
      } as any);
      assert.strictEqual(mockOrch.skipCount, 1, 'Dashboard: Skip button must trigger orchestrator.skipCurrentPhase');
      assert.strictEqual(answeredCallbacks[0].text, '⏭️ Đang bỏ qua phase...', 'Dashboard: Skip must return toast');

      // 2. Screen Capture Action (p:db:scr)
      answeredCallbacks.length = 0;
      await bot.handleUpdate({
        update_id: 212,
        callback_query: {
          id: 'cb_db_scr',
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          chat_instance: 'inst_1',
          data: 'p:db:scr',
          message: { message_id: 2, chat: { id: 777, type: 'private', first_name: 'Skul9x' } }
        }
      } as any);
      assert.strictEqual(mockScreen.captureCount, 1, 'Dashboard: Screen capture must trigger screenManager.send');
      assert.strictEqual(answeredCallbacks[0].text, '📸 Đang chụp màn hình desktop...', 'Dashboard: Screen capture toast');

      // 3. Refresh Action (p:db:ref)
      answeredCallbacks.length = 0;
      await bot.handleUpdate({
        update_id: 213,
        callback_query: {
          id: 'cb_db_ref',
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          chat_instance: 'inst_1',
          data: 'p:db:ref',
          message: { message_id: 2, chat: { id: 777, type: 'private', first_name: 'Skul9x' } }
        }
      } as any);
      assert.strictEqual(answeredCallbacks[0].text, '⚡ Trạng thái đã là mới nhất', 'Dashboard: Refresh must return latest status toast');

      // 4. Stop Action (p:db:stop)
      answeredCallbacks.length = 0;
      editedMessages.length = 0;
      await bot.handleUpdate({
        update_id: 214,
        callback_query: {
          id: 'cb_db_stop',
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          chat_instance: 'inst_1',
          data: 'p:db:stop',
          message: { message_id: 2, chat: { id: 777, type: 'private', first_name: 'Skul9x' } }
        }
      } as any);
      assert.strictEqual(mockOrch.stopCount, 1, 'Dashboard: Stop button must trigger orchestrator.stop');
      assert.strictEqual(answeredCallbacks[0].text, '🛑 Đang dừng kế hoạch...', 'Dashboard: Stop must return toast');
      assert.ok(editedMessages.length >= 1, 'Dashboard: Stop must update message to stopped state');
      const stoppedMsg = editedMessages[editedMessages.length - 1];
      assert.ok(
        stoppedMsg.text.includes('DỪNG LẠI') || stoppedMsg.text.includes('STOPPED'),
        'Dashboard: Message must show stopped status'
      );
      const stoppedBtns = stoppedMsg.reply_markup.inline_keyboard.flat();
      assert.ok(stoppedBtns.some((b: any) => b.callback_data.includes('p:db:resume')), 'Dashboard stopped: Must have resume button');
      assert.ok(stoppedBtns.some((b: any) => b.callback_data.includes('p:db:nav')), 'Dashboard stopped: Must have nav button');
    }
    console.log('  ✔ Suite 1 passed: All 4 screens and interactive controls verified flawlessly.\n');

    // -------------------------------------------------------------------------
    // Suite 2: 64-Byte Callback Data Payload Safety Audit
    // -------------------------------------------------------------------------
    console.log('[Suite 2] Verifying 64-byte payload limits across 100% of generated buttons...');
    {
      const planManager = new TelegramPlanManager({
        workspaceRoots: [testTempDir],
        defaultPlanFolder: 'plans'
      });
      const allFolders = planManager.discoverPlanFolders({ pendingOnly: false });

      // Gather all keyboards from all possible screens and components
      const keyboardsToTest: InlineKeyboard[] = [];

      // 1. Main folder list keyboards (pages 0, 1)
      keyboardsToTest.push(planManager.buildFolderPickerKeyboard(allFolders, { page: 0, pageSize: 5 }));
      keyboardsToTest.push(planManager.buildFolderPickerKeyboard(allFolders, { page: 0, pendingOnly: true, topPlan: allFolders[0] }));

      for (const folder of allFolders) {
        // 2. Active file prompt keyboard
        keyboardsToTest.push(planManager.buildActiveFilePromptKeyboard(folder, 'phase-04-oauth.md'));

        // 3. Mode selector keyboard
        keyboardsToTest.push(planManager.buildExecutionModeKeyboard(folder));

        // 4. Manual selection keyboards (empty, subset, all)
        keyboardsToTest.push(planManager.buildManualPhaseSelectionKeyboard(folder, new Set<number>()));
        keyboardsToTest.push(planManager.buildManualPhaseSelectionKeyboard(folder, new Set<number>([1, 2])));
        keyboardsToTest.push(planManager.buildManualPhaseSelectionKeyboard(folder, new Set<number>([1, 2, 3, 4, 5])));

        // 5. Live Dashboard keyboards for all states: running, completed, stopped, error
        keyboardsToTest.push(buildExecutionDashboard({ folder, planName: folder.displayName, state: 'running' }).keyboard);
        keyboardsToTest.push(buildExecutionDashboard({ folder, planName: folder.displayName, state: 'completed' }).keyboard);
        keyboardsToTest.push(buildExecutionDashboard({ folder, planName: folder.displayName, state: 'stopped' }).keyboard);
        keyboardsToTest.push(buildExecutionDashboard({ folder, planName: folder.displayName, state: 'error' }).keyboard);
      }

      let totalButtonsAudited = 0;
      for (const kb of keyboardsToTest) {
        for (const row of kb.inline_keyboard) {
          for (const btn of row) {
            totalButtonsAudited++;
            const cbData = (btn as any).callback_data || '';
            const byteLength = Buffer.byteLength(cbData, 'utf8');
            assert.ok(
              byteLength <= 64,
              `CRITICAL: Button "${btn.text}" callback_data exceeds 64 bytes (${byteLength} bytes): "${cbData}"`
            );
          }
        }
      }

      assert.ok(totalButtonsAudited >= 30, `Must audit a significant number of buttons (audited ${totalButtonsAudited})`);
      console.log(`  ✔ Suite 2 passed: 100% of buttons (${totalButtonsAudited} audited) strictly comply with <= 64-byte limit.\n`);
    }

    // -------------------------------------------------------------------------
    // Suite 3: Telegram Parse Mode Safety & Underscore Resilience
    // -------------------------------------------------------------------------
    console.log('[Suite 3] Verifying Parse Mode Safety on complex file/folder names with underscores...');
    {
      const trickyTitle = 'plans/feature_user_auth_flow_test_v2__final_edition';
      const escaped = escapeTelegramMarkdown(trickyTitle);
      assert.ok(
        !escaped.includes('_') || escaped.includes('\\_'),
        'escapeTelegramMarkdown must escape underscores'
      );

      const safePlanText = formatSafePlanText(`📁 Kế hoạch: ${trickyTitle}\nStatus: in_progress`);
      assert.ok(safePlanText, 'formatSafePlanText should produce valid text');

      // Verify compact phase button label shortening
      const shortSlug = extractPhaseSlug('phase-01-scaffold_and_database_setup_engine.md', 8);
      assert.ok(shortSlug.length <= 10, `Slug must be shortened for mobile: "${shortSlug}"`);

      const shortPlan = formatShortPlanName('plans/super_long_feature_name_exceeding_standard_limits', 18);
      assert.ok(shortPlan.length <= 18, `Plan name must be shortened: "${shortPlan}"`);
      console.log('  ✔ Suite 3 passed: Telegram parsing resilience and formatting sanitization verified.\n');
    }

    // -------------------------------------------------------------------------
    // Suite 4: DashboardThrottler Rate-Limit (1200ms) & Coalescing Verification
    // -------------------------------------------------------------------------
    console.log('[Suite 4] Verifying DashboardThrottler rate-limit (>= 1200ms) & trailing execution...');
    {
      const minInterval = 1200;
      let executedCount = 0;
      const throttler = new DashboardThrottler({
        minIntervalMs: minInterval,
        onUpdate: async () => {
          executedCount++;
        }
      });

      assert.strictEqual(throttler.getMinIntervalMs(), minInterval, 'Throttler interval must match configured interval');

      // First call fires immediately
      await throttler.schedule();
      assert.strictEqual(executedCount, 1, 'First trigger must fire immediately');

      // Rapid sequential calls within window should be throttled and coalesced
      await throttler.schedule();
      await throttler.schedule();
      await throttler.schedule();
      assert.strictEqual(executedCount, 1, 'Rapid triggers within interval window must not execute immediately');
      assert.strictEqual(throttler.hasPending(), true, 'Must register pending execution during throttle window');

      // Forced trigger (e.g. on allComplete / error / stopped) bypasses throttle immediately
      await throttler.flush();
      assert.strictEqual(executedCount, 2, 'Flush must execute immediately without waiting for timeout');

      throttler.cancel();
      console.log('  ✔ Suite 4 passed: DashboardThrottler effectively prevents HTTP 429 rate limits.\n');
    }

    // -------------------------------------------------------------------------
    // Suite 5: "Message is not modified" Telegram Resilience
    // -------------------------------------------------------------------------
    console.log('[Suite 5] Verifying "message is not modified" error resilience...');
    {
      const notModifiedError = new Error(
        'Bad Request: message is not modified: specified new message content and reply markup are exactly the same'
      );
      assert.strictEqual(
        isMessageNotModifiedError(notModifiedError),
        true,
        'isMessageNotModifiedError must identify Telegram not-modified error'
      );

      const generalError = new Error('Bad Request: chat not found');
      assert.strictEqual(
        isMessageNotModifiedError(generalError),
        false,
        'isMessageNotModifiedError must return false for unrelated errors'
      );

      // Verify that bot with editMessageText not modified failure handles refresh gracefully
      const { bot, answeredCallbacks } = createMockBot('123456:TEST_TOKEN', { shouldFailEditWithNotModified: true });
      const planManager = new TelegramPlanManager({
        workspaceRoots: [testTempDir]
      });
      planManager.registerWithBot(bot);

      // Simulate refresh callback query when message content is unchanged
      await bot.handleUpdate({
        update_id: 301,
        callback_query: {
          id: 'cb_refresh_unmodified',
          from: { id: 777, is_bot: false, first_name: 'Skul9x' },
          chat_instance: 'inst_1',
          data: 'p:db:ref',
          message: { message_id: 10, chat: { id: 777, type: 'private', first_name: 'Skul9x' } }
        }
      } as any);

      assert.strictEqual(answeredCallbacks.length, 1, 'Refresh handler must gracefully answer callback');
      assert.strictEqual(
        answeredCallbacks[0].text,
        '⚡ Trạng thái đã là mới nhất',
        'Refresh must return reassuring toast even when Telegram throws message is not modified'
      );
      console.log('  ✔ Suite 5 passed: "message is not modified" resilience confirmed.\n');
    }

    console.log('================================================================');
    console.log(' ALL SUITES PASSED! Phase 05 End-to-End Integration Verified.   ');
    console.log('================================================================\n');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase05E2EIntegrationAndReleaseTest().catch((err) => {
  console.error('\n❌ Phase 05 Test Suite failed with error:', err);
  process.exit(1);
});
