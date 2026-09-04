// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
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
import {
  TAG_START,
  TAG_END,
  BACKUP_SUFFIX,
  DEFAULT_BRIDGE_SCRIPT_NAME,
  installBridgeScript,
  installBridgeScriptAsync,
  uninstallBridgeScript,
  uninstallBridgeScriptAsync
} from '../workbenchInjector';

async function runPhase05Tests() {
  console.log('=== Running Phase 05: Safe Workbench Uninstallation & Stale Backup Elimination Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase05-test-'));

  try {
    // ----------------------------------------------------------------------
    // Test 1: Synchronous In-Place Uninstallation with Stale Backup
    // ----------------------------------------------------------------------
    console.log('[Test 1] Testing synchronous safe in-place uninstallation after simulated VS Code upgrade...');
    const dirSync = path.join(tempDir, 'sync-test');
    fs.mkdirSync(dirSync, { recursive: true });
    const wbFileSync = path.join(dirSync, 'workbench.html');
    const backupFileSync = `${wbFileSync}${BACKUP_SUFFIX}`;
    const sidecarSync = path.join(dirSync, DEFAULT_BRIDGE_SCRIPT_NAME);

    const v188Html = `<!DOCTYPE html>
<html>
<head>
  <title>VS Code 1.88</title>
  <link rel="stylesheet" href="workbench.v188.css">
  <script src="workbench.desktop.main.v188.js"></script>
</head>
<body>
  <div id="workbench.main.container">v1.88 Workbench</div>
</body>
</html>`;

    fs.writeFileSync(wbFileSync, v188Html, 'utf8');

    // 1. Install bridge script on v1.88
    const installSyncRes = installBridgeScript({
      workbenchPath: wbFileSync,
      timestamp: 10001,
      updateChecksums: false
    });
    assert.strictEqual(installSyncRes.success, true, 'installBridgeScript should succeed on v1.88');
    assert.ok(fs.existsSync(backupFileSync), 'Backup file must exist after install');
    assert.ok(fs.existsSync(sidecarSync), 'Sidecar script must exist after install');

    const initialBackupContent = fs.readFileSync(backupFileSync, 'utf8');
    assert.ok(initialBackupContent.includes('workbench.desktop.main.v188.js'), 'Backup should contain v1.88 scripts');

    // 2. Simulate VS Code update to v1.89:
    // workbench.html is updated by VS Code to v1.89 markup, but bridge tags are present,
    // and the v1.88 backup file remains untouched on disk.
    const v189HtmlWithBridge = `<!DOCTYPE html>
<html>
<head>
  <title>VS Code 1.89</title>
  <meta name="vscode-version" content="1.89.0">
  <link rel="stylesheet" href="workbench.v189.css">
  <script src="workbench.desktop.main.v189.js"></script>
</head>
<body>
  <div id="workbench.main.container">v1.89 Workbench</div>
\t${TAG_START}\n\t<script src="autoplan-dom-bridge.js?v=10001"></script>\n\t${TAG_END}
</body>
</html>`;

    fs.writeFileSync(wbFileSync, v189HtmlWithBridge, 'utf8');
    // Ensure v1.88 backup remains untouched
    assert.ok(fs.readFileSync(backupFileSync, 'utf8').includes('v188.js'));

    // 3. Perform uninstallation
    const uninstallSyncRes = uninstallBridgeScript({
      workbenchPath: wbFileSync,
      updateChecksums: false
    });
    assert.strictEqual(uninstallSyncRes.success, true, 'uninstallBridgeScript should succeed');

    const uninstalledSyncHtml = fs.readFileSync(wbFileSync, 'utf8');

    // 4. Assertions
    assert.ok(uninstalledSyncHtml.includes('workbench.desktop.main.v189.js'), 'Resulting workbench.html must contain v1.89 script');
    assert.ok(uninstalledSyncHtml.includes('workbench.v189.css'), 'Resulting workbench.html must contain v1.89 CSS');
    assert.ok(uninstalledSyncHtml.includes('<meta name="vscode-version" content="1.89.0">'), 'Resulting workbench.html must contain v1.89 metadata');
    assert.strictEqual(uninstalledSyncHtml.includes('workbench.desktop.main.v188.js'), false, 'Resulting workbench.html must NOT contain obsolete v1.88 scripts');
    assert.strictEqual(uninstalledSyncHtml.includes('workbench.v188.css'), false, 'Resulting workbench.html must NOT contain obsolete v1.88 CSS');
    assert.strictEqual(uninstalledSyncHtml.includes(TAG_START), false, 'TAG_START must be removed');
    assert.strictEqual(uninstalledSyncHtml.includes(TAG_END), false, 'TAG_END must be removed');
    assert.strictEqual(fs.existsSync(backupFileSync), false, 'Obsolete .bak file must be cleanly deleted');
    assert.strictEqual(fs.existsSync(sidecarSync), false, 'Sidecar script file must be cleanly deleted');

    console.log('  -> Passed: Synchronous in-place uninstallation preserved v1.89 and purged stale backup.');

    // ----------------------------------------------------------------------
    // Test 2: Asynchronous In-Place Uninstallation with Stale Backup
    // ----------------------------------------------------------------------
    console.log('\n[Test 2] Testing asynchronous safe in-place uninstallation after simulated VS Code upgrade...');
    const dirAsync = path.join(tempDir, 'async-test');
    fs.mkdirSync(dirAsync, { recursive: true });
    const wbFileAsync = path.join(dirAsync, 'workbench.html');
    const backupFileAsync = `${wbFileAsync}${BACKUP_SUFFIX}`;
    const sidecarAsync = path.join(dirAsync, DEFAULT_BRIDGE_SCRIPT_NAME);

    await fs.promises.writeFile(wbFileAsync, v188Html, 'utf8');

    // 1. Install bridge script on v1.88 asynchronously
    const installAsyncRes = await installBridgeScriptAsync({
      workbenchPath: wbFileAsync,
      timestamp: 20002,
      updateChecksums: false
    });
    assert.strictEqual(installAsyncRes.success, true, 'installBridgeScriptAsync should succeed on v1.88');
    assert.ok(fs.existsSync(backupFileAsync), 'Backup file must exist after async install');
    assert.ok(fs.existsSync(sidecarAsync), 'Sidecar script must exist after async install');

    // 2. Simulate VS Code update to v1.89 with injected bridge tags
    await fs.promises.writeFile(wbFileAsync, v189HtmlWithBridge, 'utf8');
    assert.ok((await fs.promises.readFile(backupFileAsync, 'utf8')).includes('v188.js'));

    // 3. Perform uninstallation asynchronously
    const uninstallAsyncRes = await uninstallBridgeScriptAsync({
      workbenchPath: wbFileAsync,
      updateChecksums: false
    });
    assert.strictEqual(uninstallAsyncRes.success, true, 'uninstallBridgeScriptAsync should succeed');

    const uninstalledAsyncHtml = await fs.promises.readFile(wbFileAsync, 'utf8');

    // 4. Assertions
    assert.ok(uninstalledAsyncHtml.includes('workbench.desktop.main.v189.js'), 'Async: Resulting workbench.html must contain v1.89 script');
    assert.ok(uninstalledAsyncHtml.includes('workbench.v189.css'), 'Async: Resulting workbench.html must contain v1.89 CSS');
    assert.ok(uninstalledAsyncHtml.includes('<meta name="vscode-version" content="1.89.0">'), 'Async: Resulting workbench.html must contain v1.89 metadata');
    assert.strictEqual(uninstalledAsyncHtml.includes('workbench.desktop.main.v188.js'), false, 'Async: Resulting workbench.html must NOT contain obsolete v1.88 scripts');
    assert.strictEqual(uninstalledAsyncHtml.includes('workbench.v188.css'), false, 'Async: Resulting workbench.html must NOT contain obsolete v1.88 CSS');
    assert.strictEqual(uninstalledAsyncHtml.includes(TAG_START), false, 'Async: TAG_START must be removed');
    assert.strictEqual(uninstalledAsyncHtml.includes(TAG_END), false, 'Async: TAG_END must be removed');
    assert.strictEqual(fs.existsSync(backupFileAsync), false, 'Async: Obsolete .bak file must be cleanly deleted');
    assert.strictEqual(fs.existsSync(sidecarAsync), false, 'Async: Sidecar script file must be cleanly deleted');

    console.log('  -> Passed: Asynchronous in-place uninstallation preserved v1.89 and purged stale backup.');

    // ----------------------------------------------------------------------
    // Test 3: Backup Freshness Synchronization on Installation
    // ----------------------------------------------------------------------
    console.log('\n[Test 3] Testing backup freshness synchronization during install (sync & async)...');
    const dirSyncFresh = path.join(tempDir, 'sync-fresh');
    fs.mkdirSync(dirSyncFresh, { recursive: true });
    const wbFresh = path.join(dirSyncFresh, 'workbench.html');
    const backupFresh = `${wbFresh}${BACKUP_SUFFIX}`;

    // Write a stale v1.88 backup beforehand
    fs.writeFileSync(backupFresh, v188Html, 'utf8');

    // Active workbench is v1.89 (without bridge tag)
    const v189CleanHtml = `<!DOCTYPE html>
<html>
<head>
  <title>VS Code 1.89 Clean</title>
  <script src="workbench.desktop.main.v189.js"></script>
</head>
<body>
  <div id="workbench.main.container">v1.89 Clean</div>
</body>
</html>`;
    fs.writeFileSync(wbFresh, v189CleanHtml, 'utf8');

    // Run installBridgeScript with forceBackup false (standard run)
    const freshInstallRes = installBridgeScript({
      workbenchPath: wbFresh,
      timestamp: 30003,
      updateChecksums: false
    });
    assert.strictEqual(freshInstallRes.success, true);

    // Stale backup should be refreshed to v1.89 content
    const updatedBackupContent = fs.readFileSync(backupFresh, 'utf8');
    assert.ok(updatedBackupContent.includes('workbench.desktop.main.v189.js'), 'Backup should be synchronized to v1.89');
    assert.strictEqual(updatedBackupContent.includes('workbench.desktop.main.v188.js'), false, 'Stale v1.88 backup content must be replaced');

    // Async test of freshness synchronization
    const dirAsyncFresh = path.join(tempDir, 'async-fresh');
    fs.mkdirSync(dirAsyncFresh, { recursive: true });
    const wbAsyncFresh = path.join(dirAsyncFresh, 'workbench.html');
    const backupAsyncFresh = `${wbAsyncFresh}${BACKUP_SUFFIX}`;

    await fs.promises.writeFile(backupAsyncFresh, v188Html, 'utf8');
    await fs.promises.writeFile(wbAsyncFresh, v189CleanHtml, 'utf8');

    const freshAsyncInstallRes = await installBridgeScriptAsync({
      workbenchPath: wbAsyncFresh,
      timestamp: 40004,
      updateChecksums: false
    });
    assert.strictEqual(freshAsyncInstallRes.success, true);

    const updatedAsyncBackupContent = await fs.promises.readFile(backupAsyncFresh, 'utf8');
    assert.ok(updatedAsyncBackupContent.includes('workbench.desktop.main.v189.js'), 'Async backup should be synchronized to v1.89');
    assert.strictEqual(updatedAsyncBackupContent.includes('workbench.desktop.main.v188.js'), false, 'Async stale v1.88 backup content must be replaced');

    console.log('  -> Passed: Backup freshness synchronization on installation verified.');

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }

  console.log('\n========================================================================');
  console.log('✅ ALL PHASE 05 SAFE WORKBENCH UNINSTALLATION TESTS PASSED!');
  console.log('========================================================================\n');
}

runPhase05Tests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
