// Self-healing ESM require guard for JSDOM in Node CommonJS
if (!process.env.__PHASE05_RELEASE_REEXEC__) {
  try {
    require('jsdom');
  } catch (e: any) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      const { execFileSync } = require('child_process');
      const env = {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-require-module`.trim(),
        __PHASE05_RELEASE_REEXEC__: '1'
      };
      try {
        execFileSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
          stdio: 'inherit',
          env
        });
        process.exit(0);
      } catch (err: any) {
        process.exit(err.status || 1);
      }
    }
    throw e;
  }
}

// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

interface MockDisposable {
  dispose: () => void;
}

let mockActiveTextEditor: any = undefined;
let mockWorkspaceFolders: any[] = [];
const mockConfigStore: Record<string, any> = {
  longPhaseNudgeEnabled: true,
  longPhaseThresholdSeconds: 180,
  longPhaseNudgeMessage:
    ' Search online to find the best practices. Note, do not open a browser and directly access the DOM. Use search_web / read_url_content when you need to look something up. ',
  longPhaseNudgeRecurring: false,
  longPhaseNotifyTelegram: true,
  telegramEnabled: true,
  telegramBotToken: 'mock_token_phase05',
  telegramAllowedUsers: [10001, 10002],
  telegramThrottleMs: 2500,
  'telegram.allowFreeChat': true,
  'telegram.enableChatMirror': true,
  'telegram.mirrorIncludePcPrompts': true,
  'telegram.chatMirrorPrefix': '🤖 Antigravity:'
};
const executedCommands: string[] = [];

class MockSecretStorage {
  public storeMap = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.storeMap.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.storeMap.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.storeMap.delete(key);
  }

  onDidChange = (() => ({ dispose: () => {} })) as any;
}

class MockWebview {
  public html: string = '';
  public options: any = {};
  public cspSource: string = 'vscode-webview:';
  public messageListeners: ((msg: any) => void)[] = [];
  public messagesPosted: any[] = [];

  asWebviewUri(uri: any): any {
    return {
      scheme: 'vscode-resource',
      authority: '',
      path: uri.path || uri.fsPath || '',
      toString: () => `vscode-resource://${uri.fsPath || uri.path || ''}`
    };
  }

  onDidReceiveMessage(listener: (msg: any) => void): MockDisposable {
    this.messageListeners.push(listener);
    return {
      dispose: () => {
        const idx = this.messageListeners.indexOf(listener);
        if (idx !== -1) this.messageListeners.splice(idx, 1);
      }
    };
  }

  async postMessage(message: any): Promise<boolean> {
    this.messagesPosted.push(message);
    return true;
  }
}

class MockWebviewPanel {
  public viewType: string;
  public title: string;
  public showOptions: any;
  public options: any;
  public webview: MockWebview;
  public visible: boolean = true;
  private disposeListeners: (() => void)[] = [];

  constructor(viewType: string, title: string, showOptions: any, options: any) {
    this.viewType = viewType;
    this.title = title;
    this.showOptions = showOptions;
    this.options = options;
    this.webview = new MockWebview();
  }

  reveal() {
    this.visible = true;
  }

  onDidDispose(listener: () => void, _thisArgs?: any, disposables?: any[]): MockDisposable {
    this.disposeListeners.push(listener);
    const disp = {
      dispose: () => {
        const idx = this.disposeListeners.indexOf(listener);
        if (idx !== -1) this.disposeListeners.splice(idx, 1);
      }
    };
    if (disposables) disposables.push(disp);
    return disp;
  }

  dispose() {
    this.visible = false;
    for (const l of [...this.disposeListeners]) l();
  }
}

