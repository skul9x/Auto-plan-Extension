// Self-healing ESM require guard for JSDOM in Node < 20.19 CommonJS
if (!process.env.__PHASE01_DOM_BRIDGE_REEXEC__) {
  try {
    require('jsdom');
  } catch (e: any) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      const { execFileSync } = require('child_process');
      const env = {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-require-module`.trim(),
        __PHASE01_DOM_BRIDGE_REEXEC__: '1'
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

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Phase 01: DOM Bridge Button Readiness Polling & Strict Rejection');
  console.log('================================================================\n');

  const domBridge = loadDomBridge();
  const {
    injectPromptAndSubmit,
    handleOpenNewConversation,
    triggerNewConversation,
    findSendButton,
    findChatInput,
    DomBridgeClient
  } = domBridge;

  // --------------------------------------------------------------------------
  // Test 1: Button Polling Waits Until Button Becomes Enabled and Clicks
  // --------------------------------------------------------------------------
  console.log('▶ Test 1: Button Polling Waits Until Button Becomes Enabled and Clicks Successfully...');
  {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="antigravity.agentSidePanelInputBox">
            <div data-lexical-editor="true" contenteditable="true" role="textbox" class="chat-editor">
              <p></p>
            </div>
            <button data-testid="send-button" disabled="" class="cursor-not-allowed text-muted-foreground bg-secondary">
              Send
            </button>
          </div>
        </body>
      </html>
    `, { url: 'http://localhost' });

    const doc = dom.window.document;
    const win = dom.window;
    const inputElem = doc.querySelector('div[data-lexical-editor="true"]') as HTMLElement;
    const sendBtn = doc.querySelector('button[data-testid="send-button"]') as HTMLButtonElement;

    let clicked = false;
    let enterKeyDetected = false;

    inputElem.addEventListener('keydown', (e: any) => {
      if (e.key === 'Enter') enterKeyDetected = true;
    });

    sendBtn.addEventListener('click', () => {
      clicked = true;
      inputElem.innerHTML = '';
      inputElem.textContent = '';
    });

    // Simulate React hydration delay: enable button after 200ms
    setTimeout(() => {
      sendBtn.removeAttribute('disabled');
      sendBtn.disabled = false;
      sendBtn.className = 'cursor-pointer bg-primary';
    }, 200);

    const startTime = Date.now();
    const result = await injectPromptAndSubmit('Test delayed enablement prompt', {
      document: doc,
      window: win,
      pollIntervalMs: 25
      // default maxPollMs should be 2500ms
    });
    const elapsed = Date.now() - startTime;

    assert.strictEqual(result.success, true, 'Prompt injection must succeed after button enables');
    assert.strictEqual(result.sendButtonClicked, true, 'Send button must be clicked');
    assert.strictEqual(result.submitStrategy, 'buttonClick', 'Submit strategy must be buttonClick');
    assert.strictEqual(result.enterDispatched, false, 'Synthetic Enter must NOT be dispatched when send button is clicked');
    assert.strictEqual(clicked, true, 'Native click event must have fired on send button');
    assert.strictEqual(enterKeyDetected, false, 'Enter key event must not reach editor');
    assert.ok(result.buttonWaitDurationMs >= 100, `Waited for button enablement (${result.buttonWaitDurationMs}ms)`);
    assert.ok(elapsed < 2000, `Completed well before 2500ms limit (${elapsed}ms)`);

    console.log(`  ✓ Polled for ${result.buttonWaitDurationMs}ms, clicked button once enabled, Enter not dispatched.`);
  }

  // --------------------------------------------------------------------------
  // Test 2: If Button Remains Disabled after 2500ms, Rejects with BUTTON_DISABLED_TIMEOUT
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 2: Button Remains Disabled -> Rejects with BUTTON_DISABLED_TIMEOUT without Enter Fallback...');
  {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="antigravity.agentSidePanelInputBox">
            <div data-lexical-editor="true" contenteditable="true" role="textbox" class="chat-editor">
              <p></p>
            </div>
            <button data-testid="send-button" disabled="" class="cursor-not-allowed text-muted-foreground bg-secondary">
              Send
            </button>
          </div>
        </body>
      </html>
    `, { url: 'http://localhost' });

    const doc = dom.window.document;
    const win = dom.window;
    const inputElem = doc.querySelector('div[data-lexical-editor="true"]') as HTMLElement;
    const sendBtn = doc.querySelector('button[data-testid="send-button"]') as HTMLButtonElement;

    let clicked = false;
    let enterKeyDetected = false;

    inputElem.addEventListener('keydown', (e: any) => {
      if (e.key === 'Enter') enterKeyDetected = true;
    });
    sendBtn.addEventListener('click', () => {
      clicked = true;
    });

    // The send button remains disabled throughout the 2500ms polling period
    const startTime = Date.now();
    let caughtError: any = null;

    try {
      await injectPromptAndSubmit('Prompt that will time out on disabled button', {
        document: doc,
        window: win,
        pollIntervalMs: 50
        // default maxPollMs = 2500ms
      });
    } catch (err: any) {
      caughtError = err;
    }
    const elapsed = Date.now() - startTime;

    assert.ok(caughtError, 'injectPromptAndSubmit must reject when button remains disabled');
    assert.strictEqual(caughtError.code, 'BUTTON_DISABLED_TIMEOUT', 'Error code must be BUTTON_DISABLED_TIMEOUT');
    assert.strictEqual(caughtError.status, 'failed', 'Error status must be failed');
    assert.strictEqual(caughtError.rejectionReason, 'button_disabled_timeout', 'rejectionReason must be button_disabled_timeout');
    assert.ok(caughtError.buttonWaitDurationMs >= 2400, `Must poll for at least ~2400ms (polled: ${caughtError.buttonWaitDurationMs}ms)`);
    assert.strictEqual(caughtError.initialDisabled, true, 'initialDisabled must be true');
    assert.strictEqual(caughtError.sendButtonClicked, false, 'sendButtonClicked must be false');
    assert.strictEqual(caughtError.enterDispatched, false, 'enterDispatched must be false');
    assert.strictEqual(clicked, false, 'Disabled button must NEVER be clicked');
    assert.strictEqual(enterKeyDetected, false, 'Synthetic Enter must NEVER be dispatched when send button is present');

    console.log(`  ✓ Rejected with BUTTON_DISABLED_TIMEOUT after ${caughtError.buttonWaitDurationMs}ms without Enter fallback.`);
  }

  // --------------------------------------------------------------------------
  // Test 3: DomBridgeClient Emits 'failed' ACK and Never Emits 'submitClicked'
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 3: DomBridgeClient Emits "failed" ACK and Never Emits "submitClicked" for Disabled Button...');
  {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="antigravity.agentSidePanelInputBox">
            <div data-lexical-editor="true" contenteditable="true" role="textbox">
              <p></p>
            </div>
            <button data-testid="send-button" disabled="" class="cursor-not-allowed disabled">
              Send
            </button>
          </div>
        </body>
      </html>
    `, { url: 'http://localhost' });

    const client = new DomBridgeClient({
      document: dom.window.document,
      window: dom.window
    });

    const dispatchedAcks: any[] = [];
    client.sendAck = async (commandId: string, status: string, errorMsg?: string, metadata?: any) => {
      dispatchedAcks.push({ commandId, status, errorMsg, metadata });
      return true;
    };
    client.sendClientLog = async () => true;

    // Execute sendPrompt command with short poll interval (using allowShortTimeout for test execution)
    await client.executeCommand({
      id: 'cmd-test-rejection-ack',
      type: 'sendPrompt',
      text: 'Verify strict rejection ACK',
      timeoutMs: 3000,
      options: {
        allowShortTimeout: true,
        pollTimeoutMs: 100,
        pollIntervalMs: 20
      }
    });

    assert.strictEqual(dispatchedAcks.length, 1, 'Exactly one ACK must be dispatched');
    const ack = dispatchedAcks[0];

    assert.strictEqual(ack.commandId, 'cmd-test-rejection-ack');
    assert.strictEqual(ack.status, 'failed', 'ACK status must be "failed"');
    assert.notStrictEqual(ack.status, 'submitClicked', 'ACK status must NEVER be false-positive "submitClicked"');
    assert.ok(ack.errorMsg && ack.errorMsg.includes('Send button remained disabled'), 'Error message must reflect button disabled timeout');
    assert.ok(ack.metadata, 'Metadata must be present in ACK');
    assert.strictEqual(ack.metadata.code, 'BUTTON_DISABLED_TIMEOUT', 'Metadata code must be BUTTON_DISABLED_TIMEOUT');
    assert.strictEqual(ack.metadata.rejectionReason, 'button_disabled_timeout');
    assert.strictEqual(ack.metadata.sendButtonClicked, false);
    assert.strictEqual(ack.metadata.enterDispatched, false);
    assert.strictEqual(ack.metadata.isSuccess, false);
    assert.ok(ack.metadata.buttonClass.includes('cursor-not-allowed'));
    assert.strictEqual(ack.metadata.initialState.initialDisabled, true);

    console.log('  ✓ DomBridgeClient accurately sent "failed" ACK with diagnostic metadata and no submitClicked.');
  }

  // --------------------------------------------------------------------------
  // Test 4: Post-Open Conversation Readiness Probe in handleOpenNewConversation
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 4: handleOpenNewConversation Post-Open Readiness Probe (Old Chat Unmount & New Editor Mount)...');
  {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="workbench">
            <button data-tooltip-id="new-conversation-tooltip" class="cursor-pointer">
              New Chat
            </button>
            <div role="article" aria-label="User message">
              <div>Previous conversation message content</div>
            </div>
          </div>
        </body>
      </html>
    `, { url: 'http://localhost' });

    const doc = dom.window.document;
    const win = dom.window;
    const newBtn = doc.querySelector('button[data-tooltip-id="new-conversation-tooltip"]') as HTMLButtonElement;

    // Simulate transition when newBtn is clicked:
    newBtn.addEventListener('click', () => {
      // 1. Immediately, newBtn acquires cursor-not-allowed
      newBtn.className = 'cursor-not-allowed';
      newBtn.setAttribute('disabled', '');
      newBtn.disabled = true;

      // 2. After 100ms, old messages unmount and new editor mounts in DOM
      setTimeout(() => {
        const oldMsg = doc.querySelector('div[role="article"]');
        if (oldMsg && oldMsg.parentElement) {
          oldMsg.parentElement.removeChild(oldMsg);
        }

        const inputContainer = doc.createElement('div');
        inputContainer.setAttribute('id', 'antigravity.agentSidePanelInputBox');

        const editor = doc.createElement('div');
        editor.setAttribute('data-lexical-editor', 'true');
        editor.setAttribute('contenteditable', 'true');
        editor.setAttribute('role', 'textbox');
        editor.innerHTML = '<p><br></p>'; // empty editor
        inputContainer.appendChild(editor);

        const sendBtn = doc.createElement('button');
        sendBtn.setAttribute('data-testid', 'send-button');
        sendBtn.setAttribute('disabled', '');
        sendBtn.disabled = true;
        sendBtn.className = 'cursor-not-allowed bg-secondary';
        inputContainer.appendChild(sendBtn);

        doc.body.appendChild(inputContainer);
      }, 100);
    });

    const result = await handleOpenNewConversation({
      document: doc,
      window: win,
      timeoutMs: 2000,
      intervalMs: 25
    });

    assert.strictEqual(result.success, true, 'handleOpenNewConversation must confirm readiness');
    assert.strictEqual(result.alreadyNew, false, 'Was not already new');
    assert.strictEqual(result.editorReady, true, 'Editor container mount must be confirmed');
    assert.ok(result.durationMs >= 90, `Waited for old unmount and new mount (${result.durationMs}ms)`);

    // Verify alias equality
    assert.strictEqual(typeof handleOpenNewConversation, 'function');
    assert.strictEqual(typeof triggerNewConversation, 'function');

    console.log(`  ✓ New conversation transition and editor readiness verified in ${result.durationMs}ms.`);
  }

  // --------------------------------------------------------------------------
  // Test 5: Fallback to Enter Key Only When Send Button is Fully Absent from DOM
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 5: Fallback to Enter Key ONLY Permitted When NO Send Button Exists Anywhere...');
  {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="antigravity.agentSidePanelInputBox">
            <div data-lexical-editor="true" contenteditable="true" role="textbox">
              <p>Type something</p>
            </div>
            <!-- Intentionally NO button in the DOM -->
          </div>
        </body>
      </html>
    `, { url: 'http://localhost' });

    const doc = dom.window.document;
    const win = dom.window;
    const inputElem = doc.querySelector('div[data-lexical-editor="true"]') as HTMLElement;

    let enterReceived = false;
    inputElem.addEventListener('keydown', (e: any) => {
      if (e.key === 'Enter') {
        enterReceived = true;
        // Simulate editor clearance upon Enter
        inputElem.innerHTML = '';
        inputElem.textContent = '';
      }
    });

    const result = await injectPromptAndSubmit('Fallback prompt without button', {
      document: doc,
      window: win,
      allowShortTimeout: true,
      pollTimeoutMs: 50,
      pollIntervalMs: 15
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.submitStrategy, 'enterKey');
    assert.strictEqual(result.enterDispatched, true);
    assert.strictEqual(result.sendButtonClicked, false);
    assert.strictEqual(enterReceived, true);

    console.log('  ✓ Enter fallback correctly dispatched when send button is completely absent from DOM.');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL Phase 01 DOM Bridge Readiness & Strict Rejection Tests PASSED!');
  console.log('================================================================\n');
}

// Support both Mocha runner and standalone node execution
const isMochaRunning = typeof (global as any).describe === 'function';
if (isMochaRunning) {
  (global as any).describe('Phase 01: DOM Bridge Button Readiness Polling & Strict Rejection', function (this: any) {
    if (this && typeof this.timeout === 'function') {
      this.timeout(15000);
    }
    (global as any).it('executes full Phase 01 readiness and rejection test suite', async () => {
      await runTests();
    });
  });
} else {
  runTests().catch(err => {
    console.error('\n❌ Test failed with error:', err);
    process.exit(1);
  });
}
