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

class MockFormElement extends MockElement {
  public formSubmitted: boolean = false;
  public submitSubmitter: any = null;

  constructor() {
    super('form');
  }

  requestSubmit(submitter?: any) {
    this.formSubmitted = true;
    this.submitSubmitter = submitter;
  }
}

class MockDocument {
  public nodeType: number = 9;
  public documentElement: MockElement;
  public body: MockElement;
  public activeElement: MockElement | null = null;
  public execCommandCalls: Array<{ command: string; showUI: boolean; value: string | null }> = [];

  constructor() {
    this.documentElement = new MockElement('html');
    this.documentElement.ownerDocument = this;
    this.body = new MockElement('body');
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName: string, className: string = ''): MockElement {
    let el: MockElement;
    if (tagName.toLowerCase() === 'form') {
      el = new MockFormElement();
    } else {
      el = new MockElement(tagName, className);
    }
    el.ownerDocument = this;
    return el;
  }

  execCommand(command: string, showUI: boolean = false, value: string | null = null): boolean {
    this.execCommandCalls.push({ command, showUI, value });
    return true;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    if (this.documentElement.matches(selector)) {
      results.push(this.documentElement);
    }
    results.push(...this.documentElement.querySelectorAll(selector));
    return results;
  }
}

function createMockWindow() {
  return {
    PointerEvent: MockPointerEvent,
    MouseEvent: MockMouseEvent,
    KeyboardEvent: MockKeyboardEvent,
    InputEvent: MockInputEvent,
    Event: MockEvent,
    HTMLTextAreaElement: { prototype: { value: '' } },
    HTMLInputElement: { prototype: { value: '' } }
  };
}

