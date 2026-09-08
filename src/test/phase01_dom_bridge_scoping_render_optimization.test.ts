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

// --- Mock DOM Implementation for Isolated Testing ---

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
  public attributes: Map<string, string> = new Map();
  public classList: MockClassList;
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public ownerDocument: any = null;
  public shadowRoot: MockElement | null = null;
  public disabled: boolean = false;
  public textContent: string = '';
  public innerText: string = '';
  public clicked: boolean = false;
  public clickCount: number = 0;
  public title: string = '';
  public checked: boolean = false;
  public dataset: Record<string, string> = {};
  public querySelectorAllStarCalls: number = 0;
  public eventListeners: Record<string, Function[]> = {};

  get innerHTML(): string {
    return this.children.map(c => `<${c.tagName.toLowerCase()} class="${c.className}">${c.textContent}</${c.tagName.toLowerCase()}>`).join('');
  }

  set innerHTML(val: string) {
    for (const child of this.children) {
      child.parentElement = null;
    }
    this.children = [];
    if (!val) return;

    const divMatch = val.match(/<([a-zA-Z0-9_-]+)([^>]*)>(.*?)<\/\1>/s);
    if (divMatch) {
      const tag = divMatch[1];
      const attrs = divMatch[2];
      const text = divMatch[3];
      const el = new MockElement(tag);
      el.ownerDocument = this.ownerDocument;
      const classMatch = attrs.match(/class=["']([^"']*)["']/);
      if (classMatch) {
        el.className = classMatch[1];
      }
      el.textContent = text;
      this.appendChild(el);
    }
  }

  get type(): string {
    return this.getAttribute('type') || '';
  }

  set type(val: string) {
    this.setAttribute('type', val);
  }

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
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  get id(): string {
    return this.getAttribute('id') || '';
  }

  set id(val: string) {
    this.attributes.set('id', val);
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        this.parentElement.children.splice(idx, 1);
      }
      this.parentElement = null;
    }
  }

  addEventListener(event: string, handler: Function) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(handler);
  }

  dispatchEvent(event: { type: string; [key: string]: any }): boolean {
    const handlers = this.eventListeners[event.type] || [];
    for (const h of handlers) {
      h(event);
    }
    return true;
  }

  click() {
    this.clicked = true;
    this.clickCount++;
    this.dispatchEvent({ type: 'click', target: this });
  }

  matches(selector: string): boolean {
    const parts = selector.split(',').map(s => s.trim());
    return parts.some(sel => this.matchesSingle(sel));
  }

  private matchesSingle(sel: string): boolean {
    if (sel === '*') return true;

    const tagMatch = sel.match(/^[a-zA-Z0-9_-]+/);
    if (tagMatch && tagMatch[0].toUpperCase() !== this.tagName) {
      return false;
    }

    const classMatches = sel.match(/\.([a-zA-Z0-9_-]+)/g);
    if (classMatches) {
      for (const cm of classMatches) {
        const cls = cm.slice(1);
        if (!this.classList.contains(cls)) {
          return false;
        }
      }
    }

    const attrMatches = sel.match(/\[([a-zA-Z0-9_-]+)([*~|^$]?=)?['"]?([^'"\]]*)['"]?\]/g);
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

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    if (selector === '*') {
      this.querySelectorAllStarCalls++;
    }

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
  public body: MockElement;
  public documentElement: MockElement;
  public querySelectorAllStarCalls: number = 0;

  constructor() {
    this.documentElement = new MockElement('html');
    this.documentElement.ownerDocument = this;
    this.body = new MockElement('body');
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName: string): MockElement {
    const el = new MockElement(tagName);
    el.ownerDocument = this;
    return el;
  }

  getElementById(id: string): MockElement | null {
    const all = this.querySelectorAll(`[id="${id}"]`);
    return all.length > 0 ? all[0] : null;
  }

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    if (selector === '*') {
      this.querySelectorAllStarCalls++;
    }
    const results: MockElement[] = [];
    if (this.documentElement.matches(selector)) {
      results.push(this.documentElement);
    }
    results.push(...this.documentElement.querySelectorAll(selector));
    return results;
  }
}

