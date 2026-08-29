// Standalone test suite for Phase 03: Renderer DOM Diagnostic Engine & Error Recording
const Module = require('module');
const originalRequire = Module.prototype.require;

// Mock 'vscode' module for standalone node execution
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      window: {
        createOutputChannel: (name: string) => ({
          name,
          lines: [] as string[],
          appendLine(l: string) { this.lines.push(l); },
          append(t: string) { this.lines.push(t); },
          show() {},
          dispose() {}
        }),
        showWarningMessage: () => {}
      },
      workspace: {
        getConfiguration: () => ({
          get: (_k: string, d: any) => d,
          update: async () => {}
        })
      },
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
import * as os from 'os';
import * as http from 'http';
import { BridgeServer } from '../bridgeServer';
import { DebugLogger } from '../debugLogger';
import { installBridgeScript, isBridgeInstalled, removeBridgeTagsFromHtml } from '../workbenchInjector';

// Dynamically load media/autoplan-dom-bridge.js
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
  throw new Error('media/autoplan-dom-bridge.js not found');
}

// Lightweight DOM mocks supporting shadow roots, iframes, and selector matching
class MockEvent {
  public type: string;
  public bubbles: boolean;
  public cancelable: boolean;
  public target: any = null;

  constructor(type: string, init: any = {}) {
    this.type = type;
    this.bubbles = init.bubbles !== false;
    this.cancelable = init.cancelable !== false;
  }
}

class MockInputEvent extends MockEvent {
  public inputType: string;
  public data: string;

  constructor(type: string, init: any = {}) {
    super(type, init);
    this.inputType = init.inputType || '';
    this.data = init.data || '';
  }
}

class MockKeyboardEvent extends MockEvent {
  public key: string;
  public code: string;
  public keyCode: number;
  public which: number;

  constructor(type: string, init: any = {}) {
    super(type, init);
    this.key = init.key || '';
    this.code = init.code || '';
    this.keyCode = init.keyCode || 0;
    this.which = init.which || 0;
  }
}

class MockClassList {
  private set = new Set<string>();

  constructor(initial: string = '') {
    if (initial) {
      initial.split(/\s+/).filter(Boolean).forEach(c => this.set.add(c));
    }
  }

  add(...tokens: string[]) {
    tokens.forEach(t => this.set.add(t));
  }

  remove(...tokens: string[]) {
    tokens.forEach(t => this.set.delete(t));
  }

  contains(token: string): boolean {
    return this.set.has(token);
  }

  toString(): string {
    return Array.from(this.set).join(' ');
  }
}

class MockElement {
  public tagName: string;
  public id: string = '';
  public attributes: Record<string, string> = {};
  public style: Record<string, string> = {};
  public disabled: boolean = false;
  public value: string = '';
  public placeholder: string = '';
  public contentEditable: string = 'inherit';
  public innerText: string = '';
  public textContent: string = '';
  public classList: MockClassList;
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public ownerDocument: any = null;
  public shadowRoot: MockElement | null = null;
  public isCrossOriginRestricted: boolean = false;
  public contentDocumentRef: any = null;
  public clicked: boolean = false;
  public focused: boolean = false;
  public dispatchedEvents: MockEvent[] = [];
  public boundingClientRect = { width: 100, height: 30 };

  constructor(tagName: string, ownerDoc?: any) {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList();
    this.ownerDocument = ownerDoc || null;
  }

  get className(): string {
    return this.classList.toString();
  }

  set className(val: string) {
    this.classList = new MockClassList(val);
  }

  get contentDocument(): any {
    if (this.isCrossOriginRestricted) {
      const err: any = new Error('Permission denied to access cross-origin frame');
      err.name = 'SecurityError';
      err.code = 18;
      throw err;
    }
    return this.contentDocumentRef;
  }

