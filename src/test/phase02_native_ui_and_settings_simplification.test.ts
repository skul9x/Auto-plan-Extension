// Self-healing ESM require guard for JSDOM in Node CommonJS
if (!process.env.__PHASE02_NATIVE_UI_REEXEC__) {
  try {
    require('jsdom');
  } catch (e: any) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      const { execFileSync } = require('child_process');
      const env = {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-require-module`.trim(),
        __PHASE02_NATIVE_UI_REEXEC__: '1'
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

const mockConfigStore: Record<string, any> = {};
const globalExecutedCommands: { command: string; args: any[] }[] = [];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          { name: 'test-workspace', uri: { fsPath: '/mock/workspace' } }
        ],
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) =>
            mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            mockConfigStore[key] = val;
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
        createStatusBarItem: (_alignment?: any, _priority?: any) => ({
          text: '',
          tooltip: '',
          command: '',
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        createWebviewPanel: () => ({
          webview: {
            html: '',
            asWebviewUri: (uri: any) => uri,
            cspSource: 'vscode-resource:',
            onDidReceiveMessage: () => ({ dispose: () => {} }),
            postMessage: async () => true
          },
          reveal: () => {},
          dispose: () => {}
        })
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: async (cmd: string, ...args: any[]) => {
          globalExecutedCommands.push({ command: cmd, args });
          return undefined;
        },
        getCommands: async () => [
          'antigravity.startNewConversation',
          'antigravity.addContext',
          'antigravity.triggerSend',
          'antigravity.prioritized.chat.stop'
        ]
      },
      Uri: {
        file: (p: string) => ({ fsPath: p }),
        joinPath: (base: any, ...segments: string[]) => ({
          fsPath: path.join(base.fsPath || base.path || '', ...segments)
        })
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
      ViewColumn: { Active: -1, One: 1, Two: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { JSDOM } from 'jsdom';
import { REGISTERED_CONFIG_KEYS, SettingsProvider } from '../settingsProvider';
import { SettingsWebviewProvider } from '../settingsWebviewProvider';
import { PromptDispatcher } from '../promptDispatcher';
import { SidebarProvider } from '../sidebarProvider';
import { updateBridgeStatusBar, getBridgeStatusBarItem, setBridgeStatusBarItem } from '../extension';

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

function setupTestSettingsDom(initialState: any = null): {
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

function setupTestSidebarDom(): {
  dom: JSDOM;
  window: any;
  document: Document;
  mockVsCode: MockVsCodeApi;
  exports: any;
} {
  const rootDir = path.resolve(__dirname, '../..');
  const htmlPath = path.join(rootDir, 'media/sidebar/sidebar.html');
  const jsPath = path.join(rootDir, 'media/sidebar/sidebar.js');

  const rawHtml = fs.readFileSync(htmlPath, 'utf8');
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
  const mockVsCode = createMockVsCode();
  (window as any).__mockVsCode = mockVsCode;

  const jsCode = fs.readFileSync(jsPath, 'utf8');
  const scriptFunction = new Function('acquireVsCodeApi', 'window', 'document', 'module', 'exports', jsCode);
  const mockModule: any = { exports: {} };
  scriptFunction(() => mockVsCode, window, document, mockModule, mockModule.exports);

  return {
    dom,
    window,
    document,
    mockVsCode,
    exports: mockModule.exports
  };
}

async function runPhase02Tests(): Promise<void> {
  console.log('========================================================================');
  console.log(' Phase 02: Settings Webview & Sidebar UI Simplification Verification');
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

  // ---------------------------------------------------------------------------
  // Suite 1: Settings HTML Structure & Obsolete Elements Removal
  // ---------------------------------------------------------------------------
  console.log('--- Suite 1: Settings HTML Structure & Element Pruning ---');

  await test('Nav tab for dispatch is renamed to "Native Dispatch"', () => {
    const { document } = setupTestSettingsDom();
    const dispatchNavBtn = document.getElementById('nav-btn-dispatch');
    assert.ok(dispatchNavBtn, '#nav-btn-dispatch must exist in settings navigation');
    const text = dispatchNavBtn.textContent || '';
    assert.ok(text.includes('Native Dispatch'), `Nav tab text should include "Native Dispatch", got: "${text}"`);
    assert.strictEqual(text.includes('Dispatch & Tiers'), false, 'Nav tab must NOT say "Dispatch & Tiers"');
  });

  await test('Absence of legacy 4 Tier cards and tier-cards-container', () => {
    const { document } = setupTestSettingsDom();
    assert.strictEqual(document.querySelector('.tier-cards-container'), null, '.tier-cards-container must be removed');
    assert.strictEqual(document.querySelector('.tier-card'), null, '.tier-card elements must be removed');
    assert.strictEqual(document.getElementById('optTierAuto'), null, '#optTierAuto must be removed');
    assert.strictEqual(document.getElementById('optTier1'), null, '#optTier1 must be removed');
    assert.strictEqual(document.getElementById('optTier2'), null, '#optTier2 must be removed');
    assert.strictEqual(document.getElementById('optTier3'), null, '#optTier3 must be removed');
  });

  await test('Absence of obsolete fallback and 1-click DOM injection controls', () => {
    const { document } = setupTestSettingsDom();
    assert.strictEqual(document.getElementById('chkAllowFallback'), null, '#chkAllowFallback must be removed');
    assert.strictEqual(document.querySelector('.fallback-policy-box'), null, '.fallback-policy-box must be removed');
    assert.strictEqual(document.getElementById('btnSetupBridge'), null, '#btnSetupBridge must be removed');
    assert.strictEqual(document.getElementById('btnUninstallBridge'), null, '#btnUninstallBridge must be removed');
    assert.strictEqual(document.getElementById('txtBridgeTimeoutMs'), null, '#txtBridgeTimeoutMs must be removed');
  });

  await test('Presence of Native Engine readiness badge, send delay input, and test dispatch button', () => {
    const { document } = setupTestSettingsDom();
    const nativeEngineBadge = document.getElementById('nativeEngineBadge');
    assert.ok(nativeEngineBadge, '#nativeEngineBadge must exist');
    assert.ok(nativeEngineBadge.textContent?.includes('Antigravity Native Engine: Ready'), 'Badge must indicate Native Engine Ready');

    const txtSendDelayMs = document.getElementById('txtSendDelayMs') as HTMLInputElement;
    assert.ok(txtSendDelayMs, '#txtSendDelayMs input must exist');
    assert.strictEqual(txtSendDelayMs.type, 'number', '#txtSendDelayMs must be numeric');
    assert.strictEqual(txtSendDelayMs.value, '500', '#txtSendDelayMs default value must be 500');

    const btnTestSendPrompt = document.getElementById('btnTestSendPrompt');
    assert.ok(btnTestSendPrompt, '#btnTestSendPrompt button must exist');
    assert.ok(btnTestSendPrompt.textContent?.includes('Test Send Prompt'), 'Button text must include "Test Send Prompt"');
  });

  // ---------------------------------------------------------------------------
  // Suite 2: Settings Client Script (settings.js) Logic & Contracts
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 2: Settings Client Script (settings.js) Logic & Contracts ---');

  await test('getFormSettings correctly captures sendDelayMs and cleans up obsolete tier toggles', () => {
    const { exports, document } = setupTestSettingsDom();
    const txtSendDelayMs = document.getElementById('txtSendDelayMs') as HTMLInputElement;
    txtSendDelayMs.value = '750';

    const settings = exports.getFormSettings();
    assert.strictEqual(settings.sendDelayMs, 750, 'settings.sendDelayMs must match input value 750');
  });

  await test('applySettingsToForm populates txtSendDelayMs and updates telemetry labels', () => {
    const { exports, document } = setupTestSettingsDom();
    exports.applySettingsToForm({ sendDelayMs: 1200 });

    const txtSendDelayMs = document.getElementById('txtSendDelayMs') as HTMLInputElement;
    assert.strictEqual(txtSendDelayMs.value, '1200', 'txtSendDelayMs value must be set to 1200');

    const lblSendDelayVal = document.getElementById('lblSendDelayVal');
    assert.strictEqual(lblSendDelayVal?.textContent, '1200ms', 'lblSendDelayVal must display "1200ms"');
  });

  await test('Clicking btnTestSendPrompt dispatches "testSendPrompt" command via postMessage', () => {
    const { document, mockVsCode } = setupTestSettingsDom();
    const btnTestSendPrompt = document.getElementById('btnTestSendPrompt') as HTMLButtonElement;
    assert.ok(btnTestSendPrompt, 'btnTestSendPrompt must exist');

    mockVsCode.postedMessages.length = 0;
    btnTestSendPrompt.click();

    assert.ok(mockVsCode.postedMessages.length >= 1, 'postMessage must be invoked on click');
    const testMsg = mockVsCode.postedMessages.find(m => m.command === 'testSendPrompt');
    assert.ok(testMsg, 'Posted message command must be "testSendPrompt"');
  });

  await test('Receiving testResult message updates testPromptBadge correctly on success and failure', () => {
    const { window, document } = setupTestSettingsDom();
    const testPromptBadge = document.getElementById('testPromptBadge');
    assert.ok(testPromptBadge, '#testPromptBadge must exist');

    // Simulate success
    const successEvent = new window.MessageEvent('message', {
      data: { command: 'testResult', success: true, latencyMs: 25 }
    });
    window.dispatchEvent(successEvent);
    assert.ok(testPromptBadge.className.includes('badge-success'), 'Badge class should include badge-success');
    assert.ok(testPromptBadge.textContent?.includes('Passed (25ms)'), `Badge should show Passed (25ms), got: ${testPromptBadge.textContent}`);

    // Simulate failure
    const failEvent = new window.MessageEvent('message', {
      data: { command: 'testResult', success: false, error: 'API timeout' }
    });
    window.dispatchEvent(failEvent);
    assert.ok(testPromptBadge.className.includes('badge-danger'), 'Badge class should include badge-danger');
    assert.ok(testPromptBadge.textContent?.includes('Failed: API timeout'), `Badge should show Failed: API timeout, got: ${testPromptBadge.textContent}`);
  });

  await test('Receiving healthUpdate message updates nativeEngineBadge runtime readiness', () => {
    const { window, document } = setupTestSettingsDom();
    const nativeEngineBadge = document.getElementById('nativeEngineBadge');
    assert.ok(nativeEngineBadge, '#nativeEngineBadge must exist');

    // Health update: ready
    const readyEvent = new window.MessageEvent('message', {
      data: { command: 'healthUpdate', isHealthy: true }
    });
    window.dispatchEvent(readyEvent);
    assert.ok(nativeEngineBadge.className.includes('badge-success'), 'Badge class should include badge-success');
    assert.ok(nativeEngineBadge.textContent?.includes('Ready'), 'Badge text should indicate Ready');

    // Health update: degraded
    const degradedEvent = new window.MessageEvent('message', {
      data: { command: 'healthUpdate', isHealthy: false }
    });
    window.dispatchEvent(degradedEvent);
    assert.ok(nativeEngineBadge.className.includes('badge-warning'), 'Badge class should include badge-warning when degraded');
    assert.ok(nativeEngineBadge.textContent?.includes('Degraded'), 'Badge text should indicate Degraded');
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Settings Provider Backend (src/settingsProvider.ts & WebviewProvider)
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 3: Settings Provider Backend Integration ---');

  await test('src/settingsWebviewProvider.ts re-exports SettingsProvider cleanly', () => {
    assert.strictEqual(SettingsWebviewProvider, SettingsProvider, 'SettingsWebviewProvider must equal SettingsProvider');
  });

  await test('REGISTERED_CONFIG_KEYS contains "sendDelayMs"', () => {
    assert.ok(REGISTERED_CONFIG_KEYS.has('sendDelayMs'), 'REGISTERED_CONFIG_KEYS must contain "sendDelayMs"');
  });

  function createTestPanel(postMsgFn?: (msg: any) => Promise<boolean>) {
    return {
      webview: {
        postMessage: postMsgFn || (async () => true),
        asWebviewUri: (uri: any) => uri,
        cspSource: 'vscode-resource:',
        onDidReceiveMessage: () => ({ dispose: () => {} }),
        html: ''
      },
      onDidDispose: () => ({ dispose: () => {} }),
      onDidChangeViewState: () => ({ dispose: () => {} }),
      reveal: () => {},
      dispose: () => {}
    };
  }

  await test('SettingsProvider persists sendDelayMs to workspace configuration on saveSettings', async () => {
    mockConfigStore['sendDelayMs'] = 500;
    const mockPanel: any = createTestPanel();

    const provider = new (SettingsProvider as any)(
      mockPanel,
      { fsPath: '/ext' }
    );

    await provider.handleMessage({
      command: 'saveSettings',
      settings: {
        sendDelayMs: 850
      }
    });

    assert.strictEqual(mockConfigStore['sendDelayMs'], 850, 'mockConfigStore.sendDelayMs must be updated to 850');
  });

  await test('SettingsProvider handles testSendPrompt and replies with testResult payload', async () => {
    const postedToWebview: any[] = [];
    const mockPanel: any = createTestPanel(async (msg: any) => {
      postedToWebview.push(msg);
      return true;
    });

    const mockDispatcher = new PromptDispatcher({
      commandExecutor: async () => undefined
    });

    const provider = new (SettingsProvider as any)(
      mockPanel,
      { fsPath: '/ext' },
      mockDispatcher
    );

    await provider.handleMessage({ command: 'testSendPrompt' });

    assert.ok(postedToWebview.length >= 1, 'Provider must reply to webview');
    const resultMsg = postedToWebview.find(m => m.command === 'testResult');
    assert.ok(resultMsg, 'Provider must post testResult message');
    assert.strictEqual(resultMsg.success, true, 'testResult success must be true');
    assert.ok(typeof resultMsg.latencyMs === 'number', 'latencyMs must be numeric');
  });

  await test('SettingsProvider getHealthDiagnostics reflects Native Antigravity Dispatch engine', () => {
    const mockDispatcher = new PromptDispatcher({
      commandExecutor: async () => undefined
    });

    const mockPanel: any = createTestPanel();
    const provider = new (SettingsProvider as any)(
      mockPanel,
      { fsPath: '/ext' },
      mockDispatcher
    );

    const health = provider.getHealthDiagnostics();
    assert.strictEqual(health.isHealthy, true, 'isHealthy must be true');
    assert.strictEqual(health.engine, 'Native Antigravity Dispatch', 'engine must be Native Antigravity Dispatch');
    assert.strictEqual(health.nativeCommandStatus, 'Native Engine Ready', 'nativeCommandStatus must be Ready');
  });

  // ---------------------------------------------------------------------------
  // Suite 4: Sidebar HTML Simplification
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 4: Sidebar HTML Simplification ---');

  await test('Sidebar HTML header reflects Native Ready status instead of inactive DOM bridge', () => {
    const { document } = setupTestSidebarDom();
    const bridgeStatusBadge = document.getElementById('bridgeStatusBadge');
    assert.ok(bridgeStatusBadge, '#bridgeStatusBadge must exist');
    const bridgeStatusText = document.getElementById('bridgeStatusText');
    assert.ok(bridgeStatusText, '#bridgeStatusText must exist');
    assert.strictEqual(bridgeStatusText.textContent, 'Native Ready', 'Sidebar header text should default to "Native Ready"');
    assert.ok(bridgeStatusBadge.title.includes('Native') && bridgeStatusBadge.title.includes('Engine'), 'Badge title must describe Native Engine');
  });

  await test('Sidebar HTML footer removes "⚡ DOM Bridge" and "🛠️ Diagnostics" buttons', () => {
    const { document } = setupTestSidebarDom();
    assert.strictEqual(document.getElementById('btnActivateBridge'), null, '#btnActivateBridge must be removed');
    assert.strictEqual(document.getElementById('btnDiagnostics'), null, '#btnDiagnostics must be removed');
    assert.ok(document.getElementById('btnSettings'), '#btnSettings must be retained');
    assert.ok(document.getElementById('btnCopyBridgeLog'), '#btnCopyBridgeLog must be retained');
  });

  // ---------------------------------------------------------------------------
  // Suite 5: Sidebar Script & SidebarProvider Logic
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 5: Sidebar Script & SidebarProvider Logic ---');

  await test('sidebar.js renderBridgeStatus renders Native Ready on connected/ready statuses', () => {
    const { exports, document } = setupTestSidebarDom();
    const bridgeStatusBadge = document.getElementById('bridgeStatusBadge')!;
    const bridgeStatusText = document.getElementById('bridgeStatusText')!;

    exports.renderBridgeStatus('ready');
    assert.ok(bridgeStatusBadge.className.includes('status-connected'), 'Should have status-connected class');
    assert.strictEqual(bridgeStatusText.textContent, '🟢 Native Ready', 'Text must be "🟢 Native Ready"');

    exports.renderBridgeStatus('disconnected');
    assert.ok(bridgeStatusBadge.className.includes('status-inactive'), 'Should have status-inactive class');
    assert.strictEqual(bridgeStatusText.textContent, '🔴 Native Unavailable', 'Text must be "🔴 Native Unavailable"');
  });

  await test('SidebarProvider sendBridgeStatus sends "ready" when native dispatcher is ready', () => {
    const postedToSidebar: any[] = [];
    const mockWebview: any = {
      postMessage: async (msg: any) => {
        postedToSidebar.push(msg);
        return true;
      }
    };

    const sidebar = new SidebarProvider({ fsPath: '/ext' } as any);
    (sidebar as any)._view = { webview: mockWebview };
    (sidebar as any)._isWebviewReady = true;

    sidebar.sendBridgeStatus();

    assert.ok(postedToSidebar.length >= 1, 'SidebarProvider must post bridgeStatus');
    const statusMsg = postedToSidebar.find(m => m.command === 'bridgeStatus');
    assert.ok(statusMsg, 'Message command must be bridgeStatus');
    assert.strictEqual(statusMsg.status, 'ready', 'Status must be ready');
  });

  await test('SidebarProvider handleWebviewMessage handles legacy activateBridge and diagnostics gracefully', async () => {
    const sidebar = new SidebarProvider({ fsPath: '/ext' } as any);
    (sidebar as any)._isWebviewReady = true;

    let threw = false;
    try {
      await sidebar.handleWebviewMessage({ command: 'activateBridge' });
      await sidebar.handleWebviewMessage({ command: 'diagnostics' });
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, false, 'Handling legacy messages should not throw');
  });

  // ---------------------------------------------------------------------------
  // Suite 6: Status Bar Presentation in extension.ts
  // ---------------------------------------------------------------------------
  console.log('\n--- Suite 6: Status Bar Presentation in extension.ts ---');

  await test('updateBridgeStatusBar updates bridgeStatusBarItem with Native Ready presentation', () => {
    let textSet = '';
    let tooltipSet = '';
    let commandSet = '';
    let shown = false;

    const mockItem: any = {
      get text() { return textSet; },
      set text(v: string) { textSet = v; },
      get tooltip() { return tooltipSet; },
      set tooltip(v: string) { tooltipSet = v; },
      get command() { return commandSet; },
      set command(v: string) { commandSet = v; },
      show: () => { shown = true; },
      hide: () => { shown = false; }
    };

    setBridgeStatusBarItem(mockItem);
    updateBridgeStatusBar();

    const currentItem = getBridgeStatusBarItem();
    assert.strictEqual(currentItem.text, '$(zap) Native: Ready', 'Status bar item text must be "$(zap) Native: Ready"');
    assert.ok(String(currentItem.tooltip || '').includes('Native Engine Ready'), 'Tooltip must indicate Native Engine Ready');
    assert.strictEqual(currentItem.command, 'autoplan.openSettings', 'Command must be autoplan.openSettings');
    assert.strictEqual(shown, true, 'Status bar item must be shown');
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(` Summary: All ${passedTests}/${totalTests} tests PASSED cleanly!`);
  console.log('========================================================================\n');
}

runPhase02Tests().catch((err) => {
  console.error('\n❌ Phase 02 Tests FAILED:');
  console.error(err);
  process.exit(1);
});
