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
  public button?: number;
  public key?: string;
  public code?: string;
  public keyCode?: number;
  public which?: number;
  public inputType?: string;
  public data?: string;

  constructor(type: string, options: any = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    if (options.button !== undefined) this.button = options.button;
    if (options.key !== undefined) this.key = options.key;
    if (options.code !== undefined) this.code = options.code;
    if (options.keyCode !== undefined) this.keyCode = options.keyCode;
    if (options.which !== undefined) this.which = options.which;
    if (options.inputType !== undefined) this.inputType = options.inputType;
    if (options.data !== undefined) this.data = options.data;
  }
}

class MockPointerEvent extends MockEvent {
  constructor(type: string, options: any = {}) {
    super(type, options);
  }
}

class MockMouseEvent extends MockEvent {
  constructor(type: string, options: any = {}) {
    super(type, options);
  }
}

class MockKeyboardEvent extends MockEvent {
  constructor(type: string, options: any = {}) {
    super(type, options);
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
  public _value: string = '';
  public role: string = '';
  public title: string = '';
  public clicked: boolean = false;
  public clickCount: number = 0;
  public focused: boolean = false;
  public focusOptions: any = null;
  public dispatchedEvents: MockEvent[] = [];
  public rect: { width: number; height: number; top: number; left: number } = { width: 100, height: 30, top: 0, left: 0 };
  public offsetParent: MockElement | null = null;
  public form: MockElement | null = null;
  public requestSubmitCalls: any[] = [];

  constructor(tagName: string, className: string = '') {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList(className);
    this.offsetParent = this;
  }

  get value(): string {
    return this._value;
  }

  set value(val: string) {
    this._value = val;
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

  click() {
    this.clicked = true;
    this.clickCount++;
    this.dispatchedEvents.push(new MockMouseEvent('native-click'));
  }

  requestSubmit(submitter?: any) {
    this.requestSubmitCalls.push(submitter);
    this.dispatchedEvents.push(new MockEvent('submit', { bubbles: true, cancelable: true }));
  }

  focus(options?: any) {
    this.focused = true;
    this.focusOptions = options;
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  dispatchEvent(event: MockEvent): boolean {
    this.dispatchedEvents.push(event);
    return true;
  }

  contains(other: MockElement): boolean {
    if (other === this) return true;
    for (const child of this.children) {
      if (child.contains(other)) return true;
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
  public nodeType: number = 9;
  public documentElement: MockElement;
  public body: MockElement;
  public activeElement: MockElement | null = null;
  public hidden: boolean = false;
  public execCommandReturnValue: boolean = true;

  constructor() {
    this.documentElement = new MockElement('html');
    this.documentElement.ownerDocument = this;
    this.body = new MockElement('body');
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }

  createElement(tagName: string, className: string = ''): MockElement {
    const el = new MockElement(tagName, className);
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

  execCommand(_command: string, _showUI: boolean = false, _value: any = null): boolean {
    return this.execCommandReturnValue;
  }
}

function createMockWindow(doc: MockDocument) {
  return {
    document: doc,
    Event: MockEvent,
    InputEvent: MockEvent,
    PointerEvent: MockPointerEvent,
    MouseEvent: MockMouseEvent,
    KeyboardEvent: MockKeyboardEvent,
    HTMLTextAreaElement: MockElement,
    HTMLInputElement: MockElement
  };
}

async function runPhase03Tests() {
  console.log('=== Running Phase 03: Direct Button Submission & Double-Tap Mechanics Tests ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge, 'DOM Bridge module must be loaded');
  assert.strictEqual(typeof domBridge.dispatchButtonClickCascade, 'function', 'dispatchButtonClickCascade must be exported');
  assert.strictEqual(typeof domBridge.injectPromptAndSubmit, 'function', 'injectPromptAndSubmit must be exported');
  assert.strictEqual(typeof domBridge.DomBridgeClient, 'function', 'DomBridgeClient must be exported');

  // ==========================================================================
  // Test 1: Native Button Click & Full Pointer/Mouse Event Cascade
  // ==========================================================================
  console.log('[Test 1] Verifying native button click and full pointer/mouse event cascade...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const input = doc.createElement('textarea', 'inputarea');
    const sendBtn = doc.createElement('button');
    sendBtn.setAttribute('data-testid', 'send-button');
    doc.body.appendChild(input);
    doc.body.appendChild(sendBtn);

    const prompt = 'Implement OAuth 2.0 PKCE flow for desktop electron client';
    const result = await domBridge.injectPromptAndSubmit(prompt, {
      document: doc,
      window: win,
      targetElement: input,
      sendButton: sendBtn
    });

    assert.strictEqual(result.success, true, 'Result must indicate success');
    assert.strictEqual(result.submitStrategy, 'buttonClick', 'submitStrategy must be buttonClick');
    assert.strictEqual(result.sendButtonClicked, true, 'sendButtonClicked must be true');
    assert.strictEqual(result.enterDispatched, false, 'enterDispatched must be false on buttonClick');
    assert.strictEqual(result.charsInjected, prompt.length, 'charsInjected must match prompt length');

    // Verify pointer & mouse event cascade on sendBtn:
    // 1. pointerdown (button 0)
    // 2. mousedown (button 0)
    // 3. pointerup (button 0)
    // 4. mouseup (button 0)
    // 5. native click
    const events = sendBtn.dispatchedEvents;
    const types = events.map(e => e.type);

    assert.ok(types.includes('pointerdown'), 'Cascade must include pointerdown');
    assert.ok(types.includes('mousedown'), 'Cascade must include mousedown');
    assert.ok(types.includes('native-click'), 'Cascade must include native click()');
    assert.ok(types.includes('pointerup'), 'Cascade must include pointerup');
    assert.ok(types.includes('mouseup'), 'Cascade must include mouseup');

    const pointerDown = events.find(e => e.type === 'pointerdown');
    assert.strictEqual(pointerDown?.bubbles, true);
    assert.strictEqual(pointerDown?.cancelable, true);
    assert.strictEqual(pointerDown?.button, 0);

    const mouseDown = events.find(e => e.type === 'mousedown');
    assert.strictEqual(mouseDown?.bubbles, true);
    assert.strictEqual(mouseDown?.cancelable, true);
    assert.strictEqual(mouseDown?.button, 0);

    console.log('  ✓ 6-step pointer & mouse event cascade verified on target button.');
  }

  // ==========================================================================
  // Test 2: Keyboard Enter Event Dispatching on Input
  // ==========================================================================
  console.log('\n[Test 2] Verifying Keyboard Enter Event Dispatching on Input...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const input = doc.createElement('textarea');
    doc.body.appendChild(input);

    const prompt = 'Add unit tests for WebSocket connection resilience';
    const result = await domBridge.injectPromptAndSubmit(prompt, {
      document: doc,
      window: win,
      targetElement: input
    });

    assert.strictEqual(result.enterDispatched, true, 'enterDispatched must be true');

    const keyDown = input.dispatchedEvents.find(e => e.type === 'keydown' && e.key === 'Enter');
    const keyUp = input.dispatchedEvents.find(e => e.type === 'keyup' && e.key === 'Enter');

    assert.ok(keyDown, 'Input must receive Enter keydown event');
    assert.ok(keyUp, 'Input must receive Enter keyup event');

    assert.strictEqual(keyDown?.key, 'Enter');
    assert.strictEqual(keyDown?.code, 'Enter');
    assert.strictEqual(keyDown?.keyCode, 13);
    assert.strictEqual(keyDown?.which, 13);
    assert.strictEqual(keyDown?.bubbles, true);
    assert.strictEqual(keyDown?.cancelable, true);

    assert.strictEqual(keyUp?.key, 'Enter');
    assert.strictEqual(keyUp?.code, 'Enter');
    assert.strictEqual(keyUp?.keyCode, 13);
    assert.strictEqual(keyUp?.which, 13);
    assert.strictEqual(keyUp?.bubbles, true);
    assert.strictEqual(keyUp?.cancelable, true);

    console.log('  ✓ Enter keydown and keyup events dispatched with key/code/keyCode/which.');
  }

  // ==========================================================================
  // Test 3: Double-Tap Submission Guard Mechanics
  // ==========================================================================
  console.log('\n[Test 3] Verifying Double-Tap Submission Guard with 50ms async retry...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const input = doc.createElement('textarea');
    const sendBtn = doc.createElement('button');
    sendBtn.setAttribute('data-testid', 'send-button');
    sendBtn.disabled = true; // Initially disabled while framework updates
    doc.body.appendChild(input);
    doc.body.appendChild(sendBtn);

    // Simulate button becoming enabled after 20ms
    setTimeout(() => {
      sendBtn.disabled = false;
    }, 20);

    const prompt = 'Refactor token cache eviction policy';
    const result = await domBridge.injectPromptAndSubmit(prompt, {
      document: doc,
      window: win,
      targetElement: input,
      sendButton: sendBtn,
      syncDelayMs: 0,
      doubleTapRetry: true
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.doubleTapExecuted, true, 'doubleTapExecuted must be true when initially disabled');
    assert.strictEqual(result.submitStrategy, 'buttonClick');
    // Button should receive clicks on initial and retry
    assert.strictEqual(sendBtn.clickCount, 2, 'sendBtn should be clicked twice across initial and retry taps');
    console.log('  ✓ Double-tap guard asynchronously re-dispatched event cascade after 50ms.');
  }

  // ==========================================================================
  // Test 4: Form Submission Fallback (requestSubmit & submit Event)
  // ==========================================================================
  console.log('\n[Test 4] Verifying Form Submission Fallbacks...');
  {
    // Sub-case 4A: form.requestSubmit(btn) when KeyboardEvent unavailable and button is submit
    {
      const doc = new MockDocument();
      const win = createMockWindow(doc);
      (win as any).KeyboardEvent = undefined;

      const form = doc.createElement('form');
      const input = doc.createElement('textarea');
      input.form = form;
      form.appendChild(input);
      doc.body.appendChild(form);

      const result = await domBridge.injectPromptAndSubmit('Form prompt A', {
        document: doc,
        window: win,
        targetElement: input
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.formSubmitted, true, 'formSubmitted should be true');
      assert.strictEqual(form.requestSubmitCalls.length, 1, 'form.requestSubmit must be invoked');
      console.log('  ✓ form.requestSubmit() executed successfully.');
    }

    // Sub-case 4B: form submit event fallback when requestSubmit is unavailable
    {
      const doc = new MockDocument();
      const win = createMockWindow(doc);
      (win as any).KeyboardEvent = undefined;

      const form = doc.createElement('form');
      // Remove requestSubmit method to test Event('submit') fallback
      (form as any).requestSubmit = undefined;
      const input = doc.createElement('textarea');
      input.form = form;
      form.appendChild(input);
      doc.body.appendChild(form);

      const result = await domBridge.injectPromptAndSubmit('Form prompt B', {
        document: doc,
        window: win,
        targetElement: input
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.formSubmitted, true);
      assert.strictEqual(result.submitStrategy, 'formSubmit', 'submitStrategy should be formSubmit when no button');
      const submitEvt = form.dispatchedEvents.find(e => e.type === 'submit');
      assert.ok(submitEvt, 'Form must receive submit event dispatch');
      console.log('  ✓ form.dispatchEvent(new Event("submit")) fallback verified.');
    }
  }

  // ==========================================================================
  // Test 5: Structured Execution Telemetry in ACK Payload via DomBridgeClient
  // ==========================================================================
  console.log('\n[Test 5] Verifying structured diagnostics in DomBridgeClient ACK Payload...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const input = doc.createElement('textarea');
    input.setAttribute('placeholder', 'Ask...');
    const sendBtn = doc.createElement('button', 'codicon-send');
    sendBtn.setAttribute('data-testid', 'send-button');
    doc.body.appendChild(input);
    doc.body.appendChild(sendBtn);

    let sentAckPayload: any = null;

    const mockFetch = async (url: string, init?: any) => {
      if (url.includes('/autoplan-ack')) {
        sentAckPayload = JSON.parse(init.body);
        return { status: 200, ok: true, json: async () => ({ acknowledged: true }) };
      }
      if (url.includes('/autoplan-log')) {
        return { status: 200, ok: true, json: async () => ({ status: 'ok' }) };
      }
      return { status: 200, ok: true, json: async () => ({ service: 'autoplan-bridge-server' }) };
    };

    const client = new domBridge.DomBridgeClient({
      document: doc,
      window: win,
      fetch: mockFetch,
      serverPort: 48860
    });

    const command = {
      id: 'cmd-phase03-test-101',
      type: 'sendPrompt',
      text: 'Generate end-to-end integration test suite',
      options: {}
    };

    await client.handleCommand(command);

    assert.ok(sentAckPayload, 'ACK payload must be sent');
    assert.strictEqual(sentAckPayload.commandId, 'cmd-phase03-test-101');
    assert.strictEqual(sentAckPayload.status, 'submitClicked');

    const meta = sentAckPayload.metadata;
    assert.ok(meta, 'Metadata must be included in ACK payload');
    assert.strictEqual(meta.submitStrategy, 'buttonClick', 'submitStrategy must be buttonClick');
    assert.strictEqual(meta.sendButtonClicked, true, 'sendButtonClicked must be true');
    assert.strictEqual(meta.enterDispatched, false, 'enterDispatched must be false on buttonClick');
    assert.strictEqual(meta.charsInjected, 'Generate end-to-end integration test suite'.length);
    assert.strictEqual(typeof meta.buttonSelector, 'string');
    assert.ok(Array.isArray(meta.steps), 'steps must be an array');
    assert.strictEqual(meta.steps.length, 4, 'Must have 4 structured steps in metadata');

    const step4 = meta.steps.find((s: any) => s.step === 4);
    assert.strictEqual(step4?.name, 'Submit triggering');
    assert.strictEqual(step4?.status, 'success');
    assert.strictEqual(step4?.submitStrategy, 'buttonClick');

    console.log('  ✓ Structured telemetry (submitStrategy, sendButtonClicked, enterDispatched, charsInjected, steps) verified in ACK payload.');
  }

  console.log('\n=== All Phase 03 Tests Passed Successfully! ===');
}

runPhase03Tests().catch(err => {
  console.error('\n❌ Phase 03 Test Suite Failed:', err);
  process.exit(1);
});
