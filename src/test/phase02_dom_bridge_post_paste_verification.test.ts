// Node 18 compatibility polyfills for webidl-conversions / jsdom
if (!Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')) {
  Object.defineProperty(ArrayBuffer.prototype, 'resizable', {
    get() { return false; },
    configurable: true
  });
}
if (typeof SharedArrayBuffer !== 'undefined' && !Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'growable')) {
  Object.defineProperty(SharedArrayBuffer.prototype, 'growable', {
    get() { return false; },
    configurable: true
  });
}

// Module hook to resolve CJS parse5 and mock vscode / css-color for JSDOM in Node 18
const topParse5 = require('parse5');
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === 'vscode') {
    return {
      commands: { executeCommand: async () => undefined },
      window: { showWarningMessage: () => undefined },
      workspace: { getConfiguration: () => ({ get: (_k: string, d: any) => d }) }
    };
  }
  if (id === '@asamuzakjp/css-color') {
    return {
      resolve: (color: string) => color,
      utils: {
        cssCalc: (v: string) => v,
        resolveGradient: () => null,
        splitValue: (v: string) => [v]
      }
    };
  }
  if (id === 'parse5' || id.endsWith('/parse5') || id.includes('node_modules/parse5')) {
    return topParse5;
  }
  return origRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { JSDOM } from 'jsdom';

function loadDomBridge() {
  const candidatePaths = [
    path.resolve(__dirname, '../../media/autoplan-dom-bridge.js'),
    path.resolve(__dirname, '../media/autoplan-dom-bridge.js'),
    path.resolve(process.cwd(), 'media/autoplan-dom-bridge.js')
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return require(p);
    }
  }
  throw new Error('Could not find media/autoplan-dom-bridge.js');
}

