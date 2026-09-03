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
      delete require.cache[require.resolve(p)];
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
  public clicked: boolean = false;
  public clickCount: number = 0;
  public dispatchedEvents: MockEvent[] = [];
  public rect: { width: number; height: number; top: number; left: number } = { width: 100, height: 30, top: 0, left: 0 };
  public offsetParent: MockElement | null = null;
  public focused: boolean = false;
  public focusOptions: any = null;

  // Simulated Lexical editor state
  public lexicalText: string = '';

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

  click() {
    this.clicked = true;
    this.clickCount++;
  }

  focus(options?: any) {
    this.focused = true;
    this.focusOptions = options;
  }

  dispatchEvent(event: any): boolean {
    event.target = this;
    this.dispatchedEvents.push(event);

    // If this is a Lexical editor element, simulate Lexical's native input listener behavior:
    // When inputType is 'insertText' and data is provided, Lexical inserts data into its state.
    if (this.hasAttribute('data-lexical-editor') && event.type === 'input') {
      if (event.inputType === 'insertText' && event.data) {
        this.lexicalText += event.data;
      }
    }

    return true;
  }

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (curr.matches(selector)) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  matches(selector: string): boolean {
    if (!selector) return false;
    const parts = selector.split(',').map(s => s.trim());
    return parts.some(sel => {
      if (sel.startsWith('#') && this.id === sel.slice(1)) return true;
      if (sel.startsWith('.') && this.classList.contains(sel.slice(1))) return true;
      if (sel.toLowerCase() === this.tagName.toLowerCase()) return true;
      if (sel.includes('[data-lexical-editor="true"]') && this.getAttribute('data-lexical-editor') === 'true') return true;
      if (sel.includes('[contenteditable="true"]') && (this.getAttribute('contenteditable') === 'true' || (this as any).contentEditable === 'true')) return true;
      return false;
    });
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    for (const child of this.children) {
      if (child.matches(selector)) results.push(child);
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }
}

class MockDocument {
  public nodeType: number = 9;
  public documentElement: MockElement;
  public body: MockElement;
  public activeElement: MockElement | null = null;
  public execCommandCalls: Array<{ command: string; showUI: boolean; value: string | null }> = [];
  public execCommandReturnValue: boolean = true;

  constructor() {
    this.documentElement = new MockElement('html');
    this.documentElement.ownerDocument = this;
    this.body = new MockElement('body');
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName: string, className: string = ''): MockElement {
    const el = new MockElement(tagName, className);
    el.ownerDocument = this;
    return el;
  }

  execCommand(command: string, showUI: boolean = false, value: string | null = null): boolean {
    this.execCommandCalls.push({ command, showUI, value });
    if (this.activeElement && this.activeElement.hasAttribute('data-lexical-editor')) {
      if (command === 'selectAll') {
        this.activeElement.lexicalText = '';
      } else if (command === 'insertText' && value) {
        this.activeElement.lexicalText += value;
      } else if (command === 'insertLineBreak') {
        this.activeElement.lexicalText += '\n';
      }
    }
    return this.execCommandReturnValue;
  }

  getSelection() {
    return {
      removeAllRanges: () => {},
      addRange: () => {}
    };
  }

  createRange() {
    return {
      selectNodeContents: () => {}
    };
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    if (this.documentElement.matches(selector)) results.push(this.documentElement);
    results.push(...this.documentElement.querySelectorAll(selector));
    return results;
  }
}

function createMockWindow(doc: MockDocument) {
  return {
    PointerEvent: MockPointerEvent,
    MouseEvent: MockMouseEvent,
    KeyboardEvent: MockKeyboardEvent,
    InputEvent: MockInputEvent,
    Event: MockEvent,
    HTMLTextAreaElement: { prototype: { value: '' } },
    HTMLInputElement: { prototype: { value: '' } },
    getSelection: () => doc.getSelection()
  };
}

