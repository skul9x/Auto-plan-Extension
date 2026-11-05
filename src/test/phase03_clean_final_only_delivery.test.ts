// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const channelLines: string[] = [];
const mockConfigStore: Record<string, any> = {
  'autoplan.telegramEnabled': true,
  'autoplan.telegram.allowedUsers': [12345],
  'autoplan.telegram.throttleMs': 50
};

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
      commands: {
        executeCommand: async (_cmd: string, ..._args: any[]) => undefined
      },
      window: {
        createOutputChannel: (name: string) => ({
          name,
          appendLine: (line: string) => {
            channelLines.push(line);
          },
          show: () => {},
          dispose: () => {}
        }),
        showWarningMessage: (_msg: string) => undefined,
        showInformationMessage: async () => {},
        showErrorMessage: async () => {}
      },
      ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ThrottledNotifier } from '../telegramNotifier';
import { TelegramBridge } from '../telegramBridge';
import { getConfig, getTelegramConfig } from '../config';
import { DebugLogger } from '../debugLogger';

class MockTelegramBot {
  public sendMessageCalls: Array<{ chatId: any; text: string; options?: any }> = [];
  public editMessageTextCalls: Array<{ chatId: any; messageId: number; text: string; options?: any }> = [];
  public unpinCalls: Array<{ chatId: any; messageId: number }> = [];
  public chatActionCalls: Array<{ chatId: any; action: string }> = [];
  public setMyCommandsCalls: Array<{ commands: any[] }> = [];

  public shouldFailHtmlParseOnNextSendMessage = false;
  private currentMsgId = 100;

  public api = {
    sendMessage: async (chatId: any, text: string, options?: any) => {
      if (this.shouldFailHtmlParseOnNextSendMessage && options?.parse_mode === 'HTML') {
        this.shouldFailHtmlParseOnNextSendMessage = false;
        const parseErr: any = new Error("Bad Request: can't parse entities in message text");
        parseErr.description = "Bad Request: can't parse entities: Unsupported start tag at byte offset 12";
        parseErr.error_code = 400;
        throw parseErr;
      }
      this.currentMsgId++;
      const id = this.currentMsgId;
      this.sendMessageCalls.push({ chatId, text, options });
      return { message_id: id, chat: { id: chatId }, text };
    },
    editMessageText: async (chatId: any, messageId: number, text: string, options?: any) => {
      this.editMessageTextCalls.push({ chatId, messageId, text, options });
      return { message_id: messageId, chat: { id: chatId }, text };
    },
    unpinChatMessage: async (chatId: any, messageId: number) => {
      this.unpinCalls.push({ chatId, messageId });
      return true;
    },
    sendChatAction: async (chatId: any, action: string) => {
      this.chatActionCalls.push({ chatId, action });
      return true;
    },
    setMyCommands: async (commands: any[]) => {
      this.setMyCommandsCalls.push({ commands });
      return true;
    }
  };

  public use(..._args: any[]) { return this; }
  public catch(..._args: any[]) { return this; }
  public command(..._args: any[]) { return this; }
  public on(..._args: any[]) { return this; }
  public callbackQuery(..._args: any[]) { return this; }
  public start(..._args: any[]) { return Promise.resolve(); }
  public stop(..._args: any[]) { return Promise.resolve(); }

