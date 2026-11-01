import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';

// ----------------------------------------------------------------------------
// Test Mock Setup: VS Code environment simulating REAL VS Code configuration
// where unregistered configuration keys throw strict exceptions.
// ----------------------------------------------------------------------------
const Module = require('module');
const originalRequire = Module.prototype.require;

const projectRoot = path.resolve(__dirname, '../../');
const packageJsonPath = path.join(projectRoot, 'package.json');
const pkgJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const declaredProperties = pkgJson.contributes?.configuration?.properties || {};

const mockConfigStore: Record<string, any> = {};
const postedWebviewMessages: any[] = [];
const lastInfoMessages: string[] = [];
const lastErrorMessages: string[] = [];

const mockVsCode = {
  Uri: {
    file: (p: string) => ({ fsPath: p, scheme: 'file' }),
    parse: (p: string) => ({ fsPath: p, scheme: 'file' })
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  },
  workspace: {
    getConfiguration: (section?: string) => {
      assert.strictEqual(section, 'autoplan');
      return {
        get: (key: string, defaultValue?: any) => {
          return mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue;
        },
        update: async (key: string, value: any, target: any) => {
          const fullKey = `autoplan.${key}`;
          // SIMULATE REAL VS CODE STRICT VALIDATION:
          if (!declaredProperties[fullKey]) {
            throw new Error(`Unable to write to User Settings because ${fullKey} is not a registered configuration.`);
          }
          mockConfigStore[key] = value;
        }
      };
    }
  },
  window: {
    showInformationMessage: (msg: string) => {
      lastInfoMessages.push(msg);
    },
    showErrorMessage: (msg: string) => {
      lastErrorMessages.push(msg);
    }
  }
};

Module.prototype.require = function (id: string) {
  if (id === 'vscode') {
    return mockVsCode;
  }
  return originalRequire.apply(this, arguments);
};

// Import modules AFTER mock is active:
const {
  SettingsProvider,
  CONFIG_KEY_MAPPINGS,
  IGNORED_CONFIG_KEYS,
  REGISTERED_CONFIG_KEYS
} = require('../settingsProvider');
const { DEFAULT_CONFIG } = require('../config');

