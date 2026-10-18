// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const channelLines: string[] = [];
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
import { EventEmitter } from 'events';
import {
  PromptOriginTracker,
  promptOriginTracker as defaultPromptOriginTracker,
  trackNudgePrompt,
  getOrigin,
  formatNudgePrompt,
  formatPcPrompt,
  Origin,
  PromptOrigin
} from '../promptOriginTracker';
import {
  TelegramChatMirror,
  TelegramChatMirrorOptions
} from '../telegramChatMirror';
import {
  PromptDispatcher,
  DispatchOptions,
  DispatchResult
} from '../promptDispatcher';
import {
  BridgeServer,
  CommandOptions,
  CommandAckResult
} from '../bridgeServer';
import {
  Orchestrator,
  PhaseItem
} from '../orchestrator';
import { DebugLogger } from '../debugLogger';
import { TranscriptTailEngine } from '../transcriptTailEngine';

interface MockSentMessage {
  chatId: string | number;
  text: string;
  options?: any;
}

function createMockTelegramBot() {
  const sentMessages: MockSentMessage[] = [];
  const bot: any = {
    sentMessages,
    api: {
      sendMessage: async (chatId: string | number, text: string, options?: any) => {
        sentMessages.push({ chatId, text, options });
        return { message_id: sentMessages.length, chat: { id: chatId }, text };
      },
      sendChatAction: async () => true
    },
    sendMessage: async (chatId: string | number, text: string, options?: any) => {
      sentMessages.push({ chatId, text, options });
      return { message_id: sentMessages.length, chat: { id: chatId }, text };
    }
  };
  return bot;
}

class MockBridgeServerForPhase03 {
  public promptCommands: Array<{ prompt: string; options?: CommandOptions }> = [];
  public newConversationCommands: Array<{ options?: any }> = [];
  public isListeningState: boolean = true;
  public clientsCount: number = 1;

  public isListening(): boolean {
    return this.isListeningState;
  }

  public getConnectedClients(): any[] {
    return new Array(this.clientsCount).fill({ id: 'c1' });
  }

  public getPort(): number {
    return 48765;
  }

  public getWindowKey(): string {
    return 'win-main';
  }

  public getActiveWindowKey(): string {
    return 'win-main';
  }

  public getWorkspaceName(): string {
    return 'test-ws';
  }

  public async probeActiveClients(): Promise<number> {
    return this.clientsCount;
  }

  public async dispatchPromptCommand(prompt: string, options?: CommandOptions): Promise<CommandAckResult> {
    this.promptCommands.push({ prompt, options });
    return {
      success: true,
      commandId: `cmd-${Date.now()}`,
      status: 'completed',
      durationMs: 15
    };
  }

  public async dispatchNewConversationCommand(options?: any): Promise<CommandAckResult> {
    this.newConversationCommands.push({ options });
    return {
      success: true,
      commandId: `conv-${Date.now()}`,
      status: 'completed',
      durationMs: 20
    };
  }
}

