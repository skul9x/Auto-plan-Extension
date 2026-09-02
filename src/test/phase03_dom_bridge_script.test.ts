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
import * as os from 'os';
import { BridgeServer } from '../bridgeServer';

// Load autoplan-dom-bridge.js dynamically
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

/**
 * Lightweight mock DOM implementation for verifying browser/Electron DOM interactions
 */
class MockEvent {
  public type: string;
  public bubbles: boolean;
  public cancelable: boolean;
  public target: any = null;
  public defaultPrevented: boolean = false;

  constructor(type: string, init: any = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? true;
    this.cancelable = init.cancelable ?? true;
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

  constructor(type: string, init: any = {}) {
    super(type, init);
    this.key = init.key || '';
    this.code = init.code || '';
    this.keyCode = init.keyCode || 0;
    this.which = init.which || 0;
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
  public value: string = '';
  public textContent: string = '';
  public innerText: string = '';
  public eventListeners: Map<string, Array<(e: any) => void>> = new Map();
  public dispatchedEvents: MockEvent[] = [];
  public clicked: boolean = false;
  public clickCount: number = 0;
  public isFocused: boolean = false;
  public nodeType: number = 1;

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

  removeChild(child: MockElement) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      child.parentElement = null;
      this.children.splice(idx, 1);
    }
    return child;
  }

