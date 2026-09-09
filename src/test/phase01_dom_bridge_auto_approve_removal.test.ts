// Self-healing ESM require guard for JSDOM in Node < 20.19 CommonJS
if (!process.env.__PHASE01_DOM_REMOVAL_REEXEC__) {
  try {
    require('jsdom');
  } catch (e: any) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      const { execFileSync } = require('child_process');
      const env = {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-require-module`.trim(),
        __PHASE01_DOM_REMOVAL_REEXEC__: '1'
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
      delete require.cache[require.resolve(p)];
      return require(p);
    }
  }
  throw new Error('Could not locate media/autoplan-dom-bridge.js');
}

async function runPhase01Verification() {
  console.log('================================================================');
  console.log(' Phase 01: DOM Bridge Auto-Approver Removal Comprehensive Test');
  console.log('================================================================\n');

  // 1. Static Source Code Cleanliness Inspection
  console.log('[Test 1] Verifying source code eradication of approval observer routines...');
  const scriptPath = path.resolve(__dirname, '../../media/autoplan-dom-bridge.js');
  const sourceCode = fs.readFileSync(
    fs.existsSync(scriptPath) ? scriptPath : path.resolve(process.cwd(), 'media/autoplan-dom-bridge.js'),
    'utf8'
  );

  assert.strictEqual(
    sourceCode.includes('DEFAULT_APPROVAL_PATTERNS'),
    false,
    'DEFAULT_APPROVAL_PATTERNS must be completely removed from script'
  );
  assert.strictEqual(
    sourceCode.includes('function startAutoApprovalObserver'),
    false,
    'startAutoApprovalObserver function must be completely deleted'
  );
  assert.strictEqual(
    sourceCode.includes('this.approvalObserver'),
    false,
    'this.approvalObserver property references must be completely removed from client'
  );
  assert.strictEqual(
    sourceCode.includes('this.autoApprovalEnabled'),
    false,
    'this.autoApprovalEnabled property references must be completely removed from client'
  );
  console.log('  ✓ Verified: Source code contains zero approval observer patterns or property bindings.\n');

  // 2. Module Export Invariants
  console.log('[Test 2] Verifying module exports after auto-approver removal...');
  const domBridge = loadDomBridge();

  assert.strictEqual(
    (domBridge as any).DEFAULT_APPROVAL_PATTERNS,
    undefined,
    'DEFAULT_APPROVAL_PATTERNS must not be exported'
  );
  assert.strictEqual(
    (domBridge as any).startAutoApprovalObserver,
    undefined,
    'startAutoApprovalObserver must not be exported'
  );
  assert.strictEqual(
    typeof domBridge.DomBridgeClient,
    'function',
    'DomBridgeClient class must remain exported'
  );
  assert.strictEqual(
    typeof domBridge.DOMAutomationBridgeClient,
    'function',
    'DOMAutomationBridgeClient alias must be exported for backwards compatibility'
  );
  assert.strictEqual(
    domBridge.DOMAutomationBridgeClient,
    domBridge.DomBridgeClient,
    'DOMAutomationBridgeClient must reference DomBridgeClient'
  );
  console.log('  ✓ Verified: Deprecated approval symbols are absent from exports while bridge client remains intact.\n');

  // 3. Client Instantiation & Lifecycle (Zero Polling Timers for Approvals)
  console.log('[Test 3] Verifying DOMAutomationBridgeClient lifecycle creates no approval observer...');
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
      <head><title>Test Workspace - Visual Studio Code</title></head>
      <body>
        <div id="antigravity.agentSidePanelInputBox">
          <div data-lexical-editor="true" contenteditable="true" role="textbox"></div>
          <button data-testid="send-button" aria-label="Send message">Send</button>
        </div>
        <div class="monaco-dialog-box">
          <button id="btn-allow" class="monaco-button">Allow</button>
          <button id="btn-always-allow" class="dialog-button">Always Allow</button>
          <button id="btn-run" class="monaco-button">Run</button>
        </div>
      </body>
    </html>
  `, { runScripts: 'outside-only', url: 'http://localhost' });

  const { window } = dom;
  let allowButtonClicked = false;
  let alwaysAllowButtonClicked = false;
  let runButtonClicked = false;

  window.document.getElementById('btn-allow')?.addEventListener('click', () => {
    allowButtonClicked = true;
  });
  window.document.getElementById('btn-always-allow')?.addEventListener('click', () => {
    alwaysAllowButtonClicked = true;
  });
  window.document.getElementById('btn-run')?.addEventListener('click', () => {
    runButtonClicked = true;
  });

  const ClientClass = domBridge.DOMAutomationBridgeClient || domBridge.DomBridgeClient;
  const client = new ClientClass({
    document: window.document,
    window: window,
    autoApproval: true // Legacy option should be gracefully ignored without setting property
  });

  assert.strictEqual((client as any).approvalObserver, undefined, 'client.approvalObserver must be undefined');
  assert.strictEqual((client as any).autoApprovalEnabled, undefined, 'client.autoApprovalEnabled must be undefined');

  // Start client
  client.start();
  assert.strictEqual(client.isRunning, true, 'Client should be marked as running');
  assert.strictEqual((client as any).approvalObserver, undefined, 'Running client must not instantiate approvalObserver');

  // Wait 100ms to confirm no background observer scans or clicks the permission buttons
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.strictEqual(allowButtonClicked, false, 'Allow button must NOT be clicked by background bridge');
  assert.strictEqual(alwaysAllowButtonClicked, false, 'Always Allow button must NOT be clicked by background bridge');
  assert.strictEqual(runButtonClicked, false, 'Run button must NOT be clicked by background bridge');

  // Verify clickApproval command handles cleanly with 0 clicks
  let ackSent: any = null;
  client.sendAck = async (id: string, status: string, error?: string, result?: any) => {
    ackSent = { id, status, error, result };
  };

  await client.handleCommand({ id: 'test-approval-cmd', type: 'clickApproval' });
  assert.ok(ackSent, 'clickApproval must emit ACK');
  assert.strictEqual(ackSent.status, 'completed');
  assert.strictEqual(ackSent.result?.clickedCount, 0, 'clickApproval must report 0 clickedCount');

  // Stop client
  client.stop();
  assert.strictEqual(client.isRunning, false, 'Client should be marked as not running after stop()');
  console.log('  ✓ Verified: Client runs without approval observer and triggers zero layout reflows or scans.\n');

  // 4. Core Bridge Functionality Regressions Check
  console.log('[Test 4] Verifying core prompt injection, submission, diagnostics, and workspace detection...');
  const inputEl = domBridge.findChatInput(window.document);
  assert.ok(inputEl, 'findChatInput must locate the lexical editor');
  assert.strictEqual(inputEl.getAttribute('data-lexical-editor'), 'true');

  const sendBtn = domBridge.findSendButton(window.document);
  assert.ok(sendBtn, 'findSendButton must locate the send button');
  assert.strictEqual(sendBtn.getAttribute('data-testid'), 'send-button');

  // Diagnostic snapshot check
  const snapshot = domBridge.captureDomDiagnosticSnapshot(window.document);
  assert.ok(snapshot, 'captureDomDiagnosticSnapshot should return snapshot object');
  assert.ok(Array.isArray(snapshot.contentEditables), 'Snapshot should list contentEditables');
  assert.strictEqual(snapshot.contentEditables.length, 1);

  // Workspace detection check
  const wsName = domBridge.detectWorkspaceName(window.document);
  assert.strictEqual(wsName, 'Test Workspace', 'detectWorkspaceName should correctly extract title workspace');

  // Prompt injection check
  let submitTriggered = false;
  sendBtn.addEventListener('click', () => {
    submitTriggered = true;
  });

  const injectionResult = await domBridge.injectPromptAndSubmit('Test Phase 01 Prompt', {
    document: window.document,
    window: window,
    allowEnterFallback: true
  });

  assert.ok(injectionResult, 'injectPromptAndSubmit should return result');
  assert.strictEqual(injectionResult.success, true, 'Prompt injection must report success');
  assert.strictEqual(submitTriggered, true, 'Send button must be clicked during prompt injection');
  console.log('  ✓ Verified: Core DOM Bridge capabilities (input discovery, send button, injection, diagnostics) operate flawlessly.\n');

  console.log('================================================================');
  console.log(' ALL PHASE 01 TESTS PASSED SUCCESSFULLY! (100% VERIFIED)');
  console.log('================================================================\n');
}

runPhase01Verification().catch(err => {
  console.error('Phase 01 Verification Test Failed:', err);
  process.exit(1);
});
