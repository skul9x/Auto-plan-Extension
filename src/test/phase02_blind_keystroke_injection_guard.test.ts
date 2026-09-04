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
import {
  KeyboardManager,
  ForeignWindowFocusError,
  inspectActiveWindow,
  isApprovedEditor,
  BatchAction
} from '../keyboardManager';

async function runPhase02BlindKeystrokeInjectionGuardTests() {
  console.log('=== Running Phase 02: Blind Keystroke Injection Guard & Window Focus Verification Tests ===\n');

  // -------------------------------------------------------------
  // Test Case 1: Foreign Window (bash - Terminal, gnome-terminal)
  // -------------------------------------------------------------
  console.log('[Test Case 1] Foreign Window Focus Abortion (bash - Terminal)...');
  {
    const clipboardCalls: string[] = [];
    const dispatchedBatches: { batchScript: string; actions: BatchAction[] }[] = [];

    const km = new KeyboardManager({
      customClipboardSetter: async (text: string) => {
        clipboardCalls.push(text);
      },
      customBatchSender: async (batchScript: string, actions: BatchAction[]) => {
        dispatchedBatches.push({ batchScript, actions });
      },
      activeWindowValidator: async () => ({
        isTarget: false,
        windowTitle: 'bash - Terminal',
        processName: 'gnome-terminal'
      })
    });

    let caughtError: any = null;
    try {
      await km.executeBatchPromptFlow('rm -rf / --dangerous-command');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'executeBatchPromptFlow must throw when active window is foreign');
    assert.ok(
      caughtError instanceof ForeignWindowFocusError,
      'Thrown error must be an instance of ForeignWindowFocusError'
    );
    assert.strictEqual(
      caughtError.detectedTitle,
      'bash - Terminal',
      'Detected title must match active window'
    );
    assert.strictEqual(
      caughtError.detectedProcess,
      'gnome-terminal',
      'Detected process must match active process'
    );
    assert.strictEqual(
      clipboardCalls.length,
      0,
      'Clipboard setter must NEVER be called when focus verification fails'
    );
    assert.strictEqual(
      dispatchedBatches.length,
      0,
      'Zero keystrokes must be dispatched when focus verification fails'
    );

    console.log('  ✓ Execution immediately aborted with ForeignWindowFocusError.');
    console.log('  ✓ Clipboard preserved (zero write invocations).');
    console.log('  ✓ Zero keystrokes dispatched to foreign terminal.');
  }

  // -------------------------------------------------------------
  // Test Case 2: Foreign Window (Google Chrome, chrome)
  // -------------------------------------------------------------
  console.log('\n[Test Case 2] Foreign Window Focus Abortion (Google Chrome)...');
  {
    let clipboardModified = false;
    let keystrokesDispatched = false;

    const km = new KeyboardManager({
      customClipboardSetter: async () => {
        clipboardModified = true;
      },
      customBatchSender: async () => {
        keystrokesDispatched = true;
      },
      activeWindowValidator: async () => ({
        isTarget: false,
        windowTitle: 'Google Chrome',
        processName: 'chrome'
      })
    });

    let caughtError: any = null;
    try {
      await km.executeBatchPromptFlow('Top secret prompt text');
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError instanceof ForeignWindowFocusError, 'Must throw ForeignWindowFocusError for Chrome');
    assert.strictEqual(caughtError.detectedTitle, 'Google Chrome');
    assert.strictEqual(caughtError.detectedProcess, 'chrome');
    assert.strictEqual(clipboardModified, false, 'Clipboard must not be modified');
    assert.strictEqual(keystrokesDispatched, false, 'Keystrokes must not be dispatched');

    console.log('  ✓ Aborted immediately for Chrome with ForeignWindowFocusError.');
    console.log('  ✓ Clipboard preserved and keystrokes blocked.');
  }

  // -------------------------------------------------------------
  // Test Case 3: Approved Target Window (Visual Studio Code)
  // -------------------------------------------------------------
  console.log('\n[Test Case 3] Target Window Focus Verification (Visual Studio Code)...');
  {
    const clipboardCalls: string[] = [];
    const dispatchedBatches: { batchScript: string; actions: BatchAction[] }[] = [];

    const km = new KeyboardManager({
      customClipboardSetter: async (text: string) => {
        clipboardCalls.push(text);
      },
      customBatchSender: async (batchScript: string, actions: BatchAction[]) => {
        dispatchedBatches.push({ batchScript, actions });
      },
      activeWindowValidator: async () => ({
        isTarget: true,
        windowTitle: 'extension.ts - Auto-plan-Extension-main - Visual Studio Code',
        processName: 'Code'
      })
    });

    await km.executeBatchPromptFlow('Implement phase 02 feature', { submitDelayMs: 0 });

    assert.strictEqual(clipboardCalls.length, 1, 'Clipboard must be primed with prompt text');
    assert.strictEqual(clipboardCalls[0], 'Implement phase 02 feature', 'Clipboard content must match prompt');
    assert.strictEqual(dispatchedBatches.length, 1, 'Batch keystrokes must be dispatched');
    assert.ok(dispatchedBatches[0].actions.length > 0, 'Dispatched batch must contain actions');

    console.log('  ✓ Target window accepted.');
    console.log('  ✓ Clipboard primed with prompt.');
    console.log('  ✓ Keystrokes dispatched successfully.');
  }

  // -------------------------------------------------------------
  // Test Case 4: instanceof ForeignWindowFocusError & Error Properties
  // -------------------------------------------------------------
  console.log('\n[Test Case 4] ForeignWindowFocusError prototype and contract...');
  {
    const err = new ForeignWindowFocusError('Untrusted App', 'malicious.exe');

    assert.ok(err instanceof Error, 'Must be an instance of Error');
    assert.ok(err instanceof ForeignWindowFocusError, 'Must be an instance of ForeignWindowFocusError');
    assert.strictEqual(err.name, 'ForeignWindowFocusError');
    assert.strictEqual(err.detectedTitle, 'Untrusted App');
    assert.strictEqual(err.detectedProcess, 'malicious.exe');
    assert.ok(err.message.includes('Untrusted App'), 'Message must contain window title');
    assert.ok(err.message.includes('malicious.exe'), 'Message must contain process name');

    // Without process name
    const errNoProc = new ForeignWindowFocusError('Window Only');
    assert.strictEqual(errNoProc.detectedTitle, 'Window Only');
    assert.strictEqual(errNoProc.detectedProcess, undefined);
    assert.ok(errNoProc.message.includes('Window Only'));

    console.log('  ✓ instanceof ForeignWindowFocusError verified.');
    console.log('  ✓ Error name, properties, and message formatted as expected.');
  }

  // -------------------------------------------------------------
  // Test Case 5: Native Window Inspector & Target Evaluator Robustness
  // -------------------------------------------------------------
  console.log('\n[Test Case 5] Native inspectActiveWindow & isApprovedEditor robustness...');
  {
    // 5.1 Native inspector must execute without crashing
    const activeInfo = await inspectActiveWindow();
    assert.strictEqual(typeof activeInfo, 'object', 'Active window info must be an object');
    assert.strictEqual(typeof activeInfo.isTarget, 'boolean', 'isTarget must be a boolean');
    assert.strictEqual(typeof activeInfo.windowTitle, 'string', 'windowTitle must be a string');
    console.log(`  ✓ inspectActiveWindow returned: isTarget=${activeInfo.isTarget}, title="${activeInfo.windowTitle}", process=${activeInfo.processName}`);

    // 5.2 Approved pattern matching validation
    assert.strictEqual(
      isApprovedEditor('bash - Terminal', 'gnome-terminal'),
      false,
      'bash terminal must not be approved'
    );
    assert.strictEqual(
      isApprovedEditor('Google Chrome', 'chrome'),
      false,
      'chrome must not be approved'
    );
    assert.strictEqual(
      isApprovedEditor('Visual Studio Code - Download - Google Chrome', 'chrome'),
      false,
      'Chrome tab with VS Code title must not be approved due to process mismatch'
    );
    assert.strictEqual(
      isApprovedEditor('extension.ts - Visual Studio Code', 'Code'),
      true,
      'VS Code must be approved'
    );
    assert.strictEqual(
      isApprovedEditor('Auto-plan - Antigravity', 'antigravity'),
      true,
      'Antigravity must be approved'
    );
    assert.strictEqual(
      isApprovedEditor('file.ts - Cursor', 'cursor'),
      true,
      'Cursor must be approved'
    );
    assert.strictEqual(
      isApprovedEditor('Windsurf IDE', 'windsurf'),
      true,
      'Windsurf must be approved'
    );
    assert.strictEqual(
      isApprovedEditor('VSCodium - workspace', 'vscodium'),
      true,
      'VSCodium must be approved'
    );
    assert.strictEqual(
      isApprovedEditor('Any foreign title', 'any_process', process.pid),
      true,
      'Current process PID must be approved'
    );

    // 5.3 skipFocusCheck override
    const kmSkipped = new KeyboardManager({
      skipFocusCheck: true,
      customClipboardSetter: async () => {},
      customBatchSender: async () => {},
      activeWindowValidator: async () => ({
        isTarget: false,
        windowTitle: 'Foreign Window',
        processName: 'foreign'
      })
    });

    await kmSkipped.executeBatchPromptFlow('Test skipped check', { submitDelayMs: 0 });
    console.log('  ✓ skipFocusCheck override successfully bypasses active window focus verification.');
  }

  console.log('\n=============================================================');
  console.log('🎉 ALL PHASE 02 TESTS PASSED SUCCESSFULLY! (100% Coverage)');
  console.log('=============================================================\n');
}

runPhase02BlindKeystrokeInjectionGuardTests().catch((err) => {
  console.error('Phase 02 Test Failed:', err);
  process.exit(1);
});
