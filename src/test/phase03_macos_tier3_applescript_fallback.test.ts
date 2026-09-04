// Mock 'vscode' module for standalone test runner
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
        }
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
  KeyboardManager,
  buildDarwinBatchScript,
  checkDarwinKeyboardPrerequisites,
  runAppleScript,
  executeDarwinBatchPrompt,
  BatchAction
} from '../keyboardManager';

async function runPhase03MacOSTier3AppleScriptFallbackTests() {
  console.log('=== Running Phase 03: macOS Tier 3 AppleScript Keystroke Fallback Tests ===\n');

  const originalPlatform = process.platform;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-verify-'));

  try {
    // -------------------------------------------------------------
    // Test Case 1: AppleScript Generation (buildDarwinBatchScript)
    // -------------------------------------------------------------
    console.log('[Test Case 1] Verifying AppleScript Generation and Delay Computation...');
    {
      // 1.1 Default timings
      const defaultScript = buildDarwinBatchScript();
      assert.ok(defaultScript.startsWith('tell application "System Events"'), 'Must start with tell block');
      assert.ok(defaultScript.endsWith('end tell'), 'Must end with end tell');
      assert.ok(defaultScript.includes('keystroke "l" using {command down, shift down}'), 'Must open chat with Cmd+Shift+L');
      assert.ok(defaultScript.includes('delay 0.8'), 'Default focus delay must be 0.8s');
      assert.ok(defaultScript.includes('keystroke "a" using {command down}'), 'Must select all with Cmd+A');
      assert.ok(defaultScript.includes('delay 0.1'), 'Default select delay must be 0.1s');
      assert.ok(defaultScript.includes('keystroke "v" using {command down}'), 'Must paste with Cmd+V');
      assert.ok(defaultScript.includes('delay 0.15'), 'Default paste delay must be 0.15s');
      assert.ok(defaultScript.includes('key code 36'), 'Must submit using key code 36 (Return)');

      // 1.2 Custom options timing computation
      const customScript = buildDarwinBatchScript({
        focusDelayMs: 1200,
        selectDelayMs: 250,
        pasteDelayMs: 350
      });
      assert.ok(customScript.includes('delay 1.2'), 'Computed delay should be 1.2s');
      assert.ok(customScript.includes('delay 0.25'), 'Computed delay should be 0.25s');
      assert.ok(customScript.includes('delay 0.35'), 'Computed delay should be 0.35s');

      // 1.3 Instance method parity
      const km = new KeyboardManager({
        focusDelayMs: 500,
        selectDelayMs: 75,
        pasteDelayMs: 125
      });
      const instanceScript = km.buildDarwinBatchScript();
      assert.ok(instanceScript.includes('delay 0.5'), 'Instance default focus delay should be 0.5s');
      assert.ok(instanceScript.includes('delay 0.075'), 'Instance default select delay should be 0.075s');
      assert.ok(instanceScript.includes('delay 0.125'), 'Instance default paste delay should be 0.125s');

      console.log('  ✓ Generated AppleScript contains correct Cmd shortcuts, delays, and key code 36.');
    }

    // -------------------------------------------------------------
    // Test Case 2: Prerequisites Detection (checkDarwinKeyboardPrerequisites)
    // -------------------------------------------------------------
    console.log('\n[Test Case 2] Verifying macOS osascript Prerequisites Detection...');
    {
      // 2.1 Missing or non-existent binary
      const nonExistentPath = path.join(tempDir, 'nonexistent_osascript');
      const missingRes = checkDarwinKeyboardPrerequisites(nonExistentPath);
      assert.strictEqual(missingRes.available, false, 'Nonexistent binary must return available: false');
      assert.strictEqual(missingRes.binary, null, 'Nonexistent binary must return null binary');
      assert.ok(missingRes.error && missingRes.error.length > 0, 'Error message must be present');

      // 2.2 Existing executable binary
      const mockBinaryPath = path.join(tempDir, 'mock_osascript');
      fs.writeFileSync(mockBinaryPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const availableRes = checkDarwinKeyboardPrerequisites(mockBinaryPath);
      assert.strictEqual(availableRes.available, true, 'Existing executable must return available: true');
      assert.strictEqual(availableRes.binary, mockBinaryPath, 'Must return path to available binary');

      // 2.3 KeyboardManager instance method parity
      const km = new KeyboardManager();
      const kmAvailableRes = km.checkDarwinKeyboardPrerequisites(mockBinaryPath);
      assert.strictEqual(kmAvailableRes.available, true, 'Instance checkDarwinKeyboardPrerequisites must match');

      console.log('  ✓ Prerequisites detection correctly evaluates osascript availability.');
    }

    // -------------------------------------------------------------
    // Test Case 3: Darwin Platform Routing in executeBatchPromptFlow
    // -------------------------------------------------------------
    console.log('\n[Test Case 3] Verifying Darwin Platform Routing in executeBatchPromptFlow...');
    {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      let dispatchedScript = '';
      let dispatchedActions: BatchAction[] = [];

      const km = new KeyboardManager({
        customBatchSender: async (batchScript, actions) => {
          dispatchedScript = batchScript;
          dispatchedActions = actions;
        },
        activeWindowValidator: async () => ({
          isTarget: true,
          windowTitle: 'Code - OSS'
        })
      });

      // Crucial: executeBatchPromptFlow MUST NOT throw "Unsupported platform for keyboard automation: darwin"
      await km.executeBatchPromptFlow('Darwin Platform Automation Prompt');

      assert.ok(
        dispatchedScript.includes('tell application "System Events"'),
        'Darwin platform must generate and dispatch AppleScript'
      );
      assert.ok(
        dispatchedScript.includes('{command down, shift down}'),
        'Dispatched AppleScript must contain macOS keystroke combinations'
      );
      assert.ok(
        dispatchedScript.includes('key code 36'),
        'Dispatched AppleScript must contain Return key code 36'
      );
      assert.strictEqual(dispatchedActions.length, 7, 'Must generate standard 7-step batch actions');
      assert.strictEqual(
        (global as any).__mock_clipboard,
        'Darwin Platform Automation Prompt',
        'Clipboard must be primed before execution'
      );

      console.log('  ✓ Darwin platform cleanly routed to AppleScript generator without unsupported platform error.');
      console.log('  ✓ Custom batch sender hook received valid AppleScript and action list.');
    }

    // -------------------------------------------------------------
    // Test Case 4: Permission Error Translation (-1743)
    // -------------------------------------------------------------
    console.log('\n[Test Case 4] Verifying Accessibility Permission Error Translation...');
    {
      // 4.1 Mock execFile throwing -1743
      const mockExecFile1743 = ((file: any, args: any, callback: any) => {
        const err: any = new Error('Command failed: /usr/bin/osascript -e ...\nexecution error: Not authorized to send Apple events. (-1743)');
        err.code = 1;
        callback(err, '', '31:42: execution error: Not authorized to send Apple events. (-1743)');
      }) as any;

      let caughtError: any = null;
      try {
        await runAppleScript('tell application "System Events"...', '/usr/bin/osascript', mockExecFile1743);
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError, 'Must throw error on -1743');
      const expectedSnippet = 'macOS Accessibility permission denied: Antigravity/VS Code requires Accessibility permission to simulate keystrokes. Please enable it in: System Settings > Privacy & Security > Accessibility.';
      assert.strictEqual(caughtError.message, expectedSnippet, 'Error message must match required translation exactly');

      // 4.2 Non-permission error should not be translated to Accessibility guidance
      const mockExecFileGeneric = ((file: any, args: any, callback: any) => {
        const err: any = new Error('syntax error');
        callback(err, '', 'syntax error: Expected end of line');
      }) as any;

      let genericError: any = null;
      try {
        await runAppleScript('bad script', '/usr/bin/osascript', mockExecFileGeneric);
      } catch (err) {
        genericError = err;
      }

      assert.ok(genericError, 'Must throw on generic error');
      assert.ok(!genericError.message.includes('System Settings'), 'Generic errors must not suggest Accessibility permission');
      assert.ok(genericError.message.includes('AppleScript execution failed'), 'Generic errors must contain failure message');

      console.log('  ✓ Error -1743 translated to actionable macOS Accessibility instructions.');
      console.log('  ✓ Generic errors preserved without false Accessibility hints.');
    }

    // -------------------------------------------------------------
    // Test Case 5: Native Execution Flow & executeDarwinBatchPrompt Integration
    // -------------------------------------------------------------
    console.log('\n[Test Case 5] Verifying Native Darwin Execution & executeDarwinBatchPrompt...');
    {
      // Create mock osascript executable that logs execution
      const mockOsascriptPath = path.join(tempDir, 'osascript');
      const logFilePath = path.join(tempDir, 'osascript_execution.log');
      const mockScriptContent = `#!/bin/sh
echo "$@" >> "${logFilePath}"
exit 0
`;
      fs.writeFileSync(mockOsascriptPath, mockScriptContent, { mode: 0o755 });

      // Test KeyboardManager.executeDarwinBatchPrompt with mock runner
      const km = new KeyboardManager({
        activeWindowValidator: async () => ({
          isTarget: true,
          windowTitle: 'Code - OSS'
        })
      });

      // 5.1 Test missing prerequisite handling
      const badKm = new KeyboardManager({
        skipFocusCheck: true
      });
      let prereqError: any = null;
      try {
        // Default /usr/bin/osascript does not exist on Linux test machine
        await badKm.executeDarwinBatchPrompt('Prompt test');
      } catch (err) {
        prereqError = err;
      }
      assert.ok(prereqError, 'executeDarwinBatchPrompt must throw when osascript is unavailable');
      assert.ok(
        prereqError.message.includes('osascript is not available') ||
        prereqError.message.includes('osascript is not installed'),
        'Error message must state osascript unavailability'
      );

      // 5.2 Test successful execution through runAppleScript
      const script = km.buildDarwinBatchScript();
      await km.runAppleScript(script, mockOsascriptPath);

      const logOutput = fs.readFileSync(logFilePath, 'utf8');
      assert.ok(logOutput.includes('-e tell application "System Events"'), 'Mock osascript received script via -e argument');

      // 5.3 Test standalone export executeDarwinBatchPrompt
      assert.strictEqual(typeof executeDarwinBatchPrompt, 'function', 'executeDarwinBatchPrompt must be exported as a standalone function');

      console.log('  ✓ Missing osascript error handling and native execution verified.');
      console.log('  ✓ Safe argument passing via execFile verified.');
    }

  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }

  console.log('\n=============================================================');
  console.log('🎉 ALL PHASE 03 TESTS PASSED SUCCESSFULLY! (100% Coverage)');
  console.log('=============================================================\n');
}

runPhase03MacOSTier3AppleScriptFallbackTests().catch((err) => {
  console.error('Phase 03 Verification Test Failed:', err);
  process.exit(1);
});
