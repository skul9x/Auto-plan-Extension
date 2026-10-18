// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {};
const mockCommands: Record<string, Function> = {};
let lastInputBoxOptions: any = null;
let lastInputBoxResult: string | undefined = undefined;
let infoMessages: string[] = [];
let warningMessages: string[] = [];

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
      window: {
        showInputBox: async (options: any) => {
          lastInputBoxOptions = options;
          return lastInputBoxResult;
        },
        showInformationMessage: async (msg: string) => {
          infoMessages.push(msg);
        },
        showWarningMessage: async (msg: string) => {
          warningMessages.push(msg);
        },
        showErrorMessage: async () => {},
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        registerWebviewViewProvider: () => ({ dispose: () => {} })
      },
      commands: {
        registerCommand: (id: string, callback: Function) => {
          mockCommands[id] = callback;
          return { dispose: () => { delete mockCommands[id]; } };
        },
        executeCommand: async (id: string, ...args: any[]) => {
          if (mockCommands[id]) {
            return mockCommands[id](...args);
          }
        }
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 },
      StatusBarAlignment: { Left: 1, Right: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DEFAULT_CONFIG,
  getConfig,
  writeSidecarConfig,
  writeConfigJson,
  SecretStorageManager,
  secretStorageManager,
  TELEGRAM_TOKEN_SECRET_KEY,
  SIDECAR_CONFIG_FILENAME
} from '../config';
import { TelegramBridge } from '../telegramBridge';

/**
 * Mock implementation of VS Code's SecretStorage backed by an in-memory Map.
 */
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

