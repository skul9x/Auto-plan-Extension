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
  getWorkbenchPath,
  findFileRecursive,
  writeFileElevated,
  isBridgeInstalled,
  buildBridgeScriptTag,
  suppressCorruptBannerScript,
  removeBridgeTagsFromHtml,
  installBridgeScript,
  uninstallBridgeScript,
  updateProductChecksums
} from '../workbenchInjector';

function runPhase01Tests() {
  console.log('=== Running Phase 01: Workbench Injector & Safe Patcher Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase01-workbench-'));

  try {
    // ----------------------------------------------------------------------
    // Test 1: Path Resolution & Candidate Discovery
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying workbench.html path resolution across candidate structures...');
    
    // Candidate 1: out/vs/code/electron-sandbox/workbench/workbench.html
    const appRoot1 = path.join(tempDir, 'app1');
    const cand1 = path.join(appRoot1, 'out', 'vs', 'code', 'electron-sandbox', 'workbench');
    fs.mkdirSync(cand1, { recursive: true });
    fs.writeFileSync(path.join(cand1, 'workbench.html'), '<html><body>Workbench 1</body></html>', 'utf8');

    const found1 = getWorkbenchPath(appRoot1);
    assert.strictEqual(found1, path.join(cand1, 'workbench.html'), 'Failed finding candidate 1');

    // Candidate 2: out/vs/code/electron-browser/workbench/workbench.html
    const appRoot2 = path.join(tempDir, 'app2');
    const cand2 = path.join(appRoot2, 'out', 'vs', 'code', 'electron-browser', 'workbench');
    fs.mkdirSync(cand2, { recursive: true });
    fs.writeFileSync(path.join(cand2, 'workbench.html'), '<html><body>Workbench 2</body></html>', 'utf8');

    const found2 = getWorkbenchPath(appRoot2);
    assert.strictEqual(found2, path.join(cand2, 'workbench.html'), 'Failed finding candidate 2');

    // Fallback: Non-standard deeply nested path within out/
    const appRootDeep = path.join(tempDir, 'appDeep');
    const deepDir = path.join(appRootDeep, 'out', 'custom', 'nested', 'path');
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(path.join(deepDir, 'workbench.html'), '<html><body>Deep Workbench</body></html>', 'utf8');

    const foundDeep = getWorkbenchPath(appRootDeep);
    assert.strictEqual(foundDeep, path.join(deepDir, 'workbench.html'), 'Failed recursive fallback search');

    console.log('  -> Passed: Path resolution & recursive search work correctly.');

    // ----------------------------------------------------------------------
    // Test 2: Bridge Tag Builder & Detection
    // ----------------------------------------------------------------------
    console.log('\n[Test 2] Verifying tag builder and bridge detection...');
    const tag1 = buildBridgeScriptTag(1740800000000);
    assert.ok(tag1.includes(TAG_START), 'Tag must contain TAG_START');
    assert.ok(tag1.includes(TAG_END), 'Tag must contain TAG_END');
    assert.ok(tag1.includes('autoplan-dom-bridge.js?v=1740800000000'), 'Tag must contain script src and version');

    assert.strictEqual(isBridgeInstalled(tag1), true, 'isBridgeInstalled should be true for content with tags');
    assert.strictEqual(isBridgeInstalled('<html><body>Clean</body></html>'), false, 'isBridgeInstalled should be false for clean content');

    console.log('  -> Passed: Tag builder & installation detection verified.');

    // ----------------------------------------------------------------------
    // Test 3: Safe Script Injection & Backup Creation
    // ----------------------------------------------------------------------
    console.log('\n[Test 3] Verifying safe script injection and automated backup...');
    const testHtmlDir = path.join(tempDir, 'injection-test');
    fs.mkdirSync(testHtmlDir, { recursive: true });
    const wbFile = path.join(testHtmlDir, 'workbench.html');
    const originalHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Antigravity Workbench</title>
</head>
<body>
  <div id="workbench.main.container"></div>
</body>
</html>`;
    fs.writeFileSync(wbFile, originalHtml, 'utf8');

    const installResult = installBridgeScript({
      workbenchPath: wbFile,
      timestamp: 1740800000111,
      updateChecksums: false
    });

    assert.strictEqual(installResult.success, true, 'installBridgeScript should succeed');
    assert.strictEqual(installResult.path, wbFile);

    const patchedHtml = fs.readFileSync(wbFile, 'utf8');
    assert.ok(patchedHtml.includes(TAG_START), 'Patched file should contain TAG_START');
    assert.ok(patchedHtml.includes(TAG_END), 'Patched file should contain TAG_END');
    assert.ok(patchedHtml.includes('autoplan-dom-bridge.js?v=1740800000111'), 'Patched file should contain versioned script');
    assert.ok(patchedHtml.indexOf(TAG_START) < patchedHtml.indexOf('</body>'), 'Script tag should be injected before </body>');

    // Verify backup created
    const backupFile = `${wbFile}${BACKUP_SUFFIX}`;
    assert.ok(fs.existsSync(backupFile), 'Backup file .autoplan.bak should be created');
    const backupContent = fs.readFileSync(backupFile, 'utf8');
    assert.strictEqual(backupContent.trim(), originalHtml.trim(), 'Backup content must match original HTML verbatim');

    console.log('  -> Passed: Script injected before </body> and backup safely created.');

    // ----------------------------------------------------------------------
    // Test 4: Idempotency & Tag Updates
    // ----------------------------------------------------------------------
    console.log('\n[Test 4] Verifying injection idempotency and timestamp update...');
    const secondInstall = installBridgeScript({
      workbenchPath: wbFile,
      timestamp: 1740800000222,
      updateChecksums: false
    });

    assert.strictEqual(secondInstall.success, true);
    const rePatchedHtml = fs.readFileSync(wbFile, 'utf8');

    // Count occurrences of TAG_START
    const startCount = (rePatchedHtml.match(new RegExp(TAG_START, 'g')) || []).length;
    assert.strictEqual(startCount, 1, 'Should have exactly 1 TAG_START after re-injection');
    assert.ok(rePatchedHtml.includes('autoplan-dom-bridge.js?v=1740800000222'), 'Updated timestamp must be present');
    assert.ok(!rePatchedHtml.includes('autoplan-dom-bridge.js?v=1740800000111'), 'Old timestamp must be removed');

    console.log('  -> Passed: Idempotent re-injection successfully updated timestamp without tag duplication.');

    // ----------------------------------------------------------------------
    // Test 5: Uninstallation & Clean Revert
    // ----------------------------------------------------------------------
    console.log('\n[Test 5] Verifying uninstallation and clean revert...');
    // Create a mock sidecar script in the same directory
    const sidecarScript = path.join(testHtmlDir, 'autoplan-dom-bridge.js');
    fs.writeFileSync(sidecarScript, 'console.log("sidecar");', 'utf8');
    assert.ok(fs.existsSync(sidecarScript), 'Sidecar script must exist before uninstall');

    const uninstallResult = uninstallBridgeScript({
      workbenchPath: wbFile,
      updateChecksums: false
    });

    assert.strictEqual(uninstallResult.success, true, 'uninstallBridgeScript should succeed');
    const revertedHtml = fs.readFileSync(wbFile, 'utf8');
    assert.strictEqual(revertedHtml.includes(TAG_START), false, 'TAG_START must be removed');
    assert.strictEqual(revertedHtml.includes(TAG_END), false, 'TAG_END must be removed');
    assert.strictEqual(revertedHtml.trim(), originalHtml.trim(), 'Reverted HTML must match original verbatim');
    assert.strictEqual(fs.existsSync(sidecarScript), false, 'Sidecar script should be deleted on uninstall');

    console.log('  -> Passed: Uninstallation cleanly reverted HTML and cleaned up sidecars.');

    // ----------------------------------------------------------------------
    // Test 6: Corruption Banner Suppression & Checksum Utilities
    // ----------------------------------------------------------------------
    console.log('\n[Test 6] Verifying corruption banner suppression script & product.json checksum updates...');
    const bannerScript = suppressCorruptBannerScript();
    assert.ok(bannerScript.includes('notification-toast'), 'Suppression script must target notification-toast');
    assert.ok(bannerScript.includes('corrupt'), 'Suppression script must check for corruption keywords');
    assert.ok(bannerScript.includes('MutationObserver'), 'Suppression script should observe DOM mutations');

    // Test product.json checksum update
    const productDir = path.join(tempDir, 'mock-app');
    const outProductDir = path.join(productDir, 'out', 'vs', 'workbench');
    fs.mkdirSync(outProductDir, { recursive: true });

    const mockWb = path.join(outProductDir, 'workbench.html');
    fs.writeFileSync(mockWb, '<html><body>Mock WB</body></html>', 'utf8');

    const mockProductJsonPath = path.join(productDir, 'product.json');
    const mockProductJson = {
      nameShort: 'Antigravity',
      checksums: {
        'vs/workbench/workbench.html': 'dummyoldhash'
      }
    };
    fs.writeFileSync(mockProductJsonPath, JSON.stringify(mockProductJson, null, 2), 'utf8');

    const checksumResult = updateProductChecksums(mockWb);
    assert.strictEqual(checksumResult, true, 'updateProductChecksums should succeed');

    const updatedProduct = JSON.parse(fs.readFileSync(mockProductJsonPath, 'utf8'));
    assert.notStrictEqual(updatedProduct.checksums['vs/workbench/workbench.html'], 'dummyoldhash', 'Checksum should be recomputed and updated');

    console.log('  -> Passed: Corruption banner suppression & product.json checksum updater verified.');

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 01 WORKBENCH INJECTOR TESTS PASSED!');
  console.log('======================================================\n');
}

runPhase01Tests();
