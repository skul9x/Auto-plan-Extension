// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const channelLines: string[] = [];
const executedCommands: Array<{ command: string; args: any[] }> = [];
const mockConfigStore: Record<string, any> = {
  'autoplan.telegramEnabled': true,
  'autoplan.telegram.allowedUsers': [98765],
  'autoplan.telegram.throttleMs': 50,
  'autoplan.telegram.liveProgressMode': 'final_only',
  'autoplan.longPhaseNudgeEnabled': false,
  'autoplan.longPhaseThresholdSeconds': 180,
  'autoplan.sendDelayMs': 50
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
        executeCommand: async (cmd: string, ...args: any[]) => {
          executedCommands.push({ command: cmd, args });
          return undefined;
        }
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
import { EventEmitter } from 'events';
import { ThrottledNotifier } from '../telegramNotifier';
import { TelegramBridge } from '../telegramBridge';
import { Orchestrator, PhaseItem } from '../orchestrator';
import { PromptDispatcher, DispatchOptions, DispatchResult } from '../promptDispatcher';
import { PromptOriginTracker } from '../promptOriginTracker';
import { getConfig, AutoPlanConfig, DEFAULT_CONFIG } from '../config';
import { DebugLogger } from '../debugLogger';

class MockTelegramBot {
  public sendMessageCalls: Array<{ chatId: any; text: string; options?: any }> = [];
  public editMessageTextCalls: Array<{ chatId: any; messageId: number; text: string; options?: any }> = [];
  public unpinCalls: Array<{ chatId: any; messageId: number }> = [];
  public chatActionCalls: Array<{ chatId: any; action: string }> = [];
  public setMyCommandsCalls: Array<{ commands: any[] }> = [];

  public shouldFailHtmlParseOnNextSendMessage = false;
  private currentMsgId = 1000;

  public api = {
    sendMessage: async (chatId: any, text: string, options?: any) => {
      if (this.shouldFailHtmlParseOnNextSendMessage && options?.parse_mode === 'HTML') {
        this.shouldFailHtmlParseOnNextSendMessage = false;
        const parseErr: any = new Error("Bad Request: can't parse entities in message text");
        parseErr.description = "Bad Request: can't parse entities: Unsupported start tag at byte offset 15";
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

class MockPromptDispatcherForRegression extends EventEmitter {
  public stopActiveGenerationCalls: Array<{ options?: DispatchOptions }> = [];
  public dispatchPromptCalls: Array<{ prompt: string; options?: DispatchOptions }> = [];

  public async stopActiveGeneration(options?: DispatchOptions): Promise<boolean> {
    this.stopActiveGenerationCalls.push({ options });
    return true;
  }

  public async dispatchPrompt(prompt: string, options?: DispatchOptions): Promise<DispatchResult> {
    this.dispatchPromptCalls.push({ prompt, options });
    return {
      success: true,
      tier: 'nativeCommand',
      durationMs: 25,
      commandId: 'mock-dispatch'
    };
  }

  public reset(): void {
    this.stopActiveGenerationCalls = [];
    this.dispatchPromptCalls = [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createDummyPhase(index: number, fileName: string): PhaseItem {
  const fullPath = path.resolve(process.cwd(), 'plans', fileName);
  return {
    index,
    phaseNumber: index + 1,
    fileName,
    filePath: fullPath,
    nativePath: fullPath,
    normalizedPath: fullPath.replace(/\\/g, '/'),
    status: 'Pending'
  };
}

async function runPhase04RegressionTests(): Promise<void> {
  console.log('========================================================================');
  console.log(' Phase 04: Full End-to-End Regression & VSIX Release Verification');
  console.log('========================================================================\n');

  const silentLogger = new DebugLogger();
  const testChatId = 98765;

  // ==========================================================================
  // [1] Verify Package Metadata, Schema Declarations & Documentation (FR-03, FR-04)
  // ==========================================================================
  console.log('[Step 1] Verifying Package Metadata, Schema Declarations & Documentation...');
  {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    // Check bumped version
    assert.strictEqual(pkgJson.version, '1.7.4', 'package.json version must be bumped to 1.7.4');

    const props = pkgJson.contributes?.configuration?.properties;
    assert.ok(props, 'package.json contributes.configuration.properties must exist');

    // Check autoplan.longPhaseNudgeEnabled default false
    const nudgeProp = props['autoplan.longPhaseNudgeEnabled'];
    assert.ok(nudgeProp, 'autoplan.longPhaseNudgeEnabled must be registered in package.json');
    assert.strictEqual(nudgeProp.type, 'boolean');
    assert.strictEqual(nudgeProp.default, false, 'autoplan.longPhaseNudgeEnabled default must be false');

    // Check autoplan.telegram.liveProgressMode
    const liveProgressProp = props['autoplan.telegram.liveProgressMode'];
    assert.ok(liveProgressProp, 'autoplan.telegram.liveProgressMode must be registered in package.json');
    assert.strictEqual(liveProgressProp.type, 'string');
    assert.strictEqual(liveProgressProp.default, 'final_only', 'liveProgressMode default must be final_only');
    assert.deepStrictEqual(liveProgressProp.enum, ['final_only', 'live_edit']);

    // Check README.md
    const readmeContent = fs.readFileSync(path.resolve(process.cwd(), 'README.md'), 'utf8');
    assert.ok(readmeContent.includes('version-1.7.4-blue.svg'), 'README.md must have version 1.7.4 badge');
    assert.ok(readmeContent.includes('autoplan.telegram.liveProgressMode'), 'README.md must document liveProgressMode');
    assert.ok(
      readmeContent.includes('Telegram Single-Leader Gating & Clean Delivery (v1.7.4)'),
      'README.md must feature v1.7.4 Single-Leader Gating'
    );
    assert.ok(
      readmeContent.includes('`autoplan.longPhaseNudgeEnabled` | `boolean` | `false`'),
      'README.md configuration reference must document longPhaseNudgeEnabled default false'
    );

    // Check CHANGELOG.md
    const changelogContent = fs.readFileSync(path.resolve(process.cwd(), 'CHANGELOG.md'), 'utf8');
    assert.ok(changelogContent.includes('## [1.7.4] - 2026-11-05'), 'CHANGELOG.md must contain [1.7.4] section');
    assert.ok(
      changelogContent.includes('Single-Leader Delivery Gating & Standby Muting'),
      'CHANGELOG.md must detail Single-Leader gating'
    );
    assert.ok(
      changelogContent.includes('Clean Final-Only Delivery Mode & Typing State Lifecycle'),
      'CHANGELOG.md must detail Clean Final-Only Delivery Mode'
    );
    assert.ok(
      changelogContent.includes('Deactivated 180s Mid-Flight Nudge Watchdog by Default'),
      'CHANGELOG.md must detail Nudge Watchdog deactivation'
    );

    console.log('  ✓ Version 1.7.4 metadata, package schemas, README, and CHANGELOG verified.');
  }

  // ==========================================================================
  // [2] Verify Native Antigravity Dispatch Tier (FR-02)
  // ==========================================================================
  console.log('\n[Step 2] Verifying Native Antigravity Dispatch Tier execution...');
  {
    executedCommands.length = 0;
    const nativeDispatcher = new PromptDispatcher({
      logger: silentLogger,
      configProvider: () => getConfig(),
      commandExecutor: async (cmd: string, ...args: any[]) => {
        executedCommands.push({ command: cmd, args });
        return undefined;
      }
    });

    // 1. Dispatch with newConversation = true
    const dispatchRes1 = await nativeDispatcher.dispatchPrompt('Implement phase 04 regression suite', {
      newConversation: true,
      sendDelayMs: 20
    });
    assert.strictEqual(dispatchRes1.success, true, 'Native dispatch with newConversation must succeed');
    assert.strictEqual(dispatchRes1.tier, 'nativeCommand', 'Tier must be nativeCommand');

    // Assert sequence: antigravity.startNewConversation -> antigravity.addContext -> antigravity.triggerSend
    const cmdNames1 = executedCommands.map((c) => c.command);
    assert.ok(cmdNames1.includes('antigravity.startNewConversation'), 'Must execute startNewConversation');
    assert.ok(cmdNames1.includes('antigravity.addContext'), 'Must execute addContext');
    assert.ok(cmdNames1.includes('antigravity.triggerSend'), 'Must execute triggerSend');

    const addContextCall = executedCommands.find((c) => c.command === 'antigravity.addContext');
    assert.strictEqual(
      addContextCall?.args[0],
      'Implement phase 04 regression suite',
      'addContext must be called with the target prompt'
    );

    // 2. Dispatch subsequent prompt without newConversation
    executedCommands.length = 0;
    const dispatchRes2 = await nativeDispatcher.dispatchPrompt('Follow up step prompt', {
      newConversation: false,
      sendDelayMs: 20
    });
    assert.strictEqual(dispatchRes2.success, true);
    const cmdNames2 = executedCommands.map((c) => c.command);
    assert.strictEqual(
      cmdNames2.includes('antigravity.startNewConversation'),
      false,
      'Subsequent dispatch must NOT call startNewConversation'
    );
    assert.ok(cmdNames2.includes('antigravity.addContext'), 'Must execute addContext');
    assert.ok(cmdNames2.includes('antigravity.triggerSend'), 'Must execute triggerSend');

    // 3. Stop active generation
    executedCommands.length = 0;
    const stopRes = await nativeDispatcher.stopActiveGeneration();
    assert.strictEqual(stopRes, true);
    const stopCmds = executedCommands.map((c) => c.command);
    assert.ok(
      stopCmds.includes('antigravity.prioritized.chat.stop') || stopCmds.includes('workbench.action.chat.stop'),
      'stopActiveGeneration must invoke native stop chat command'
    );

    console.log('  ✓ Native Antigravity dispatch commands (addContext, triggerSend, stop) verified.');
  }

  // ==========================================================================
  // [3] Initialize Multi-Window Mock Environment (Leader + Follower) with Bot
  // ==========================================================================
  console.log('\n[Step 3] Initializing Multi-Window Environment (Leader + Standby)...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-phase04-test-'));
  const customRegistryPath = path.join(tmpDir, 'ag-autoplan-ports.json');

  const botLeader = new MockTelegramBot();
  const botStandby = new MockTelegramBot();

  const bridgeLeader = new TelegramBridge({
    windowKey: 'window-leader-w1',
    token: '123456:mock-token-leader',
    registryPath: customRegistryPath,
    botFactory: () => botLeader as any,
    allowedUsers: [testChatId],
    logger: silentLogger
  });

  const bridgeStandby = new TelegramBridge({
    windowKey: 'window-standby-w2',
    token: '123456:mock-token-standby',
    registryPath: customRegistryPath,
    botFactory: () => botStandby as any,
    allowedUsers: [testChatId],
    logger: silentLogger
  });

  // Start leader first
  await bridgeLeader.start();
  assert.strictEqual(bridgeLeader.getIsLeader(), true, 'Window 1 must be elected as Leader');

  // Start standby second
  await bridgeStandby.start();
  assert.strictEqual(bridgeStandby.getIsLeader(), false, 'Window 2 must recognize active leader and enter Standby');

  const notifierLeader = new ThrottledNotifier({
    bot: botLeader as any,
    chatIds: [testChatId],
    throttleMs: 30,
    typingIntervalMs: 60,
    logger: silentLogger,
    isLeader: true,
    liveProgressMode: 'final_only'
  });

  const notifierStandby = new ThrottledNotifier({
    bot: botStandby as any,
    chatIds: [testChatId],
    throttleMs: 30,
    typingIntervalMs: 60,
    logger: silentLogger,
    isLeader: false,
    liveProgressMode: 'final_only'
  });

  assert.strictEqual(notifierLeader.isLeader, true);
  assert.strictEqual(notifierLeader.getLiveProgressMode(), 'final_only');
  assert.strictEqual(notifierStandby.isLeader, false);
  assert.strictEqual(notifierStandby.getLiveProgressMode(), 'final_only');
  console.log('  ✓ Multi-window leader election & notifier gating state initialized.');

  // ==========================================================================
  // [4] Full Phase Lifecycle Simulation with > 200s Virtual Time (FR-01)
  // ==========================================================================
  console.log('\n[Step 4] Executing Phase Run with > 200s Virtual Time & Stream Simulation...');
  {
    botLeader.reset();
    botStandby.reset();

    const mockDispatcherLeader = new MockPromptDispatcherForRegression();
    const mockDispatcherStandby = new MockPromptDispatcherForRegression();

    const originTrackerLeader = new PromptOriginTracker({ autoPrune: false });
    const originTrackerStandby = new PromptOriginTracker({ autoPrune: false });

    const baseConfig = getConfig();
    assert.strictEqual(
      baseConfig.longPhaseNudgeEnabled,
      false,
      'longPhaseNudgeEnabled must default to false in configuration'
    );

    const orchestratorLeader = new Orchestrator({
      configProvider: () => baseConfig,
      promptDispatcher: mockDispatcherLeader as any,
      debugLogger: silentLogger
    });
    orchestratorLeader.setPromptOriginTracker(originTrackerLeader);

    const orchestratorStandby = new Orchestrator({
      configProvider: () => baseConfig,
      promptDispatcher: mockDispatcherStandby as any,
      debugLogger: silentLogger
    });
    orchestratorStandby.setPromptOriginTracker(originTrackerStandby);

    let leaderNudgeEventCount = 0;
    let standbyNudgeEventCount = 0;
    orchestratorLeader.on('phaseNudged', () => { leaderNudgeEventCount++; });
    orchestratorStandby.on('phaseNudged', () => { standbyNudgeEventCount++; });

    const phase = createDummyPhase(0, 'phase-04-regression.md');

    // 4.1 Phase Start Lifecycle
    await notifierStandby.handlePhaseStart(phase, 0, 1);
    await notifierLeader.handlePhaseStart(phase, 0, 1);

    // Standby should have emitted NOTHING
    assert.strictEqual(botStandby.sendMessageCalls.length, 0, 'Standby must emit 0 start messages');
    assert.strictEqual(botStandby.chatActionCalls.length, 0, 'Standby must emit 0 chat actions');

    // 4.2 Start Nudge Watchdogs on both windows
    orchestratorLeader.startPhaseNudgeWatchdog(phase, 0);
    orchestratorStandby.startPhaseNudgeWatchdog(phase, 0);

    // Since longPhaseNudgeEnabled is false, no timer must be active
    assert.strictEqual(
      orchestratorLeader.isPhaseNudgeTimerActive(),
      false,
      'Leader watchdog timer must NOT be scheduled'
    );
    assert.strictEqual(
      orchestratorStandby.isPhaseNudgeTimerActive(),
      false,
      'Standby watchdog timer must NOT be scheduled'
    );

    // 4.3 Virtual Time Progression: Advance beyond 180s (e.g. 210 seconds virtual time)
    console.log('    -> Simulating virtual time passage (> 200 seconds virtual time)...');
    let virtualElapsedTimeSec = 0;
    const targetVirtualTimeSec = 210; // > 200s virtual time

    while (virtualElapsedTimeSec < targetVirtualTimeSec) {
      virtualElapsedTimeSec += 30; // tick 30s virtual intervals
      // Stream intermediate logs during active execution
      notifierStandby.handleLogUpdate(`[Standby] Analyzing workspace AST at t=${virtualElapsedTimeSec}s...`);
      notifierLeader.handleLogUpdate(`[Leader] Executing TypeScript compilation at t=${virtualElapsedTimeSec}s...`);
      await sleep(75); // Allow typing ticker tick (typingIntervalMs is 60ms)
    }

    // Flush throttle buffers
    await notifierStandby.flushThrottleBuffer();
    await notifierLeader.flushThrottleBuffer();

    // Verify Nudge Invariant: 0 nudge prompts injected after > 200s virtual time
    assert.strictEqual(
      mockDispatcherLeader.dispatchPromptCalls.length,
      0,
      'Leader promptDispatcher must have 0 nudge prompts injected'
    );
    assert.strictEqual(
      mockDispatcherStandby.dispatchPromptCalls.length,
      0,
      'Standby promptDispatcher must have 0 nudge prompts injected'
    );
    assert.strictEqual(
      mockDispatcherLeader.stopActiveGenerationCalls.length,
      0,
      'Leader stopActiveGeneration must NOT be triggered by nudge'
    );
    assert.strictEqual(leaderNudgeEventCount, 0, 'Leader must emit 0 phaseNudged events');
    assert.strictEqual(standbyNudgeEventCount, 0, 'Standby must emit 0 phaseNudged events');
    assert.strictEqual(phase.hasNudged, undefined, 'phase.hasNudged flag must remain undefined');
    assert.strictEqual(
      originTrackerLeader.size(),
      0,
      'originTrackerLeader must have 0 tracked nudge prompts'
    );
    assert.strictEqual(
      originTrackerStandby.size(),
      0,
      'originTrackerStandby must have 0 tracked nudge prompts'
    );
    console.log('    ✓ 0 nudge prompts injected, 0 watchdog timers active across > 200s virtual execution.');

    // Verify Standby Invariant: Completely silent on Telegram
    assert.strictEqual(
      botStandby.sendMessageCalls.length,
      0,
      'Standby bot must have 0 sendMessage calls'
    );
    assert.strictEqual(
      botStandby.editMessageTextCalls.length,
      0,
      'Standby bot must have 0 editMessageText calls'
    );
    assert.strictEqual(
      botStandby.chatActionCalls.length,
      0,
      'Standby bot must have 0 chatActionCalls'
    );
    assert.strictEqual(
      notifierStandby.getLiveMessageMap().size,
      0,
      'Standby notifier liveMessageMap must remain empty'
    );
    console.log('    ✓ Standby window remained completely silent (0 Telegram calls emitted).');

    // Verify Leader Invariant: Active typing indicator, 0 intermediate duplicate live messages
    const intermediateProgressMessages = botLeader.sendMessageCalls.filter((c) =>
      !c.text.includes('Phase Started')
    );
    assert.strictEqual(
      intermediateProgressMessages.length,
      0,
      'In final_only mode, Leader must NOT send intermediate progress messages'
    );
    assert.strictEqual(
      botLeader.editMessageTextCalls.length,
      0,
      'In final_only mode, Leader must NOT send intermediate editMessageText calls'
    );
    assert.strictEqual(
      notifierLeader.getLiveMessageMap().size,
      0,
      'In final_only mode, Leader must NOT maintain live progress message containers'
    );
    assert.strictEqual(
      notifierLeader.isTyping(),
      true,
      'Leader notifier typing indicator must be active during ongoing execution'
    );
    assert.ok(
      botLeader.chatActionCalls.length >= 2,
      `Leader bot must have dispatched periodic typing actions (got ${botLeader.chatActionCalls.length})`
    );
    assert.ok(
      botLeader.chatActionCalls.every((c) => c.chatId === testChatId && c.action === 'typing'),
      'All chatActionCalls must be typing actions directed to testChatId'
    );
    console.log(`    ✓ Leader issued continuous typing indicators (${botLeader.chatActionCalls.length} pings) without duplicate live message spam.`);

    // 4.4 Phase Completion Lifecycle
    console.log('    -> Simulating phase completion on both windows...');
    const completionResult = {
      summary: 'Phase 04 Regression verified with 100% assertions satisfied',
      durationMs: 210000
    };

    // Complete on standby (should do nothing on Telegram)
    await notifierStandby.handlePhaseComplete(phase, completionResult, 1, 1);
    assert.strictEqual(
      botStandby.sendMessageCalls.length,
      0,
      'Standby must still emit 0 messages on phase completion'
    );

    // Complete on leader
    await notifierLeader.handlePhaseComplete(phase, completionResult, 1, 1);

    // Assert typing indicator is immediately halted
    assert.strictEqual(
      notifierLeader.isTyping(),
      false,
      'Leader typing indicator must be stopped upon phase completion'
    );

    // Assert exactly ONE final completion message was dispatched
    const completionMessages = botLeader.sendMessageCalls.filter((c) =>
      c.text.includes('Phase Completed')
    );
    assert.strictEqual(
      completionMessages.length,
      1,
      'Leader must dispatch exactly one completion message upon phase completion'
    );

    const completionMsg = completionMessages[0];
    assert.strictEqual(completionMsg.chatId, testChatId);
    assert.strictEqual(
      completionMsg.options?.parse_mode,
      'HTML',
      'Final delivery message must use parse_mode HTML'
    );
    assert.ok(
      completionMsg.text.includes('Phase Completed') && completionMsg.text.includes('phase-04-regression.md'),
      'Final completion message must mention the completed phase name'
    );
    assert.ok(
      completionMsg.text.includes('<b>') || completionMsg.text.includes('<code>'),
      'Final completion message must be formatted with Rich Telegram HTML tags'
    );
    console.log('    ✓ Typing stopped and exactly 1 Rich HTML completion message delivered.');
  }

  // ==========================================================================
  // [5] Validate Fallback Behavior: HTTP 400 Zero-Drop Plain-Text Fallback
  // ==========================================================================
  console.log('\n[Step 5] Validating Zero-Drop Plain-Text Fallback on Telegram HTTP 400...');
  {
    botLeader.reset();
    botLeader.shouldFailHtmlParseOnNextSendMessage = true;

    const fallbackPhase = createDummyPhase(1, 'phase-04-entity-fallback.md');
    const fallbackResult = {
      summary: 'Testing HTML parse error recovery: <unclosed-tag> & raw artifacts',
      durationMs: 5000
    };

    await notifierLeader.handlePhaseComplete(fallbackPhase, fallbackResult, 2, 2);

    assert.strictEqual(
      botLeader.sendMessageCalls.length,
      1,
      'Fallback message must be sent via zero-drop handler despite HTTP 400 error'
    );

    const fallbackMsg = botLeader.sendMessageCalls[0];
    assert.strictEqual(fallbackMsg.chatId, testChatId);
    assert.strictEqual(
      fallbackMsg.options?.parse_mode,
      undefined,
      'Fallback message must be delivered as plain text (parse_mode undefined)'
    );
    assert.ok(
      fallbackMsg.text.includes('Phase Completed: phase-04-entity-fallback.md'),
      'Fallback message must contain intact completion content'
    );
    console.log('  ✓ Zero-drop fallback successfully recovered from simulated HTTP 400 entity parse error.');
  }

  // ==========================================================================
  // [6] Backward Compatibility & Leadership Takeover (NFR-01)
  // ==========================================================================
  console.log('\n[Step 6] Validating Backward Compatibility, live_edit Mode & Dynamic Leadership Takeover...');
  {
    // 6.1 Verify live_edit mode still functions for users opting in
    botLeader.reset();
    const liveEditNotifier = new ThrottledNotifier({
      bot: botLeader as any,
      chatIds: [testChatId],
      throttleMs: 30,
      logger: silentLogger,
      isLeader: true,
      liveProgressMode: 'live_edit'
    });

    liveEditNotifier.handleLogUpdate('Running cargo test...');
    await liveEditNotifier.flushThrottleBuffer();
    assert.strictEqual(
      botLeader.sendMessageCalls.length,
      1,
      'In live_edit mode, Leader must create live status message container'
    );
    assert.strictEqual(liveEditNotifier.getLiveMessageMap().size, 1);

    liveEditNotifier.handleLogUpdate('Test pass 12/12');
    await liveEditNotifier.flushThrottleBuffer();
    assert.strictEqual(
      botLeader.editMessageTextCalls.length,
      1,
      'In live_edit mode, Leader must update message container via editMessageText'
    );
    liveEditNotifier.dispose();
    console.log('  ✓ live_edit mode backward compatibility confirmed.');

    // 6.2 Leadership Takeover: Window 1 stops, Window 2 promotes to Leader
    botStandby.reset();
    await bridgeLeader.stop();
    assert.strictEqual(bridgeLeader.getIsLeader(), false, 'Bridge 1 must surrender leadership on stop');

    const takeoverAcquired = bridgeStandby.tryAcquireLeadership();
    assert.strictEqual(takeoverAcquired, true, 'Bridge 2 must successfully acquire leadership');
    notifierStandby.setLeader(true);
    assert.strictEqual(notifierStandby.isLeader, true, 'Notifier 2 is unmuted after promotion');

    notifierStandby.handleLogUpdate('Window 2 has taken leadership!');
    await notifierStandby.flushThrottleBuffer();

    // Since notifierStandby is in final_only mode, it starts typing
    assert.strictEqual(notifierStandby.isTyping(), true, 'Promoted Window 2 is actively typing');
    await notifierStandby.handlePhaseComplete(
      createDummyPhase(2, 'phase-04-takeover.md'),
      { summary: 'Takeover success' },
      3,
      3
    );
    assert.strictEqual(
      botStandby.sendMessageCalls.length,
      1,
      'Promoted Window 2 successfully delivers completion message to Telegram'
    );
    console.log('  ✓ Dynamic leadership takeover from Window 1 to Window 2 verified.');

    await bridgeStandby.stop();
  }

  // Cleanup temporary resources
  notifierLeader.dispose();
  notifierStandby.dispose();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  console.log('\n========================================================================');
  console.log(' All Phase 04 Full End-to-End Regression assertions PASSED successfully!');
  console.log('========================================================================\n');
}

runPhase04RegressionTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Phase 04 Regression test failed:', err);
    process.exit(1);
  });
