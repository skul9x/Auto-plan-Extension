// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (_section: string) => ({
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
import { Bot } from 'grammy';
import {
  TelegramBridge,
  formatWorkflowRecipeUrl,
  resolveWorkflowFilePath,
  formatWorkflowRecipePrompt,
  parseWorkflowCommand
} from '../telegramBridge';
import { PromptDispatcher, DispatchResult } from '../promptDispatcher';
import { DebugLogger } from '../debugLogger';

/**
 * Creates a mock GrammY bot initialized with offline botInfo and message capturing.
 */
function createMockBot(token: string = '123456:TEST_TOKEN'): {
  bot: Bot;
  sentMessages: any[];
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

  bot.api.config.use(async (_prev, method, payload) => {
    if (method === 'sendMessage') {
      const anyPayload = payload as any;
      sentMessages.push(anyPayload);
      return {
        ok: true,
        result: {
          message_id: Math.floor(Math.random() * 10000) + 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id, type: 'private', first_name: 'Chat' },
          text: anyPayload.text
        }
      } as any;
    }
    return { ok: true, result: {} } as any;
  });

  return { bot, sentMessages };
}

async function runTelegramRecipeWorkflowDispatchTest() {
  console.log('================================================================');
  console.log(' Antigravity Native Recipe Workflow Dispatch & Formatting Tests');
  console.log('================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-tg-recipe-'));
  const testRegistryPath = path.join(testTempDir, 'ag-autoplan-ports.json');
  const testLogger = new DebugLogger(100);
  let bridge: TelegramBridge | null = null;

  try {
    // ------------------------------------------------------------------------
    // TEST SUITE 1: formatWorkflowRecipeUrl Cross-Platform URI Generation
    // ------------------------------------------------------------------------
    console.log('[Suite 1] Recipe URL Generation & Cross-Platform Encoding...');

    // 1.1 Windows path with backslashes
    const winBackslash = 'C:\\Users\\Admin\\.gemini\\config\\global_workflows\\code.md';
    const winBackslashUrl = formatWorkflowRecipeUrl(winBackslash);
    assert.strictEqual(
      winBackslashUrl,
      'recipe;file:///c%3A/Users/Admin/.gemini/config/global_workflows/code.md',
      'Windows backslash path must be converted to lowercase drive with %3A and forward slashes'
    );
    console.log('  ✓ Windows backslash path converted to: ' + winBackslashUrl);

    // 1.2 Windows path with forward slashes
    const winSlash = 'C:/Users/Admin/.gemini/config/global_workflows/code.md';
    const winSlashUrl = formatWorkflowRecipeUrl(winSlash);
    assert.strictEqual(
      winSlashUrl,
      'recipe;file:///c%3A/Users/Admin/.gemini/config/global_workflows/code.md',
      'Windows forward slash path must format identically'
    );
    console.log('  ✓ Windows forward slash path formatted identically');

    // 1.3 Unix absolute path
    const unixPath = '/home/admin/.gemini/config/global_workflows/code.md';
    const unixUrl = formatWorkflowRecipeUrl(unixPath);
    assert.strictEqual(
      unixUrl,
      'recipe;file:///home/admin/.gemini/config/global_workflows/code.md',
      'Unix absolute path must retain triple slash prefix'
    );
    console.log('  ✓ Unix absolute path formatted to: ' + unixUrl);

    // 1.4 Invalid / empty input handling
    assert.strictEqual(formatWorkflowRecipeUrl(''), '');
    assert.strictEqual(formatWorkflowRecipeUrl(null as any), '');
    console.log('  ✓ Empty/invalid path safely handled with empty string fallback\n');

    // ------------------------------------------------------------------------
    // TEST SUITE 2: resolveWorkflowFilePath Local & Global Search Hierarchy
    // ------------------------------------------------------------------------
    console.log('[Suite 2] Workflow File Path Resolution & Naming Variants...');

    // 2.1 Resolving known global workflow files
    const globalCodePath = resolveWorkflowFilePath('code');
    assert.ok(globalCodePath, 'Must resolve global code.md');
    assert.ok(globalCodePath.endsWith('code.md'), 'Path must end with code.md');
    console.log('  ✓ Global code resolved to: ' + globalCodePath);

    // 2.2 Resolving underscore vs hyphen variant: save_brain vs save-brain
    const saveBrainFromUnderscore = resolveWorkflowFilePath('save_brain');
    const saveBrainFromHyphen = resolveWorkflowFilePath('save-brain');
    assert.ok(saveBrainFromUnderscore, 'Must resolve save_brain');
    assert.ok(saveBrainFromHyphen, 'Must resolve save-brain');
    assert.strictEqual(
      saveBrainFromUnderscore,
      saveBrainFromHyphen,
      'save_brain and save-brain must resolve to the same underlying file on disk'
    );
    console.log('  ✓ save_brain and save-brain resolve symmetrically to: ' + path.basename(saveBrainFromUnderscore));

    // 2.3 Resolving awf_update vs awf-update (file is awf-update.md)
    const awfUpdateResolved = resolveWorkflowFilePath('awf_update');
    assert.ok(awfUpdateResolved, 'awf_update must resolve to awf-update.md on disk');
    assert.ok(awfUpdateResolved.endsWith('awf-update.md'), 'Must find awf-update.md');
    console.log('  ✓ awf_update mapped to: ' + path.basename(awfUpdateResolved));

    // 2.4 Workspace-local override resolution
    const mockWorkspace = path.join(testTempDir, 'workspace');
    const localWorkflowsDir = path.join(mockWorkspace, '.agent', 'workflows');
    fs.mkdirSync(localWorkflowsDir, { recursive: true });
    const localCodeFile = path.join(localWorkflowsDir, 'code.md');
    fs.writeFileSync(localCodeFile, '# Local Workspace Custom Code Workflow', 'utf8');

    const resolvedLocal = resolveWorkflowFilePath('code', mockWorkspace);
    assert.strictEqual(
      resolvedLocal,
      localCodeFile,
      'Workspace local workflow must take precedence over global workflow'
    );
    console.log('  ✓ Local workspace workflow takes precedence over global workflow');

    // 2.5 Nonexistent workflow returns null
    const nonexistent = resolveWorkflowFilePath('nonexistent_custom_cmd');
    assert.strictEqual(nonexistent, null, 'Nonexistent command must return null');
    console.log('  ✓ Nonexistent command returns null gracefully\n');

    // ------------------------------------------------------------------------
    // TEST SUITE 3: formatWorkflowRecipePrompt Formatting & Argument Handling
    // ------------------------------------------------------------------------
    console.log('[Suite 3] Recipe Mention Markdown Prompt Formatting...');

    // 3.1 Basic command without args
    const codePrompt = formatWorkflowRecipePrompt('code');
    assert.ok(codePrompt.startsWith('[code](recipe;file:///'), 'Prompt must start with [code](recipe;file:///');
    assert.ok(codePrompt.endsWith('code.md)'), 'Prompt must end with code.md)');
    console.log('  ✓ /code formatted as: ' + codePrompt);

    // 3.2 Command with trailing arguments
    const codeWithArgs = formatWorkflowRecipePrompt('code', 'phase-01: setup database models');
    assert.ok(
      codeWithArgs.includes('(recipe;file:///') && codeWithArgs.endsWith('code.md) phase-01: setup database models'),
      'Prompt must append arguments cleanly with space separation'
    );
    console.log('  ✓ /code with arguments formatted as: ' + codeWithArgs);

    // 3.3 Underscore workflow formatting (save_brain)
    const saveBrainPrompt = formatWorkflowRecipePrompt('save_brain', 'daily standup notes');
    assert.ok(
      saveBrainPrompt.startsWith('[save_brain](recipe;file:///') && saveBrainPrompt.endsWith('daily standup notes'),
      'save_brain label and arguments must be preserved'
    );
    console.log('  ✓ /save_brain with arguments formatted as: ' + saveBrainPrompt);

    // 3.4 Fallback when file is absent
    const fallbackPrompt = formatWorkflowRecipePrompt('nonexistent_action', 'arg1 arg2');
    assert.strictEqual(
      fallbackPrompt,
      '/nonexistent_action arg1 arg2',
      'Absent workflow file must fallback to standard slash command text'
    );
    console.log('  ✓ Absent workflow file falls back gracefully to: ' + fallbackPrompt + '\n');

    // ------------------------------------------------------------------------
    // TEST SUITE 4: parseWorkflowCommand Integration
    // ------------------------------------------------------------------------
    console.log('[Suite 4] parseWorkflowCommand returns recipePrompt...');

    const parsed = parseWorkflowCommand('/code phase-02 --strict');
    assert.ok(parsed, 'parseWorkflowCommand must succeed');
    assert.strictEqual(parsed.command, 'code');
    assert.strictEqual(parsed.args, 'phase-02 --strict');
    assert.strictEqual(parsed.normalizedPrompt, '/code phase-02 --strict');
    assert.ok(parsed.recipePrompt.startsWith('[code](recipe;file:///'));
    assert.ok(parsed.recipePrompt.endsWith('phase-02 --strict'));
    console.log('  ✓ parseWorkflowCommand populates recipePrompt while keeping normalizedPrompt intact\n');

    // ------------------------------------------------------------------------
    // TEST SUITE 5: TelegramBridge End-to-End Pipeline Dispatch
    // ------------------------------------------------------------------------
    console.log('[Suite 5] TelegramBridge End-to-End Dispatch Integration...');

    const dispatchedPrompts: Array<{ text: string; options: any }> = [];
    const mockPromptDispatcher: any = {
      dispatchPrompt: async (text: string, options?: any): Promise<DispatchResult> => {
        dispatchedPrompts.push({ text, options });
        return {
          success: true,
          tier: 'domBridge',
          durationMs: 42,
          status: 'success'
        };
      }
    };

    const { bot: testBot, sentMessages: testSent } = createMockBot();
    const authorizedUserId = 12345678;

    // Default configuration: formatWorkflowRecipes: true
    bridge = new TelegramBridge({
      token: '123456:TEST_TOKEN',
      enabled: true,
      allowedUsers: [authorizedUserId],
      registryPath: testRegistryPath,
      logger: testLogger,
      botFactory: () => testBot,
      promptDispatcher: mockPromptDispatcher,
      formatWorkflowRecipes: true
    });

    bridge.initBot();
    await testBot.init();

    // 5.1 Send /code via Telegram bot update
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 501,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'DevUser' },
        text: '/code phase-01: initialize schema',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      }
    } as any);

    assert.strictEqual(dispatchedPrompts.length, 1, 'Expected prompt to be dispatched');
    assert.ok(
      dispatchedPrompts[0].text.startsWith('[code](recipe;file:///'),
      'Dispatched prompt must be formatted as Antigravity Recipe Mention'
    );
    assert.ok(
      dispatchedPrompts[0].text.endsWith('phase-01: initialize schema'),
      'Dispatched prompt must preserve trailing arguments'
    );
    assert.strictEqual(
      dispatchedPrompts[0].options?.openNewConversation,
      false,
      'Must maintain conversation continuity'
    );
    assert.ok(
      testSent.some((m) => m.text && m.text.includes('⏳ Prompt sent to Antigravity IDE...')),
      'Must acknowledge prompt receipt to user on Telegram'
    );
    console.log('  ✓ /code dispatched as Recipe Mention: ' + dispatchedPrompts[0].text);

    // 5.2 Send /save_brain with arguments
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 502,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'DevUser' },
        text: '/save_brain architecture decision record',
        entities: [{ type: 'bot_command', offset: 0, length: 11 }]
      }
    } as any);

    assert.strictEqual(dispatchedPrompts.length, 1);
    assert.ok(
      dispatchedPrompts[0].text.startsWith('[save_brain](recipe;file:///'),
      'Dispatched prompt must format save_brain as Recipe Mention'
    );
    assert.ok(
      dispatchedPrompts[0].text.endsWith('architecture decision record'),
      'Trailing arguments preserved'
    );
    console.log('  ✓ /save_brain dispatched as Recipe Mention: ' + dispatchedPrompts[0].text);

    // 5.3 Test with formatWorkflowRecipes: false (plain text legacy mode)
    bridge.applyOptions({ formatWorkflowRecipes: false });
    dispatchedPrompts.length = 0;

    await testBot.handleUpdate({
      update_id: 503,
      message: {
        message_id: 3,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'DevUser' },
        text: '/code standalone',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      }
    } as any);

    assert.strictEqual(dispatchedPrompts.length, 1);
    assert.strictEqual(
      dispatchedPrompts[0].text,
      '/code standalone',
      'When formatWorkflowRecipes is false, raw normalized slash command must be dispatched'
    );
    console.log('  ✓ formatWorkflowRecipes: false preserves raw normalized slash command\n');

    console.log('================================================================');
    console.log(' ALL Antigravity Native Recipe Workflow Dispatch Tests PASSED!');
    console.log('================================================================\n');
  } finally {
    if (bridge) {
      await bridge.stop().catch(() => {});
    }
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

runTelegramRecipeWorkflowDispatchTest().catch((err) => {
  console.error('\n❌ Recipe Workflow Dispatch Test Suite Failed:', err);
  process.exit(1);
});
