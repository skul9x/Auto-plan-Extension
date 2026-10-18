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
import { Bot, Context } from 'grammy';
import {
  TelegramPlanManager,
  DiscoveredPlanFolder,
  discoverPlanFolders,
  discoverPlanFoldersAsync
} from '../telegramPlanManager';
import {
  tryScanPlanFolder,
  tryScanPlanFolderAsync,
  scanMultiplePlanFolders,
  PhaseFile
} from '../planScanner';
import { TelegramBridge } from '../telegramBridge';
import { DebugLogger } from '../debugLogger';

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
          message_id: Math.floor(Math.random() * 10000) + 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id, type: 'private', first_name: 'Chat' },
          text: anyPayload.text,
          reply_markup: anyPayload.reply_markup
        }
      } as any;
    }
    if (method === 'editMessageText' || method === 'editMessageReplyMarkup') {
      editedMessages.push({ method, payload: anyPayload });
      return {
        ok: true,
        result: {
          message_id: anyPayload.message_id || 101,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id || 12345, type: 'private' },
          text: anyPayload.text,
          reply_markup: anyPayload.reply_markup
        }
      } as any;
    }
    if (method === 'answerCallbackQuery') {
      answeredCallbacks.push(anyPayload);
      return { ok: true, result: true } as any;
    }
    return { ok: true, result: {} } as any;
  });

  return { bot, sentMessages, editedMessages, answeredCallbacks };
}

/**
 * Mock Orchestrator for tracking custom phase executions.
 */
class MockOrchestrator {
  public executedPhasesList: PhaseFile[][] = [];
  public customExecutionCallCount: number = 0;
  public startPhasesCallCount: number = 0;
  public running: boolean = false;
  public currentPhase: any = null;

  public isRunning(): boolean {
    return this.running;
  }

  public getCurrentPhase(): any {
    return this.currentPhase;
  }

  public async startCustomExecution(phases: PhaseFile[]): Promise<boolean> {
    this.customExecutionCallCount++;
    this.executedPhasesList.push([...phases]);
    return true;
  }

  public async startPhases(phases: PhaseFile[]): Promise<boolean> {
    this.startPhasesCallCount++;
    this.executedPhasesList.push([...phases]);
    return true;
  }
}

