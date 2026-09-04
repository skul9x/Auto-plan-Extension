// Standalone mock for 'vscode' module if run directly via Node
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
  public classes: Set<string> = new Set();

  constructor(className: string = '') {
    if (className) {
      className.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
    }
  }

  get length(): number {
    return this.classes.size;
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

  toString(): string {
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
  public disabled: boolean = false;
  public textContent: string = '';
  public innerText: string = '';
  public innerHTML: string = '';
  public value: string = '';
  public clicked: boolean = false;
  public clickCount: number = 0;
  public dispatchedEvents: MockEvent[] = [];
  public eventListeners: Map<string, Array<(e: any) => void>> = new Map();

  constructor(tagName: string, className: string = '') {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList(className);
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
    if (name === 'disabled') {
      this.disabled = true;
    }
  }

  getAttribute(name: string): string | null {
    if (name === 'class') return this.className || null;
    if (name === 'id') return this.id || null;
    return this.attributes.get(name) || null;
  }

  hasAttribute(name: string): boolean {
    if (name === 'class') return Boolean(this.className);
    if (name === 'id') return Boolean(this.id);
    return this.attributes.has(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === 'disabled') {
      this.disabled = false;
    }
    if (name === 'id') {
      this.id = '';
    }
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: (e: any) => void) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(listener);
  }

  click() {
    this.clicked = true;
    this.clickCount++;
    const listeners = this.eventListeners.get('click');
    if (listeners) {
      const evt = new MockMouseEvent('click', { bubbles: true, cancelable: true });
      evt.target = this;
      listeners.forEach(fn => fn(evt));
    }
  }

  focus() {}

  dispatchEvent(event: any): boolean {
    event.target = this;
    this.dispatchedEvents.push(event);
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach(fn => fn(event));
    }
    return true;
  }

  getBoundingClientRect() {
    return { width: 100, height: 30, top: 0, left: 0, bottom: 30, right: 100 };
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

  matches(selector: string): boolean {
    if (!selector) return false;
    const parts = selector.split(',').map(s => s.trim());
    return parts.some(sel => {
      if (sel.startsWith('.')) {
        return this.classList.contains(sel.slice(1));
      }
      if (sel.startsWith('#')) {
        const targetId = sel.slice(1).replace(/\\./g, '.');
        return this.id === targetId || this.getAttribute('id') === targetId;
      }
      const attrMatch = sel.match(/^([a-zA-Z0-9_-]+)?\[([a-zA-Z0-9_-]+)([\*~^$|]?=)?["']?([^"']*)?["']?\]$/);
      if (attrMatch) {
        const tag = attrMatch[1];
        const attr = attrMatch[2];
        const op = attrMatch[3];
        const val = attrMatch[4];
        if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
        if (!this.hasAttribute(attr)) return false;
        if (!op) return true;
        const actual = this.getAttribute(attr) || '';
        if (op === '=') return actual === val;
        if (op === '*=') return actual.includes(val);
        if (op === '^=') return actual.startsWith(val);
        if (op === '$=') return actual.endsWith(val);
      }
      return this.tagName.toLowerCase() === sel.toLowerCase();
    });
  }

  querySelector(selector: string): MockElement | null {
    const list = this.querySelectorAll(selector);
    return list.length > 0 ? list[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const traverse = (el: MockElement) => {
      for (const child of el.children) {
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
  public body: MockElement;

  constructor() {
    this.body = new MockElement('body');
    this.body.ownerDocument = this;
  }

  createElement(tagName: string, className: string = ''): MockElement {
    const el = new MockElement(tagName, className);
    el.ownerDocument = this;
    return el;
  }

  querySelector(selector: string): MockElement | null {
    if (this.body.matches(selector)) return this.body;
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    return this.body.querySelectorAll(selector);
  }
}

function createMockWindow(doc: MockDocument) {
  return {
    document: doc,
    KeyboardEvent: MockKeyboardEvent,
    MouseEvent: MockMouseEvent,
    PointerEvent: MockPointerEvent,
    Event: MockEvent,
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout
  };
}

async function runTests() {
  console.log('\n================================================================');
  console.log('🧪 Starting Phase 02: Send Button Readiness & Fallback Tests');
  console.log('================================================================\n');

  const domBridge = loadDomBridge();

  // --------------------------------------------------------------------------
  // Test 1: Button Enablement Polling up to 1500ms (enabling at 400ms)
  // --------------------------------------------------------------------------
  console.log('▶ Test 1: Button Enablement Polling (enabling at 400ms delay)...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const container = doc.createElement('div');
    container.setAttribute('id', 'antigravity.agentSidePanelInputBox');
    doc.body.appendChild(container);

    const inputElem = doc.createElement('div', 'editor');
    inputElem.setAttribute('data-lexical-editor', 'true');
    inputElem.setAttribute('contenteditable', 'true');
    inputElem.textContent = '';
    inputElem.innerHTML = '<p dir="auto"><br></p>';
    container.appendChild(inputElem);

    // Send button starts disabled per body.txt snapshot:
    // disabled="", cursor-not-allowed, bg-secondary
    const sendBtn = doc.createElement('button', 'flex items-center justify-center w-7 h-7 p-1.5 rounded-full transition-all duration-150 text-muted-foreground bg-secondary cursor-not-allowed');
    sendBtn.setAttribute('data-testid', 'send-button');
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.setAttribute('disabled', '');
    sendBtn.disabled = true;

    // Simulate input buffer clearing upon send button click
    sendBtn.click = () => {
      sendBtn.clicked = true;
      sendBtn.clickCount++;
      inputElem.textContent = '';
      inputElem.innerText = '';
      inputElem.innerHTML = '<p dir="auto"><br></p>';
    };
    container.appendChild(sendBtn);

    // Track any KeyboardEvent dispatched on inputElem
    const dispatchedOnInput: any[] = [];
    inputElem.addEventListener('keydown', e => dispatchedOnInput.push(e));
    inputElem.addEventListener('keypress', e => dispatchedOnInput.push(e));
    inputElem.addEventListener('keyup', e => dispatchedOnInput.push(e));

    // Simulate React AST reconciliation transitioning the button to ready after 400ms (per body4.txt snapshot)
    setTimeout(() => {
      sendBtn.removeAttribute('disabled');
      sendBtn.disabled = false;
      sendBtn.className = 'flex items-center justify-center w-7 h-7 p-1.5 rounded-full transition-all duration-150 bg-primary text-primary-foreground hover:opacity-90 cursor-pointer';
    }, 400);

    const startTime = Date.now();
    const result = await domBridge.injectPromptAndSubmit('Implement feature X according to spec', {
      document: doc,
      window: win,
      syncDelayMs: 10
      // pollTimeoutMs defaults to 1500ms, pollIntervalMs defaults to 50ms
    });
    const totalElapsed = Date.now() - startTime;

    assert.strictEqual(result.success, true, 'Result must be success=true');
    assert.strictEqual(result.sendButtonClicked, true, 'Send button must be clicked after enablement');
    assert.strictEqual(result.enterDispatched, false, 'Enter must NOT be dispatched when send button is clicked');
    assert.strictEqual(result.submitStrategy, 'buttonClick', 'Submit strategy must be buttonClick');
    assert.strictEqual(sendBtn.clickCount, 1, 'Send button must receive click event');
    assert.ok(result.buttonWaitDurationMs >= 350, `buttonWaitDurationMs (${result.buttonWaitDurationMs}ms) should reflect >= 350ms wait`);
    assert.ok(result.buttonWaitDurationMs <= 1500, `buttonWaitDurationMs (${result.buttonWaitDurationMs}ms) must not exceed 1500ms`);

    // Verify synthetic Enter was NOT dispatched to inputElem
    const enterEvents = dispatchedOnInput.filter(e => e.key === 'Enter');
    assert.strictEqual(enterEvents.length, 0, 'No synthetic Enter event should be dispatched when send button exists');

    console.log(`  ✓ Polling waited ${result.buttonWaitDurationMs}ms and submitted successfully when button enabled at 400ms (total: ${totalElapsed}ms).`);
  }

  // --------------------------------------------------------------------------
  // Test 2: Absolute Prohibition of Synthetic Enter when Send Button Exists
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 2: Absolute Prohibition of Synthetic Enter with Disabled Send Button...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const container = doc.createElement('div');
    container.setAttribute('id', 'antigravity.agentSidePanelInputBox');
    doc.body.appendChild(container);

    const inputElem = doc.createElement('div', 'editor');
    inputElem.setAttribute('data-lexical-editor', 'true');
    inputElem.setAttribute('contenteditable', 'true');
    inputElem.textContent = '';
    container.appendChild(inputElem);

    // Send button exists but remains permanently disabled
    const sendBtn = doc.createElement('button', 'w-7 h-7 bg-secondary text-muted-foreground cursor-not-allowed');
    sendBtn.setAttribute('data-testid', 'send-button');
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.setAttribute('disabled', '');
    sendBtn.disabled = true;
    container.appendChild(sendBtn);

    const capturedInputKeyEvents: any[] = [];
    inputElem.addEventListener('keydown', e => capturedInputKeyEvents.push(e));
    inputElem.addEventListener('keypress', e => capturedInputKeyEvents.push(e));
    inputElem.addEventListener('keyup', e => capturedInputKeyEvents.push(e));

    // Test with default 1500ms timeout
    const startTime = Date.now();
    const result = await domBridge.injectPromptAndSubmit('Test unsubmitted prompt', {
      document: doc,
      window: win,
      syncDelayMs: 10
      // Use default maxPollMs = 1500ms, pollIntervalMs = 50ms
    });
    const totalElapsed = Date.now() - startTime;

    assert.strictEqual(result.success, false, 'Result must be success=false when send button remains disabled');
    assert.strictEqual(result.sendButtonClicked, false, 'Send button must NOT be clicked when disabled');
    assert.strictEqual(result.enterDispatched, false, 'Enter must NOT be dispatched when send button exists in DOM');
    assert.strictEqual(result.rejectionReason, 'button_disabled_timeout', 'Rejection reason must be button_disabled_timeout');
    assert.ok(result.buttonWaitDurationMs >= 1400, `Should have polled full ~1500ms duration (was ${result.buttonWaitDurationMs}ms)`);
    assert.ok(totalElapsed >= 1400, `Total elapsed time should be >= 1400ms (was ${totalElapsed}ms)`);

    // Verify ABSOLUTELY ZERO Enter KeyboardEvents were dispatched
    const enterEvents = capturedInputKeyEvents.filter(e => e.key === 'Enter');
    assert.strictEqual(enterEvents.length, 0, 'CRITICAL: Absolutely NO synthetic Enter KeyboardEvents allowed when send button exists in DOM');

    console.log(`  ✓ 1500ms timeout observed (${result.buttonWaitDurationMs}ms). Marked as failed without attempting fake Enter.`);
  }

  // --------------------------------------------------------------------------
  // Test 3: Strict Readiness Criteria Validation Aligned with body4.txt
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 3: Strict Readiness Criteria Verification (body4.txt structure)...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    // Sub-case A: Button has cursor-pointer but still has disabled attribute -> NOT ready
    {
      const btnA = doc.createElement('button', 'cursor-pointer bg-primary');
      btnA.setAttribute('data-testid', 'send-button');
      btnA.setAttribute('disabled', '');
      btnA.disabled = true;

      const inputA = doc.createElement('div');
      inputA.setAttribute('data-lexical-editor', 'true');
      doc.body.appendChild(inputA);
      doc.body.appendChild(btnA);

      const resA = await domBridge.injectPromptAndSubmit('test prompt A', {
        document: doc,
        window: win,
        sendButton: btnA,
        pollTimeoutMs: 50,
        pollIntervalMs: 10
      });
      assert.strictEqual(resA.sendButtonClicked, false, 'Button with disabled attribute must NOT be considered ready');
      assert.strictEqual(resA.enterDispatched, false, 'Enter must not be dispatched when button exists');
      doc.body.children = [];
    }

    // Sub-case B: Button has disabled attribute removed, but still has cursor-not-allowed -> NOT ready
    {
      const btnB = doc.createElement('button', 'cursor-not-allowed bg-primary');
      btnB.setAttribute('data-testid', 'send-button');
      btnB.disabled = false;

      const inputB = doc.createElement('div');
      inputB.setAttribute('data-lexical-editor', 'true');
      doc.body.appendChild(inputB);
      doc.body.appendChild(btnB);

      const resB = await domBridge.injectPromptAndSubmit('test prompt B', {
        document: doc,
        window: win,
        sendButton: btnB,
        pollTimeoutMs: 50,
        pollIntervalMs: 10
      });
      assert.strictEqual(resB.sendButtonClicked, false, 'Button with cursor-not-allowed must NOT be considered ready');
      doc.body.children = [];
    }

    // Sub-case C: Button has styling classes but neither cursor-pointer nor bg-primary -> NOT ready
    {
      const btnC = doc.createElement('button', 'w-7 h-7 p-1.5 rounded-full text-muted-foreground');
      btnC.setAttribute('data-testid', 'send-button');
      btnC.disabled = false;

      const inputC = doc.createElement('div');
      inputC.setAttribute('data-lexical-editor', 'true');
      doc.body.appendChild(inputC);
      doc.body.appendChild(btnC);

      const resC = await domBridge.injectPromptAndSubmit('test prompt C', {
        document: doc,
        window: win,
        sendButton: btnC,
        pollTimeoutMs: 50,
        pollIntervalMs: 10
      });
      assert.strictEqual(resC.sendButtonClicked, false, 'Button without cursor-pointer or bg-primary must NOT be considered ready');
      doc.body.children = [];
    }

    // Sub-case D: Button has cursor-pointer bg-primary and disabled attribute removed -> READY
    {
      const btnD = doc.createElement('button', 'cursor-pointer bg-primary');
      btnD.setAttribute('data-testid', 'send-button');
      btnD.disabled = false;

      const inputD = doc.createElement('div');
      inputD.setAttribute('data-lexical-editor', 'true');
      doc.body.appendChild(inputD);
      doc.body.appendChild(btnD);

      const resD = await domBridge.injectPromptAndSubmit('test prompt D', {
        document: doc,
        window: win,
        sendButton: btnD,
        pollTimeoutMs: 50,
        pollIntervalMs: 10
      });
      assert.strictEqual(resD.sendButtonClicked, true, 'Button with cursor-pointer bg-primary and no disabled must be ready');
      doc.body.children = [];
    }

    console.log('  ✓ Verified readiness checks: disabled attribute, cursor-not-allowed, and cursor-pointer / bg-primary.');
  }

  // --------------------------------------------------------------------------
  // Test 4: Reliable Click Cascade Triggering
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 4: Reliable Native Event Cascade (pointerdown, mousedown, pointerup, mouseup, click)...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const container = doc.createElement('div');
    container.setAttribute('id', 'antigravity.agentSidePanelInputBox');
    doc.body.appendChild(container);

    const inputElem = doc.createElement('div');
    inputElem.setAttribute('data-lexical-editor', 'true');
    container.appendChild(inputElem);

    const sendBtn = doc.createElement('button', 'cursor-pointer bg-primary');
    sendBtn.setAttribute('data-testid', 'send-button');
    container.appendChild(sendBtn);

    const receivedEventTypes: string[] = [];
    sendBtn.dispatchEvent = (evt: any) => {
      receivedEventTypes.push(evt.type);
      sendBtn.dispatchedEvents.push(evt);
      return true;
    };
    sendBtn.click = () => {
      receivedEventTypes.push('click');
      sendBtn.clicked = true;
      sendBtn.clickCount++;
      inputElem.textContent = '';
    };

    const result = await domBridge.injectPromptAndSubmit('Cascade test prompt', {
      document: doc,
      window: win,
      pollTimeoutMs: 100,
      pollIntervalMs: 20
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.sendButtonClicked, true);

    // Verify full cascade occurred
    assert.ok(receivedEventTypes.includes('pointerdown'), 'Must dispatch pointerdown');
    assert.ok(receivedEventTypes.includes('mousedown'), 'Must dispatch mousedown');
    assert.ok(receivedEventTypes.includes('pointerup'), 'Must dispatch pointerup');
    assert.ok(receivedEventTypes.includes('mouseup'), 'Must dispatch mouseup');
    assert.ok(receivedEventTypes.includes('click'), 'Must dispatch click');

    const pointerdownIdx = receivedEventTypes.indexOf('pointerdown');
    const mousedownIdx = receivedEventTypes.indexOf('mousedown');
    const pointerupIdx = receivedEventTypes.indexOf('pointerup');
    const mouseupIdx = receivedEventTypes.indexOf('mouseup');
    const clickIdx = receivedEventTypes.indexOf('click');

    assert.ok(pointerdownIdx < mousedownIdx, 'pointerdown before mousedown');
    assert.ok(mousedownIdx < pointerupIdx, 'mousedown before pointerup');
    assert.ok(pointerupIdx < mouseupIdx, 'pointerup before mouseup');
    assert.ok(mouseupIdx < clickIdx, 'mouseup before click');

    console.log('  ✓ Full event cascade confirmed: pointerdown -> mousedown -> pointerup -> mouseup -> click.');
  }

  // --------------------------------------------------------------------------
  // Test 5: Re-evaluation of findSendButton on Every Poll Interval
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 5: Re-evaluation of findSendButton on Each Poll Interval...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const container = doc.createElement('div');
    container.setAttribute('id', 'antigravity.agentSidePanelInputBox');
    doc.body.appendChild(container);

    const inputElem = doc.createElement('div');
    inputElem.setAttribute('data-lexical-editor', 'true');
    inputElem.textContent = '';
    container.appendChild(inputElem);

    // Button is NOT in DOM initially
    assert.strictEqual(container.querySelector('[data-testid="send-button"]'), null);

    // Render button after 200ms
    setTimeout(() => {
      const lateBtn = doc.createElement('button', 'cursor-pointer bg-primary');
      lateBtn.setAttribute('data-testid', 'send-button');
      lateBtn.click = () => {
        lateBtn.clicked = true;
        lateBtn.clickCount++;
        inputElem.textContent = '';
      };
      container.appendChild(lateBtn);
    }, 200);

    const startTime = Date.now();
    const result = await domBridge.injectPromptAndSubmit('Late rendering prompt', {
      document: doc,
      window: win,
      pollTimeoutMs: 1500,
      pollIntervalMs: 50
    });
    const totalElapsed = Date.now() - startTime;

    assert.strictEqual(result.success, true, 'Result must succeed after discovering late rendered button');
    assert.strictEqual(result.sendButtonClicked, true, 'Late rendered button must be clicked');
    assert.strictEqual(result.submitStrategy, 'buttonClick', 'Submit strategy must be buttonClick');
    assert.strictEqual(result.enterDispatched, false, 'Enter must not be dispatched');
    assert.ok(result.buttonWaitDurationMs >= 150, `Waited for late render (${result.buttonWaitDurationMs}ms)`);
    assert.ok(totalElapsed < 1000, `Succeeded well within 1500ms limit (${totalElapsed}ms)`);

    console.log(`  ✓ Late-rendered send button discovered via interval re-evaluation in ${result.buttonWaitDurationMs}ms.`);
  }

  // --------------------------------------------------------------------------
  // Test 6: Permitted Synthetic Enter Fallback ONLY when NO Send Button Exists
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 6: Permitted Synthetic Enter Fallback when NO Send Button Exists Anywhere...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    // Deliberately NO send button in the document
    const inputElem = doc.createElement('div');
    inputElem.setAttribute('data-lexical-editor', 'true');
    inputElem.setAttribute('contenteditable', 'true');
    inputElem.textContent = '';
    doc.body.appendChild(inputElem);

    // Simulate input clearance upon keyup Enter event
    inputElem.addEventListener('keyup', (e: any) => {
      if (e.key === 'Enter') {
        inputElem.textContent = '';
        inputElem.innerText = '';
      }
    });

    const result = await domBridge.injectPromptAndSubmit('Enter fallback prompt', {
      document: doc,
      window: win,
      pollTimeoutMs: 60,
      pollIntervalMs: 20
    });

    assert.strictEqual(result.enterDispatched, true, 'Enter MUST be dispatched when NO send button exists in DOM');
    assert.strictEqual(result.submitStrategy, 'enterKey', 'Submit strategy must be enterKey');
    assert.strictEqual(result.sendButtonClicked, false, 'No send button was clicked');

    console.log('  ✓ Enter fallback correctly permitted only when send button is completely absent from DOM.');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL Phase 02 Send Button Readiness Tests PASSED!');
  console.log('================================================================\n');
}

// Support both Mocha runner and standalone node execution
const isMochaRunning = typeof (global as any).describe === 'function';
if (isMochaRunning) {
  (global as any).describe('Phase 02: Send Button Readiness Polling & Enter-Fallback Disabling', function (this: any) {
    if (this && typeof this.timeout === 'function') {
      this.timeout(15000);
    }
    (global as any).it('executes full Phase 02 readiness verification suite', async () => {
      await runTests();
    });
  });
} else {
  runTests().catch(err => {
    console.error('\n❌ Test failed with error:', err);
    process.exit(1);
  });
}
