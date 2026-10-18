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
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Bot } from 'grammy';
import { getConfig, getTelegramConfig, DEFAULT_CONFIG } from '../config';
import { TelegramBridge, INTERNAL_BOT_COMMANDS } from '../telegramBridge';
import { TelegramPlanManager } from '../telegramPlanManager';
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

async function runPhase01TelegramFreeChatGatingTest(): Promise<void> {
  console.log('================================================================');
  console.log(' Phase 01: Core Configuration & Telegram Free-Text Silent Drop Gating Test');
  console.log('================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-tg-phase01-gating-'));
  const testRegistryPath = path.join(testTempDir, 'ag-autoplan-ports.json');
  const testPlansDir = path.join(testTempDir, 'plans', 'sample-plan');
  fs.mkdirSync(testPlansDir, { recursive: true });
  fs.writeFileSync(
    path.join(testPlansDir, 'plan.md'),
    '# Sample Plan\nStatus: 📋 Planned\n## Phases\n- Phase 01: Test Phase\n'
  );

  const testLogger = new DebugLogger(200);
  const authorizedUserId = 778899;

  try {
    // ------------------------------------------------------------------------
    // SUITE 1: Core Configuration Resolution (AutoPlanConfig & TelegramConfig)
    // ------------------------------------------------------------------------
    console.log('[Suite 1] Core Configuration & Defaults Resolution...');

    // 1.1 Verify default configuration values
    assert.strictEqual(
      DEFAULT_CONFIG.telegramAllowFreeChat,
      true,
      'DEFAULT_CONFIG.telegramAllowFreeChat must default to true'
    );
    const initialConfig = getConfig();
    assert.strictEqual(
      initialConfig.telegramAllowFreeChat,
      true,
      'getConfig().telegramAllowFreeChat must resolve to true by default'
    );
    const initialTgConfig = getTelegramConfig();
    assert.strictEqual(
      initialTgConfig.allowFreeChat,
      true,
      'getTelegramConfig().allowFreeChat must resolve to true by default'
    );
    console.log('  ✓ Default configuration correctly enables allowFreeChat');

    // 1.2 Verify workspace/global configuration resolution when disabled
    mockConfigStore['telegram.allowFreeChat'] = false;
    const disabledTgConfig = getTelegramConfig();
    assert.strictEqual(
      disabledTgConfig.allowFreeChat,
      false,
      'getTelegramConfig().allowFreeChat must resolve to false when overridden'
    );

    // 1.3 Verify resolution when re-enabled
    mockConfigStore['telegram.allowFreeChat'] = true;
    const reenabledTgConfig = getTelegramConfig();
    assert.strictEqual(
      reenabledTgConfig.allowFreeChat,
      true,
      'getTelegramConfig().allowFreeChat must resolve to true when configured'
    );
    console.log('  ✓ Workspace configuration overrides successfully resolve in getTelegramConfig()');

    // ------------------------------------------------------------------------
    // SUITE 2: TelegramBridge Lifecycle, Options & Dynamic Config Reloading
    // ------------------------------------------------------------------------
    console.log('\n[Suite 2] TelegramBridge Options & Dynamic Config Reloading...');

    const dispatchedPrompts: Array<{ text: string; options: any }> = [];
    const mockPromptDispatcher: PromptDispatcher = {
      dispatchPrompt: async (text: string, options?: any): Promise<DispatchResult> => {
        dispatchedPrompts.push({ text, options });
        return {
          success: true,
          tier: 'domBridge',
          durationMs: 45,
          status: 'success'
        };
      }
    } as any;

    const planManager = new TelegramPlanManager({
      defaultPlanFolder: path.join(testTempDir, 'plans'),
      logger: testLogger
    });

    // 2.1 Explicit options in constructor
    const bridgeDisabled = new TelegramBridge({
      token: '123456:TEST_TOKEN',
      enabled: true,
      allowedUsers: [authorizedUserId],
      registryPath: testRegistryPath,
      logger: testLogger,
      allowFreeChat: false,
      promptDispatcher: mockPromptDispatcher,
      planManager
    });
    assert.strictEqual(
      bridgeDisabled.getAllowFreeChat(),
      false,
      'Bridge instance must honor allowFreeChat: false from options'
    );
    console.log('  ✓ TelegramBridge constructor honors allowFreeChat option');

    // 2.2 Dynamic applyOptions
    bridgeDisabled.applyOptions({ allowFreeChat: true });
    assert.strictEqual(
      bridgeDisabled.getAllowFreeChat(),
      true,
      'applyOptions must update allowFreeChat'
    );
    console.log('  ✓ TelegramBridge.applyOptions updates allowFreeChat dynamically');

    // 2.3 reloadConfig reflects underlying config
    mockConfigStore['telegram.allowFreeChat'] = false;
    await bridgeDisabled.reloadConfig();
    assert.strictEqual(
      bridgeDisabled.getAllowFreeChat(),
      false,
      'reloadConfig must sync allowFreeChat: false from configuration'
    );
    console.log('  ✓ TelegramBridge.reloadConfig synchronizes allowFreeChat from config');

    // ------------------------------------------------------------------------
    // SUITE 3: Silent Drop Gating when allowFreeChat = false
    // ------------------------------------------------------------------------
    console.log('\n[Suite 3] Silent Drop Gating when allowFreeChat = false...');

    const { bot: mockBotGated, sentMessages: sentGated } = createMockBot();
    const bridgeGated = new TelegramBridge({
      token: '123456:TEST_TOKEN',
      enabled: true,
      allowedUsers: [authorizedUserId],
      registryPath: testRegistryPath,
      logger: testLogger,
      allowFreeChat: false,
      botFactory: () => mockBotGated,
      promptDispatcher: mockPromptDispatcher,
      planManager
    });

    bridgeGated.initBot();
    await mockBotGated.init();

    // 3.1 Free-form text prompt MUST be silently dropped:
    // - 0 replies sent to Telegram
    // - 0 calls to PromptDispatcher
    // - Debug log recorded
    dispatchedPrompts.length = 0;
    sentGated.length = 0;
    testLogger.clear();

    await mockBotGated.handleUpdate({
      update_id: 101,
      message: {
        message_id: 10,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthorizedTester' },
        text: 'Can you implement authentication with JWT and refresh tokens?'
      }
    } as any);

    assert.strictEqual(
      sentGated.length,
      0,
      'Silent drop: No reply or acknowledgment must be sent to Telegram'
    );
    assert.strictEqual(
      dispatchedPrompts.length,
      0,
      'Silent drop: No prompt must be dispatched to Antigravity IDE'
    );
    const dropLogs = testLogger.getEntries().filter((e) =>
      e.message.includes('Silent dropping free-text message') &&
      e.message.includes('allowFreeChat is false')
    );
    assert.strictEqual(
      dropLogs.length,
      1,
      'Must record debug log for silent dropped message'
    );
    console.log('  ✓ Free-form text is silently dropped (0 Telegram messages, 0 IDE dispatches, debug log verified)');

    // 3.2 Unrecognized slash command MUST also be silently dropped
    dispatchedPrompts.length = 0;
    sentGated.length = 0;

    await mockBotGated.handleUpdate({
      update_id: 102,
      message: {
        message_id: 11,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthorizedTester' },
        text: '/unknown_tool do something',
        entities: [{ type: 'bot_command', offset: 0, length: 13 }]
      }
    } as any);

    assert.strictEqual(
      sentGated.length,
      0,
      'Unrecognized command must be silently dropped without Telegram reply'
    );
    assert.strictEqual(
      dispatchedPrompts.length,
      0,
      'Unrecognized command must not be dispatched to PromptDispatcher'
    );
    console.log('  ✓ Unrecognized slash command is silently dropped when free chat is disabled');

    // 3.3 Slash internal command (/plan_status) MUST execute normally
    dispatchedPrompts.length = 0;
    sentGated.length = 0;

    await mockBotGated.handleUpdate({
      update_id: 103,
      message: {
        message_id: 12,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthorizedTester' },
        text: '/plan_status',
        entities: [{ type: 'bot_command', offset: 0, length: 12 }]
      }
    } as any);

    assert.strictEqual(
      sentGated.length,
      1,
      'Internal command /plan_status must send reply to Telegram'
    );
    assert.strictEqual(
      dispatchedPrompts.length,
      0,
      'Internal command /plan_status is handled internally, not dispatched to PromptDispatcher'
    );
    assert(
      sentGated[0].text.includes('Bridge Status') || sentGated[0].text.includes('Auto-Plan'),
      'Reply must contain plan/bridge status text'
    );
    console.log('  ✓ Internal command /plan_status executes normally regardless of allowFreeChat');

    // 3.4 Slash internal command (/plans) MUST execute normally
    dispatchedPrompts.length = 0;
    sentGated.length = 0;

    await mockBotGated.handleUpdate({
      update_id: 104,
      message: {
        message_id: 13,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthorizedTester' },
        text: '/plans',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    } as any);

    assert.strictEqual(
      sentGated.length,
      1,
      'Internal command /plans must send reply to Telegram'
    );
    console.log('  ✓ Internal command /plans executes normally regardless of allowFreeChat');

    // 3.5 AWF Workflow command (/code refactor the parser) MUST execute and dispatch normally
    dispatchedPrompts.length = 0;
    sentGated.length = 0;

    await mockBotGated.handleUpdate({
      update_id: 105,
      message: {
        message_id: 14,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthorizedTester' },
        text: '/code refactor the parser',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      }
    } as any);

    assert.strictEqual(
      dispatchedPrompts.length,
      1,
      'Workflow command /code must be dispatched to PromptDispatcher'
    );
    assert.strictEqual(
      dispatchedPrompts[0].text,
      '/code refactor the parser',
      'Dispatched prompt must match normalized workflow command'
    );
    assert(
      sentGated.some((m) => m.text && m.text.includes('⏳ Prompt sent to Antigravity IDE...')),
      'Must send acknowledgment reply for workflow command'
    );
    console.log('  ✓ Workflow command /code executes and dispatches normally when allowFreeChat = false');

    // 3.6 AWF Workflow command (/recap) without arguments MUST execute and dispatch normally
    dispatchedPrompts.length = 0;
    sentGated.length = 0;

    await mockBotGated.handleUpdate({
      update_id: 106,
      message: {
        message_id: 15,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthorizedTester' },
        text: '/recap',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    } as any);

    assert.strictEqual(
      dispatchedPrompts.length,
      1,
      'Workflow command /recap must be dispatched to PromptDispatcher'
    );
    assert.strictEqual(
      dispatchedPrompts[0].text,
      '/recap',
      'Dispatched prompt must match /recap'
    );
    console.log('  ✓ Workflow command /recap executes and dispatches normally when allowFreeChat = false');

    // ------------------------------------------------------------------------
    // SUITE 4: Prompt Dispatching when allowFreeChat = true
    // ------------------------------------------------------------------------
    console.log('\n[Suite 4] Full Text Dispatching when allowFreeChat = true...');

    const { bot: mockBotEnabled, sentMessages: sentEnabled } = createMockBot();
    const bridgeEnabled = new TelegramBridge({
      token: '123456:TEST_TOKEN',
      enabled: true,
      allowedUsers: [authorizedUserId],
      registryPath: testRegistryPath,
      logger: testLogger,
      allowFreeChat: true,
      botFactory: () => mockBotEnabled,
      promptDispatcher: mockPromptDispatcher,
      planManager
    });

    bridgeEnabled.initBot();
    await mockBotEnabled.init();

    // 4.1 Free-form text message is dispatched and acknowledged
    dispatchedPrompts.length = 0;
    sentEnabled.length = 0;

    await mockBotEnabled.handleUpdate({
      update_id: 201,
      message: {
        message_id: 20,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthorizedTester' },
        text: 'Write a unit test for user registration'
      }
    } as any);

    assert.strictEqual(
      dispatchedPrompts.length,
      1,
      'Prompt must be dispatched to PromptDispatcher when allowFreeChat = true'
    );
    assert.strictEqual(
      dispatchedPrompts[0].text,
      'Write a unit test for user registration'
    );
    assert.strictEqual(
      dispatchedPrompts[0].options?.openNewConversation,
      false,
      'Must maintain conversation continuity'
    );
    assert(
      sentEnabled.some((m) => m.text && m.text.includes('⏳ Prompt sent to Antigravity IDE...')),
      'Must send acknowledgment message to Telegram'
    );
    console.log('  ✓ Free-form text message dispatched and acknowledged when allowFreeChat = true');

    // 4.2 Workflow command also continues to work when allowFreeChat = true
    dispatchedPrompts.length = 0;
    sentEnabled.length = 0;

    await mockBotEnabled.handleUpdate({
      update_id: 202,
      message: {
        message_id: 21,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthorizedTester' },
        text: '/brainstorm new dashboard features',
        entities: [{ type: 'bot_command', offset: 0, length: 11 }]
      }
    } as any);

    assert.strictEqual(
      dispatchedPrompts.length,
      1,
      'Workflow command must be dispatched'
    );
    assert.strictEqual(
      dispatchedPrompts[0].text,
      '/brainstorm new dashboard features'
    );
    console.log('  ✓ Workflow command dispatches cleanly when allowFreeChat = true');

    console.log('\n================================================================');
    console.log(' ✅ ALL PHASE 01 TESTS PASSED SUCCESSFULLY (100% VERIFIED)');
    console.log('================================================================');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase01TelegramFreeChatGatingTest().catch((err) => {
  console.error('❌ Phase 01 Test Failed:', err);
  process.exit(1);
});
