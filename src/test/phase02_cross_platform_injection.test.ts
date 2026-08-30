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
  buildLinuxElevationCommand,
  buildWindowsElevationCommand,
  computeSha256Base64,
  suppressCorruptBannerScript,
  removeBridgeTagsFromHtml,
  buildBridgeScriptContent,
  installBridgeScript,
  uninstallBridgeScript,
  updateProductChecksums
} from '../workbenchInjector';

function runPhase02Tests() {
  console.log('=== Running Phase 02: Cross-Platform Injection & Elevation Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase02-cross-platform-'));

  try {
    // ----------------------------------------------------------------------
    // Test 1: Linux Elevation Command Generation & Quoting
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying Linux Polkit elevation command generator & escaping...');
    const linuxTmp = '/tmp/autoplan test.tmp';
    const linuxTarget = '/opt/VS Code/resources/app/out/workbench.html';
    const linuxCmd = buildLinuxElevationCommand(linuxTmp, linuxTarget);

    assert.ok(linuxCmd.startsWith('pkexec bash -c "'), 'Linux elevation command must start with pkexec bash -c');
    assert.ok(linuxCmd.includes(`cp '${linuxTmp}' '${linuxTarget}'`), 'Linux command must safely quote cp source and destination');
    assert.ok(linuxCmd.includes(`chmod 644 '${linuxTarget}'`), 'Linux command must ensure chmod 644 permission on target');

    // Test quote escaping in Linux command
    const linuxQuoteTmp = "/tmp/auto'plan.tmp";
    const linuxQuoteTarget = "/opt/VS'Code/workbench.html";
    const linuxQuoteCmd = buildLinuxElevationCommand(linuxQuoteTmp, linuxQuoteTarget);
    assert.ok(linuxQuoteCmd.includes("/tmp/auto'\\''plan.tmp"), 'Linux elevation must properly escape single quotes');
    assert.ok(linuxQuoteCmd.includes("/opt/VS'\\''Code/workbench.html"), 'Linux elevation must escape target single quotes');
    console.log('  -> Passed: Linux Polkit elevation command syntax and quoting verified.');

    // ----------------------------------------------------------------------
    // Test 2: Windows Elevation Command Generation & Quoting
    // ----------------------------------------------------------------------
    console.log('\n[Test 2] Verifying Windows UAC elevation command generator & escaping...');
    const winTmp = 'C:\\Users\\Admin AppData\\Local\\Temp\\autoplan.tmp';
    const winTarget = 'C:\\Program Files\\Microsoft VS Code\\resources\\app\\out\\workbench.html';
    const winCmd = buildWindowsElevationCommand(winTmp, winTarget);

    assert.ok(winCmd.includes('powershell.exe'), 'Windows command must invoke powershell.exe');
    assert.ok(winCmd.includes('-ExecutionPolicy Bypass'), 'Windows command must bypass execution policy');
    assert.ok(winCmd.includes('Start-Process powershell -Verb runAs'), 'Windows command must request UAC elevation via Start-Process runAs');
    assert.ok(winCmd.includes(`-LiteralPath \\"${winTmp}\\"`), 'Windows command must pass escaped literal source path');
    assert.ok(winCmd.includes(`-Destination \\"${winTarget}\\"`), 'Windows command must pass escaped literal target destination');
    assert.ok(winCmd.includes('-Force'), 'Windows command must force copy item');
    assert.ok(winCmd.includes('-Wait'), 'Windows command must wait for child elevated process');
    console.log('  -> Passed: Windows UAC elevation command syntax and escaping verified.');

    // ----------------------------------------------------------------------
    // Test 3: Cross-Platform Candidate Discovery (Windows & Linux layouts)
    // ----------------------------------------------------------------------
    console.log('\n[Test 3] Verifying cross-platform workbench.html candidate layout discovery...');
    
    // Linux style layout
    const linuxAppRoot = path.join(tempDir, 'linux_app');
    const linuxWbDir = path.join(linuxAppRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench');
    fs.mkdirSync(linuxWbDir, { recursive: true });
    const linuxWbFile = path.join(linuxWbDir, 'workbench.html');
    fs.writeFileSync(linuxWbFile, '<!DOCTYPE html><html><body>Linux Workbench</body></html>', 'utf8');

    const discoveredLinuxWb = getWorkbenchPath(linuxAppRoot);
    assert.strictEqual(discoveredLinuxWb, linuxWbFile, 'Failed discovering Linux candidate path');

    // Windows style layout with browser variant
    const winAppRoot = path.join(tempDir, 'win app with spaces');
    const winWbDir = path.join(winAppRoot, 'out', 'vs', 'code', 'browser', 'workbench');
    fs.mkdirSync(winWbDir, { recursive: true });
    const winWbFile = path.join(winWbDir, 'workbench.html');
    fs.writeFileSync(winWbFile, '<!DOCTYPE html><html><body>Windows Workbench</body></html>', 'utf8');

    const discoveredWinWb = getWorkbenchPath(winAppRoot);
    assert.strictEqual(discoveredWinWb, winWbFile, 'Failed discovering Windows candidate path with spaces');
    console.log('  -> Passed: Candidate discovery works across diverse directory layouts.');

    // ----------------------------------------------------------------------
    // Test 4: Injection, Idempotency, Sidecar Synchronization & Context Path
    // ----------------------------------------------------------------------
    console.log('\n[Test 4] Verifying injection lifecycle, sidecar sync, and context resolution...');
    const testWbDir = path.join(tempDir, 'mock_sandbox', 'out', 'vs', 'workbench');
    fs.mkdirSync(testWbDir, { recursive: true });
    const wbHtmlPath = path.join(testWbDir, 'workbench.html');
    const initialHtml = `<!DOCTYPE html>\n<html>\n<head><title>Test Workbench</title></head>\n<body>\n  <div id="container"></div>\n</body>\n</html>`;
    fs.writeFileSync(wbHtmlPath, initialHtml, 'utf8');

    // Custom extension context with mock media folder
    const mockExtDir = path.join(tempDir, 'mock_extension');
    const mockMediaDir = path.join(mockExtDir, 'media');
    fs.mkdirSync(mockMediaDir, { recursive: true });
    const customBridgeCode = `/* Mock DOM Bridge v2 */\nconsole.log('[Auto-Plan-Bridge] Active');\n`;
    fs.writeFileSync(path.join(mockMediaDir, 'autoplan-dom-bridge.js'), customBridgeCode, 'utf8');

    const mockContext = { extensionPath: mockExtDir };

    // 1st Install
    const res1 = installBridgeScript({
      workbenchPath: wbHtmlPath,
      timestamp: 1740900000000,
      context: mockContext,
      updateChecksums: false
    });
    assert.strictEqual(res1.success, true, 'First installation must succeed');

    const installedHtml = fs.readFileSync(wbHtmlPath, 'utf8');
    assert.ok(installedHtml.includes(TAG_START), 'Injected HTML must include TAG_START');
    assert.ok(installedHtml.includes(TAG_END), 'Injected HTML must include TAG_END');
    assert.ok(installedHtml.includes('autoplan-dom-bridge.js?v=1740900000000'), 'Injected HTML must include timestamped script tag');
    
    // Check sidecar file synced into workbench directory
    const syncedScript = path.join(testWbDir, 'autoplan-dom-bridge.js');
    assert.ok(fs.existsSync(syncedScript), 'Sidecar bridge script must be copied into workbench dir');
    assert.strictEqual(fs.readFileSync(syncedScript, 'utf8'), customBridgeCode, 'Synced script content must match extension media');

    // Check backup file created
    const backupFile = `${wbHtmlPath}${BACKUP_SUFFIX}`;
    assert.ok(fs.existsSync(backupFile), 'Backup file must exist');
    assert.strictEqual(fs.readFileSync(backupFile, 'utf8').trim(), initialHtml.trim(), 'Backup must preserve original HTML');

    // 2nd Install (Idempotent update with new timestamp)
    const res2 = installBridgeScript({
      workbenchPath: wbHtmlPath,
      timestamp: 1740900000999,
      context: mockContext,
      updateChecksums: false
    });
    assert.strictEqual(res2.success, true, 'Idempotent re-installation must succeed');
    const updatedHtml = fs.readFileSync(wbHtmlPath, 'utf8');
    const tagMatches = updatedHtml.match(new RegExp(TAG_START, 'g')) || [];
    assert.strictEqual(tagMatches.length, 1, 'Exactly one script tag block should exist after update');
    assert.ok(updatedHtml.includes('autoplan-dom-bridge.js?v=1740900000999'), 'Updated timestamp must be present');

    console.log('  -> Passed: Injection, sidecar synchronization, and idempotency verified.');

    // ----------------------------------------------------------------------
    // Test 5: Uninstallation, Restoration & Cleanup
    // ----------------------------------------------------------------------
    console.log('\n[Test 5] Verifying uninstallation, original restoration, and backup cleanup...');
    const uninstRes = uninstallBridgeScript({
      workbenchPath: wbHtmlPath,
      updateChecksums: false
    });
    assert.strictEqual(uninstRes.success, true, 'Uninstallation must succeed');

    const restoredHtml = fs.readFileSync(wbHtmlPath, 'utf8');
    assert.strictEqual(restoredHtml.includes(TAG_START), false, 'Restored HTML must not have TAG_START');
    assert.strictEqual(restoredHtml.includes(TAG_END), false, 'Restored HTML must not have TAG_END');
    assert.strictEqual(restoredHtml.trim(), initialHtml.trim(), 'Restored HTML must match original HTML');

    assert.strictEqual(fs.existsSync(backupFile), false, 'Backup file should be cleaned up on uninstallation');
    assert.strictEqual(fs.existsSync(syncedScript), false, 'Sidecar script should be deleted on uninstallation');
    console.log('  -> Passed: Clean uninstallation, full restoration, and resource cleanup verified.');

    // ----------------------------------------------------------------------
    // Test 6: Checksum Calculation & Multi-Platform product.json Update
    // ----------------------------------------------------------------------
    console.log('\n[Test 6] Verifying SHA-256 base64 checksum updates across relative path structures...');
    
    // Checksum format verification (base64 with stripped '=')
    const sampleData = '<html><body>Checksum Test</body></html>';
    const computedHash = computeSha256Base64(sampleData);
    assert.strictEqual(typeof computedHash, 'string', 'Hash should be a string');
    assert.ok(!computedHash.endsWith('='), 'Hash must strip trailing = according to VS Code format');

    // Setup product.json mock app
    const appDir = path.join(tempDir, 'checksum_app');
    const outDir = path.join(appDir, 'out', 'vs', 'code', 'electron-sandbox', 'workbench');
    fs.mkdirSync(outDir, { recursive: true });

    const targetWb = path.join(outDir, 'workbench.html');
    fs.writeFileSync(targetWb, '<!DOCTYPE html><html><body>Checksum WB Content</body></html>', 'utf8');

    const productJsonPath = path.join(appDir, 'product.json');
    const initialProduct = {
      nameShort: 'Antigravity IDE',
      version: '1.90.0',
      checksums: {
        'vs/code/electron-sandbox/workbench/workbench.html': 'OUTDATED_HASH_VALUE_12345',
        'vs/workbench/workbench.main.css': 'OTHER_HASH'
      }
    };
    fs.writeFileSync(productJsonPath, JSON.stringify(initialProduct, null, '\t'), 'utf8');

    const updateRes = updateProductChecksums(targetWb);
    assert.strictEqual(updateRes, true, 'updateProductChecksums should return true');

    const updatedProduct = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
    const expectedWbHash = computeSha256Base64(fs.readFileSync(targetWb));
    assert.strictEqual(
      updatedProduct.checksums['vs/code/electron-sandbox/workbench/workbench.html'],
      expectedWbHash,
      'product.json checksum must be updated to match workbench.html SHA256'
    );
    assert.strictEqual(
      updatedProduct.checksums['vs/workbench/workbench.main.css'],
      'OTHER_HASH',
      'Untouched checksum keys must be preserved'
    );
    assert.strictEqual(updatedProduct.nameShort, 'Antigravity IDE', 'Product properties must be preserved');
    console.log('  -> Passed: Product checksum recalculation and JSON formatting verified.');

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 02 CROSS-PLATFORM TESTS PASSED!');
  console.log('======================================================\n');
}

runPhase02Tests();