  public reset(): void {
    this.sendMessageCalls = [];
    this.editMessageTextCalls = [];
    this.unpinCalls = [];
    this.chatActionCalls = [];
    this.setMyCommandsCalls = [];
    this.shouldFailHtmlParseOnNextSendMessage = false;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPhase03CleanFinalOnlyDeliveryTests(): Promise<void> {
  console.log('================================================================');
  console.log(' Phase 03: Clean Final-Only Delivery Mode Verification Test');
  console.log('================================================================\n');

  const silentLogger = new DebugLogger();
  const mockBot = new MockTelegramBot();
  const testChatId = 12345;

  // --------------------------------------------------------------------------
  // [Req 1] Test configuration resolution for autoplan.telegram.liveProgressMode
  // --------------------------------------------------------------------------
  console.log('[Req 1] Verifying configuration resolution for autoplan.telegram.liveProgressMode...');
  delete mockConfigStore['telegram.liveProgressMode'];
  delete mockConfigStore['telegramLiveProgressMode'];

  const defaultConfig = getConfig();
  const defaultTgConfig = getTelegramConfig();
  assert.strictEqual(
    defaultConfig.telegramLiveProgressMode,
    'final_only',
    'getConfig().telegramLiveProgressMode must default to final_only'
  );
  assert.strictEqual(
    defaultTgConfig.liveProgressMode,
    'final_only',
    'getTelegramConfig().liveProgressMode must default to final_only'
  );
  console.log('  ✓ Default configuration correctly resolves to final_only.');

  // Set explicit live_edit in configuration store
  mockConfigStore['telegram.liveProgressMode'] = 'live_edit';
  const liveEditConfig = getConfig();
  const liveEditTgConfig = getTelegramConfig();
  assert.strictEqual(
    liveEditConfig.telegramLiveProgressMode,
    'live_edit',
    'getConfig().telegramLiveProgressMode must resolve to live_edit when configured'
  );
  assert.strictEqual(
    liveEditTgConfig.liveProgressMode,
    'live_edit',
    'getTelegramConfig().liveProgressMode must resolve to live_edit when configured'
  );
  console.log('  ✓ Explicit live_edit configuration correctly resolved.');

  // Reset back to default final_only
  delete mockConfigStore['telegram.liveProgressMode'];
  assert.strictEqual(getConfig().telegramLiveProgressMode, 'final_only');

  // Verify package.json schema defines autoplan.telegram.liveProgressMode with enum and default
  const pkgJsonPath = path.resolve(__dirname, '../../package.json');
  assert.strictEqual(fs.existsSync(pkgJsonPath), true, 'package.json must exist');
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const schemaProps = pkgJson.contributes.configuration.properties;
  assert.ok(schemaProps['autoplan.telegram.liveProgressMode'], 'package.json must define autoplan.telegram.liveProgressMode');
  assert.deepStrictEqual(
    schemaProps['autoplan.telegram.liveProgressMode'].enum,
    ['final_only', 'live_edit'],
    'Enum options must be ["final_only", "live_edit"]'
  );
  assert.strictEqual(
    schemaProps['autoplan.telegram.liveProgressMode'].default,
    'final_only',
    'Default mode in package.json must be "final_only"'
  );
  console.log('  ✓ Manifest validation passed: autoplan.telegram.liveProgressMode properly defined.');

  // --------------------------------------------------------------------------
  // [Req 2] Verify in final_only mode, streaming 20 log updates produces 0 sendMessage
  //         and produces periodic sendChatAction('typing') calls
  // --------------------------------------------------------------------------
  console.log('\n[Req 2] Verifying final_only mode suppresses intermediate messages and pulses typing indicator...');
  mockBot.reset();

  const finalOnlyNotifier = new ThrottledNotifier({
    bot: mockBot as any,
    chatIds: [testChatId],
    throttleMs: 50,
    typingIntervalMs: 60, // Short interval for deterministic, fast testing
    logger: silentLogger,
    isLeader: true,
    liveProgressMode: 'final_only'
  });

  assert.strictEqual(finalOnlyNotifier.getLiveProgressMode(), 'final_only');
  assert.strictEqual(finalOnlyNotifier.isTyping(), false, 'Notifier should not be typing initially');

  // Stream 20 log updates with small delays to allow periodic typing ticks
  for (let i = 1; i <= 20; i++) {
    finalOnlyNotifier.handleLogUpdate(`Compiling phase 03 source file ${i}/20...`);
    if (i === 5 || i === 12 || i === 18) {
      await sleep(80); // Trigger periodic interval timer
    }
  }

  // Force any pending buffer flushes
  await finalOnlyNotifier.flushThrottleBuffer();

  assert.strictEqual(
    mockBot.sendMessageCalls.length,
    0,
    'Streaming 20 log updates in final_only mode must produce 0 sendMessage calls'
  );
  assert.strictEqual(
    mockBot.editMessageTextCalls.length,
    0,
    'Streaming 20 log updates in final_only mode must produce 0 editMessageText calls'
  );
  assert.strictEqual(
    finalOnlyNotifier.getLiveMessageMap().size,
    0,
    'No live progress message container should be created in final_only mode'
  );
  assert.strictEqual(
    finalOnlyNotifier.isTyping(),
    true,
    'Typing indicator must remain active while phase processing continues'
  );
  assert.ok(
    mockBot.chatActionCalls.length >= 2,
    `Periodic typing calls must have been triggered (observed ${mockBot.chatActionCalls.length} calls)`
  );
  assert.ok(
    mockBot.chatActionCalls.every((c) => c.chatId === testChatId && c.action === 'typing'),
    'All chat action calls must target testChatId with typing action'
  );
  console.log(`  ✓ 20 log updates produced 0 sendMessage calls and ${mockBot.chatActionCalls.length} periodic typing actions.`);

  // --------------------------------------------------------------------------
  // [Req 3] Verify on handlePhaseComplete, typing is stopped and exactly one completion message is sent
  // --------------------------------------------------------------------------
  console.log('\n[Req 3] Verifying handlePhaseComplete stops typing and delivers single Rich HTML summary...');
  mockBot.reset();

  // Trigger phase completion
  await finalOnlyNotifier.handlePhaseComplete(
    { name: 'Phase 03 Clean Delivery', fileName: 'phase-03.md' },
    { summary: 'Implemented typing lifecycle & single final delivery', durationMs: 4200 },
    1,
    1
  );

  assert.strictEqual(
    finalOnlyNotifier.isTyping(),
    false,
    'handlePhaseComplete must immediately stop typing indicator'
  );
  assert.strictEqual(
    mockBot.sendMessageCalls.length,
    1,
    'handlePhaseComplete must dispatch exactly one final completion message'
  );

  const finalMsg = mockBot.sendMessageCalls[0];
  assert.strictEqual(finalMsg.chatId, testChatId);
  assert.strictEqual(finalMsg.options?.parse_mode, 'HTML', 'Final delivery message must use parse_mode HTML');
  assert.ok(
    finalMsg.text.includes('Phase Completed') && finalMsg.text.includes('phase-03.md'),
    'Final message must include completed phase name'
  );
  assert.ok(
    finalMsg.text.includes('<code>') || finalMsg.text.includes('<b>'),
    'Final message must be formatted with Telegram Rich HTML tags'
  );
  console.log('  ✓ Typing stopped and exactly one Rich HTML completion message dispatched.');

  // Sub-test for FR-02 lifecycle stops: handleStopped and handleError stop typing
  finalOnlyNotifier.startTyping();
  assert.strictEqual(finalOnlyNotifier.isTyping(), true);
  await finalOnlyNotifier.handleStopped();
  assert.strictEqual(finalOnlyNotifier.isTyping(), false, 'handleStopped must stop typing');

  finalOnlyNotifier.startTyping();
  assert.strictEqual(finalOnlyNotifier.isTyping(), true);
  await finalOnlyNotifier.handleError(new Error('Synthetic abort'));
  assert.strictEqual(finalOnlyNotifier.isTyping(), false, 'handleError must stop typing');
  console.log('  ✓ Lifecycle stops (stopped, error) cleanly cancel typing state.');

  // Sub-test for FR-05: Zero-drop fallback to plain text if Telegram 400 entity parse error occurs
  console.log('\n[Req 3b] Verifying zero-drop fallback to plain text on Telegram 400 entity parse error...');
  mockBot.reset();
  mockBot.shouldFailHtmlParseOnNextSendMessage = true;

  await finalOnlyNotifier.handlePhaseComplete(
    { name: 'Phase 03 Fallback Test', fileName: 'phase-03-fallback.md' },
    { summary: 'Malformed <tag> test payload', durationMs: 1000 },
    1,
    1
  );

  assert.strictEqual(
    mockBot.sendMessageCalls.length,
    1,
    'Zero-drop fallback must successfully deliver message even after HTML parse failure'
  );
  assert.strictEqual(
    mockBot.sendMessageCalls[0].options?.parse_mode,
    undefined,
    'Fallback message must be sent as plain text (parse_mode undefined)'
  );
  assert.ok(
    mockBot.sendMessageCalls[0].text.includes('Phase Completed: phase-03-fallback.md'),
    'Fallback message content must be intact'
  );
  console.log('  ✓ Zero-drop fallback successfully recovered from Telegram 400 and sent clean plain text.');

  // --------------------------------------------------------------------------
  // [Req 4] Verify in live_edit mode, streaming log updates creates exactly one
  //         live message and edits it with throttled intervals
  // --------------------------------------------------------------------------
  console.log('\n[Req 4] Verifying live_edit mode creates single live message and edits it throttled...');
  mockBot.reset();

  const liveEditNotifier = new ThrottledNotifier({
    bot: mockBot as any,
    chatIds: [testChatId],
    throttleMs: 40,
    logger: silentLogger,
    isLeader: true,
    liveProgressMode: 'live_edit'
  });

  assert.strictEqual(liveEditNotifier.getLiveProgressMode(), 'live_edit');

  // Stream initial log update
  liveEditNotifier.handleLogUpdate('First log line: Initializing workspace');
  await liveEditNotifier.flushThrottleBuffer();

  assert.strictEqual(
    mockBot.sendMessageCalls.length,
    1,
    'live_edit mode must create exactly one live message container'
  );
  assert.ok(
    mockBot.sendMessageCalls[0].text.includes('🔄 Live Progress') || mockBot.sendMessageCalls[0].text.includes('Auto-Plan Live Progress'),
    'Container must contain live progress header'
  );
  const containerId = liveEditNotifier.getLiveMessageId(testChatId);
  assert.ok(containerId, 'Container messageId must be tracked');

  // Stream subsequent log updates
  await sleep(50);
  liveEditNotifier.handleLogUpdate('Second log line: Compiling');
  await liveEditNotifier.flushThrottleBuffer();

  await sleep(50);
  liveEditNotifier.handleLogUpdate('Third log line: Testing');
  await liveEditNotifier.flushThrottleBuffer();

  assert.strictEqual(
    mockBot.sendMessageCalls.length,
    1,
    'No additional sendMessage calls should occur during subsequent live_edit updates'
  );
  assert.ok(
    mockBot.editMessageTextCalls.length >= 2,
    `Edits should have updated the single container (observed ${mockBot.editMessageTextCalls.length} edits)`
  );
  assert.ok(
    mockBot.editMessageTextCalls.every((e) => e.messageId === containerId),
    'All editMessageText calls must target the same initial container messageId'
  );

  // Complete phase and verify container finalized and unpinned
  await liveEditNotifier.handlePhaseComplete(
    { name: 'Phase 03 Live Edit', fileName: 'phase-03.md' },
    'Live edit completed',
    1,
    1
  );
  assert.strictEqual(liveEditNotifier.getLiveMessageMap().size, 0, 'Live message container must be cleared on completion');
  assert.strictEqual(mockBot.unpinCalls.length, 1, 'Live container must be unpinned on completion');
  console.log('  ✓ live_edit mode created exactly 1 container, edited via throttled updates, and unpinned on complete.');

  // --------------------------------------------------------------------------
  // [Req 5] Verify dynamic mode toggling updates notifier behavior without instance recreation
  // --------------------------------------------------------------------------
  console.log('\n[Req 5] Verifying dynamic mode toggling updates notifier behavior on the same instance...');
  mockBot.reset();

  const dynamicNotifier = new ThrottledNotifier({
    bot: mockBot as any,
    chatIds: [testChatId],
    throttleMs: 30,
    typingIntervalMs: 50,
    logger: silentLogger,
    isLeader: true,
    liveProgressMode: 'final_only'
  });

  // 1. In final_only mode: stream updates -> 0 sendMessage, typing started
  dynamicNotifier.handleLogUpdate('Step A (final_only): processing');
  await dynamicNotifier.flushThrottleBuffer();
  assert.strictEqual(mockBot.sendMessageCalls.length, 0);
  assert.strictEqual(dynamicNotifier.isTyping(), true);
  console.log('  ✓ Step A: dynamic instance in final_only mode muted messages and started typing.');

  // 2. Toggle to live_edit mode
  dynamicNotifier.setLiveProgressMode('live_edit');
  assert.strictEqual(dynamicNotifier.getLiveProgressMode(), 'live_edit');
  assert.strictEqual(dynamicNotifier.isTyping(), false, 'Switching to live_edit must stop typing immediately');

  // Stream updates in live_edit mode -> creates live message and edits it
  dynamicNotifier.handleLogUpdate('Step B (live_edit): creating container');
  await dynamicNotifier.flushThrottleBuffer();
  assert.strictEqual(mockBot.sendMessageCalls.length, 1, 'live_edit must now create message container');
  const dynamicContainerId = dynamicNotifier.getLiveMessageId(testChatId);
  assert.ok(dynamicContainerId);

  await sleep(40);
  dynamicNotifier.handleLogUpdate('Step C (live_edit): editing container');
  await dynamicNotifier.flushThrottleBuffer();
  assert.strictEqual(mockBot.sendMessageCalls.length, 1, 'No new sendMessage, only edit');
  assert.ok(mockBot.editMessageTextCalls.length >= 1, 'Edit must be issued to container');
  assert.ok(
    mockBot.editMessageTextCalls.every((e) => e.messageId === dynamicContainerId),
    'All edits must target dynamic container'
  );
  console.log('  ✓ Step B & C: dynamically toggled to live_edit; created 1 container and edited it.');

  // 3. Toggle back to final_only mode
  dynamicNotifier.setLiveProgressMode('final_only');
  assert.strictEqual(dynamicNotifier.getLiveProgressMode(), 'final_only');

  const previousSendCount = mockBot.sendMessageCalls.length;
  const previousEditCount = mockBot.editMessageTextCalls.length;

  dynamicNotifier.handleLogUpdate('Step D (switched back to final_only)');
  await dynamicNotifier.flushThrottleBuffer();

  assert.strictEqual(
    mockBot.sendMessageCalls.length,
    previousSendCount,
    'No new sendMessage after switching back to final_only'
  );
  assert.strictEqual(
    mockBot.editMessageTextCalls.length,
    previousEditCount,
    'No new editMessageText after switching back to final_only'
  );
  assert.strictEqual(dynamicNotifier.isTyping(), true, 'Typing should resume in final_only mode');
  console.log('  ✓ Step D: switched back to final_only; edits muted and typing resumed.');

  // 4. Verify TelegramBridge reloadConfig updates attached notifier's mode
  const bridge = new TelegramBridge({
    botFactory: () => mockBot as any,
    allowedUsers: [testChatId],
    throttleMs: 50,
    notifier: dynamicNotifier,
    logger: silentLogger
  });

  assert.strictEqual(bridge.getLiveProgressMode(), 'final_only');
  assert.strictEqual(dynamicNotifier.getLiveProgressMode(), 'final_only');

  mockConfigStore['telegram.liveProgressMode'] = 'live_edit';
  await bridge.reloadConfig();

  assert.strictEqual(bridge.getLiveProgressMode(), 'live_edit', 'Bridge must reload liveProgressMode to live_edit');
  assert.strictEqual(dynamicNotifier.getLiveProgressMode(), 'live_edit', 'Attached notifier must update to live_edit');

  mockConfigStore['telegram.liveProgressMode'] = 'final_only';
  await bridge.reloadConfig();

  assert.strictEqual(bridge.getLiveProgressMode(), 'final_only', 'Bridge must reload liveProgressMode to final_only');
  assert.strictEqual(dynamicNotifier.getLiveProgressMode(), 'final_only', 'Attached notifier must update to final_only');
  console.log('  ✓ TelegramBridge.reloadConfig dynamically synchronizes liveProgressMode to notifier.');

  // Clean up
  finalOnlyNotifier.dispose();
  liveEditNotifier.dispose();
  dynamicNotifier.dispose();
  await bridge.stop();

  console.log('\n================================================================');
  console.log(' All Phase 03 Clean Final-Only Delivery tests passed successfully!');
  console.log('================================================================');
}

runPhase03CleanFinalOnlyDeliveryTests().catch((err) => {
  console.error('\n❌ Phase 03 Test Failed:', err);
  process.exit(1);
});
