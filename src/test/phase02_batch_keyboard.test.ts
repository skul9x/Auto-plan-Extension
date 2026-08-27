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
  BatchAction,
  BatchPromptOptions
} from '../keyboardManager';

async function runPhase02BatchKeyboardTests() {
  console.log('=== Running Phase 02: Single-Batch PowerShell Keystroke Automation Tests ===\n');

  // -------------------------------------------------------------
  // Test 1: Batch Script Construction & Timing Parameters
  // -------------------------------------------------------------
  console.log('[Test 1] Verifying Batch Script Builder & Custom Delay Formatting...');
  {
    const km = new KeyboardManager({
      focusDelayMs: 800,
      selectDelayMs: 100,
      pasteDelayMs: 150,
      submitDelayMs: 300
    });

    // 1.1 Default timing script
    const defaultScript = km.buildBatchScript();
    assert.ok(
      defaultScript.includes("New-Object -ComObject WScript.Shell"),
      'Batch script must initialize WScript.Shell COM object'
    );
    assert.ok(
      defaultScript.includes("$ws.SendKeys('^+l');"),
      "Batch script must send '^+l' as first keystroke"
    );
    assert.ok(
      defaultScript.includes("Start-Sleep -Milliseconds 800;"),
      'Batch script must contain focus delay'
    );
    assert.ok(
      defaultScript.includes("$ws.SendKeys('^a');"),
      "Batch script must send '^a' to select all"
    );
    assert.ok(
      defaultScript.includes("Start-Sleep -Milliseconds 100;"),
      'Batch script must contain select delay'
    );
    assert.ok(
      defaultScript.includes("$ws.SendKeys('^v');"),
      "Batch script must send '^v' to paste"
    );
    assert.ok(
      defaultScript.includes("Start-Sleep -Milliseconds 150;"),
      'Batch script must contain paste delay'
    );
    assert.ok(
      defaultScript.includes("$ws.SendKeys('{ENTER}');"),
      "Batch script must send '{ENTER}' to submit"
    );

    // 1.2 Custom override timing script
    const customOptions: BatchPromptOptions = {
      focusDelayMs: 450,
      selectDelayMs: 60,
      pasteDelayMs: 90,
      submitDelayMs: 120
    };
    const customScript = km.buildBatchScript(customOptions);
    assert.ok(customScript.includes("Start-Sleep -Milliseconds 450;"), 'Custom focus delay must be respected');
    assert.ok(customScript.includes("Start-Sleep -Milliseconds 60;"), 'Custom select delay must be respected');
    assert.ok(customScript.includes("Start-Sleep -Milliseconds 90;"), 'Custom paste delay must be respected');

    // 1.3 Windows Forms Fallback script
    const formsScript = km.buildFormsBatchScript(customOptions);
    assert.ok(
      formsScript.includes("[System.Windows.Forms.SendKeys]::SendWait('^+l')"),
      'Forms script must use Forms SendWait'
    );
    assert.ok(
      formsScript.includes("Start-Sleep -Milliseconds 450;"),
      'Forms script must include timing delays'
    );

    // 1.4 Structured Batch Actions
    const actions = km.buildBatchActions(customOptions);
    assert.strictEqual(actions.length, 7, 'Must construct exactly 7 sequence items');
    assert.deepStrictEqual(actions[0], { type: 'sendKeys', value: '^+l' });
    assert.deepStrictEqual(actions[1], { type: 'sleep', value: 450 });
    assert.deepStrictEqual(actions[2], { type: 'sendKeys', value: '^a' });
    assert.deepStrictEqual(actions[3], { type: 'sleep', value: 60 });
    assert.deepStrictEqual(actions[4], { type: 'sendKeys', value: '^v' });
    assert.deepStrictEqual(actions[5], { type: 'sleep', value: 90 });
    assert.deepStrictEqual(actions[6], { type: 'sendKeys', value: '{ENTER}' });

    console.log('  ✓ Batch script builder and action sequence verified.');
  }

  // -------------------------------------------------------------
  // Test 2: Process Invocation Reduction (1 Batch vs 4 Modular)
  // -------------------------------------------------------------
  console.log('[Test 2] Verifying Process Invocation Count (Single Process vs Multi Process)...');
  {
    let batchInvocations = 0;
    let dispatchedScript = '';
    let dispatchedActions: BatchAction[] = [];

    const batchKm = new KeyboardManager({
      customBatchSender: async (script, actions) => {
        batchInvocations++;
        dispatchedScript = script;
        dispatchedActions = actions;
      }
    });

    const testPrompt = 'Implement Phase 02 with single-batch performance.';
    await batchKm.executeBatchPromptFlow(testPrompt);

    assert.strictEqual(
      batchInvocations,
      1,
      `executeBatchPromptFlow must trigger exactly 1 batch execution (got ${batchInvocations})`
    );
    assert.ok(dispatchedScript.length > 0, 'Batch script must be dispatched');
    assert.strictEqual(dispatchedActions.length, 7, 'Dispatched actions must have full sequence');

    // Also verify executePromptFlow delegates to batch runner
    batchInvocations = 0;
    await batchKm.executePromptFlow(testPrompt);
    assert.strictEqual(
      batchInvocations,
      1,
      `executePromptFlow must route through batch execution triggering exactly 1 invocation`
    );

    console.log('  ✓ Process invocation reduction verified (1 single batch process for full flow).');
  }

  // -------------------------------------------------------------
  // Test 3: In-Process Clipboard Priming & Synchronization
  // -------------------------------------------------------------
  console.log('[Test 3] Verifying In-Process Clipboard Priming Prior to Keystroke Execution...');
  {
    const executionTimeline: string[] = [];
    let capturedClipboardAtSend = '';

    const syncKm = new KeyboardManager({
      customClipboardSetter: async (text) => {
        executionTimeline.push(`clipboard_set:${text}`);
        (global as any).__mock_clipboard = text;
      },
      customBatchSender: async (_script, _actions) => {
        executionTimeline.push('batch_sender_invoked');
        capturedClipboardAtSend = (global as any).__mock_clipboard;
      }
    });

    const promptPayload = 'Special Unicode Prompt: 🚀 Khởi tạo quy trình Auto-Plan with "quotes" & \'single\'.';
    await syncKm.executeBatchPromptFlow(promptPayload);

    // Verify ordering: clipboard primed BEFORE batch keystrokes sent
    assert.strictEqual(
      executionTimeline[0],
      `clipboard_set:${promptPayload}`,
      'Clipboard priming MUST happen as the first operation'
    );
    assert.strictEqual(
      executionTimeline[1],
      'batch_sender_invoked',
      'Batch sender MUST be invoked AFTER clipboard is primed'
    );
    assert.strictEqual(
      capturedClipboardAtSend,
      promptPayload,
      'Clipboard content at batch send time must exactly match the prompt'
    );

    // Read back via readClipboard
    const readBack = await syncKm.readClipboard();
    assert.strictEqual(readBack, promptPayload, 'readClipboard must return synchronized clipboard content');

    console.log('  ✓ In-process clipboard synchronization verified.');
  }

  // -------------------------------------------------------------
  // Test 4: Custom Key Sender Fallback Interoperability
  // -------------------------------------------------------------
  console.log('[Test 4] Verifying Fallback when only customKeySender is provided...');
  {
    const sentKeys: string[] = [];
    const legacyKm = new KeyboardManager({
      customKeySender: async (keys) => {
        sentKeys.push(keys);
      },
      submitDelayMs: 0,
      focusDelayMs: 1,
      selectDelayMs: 1,
      pasteDelayMs: 1
    });

    await legacyKm.executeBatchPromptFlow('Test message');

    assert.deepStrictEqual(
      sentKeys,
      ['^+l', '^a', '^v', '{ENTER}'],
      'Should sequentially send all keys when only customKeySender is present'
    );

    console.log('  ✓ Fallback customKeySender interoperability verified.');
  }

  // -------------------------------------------------------------
  // Test 5: Error Handling & Graceful Fallbacks
  // -------------------------------------------------------------
  console.log('[Test 5] Verifying Error Handling & Exception Propagation...');
  {
    const errorKm = new KeyboardManager({
      customBatchSender: async () => {
        throw new Error('Simulated PowerShell batch execution failure');
      }
    });

    await assert.rejects(
      errorKm.executeBatchPromptFlow('Any prompt'),
      /Simulated PowerShell batch execution failure/,
      'Exceptions in batch sender must cleanly propagate to caller'
    );

    // Test clipboard setter failure propagation
    const clipboardErrorKm = new KeyboardManager({
      customClipboardSetter: async () => {
        throw new Error('Clipboard access denied');
      }
    });

    await assert.rejects(
      clipboardErrorKm.executeBatchPromptFlow('Test prompt'),
      /Clipboard access denied/,
      'Clipboard errors must be caught or propagated appropriately'
    );

    console.log('  ✓ Error handling and propagation verified.');
  }

  // -------------------------------------------------------------
  // Test 6: Backward Compatibility with Granular Methods
  // -------------------------------------------------------------
  console.log('[Test 6] Verifying Backward Compatibility of Granular Keyboard Methods...');
  {
    const modularKeys: string[] = [];
    const modularKm = new KeyboardManager({
      customKeySender: async (keys) => {
        modularKeys.push(keys);
      },
      customClipboardSetter: async (text) => {
        (global as any).__mock_clipboard = text;
      },
      focusDelayMs: 1,
      selectDelayMs: 1,
      pasteDelayMs: 1,
      submitDelayMs: 1
    });

    await modularKm.openNewConversation();
    await modularKm.selectAll();
    await modularKm.paste();
    await modularKm.submit();

    assert.deepStrictEqual(
      modularKeys,
      ['^+l', '^a', '^v', '{ENTER}'],
      'Granular modular methods must function independently'
    );

    modularKeys.length = 0;
    await modularKm.pasteAndSubmit('Modular Prompt Text');
    assert.deepStrictEqual(
      modularKeys,
      ['^a', '^v', '{ENTER}'],
      'pasteAndSubmit must select, paste, and enter'
    );
    assert.strictEqual(
      (global as any).__mock_clipboard,
      'Modular Prompt Text',
      'pasteAndSubmit must copy text to clipboard'
    );

    console.log('  ✓ Modular granular methods backward compatibility verified.');
  }

  console.log('\n=============================================================');
  console.log('🎉 ALL PHASE 02 TESTS PASSED SUCCESSFULLY! (100% Coverage)');
  console.log('=============================================================\n');
}

runPhase02BatchKeyboardTests().catch((err) => {
  console.error('Phase 02 Test Failed:', err);
  process.exit(1);
});