const mockSecrets = new MockSecretStorage();
let mockInputBoxResult: string | undefined = undefined;

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
        createWebviewPanel: (viewType: string, title: string, showOptions: any, options: any) => {
          return new MockWebviewPanel(viewType, title, showOptions, options);
        },
        registerWebviewViewProvider: () => ({ dispose: () => {} }),
        showInformationMessage: async () => {},
        showWarningMessage: async () => {},
        showErrorMessage: async () => {},
        showInputBox: async () => mockInputBoxResult
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
      StatusBarAlignment: { Left: 1, Right: 2 },
      ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 },
      env: {
        appRoot: undefined
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const yauzl = require('yauzl');
import { JSDOM } from 'jsdom';
import { Bot } from 'grammy';

import { getConfig, getTelegramConfig, DEFAULT_CONFIG, SecretStorageManager } from '../config';
import { Orchestrator, PhaseItem } from '../orchestrator';
import { PromptDispatcher } from '../promptDispatcher';
import {
  PromptOriginTracker,
  Origin,
  formatPcPrompt
} from '../promptOriginTracker';
import { TelegramBridge, WORKFLOW_COMMAND_NAMES, isWorkflowCommand } from '../telegramBridge';
import { ThrottledNotifier } from '../telegramNotifier';
import { formatPlanStatus } from '../telegramScreen';
import { SettingsProvider } from '../settingsProvider';

interface MockApiCall {
  method: string;
  payload: any;
  timestamp: number;
}

function createMockGrammyBot(token: string = '123456:MOCK_TOKEN_PHASE05'): {
  bot: Bot;
  apiCalls: MockApiCall[];
  sentMessages: any[];
} {
  const bot = new Bot(token, {
    botInfo: {
      id: 999888777,
      is_bot: true,
      first_name: 'AutoPlanReleaseBot',
      username: 'autoplan_release_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false
    } as any
  });

  const apiCalls: MockApiCall[] = [];
  const sentMessages: any[] = [];

  bot.api.config.use(async (_prev, method, payload) => {
    apiCalls.push({ method, payload, timestamp: Date.now() });

    if (method === 'sendMessage') {
      const p = payload as any;
      sentMessages.push(p);
      return {
        ok: true,
        result: {
          message_id: Math.floor(Math.random() * 10000) + 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: p.chat_id, type: 'private', first_name: 'ReleaseTester' },
          text: p.text
        }
      } as any;
    }
    return { ok: true, result: {} } as any;
  });

  return { bot, apiCalls, sentMessages };
}

/**
 * Deep-audit entries and manifest inside a .vsix zip archive.
 */
