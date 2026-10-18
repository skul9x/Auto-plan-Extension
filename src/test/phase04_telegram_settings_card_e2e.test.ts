// Self-healing ESM require guard for JSDOM in Node < 20.19 CommonJS
if (!process.env.__PHASE04_TELEGRAM_SETTINGS_REEXEC__) {
  try {
    require('jsdom');
  } catch (e: any) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      const { execFileSync } = require('child_process');
      const env = {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-require-module`.trim(),
        __PHASE04_TELEGRAM_SETTINGS_REEXEC__: '1'
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

// Standalone Mock Setup for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

interface MockDisposable {
  dispose: () => void;
}

let mockConfigStore: Record<string, any> = {};
const executedCommands: { command: string; args: any[] }[] = [];
let mockInputBoxValue: string | undefined = undefined;

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

  onDidReceiveMessage(listener: (msg: any) => void, _thisArgs?: any, disposables?: any[]): MockDisposable {
    this.messageListeners.push(listener);
    const disp = {
      dispose: () => {
        const idx = this.messageListeners.indexOf(listener);
        if (idx !== -1) {
          this.messageListeners.splice(idx, 1);
        }
      }
    };
    if (disposables) {
      disposables.push(disp);
    }
    return disp;
  }

  async postMessage(msg: any): Promise<boolean> {
    this.messagesPosted.push(msg);
    return true;
  }
}

class MockWebviewPanel {
  public viewType: string;
  public title: string;
  public showOptions: any;
  public options: any;
  public iconPath: any;
  public webview: MockWebview;
  public visible: boolean = true;
  public viewColumn: number = 1;
  public isDisposed: boolean = false;
  private disposeListeners: (() => void)[] = [];

  constructor(viewType: string, title: string, showOptions: any, options: any) {
    this.viewType = viewType;
    this.title = title;
    this.showOptions = showOptions;
    this.options = options;
    this.webview = new MockWebview();
  }

  reveal(column?: number) {
    if (column !== undefined) {
      this.viewColumn = column;
    }
    this.visible = true;
  }

  onDidDispose(listener: () => void, _thisArgs?: any, disposables?: any[]): MockDisposable {
    this.disposeListeners.push(listener);
    const disp = {
      dispose: () => {
        const idx = this.disposeListeners.indexOf(listener);
        if (idx !== -1) {
          this.disposeListeners.splice(idx, 1);
        }
      }
    };
    if (disposables) {
      disposables.push(disp);
    }
    return disp;
  }

  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.visible = false;
    for (const l of [...this.disposeListeners]) {
      l();
    }
  }
}

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          { name: 'test-workspace', uri: { fsPath: '/mock/workspace' } }
        ],
        getConfiguration: (section?: string) => ({
          get: (key: string, defaultValue: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            if (mockConfigStore[fullKey] !== undefined) return mockConfigStore[fullKey];
            if (mockConfigStore[key] !== undefined) return mockConfigStore[key];
            return defaultValue;
          },
          update: async (key: string, value: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            mockConfigStore[fullKey] = value;
            mockConfigStore[key] = value;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      window: {
        showInformationMessage: async () => {},
        showErrorMessage: async () => {},
        showWarningMessage: async () => {},
        showInputBox: async (options?: any) => {
          return mockInputBoxValue;
        },
        createWebviewPanel: (viewType: string, title: string, showOptions: any, options: any) => {
          return new MockWebviewPanel(viewType, title, showOptions, options);
        }
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: async (cmd: string, ...args: any[]) => {
          executedCommands.push({ command: cmd, args });
        }
      },
      Uri: {
        file: (p: string) => ({ fsPath: p, path: p }),
        joinPath: (base: any, ...segments: string[]) => ({
          fsPath: path.join(base.fsPath || base.path || '', ...segments),
          path: path.join(base.path || base.fsPath || '', ...segments)
        })
      },
      ViewColumn: { Active: 1 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { JSDOM } from 'jsdom';
import { SecretStorageManager } from '../config';
import { SettingsProvider } from '../settingsProvider';

interface MockVsCodeApi {
  postMessage: (msg: any) => void;
  getState: () => any;
  setState: (state: any) => void;
  postedMessages: any[];
}

function createMockVsCode(initialState: any = null): MockVsCodeApi {
  let state = initialState ? { ...initialState } : null;
  const postedMessages: any[] = [];

  return {
    postMessage: (msg: any) => {
      postedMessages.push(msg);
    },
    getState: () => state,
    setState: (newState: any) => {
      state = { ...newState };
    },
    postedMessages
  };
}

function setupTestDom(initialState: any = null): {
  dom: JSDOM;
  window: any;
  document: Document;
  mockVsCode: MockVsCodeApi;
  exports: any;
} {
  const rootDir = path.resolve(__dirname, '../..');
  const htmlPath = path.join(rootDir, 'media/settings/settings.html');
  const jsPath = path.join(rootDir, 'media/settings/settings.js');

  const rawHtml = fs.readFileSync(htmlPath, 'utf8');
  // Strip out CSP and template placeholders for standalone test harness
  const cleanHtml = rawHtml
    .replace(/\$\{webview\.cspSource\}/g, '')
    .replace(/\$\{nonce\}/g, 'test-nonce')
    .replace(/\$\{styleUri\}/g, '')
    .replace(/\$\{scriptUri\}/g, '');

  const dom = new JSDOM(cleanHtml, {
    runScripts: 'outside-only',
    url: 'http://localhost'
  });

  const { window } = dom;
  const { document } = window;
  const mockVsCode = createMockVsCode(initialState);
  (window as any).__mockVsCode = mockVsCode;

  // Execute settings.js inside the window context
  const jsCode = fs.readFileSync(jsPath, 'utf8');
  const scriptFunction = new Function('window', 'document', 'acquireVsCodeApi', 'module', 'exports', jsCode);
  const mockModule: any = { exports: {} };
  scriptFunction(window, document, () => mockVsCode, mockModule, mockModule.exports);

  return {
    dom,
    window,
    document,
    mockVsCode,
    exports: mockModule.exports
  };
}

async function runPhase04TelegramSettingsCardE2ETest(): Promise<void> {
  console.log('================================================================');
  console.log(' Phase 04: Telegram Settings Card & Rollback E2E Test Suite');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // Test Suite 1: Telegram Remote Control Card DOM Structure & Attributes
  // -------------------------------------------------------------------------
  console.log('[Suite 1] Verifying Telegram Card elements, attributes, and tooltips in settings.html...');
  {
    const { document } = setupTestDom();

    const telegramSection = document.getElementById('sectionTelegramSettings');
    assert.ok(telegramSection, '#sectionTelegramSettings card must exist');
    assert.ok(telegramSection.classList.contains('glass-card'), '#sectionTelegramSettings must have .glass-card class');

    // Master switch
    const chkEnabled = document.getElementById('chkTelegramEnabled') as HTMLInputElement | null;
    assert.ok(chkEnabled, '#chkTelegramEnabled input must exist');
    assert.strictEqual(chkEnabled.type, 'checkbox', '#chkTelegramEnabled must be a checkbox');

    // Free chat gating switch
    const chkFreeChat = document.getElementById('chkTelegramAllowFreeChat') as HTMLInputElement | null;
    assert.ok(chkFreeChat, '#chkTelegramAllowFreeChat input must exist');
    assert.strictEqual(chkFreeChat.type, 'checkbox', '#chkTelegramAllowFreeChat must be a checkbox');
    const freeChatDesc = chkFreeChat.closest('.switch-container')?.querySelector('.toggle-description')?.textContent || '';
    assert.ok(
      freeChatDesc.includes('free-form text messages are silently dropped') && freeChatDesc.includes('slash commands'),
      `Free chat description must mention silent drop of text while slash commands remain active. Got: "${freeChatDesc}"`
    );

    // Live Q&A Mirroring switch
    const chkMirror = document.getElementById('chkTelegramEnableChatMirror') as HTMLInputElement | null;
    assert.ok(chkMirror, '#chkTelegramEnableChatMirror input must exist');
    assert.strictEqual(chkMirror.type, 'checkbox', '#chkTelegramEnableChatMirror must be a checkbox');

    // Allowed Users input
    const txtAllowedUsers = document.getElementById('txtTelegramAllowedUsers') as HTMLInputElement | null;
    assert.ok(txtAllowedUsers, '#txtTelegramAllowedUsers input must exist');

    // Throttle range slider & badge
    const rngThrottle = document.getElementById('rngTelegramThrottleMs') as HTMLInputElement | null;
    const lblThrottle = document.getElementById('lblTelegramThrottleVal');
    assert.ok(rngThrottle, '#rngTelegramThrottleMs range input must exist');
    assert.ok(lblThrottle, '#lblTelegramThrottleVal badge must exist');
    assert.strictEqual(rngThrottle.min, '500', 'Throttle slider min should be 500');
    assert.strictEqual(rngThrottle.max, '10000', 'Throttle slider max should be 10000');

    // Token management elements
    const tokenBadge = document.getElementById('telegramTokenBadge');
    const btnSetToken = document.getElementById('btnSetTelegramToken');
    const btnClearToken = document.getElementById('btnClearTelegramToken');
    assert.ok(tokenBadge, '#telegramTokenBadge must exist');
    assert.ok(btnSetToken, '#btnSetTelegramToken must exist');
    assert.ok(btnClearToken, '#btnClearTelegramToken must exist');
    assert.ok(tokenBadge.classList.contains('status-badge'), '#telegramTokenBadge must have .status-badge class');

    console.log('  ✓ [Suite 1 Passed] DOM structure, toggles, badge, slider and buttons verified.');
  }

  // -------------------------------------------------------------------------
  // Test Suite 2: State Synchronization with AutoPlanConfig & initSettings
  // -------------------------------------------------------------------------
  console.log('\n[Suite 2] Verifying State Synchronization with AutoPlanConfig...');
  {
    const { window, document, exports } = setupTestDom();

    const sampleConfig = {
      telegramEnabled: true,
      telegramAllowFreeChat: false,
      telegramEnableChatMirror: true,
      telegramAllowedUsers: [111222, '333444'],
      telegramThrottleMs: 4500
    };

    // Dispatch initSettings message
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: {
          command: 'initSettings',
          settings: sampleConfig
        }
      })
    );

    const chkEnabled = document.getElementById('chkTelegramEnabled') as HTMLInputElement;
    const chkFreeChat = document.getElementById('chkTelegramAllowFreeChat') as HTMLInputElement;
    const chkMirror = document.getElementById('chkTelegramEnableChatMirror') as HTMLInputElement;
    const txtAllowedUsers = document.getElementById('txtTelegramAllowedUsers') as HTMLInputElement;
    const rngThrottle = document.getElementById('rngTelegramThrottleMs') as HTMLInputElement;
    const lblThrottle = document.getElementById('lblTelegramThrottleVal');

    assert.strictEqual(chkEnabled.checked, true, 'chkTelegramEnabled should be true from initSettings');
    assert.strictEqual(chkFreeChat.checked, false, 'chkTelegramAllowFreeChat should be false from initSettings');
    assert.strictEqual(chkMirror.checked, true, 'chkTelegramEnableChatMirror should be true from initSettings');
    assert.ok(txtAllowedUsers.value.includes('111222'), 'Allowed users should include 111222');
    assert.strictEqual(rngThrottle.value, '4500', 'Throttle range should be 4500');
    assert.strictEqual(lblThrottle?.textContent, '4500ms', 'Throttle badge text should be 4500ms');

    // Test getFormSettings serialization
    const collected = exports.getFormSettings();
    assert.strictEqual(collected.telegramEnabled, true);
    assert.strictEqual(collected.telegramAllowFreeChat, false);
    assert.strictEqual(collected.telegramEnableChatMirror, true);
    assert.strictEqual(collected.telegramThrottleMs, 4500);
    assert.deepStrictEqual(collected.telegramAllowedUsers, ['111222', '333444']);

    console.log('  ✓ [Suite 2 Passed] Configuration state synchronization and serialization verified.');
  }

  // -------------------------------------------------------------------------
  // Test Suite 3: Missing Token & Optimistic Toggle Reversal (Rollback)
  // -------------------------------------------------------------------------
  console.log('\n[Suite 3] Verifying Optimistic Rollback when token is missing and user cancels prompt...');
  {
    const { window, document, mockVsCode, exports } = setupTestDom();

    // Ensure initial status: hasToken = false, enabled = false
    exports.setCurrentTelegramStatus({
      enabled: false,
      allowFreeChat: true,
      enableChatMirror: true,
      hasToken: false,
      allowedUsers: [],
      throttleMs: 2500
    });

    const chkEnabled = document.getElementById('chkTelegramEnabled') as HTMLInputElement;
    chkEnabled.checked = false;
    mockVsCode.postedMessages.length = 0;

    // User flips switch ON
    chkEnabled.checked = true;
    chkEnabled.dispatchEvent(new window.Event('change'));

    // Webview must immediately detect hasToken === false and request token prompt
    const promptRequests = mockVsCode.postedMessages.filter((m) => m.command === 'requestSetTelegramToken');
    assert.strictEqual(promptRequests.length, 1, 'Webview must send requestSetTelegramToken when toggling ON without token');

    // Ensure no premature autoSave was dispatched
    const prematureSave = mockVsCode.postedMessages.filter((m) => m.command === 'saveSettings' && m.settings?.telegramEnabled === true);
    assert.strictEqual(prematureSave.length, 0, 'Must NOT prematurely dispatch saveSettings before token prompt is resolved');

    // Backend informs user cancelled (Esc or Cancel button) -> rollback
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: {
          command: 'tokenPromptCancelled',
          rollback: true,
          enabled: false
        }
      })
    );

    // Verify switch is reverted to OFF
    assert.strictEqual(chkEnabled.checked, false, 'chkTelegramEnabled must roll back to false after tokenPromptCancelled');

    // Verify toast notification is displayed
    const toast = document.getElementById('toastNotification');
    assert.ok(toast, '#toastNotification must exist');
    assert.ok(toast.classList.contains('toast-warning'), 'Toast should have toast-warning class');
    assert.ok(toast.textContent?.includes('Telegram requires a valid bot token to enable'), 'Toast should display rollback rationale');

    console.log('  ✓ [Suite 3 Passed] Missing token prompt request and optimistic rollback verified.');
  }

  // -------------------------------------------------------------------------
  // Test Suite 4: Token Submission & Successful Enablement (Without Secret Leaks)
  // -------------------------------------------------------------------------
  console.log('\n[Suite 4] Verifying Token Update and Status Badge update without raw token leak...');
  {
    const { window, document, mockVsCode, exports } = setupTestDom();

    const tokenBadge = document.getElementById('telegramTokenBadge');
    const chkEnabled = document.getElementById('chkTelegramEnabled') as HTMLInputElement;

    // Simulate backend sending successful telegramTokenUpdated
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: {
          command: 'telegramTokenUpdated',
          hasToken: true,
          enabled: true,
          status: {
            enabled: true,
            allowFreeChat: true,
            enableChatMirror: true,
            hasToken: true,
            allowedUsers: [999888],
            throttleMs: 2500
          }
        }
      })
    );

    assert.strictEqual(chkEnabled.checked, true, 'chkTelegramEnabled should be checked after token update');
    assert.ok(tokenBadge?.classList.contains('badge-success'), 'tokenBadge should have badge-success class');
    assert.strictEqual(tokenBadge?.textContent, '🟢 Configured in SecretStorage', 'Badge should indicate configured in SecretStorage');

    // CRITICAL: Ensure raw token string is nowhere in the DOM
    const rawHtml = document.body.innerHTML;
    assert.ok(!rawHtml.includes('bot_secret_token_12345'), 'Raw secret token must NEVER be written to the DOM');

    // Verify that subsequent toggle off and on does NOT trigger token prompt since hasToken is now true
    mockVsCode.postedMessages.length = 0;
    chkEnabled.checked = false;
    chkEnabled.dispatchEvent(new window.Event('change'));
    assert.strictEqual(mockVsCode.postedMessages.filter((m) => m.command === 'requestSetTelegramToken').length, 0);

    chkEnabled.checked = true;
    chkEnabled.dispatchEvent(new window.Event('change'));
    assert.strictEqual(mockVsCode.postedMessages.filter((m) => m.command === 'requestSetTelegramToken').length, 0);

    console.log('  ✓ [Suite 4 Passed] Token badge updated securely without leaking secrets.');
  }

  // -------------------------------------------------------------------------
  // Test Suite 5: Whitelist & Throttle Slider Live Interaction
  // -------------------------------------------------------------------------
  console.log('\n[Suite 5] Verifying Whitelist and Throttle Slider interactions...');
  {
    const { window, document, exports } = setupTestDom();

    const txtAllowedUsers = document.getElementById('txtTelegramAllowedUsers') as HTMLInputElement;
    const rngThrottle = document.getElementById('rngTelegramThrottleMs') as HTMLInputElement;
    const lblThrottle = document.getElementById('lblTelegramThrottleVal');

    txtAllowedUsers.value = '555111, 777222, 999333';
    txtAllowedUsers.dispatchEvent(new window.Event('input'));

    rngThrottle.value = '7500';
    rngThrottle.dispatchEvent(new window.Event('input'));

    assert.strictEqual(lblThrottle?.textContent, '7500ms', 'Throttle badge should update on input event');

    rngThrottle.value = '3000';
    rngThrottle.dispatchEvent(new window.Event('change'));
    assert.strictEqual(lblThrottle?.textContent, '3000ms', 'Throttle badge should update on change event');

    const formSettings = exports.getFormSettings();
    assert.deepStrictEqual(formSettings.telegramAllowedUsers, ['555111', '777222', '999333']);
    assert.strictEqual(formSettings.telegramThrottleMs, 3000);

    console.log('  ✓ [Suite 5 Passed] Whitelist formatting and throttle slider live updates verified.');
  }

  // -------------------------------------------------------------------------
  // Test Suite 6: Token Button Clicks & Token Clearing Flow
  // -------------------------------------------------------------------------
  console.log('\n[Suite 6] Verifying Set/Clear Token button dispatches and clearing rollback...');
  {
    const { window, document, mockVsCode } = setupTestDom();

    const btnSetToken = document.getElementById('btnSetTelegramToken');
    const btnClearToken = document.getElementById('btnClearTelegramToken');
    const tokenBadge = document.getElementById('telegramTokenBadge');
    const chkEnabled = document.getElementById('chkTelegramEnabled') as HTMLInputElement;

    mockVsCode.postedMessages.length = 0;

    // Click Set Token button
    btnSetToken?.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.strictEqual(
      mockVsCode.postedMessages.filter((m) => m.command === 'requestSetTelegramToken').length,
      1,
      'Clicking btnSetTelegramToken must post requestSetTelegramToken'
    );

    // Click Clear Token button
    btnClearToken?.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.strictEqual(
      mockVsCode.postedMessages.filter((m) => m.command === 'requestClearTelegramToken').length,
      1,
      'Clicking btnClearTelegramToken must post requestClearTelegramToken'
    );

    // Backend replies with token cleared
    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: {
          command: 'telegramTokenCleared',
          hasToken: false,
          status: {
            enabled: false,
            allowFreeChat: true,
            enableChatMirror: true,
            hasToken: false,
            allowedUsers: [],
            throttleMs: 2500
          }
        }
      })
    );

    assert.ok(tokenBadge?.classList.contains('badge-warning'), 'Badge must have badge-warning after clearing');
    assert.strictEqual(tokenBadge?.textContent, '🔴 Token Missing');
    assert.strictEqual(chkEnabled.checked, false, 'chkTelegramEnabled should be turned off when token is cleared');

    console.log('  ✓ [Suite 6 Passed] Token button IPC and token clearing flow verified.');
  }

  // -------------------------------------------------------------------------
  // Test Suite 7: SettingsProvider Backend End-to-End Integration
  // -------------------------------------------------------------------------
  console.log('\n[Suite 7] Verifying SettingsProvider backend IPC handling and secret storage protection...');
  {
    const mockStorage = new MockSecretStorage();
    const secretManager = new SecretStorageManager(mockStorage as any);

    // Clear config store
    mockConfigStore = {
      'autoplan.telegramEnabled': false,
      'autoplan.telegram.allowFreeChat': true,
      'autoplan.telegram.enableChatMirror': true,
      'autoplan.telegramThrottleMs': 2500,
      'autoplan.telegramAllowedUsers': []
    };

    // Test 7.1: getTelegramStatus without token
    const mockPanel: any = {
      webview: {
        html: '',
        postMessage: (msg: any) => {
          mockPanel.messages.push(msg);
          return Promise.resolve(true);
        },
        asWebviewUri: (u: any) => u,
        onDidReceiveMessage: () => ({ dispose: () => {} }),
        cspSource: 'vscode-webview:'
      },
      iconPath: null,
      onDidDispose: () => ({ dispose: () => {} }),
      dispose: () => {},
      messages: []
    };

    const provider = SettingsProvider.render({ fsPath: '/test/ext' } as any, undefined, undefined, secretManager);
    (provider as any)._panel = mockPanel;

    const initialStatus = await provider.getTelegramStatus();
    assert.strictEqual(initialStatus.hasToken, false, 'Initial status hasToken must be false');
    assert.strictEqual(initialStatus.enabled, false);

    // Test 7.2: User cancels token input -> rollback message sent
    mockPanel.messages.length = 0;
    mockInputBoxValue = undefined; // User cancelled
    await provider.handleMessage({ command: 'requestSetTelegramToken' });

    const cancelMsg = mockPanel.messages.find((m: any) => m.command === 'tokenPromptCancelled');
    assert.ok(cancelMsg, 'SettingsProvider must post tokenPromptCancelled on cancel');
    assert.strictEqual(cancelMsg.rollback, true, 'Rollback flag must be true');

    // Test 7.3: User enters valid token -> SecretStorage updated, telegramEnabled: true
    mockPanel.messages.length = 0;
    mockInputBoxValue = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ';
    await provider.handleMessage({ command: 'requestSetTelegramToken' });

    const savedToken = await secretManager.getTelegramToken();
    assert.strictEqual(savedToken, '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ', 'Token must be stored in SecretStorage');
    assert.strictEqual(mockConfigStore['autoplan.telegramEnabled'], true, 'telegramEnabled must be updated to true');

    const updateMsg = mockPanel.messages.find((m: any) => m.command === 'telegramTokenUpdated');
    assert.ok(updateMsg, 'SettingsProvider must post telegramTokenUpdated');
    assert.strictEqual(updateMsg.hasToken, true);
    assert.strictEqual(updateMsg.enabled, true);

    // Verify token is NOT sent in status
    const statusMsg = mockPanel.messages.find((m: any) => m.command === 'telegramStatusUpdate');
    assert.ok(statusMsg, 'telegramStatusUpdate must be dispatched');
    assert.strictEqual(statusMsg.status.hasToken, true);
    assert.strictEqual((statusMsg.status as any).botToken, undefined, 'Raw botToken must never be included in status payload');

    // Test 7.4: Clear token
    mockPanel.messages.length = 0;
    await provider.handleMessage({ command: 'requestClearTelegramToken' });

    const clearedToken = await secretManager.getTelegramToken();
    assert.strictEqual(clearedToken, undefined, 'Token in SecretStorage must be deleted');

    const clearMsg = mockPanel.messages.find((m: any) => m.command === 'telegramTokenCleared');
    assert.ok(clearMsg, 'SettingsProvider must post telegramTokenCleared');
    assert.strictEqual(clearMsg.hasToken, false);

    provider.dispose();
    console.log('  ✓ [Suite 7 Passed] SettingsProvider backend integration and secret storage protection verified.');
  }

  console.log('\n================================================================');
  console.log(' ✅ ALL PHASE 04 TELEGRAM SETTINGS CARD & ROLLBACK TESTS PASSED');
  console.log('================================================================');
}

runPhase04TelegramSettingsCardE2ETest().catch((err) => {
  console.error('\n❌ Test execution failed with error:');
  console.error(err);
  process.exit(1);
});
