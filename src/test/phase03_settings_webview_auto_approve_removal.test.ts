// Self-healing ESM require guard for JSDOM in Node < 20.19 CommonJS
if (!process.env.__PHASE03_SETTINGS_REMOVAL_REEXEC__) {
  try {
    require('jsdom');
  } catch (e: any) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      const { execFileSync } = require('child_process');
      const env = {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-require-module`.trim(),
        __PHASE03_SETTINGS_REMOVAL_REEXEC__: '1'
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
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          { name: 'test-workspace', uri: { fsPath: '/mock/workspace' } }
        ],
        getConfiguration: (_section?: string) => ({
          get: (_key: string, defaultValue: any) => defaultValue,
          update: async () => {}
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
        showWarningMessage: async () => {}
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: async () => {}
      },
      Uri: { file: (p: string) => ({ fsPath: p }) }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { JSDOM } from 'jsdom';

async function runPhase03Verification() {
  console.log('================================================================');
  console.log(' Phase 03: Settings Webview UI Auto-Approve Removal Test');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '../..');
  const settingsHtmlPath = path.join(rootDir, 'media/settings/settings.html');
  const settingsJsPath = path.join(rootDir, 'media/settings/settings.js');

  // -------------------------------------------------------------------------
  // 1. Static Source Code Cleanliness Inspection
  // -------------------------------------------------------------------------
  console.log('[Test 1] Inspecting settings.html and settings.js source files...');
  assert.ok(fs.existsSync(settingsHtmlPath), 'settings.html must exist');
  assert.ok(fs.existsSync(settingsJsPath), 'settings.js must exist');

  const htmlSource = fs.readFileSync(settingsHtmlPath, 'utf8');
  const jsSource = fs.readFileSync(settingsJsPath, 'utf8');

  // Verify settings.html has zero auto-approve references
  assert.strictEqual(
    htmlSource.includes('chkAutoApprovePermissions'),
    false,
    'settings.html must not contain chkAutoApprovePermissions'
  );
  assert.strictEqual(
    htmlSource.includes('Auto-Approve Terminal/Action Permissions'),
    false,
    'settings.html must not contain Auto-Approve Terminal/Action Permissions text'
  );

  // Verify settings.js has zero auto-approve references
  assert.strictEqual(
    jsSource.includes('chkAutoApprovePermissions'),
    false,
    'settings.js must not contain chkAutoApprovePermissions'
  );
  assert.strictEqual(
    jsSource.includes('autoApprovePermissions'),
    false,
    'settings.js must not contain autoApprovePermissions'
  );
  console.log('  ✓ Verified: Static source files have zero auto-approve references.\n');

  // -------------------------------------------------------------------------
  // 2. JSDOM Webview Document Structure Verification
  // -------------------------------------------------------------------------
  console.log('[Test 2] Verifying settings.html DOM structure in JSDOM...');
  const dom = new JSDOM(htmlSource, { runScripts: 'dangerously', url: 'http://localhost' });
  const { window } = dom;
  const { document } = window;

  // Confirm absence of #chkAutoApprovePermissions
  const autoApproveEl = document.getElementById('chkAutoApprovePermissions');
  assert.strictEqual(autoApproveEl, null, '#chkAutoApprovePermissions must be absent from the DOM');
  assert.strictEqual(document.querySelector('#chkAutoApprovePermissions'), null);

  // Confirm sibling automation controls remain intact
  const autoInjectEl = document.getElementById('chkAutoInjectWorkbench') as HTMLInputElement | null;
  assert.ok(autoInjectEl, '#chkAutoInjectWorkbench must exist in DOM');
  assert.strictEqual(autoInjectEl.type, 'checkbox');

  const suppressWarningsEl = document.getElementById('chkSuppressFallbackWarnings') as HTMLInputElement | null;
  assert.ok(suppressWarningsEl, '#chkSuppressFallbackWarnings must exist in DOM');
  assert.strictEqual(suppressWarningsEl.type, 'checkbox');

  // Confirm essential core elements exist
  assert.ok(document.getElementById('optTierAuto'), '#optTierAuto must exist');
  assert.ok(document.getElementById('optTier1'), '#optTier1 must exist');
  assert.ok(document.getElementById('optTier2'), '#optTier2 must exist');
  assert.ok(document.getElementById('optTier3'), '#optTier3 must exist');
  assert.ok(document.getElementById('chkAllowFallback'), '#chkAllowFallback must exist');
  assert.ok(document.getElementById('txtDelayMs'), '#txtDelayMs must exist');
  assert.ok(document.getElementById('txtTimeoutMinutes'), '#txtTimeoutMinutes must exist');
  assert.ok(document.getElementById('txtRepeatCount'), '#txtRepeatCount must exist');
  assert.ok(document.getElementById('txtFocusDelayMs'), '#txtFocusDelayMs must exist');
  assert.ok(document.getElementById('txtBridgeTimeoutMs'), '#txtBridgeTimeoutMs must exist');
  assert.ok(document.getElementById('txtDefaultPlanFolder'), '#txtDefaultPlanFolder must exist');
  assert.ok(document.getElementById('txtPromptTemplate'), '#txtPromptTemplate must exist');
  assert.ok(document.getElementById('txtCompletionKeyword'), '#txtCompletionKeyword must exist');
  assert.ok(document.getElementById('btnSave'), '#btnSave must exist');
  assert.ok(document.getElementById('btnReset'), '#btnReset must exist');
  assert.ok(document.getElementById('saveStatusText'), '#saveStatusText must exist');
  console.log('  ✓ Verified: DOM structure is intact and clean of auto-approve toggle.\n');

  // -------------------------------------------------------------------------
  // 3. Execution of settings.js & Lifecycle / IPC Verification
  // -------------------------------------------------------------------------
  console.log('[Test 3] Executing settings.js in mock webview environment...');
  const postedMessages: any[] = [];
  (window as any).module = { exports: {} };
  (window as any).acquireVsCodeApi = () => ({
    postMessage: (msg: any) => {
      postedMessages.push(JSON.parse(JSON.stringify(msg)));
    }
  });

  // Evaluate settings.js inside JSDOM window
  let scriptLoadError: any = null;
  try {
    window.eval(jsSource);
  } catch (err) {
    scriptLoadError = err;
  }
  assert.strictEqual(scriptLoadError, null, `settings.js must execute without throwing errors: ${scriptLoadError}`);

  // Verify 'ready' signal was dispatched immediately
  assert.ok(postedMessages.length >= 1, 'settings.js must post at least one message on load');
  assert.deepStrictEqual(postedMessages[0], { command: 'ready' }, 'Initial IPC message must be { command: "ready" }');
  console.log('  ✓ Verified: settings.js initialized cleanly and posted ready signal.\n');

  // -------------------------------------------------------------------------
  // 4. initSettings & applySettingsToForm State Binding
  // -------------------------------------------------------------------------
  console.log('[Test 4] Testing initSettings IPC message handling & form binding...');
  const initialSettingsPayload = {
    executionMode: 'domBridge',
    allowTierFallback: false,
    delayBetweenLoopsMs: 3500,
    timeoutPerLoopMinutes: 20,
    repeatCount: 10,
    focusDelayMs: 900,
    bridgeTimeoutMs: 8000,
    defaultPlanFolder: 'plans/test-phase-03',
    promptTemplate: 'Execute phase {xxx} strictly.',
    promptText: 'Execute phase {xxx} strictly.',
    completionKeyword: 'Done phase03.',
    autoInjectWorkbench: false,
    suppressFallbackWarnings: false
  };

  // Dispatch initSettings event from extension host
  window.dispatchEvent(
    new (window as any).MessageEvent('message', {
      data: {
        command: 'initSettings',
        settings: initialSettingsPayload
      }
    })
  );

  // Check form values updated correctly
  const optTier1 = document.getElementById('optTier1') as HTMLInputElement;
  assert.strictEqual(optTier1.checked, true, 'optTier1 must be checked');

  const chkAllowFallback = document.getElementById('chkAllowFallback') as HTMLInputElement;
  assert.strictEqual(chkAllowFallback.checked, false, 'chkAllowFallback must be false');

  const txtDelayMs = document.getElementById('txtDelayMs') as HTMLInputElement;
  assert.strictEqual(txtDelayMs.value, '3500', 'txtDelayMs must be 3500');

  assert.strictEqual(autoInjectEl.checked, false, 'chkAutoInjectWorkbench must be false');
  assert.strictEqual(suppressWarningsEl.checked, false, 'chkSuppressFallbackWarnings must be false');

  // -------------------------------------------------------------------------
  // 5. Settings Serialization (collectCurrentSettings / getFormSettings)
  // -------------------------------------------------------------------------
  console.log('[Test 5] Verifying settings payload serialization (getFormSettings)...');
  const settingsModule = (window as any).module?.exports;
  assert.ok(settingsModule, 'settings.js must export module.exports in Node environment');

  const getSettingsFn = settingsModule.collectCurrentSettings || settingsModule.getFormSettings;
  assert.strictEqual(typeof getSettingsFn, 'function', 'collectCurrentSettings / getFormSettings must be a function');

  const currentSettings = getSettingsFn();

  // Verify autoApprovePermissions is completely absent from collected settings
  assert.strictEqual(
    (currentSettings as any).autoApprovePermissions,
    undefined,
    'autoApprovePermissions must be undefined in collected settings'
  );
  assert.strictEqual(
    'autoApprovePermissions' in currentSettings,
    false,
    'collected settings object must not contain autoApprovePermissions key'
  );
  assert.strictEqual(
    Object.keys(currentSettings).includes('autoApprovePermissions'),
    false,
    'Object.keys(collectedSettings) must not include autoApprovePermissions'
  );

  // Sibling settings must be present and correctly serialized
  assert.strictEqual(currentSettings.executionMode, 'domBridge');
  assert.strictEqual(currentSettings.allowTierFallback, false);
  assert.strictEqual(currentSettings.delayBetweenLoopsMs, 3500);
  assert.strictEqual(currentSettings.autoInjectWorkbench, false);
  assert.strictEqual(currentSettings.suppressFallbackWarnings, false);
  assert.strictEqual(currentSettings.completionKeyword, 'Done phase03.');
  console.log('  ✓ Verified: Collected settings contain zero autoApprovePermissions properties.\n');

  // -------------------------------------------------------------------------
  // 6. Dirty State Tracking & Save Action IPC Serialization
  // -------------------------------------------------------------------------
  console.log('[Test 6] Testing dirty state tracking and save IPC dispatch...');
  const btnSave = document.getElementById('btnSave') as HTMLButtonElement;
  const saveStatusText = document.getElementById('saveStatusText') as HTMLElement;

  // After initSettings, state must be clean
  assert.strictEqual(btnSave.disabled, true, 'btnSave should be disabled when clean');
  assert.strictEqual(settingsModule.checkDirty(), false, 'checkDirty() should return false when clean');
  assert.strictEqual(saveStatusText.textContent, 'All changes saved');

  // Mutate an input: change autoInjectWorkbench to true
  autoInjectEl.checked = true;
  autoInjectEl.dispatchEvent(new (window as any).Event('change'));

  // Dirty state should now trigger
  assert.strictEqual(settingsModule.checkDirty(), true, 'checkDirty() should return true when mutated');
  assert.strictEqual(btnSave.disabled, false, 'btnSave should be enabled when dirty');
  assert.strictEqual(saveStatusText.textContent, 'Unsaved changes');

  // Trigger Save button click
  postedMessages.length = 0; // Clear messages
  btnSave.click();

  assert.strictEqual(postedMessages.length, 1, 'Clicking save should post 1 message');
  const saveMsg: any = postedMessages[0];
  assert.strictEqual(saveMsg.command, 'saveSettings', 'Message command must be saveSettings');
  assert.ok(saveMsg.settings, 'Save message must carry settings payload');

  // Verify the IPC payload does not contain autoApprovePermissions
  assert.strictEqual(
    saveMsg.settings.autoApprovePermissions,
    undefined,
    'IPC save payload must not contain autoApprovePermissions'
  );
  assert.strictEqual(
    'autoApprovePermissions' in saveMsg.settings,
    false,
    'IPC save payload object must not have autoApprovePermissions key'
  );
  assert.strictEqual(saveMsg.settings.autoInjectWorkbench, true);

  // Simulate Extension Host confirming save
  window.dispatchEvent(
    new (window as any).MessageEvent('message', {
      data: { command: 'saveConfirmed' }
    })
  );

  assert.strictEqual(btnSave.disabled, true, 'btnSave should return to disabled after saveConfirmed');
  assert.strictEqual(settingsModule.checkDirty(), false, 'checkDirty() should return false after saveConfirmed');
  assert.strictEqual(saveStatusText.textContent, 'All changes saved');
  console.log('  ✓ Verified: Dirty tracking and saveSettings IPC operate flawlessly without autoApprovePermissions.\n');

  console.log('================================================================');
  console.log(' ALL PHASE 03 TESTS PASSED SUCCESSFULLY! (100% VERIFIED)');
  console.log('================================================================\n');
}

runPhase03Verification().catch(err => {
  console.error('Phase 03 Verification Test Failed:', err);
  process.exit(1);
});