async function runTests() {
  console.log('=== Running Test: DOM Bridge No-Duplicate & Multiline Lexical Injection ===\n');

  const domBridge = loadDomBridge();
  assert.strictEqual(typeof domBridge.injectPromptAndSubmit, 'function');

  // ==========================================================================
  // Test 1: Multiline Prompt in Lexical Editor (Preserves Newlines & NO x2 Duplication)
  // ==========================================================================
  console.log('[Test 1] Verifying Multiline Prompt Injection in Lexical Editor (No x2, Preserves \\n)...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const lexicalInput = doc.createElement('div');
    lexicalInput.setAttribute('data-lexical-editor', 'true');
    lexicalInput.setAttribute('contenteditable', 'true');
    doc.body.appendChild(lexicalInput);
    doc.activeElement = lexicalInput;

    const sendBtn = doc.createElement('button', 'send-button');
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.setAttribute('data-testid', 'send-button');
    doc.body.appendChild(sendBtn);

    const multilinePrompt = 'Implement the code closely following file.md\nNote, follow requirements.\nWhen done say "Done".';

    const result = await domBridge.injectPromptAndSubmit(multilinePrompt, {
      document: doc,
      window: win,
      targetElement: lexicalInput,
      sendButton: sendBtn
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.injectionStrategy, 'execCommand');
    assert.strictEqual(result.sendButtonClicked, true);

    // 1. Verify execCommand calls preserved all lines and linebreaks
    const insertTextCalls = doc.execCommandCalls.filter(c => c.command === 'insertText');
    const insertLineBreakCalls = doc.execCommandCalls.filter(c => c.command === 'insertLineBreak');
    assert.strictEqual(insertTextCalls.length, 3, 'Should have 3 insertText calls for 3 lines');
    assert.strictEqual(insertTextCalls[0].value, 'Implement the code closely following file.md');
    assert.strictEqual(insertTextCalls[1].value, 'Note, follow requirements.');
    assert.strictEqual(insertTextCalls[2].value, 'When done say "Done".');
    assert.strictEqual(insertLineBreakCalls.length, 2, 'Should have 2 insertLineBreak calls for newlines');

    // 2. Verify Step 3 InputEvent did NOT pass data (preventing Lexical duplicate insertion)
    const inputEvents = lexicalInput.dispatchedEvents.filter(e => e.type === 'input');
    assert.strictEqual(inputEvents.length, 1, 'Should dispatch 1 input event');
    const inputEv = inputEvents[0] as MockInputEvent;
    assert.strictEqual(inputEv.data, '', 'InputEvent on contenteditable/Lexical MUST NOT have data attached to avoid duplicate text insertion');

    // 3. Verify Lexical simulated content contains EXACTLY ONE COPY of the prompt with newlines
    assert.strictEqual(lexicalInput.lexicalText, multilinePrompt, 'Lexical text must match exactly 1 copy with newlines preserved');
    console.log('  ✓ Multiline Lexical injection verified: preserved all lines, 0 duplicate text.');
  }

  // ==========================================================================
  // Test 2: Single-line Prompt in Lexical Editor
  // ==========================================================================
  console.log('\n[Test 2] Verifying Single-line Prompt Injection in Lexical Editor...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const lexicalInput = doc.createElement('div');
    lexicalInput.setAttribute('data-lexical-editor', 'true');
    lexicalInput.setAttribute('contenteditable', 'true');
    doc.body.appendChild(lexicalInput);
    doc.activeElement = lexicalInput;

    const singleLinePrompt = 'Single line prompt without newlines';

    const result = await domBridge.injectPromptAndSubmit(singleLinePrompt, {
      document: doc,
      window: win,
      targetElement: lexicalInput
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.injectionStrategy, 'execCommand');

    const insertTextCalls = doc.execCommandCalls.filter(c => c.command === 'insertText');
    assert.strictEqual(insertTextCalls.length, 1, 'Single-line prompt uses exactly 1 insertText call');
    assert.strictEqual(insertTextCalls[0].value, singleLinePrompt);

    const inputEvents = lexicalInput.dispatchedEvents.filter(e => e.type === 'input');
    const inputEv = inputEvents[0] as MockInputEvent;
    assert.strictEqual(inputEv.data, '', 'InputEvent must not carry redundant data');
    assert.strictEqual(lexicalInput.lexicalText, singleLinePrompt);
    console.log('  ✓ Single-line Lexical injection verified.');
  }

  // ==========================================================================
  // Test 3: Standard Textarea Compatibility (React State Sync Maintained)
  // ==========================================================================
  console.log('\n[Test 3] Verifying Standard Textarea Compatibility...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const textarea = doc.createElement('textarea');
    doc.body.appendChild(textarea);

    const prompt = 'Textarea prompt test\nSecond line';

    const result = await domBridge.injectPromptAndSubmit(prompt, {
      document: doc,
      window: win,
      targetElement: textarea
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.injectionStrategy, 'textarea-value');
    assert.strictEqual(textarea.value, prompt);

    // Verify textarea InputEvent preserves inputType and data for React
    const inputEvents = textarea.dispatchedEvents.filter(e => e.type === 'input');
    const inputEv = inputEvents[0] as MockInputEvent;
    assert.strictEqual(inputEv.inputType, 'insertText');
    assert.strictEqual(inputEv.data, prompt);
    console.log('  ✓ Textarea compatibility verified with React state sync events intact.');
  }

  console.log('\n=== All Tests Passed Successfully! ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