async function runPhase03PromptInjectionAndOriginTrackingTests(): Promise<void> {
  console.log('========================================================================');
  console.log(' Phase 03: Mid-Flight Prompt Injection & Origin Tracking Integration Test');
  console.log('========================================================================\n');

  // -------------------------------------------------------------------------
  // [Test 1] PromptOriginTracker: SYSTEM_NUDGE Classification & Deduplication
  // -------------------------------------------------------------------------
  console.log('[Test 1] Verifying PromptOriginTracker SYSTEM_NUDGE origin tracking...');
  {
    const tracker = new PromptOriginTracker({ autoPrune: false, ttlMs: 60000 });

    // Verify constants
    assert.strictEqual(Origin.SYSTEM_NUDGE, 'system_nudge');
    assert.strictEqual(Origin.TELEGRAM, 'telegram');
    assert.strictEqual(Origin.PC, 'pc');

    const nudgeText = 'Search online to find the best practices. Note, do not open a browser.';

    // Before tracking: unregistered prompt resolves to 'pc'
    assert.strictEqual(tracker.getOrigin(nudgeText), 'pc', '1A: Unregistered prompt must resolve to pc');

    // Track as system nudge
    const hash = tracker.trackNudgePrompt(nudgeText);
    assert.ok(hash && hash.length === 64, '1B: trackNudgePrompt returns 64-char sha256 hash');
    assert.strictEqual(tracker.size(), 1, '1C: Buffer size is 1');

    // peekOrigin inspects without consuming
    assert.strictEqual(tracker.peekOrigin(nudgeText), 'system_nudge', '1D: peekOrigin returns system_nudge');
    assert.strictEqual(tracker.size(), 1, '1E: peekOrigin does not consume entry');

    // getOrigin consumes matching entry
    assert.strictEqual(tracker.getOrigin(nudgeText), 'system_nudge', '1F: getOrigin returns system_nudge');
    assert.strictEqual(tracker.size(), 0, '1G: getOrigin consumed entry from ring buffer');

    // Subsequent getOrigin reverts to 'pc' (consumed!)
    assert.strictEqual(tracker.getOrigin(nudgeText), 'pc', '1H: Consumed entry reverts to pc');

    // Test Telegram prompt registration & consumption
    const telePrompt = 'Help me refactor auth';
    tracker.registerTelegramPrompt(telePrompt);
    assert.strictEqual(tracker.getOrigin(telePrompt), 'telegram', '1I: Telegram prompt resolves to telegram');
    assert.strictEqual(tracker.getOrigin(telePrompt), 'pc', '1J: Consumed telegram prompt reverts to pc');

    // Test TTL expiry (deterministic timestamps)
    const baseTime = 1000000;
    tracker.trackNudgePrompt('Nudge prompt with TTL', baseTime);
    assert.strictEqual(tracker.getOrigin('Nudge prompt with TTL', baseTime + 30000), 'system_nudge', '1K: Within 60s TTL matches');

    tracker.trackNudgePrompt('Nudge prompt expired', baseTime);
    assert.strictEqual(tracker.getOrigin('Nudge prompt expired', baseTime + 65000), 'pc', '1L: After 60s TTL expires to pc');

    // Test singleton convenience helpers
    defaultPromptOriginTracker.clear();
    const globalNudge = 'Global singleton nudge prompt';
    trackNudgePrompt(globalNudge);
    assert.strictEqual(getOrigin(globalNudge), 'system_nudge', '1M: Top-level trackNudgePrompt & getOrigin work on singleton');
    assert.strictEqual(getOrigin(globalNudge), 'pc', '1N: Consumed singleton entry reverts to pc');

    // Test formatNudgePrompt helper
    const formatted = formatNudgePrompt('Check the documentation');
    assert.strictEqual(formatted, '🤖 [Auto-Plan Nudge]: Check the documentation', '1O: formatNudgePrompt formats properly');

    console.log('  ✓ PromptOriginTracker origin classification, consumption, TTL & formatting verified.');
  }

  // -------------------------------------------------------------------------
  // [Test 2] PromptDispatcher: Mid-Flight Injection (openNewConversation: false)
  // -------------------------------------------------------------------------
  console.log('\n[Test 2] Verifying PromptDispatcher mid-flight injection without new chat reset...');
  {
    const executedCommands: string[] = [];
    const customExecutor = async (cmd: string, ...args: any[]) => {
      executedCommands.push(cmd);
      return undefined;
    };

    const mockBridge = new MockBridgeServerForPhase03();
    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridge as any,
      commandExecutor: customExecutor,
      configProvider: () => ({
        executionMode: 'domBridge',
        allowTierFallback: false,
        bridgeTimeoutMs: 1000
      } as any)
    });

    const steeringPrompt = 'Search online to find the best practices.';

    // Case 2A: Mid-flight steering dispatch with openNewConversation: false
    const startT1 = Date.now();
    const resT1 = await dispatcher.dispatchPrompt(steeringPrompt, {
      openNewConversation: false
    });
    const elapsedT1 = Date.now() - startT1;

    assert.strictEqual(resT1.success, true, '2A: Mid-flight dispatch succeeds');
    assert.strictEqual(mockBridge.promptCommands.length, 1, '2B: Prompt sent to BridgeServer');
    assert.strictEqual(mockBridge.promptCommands[0].prompt, steeringPrompt, '2C: Prompt text matches');
    assert.strictEqual(
      mockBridge.promptCommands[0].options?.extra?.openNewConversation,
      false,
      '2D: commandOpts.extra.openNewConversation is false'
    );
    assert.strictEqual(mockBridge.newConversationCommands.length, 0, '2E: No DOM new chat command triggered');
    assert.ok(
      !executedCommands.includes('antigravity.prioritized.chat.openNewConversation') &&
      !executedCommands.includes('workbench.action.chat.newChat'),
      '2F: No VS Code openNewConversation commands executed'
    );
    assert.ok(elapsedT1 < 300, `2G: Skipped 450ms stabilization delay (elapsed ${elapsedT1}ms)`);

    // Case 2B: Native Command tier with openNewConversation: false
    executedCommands.length = 0;
    const nativeDispatcher = new PromptDispatcher({
      commandExecutor: customExecutor,
      configProvider: () => ({
        executionMode: 'nativeCommand',
        allowTierFallback: false
      } as any)
    });

    const resNative = await nativeDispatcher.dispatchPrompt(steeringPrompt, {
      openNewConversation: false
    });
    assert.strictEqual(resNative.success, true, '2H: Native command dispatch succeeds');
    assert.ok(!executedCommands.includes('antigravity.prioritized.chat.openNewConversation'), '2I: No new conversation opened');
    assert.ok(executedCommands.includes('antigravity.sendTextToChat'), '2J: Directly executed sendTextToChat');

    // Case 2C: Contrast with openNewConversation: true (fresh session)
    mockBridge.promptCommands.length = 0;
    mockBridge.newConversationCommands.length = 0;
    executedCommands.length = 0;

    await dispatcher.dispatchPrompt('Initial plan prompt', {
      openNewConversation: true
    });
    assert.ok(
      executedCommands.includes('antigravity.prioritized.chat.openNewConversation'),
      '2K: Fresh phase dispatches openNewConversation command'
    );

    console.log('  ✓ PromptDispatcher seamlessly injects mid-flight prompts preserving conversation continuity.');
  }

  // -------------------------------------------------------------------------
  // [Test 3] TelegramChatMirror: System Nudge Attribution & Echo Suppression
  // -------------------------------------------------------------------------
  console.log('\n[Test 3] Verifying TelegramChatMirror system nudge attribution & echo suppression...');
  {
    const bot = createMockTelegramBot();
    const tracker = new PromptOriginTracker({ autoPrune: false });
    const mirror = new TelegramChatMirror({
      bot,
      allowedUsers: [123456],
      promptOriginTracker: tracker,
      enableChatMirror: true,
      mirrorIncludePcPrompts: true
    });

    const nudgeText = 'Search online to find the best practices. Note, do not open a browser.';

    // Register steering prompt in tracker
    tracker.trackNudgePrompt(nudgeText);

    // Case 3A: When steering prompt arrives from transcript tail
    const mirrorRes = await mirror.handleUserInput(nudgeText);
    assert.strictEqual(mirrorRes.forwarded, true, '3A: Steering prompt mirrored to Telegram');
    assert.strictEqual(mirrorRes.origin, 'system_nudge', '3B: Origin classified as system_nudge');
    assert.strictEqual(bot.sentMessages.length, 1, '3C: 1 Telegram message sent');
    assert.strictEqual(
      bot.sentMessages[0].text,
      `🤖 [Auto-Plan Nudge]: ${nudgeText}`,
      '3D: Message formatted with 🤖 [Auto-Plan Nudge] header'
    );
    assert.ok(
      !bot.sentMessages[0].text.includes('💻 You (on PC):'),
      '3E: System nudge does NOT contain PC keyboard header'
    );

    // Case 3B: Echo suppression - immediate duplicate transcript entry
    bot.sentMessages.length = 0;
    const echoRes = await mirror.handleUserInput(nudgeText);
    // Since entry was consumed, second turn resolves as PC prompt or normal forward without infinite loop
    assert.strictEqual(echoRes.forwarded, true, '3F: Second occurrence forwarded as standard PC input');
    assert.ok(
      bot.sentMessages[0].text.includes('💻 You (on PC):'),
      '3G: Subsequent un-tracked duplicate treated as PC question, not phantom nudge'
    );

    // Case 3C: User prompt from Telegram - must be suppressed from mirror
    bot.sentMessages.length = 0;
    const userTelegramPrompt = 'Please summarize the latest git commit';
    tracker.registerTelegramPrompt(userTelegramPrompt);
    const teleRes = await mirror.handleUserInput(userTelegramPrompt);
    assert.strictEqual(teleRes.forwarded, false, '3H: Telegram prompt suppressed from duplicate send');
    assert.strictEqual(teleRes.origin, 'telegram', '3I: Origin classified as telegram');
    assert.strictEqual(bot.sentMessages.length, 0, '3J: No duplicate message sent to Telegram');

    // Case 3D: Multi-workspace tag preservation on system nudge
    bot.sentMessages.length = 0;
    mirror.setWorkspace('Project-Alpha', true);
    tracker.trackNudgePrompt('Multi-workspace nudge prompt');
    await mirror.handleUserInput('Multi-workspace nudge prompt');
    assert.strictEqual(bot.sentMessages.length, 1, '3K: Message sent for multi-workspace');
    assert.strictEqual(
      bot.sentMessages[0].text,
      '[📁 Project-Alpha] 🤖 [Auto-Plan Nudge]: Multi-workspace nudge prompt',
      '3L: Workspace tag prefixed before nudge header'
    );

    // Case 3E: mirrorIncludePcPrompts: false leaves system nudges active
    bot.sentMessages.length = 0;
    mirror.setWorkspace(undefined, false);
    mirror.setMirrorIncludePcPrompts(false);

    // PC prompt is suppressed
    const pcRes = await mirror.handleUserInput('Human PC question');
    assert.strictEqual(pcRes.forwarded, false, '3M: PC prompt suppressed when mirrorIncludePcPrompts is false');
    assert.strictEqual(bot.sentMessages.length, 0, '3N: No message sent for PC prompt');

    // System nudge is still mirrored
    tracker.trackNudgePrompt('Automated steering nudge');
    const nudgeMirroredRes = await mirror.handleUserInput('Automated steering nudge');
    assert.strictEqual(nudgeMirroredRes.forwarded, true, '3O: System nudge mirrored despite mirrorIncludePcPrompts=false');
    assert.strictEqual(
      bot.sentMessages[0].text,
      '🤖 [Auto-Plan Nudge]: Automated steering nudge',
      '3P: System nudge delivered cleanly'
    );

    console.log('  ✓ TelegramChatMirror correctly formats system nudges and prevents echo anomalies.');
  }

  // -------------------------------------------------------------------------
  // [Test 4] Full Coordination: Orchestrator Nudge Watchdog + Origin + Mirror
  // -------------------------------------------------------------------------
  console.log('\n[Test 4] Verifying End-to-End Orchestrator + Nudge Watchdog + Mirror coordination...');
  {
    const bot = createMockTelegramBot();
    const tracker = new PromptOriginTracker({ autoPrune: false });
    const mirror = new TelegramChatMirror({
      bot,
      allowedUsers: [987654],
      promptOriginTracker: tracker,
      enableChatMirror: true
    });

    const mockTailEngine = new EventEmitter() as any;
    mockTailEngine.isActive = () => true;
    mockTailEngine.start = async () => {};
    mockTailEngine.stop = () => {};
    mirror.attachTailEngine(mockTailEngine);

    const mockBridge = new MockBridgeServerForPhase03();
    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridge as any,
      commandExecutor: async () => undefined,
      configProvider: () => ({
        executionMode: 'domBridge',
        allowTierFallback: false
      } as any)
    });

    let stopCalled = false;
    (dispatcher as any).stopActiveGeneration = async () => {
      stopCalled = true;
      return { success: true, tier: 'domBridge', durationMs: 10 };
    };

    const orchestrator = new Orchestrator({
      promptDispatcher: dispatcher,
      promptOriginTracker: tracker,
      configProvider: () => ({
        longPhaseNudgeEnabled: true,
        longPhaseThresholdSeconds: 1,
        longPhaseNudgeMessage: 'Search online to find the best practices. Use search_web / read_url_content.'
      } as any)
    });

    const phase: PhaseItem = {
      index: 0,
      phaseNumber: 1,
      filePath: '/mock/plans/phase-01.md',
      fileName: 'phase-01.md',
      nativePath: '/mock/plans/phase-01.md',
      normalizedPath: '/mock/plans/phase-01.md',
      status: 'Pending'
    };

    let eventEmitted = false;
    orchestrator.on('phaseNudged', (ev) => {
      eventEmitted = true;
      assert.strictEqual(ev.phase.fileName, 'phase-01.md');
    });

    // Trigger phase nudge
    await orchestrator.triggerPhaseNudge(phase, 0);

    assert.strictEqual(stopCalled, true, '4A: Generation halted before steering injection');
    assert.strictEqual(phase.hasNudged, true, '4B: Phase marked as nudged');
    assert.strictEqual(mockBridge.promptCommands.length, 1, '4C: Steering prompt dispatched to bridge');
    assert.strictEqual(
      mockBridge.promptCommands[0].options?.extra?.openNewConversation,
      false,
      '4D: Dispatched with openNewConversation: false'
    );
    assert.strictEqual(eventEmitted, true, '4E: phaseNudged event emitted');

    // Simulate TranscriptTailEngine detecting the injected prompt in transcript.jsonl
    const injectedText = 'Search online to find the best practices. Use search_web / read_url_content.';
    mockTailEngine.emit('userInput', { prompt: injectedText, timestamp: Date.now() });

    // Allow async listener to complete
    await new Promise((r) => setTimeout(r, 50));

    assert.strictEqual(bot.sentMessages.length, 1, '4F: Chat mirror received transcript event and posted to Telegram');
    assert.strictEqual(
      bot.sentMessages[0].text,
      `🤖 [Auto-Plan Nudge]: ${injectedText}`,
      '4G: Mirror delivered with exact 🤖 [Auto-Plan Nudge] attribution'
    );
    assert.ok(
      !bot.sentMessages[0].text.includes('💻 You (on PC):'),
      '4H: Not attributed as a PC user question'
    );

    mirror.dispose();
    console.log('  ✓ End-to-end Orchestrator nudge watchdog, origin tracking, and Telegram mirror flow verified.');
  }

  console.log('\n========================================================================');
  console.log(' ALL Phase 03 Prompt Injection & Origin Tracking Tests PASSED! 🎉');
  console.log('========================================================================\n');
}

runPhase03PromptInjectionAndOriginTrackingTests().catch((err) => {
  console.error('\n❌ Phase 03 Test Failed:', err);
  process.exit(1);
});
