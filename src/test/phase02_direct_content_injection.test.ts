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
  public inputType?: string;
  public data?: string;
  public key?: string;
  public code?: string;
  public keyCode?: number;

  constructor(type: string, options: any = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    if (options.inputType !== undefined) this.inputType = options.inputType;
    if (options.data !== undefined) this.data = options.data;
    if (options.key !== undefined) this.key = options.key;
    if (options.code !== undefined) this.code = options.code;
    if (options.keyCode !== undefined) this.keyCode = options.keyCode;
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
  public pmViewDesc?: any;
  public _pmView?: any;

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
  public execCommandCalls: { command: string; showUI: boolean; value: any }[] = [];
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

  execCommand(command: string, showUI: boolean = false, value: any = null): boolean {
    this.execCommandCalls.push({ command, showUI, value });
    return this.execCommandReturnValue;
  }
}

function createMockWindow(doc: MockDocument) {
  return {
    document: doc,
    Event: MockEvent,
    InputEvent: MockEvent,
    KeyboardEvent: MockEvent,
    MouseEvent: MockEvent,
    HTMLTextAreaElement: MockElement,
    HTMLInputElement: MockElement,
    monaco: undefined as any
  };
}

async function runPhase02Tests() {
  console.log('=== Running Phase 02: Multi-Strategy Direct Content Injection Engine Tests ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge, 'DOM Bridge module must be loaded');
  assert.strictEqual(typeof domBridge.injectPromptAndSubmit, 'function', 'injectPromptAndSubmit must be a function');

  // ==========================================================================
  // Test 1: Strategy 1 - Monaco Editor Model API
  // ==========================================================================
  console.log('[Test 1] Verifying Strategy 1: Monaco Editor Model API Injection...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const container = doc.createElement('div', 'monaco-editor');
    const inputArea = doc.createElement('textarea', 'inputarea');
    container.appendChild(inputArea);
    doc.body.appendChild(container);

    let modelValueSet = '';
    let executedEdits: any[] = [];
    let cursorPosition: any = null;

    const mockModel = {
      getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }),
      getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
      setValue: (val: string) => { modelValueSet = val; }
    };

    const mockEditor = {
      getDomNode: () => container,
      getModel: () => mockModel,
      executeEdits: (source: string, edits: any[]) => {
        executedEdits = edits;
        modelValueSet = edits[0]?.text;
      },
      setPosition: (pos: any) => {
        cursorPosition = pos;
      }
    };

    win.monaco = {
      editor: {
        getEditors: () => [mockEditor]
      }
    };

    const prompt = 'Fix the authentication race condition in login handler';
    const result = await domBridge.injectPromptAndSubmit(prompt, {
      document: doc,
      window: win,
      targetElement: inputArea
    });

    assert.strictEqual(result.success, true, 'Result should indicate success');
    assert.strictEqual(result.injectionStrategy, 'monaco-model', 'Strategy should be monaco-model');
    assert.strictEqual(modelValueSet, prompt, 'Monaco model should receive prompt text');
    assert.strictEqual(executedEdits.length, 1, 'Should execute edits with range and text');
    assert.ok(cursorPosition, 'Should set cursor position at end of text');
    console.log('  ✓ Monaco Model API executeEdits & cursor positioning verified.');
  }

  // ==========================================================================
  // Test 2: Strategy 2 - document.execCommand('insertText')
  // ==========================================================================
  console.log('\n[Test 2] Verifying Strategy 2: document.execCommand("insertText")...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    // Antigravity lexical editor container
    const lexicalEditor = doc.createElement('div');
    lexicalEditor.setAttribute('data-lexical-editor', 'true');
    lexicalEditor.setAttribute('contenteditable', 'true');
    doc.body.appendChild(lexicalEditor);

    const prompt = 'Implement unit tests for the token bucket rate limiter';
    const result = await domBridge.injectPromptAndSubmit(prompt, {
      document: doc,
      window: win,
      targetElement: lexicalEditor
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.injectionStrategy, 'execCommand', 'Strategy should be execCommand');
    assert.strictEqual(lexicalEditor.focused, true, 'Element must be focused with preventScroll');
    assert.strictEqual(lexicalEditor.focusOptions?.preventScroll, true, 'Focus options must include preventScroll: true');

    // Verify execCommand calls
    const selectAllCall = doc.execCommandCalls.find(c => c.command === 'selectAll');
    const insertTextCall = doc.execCommandCalls.find(c => c.command === 'insertText');
    assert.ok(selectAllCall, 'doc.execCommand("selectAll") must be executed');
    assert.ok(insertTextCall, 'doc.execCommand("insertText") must be executed');
    assert.strictEqual(insertTextCall?.value, prompt, 'insertText must receive the prompt text');
    console.log('  ✓ execCommand("selectAll") and execCommand("insertText") verified.');
  }

  // ==========================================================================
  // Test 3: Strategy 3 - ProseMirror Direct View & Transaction Dispatch
  // ==========================================================================
  console.log('\n[Test 3] Verifying Strategy 3: ProseMirror View & Transaction Dispatch...');
  {
    // Sub-case 3A: view.pasteText
    {
      const doc = new MockDocument();
      const win = createMockWindow(doc);
      doc.execCommandReturnValue = false; // Disable execCommand to reach Strategy 3

      const pmDiv = doc.createElement('div', 'ProseMirror');
      pmDiv.setAttribute('contenteditable', 'true');
      doc.body.appendChild(pmDiv);

      let pastedText = '';
      pmDiv.pmViewDesc = {
        view: {
          pasteText: (text: string) => { pastedText = text; }
        }
      };

      const prompt = 'Refactor database connection pool configuration';
      const result = await domBridge.injectPromptAndSubmit(prompt, {
        document: doc,
        window: win,
        targetElement: pmDiv
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.injectionStrategy, 'prosemirror-view');
      assert.strictEqual(pastedText, prompt, 'pasteText should receive prompt');
      console.log('  ✓ ProseMirror pasteText method verified.');
    }

    // Sub-case 3B: view.dispatch with transaction
    {
      const doc = new MockDocument();
      const win = createMockWindow(doc);
      doc.execCommandReturnValue = false;

      const pmDiv = doc.createElement('div', 'ProseMirror');
      pmDiv.setAttribute('contenteditable', 'true');
      doc.body.appendChild(pmDiv);

      let dispatchedTr: any = null;
      const mockTr = {
        replaceWith: (from: number, to: number, textNode: any) => {
          mockTr.from = from;
          mockTr.to = to;
          mockTr.textNode = textNode;
        },
        from: 0,
        to: 0,
        textNode: null
      };

      pmDiv._pmView = {
        state: {
          doc: { content: { size: 10 } },
          schema: {
            text: (t: string) => ({ type: 'text', text: t })
          },
          tr: mockTr
        },
        dispatch: (tr: any) => {
          dispatchedTr = tr;
        }
      };

      const prompt = 'Optimize SQL queries with composite indexes';
      const result = await domBridge.injectPromptAndSubmit(prompt, {
        document: doc,
        window: win,
        targetElement: pmDiv
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.injectionStrategy, 'prosemirror-transaction');
      assert.ok(dispatchedTr, 'Transaction must be dispatched');
      assert.strictEqual(dispatchedTr.textNode?.text, prompt, 'Transaction must contain prompt text node');
      console.log('  ✓ ProseMirror schema transaction dispatch verified.');
    }
  }

  // ==========================================================================
  // Test 4: Strategy 4 - W3C Input Events Level 2 Dispatching (Textarea / Input)
  // ==========================================================================
  console.log('\n[Test 4] Verifying Strategy 4: W3C Input Events Level 2 Dispatching...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);
    doc.execCommandReturnValue = false;

    const textarea = doc.createElement('textarea');
    textarea.setAttribute('placeholder', 'Ask a question...');
    doc.body.appendChild(textarea);

    const prompt = 'Generate comprehensive OpenAPI 3.1 specification for users route';
    const result = await domBridge.injectPromptAndSubmit(prompt, {
      document: doc,
      window: win,
      targetElement: textarea
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.injectionStrategy, 'textarea-value');
    assert.strictEqual(textarea.value, prompt, 'Textarea value must be set to prompt');

    // Verify beforeinput event
    const beforeInput = textarea.dispatchedEvents.find(e => e.type === 'beforeinput');
    assert.ok(beforeInput, 'beforeinput event must be dispatched');
    assert.strictEqual(beforeInput?.inputType, 'insertText');
    assert.strictEqual(beforeInput?.data, prompt);

    // Verify input event
    const inputEvent = textarea.dispatchedEvents.find(e => e.type === 'input');
    assert.ok(inputEvent, 'input event must be dispatched');
    assert.strictEqual(inputEvent?.inputType, 'insertText');
    assert.strictEqual(inputEvent?.data, prompt);

    // Verify change event
    const changeEvent = textarea.dispatchedEvents.find(e => e.type === 'change');
    assert.ok(changeEvent, 'change event must be dispatched');

    // Verify enter key events
    const enterDown = textarea.dispatchedEvents.find(e => e.type === 'keydown' && e.key === 'Enter');
    const enterUp = textarea.dispatchedEvents.find(e => e.type === 'keyup' && e.key === 'Enter');
    assert.ok(enterDown, 'Enter keydown event must be dispatched');
    assert.ok(enterUp, 'Enter keyup event must be dispatched');
    console.log('  ✓ beforeinput, input, change, and Enter key events verified.');
  }

  // ==========================================================================
  // Test 5: Strategy 5 - ContentEditable / Text Direct Fallback
  // ==========================================================================
  console.log('\n[Test 5] Verifying Strategy 5: ContentEditable / Text Direct Fallback...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);
    doc.execCommandReturnValue = false;

    const ceDiv = doc.createElement('div');
    ceDiv.setAttribute('role', 'textbox');
    doc.body.appendChild(ceDiv);

    const prompt = 'Direct fallback prompt text injection';
    const result = await domBridge.injectPromptAndSubmit(prompt, {
      document: doc,
      window: win,
      targetElement: ceDiv
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.injectionStrategy, 'contenteditable-text');
    assert.strictEqual(ceDiv.innerText, prompt, 'innerText should be populated with prompt text');
    console.log('  ✓ ContentEditable direct text fallback verified.');
  }

  // ==========================================================================
  // Test 6: Pre-Injection Focus Guard & Parent Container Focus
  // ==========================================================================
  console.log('\n[Test 6] Verifying Pre-Injection Focus Guard...');
  {
    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const parentContainer = doc.createElement('div', 'monaco-editor');
    const textarea = doc.createElement('textarea', 'inputarea');
    parentContainer.appendChild(textarea);
    doc.body.appendChild(parentContainer);

    // Initial active element is body
    doc.activeElement = doc.body;

    const prompt = 'Testing focus guard activation';
    await domBridge.injectPromptAndSubmit(prompt, {
      document: doc,
      window: win,
      targetElement: textarea
    });

    assert.strictEqual(textarea.focused, true, 'Input element must be focused');
    assert.strictEqual(textarea.focusOptions?.preventScroll, true, 'Focus must specify preventScroll: true');
    console.log('  ✓ Pre-Injection Focus Guard verified.');
  }

  console.log('\n=== All Phase 02 Tests Passed Successfully! ===');
}

runPhase02Tests().catch(err => {
  console.error('\n❌ Phase 02 Test Suite Failed:', err);
  process.exit(1);
});
