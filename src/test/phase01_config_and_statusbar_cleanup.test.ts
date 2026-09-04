// Standalone mock for 'vscode' module when run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockConfigStore: Record<string, any> = {};

class MockStatusBarItem {
  public text: string = '';
  public tooltip: any = '';
  public command: string = '';
  public showCalls: number = 0;
  public hideCalls: number = 0;
  public visible: boolean = false;

  show() {
    this.showCalls++;
    this.visible = true;
  }

  hide() {
    this.hideCalls++;
    this.visible = false;
  }

  dispose() {}
}

let currentMockStatusBarItem = new MockStatusBarItem();

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [{ name: 'test-ws', uri: { fsPath: '/test/ws' } }],
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) => {
            return mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue;
          },
          update: async (key: string, value: any) => {
            mockConfigStore[key] = value;
          }
        })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      env: {
        clipboard: {
          writeText: async () => {},
          readText: async () => ''
        }
      },
      window: {
        showErrorMessage: async () => undefined,
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        createOutputChannel: () => ({
          appendLine: () => {},
          show: () => {},
          clear: () => {},
          dispose: () => {}
        }),
        createStatusBarItem: (_alignment?: any, _priority?: any) => currentMockStatusBarItem
      },
      commands: {
        executeCommand: async () => undefined
      },
      StatusBarAlignment: {
        Left: 1,
        Right: 2
      },
      MarkdownString: class {
        public value: string;
        public isTrusted: boolean = false;
        constructor(val: string) {
          this.value = val;
        }
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_CONFIG, getConfig, AutoPlanConfig } from '../config';
import {
  updateBridgeStatusBar,
  getBridgeStatusBarItem,
  setBridgeStatusBarItem
} from '../extension';

