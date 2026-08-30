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

// Load autoplan-dom-bridge.js dynamically
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

/**
 * Lightweight mock DOM hierarchy for Node.js test execution
 */
class MockEvent {
  public type: string;
  public bubbles: boolean;
  public cancelable: boolean;
  public composed: boolean;
  public button: number;
  public target: any = null;
  public defaultPrevented: boolean = false;

  constructor(type: string, init: any = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? true;
    this.cancelable = init.cancelable ?? true;
    this.composed = init.composed ?? false;
    this.button = init.button ?? 0;
  }

  preventDefault() {
    this.defaultPrevented = true;
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
  public charCode: number;

  constructor(type: string, init: any = {}) {
    super(type, init);
    this.key = init.key || '';
    this.code = init.code || '';
    this.keyCode = init.keyCode || 0;
    this.which = init.which || 0;
    this.charCode = init.charCode || 0;
  }
}

class MockMouseEvent extends MockEvent {
  constructor(type: string, init: any = {}) {
    super(type, init);
  }
}

class MockPointerEvent extends MockMouseEvent {
  constructor(type: string, init: any = {}) {
    super(type, init);
  }
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

  toString(): string {
    return Array.from(this.classes).join(' ');
  }
}

class MockElement {
  public nodeType: number = 1;
  public tagName: string;
  public id: string = '';
  public classList: MockClassList;
  public attributes: Map<string, string> = new Map();
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public parentNode: MockElement | null = null;
  public shadowRoot: MockElement | null = null;
  public value: string = '';
  public textContent: string = '';
  public innerText: string = '';
  public disabled: boolean = false;
  public contentEditable: boolean | string = false;
  public dispatchedEvents: MockEvent[] = [];
  public isFocused: boolean = false;
  public clickCalled: boolean = false;

  constructor(tagName: string, id: string = '', className: string = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.classList = new MockClassList(className);
    if (id) this.attributes.set('id', id);
    if (className) this.attributes.set('class', className);
  }

  get className(): string {
    return this.classList.toString();
  }

  set className(val: string) {
    this.classList = new MockClassList(val);
    this.attributes.set('class', val);
  }

  setAttribute(name: string, val: string) {
    this.attributes.set(name.toLowerCase(), val);
    if (name.toLowerCase() === 'class') {
      this.classList = new MockClassList(val);
    }
    if (name.toLowerCase() === 'id') {
      this.id = val;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) || null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }

  removeAttribute(name: string) {
    this.attributes.delete(name.toLowerCase());
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  focus() {
    this.isFocused = true;
  }

  click() {
    this.clickCalled = true;
  }

  dispatchEvent(event: MockEvent): boolean {
    event.target = this;
    this.dispatchedEvents.push(event);
    return !event.defaultPrevented;
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

  contains(other: MockElement): boolean {
    if (other === this) return true;
    for (const ch of this.children) {
      if (ch.contains(other)) return true;
    }
    return false;
  }

  matches(selector: string): boolean {
    const parts = selector.split(',').map(s => s.trim());
    return parts.some(sel => this.matchesSingle(sel));
  }

  private matchesSingle(sel: string): boolean {
    if (sel === '*') return true;
    
    // Check escaped id e.g. #antigravity\.agentSidePanelInputBox
    const cleanSel = sel.replace(/\\/g, '');
    if (cleanSel.startsWith('#') && !cleanSel.includes(' ') && !cleanSel.includes('.')) {
      return this.id === cleanSel.slice(1);
    }

    // Direct tag match
    const tagMatch = sel.match(/^[a-zA-Z0-9_-]+/);
    if (tagMatch && tagMatch[0].toUpperCase() !== this.tagName) {
      return false;
    }

    // Class match
    const classMatches = sel.match(/\.([a-zA-Z0-9_-]+)/g);
    if (classMatches) {
      for (const cm of classMatches) {
        const cls = cm.slice(1);
        if (!this.classList.contains(cls)) {
          return false;
        }
      }
    }

    // ID match
    const idMatch = sel.match(/#([a-zA-Z0-9_.-]+)/);
    if (idMatch) {
      const idVal = idMatch[1].replace(/\\/g, '');
      if (this.id !== idVal) return false;
    }

    // Attribute match [attr*="val"] or [attr="val"]
    const attrMatches = sel.match(/\[([a-zA-Z0-9_:-]+)([*~|^$]?=)?['"]?([^'"\]]*)['"]?\]/g);
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
      if (node.shadowRoot) {
        traverse(node.shadowRoot);
      }
    };
    traverse(this);
    return results;
  }

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }
}

class MockDocument {
  public nodeType: number = 9;
  public body: MockElement;
  public activeElement: MockElement | null = null;
  public hidden: boolean = false;
  public execCommands: { command: string; value: any }[] = [];

