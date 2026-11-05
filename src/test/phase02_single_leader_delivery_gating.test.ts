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
import * as os from 'os';
import { ThrottledNotifier } from '../telegramNotifier';
import { TelegramBridge } from '../telegramBridge';
import { TelegramChatMirror } from '../telegramChatMirror';
import { DebugLogger } from '../debugLogger';

class MockTelegramBot {
  public sendMessageCalls: Array<{ chatId: any; text: string; options?: any }> = [];
  public editMessageTextCalls: Array<{ chatId: any; messageId: number; text: string; options?: any }> = [];
  public unpinCalls: Array<{ chatId: any; messageId: number }> = [];
  public chatActionCalls: Array<{ chatId: any; action: string }> = [];
  public setMyCommandsCalls: Array<{ commands: any[] }> = [];

  private currentMsgId = 100;

  public api = {
    sendMessage: async (chatId: any, text: string, options?: any) => {
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
  }
}

async function runPhase02SingleLeaderTests(): Promise<void> {
  console.log('================================================================');
  console.log(' Phase 02: Single-Leader Delivery Gating Verification Test');
  console.log('================================================================\n');

  const silentLogger = new DebugLogger();
  const mockBot = new MockTelegramBot();
  const testChatId = 12345;

  // --------------------------------------------------------------------------
  // [Req 1] Initialize two ThrottledNotifier instances (Leader & Standby)
  // --------------------------------------------------------------------------
  console.log('[Req 1] Initializing Window 1 (Leader) and Window 2 (Standby) notifiers...');
  const notifierLeader = new ThrottledNotifier({
    bot: mockBot as any,
    chatIds: [testChatId],
    throttleMs: 50,
    logger: silentLogger,
    isLeader: true
  });

  const notifierStandby = new ThrottledNotifier({
    bot: mockBot as any,
    chatIds: [testChatId],
    throttleMs: 50,
    logger: silentLogger,
    isLeader: false
  });

  assert.strictEqual(notifierLeader.getIsLeader(), true, 'Window 1 must report leader state true');
  assert.strictEqual(notifierLeader.isLeader, true, 'Window 1 isLeader getter must be true');
  assert.strictEqual(notifierStandby.getIsLeader(), false, 'Window 2 must report leader state false');
  assert.strictEqual(notifierStandby.isLeader, false, 'Window 2 isLeader getter must be false');
  console.log('  ✓ Initial leadership states verified (Leader: true, Standby: false).');

  // --------------------------------------------------------------------------
  // [Req 2] Verify Standby suppresses log updates, edits, and phase events
  // --------------------------------------------------------------------------
  console.log('\n[Req 2] Verifying Standby window mutes all log updates and phase events...');
  mockBot.reset();

  // Emulate streaming logs on standby instance
  notifierStandby.handleLogUpdate('Reading src/auth.ts...');
  notifierStandby.handleLogUpdate('Executing cargo check...');
  await notifierStandby.flushThrottleBuffer();

  assert.strictEqual(
    mockBot.sendMessageCalls.length,
    0,
    'Standby instance must not invoke bot.api.sendMessage on log updates'
  );
  assert.strictEqual(
    mockBot.editMessageTextCalls.length,
    0,
    'Standby instance must not invoke bot.api.editMessageText'
  );
  assert.strictEqual(
    notifierStandby.getLiveMessageMap().size,
    0,
    'Standby instance liveMessageIds map must remain strictly empty'
  );

  // Emulate phase lifecycle events on standby instance
  await notifierStandby.handlePhaseStart({ name: 'Phase 02 Gating', phaseNumber: 2 }, 1, 4);
  await notifierStandby.handlePhaseComplete({ name: 'Phase 02 Gating' }, 'Completed');
  await notifierStandby.handleSkipped({ name: 'Phase 03 Test' });
  await notifierStandby.handleAllComplete(4);
  await notifierStandby.handleStopped();
  await notifierStandby.handleError(new Error('Test standby failure'));
  await notifierStandby.handleCompletionDetected({ response: 'Done skul9x.' });

  assert.strictEqual(
    mockBot.sendMessageCalls.length,
    0,
    'Standby instance must not dispatch any phase start/complete/stopped/completion messages'
  );
  assert.strictEqual(
    notifierStandby.getLiveMessageMap().size,
    0,
    'Standby liveMessageIds must still remain empty after phase lifecycle events'
  );
  console.log('  ✓ Standby window completely suppressed all 7 lifecycle and log events. 0 Telegram calls emitted.');

  // --------------------------------------------------------------------------
  // [Req 3] Verify Leader window creates exactly one live message and edits it
  // --------------------------------------------------------------------------
  console.log('\n[Req 3] Verifying Leader window creates exactly one live message container and edits it...');
  mockBot.reset();

  notifierLeader.handleLogUpdate('Compiling TypeScript...');
  await notifierLeader.flushThrottleBuffer();

  assert.strictEqual(
    mockBot.sendMessageCalls.length,
    1,
    'Leader window must invoke bot.api.sendMessage exactly once for initial container'
  );
  const createdMsgId = mockBot.sendMessageCalls[0] ? 101 : 0;
  assert.strictEqual(
    notifierLeader.getLiveMessageId(testChatId),
    createdMsgId,
    'Leader window must record created message ID in liveMessageIds'
  );
  assert.strictEqual(
    notifierLeader.getLiveMessageMap().size,
    1,
    'Leader window liveMessageIds map must have exactly 1 entry'
  );

  // Subsequent log updates should edit existing container
  notifierLeader.handleLogUpdate('Editing src/telegramNotifier.ts...');
  await notifierLeader.flushThrottleBuffer();

  assert.strictEqual(
    mockBot.sendMessageCalls.length,
    1,
    'Leader window must NOT send a new message for subsequent log updates'
  );
  assert.strictEqual(
    mockBot.editMessageTextCalls.length,
    1,
    'Leader window must invoke bot.api.editMessageText for subsequent log update'
  );
  assert.strictEqual(
    mockBot.editMessageTextCalls[0].messageId,
    createdMsgId,
    'Leader window must target the created live message ID'
  );
  assert.ok(
    mockBot.editMessageTextCalls[0].text.includes('Editing src/telegramNotifier.ts'),
    'Edited message text must reflect updated activity preview'
  );

  console.log('  ✓ Leader window created exactly 1 message container (ID 101) and edited it as expected.');

  // --------------------------------------------------------------------------
  // [Req 4] Simulate leadership transfer from Window 1 to Window 2
  // --------------------------------------------------------------------------
  console.log('\n[Req 4] Simulating leadership transfer from Window 1 to Window 2...');
  mockBot.reset();

  // Window 1 demoted (releases leadership)
  notifierLeader.setLeader(false);
  assert.strictEqual(notifierLeader.getIsLeader(), false, 'Window 1 must now be in standby');
  assert.strictEqual(
    notifierLeader.getLiveMessageMap().size,
    0,
    'Window 1 liveMessageIds must be cleared upon leadership release'
  );

  // Window 1 attempts log update while in standby -> muted
  notifierLeader.handleLogUpdate('Window 1 lingering activity...');
  await notifierLeader.flushThrottleBuffer();
  assert.strictEqual(mockBot.sendMessageCalls.length, 0, 'Demoted Window 1 must not send messages');
  assert.strictEqual(mockBot.editMessageTextCalls.length, 0, 'Demoted Window 1 must not edit messages');

  // Window 2 promoted (takes over leadership)
  notifierStandby.setLeader(true);
  assert.strictEqual(notifierStandby.getIsLeader(), true, 'Window 2 must now be leader');

  // Window 2 sends log update -> active delivery unmuted, creates new live message
  notifierStandby.handleLogUpdate('Window 2 taking over leadership...');
  await notifierStandby.flushThrottleBuffer();

  assert.strictEqual(
    mockBot.sendMessageCalls.length,
    1,
    'Promoted Window 2 must create a new live message container'
  );
  const newMsgId = mockBot.sendMessageCalls[0] ? 102 : 0;
  assert.strictEqual(
    notifierStandby.getLiveMessageId(testChatId),
    newMsgId,
    'Window 2 must store new message ID in liveMessageIds'
  );

  // Subsequent log update on Window 2 -> edits message 102
  notifierStandby.handleLogUpdate('Window 2 running tests...');
  await notifierStandby.flushThrottleBuffer();

  assert.strictEqual(mockBot.sendMessageCalls.length, 1, 'Still only 1 sendMessage from Window 2');
  assert.strictEqual(mockBot.editMessageTextCalls.length, 1, 'Window 2 must edit its live message');
  assert.strictEqual(
    mockBot.editMessageTextCalls[0].messageId,
    newMsgId,
    'Window 2 must target message ID 102'
  );

  console.log('  ✓ Seamless leadership handover: Window 1 silenced, Window 2 promoted and resumed live updates.');

  // --------------------------------------------------------------------------
  // [Req 5] Verify broadcast and approval messages follow single-leader gating
  // --------------------------------------------------------------------------
  console.log('\n[Req 5] Verifying broadcast and approval messages adhere to single-leader gating...');
  mockBot.reset();

  // Test standby instance (notifierLeader is currently false)
  const standbyBroadcastResults = await notifierLeader.broadcastMessage('Standby Broadcast Test');
  assert.deepStrictEqual(
    standbyBroadcastResults,
    [],
    'broadcastMessage on standby must return empty array without calling API'
  );

  const standbyInfoResults = await notifierLeader.sendInfo('Standby Info Test');
  assert.deepStrictEqual(
    standbyInfoResults,
    [],
    'sendInfo on standby must return empty array without calling API'
  );

  const standbyApprovalQueued = notifierLeader.queueApprovalNotification({
    command: 'npm test',
    candidate: { command: 'npm test' }
  });
  assert.strictEqual(
    standbyApprovalQueued,
    false,
    'queueApprovalNotification on standby must return false without enqueuing'
  );
  assert.strictEqual(
    notifierLeader.getApprovalQueueLength(),
    0,
    'Standby approval queue length must remain 0'
  );

  const standbyApprovalSent = await notifierLeader.sendApprovalNotification({
    command: 'npm test',
    candidate: { command: 'npm test' }
  });
  assert.strictEqual(
    standbyApprovalSent,
    false,
    'sendApprovalNotification on standby must return false without sending'
  );

  assert.strictEqual(
    mockBot.sendMessageCalls.length,
    0,
    'Standby instance must have 0 bot API calls for broadcasts and approvals'
  );

  // Test leader instance (notifierStandby is currently true)
  const leaderBroadcastResults = await notifierStandby.broadcastMessage('Leader Broadcast Test');
  assert.strictEqual(
    leaderBroadcastResults.length,
    1,
    'broadcastMessage on leader must return sent message result'
  );
  assert.strictEqual(mockBot.sendMessageCalls.length, 1, 'Leader broadcast must invoke bot.api.sendMessage');

  const leaderInfoResults = await notifierStandby.sendInfo('Leader Info Test');
  assert.strictEqual(leaderInfoResults.length, 1, 'sendInfo on leader must return sent message result');
  assert.strictEqual(mockBot.sendMessageCalls.length, 2, 'Leader sendInfo must invoke bot.api.sendMessage');

  const approvalPromise = notifierStandby.sendApprovalNotification({
    command: 'rm -rf /',
    candidate: { command: 'rm -rf /' }
  });
  await notifierStandby.flushApprovalQueue();
  const leaderApprovalSent = await approvalPromise;
  assert.strictEqual(leaderApprovalSent, true, 'sendApprovalNotification on leader must resolve true');
  assert.strictEqual(
    mockBot.sendMessageCalls.length,
    3,
    'Leader approval notification must be delivered to bot'
  );

  console.log('  ✓ Standby correctly suppressed broadcasts and approvals; Leader delivered all 3 successfully.');

  // --------------------------------------------------------------------------
  // [Req 6] Multi-Window TelegramBridge Leader Coordination Integration Test
  // --------------------------------------------------------------------------
  console.log('\n[Req 6] Verifying multi-window TelegramBridge coordinator and chat mirror integration...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-phase02-test-'));
  const customRegistryPath = path.join(tmpDir, 'ag-autoplan-ports.json');

