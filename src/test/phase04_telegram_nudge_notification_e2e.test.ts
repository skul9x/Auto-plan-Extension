// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockActiveTextEditor: any = undefined;
let mockWorkspaceFolders: any[] = [];
const mockConfigStore: Record<string, any> = {};
let executedCommands: string[] = [];

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
        },
        name: 'test-workspace'
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
        createOutputChannel: () => ({
          appendLine: () => {},
          show: () => {},
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
      Uri: {
        file: (p: string) => ({ fsPath: p, scheme: 'file', toString: () => `file://${p}` }),
        joinPath: (base: any, ...segments: string[]) => ({
          fsPath: [base.fsPath, ...segments].join('/'),
          toString: () => `file://${[base.fsPath, ...segments].join('/')}`
        })
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 },
      StatusBarAlignment: { Left: 1, Right: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import { EventEmitter } from 'events';
import { Bot } from 'grammy';
import { TelegramBridge } from '../telegramBridge';
import { ThrottledNotifier, TelegramNotifier } from '../telegramNotifier';
import { TelegramPlanManager } from '../telegramPlanManager';
import { formatPlanStatus } from '../telegramScreen';
import { SidebarProvider } from '../sidebarProvider';
import { Orchestrator, PhaseItem } from '../orchestrator';
import { PromptDispatcher } from '../promptDispatcher';
import { PromptOriginTracker } from '../promptOriginTracker';

interface MockApiCall {
  method: string;
  payload: any;
  timestamp: number;
}

function createMockGrammyBot(token: string = '123456:MOCK_TOKEN_PHASE04'): {
  bot: Bot;
  apiCalls: MockApiCall[];
  sentMessages: any[];
  editedMessages: any[];
} {
  const bot = new Bot(token, {
    botInfo: {
      id: 999888777,
      is_bot: true,
      first_name: 'AutoPlanNudgeBot',
      username: 'autoplan_nudge_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false
    } as any
  });

  const apiCalls: MockApiCall[] = [];
  const sentMessages: any[] = [];
  const editedMessages: any[] = [];
  let nextMessageId = 500;

  bot.api.config.use(async (prev, method, payload, signal) => {
    const record: MockApiCall = {
      method,
      payload: JSON.parse(JSON.stringify(payload || {})),
      timestamp: Date.now()
    };
    apiCalls.push(record);

    if (method === 'sendMessage') {
      const msgId = ++nextMessageId;
      sentMessages.push({ ...record.payload, message_id: msgId });
      return {
        ok: true,
        result: {
          message_id: msgId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: record.payload.chat_id, type: 'private', first_name: 'TestUser' },
          text: record.payload.text
        }
      } as any;
    }

    if (method === 'editMessageText') {
      editedMessages.push(record.payload);
      return {
        ok: true,
        result: {
          message_id: record.payload.message_id,
          date: Math.floor(Date.now() / 1000),
          chat: { id: record.payload.chat_id, type: 'private', first_name: 'TestUser' },
          text: record.payload.text
        }
      } as any;
    }

    return { ok: true, result: true } as any;
  });

  return { bot, apiCalls, sentMessages, editedMessages };
}

async function runPhase04TelegramNudgeNotificationTests(): Promise<void> {
  console.log('========================================================================');
  console.log(' Phase 04: Telegram Nudge Notification & Dashboard State Integration Test');
  console.log('========================================================================\n');

  // Reset default configuration in mockConfigStore
  mockConfigStore['telegramEnabled'] = true;
  mockConfigStore['longPhaseNotifyTelegram'] = true;
  mockConfigStore['longPhaseNudgeEnabled'] = true;
  mockConfigStore['longPhaseThresholdSeconds'] = 180;

  // -------------------------------------------------------------------------
  // [Test 1] Telegram Event Wiring & Notification Delivery Format
  // -------------------------------------------------------------------------
  console.log('[Test 1] Verifying TelegramBridge phaseNudged event subscription & notification format...');
  {
    const { bot, sentMessages } = createMockGrammyBot();
    const authorizedUsers = [111222, 333444];

    const notifier = new ThrottledNotifier({
      bot,
      chatIds: authorizedUsers,
      throttleMs: 50
    });

    // Verify TelegramNotifier alias export
    assert.strictEqual(TelegramNotifier, ThrottledNotifier, '1A: TelegramNotifier must alias ThrottledNotifier');
    assert.strictEqual(typeof notifier.sendInfo, 'function', '1B: notifier.sendInfo must be a function');

    const orchEmitter = new EventEmitter();
    const bridge = new TelegramBridge({
      botFactory: () => bot,
      notifier,
      orchestrator: orchEmitter,
      allowedUsers: authorizedUsers,
      enabled: true
    });

    const mockPhase: PhaseItem = {
      index: 1,
      phaseNumber: 2,
      fileName: 'phase-02-auth-service.md',
      filePath: '/mock/plans/phase-02-auth-service.md',
      nativePath: '/mock/plans/phase-02-auth-service.md',
      normalizedPath: '/mock/plans/phase-02-auth-service.md',
      status: 'Running'
    };

    // Emit phaseNudged event from orchestrator
    orchEmitter.emit('phaseNudged', {
      phase: mockPhase,
      phaseIndex: 1,
      message: 'Search online to find the best practices.'
    });

    // Wait a brief tick for async handler
    await new Promise((r) => setTimeout(r, 60));

    assert.strictEqual(sentMessages.length, 2, '1C: Sent notification to both authorized users');
    assert.strictEqual(sentMessages[0].chat_id, 111222, '1D: Delivered to first authorized user');
    assert.strictEqual(sentMessages[1].chat_id, 333444, '1E: Delivered to second authorized user');

    const expectedNotification = [
      '⏱️ [Auto-Plan Nudge]',
      'Phase 2 (phase-02-auth-service.md) running > 3 minutes.',
      'Automatically paused AI and injected online search guidance into IDE chat.'
    ].join('\n');

    assert.strictEqual(sentMessages[0].text, expectedNotification, '1F: Notification matches required template exactly');

    // Test fallback when phaseNumber is missing, uses phaseIndex + 1
    sentMessages.length = 0;
    orchEmitter.emit('phaseNudged', {
      phase: { fileName: 'phase-fallback.md' },
      phaseIndex: 4
    });
    await new Promise((r) => setTimeout(r, 60));

    assert.strictEqual(sentMessages.length, 2, '1G: Handled fallback phase index');
    assert.ok(
      sentMessages[0].text.includes('Phase 5 (phase-fallback.md) running > 3 minutes.'),
      '1H: Fallback phase number computed as phaseIndex + 1 = 5'
    );

    bridge.stop();
    notifier.dispose();
    console.log('  ✓ TelegramBridge successfully formats and delivers nudge notifications to all authorized users.');
  }

  // -------------------------------------------------------------------------
  // [Test 2] Configuration Gating: telegramEnabled & longPhaseNotifyTelegram
  // -------------------------------------------------------------------------
  console.log('\n[Test 2] Verifying configuration toggles and suppression rules...');
  {
    const { bot, sentMessages } = createMockGrammyBot();
    const notifier = new ThrottledNotifier({ bot, chatIds: [1001], throttleMs: 50 });
    const orchEmitter = new EventEmitter();
    const bridge = new TelegramBridge({
      botFactory: () => bot,
      notifier,
      orchestrator: orchEmitter,
      allowedUsers: [1001],
      enabled: true
    });

    const testPhase = { phaseNumber: 1, fileName: 'phase-01.md' };

    // Case 2A: Suppression when longPhaseNotifyTelegram = false
    mockConfigStore['longPhaseNotifyTelegram'] = false;
    mockConfigStore['telegramEnabled'] = true;
    orchEmitter.emit('phaseNudged', { phase: testPhase, phaseIndex: 0 });
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(sentMessages.length, 0, '2A: No message sent when longPhaseNotifyTelegram is false');

    // Case 2B: Suppression when telegramEnabled = false
    mockConfigStore['longPhaseNotifyTelegram'] = true;
    mockConfigStore['telegramEnabled'] = false;
    orchEmitter.emit('phaseNudged', { phase: testPhase, phaseIndex: 0 });
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(sentMessages.length, 0, '2B: No message sent when telegramEnabled is false');

    // Case 2C: Re-enabled - notification is delivered
    mockConfigStore['telegramEnabled'] = true;
    mockConfigStore['longPhaseNotifyTelegram'] = true;
    orchEmitter.emit('phaseNudged', { phase: testPhase, phaseIndex: 0 });
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(sentMessages.length, 1, '2C: Notification delivered once re-enabled');
    assert.ok(sentMessages[0].text.includes('Phase 1 (phase-01.md) running > 3 minutes.'), '2D: Delivered text verified');

    bridge.stop();
    notifier.dispose();
    console.log('  ✓ Configuration flags telegramEnabled & longPhaseNotifyTelegram reliably gate nudge alerts.');
  }

  // -------------------------------------------------------------------------
  // [Test 3] Telegram Dashboard & /plan_status Nudge Status Indicator
  // -------------------------------------------------------------------------
  console.log('\n[Test 3] Verifying Telegram Live Dashboard & /plan_status nudge indicator...');
  {
    // Test 3A: formatPlanStatus helper
    const statusWithoutNudge = formatPlanStatus({
      state: 'RUNNING',
      currentPhaseName: 'phase-03.md',
      currentIteration: 1,
      totalIterations: 3,
      completedPhases: 1,
      totalPhases: 3,
      hasNudged: false
    });
    assert.ok(!statusWithoutNudge.includes('⚠️ Nudged'), '3A: Non-nudged status has no warning indicator');

    const statusWithNudge = formatPlanStatus({
      state: 'RUNNING',
      currentPhaseName: 'phase-03.md',
      currentIteration: 1,
      totalIterations: 3,
      completedPhases: 1,
      totalPhases: 3,
      hasNudged: true
    });
    assert.ok(
      statusWithNudge.includes('• Phase: phase-03.md ⚠️ Nudged (guidance sent)'),
      '3B: formatPlanStatus displays ⚠️ Nudged (guidance sent) next to phase'
    );

    // Test 3B: TelegramBridge.buildStatusDashboard() for /plan_status
    const mockOrch = {
      getState: () => 'running',
      isRunning: () => true,
      getCurrentPhase: () => ({ fileName: 'phase-02-api.md', hasNudged: true }),
      getProgress: () => ({ current: 1, total: 4 }),
      getPhases: () => [
        { fileName: 'phase-01.md', status: 'Completed' },
        { fileName: 'phase-02-api.md', status: 'Running', hasNudged: true }
      ]
    };

    const bridge = new TelegramBridge({
      allowedUsers: [999],
      orchestrator: mockOrch
    });

    const dashboardText = bridge.buildStatusDashboard();
    assert.ok(
      dashboardText.includes('• Phase: phase-02-api.md ⚠️ Nudged (guidance sent)'),
      '3C: buildStatusDashboard reflects nudge warning on active phase'
    );

    // Test 3C: TelegramPlanManager Live Dashboard execution message
    const planManager = new TelegramPlanManager();
    const dashboardResult = planManager.buildExecutionDashboard({
      planName: 'Payment Gateway',
      currentPhaseName: 'phase-02-api.md',
      currentPhaseIndex: 2,
      completedPhases: 1,
      totalPhases: 4,
      state: 'running',
      hasNudged: true
    });

    assert.ok(
      dashboardResult.text.includes('⏳ Đang chạy: Phase 02 - Api ⚠️ Nudged (guidance sent)'),
      '3D: buildExecutionDashboard shows ⚠️ Nudged (guidance sent) in running phase line'
    );

    // Test 3D: TelegramPlanManager.buildLiveDashboardText
    planManager.setOrchestrator(mockOrch);
    const liveText = planManager.buildLiveDashboardText({
      id: 'f1',
      displayName: 'Payment Gateway',
      completedPhases: 1,
      totalPhases: 4
    } as any);
    assert.ok(
      liveText.includes('• Phase hiện tại: `phase-02-api.md` ⚠️ Nudged (guidance sent)'),
      '3E: buildLiveDashboardText shows ⚠️ Nudged (guidance sent)'
    );

    // Test 3E: Dynamic phaseNudged event handling in TelegramPlanManager
    const orchEmitter = new EventEmitter();
    planManager.setOrchestrator(orchEmitter);
    const { bot, editedMessages } = createMockGrammyBot();

    (planManager as any).activeDashboardSession = {
      chatId: 888,
      messageId: 55,
      planName: 'Auth Refactor',
      currentPhaseName: 'phase-01.md',
      currentPhaseIndex: 1,
      completedPhases: 0,
      totalPhases: 2,
      state: 'running',
      hasNudged: false,
      bot
    };
    planManager.bindOrchestratorEvents(orchEmitter);

    // Emit phaseNudged event
    orchEmitter.emit('phaseNudged', { phase: { fileName: 'phase-01.md' } });
    assert.strictEqual(
      (planManager as any).activeDashboardSession.hasNudged,
      true,
      '3F: Active dashboard session marked as hasNudged upon phaseNudged event'
    );

    bridge.stop();
    console.log('  ✓ Telegram plan status and live execution dashboard dynamically display nudge indicators.');
  }

  // -------------------------------------------------------------------------
  // [Test 4] Sidebar Webview Control Center & In-Memory Log Console
  // -------------------------------------------------------------------------
  console.log('\n[Test 4] Verifying SidebarProvider telemetry logging & phase viewmodel nudge state...');
  {
    const orchEmitter = new EventEmitter() as any;
    const phasesInOrch: any[] = [
      {
        fileName: 'phase-01.md',
        filePath: '/plans/phase-01.md',
        status: 'Completed',
        isCompleted: true
      },
      {
        fileName: 'phase-02.md',
        filePath: '/plans/phase-02.md',
        status: 'Running',
        isCompleted: false,
        hasNudged: false
      }
    ];

    orchEmitter.isRunning = () => true;
    orchEmitter.getCurrentPhase = () => phasesInOrch[1];
    orchEmitter.getPhases = () => phasesInOrch;
    orchEmitter.getPhaseAuditReport = () => ({
      folderPath: '/plans',
      totalPhases: 2,
      completedCount: 1,
      pendingCount: 0,
      failedCount: 0,
      skippedCount: 0,
      phases: phasesInOrch.map((p, idx) => ({
        index: idx,
        phaseNumber: idx + 1,
        fileName: p.fileName,
        filePath: p.filePath,
        status: p.status,
        isCompleted: p.isCompleted,
        isSelected: true,
        hasNudged: p.hasNudged
      })),
      hasBlockers: false
    });

    const mockUri = { fsPath: '/test/extension' } as any;
    const sidebar = new SidebarProvider(mockUri, undefined, orchEmitter);

    const receivedMessages: any[] = [];
    const mockWebviewView: any = {
      webview: {
        options: {},
        html: '',
        cspSource: 'https:',
        asWebviewUri: (u: any) => u,
        postMessage: async (msg: any) => {
          receivedMessages.push(msg);
        },
        onDidReceiveMessage: () => ({ dispose: () => {} })
      }
    };

    sidebar.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    await sidebar.handleWebviewMessage({ command: 'ready' });

    // Initial state: no nudged logs
    assert.strictEqual(sidebar.getTranscriptLogs().length, 0, '4A: Initial transcript logs empty');

    // Trigger phaseNudged event
    phasesInOrch[1].hasNudged = true;
    orchEmitter.emit('phaseNudged', {
      phase: phasesInOrch[1],
      phaseIndex: 1,
      message: 'Search online'
    });

    // In-memory Log Console receives telemetry log
    const logs = sidebar.getTranscriptLogs();
    assert.strictEqual(logs.length, 1, '4B: Telemetry log entry recorded in in-memory Log Console');
    assert.ok(
      logs[0].includes('[Nudge] Phase 2 (phase-02.md) mid-flight steering injected.'),
      '4C: Telemetry message format verified'
    );

    // Refresh state and verify phases viewmodel has hasNudged: true
    await sidebar.refreshAndSendState();
    const updatedPhases = sidebar.getPhases();
    assert.strictEqual((updatedPhases[1] as any).hasNudged, true, '4D: Phase viewmodel marks hasNudged as true');

    // Check message sent to Webview
    const stateUpdate = receivedMessages.find(
      (m) => m.command === 'stateUpdate' && m.phases && m.phases[1]?.hasNudged
    );
    assert.ok(stateUpdate, '4E: Webview received stateUpdate with hasNudged: true');

    sidebar.dispose();
    console.log('  ✓ SidebarProvider records in-memory telemetry logs and propagates hasNudged viewmodel to webview.');
  }

  // -------------------------------------------------------------------------
  // [Test 5] Full End-to-End Coordination: Orchestrator + Watchdog + Telegram + Dashboard
  // -------------------------------------------------------------------------
  console.log('\n[Test 5] Verifying Full End-to-End Orchestrator Nudge -> Telegram & Dashboard Flow...');
  {
    const { bot, sentMessages } = createMockGrammyBot();
    const authorizedUsers = [555666];

    const notifier = new ThrottledNotifier({
      bot,
      chatIds: authorizedUsers,
      throttleMs: 20
    });

    const originTracker = new PromptOriginTracker({ autoPrune: false });
    const executedCmds: string[] = [];

    const mockDispatcher: any = {
      stopActiveGeneration: async () => ({ success: true, tier: 'domBridge', durationMs: 15 }),
      dispatchPrompt: async (text: string, opts?: any) => {
        executedCmds.push(text);
        return { success: true, tier: 'domBridge', durationMs: 30 };
      }
    };

    const orchestrator = new Orchestrator({
      promptDispatcher: mockDispatcher as any,
      promptOriginTracker: originTracker,
      configProvider: () => ({
        longPhaseNudgeEnabled: true,
        longPhaseThresholdSeconds: 1,
        longPhaseNudgeMessage: 'Search online to find the best practices. Use search_web.',
        longPhaseNotifyTelegram: true,
        telegramEnabled: true
      } as any)
    });

    const bridge = new TelegramBridge({
      botFactory: () => bot,
      notifier,
      orchestrator,
      allowedUsers: authorizedUsers,
      enabled: true
    });

    const sidebar = new SidebarProvider({ fsPath: '/ext' } as any, undefined, orchestrator);

    const phase: PhaseItem = {
      index: 0,
      phaseNumber: 1,
      fileName: 'phase-01-core.md',
      filePath: '/plans/phase-01-core.md',
      nativePath: '/plans/phase-01-core.md',
      normalizedPath: '/plans/phase-01-core.md',
      status: 'Running'
    };

    // Execute orchestrator phase nudge
    await orchestrator.triggerPhaseNudge(phase, 0);

    // Allow async handlers to execute
    await new Promise((r) => setTimeout(r, 80));

    // 1. Phase state mutated
    assert.strictEqual(phase.hasNudged, true, '5A: Phase.hasNudged marked as true');

    // 2. Prompt dispatched focus-free into current session
    assert.strictEqual(executedCmds.length, 1, '5B: Steering prompt dispatched');
    assert.strictEqual(
      executedCmds[0],
      'Search online to find the best practices. Use search_web.',
      '5C: Dispatched exact steering prompt'
    );

    // 3. Telegram alert delivered
    assert.strictEqual(sentMessages.length, 1, '5D: Telegram nudge alert delivered');
    assert.strictEqual(sentMessages[0].chat_id, 555666, '5E: Delivered to authorized user 555666');
    assert.strictEqual(
      sentMessages[0].text,
      [
        '⏱️ [Auto-Plan Nudge]',
        'Phase 1 (phase-01-core.md) running > 3 minutes.',
        'Automatically paused AI and injected online search guidance into IDE chat.'
      ].join('\n'),
      '5F: Telegram alert content matches format exactly'
    );

    // 4. Sidebar Log Console received entry
    const sideLogs = sidebar.getTranscriptLogs();
    assert.strictEqual(sideLogs.length, 1, '5G: Sidebar log received nudge entry');
    assert.ok(
      sideLogs[0].includes('[Nudge] Phase 1 (phase-01-core.md) mid-flight steering injected.'),
      '5H: Sidebar log verified'
    );

    // 5. Telegram /plan_status displays nudged status
    const statusText = bridge.buildStatusDashboard();
    assert.ok(
      statusText.includes('• Phase: phase-01-core.md ⚠️ Nudged (guidance sent)'),
      '5I: /plan_status displays ⚠️ Nudged (guidance sent)'
    );

    sidebar.dispose();
    bridge.stop();
    notifier.dispose();
    console.log('  ✓ Full End-to-End Orchestrator -> Telegram -> Sidebar -> Live Dashboard integration verified.');
  }

  console.log('\n========================================================================');
  console.log(' ALL Phase 04 Telegram Nudge Notification E2E Tests PASSED! 🎉');
  console.log('========================================================================\n');
}

runPhase04TelegramNudgeNotificationTests().catch((err) => {
  console.error('\n❌ Phase 04 Test Failed:', err);
  process.exit(1);
});
