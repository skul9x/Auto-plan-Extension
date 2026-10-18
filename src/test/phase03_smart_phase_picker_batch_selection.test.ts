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
  formatCompactPhaseButtonLabel,
  formatManualSelectionMessage,
  extractPhaseSlug,
  extractReadablePhaseTitle
} from '../telegramPlanManager';
import { PhaseFile } from '../planScanner';

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
  title?: string
): string {
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, fileName);
  const heading = title ? `# ${title}` : `# Phase File: ${fileName}`;
  const content = `${heading}\n\nStatus: ${status === 'Completed' ? '✅ Completed' : '⬜ Pending'}\n\n## Content\nSample phase test content.`;
  fs.writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

async function runPhase03SmartPhasePickerTest(): Promise<void> {
  console.log('================================================================');
  console.log(' Phase 03: Smart Phase Picker with Batch Selection & Compact Grid ');
  console.log('================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan_p3_test_'));
  mockWorkspaceFolders = [{ uri: { fsPath: testTempDir } }];

  try {
    // -------------------------------------------------------------------------
    // Suite 1: Compact 2-Column Mobile Truncation & Label Formatter
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Verifying Compact 2-Column Labels and Mobile Truncation Rule...');
    {
      // 1.1 extractPhaseSlug with various name formats
      assert.strictEqual(
        extractPhaseSlug('phase-01-visual-progress-and-localization.md', 8),
        'Visual..',
        'Should truncate long slug to Visual.. with maxLen 8'
      );
      assert.strictEqual(
        extractPhaseSlug('phase-02-quick-resume-and-folder-picker.md', 8),
        'Quick..',
        'Should truncate long slug to Quick.. with maxLen 8'
      );
      assert.strictEqual(
        extractPhaseSlug('03-auth.md', 8),
        'Auth',
        'Short slug Auth should not be truncated'
      );
      assert.strictEqual(
        extractPhaseSlug('phase-04-scaffold.md', 8),
        'Scaffold',
        '8-char slug Scaffold should not be truncated'
      );
      assert.strictEqual(
        extractPhaseSlug('phase-10-performance-monitoring.md', 8),
        'Perfor..',
        'Long slug should truncate cleanly with ..'
      );

      // 1.2 formatCompactPhaseButtonLabel formatting
      const samplePhase1: PhaseFile = {
        fileName: 'phase-01-visual-progress-and-localization.md',
        filePath: '/dummy/phase-01-visual-progress-and-localization.md',
        nativePath: '/dummy/phase-01-visual-progress-and-localization.md',
        normalizedPath: '/dummy/phase-01-visual-progress-and-localization.md',
        relativePath: 'phase-01-visual-progress-and-localization.md',
        index: 1,
        status: 'Pending',
        isCompleted: false
      };
      const samplePhase2: PhaseFile = {
        fileName: 'phase-02-quick-resume-and-folder-picker.md',
        filePath: '/dummy/phase-02-quick-resume-and-folder-picker.md',
        nativePath: '/dummy/phase-02-quick-resume-and-folder-picker.md',
        normalizedPath: '/dummy/phase-02-quick-resume-and-folder-picker.md',
        relativePath: 'phase-02-quick-resume-and-folder-picker.md',
        index: 2,
        status: 'Completed',
        isCompleted: true
      };

      const label1Checked = formatCompactPhaseButtonLabel(samplePhase1, true);
      assert.strictEqual(
        label1Checked,
        '[✅ P01: Visual..]',
        'Checked phase 1 label must match standard [✅ P01: Visual..]'
      );

      const label2Unchecked = formatCompactPhaseButtonLabel(samplePhase2, false);
      assert.strictEqual(
        label2Unchecked,
        '[⬜ P02: Quick..]',
        'Unchecked phase 2 label must match standard [⬜ P02: Quick..]'
      );

      // Verify label length constraint: must be <= 18-20 characters to prevent mobile line-wrapping
      assert.ok(
        label1Checked.length <= 18,
        `Label length (${label1Checked.length}) must be <= 18 characters on mobile`
      );
      assert.ok(
        label2Unchecked.length <= 18,
        `Label length (${label2Unchecked.length}) must be <= 18 characters on mobile`
      );

      // Overload signature test: (index, fileName, checked)
      const labelByArgs = formatCompactPhaseButtonLabel(9, 'phase-09-database.md', true);
      assert.strictEqual(
        labelByArgs,
        '[✅ P09: Database]',
        'Should support direct index and fileName arguments'
      );

      console.log('  ✔ Suite 1 passed: Compact 2-column mobile labels and truncation verified.\n');
    }

    // -------------------------------------------------------------------------
    // Suite 2: Full Phase Detail Body Message Formatter
    // -------------------------------------------------------------------------
    console.log('[Suite 2] Verifying Message Body Detail Formatting...');
    {
      const dummyFolder: DiscoveredPlanFolder = {
        id: 'f_test_suite2',
        folderPath: '/workspace/plans/feature-auth',
        nativePath: '/workspace/plans/feature-auth',
        relativePath: 'plans/feature-auth',
        displayName: 'feature-auth',
        totalPhases: 2,
        completedPhases: 1,
        pendingPhases: 1,
        hasPendingPhases: true,
        phases: [
          {
            fileName: 'phase-01-visual-progress-bar-engine.md',
            filePath: '/workspace/plans/feature-auth/phase-01-visual-progress-bar-engine.md',
            nativePath: '/workspace/plans/feature-auth/phase-01-visual-progress-bar-engine.md',
            normalizedPath: '/workspace/plans/feature-auth/phase-01-visual-progress-bar-engine.md',
            relativePath: 'phase-01-visual-progress-bar-engine.md',
            index: 1,
            status: 'Pending',
            isCompleted: false
          },
          {
            fileName: 'phase-02-quick-resume-and-folder-picker.md',
            filePath: '/workspace/plans/feature-auth/phase-02-quick-resume-and-folder-picker.md',
            nativePath: '/workspace/plans/feature-auth/phase-02-quick-resume-and-folder-picker.md',
            normalizedPath: '/workspace/plans/feature-auth/phase-02-quick-resume-and-folder-picker.md',
            relativePath: 'phase-02-quick-resume-and-folder-picker.md',
            index: 2,
            status: 'Completed',
            isCompleted: true
          }
        ]
      };

      const msg = formatManualSelectionMessage(dummyFolder);
      assert.ok(msg.includes('📋 CHỌN PHASE THỰC THI (feature-auth)'), 'Must include header title');
      assert.ok(msg.includes('1️⃣ Phase 01: Visual Progress Bar Engine [Chưa chạy]'), 'Must format pending phase with [Chưa chạy]');
      assert.ok(msg.includes('2️⃣ Phase 02: Quick Resume And Folder Picker [Đã xong]'), 'Must format completed phase with [Đã xong]');
      assert.ok(msg.includes('Chạm vào nút bên dưới để chọn, sau đó nhấn Bắt đầu:'), 'Must include action footer prompt');

      console.log('  ✔ Suite 2 passed: Message body accurately retains full titles and statuses.\n');
    }

    // -------------------------------------------------------------------------
    // Suite 3: Batch Selection Methods (selectAllPhases, selectPendingPhasesOnly, clearPhaseSelection)
    // -------------------------------------------------------------------------
    console.log('[Suite 3] Verifying Batch Selection Methods (All, Pending, Clear)...');
    {
      const planDir = path.join(testTempDir, 'plans', 'batch-test-plan');
      // Create 5 phases: Phase 1 & 3 Completed, Phase 2, 4, 5 Pending
      createDummyPhase(planDir, 'phase-01-scaffold.md', 'Completed');
      createDummyPhase(planDir, 'phase-02-core.md', 'Pending');
      createDummyPhase(planDir, 'phase-03-api.md', 'Completed');
      createDummyPhase(planDir, 'phase-04-ui.md', 'Pending');
      createDummyPhase(planDir, 'phase-05-e2e.md', 'Pending');

      const planManager = new TelegramPlanManager({ workspaceRoots: [testTempDir] });
      const folders = planManager.discoverPlanFolders({ pendingOnly: false });
      const folder = folders.find((f) => f.folderPath.includes('batch-test-plan'))!;
      assert.ok(folder, 'Batch test folder must be discovered');
      assert.strictEqual(folder.phases.length, 5, 'Must have 5 phases in folder');
      planManager.cacheFolder(folder);

      const userId = 'user_batch_123';

      // 3.1 Initial session default
      const session = planManager.initSession(userId, folder);
      assert.strictEqual(session.folderId, folder.id);

      // 3.2 selectAllPhases -> should contain all 5 indices
      const allSelected = planManager.selectAllPhases(userId, folder.id);
      assert.strictEqual(allSelected.size, 5, 'selectAllPhases must select all 5 phases');
      assert.deepStrictEqual(
        Array.from(allSelected).sort((a, b) => a - b),
        [1, 2, 3, 4, 5],
        'All phase indices [1, 2, 3, 4, 5] must be in selection'
      );

      // 3.3 selectPendingPhasesOnly -> should only select indices 2, 4, 5
      const pendingSelected = planManager.selectPendingPhasesOnly(userId, folder.id);
      assert.strictEqual(pendingSelected.size, 3, 'selectPendingPhasesOnly must select only 3 pending phases');
      assert.deepStrictEqual(
        Array.from(pendingSelected).sort((a, b) => a - b),
        [2, 4, 5],
        'Pending phase indices [2, 4, 5] must be selected'
      );
      assert.ok(!pendingSelected.has(1), 'Completed Phase 1 must not be selected');
      assert.ok(!pendingSelected.has(3), 'Completed Phase 3 must not be selected');

      // 3.4 clearPhaseSelection -> should have 0 indices
      const cleared = planManager.clearPhaseSelection(userId, folder.id);
      assert.strictEqual(cleared.size, 0, 'clearPhaseSelection must result in 0 selected phases');

      // 3.5 togglePhaseSelection -> test individual toggle on & off
      const toggledOn = planManager.togglePhaseSelection(userId, folder.id, 2);
      assert.strictEqual(toggledOn.size, 1);
      assert.ok(toggledOn.has(2), 'Phase 2 should now be selected');

      const toggledOff = planManager.togglePhaseSelection(userId, folder.id, 2);
      assert.strictEqual(toggledOff.size, 0);
      assert.ok(!toggledOff.has(2), 'Phase 2 should now be deselected');

      console.log('  ✔ Suite 3 passed: All batch selection methods operate with 100% accuracy.\n');
    }

    // -------------------------------------------------------------------------
    // Suite 4: Keyboard Architecture (Row 0 Batch Row, 2-Column Grid, Dynamic Counter)
    // -------------------------------------------------------------------------
    console.log('[Suite 4] Verifying Keyboard Layout, Batch Row, 2-Column Grid, and Dynamic Counter...');
    {
      const planDir = path.join(testTempDir, 'plans', 'keyboard-layout-plan');
      createDummyPhase(planDir, 'phase-01-alpha.md', 'Pending');
      createDummyPhase(planDir, 'phase-02-beta.md', 'Completed');
      createDummyPhase(planDir, 'phase-03-gamma.md', 'Pending');
      createDummyPhase(planDir, 'phase-04-delta.md', 'Pending');

      const planManager = new TelegramPlanManager({ workspaceRoots: [testTempDir] });
      const folder = planManager.discoverPlanFolders({ pendingOnly: false }).find(
        (f) => f.folderPath.includes('keyboard-layout-plan')
      )!;
      assert.ok(folder);

      // Build keyboard with Phase 1 and 3 selected
      const selected = new Set<number>([1, 3]);
      const kb = planManager.buildManualPhaseSelectionKeyboard(folder, selected);
      const rows = kb.inline_keyboard;

      // Row 0: Batch Selection Row with 3 buttons
      assert.strictEqual(rows[0].length, 3, 'Row 0 must contain exactly 3 batch selection buttons');
      assert.strictEqual(rows[0][0].text, '[✅ Tất cả]');
      assert.strictEqual((rows[0][0] as any).callback_data, `p:bt:all:${folder.id}`);
      assert.strictEqual(rows[0][1].text, '[⚡ Chưa chạy]');
      assert.strictEqual((rows[0][1] as any).callback_data, `p:bt:pnd:${folder.id}`);
      assert.strictEqual(rows[0][2].text, '[⬜ Bỏ chọn]');
      assert.strictEqual((rows[0][2] as any).callback_data, `p:bt:clr:${folder.id}`);

      // Rows 1 and 2: Compact 2-column grid
      assert.strictEqual(rows[1].length, 2, 'Row 1 must contain 2 phase toggle buttons');
      assert.ok(rows[1][0].text.startsWith('[✅ P01:'), 'Phase 1 is selected so it must have ✅');
      assert.strictEqual((rows[1][0] as any).callback_data, `p:tog:${folder.id}:1`);

      assert.ok(rows[1][1].text.startsWith('[⬜ P02:'), 'Phase 2 is not selected so it must have ⬜');
      assert.strictEqual((rows[1][1] as any).callback_data, `p:tog:${folder.id}:2`);

      assert.strictEqual(rows[2].length, 2, 'Row 2 must contain 2 phase toggle buttons');
      assert.ok(rows[2][0].text.startsWith('[✅ P03:'), 'Phase 3 is selected so it must have ✅');
      assert.strictEqual((rows[2][0] as any).callback_data, `p:tog:${folder.id}:3`);

      assert.ok(rows[2][1].text.startsWith('[⬜ P04:'), 'Phase 4 is not selected so it must have ⬜');
      assert.strictEqual((rows[2][1] as any).callback_data, `p:tog:${folder.id}:4`);

      // Row 3: Dynamic Execution button
      assert.strictEqual(rows[3].length, 1);
      assert.strictEqual(rows[3][0].text, '[▶️ Bắt đầu (2/4 phase)]', 'Must display dynamic count (2/4 phase)');
      assert.strictEqual((rows[3][0] as any).callback_data, `p:run:man:${folder.id}`);

      // Row 4: Back navigation button
      assert.strictEqual(rows[4].length, 1);
      assert.strictEqual(rows[4][0].text, '[🔙 Quay lại]');
      assert.strictEqual((rows[4][0] as any).callback_data, `fld:${folder.id}`);

      console.log('  ✔ Suite 4 passed: Keyboard architecture, compact grid, and dynamic counter verified.\n');
    }

    // -------------------------------------------------------------------------
    // Suite 5: Feedback Strategy & Callback Queries (Silent, Toast, Alert)
    // -------------------------------------------------------------------------
    console.log('[Suite 5] Verifying Feedback Strategy & Callback Queries...');
    {
      const planDir = path.join(testTempDir, 'plans', 'callback-test-plan');
      createDummyPhase(planDir, 'phase-01-core.md', 'Completed');
      createDummyPhase(planDir, 'phase-02-auth.md', 'Pending');
      createDummyPhase(planDir, 'phase-03-api.md', 'Pending');

      let executedPhases: PhaseFile[] = [];
      let isRunningState = false;
      const mockOrchestrator = {
        isRunning: () => isRunningState,
        getCurrentPhase: () => (isRunningState ? { fileName: 'phase-02-auth.md' } : null),
        startCustomExecution: async (phases: PhaseFile[]) => {
          executedPhases = [...phases];
          return true;
        }
      };

      const planManager = new TelegramPlanManager({
        workspaceRoots: [testTempDir],
        orchestrator: mockOrchestrator
      });
      const folder = planManager.discoverPlanFolders({ pendingOnly: false }).find(
        (f) => f.folderPath.includes('callback-test-plan')
      )!;
      assert.ok(folder);
      planManager.cacheFolder(folder);

      const { bot, editedMessages, answeredCallbacks } = createMockBot();
      planManager.registerWithBot(bot);

      const userId = 777;

      // 5.1 Batch Selection callback: [✅ Tất cả]
      await (bot as any).handleUpdate({
        update_id: 201,
        callback_query: {
          id: 'cb_batch_all',
          from: { id: userId, is_bot: false, first_name: 'Tester' },
          data: `p:bt:all:${folder.id}`,
          message: {
            message_id: 50,
            date: Math.floor(Date.now() / 1000),
            chat: { id: userId, type: 'private' }
          }
        }
      });

      // Verify Toast feedback
      assert.ok(answeredCallbacks.length >= 1, 'Must answer batch callback');
      const toastAll = answeredCallbacks[answeredCallbacks.length - 1];
      assert.strictEqual(toastAll.text, '⚡ Đã chọn 3 phase', 'Toast must show 3 phases selected');
      assert.ok(!toastAll.show_alert, 'Toast must not be modal alert');
      assert.ok(editedMessages.length >= 1, 'Markup must be updated');

      // 5.2 Batch Selection callback: [⚡ Chưa chạy]
      await (bot as any).handleUpdate({
        update_id: 202,
        callback_query: {
          id: 'cb_batch_pnd',
          from: { id: userId, is_bot: false, first_name: 'Tester' },
          data: `p:bt:pnd:${folder.id}`,
          message: {
            message_id: 50,
            date: Math.floor(Date.now() / 1000),
            chat: { id: userId, type: 'private' }
          }
        }
      });

      const toastPnd = answeredCallbacks[answeredCallbacks.length - 1];
      assert.strictEqual(toastPnd.text, '⚡ Đã chọn 2 phase', 'Toast must show 2 pending phases selected');

      // 5.3 Batch Selection callback: [⬜ Bỏ chọn]
      await (bot as any).handleUpdate({
        update_id: 203,
        callback_query: {
          id: 'cb_batch_clr',
          from: { id: userId, is_bot: false, first_name: 'Tester' },
          data: `p:bt:clr:${folder.id}`,
          message: {
            message_id: 50,
            date: Math.floor(Date.now() / 1000),
            chat: { id: userId, type: 'private' }
          }
        }
      });

      const toastClr = answeredCallbacks[answeredCallbacks.length - 1];
      assert.strictEqual(toastClr.text, '⚡ Đã chọn 0 phase', 'Toast must show 0 phases selected');

      // 5.4 Toggle callback: Silent response
      await (bot as any).handleUpdate({
        update_id: 204,
        callback_query: {
          id: 'cb_tog_1',
          from: { id: userId, is_bot: false, first_name: 'Tester' },
          data: `p:tog:${folder.id}:2`,
          message: {
            message_id: 50,
            date: Math.floor(Date.now() / 1000),
            chat: { id: userId, type: 'private' }
          }
        }
      });

      const silentAck = answeredCallbacks[answeredCallbacks.length - 1];
      assert.strictEqual(silentAck.text, undefined, 'Toggle must be silent (no text)');
      assert.ok(!silentAck.show_alert, 'Toggle must not trigger alert popup');

      // 5.5 Backward-compatible alias toggle: tog:<folderId>:<index>
      await (bot as any).handleUpdate({
        update_id: 205,
        callback_query: {
          id: 'cb_tog_legacy',
          from: { id: userId, is_bot: false, first_name: 'Tester' },
          data: `tog:${folder.id}:3`,
          message: {
            message_id: 50,
            date: Math.floor(Date.now() / 1000),
            chat: { id: userId, type: 'private' }
          }
        }
      });
      const legacyAck = answeredCallbacks[answeredCallbacks.length - 1];
      assert.strictEqual(legacyAck.text, undefined, 'Legacy toggle alias must be recognized and silent');

      // 5.6 Zero Selection Guard: Block start when 0 phases selected
      planManager.clearPhaseSelection(userId, folder.id);
      await (bot as any).handleUpdate({
        update_id: 206,
        callback_query: {
          id: 'cb_run_zero',
          from: { id: userId, is_bot: false, first_name: 'Tester' },
          data: `p:run:man:${folder.id}`,
          message: {
            message_id: 50,
            date: Math.floor(Date.now() / 1000),
            chat: { id: userId, type: 'private' }
          }
        }
      });

      const zeroGuardAlert = answeredCallbacks[answeredCallbacks.length - 1];
      assert.strictEqual(
        zeroGuardAlert.text,
        '⚠️ Vui lòng chọn ít nhất 1 phase để thực thi!',
        'Zero Selection Guard must display exact warning'
      );
      assert.strictEqual(zeroGuardAlert.show_alert, true, 'Zero Selection Guard must be a modal alert');
      assert.strictEqual(executedPhases.length, 0, 'No execution must be dispatched when 0 phases selected');

      // 5.7 Legacy start:manual:<folderId> alias with Zero Selection Guard
      await (bot as any).handleUpdate({
        update_id: 207,
        callback_query: {
          id: 'cb_run_legacy_zero',
          from: { id: userId, is_bot: false, first_name: 'Tester' },
          data: `start:manual:${folder.id}`,
          message: {
            message_id: 50,
            date: Math.floor(Date.now() / 1000),
            chat: { id: userId, type: 'private' }
          }
        }
      });
      const legacyZeroGuardAlert = answeredCallbacks[answeredCallbacks.length - 1];
      assert.strictEqual(
        legacyZeroGuardAlert.text,
        '⚠️ Vui lòng chọn ít nhất 1 phase để thực thi!',
        'Legacy start:manual must trigger Zero Selection Guard'
      );

      // 5.8 Concurrency Guard: Block start when orchestrator is already running
      isRunningState = true;
      planManager.selectAllPhases(userId, folder.id);
      await (bot as any).handleUpdate({
        update_id: 208,
        callback_query: {
          id: 'cb_run_concurrency',
          from: { id: userId, is_bot: false, first_name: 'Tester' },
          data: `p:run:man:${folder.id}`,
          message: {
            message_id: 50,
            date: Math.floor(Date.now() / 1000),
            chat: { id: userId, type: 'private' }
          }
        }
      });

      const concurrencyAlert = answeredCallbacks[answeredCallbacks.length - 1];
      assert.strictEqual(
        concurrencyAlert.text,
        '⚠️ Đang có kế hoạch khác đang chạy!',
        'Concurrency Guard must display warning'
      );
      assert.strictEqual(concurrencyAlert.show_alert, true, 'Concurrency Guard must be a modal alert');

      // 5.9 Normal Execution Dispatch when Idle and phases selected
      isRunningState = false;
      await (bot as any).handleUpdate({
        update_id: 209,
        callback_query: {
          id: 'cb_run_success',
          from: { id: userId, is_bot: false, first_name: 'Tester' },
          data: `p:run:man:${folder.id}`,
          message: {
            message_id: 50,
            date: Math.floor(Date.now() / 1000),
            chat: { id: userId, type: 'private' }
          }
        }
      });

      assert.strictEqual(executedPhases.length, 3, 'Must successfully dispatch all 3 selected phases');

      console.log('  ✔ Suite 5 passed: Silent, Toast, and Alert feedback tiers completely verified.\n');
    }

    // -------------------------------------------------------------------------
    // Suite 6: Strict 64-Byte Callback Data Verification
    // -------------------------------------------------------------------------
    console.log('[Suite 6] Verifying 100% callback_data <= 64 Bytes...');
    {
      const planDir = path.join(testTempDir, 'plans', 'callback-size-stress-plan');
      for (let i = 1; i <= 25; i++) {
        const pad = String(i).padStart(2, '0');
        createDummyPhase(planDir, `phase-${pad}-very-long-feature-name-for-testing.md`, i % 2 === 0 ? 'Completed' : 'Pending');
      }

      const planManager = new TelegramPlanManager({ workspaceRoots: [testTempDir] });
      const folder = planManager.discoverPlanFolders({ pendingOnly: false }).find(
        (f) => f.folderPath.includes('callback-size-stress-plan')
      )!;
      assert.ok(folder);

      const kb = planManager.buildManualPhaseSelectionKeyboard(folder, new Set<number>([1, 2, 3]));
      let buttonCount = 0;
      for (const row of kb.inline_keyboard) {
        for (const btn of row) {
          buttonCount++;
          const data = (btn as any).callback_data || '';
          const byteLen = Buffer.byteLength(data, 'utf8');
          assert.ok(
            byteLen <= 64,
            `Button "${btn.text}" callback_data "${data}" exceeds 64 bytes (${byteLen} bytes)`
          );
        }
      }

      assert.ok(buttonCount >= 28, 'Must verify all buttons including batch row, grid, and navigation');
      console.log(`  ✔ Suite 6 passed: Verified ${buttonCount} buttons, all <= 64 bytes.\n`);
    }

    // -------------------------------------------------------------------------
    // Suite 7: Response Latency Benchmarking (< 30ms requirement)
    // -------------------------------------------------------------------------
    console.log('[Suite 7] Benchmarking In-Memory Operation Latency (< 30ms)...');
    {
      const planManager = new TelegramPlanManager({ workspaceRoots: [testTempDir] });
      const folder = planManager.discoverPlanFolders({ pendingOnly: false })[0];
      assert.ok(folder);
      planManager.cacheFolder(folder);

      const userId = 'bench_user';
      const iterations = 1000;
      const t0 = Date.now();

      for (let i = 0; i < iterations; i++) {
        planManager.togglePhaseSelection(userId, folder.id, (i % folder.phases.length) + 1);
        const sel = planManager.selectAllPhases(userId, folder.id);
        planManager.buildManualPhaseSelectionKeyboard(folder, sel);
      }

      const totalMs = Date.now() - t0;
      const avgMs = totalMs / iterations;
      assert.ok(avgMs < 30, `Average latency (${avgMs.toFixed(3)}ms) must be < 30ms`);

      console.log(`  ✔ Suite 7 passed: Average latency ${avgMs.toFixed(3)}ms (< 30ms requirement).\n`);
    }

    console.log('================================================================');
    console.log(' 🎉 ALL PHASE 03 TESTS PASSED SUCCESSFULLY! (100% Verified)     ');
    console.log('================================================================');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

// Run tests
runPhase03SmartPhasePickerTest().catch((err) => {
  console.error('❌ Phase 03 Test failed with error:', err);
  process.exit(1);
});
