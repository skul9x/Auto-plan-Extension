// Standalone mock for 'vscode' module when executed directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {};
const globalExecutedCommands: { command: string; args: any[]; timestamp: number }[] = [];
const registeredCommandHandlers: Record<string, (...args: any[]) => any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) =>
            mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            mockConfigStore[key] = val;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        workspaceFolders: [
          { name: 'test-workspace', uri: { fsPath: '/mock/workspace' } }
        ]
      },
      env: {
        appRoot: '/mock/app/root'
      },
      commands: {
        registerCommand: (command: string, callback: (...args: any[]) => any) => {
          registeredCommandHandlers[command] = callback;
          return {
            dispose: () => {
              delete registeredCommandHandlers[command];
            }
          };
        },
        executeCommand: async (cmd: string, ...args: any[]) => {
          globalExecutedCommands.push({ command: cmd, args, timestamp: Date.now() });
          if (registeredCommandHandlers[cmd]) {
            return await registeredCommandHandlers[cmd](...args);
          }
          return undefined;
        },
        getCommands: async (_internal?: boolean) => [
          'antigravity.startNewConversation',
          'antigravity.addContext',
          'antigravity.triggerSend',
          'antigravity.prioritized.chat.stop',
          'workbench.action.chat.stop',
          'autoplan.start',
          'autoplan.stop',
          'autoplan.testNativeDispatch',
          'autoplan.cleanWorkbench',
          'autoplan.checkStatus'
        ]
      },
      window: {
        showWarningMessage: (_msg: string) => undefined,
        showInformationMessage: async (_msg: string, ..._items: string[]) => undefined,
        showErrorMessage: async (_msg: string, ..._items: string[]) => undefined,
        createStatusBarItem: (_alignment?: any, _priority?: any) => ({
          text: '',
          tooltip: '',
          command: '',
          show: () => {},
          hide: () => {},
          dispose: () => {}
        })
      },
      ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
      StatusBarAlignment: { Left: 1, Right: 2 },
      Uri: { file: (p: string) => ({ fsPath: p }) }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import { Bot } from 'grammy';
import {
  getConfig,
  DEFAULT_CONFIG,
  AutoPlanConfig
} from '../config';
import { PromptDispatcher, DispatchResult } from '../promptDispatcher';
import { Orchestrator } from '../orchestrator';
import { DebugLogger } from '../debugLogger';
import {
  TelegramBridge,
  parseWorkflowCommand,
  INTERNAL_BOT_COMMANDS
} from '../telegramBridge';
import { PromptOriginTracker } from '../promptOriginTracker';
import { runBridgeDiagnostic, updateBridgeStatusBar } from '../extension';

/**
 * Creates a mock GrammY bot initialized with offline botInfo and message capturing.
 */
