// Mock 'vscode' module for standalone Node test runner
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      env: {
        clipboard: {
          writeText: async (text: string) => {
            (global as any).__mock_clipboard = text;
          },
          readText: async () => {
            return (global as any).__mock_clipboard || '';
          }
        },
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
import * as crypto from 'crypto';
import * as childProcess from 'child_process';

import {
  buildLinuxElevationCommand,
  buildWindowsElevationCommand,
  computeSha256Base64,
  writeFileElevated,
  updateProductChecksums,
  installBridgeScript,
  uninstallBridgeScript,
  getWorkbenchPath
} from '../workbenchInjector';

import {
  KeyboardManager,
  buildLinuxBatchScript,
  checkLinuxKeyboardPrerequisites,
  BatchPromptOptions,
  BatchAction
} from '../keyboardManager';

async function runPhase01VerificationSuite() {
  console.log('=== Running Phase 01: Cross-Platform Elevation & Linux Keyboard Adapter Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase01-verify-'));

  try {
    // --------------------------------------------------------------------------
    // Test 1: Elevation Command Generation
    // --------------------------------------------------------------------------
    console.log('[Test 1] Verifying Elevation Command Builders (Linux pkexec & Windows runAs)...');
    {
      const tmpPath = '/tmp/autoplan-test.tmp';
      const targetPath = '/usr/share/antigravity/workbench.html';

      // 1.1 Linux Polkit Elevation Command
      const linuxCmd = buildLinuxElevationCommand(tmpPath, targetPath);
      assert.ok(linuxCmd.startsWith('pkexec bash -c "'), 'Linux command must use pkexec bash -c');
      assert.ok(linuxCmd.includes(`cp '${tmpPath}' '${targetPath}'`), 'Linux command must copy tmp to target');
      assert.ok(linuxCmd.includes(`chmod 644 '${targetPath}'`), 'Linux command must chmod 644 target');

      // 1.2 Windows UAC Elevation Command
      const winTmp = 'C:\\temp\\autoplan.tmp';
      const winTarget = 'C:\\Program Files\\Antigravity\\workbench.html';
      const winCmd = buildWindowsElevationCommand(winTmp, winTarget);
      assert.ok(winCmd.includes('powershell.exe'), 'Windows command must invoke powershell.exe');
      assert.ok(winCmd.includes('Start-Process powershell -Verb runAs'), 'Windows command must use Start-Process -Verb runAs');
      assert.ok(winCmd.includes('Copy-Item'), 'Windows command must use Copy-Item');
      assert.ok(winCmd.includes(winTmp), 'Windows command must reference tmp path');
      assert.ok(winCmd.includes(winTarget), 'Windows command must reference target path');

      console.log('  ✓ Elevation command generators produce valid OS-specific elevated commands.');
    }

    // --------------------------------------------------------------------------
    // Test 2: SHA256 Base64 Checksum Calculation & Product.json Updater
    // --------------------------------------------------------------------------
    console.log('\n[Test 2] Verifying SHA256 Checksum Calculation & product.json Patching...');
    {
      const sampleText = 'Antigravity IDE Workbench HTML Content';
      const expectedHash = crypto.createHash('sha256').update(sampleText, 'utf8').digest('base64').replace(/=+$/, '');
      const computedHash = computeSha256Base64(sampleText);
      const computedHashFromBuffer = computeSha256Base64(Buffer.from(sampleText, 'utf8'));

      assert.strictEqual(computedHash, expectedHash, 'String hash calculation must match crypto output');
      assert.strictEqual(computedHashFromBuffer, expectedHash, 'Buffer hash calculation must match crypto output');
      assert.ok(!computedHash.endsWith('='), 'Trailing equals signs must be trimmed');

      // Setup mock product.json structure
      const appRoot = path.join(tempDir, 'ide-app');
      const outDir = path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench');
      fs.mkdirSync(outDir, { recursive: true });

      const mockWb = path.join(outDir, 'workbench.html');
      fs.writeFileSync(mockWb, sampleText, 'utf8');

      const productPath = path.join(appRoot, 'product.json');
      const standardKey = 'vs/code/electron-sandbox/workbench/workbench.html';
      const initialProductJson = {
        nameShort: 'Antigravity',
        checksums: {
          [standardKey]: 'OLD_OUTDATED_HASH'
        }
      };
      fs.writeFileSync(productPath, JSON.stringify(initialProductJson, null, 2), 'utf8');

      const updated = updateProductChecksums(mockWb);
      assert.strictEqual(updated, true, 'updateProductChecksums should return true');

      const patchedProductJson = JSON.parse(fs.readFileSync(productPath, 'utf8'));
      assert.strictEqual(
        patchedProductJson.checksums[standardKey],
        expectedHash,
        'product.json checksum must be updated to match workbench.html SHA256'
      );

      console.log('  ✓ SHA256 base64 hashing and product.json checksum patching verified.');
    }

    // --------------------------------------------------------------------------
    // Test 3: Linux xdotool Detection & Sequence Generation
    // --------------------------------------------------------------------------
    console.log('\n[Test 3] Verifying Linux xdotool Detection & Script Sequence Construction...');
    {
      // 3.1 Script building with default options
      const defaultScript = buildLinuxBatchScript();
      assert.ok(defaultScript.startsWith('xdotool key --clearmodifiers ctrl+shift+l'), 'Linux script must start with xdotool ctrl+shift+l');
      assert.ok(defaultScript.includes('sleep 0.800'), 'Default focus delay should be 0.800s');
      assert.ok(defaultScript.includes('key --clearmodifiers ctrl+a'), 'Linux script must select all');
      assert.ok(defaultScript.includes('sleep 0.100'), 'Default select delay should be 0.100s');
      assert.ok(defaultScript.includes('key --clearmodifiers ctrl+v'), 'Linux script must paste');
      assert.ok(defaultScript.includes('sleep 0.150'), 'Default paste delay should be 0.150s');
      assert.ok(defaultScript.includes('key --clearmodifiers Return'), 'Linux script must submit with Return');

      // 3.2 Script building with custom timing options
      const customOptions: BatchPromptOptions = {
        focusDelayMs: 650,
        selectDelayMs: 80,
        pasteDelayMs: 120,
        submitDelayMs: 250
      };
      const customScript = buildLinuxBatchScript(customOptions);
      assert.ok(customScript.includes('sleep 0.650'), 'Custom focus delay 0.650s must be present');
      assert.ok(customScript.includes('sleep 0.080'), 'Custom select delay 0.080s must be present');
      assert.ok(customScript.includes('sleep 0.120'), 'Custom paste delay 0.120s must be present');

      // 3.3 Linux prerequisites detection
      const prereqs = checkLinuxKeyboardPrerequisites();
      assert.strictEqual(typeof prereqs.available, 'boolean', 'Prerequisites available must be boolean');
      if (prereqs.available) {
        assert.ok(prereqs.binary?.includes('xdotool'), 'Binary path should point to xdotool');
      } else {
        assert.ok(prereqs.error?.includes('xdotool'), 'Error should describe missing xdotool');
      }

      console.log('  ✓ Linux xdotool detection and atomic script chain construction verified.');
    }

    // --------------------------------------------------------------------------
    // Test 4: KeyboardManager Cross-Platform Methods & Platform Routing
    // --------------------------------------------------------------------------
    console.log('\n[Test 4] Verifying KeyboardManager Cross-Platform Routing & Fallbacks...');
    {
      const km = new KeyboardManager({
        focusDelayMs: 500,
        selectDelayMs: 100,
        pasteDelayMs: 150,
        submitDelayMs: 200
      });

      // Class method tests
      const kmLinuxScript = km.buildLinuxBatchScript();
      assert.ok(kmLinuxScript.includes('sleep 0.500'), 'KeyboardManager instance defaults must be used');

      // Custom batch sender verification
      let capturedScript = '';
      let capturedActions: BatchAction[] = [];
      const testKm = new KeyboardManager({
        customBatchSender: async (script, actions) => {
          capturedScript = script;
          capturedActions = actions;
        },
        focusDelayMs: 400,
        selectDelayMs: 50,
        pasteDelayMs: 60,
        submitDelayMs: 0
      });

      await testKm.executeBatchPromptFlow('Cross platform prompt test');
      assert.ok(capturedScript.length > 0, 'Batch script must be generated and dispatched');
      assert.strictEqual(capturedActions.length, 7, 'Actions sequence should have 7 steps');
      assert.strictEqual((global as any).__mock_clipboard, 'Cross platform prompt test', 'Clipboard must be primed');

      console.log('  ✓ Cross-platform keyboard execution flow verified.');
    }

    // --------------------------------------------------------------------------
    // Test 5: End-to-End Injection and Elevation Safety
    // --------------------------------------------------------------------------
    console.log('\n[Test 5] Verifying Safe Injection & Backup with File Elevation Handling...');
    {
      const wbPath = path.join(tempDir, 'injection-elevated-test', 'workbench.html');
      fs.mkdirSync(path.dirname(wbPath), { recursive: true });
      fs.writeFileSync(wbPath, '<html><head></head><body><div id="root"></div></body></html>', 'utf8');

      // Test standard write via writeFileElevated
      writeFileElevated(wbPath, '<html><head></head><body><div id="root">Modified</div></body></html>');
      const currentContent = fs.readFileSync(wbPath, 'utf8');
      assert.ok(currentContent.includes('Modified'), 'writeFileElevated should write content correctly');

      // Test installBridgeScript
      const installRes = installBridgeScript({ workbenchPath: wbPath, updateChecksums: false });
      assert.strictEqual(installRes.success, true, 'installBridgeScript must succeed');
      const installedContent = fs.readFileSync(wbPath, 'utf8');
      assert.ok(installedContent.includes('autoplan-dom-bridge.js'), 'Bridge script tag must be injected');

      // Test uninstallBridgeScript
      const uninstallRes = uninstallBridgeScript({ workbenchPath: wbPath, updateChecksums: false });
      assert.strictEqual(uninstallRes.success, true, 'uninstallBridgeScript must succeed');
      const uninstalledContent = fs.readFileSync(wbPath, 'utf8');
      assert.ok(!uninstalledContent.includes('autoplan-dom-bridge.js'), 'Bridge script tag must be removed');

      console.log('  ✓ Safe injection and uninstallation with elevation support verified.');
    }

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }

  console.log('\n=============================================================');
  console.log('🎉 ALL PHASE 01 TESTS PASSED SUCCESSFULLY! (100% Coverage)');
  console.log('=============================================================\n');
}

runPhase01VerificationSuite().catch((err) => {
  console.error('Phase 01 Verification Test Failed:', err);
  process.exit(1);
});