class MockMutationObserver {
  public callback: (mutations: any[]) => void;
  public isObserving: boolean = false;
  public target: any = null;
  public static instances: MockMutationObserver[] = [];

  constructor(callback: (mutations: any[]) => void) {
    this.callback = callback;
    MockMutationObserver.instances.push(this);
  }

  observe(target: any, _options?: any) {
    this.isObserving = true;
    this.target = target;
  }

  disconnect() {
    this.isObserving = false;
    this.target = null;
  }

  trigger(mutations: any[] = []) {
    if (this.isObserving && this.callback) {
      this.callback(mutations);
    }
  }
}

// Helper to load autoplan-dom-bridge.js
function loadDomBridge() {
  const p = path.resolve(__dirname, '../../media/autoplan-dom-bridge.js');
  if (fs.existsSync(p)) {
    return require(p);
  }
  const alt = path.resolve(__dirname, '../media/autoplan-dom-bridge.js');
  if (fs.existsSync(alt)) {
    return require(alt);
  }
  throw new Error('Could not locate media/autoplan-dom-bridge.js');
}

// Helper to load media/sidebar/sidebar.js in isolated sandbox
function loadSidebarModule(mockDoc: MockDocument, postMessageSpy: Function) {
  const sidebarPath = path.resolve(__dirname, '../../media/sidebar/sidebar.js');
  const code = fs.readFileSync(sidebarPath, 'utf8');

  // Provide mock globals required by sidebar.js IIFE
  const sandboxGlobals = {
    document: mockDoc,
    window: {
      __SIDEBAR_INTERNALS__: null,
      addEventListener: (_event: string, _handler: Function) => {},
      removeEventListener: (_event: string, _handler: Function) => {}
    },
    acquireVsCodeApi: () => ({
      postMessage: postMessageSpy
    }),
    module: { exports: {} }
  };

  const fn = new Function('document', 'window', 'acquireVsCodeApi', 'module', code);
  fn(sandboxGlobals.document, sandboxGlobals.window, sandboxGlobals.acquireVsCodeApi, sandboxGlobals.module);

  return (sandboxGlobals.window as any).__SIDEBAR_INTERNALS__ || sandboxGlobals.module.exports;
}

// --- Main Test Suite ---