async function runPhase02PlanDiscoverySelectorTest() {
  console.log('================================================================');
  console.log(' Phase 02: Plan Folder Discovery & Execution Selector Test');
  console.log('================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-tg-phase02-'));
  const testLogger = new DebugLogger(100);

  // Setup test workspace directories and markdown files
  // Folder 1: plans/feature-auth (3 completed, 2 pending -> total 5, uncompleted)
  const authDir = path.join(testTempDir, 'plans', 'feature-auth');
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(authDir, 'phase-01-scaffold.md'), '# Phase 01\nStatus: ✅ Completed\n');
  fs.writeFileSync(path.join(authDir, 'phase-02-auth-core.md'), '# Phase 02\nStatus: ✅ Completed\n');
  fs.writeFileSync(path.join(authDir, 'phase-03-jwt.md'), '# Phase 03\nStatus: [x] Done\n');
  fs.writeFileSync(path.join(authDir, 'phase-04-oauth.md'), '# Phase 04\nStatus: ⬜ Pending\n');
  fs.writeFileSync(path.join(authDir, 'phase-05-audit.md'), '# Phase 05\nStatus: 🟡 In Progress\n');

  // Folder 2: plans/feature-payment (0 completed, 4 pending -> total 4, uncompleted)
  const paymentDir = path.join(testTempDir, 'plans', 'feature-payment');
  fs.mkdirSync(paymentDir, { recursive: true });
  fs.writeFileSync(path.join(paymentDir, 'phase-01-stripe.md'), '# Phase 01\nStatus: ⬜ Pending\n');
  fs.writeFileSync(path.join(paymentDir, 'phase-02-paypal.md'), '# Phase 02\nStatus: ⬜ Pending\n');
  fs.writeFileSync(path.join(paymentDir, 'phase-03-webhooks.md'), '# Phase 03\nStatus: ⬜ Pending\n');
  fs.writeFileSync(path.join(paymentDir, 'phase-04-receipts.md'), '# Phase 04\nStatus: ⬜ Pending\n');

  // Folder 3: plans/feature-legacy (2 completed, 0 pending -> fully completed)
  const legacyDir = path.join(testTempDir, 'plans', 'feature-legacy');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'phase-01-setup.md'), '# Phase 01\nStatus: ✅ Completed\n');
  fs.writeFileSync(path.join(legacyDir, 'phase-02-wrapup.md'), '# Phase 02\nStatus: ✅ Completed\n');

  // Folder 4: custom-plans/feature-export (1 completed, 1 pending -> in defaultPlanFolder)
  const exportDir = path.join(testTempDir, 'custom-plans', 'feature-export');
  fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(path.join(exportDir, 'phase-01-csv.md'), '# Phase 01\nStatus: ✅ Completed\n');
  fs.writeFileSync(path.join(exportDir, 'phase-02-pdf.md'), '# Phase 02\nStatus: ⬜ Pending\n');

  // Non-plan folder with non-phase markdown files (should be ignored)
  const nonPlanDir = path.join(testTempDir, 'plans', 'docs-only');
  fs.mkdirSync(nonPlanDir, { recursive: true });
  fs.writeFileSync(path.join(nonPlanDir, 'readme.md'), '# Readme\n');
  fs.writeFileSync(path.join(nonPlanDir, 'summary.md'), '# Summary\n');
  fs.writeFileSync(path.join(nonPlanDir, 'notes.md'), '# Notes\n');

  mockWorkspaceFolders = [{ uri: { fsPath: testTempDir } }];

  try {
    // -------------------------------------------------------------------------
    // Test Suite 1: Scanning & Identification of Plan Folders
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Verifying scanning and identification of plan folders...');
    {
      const planManager = new TelegramPlanManager({
        workspaceRoots: [testTempDir],
        defaultPlanFolder: 'custom-plans',
        logger: testLogger
      });

      // 1.1 Multi-folder scanning utility in planScanner
      const scannedMulti = scanMultiplePlanFolders([authDir, paymentDir, legacyDir, nonPlanDir]);
      assert.strictEqual(scannedMulti.size, 3, 'Should only discover the 3 valid phase folders');

      // 1.2 Discover all valid plan folders
      const allFolders = planManager.discoverPlanFolders({ pendingOnly: false });
      assert.strictEqual(allFolders.length, 4, 'Should discover all 4 folders (auth, payment, legacy, export)');

      // Verify feature-auth metrics
      const authFolder = allFolders.find((f) => f.displayName.includes('feature-auth'));
      assert.ok(authFolder, 'feature-auth folder should be discovered');
      assert.strictEqual(authFolder.totalPhases, 5, 'feature-auth should have 5 total phases');
      assert.strictEqual(authFolder.completedPhases, 3, 'feature-auth should have 3 completed phases');
      assert.strictEqual(authFolder.pendingPhases, 2, 'feature-auth should have 2 pending phases');
      assert.strictEqual(authFolder.hasPendingPhases, true, 'feature-auth has pending phases');

      // Verify feature-payment metrics
      const paymentFolder = allFolders.find((f) => f.displayName.includes('feature-payment'));
      assert.ok(paymentFolder, 'feature-payment folder should be discovered');
      assert.strictEqual(paymentFolder.totalPhases, 4, 'feature-payment should have 4 total phases');
      assert.strictEqual(paymentFolder.completedPhases, 0, 'feature-payment should have 0 completed phases');
      assert.strictEqual(paymentFolder.pendingPhases, 4, 'feature-payment should have 4 pending phases');
      assert.strictEqual(paymentFolder.hasPendingPhases, true, 'feature-payment has pending phases');

      // Verify feature-legacy metrics (fully completed)
      const legacyFolder = allFolders.find((f) => f.displayName.includes('feature-legacy'));
      assert.ok(legacyFolder, 'feature-legacy folder should be discovered');
      assert.strictEqual(legacyFolder.totalPhases, 2);
      assert.strictEqual(legacyFolder.completedPhases, 2);
      assert.strictEqual(legacyFolder.pendingPhases, 0);
      assert.strictEqual(legacyFolder.hasPendingPhases, false, 'feature-legacy should NOT have pending phases');

      // Verify defaultPlanFolder discovery (feature-export)
      const exportFolder = allFolders.find((f) => f.displayName.includes('feature-export'));
      assert.ok(exportFolder, 'feature-export from defaultPlanFolder should be discovered');
      assert.strictEqual(exportFolder.totalPhases, 2);
      assert.strictEqual(exportFolder.completedPhases, 1);
      assert.strictEqual(exportFolder.pendingPhases, 1);

      // 1.3 Discover only folders with pending phases (pendingOnly: true)
      const pendingFolders = planManager.discoverPlanFolders({ pendingOnly: true });
      assert.strictEqual(pendingFolders.length, 3, 'Pending-only should filter out feature-legacy');
      assert.ok(!pendingFolders.some((f) => f.displayName.includes('feature-legacy')), 'feature-legacy must be excluded');

      // 1.4 Async discovery parity
      const asyncPending = await planManager.discoverPlanFoldersAsync({ pendingOnly: true });
      assert.strictEqual(asyncPending.length, 3, 'Async discovery should return identical folder count');

      console.log('  ✓ Scanning correctly identified pending vs completed folders and aggregated status metrics.');
    }

    // -------------------------------------------------------------------------
    // Test Suite 2: Inline Keyboard Generation & Formatting
    // -------------------------------------------------------------------------
    console.log('\n[Suite 2] Verifying generation of inline keyboard buttons...');
    {
      const planManager = new TelegramPlanManager({
        workspaceRoots: [testTempDir],
        defaultPlanFolder: 'custom-plans',
        logger: testLogger
      });
      const pendingFolders = planManager.discoverPlanFolders({ pendingOnly: true });

      // 2.1 Folder picker keyboard buttons
      const kb = planManager.buildFolderPickerKeyboard(pendingFolders, 0, 8);
      const rows = kb.inline_keyboard;
      assert.ok(rows.length >= 3, 'Should have button rows for pending folders');

      // Check button text format matching: [📁 plans/feature-auth (3/5 done)]
      const authBtn = rows.flat().find((btn) => btn.text.includes('feature-auth'));
      assert.ok(authBtn, 'Should have button for feature-auth');
      assert.ok(
        authBtn.text.includes('(3/5 done)'),
        `Button text "${authBtn.text}" should format completion as (3/5 done)`
      );
      assert.ok((authBtn as any).callback_data.startsWith('fld:'), 'Callback data should start with fld:');

      const paymentBtn = rows.flat().find((btn) => btn.text.includes('feature-payment'));
      assert.ok(paymentBtn, 'Should have button for feature-payment');
      assert.ok(
        paymentBtn.text.includes('(0/4 done)'),
        `Button text "${paymentBtn.text}" should format completion as (0/4 done)`
      );

      // 2.2 Pagination for > 8 plan folders
      const dummyFolders: DiscoveredPlanFolder[] = Array.from({ length: 12 }, (_, i) => ({
        id: `f_dummy_${i}`,
        folderPath: `/dummy/folder_${i}`,
        nativePath: `/dummy/folder_${i}`,
        relativePath: `plans/module-${i}`,
        displayName: `plans/module-${i}`,
        totalPhases: 3,
        completedPhases: 1,
        pendingPhases: 2,
        hasPendingPhases: true,
        phases: []
      }));

      const page0Kb = planManager.buildFolderPickerKeyboard(dummyFolders, 0, 8);
      const p0Rows = page0Kb.inline_keyboard;
      assert.strictEqual(p0Rows.length, 9, 'Page 0 should have 8 folder rows + 1 pagination row');
      const nextBtn = p0Rows[8].find((b) => b.text.includes('Next'));
      assert.ok(nextBtn, 'Page 0 must include Next page button');
      assert.strictEqual((nextBtn as any).callback_data, 'fld_page:1');

      const page1Kb = planManager.buildFolderPickerKeyboard(dummyFolders, 1, 8);
      const p1Rows = page1Kb.inline_keyboard;
      assert.strictEqual(p1Rows.length, 5, 'Page 1 should have 4 folder rows + 1 pagination row');
      const prevBtn = p1Rows[4].find((b) => b.text.includes('Prev'));
      assert.ok(prevBtn, 'Page 1 must include Prev page button');
      assert.strictEqual((prevBtn as any).callback_data, 'fld_page:0');

      // 2.3 Execution mode selector keyboard
      const authFolder = pendingFolders.find((f) => f.displayName.includes('feature-auth'))!;
      const modeKb = planManager.buildExecutionModeKeyboard(authFolder);
      const modeBtns = modeKb.inline_keyboard.flat();

      const runAllBtn = modeBtns.find((b) => b.text.includes('Run All Phases'));
      assert.ok(runAllBtn, 'Should include [Run All Phases] button');
      assert.strictEqual((runAllBtn as any).callback_data, `mode:all:${authFolder.id}`);

      const runPendingBtn = modeBtns.find((b) => b.text.includes('Run Only Pending'));
      assert.ok(runPendingBtn, 'Should include [Run Only Pending/Uncompleted Phases] button');
      assert.strictEqual((runPendingBtn as any).callback_data, `mode:pending:${authFolder.id}`);

      const selectManualBtn = modeBtns.find((b) => b.text.includes('Select Phases Manually'));
      assert.ok(selectManualBtn, 'Should include [Select Phases Manually] button');
      assert.strictEqual((selectManualBtn as any).callback_data, `mode:manual:${authFolder.id}`);

      // 2.4 Manual phase selection keyboard with checkboxes
      const selectedIndices = new Set<number>([4, 5]); // select phase 4 and 5
      const manualKb = planManager.buildManualPhaseSelectionKeyboard(authFolder, selectedIndices);
      const manualBtns = manualKb.inline_keyboard.flat();

      const phase1Btn = manualBtns.find(
        (b) => b.text.includes('phase-01-scaffold.md') || b.text.includes('P01:')
      );
      assert.ok(phase1Btn, 'Should render phase 1 toggle button');
      assert.ok(phase1Btn.text.includes('⬜'), 'Phase 1 not selected should have ⬜');

      const phase4Btn = manualBtns.find(
        (b) => b.text.includes('phase-04-oauth.md') || b.text.includes('P04:')
      );
      assert.ok(phase4Btn, 'Should render phase 4 toggle button');
      assert.ok(phase4Btn.text.includes('✅'), 'Phase 4 selected should have ✅');

      const startSelectedBtn = manualBtns.find(
        (b) => b.text.includes('Start Selected Phases') || b.text.includes('Bắt đầu')
      );
      assert.ok(startSelectedBtn, 'Should include [Start Selected Phases] button');
      assert.ok(
        (startSelectedBtn as any).callback_data === `start:manual:${authFolder.id}` ||
          (startSelectedBtn as any).callback_data === `p:run:man:${authFolder.id}`,
        'Callback data should be start:manual or p:run:man'
      );

      console.log('  ✓ Inline keyboards, button formatting, pagination, and toggle icons generated accurately.');
    }

    // -------------------------------------------------------------------------
    // Test Suite 3: Interactive Bot Commands & Execution Modes Handling
    // -------------------------------------------------------------------------
    console.log('\n[Suite 3] Verifying interactive Telegram commands, callbacks, and execution modes...');
    {
      const { bot, sentMessages, editedMessages, answeredCallbacks } = createMockBot();
      const mockOrch = new MockOrchestrator();
      const planManager = new TelegramPlanManager({
        workspaceRoots: [testTempDir],
        defaultPlanFolder: 'custom-plans',
        orchestrator: mockOrch,
        logger: testLogger
      });

      planManager.registerWithBot(bot);

      // 3.1 Send /plans command when no active editor is open
      mockActiveTextEditor = undefined;
      await bot.handleUpdate({
        update_id: 101,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private', first_name: 'Tester' },
          from: { id: 777, is_bot: false, first_name: 'Tester' },
          text: '/plans',
          entities: [{ type: 'bot_command', offset: 0, length: 6 }]
        }
      });

      assert.strictEqual(sentMessages.length, 1, 'Bot should reply to /plans command');
      const initialReply = sentMessages[0];
      assert.ok(initialReply.text.includes('Available Plan Folders'));
      assert.ok(initialReply.reply_markup, 'Reply should include inline keyboard');

      // 3.2 Send /plan_start command when an active markdown phase file is in editor
      sentMessages.length = 0;
      mockActiveTextEditor = {
        document: {
          uri: {
            fsPath: path.join(authDir, 'phase-04-oauth.md')
          }
        }
      };

      await bot.handleUpdate({
        update_id: 102,
        message: {
          message_id: 2,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 777, type: 'private', first_name: 'Tester' },
          from: { id: 777, is_bot: false, first_name: 'Tester' },
          text: '/plan_start',
          entities: [{ type: 'bot_command', offset: 0, length: 11 }]
        }
      });

      assert.strictEqual(sentMessages.length, 1, 'Bot should reply to /plan_start');
      const activePromptReply = sentMessages[0];
      assert.ok(
        activePromptReply.text.includes('Active Plan Detected'),
        'Bot should offer to run active plan detected in editor'
      );
      const activePromptBtns = activePromptReply.reply_markup.inline_keyboard.flat();
      assert.ok(activePromptBtns.some((b: any) => b.text.includes('Run Active Plan')));
      assert.ok(activePromptBtns.some((b: any) => b.text.includes('Browse Other Plan Folders')));

      // Reset active editor
      mockActiveTextEditor = undefined;

      // 3.3 Folder selection callback (fld:<id>)
      const allFolders = planManager.discoverPlanFolders({ pendingOnly: false });
      const authFolder = allFolders.find((f) => f.displayName.includes('feature-auth'))!;
      editedMessages.length = 0;
      answeredCallbacks.length = 0;

      await bot.handleUpdate({
        update_id: 103,
        callback_query: {
          id: 'cb_query_select_folder',
          from: { id: 777, is_bot: false, first_name: 'Tester' },
          chat_instance: 'instance_1',
          data: `fld:${authFolder.id}`,
          message: {
            message_id: 10,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Tester' },
            text: 'Available Plan Folders'
          }
        }
      });

      assert.strictEqual(answeredCallbacks.length, 1, 'Callback query must be answered immediately');
      assert.strictEqual(editedMessages.length, 1, 'Message text should be edited to show execution modes');
      const modeMenuEdit = editedMessages[0];
      assert.ok(modeMenuEdit.payload.text.includes('Choose execution mode'));

      // 3.4 Execution Mode 1: Run All Phases
      mockOrch.executedPhasesList = [];
      await bot.handleUpdate({
        update_id: 104,
        callback_query: {
          id: 'cb_query_mode_all',
          from: { id: 777, is_bot: false, first_name: 'Tester' },
          chat_instance: 'instance_1',
          data: `mode:all:${authFolder.id}`,
          message: {
            message_id: 10,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Tester' },
            text: 'Choose execution mode'
          }
        }
      });

      assert.strictEqual(mockOrch.customExecutionCallCount, 1, 'Orchestrator startCustomExecution called');
      assert.strictEqual(mockOrch.executedPhasesList[0].length, 5, 'Run All must pass all 5 phases to orchestrator');

      // 3.5 Execution Mode 2: Run Only Pending / Uncompleted Phases
      mockOrch.executedPhasesList = [];
      await bot.handleUpdate({
        update_id: 105,
        callback_query: {
          id: 'cb_query_mode_pending',
          from: { id: 777, is_bot: false, first_name: 'Tester' },
          chat_instance: 'instance_1',
          data: `mode:pending:${authFolder.id}`,
          message: {
            message_id: 10,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Tester' },
            text: 'Choose execution mode'
          }
        }
      });

      assert.strictEqual(mockOrch.customExecutionCallCount, 2, 'Orchestrator called for pending execution');
      assert.strictEqual(
        mockOrch.executedPhasesList[0].length,
        2,
        'Run Only Pending must pass exactly the 2 uncompleted phases'
      );
      assert.strictEqual(mockOrch.executedPhasesList[0][0].fileName, 'phase-04-oauth.md');
      assert.strictEqual(mockOrch.executedPhasesList[0][1].fileName, 'phase-05-audit.md');

      // 3.6 Execution Mode 3: Manual Selection Flow
      editedMessages.length = 0;
      await bot.handleUpdate({
        update_id: 106,
        callback_query: {
          id: 'cb_query_mode_manual',
          from: { id: 777, is_bot: false, first_name: 'Tester' },
          chat_instance: 'instance_1',
          data: `mode:manual:${authFolder.id}`,
          message: {
            message_id: 10,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Tester' },
            text: 'Choose execution mode'
          }
        }
      });

      assert.strictEqual(editedMessages.length, 1, 'Should edit message to render manual selection buttons');
      const manualEdit = editedMessages[0];
      assert.ok(
        manualEdit.payload.text.includes('Select Phases to Execute') ||
          manualEdit.payload.text.includes('CHỌN PHASE')
      );

      // 3.7 Toggle phase in manual selection: toggle phase 1 (currently unselected -> toggled to selected)
      await bot.handleUpdate({
        update_id: 107,
        callback_query: {
          id: 'cb_query_toggle',
          from: { id: 777, is_bot: false, first_name: 'Tester' },
          chat_instance: 'instance_1',
          data: `tog:${authFolder.id}:1`,
          message: {
            message_id: 10,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Tester' }
          }
        }
      });

      const session = planManager.getSession(777, authFolder.id);
      assert.ok(session.selectedIndices.has(1), 'Phase 1 should now be selected in session');

      // 3.8 Confirm and start selected phases manually
      mockOrch.executedPhasesList = [];
      await bot.handleUpdate({
        update_id: 108,
        callback_query: {
          id: 'cb_query_start_manual',
          from: { id: 777, is_bot: false, first_name: 'Tester' },
          chat_instance: 'instance_1',
          data: `start:manual:${authFolder.id}`,
          message: {
            message_id: 10,
            date: Math.floor(Date.now() / 1000),
            chat: { id: 777, type: 'private', first_name: 'Tester' },
            text: 'Select Phases to Execute'
          }
        }
      });

      assert.strictEqual(mockOrch.customExecutionCallCount, 3, 'Orchestrator called for manual execution');
      const manualDispatched = mockOrch.executedPhasesList[0];
      // Initially pending was [4, 5], toggled 1 ON -> total 3: [1, 4, 5]
      assert.strictEqual(manualDispatched.length, 3, 'Must execute exactly the 3 selected phases');
      const fileNames = manualDispatched.map((p) => p.fileName);
      assert.ok(fileNames.includes('phase-01-scaffold.md'), 'Phase 1 included');
      assert.ok(fileNames.includes('phase-04-oauth.md'), 'Phase 4 included');
      assert.ok(fileNames.includes('phase-05-audit.md'), 'Phase 5 included');

      console.log('  ✓ Interactive /plans command, callbacks, and all 3 execution modes verified successfully.');
    }

    // -------------------------------------------------------------------------
    // Test Suite 4: Bridge Integration & Safeguard Guards
    // -------------------------------------------------------------------------
    console.log('\n[Suite 4] Verifying TelegramBridge integration and runtime guards...');
    {
      const mockOrch = new MockOrchestrator();
      const planManager = new TelegramPlanManager({
        workspaceRoots: [testTempDir],
        defaultPlanFolder: 'custom-plans',
        orchestrator: mockOrch,
        logger: testLogger
      });

      const bridge = new TelegramBridge({
        token: 'test_token_phase02',
        enabled: true,
        allowedUsers: [777],
        logger: testLogger,
        planManager
      });

      assert.strictEqual(bridge.getPlanManager(), planManager, 'Bridge must reference provided planManager');

      // Test already running orchestrator guard
      mockOrch.running = true;
      mockOrch.currentPhase = { fileName: 'phase-03-jwt.md' };

      const allFolders = planManager.discoverPlanFolders({ pendingOnly: false });
      const authFolder = allFolders.find((f) => f.displayName.includes('feature-auth'))!;
      const rejectResult = await planManager.executePhases(authFolder.phases, 'all', authFolder.displayName);

      assert.strictEqual(rejectResult.success, false, 'Should reject execution when orchestrator is running');
      assert.ok(
        rejectResult.message.includes('already running'),
        `Message should indicate orchestrator is already running: "${rejectResult.message}"`
      );

      // Test empty phase selection guard
      mockOrch.running = false;
      const emptyResult = await planManager.executePhases([], 'manual');
      assert.strictEqual(emptyResult.success, false, 'Should reject empty phases list');

      console.log('  ✓ Bridge integration, already-running guard, and empty selection guard verified.');
    }

    console.log('\n================================================================');
    console.log(' ALL Phase 02 Plan Discovery & Execution Selector Tests PASSED!');
    console.log('================================================================\n');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase02PlanDiscoverySelectorTest().catch((err) => {
  console.error('\n❌ Phase 02 Test Suite failed with error:', err);
  process.exit(1);
});