async function auditVsixArchive(vsixFilePath: string): Promise<{
  totalFiles: number;
  files: string[];
  packageJson: any;
  leakedSecretFindings: Array<{ file: string; match: string }>;
}> {
  return new Promise((resolve, reject) => {
    yauzl.open(vsixFilePath, { lazyEntries: true }, (err: any, zipfile: any) => {
      if (err) return reject(err);

      const report = {
        totalFiles: 0,
        files: [] as string[],
        packageJson: null as any,
        leakedSecretFindings: [] as Array<{ file: string; match: string }>
      };

      const auditRegex = /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g;
      const forbiddenStrings = [
        '8930752011:AAG6HyFKC5h405nOw06EHz71np73vYuzFMc',
        '8376918512:'
      ];

      zipfile.readEntry();
      zipfile.on('entry', (entry: any) => {
        report.totalFiles++;
        report.files.push(entry.fileName);

        const isTextCandidate = /\.(js|json|md|html|txt|ts|yml|yaml)$/i.test(entry.fileName);

        if (isTextCandidate) {
          zipfile.openReadStream(entry, (streamErr: any, readStream: any) => {
            if (streamErr) return reject(streamErr);
            const chunks: Buffer[] = [];
            readStream.on('data', (c: Buffer) => chunks.push(c));
            readStream.on('end', () => {
              const content = Buffer.concat(chunks).toString('utf8');

              if (entry.fileName === 'extension/package.json') {
                try {
                  report.packageJson = JSON.parse(content);
                } catch {}
              }

              for (const forbidden of forbiddenStrings) {
                if (content.includes(forbidden)) {
                  report.leakedSecretFindings.push({
                    file: entry.fileName,
                    match: forbidden
                  });
                }
              }

              const matches = content.match(auditRegex);
              if (matches) {
                for (const m of matches) {
                  report.leakedSecretFindings.push({
                    file: entry.fileName,
                    match: m
                  });
                }
              }

              zipfile.readEntry();
            });
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => resolve(report));
      zipfile.on('error', (zipErr: any) => reject(zipErr));
    });
  });
}

/**
 * Main Phase 05 Verification: Regression Benchmark, Documentation & Release Packaging (v1.6.7)
 */
export async function runPhase05ReleaseRegressionTest(): Promise<void> {
  console.log('================================================================================');
  console.log(' Phase 05: Telegram Chat Toggle, Settings UI & Release Packaging Test (v1.6.7)');
  console.log('================================================================================\n');

  const rootDir = path.resolve(__dirname, '..', '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-p05-release-test-'));

  try {
    // -------------------------------------------------------------------------
    // Suite 1: Clean Compilation & Output Module Manifests Verification
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Verifying Compilation Output Modules Manifest & Assets...');
    const expectedOutputModules = [
      'out/extension.js',
      'out/config.js',
      'out/settingsProvider.js',
      'out/orchestrator.js',
      'out/promptDispatcher.js',
      'out/promptOriginTracker.js',
      'out/bridgeServer.js',
      'out/telegramNotifier.js',
      'out/telegramBridge.js',
      'out/sidebarProvider.js',
      'media/settings/settings.html',
      'media/settings/settings.css',
      'media/settings/settings.js',
      'media/autoplan-dom-bridge.js'
    ];

    for (const mod of expectedOutputModules) {
      const fullPath = path.join(rootDir, mod);
      assert.ok(
        fs.existsSync(fullPath),
        `Required module/asset '${mod}' must exist at ${fullPath}`
      );
    }
    console.log(`  ✓ All ${expectedOutputModules.length} core runtime output modules & UI assets verified.\n`);

    // -------------------------------------------------------------------------
    // Suite 2: 3-Tier Prompt Dispatching Regression
    // -------------------------------------------------------------------------
    console.log('[Suite 2] Verifying 3-Tier Prompt Dispatching Architecture...');
    let tier1Called = false;
    let tier2Called = false;
    let tier3Called = false;

    const mockBridgeServer: any = {
      isListening: () => true,
      start: async () => {},
      getConnectedClients: () => [{ id: 'client-1', connectedAt: Date.now() }],
      getPort: () => 48860,
      getWorkspaceName: () => 'test-workspace',
      probeActiveClients: async () => {},
      dispatchPromptCommand: async (prompt: string, opts: any) => {
        tier1Called = true;
        return { success: true, status: 'success', commandId: 'cmd-1', durationMs: 10 };
      },
      dispatchNewConversationCommand: async (opts: any) => {
        return { success: true, status: 'success', commandId: 'conv-1', durationMs: 10 };
      }
    };

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer as any,
      commandExecutor: async (cmd: string, ...args: any[]) => {
        tier2Called = true;
        return true;
      },
      keyboardManager: {
        sendPromptViaKeyboard: async (prompt: string) => {
          tier3Called = true;
          return { success: true };
        }
      } as any,
      configProvider: () => ({
        executionMode: 'auto',
        bridgeTimeoutMs: 5000,
        allowTierFallback: true,
        suppressFallbackWarnings: true
      } as any)
    });

    const dispatchRes = await dispatcher.dispatchPrompt('Test dispatching');
    assert.ok(dispatchRes.success, 'Prompt dispatching must succeed');
    assert.strictEqual(tier1Called, true, 'Tier 1 DOM Bridge must be invoked first when available');
    console.log('  ✓ Subsystem 2: 3-Tier Prompt Dispatching verified.\n');

    // -------------------------------------------------------------------------
    // Suite 3: Telegram Remote Control & AWF Workflow Commands Regression
    // -------------------------------------------------------------------------
    console.log('[Suite 3] Verifying Telegram Remote Commands & AWF Workflow Forwarding...');
    const { bot: mockGrammyBot, sentMessages } = createMockGrammyBot();
    const authorizedUsers = [10001, 10002];

    let lastDispatchedPrompt = '';
    const mockDispatcherForBot: any = {
      dispatchPrompt: async (text: string, options: any) => {
        lastDispatchedPrompt = text;
        return { success: true };
      }
    };

    const originTracker = new PromptOriginTracker({ ttlMs: 2000, capacity: 50 });
    const orchestrator = new Orchestrator({
      promptDispatcher: mockDispatcherForBot,
      originTracker,
      configProvider: () => ({
        longPhaseNudgeEnabled: true,
        longPhaseThresholdSeconds: 180,
        longPhaseNudgeMessage: 'Search online to find the best practices.',
        longPhaseNudgeRecurring: false,
        longPhaseNotifyTelegram: true
      })
    } as any);

    const telegramBridge = new TelegramBridge({
      token: '123456:MOCK_TOKEN_PHASE05',
      botFactory: () => mockGrammyBot,
      orchestrator,
      promptDispatcher: mockDispatcherForBot,
      allowedUsers: authorizedUsers,
      allowFreeChat: true,
      enabled: true
    } as any);

    telegramBridge.initBot();
    await mockGrammyBot.init();

    // Verify formatPlanStatus formatting
    const statusReport = formatPlanStatus({
      state: 'RUNNING',
      currentPhaseName: 'phase-05-regression-benchmark-and-release-v1.6.7.md',
      currentIteration: 1,
      totalIterations: 1,
      completedPhases: 4,
      totalPhases: 5,
      hasNudged: false
    });
    assert.ok(statusReport.includes('RUNNING'), 'formatPlanStatus must include RUNNING state');
    assert.ok(statusReport.includes('phase-05'), 'formatPlanStatus must include phase name');
    assert.ok(statusReport.includes('4/5'), 'formatPlanStatus must include progress 4/5');

    // Test AWF workflow command catalog & normalization (/code, /recap, etc.)
    assert.ok(WORKFLOW_COMMAND_NAMES.has('code'), 'WORKFLOW_COMMAND_NAMES must include code');
    assert.ok(WORKFLOW_COMMAND_NAMES.has('recap'), 'WORKFLOW_COMMAND_NAMES must include recap');
    assert.ok(WORKFLOW_COMMAND_NAMES.has('init'), 'WORKFLOW_COMMAND_NAMES must include init');
    assert.ok(WORKFLOW_COMMAND_NAMES.has('plan'), 'WORKFLOW_COMMAND_NAMES must include plan');
    assert.strictEqual(isWorkflowCommand('code'), true, 'isWorkflowCommand must recognize code');
    assert.strictEqual(isWorkflowCommand('recap'), true, 'isWorkflowCommand must recognize recap');
    console.log('  ✓ Subsystem 3: Telegram Remote Control & AWF Commands verified.\n');

    // -------------------------------------------------------------------------
    // Suite 4: Silent Drop Gating Subsystem (allowFreeChat)
    // -------------------------------------------------------------------------
    console.log('[Suite 4] Verifying Free-Text Chat Silent Drop Gating (allowFreeChat)...');
    
    // Gating enabled (allowFreeChat: false)
    telegramBridge.applyOptions({ allowFreeChat: false });
    assert.strictEqual(telegramBridge.getAllowFreeChat(), false, 'getAllowFreeChat must return false');
    lastDispatchedPrompt = '';
    sentMessages.length = 0;

    await mockGrammyBot.handleUpdate({
      update_id: 201,
      message: {
        message_id: 20,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 10001, type: 'private' },
        from: { id: 10001, is_bot: false, first_name: 'Tester' },
        text: 'can you review my code?'
      }
    } as any);

    assert.strictEqual(
      lastDispatchedPrompt,
      '',
      'Free-form text must NOT be dispatched to IDE when allowFreeChat is false'
    );
    assert.strictEqual(
      sentMessages.length,
      0,
      'No reply must be sent on Telegram for silently dropped messages'
    );

    // Verify slash command executes even when allowFreeChat = false
    await mockGrammyBot.handleUpdate({
      update_id: 202,
      message: {
        message_id: 21,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 10001, type: 'private' },
        from: { id: 10001, is_bot: false, first_name: 'Tester' },
        text: '/code implement silent drop'
      }
    } as any);

    assert.ok(
      lastDispatchedPrompt.includes('/code'),
      'Slash workflow command must execute and dispatch even when allowFreeChat is false'
    );

    // Switch allowFreeChat to true
    telegramBridge.applyOptions({ allowFreeChat: true });
    assert.strictEqual(telegramBridge.getAllowFreeChat(), true, 'getAllowFreeChat must return true');
    lastDispatchedPrompt = '';
    sentMessages.length = 0;

    await mockGrammyBot.handleUpdate({
      update_id: 203,
      message: {
        message_id: 22,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 10001, type: 'private' },
        from: { id: 10001, is_bot: false, first_name: 'Tester' },
        text: 'can you review my code?'
      }
    } as any);

    assert.strictEqual(
      lastDispatchedPrompt,
      'can you review my code?',
      'Free-form text must be dispatched when allowFreeChat is true'
    );
    console.log('  ✓ Subsystem 4: Telegram Free-Text Silent Drop Gating verified.\n');

    // -------------------------------------------------------------------------
    // Suite 5: Watchdog Long-Running Phase Nudge Notifications Regression
    // -------------------------------------------------------------------------
    console.log('[Suite 5] Verifying Watchdog Long-Running Phase Nudge Engine...');
    let nudgeDispatched = '';
    let stopGenerationCalled = false;

    const mockDispatcherWithStop: any = {
      stopActiveGeneration: async () => {
        stopGenerationCalled = true;
        return { stopped: true };
      },
      dispatchPrompt: async (text: string, options: any) => {
        nudgeDispatched = text;
        return { success: true };
      }
    };

    const watchdogOrchestrator = new Orchestrator({
      promptDispatcher: mockDispatcherWithStop,
      originTracker,
      configProvider: () => ({
        longPhaseNudgeEnabled: true,
        longPhaseThresholdSeconds: 180,
        longPhaseNudgeMessage: 'Search online to find the best practices.',
        longPhaseNudgeRecurring: false,
        longPhaseNotifyTelegram: true
      })
    } as any);

    const testPhase: PhaseItem = {
      index: 0,
      phaseNumber: 1,
      fileName: 'phase-01-core.md',
      filePath: path.join(tempDir, 'phase-01-core.md'),
      nativePath: path.join(tempDir, 'phase-01-core.md'),
      normalizedPath: path.join(tempDir, 'phase-01-core.md'),
      status: 'Running',
      hasNudged: false
    };

    watchdogOrchestrator.startPhaseNudgeWatchdog(testPhase, 0, 40);
    await new Promise((r) => setTimeout(r, 600));

    assert.strictEqual(stopGenerationCalled, true, 'Watchdog must trigger stopActiveGeneration');
    assert.ok(nudgeDispatched.length > 0, 'Watchdog must dispatch nudge steering prompt');
    assert.strictEqual(testPhase.hasNudged, true, 'Phase must be marked as hasNudged = true');
    watchdogOrchestrator.stopPhaseNudgeWatchdog();
    console.log('  ✓ Subsystem 5: Long-Running Phase Nudge Watchdog verified.\n');

    // -------------------------------------------------------------------------
    // Suite 6: Settings Webview 4-Tab Navigation, Search & Auto-Save Regression
    // -------------------------------------------------------------------------
    console.log('[Suite 6] Verifying Settings Webview 4-Tab Navigation, Search Filter & Optimistic Rollback...');
    const htmlPath = path.join(rootDir, 'media', 'settings', 'settings.html');
    const cssPath = path.join(rootDir, 'media', 'settings', 'settings.css');
    const jsPath = path.join(rootDir, 'media', 'settings', 'settings.js');

    assert.ok(fs.existsSync(htmlPath), 'settings.html must exist');
    assert.ok(fs.existsSync(cssPath), 'settings.css must exist');
    assert.ok(fs.existsSync(jsPath), 'settings.js must exist');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    // Load in JSDOM
    const dom = new JSDOM(htmlContent, {
      runScripts: 'dangerously',
      url: 'http://localhost/settings.html',
      resources: 'usable'
    });

    const { window } = dom;
    const { document } = window;

    // Verify 4 Tab Buttons exist with ARIA attributes
    const tabs = Array.from(document.querySelectorAll('.nav-tab'));
    assert.strictEqual(tabs.length, 4, 'Must have exactly 4 tab navigation buttons');
    const expectedTabs = ['tab-dispatch', 'tab-telegram', 'tab-automation', 'tab-diagnostics'];
    tabs.forEach((btn, idx) => {
      assert.strictEqual(
        btn.getAttribute('data-tab'),
        expectedTabs[idx],
        `Tab button ${idx} must target ${expectedTabs[idx]}`
      );
      assert.strictEqual(btn.getAttribute('role'), 'tab');
    });

    const tabPanes = Array.from(document.querySelectorAll('.tab-pane'));
    assert.strictEqual(tabPanes.length, 4, 'Must have exactly 4 tab-pane elements');

    // Verify Telegram Card elements exist
    const chkTelegramEnabled = document.getElementById('chkTelegramEnabled') as HTMLInputElement;
    const chkTelegramAllowFreeChat = document.getElementById('chkTelegramAllowFreeChat') as HTMLInputElement;
    const chkTelegramEnableChatMirror = document.getElementById('chkTelegramEnableChatMirror') as HTMLInputElement;
    const tokenBadge = document.getElementById('telegramTokenBadge');

    assert.ok(chkTelegramEnabled, '#chkTelegramEnabled must exist');
    assert.ok(chkTelegramAllowFreeChat, '#chkTelegramAllowFreeChat must exist');
    assert.ok(chkTelegramEnableChatMirror, '#chkTelegramEnableChatMirror must exist');
    assert.ok(tokenBadge, '#telegramTokenBadge must exist');

    // Verify JS logic includes optimistic rollback and debounced auto-save
    assert.ok(
      jsContent.includes('tokenPromptCancelled'),
      'settings.js must handle tokenPromptCancelled IPC message'
    );
    assert.ok(
      jsContent.includes('requestSetTelegramToken'),
      'settings.js must send requestSetTelegramToken when enabling without token'
    );
    assert.ok(
      jsContent.includes('applySearchFilter'),
      'settings.js must implement applySearchFilter search function'
    );
    assert.ok(
      jsContent.includes('scheduleAutoSave'),
      'settings.js must implement scheduleAutoSave debounced auto-save'
    );

    // Verify Backend SettingsProvider token integration
    const secretManager = new SecretStorageManager(mockSecrets as any);
    const mockExtUri = { fsPath: rootDir } as any;
    const settingsProvider = SettingsProvider.render(mockExtUri, undefined, undefined, secretManager);

    // Test getTelegramStatus() without token
    mockConfigStore.telegramBotToken = '';
    await mockSecrets.delete('autoplan.telegram.token');
    const statusNoToken = await (settingsProvider as any).getTelegramStatus();
    assert.strictEqual(statusNoToken.hasToken, false, 'hasToken must be false when secret absent');
    assert.strictEqual((statusNoToken as any).token, undefined, 'Raw token must never be leaked');

    // Test requestSetTelegramToken with cancellation
    mockInputBoxResult = undefined; // simulate Esc / cancel
    let cancelledMsg: any = null;
    const mockWebviewForProvider: any = {
      postMessage: async (msg: any) => {
        if (msg.type === 'tokenPromptCancelled' || msg.command === 'tokenPromptCancelled') {
          cancelledMsg = msg;
        }
      }
    };
    (settingsProvider as any)._panel = { webview: mockWebviewForProvider };
    await (settingsProvider as any).handleMessage({ command: 'requestSetTelegramToken' });

    assert.ok(cancelledMsg, 'tokenPromptCancelled message must be posted to webview upon cancel');
    assert.strictEqual(cancelledMsg.rollback, true, 'Rollback flag must be true');
    console.log('  ✓ Subsystem 6: Settings Webview 4-Tab Navigation & Optimistic Rollback verified.\n');

    // -------------------------------------------------------------------------
    // Suite 7: Release Manifest (package.json) & Documentation Alignment (v1.6.7)
    // -------------------------------------------------------------------------
    console.log('[Suite 7] Verifying package.json Manifest, CHANGELOG, README & .brain Alignment...');
    const packageJsonPath = path.join(rootDir, 'package.json');
    const changelogPath = path.join(rootDir, 'CHANGELOG.md');
    const readmePath = path.join(rootDir, 'README.md');
    const brainJsonPath = path.join(rootDir, '.brain', 'brain.json');
    const sessionJsonPath = path.join(rootDir, '.brain', 'session.json');
    const handoverMdPath = path.join(rootDir, '.brain', 'handover.md');

    // 7.1 package.json
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    assert.strictEqual(pkg.version, '1.6.7', 'package.json version must be 1.6.7');
    assert.strictEqual(pkg.name, 'antigravity-auto-plan', 'package.json name must match');
    assert.ok(
      pkg.scripts?.['test:phase05-release'],
      'package.json scripts must include test:phase05-release'
    );
    assert.ok(
      pkg.contributes?.configuration?.properties?.['autoplan.telegram.allowFreeChat'],
      'package.json must contribute autoplan.telegram.allowFreeChat'
    );
    assert.strictEqual(
      pkg.contributes.configuration.properties['autoplan.telegram.allowFreeChat'].type,
      'boolean',
      'autoplan.telegram.allowFreeChat type must be boolean'
    );
    assert.strictEqual(
      pkg.contributes.configuration.properties['autoplan.telegram.allowFreeChat'].default,
      true,
      'autoplan.telegram.allowFreeChat default must be true'
    );

    // 7.2 CHANGELOG.md
    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    assert.ok(changelogContent.includes('## [1.6.7]'), 'CHANGELOG.md must contain ## [1.6.7]');
    assert.ok(
      changelogContent.includes('autoplan.telegram.allowFreeChat'),
      'CHANGELOG.md must detail autoplan.telegram.allowFreeChat'
    );
    assert.ok(
      changelogContent.includes('Modern Tab-Based Settings Dashboard'),
      'CHANGELOG.md must detail Modern Tab-Based Settings Dashboard'
    );
    assert.ok(
      changelogContent.includes('SecretStorage'),
      'CHANGELOG.md must detail SecretStorage token management'
    );

    // 7.3 README.md
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    assert.ok(readmeContent.includes('version-1.6.7'), 'README.md must display version 1.6.7 badge');
    assert.ok(
      readmeContent.includes('antigravity-auto-plan-1.6.7.vsix'),
      'README.md must reference antigravity-auto-plan-1.6.7.vsix installation'
    );
    assert.ok(
      readmeContent.includes('autoplan.telegram.allowFreeChat'),
      'README.md must document autoplan.telegram.allowFreeChat'
    );

    // 7.4 .brain/ State Files
    const brainJson = JSON.parse(fs.readFileSync(brainJsonPath, 'utf8'));
    assert.strictEqual(brainJson.project?.version, '1.6.7', '.brain/brain.json version must be 1.6.7');
    assert.ok(
      brainJson.tech_stack?.chat_gating,
      '.brain/brain.json tech_stack must include chat_gating'
    );
    assert.ok(
      brainJson.tech_stack?.settings_dashboard,
      '.brain/brain.json tech_stack must include settings_dashboard'
    );

    const sessionJson = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
    assert.strictEqual(sessionJson.working_on?.status, 'completed', '.brain/session.json status must be completed');
    const hasV167Change = sessionJson.recent_changes?.some((c: any) =>
      c.description?.includes('1.6.7')
    );
    assert.ok(hasV167Change, '.brain/session.json recent_changes must include 1.6.7 release');

    const handoverContent = fs.readFileSync(handoverMdPath, 'utf8');
    assert.ok(handoverContent.includes('v1.6.7'), '.brain/handover.md must reference v1.6.7');
    assert.ok(
      handoverContent.includes('antigravity-auto-plan-1.6.7.vsix'),
      '.brain/handover.md must reference antigravity-auto-plan-1.6.7.vsix'
    );
    console.log('  ✓ Subsystem 7: Manifest, CHANGELOG, README & .brain files verified.\n');

    // -------------------------------------------------------------------------
    // Suite 8: Production VSIX Packaging & Security Integrity (v1.6.7)
    // -------------------------------------------------------------------------
    console.log('[Suite 8] Verifying Production VSIX Packaging (antigravity-auto-plan-1.6.7.vsix)...');
    const vsixPath = path.join(rootDir, 'antigravity-auto-plan-1.6.7.vsix');
    assert.ok(fs.existsSync(vsixPath), `VSIX release artifact must exist at: ${vsixPath}`);

    const vsixStats = fs.statSync(vsixPath);
    console.log(`     Release VSIX size: ${(vsixStats.size / 1024).toFixed(2)} KB`);
    assert.ok(
      vsixStats.size > 500 * 1024,
      `VSIX release bundle must contain production dependencies (> 500 KB), actual: ${vsixStats.size} bytes`
    );

    // Verify valid ZIP magic header (PK\x03\x04)
    const fd = fs.openSync(vsixPath, 'r');
    const magicBuf = Buffer.alloc(4);
    fs.readSync(fd, magicBuf, 0, 4, 0);
    fs.closeSync(fd);
    assert.strictEqual(
      magicBuf.toString('hex'),
      '504b0304',
      'VSIX file must possess valid zip magic header (PK\\x03\\x04)'
    );

    // Deep-audit entries inside the VSIX package
    const vsixAudit = await auditVsixArchive(vsixPath);
    console.log(`     Total files packaged in VSIX: ${vsixAudit.totalFiles}`);
    assert.ok(vsixAudit.totalFiles > 100, `Expected > 100 packaged files, found ${vsixAudit.totalFiles}`);

    // Verify package.json inside VSIX has 1.6.7 version
    assert.ok(vsixAudit.packageJson, 'Packaged extension/package.json must be readable');
    assert.strictEqual(
      vsixAudit.packageJson.version,
      '1.6.7',
      `Packaged extension version must be 1.6.7 (got ${vsixAudit.packageJson?.version})`
    );
    assert.strictEqual(
      vsixAudit.packageJson.name,
      'antigravity-auto-plan',
      'Packaged extension name must match antigravity-auto-plan'
    );

    // Verify critical files are packaged
    const criticalPackageFiles = [
      'extension/package.json',
      'extension/CHANGELOG.md',
      'extension/README.md',
      'extension/out/extension.js',
      'extension/out/config.js',
      'extension/out/settingsProvider.js',
      'extension/out/telegramBridge.js',
      'extension/media/settings/settings.html',
      'extension/media/settings/settings.css',
      'extension/media/settings/settings.js',
      'extension/media/autoplan-dom-bridge.js'
    ];

    for (const critFile of criticalPackageFiles) {
      assert.ok(
        vsixAudit.files.includes(critFile),
        `Critical file '${critFile}' must be packaged inside VSIX`
      );
    }

    // Verify production dependency (grammy) is bundled
    const hasGrammy = vsixAudit.files.some((f) => f.startsWith('extension/node_modules/grammy/'));
    assert.ok(hasGrammy, 'Production dependency grammy must be bundled in VSIX node_modules');

    // Verify zero leaked credentials/tokens
    if (vsixAudit.leakedSecretFindings.length > 0) {
      console.error('Leaked secret findings detected in VSIX:', vsixAudit.leakedSecretFindings);
      assert.fail(`Detected ${vsixAudit.leakedSecretFindings.length} leaked credential findings in VSIX`);
    }
    console.log('  ✓ Subsystem 8: Production VSIX package integrity, version 1.6.7, and security verified.\n');

    console.log('================================================================================');
    console.log(' 🎉 ALL 8 PHASE 05 REGRESSION, DOCS & RELEASE PACKAGING TESTS PASSED (100%)!');
    console.log('================================================================================\n');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

// Direct CLI execution
if (require.main === module) {
  runPhase05ReleaseRegressionTest()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ Phase 05 Release Test FAILED:', err);
      process.exit(1);
    });
}