async function runPhase02Tests() {
  console.log('=== Running Phase 02: Lexical React State Sync & Enter/Click Cascade Submission Tests ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge, 'DOM Bridge module must be loaded');
  assert.strictEqual(typeof domBridge.injectPromptAndSubmit, 'function', 'injectPromptAndSubmit must be exported');
  assert.strictEqual(typeof domBridge.dispatchButtonClickCascade, 'function', 'dispatchButtonClickCascade must be exported');

  // ==========================================================================
  // Test 1: Asynchronous Button Enablement Polling in Antigravity Chat Panel
  // ==========================================================================
  console.log('[Test 1] Verifying asynchronous button enablement polling (disabled -> enabled after 60ms)...');
  const doc1 = new MockDocument();
  const win1 = createMockWindow();

  const container1 = doc1.createElement('div');
  container1.setAttribute('id', 'antigravity.agentSidePanelInputBox');
  doc1.body.appendChild(container1);

  const lexicalInput1 = doc1.createElement('div');
  lexicalInput1.setAttribute('data-lexical-editor', 'true');
  lexicalInput1.setAttribute('contenteditable', 'true');
  container1.appendChild(lexicalInput1);

  const sendBtn1 = doc1.createElement('button');
  sendBtn1.setAttribute('data-testid', 'send-button');
  sendBtn1.setAttribute('aria-label', 'Send message');
  sendBtn1.disabled = true; // Initially disabled before typing
  container1.appendChild(sendBtn1);

  // Simulate Lexical AST reconciliation enabling the button after 60ms
  setTimeout(() => {
    sendBtn1.disabled = false;
    sendBtn1.setAttribute('aria-disabled', 'false');
  }, 60);

  const startTime1 = Date.now();
  const result1 = await domBridge.injectPromptAndSubmit('Create unit tests for plan', {
    document: doc1,
    window: win1,
    syncDelayMs: 25,
    pollTimeoutMs: 250,
    pollIntervalMs: 20
  });
  const elapsed1 = Date.now() - startTime1;

  assert.strictEqual(result1.success, true, 'Result should indicate successful submission');
  assert.strictEqual(result1.sendButtonClicked, true, 'Send button should be clicked after becoming enabled');
  assert.strictEqual(result1.submitStrategy, 'buttonClick', 'Submit strategy should be buttonClick');
  assert.strictEqual(sendBtn1.clicked, true, 'sendBtn.clicked should be true');
  assert.ok(sendBtn1.clickCount >= 1, 'sendBtn should have been clicked at least once');
  assert.strictEqual(result1.initialDisabled, true, 'initialDisabled should reflect initial button state');
  assert.ok(result1.buttonWaitDurationMs >= 20, `buttonWaitDurationMs (${result1.buttonWaitDurationMs}ms) should reflect wait time >= 20ms`);
  assert.ok(elapsed1 < 350, `Total execution time (${elapsed1}ms) should be fast (< 350ms)`);

  console.log(`  ✓ Button enablement polling succeeded in ${result1.buttonWaitDurationMs}ms (total: ${elapsed1}ms).`);

  // ==========================================================================
  // Test 2: Keyboard Enter Event Sequence (keydown, keypress, keyup with composed: true)
  // ==========================================================================
  console.log('\n[Test 2] Verifying full KeyboardEvent sequence on input (keydown, keypress, keyup with composed: true)...');
  const doc2 = new MockDocument();
  const win2 = createMockWindow();

  const input2 = doc2.createElement('div');
  input2.setAttribute('data-lexical-editor', 'true');
  input2.setAttribute('contenteditable', 'true');
  doc2.body.appendChild(input2);

  const result2 = await domBridge.injectPromptAndSubmit('Keyboard enter test', {
    document: doc2,
    window: win2,
    syncDelayMs: 0,
    pollTimeoutMs: 50
  });

  assert.strictEqual(result2.enterDispatched, true, 'enterDispatched must be true');

  const kbEvents = input2.dispatchedEvents.filter(e => e instanceof MockKeyboardEvent);
  assert.strictEqual(kbEvents.length, 3, 'Should dispatch keydown, keypress, and keyup on inputElem');

  const [keydown, keypress, keyup] = kbEvents as MockKeyboardEvent[];
  assert.strictEqual(keydown.type, 'keydown');
  assert.strictEqual(keydown.key, 'Enter');
  assert.strictEqual(keydown.code, 'Enter');
  assert.strictEqual(keydown.keyCode, 13);
  assert.strictEqual(keydown.which, 13);
  assert.strictEqual(keydown.composed, true, 'keydown must have composed: true for Lexical AST');

  assert.strictEqual(keypress.type, 'keypress');
  assert.strictEqual(keypress.key, 'Enter');
  assert.strictEqual(keypress.code, 'Enter');
  assert.strictEqual(keypress.keyCode, 13);
  assert.strictEqual(keypress.which, 13);
  assert.strictEqual(keypress.composed, true, 'keypress must have composed: true for Lexical AST');

  assert.strictEqual(keyup.type, 'keyup');
  assert.strictEqual(keyup.key, 'Enter');
  assert.strictEqual(keyup.code, 'Enter');
  assert.strictEqual(keyup.keyCode, 13);
  assert.strictEqual(keyup.which, 13);
  assert.strictEqual(keyup.composed, true, 'keyup must have composed: true for Lexical AST');

  console.log('  ✓ Keyboard Enter events (keydown, keypress, keyup) dispatched with composed: true.');

  // ==========================================================================
  // Test 3: Pointer & Mouse Click Cascade on Send Button
  // ==========================================================================
  console.log('\n[Test 3] Verifying native pointer & mouse click cascade on target send button...');
  const doc3 = new MockDocument();
  const win3 = createMockWindow();

  const button3 = doc3.createElement('button');
  button3.setAttribute('aria-label', 'Send message');
  doc3.body.appendChild(button3);

  domBridge.dispatchButtonClickCascade(button3, win3);

  assert.strictEqual(button3.clicked, true, 'button3.click() must be executed');
  assert.strictEqual(button3.clickCount, 1, 'Native click count should be 1');

  const dispatched = button3.dispatchedEvents;
  const eventTypes = dispatched.map(e => e.type);
  assert.ok(eventTypes.includes('pointerdown'), 'pointerdown event must be dispatched');
  assert.ok(eventTypes.includes('mousedown'), 'mousedown event must be dispatched');
  assert.ok(eventTypes.includes('pointerup'), 'pointerup event must be dispatched');
  assert.ok(eventTypes.includes('mouseup'), 'mouseup event must be dispatched');

  // Verify composed: true on pointer and mouse events
  const pointerDownEv = dispatched.find(e => e.type === 'pointerdown');
  assert.strictEqual(pointerDownEv?.composed, true, 'pointerdown must have composed: true');

  const mouseDownEv = dispatched.find(e => e.type === 'mousedown');
  assert.strictEqual(mouseDownEv?.composed, true, 'mousedown must have composed: true');

  console.log('  ✓ Native pointer and mouse cascade verified successfully.');

  // ==========================================================================
  // Test 4: Double-Tap Retry on Disabled/Transitioning Button
  // ==========================================================================
  console.log('\n[Test 4] Verifying double-tap retry operates strictly on confirmed send button...');
  const doc4 = new MockDocument();
  const win4 = createMockWindow();

  const container4 = doc4.createElement('div', 'chat-widget');
  doc4.body.appendChild(container4);

  const input4 = doc4.createElement('textarea');
  input4.setAttribute('placeholder', 'Type a message...');
  container4.appendChild(input4);

  const sendBtn4 = doc4.createElement('button', 'codicon-send');
  sendBtn4.disabled = true; // Initially disabled while framework updates
  container4.appendChild(sendBtn4);

  // Simulate button becoming enabled after 15ms
  setTimeout(() => {
    sendBtn4.disabled = false;
  }, 15);

  const result4 = await domBridge.injectPromptAndSubmit('Double-tap test prompt', {
    document: doc4,
    window: win4,
    syncDelayMs: 10,
    pollTimeoutMs: 50,
    doubleTapRetry: true,
    doubleTapDelayMs: 20
  });

  assert.strictEqual(result4.doubleTapExecuted, true, 'doubleTapExecuted must be true when button was disabled');
  assert.strictEqual(sendBtn4.clickCount, 2, 'sendBtn4 should receive 2 click executions (initial + double-tap retry)');
  assert.strictEqual(result4.sendButtonClicked, true, 'sendButtonClicked should be true');

  console.log('  ✓ Double-tap retry executed twice on confirmed send button.');

  // ==========================================================================
  // Test 5: Form Submission Fallback
  // ==========================================================================
  console.log('\n[Test 5] Verifying form submission fallback when no send button is available...');
  const doc5 = new MockDocument();
  const win5 = createMockWindow();

  const form5 = doc5.createElement('form') as MockFormElement;
  doc5.body.appendChild(form5);

  const input5 = doc5.createElement('textarea');
  input5.setAttribute('placeholder', 'Type a message...');
  form5.appendChild(input5);
  input5.form = form5;

  (win5 as any).KeyboardEvent = undefined;

  const result5 = await domBridge.injectPromptAndSubmit('Form fallback prompt', {
    document: doc5,
    window: win5,
    syncDelayMs: 0,
    pollTimeoutMs: 20
  });

  assert.strictEqual(result5.formSubmitted, true, 'formSubmitted should be true');
  assert.strictEqual(form5.formSubmitted, true, 'form.requestSubmit should have been called');
  assert.strictEqual(result5.submitStrategy, 'formSubmit', 'submitStrategy should be formSubmit');

  console.log('  ✓ Form submission fallback verified.');

  // ==========================================================================
  // Test 6: Step-by-Step Diagnostic Report Structure
  // ==========================================================================
  console.log('\n[Test 6] Verifying step-by-step diagnostic report accuracy...');
  const doc6 = new MockDocument();
  const win6 = createMockWindow();

  const agentBox6 = doc6.createElement('div');
  agentBox6.setAttribute('id', 'antigravity.agentSidePanelInputBox');
  doc6.body.appendChild(agentBox6);

  const lexicalInput6 = doc6.createElement('div');
  lexicalInput6.setAttribute('data-lexical-editor', 'true');
  agentBox6.appendChild(lexicalInput6);

  const sendBtn6 = doc6.createElement('button');
  sendBtn6.setAttribute('data-testid', 'send-button');
  sendBtn6.disabled = false;
  agentBox6.appendChild(sendBtn6);

  const result6 = await domBridge.injectPromptAndSubmit('Diagnostic telemetry test', {
    document: doc6,
    window: win6,
    syncDelayMs: 15,
    pollTimeoutMs: 50
  });

  assert.ok(Array.isArray(result6.steps), 'steps should be an array');
  assert.strictEqual(result6.steps.length, 4, 'Should contain 4 diagnostic steps');
  assert.strictEqual(result6.steps[0].name, 'Input discovery & focus');
  assert.strictEqual(result6.steps[1].name, 'Content injection');
  assert.strictEqual(result6.steps[2].name, 'Event dispatching');
  assert.strictEqual(result6.steps[3].name, 'Submit triggering');
  assert.strictEqual(result6.steps[3].status, 'success');
  assert.strictEqual(result6.steps[3].submitStrategy, 'buttonClick');
  assert.ok(result6.diagnostics, 'diagnostics object should be present');
  assert.strictEqual(result6.charsInjected, 'Diagnostic telemetry test'.length);

  console.log('  ✓ Diagnostic report telemetry structure verified.');

  // ==========================================================================
  // Test 7: Dynamically Replaced Send Button During Polling
  // ==========================================================================
  console.log('\n[Test 7] Verifying dynamically replaced send button during polling...');
  const doc7 = new MockDocument();
  const win7 = createMockWindow();

  const container7 = doc7.createElement('div', 'chat-widget');
  doc7.body.appendChild(container7);

  const input7 = doc7.createElement('textarea');
  input7.setAttribute('placeholder', 'Type a message...');
  container7.appendChild(input7);

  const initialDisabledBtn = doc7.createElement('button', 'send-btn');
  initialDisabledBtn.disabled = true;
  container7.appendChild(initialDisabledBtn);

  // Replace initial disabled button with new enabled button after 40ms
  let newEnabledBtn: MockElement;
  setTimeout(() => {
    // Remove disabled button
    container7.children = container7.children.filter(c => c !== initialDisabledBtn);
    newEnabledBtn = doc7.createElement('button', 'send-btn');
    newEnabledBtn.setAttribute('aria-label', 'Send message');
    newEnabledBtn.disabled = false;
    container7.appendChild(newEnabledBtn);
  }, 40);

  const result7 = await domBridge.injectPromptAndSubmit('Dynamic replacement prompt', {
    document: doc7,
    window: win7,
    syncDelayMs: 10,
    pollTimeoutMs: 200,
    pollIntervalMs: 20
  });

  assert.strictEqual(result7.success, true, 'Should succeed with refreshed button');
  assert.strictEqual(result7.sendButtonClicked, true, 'sendButtonClicked should be true');
  assert.ok(newEnabledBtn!.clicked, 'Newly mounted enabled button should be clicked');

  console.log('  ✓ Dynamically replaced send button resolved and clicked successfully.');

  console.log('\n=== All Phase 02 Tests Passed Successfully! ===');
}

runPhase02Tests().catch(err => {
  console.error('\n❌ Phase 02 Test Failed:', err);
  process.exit(1);
});