  get contentWindow(): any {
    if (this.isCrossOriginRestricted) {
      const err: any = new Error('Blocked a frame with origin from accessing a cross-origin frame');
      err.name = 'SecurityError';
      throw err;
    }
    return this.contentDocumentRef ? { document: this.contentDocumentRef } : null;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name.toLowerCase()] = String(value);
    if (name.toLowerCase() === 'class') {
      this.className = value;
    }
    if (name.toLowerCase() === 'id') {
      this.id = value;
    }
    if (name.toLowerCase() === 'placeholder') {
      this.placeholder = value;
    }
    if (name.toLowerCase() === 'contenteditable') {
      this.contentEditable = value;
    }
  }

  getAttribute(name: string): string | null {
    const val = this.attributes[name.toLowerCase()];
    return val !== undefined ? val : null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes[name.toLowerCase()] !== undefined;
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  getBoundingClientRect() {
    return this.boundingClientRect;
  }

  focus() {
    this.focused = true;
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  click() {
    this.clicked = true;
  }

  dispatchEvent(evt: MockEvent): boolean {
    evt.target = this;
    this.dispatchedEvents.push(evt);
    return !evt.cancelable;
  }

  matches(selector: string): boolean {
    const sel = selector.trim();
    if (sel.includes(',')) {
      return sel.split(',').some(s => this.matches(s.trim()));
    }
    if (sel === '*') return true;
    if (sel === this.tagName.toLowerCase() || sel === this.tagName) return true;

    // Class selector: e.g. .interactive-session or div.chat-input
    if (sel.startsWith('.')) {
      return this.classList.contains(sel.slice(1));
    }
    if (sel.includes('.')) {
      const parts = sel.split('.');
      const tagMatch = !parts[0] || parts[0].toUpperCase() === this.tagName;
      const classMatch = parts.slice(1).every(c => this.classList.contains(c));
      return tagMatch && classMatch;
    }

    // Attribute selector: e.g. button[aria-label*="Send"] or [contenteditable="true"]
    const attrMatch = sel.match(/^([a-zA-Z0-9_-]*?)\[([a-zA-Z0-9_-]+)([\*\$\^]?=)"?([^"\]]*)"?\]$/);
    if (attrMatch) {
      const reqTag = attrMatch[1];
      const attrName = attrMatch[2].toLowerCase();
      const op = attrMatch[3];
      const expectedVal = attrMatch[4];

      if (reqTag && reqTag.toUpperCase() !== this.tagName) {
        return false;
      }
      const actualVal = this.getAttribute(attrName) ?? (this as any)[attrName];
      if (actualVal === undefined || actualVal === null) return false;
      const strVal = String(actualVal);
      if (op === '*=') return strVal.includes(expectedVal);
      if (op === '=') return strVal === expectedVal;
      return true;
    }

    return false;
  }

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (curr.matches(selector)) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const trimmed = selector.trim();
    if (trimmed.includes(',')) {
      const parts = trimmed.split(',').map(s => s.trim());
      const set = new Set<MockElement>();
      for (const p of parts) {
        this.querySelectorAll(p).forEach(el => set.add(el));
      }
      return Array.from(set);
    }

    // Descendant selector support: "parent child"
    if (trimmed.includes(' ')) {
      const tokens = trimmed.split(/\s+/);
      let currentMatches = this.querySelectorAll(tokens[0]);
      for (let i = 1; i < tokens.length; i++) {
        const nextToken = tokens[i];
        const nextMatches: MockElement[] = [];
        for (const m of currentMatches) {
          nextMatches.push(...m.querySelectorAll(nextToken));
        }
        currentMatches = Array.from(new Set(nextMatches));
      }
      return currentMatches;
    }

    const matches: MockElement[] = [];
    const walk = (node: MockElement) => {
      for (const ch of node.children) {
        if (ch.matches(trimmed)) {
          matches.push(ch);
        }
        walk(ch);
      }
    };
    walk(this);
    return matches;
  }
}

class MockDocument {
  public documentElement: MockElement;
  public body: MockElement;
  public activeElement: MockElement | null = null;
  public title: string = 'Test Document Title';
  public execCommandCalls: Array<{ command: string; showUI: boolean; value: any }> = [];

