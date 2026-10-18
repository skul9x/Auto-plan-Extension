// Standalone Mock Setup for 'vscode' before importing application modules
const Module = require('module');
const originalRequire = Module.prototype.require;

interface MockDisposable {
  dispose: () => void;
}

let mockConfigStore: Record<string, any> = {};
const configListeners: ((e: any) => void)[] = [];
const createdWebviewPanels: any[] = [];
let mockInputBoxValue: string | undefined = undefined;
let lastInputBoxOptions: any = undefined;
const executedCommands: { command: string; args: any[] }[] = [];

class MockWebview {
  public html: string = '';
  public options: any = {};
  public cspSource: string = 'vscode-webview:';
  private messageListeners: ((msg: any) => void)[] = [];
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

  async simulateMessageFromWebview(msg: any): Promise<void> {
    for (const l of [...this.messageListeners]) {
      await l(msg);
    }
  }

  clearMessages(): void {
    this.messagesPosted.length = 0;
  }

  findMessages(commandOrType: string): any[] {
    return this.messagesPosted.filter(
      (m) => m.command === commandOrType || m.type === commandOrType
    );
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

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section?: string) => ({
          get: (key: string, defaultValue: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            if (mockConfigStore[fullKey] !== undefined) return mockConfigStore[fullKey];
            if (mockConfigStore[key] !== undefined) return mockConfigStore[key];
            return defaultValue;
          },
          update: async (key: string, value: any, _target?: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            mockConfigStore[fullKey] = value;
            mockConfigStore[key] = value;
            for (const l of configListeners) {
              l({ affectsConfiguration: (s: string) => s === section || s === 'autoplan' });
            }
          }
        }),
        onDidChangeConfiguration: (listener: (e: any) => void) => {
          configListeners.push(listener);
          return {
            dispose: () => {
              const idx = configListeners.indexOf(listener);
              if (idx !== -1) configListeners.splice(idx, 1);
            }
          };
        },
        workspaceFolders: []
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      ViewColumn: {
        Active: -1,
        Beside: -2,
        One: 1,
        Two: 2
      },
      StatusBarAlignment: {
        Left: 1,
        Right: 2
      },
      Uri: {
        file: (fsPath: string) => ({
          fsPath,
          path: fsPath,
          scheme: 'file',
          toString: () => `file://${fsPath}`
        }),
        joinPath: (baseUri: any, ...pathSegments: string[]) => {
          const pathModule = require('path');
          const joined = pathModule.join(baseUri.fsPath || baseUri.path || '', ...pathSegments);
          return {
            fsPath: joined,
            path: joined,
            scheme: 'file',
            toString: () => `file://${joined}`
          };
        }
      },
      window: {
        createWebviewPanel: (viewType: string, title: string, showOptions: any, options: any) => {
          const panel = new MockWebviewPanel(viewType, title, showOptions, options);
          createdWebviewPanels.push(panel);
          return panel;
        },
        showInputBox: async (options: any) => {
          lastInputBoxOptions = options;
          return mockInputBoxValue;
        },
        showInformationMessage: async () => {},
        showErrorMessage: async () => {},
        showWarningMessage: async () => {},
        showOpenDialog: async () => undefined,
        activeTextEditor: undefined
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: async (command: string, ...args: any[]) => {
          executedCommands.push({ command, args });
          return undefined;
        }
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { SettingsProvider } from '../settingsProvider';
import {
  SecretStorageManager,
  TELEGRAM_TOKEN_SECRET_KEY,
  getTelegramConfig,
  getConfig
} from '../config';

async function runPhase02SettingsTelegramTokenIpcTest(): Promise<void> {
  console.log('================================================================');
  console.log(' Phase 02: Token SecretStorage Bridge API & Rollback Handler Test');
  console.log('================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-tg-phase02-ipc-'));
  const mockExtUri = vscode.Uri.file(testTempDir);

  // Create media/settings directories for asset resolution
  fs.mkdirSync(path.join(testTempDir, 'media', 'settings'), { recursive: true });
  fs.writeFileSync(path.join(testTempDir, 'media', 'settings', 'settings.html'), '<html><body>Settings</body></html>');
  fs.writeFileSync(path.join(testTempDir, 'media', 'settings', 'settings.css'), '/* css */');
  fs.writeFileSync(path.join(testTempDir, 'media', 'settings', 'settings.js'), '// js');

  try {
    // -------------------------------------------------------------------------
    // Test Suite 1: getTelegramStatus() Secure Introspection & Secret Shielding
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Verifying getTelegramStatus() without secret leakage...');
    {
      const mockSecrets = new MockSecretStorage();
      const secretManager = new SecretStorageManager(mockSecrets as any);

      // Clean config store
      mockConfigStore = {
        telegramEnabled: true,
        'telegram.allowFreeChat': true,
        'telegram.enableChatMirror': true,
        telegramAllowedUsers: [12345678, '98765432'],
        telegramThrottleMs: 2500,
        telegramBotToken: ''
      };

      const provider = SettingsProvider.render(mockExtUri, undefined, undefined, secretManager);
      assert.ok(provider, 'SettingsProvider instance should be created');

      // 1.1 Status when no token exists anywhere
      const statusNoToken = await provider.getTelegramStatus();
      assert.strictEqual(statusNoToken.hasToken, false, 'hasToken must be false when no token stored');
      assert.strictEqual(statusNoToken.enabled, true, 'enabled must match config');
      assert.strictEqual(statusNoToken.allowFreeChat, true, 'allowFreeChat must be true');
      assert.strictEqual(statusNoToken.enableChatMirror, true, 'enableChatMirror must be true');
      assert.deepStrictEqual(statusNoToken.allowedUsers, [12345678, '98765432'], 'allowedUsers should match');
      assert.strictEqual(statusNoToken.throttleMs, 2500, 'throttleMs should match');

      // Verify that no secret token or token string is leaked in the returned keys or object
      assert.strictEqual((statusNoToken as any).token, undefined, 'raw token field must not exist');
      assert.strictEqual((statusNoToken as any).botToken, undefined, 'raw botToken field must not exist');
      assert.strictEqual((statusNoToken as any).telegramBotToken, undefined, 'raw telegramBotToken must not exist');

      // 1.2 Store token in SecretStorage
      const secretTokenVal = '999888777:SecretStorageBotTokenValXYZ';
      await mockSecrets.store(TELEGRAM_TOKEN_SECRET_KEY, secretTokenVal);

      const statusWithSecret = await provider.getTelegramStatus();
      assert.strictEqual(statusWithSecret.hasToken, true, 'hasToken must be true when token in SecretStorage');
      assert.strictEqual(
        JSON.stringify(statusWithSecret).includes(secretTokenVal),
        false,
        'Secret token value must NEVER be serialized or present in getTelegramStatus() result'
      );

      // 1.3 Precedence & Fallback: when SecretStorage is empty but config has token
      await mockSecrets.delete(TELEGRAM_TOKEN_SECRET_KEY);
      mockConfigStore['telegramBotToken'] = '111222333:ConfigFallbackBotToken';

      const statusWithFallback = await provider.getTelegramStatus();
      assert.strictEqual(statusWithFallback.hasToken, true, 'hasToken must be true with config fallback');
      assert.strictEqual(
        JSON.stringify(statusWithFallback).includes('ConfigFallbackBotToken'),
        false,
        'Config token value must NEVER be serialized or present in getTelegramStatus() result'
      );

      // Clean up panel
      provider.dispose();
      console.log('  ✓ getTelegramStatus() returns boolean presence and never leaks plaintext secrets');
    }

    // -------------------------------------------------------------------------
    // Test Suite 2: Interactive Token Input Modal & Successful Save IPC
    // -------------------------------------------------------------------------
    console.log('\n[Suite 2] Verifying requestSetTelegramToken with valid user input...');
    {
      const mockSecrets = new MockSecretStorage();
      const secretManager = new SecretStorageManager(mockSecrets as any);

      mockConfigStore = {
        telegramEnabled: false,
        telegramBotToken: ''
      };

      const provider = SettingsProvider.render(mockExtUri, undefined, undefined, secretManager);
      const webview = (provider.panel as any).webview as MockWebview;
      webview.clearMessages();

      const validTokenInput = '1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ';
      mockInputBoxValue = validTokenInput;

      // Simulate Webview sending 'requestSetTelegramToken'
      await webview.simulateMessageFromWebview({ command: 'requestSetTelegramToken' });

      // Verify showInputBox was called with proper password masking
      assert.ok(lastInputBoxOptions, 'showInputBox must have been invoked');
      assert.strictEqual(lastInputBoxOptions.password, true, 'showInputBox must enforce password: true');
      assert.ok(lastInputBoxOptions.prompt.includes('Telegram'), 'prompt should mention Telegram');

      // Verify token was stored in SecretStorage
      const storedSecret = await secretManager.getTelegramToken();
      assert.strictEqual(storedSecret, validTokenInput, 'SecretStorage must contain entered token');

      // Verify telegramEnabled was updated to true
      assert.strictEqual(mockConfigStore['telegramEnabled'], true, 'autoplan.telegramEnabled must be updated to true');

      // Verify IPC response messages posted back to Webview
      const updatedMessages = webview.findMessages('telegramTokenUpdated');
      assert.strictEqual(updatedMessages.length, 1, 'Webview must receive exactly one telegramTokenUpdated message');
      assert.strictEqual(updatedMessages[0].hasToken, true, 'telegramTokenUpdated must state hasToken: true');
      assert.strictEqual(updatedMessages[0].enabled, true, 'telegramTokenUpdated must state enabled: true');
      assert.strictEqual(updatedMessages[0].status.hasToken, true, 'status.hasToken must be true');

      const statusMessages = webview.findMessages('telegramStatusUpdate');
      assert.ok(statusMessages.length >= 1, 'Webview must receive telegramStatusUpdate message');
      assert.strictEqual(statusMessages[statusMessages.length - 1].status.hasToken, true, 'status.hasToken must be true');

      provider.dispose();
      console.log('  ✓ Token successfully persisted to SecretStorage, config enabled, and IPC notified');
    }

    // -------------------------------------------------------------------------
    // Test Suite 3: Token Prompt Cancellation & Optimistic Rollback Handler
    // -------------------------------------------------------------------------
    console.log('\n[Suite 3] Verifying requestSetTelegramToken cancellation & rollback signal...');
    {
      const mockSecrets = new MockSecretStorage();
      const secretManager = new SecretStorageManager(mockSecrets as any);

      mockConfigStore = {
        telegramEnabled: false,
        telegramBotToken: ''
      };

      const provider = SettingsProvider.render(mockExtUri, undefined, undefined, secretManager);
      const webview = (provider.panel as any).webview as MockWebview;
      webview.clearMessages();

      // Case 3.1: User cancels input box (returns undefined, e.g. Esc pressed)
      mockInputBoxValue = undefined;

      await webview.simulateMessageFromWebview({ command: 'requestSetTelegramToken' });

      const rollbackMessages = webview.findMessages('tokenPromptCancelled');
      assert.strictEqual(rollbackMessages.length, 1, 'Webview must receive tokenPromptCancelled message on cancel');
      assert.strictEqual(rollbackMessages[0].rollback, true, 'tokenPromptCancelled must specify rollback: true');
      assert.strictEqual(rollbackMessages[0].enabled, false, 'tokenPromptCancelled must specify enabled: false');

      // Ensure SecretStorage was NOT populated
      const tokenInStorage = await secretManager.getTelegramToken();
      assert.strictEqual(tokenInStorage, undefined, 'SecretStorage must remain empty after cancellation');

      // Case 3.2: User enters empty or whitespace-only token
      webview.clearMessages();
      mockInputBoxValue = '   ';

      await webview.simulateMessageFromWebview({ command: 'requestSetTelegramToken' });

      const whitespaceRollbackMessages = webview.findMessages('tokenPromptCancelled');
      assert.strictEqual(whitespaceRollbackMessages.length, 1, 'Whitespace token must trigger tokenPromptCancelled');
      assert.strictEqual(whitespaceRollbackMessages[0].rollback, true, 'Whitespace must trigger rollback: true');

      provider.dispose();
      console.log('  ✓ User cancellation and whitespace entry cleanly dispatch tokenPromptCancelled with rollback: true');
    }

    // -------------------------------------------------------------------------
    // Test Suite 4: Token Clearing IPC (requestClearTelegramToken)
    // -------------------------------------------------------------------------
    console.log('\n[Suite 4] Verifying requestClearTelegramToken removes credentials...');
    {
      const mockSecrets = new MockSecretStorage();
      const secretManager = new SecretStorageManager(mockSecrets as any);

      // Seed SecretStorage and config with active credentials
      await mockSecrets.store(TELEGRAM_TOKEN_SECRET_KEY, 'ActiveTokenToBeCleared');
      mockConfigStore = {
        telegramEnabled: true,
        telegramBotToken: 'OldFallbackConfigToken'
      };

      const provider = SettingsProvider.render(mockExtUri, undefined, undefined, secretManager);
      const webview = (provider.panel as any).webview as MockWebview;
      webview.clearMessages();

      // Verify token exists initially
      const initialStatus = await provider.getTelegramStatus();
      assert.strictEqual(initialStatus.hasToken, true, 'Initial status must have token');

      // Webview requests to clear token
      await webview.simulateMessageFromWebview({ command: 'requestClearTelegramToken' });

      // Verify token was deleted from SecretStorage
      const postDeleteToken = await secretManager.getTelegramToken();
      assert.strictEqual(postDeleteToken, undefined, 'SecretStorage must be cleared of token');

      // Verify config token was cleared
      assert.strictEqual(mockConfigStore['telegramBotToken'], '', 'Config token must be emptied');

      // Verify IPC response message
      const clearMessages = webview.findMessages('telegramTokenCleared');
      assert.strictEqual(clearMessages.length, 1, 'Webview must receive telegramTokenCleared message');
      assert.strictEqual(clearMessages[0].hasToken, false, 'telegramTokenCleared must have hasToken: false');

      const statusMessages = webview.findMessages('telegramStatusUpdate');
      assert.ok(statusMessages.length >= 1, 'Webview must receive updated telegramStatusUpdate');
      assert.strictEqual(statusMessages[statusMessages.length - 1].status.hasToken, false, 'hasToken must now be false');

      provider.dispose();
      console.log('  ✓ requestClearTelegramToken purges SecretStorage and notifies webview with hasToken: false');
    }

    // -------------------------------------------------------------------------
    // Test Suite 5: Status Query, Ready Handshake & External Config Synchronization
    // -------------------------------------------------------------------------
    console.log('\n[Suite 5] Verifying requestTelegramStatus, ready handshake & external config sync...');
    {
      const mockSecrets = new MockSecretStorage();
      const secretManager = new SecretStorageManager(mockSecrets as any);
      await mockSecrets.store(TELEGRAM_TOKEN_SECRET_KEY, '987654:ActiveTokenForHandshake');

      mockConfigStore = {
        telegramEnabled: true,
        'telegram.allowFreeChat': false,
        'telegram.enableChatMirror': true,
        telegramAllowedUsers: [444555],
        telegramThrottleMs: 3000
      };

      const provider = SettingsProvider.render(mockExtUri, undefined, undefined, secretManager);
      const webview = (provider.panel as any).webview as MockWebview;
      webview.clearMessages();

      // 5.1 Explicit requestTelegramStatus IPC
      await webview.simulateMessageFromWebview({ command: 'requestTelegramStatus' });
      const statusUpdates = webview.findMessages('telegramStatusUpdate');
      assert.strictEqual(statusUpdates.length, 1, 'Must receive telegramStatusUpdate');
      assert.strictEqual(statusUpdates[0].status.hasToken, true, 'hasToken must be true');
      assert.strictEqual(statusUpdates[0].status.allowFreeChat, false, 'allowFreeChat must be false');
      assert.strictEqual(statusUpdates[0].status.throttleMs, 3000, 'throttleMs must be 3000');

      // 5.2 Webview 'ready' message handshake
      webview.clearMessages();
      await webview.simulateMessageFromWebview({ command: 'ready' });
      const readyStatusUpdates = webview.findMessages('telegramStatusUpdate');
      assert.strictEqual(readyStatusUpdates.length, 1, 'ready signal must broadcast telegramStatusUpdate');
      assert.strictEqual(readyStatusUpdates[0].status.hasToken, true);

      // 5.3 External config change triggers telegramStatusUpdate
      webview.clearMessages();
      await vscode.workspace.getConfiguration('autoplan').update('telegramEnabled', false);
      await new Promise((r) => setTimeout(r, 20));
      const extConfigUpdates = webview.findMessages('telegramStatusUpdate');
      assert.ok(extConfigUpdates.length >= 1, 'External config change must push telegramStatusUpdate');
      assert.strictEqual(extConfigUpdates[extConfigUpdates.length - 1].status.enabled, false);

      provider.dispose();
      console.log('  ✓ Handshake and external configuration watchers keep Telegram status synchronised');
    }

    console.log('\n================================================================');
    console.log(' ✓ All Phase 02 Telegram Token & Rollback IPC Tests Passed! (100%)');
    console.log('================================================================\n');

  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase02SettingsTelegramTokenIpcTest().catch((err) => {
  console.error('\n❌ Phase 02 Test Suite Failed:', err);
  process.exit(1);
});
