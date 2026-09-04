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

class MockClassList {
  private classes: Set<string> = new Set();

  constructor(className: string = '') {
    if (className) {
      className.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
    }
  }

  add(...tokens: string[]) {
    tokens.forEach(t => this.classes.add(t));
  }

  remove(...tokens: string[]) {
    tokens.forEach(t => this.classes.delete(t));
  }

  contains(token: string): boolean {
    return this.classes.has(token);
  }

  toString() {
    return Array.from(this.classes).join(' ');
  }
}

class MockEvent {
  public type: string;
  public bubbles: boolean;
  public cancelable: boolean;
  public composed: boolean;
  public target: any = null;

  constructor(type: string, options: any = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    this.composed = Boolean(options.composed);
  }
}

class MockInputEvent extends MockEvent {
  public inputType: string;
  public data: string;

  constructor(type: string, options: any = {}) {
    super(type, options);
    this.inputType = options.inputType || '';
    this.data = options.data || '';
  }
}

class MockMouseEvent extends MockEvent {
  public button: number;

  constructor(type: string, options: any = {}) {
    super(type, options);
    this.button = options.button !== undefined ? options.button : 0;
  }
}

class MockPointerEvent extends MockMouseEvent {
  constructor(type: string, options: any = {}) {
    super(type, options);
  }
}

class MockKeyboardEvent extends MockEvent {
  public key: string;
  public code: string;
  public keyCode: number;
  public which: number;
  public charCode: number;

  constructor(type: string, options: any = {}) {
    super(type, options);
    this.key = options.key || '';
    this.code = options.code || '';
    this.keyCode = options.keyCode !== undefined ? options.keyCode : 0;
    this.which = options.which !== undefined ? options.which : 0;
    this.charCode = options.charCode !== undefined ? options.charCode : 0;
  }
}

class MockElement {
  public nodeType: number = 1;
  public tagName: string;
  public id: string = '';
  public attributes: Map<string, string> = new Map();
  public classList: MockClassList;
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public parentNode: MockElement | null = null;
  public ownerDocument: any = null;
  public shadowRoot: MockElement | null = null;
  public disabled: boolean = false;
  private _textContent: string = '';
  private _innerText: string = '';
  public innerHTML: string = '';

  get textContent(): string {
    return this._textContent;
  }

  set textContent(val: string) {
    this._textContent = val;
    this._innerText = val;
  }

  get innerText(): string {
    return this._innerText;
  }

  set innerText(val: string) {
    this._innerText = val;
    this._textContent = val;
  }
  public value: string = '';
  public role: string = '';
  public title: string = '';
  public form: any = null;
  public clicked: boolean = false;
  public clickCount: number = 0;
  public dispatchedEvents: MockEvent[] = [];
  public eventListeners: Map<string, ((evt: any) => void)[]> = new Map();
  public rect: { width: number; height: number; top: number; left: number } = { width: 100, height: 30, top: 0, left: 0 };
  public offsetParent: MockElement | null = null;

  constructor(tagName: string, className: string = '') {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList(className);
    this.offsetParent = this;
  }

  get className(): string {
    return this.classList.toString();
  }

  set className(val: string) {
    this.classList = new MockClassList(val);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
    if (name === 'id') this.id = value;
    if (name === 'role') this.role = value;
    if (name === 'title') this.title = value;
    if (name === 'value') this.value = value;
  }

  getAttribute(name: string): string | null {
    if (name === 'class') return this.className || null;
    if (name === 'id') return this.id || null;
    if (name === 'role') return this.role || null;
    if (name === 'title') return this.title || null;
    if (name === 'value') return this.value || null;
    return this.attributes.get(name) || null;
  }

