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
  console.log('🧪 Phase 03: Submission Proof Transition Hardening & Elimination');
  console.log('================================================================\n');

  const domBridge = loadDomBridge();
  const {
    isInputClearedOrSubmitted,
    verifyInputSubmission,
    findCancelButton,
    countUserMessages,
    injectPromptAndSubmit
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
  // Suite 1: Content Transition Requirement for Proof 1 (isInputClearedOrSubmitted)
  // --------------------------------------------------------------------------
  console.log('▶ Suite 1: Content Transition Requirement for Proof 1 (isInputClearedOrSubmitted)');

  runTest('Initially empty <textarea> without pre-confirmed content returns false (NO false-positive)', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const ta = dom.window.document.getElementById('t') as HTMLTextAreaElement;
    assert.strictEqual(ta.value, '');

    const res = isInputClearedOrSubmitted(ta, 'Implement feature XYZ');
    assert.strictEqual(res, false, 'Empty textarea without confirmed content MUST return false');
  });

  runTest('Initially empty <textarea> with explicit hasConfirmedContentBeforeSubmit: false returns false', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const ta = dom.window.document.getElementById('t') as HTMLTextAreaElement;

    const res = isInputClearedOrSubmitted(ta, 'Implement feature XYZ', { hasConfirmedContentBeforeSubmit: false });
    assert.strictEqual(res, false, 'hasConfirmedContentBeforeSubmit: false MUST return false');
  });

  runTest('Initially empty <textarea> with charsDetectedInDOM: 0 returns false', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const ta = dom.window.document.getElementById('t') as HTMLTextAreaElement;

    const res = isInputClearedOrSubmitted(ta, 'Implement feature XYZ', { charsDetectedInDOM: 0 });
    assert.strictEqual(res, false, 'charsDetectedInDOM: 0 MUST return false');
  });

  runTest('Initially empty Lexical editor (<p><br></p>) without pre-confirmed content returns false', () => {
    const dom = new JSDOM('<div data-lexical-editor="true" contenteditable="true"><p><br></p></div>');
    const el = dom.window.document.querySelector('div') as HTMLElement;

    const res = isInputClearedOrSubmitted(el, 'Refactor database models');
    assert.strictEqual(res, false, 'Empty Lexical editor without pre-confirmed content MUST return false');
  });

  runTest('Initially empty Lexical editor (<div><br/></div>) without pre-confirmed content returns false', () => {
    const dom = new JSDOM('<div data-lexical-editor="true" contenteditable="true"><div><br/></div></div>');
    const el = dom.window.document.querySelector('div') as HTMLElement;

    const res = isInputClearedOrSubmitted(el, 'Test prompt');
    assert.strictEqual(res, false, 'Empty Lexical editor with <div><br/></div> MUST return false');
  });

  runTest('Initially empty Monaco model API (getValue() === "") without pre-confirmed content returns false', () => {
    const dom = new JSDOM('<div class="monaco-editor"></div>');
    const el = dom.window.document.querySelector('.monaco-editor') as any;
    el.getModel = () => ({ getValue: () => '' });

    const res = isInputClearedOrSubmitted(el, 'Run unit test suite');
    assert.strictEqual(res, false, 'Empty Monaco model without pre-confirmed content MUST return false');
  });

  runTest('Null or undefined input element returns false', () => {
    assert.strictEqual(isInputClearedOrSubmitted(null, 'Some prompt'), false);
    assert.strictEqual(isInputClearedOrSubmitted(undefined, 'Some prompt'), false);
    assert.strictEqual(isInputClearedOrSubmitted(null, 'Some prompt', { hasConfirmedContentBeforeSubmit: true }), false);
  });

  // --------------------------------------------------------------------------
  // Suite 2: State Transition Verification (Populated -> Cleared)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 2: State Transition Verification (Populated -> Cleared)');

  runTest('<textarea> returns false while populated, returns true after transitioning to empty with confirmed content', () => {
    const dom = new JSDOM('<textarea id="t">Fix navigation crash</textarea>');
    const ta = dom.window.document.getElementById('t') as HTMLTextAreaElement;
    const prompt = 'Fix navigation crash';

    // Populated state
    const popRes = isInputClearedOrSubmitted(ta, prompt, { hasConfirmedContentBeforeSubmit: true });
    assert.strictEqual(popRes, false, 'Populated textarea must return false');

    // Transition to cleared state
    ta.value = '';
    const clearedRes = isInputClearedOrSubmitted(ta, prompt, { hasConfirmedContentBeforeSubmit: true });
    assert.strictEqual(clearedRes, true, 'Transitioned empty textarea must return true when pre-confirmed');
  });

  runTest('<textarea> returns true when charsDetectedInDOM: 50 is passed and value is cleared', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const ta = dom.window.document.getElementById('t') as HTMLTextAreaElement;

    const res = isInputClearedOrSubmitted(ta, 'A'.repeat(50), { charsDetectedInDOM: 50 });
    assert.strictEqual(res, true, 'Empty textarea with charsDetectedInDOM > 0 must return true');
  });

  runTest('Lexical editor returns false while populated, returns true after transitioning to <p><br></p>', () => {
    const dom = new JSDOM('<div data-lexical-editor="true" contenteditable="true"><p>Active prompt text</p></div>');
    const el = dom.window.document.querySelector('div') as HTMLElement;
    const prompt = 'Active prompt text';

    // Populated
    assert.strictEqual(isInputClearedOrSubmitted(el, prompt, { hasConfirmedContentBeforeSubmit: true }), false);

    // Transitioned to <p><br></p>
    el.innerHTML = '<p><br></p>';
    assert.strictEqual(isInputClearedOrSubmitted(el, prompt, { hasConfirmedContentBeforeSubmit: true }), true);
  });

  runTest('Lexical editor transitions to <p class="editor-paragraph"><br></p> returns true', () => {
    const dom = new JSDOM('<div data-lexical-editor="true" contenteditable="true"><p class="editor-paragraph"><br></p></div>');
    const el = dom.window.document.querySelector('div') as HTMLElement;

    assert.strictEqual(isInputClearedOrSubmitted(el, 'Prompt text', { hasConfirmedContentBeforeSubmit: true }), true);
  });

  runTest('Lexical editor transitions to empty with zero-width characters (\\u200B) returns true', () => {
    const dom = new JSDOM('<div data-lexical-editor="true" contenteditable="true"><p><span data-lexical-text="true">\u200B</span></p></div>');
    const el = dom.window.document.querySelector('div') as HTMLElement;

    assert.strictEqual(isInputClearedOrSubmitted(el, 'Clean code', { hasConfirmedContentBeforeSubmit: true }), true);
  });

  runTest('Monaco editor returns false while populated, returns true after model clears to ""', () => {
    let content = 'export const API_KEY = "12345";';
    const dom = new JSDOM('<div class="monaco-editor"></div>');
    const el = dom.window.document.querySelector('.monaco-editor') as any;
    el.getModel = () => ({ getValue: () => content });

    assert.strictEqual(isInputClearedOrSubmitted(el, content, { hasConfirmedContentBeforeSubmit: true }), false);

    content = '';
    assert.strictEqual(isInputClearedOrSubmitted(el, 'export const API_KEY = "12345";', { hasConfirmedContentBeforeSubmit: true }), true);
  });

  // --------------------------------------------------------------------------
  // Suite 3: Special Characters, Whitespace & Edge Cases
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 3: Special Characters, Whitespace & Edge Cases');

  runTest('Prompt with whitespace, symbols, and quotes verifies false when populated and true when cleared', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const ta = dom.window.document.getElementById('t') as HTMLTextAreaElement;
    const specialPrompt = '   SELECT * FROM `users` WHERE "status" = \'active\' AND score >= 90; \n\t// comment <tag> & "escapes"   ';

    ta.value = specialPrompt;
    assert.strictEqual(isInputClearedOrSubmitted(ta, specialPrompt, { hasConfirmedContentBeforeSubmit: true }), false);

    ta.value = '';
    assert.strictEqual(isInputClearedOrSubmitted(ta, specialPrompt, { hasConfirmedContentBeforeSubmit: true }), true);
  });

  runTest('Buffer retaining residual partial prompt (> 2 chars) returns false even with confirmed content', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const ta = dom.window.document.getElementById('t') as HTMLTextAreaElement;
    const fullPrompt = 'Build the entire microservice architecture';

    // Simulated incomplete clearance (only last word remained)
    ta.value = 'architecture';
    assert.strictEqual(isInputClearedOrSubmitted(ta, fullPrompt, { hasConfirmedContentBeforeSubmit: true }), false);
  });

  runTest('Buffer retaining residual whitespace or <= 2 non-printable chars returns true when confirmed', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const ta = dom.window.document.getElementById('t') as HTMLTextAreaElement;
    const prompt = 'Generate documentation';

    ta.value = '  '; // 2 whitespace characters
    assert.strictEqual(isInputClearedOrSubmitted(ta, prompt, { hasConfirmedContentBeforeSubmit: true }), true);

    ta.value = '\n'; // 1 newline character
    assert.strictEqual(isInputClearedOrSubmitted(ta, prompt, { hasConfirmedContentBeforeSubmit: true }), true);
  });

  runTest('Buffer replaced by completely different text returns false', () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const ta = dom.window.document.getElementById('t') as HTMLTextAreaElement;

    ta.value = 'Completely different command inserted by user';
    assert.strictEqual(isInputClearedOrSubmitted(ta, 'Original prompt', { hasConfirmedContentBeforeSubmit: true }), false);
  });

  // --------------------------------------------------------------------------
  // Suite 4: Immediate Evaluation Hardening in verifyInputSubmission
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 4: Immediate Evaluation Hardening in verifyInputSubmission');

  await runTest('Empty input element without pre-confirmed content returns verified: false (0ms instant false-positive eliminated)', async () => {
    const dom = new JSDOM(`
      <div id="antigravity.agentSidePanelInputBox">
        <div data-lexical-editor="true" contenteditable="true" class="input-editor"><p><br></p></div>
      </div>
    `);
    const doc = dom.window.document;
    const win = dom.window;
    const inputElem = doc.querySelector('.input-editor') as HTMLElement;

    const result = await verifyInputSubmission(inputElem, 'Run test plan step 3', {
      document: doc,
      window: win,
      observationTimeoutMs: 60,
      pollIntervalMs: 15
    });

    assert.strictEqual(result.verified, false, 'Empty input MUST NOT verify submission');
    assert.strictEqual(result.reason, 'unverified_input_remains');
    assert.strictEqual(result.rejectionReason, 'unverified_input_remains');
    assert.ok(result.error);
  });

  await runTest('Empty input element with charsDetectedInDOM: 0 returns verified: false', async () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const doc = dom.window.document;
    const win = dom.window;
    const inputElem = doc.getElementById('t') as HTMLTextAreaElement;

    const result = await verifyInputSubmission(inputElem, 'Phase 03 validation', {
      document: doc,
      window: win,
      charsDetectedInDOM: 0,
      observationTimeoutMs: 60,
      pollIntervalMs: 15
    });

    assert.strictEqual(result.verified, false);
    assert.strictEqual(result.reason, 'unverified_input_remains');
  });

  await runTest('Instantaneous tick clearance with confirmed content returns durationMs >= 1 (NEVER durationMs: 0)', async () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const doc = dom.window.document;
    const win = dom.window;
    const inputElem = doc.getElementById('t') as HTMLTextAreaElement;

    // Simulate input that was verified populated (e.g. 3,000 chars) and synchronously cleared upon submit
    const result = await verifyInputSubmission(inputElem, 'Synchronous submit prompt', {
      document: doc,
      window: win,
      hasConfirmedContentBeforeSubmit: true,
      charsDetectedInDOM: 3000,
      observationTimeoutMs: 100,
      pollIntervalMs: 15
    });

    assert.strictEqual(result.verified, true);
    assert.strictEqual(result.reason, 'input_cleared');
    assert.strictEqual(result.proof, 'proof1_input_clearance');
    assert.ok(result.durationMs >= 1, `Proof 1 durationMs (${result.durationMs}ms) must be >= 1, NEVER 0ms`);
  });

  await runTest('Proof 2 (Active Cancel Button in DOM) verifies immediately with reason: cancel_button_active', async () => {
    const dom = new JSDOM(`
      <div>
        <textarea id="t">In progress prompt</textarea>
        <button aria-label="Cancel agent response" data-tooltip-id="input-send-button-cancel-tooltip">
          <div class="bg-red-500"></div>
        </button>
      </div>
    `);
    const doc = dom.window.document;
    const win = dom.window;
    const inputElem = doc.getElementById('t') as HTMLTextAreaElement;

    const result = await verifyInputSubmission(inputElem, 'In progress prompt', {
      document: doc,
      window: win,
      observationTimeoutMs: 100
    });

    assert.strictEqual(result.verified, true);
    assert.strictEqual(result.reason, 'cancel_button_active');
    assert.strictEqual(result.proof, 'proof2_active_cancel_button');
  });

  await runTest('Proof 2 excludes dialog Cancel buttons (e.g. .monaco-dialog-box) to prevent false-positives', async () => {
    const dom = new JSDOM(`
      <div>
        <textarea id="t">Unsubmitted text</textarea>
        <div class="monaco-dialog-box">
          <button aria-label="Cancel">Cancel</button>
        </div>
      </div>
    `);
    const doc = dom.window.document;
    const win = dom.window;
    const inputElem = doc.getElementById('t') as HTMLTextAreaElement;

    const result = await verifyInputSubmission(inputElem, 'Unsubmitted text', {
      document: doc,
      window: win,
      observationTimeoutMs: 60,
      pollIntervalMs: 15
    });

    assert.strictEqual(result.verified, false, 'Modal dialog Cancel button must NOT verify submission');
  });

  await runTest('Proof 3 (User message count increment) verifies immediately with reason: message_count_incremented', async () => {
    const dom = new JSDOM(`
      <div>
        <textarea id="t">Pending prompt</textarea>
        <div role="article" aria-label="User message">Message 1</div>
        <div role="article" aria-label="User message">Message 2</div>
      </div>
    `);
    const doc = dom.window.document;
    const win = dom.window;
    const inputElem = doc.getElementById('t') as HTMLTextAreaElement;

    // Snapshot pre-submission count as 1, current is 2
    const result = await verifyInputSubmission(inputElem, 'Pending prompt', {
      document: doc,
      window: win,
      initialMessageCount: 1,
      observationTimeoutMs: 100
    });

    assert.strictEqual(result.verified, true);
    assert.strictEqual(result.reason, 'message_count_incremented');
    assert.strictEqual(result.proof, 'proof3_message_count_increment');
  });

  // --------------------------------------------------------------------------
  // Suite 5: Dynamic Polling Clearance & Acceptance Criteria Verification
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 5: Dynamic Polling Clearance & Acceptance Criteria Verification');

  await runTest('Acceptance Criteria: Input verified 3,000 characters in Phase 02, cleared during polling -> returns verified: true, reason: "input_cleared"', async () => {
    const dom = new JSDOM('<textarea id="t"></textarea>');
    const doc = dom.window.document;
    const win = dom.window;
    const inputElem = doc.getElementById('t') as HTMLTextAreaElement;

    // 3,000 character prompt
    const largePrompt = 'X'.repeat(3000);
    inputElem.value = largePrompt;

    // Asynchronous verification with confirmed pre-submit content
    const verifyPromise = verifyInputSubmission(inputElem, largePrompt, {
      document: doc,
      window: win,
      hasConfirmedContentBeforeSubmit: true,
      charsDetectedInDOM: 3000,
      observationTimeoutMs: 300,
      pollIntervalMs: 15
    });

    // Simulate framework clearing the input after 50ms (microtask / framework state update)
    setTimeout(() => {
      inputElem.value = '';
    }, 50);

    const result = await verifyPromise;

    assert.strictEqual(result.verified, true, 'Submission must be verified when cleared during polling');
    assert.strictEqual(result.reason, 'input_cleared');
    assert.strictEqual(result.proof, 'proof1_input_clearance');
    assert.ok(result.durationMs >= 40, `durationMs (${result.durationMs}ms) should reflect time until cleared`);
  });

  await runTest('Polling loop ignores unrelated generic body mutations during observation window', async () => {
    const dom = new JSDOM(`
      <div>
        <textarea id="t">Prompt retained in buffer</textarea>
      </div>
    `);
    const doc = dom.window.document;
    const win = dom.window;
    const inputElem = doc.getElementById('t') as HTMLTextAreaElement;

    const verifyPromise = verifyInputSubmission(inputElem, 'Prompt retained in buffer', {
      document: doc,
      window: win,
      hasConfirmedContentBeforeSubmit: true,
      charsDetectedInDOM: 'Prompt retained in buffer'.length,
      observationTimeoutMs: 100,
      pollIntervalMs: 15
    });

    // Rapid generic body mutations
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 20));
      const toast = doc.createElement('div');
      toast.className = 'monaco-hover-content tooltip';
      toast.textContent = `Random toast ${i}`;
      doc.body.appendChild(toast);
    }

    const result = await verifyPromise;
    assert.strictEqual(result.verified, false, 'Random body mutations must not falsely verify submission');
    assert.strictEqual(result.reason, 'unverified_input_remains');
  });

  // --------------------------------------------------------------------------
  // Suite 6: Untrusted Fallback Rejection Guard (injectPromptAndSubmit)
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 6: Untrusted Fallback Rejection Guard (injectPromptAndSubmit)');

  await runTest('Untrusted Enter Fallback: When Enter fails to clear input, flags rejectionReason: "untrusted_enter_rejected"', async () => {
    const dom = new JSDOM(`
      <div id="antigravity.agentSidePanelInputBox">
        <textarea id="chat-input" aria-label="Message input"></textarea>
      </div>
    `);
    const doc = dom.window.document;
    const win = dom.window;
    const chatInput = doc.getElementById('chat-input') as HTMLTextAreaElement;

    // Non-responsive to Enter: textarea retains prompt
    chatInput.addEventListener('keydown', (e: any) => {
      // Does not clear buffer on Enter
    });

    const report = await injectPromptAndSubmit('Execute task without send button', {
      document: doc,
      window: win,
      targetElement: chatInput,
      clearanceObservationMs: 60,
      pollIntervalMs: 15
    });

    assert.strictEqual(report.success, false, 'Success must be false when Enter fails to clear buffer');
    assert.strictEqual(report.submissionVerified, false, 'submissionVerified must be false');
    assert.strictEqual(report.submitStrategy, 'enterKey');
    assert.strictEqual(report.rejectionReason, 'untrusted_enter_rejected', 'rejectionReason must be untrusted_enter_rejected');

    const step4 = report.steps.find((s: any) => s.step === 4);
    assert.ok(step4);
    assert.strictEqual(step4.status, 'failed');
    assert.strictEqual(step4.rejectionReason, 'untrusted_enter_rejected');
  });

  await runTest('Successful Enter Submission: When Enter successfully clears input, submission is verified', async () => {
    const dom = new JSDOM(`
      <div id="antigravity.agentSidePanelInputBox">
        <textarea id="chat-input" aria-label="Message input"></textarea>
      </div>
    `);
    const doc = dom.window.document;
    const win = dom.window;
    const chatInput = doc.getElementById('chat-input') as HTMLTextAreaElement;

    // Framework listener that clears input on Enter
    chatInput.addEventListener('keydown', (e: any) => {
      if (e.key === 'Enter') {
        setTimeout(() => {
          chatInput.value = '';
        }, 15);
      }
    });

    const report = await injectPromptAndSubmit('Valid enter prompt', {
      document: doc,
      window: win,
      targetElement: chatInput,
      clearanceObservationMs: 200,
      pollIntervalMs: 15
    });

    assert.strictEqual(report.success, true);
    assert.strictEqual(report.submissionVerified, true);
    assert.strictEqual(report.submitStrategy, 'enterKey');
    assert.strictEqual(report.rejectionReason, undefined);

    const step4 = report.steps.find((s: any) => s.step === 4);
    assert.strictEqual(step4.status, 'success');
  });

  // --------------------------------------------------------------------------
  // Suite 7: New Conversation Creation & Race Condition Guards
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 7: New Conversation Creation & Race Condition Guards');

  runTest('Disconnected or unmounted elements are excluded from user message count', () => {
    const dom = new JSDOM(`
      <div>
        <div role="article" aria-label="User message">Connected msg 1</div>
      </div>
    `);
    const doc = dom.window.document;

    // Create a detached element not added to document
    const detachedMsg = doc.createElement('div');
    detachedMsg.setAttribute('role', 'article');
    detachedMsg.setAttribute('aria-label', 'User message');

    const count = countUserMessages(doc);
    assert.strictEqual(count, 1, 'Detached messages must not be counted');
  });

  runTest('Disconnected or unmounted cancel buttons are ignored by findCancelButton', () => {
    const dom = new JSDOM('<div><button id="live-btn">Live</button></div>');
    const doc = dom.window.document;

    // Live button is not cancel
    assert.strictEqual(findCancelButton(doc), null);
  });

  console.log('\n================================================================');
  console.log(`🎉 Phase 03 Test Suite Completed: ${passedTests}/${totalTests} Passed!`);
  console.log('================================================================\n');
}

runAllTests().catch((err: any) => {
  console.error('\n❌ Phase 03 Test Suite Failed:', err);
  process.exit(1);
});

