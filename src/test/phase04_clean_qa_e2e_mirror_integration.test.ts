// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockConfigValues: Record<string, any> = {
  'telegram.enableChatMirror': true,
  'telegram.mirrorIncludePcPrompts': true,
  'telegram.chatMirrorPrefix': '🤖 Antigravity:',
  telegramEnabled: true,
  telegramBotToken: 'mock_token_123',
  telegramAllowedUsers: [10001],
  telegramThrottleMs: 2500
};

let configChangeListeners: ((e: any) => void)[] = [];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (_section: string) => ({
          get: (key: string, defaultValue: any) => {
            return mockConfigValues[key] !== undefined ? mockConfigValues[key] : defaultValue;
          },
          update: async (key: string, val: any) => {
            mockConfigValues[key] = val;
          }
        }),
        onDidChangeConfiguration: (listener: (e: any) => void) => {
          configChangeListeners.push(listener);
          return {
            dispose: () => {
              const idx = configChangeListeners.indexOf(listener);
              if (idx >= 0) {
                configChangeListeners.splice(idx, 1);
              }
            }
          };
        },
        workspaceFolders: [{ name: 'TestWorkspace', uri: { fsPath: '/test/workspace' } }],
        name: 'TestWorkspace'
      },
      window: {
        showWarningMessage: () => {},
        showInformationMessage: () => {},
        showErrorMessage: () => {}
      },
      commands: {
        executeCommand: async () => {}
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  TelegramChatMirror,
  DEFAULT_AI_RESPONSE_HEADER,
  deliverChunkedResponse
} from '../telegramChatMirror';
import { Bot } from 'grammy';
import {
  TranscriptTailEngine,
  UserInputEvent,
  PlannerResponseEvent,
  AgentActivityEvent
} from '../transcriptTailEngine';
import { PromptOriginTracker } from '../promptOriginTracker';
import { TypingActionManager } from '../typingActionManager';
import { TelegramBridge } from '../telegramBridge';
import { getTelegramConfig } from '../config';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface SentMessageLog {
  chatId: string | number;
  text: string;
  options?: any;
}

interface ActionLog {
  chatId: string | number;
  action: string;
}

function createMockBot(token: string = '123456:TEST_TOKEN') {
  const sentMessages: SentMessageLog[] = [];
  const sentActions: ActionLog[] = [];

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

  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === 'sendMessage') {
      const anyPayload = payload as any;
      sentMessages.push({
        chatId: anyPayload.chat_id,
        text: anyPayload.text,
        options: anyPayload
      });
      return {
        ok: true,
        result: {
          message_id: sentMessages.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id, type: 'private', first_name: 'Chat' },
          text: anyPayload.text
        }
      } as any;
    }
    if (method === 'sendChatAction') {
      const anyPayload = payload as any;
      sentActions.push({
        chatId: anyPayload.chat_id,
        action: anyPayload.action
      });
      return { ok: true, result: true } as any;
    }
    return { ok: true, result: {} } as any;
  });

  (bot as any).sentMessages = sentMessages;
  (bot as any).sentActions = sentActions;
  (bot as any).clearLogs = () => {
    sentMessages.length = 0;
    sentActions.length = 0;
  };

  return bot as any;
}

