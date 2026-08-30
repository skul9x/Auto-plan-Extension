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

class MockFormElement {
  public requestedSubmit: boolean = false;
  public submitButton: any = null;
  public dispatchedEvents: MockEvent[] = [];

  requestSubmit(submitter?: any) {
    this.requestedSubmit = true;
    this.submitButton = submitter || null;
  }

  dispatchEvent(event: any): boolean {
    this.dispatchedEvents.push(event);
    return true;
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
  public textContent: string = '';
  public innerText: string = '';
  public value: string = '';
  public role: string = '';
  public title: string = '';
  public form: MockFormElement | null = null;
  public clicked: boolean = false;
  public clickCount: number = 0;
  public dispatchedEvents: MockEvent[] = [];
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
    if (name === 'class') {
      this.className = value;
    }
    if (name === 'id') {
      this.id = value;
    }
    if (name === 'role') {
      this.role = value;
    }
    if (name === 'title') {
      this.title = value;
    }
    if (name === 'value') {
      this.value = value;
    }
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

  click() {
    this.clicked = true;
    this.clickCount++;
  }

  focus(_options?: any) {}

  dispatchEvent(event: any): boolean {
    event.target = this;
    this.dispatchedEvents.push(event);
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

  execCommand(_command: string, _showUI?: boolean, _value?: any): boolean {
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

async function runPhase01SingleSubmitTests() {
  console.log('=== Running Phase 01: DOM Bridge Mutually Exclusive Single-Submit Pipeline Tests ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge, 'DOM Bridge module must be loaded');
  assert.strictEqual(typeof domBridge.injectPromptAndSubmit, 'function', 'injectPromptAndSubmit must be exported');
  assert.strictEqual(typeof domBridge.DomBridgeClient, 'function', 'DomBridgeClient must be exported');

  // ==========================================================================
  // Test 1: Mutually Exclusive Primary Strategy (buttonClick)
  // When sendBtn is present and clickable:
  // - sendButtonClicked === true, enterDispatched === false, submitStrategy === 'buttonClick'
  // - Mouse/Pointer events fired on button, ZERO Keyboard Enter events dispatched to inputElem
  // ==========================================================================
  console.log('[Test 1] Verifying Mutually Exclusive buttonClick Strategy (No Enter Keydown on Button Click)...');
  const doc1 = new MockDocument();
  const win1 = createMockWindow();

  const container1 = doc1.createElement('div');
  container1.setAttribute('id', 'antigravity.agentSidePanelInputBox');
  doc1.body.appendChild(container1);

  const input1 = doc1.createElement('div');
  input1.setAttribute('data-lexical-editor', 'true');
  input1.setAttribute('contenteditable', 'true');
  container1.appendChild(input1);

  const sendBtn1 = doc1.createElement('button');
  sendBtn1.setAttribute('data-testid', 'send-button');
  sendBtn1.setAttribute('aria-label', 'Send message');
  sendBtn1.disabled = false;
  container1.appendChild(sendBtn1);

  const result1 = await domBridge.injectPromptAndSubmit('Test button-only submit prompt', {
    document: doc1,
    window: win1,
    syncDelayMs: 0,
    pollTimeoutMs: 50
  });

  assert.strictEqual(result1.success, true, 'Result success should be true');
  assert.strictEqual(result1.sendButtonClicked, true, 'sendButtonClicked must be true');
  assert.strictEqual(result1.enterDispatched, false, 'enterDispatched must be strictly false when button is clicked');
  assert.strictEqual(result1.submitStrategy, 'buttonClick', 'submitStrategy must be buttonClick');
  assert.strictEqual(sendBtn1.clicked, true, 'Send button click() must have been called');

  // Check event spy on input1: MUST NOT have any KeyboardEvent
  const input1KbEvents = input1.dispatchedEvents.filter(e => e instanceof MockKeyboardEvent || e.type === 'keydown' || e.type === 'keypress' || e.type === 'keyup');
  assert.strictEqual(input1KbEvents.length, 0, 'Zero KeyboardEvent (keydown/keypress/keyup) should be dispatched to inputElem when send button is clicked');

  // Check event spy on sendBtn1: MUST have mouse/pointer events
  const btnPointerEvents = sendBtn1.dispatchedEvents.filter(e => e instanceof MockPointerEvent || e.type === 'pointerdown' || e.type === 'pointerup');
  const btnMouseEvents = sendBtn1.dispatchedEvents.filter(e => e instanceof MockMouseEvent || e.type === 'mousedown' || e.type === 'mouseup' || e.type === 'click');
  assert.ok(btnPointerEvents.length >= 2, 'Pointerdown and pointerup events must be dispatched on sendBtn');
  assert.ok(btnMouseEvents.length >= 3, 'Mousedown, mouseup, and click events must be dispatched on sendBtn');

  console.log('  ✓ Verified: Primary buttonClick strategy cleanly executed without synthetic Keyboard Enter events.');

  // ==========================================================================
  // Test 2: Fallback Strategy (enterKey) when Send Button is NOT Present
  // When no sendBtn is in DOM:
  // - enterDispatched === true, sendButtonClicked === false, submitStrategy === 'enterKey'
  // - Keyboard events (keydown, keypress, keyup) dispatched to inputElem
  // ==========================================================================
  console.log('\n[Test 2] Verifying Fallback enterKey Strategy when Send Button is Absent...');
  const doc2 = new MockDocument();
  const win2 = createMockWindow();

  const container2 = doc2.createElement('div');
  container2.setAttribute('class', 'interactive-session');
  doc2.body.appendChild(container2);

  const input2 = doc2.createElement('textarea');
  input2.setAttribute('placeholder', 'Ask a question...');
  container2.appendChild(input2);

  const result2 = await domBridge.injectPromptAndSubmit('Fallback enter prompt', {
    document: doc2,
    window: win2,
    syncDelayMs: 0,
    pollTimeoutMs: 50
  });

  assert.strictEqual(result2.success, true, 'Result success should be true');
  assert.strictEqual(result2.sendButtonClicked, false, 'sendButtonClicked must be false when no send button is present');
  assert.strictEqual(result2.enterDispatched, true, 'enterDispatched must be true');
  assert.strictEqual(result2.submitStrategy, 'enterKey', 'submitStrategy must be enterKey');

  const input2KbEvents = input2.dispatchedEvents.filter(e => e instanceof MockKeyboardEvent);
  assert.strictEqual(input2KbEvents.length, 3, 'Input element must receive exactly 3 KeyboardEvents (keydown, keypress, keyup)');
  assert.strictEqual(input2KbEvents[0].type, 'keydown');
  assert.strictEqual(input2KbEvents[0].key, 'Enter');
  assert.strictEqual(input2KbEvents[1].type, 'keypress');
  assert.strictEqual(input2KbEvents[1].key, 'Enter');
  assert.strictEqual(input2KbEvents[2].type, 'keyup');
  assert.strictEqual(input2KbEvents[2].key, 'Enter');

  console.log('  ✓ Verified: Fallback enterKey strategy correctly dispatched full Enter key event cascade to input element.');

  // ==========================================================================
  // Test 3: Form Fallback Strategy (formSubmit) when Button and Keyboard are Unavailable
  // ==========================================================================
  console.log('\n[Test 3] Verifying Form Fallback Strategy (formSubmit)...');
  const doc3 = new MockDocument();
  const win3 = {
    // Window without KeyboardEvent to test form fallback path
    PointerEvent: MockPointerEvent,
    MouseEvent: MockMouseEvent,
    getComputedStyle: (_el: any) => ({ display: 'block', visibility: 'visible' })
  };

  const container3 = doc3.createElement('div');
  container3.setAttribute('class', 'chat-widget');
  doc3.body.appendChild(container3);

  const form3 = new MockFormElement();
  const input3 = doc3.createElement('textarea');
  input3.setAttribute('role', 'textbox');
  input3.form = form3;
  container3.appendChild(input3);

  const result3 = await domBridge.injectPromptAndSubmit('Form fallback prompt', {
    document: doc3,
    window: win3,
    syncDelayMs: 0,
    pollTimeoutMs: 50
  });

  assert.strictEqual(result3.success, true, 'Result success should be true');
  assert.strictEqual(result3.formSubmitted, true, 'formSubmitted must be true');
  assert.strictEqual(result3.submitStrategy, 'formSubmit', 'submitStrategy must be formSubmit');
  assert.strictEqual(form3.requestedSubmit, true, 'form.requestSubmit() must have been called');

  console.log('  ✓ Verified: Form fallback strategy correctly requested form submission.');

  // ==========================================================================
  // Test 4: Concurrency Mutex & Debounce Guard in DomBridgeClient
  // When multiple submissions are triggered rapidly within 500ms window:
  // - In-flight or overlapping submissions are blocked/debounced
  // - Explicit bypass (force: true) allows intentional overrides
  // ==========================================================================
  console.log('\n[Test 4] Verifying In-Memory Submission Mutex & Debounce Guard in DomBridgeClient...');
  const doc4 = new MockDocument();
  const win4 = createMockWindow();

  const container4 = doc4.createElement('div');
  container4.setAttribute('id', 'antigravity.agentSidePanelInputBox');
  doc4.body.appendChild(container4);

  const input4 = doc4.createElement('div');
  input4.setAttribute('data-lexical-editor', 'true');
  input4.setAttribute('contenteditable', 'true');
  container4.appendChild(input4);

  const sendBtn4 = doc4.createElement('button');
  sendBtn4.setAttribute('data-testid', 'send-button');
  container4.appendChild(sendBtn4);

  const client = new domBridge.DomBridgeClient({
    document: doc4,
    window: win4,
    autoApproval: false
  });

  // Rapidly trigger 2 submissions simultaneously
  let sub1Error: any = null;
  let sub2Error: any = null;

  const p1 = client.injectPrompt('Prompt 1', { debounceMs: 500, syncDelayMs: 30 })
    .catch((err: any) => { sub1Error = err; });

  const p2 = client.injectPrompt('Prompt 2 (rapid overlap)', { debounceMs: 500 })
    .catch((err: any) => { sub2Error = err; });

  await Promise.all([p1, p2]);

  // One of the overlapping submissions should have succeeded and the rapid one blocked
  assert.ok(sub1Error === null || sub2Error !== null, 'Overlapping concurrent submission should be blocked by mutex');
  assert.ok(sub2Error !== null, 'Second rapid submission must be rejected with debounce/concurrency error');
  assert.ok(
    sub2Error.message.includes('Submission blocked') || sub2Error.message.includes('Submission debounced'),
    `Error message should indicate mutex lock: ${sub2Error.message}`
  );

  // Test explicit bypass with force: true
  const forcedResult = await client.injectPrompt('Forced prompt override', { force: true, syncDelayMs: 0 });
  assert.strictEqual(forcedResult.success, true, 'Submission with force: true must bypass debounce lock');
  assert.strictEqual(forcedResult.submitStrategy, 'buttonClick');

  console.log('  ✓ Verified: Mutex lock safely prevented concurrent submission overlap while supporting forced overrides.');

  // ==========================================================================
  // Test 5: Double-Tap Retry Control
  // Double-tap should ONLY execute if requested or transitionally disabled
  // ==========================================================================
  console.log('\n[Test 5] Verifying Double-Tap Execution Exclusivity...');
  const doc5 = new MockDocument();
  const win5 = createMockWindow();

  const container5 = doc5.createElement('div');
  container5.setAttribute('id', 'antigravity.agentSidePanelInputBox');
  doc5.body.appendChild(container5);

  const input5 = doc5.createElement('div');
  input5.setAttribute('data-lexical-editor', 'true');
  container5.appendChild(input5);

  const sendBtn5 = doc5.createElement('button');
  sendBtn5.setAttribute('data-testid', 'send-button');
  sendBtn5.disabled = false;
  container5.appendChild(sendBtn5);

  // Normal submission on enabled button: doubleTapExecuted must be false
  const singleResult = await domBridge.injectPromptAndSubmit('Single tap prompt', {
    document: doc5,
    window: win5,
    syncDelayMs: 0,
    pollTimeoutMs: 10
  });
  assert.strictEqual(singleResult.doubleTapExecuted, false, 'doubleTapExecuted should be false for normal single-tap submission');
  assert.strictEqual(sendBtn5.clickCount, 1, 'sendBtn clickCount must be exactly 1');

  // Explicit doubleTap: true option: doubleTapExecuted must be true
  sendBtn5.clickCount = 0;
  const doubleResult = await domBridge.injectPromptAndSubmit('Double tap prompt', {
    document: doc5,
    window: win5,
    doubleTap: true,
    doubleTapDelayMs: 10,
    syncDelayMs: 0,
    pollTimeoutMs: 10
  });
  assert.strictEqual(doubleResult.doubleTapExecuted, true, 'doubleTapExecuted should be true when doubleTap option is enabled');
  assert.strictEqual(sendBtn5.clickCount, 2, 'sendBtn clickCount must be 2 after double-tap');

  console.log('  ✓ Verified: Double-tap retry is executed exclusively when requested or required.');

  console.log('\n========================================================================');
  console.log('✅ ALL PHASE 01 DOM BRIDGE MUTUALLY EXCLUSIVE SINGLE-SUBMIT TESTS PASSED!');
  console.log('========================================================================\n');
}

runPhase01SingleSubmitTests().catch(err => {
  console.error('Phase 01 Test Suite Failed:', err);
  process.exit(1);
});