async function runPhase01Tests() {
  console.log('--- Running Phase 01 Tests: Config & Status Bar Cleanup ---');

  // =========================================================================
  // 1. package.json Schema Verification
  // =========================================================================
  console.log('Test 1: Verify package.json configuration schemas');
  const pkgPath = path.resolve(__dirname, '../../package.json');
  const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgRaw);
  const properties = pkg.contributes?.configuration?.properties;

  assert.ok(properties, 'contributes.configuration.properties must exist in package.json');

  // Check autoplan.autoRetryOnTimeout
  const autoRetryProp = properties['autoplan.autoRetryOnTimeout'];
  assert.ok(autoRetryProp, 'autoplan.autoRetryOnTimeout must exist in package.json');
  assert.strictEqual(autoRetryProp.type, 'boolean');
  assert.strictEqual(autoRetryProp.default, true);
  assert.strictEqual(autoRetryProp.title, 'Auto Retry On Timeout');

  // Check autoplan.retryDelaySeconds
  const retryDelayProp = properties['autoplan.retryDelaySeconds'];
  assert.ok(retryDelayProp, 'autoplan.retryDelaySeconds must exist in package.json');
  assert.strictEqual(retryDelayProp.type, 'number');
  assert.strictEqual(retryDelayProp.default, 3);
  assert.strictEqual(retryDelayProp.minimum, 1);
  assert.strictEqual(retryDelayProp.maximum, 30);

  // Check autoplan.maxAutoRetries
  const maxRetriesProp = properties['autoplan.maxAutoRetries'];
  assert.ok(maxRetriesProp, 'autoplan.maxAutoRetries must exist in package.json');
  assert.strictEqual(maxRetriesProp.type, 'number');
  assert.strictEqual(maxRetriesProp.default, 5);
  assert.strictEqual(maxRetriesProp.minimum, 1);
  assert.strictEqual(maxRetriesProp.maximum, 20);
  console.log('✓ package.json schemas verified successfully.');

  // =========================================================================
  // 2. DEFAULT_CONFIG Verification
  // =========================================================================
  console.log('Test 2: Verify DEFAULT_CONFIG values in src/config.ts');
  assert.strictEqual(DEFAULT_CONFIG.autoRetryOnTimeout, true, 'DEFAULT_CONFIG.autoRetryOnTimeout should be true');
  assert.strictEqual(DEFAULT_CONFIG.retryDelaySeconds, 3, 'DEFAULT_CONFIG.retryDelaySeconds should be 3');
  assert.strictEqual(DEFAULT_CONFIG.maxAutoRetries, 5, 'DEFAULT_CONFIG.maxAutoRetries should be 5');
  console.log('✓ DEFAULT_CONFIG verified successfully.');

  // =========================================================================
  // 3. getConfig() Default Fallback & Custom Overrides Verification
  // =========================================================================
  console.log('Test 3: Verify getConfig() resolution with defaults and overrides');
  mockConfigStore = {};
  const defaultConfigObj = getConfig();
  assert.strictEqual(defaultConfigObj.autoRetryOnTimeout, true, 'getConfig() fallback autoRetryOnTimeout must be true');
  assert.strictEqual(defaultConfigObj.retryDelaySeconds, 3, 'getConfig() fallback retryDelaySeconds must be 3');
  assert.strictEqual(defaultConfigObj.maxAutoRetries, 5, 'getConfig() fallback maxAutoRetries must be 5');

  mockConfigStore['autoRetryOnTimeout'] = false;
  mockConfigStore['retryDelaySeconds'] = 12;
  mockConfigStore['maxAutoRetries'] = 8;

  const overriddenConfig = getConfig();
  assert.strictEqual(overriddenConfig.autoRetryOnTimeout, false, 'getConfig() override autoRetryOnTimeout must be false');
  assert.strictEqual(overriddenConfig.retryDelaySeconds, 12, 'getConfig() override retryDelaySeconds must be 12');
  assert.strictEqual(overriddenConfig.maxAutoRetries, 8, 'getConfig() override maxAutoRetries must be 8');
  console.log('✓ getConfig() defaults and overrides verified successfully.');

  // =========================================================================
  // 4. updateBridgeStatusBar() & getBridgeStatusBarItem() Verification
  // =========================================================================
  console.log('Test 4: Verify updateBridgeStatusBar() hides the status bar item and sets properties');
  currentMockStatusBarItem = new MockStatusBarItem();
  setBridgeStatusBarItem(currentMockStatusBarItem as any);

  assert.strictEqual(getBridgeStatusBarItem(), currentMockStatusBarItem as any, 'getBridgeStatusBarItem() must return the configured item');

  // Call updateBridgeStatusBar
  updateBridgeStatusBar();

  // Validate item state
  assert.strictEqual(currentMockStatusBarItem.hideCalls, 1, 'updateBridgeStatusBar must call hide() exactly once');
  assert.strictEqual(currentMockStatusBarItem.showCalls, 0, 'updateBridgeStatusBar must NOT call show()');
  assert.strictEqual(currentMockStatusBarItem.visible, false, 'status bar item must remain not visible');
  assert.ok(currentMockStatusBarItem.text.length > 0, 'text property must be populated');
  assert.ok(currentMockStatusBarItem.text.includes('Bridge:'), `text property should describe Bridge status, got "${currentMockStatusBarItem.text}"`);
  assert.ok(currentMockStatusBarItem.tooltip.length > 0, 'tooltip property must be populated');
  assert.ok(currentMockStatusBarItem.command.length > 0, 'command property must be configured');

  // Even if show was called previously by an external caller, updateBridgeStatusBar must ensure it is hidden
  currentMockStatusBarItem.show();
  assert.strictEqual(currentMockStatusBarItem.visible, true);
  updateBridgeStatusBar();
  assert.strictEqual(currentMockStatusBarItem.hideCalls, 2);
  assert.strictEqual(currentMockStatusBarItem.visible, false, 'updateBridgeStatusBar must hide previously visible status item');
  console.log('✓ updateBridgeStatusBar() hiding behavior verified successfully.');

  console.log('All Phase 01 tests passed with 100% assertions satisfied!');
}

runPhase01Tests().catch((err) => {
  console.error('Phase 01 Test Failure:', err);
  process.exit(1);
});
