// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockClipboardContent = '';

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      env: {
        clipboard: {
          writeText: async (text: string) => {
            mockClipboardContent = text;
          },
          readText: async () => mockClipboardContent
        }
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import { KeyboardManager, keyboardManager } from '../keyboardManager';

async function runPhase02Tests() {
  console.log('=== Running Phase 02 Keyboard Simulation & Prompt Sender Tests ===');

  // Test 1: Default instance and option initialization
  const defaultOpts = keyboardManager.getOptions();
  assert.strictEqual(defaultOpts.focusDelayMs, 800, 'Default focus delay should be 800ms');
  assert.strictEqual(defaultOpts.selectDelayMs, 100, 'Default select delay should be 100ms');
  assert.strictEqual(defaultOpts.pasteDelayMs, 150, 'Default paste delay should be 150ms');
  assert.strictEqual(defaultOpts.submitDelayMs, 300, 'Default submit delay should be 300ms');
  console.log('✓ Test 1: Default KeyboardManager instance and timings verified');

  // Test 2: Custom timings initialization
  const customKm = new KeyboardManager({
    focusDelayMs: 400,
    selectDelayMs: 50,
    pasteDelayMs: 60,
    submitDelayMs: 70
  });
  const customOpts = customKm.getOptions();
  assert.strictEqual(customOpts.focusDelayMs, 400);
  assert.strictEqual(customOpts.selectDelayMs, 50);
  assert.strictEqual(customOpts.pasteDelayMs, 60);
  assert.strictEqual(customOpts.submitDelayMs, 70);
  console.log('✓ Test 2: Custom timing options verified');

  // Test 3: Clipboard operations (write & read)
  mockClipboardContent = '';
  await keyboardManager.copyToClipboard('Hello Antigravity Auto-Plan!');
  assert.strictEqual(mockClipboardContent, 'Hello Antigravity Auto-Plan!');
  const readBack = await keyboardManager.readClipboard();
  assert.strictEqual(readBack, 'Hello Antigravity Auto-Plan!');
  console.log('✓ Test 3: Clipboard copy & read functionality verified');

  // Test 4: Action simulation & Key sequencing tracking
  const actionLog: string[] = [];
  const senderKm = new KeyboardManager({
    focusDelayMs: 10,
    selectDelayMs: 10,
    pasteDelayMs: 10,
    submitDelayMs: 10,
    customKeySender: async (keys: string) => {
      actionLog.push(`KEY:${keys}`);
    },
    customClipboardSetter: async (text: string) => {
      actionLog.push(`CLIPBOARD:${text}`);
    }
  });

  // Test individual methods
  await senderKm.openNewConversation();
  assert.deepStrictEqual(actionLog, ['KEY:^+l']);
  actionLog.length = 0;

  await senderKm.selectAll();
  assert.deepStrictEqual(actionLog, ['KEY:^a']);
  actionLog.length = 0;

  await senderKm.paste();
  assert.deepStrictEqual(actionLog, ['KEY:^v']);
  actionLog.length = 0;

  await senderKm.submit();
  assert.deepStrictEqual(actionLog, ['KEY:{ENTER}']);
  actionLog.length = 0;
  console.log('✓ Test 4: Individual key events (Ctrl+Shift+L, Ctrl+A, Ctrl+V, Enter) verified');

  // Test 5: pasteAndSubmit composite flow
  const samplePrompt = 'Hãy trả lời tôi với câu trả lời là "Done skul9x.", ngoài ra không nói gì thêm';
  await senderKm.pasteAndSubmit(samplePrompt);
  assert.deepStrictEqual(actionLog, [
    `CLIPBOARD:${samplePrompt}`,
    'KEY:^a',
    'KEY:^v',
    'KEY:{ENTER}'
  ]);
  actionLog.length = 0;
  console.log('✓ Test 5: pasteAndSubmit compound sequence verified');

  // Test 6: Full executePromptFlow sequence
  await senderKm.executePromptFlow(samplePrompt);
  assert.deepStrictEqual(actionLog, [
    `CLIPBOARD:${samplePrompt}`, // 1. Copy prompt to clipboard (batch primed first)
    'KEY:^+l',                   // 2. Open conversation
    'KEY:^a',                    // 3. Select all
    'KEY:^v',                    // 4. Paste
    'KEY:{ENTER}'                // 5. Submit
  ]);
  console.log('✓ Test 6: Full executePromptFlow end-to-end sequence verified');

  // Test 7: Real system SendKeys & PowerShell command execution verification
  if (process.platform === 'win32') {
    const realKm = new KeyboardManager({
      focusDelayMs: 50,
      selectDelayMs: 10,
      pasteDelayMs: 10,
      submitDelayMs: 10
    });
    // Send a harmless key (F15 or shift key release) to verify PowerShell Forms SendKeys executes without throwing
    await realKm.sendKeys('+');
    console.log('✓ Test 7: Windows PowerShell SendKeys platform execution verified');
  }

  console.log('\n=== All Phase 02 Tests Passed Successfully! ===');
}

runPhase02Tests().catch((err) => {
  console.error('Phase 02 Test Failed:', err);
  process.exit(1);
});