  constructor() {
    this.documentElement = new MockElement('HTML', this);
    this.body = new MockElement('BODY', this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName: string): MockElement {
    return new MockElement(tagName, this);
  }

  querySelectorAll(selector: string): MockElement[] {
    const matches: MockElement[] = [];
    if (this.documentElement.matches(selector)) {
      matches.push(this.documentElement);
    }
    matches.push(...this.documentElement.querySelectorAll(selector));
    return Array.from(new Set(matches));
  }

  execCommand(command: string, showUI: boolean = false, value: any = null): boolean {
    this.execCommandCalls.push({ command, showUI, value });
    return true;
  }
}

class MockWindow {
  public document: MockDocument;
  public location = { href: 'vscode-file://vscode-app/workbench.html' };
  public Event = MockEvent;
  public InputEvent = MockInputEvent;
  public KeyboardEvent = MockKeyboardEvent;
  public HTMLTextAreaElement = {
    prototype: {
      value: ''
    }
  };

  constructor(doc: MockDocument) {
    this.document = doc;
  }
}

async function runPhase03Tests() {
  console.log('=== Running Phase 03: Renderer DOM Diagnostic Engine Verification Test ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge, 'autoplan-dom-bridge.js module must be loaded');

  const mockDoc = new MockDocument();
  const mockWin = new MockWindow(mockDoc);

  // --------------------------------------------------------------------------
  // Test 1: queryDeep Shadow Roots, Iframe Safety, and Scoped Container Fallback
  // --------------------------------------------------------------------------
  console.log('[Test 1] Verifying queryDeep traversal across shadow roots, iframes, and scoped fallback...');

  // 1.1 Shadow Root Traversal
  const hostElem = mockDoc.createElement('div');
  hostElem.className = 'shadow-host';
  const shadowRootElem = new MockElement('DIV', mockDoc);
  const deepShadowButton = mockDoc.createElement('button');
  deepShadowButton.className = 'codicon-send';
  shadowRootElem.appendChild(deepShadowButton);
  hostElem.shadowRoot = shadowRootElem;
  mockDoc.body.appendChild(hostElem);

  const shadowMatches = domBridge.queryDeep('.codicon-send', mockDoc);
  assert.strictEqual(shadowMatches.length, 1, 'queryDeep must discover element inside shadowRoot');
  assert.strictEqual(shadowMatches[0], deepShadowButton);
  console.log('  ✔ Discovered element inside nested shadowRoot');

  // 1.2 Child Iframe Traversal (Accessible)
  const accessibleIframe = mockDoc.createElement('iframe');
  accessibleIframe.id = 'frame-accessible';
  const frameDoc = new MockDocument();
  const iframeTarget = frameDoc.createElement('textarea');
  iframeTarget.className = 'inputarea';
  frameDoc.body.appendChild(iframeTarget);
  accessibleIframe.contentDocumentRef = frameDoc;
  mockDoc.body.appendChild(accessibleIframe);

  const iframeMatches = domBridge.queryDeep('textarea.inputarea', mockDoc);
  assert.strictEqual(iframeMatches.length, 1, 'queryDeep must safely traverse into accessible iframe');
  assert.strictEqual(iframeMatches[0], iframeTarget);
  console.log('  ✔ Safely traversed into accessible child iframe document');

  // 1.3 Child Iframe Cross-Origin Security Error (Inaccessible)
  const restrictedIframe = mockDoc.createElement('iframe');
  restrictedIframe.id = 'frame-cross-origin';
  restrictedIframe.isCrossOriginRestricted = true;
  mockDoc.body.appendChild(restrictedIframe);

  // Should NOT throw exception
  let safeSearchWorked = false;
  try {
    const results = domBridge.queryDeep('button', mockDoc);
    assert.ok(Array.isArray(results), 'queryDeep should return array even with cross-origin iframe');
    safeSearchWorked = true;
  } catch (err) {
    assert.fail(`queryDeep must not throw on cross-origin iframe: ${err}`);
  }
  assert.strictEqual(safeSearchWorked, true);
  console.log('  ✔ Handled cross-origin iframe without throwing SecurityError');

  // 1.4 Scoped Container 0-Match Fallback to Full Document Tree
  // Create an empty .interactive-session container (0 matches for target)
  const emptyContainer = mockDoc.createElement('div');
  emptyContainer.className = 'interactive-session';
  mockDoc.body.appendChild(emptyContainer);

  // Put target OUTSIDE .interactive-session in full document tree
  const outsideTarget = mockDoc.createElement('textarea');
  outsideTarget.setAttribute('placeholder', 'Ask anything...');
  mockDoc.body.appendChild(outsideTarget);

  const fallbackResults = domBridge.queryDeep('textarea[placeholder*="Ask"]', mockDoc);
  assert.strictEqual(fallbackResults.length, 1, 'Scoped search producing 0 matches MUST fall back to full document tree');
  assert.strictEqual(fallbackResults[0], outsideTarget);
  console.log('  ✔ Scoped container 0-match fallback searched full document tree');

  // --------------------------------------------------------------------------
  // Test 2: findChatInput DOM Diagnostic Snapshot Engine on Resolution Failure
  // --------------------------------------------------------------------------
  console.log('\n[Test 2] Verifying findChatInput capture of structured DomDiagnosticSnapshot on failure...');

  const emptyDoc = new MockDocument();
  // Set activeElement
  const focusedDiv = emptyDoc.createElement('div');
  focusedDiv.id = 'focused-dummy';
  focusedDiv.className = 'monaco-list';
  emptyDoc.activeElement = focusedDiv;

  // Add dummy disabled textarea to test textarea metadata collection
  const hiddenTa = emptyDoc.createElement('textarea');
  hiddenTa.className = 'hidden-input';
  hiddenTa.placeholder = 'Search';
  hiddenTa.disabled = true;
  emptyDoc.body.appendChild(hiddenTa);

  // Add a contenteditable element with display:none to test contentEditables capture on invisible elements
  const ceElem = emptyDoc.createElement('div');
  ceElem.setAttribute('contenteditable', 'true');
  ceElem.setAttribute('role', 'textbox');
  ceElem.style = { display: 'none' };
  emptyDoc.body.appendChild(ceElem);

  const diagOut: any = {};
  const foundInput = domBridge.findChatInput(emptyDoc, diagOut);
  assert.strictEqual(foundInput, null, 'findChatInput should return null when no chat input matches');

  const snapshot = diagOut.snapshot || domBridge.findChatInput.lastSnapshot;
  assert.ok(snapshot, 'Snapshot must be captured and attached');
  assert.ok(typeof snapshot.timestamp === 'number', 'Snapshot must have valid timestamp');
  assert.strictEqual(snapshot.activeElement.id, 'focused-dummy');
  assert.strictEqual(snapshot.activeElement.className, 'monaco-list');
  assert.ok(Array.isArray(snapshot.textareas), 'Snapshot must list textareas');
  assert.strictEqual(snapshot.textareas.length, 1);
  assert.strictEqual(snapshot.textareas[0].disabled, true);
  assert.strictEqual(snapshot.textareas[0].placeholder, 'Search');

  assert.ok(Array.isArray(snapshot.contentEditables), 'Snapshot must list contentEditables');
  assert.strictEqual(snapshot.contentEditables.length, 1);
  assert.strictEqual(snapshot.contentEditables[0].role, 'textbox');

  assert.ok(Array.isArray(snapshot.evaluatedSelectors), 'Snapshot must list evaluatedSelectors');
  assert.ok(snapshot.evaluatedSelectors.length >= 10, 'Must record all evaluated selectors');
  for (const s of snapshot.evaluatedSelectors) {
    assert.ok(typeof s.selector === 'string', 'Selector must be string');
    assert.ok(typeof s.matches === 'number', 'Matches count must be number');
  }
  console.log(`  ✔ Snapshot captured: ${snapshot.evaluatedSelectors.length} evaluated selectors, activeElement="${snapshot.activeElement.id}"`);

  // --------------------------------------------------------------------------
  // Test 3: findSendButton Failure Diagnostics & Nearby Buttons Capture
  // --------------------------------------------------------------------------
  console.log('\n[Test 3] Verifying findSendButton nearby button diagnostics on failure...');

  const buttonTestDoc = new MockDocument();
  // Add some unrelated buttons nearby
  const closeBtn = buttonTestDoc.createElement('button');
  closeBtn.className = 'monaco-button';
  closeBtn.setAttribute('aria-label', 'Close Tab');
  buttonTestDoc.body.appendChild(closeBtn);

  const gearBtn = buttonTestDoc.createElement('button');
  gearBtn.className = 'codicon-gear';
  gearBtn.setAttribute('title', 'Settings');
  buttonTestDoc.body.appendChild(gearBtn);

  const btnDiag: any = {};
  const foundBtn = domBridge.findSendButton(buttonTestDoc, btnDiag);
  assert.strictEqual(foundBtn, null, 'findSendButton must return null when no submit button matches');

  const btnFailureDiag = btnDiag.diagnostics || domBridge.findSendButton.lastDiagnostics;
  assert.ok(btnFailureDiag, 'Failure diagnostics must be recorded');
  assert.ok(Array.isArray(btnFailureDiag.evaluatedSelectors), 'Evaluated selectors must be captured');
  assert.ok(Array.isArray(btnFailureDiag.nearbyButtons), 'Nearby buttons must be captured');
  assert.strictEqual(btnFailureDiag.nearbyButtons.length, 2);
  const closeMeta = btnFailureDiag.nearbyButtons.find((b: any) => b.ariaLabel === 'Close Tab');
  assert.ok(closeMeta, 'Must include Close Tab button in nearby buttons list');
  console.log(`  ✔ Captured ${btnFailureDiag.nearbyButtons.length} nearby buttons on send button resolution failure`);

  // --------------------------------------------------------------------------
  // Test 4: injectPromptAndSubmit Step-by-Step Execution Diagnostics
  // --------------------------------------------------------------------------
  console.log('\n[Test 4] Verifying injectPromptAndSubmit step-by-step progress and diagnostic report...');

  const promptDoc = new MockDocument();
  const promptWin = new MockWindow(promptDoc);

  // 4.1 Successful Injection into textarea
  const chatInput = promptDoc.createElement('textarea');
  chatInput.className = 'interactive-input-editor';
  promptDoc.body.appendChild(chatInput);

  const sendBtn = promptDoc.createElement('button');
  sendBtn.setAttribute('aria-label', 'Send');
  promptDoc.body.appendChild(sendBtn);

  const promptText = 'Test prompt with diagnostics';
  const report = await domBridge.injectPromptAndSubmit(promptText, {
    document: promptDoc,
    window: promptWin
  });

  assert.strictEqual(report.success, true);
  assert.strictEqual(report.injectionStrategy, 'textarea-value');
  assert.strictEqual(report.sendButtonClicked, true);
  assert.strictEqual(report.charsInjected, promptText.length);
  assert.strictEqual(chatInput.value, promptText);
  assert.strictEqual(sendBtn.clicked, true);

  // Verify steps structure
  assert.ok(Array.isArray(report.steps), 'Report must contain steps array');
  assert.strictEqual(report.steps.length, 4, 'Must report 4 steps');
  assert.strictEqual(report.steps[0].step, 1);
  assert.strictEqual(report.steps[0].name, 'Input discovery & focus');
  assert.strictEqual(report.steps[0].status, 'success');

  assert.strictEqual(report.steps[1].step, 2);
  assert.strictEqual(report.steps[1].name, 'Content injection');
  assert.strictEqual(report.steps[1].strategy, 'textarea-value');

  assert.strictEqual(report.steps[2].step, 3);
  assert.strictEqual(report.steps[2].name, 'Event dispatching');
  assert.ok(report.steps[2].events.includes('input'));

  assert.strictEqual(report.steps[3].step, 4);
  assert.strictEqual(report.steps[3].name, 'Submit triggering');
  assert.strictEqual(report.steps[3].sendButtonClicked, true);
  assert.strictEqual(report.steps[3].enterDispatched, true);
  console.log('  ✔ Step-by-step injection report generated for textarea');

  // 4.2 ContentEditable injection
  const ceDoc = new MockDocument();
  const ceWin = new MockWindow(ceDoc);
  const ceInput = ceDoc.createElement('div');
  ceInput.className = 'monaco-editor';
  ceInput.setAttribute('contenteditable', 'true');
  ceDoc.body.appendChild(ceInput);

  const ceReport = await domBridge.injectPromptAndSubmit('Rich text prompt', {
    document: ceDoc,
    window: ceWin,
    targetElement: ceInput
  });
  assert.strictEqual(ceReport.success, true);
  assert.strictEqual(ceReport.injectionStrategy, 'execCommand');
  assert.strictEqual(ceDoc.execCommandCalls.length, 2, 'Should call selectAll and insertText');
  console.log('  ✔ Step-by-step injection report generated for contenteditable via execCommand');

  // 4.3 Failure attaches DomDiagnosticSnapshot to Error
  const failDoc = new MockDocument();
  let threwError = false;
  try {
    await domBridge.injectPromptAndSubmit('Will fail', { document: failDoc, window: promptWin });
  } catch (err: any) {
    threwError = true;
    assert.ok(err.domSnapshot, 'Error must include attached domSnapshot');
    assert.ok(Array.isArray(err.steps), 'Error must include steps array');
    assert.strictEqual(err.steps[0].status, 'failed');
  }
  assert.strictEqual(threwError, true, 'injectPromptAndSubmit must throw when no input found');
  console.log('  ✔ Error on missing input contains attached domSnapshot and failed step');

  // --------------------------------------------------------------------------
  // Test 5: DomBridgeClient Telemetry Queue & Automatic Flush to POST /autoplan-log
  // --------------------------------------------------------------------------
  console.log('\n[Test 5] Verifying DomBridgeClient log queuing, startup telemetry, and HTTP flush...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase03-client-test-'));
  const testLogger = new DebugLogger(500);

  const server = new BridgeServer({
    portStart: 49400,
    portEnd: 49450,
    host: '127.0.0.1',
    workbenchDir: tempDir,
    logger: testLogger
  });

  const serverPort = await server.start();
  assert.ok(serverPort > 0);

  // Helper HTTP fetch mock for DomBridgeClient
  const createMockFetch = () => {
    return async (urlStr: string, init: any = {}) => {
      const parsed = new URL(urlStr);
      return new Promise<{ status: number; ok: boolean; json: () => Promise<any> }>((resolve, reject) => {
        const req = http.request({
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: init.method || 'GET',
          headers: init.headers || {}
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
              json: async () => JSON.parse(data || '{}')
            });
          });
        });
        req.on('error', reject);
        if (init.body) {
          req.write(init.body);
        }
        req.end();
      });
    };
  };

  const clientDoc = new MockDocument();
  const clientWin = new MockWindow(clientDoc);
  const clientInputArea = clientDoc.createElement('textarea');
  clientInputArea.className = 'interactive-input-editor';
  clientDoc.body.appendChild(clientInputArea);
  const clientSendBtn = clientDoc.createElement('button');
  clientSendBtn.setAttribute('aria-label', 'Send');
  clientDoc.body.appendChild(clientSendBtn);

  const testWinKey = `win_telemetry_${Date.now()}`;
  const client = new domBridge.DomBridgeClient({
    portStart: serverPort,
    portEnd: serverPort,
    windowKey: testWinKey,
    autoApproval: false,
    document: clientDoc,
    window: clientWin,
    fetch: createMockFetch()
  });

  // 5.1 Early log queue before port discovery
  assert.strictEqual(client.serverPort, null, 'serverPort must initially be null');
  await client.sendClientLog('INFO', 'Pre-connect early diagnostic log 1', { tag: 'init' });
  await client.sendClientLog('WARN', 'Pre-connect early diagnostic log 2', { tag: 'warning' });
  assert.strictEqual(client.logQueue.length >= 2, true, 'Early logs must be queued in memory');
  console.log(`  ✔ Queued ${client.logQueue.length} pre-connect startup logs in DomBridgeClient`);

  // 5.2 Discover port and automatically flush startup logs
  const discoveredPort = await client.discoverPort();
  assert.strictEqual(discoveredPort, serverPort, 'Client must discover active server port');
  assert.strictEqual(client.logQueue.length, 0, 'Log queue must be flushed after discovering port');

  // Verify server ingested the queued logs into DebugLogger
  const clientLogs = testLogger.getEntries().filter(e => e.component === 'CLIENT');
  assert.ok(clientLogs.length >= 3, 'Server must have received client startup telemetry and queued logs');
  const initEntry = clientLogs.find(e => e.message.includes('Initializing DOM Bridge Client'));
  assert.ok(initEntry, 'Must log DomBridgeClient initialization with version and windowKey');
  assert.strictEqual(initEntry!.details.clientVersion, '2.0.0');

  const preLog1 = clientLogs.find(e => e.message.includes('Pre-connect early diagnostic log 1'));
  assert.ok(preLog1, 'Server must ingest early buffered log 1');
  console.log('  ✔ Flushed queued logs and startup telemetry to BridgeServer POST /autoplan-log');

  // 5.3 Verify command execution with full step diagnostics returned in ACK
  client.start();

  const promptResult = await server.dispatchPromptCommand('Hello from Phase 03 test', {
    windowKey: testWinKey,
    timeoutMs: 3000
  });

  assert.strictEqual(promptResult.success, true);
  assert.strictEqual(promptResult.status, 'submitClicked');
  assert.ok(promptResult.metadata, 'ACK result must contain metadata');
  assert.ok(Array.isArray(promptResult.metadata.steps), 'Metadata must contain step-by-step diagnostic steps');
  assert.strictEqual(promptResult.metadata.steps.length, 4);
  console.log('  ✔ Dispatched command received and returned structured steps in ACK payload');

  client.stop();
  await server.stop();

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}

  // --------------------------------------------------------------------------
  // Test 6: Synchronize Workbench Injector Updates Script File
  // --------------------------------------------------------------------------
  console.log('\n[Test 6] Verifying workbenchInjector copies updated diagnostic script to workbench directory...');

  const mockWbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase03-wb-test-'));
  const mockWbHtml = path.join(mockWbDir, 'workbench.html');
  const mockSidecarJs = path.join(mockWbDir, 'autoplan-dom-bridge.js');

  // Write initial workbench.html and outdated script file
  fs.writeFileSync(mockWbHtml, '<html><head></head><body><!-- AUTO-PLAN-BRIDGE-START -->\n<script src="autoplan-dom-bridge.js?v=1"></script>\n<!-- AUTO-PLAN-BRIDGE-END -->\n</body></html>', 'utf8');
  fs.writeFileSync(mockSidecarJs, '/* Old Outdated Script Version */', 'utf8');

  // Run installBridgeScript
  const injectResult = installBridgeScript({
    workbenchPath: mockWbHtml,
    updateChecksums: false
  });

  assert.strictEqual(injectResult.success, true, 'installBridgeScript must succeed');
  assert.strictEqual(isBridgeInstalled(mockWbHtml), true, 'Bridge must be installed');

  const updatedScriptContent = fs.readFileSync(mockSidecarJs, 'utf8');
  assert.ok(updatedScriptContent.includes('captureDomDiagnosticSnapshot'), 'WorkbenchInjector must copy updated diagnostic script to workbench dir');
  console.log('  ✔ workbenchInjector successfully updated sidecar script with Phase 03 diagnostic engine');

  try {
    fs.rmSync(mockWbDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 03 RENDERER DOM DIAGNOSTICS TESTS PASSED!');
  console.log('======================================================\n');
}

runPhase03Tests().catch(err => {
  console.error('Phase 03 Test Suite Failed:', err);
  process.exit(1);
});