function createMockBot(token: string = '123456:TEST_TOKEN'): {
  bot: Bot;
  sentMessages: any[];
} {
  const bot = new Bot(token, {
    botInfo: {
      id: 999999999,
      is_bot: true,
      first_name: 'AutoPlanRegressionBot',
      username: 'autoplan_regression_bot',
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

/**
 * Mock transcript watcher for headless orchestrator testing.
 */
class MockTranscriptWatcher extends EventEmitter {
  public waitForNewConversationCalls = 0;
  public watchFileCalls = 0;
  public watchLatestCalls = 0;
  private brainDir: string;

  constructor(brainDir: string) {
    super();
    this.brainDir = brainDir;
  }

  setOptions(_opts: any) {}
  clearRunListeners() {}

  getOptions(): any {
    return {
      brainDir: this.brainDir,
      pollIntervalMs: 20,
      completionKeyword: 'Done skul9x.',
      completionRegex: null,
      maxScanLines: 200,
      timeoutMinutes: 5
    };
  }

  async waitForNewConversation(
    _phaseStartTime: number,
    _lastConvId?: string,
    _timeoutMs: number = 8000,
    _pollIntervalMs?: number,
    _ownershipCriteria?: any
  ): Promise<string> {
    this.waitForNewConversationCalls++;
    const convId = `conv-e2e-${this.waitForNewConversationCalls}`;
    const logDir = path.join(this.brainDir, convId, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'transcript.jsonl'), '{"type":"MODEL","content":"Working..."}\n');
    return convId;
  }

  async watchFile(
    _transcriptPath: string,
    convId: string,
    _offset: number,
    _startTime: number,
    _initLength?: number
  ): Promise<any> {
    this.watchFileCalls++;
    return {
      success: true,
      conversationId: convId,
      matchedContent: 'Done skul9x.',
      timestamp: Date.now()
    };
  }

  async watchLatest(
    _startTime: number,
    convId?: string,
    _initLength?: number
  ): Promise<any> {
    this.watchLatestCalls++;
    return {
      success: true,
      conversationId: convId || 'conv-latest',
      matchedContent: 'Done skul9x.',
      timestamp: Date.now()
    };
  }

  stop() {}
}

async function runPhase04RegressionAndPackagingTests() {
  console.log('========================================================================');
  console.log(' Phase 04: Full System Regression & Extension Packaging Test');
  console.log('========================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    totalTests++;
    process.stdout.write(`  Test ${totalTests}: ${name} ... `);
    try {
      await fn();
      console.log('✓ PASS');
      passedTests++;
    } catch (err: any) {
      console.log('✗ FAIL');
      console.error(err);
      throw err;
    }
  }

  const testLogger = new DebugLogger(200);

  // -------------------------------------------------------------------------
  // Group 1: End-to-End Multi-Phase Plan Execution with Native Chat API
  // -------------------------------------------------------------------------
  console.log('--- Group 1: Multi-Phase Plan Execution with Native Chat API ---');

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-test-'));
  const testBrainDir = path.join(tmpBase, 'brain');
  const testPlansDir = path.join(tmpBase, 'plans');
  fs.mkdirSync(testBrainDir, { recursive: true });
  fs.mkdirSync(testPlansDir, { recursive: true });

  const phase1File = path.join(testPlansDir, 'phase-01-core.md');
  const phase2File = path.join(testPlansDir, 'phase-02-api.md');
  fs.writeFileSync(phase1File, '# Phase 01: Core Setup\nStatus: ⬜ Pending\n\nExecute Phase 1 prompt.\nDone skul9x.\n');
  fs.writeFileSync(phase2File, '# Phase 02: API Integration\nStatus: ⬜ Pending\n\nExecute Phase 2 prompt.\nDone skul9x.\n');

  await test('Multi-phase plan executes sequentially using 100% Native Antigravity Commands', async () => {
    const executedCommandHistory: { command: string; args: any[]; timestamp: number }[] = [];

    const mockExecutor = async (cmd: string, ...args: any[]) => {
      executedCommandHistory.push({ command: cmd, args, timestamp: Date.now() });
      return undefined;
    };

    const nativeDispatcher = new PromptDispatcher({
      commandExecutor: mockExecutor,
      logger: testLogger,
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        sendDelayMs: 60
      })
    });

    const mockWatcher = new MockTranscriptWatcher(testBrainDir);

    const orchestrator = new Orchestrator({
      promptDispatcher: nativeDispatcher,
      transcriptWatcher: mockWatcher as any,
      debugLogger: testLogger,
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        brainDir: testBrainDir,
        sendDelayMs: 60,
        delayBetweenLoopsMs: 10
      })
    });

    const origSleep = orchestrator.sleepWithAbort.bind(orchestrator);
    orchestrator.sleepWithAbort = async function (ms: number, abortCheck: () => boolean) {
      return origSleep(Math.min(ms, 15), abortCheck);
    };

    const runResult = await orchestrator.startPhases([phase1File, phase2File]);
    assert.strictEqual(runResult, true, 'startPhases should return true on successful execution');

    // Verify commands called
    const cmdNames = executedCommandHistory.map(c => c.command);

    // Verify Phase 1 transition: startNewConversation, addContext, triggerSend
    const firstStartIdx = cmdNames.indexOf('antigravity.startNewConversation');
    assert.ok(firstStartIdx >= 0, 'Phase 1 must execute antigravity.startNewConversation');

    const firstAddIdx = cmdNames.indexOf('antigravity.addContext');
    assert.ok(firstAddIdx > firstStartIdx, 'Phase 1 antigravity.addContext must execute after startNewConversation');

    const firstSendIdx = cmdNames.indexOf('antigravity.triggerSend');
    assert.ok(firstSendIdx > firstAddIdx, 'Phase 1 antigravity.triggerSend must execute after addContext');

    // Verify sendDelayMs between addContext and triggerSend
    const delayPhase1 = executedCommandHistory[firstSendIdx].timestamp - executedCommandHistory[firstAddIdx].timestamp;
    assert.ok(delayPhase1 >= 50, `Delay between addContext and triggerSend must observe sendDelayMs (got ${delayPhase1}ms)`);

    // Verify Phase 2 transition also executed startNewConversation, addContext, triggerSend
    const secondStartIdx = cmdNames.indexOf('antigravity.startNewConversation', firstSendIdx + 1);
    assert.ok(secondStartIdx > firstSendIdx, 'Phase 2 must execute antigravity.startNewConversation after Phase 1 completion');

    const secondAddIdx = cmdNames.indexOf('antigravity.addContext', secondStartIdx + 1);
    assert.ok(secondAddIdx > secondStartIdx, 'Phase 2 antigravity.addContext must follow startNewConversation');

    const secondSendIdx = cmdNames.indexOf('antigravity.triggerSend', secondAddIdx + 1);
    assert.ok(secondSendIdx > secondAddIdx, 'Phase 2 antigravity.triggerSend must follow addContext');

    // Verify phase status updated to Completed
    const finalPhases = orchestrator.getPhases();
    assert.strictEqual(finalPhases[0].status, 'Completed', 'Phase 1 must be marked as Completed');
    assert.strictEqual(finalPhases[1].status, 'Completed', 'Phase 2 must be marked as Completed');

    // Verify zero legacy tier commands (no xdotool, no DOM injection scripts)
    const illegalCommands = executedCommandHistory.filter(c =>
      c.command.includes('xdotool') || c.command.includes('powershell')
    );
    assert.strictEqual(illegalCommands.length, 0, 'No legacy keyboard commands may be invoked');
  });

  // -------------------------------------------------------------------------
  // Group 2: Telegram Remote Control & Focus-Free Interactions
  // -------------------------------------------------------------------------
  console.log('\n--- Group 2: Telegram Remote Control & Focus-Free Interactions ---');

  await test('Telegram remote commands (/run, /plan, /stop) operate focus-free via native engine', async () => {
    const telegramCommands: { command: string; args: any[]; timestamp: number }[] = [];
    const mockExecutor = async (cmd: string, ...args: any[]) => {
      telegramCommands.push({ command: cmd, args, timestamp: Date.now() });
      return undefined;
    };

    const dispatcher = new PromptDispatcher({
      commandExecutor: mockExecutor,
      logger: testLogger,
      configProvider: () => ({ ...DEFAULT_CONFIG, sendDelayMs: 40 })
    });

    const originTracker = new PromptOriginTracker();
    const { bot: mockBot, sentMessages } = createMockBot('123456:TEST_TELEGRAM_TOKEN');

    const mockOrch = new Orchestrator({
      promptDispatcher: dispatcher,
      debugLogger: testLogger
    });

    const bridge = new TelegramBridge({
      token: '123456:TEST_TELEGRAM_TOKEN',
      allowedUsers: [12345],
      allowFreeChat: true,
      botFactory: () => mockBot,
      promptDispatcher: dispatcher,
      orchestrator: mockOrch,
      logger: testLogger,
      promptOriginTracker: originTracker
    });

    bridge.initBot();

    // 1. Simulate user sending /run test pipeline
    telegramCommands.length = 0;
    sentMessages.length = 0;

    await (bridge as any).bot.handleUpdate({
      update_id: 101,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Tester' },
        text: '/run test pipeline',
        entities: [{ type: 'bot_command', offset: 0, length: 4 }]
      }
    });

    // Verify /run dispatched prompt via addContext and triggerSend without focus theft
    const runAdd = telegramCommands.find(c => c.command === 'antigravity.addContext');
    assert.ok(runAdd, 'Telegram /run must trigger antigravity.addContext');
    assert.strictEqual(runAdd.args[0], '/run test pipeline', 'Prompt text must match normalized workflow command');

    const runSend = telegramCommands.find(c => c.command === 'antigravity.triggerSend');
    assert.ok(runSend, 'Telegram /run must trigger antigravity.triggerSend');

    const runNewConv = telegramCommands.find(c => c.command === 'antigravity.startNewConversation');
    assert.strictEqual(runNewConv, undefined, 'Telegram /run must preserve conversation continuity (openNewConversation: false)');

    // 2. Simulate user sending /plan redesign architecture
    telegramCommands.length = 0;
    sentMessages.length = 0;

    await (bridge as any).bot.handleUpdate({
      update_id: 102,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Tester' },
        text: '/plan redesign architecture',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      }
    });

    const planAdd = telegramCommands.find(c => c.command === 'antigravity.addContext');
    assert.ok(planAdd, 'Telegram /plan must trigger antigravity.addContext');
    assert.strictEqual(planAdd.args[0], '/plan redesign architecture');

    const planSend = telegramCommands.find(c => c.command === 'antigravity.triggerSend');
    assert.ok(planSend, 'Telegram /plan must trigger antigravity.triggerSend');

    // 3. Simulate user sending /stop command
    telegramCommands.length = 0;
    sentMessages.length = 0;

    await (bridge as any).bot.handleUpdate({
      update_id: 103,
      message: {
        message_id: 3,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 12345, is_bot: false, first_name: 'Tester' },
        text: '/stop',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      }
    });

    // Verify /stop triggers stopActiveGeneration on native chat
    const stopChatCmd = telegramCommands.find(c =>
      c.command === 'antigravity.prioritized.chat.stop' || c.command === 'workbench.action.chat.stop'
    );
    assert.ok(stopChatCmd, 'Telegram /stop must execute native chat stop command');

    const stopReply = sentMessages.find(m => m.text && m.text.includes('🛑 Plan execution stopped.'));
    assert.ok(stopReply, 'Telegram must confirm plan execution stopped');

    // 4. Verify prompt origin tracking prevents redundant echoing
    assert.strictEqual(originTracker.peekOrigin('/run test pipeline'), 'telegram', 'Outbound prompt must be tracked as telegram origin');
  });

  // -------------------------------------------------------------------------
  // Group 3: Loop Mode Transitions, Nudge Watchdog & Error Resilience
  // -------------------------------------------------------------------------
  console.log('\n--- Group 3: Loop Mode Transitions, Nudge Watchdog & Error Resilience ---');

  await test('Nudge procedure halts active generation and dispatches steering prompt focus-free', async () => {
    const executedCmds: string[] = [];
    const mockExecutor = async (cmd: string) => {
      executedCmds.push(cmd);
      return undefined;
    };

    const dispatcher = new PromptDispatcher({
      commandExecutor: mockExecutor,
      logger: testLogger,
      configProvider: () => ({ ...DEFAULT_CONFIG, sendDelayMs: 40 })
    });

    const orchestrator = new Orchestrator({
      promptDispatcher: dispatcher,
      debugLogger: testLogger,
      configProvider: () => ({ ...DEFAULT_CONFIG, sendDelayMs: 40 })
    });

    let nudgedEventFired = false;
    orchestrator.on('phaseNudged', (evt) => {
      nudgedEventFired = true;
      assert.strictEqual(evt.message, 'Steering guidance: resolve type errors');
    });

    const dummyPhase: any = {
      index: 0,
      phaseNumber: 1,
      fileName: 'phase-01-core.md',
      filePath: phase1File,
      nativePath: phase1File,
      normalizedPath: phase1File,
      status: 'Running'
    };

    await orchestrator.executeNudgeProcedure(dummyPhase, 0, 'Steering guidance: resolve type errors');

    assert.strictEqual(nudgedEventFired, true, 'phaseNudged event must be emitted');
    assert.ok(executedCmds.includes('antigravity.prioritized.chat.stop'), 'Nudge must halt active generation');
    assert.ok(executedCmds.includes('antigravity.addContext'), 'Nudge must inject prompt via antigravity.addContext');
    assert.ok(executedCmds.includes('antigravity.triggerSend'), 'Nudge must trigger send via antigravity.triggerSend');
    assert.strictEqual(executedCmds.includes('antigravity.startNewConversation'), false, 'Nudge must maintain continuous context');
  });

  await test('Dispatcher error resilience: structured errors and telemetry on API failures', async () => {
    // Failure in antigravity.addContext
    const failExecutor = async (cmd: string) => {
      if (cmd === 'antigravity.addContext') {
        throw new Error('Chat panel disconnected');
      }
      return undefined;
    };

    const failingDispatcher = new PromptDispatcher({
      commandExecutor: failExecutor,
      logger: testLogger,
      configProvider: () => ({ ...DEFAULT_CONFIG, sendDelayMs: 20 })
    });

    let caughtAddErr: any = null;
    try {
      await failingDispatcher.dispatchPrompt('Test error dispatch', { openNewConversation: false });
    } catch (err: any) {
      caughtAddErr = err;
    }

    assert.ok(caughtAddErr, 'Dispatcher must throw on command failure');
    assert.strictEqual(caughtAddErr.code, 'NATIVE_COMMAND_FAILED');
    assert.strictEqual(caughtAddErr.command, 'antigravity.addContext');
    assert.ok(caughtAddErr.message.includes('Chat panel disconnected'));

    // Check telemetry recorded failure
    const lastTelemetry = testLogger.getLastInjectionTelemetry();
    assert.ok(lastTelemetry, 'Failure telemetry must be recorded in logger');
    assert.strictEqual(lastTelemetry.status, 'failed');
    assert.strictEqual(lastTelemetry.strategy, 'native-chat-api');
    assert.strictEqual(lastTelemetry.verified, false);
  });

  // -------------------------------------------------------------------------
  // Group 4: Diagnostic & Telemetry Reporting
  // -------------------------------------------------------------------------
  console.log('\n--- Group 4: Diagnostic & Telemetry Reporting ---');

  await test('Diagnostic reports accurately represent Native Chat Engine health and settings', async () => {
    // Record verified native dispatch telemetry
    testLogger.recordInjectionTelemetry({
      timestamp: Date.now(),
      status: 'verified',
      elementContext: 'antigravity.addContext (Native)',
      charsInjected: 142,
      charsExpected: 142,
      charsDetectedInDOM: 142,
      strategy: 'native-chat-api',
      verified: true
    });

    const diagnosticReport = testLogger.generateDiagnosticReport();

    assert.ok(diagnosticReport.includes('Auto-Plan Diagnostic Report'), 'Report must have correct title');
    assert.ok(diagnosticReport.includes('Native Antigravity Chat API'), 'Report must identify Native Engine');
    assert.ok(diagnosticReport.includes('Send Delay'), 'Report must display Send Delay setting');
    assert.ok(diagnosticReport.includes('Native Dispatch Engine**: Operational'), 'Checklist must mark Native Engine Operational');
    assert.ok(diagnosticReport.includes('Native Dispatch: 142 chars'), 'Report must reflect verified native dispatch telemetry');

    // Test extension host runBridgeDiagnostic
    mockConfigStore['sendDelayMs'] = 650;
    const bridgeDiag = runBridgeDiagnostic();
    assert.strictEqual(bridgeDiag.nativeEngineReady, true, 'runBridgeDiagnostic must report nativeEngineReady: true');
    assert.strictEqual(bridgeDiag.nativeEngineHealth, 'Operational', 'Health must be Operational');
    assert.strictEqual(bridgeDiag.sendDelayMs, 650, 'Must reflect configured sendDelayMs');
  });

  // -------------------------------------------------------------------------
  // Group 5: Package Manifest, Production Asset Completeness & VSIX Verification
  // -------------------------------------------------------------------------
  console.log('\n--- Group 5: Package Manifest, Production Asset Completeness & VSIX Verification ---');

  const rootDir = path.resolve(__dirname, '../../');
  const pkgJsonPath = path.join(rootDir, 'package.json');
  const vscodeignorePath = path.join(rootDir, '.vscodeignore');

  await test('package.json manifest contains all required metadata and native configurations', () => {
    assert.ok(fs.existsSync(pkgJsonPath), 'package.json must exist');
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

    assert.strictEqual(pkg.name, 'antigravity-auto-plan');
    assert.strictEqual(pkg.main, './out/extension.js');
    assert.ok(pkg.version, 'Must have version string');
    assert.ok(pkg.engines && pkg.engines.vscode, 'Must define vscode engine requirement');

    // Commands check
    const commands: { command: string; title: string }[] = pkg.contributes?.commands || [];
    const commandNames = commands.map(c => c.command);
    assert.ok(commandNames.includes('autoplan.start'), 'Must contribute autoplan.start');
    assert.ok(commandNames.includes('autoplan.stop'), 'Must contribute autoplan.stop');
    assert.ok(commandNames.includes('autoplan.testNativeDispatch'), 'Must contribute autoplan.testNativeDispatch');
    assert.ok(commandNames.includes('autoplan.cleanWorkbench'), 'Must contribute autoplan.cleanWorkbench');

    // Configuration schema check
    const configProps = pkg.contributes?.configuration?.properties || {};
    assert.ok(configProps['autoplan.sendDelayMs'], 'Must declare autoplan.sendDelayMs');
    assert.strictEqual(configProps['autoplan.sendDelayMs'].default, 500, 'sendDelayMs default must be 500');
  });

  await test('.vscodeignore strictly excludes tests, scratch files, and source code', () => {
    assert.ok(fs.existsSync(vscodeignorePath), '.vscodeignore must exist');
    const content = fs.readFileSync(vscodeignorePath, 'utf8');

    assert.ok(content.includes('out/test/**'), '.vscodeignore must exclude out/test/**');
    assert.ok(content.includes('src/**'), '.vscodeignore must exclude src/**');
    assert.ok(content.includes('plans/**'), '.vscodeignore must exclude plans/**');
    assert.ok(content.includes('*.py'), '.vscodeignore must exclude *.py scratch files');
    assert.ok(content.includes('*.txt'), '.vscodeignore must exclude *.txt temporary files');
    assert.ok(content.includes('scripts/**'), '.vscodeignore must exclude scripts/**');
  });

  await test('vsce package generation produces a clean, installable .vsix bundle', () => {
    // Run packaging via vsce / scripts/package.js
    console.log('\n    Running VSIX package validation...');
    const packageCmd = 'npx @vscode/vsce package --allow-missing-repository --no-git-tag-version';
    const output = execSync(packageCmd, { cwd: rootDir, encoding: 'utf8' });
    assert.ok(output.includes('Packaged:'), 'vsce package must successfully output "Packaged:"');

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const vsixFileName = `${pkg.name}-${pkg.version}.vsix`;
    const vsixPath = path.join(rootDir, vsixFileName);

    assert.ok(fs.existsSync(vsixPath), `VSIX file ${vsixFileName} must exist in workspace root`);
    const stat = fs.statSync(vsixPath);
    assert.ok(stat.size > 10000, `VSIX package must have content (size: ${stat.size} bytes)`);
    assert.ok(stat.size < 5 * 1024 * 1024, `VSIX package must be lean and under 5MB (size: ${stat.size} bytes)`);

    console.log(`    Successfully validated VSIX bundle: ${vsixFileName} (${(stat.size / 1024).toFixed(1)} KB)`);
  });

  // Cleanup temp files
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch {}

  console.log('\n========================================================================');
  console.log(` Summary: All ${passedTests}/${totalTests} tests in Phase 04 PASSED cleanly!`);
  console.log('========================================================================\n');
}

// Run test directly if launched via Node
if (require.main === module) {
  runPhase04RegressionAndPackagingTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Phase 04 Test execution failed:', err);
      process.exit(1);
    });
}

export { runPhase04RegressionAndPackagingTests };