async function runPhase04CleanQaMirrorIntegrationTests() {
  console.log('=== Running Phase 04: Full End-to-End Chat Mirror Integration & Configuration Tests ===\n');

  const tmpTestDir = path.join(os.tmpdir(), `phase04_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(tmpTestDir, { recursive: true });

  try {
    // =========================================================================
    // Test 1: PC-originated Prompts Complete E2E Flow
    // =========================================================================
    console.log('[Test 1] Verifying complete flow for PC-originated prompts...');
    const bot1 = createMockBot();
    const tracker1 = new PromptOriginTracker({ autoPrune: false });
    const tailEngine1 = new TranscriptTailEngine({ brainDir: tmpTestDir });

    const mirror1 = new TelegramChatMirror({
      bot: bot1,
      allowedUsers: [10001],
      promptOriginTracker: tracker1,
      tailEngine: tailEngine1,
      minChunkDelayMs: 0
    });

    // 1.1: userInput event triggered with PC prompt
    const pcPromptText = 'Implement JWT authentication with refresh tokens';
    tailEngine1.emit('userInput', {
      convId: 'conv_1',
      prompt: pcPromptText,
      stepIndex: 1,
      timestamp: Date.now()
    });

    // Allow event loop ticks for async handlers
    await sleep(20);

    // 1.2: Telegram receives 💻 You (on PC): ...
    assert.strictEqual(bot1.sentMessages.length, 1, '1A: Telegram must receive exactly 1 message for PC prompt');
    assert.strictEqual(bot1.sentMessages[0].chatId, 10001, '1B: Must be sent to authorized chat ID 10001');
    assert.ok(bot1.sentMessages[0].text.includes('💻 You (on PC):'), '1C: Header must contain PC provenance');
    assert.ok(bot1.sentMessages[0].text.includes(pcPromptText), '1D: Text must contain full prompt');

    // 1.3: Intermediate agentActivity activates typing indicator
    tailEngine1.emit('agentActivity', {
      convId: 'conv_1',
      activity: 'Calling tool read_file',
      stepIndex: 2
    });

    assert.ok(mirror1.getTypingManager().isTyping(10001), '1E: Typing action must be active for chat');
    assert.ok(bot1.sentActions.some((a: any) => a.chatId === 10001 && a.action === 'typing'), '1F: Telegram received typing chat action');

    // 1.4: plannerResponse triggers delivery of 🤖 Antigravity: ... with typing halted
    const assistantAnswer = 'Here is the JWT authentication service:\n```ts\nexport class AuthService {}\n```';
    tailEngine1.emit('plannerResponse', {
      convId: 'conv_1',
      response: assistantAnswer,
      stepIndex: 3,
      timestamp: Date.now()
    });

    await sleep(20);

    assert.strictEqual(mirror1.getTypingManager().isTyping(10001), false, '1G: Typing must be cancelled on plannerResponse');
    assert.strictEqual(bot1.sentMessages.length, 2, '1H: Second message must be delivered');
    assert.ok(bot1.sentMessages[1].text.includes('🤖 Antigravity:'), '1I: Must start with assistant header');
    assert.ok(bot1.sentMessages[1].text.includes('AuthService'), '1J: Must include code content');

    mirror1.dispose();
    console.log('✓ [Test 1] PC-originated prompts complete flow verified successfully.\n');

    // =========================================================================
    // Test 2: Telegram-originated Prompts Complete Flow (Deduplication)
    // =========================================================================
    console.log('[Test 2] Verifying complete flow for Telegram-originated prompts (suppression & delivery)...');
    const bot2 = createMockBot();
    const tracker2 = new PromptOriginTracker({ autoPrune: false });
    const tailEngine2 = new TranscriptTailEngine({ brainDir: tmpTestDir });

    const mirror2 = new TelegramChatMirror({
      bot: bot2,
      allowedUsers: [20002],
      promptOriginTracker: tracker2,
      tailEngine: tailEngine2,
      minChunkDelayMs: 0
    });

    const telePrompt = 'Refactor payment gateway error handling';

    // 2.1: Outbound prompt registered in PromptOriginTracker (from Telegram handler)
    tracker2.registerTelegramPrompt(telePrompt);

    // 2.2: userInput event triggered -> prompt forwarding suppressed
    tailEngine2.emit('userInput', {
      convId: 'conv_2',
      prompt: telePrompt,
      stepIndex: 1,
      timestamp: Date.now()
    });

    await sleep(20);

    assert.strictEqual(bot2.sentMessages.length, 0, '2A: Telegram prompt must NOT be forwarded back to Telegram');

    // 2.3: Intermediate activity activates typing
    tailEngine2.emit('agentActivity', {
      convId: 'conv_2',
      activity: 'Checking error codes',
      stepIndex: 2
    });
    assert.ok(mirror2.getTypingManager().isTyping(20002), '2B: Typing indicator activated for Telegram query');

    // 2.4: plannerResponse delivered normally to Telegram
    const teleAnswer = 'Payment gateway error handling refactored successfully.';
    tailEngine2.emit('plannerResponse', {
      convId: 'conv_2',
      response: teleAnswer,
      stepIndex: 3,
      timestamp: Date.now()
    });

    await sleep(20);

    assert.strictEqual(mirror2.getTypingManager().isTyping(20002), false, '2C: Typing halted on response');
    assert.strictEqual(bot2.sentMessages.length, 1, '2D: Assistant response delivered normally to Telegram');
    assert.ok(bot2.sentMessages[0].text.includes('🤖 Antigravity:'), '2E: Contains assistant header');
    assert.ok(bot2.sentMessages[0].text.includes(teleAnswer), '2F: Contains answer text');

    mirror2.dispose();
    console.log('✓ [Test 2] Telegram-originated prompts flow verified successfully.\n');

    // =========================================================================
    // Test 3: enableChatMirror: false Completely Suppresses Mirror Dispatches
    // =========================================================================
    console.log('[Test 3] Verifying enableChatMirror: false completely suppresses mirror dispatches...');
    const bot3 = createMockBot();
    const tracker3 = new PromptOriginTracker({ autoPrune: false });
    const tailEngine3 = new TranscriptTailEngine({ brainDir: tmpTestDir });

    const mirror3 = new TelegramChatMirror({
      bot: bot3,
      allowedUsers: [30003],
      enableChatMirror: false,
      promptOriginTracker: tracker3,
      tailEngine: tailEngine3,
      minChunkDelayMs: 0
    });

    tailEngine3.emit('userInput', {
      convId: 'conv_3',
      prompt: 'Test prompt with mirror disabled',
      stepIndex: 1,
      timestamp: Date.now()
    });

    tailEngine3.emit('agentActivity', {
      convId: 'conv_3',
      activity: 'Thinking',
      stepIndex: 2
    });

    tailEngine3.emit('plannerResponse', {
      convId: 'conv_3',
      response: 'Test response with mirror disabled',
      stepIndex: 3,
      timestamp: Date.now()
    });

    await sleep(20);

    assert.strictEqual(bot3.sentMessages.length, 0, '3A: Zero messages dispatched when enableChatMirror is false');
    assert.strictEqual(bot3.sentActions.length, 0, '3B: Zero typing actions triggered when enableChatMirror is false');
    assert.strictEqual(mirror3.getTypingManager().isTyping(30003), false, '3C: Typing indicator must remain inactive');

    mirror3.dispose();
    console.log('✓ [Test 3] enableChatMirror: false suppression verified successfully.\n');

    // =========================================================================
    // Test 4: mirrorIncludePcPrompts: false Behavior
    // =========================================================================
    console.log('[Test 4] Verifying mirrorIncludePcPrompts: false suppresses PC prompt but delivers response...');
    const bot4 = createMockBot();
    const tracker4 = new PromptOriginTracker({ autoPrune: false });
    const tailEngine4 = new TranscriptTailEngine({ brainDir: tmpTestDir });

    const mirror4 = new TelegramChatMirror({
      bot: bot4,
      allowedUsers: [40004],
      mirrorIncludePcPrompts: false,
      promptOriginTracker: tracker4,
      tailEngine: tailEngine4,
      minChunkDelayMs: 0
    });

    tailEngine4.emit('userInput', {
      convId: 'conv_4',
      prompt: 'This PC prompt should be omitted from mirror',
      stepIndex: 1,
      timestamp: Date.now()
    });

    await sleep(20);
    assert.strictEqual(bot4.sentMessages.length, 0, '4A: PC prompt omitted when mirrorIncludePcPrompts is false');

    tailEngine4.emit('plannerResponse', {
      convId: 'conv_4',
      response: 'Assistant response is still delivered to Telegram',
      stepIndex: 2,
      timestamp: Date.now()
    });

    await sleep(20);
    assert.strictEqual(bot4.sentMessages.length, 1, '4B: Assistant response delivered successfully');
    assert.ok(bot4.sentMessages[0].text.includes('Assistant response is still delivered'), '4C: Contains response');

    mirror4.dispose();
    console.log('✓ [Test 4] mirrorIncludePcPrompts: false verified successfully.\n');

    // =========================================================================
    // Test 5: Custom Prefix Configuration
    // =========================================================================
    console.log('[Test 5] Verifying customizable chatMirrorPrefix configuration...');
    const bot5 = createMockBot();
    const mirror5 = new TelegramChatMirror({
      bot: bot5,
      allowedUsers: [50005],
      prefix: '🧠 Antigravity DeepThought:',
      minChunkDelayMs: 0
    });

    await mirror5.handlePlannerResponse('Custom header test answer', 50005, { sleepFn: async () => {} });

    assert.strictEqual(bot5.sentMessages.length, 1, '5A: Message delivered');
    assert.ok(bot5.sentMessages[0].text.startsWith('🧠 Antigravity DeepThought:'), '5B: Custom header prefix applied');

    // Dynamic prefix update
    mirror5.setPrefix('✨ AI:');
    assert.strictEqual(mirror5.getPrefix(), '✨ AI:', '5C: Prefix updated');

    await mirror5.handlePlannerResponse('Second answer with updated prefix', 50005, { sleepFn: async () => {} });
    assert.ok(bot5.sentMessages[1].text.startsWith('✨ AI:'), '5D: Updated prefix applied to next message');

    mirror5.dispose();
    console.log('✓ [Test 5] Customizable chatMirrorPrefix verified successfully.\n');

    // =========================================================================
    // Test 6: Multi-Workspace Environment Tagging
    // =========================================================================
    console.log('[Test 6] Verifying multi-workspace [📁 <workspaceName>] tagging...');
    const bot6 = createMockBot();
    const mirror6 = new TelegramChatMirror({
      bot: bot6,
      allowedUsers: [60006],
      workspaceName: 'Frontend-Portal',
      isMultiWorkspace: true,
      minChunkDelayMs: 0
    });

    assert.strictEqual(mirror6.getWorkspaceTag(), '[📁 Frontend-Portal]', '6A: Tag formatted correctly');

    // 6.1: PC prompt in multi-workspace environment
    await mirror6.handleUserInput('Update navigation bar styles', 60006);
    assert.strictEqual(bot6.sentMessages.length, 1, '6B: PC prompt delivered');
    assert.ok(bot6.sentMessages[0].text.startsWith('[📁 Frontend-Portal] 💻 You (on PC):'), '6C: Contains workspace tag before PC header');

    // 6.2: Assistant response in multi-workspace environment
    await mirror6.handlePlannerResponse('Navigation bar updated.', 60006, { sleepFn: async () => {} });
    assert.strictEqual(bot6.sentMessages.length, 2, '6D: Response delivered');
    assert.ok(bot6.sentMessages[1].text.startsWith('[📁 Frontend-Portal] 🤖 Antigravity:'), '6E: Contains workspace tag before assistant header');

    // 6.3: Single workspace environment (isMultiWorkspace = false)
    mirror6.setWorkspace('Frontend-Portal', false);
    assert.strictEqual(mirror6.getWorkspaceTag(), '', '6F: Tag is empty in single-workspace mode');

    await mirror6.handleUserInput('Run build command', 60006);
    assert.ok(bot6.sentMessages[2].text.startsWith('💻 You (on PC):'), '6G: Single workspace does not prepend workspace tag to PC prompt');

    mirror6.dispose();
    console.log('✓ [Test 6] Multi-workspace tagging verified successfully.\n');

    // =========================================================================
    // Test 7: TelegramBridge Lifecycle & Authorized User Whitelist
    // =========================================================================
    console.log('[Test 7] Verifying TelegramBridge lifecycle binding and user authorization...');
    const bot7 = createMockBot();
    const bridge7 = new TelegramBridge({
      token: 'test_token_777',
      allowedUsers: [70001, 70002],
      botFactory: () => bot7 as any
    });

    bridge7.initBot();

    const mirrorFromBridge = bridge7.getChatMirror();
    assert.ok(mirrorFromBridge, '7A: TelegramBridge exposes chatMirror instance');
    assert.strictEqual(mirrorFromBridge?.isEnabled(), true, '7B: Chat mirror enabled by default on bridge');

    // Broadcast to authorized users only
    await mirrorFromBridge?.handlePlannerResponse('Broadcast message to authorized users', undefined, {
      sleepFn: async () => {}
    });

    const receivedChatIds = bot7.sentMessages.map((m: any) => m.chatId);
    assert.strictEqual(receivedChatIds.length, 2, '7C: Sent to both authorized users');
    assert.ok(receivedChatIds.includes(70001), '7D: Delivered to 70001');
    assert.ok(receivedChatIds.includes(70002), '7E: Delivered to 70002');
    assert.ok(!receivedChatIds.includes(99999), '7F: Unauthorized users excluded');

    await bridge7.stop();
    console.log('✓ [Test 7] TelegramBridge lifecycle & authorization verified successfully.\n');

    // =========================================================================
    // Test 8: End-to-End Real File Tailing with Live Transcript
    // =========================================================================
    console.log('[Test 8] Verifying live continuous file-tailing via TranscriptTailEngine with real disk I/O...');
    const convDir8 = path.join(tmpTestDir, 'conv_live_8');
    const logsDir8 = path.join(convDir8, '.system_generated', 'logs');
    fs.mkdirSync(logsDir8, { recursive: true });
    const transcriptFile8 = path.join(logsDir8, 'transcript.jsonl');
    fs.writeFileSync(transcriptFile8, '', 'utf8');

    const bot8 = createMockBot();
    const tailEngine8 = new TranscriptTailEngine({
      brainDir: tmpTestDir,
      activeConvId: 'conv_live_8',
      transcriptPath: transcriptFile8,
      pollIntervalMs: 50
    });

    const mirror8 = new TelegramChatMirror({
      bot: bot8,
      allowedUsers: [80008],
      tailEngine: tailEngine8,
      minChunkDelayMs: 0
    });

    await mirror8.start();
    assert.strictEqual(tailEngine8.isActive(), true, '8A: TailEngine is actively monitoring');

    // Step A: Append User Input line to real transcript.jsonl
    const line1 = JSON.stringify({
      step_index: 1,
      type: 'USER_INPUT',
      content: '<USER_REQUEST>Implement Redis caching layer</USER_REQUEST>'
    }) + '\n';
    fs.appendFileSync(transcriptFile8, line1, 'utf8');

    // Wait for file watcher / poll tick
    await sleep(150);

    assert.ok(bot8.sentMessages.length >= 1, '8B: Telegram received mirrored message from real file append');
    assert.ok(bot8.sentMessages[0].text.includes('💻 You (on PC):'), '8C: Mirrored prompt has PC provenance');
    assert.ok(bot8.sentMessages[0].text.includes('Implement Redis caching layer'), '8D: Extracted prompt matches');

    // Step B: Append Tool call (Agent Activity) to real transcript.jsonl
    const line2 = JSON.stringify({
      step_index: 2,
      type: 'TOOL_CALL',
      name: 'write_to_file',
      activity: 'Creating redisClient.ts'
    }) + '\n';
    fs.appendFileSync(transcriptFile8, line2, 'utf8');

    await sleep(150);

    assert.ok(mirror8.getTypingManager().isTyping(80008), '8E: Typing active after tool call in file');

    // Step C: Append Planner Response to real transcript.jsonl
    const line3 = JSON.stringify({
      step_index: 3,
      type: 'PLANNER_RESPONSE',
      response: 'Redis cache layer setup is complete with TTL support.'
    }) + '\n';
    fs.appendFileSync(transcriptFile8, line3, 'utf8');

    await sleep(150);

    assert.strictEqual(mirror8.getTypingManager().isTyping(80008), false, '8F: Typing stopped after response in file');
    assert.ok(bot8.sentMessages.length >= 2, '8G: Response delivered from file');
    assert.ok(bot8.sentMessages[1].text.includes('Redis cache layer setup is complete'), '8H: Contains response text');

    // Clean teardown
    mirror8.dispose();
    assert.strictEqual(tailEngine8.isActive(), false, '8I: Tail engine stopped cleanly');
    console.log('✓ [Test 8] Live continuous file-tailing verified successfully.\n');

    // =========================================================================
    // Test 9: Graceful Error Isolation
    // =========================================================================
    console.log('[Test 9] Verifying graceful error isolation under Telegram API failure...');
    const failingBot = {
      api: {
        sendMessage: async () => {
          throw new Error('Telegram network connection timeout (ETIMEDOUT)');
        },
        sendChatAction: async () => {
          throw new Error('Telegram chat not found (400 Bad Request)');
        }
      }
    };

    const mirror9 = new TelegramChatMirror({
      bot: failingBot,
      allowedUsers: [90009],
      minChunkDelayMs: 0
    });

    // Should not throw or crash IDE process
    await assert.doesNotReject(async () => {
      mirror9.handleAgentActivity(90009);
      await mirror9.handleUserInput('Prompt that encounters telegram error', 90009);
      await mirror9.handlePlannerResponse('Answer that encounters telegram error', 90009, {
        sleepFn: async () => {}
      });
    }, '9A: Error in chat mirror must be gracefully caught and isolated');

    mirror9.dispose();
    console.log('✓ [Test 9] Graceful error isolation verified successfully.\n');

    // =========================================================================
    // Test 10: Configuration Hot-Reloading & VS Code Settings Binding
    // =========================================================================
    console.log('[Test 10] Verifying dynamic configuration hot-reloading...');
    const bot10 = createMockBot();
    const bridge10 = new TelegramBridge({
      token: 'test_token_10',
      allowedUsers: [10010],
      botFactory: () => bot10 as any
    });

    bridge10.initBot();
    const mirror10 = bridge10.getChatMirror();
    assert.ok(mirror10, '10A: Bridge mirror initialized');

    // Initial state
    assert.strictEqual(mirror10?.isEnabled(), true, '10B: Mirror initially enabled');
    assert.strictEqual(mirror10?.isMirrorIncludePcPrompts(), true, '10C: PC prompts initially included');

    // Hot-reload settings dynamically
    mockConfigValues['telegram.enableChatMirror'] = false;
    mockConfigValues['telegram.mirrorIncludePcPrompts'] = false;
    mockConfigValues['telegram.chatMirrorPrefix'] = '⚡ HotReload:';

    await bridge10.reloadConfig();

    assert.strictEqual(mirror10?.isEnabled(), false, '10D: Mirror dynamically disabled without restart');
    assert.strictEqual(mirror10?.isMirrorIncludePcPrompts(), false, '10E: PC prompts dynamically disabled');
    assert.strictEqual(mirror10?.getPrefix(), '⚡ HotReload:', '10F: Prefix dynamically updated');

    // Re-enable via direct updateConfig
    mirror10?.updateConfig({
      enableChatMirror: true,
      mirrorIncludePcPrompts: true,
      chatMirrorPrefix: '🤖 ReEnabled:'
    });
    assert.strictEqual(mirror10?.isEnabled(), true, '10G: Mirror re-enabled');
    assert.strictEqual(mirror10?.getPrefix(), '🤖 ReEnabled:', '10H: Prefix re-enabled');

    await bridge10.stop();
    console.log('✓ [Test 10] Dynamic configuration hot-reloading verified successfully.\n');

    console.log('=================================================================');
    console.log('ALL PHASE 04 INTEGRATION TESTS PASSED SUCCESSFULLY!');
    console.log('=================================================================');
  } finally {
    try {
      fs.rmSync(tmpTestDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase04CleanQaMirrorIntegrationTests().catch((err) => {
  console.error('Phase 04 Test Failure:', err);
  process.exit(1);
});