async function runPhase01SecretsHardeningTest() {
  console.log('================================================================');
  console.log(' Phase 01: Secrets Hardening & Secure Credential Storage Test');
  console.log('================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-secrets-p01-'));

  try {
    // -------------------------------------------------------------------------
    // Test Suite 1: Hardcoded Credentials Scrubbing & Schema Defaults
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Verifying hardcoded credentials removal from code and package manifest...');
    {
      // 1.1 DEFAULT_CONFIG check
      assert.strictEqual(
        DEFAULT_CONFIG.telegramBotToken,
        '',
        'DEFAULT_CONFIG.telegramBotToken must be empty string'
      );
      assert.deepStrictEqual(
        DEFAULT_CONFIG.telegramAllowedUsers,
        [],
        'DEFAULT_CONFIG.telegramAllowedUsers must be empty array'
      );

      // 1.2 package.json manifest check
      const packageJsonPath = path.resolve(__dirname, '../../package.json');
      assert.ok(fs.existsSync(packageJsonPath), 'package.json should exist');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      const configProps = packageJson.contributes?.configuration?.properties;
      assert.ok(configProps, 'package.json contributes.configuration.properties should exist');
      assert.strictEqual(
        configProps['autoplan.telegramBotToken']?.default,
        '',
        'package.json autoplan.telegramBotToken default must be empty string'
      );
      assert.deepStrictEqual(
        configProps['autoplan.telegramAllowedUsers']?.default,
        [],
        'package.json autoplan.telegramAllowedUsers default must be empty array'
      );

      // Verify commands registered in package.json
      const commands = packageJson.contributes?.commands || [];
      const setTokenCmd = commands.find((c: any) => c.command === 'autoplan.setTelegramToken');
      const clearTokenCmd = commands.find((c: any) => c.command === 'autoplan.clearTelegramToken');
      assert.ok(setTokenCmd, 'autoplan.setTelegramToken command must be declared in package.json');
      assert.ok(clearTokenCmd, 'autoplan.clearTelegramToken command must be declared in package.json');

      console.log('  ✓ Hardcoded credentials cleanly scrubbed from DEFAULT_CONFIG and package.json');
      console.log('  ✓ Manifest commands autoplan.setTelegramToken & autoplan.clearTelegramToken present');
    }

    // -------------------------------------------------------------------------
    // Test Suite 2: SecretStorageManager Store, Retrieve & Delete Lifecycle
    // -------------------------------------------------------------------------
    console.log('\n[Suite 2] Verifying SecretStorageManager lifecycle via MockSecretStorage...');
    {
      const mockSecrets = new MockSecretStorage();
      const manager = new SecretStorageManager(mockSecrets as any);

      // 2.1 Initial state with no secrets or config
      for (const k of Object.keys(mockConfigStore)) delete mockConfigStore[k];
      const initialToken = await manager.getTelegramToken();
      assert.strictEqual(initialToken, undefined, 'Initially getTelegramToken() should return undefined');

      // 2.2 Store token
      const testToken = '123456789:AAEFakeTestTokenForUnitTestOnly_xyz';
      await manager.setTelegramToken(testToken);
      assert.strictEqual(
        mockSecrets.storeMap.get(TELEGRAM_TOKEN_SECRET_KEY),
        testToken,
        'SecretStorage should have stored token under correct key'
      );

      // 2.3 Retrieve token
      const retrieved = await manager.getTelegramToken();
      assert.strictEqual(retrieved, testToken, 'Retrieved token should match stored token');

      // 2.4 Delete token
      await manager.deleteTelegramToken();
      assert.strictEqual(
        mockSecrets.storeMap.has(TELEGRAM_TOKEN_SECRET_KEY),
        false,
        'Token should be removed from mock secret storage'
      );
      const afterDelete = await manager.getTelegramToken();
      assert.strictEqual(afterDelete, undefined, 'After deletion, getTelegramToken() should return undefined');

      // 2.5 Graceful fallback when SecretStorage is not initialized
      const uninitManager = new SecretStorageManager();
      const fallbackToken = await uninitManager.getTelegramToken();
      assert.strictEqual(fallbackToken, undefined, 'Uninitialized manager should not crash and return undefined');

      console.log('  ✓ SecretStorageManager store, retrieve, delete cycles pass');
      console.log('  ✓ Uninitialized SecretStorageManager handles calls gracefully');
    }

    // -------------------------------------------------------------------------
    // Test Suite 3: Token Resolution Hierarchy (SecretStorage > Workspace Config)
    // -------------------------------------------------------------------------
    console.log('\n[Suite 3] Verifying token resolution precedence hierarchy...');
    {
      const mockSecrets = new MockSecretStorage();
      const manager = new SecretStorageManager(mockSecrets as any);

      // Case A: Only workspace configuration set
      mockConfigStore['telegramBotToken'] = '987654321:WorkspaceConfigTokenOnly';
      const resolvedFromConfig = await manager.getTelegramToken();
      assert.strictEqual(
        resolvedFromConfig,
        '987654321:WorkspaceConfigTokenOnly',
        'Should fall back to workspace config when SecretStorage is empty'
      );

      // Case B: SecretStorage is also set -> SecretStorage takes precedence!
      await manager.setTelegramToken('111222333:SecretStoragePriorityToken');
      const resolvedPrecedence = await manager.getTelegramToken();
      assert.strictEqual(
        resolvedPrecedence,
        '111222333:SecretStoragePriorityToken',
        'SecretStorage token MUST take precedence over workspace configuration'
      );

      // Case C: SecretStorage deleted -> Falls back to workspace configuration
      await manager.deleteTelegramToken();
      const resolvedAfterDelete = await manager.getTelegramToken();
      assert.strictEqual(
        resolvedAfterDelete,
        '987654321:WorkspaceConfigTokenOnly',
        'Should fall back to workspace config after secret deletion'
      );

      // Case D: Workspace config cleared as well
      mockConfigStore['telegramBotToken'] = '';
      const resolvedBothEmpty = await manager.getTelegramToken();
      assert.strictEqual(resolvedBothEmpty, undefined, 'Should return undefined when both stores are empty');

      console.log('  ✓ Token resolution hierarchy correctly prioritizes SecretStorage over workspace settings');
    }

    // -------------------------------------------------------------------------
    // Test Suite 4: TelegramBridge Integration with SecretStorageManager
    // -------------------------------------------------------------------------
    console.log('\n[Suite 4] Verifying TelegramBridge integration with SecretStorageManager...');
    {
      const mockSecrets = new MockSecretStorage();
      const manager = new SecretStorageManager(mockSecrets as any);
      const bridge = new TelegramBridge({
        secretManager: manager,
        registryPath: path.join(testTempDir, 'ag-autoplan-ports.json')
      });

      // Initially empty
      await bridge.reloadConfig();
      assert.strictEqual(bridge.getToken(), '', 'Bridge token should be empty initially');

      // Set secret in SecretStorage and reload
      await manager.setTelegramToken('555666777:BridgeSecretStorageToken');
      await bridge.reloadConfig();
      assert.strictEqual(
        bridge.getToken(),
        '555666777:BridgeSecretStorageToken',
        'Bridge reloadConfig should load token from SecretStorageManager'
      );

      // Workspace config overridden while SecretStorage is set -> SecretStorage still wins
      mockConfigStore['telegramBotToken'] = '444444:WorkspaceToken';
      await bridge.reloadConfig();
      assert.strictEqual(
        bridge.getToken(),
        '555666777:BridgeSecretStorageToken',
        'Bridge must prioritize SecretStorage over workspace settings'
      );

      // Clear secret -> Falls back to workspace config
      await manager.deleteTelegramToken();
      await bridge.reloadConfig();
      assert.strictEqual(
        bridge.getToken(),
        '444444:WorkspaceToken',
        'Bridge should fall back to workspace config when secret is cleared'
      );

      // Start method automatically resolves secret if token was empty
      const bridge2 = new TelegramBridge({
        secretManager: manager,
        registryPath: path.join(testTempDir, 'ag-autoplan-ports.json')
      });
      mockConfigStore['telegramBotToken'] = '';
      await manager.setTelegramToken('888999:AutoResolveOnStart');
      // Bridge2 token is initially empty until start / reload
      assert.strictEqual(bridge2.getToken(), '');
      await bridge2.reloadConfig();
      assert.strictEqual(bridge2.getToken(), '888999:AutoResolveOnStart');

      console.log('  ✓ TelegramBridge seamlessly resolves credentials from SecretStorageManager with fallback');
    }

    // -------------------------------------------------------------------------
    // Test Suite 5: Sanitized Sidecar Configuration & 0o600 Permissions
    // -------------------------------------------------------------------------
    console.log('\n[Suite 5] Verifying writeSidecarConfig sanitization and 0o600 file permissions...');
    {
      // 5.1 Verify writeSidecarConfig and writeConfigJson are identical
      assert.strictEqual(
        writeConfigJson,
        writeSidecarConfig,
        'writeConfigJson must alias writeSidecarConfig'
      );

      // 5.2 Write configuration containing sensitive telegramBotToken
      const configWithSensitiveToken = {
        ...DEFAULT_CONFIG,
        telegramBotToken: 'EXPLICIT_SENSITIVE_BOT_TOKEN_12345:SHOULD_NOT_BE_SAVED',
        promptText: 'Safe prompt instruction text',
        repeatCount: 7
      };

      const outDir = path.join(testTempDir, 'sidecar-out');
      const writtenPath = writeSidecarConfig(configWithSensitiveToken, outDir);
      assert.ok(writtenPath, 'writeSidecarConfig should return valid file path');
      assert.ok(fs.existsSync(writtenPath), 'Sidecar config file must exist on disk');
      assert.strictEqual(
        path.basename(writtenPath),
        SIDECAR_CONFIG_FILENAME,
        `Written file name must match ${SIDECAR_CONFIG_FILENAME}`
      );

      // 5.3 Verify file permission mode 0o600 (owner read/write only: 384 decimal)
      const stat = fs.statSync(writtenPath);
      const fileMode = stat.mode & 0o777;
      assert.strictEqual(
        fileMode,
        0o600,
        `Sidecar config permissions must be 0o600 (got 0o${fileMode.toString(8)})`
      );

      // 5.4 Verify raw content does NOT leak sensitive token
      const rawFileContent = fs.readFileSync(writtenPath, 'utf8');
      assert.strictEqual(
        rawFileContent.includes('EXPLICIT_SENSITIVE_BOT_TOKEN_12345'),
        false,
        'Plaintext bot token must NOT appear in sidecar config file content'
      );

      // 5.5 Verify parsed JSON does not have telegramBotToken property
      const parsedConfig = JSON.parse(rawFileContent);
      assert.strictEqual(
        parsedConfig.telegramBotToken,
        undefined,
        'Parsed JSON must not contain telegramBotToken property'
      );
      assert.strictEqual(
        'telegramBotToken' in parsedConfig,
        false,
        'telegramBotToken key must be completely stripped'
      );
      assert.strictEqual(parsedConfig.repeatCount, 7, 'Other configuration fields should be preserved');
      assert.strictEqual(parsedConfig.promptText, 'Safe prompt instruction text');

      // 5.6 Test writeSidecarConfig with direct file path
      const directFilePath = path.join(testTempDir, 'custom-sidecar', 'autoplan-config.json');
      const directWritten = writeSidecarConfig(configWithSensitiveToken, directFilePath);
      assert.ok(directWritten);
      assert.strictEqual(directWritten, directFilePath);
      const directStat = fs.statSync(directFilePath);
      assert.strictEqual(directStat.mode & 0o777, 0o600, 'Direct file path must also have 0o600 permissions');
      const directParsed = JSON.parse(fs.readFileSync(directFilePath, 'utf8'));
      assert.strictEqual(directParsed.telegramBotToken, undefined);

      console.log('  ✓ writeSidecarConfig successfully strips telegramBotToken from serialized payload');
      console.log('  ✓ Enforces restrictive 0o600 permissions on sidecar files');
    }

    console.log('\n================================================================');
    console.log(' All Phase 01 Secrets Hardening & Storage Tests Passed! (100%)');
    console.log('================================================================\n');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

// Execute test
runPhase01SecretsHardeningTest().catch((err) => {
  console.error('\n❌ Test execution failed with error:', err);
  process.exit(1);
});
