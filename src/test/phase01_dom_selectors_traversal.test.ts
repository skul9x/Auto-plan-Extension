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

  dispatchEvent(_event: any): boolean {
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

    // Last segment must match this element
    const lastSeg = segments[segments.length - 1];
    if (!this.matchSingleSegment(lastSeg)) {
      return false;
    }

    // Ancestors must match remaining segments from right to left
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

    // Extract ID if present (handles escaped periods e.g. #antigravity\\.agentSidePanelInputBox)
    let working = sel;
    const idMatch = working.match(/#([a-zA-Z0-9_\-\\.]+)/);
    if (idMatch) {
      const rawId = idMatch[1].replace(/\\/g, '');
      if (this.id !== rawId) {
        return false;
      }
      working = working.replace(idMatch[0], '');
    }

    // Extract tag name
    const tagMatch = working.match(/^[a-zA-Z0-9_-]+/);
    if (tagMatch) {
      if (tagMatch[0].toUpperCase() !== this.tagName) {
        return false;
      }
      working = working.replace(tagMatch[0], '');
    }

    // Extract classes
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

    // Extract attributes
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

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    if (this.documentElement.matches(selector)) {
      results.push(this.documentElement);
    }
    results.push(...this.documentElement.querySelectorAll(selector));
    return results;
  }
}

