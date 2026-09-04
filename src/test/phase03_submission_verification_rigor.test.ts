// Self-healing ESM require guard for JSDOM in Node < 20.19 CommonJS
if (!process.env.__SUBMISSION_RIGOR_REEXEC__) {
  try {
    require('jsdom');
  } catch (e: any) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      const { execFileSync } = require('child_process');
      const env = {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-require-module`.trim(),
        __SUBMISSION_RIGOR_REEXEC__: '1'
      };
      try {
        execFileSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
          stdio: 'inherit',
          env
        });
        process.exit(0);
      } catch (err: any) {
        process.exit(err.status || 1);
      }
    }
    throw e;
  }
}

// Standalone mock for 'vscode' module if run directly via Node / Mocha
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      commands: {
        executeCommand: async (_cmd: string, ..._args: any[]) => undefined
      },
      window: {
        showWarningMessage: (_msg: string) => undefined
      },
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue
        })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

declare const describe: any;
declare const it: any;

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

describe('Phase 03: Rigid Input Submission Verification & False-Positive Elimination', function (this: any) {
  this.timeout(15000);

  const bridge = loadDomBridge();
  const {
    verifyInputSubmission,
    findCancelButton,
    countUserMessages,
    isInputClearedOrSubmitted,
    injectPromptAndSubmit
  } = bridge;

  it('exports required Phase 03 functions', () => {
    assert.strictEqual(typeof verifyInputSubmission, 'function', 'verifyInputSubmission must be a function');
    assert.strictEqual(typeof findCancelButton, 'function', 'findCancelButton must be a function');
    assert.strictEqual(typeof countUserMessages, 'function', 'countUserMessages must be a function');
    assert.strictEqual(typeof isInputClearedOrSubmitted, 'function', 'isInputClearedOrSubmitted must be a function');
  });

  describe('1. Elimination of Generic Body Mutation Observer (False-Positive Protection)', () => {
    it('does NOT verify submission when random DOM elements (tooltips, clock ticks, toasts) are added to document.body', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div id="workbench">
              <div contenteditable="true" role="textbox" class="input-editor">
                <p>Execute plan step 1</p>
              </div>
            </div>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const win = dom.window;
      const inputElem = doc.querySelector('.input-editor') as HTMLElement;
      const promptText = 'Execute plan step 1';

      // Start asynchronous verification with a short observation window
      const verifyPromise = verifyInputSubmission(inputElem, promptText, {
        window: win,
        document: doc,
        observationTimeoutMs: 120,
        pollIntervalMs: 15
      });

      // Simulate rapid generic mutations on document.body during the observation window
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 20));
        const tooltip = doc.createElement('div');
        tooltip.className = 'monaco-hover-content tooltip-popup';
        tooltip.textContent = `Tooltip update ${i} at ${Date.now()}`;
        doc.body.appendChild(tooltip);

        const statusBarClock = doc.createElement('div');
        statusBarClock.className = 'status-bar-item clock-tick';
        statusBarClock.textContent = '12:34:56';
        doc.body.appendChild(statusBarClock);
      }

      const result = await verifyPromise;

      assert.strictEqual(result.verified, false, 'Generic mutations on doc.body must NOT produce false-positive verification');
      assert.strictEqual(result.reason, 'unverified_input_remains', 'Should fail with unverified_input_remains');
      assert.ok(result.error, 'Should contain descriptive error message');
      assert.strictEqual(result.currentValue.trim(), 'Execute plan step 1', 'Current value should reflect remaining text');
    });

    it('returns verified: false within observationTimeoutMs when no proof occurs', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <textarea id="prompt-input">Keep this prompt text</textarea>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const win = dom.window;
      const inputElem = doc.querySelector('#prompt-input') as HTMLTextAreaElement;

      const startTime = Date.now();
      const result = await verifyInputSubmission(inputElem, 'Keep this prompt text', {
        window: win,
        document: doc,
        observationTimeoutMs: 100,
        pollIntervalMs: 15
      });
      const elapsed = Date.now() - startTime;

      assert.strictEqual(result.verified, false);
      assert.strictEqual(result.reason, 'unverified_input_remains');
      assert.ok(elapsed >= 90, `Elapsed time (${elapsed}ms) should match observationTimeoutMs (~100ms)`);
    });
  });

  describe('2. Proof 1: Input Clearance Verification', () => {
    it('verifies submission immediately when Lexical / contenteditable input is already empty', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div contenteditable="true" role="textbox" class="editor"><p><br></p></div>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const win = dom.window;
      const inputElem = doc.querySelector('.editor') as HTMLElement;

      const result = await verifyInputSubmission(inputElem, 'Submitted text', {
        window: win,
        document: doc,
        observationTimeoutMs: 500
      });

      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.reason, 'input_cleared_immediately');
      assert.strictEqual(result.proof, 'proof1_input_clearance');
    });

    it('verifies submission when input is cleared dynamically during the polling window', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div contenteditable="true" role="textbox" class="editor"><p>My pending prompt</p></div>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const win = dom.window;
      const inputElem = doc.querySelector('.editor') as HTMLElement;

      const verifyPromise = verifyInputSubmission(inputElem, 'My pending prompt', {
        window: win,
        document: doc,
        observationTimeoutMs: 500,
        pollIntervalMs: 20
      });

      // Clear input after 60ms
      setTimeout(() => {
        inputElem.innerHTML = '';
        inputElem.textContent = '';
      }, 60);

      const result = await verifyPromise;
      assert.strictEqual(result.verified, true);
      assert.ok(result.reason === 'input_cleared' || result.reason === 'input_cleared_at_deadline');
      assert.strictEqual(result.proof, 'proof1_input_clearance');
    });

    it('verifies textarea clearance dynamically', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <textarea id="ta">Text in textarea</textarea>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const win = dom.window;
      const inputElem = doc.querySelector('#ta') as HTMLTextAreaElement;

      const verifyPromise = verifyInputSubmission(inputElem, 'Text in textarea', {
        window: win,
        document: doc,
        observationTimeoutMs: 300,
        pollIntervalMs: 15
      });

      setTimeout(() => {
        inputElem.value = '';
      }, 45);

      const result = await verifyPromise;
      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.proof, 'proof1_input_clearance');
    });
  });

  describe('3. Proof 2: Active Agent Cancel Button & Working Announcer', () => {
    it('finds Cancel button matching button[aria-label*="Cancel"][data-tooltip-id*="input-send-button-cancel-tooltip"]', () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <button type="button" aria-label="Cancel (Ctrl+D)" data-tooltip-id="input-send-button-cancel-tooltip" class="bg-secondary">
              <div class="bg-red-500 w-[0.625rem] h-[0.625rem] rounded-[1px]"></div>
            </button>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const cancelBtn = findCancelButton(doc);
      assert.ok(cancelBtn, 'Should find cancel button from snapshot body2.txt structure');
      assert.strictEqual(cancelBtn?.getAttribute('data-tooltip-id'), 'input-send-button-cancel-tooltip');
    });

    it('finds Cancel button with data-tooltip-id="cancel" containing .bg-red-500', () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <button type="button" aria-label="Cancel generation" data-tooltip-id="cancel-button">
              <span class="bg-red-500"></span>
            </button>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const cancelBtn = findCancelButton(doc);
      assert.ok(cancelBtn, 'Should find cancel button with red indicator');
    });

    it('verifies submission immediately when Cancel button is present, even if input remains uncleared', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div contenteditable="true" role="textbox" class="editor"><p>Uncleared prompt</p></div>
            <button type="button" aria-label="Cancel (Ctrl+D)" data-tooltip-id="input-send-button-cancel-tooltip">
              <div class="bg-red-500"></div>
            </button>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const win = dom.window;
      const inputElem = doc.querySelector('.editor') as HTMLElement;

      const result = await verifyInputSubmission(inputElem, 'Uncleared prompt', {
        window: win,
        document: doc,
        observationTimeoutMs: 500
      });

      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.reason, 'cancel_button_active');
      assert.strictEqual(result.proof, 'proof2_active_cancel_button');
    });

    it('verifies submission when Cancel button is rendered dynamically while input remains uncleared', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div contenteditable="true" role="textbox" class="editor"><p>Prompt stays in buffer</p></div>
            <div id="controls">
              <button type="button" aria-label="Send" data-tooltip-id="send-button"></button>
            </div>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const win = dom.window;
      const inputElem = doc.querySelector('.editor') as HTMLElement;

      const verifyPromise = verifyInputSubmission(inputElem, 'Prompt stays in buffer', {
        window: win,
        document: doc,
        observationTimeoutMs: 400,
        pollIntervalMs: 20
      });

      // Render Cancel button replacing send button after 60ms
      setTimeout(() => {
        const controls = doc.querySelector('#controls') as HTMLElement;
        controls.innerHTML = `
          <button type="button" aria-label="Cancel (Ctrl+D)" data-tooltip-id="input-send-button-cancel-tooltip">
            <div class="bg-red-500"></div>
          </button>
        `;
      }, 60);

      const result = await verifyPromise;
      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.reason, 'cancel_button_active');
      assert.strictEqual(result.proof, 'proof2_active_cancel_button');
    });

    it('verifies submission when #a11y-live-announcer contains text "Working..."', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div contenteditable="true" role="textbox" class="editor"><p>Uncleared text</p></div>
            <div id="a11y-live-announcer" aria-live="polite">Working...</div>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const win = dom.window;
      const inputElem = doc.querySelector('.editor') as HTMLElement;

      const result = await verifyInputSubmission(inputElem, 'Uncleared text', {
        window: win,
        document: doc,
        observationTimeoutMs: 300
      });

      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.reason, 'cancel_button_active');
      assert.strictEqual(result.proof, 'proof2_active_cancel_button');
    });
  });

  describe('4. Proof 3: Message Count Increment', () => {
    it('accurately counts user messages targeting div[role="article"][aria-label="User message"] and div[data-testid="user-input-step"] without duplicates', () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div id="chat">
              <!-- Nested message: should only count as 1 -->
              <div role="article" aria-label="User message">
                <div>
                  <div data-testid="user-input-step">Hello</div>
                </div>
              </div>
              <!-- Standalone article -->
              <div role="article" aria-label="User message">
                <div>Second message</div>
              </div>
              <!-- Standalone testid -->
              <div data-testid="user-input-step">
                Third message
              </div>
            </div>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const count = countUserMessages(doc);
      assert.strictEqual(count, 3, 'Should count 3 distinct messages without double-counting nested elements');
    });

    it('verifies submission immediately when message count is already incremented', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div contenteditable="true" role="textbox" class="editor"><p>Uncleared text</p></div>
            <div role="article" aria-label="User message">First</div>
            <div role="article" aria-label="User message">Second</div>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const win = dom.window;
      const inputElem = doc.querySelector('.editor') as HTMLElement;

      // Initial count was 1, now is 2
      const result = await verifyInputSubmission(inputElem, 'Uncleared text', {
        window: win,
        document: doc,
        initialMessageCount: 1,
        observationTimeoutMs: 300
      });

      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.reason, 'message_count_incremented');
      assert.strictEqual(result.proof, 'proof3_message_count_increment');
    });

    it('verifies submission when a new user message is appended dynamically during the polling window', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div id="messages">
              <div role="article" aria-label="User message">
                <div data-testid="user-input-step">Existing message</div>
              </div>
            </div>
            <div contenteditable="true" role="textbox" class="editor"><p>Prompt stays in input</p></div>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const win = dom.window;
      const inputElem = doc.querySelector('.editor') as HTMLElement;

      const initialCount = countUserMessages(doc);
      assert.strictEqual(initialCount, 1);

      const verifyPromise = verifyInputSubmission(inputElem, 'Prompt stays in input', {
        window: win,
        document: doc,
        initialMessageCount: initialCount,
        observationTimeoutMs: 400,
        pollIntervalMs: 20
      });

      // Append new user message after 60ms
      setTimeout(() => {
        const messages = doc.querySelector('#messages') as HTMLElement;
        const newMsg = doc.createElement('div');
        newMsg.setAttribute('role', 'article');
        newMsg.setAttribute('aria-label', 'User message');
        newMsg.innerHTML = '<div data-testid="user-input-step">Prompt stays in input</div>';
        messages.appendChild(newMsg);
      }, 60);

      const result = await verifyPromise;
      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.reason, 'message_count_incremented');
      assert.strictEqual(result.proof, 'proof3_message_count_increment');
    });
  });

  describe('5. Real Workspace Snapshots (body1.txt & body2.txt)', () => {
    it('accurately parses body1.txt message count and verifies increment when a 4th message is appended', () => {
      const body1Path = path.resolve(process.cwd(), 'body1.txt');
      assert.ok(fs.existsSync(body1Path), 'body1.txt must exist');
      const body1Html = fs.readFileSync(body1Path, 'utf8');

      const dom = new JSDOM(body1Html);
      const doc = dom.window.document;

      const initialCount = countUserMessages(doc);
      assert.strictEqual(initialCount, 3, 'body1.txt snapshot must contain exactly 3 user messages');

      // Append 4th user message
      const conversation = doc.querySelector('#conversation') || doc.body;
      const newMsg = doc.createElement('div');
      newMsg.setAttribute('role', 'article');
      newMsg.setAttribute('aria-label', 'User message');
      newMsg.innerHTML = '<div data-testid="user-input-step">4th user prompt</div>';
      conversation.appendChild(newMsg);

      const updatedCount = countUserMessages(doc);
      assert.strictEqual(updatedCount, 4, 'Message count must increment to 4');
    });

    it('accurately detects active Cancel button with .bg-red-500 in body2.txt snapshot', () => {
      const body2Path = path.resolve(process.cwd(), 'body2.txt');
      assert.ok(fs.existsSync(body2Path), 'body2.txt must exist');
      const body2Html = fs.readFileSync(body2Path, 'utf8');

      const dom = new JSDOM(body2Html);
      const doc = dom.window.document;

      const cancelBtn = findCancelButton(doc);
      assert.ok(cancelBtn, 'Must find active Cancel button in body2.txt');
      assert.strictEqual(cancelBtn?.getAttribute('data-tooltip-id'), 'input-send-button-cancel-tooltip');
      const redIndicator = cancelBtn?.querySelector('.bg-red-500');
      assert.ok(redIndicator, 'Cancel button in body2.txt must contain .bg-red-500 red indicator');
    });
  });

  describe('6. Integration with injectPromptAndSubmit', () => {
    it('fails when send button is disabled and input buffer remains uncleared despite generic body mutations', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div id="workbench">
              <div contenteditable="true" role="textbox" class="input-send-button-lexical-editor">
                <p>Unsent text</p>
              </div>
              <button type="button" aria-label="Send" data-tooltip-id="send-button" disabled class="opacity-50">
                Send
              </button>
            </div>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const win = dom.window;

      // Mutate body periodically during execution
      const interval = setInterval(() => {
        const el = doc.createElement('div');
        el.className = 'random-status-update';
        doc.body.appendChild(el);
      }, 20);

      try {
        const res = await injectPromptAndSubmit('Unsent text', {
          window: win,
          document: doc,
          maxPollMs: 50,
          pollIntervalMs: 10,
          observationTimeoutMs: 100
        });

        assert.strictEqual(res.success, false, 'Should fail because button is disabled and input remains uncleared');
        assert.ok(res.rejectionReason, 'Should have rejectionReason');
      } finally {
        clearInterval(interval);
      }
    });

    it('succeeds when input is cleared after click cascade', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div id="workbench">
              <div contenteditable="true" role="textbox" class="input-send-button-lexical-editor">
                <p>Ready to send</p>
              </div>
              <button type="button" aria-label="Send" data-tooltip-id="send-button" class="cursor-pointer">
                Send
              </button>
            </div>
          </body>
        </html>
      `);
      const doc = dom.window.document;
      const win = dom.window;
      const inputElem = doc.querySelector('.input-send-button-lexical-editor') as HTMLElement;
      const sendBtn = doc.querySelector('button[aria-label="Send"]') as HTMLButtonElement;

      sendBtn.addEventListener('click', () => {
        // Clearing input upon submit
        inputElem.innerHTML = '';
        inputElem.textContent = '';
      });

      const res = await injectPromptAndSubmit('Ready to send', {
        window: win,
        document: doc,
        observationTimeoutMs: 300,
        pollIntervalMs: 15
      });

      assert.strictEqual(res.success, true, 'injectPromptAndSubmit should succeed when input is cleared');
    });
  });
});
