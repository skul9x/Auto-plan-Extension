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
  console.log('=== Running Phase 01: DOM Selectors Scoping & Visibility Fix Comprehensive Tests ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge, 'DOM Bridge module must be loaded');
  assert.strictEqual(typeof domBridge.isElementVisible, 'function', 'isElementVisible must be exported');
  assert.strictEqual(typeof domBridge.findSendButton, 'function', 'findSendButton must be exported');
  assert.strictEqual(typeof domBridge.findChatInput, 'function', 'findChatInput must be exported');
  assert.strictEqual(typeof domBridge.findNewConversationButton, 'function', 'findNewConversationButton must be exported');

  // ==========================================================================
  // Test 1: isElementVisible Disabled Bypass vs Visibility Checks
  // ==========================================================================
  console.log('[Test 1] Verifying isElementVisible allowDisabled options & visibility rules...');
  const doc1 = new MockDocument();

  const enabledBtn = doc1.createElement('button');
  assert.strictEqual(domBridge.isElementVisible(enabledBtn), true, 'Enabled button should be visible');

  const disabledBtn = doc1.createElement('button');
  disabledBtn.disabled = true;
  assert.strictEqual(domBridge.isElementVisible(disabledBtn), false, 'Disabled button should be false by default');
  assert.strictEqual(domBridge.isElementVisible(disabledBtn, { allowDisabled: false }), false, 'allowDisabled: false should return false');
  assert.strictEqual(domBridge.isElementVisible(disabledBtn, { allowDisabled: true }), true, 'allowDisabled: true should return true for disabled button');
  assert.strictEqual(domBridge.isElementVisible(disabledBtn, true), true, 'boolean true should return true for disabled button');

  // Hidden styles must still return false even if allowDisabled: true
  const hiddenBtn = doc1.createElement('button');
  hiddenBtn.disabled = true;
  hiddenBtn.style.display = 'none';
  assert.strictEqual(domBridge.isElementVisible(hiddenBtn, { allowDisabled: true }), false, 'display: none must return false even if allowDisabled: true');

  const visHiddenBtn = doc1.createElement('button');
  visHiddenBtn.disabled = true;
  visHiddenBtn.style.visibility = 'hidden';
  assert.strictEqual(domBridge.isElementVisible(visHiddenBtn, { allowDisabled: true }), false, 'visibility: hidden must return false even if allowDisabled: true');

  const ariaHiddenBtn = doc1.createElement('button');
  ariaHiddenBtn.disabled = true;
  ariaHiddenBtn.setAttribute('aria-hidden', 'true');
  assert.strictEqual(domBridge.isElementVisible(ariaHiddenBtn, { allowDisabled: true }), false, 'aria-hidden="true" must return false even if allowDisabled: true');

  const hiddenAttrBtn = doc1.createElement('button');
  hiddenAttrBtn.disabled = true;
  hiddenAttrBtn.setAttribute('hidden', '');
  assert.strictEqual(domBridge.isElementVisible(hiddenAttrBtn, { allowDisabled: true }), false, 'hidden attribute must return false even if allowDisabled: true');

  console.log('  ✓ isElementVisible correctly differentiates disabled status and visibility.');

  // ==========================================================================
  // Test 2: Antigravity IDE Live Input Box & Disabled Send Button Discovery
  // ==========================================================================
  console.log('\n[Test 2] Verifying Antigravity live container (#antigravity.agentSidePanelInputBox) resolution with disabled send button...');
  const doc2 = new MockDocument();

  const agentInputBox = doc2.createElement('div');
  agentInputBox.setAttribute('id', 'antigravity.agentSidePanelInputBox');
  doc2.body.appendChild(agentInputBox);

  const lexicalInput = doc2.createElement('div');
  lexicalInput.setAttribute('data-lexical-editor', 'true');
  lexicalInput.setAttribute('contenteditable', 'true');
  agentInputBox.appendChild(lexicalInput);

  const sendBtn = doc2.createElement('button');
  sendBtn.setAttribute('data-testid', 'send-button');
  sendBtn.setAttribute('aria-label', 'Send message');
  sendBtn.setAttribute('data-tooltip-id', 'send-tooltip');
  sendBtn.disabled = true; // Initially disabled before typing
  agentInputBox.appendChild(sendBtn);

  // Finding from document root
  const foundFromDoc = domBridge.findSendButton(doc2);
  assert.strictEqual(foundFromDoc, sendBtn, 'findSendButton(doc) should return disabled Antigravity send button inside agent container');

  // Finding from input element context
  const foundFromInputContext = domBridge.findSendButton(lexicalInput);
  assert.strictEqual(foundFromInputContext, sendBtn, 'findSendButton(inputElem) should scope to closest container and return send button');

  console.log('  ✓ Antigravity live container & disabled send button resolved successfully.');

  // ==========================================================================
  // Test 3: Rejection of Unrelated VS Code Workbench Buttons & Codicons
  // ==========================================================================
  console.log('\n[Test 3] Verifying strict rejection of unrelated workbench buttons (e.g. .action-label.codicon-arrow-right)...');
  const doc3 = new MockDocument();

  // Workbench title bar action with .action-label.codicon.codicon-arrow-right
  const workbenchTitleBar = doc3.createElement('div', 'title-actions');
  const workbenchArrowBtn = doc3.createElement('a', 'action-label codicon codicon-arrow-right');
  workbenchArrowBtn.setAttribute('title', 'Next Editor');
  workbenchTitleBar.appendChild(workbenchArrowBtn);
  doc3.body.appendChild(workbenchTitleBar);

  // Breadcrumbs navigation with .codicon-arrow-right
  const breadcrumbBar = doc3.createElement('div', 'breadcrumbs-control');
  const breadcrumbArrow = doc3.createElement('button', 'codicon codicon-arrow-right');
  breadcrumbBar.appendChild(breadcrumbArrow);
  doc3.body.appendChild(breadcrumbBar);

  // When no chat container or chat send button exists:
  const noMatchFound = domBridge.findSendButton(doc3);
  assert.strictEqual(noMatchFound, null, 'findSendButton must NOT match global workbench codicon-arrow-right buttons outside chat containers');

  // Now add a valid chat widget with a real send button
  const chatWidget = doc3.createElement('div', 'chat-widget');
  const chatSendBtn = doc3.createElement('button', 'codicon-send');
  chatSendBtn.disabled = true;
  chatWidget.appendChild(chatSendBtn);
  doc3.body.appendChild(chatWidget);

  const resolvedChatBtn = domBridge.findSendButton(doc3);
  assert.strictEqual(resolvedChatBtn, chatSendBtn, 'findSendButton must prioritize chat container send button and completely ignore workbench arrow buttons');

  console.log('  ✓ Unrelated workbench icons rejected and chat container strictly prioritized.');

  // ==========================================================================
  // Test 4: Scoped Generic Codicon Resolution Inside Chat Containers
  // ==========================================================================
  console.log('\n[Test 4] Verifying scoped generic codicons (.codicon-arrow-up, .codicon-send, .codicon-arrow-right) inside containers...');

  const scopedCodiconCases = [
    {
      name: '.codicon-arrow-up inside .chat-widget',
      setup: (container: MockElement, doc: MockDocument) => {
        const btn = doc.createElement('button', 'action-btn');
        const icon = doc.createElement('span', 'codicon-arrow-up');
        btn.appendChild(icon);
        container.appendChild(btn);
        return btn;
      }
    },
    {
      name: '.codicon-send inside .composer-container',
      setup: (container: MockElement, doc: MockDocument) => {
        const btn = doc.createElement('button', 'composer-send-btn');
        const icon = doc.createElement('i', 'codicon codicon-send');
        btn.appendChild(icon);
        container.appendChild(btn);
        return btn;
      }
    },
    {
      name: '.codicon-arrow-right inside #antigravity.agentSidePanelInputBox',
      setup: (container: MockElement, doc: MockDocument) => {
        const btn = doc.createElement('button', 'send-button-wrapper');
        const icon = doc.createElement('span', 'codicon codicon-arrow-right');
        btn.appendChild(icon);
        container.appendChild(btn);
        return btn;
      }
    }
  ];

  for (const tc of scopedCodiconCases) {
    const doc = new MockDocument();
    const container = doc.createElement('div', 'chat-widget');
    doc.body.appendChild(container);
    const expectedBtn = tc.setup(container, doc);

    const resolved = domBridge.findSendButton(doc);
    assert.strictEqual(resolved, expectedBtn, `Scoped codicon should resolve for: ${tc.name}`);
    console.log(`  ✓ Resolved scoped codicon: ${tc.name}`);
  }

  // ==========================================================================
  // Test 5: Global Safe Fallback for Explicit Uncontainerized Submit Buttons
  // ==========================================================================
  console.log('\n[Test 5] Verifying global safe fallback for explicit button attributes...');

  const globalExplicitCases = [
    {
      name: 'button[data-testid="send-button"]',
      setup: (doc: MockDocument) => {
        const btn = doc.createElement('button');
        btn.setAttribute('data-testid', 'send-button');
        return btn;
      }
    },
    {
      name: 'button[aria-label="Send message"]',
      setup: (doc: MockDocument) => {
        const btn = doc.createElement('button');
        btn.setAttribute('aria-label', 'Send message');
        return btn;
      }
    },
    {
      name: 'button[data-tooltip-id="send-tooltip"]',
      setup: (doc: MockDocument) => {
        const btn = doc.createElement('button');
        btn.setAttribute('data-tooltip-id', 'send-tooltip');
        return btn;
      }
    },
    {
      name: 'button[type="submit"]',
      setup: (doc: MockDocument) => {
        const btn = doc.createElement('button');
        btn.setAttribute('type', 'submit');
        return btn;
      }
    }
  ];

  for (const tc of globalExplicitCases) {
    const doc = new MockDocument();
    const btn = tc.setup(doc);
    doc.body.appendChild(btn);

    const resolved = domBridge.findSendButton(doc);
    assert.strictEqual(resolved, btn, `Global explicit button should resolve for: ${tc.name}`);
    console.log(`  ✓ Resolved global explicit button: ${tc.name}`);
  }

  // ==========================================================================
  // Test 6: Non-Regression for Input & New Conversation Resolution
  // ==========================================================================
  console.log('\n[Test 6] Verifying non-regression for findChatInput & findNewConversationButton...');
  const doc6 = new MockDocument();

  const newChatBtn = doc6.createElement('button');
  newChatBtn.setAttribute('aria-label', 'New Conversation');
  newChatBtn.disabled = true;
  doc6.body.appendChild(newChatBtn);

  const resolvedNewChat = domBridge.findNewConversationButton(doc6);
  assert.strictEqual(resolvedNewChat, newChatBtn, 'findNewConversationButton must resolve even when disabled');

  const inputEl = doc6.createElement('div');
  inputEl.setAttribute('data-lexical-editor', 'true');
  inputEl.setAttribute('contenteditable', 'true');
  doc6.body.appendChild(inputEl);

  const resolvedInput = domBridge.findChatInput(doc6);
  assert.strictEqual(resolvedInput, inputEl, 'findChatInput must resolve lexical editor');
  console.log('  ✓ findChatInput & findNewConversationButton non-regression verified.');

  // ==========================================================================
  // Test 7: Diagnostics & Failure Handling
  // ==========================================================================
  console.log('\n[Test 7] Verifying findSendButton diagnostic capturing on failure...');
  const doc7 = new MockDocument();
  const optionsOut: any = {};
  const notFound = domBridge.findSendButton(doc7, optionsOut);
  assert.strictEqual(notFound, null, 'findSendButton returns null when no matching button');
  assert.ok(optionsOut.diagnostics, 'optionsOut must contain diagnostics object');
  assert.ok(Array.isArray(optionsOut.evaluatedSelectors), 'evaluatedSelectors must be an array');
  assert.ok(Array.isArray(optionsOut.nearbyButtons), 'nearbyButtons must be an array');
  assert.strictEqual(domBridge.findSendButton.lastDiagnostics, optionsOut.diagnostics, 'lastDiagnostics must be populated');
  console.log('  ✓ Failure diagnostics verified.');

  console.log('\n=== All Phase 01 Tests Passed Successfully! ===');
}

runPhase01Tests().catch(err => {
  console.error('\n❌ Phase 01 Test Failed:', err);
  process.exit(1);
});