async function runRegressionTests() {
  console.log('================================================================');
  console.log(' 🔍 Settings Registered Configuration Regression Test Suite');
  console.log('================================================================');

  // Test 1: Verify package.json schema declares canonical and alias properties
  console.log('\n[Test 1] Verifying package.json configuration registration...');
  assert.ok(
    declaredProperties['autoplan.telegram.allowFreeChat'],
    'package.json must declare canonical autoplan.telegram.allowFreeChat'
  );
  assert.ok(
    declaredProperties['autoplan.telegramAllowFreeChat'],
    'package.json must declare alias autoplan.telegramAllowFreeChat'
  );
  assert.ok(
    declaredProperties['autoplan.telegramEnableChatMirror'],
    'package.json must declare alias autoplan.telegramEnableChatMirror'
  );
  assert.ok(
    declaredProperties['autoplan.autoSubmitEnabled'],
    'package.json must declare alias autoplan.autoSubmitEnabled'
  );
  console.log('  ✓ package.json contains all canonical and compatibility aliases.');

  // Test 2: Verify CONFIG_KEY_MAPPINGS and IGNORED_CONFIG_KEYS integrity
  console.log('\n[Test 2] Verifying key mappings and ignore filters...');
  assert.strictEqual(CONFIG_KEY_MAPPINGS['telegramAllowFreeChat'], 'telegram.allowFreeChat');
  assert.strictEqual(CONFIG_KEY_MAPPINGS['autoSubmitEnabled'], 'autoSubmit.enabled');
  assert.ok(IGNORED_CONFIG_KEYS.has('strictMode'));
  assert.ok(IGNORED_CONFIG_KEYS.has('bridgeAuthToken'));
  assert.ok(REGISTERED_CONFIG_KEYS.has('telegram.allowFreeChat'));
  assert.ok(REGISTERED_CONFIG_KEYS.has('telegramAllowFreeChat'));
  console.log('  ✓ CONFIG_KEY_MAPPINGS and IGNORED_CONFIG_KEYS properly structured.');

  // Test 3: Verify saveSettings with webview payload containing telegramAllowFreeChat
  console.log('\n[Test 3] Verifying saveSettings IPC handling with strict VS Code mock...');
  postedWebviewMessages.length = 0;
  lastInfoMessages.length = 0;
  lastErrorMessages.length = 0;

  const mockPanel: any = {
    webview: {
      postMessage: (msg: any) => {
        postedWebviewMessages.push(msg);
      }
    }
  };

  // Instantiate provider instance via prototype
  const provider = Object.create(SettingsProvider.prototype);
  (provider as any)._panel = mockPanel;

  // Simulate webview sending form settings containing both dot-notation and camelCase keys
  const incomingWebviewSettings = {
    executionMode: 'auto',
    allowTierFallback: true,
    repeatCount: 10,
    telegramEnabled: true,
    'telegram.allowFreeChat': false,
    telegramAllowFreeChat: false,
    'telegram.enableChatMirror': true,
    telegramEnableChatMirror: true,
    'autoSubmit.enabled': true,
    autoSubmitEnabled: true,
    'autoSubmit.intervalMs': 1200,
    autoSubmitIntervalMs: 1200,
    strictMode: false
  };

  await provider.handleMessage({
    command: 'saveSettings',
    settings: incomingWebviewSettings
  });

  // Verify saveConfirmed was sent and no error message was shown
  assert.strictEqual(lastErrorMessages.length, 0, `No error should be raised, but got: ${lastErrorMessages.join(', ')}`);
  assert.ok(lastInfoMessages.some((m) => m.includes('Settings saved successfully')), 'Success message must be displayed');
  const saveConfirmedMsg = postedWebviewMessages.find((m: any) => m.command === 'saveConfirmed');
  assert.ok(saveConfirmedMsg, 'saveConfirmed message must be posted to webview');

  // Verify config store received canonical keys
  assert.strictEqual(mockConfigStore['telegram.allowFreeChat'], false, 'telegram.allowFreeChat must be updated in config store');
  assert.strictEqual(mockConfigStore['autoSubmit.enabled'], true, 'autoSubmit.enabled must be updated in config store');
  assert.strictEqual(mockConfigStore['autoSubmit.intervalMs'], 1200, 'autoSubmit.intervalMs must be updated in config store');
  console.log('  ✓ saveSettings successfully persisted without throwing unregistered config errors.');

  // Test 4: Verify resetSettings with strict VS Code mock
  console.log('\n[Test 4] Verifying resetSettings IPC handling with strict VS Code mock...');
  postedWebviewMessages.length = 0;
  lastInfoMessages.length = 0;
  lastErrorMessages.length = 0;

  await provider.handleMessage({
    command: 'resetSettings'
  });

  assert.strictEqual(lastErrorMessages.length, 0, `No error should be raised during reset, but got: ${lastErrorMessages.join(', ')}`);
  assert.ok(lastInfoMessages.some((m) => m.includes('Settings reset to defaults')), 'Reset confirmation message must be displayed');
  const resetInitMsg = postedWebviewMessages.find((m: any) => m.command === 'initSettings');
  const resetConfirmMsg = postedWebviewMessages.find((m: any) => m.command === 'saveConfirmed');
  assert.ok(resetInitMsg, 'initSettings message must be posted to webview');
  assert.ok(resetConfirmMsg, 'saveConfirmed message must be posted to webview');
  assert.strictEqual(mockConfigStore['telegram.allowFreeChat'], DEFAULT_CONFIG.telegramAllowFreeChat);
  assert.strictEqual(mockConfigStore['autoSubmit.enabled'], DEFAULT_CONFIG.autoSubmitEnabled);
  console.log('  ✓ resetSettings successfully reset all settings without errors.');

  console.log('\n🎉 ALL REGRESSION TESTS PASSED (100%)!\n');
}

runRegressionTests().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