async function runPhase01Tests() {
  console.log('=== Running Phase 01: Deep DOM Traversal & Selector Engine Enhancement Tests ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge, 'DOM Bridge module must be loaded');
  assert.ok(Array.isArray(domBridge.CONTAINER_SELECTORS), 'CONTAINER_SELECTORS must be an array');
  assert.strictEqual(typeof domBridge.queryDeep, 'function', 'queryDeep must be a function');
  assert.strictEqual(typeof domBridge.findChatInput, 'function', 'findChatInput must be a function');
  assert.strictEqual(typeof domBridge.findSendButton, 'function', 'findSendButton must be a function');

  // ==========================================================================
  // Test 1: CONTAINER_SELECTORS Coverage & Scoped Compound Resolution
  // ==========================================================================
  console.log('[Test 1] Verifying CONTAINER_SELECTORS coverage and scoped compound query traversal...');
  const expectedContainers = [
    '#antigravity\\.agentSidePanelInputBox',
    'div[id*="agentSidePanelInputBox"]',
    '.chat-widget',
    '.interactive-session',
    'div.chat-input',
    '.chat-input-container',
    '.chat-input-part',
    '.interactive-input',
    '.chat-editor-widget',
    '.composer-container',
    '.composer-bar',
    '.monaco-dialog-box',
    '.notifications-toasts'
  ];

  for (const exp of expectedContainers) {
    assert.ok(
      domBridge.CONTAINER_SELECTORS.includes(exp),
      `CONTAINER_SELECTORS should contain "${exp}"`
    );
  }

  // Scoped compound query inside container: e.g. .chat-widget .monaco-editor textarea.inputarea
  const doc1 = new MockDocument();
  const chatWidget = doc1.createElement('div', 'chat-widget');
  doc1.body.appendChild(chatWidget);

  const monacoWrapper = doc1.createElement('div', 'monaco-editor');
  chatWidget.appendChild(monacoWrapper);

  const monacoTextarea = doc1.createElement('textarea', 'inputarea');
  monacoWrapper.appendChild(monacoTextarea);

  const foundNested = domBridge.queryDeep('.chat-widget .monaco-editor textarea.inputarea', doc1);
  assert.strictEqual(foundNested.length, 1, 'Should resolve compound selector starting with container class');
  assert.strictEqual(foundNested[0], monacoTextarea, 'Resolved element must be the inner textarea');
  console.log('  ✓ Container selectors & scoped compound query verified.');

  // ==========================================================================
  // Test 2: findChatInput Resolution Across All Specified Input Types
  // ==========================================================================
  console.log('\n[Test 2] Verifying findChatInput resolution for all modern input types...');

  const inputCases: { name: string; setup: (doc: MockDocument) => MockElement }[] = [
    {
      name: 'div[data-lexical-editor="true"] (Antigravity Live Agent Input)',
      setup: doc => {
        const div = doc.createElement('div');
        div.setAttribute('data-lexical-editor', 'true');
        div.setAttribute('contenteditable', 'true');
        return div;
      }
    },
    {
      name: 'div[aria-label="Message input"]',
      setup: doc => {
        const div = doc.createElement('div');
        div.setAttribute('aria-label', 'Message input');
        div.setAttribute('contenteditable', 'true');
        return div;
      }
    },
    {
      name: '#antigravity.agentSidePanelInputBox [contenteditable="true"]',
      setup: doc => {
        const container = doc.createElement('div');
        container.setAttribute('id', 'antigravity.agentSidePanelInputBox');
        const ce = doc.createElement('div');
        ce.setAttribute('contenteditable', 'true');
        container.appendChild(ce);
        doc.body.appendChild(container);
        return ce;
      }
    },
    {
      name: 'div[contenteditable="true"][role="combobox"]',
      setup: doc => {
        const div = doc.createElement('div');
        div.setAttribute('contenteditable', 'true');
        div.setAttribute('role', 'combobox');
        return div;
      }
    },
    {
      name: '.chat-widget .monaco-editor textarea.inputarea',
      setup: doc => {
        const cw = doc.createElement('div', 'chat-widget');
        const me = doc.createElement('div', 'monaco-editor');
        const ta = doc.createElement('textarea', 'inputarea');
        cw.appendChild(me);
        me.appendChild(ta);
        doc.body.appendChild(cw);
        return ta;
      }
    },
    {
      name: '.interactive-session .monaco-editor textarea.inputarea',
      setup: doc => {
        const is = doc.createElement('div', 'interactive-session');
        const me = doc.createElement('div', 'monaco-editor');
        const ta = doc.createElement('textarea', 'inputarea');
        is.appendChild(me);
        me.appendChild(ta);
        doc.body.appendChild(is);
        return ta;
      }
    },
    {
      name: '.interactive-input .monaco-editor textarea.inputarea',
      setup: doc => {
        const ii = doc.createElement('div', 'interactive-input');
        const me = doc.createElement('div', 'monaco-editor');
        const ta = doc.createElement('textarea', 'inputarea');
        ii.appendChild(me);
        me.appendChild(ta);
        doc.body.appendChild(ii);
        return ta;
      }
    },
    {
      name: 'div.interactive-input-editor textarea',
      setup: doc => {
        const wrapper = doc.createElement('div', 'interactive-input-editor');
        const ta = doc.createElement('textarea');
        wrapper.appendChild(ta);
        doc.body.appendChild(wrapper);
        return ta;
      }
    },
    {
      name: 'div.monaco-editor textarea.inputarea',
      setup: doc => {
        const me = doc.createElement('div', 'monaco-editor');
        const ta = doc.createElement('textarea', 'inputarea');
        me.appendChild(ta);
        doc.body.appendChild(me);
        return ta;
      }
    },
    {
      name: 'div.monaco-editor[role="textbox"]',
      setup: doc => {
        const me = doc.createElement('div', 'monaco-editor');
        me.setAttribute('role', 'textbox');
        return me;
      }
    },
    {
      name: 'div.ProseMirror[contenteditable="true"]',
      setup: doc => {
        const pm = doc.createElement('div', 'ProseMirror');
        pm.setAttribute('contenteditable', 'true');
        return pm;
      }
    },
    {
      name: 'div.ProseMirror',
      setup: doc => doc.createElement('div', 'ProseMirror')
    },
    {
      name: 'div[contenteditable="true"][role="textbox"]',
      setup: doc => {
        const div = doc.createElement('div');
        div.setAttribute('contenteditable', 'true');
        div.setAttribute('role', 'textbox');
        return div;
      }
    },
    {
      name: '[data-testid="composer-input"]',
      setup: doc => {
        const el = doc.createElement('div');
        el.setAttribute('data-testid', 'composer-input-field');
        return el;
      }
    },
    {
      name: '[data-testid="chat-input"]',
      setup: doc => {
        const el = doc.createElement('div');
        el.setAttribute('data-testid', 'chat-input-editor');
        return el;
      }
    },
    {
      name: '[data-testid="prompt-input"]',
      setup: doc => {
        const el = doc.createElement('div');
        el.setAttribute('data-testid', 'prompt-input-area');
        return el;
      }
    },
    {
      name: 'textarea[placeholder*="Ask"]',
      setup: doc => {
        const ta = doc.createElement('textarea');
        ta.setAttribute('placeholder', 'Ask a question...');
        return ta;
      }
    },
    {
      name: 'textarea[placeholder*="Message"]',
      setup: doc => {
        const ta = doc.createElement('textarea');
        ta.setAttribute('placeholder', 'Message agent');
        return ta;
      }
    },
    {
      name: 'textarea[placeholder*="Prompt"]',
      setup: doc => {
        const ta = doc.createElement('textarea');
        ta.setAttribute('placeholder', 'Enter Prompt here');
        return ta;
      }
    },
    {
      name: 'textarea[placeholder*="Chat"]',
      setup: doc => {
        const ta = doc.createElement('textarea');
        ta.setAttribute('placeholder', 'Chat with Copilot');
        return ta;
      }
    },
    {
      name: 'textarea[placeholder*="Type"]',
      setup: doc => {
        const ta = doc.createElement('textarea');
        ta.setAttribute('placeholder', 'Type a message');
        return ta;
      }
    },
    {
      name: 'textarea.inputarea',
      setup: doc => doc.createElement('textarea', 'inputarea')
    },
    {
      name: '[role="textbox"]',
      setup: doc => {
        const div = doc.createElement('div');
        div.setAttribute('role', 'textbox');
        return div;
      }
    }
  ];

  for (const tc of inputCases) {
    const doc = new MockDocument();
    const target = tc.setup(doc);
    if (!target.parentElement && target !== doc.body) {
      doc.body.appendChild(target);
    }
    const resolved = domBridge.findChatInput(doc);
    assert.ok(resolved !== null, `findChatInput must resolve for: ${tc.name}`);
    console.log(`  ✓ Resolved input: ${tc.name}`);
  }

  // ==========================================================================
  // Test 3: findSendButton Resolution Across All Specified Button Selectors
  // ==========================================================================
  console.log('\n[Test 3] Verifying findSendButton resolution for all send / submit button variations...');

  const buttonCases: { name: string; setup: (doc: MockDocument) => MockElement }[] = [
    {
      name: 'button[data-testid="send-button"] (Antigravity Live Send Button)',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('data-testid', 'send-button');
        return btn;
      }
    },
    {
      name: 'button[aria-label="Send message"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('aria-label', 'Send message');
        return btn;
      }
    },
    {
      name: 'button[aria-label*="Send message"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('aria-label', 'Send message now');
        return btn;
      }
    },
    {
      name: 'button[title*="Send message"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('title', 'Send message (Enter)');
        return btn;
      }
    },
    {
      name: 'button[data-tooltip-id*="send-button"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('data-tooltip-id', 'send-button-tooltip');
        return btn;
      }
    },
    {
      name: 'button[aria-label*="Send"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('aria-label', 'Send prompt');
        return btn;
      }
    },
    {
      name: 'button[title*="Send"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('title', 'Send');
        return btn;
      }
    },
    {
      name: 'button[aria-label*="Submit"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('aria-label', 'Submit changes');
        return btn;
      }
    },
    {
      name: 'button[title*="Submit"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('title', 'Submit');
        return btn;
      }
    },
    {
      name: 'button[aria-label*="Generate"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('aria-label', 'Generate code');
        return btn;
      }
    },
    {
      name: 'button[title*="Generate"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('title', 'Generate response');
        return btn;
      }
    },
    {
      name: 'button[aria-label*="Accept"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('aria-label', 'Accept suggestion');
        return btn;
      }
    },
    {
      name: 'button[title*="Accept"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('title', 'Accept all');
        return btn;
      }
    },
    {
      name: 'button.codicon-arrow-up',
      setup: doc => doc.createElement('button', 'codicon-arrow-up')
    },
    {
      name: '.codicon-arrow-up (inside button wrapper)',
      setup: doc => {
        const btn = doc.createElement('button', 'action-btn');
        const icon = doc.createElement('span', 'codicon-arrow-up');
        btn.appendChild(icon);
        return btn;
      }
    },
    {
      name: 'button.codicon-send',
      setup: doc => doc.createElement('button', 'codicon-send')
    },
    {
      name: '.codicon-send (inside button wrapper)',
      setup: doc => {
        const btn = doc.createElement('button', 'send-wrapper');
        const icon = doc.createElement('span', 'codicon-send');
        btn.appendChild(icon);
        return btn;
      }
    },
    {
      name: 'button.codicon-arrow-right',
      setup: doc => doc.createElement('button', 'codicon-arrow-right')
    },
    {
      name: '.codicon-arrow-right (inside button wrapper)',
      setup: doc => {
        const btn = doc.createElement('button', 'arrow-right-wrapper');
        const icon = doc.createElement('span', 'codicon-arrow-right');
        btn.appendChild(icon);
        return btn;
      }
    },
    {
      name: 'div.chat-input-toolbar button',
      setup: doc => {
        const tb = doc.createElement('div', 'chat-input-toolbar');
        const btn = doc.createElement('button');
        tb.appendChild(btn);
        doc.body.appendChild(tb);
        return btn;
      }
    },
    {
      name: 'div.chat-input-actions button',
      setup: doc => {
        const act = doc.createElement('div', 'chat-input-actions');
        const btn = doc.createElement('button');
        act.appendChild(btn);
        doc.body.appendChild(act);
        return btn;
      }
    },
    {
      name: 'button[type="submit"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('type', 'submit');
        return btn;
      }
    },
    {
      name: '[data-testid*="send-button"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('data-testid', 'my-send-button-test');
        return btn;
      }
    },
    {
      name: '[data-testid*="submit-button"]',
      setup: doc => {
        const btn = doc.createElement('button');
        btn.setAttribute('data-testid', 'custom-submit-button');
        return btn;
      }
    }
  ];

  for (const tc of buttonCases) {
    const doc = new MockDocument();
    const target = tc.setup(doc);
    if (!target.parentElement && target !== doc.body) {
      doc.body.appendChild(target);
    }
    const resolved = domBridge.findSendButton(doc);
    assert.ok(resolved !== null, `findSendButton must resolve for: ${tc.name}`);
    console.log(`  ✓ Resolved button: ${tc.name}`);
  }

  // ==========================================================================
  // Test 4: Deep ShadowRoot Traversal
  // ==========================================================================
  console.log('\n[Test 4] Verifying deep ShadowRoot traversal for inputs and send buttons...');
  const docShadow = new MockDocument();
  const hostEl = docShadow.createElement('div', 'composer-container');
  docShadow.body.appendChild(hostEl);

  const shadowRoot = new MockElement('div');
  shadowRoot.ownerDocument = docShadow;
  hostEl.shadowRoot = shadowRoot;

  const shadowInput = docShadow.createElement('textarea', 'inputarea');
  shadowRoot.appendChild(shadowInput);

  const shadowBtn = docShadow.createElement('button', 'codicon-arrow-up');
  shadowRoot.appendChild(shadowBtn);

  const foundShadowInput = domBridge.findChatInput(docShadow);
  assert.strictEqual(foundShadowInput, shadowInput, 'Must locate input inside descendant ShadowRoot');

  const foundShadowBtn = domBridge.findSendButton(docShadow);
  assert.strictEqual(foundShadowBtn, shadowBtn, 'Must locate send button inside descendant ShadowRoot');
  console.log('  ✓ ShadowRoot deep traversal verified successfully.');

  // ==========================================================================
  // Test 5: Visibility Checking & Monaco Proxy Accommodation
  // ==========================================================================
  console.log('\n[Test 5] Verifying visibility filtering and Monaco proxy textarea accommodation...');

  // Case A: Hidden input by style.display = 'none' should NOT be selected
  const docHidden = new MockDocument();
  const hiddenInput = docHidden.createElement('textarea');
  hiddenInput.setAttribute('placeholder', 'Ask...');
  hiddenInput.style.display = 'none';
  docHidden.body.appendChild(hiddenInput);

  const resolvedHidden = domBridge.findChatInput(docHidden);
  assert.strictEqual(resolvedHidden, null, 'Hidden input with display: none must be filtered out');

  // Case B: Hidden by ancestor visibility
  const docHiddenParent = new MockDocument();
  const hiddenParent = docHiddenParent.createElement('div');
  hiddenParent.style.display = 'none';
  const childInput = docHiddenParent.createElement('textarea');
  childInput.setAttribute('placeholder', 'Ask...');
  hiddenParent.appendChild(childInput);
  docHiddenParent.body.appendChild(hiddenParent);

  const resolvedHiddenChild = domBridge.findChatInput(docHiddenParent);
  assert.strictEqual(resolvedHiddenChild, null, 'Input inside display: none parent must be filtered out');

  // Case C: Hidden by hidden attribute
  const docHiddenAttr = new MockDocument();
  const hiddenAttrInput = docHiddenAttr.createElement('textarea');
  hiddenAttrInput.setAttribute('placeholder', 'Ask...');
  hiddenAttrInput.setAttribute('hidden', 'true');
  docHiddenAttr.body.appendChild(hiddenAttrInput);

  const resolvedHiddenAttr = domBridge.findChatInput(docHiddenAttr);
  assert.strictEqual(resolvedHiddenAttr, null, 'Input with hidden attribute must be filtered out');

  // Case D: Monaco proxy textarea with 1x1 dimensions is accepted as visible
  const docMonaco = new MockDocument();
  const monacoProxy = docMonaco.createElement('textarea', 'inputarea');
  monacoProxy.rect = { width: 1, height: 1, top: 0, left: 0 };
  docMonaco.body.appendChild(monacoProxy);

  const resolvedMonaco = domBridge.findChatInput(docMonaco);
  assert.strictEqual(resolvedMonaco, monacoProxy, 'Monaco proxy textarea.inputarea must be accommodated as visible');

  // Case E: Diagnostic snapshot captured on resolution failure
  const docEmpty = new MockDocument();
  const outOptions: any = {};
  const emptyRes = domBridge.findChatInput(docEmpty, outOptions);
  assert.strictEqual(emptyRes, null);
  assert.ok(outOptions.snapshot, 'Diagnostic snapshot should be populated on failure');
  assert.ok(Array.isArray(outOptions.evaluatedSelectors), 'Evaluated selectors should be recorded');
  console.log('  ✓ Visibility filtering and Monaco proxy accommodation verified.');

  console.log('\n=======================================================');
  console.log('🎉 ALL Phase 01 DOM Selectors & Traversal Tests PASSED!');
  console.log('=======================================================\n');
}

runPhase01Tests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