async function runAllTests() {
  console.log('================================================================');
  console.log('🧪 Phase 02: Post-Paste Buffer Verification & Fail-Fast Rejection');
  console.log('================================================================\n');

  const domBridge = loadDomBridge();
  const {
    extractDomBufferText,
    verifyBufferHasText,
    injectPromptAndSubmit,
    findChatInput
  } = domBridge;

  let totalTests = 0;
  let passedTests = 0;

  function runTest(name: string, fn: () => void | Promise<void>) {
    totalTests++;
    try {
      const res = fn();
      if (res && typeof (res as any).then === 'function') {
        return (res as any).then(() => {
          console.log(`  ✓ ${name}`);
          passedTests++;
        }).catch((err: any) => {
          console.error(`  ✗ ${name}`);
          console.error(`    ${err?.message || err}`);
          throw err;
        });
      } else {
        console.log(`  ✓ ${name}`);
        passedTests++;
      }
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err?.message || err}`);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Suite 1: Multi-Pathway DOM Content Extraction & Cleaning
  // --------------------------------------------------------------------------
  console.log('▶ Suite 1: Multi-Pathway DOM Content Extraction & Cleaning');

  runTest('Pathway A: Extracts clean text from <textarea> via .value', () => {
    const dom = new JSDOM('<textarea id="t">Hello from textarea\nSecond line</textarea>');
    const doc = dom.window.document;
    const textarea = doc.getElementById('t') as HTMLTextAreaElement;
    assert.ok(textarea);

    const res = extractDomBufferText(textarea, { window: dom.window, document: doc });
    assert.strictEqual(res.pathway, 'input-value');
    assert.strictEqual(res.cleanText, 'Hello from textarea\nSecond line');
    assert.strictEqual(res.charsDetectedInDOM, 'Hello from textarea\nSecond line'.length);
    assert.strictEqual(res.domExcerpt, 'Hello from textarea\nSecond line');
  });

  runTest('Pathway B: Extracts clean text from ContentEditable / Lexical via textContent / innerText', () => {
    const dom = new JSDOM('<div data-lexical-editor="true" contenteditable="true"><p>Lexical paragraph text</p></div>');
    const doc = dom.window.document;
    const lexicalDiv = doc.querySelector('div[data-lexical-editor="true"]');
    assert.ok(lexicalDiv);

    const res = extractDomBufferText(lexicalDiv, { window: dom.window, document: doc });
    assert.ok(res.pathway === 'inner-text' || res.pathway === 'text-content');
    assert.strictEqual(res.cleanText, 'Lexical paragraph text');
    assert.strictEqual(res.charsDetectedInDOM, 22);
  });

  runTest('Pathway C: Extracts clean text from Monaco Editor model API (getModel().getValue())', () => {
    const dom = new JSDOM('<div class="monaco-editor"><div class="view-lines"></div></div>');
    const doc = dom.window.document;
    const monacoDiv = doc.querySelector('.monaco-editor') as any;
    assert.ok(monacoDiv);

    monacoDiv.getModel = () => ({
      getValue: () => 'const greeting = "Hello Monaco Model";'
    });

    const res = extractDomBufferText(monacoDiv, { window: dom.window, document: doc });
    assert.strictEqual(res.pathway, 'monaco-model');
    assert.strictEqual(res.cleanText, 'const greeting = "Hello Monaco Model";');
    assert.strictEqual(res.charsDetectedInDOM, 38);
  });

  runTest('Pathway D: Cleans non-printable zero-width characters (\\u200B-\\u200D, \\uFEFF)', () => {
    const dom = new JSDOM('<div id="editor">Line1\u200B\u200C\u200D\uFEFFLine2</div>');
    const doc = dom.window.document;
    const el = doc.getElementById('editor');
    assert.ok(el);

    const res = extractDomBufferText(el, { window: dom.window, document: doc });
    assert.strictEqual(res.cleanText, 'Line1Line2');
    assert.strictEqual(res.charsDetectedInDOM, 10);
  });

  runTest('Pathway E: Normalizes Windows newlines (\\r\\n) to standard (\\n)', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const doc = dom.window.document;
    const ta = doc.getElementById('t') as HTMLTextAreaElement;
    ta.value = 'Row1\r\nRow2\r\nRow3';

    const res = extractDomBufferText(ta, { window: dom.window, document: doc });
    assert.strictEqual(res.cleanText, 'Row1\nRow2\nRow3');
    assert.strictEqual(res.charsDetectedInDOM, 14);
  });

  // --------------------------------------------------------------------------
  // Suite 2: Buffer Verification Standard (verifyBufferHasText)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 2: Buffer Verification Standard (verifyBufferHasText)');

  runTest('Full legitimate inputs pass verification with 100% accuracy', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const doc = dom.window.document;
    const ta = doc.getElementById('t') as HTMLTextAreaElement;
    const prompt = 'Please refactor the authentication middleware to use JWT tokens with 15-minute expiration.';
    ta.value = prompt;

    const diag: any = {};
    const ok = verifyBufferHasText(ta, prompt, { window: dom.window, document: doc, diagnostics: diag });
    assert.strictEqual(ok, true, 'verifyBufferHasText must return true for identical prompt');
    assert.strictEqual(diag.verified, true);
    assert.strictEqual(diag.charsExpected, prompt.length);
    assert.strictEqual(diag.charsDetectedInDOM, prompt.length);
    assert.strictEqual(diag.rejectionReason, null);
    assert.strictEqual(diag.domExcerpt, prompt.slice(0, 60));
  });

  runTest('Completely empty buffer returns false with rejectionReason: dom_buffer_empty', () => {
    const dom = new JSDOM('<div data-lexical-editor="true"></div>');
    const doc = dom.window.document;
    const el = doc.querySelector('div');
    const prompt = 'Implement new database migration scripts';

    const diag: any = {};
    const ok = verifyBufferHasText(el, prompt, { window: dom.window, document: doc, diagnostics: diag });
    assert.strictEqual(ok, false, 'verifyBufferHasText must return false for empty DOM buffer');
    assert.strictEqual(diag.verified, false);
    assert.strictEqual(diag.rejectionReason, 'dom_buffer_empty');
    assert.strictEqual(diag.charsDetectedInDOM, 0);
    assert.strictEqual(diag.charsExpected, prompt.length);
  });

  runTest('Zero-width space only buffer (empty Lexical editor) evaluates to 0 detected chars and fails', () => {
    const dom = new JSDOM('<div data-lexical-editor="true"><p><span data-lexical-text="true">\u200B</span></p></div>');
    const doc = dom.window.document;
    const el = doc.querySelector('div');
    const prompt = 'Verify unit tests pass';

    const diag: any = {};
    const ok = verifyBufferHasText(el, prompt, { window: dom.window, document: doc, diagnostics: diag });
    assert.strictEqual(ok, false);
    assert.strictEqual(diag.verified, false);
    assert.strictEqual(diag.charsDetectedInDOM, 0, 'Zero-width space must be stripped, yielding 0 detected chars');
    assert.strictEqual(diag.rejectionReason, 'dom_buffer_empty');
  });

  runTest('Partial input (< 75% for prompt > 50 chars) returns false with insufficient_characters_detected', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const doc = dom.window.document;
    const ta = doc.getElementById('t') as HTMLTextAreaElement;
    // 100 character prompt
    const fullPrompt = '1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890';
    // Only 40 characters materialize in DOM (40% < 75%)
    ta.value = fullPrompt.slice(0, 40);

    const diag: any = {};
    const ok = verifyBufferHasText(ta, fullPrompt, { window: dom.window, document: doc, diagnostics: diag });
    assert.strictEqual(ok, false, 'Partial input (< 75%) must fail verification');
    assert.strictEqual(diag.verified, false);
    assert.strictEqual(diag.rejectionReason, 'insufficient_characters_detected');
    assert.strictEqual(diag.charsDetectedInDOM, 40);
    assert.strictEqual(diag.charsExpected, 100);
  });

  runTest('Missing prefix (initial 30 non-whitespace chars missing) returns false with prefix_not_found_in_dom', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const doc = dom.window.document;
    const ta = doc.getElementById('t') as HTMLTextAreaElement;
    const expected = 'CRITICAL_INITIAL_PREFIX_1234567890_REST_OF_PROMPT_THAT_IS_LONG_ENOUGH_TO_PASS_LENGTH_CHECKS_OVER_75_PERCENT';
    // Suffix is present, but prefix is replaced by random text
    ta.value = 'SOMETHING_DIFFERENT_ENTIRELY____REST_OF_PROMPT_THAT_IS_LONG_ENOUGH_TO_PASS_LENGTH_CHECKS_OVER_75_PERCENT';

    const diag: any = {};
    const ok = verifyBufferHasText(ta, expected, { window: dom.window, document: doc, diagnostics: diag });
    assert.strictEqual(ok, false, 'Mismatched prefix must fail verification');
    assert.strictEqual(diag.verified, false);
    assert.strictEqual(diag.rejectionReason, 'prefix_not_found_in_dom');
  });

  runTest('Missing suffix for prompt > 50 chars returns false with suffix_not_found_in_dom', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const doc = dom.window.document;
    const ta = doc.getElementById('t') as HTMLTextAreaElement;
    const expected = 'PREFIX_START_OF_THE_PROMPT_FOR_TESTING_PURPOSES_AND_VERIFICATION_SUFFIX_KEY_999888';
    // Truncate the suffix
    ta.value = 'PREFIX_START_OF_THE_PROMPT_FOR_TESTING_PURPOSES_AND_VERIFICATION_SUFFIX_TRUNCATED';

    const diag: any = {};
    const ok = verifyBufferHasText(ta, expected, { window: dom.window, document: doc, diagnostics: diag });
    assert.strictEqual(ok, false, 'Mismatched/truncated suffix must fail verification');
    assert.strictEqual(diag.verified, false);
    assert.strictEqual(diag.rejectionReason, 'suffix_not_found_in_dom');
  });

  runTest('Short prompt (<= 50 chars) verifies accurately with proportional threshold and prefix check', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const doc = dom.window.document;
    const ta = doc.getElementById('t') as HTMLTextAreaElement;
    const shortPrompt = 'Run phase 02 tests';
    ta.value = shortPrompt;

    const diag: any = {};
    const ok = verifyBufferHasText(ta, shortPrompt, { window: dom.window, document: doc, diagnostics: diag });
    assert.strictEqual(ok, true);
    assert.strictEqual(diag.verified, true);
    assert.strictEqual(diag.charsDetectedInDOM, 18);
    assert.strictEqual(diag.charsExpected, 18);

    // If truncated to 5 chars (5 < 18 * 0.75 = 13.5), must fail
    ta.value = 'Run p';
    const diagFail: any = {};
    const failRes = verifyBufferHasText(ta, shortPrompt, { window: dom.window, document: doc, diagnostics: diagFail });
    assert.strictEqual(failRes, false);
    assert.strictEqual(diagFail.rejectionReason, 'insufficient_characters_detected');
  });

  // --------------------------------------------------------------------------
  // Suite 3: Fail-Fast Enforcement & Rejection Engine (injectPromptAndSubmit)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 3: Fail-Fast Enforcement & Rejection Engine');

  await runTest('Throws PASTE_VERIFICATION_FAILED when injecting into non-responsive / read-only DOM node', async () => {
    const dom = new JSDOM(`
      <div id="antigravity.agentSidePanelInputBox">
        <div id="chat-input" data-lexical-editor="true" contenteditable="true" aria-label="Message input"></div>
        <button data-testid="send-button" aria-label="Send message">Send</button>
      </div>
    `);
    const doc = dom.window.document;
    const chatInput = doc.getElementById('chat-input') as any;

    // Simulate non-responsive / read-only element where injection does not mutate buffer
    Object.defineProperty(chatInput, 'innerText', {
      get() { return ''; },
      set(_v) { /* non-responsive / fails to set */ },
      configurable: true
    });
    Object.defineProperty(chatInput, 'textContent', {
      get() { return ''; },
      set(_v) { /* non-responsive / fails to set */ },
      configurable: true
    });

    let caughtError: any = null;
    try {
      await injectPromptAndSubmit('Deploy updated server code to staging environment', {
        document: doc,
        window: dom.window,
        targetElement: chatInput
      });
    } catch (err: any) {
      caughtError = err;
    }

    assert.ok(caughtError, 'injectPromptAndSubmit MUST throw an error when buffer verification fails');
    assert.strictEqual(caughtError.name, 'PASTE_VERIFICATION_FAILED');
    assert.strictEqual(caughtError.code, 'PASTE_VERIFICATION_FAILED');
    assert.strictEqual(caughtError.charsDetectedInDOM, 0);
    assert.strictEqual(caughtError.charsExpected, 'Deploy updated server code to staging environment'.length);
    assert.strictEqual(caughtError.domExcerpt, '');
    assert.ok(Array.isArray(caughtError.steps), 'Error must have steps diagnostics attached');

    const step2 = caughtError.steps.find((s: any) => s.step === 2);
    assert.ok(step2, 'Step 2 must be recorded in steps');
    assert.strictEqual(step2.status, 'failed');
    assert.strictEqual(step2.code, 'PASTE_VERIFICATION_FAILED');
    assert.strictEqual(step2.charsDetectedInDOM, 0);
  });

  await runTest('Submit triggering (Step 3 and Step 4) is completely bypassed on paste verification failure', async () => {
    const dom = new JSDOM(`
      <div id="antigravity.agentSidePanelInputBox">
        <div id="chat-input" data-lexical-editor="true" contenteditable="true" aria-label="Message input"></div>
        <button id="send-btn" data-testid="send-button" aria-label="Send message">Send</button>
      </div>
    `);
    const doc = dom.window.document;
    const chatInput = doc.getElementById('chat-input') as any;
    const sendBtn = doc.getElementById('send-btn') as any;

    // Track if any submit or event dispatch was attempted
    let buttonClicked = false;
    let enterDispatched = false;

    sendBtn.addEventListener('click', () => { buttonClicked = true; });
    chatInput.addEventListener('keydown', (e: any) => {
      if (e.key === 'Enter') enterDispatched = true;
    });

    // Make element non-responsive
    Object.defineProperty(chatInput, 'innerText', { get() { return ''; }, set() {}, configurable: true });
    Object.defineProperty(chatInput, 'textContent', { get() { return ''; }, set() {}, configurable: true });

    let caughtError: any = null;
    try {
      await injectPromptAndSubmit('Test fail fast abort', {
        document: doc,
        window: dom.window,
        targetElement: chatInput,
        sendButton: sendBtn
      });
    } catch (err: any) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Must throw error');
    assert.strictEqual(caughtError.code, 'PASTE_VERIFICATION_FAILED');

    // Strict invariant: Step 3 (Event dispatching) and Step 4 (Submit triggering) must NOT exist in steps
    const step3 = caughtError.steps.find((s: any) => s.step === 3);
    const step4 = caughtError.steps.find((s: any) => s.step === 4);
    assert.strictEqual(step3, undefined, 'Step 3 MUST be completely bypassed');
    assert.strictEqual(step4, undefined, 'Step 4 MUST be completely bypassed');

    // Strict invariant: No button click or Enter key dispatched
    assert.strictEqual(buttonClicked, false, 'Send button must NEVER be clicked when buffer verification fails');
    assert.strictEqual(enterDispatched, false, 'Enter key must NEVER be dispatched when buffer verification fails');
  });

  // --------------------------------------------------------------------------
  // Suite 4: Step 2 Success Telemetry Payload & Legitimate Injections
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 4: Step 2 Success Telemetry Payload & Legitimate Injections');

  await runTest('Legitimate Lexical prompt injection emits rich Step 2 metadata payload', async () => {
    const dom = new JSDOM(`
      <div id="antigravity.agentSidePanelInputBox">
        <div id="chat-input" data-lexical-editor="true" contenteditable="true" aria-label="Message input"></div>
        <button data-testid="send-button" aria-label="Send message">Send</button>
      </div>
    `);
    const doc = dom.window.document;
    const prompt = 'Implement user profile avatar upload functionality with image compression.';

    const report = await injectPromptAndSubmit(prompt, {
      document: doc,
      window: dom.window
    });

    assert.strictEqual(report.success, true);
    assert.ok(report.steps);

    const step2 = report.steps.find((s: any) => s.step === 2);
    assert.ok(step2, 'Step 2 must be present');
    assert.strictEqual(step2.status, 'success');
    assert.strictEqual(step2.verified, true);
    assert.strictEqual(step2.charsExpected, prompt.length);
    assert.strictEqual(step2.charsDetectedInDOM, prompt.length);
    assert.strictEqual(step2.domExcerpt, prompt.slice(0, 60));
    assert.ok(step2.strategy, 'Strategy must be specified');
  });

  await runTest('Legitimate Textarea prompt injection succeeds with strategy: textarea-value', async () => {
    const dom = new JSDOM(`
      <div id="antigravity.agentSidePanelInputBox">
        <textarea id="chat-textarea" aria-label="Message input"></textarea>
        <button data-testid="send-button" aria-label="Send message">Send</button>
      </div>
    `);
    const doc = dom.window.document;
    const prompt = 'Run test suite for authentication service';

    const report = await injectPromptAndSubmit(prompt, {
      document: doc,
      window: dom.window
    });

    assert.strictEqual(report.success, true);
    const step2 = report.steps.find((s: any) => s.step === 2);
    assert.ok(step2);
    assert.strictEqual(step2.status, 'success');
    assert.strictEqual(step2.strategy, 'textarea-value');
    assert.strictEqual(step2.verified, true);
    assert.strictEqual(step2.charsDetectedInDOM, prompt.length);
  });

  await runTest('Passes verification with 100% precision on empirical Antigravity DOM (Data/body1.txt)', async () => {
    const fixturePath = path.resolve(process.cwd(), 'Data/body1.txt');
    assert.ok(fs.existsSync(fixturePath), `Data/body1.txt fixture must exist at ${fixturePath}`);
    const empiricalHtml = fs.readFileSync(fixturePath, 'utf8');

    const dom = new JSDOM(empiricalHtml);
    const doc = dom.window.document;

    const chatInput = findChatInput(doc);
    assert.ok(chatInput, 'findChatInput must locate live chat input in Data/body1.txt');

    const prompt = 'Refactor database indexing to support multi-tenant query isolation.';
    const report = await injectPromptAndSubmit(prompt, {
      document: doc,
      window: dom.window,
      targetElement: chatInput
    });

    assert.strictEqual(report.success, true);
    const step2 = report.steps.find((s: any) => s.step === 2);
    assert.ok(step2);
    assert.strictEqual(step2.status, 'success');
    assert.strictEqual(step2.verified, true);
    assert.strictEqual(step2.charsDetectedInDOM, prompt.length);
    assert.strictEqual(step2.charsExpected, prompt.length);
  });

  // --------------------------------------------------------------------------
  // Suite 5: Constraints & Edge Cases
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 5: Constraints & Edge Cases');

  runTest('Null or undefined inputElem evaluates to false safely without throwing TypeError', () => {
    const diag: any = {};
    const okNull = verifyBufferHasText(null, 'Some prompt', { diagnostics: diag });
    assert.strictEqual(okNull, false);
    assert.strictEqual(diag.verified, false);
    assert.strictEqual(diag.rejectionReason, 'no_target_element');

    const okUndef = verifyBufferHasText(undefined, 'Some prompt');
    assert.strictEqual(okUndef, false);
  });

  runTest('Verification calculation executes sub-15ms (< 5ms in practice)', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const ta = dom.window.document.getElementById('t') as HTMLTextAreaElement;
    // 5000 character prompt
    const largePrompt = 'a'.repeat(5000);
    ta.value = largePrompt;

    const start = Date.now();
    for (let i = 0; i < 50; i++) {
      const ok = verifyBufferHasText(ta, largePrompt);
      assert.strictEqual(ok, true);
    }
    const elapsed = Date.now() - start;
    const avgMs = elapsed / 50;

    assert.ok(avgMs < 15, `Verification average duration ${avgMs.toFixed(3)}ms must be strictly sub-15ms`);
  });

  runTest('Prompt with multiline markdown, code blocks, and symbols verifies accurately', () => {
    const dom = new JSDOM('<div data-lexical-editor="true" contenteditable="true"></div>');
    const el = dom.window.document.querySelector('div') as any;

    const complexPrompt = [
      '# Feature Plan: WebSocket Stream Sync',
      '',
      '```typescript',
      'export interface StreamSyncPacket {',
      '  id: string;',
      '  payload: Record<string, unknown>;',
      '}',
      '```',
      '',
      'Ensure strict backwards compatibility with v1.7.0 client payload format.'
    ].join('\n');

    el.textContent = complexPrompt;

    const diag: any = {};
    const ok = verifyBufferHasText(el, complexPrompt, { diagnostics: diag });
    assert.strictEqual(ok, true, 'Complex multiline markdown prompt must verify successfully');
    assert.strictEqual(diag.verified, true);
    assert.strictEqual(diag.charsDetectedInDOM, complexPrompt.length);
  });

  console.log('\n================================================================');
  console.log(`🎉 Phase 02 Test Suite Completed: ${passedTests}/${totalTests} Passed!`);
  console.log('================================================================\n');
}

runAllTests().catch((err: any) => {
  console.error('\n❌ Phase 02 Test Suite Failed:', err);
  process.exit(1);
});

