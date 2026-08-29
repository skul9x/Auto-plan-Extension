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
  public querySelectorAllStarCalls: number = 0;

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
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  click() {
    this.clicked = true;
    this.clickCount++;
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

  trigger() {
    if (this.isObserving && this.callback) {
      this.callback([]);
    }
  }
}

async function runPhase01Tests() {
  console.log('=== Running Phase 01: Scoped DOM Traversal & Debounced MutationObserver Tests ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge !== null, 'DOM Bridge module must be loaded');

  // ----------------------------------------------------------------------
  // Test 1: Scoped DOM Query Test
  // ----------------------------------------------------------------------
  console.log('[Test 1] Verifying Scoped DOM Query execution...');

  const doc = new MockDocument();

  // Create 1,000 irrelevant elements inside .monaco-workbench outside target containers
  const workbench = doc.createElement('div');
  workbench.className = 'monaco-workbench';
  for (let i = 0; i < 1000; i++) {
    const item = doc.createElement('div');
    item.className = `workbench-item-${i}`;
    workbench.appendChild(item);
  }
  doc.body.appendChild(workbench);

  // Create target container with 5 matching buttons
  const chatSession = doc.createElement('div');
  chatSession.className = 'interactive-session';
  const matchingButtons: MockElement[] = [];
  for (let i = 0; i < 5; i++) {
    const btn = doc.createElement('button');
    btn.textContent = `Action ${i + 1}`;
    chatSession.appendChild(btn);
    matchingButtons.push(btn);
  }
  doc.body.appendChild(chatSession);

  // Reset counters before queryDeep call
  doc.querySelectorAllStarCalls = 0;
  doc.documentElement.querySelectorAllStarCalls = 0;
  doc.body.querySelectorAllStarCalls = 0;
  workbench.querySelectorAllStarCalls = 0;

  const foundButtons = domBridge.queryDeep('button', doc);

  assert.strictEqual(foundButtons.length, 5, 'Should return exactly 5 matching buttons from .interactive-session');
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(foundButtons[i], matchingButtons[i], `Button ${i} must match target element`);
  }

  // Assert top-level doc/body querySelectorAll('*') was NOT called (avoiding 1,000 irrelevant element scan)
  assert.strictEqual(doc.querySelectorAllStarCalls, 0, 'Top-level document querySelectorAll("*") must NOT be called when containers exist');
  assert.strictEqual(workbench.querySelectorAllStarCalls, 0, 'Irrelevant workbench querySelectorAll("*") must NOT be called');
  assert.ok(chatSession.querySelectorAllStarCalls > 0, 'Scoped container querySelectorAll("*") should be called for shadowRoot discovery');

  console.log('  -> Passed: Scoped DOM Query restricted querySelectorAll("*") scan to target container subtrees.');

  // ----------------------------------------------------------------------
  // Test 2: Observer Debounce Test
  // ----------------------------------------------------------------------
  console.log('\n[Test 2] Verifying Throttled MutationObserver execution (300ms quiet window)...');

  const testDoc = new MockDocument();
  let approvalCallbackCount = 0;

  const btnToApprove = testDoc.createElement('button');
  btnToApprove.textContent = 'Allow';

  const container = testDoc.createElement('div');
  container.className = 'interactive-session';
  container.appendChild(btnToApprove);
  testDoc.body.appendChild(container);

  MockMutationObserver.instances = [];

  const handle = domBridge.startAutoApprovalObserver(['Allow'], {
    document: testDoc,
    MutationObserver: MockMutationObserver,
    throttleMs: 300,
    maxWaitMs: 500,
    onApproved: () => {
      approvalCallbackCount++;
    }
  });

  const observerInstance = MockMutationObserver.instances[0];
  assert.ok(observerInstance, 'MockMutationObserver instance should be instantiated');
  assert.strictEqual(observerInstance.isObserving, true, 'MutationObserver should be active');

  // Initial immediate scan executed upon startAutoApprovalObserver call
  assert.strictEqual(approvalCallbackCount, 1, 'Initial immediate scan should fire synchronously on start');

  // Reset button clicked state & count for dynamic mutation test
  btnToApprove.clicked = false;
  btnToApprove.clickCount = 0;
  approvalCallbackCount = 0;

  // Fire 50 consecutive DOM mutation events in quick succession (<100ms)
  for (let i = 0; i < 50; i++) {
    observerInstance.trigger();
  }

  // Immediately after triggers (<300ms quiet period), scan should NOT have executed yet
  assert.strictEqual(approvalCallbackCount, 0, 'Scan should NOT fire immediately during burst of 50 mutations');

  // Wait 350ms for debounce quiet window to elapse
  await new Promise(resolve => setTimeout(resolve, 350));

  // Assert scanAndApprove executed exactly once
  assert.strictEqual(approvalCallbackCount, 1, 'Scan should execute exactly once after 300ms debounce quiet period');
  assert.strictEqual(btnToApprove.clickCount, 1, 'Target button should be clicked exactly once');

  console.log('  -> Passed: 50 rapid DOM mutations binned into 1 throttled scan execution.');

  // ----------------------------------------------------------------------
  // Test 3: Observer Teardown Test
  // ----------------------------------------------------------------------
  console.log('\n[Test 3] Verifying Clean Teardown on .stop()...');

  approvalCallbackCount = 0;
  btnToApprove.clicked = false;
  btnToApprove.clickCount = 0;

  // Trigger mutation events
  observerInstance.trigger();

  // Immediately call stop() before quiet window expires
  handle.stop();

  assert.strictEqual(observerInstance.isObserving, false, 'Observer disconnect() must be called on stop()');

  // Wait 400ms to ensure no deferred timer callback fires after teardown
  await new Promise(resolve => setTimeout(resolve, 400));

  assert.strictEqual(approvalCallbackCount, 0, 'No deferred scanAndApprove callback should fire after stop()');

  console.log('  -> Passed: Teardown cleared timers, disconnected observer, and cancelled pending scans.');

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 01 DOM BRIDGE SCOPED THROTTLE TESTS PASSED!');
  console.log('======================================================\n');
}

runPhase01Tests().catch(err => {
  console.error('Phase 01 Test Suite Failed:', err);
  process.exit(1);
});