  addEventListener(type: string, listener: (e: any) => void) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: (e: any) => void) {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    }
  }

  dispatchEvent(event: MockEvent): boolean {
    event.target = this;
    this.dispatchedEvents.push(event);

    const listeners = this.eventListeners.get(event.type) || [];
    for (const listener of listeners) {
      listener(event);
    }

    if (event.bubbles && this.parentElement) {
      this.parentElement.dispatchEvent(event);
    }

    return !event.defaultPrevented;
  }

  focus() {
    this.isFocused = true;
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  blur() {
    this.isFocused = false;
  }

  click() {
    this.clicked = true;
    this.clickCount++;
    this.dispatchEvent(new MockEvent('click', { bubbles: true }));
  }

  closest(selector: string): MockElement | null {
    let current: MockElement | null = this;
    while (current) {
      if (current.matches(selector)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  matches(selector: string): boolean {
    const parts = selector.split(',').map(s => s.trim());
    return parts.some(sel => this.matchesSingle(sel));
  }

  private matchesSingle(sel: string): boolean {
    if (sel === '*') return true;
    
    // Tag match
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

    // Attribute match [attr*="val"] or [attr="val"]
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

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }
}

class MockDocument {
  public body: MockElement;
  public documentElement: MockElement;
  public activeElement: MockElement | null = null;
  public nodeType: number = 9;
  public execCommandCalls: Array<{ aCommandName: string; aShowDefaultUI: boolean; aValueArgument: any }> = [];

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
    const results: MockElement[] = [];
    if (this.documentElement.matches(selector)) {
      results.push(this.documentElement);
    }
    results.push(...this.documentElement.querySelectorAll(selector));
    return results;
  }

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  execCommand(aCommandName: string, aShowDefaultUI: boolean = false, aValueArgument: any = null): boolean {
    this.execCommandCalls.push({ aCommandName, aShowDefaultUI, aValueArgument });
    if (aCommandName === 'insertText' && this.activeElement) {
      this.activeElement.value = aValueArgument;
    }
    return true;
  }
}

class MockMutationObserver {
  private callback: (mutations: any[]) => void;
  public isObserving: boolean = false;
  public target: any = null;

  constructor(callback: (mutations: any[]) => void) {
    this.callback = callback;
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
    if (this.isObserving) {
      this.callback([]);
    }
  }
}

class MockWindow {
  public Event = MockEvent;
  public InputEvent = MockInputEvent;
  public KeyboardEvent = MockKeyboardEvent;
  public MutationObserver = MockMutationObserver;
  public HTMLTextAreaElement = {
    prototype: {
      get value() {
        return (this as any)._val || '';
      },
      set value(v: string) {
        (this as any)._val = v;
        (this as any).value = v;
      }
    }
  };
}

async function runPhase03Tests() {
  console.log('=== Running Phase 03: DOM Renderer Bridge & Prompt Automator Tests ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge !== null, 'DOM Bridge module must be loaded');

  // ----------------------------------------------------------------------
  // Test 1: DOM Input Detection Across Diverse Antigravity Editor Types
  // ----------------------------------------------------------------------
  console.log('[Test 1] Verifying DOM chat input detection across Monaco, ProseMirror, and Textareas...');

  const doc1 = new MockDocument();

  // 1a. Monaco Editor inside interactive-session
  const sessionDiv = doc1.createElement('div');
  sessionDiv.className = 'interactive-session';
  const monacoDiv = doc1.createElement('div');
  monacoDiv.className = 'monaco-editor';
  const monacoTextarea = doc1.createElement('textarea');
  monacoTextarea.className = 'inputarea';
  monacoDiv.appendChild(monacoTextarea);
  sessionDiv.appendChild(monacoDiv);
  doc1.body.appendChild(sessionDiv);

  const foundInput1 = domBridge.findChatInput(doc1);
  assert.strictEqual(foundInput1, monacoTextarea, 'Should find Monaco inputarea inside interactive session');

  // 1b. Contenteditable ProseMirror container
  const doc2 = new MockDocument();
  const proseMirrorDiv = doc2.createElement('div');
  proseMirrorDiv.className = 'ProseMirror';
  proseMirrorDiv.setAttribute('contenteditable', 'true');
  doc2.body.appendChild(proseMirrorDiv);

  const foundInput2 = domBridge.findChatInput(doc2);
  assert.strictEqual(foundInput2, proseMirrorDiv, 'Should find contenteditable ProseMirror container');

  // 1c. Standard chat textarea with placeholder
  const doc3 = new MockDocument();
  const promptTextarea = doc3.createElement('textarea');
  promptTextarea.setAttribute('placeholder', 'Ask anything or generate code...');
  doc3.body.appendChild(promptTextarea);

  const foundInput3 = domBridge.findChatInput(doc3);
  assert.strictEqual(foundInput3, promptTextarea, 'Should find textarea matching Ask placeholder');

  console.log('  -> Passed: Chat input discovered across Monaco, ProseMirror, and placeholder textareas.');

  // ----------------------------------------------------------------------
  // Test 2: Multi-Strategy Text Injection & Synthetic Event Propagation
  // ----------------------------------------------------------------------
  console.log('\n[Test 2] Verifying multi-strategy text injection and event propagation...');

  const mockWin = new MockWindow();
  const testPrompt = 'Implement comprehensive end-to-end telemetry';

  // 2a. Textarea injection
  const docTextarea = new MockDocument();
  const targetTextarea = docTextarea.createElement('textarea');
  targetTextarea.className = 'interactive-input-editor';
  docTextarea.body.appendChild(targetTextarea);

  const result1 = await domBridge.injectPromptAndSubmit(testPrompt, {
    document: docTextarea,
    window: mockWin,
    targetElement: targetTextarea
  });

  assert.strictEqual(result1.success, true, 'Injection should succeed');
  assert.strictEqual(targetTextarea.value, testPrompt, 'Textarea value should equal promptText');
  assert.strictEqual(targetTextarea.isFocused, true, 'Element should have been focused');

  // Check dispatched events on targetTextarea
  const eventTypes1 = targetTextarea.dispatchedEvents.map(e => e.type);
  assert.ok(eventTypes1.includes('beforeinput'), 'beforeinput event should be dispatched');
  assert.ok(eventTypes1.includes('input'), 'input event should be dispatched');
  assert.ok(eventTypes1.includes('change'), 'change event should be dispatched');
  assert.ok(eventTypes1.includes('keydown'), 'keydown (Enter) event should be dispatched');
  assert.ok(eventTypes1.includes('keyup'), 'keyup (Enter) event should be dispatched');

  // 2b. Contenteditable execCommand injection
  const docEditable = new MockDocument();
  const targetEditable = docEditable.createElement('div');
  targetEditable.className = 'ProseMirror';
  targetEditable.setAttribute('contenteditable', 'true');
  docEditable.body.appendChild(targetEditable);

  const result2 = await domBridge.injectPromptAndSubmit(testPrompt, {
    document: docEditable,
    window: mockWin,
    targetElement: targetEditable
  });

  assert.strictEqual(result2.success, true, 'Contenteditable injection should succeed');
  assert.strictEqual(docEditable.execCommandCalls.some(c => c.aCommandName === 'insertText' && c.aValueArgument === testPrompt), true, 'execCommand insertText should be invoked');

  console.log('  -> Passed: Text injection executed with beforeinput, input, change, and Enter key events.');

  // ----------------------------------------------------------------------
  // Test 3: Send & New Conversation Button Discovery & Click Trigger
  // ----------------------------------------------------------------------
  console.log('\n[Test 3] Verifying Send and New Conversation button discovery & click invocation...');

  const docButtons = new MockDocument();
  const sendButton = docButtons.createElement('button');
  sendButton.setAttribute('aria-label', 'Send Prompt');
  sendButton.className = 'interactive-item-submit-button';
  docButtons.body.appendChild(sendButton);

  const newChatButton = docButtons.createElement('button');
  newChatButton.setAttribute('aria-label', 'New Conversation');
  newChatButton.className = 'codicon-plus';
  docButtons.body.appendChild(newChatButton);

  // Test findSendButton
  const foundSendBtn = domBridge.findSendButton(docButtons);
  assert.strictEqual(foundSendBtn, sendButton, 'findSendButton should locate Send button');

  // Test findNewConversationButton with real Antigravity IDE DOM structure (body.txt)
  const docAntigravity = new MockDocument();
  const antigravityNewConvAnchor = docAntigravity.createElement('a');
  antigravityNewConvAnchor.setAttribute('data-tooltip-id', 'new-conversation-tooltip');
  antigravityNewConvAnchor.className = 'group relative text-sm text-foreground font-medium';
  docAntigravity.body.appendChild(antigravityNewConvAnchor);

  const foundAntigravityBtn = domBridge.findNewConversationButton(docAntigravity);
  assert.strictEqual(foundAntigravityBtn, antigravityNewConvAnchor, 'findNewConversationButton should locate a[data-tooltip-id="new-conversation-tooltip"]');

  const antigravityTriggered = await domBridge.triggerNewConversation({
    document: docAntigravity,
    button: antigravityNewConvAnchor
  });
  assert.strictEqual(antigravityTriggered, true, 'triggerNewConversation on Antigravity anchor should return true');
  assert.strictEqual(antigravityNewConvAnchor.clicked, true, 'Antigravity anchor should be clicked');

  console.log('  -> Passed: Send button and New Conversation button located and triggered (including Antigravity IDE anchor).');

  // ----------------------------------------------------------------------
  // Test 4: Background Permission Auto-Approval Scanner
  // ----------------------------------------------------------------------
  console.log('\n[Test 4] Verifying background permission auto-approver and MutationObserver...');

  const docApproval = new MockDocument();
  let approvedActions: string[] = [];

  // Create approval observer
  const observerController = domBridge.startAutoApprovalObserver(
    ['Allow', 'Always Allow', 'Run', 'Submit'],
    {
      document: docApproval,
      window: mockWin,
      MutationObserver: MockMutationObserver,
      intervalMs: 100000, // Large interval to test observer/scanNow manually
      onApproved: (pat: string) => {
        approvedActions.push(pat);
      }
    }
  );

  // Add permission buttons into DOM
  const allowBtn = docApproval.createElement('button');
  allowBtn.textContent = 'Always Allow';
  docApproval.body.appendChild(allowBtn);

  const runBtn = docApproval.createElement('button');
  runBtn.textContent = 'Run';
  docApproval.body.appendChild(runBtn);

  const unmatchBtn = docApproval.createElement('button');
  unmatchBtn.textContent = 'Cancel';
  docApproval.body.appendChild(unmatchBtn);

  // Trigger scan
  const approvedCount = observerController.scanNow();
  assert.strictEqual(approvedCount, 2, 'Should have approved 2 matching buttons');
  assert.strictEqual(allowBtn.clicked, true, 'Always Allow button should be clicked');
  assert.strictEqual(runBtn.clicked, true, 'Run button should be clicked');
  assert.strictEqual(unmatchBtn.clicked, false, 'Cancel button should not be clicked');

  observerController.stop();
  console.log('  -> Passed: Auto-approval observer clicked modal permission buttons.');

  // ----------------------------------------------------------------------
  // Test 5: Bridge Server Integration Loop & Command Acknowledgment
  // ----------------------------------------------------------------------
  console.log('\n[Test 5] Verifying DomBridgeClient IPC polling loop and server ACK dispatch...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-bridge-'));
  const testWindowKey = 'win_dom_bridge_test';

  const server = new BridgeServer({
    portStart: 48880,
    portEnd: 48890,
    portsRegistryPath: path.join(tempDir, 'ports.json'),
    windowKey: testWindowKey
  });

  const serverPort = await server.start();
  assert.ok(serverPort > 0, 'Server should start and return port');

  // Create mock document and DOM element for the client
  const clientDoc = new MockDocument();
  const clientInput = clientDoc.createElement('textarea');
  clientInput.className = 'interactive-input-editor';
  clientDoc.body.appendChild(clientInput);

  const clientSendBtn = clientDoc.createElement('button');
  clientSendBtn.setAttribute('aria-label', 'Send Prompt');
  clientDoc.body.appendChild(clientSendBtn);

  // Create mock fetch that routes to node http request or bridge server
  const client = new domBridge.DomBridgeClient({
    serverPort,
    windowKey: testWindowKey,
    pollIntervalMs: 50,
    autoApproval: false,
    document: clientDoc,
    window: mockWin,
    fetch: async (urlStr: string, init: any = {}) => {
      const parsed = new URL(urlStr);
      const http = require('http');

      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: init.method || 'GET',
          headers: init.headers || {}
        }, (res: any) => {
          let data = '';
          res.on('data', (c: any) => (data += c));
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              ok: res.statusCode >= 200 && res.statusCode < 300,
              json: async () => JSON.parse(data || '{}')
            });
          });
        });

        req.on('error', reject);
        if (init.body) {
          req.write(init.body);
        }
        req.end();
      });
    }
  });

  // Start client polling
  client.start();

  // Dispatch a prompt command from the server to the client
  const dispatchedPrompt = 'Please optimize the recursive AST traversal';
  const dispatchPromise = server.dispatchPromptCommand(dispatchedPrompt, {
    timeoutMs: 4000,
    windowKey: testWindowKey
  });

  const result = await dispatchPromise;
  assert.strictEqual(result.success, true, 'Server dispatch should resolve with success ACK from client');
  assert.strictEqual(result.status, 'submitClicked', 'ACK status should be submitClicked');
  assert.strictEqual(clientInput.value, dispatchedPrompt, 'Client DOM textarea should have received injected prompt');
  assert.strictEqual(clientSendBtn.clicked, true, 'Client DOM Send button should have been clicked');

  // Stop client and server
  client.stop();
  await server.stop();

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('  -> Passed: DomBridgeClient polling loop received command, injected prompt, clicked submit, and sent ACK.');

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 03 DOM BRIDGE SCRIPT TESTS PASSED!');
  console.log('======================================================\n');
}

runPhase03Tests().catch((err) => {
  console.error('Phase 03 Test Suite Failed:', err);
  process.exit(1);
});