  constructor() {
    this.body = new MockElement('BODY', 'mock-body');
  }

  createElement(tagName: string): MockElement {
    return new MockElement(tagName);
  }

  querySelector(selector: string): MockElement | null {
    if (this.body.matches(selector)) return this.body;
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    if (this.body.matches(selector)) results.push(this.body);
    results.push(...this.body.querySelectorAll(selector));
    return results;
  }

  getElementById(id: string): MockElement | null {
    return this.querySelector(`#${id}`);
  }

  execCommand(command: string, showUI: boolean, value: any): boolean {
    this.execCommands.push({ command, value });
    return true;
  }
}

async function runTests() {
  console.log('--- Starting Phase 01: DOM Bridge TDZ & Safe Context Resolution Tests ---');

  const bridge = loadDomBridge();
  assert.ok(bridge, 'DOM Bridge module must load successfully');

  // =========================================================================
  // Test 1: Zero TDZ Hazard & Safe Resolution when called in bare Node environment
  // =========================================================================
  console.log('\n[Test 1] TDZ Safety Check in bare environment...');
  {
    let caughtError: any = null;
    try {
      // Calling without options or document
      await bridge.injectPromptAndSubmit('test prompt bare');
    } catch (err: any) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Should reject when document is missing');
    // Must NOT throw ReferenceError: Cannot access 'win' before initialization
    assert.strictEqual(
      caughtError.message,
      'DOM document not available for prompt injection',
      `Error must be the expected DOM missing error, got: ${caughtError.message}`
    );
    assert.ok(
      !caughtError.stack?.includes('Cannot access \'win\' before initialization'),
      'Must not trigger TDZ ReferenceError'
    );
    console.log('  ✓ No TDZ ReferenceError when window/document are undefined');
  }

  // =========================================================================
  // Test 2: Ingestion and submission with mock document and without options.window
  // =========================================================================
  console.log('\n[Test 2] Safe win resolution when options.window is omitted...');
  {
    const mockDoc = new MockDocument();
    const container = new MockElement('div', 'antigravity.agentSidePanelInputBox', 'chat-widget');
    const textarea = new MockElement('textarea', 'prompt-input', 'inputarea');
    textarea.setAttribute('placeholder', 'Ask a question');
    const sendButton = new MockElement('button', 'send-btn', 'codicon-send');
    sendButton.setAttribute('aria-label', 'Send');

    container.appendChild(textarea);
    container.appendChild(sendButton);
    mockDoc.body.appendChild(container);

    const result = await bridge.injectPromptAndSubmit('Automate phase 01', {
      document: mockDoc,
      syncDelayMs: 0,
      pollTimeoutMs: 0
    });

    assert.ok(result, 'Result should be returned');
    assert.strictEqual(result.success, true, 'success should be true');
    assert.strictEqual(result.sendButtonClicked, true, 'sendButtonClicked should be true');
    assert.strictEqual(result.steps.length, 4, 'Should execute 4 steps');
    assert.strictEqual(result.steps[0].status, 'success', 'Step 1 should succeed');
    assert.strictEqual(result.steps[1].status, 'success', 'Step 2 should succeed');
    assert.strictEqual(result.steps[2].status, 'success', 'Step 3 should succeed');
    assert.strictEqual(result.steps[3].status, 'success', 'Step 4 should succeed');
    assert.strictEqual(sendButton.clickCalled, true, 'Send button click should have been called');

    console.log('  ✓ Successfully executed 4-step prompt injection & submission without options.window');
  }

  // =========================================================================
  // Test 3: Simulated Electron Window Context (Cross-Platform Windows / Linux)
  // =========================================================================
  console.log('\n[Test 3] Simulated Electron Window with Custom Event Classes...');
  {
    const mockDoc = new MockDocument();
    (mockDoc as any).execCommand = undefined;
    const mockWin = {
      InputEvent: MockInputEvent,
      KeyboardEvent: MockKeyboardEvent,
      MouseEvent: MockMouseEvent,
      PointerEvent: MockPointerEvent,
      Event: MockEvent,
      HTMLTextAreaElement: { prototype: MockElement.prototype }
    };

    const container = new MockElement('div', 'antigravity.agentSidePanelInputBox', 'interactive-session');
    const textarea = new MockElement('textarea', 'chat-box', 'inputarea');
    textarea.setAttribute('placeholder', 'Message Antigravity');
    const sendBtn = new MockElement('button', 'submit-btn', 'monaco-button');
    sendBtn.setAttribute('aria-label', 'Send message');

    container.appendChild(textarea);
    container.appendChild(sendBtn);
    mockDoc.body.appendChild(container);

    const result = await bridge.injectPromptAndSubmit('Execute Linux & Windows plan', {
      document: mockDoc,
      window: mockWin,
      syncDelayMs: 5,
      pollTimeoutMs: 10
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.sendButtonClicked, true);
    assert.strictEqual(result.submitStrategy, 'buttonClick');

    // Check dispatched input events on textarea
    const inputEvts = textarea.dispatchedEvents.map(e => e.type);
    assert.ok(inputEvts.includes('beforeinput'), 'Should dispatch beforeinput');
    assert.ok(inputEvts.includes('input'), 'Should dispatch input');
    assert.ok(inputEvts.includes('change'), 'Should dispatch change');
    assert.ok(inputEvts.includes('keydown'), 'Should dispatch keydown Enter');
    assert.ok(inputEvts.includes('keypress'), 'Should dispatch keypress Enter');
    assert.ok(inputEvts.includes('keyup'), 'Should dispatch keyup Enter');

    // Check pointer and mouse events on send button
    const btnEvts = sendBtn.dispatchedEvents.map(e => e.type);
    assert.ok(btnEvts.includes('pointerdown'), 'Should dispatch pointerdown on send button');
    assert.ok(btnEvts.includes('mousedown'), 'Should dispatch mousedown on send button');
    assert.ok(btnEvts.includes('pointerup'), 'Should dispatch pointerup on send button');
    assert.ok(btnEvts.includes('mouseup'), 'Should dispatch mouseup on send button');
    assert.ok(btnEvts.includes('click'), 'Should dispatch click on send button');

    console.log('  ✓ Correctly dispatched InputEvent, KeyboardEvent, PointerEvent, and MouseEvent cascades');
  }

  // =========================================================================
  // Test 4: execCommand Injection Fallback Verification
  // =========================================================================
  console.log('\n[Test 4] execCommand(\'insertText\') fallback strategy verification...');
  {
    const mockDoc = new MockDocument();
    const container = new MockElement('div', 'antigravity.agentSidePanelInputBox', 'composer-container');
    const contentEditableDiv = new MockElement('div', 'lexical-input', 'ProseMirror');
    contentEditableDiv.setAttribute('contenteditable', 'true');
    const sendBtn = new MockElement('button', 'send-button', 'send');
    sendBtn.setAttribute('title', 'Send');

    container.appendChild(contentEditableDiv);
    container.appendChild(sendBtn);
    mockDoc.body.appendChild(container);

    const result = await bridge.injectPromptAndSubmit('Lexical Prompt Text', {
      document: mockDoc,
      syncDelayMs: 0,
      pollTimeoutMs: 0
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.sendButtonClicked, true);
    assert.strictEqual(result.steps[1].strategy, 'execCommand');
    assert.strictEqual(mockDoc.execCommands.length, 2);
    assert.strictEqual(mockDoc.execCommands[0].command, 'selectAll');
    assert.strictEqual(mockDoc.execCommands[1].command, 'insertText');
    assert.strictEqual(mockDoc.execCommands[1].value, 'Lexical Prompt Text');

    console.log('  ✓ Successfully verified execCommand fallback strategy for rich-text inputs');
  }

  // =========================================================================
  // Test 5: Helper Functions Context Safety (dispatchButtonClickCascade, triggerNewConversation)
  // =========================================================================
  console.log('\n[Test 5] Helper functions safe context resolution...');
  {
    const mockBtn = new MockElement('button');
    // Calling dispatchButtonClickCascade without window parameter
    const dispatched = bridge.dispatchButtonClickCascade(mockBtn, null);
    assert.strictEqual(dispatched, true, 'dispatchButtonClickCascade should work safely without win argument');
    assert.strictEqual(mockBtn.clickCalled, true);

    // Testing triggerNewConversation
    const mockDoc = new MockDocument();
    const newChatBtn = new MockElement('button', 'new-chat', 'codicon-plus');
    newChatBtn.setAttribute('aria-label', 'New Chat');
    mockDoc.body.appendChild(newChatBtn);

    const newChatSuccess = await bridge.triggerNewConversation({ document: mockDoc });
    assert.strictEqual(newChatSuccess, true, 'triggerNewConversation should trigger new chat button');
    assert.strictEqual(newChatBtn.clickCalled, true);

    console.log('  ✓ dispatchButtonClickCascade and triggerNewConversation operate with complete context safety');
  }

  console.log('\n=======================================================');
  console.log('>>> ALL PHASE 01 DOM BRIDGE TDZ & INJECTION TESTS PASSED <<<');
  console.log('=======================================================');
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