  hasAttribute(name: string): boolean {
    if (name === 'class') return Boolean(this.className);
    if (name === 'id') return Boolean(this.id);
    if (name === 'role') return Boolean(this.role);
    if (name === 'title') return Boolean(this.title);
    return this.attributes.has(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === 'id') this.id = '';
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: (evt: any) => void) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(listener);
  }

  click() {
    this.clicked = true;
    this.clickCount++;
    const clickEvt = new MockMouseEvent('click', { bubbles: true, cancelable: true });
    this.dispatchEvent(clickEvt);
  }

  focus(_options?: any) {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  dispatchEvent(event: any): boolean {
    event.target = this;
    this.dispatchedEvents.push(event);
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
    return true;
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

  getBoundingClientRect() {
    return this.rect;
  }

  matches(selector: string): boolean {
    if (!selector) return false;
    const commaParts = selector.split(',').map(s => s.trim());
    return commaParts.some(sel => this.matchCompound(sel));
  }

  private matchCompound(sel: string): boolean {
    const segments = this.splitSelectorSegments(sel);
    if (segments.length === 0) return false;
    if (segments.length === 1) {
      return this.matchSingleSegment(segments[0]);
    }

    const lastSeg = segments[segments.length - 1];
    if (!this.matchSingleSegment(lastSeg)) {
      return false;
    }

    let curr: MockElement | null = this.parentElement;
    let segIdx = segments.length - 2;
    while (curr && segIdx >= 0) {
      if (curr.matchSingleSegment(segments[segIdx])) {
        segIdx--;
      }
      curr = curr.parentElement;
    }

    return segIdx < 0;
  }

  private splitSelectorSegments(sel: string): string[] {
    const segments: string[] = [];
    let current = '';
    let inBracket = false;
    let inQuote: string | null = null;

    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (inQuote) {
        current += ch;
        if (ch === inQuote && sel[i - 1] !== '\\') {
          inQuote = null;
        }
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
        current += ch;
      } else if (ch === '[') {
        inBracket = true;
        current += ch;
      } else if (ch === ']') {
        inBracket = false;
        current += ch;
      } else if (/\s/.test(ch)) {
        if (inBracket) {
          current += ch;
        } else if (current.trim()) {
          segments.push(current.trim());
          current = '';
        }
      } else {
        current += ch;
      }
    }
    if (current.trim()) {
      segments.push(current.trim());
    }
    return segments;
  }

  public matchSingleSegment(sel: string): boolean {
    if (sel === '*' || sel === ':scope') return true;

    let working = sel;
    const idMatch = working.match(/#([a-zA-Z0-9_\-\\.]+)/);
    if (idMatch) {
      const rawId = idMatch[1].replace(/\\/g, '');
      if (this.id !== rawId) {
        return false;
      }
      working = working.replace(idMatch[0], '');
    }

    const tagMatch = working.match(/^[a-zA-Z0-9_-]+/);
    if (tagMatch) {
      if (tagMatch[0].toUpperCase() !== this.tagName) {
        return false;
      }
      working = working.replace(tagMatch[0], '');
    }

    const classMatches = working.match(/\.([a-zA-Z0-9_-]+)/g);
    if (classMatches) {
      for (const cm of classMatches) {
        const cls = cm.slice(1);
        if (!this.classList.contains(cls)) {
          return false;
        }
      }
      working = working.replace(/\.([a-zA-Z0-9_-]+)/g, '');
    }

    const attrMatches = working.match(/\[([a-zA-Z0-9_-]+)([*~|^$]?=)?['"]?([^'"\]]*)['"]?\]/g);
    if (attrMatches) {
      for (const am of attrMatches) {
        const inner = am.slice(1, -1);
        if (inner.includes('*=')) {
          const [attr, val] = inner.split('*=');
          const cleanVal = val.replace(/['"]/g, '');
          const actual = this.getAttribute(attr) || '';
          if (!actual.includes(cleanVal)) return false;
        } else if (inner.includes('=')) {
          const [attr, val] = inner.split('=');
          const cleanVal = val.replace(/['"]/g, '');
          const actual = this.getAttribute(attr);
          if (actual !== cleanVal) return false;
        } else {
          if (!this.hasAttribute(inner)) return false;
        }
      }
      working = working.replace(/\[([a-zA-Z0-9_-]+)([*~|^$]?=)?['"]?([^'"\]]*)['"]?\]/g, '');
    }

    return true;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const traverse = (node: MockElement) => {
      for (const child of node.children) {
        if (child.matches(selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }
}

class MockDocument {
  public body: MockElement;
  public documentElement: MockElement;
  public activeElement: MockElement | null = null;
  public hidden: boolean = false;

  constructor() {
    this.documentElement = new MockElement('html');
    this.documentElement.ownerDocument = this;
    this.body = new MockElement('body');
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }

  createElement(tagName: string): MockElement {
    const el = new MockElement(tagName);
    el.ownerDocument = this;
    return el;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    if (this.documentElement.matches(selector)) {
      results.push(this.documentElement);
    }
    results.push(...this.documentElement.querySelectorAll(selector));
    return results;
  }

  execCommand(command: string, _showUI?: boolean, value?: any): boolean {
    if (command === 'insertText' && value && this.activeElement) {
      this.activeElement.textContent = (this.activeElement.textContent || '') + value;
      this.activeElement.innerText = this.activeElement.textContent;
    }
    return true;
  }
}

function createMockWindow() {
  return {
    PointerEvent: MockPointerEvent,
    MouseEvent: MockMouseEvent,
    KeyboardEvent: MockKeyboardEvent,
    InputEvent: MockInputEvent,
    Event: MockEvent,
    getComputedStyle: (_el: any) => ({ display: 'block', visibility: 'visible' })
  };
}

async function runPhase01Tests() {
  console.log('=== Running Phase 01: False-Positive Enter ACK Guard & Input Clearance Verification Tests ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge, 'DOM Bridge module must load');
  assert.strictEqual(typeof domBridge.injectPromptAndSubmit, 'function');
  assert.strictEqual(typeof domBridge.isInputClearedOrSubmitted, 'function');
  assert.strictEqual(typeof domBridge.verifyInputSubmission, 'function');

  // ==========================================================================
  // Unit Tests: isInputClearedOrSubmitted
  // ==========================================================================
  console.log('[Unit Test] Testing isInputClearedOrSubmitted helper...');
  {
    // Textarea tests
    const ta = new MockElement('textarea');
    ta.value = 'Hello world';
    assert.strictEqual(domBridge.isInputClearedOrSubmitted(ta, 'Hello world'), false, 'Should return false when value equals prompt');
    assert.strictEqual(domBridge.isInputClearedOrSubmitted(ta, 'world'), false, 'Should return false when value contains prompt');

    ta.value = '';
    assert.strictEqual(domBridge.isInputClearedOrSubmitted(ta, 'Hello world'), true, 'Should return true when value is empty');

    ta.value = '   ';
    assert.strictEqual(domBridge.isInputClearedOrSubmitted(ta, 'Hello world'), true, 'Should return true when value is whitespace');

    // Rich text / Lexical contenteditable tests
    const ce = new MockElement('div');
    ce.setAttribute('contenteditable', 'true');
    ce.textContent = 'Lexical prompt text';
    assert.strictEqual(domBridge.isInputClearedOrSubmitted(ce, 'Lexical prompt text'), false, 'Should return false when textContent equals prompt');

    ce.textContent = '';
    ce.innerHTML = '<p><br></p>';
    assert.strictEqual(domBridge.isInputClearedOrSubmitted(ce, 'Lexical prompt text'), true, 'Should return true for empty <p><br></p>');

    ce.innerHTML = '<div><br/></div>';
    assert.strictEqual(domBridge.isInputClearedOrSubmitted(ce, 'Lexical prompt text'), true, 'Should return true for empty <div><br/></div>');

    ce.innerHTML = '';
    ce.textContent = '';
    assert.strictEqual(domBridge.isInputClearedOrSubmitted(ce, 'Lexical prompt text'), true, 'Should return true for completely empty container');
    console.log('  ✓ Verified: isInputClearedOrSubmitted accurately detects buffer states across element types.');
  }

  // ==========================================================================
  // Test Case 1: Untrusted Enter Rejection (Contenteditable ignores Enter, retains prompt)
  // ==========================================================================
  console.log('\n[Test Case 1] Verifying Untrusted Enter Rejection (Synthetic Enter ignored by editor)...');
  {
    const doc = new MockDocument();
    const win = createMockWindow();

    const container = doc.createElement('div');
    container.setAttribute('id', 'antigravity.agentSidePanelInputBox');
    doc.body.appendChild(container);

    const input = doc.createElement('div');
    input.setAttribute('data-lexical-editor', 'true');
    input.setAttribute('contenteditable', 'true');
    container.appendChild(input);

    // No valid send button exists in container or document
    // Contenteditable retains injected text even after KeyboardEvent('Enter') is dispatched
    const result = await domBridge.injectPromptAndSubmit('Untrusted prompt text to reject', {
      document: doc,
      window: win,
      clearanceObservationMs: 50,
      pollIntervalMs: 10,
      syncDelayMs: 0
    });

    assert.strictEqual(result.success, false, 'Result success must be false when input is not cleared');
    assert.strictEqual(result.submitStrategy, 'enterKey', 'submitStrategy must be enterKey');
    assert.strictEqual(result.submissionVerified, false, 'submissionVerified must be false');
    assert.strictEqual(result.enterDispatched, false, 'enterDispatched must be marked false upon verification failure');
    assert.strictEqual(result.rejectionReason, 'untrusted_enter_rejected', 'rejectionReason must be untrusted_enter_rejected');
    assert.ok(result.error && result.error.includes('Synthetic Enter event was not accepted by the editor'), 'Error diagnostic must explain Enter rejection');
    assert.ok(result.diagnostics, 'Diagnostics object must be included in report');
    assert.strictEqual(result.diagnostics.rejectionReason, 'untrusted_enter_rejected');

    // Step 4 verification in steps list
    const step4 = result.steps.find((s: any) => s.step === 4);
    assert.ok(step4, 'Step 4 submit triggering must be present');
    assert.strictEqual(step4.status, 'failed', 'Step 4 status must be failed');
    assert.strictEqual(step4.rejectionReason, 'untrusted_enter_rejected');
    console.log('  ✓ Verified: Untrusted Enter rejection accurately detected and reports success: false.');
  }

  // ==========================================================================
  // Test Case 2: Successful Enter Submission (Input clears upon receiving Enter)
  // ==========================================================================
  console.log('\n[Test Case 2] Verifying Successful Enter Submission (Input clears on Enter)...');
  {
    const doc = new MockDocument();
    const win = createMockWindow();

    const container = doc.createElement('div');
    container.setAttribute('id', 'antigravity.agentSidePanelInputBox');
    doc.body.appendChild(container);

    const input = doc.createElement('div');
    input.setAttribute('data-lexical-editor', 'true');
    input.setAttribute('contenteditable', 'true');
    container.appendChild(input);

    // Simulate an editor that clears text buffer on Enter keypress
    input.addEventListener('keypress', (evt: any) => {
      if (evt.key === 'Enter') {
        input.textContent = '';
        input.innerHTML = '<p><br></p>';
      }
    });

    const result = await domBridge.injectPromptAndSubmit('Successful Enter prompt', {
      document: doc,
      window: win,
      clearanceObservationMs: 50,
      pollIntervalMs: 10,
      syncDelayMs: 0
    });

    assert.strictEqual(result.success, true, 'Result success must be true when editor clears input');
    assert.strictEqual(result.submitStrategy, 'enterKey', 'submitStrategy must be enterKey');
    assert.strictEqual(result.submissionVerified, true, 'submissionVerified must be true');
    assert.strictEqual(result.rejectionReason, undefined, 'rejectionReason must be undefined on success');
    console.log('  ✓ Verified: Successful Enter key submission clears input and reports success: true.');
  }

  // ==========================================================================
  // Test Case 2b: Successful Monaco Editor Submission (Textarea inputarea)
  // ==========================================================================
  console.log('\n[Test Case 2b] Verifying Monaco-style textarea clearance on Enter...');
  {
    const doc = new MockDocument();
    const win = createMockWindow();

    const container = doc.createElement('div');
    container.setAttribute('class', 'interactive-session');
    doc.body.appendChild(container);

    const monacoDiv = doc.createElement('div');
    monacoDiv.setAttribute('class', 'monaco-editor');
    container.appendChild(monacoDiv);

    const textarea = doc.createElement('textarea');
    textarea.setAttribute('class', 'inputarea');
    monacoDiv.appendChild(textarea);

    textarea.addEventListener('keydown', (evt: any) => {
      if (evt.key === 'Enter') {
        textarea.value = '';
      }
    });

    const result = await domBridge.injectPromptAndSubmit('Monaco prompt submission', {
      document: doc,
      window: win,
      clearanceObservationMs: 50,
      pollIntervalMs: 10,
      syncDelayMs: 0
    });

    assert.strictEqual(result.success, true, 'Monaco submission should succeed when textarea cleared');
    assert.strictEqual(result.submitStrategy, 'enterKey');
    assert.strictEqual(result.submissionVerified, true);
    console.log('  ✓ Verified: Monaco textarea cleared on Enter and verified successfully.');
  }

  // ==========================================================================
  // Test Case 3: Active Button Click Cascade (Immediate success with buttonClick)
  // ==========================================================================
  console.log('\n[Test Case 3] Verifying Active Button Click Cascade (Immediate success without delay)...');
  {
    const doc = new MockDocument();
    const win = createMockWindow();

    const container = doc.createElement('div');
    container.setAttribute('id', 'antigravity.agentSidePanelInputBox');
    doc.body.appendChild(container);

    const input = doc.createElement('div');
    input.setAttribute('data-lexical-editor', 'true');
    input.setAttribute('contenteditable', 'true');
    container.appendChild(input);

    const sendBtn = doc.createElement('button');
    sendBtn.setAttribute('data-testid', 'send-button');
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.disabled = false;
    container.appendChild(sendBtn);

    const startTime = Date.now();
    const result = await domBridge.injectPromptAndSubmit('Button prompt submission', {
      document: doc,
      window: win,
      syncDelayMs: 0,
      pollTimeoutMs: 10
    });
    const duration = Date.now() - startTime;

    assert.strictEqual(result.success, true, 'Button click must report success: true');
    assert.strictEqual(result.submitStrategy, 'buttonClick', 'submitStrategy must be buttonClick');
    assert.strictEqual(result.sendButtonClicked, true, 'sendButtonClicked must be true');
    assert.strictEqual(result.enterDispatched, false, 'enterDispatched must be false');
    assert.strictEqual(sendBtn.clicked, true, 'Send button click() must have been called');
    assert.ok(duration < 150, `Button submission should be immediate without clearance wait (took ${duration}ms)`);
    console.log(`  ✓ Verified: Active button click succeeds immediately with buttonClick strategy (${duration}ms).`);
  }

  // ==========================================================================
  // Test Case 4: Asynchronous Buffer Clearance within Observation Window
  // ==========================================================================
  console.log('\n[Test Case 4] Verifying Asynchronous Buffer Clearance within Observation Window...');
  {
    const doc = new MockDocument();
    const win = createMockWindow();

    const container = doc.createElement('div');
    container.setAttribute('id', 'antigravity.agentSidePanelInputBox');
    doc.body.appendChild(container);

    const input = doc.createElement('div');
    input.setAttribute('data-lexical-editor', 'true');
    input.setAttribute('contenteditable', 'true');
    container.appendChild(input);

    // Simulate an async React state flush where buffer is cleared 25ms after Enter
    input.addEventListener('keyup', (evt: any) => {
      if (evt.key === 'Enter') {
        setTimeout(() => {
          input.textContent = '';
          input.innerHTML = '<p><br></p>';
        }, 25);
      }
    });

    const result = await domBridge.injectPromptAndSubmit('Async clearance prompt', {
      document: doc,
      window: win,
      clearanceObservationMs: 100,
      pollIntervalMs: 10,
      syncDelayMs: 0
    });

    assert.strictEqual(result.success, true, 'Async clearance within observation window must succeed');
    assert.strictEqual(result.submitStrategy, 'enterKey');
    assert.strictEqual(result.submissionVerified, true);
    console.log('  ✓ Verified: Input cleared asynchronously within observation window is successfully acknowledged.');
  }

  // ==========================================================================
  // Test Case 5: Chat Container Item Mutation Verification
  // ==========================================================================
  console.log('\n[Test Case 5] Verifying Chat List Mutation Observation...');
  {
    const doc = new MockDocument();
    const win = createMockWindow();

    const container = doc.createElement('div');
    container.setAttribute('class', 'chat-widget');
    doc.body.appendChild(container);

    const input = doc.createElement('div');
    input.setAttribute('contenteditable', 'true');
    input.setAttribute('role', 'textbox');
    container.appendChild(input);

    // Editor does not immediately clear text, but appends a new message row
    input.addEventListener('keyup', (evt: any) => {
      if (evt.key === 'Enter') {
        setTimeout(() => {
          const newMsg = doc.createElement('div');
          newMsg.setAttribute('class', 'chat-item');
          container.appendChild(newMsg);
        }, 20);
      }
    });

    const result = await domBridge.injectPromptAndSubmit('Chat list mutation prompt', {
      document: doc,
      window: win,
      clearanceObservationMs: 100,
      pollIntervalMs: 10,
      syncDelayMs: 0
    });

    assert.strictEqual(result.success, true, 'Chat mutation within window must succeed verification');
    assert.strictEqual(result.submissionVerified, true);
    console.log('  ✓ Verified: Appended chat item mutation verifies submission successfully.');
  }

  // ==========================================================================
  // Test Case 6: DomBridgeClient.handleCommand Sends Error ACK on Failure
  // ==========================================================================
  console.log('\n[Test Case 6] Verifying DomBridgeClient.handleCommand emits Error ACK on rejection...');
  {
    const doc = new MockDocument();
    const win = createMockWindow();

    const container = doc.createElement('div');
    container.setAttribute('id', 'antigravity.agentSidePanelInputBox');
    doc.body.appendChild(container);

    const input = doc.createElement('div');
    input.setAttribute('contenteditable', 'true');
    input.setAttribute('role', 'textbox');
    container.appendChild(input);

    const client = new domBridge.DomBridgeClient({
      portStart: 48990,
      portEnd: 48995
    });
    client.customDocument = doc;
    client.customWindow = win;

    let sentAckStatus = '';
    let sentAckError: any = null;
    let sentAckMeta: any = null;

    client.sendAck = async (cmdId: string, status: string, error: any, meta: any) => {
      sentAckStatus = status;
      sentAckError = error;
      sentAckMeta = meta;
    };

    // Dispatch command where Enter will be rejected (untrusted)
    await client.handleCommand({
      id: 'cmd-untrusted-001',
      type: 'sendPrompt',
      text: 'Test untrusted command',
      options: {
        clearanceObservationMs: 40,
        pollIntervalMs: 10,
        syncDelayMs: 0
      }
    });

    assert.strictEqual(sentAckStatus, 'error', 'ACK status must be "error" instead of "submitClicked"');
    assert.ok(sentAckError && sentAckError.includes('Synthetic Enter event was not accepted'), 'ACK error must record Enter rejection');
    assert.strictEqual(sentAckMeta.success, false, 'ACK metadata success must be false');
    assert.strictEqual(sentAckMeta.rejectionReason, 'untrusted_enter_rejected');
    console.log('  ✓ Verified: DomBridgeClient sends error ACK on rejected Enter, preventing false positive hang.');
  }

  console.log('\n========================================================================');
  console.log('✅ ALL PHASE 01 FALSE-POSITIVE ENTER ACK GUARD TESTS PASSED!');
  console.log('========================================================================\n');
}

runPhase01Tests().catch(err => {
  console.error('Phase 01 Test Suite Failed:', err);
  process.exit(1);
});