  try {
    const bridge1Bot = new MockTelegramBot();
    const bridge2Bot = new MockTelegramBot();

    const bridge1 = new TelegramBridge({
      windowKey: 'window-1-primary',
      token: '123456:mock-token-for-test',
      registryPath: customRegistryPath,
      botFactory: () => bridge1Bot as any,
      allowedUsers: [testChatId],
      logger: silentLogger
    });

    const bridge2 = new TelegramBridge({
      windowKey: 'window-2-secondary',
      token: '123456:mock-token-for-test',
      registryPath: customRegistryPath,
      botFactory: () => bridge2Bot as any,
      allowedUsers: [testChatId],
      logger: silentLogger
    });

    // Start Window 1 (should become leader)
    await bridge1.start();
    assert.strictEqual(bridge1.getIsLeader(), true, 'Bridge 1 must acquire leadership');
    assert.strictEqual(
      bridge1.getNotifier()?.isLeader,
      true,
      'Bridge 1 notifier must have isLeader === true'
    );
    assert.strictEqual(
      bridge1.getChatMirror()?.isLeader,
      true,
      'Bridge 1 chatMirror must have isLeader === true'
    );

    // Start Window 2 with matching registry (should detect Bridge 1 and enter standby)
    await bridge2.start();
    assert.strictEqual(bridge2.getIsLeader(), false, 'Bridge 2 must detect active leader and be in standby');
    assert.strictEqual(
      bridge2.getNotifier()?.isLeader,
      false,
      'Bridge 2 notifier must have isLeader === false'
    );
    assert.strictEqual(
      bridge2.getChatMirror()?.isLeader,
      false,
      'Bridge 2 chatMirror must have isLeader === false'
    );

    // Verify Bridge 2 notifier and split sender are gated
    const b2Notifier = bridge2.getNotifier();
    if (b2Notifier) {
      b2Notifier.handleLogUpdate('Window 2 background work...');
      await b2Notifier.flushThrottleBuffer();
      assert.strictEqual(
        bridge2Bot.sendMessageCalls.length,
        0,
        'Standby Bridge 2 bot must not receive sendMessage calls'
      );
      assert.strictEqual(
        b2Notifier.getLiveMessageMap().size,
        0,
        'Standby Bridge 2 liveMessageMap must be empty'
      );
    }

    const splitRes = await bridge2.sendSplitMessage(testChatId, 'Standby message');
    assert.deepStrictEqual(splitRes, [], 'sendSplitMessage on standby bridge must return empty array');

    const nudgeRes = await bridge2.handlePhaseNudged({ phase: { name: 'P2' } });
    assert.strictEqual(nudgeRes, false, 'handlePhaseNudged on standby bridge must return false');

    // Simulate Window 1 stop / leadership release
    await bridge1.stop();
    assert.strictEqual(bridge1.getIsLeader(), false, 'Bridge 1 must relinquish leadership on stop');
    assert.strictEqual(bridge1.getNotifier()?.isLeader, false, 'Bridge 1 notifier must be muted');

    // Bridge 2 acquires leadership
    const acquired = bridge2.tryAcquireLeadership();
    assert.strictEqual(acquired, true, 'Bridge 2 must acquire leadership after Bridge 1 released');
    bridge2.getNotifier()?.setLeader(true);
    bridge2.getChatMirror()?.setLeader(true);

    assert.strictEqual(bridge2.getNotifier()?.isLeader, true, 'Bridge 2 notifier is now unmuted');
    if (bridge2.getNotifier()) {
      bridge2.getNotifier()!.handleLogUpdate('Window 2 promoted!');
      await bridge2.getNotifier()!.flushThrottleBuffer();
      assert.strictEqual(
        bridge2Bot.sendMessageCalls.length,
        1,
        'Promoted Bridge 2 creates live message container'
      );
    }

    await bridge2.stop();
    console.log('  ✓ Multi-window TelegramBridge coordinator cleanly manages election, standby muting, and takeover.');
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }

  // Dispose notifiers
  notifierLeader.dispose();
  notifierStandby.dispose();

  console.log('\n================================================================');
  console.log(' All Phase 02 Single-Leader Delivery Gating assertions PASSED! ');
  console.log('================================================================\n');
}

runPhase02SingleLeaderTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test failed with error:', err);
    process.exit(1);
  });