async function runPhase01Verification() {
  console.log('================================================================');
  console.log(' Phase 01 Verification: DOM Bridge Scoping & Sidebar Render Diff');
  console.log('================================================================\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge, 'DOM Bridge module must be loaded');

  // ----------------------------------------------------------------------
  // Test 1: MutationObserver Scoping & Dialog Filtering
  // ----------------------------------------------------------------------
  console.log('[Test 1] Testing MutationObserver Scoping & Dialog Filtering...');

  const { isRelevantDialogMutation } = domBridge;
  assert.strictEqual(typeof isRelevantDialogMutation, 'function', 'isRelevantDialogMutation must be exported');

  // 1a. Unrelated Editor / Terminal / Minimap mutations MUST be ignored
  const editorLineNode = new MockElement('span', 'view-line');
  const cursorNode = new MockElement('div', 'cursor');
  const terminalLineNode = new MockElement('div', 'xterm-rows');
  const minimapNode = new MockElement('canvas', 'minimap-slider');

  const editorMutations = [
    { type: 'childList', target: new MockElement('div', 'monaco-editor'), addedNodes: [editorLineNode] },
    { type: 'childList', target: new MockElement('div', 'view-lines'), addedNodes: [cursorNode] },
    { type: 'childList', target: new MockElement('div', 'terminal-widget'), addedNodes: [terminalLineNode] },
    { type: 'childList', target: new MockElement('div', 'minimap'), addedNodes: [minimapNode] }
  ];

  assert.strictEqual(isRelevantDialogMutation(editorMutations), false, 'Editor, cursor, terminal, and minimap mutations must NOT be considered relevant dialog mutations');

  // 1b. Relevant Dialog & Toast additions MUST be recognized
  const dialogBoxNode = new MockElement('div', 'monaco-dialog-box');
  const notificationToastNode = new MockElement('div', 'notifications-toasts');
  const actionWidgetNode = new MockElement('div', 'action-widget');
  const buttonContainerNode = new MockElement('div');
  buttonContainerNode.appendChild(new MockElement('button', 'monaco-button'));

  assert.strictEqual(isRelevantDialogMutation([{ type: 'childList', addedNodes: [dialogBoxNode] }]), true, 'monaco-dialog-box addition must be recognized');
  assert.strictEqual(isRelevantDialogMutation([{ type: 'childList', addedNodes: [notificationToastNode] }]), true, 'notifications-toasts addition must be recognized');
  assert.strictEqual(isRelevantDialogMutation([{ type: 'childList', addedNodes: [actionWidgetNode] }]), true, 'action-widget addition must be recognized');
  assert.strictEqual(isRelevantDialogMutation([{ type: 'childList', addedNodes: [buttonContainerNode] }]), true, 'Button addition must be recognized');

  // 1c. Verify startAutoApprovalObserver ignores typing mutations and triggers on dialog
  const testDoc = new MockDocument();
  MockMutationObserver.instances = [];
  let approvedCalls = 0;

  const approvalHandle = domBridge.startAutoApprovalObserver(['Allow', 'Continue'], {
    document: testDoc,
    MutationObserver: MockMutationObserver,
    activeIntervalMs: 50,
    idleIntervalMs: 800,
    onApproved: () => {
      approvedCalls++;
    }
  });

  const rootObs = MockMutationObserver.instances[MockMutationObserver.instances.length - 1];
  assert.ok(rootObs, 'Root MockMutationObserver should be active');

  // Trigger editor typing mutations -> approvedCalls must not increase
  rootObs.trigger(editorMutations);
  assert.strictEqual(approvedCalls, 0, 'Editor typing mutations must be ignored by startAutoApprovalObserver');

  // Now attach a dialog button into DOM and trigger a dialog mutation
  const dialogBox = new MockElement('div', 'monaco-dialog-box');
  const allowBtn = new MockElement('button', 'dialog-button');
  allowBtn.textContent = 'Allow';
  dialogBox.appendChild(allowBtn);
  testDoc.body.appendChild(dialogBox);

  // Trigger dialog mutation -> must immediately scan and click
  rootObs.trigger([{ type: 'childList', target: dialogBox, addedNodes: [allowBtn] }]);
  assert.strictEqual(approvedCalls, 1, 'Dialog mutation must immediately trigger scanAndApprove');
  assert.strictEqual(allowBtn.clicked, true, 'Dialog button must be clicked');

  approvalHandle.stop();
  console.log('  -> Passed: Editor mutations filtered; dialog mutations instantly approve.\n');

  // ----------------------------------------------------------------------
  // Test 2: Elimination of querySelectorAll('*') in queryDeep
  // ----------------------------------------------------------------------
  console.log('[Test 2] Testing queryDeep wildcard (*) query elimination...');

  const queryDoc = new MockDocument();
  const chatContainer = new MockElement('div', 'chat-widget');
  const promptInput = new MockElement('textarea', 'inputarea');
  chatContainer.appendChild(promptInput);
  queryDoc.body.appendChild(chatContainer);

  queryDoc.querySelectorAllStarCalls = 0;
  chatContainer.querySelectorAllStarCalls = 0;

  // Execute queryDeep across containers
  const foundInputs = domBridge.queryDeep('textarea.inputarea', queryDoc);
  assert.strictEqual(foundInputs.length, 1, 'queryDeep should locate prompt input in container');
  assert.strictEqual(foundInputs[0], promptInput);

  // CRITICAL ASSERTION: No wildcard querySelectorAll('*') calls were made
  assert.strictEqual(queryDoc.querySelectorAllStarCalls, 0, 'doc.querySelectorAll("*") must NEVER be called in queryDeep');
  assert.strictEqual(chatContainer.querySelectorAllStarCalls, 0, 'container.querySelectorAll("*") must NEVER be called in queryDeep');

  // Test fallback query (selector outside container)
  const outsideBtn = new MockElement('button', 'outside-btn');
  queryDoc.body.appendChild(outsideBtn);

  const foundOutside = domBridge.queryDeep('button.outside-btn', queryDoc);
  assert.strictEqual(foundOutside.length, 1, 'queryDeep should fallback and locate outside button');
  assert.strictEqual(queryDoc.querySelectorAllStarCalls, 0, 'Fallback query must NOT invoke querySelectorAll("*")');

  console.log('  -> Passed: queryDeep eliminated 100% of querySelectorAll("*") wildcard scans.\n');

  // ----------------------------------------------------------------------
  // Test 3: Sidebar renderPhaseList In-Place DOM Reconciliation
  // ----------------------------------------------------------------------
  console.log('[Test 3] Testing Sidebar renderPhaseList in-place DOM reconciliation...');

  const sidebarDoc = new MockDocument();

  // Create required sidebar DOM nodes
  const phaseList = new MockElement('div', 'phase-list');
  phaseList.id = 'phaseList';
  sidebarDoc.body.appendChild(phaseList);

  const selectedCountBadge = new MockElement('span');
  selectedCountBadge.id = 'selectedCountBadge';
  sidebarDoc.body.appendChild(selectedCountBadge);

  const toggleAllPhases = new MockElement('input');
  toggleAllPhases.id = 'toggleAllPhases';
  toggleAllPhases.type = 'checkbox';
  sidebarDoc.body.appendChild(toggleAllPhases);

  // Stub other required buttons in sidebar
  const ids = [
    'bridgeStatusBadge', 'bridgeStatusText', 'planFolderSelect', 'btnRefreshPlans',
    'btnSelectFolder', 'elapsedTime', 'progressCounter', 'progressBarFill',
    'btnStart', 'btnPause', 'btnSkip', 'btnStop', 'btnClearLog',
    'transcriptLog', 'transcriptViewport', 'btnActivateBridge',
    'btnDiagnostics', 'btnCopyBridgeLog', 'btnSettings'
  ];
  for (const id of ids) {
    const el = new MockElement('div');
    el.id = id;
    sidebarDoc.body.appendChild(el);
  }

  const postedMessages: any[] = [];
  const sidebar = loadSidebarModule(sidebarDoc, (msg: any) => postedMessages.push(msg));
  assert.ok(sidebar && sidebar.renderPhaseList, 'renderPhaseList must be exported');

  // Phase tick 1: Initial Render
  const phasesTick1 = [
    { fileName: '01-dom-bridge.md', status: 'Pending', filePath: '/path/01.md' },
    { fileName: '02-stream-reader.md', status: 'Pending', filePath: '/path/02.md' },
    { fileName: '03-brain-cache.md', status: 'Pending', filePath: '/path/03.md' }
  ];
  const selectedSet1 = new Set([0, 1, 2]);

  sidebar.renderPhaseList(phasesTick1, selectedSet1, -1);

  assert.strictEqual(phaseList.children.length, 3, 'Initial render should create 3 phase items');
  const item0 = phaseList.children[0];
  const item1 = phaseList.children[1];
  const item2 = phaseList.children[2];

  const checkbox0 = item0.querySelector('input[type="checkbox"]');
  assert.ok(checkbox0, 'Checkbox 0 must exist');

  // Attach identity markers to verify nodes are not recreated
  (item0 as any).__inPlaceId = 'node-0-retained';
  (item1 as any).__inPlaceId = 'node-1-retained';
  (item2 as any).__inPlaceId = 'node-2-retained';
  (checkbox0 as any).__cbMarker = 'cb-0-retained';

  // Phase tick 2: State updates (0 becomes Running, 1 becomes Completed, 2 becomes Failed)
  sidebar.setCurrentState('running');
  const phasesTick2 = [
    { fileName: '01-dom-bridge.md', status: 'Running', filePath: '/path/01.md' },
    { fileName: '02-stream-reader.md', status: 'Completed', filePath: '/path/02.md', isCompleted: true },
    { fileName: '03-brain-cache.md', status: 'Failed', filePath: '/path/03.md', error: 'Test error' }
  ];

  sidebar.renderPhaseList(phasesTick2, selectedSet1, 0);

  // Verify DOM reference equality (In-place reconciliation!)
  assert.strictEqual(phaseList.children[0], item0, 'item0 reference must be preserved across render');
  assert.strictEqual(phaseList.children[1], item1, 'item1 reference must be preserved across render');
  assert.strictEqual(phaseList.children[2], item2, 'item2 reference must be preserved across render');

  assert.strictEqual((phaseList.children[0] as any).__inPlaceId, 'node-0-retained', 'Node 0 identity marker must persist');
  assert.strictEqual((phaseList.children[1] as any).__inPlaceId, 'node-1-retained', 'Node 1 identity marker must persist');
  assert.strictEqual((phaseList.children[2] as any).__inPlaceId, 'node-2-retained', 'Node 2 identity marker must persist');

  const currentCb0 = item0.querySelector('input[type="checkbox"]');
  assert.strictEqual(currentCb0, checkbox0, 'Checkbox element reference and listeners must be preserved');
  assert.strictEqual((currentCb0 as any).__cbMarker, 'cb-0-retained');

  // Verify class names and status tags updated in-place
  assert.ok(item0.classList.contains('running'), 'item0 should have "running" class');
  assert.ok(item1.classList.contains('completed'), 'item1 should have "completed" class');
  assert.ok(item2.classList.contains('failed'), 'item2 should have "failed" class');

  const tag0 = item0.querySelector('.status-tag');
  const tag1 = item1.querySelector('.status-tag');
  const tag2 = item2.querySelector('.status-tag');
  assert.strictEqual(tag0?.textContent, '🔄 Running', 'item0 status tag should show Running');
  assert.strictEqual(tag1?.textContent, '✅ Completed', 'item1 status tag should show Completed');
  assert.strictEqual(tag2?.textContent, '❌ Failed', 'item2 status tag should show Failed');

  // Phase tick 3: Pruning excess items (from 3 down to 2)
  const phasesTick3 = [
    { fileName: '01-dom-bridge.md', status: 'Completed', isCompleted: true },
    { fileName: '02-stream-reader.md', status: 'Running' }
  ];
  sidebar.renderPhaseList(phasesTick3, new Set([0, 1]), 1);

  assert.strictEqual(phaseList.children.length, 2, 'Phase list should prune excess item to 2 items');
  assert.strictEqual(phaseList.children[0], item0, 'item0 reference should still be preserved');
  assert.strictEqual(phaseList.children[1], item1, 'item1 reference should still be preserved');

  // Phase tick 4: Empty list render
  sidebar.renderPhaseList([], new Set(), -1);
  assert.ok(phaseList.querySelector('.empty-state'), 'Empty state should render when phase list is empty');

  console.log('  -> Passed: renderPhaseList performs seamless in-place DOM reconciliation without recreation.\n');

  console.log('================================================================');
  console.log(' ALL PHASE 01 TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

runPhase01Verification().catch(err => {
  console.error('Phase 01 Verification failed:', err);
  process.exit(1);
});
