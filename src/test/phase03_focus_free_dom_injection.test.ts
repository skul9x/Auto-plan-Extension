// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      env: {
        appRoot: undefined
      },
      commands: {
        executeCommand: async () => {}
      },
      window: {
        showWarningMessage: () => {},
        showErrorMessage: () => {}
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
 * Mock DOM Event classes
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

class MockMouseEvent extends MockEvent {
  public button: number;

  constructor(type: string, init: any = {}) {
    super(type, init);
    this.button = init.button || 0;
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
  public focusOptions: any = null;
  public pmViewDesc: any = null;
  public _monacoEditor: any = null;

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

  focus(options?: any) {
    this.isFocused = true;
    this.focusOptions = options;
  }

  blur() {
    this.isFocused = false;
  }

  click() {
    this.clicked = true;
    this.clickCount++;
    this.dispatchEvent(new MockMouseEvent('click', { bubbles: true }));
  }

  contains(child: MockElement): boolean {
    if (child === this) return true;
    for (const c of this.children) {
      if (c === child || c.contains(child)) return true;
    }
    return false;
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
  public hidden: boolean = false;
  public activeElement: MockElement | null = null;
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
    return true;
  }
}

class MockWindow {
  public Event = MockEvent;
  public InputEvent = MockInputEvent;
  public KeyboardEvent = MockKeyboardEvent;
  public MouseEvent = MockMouseEvent;
  public windowFocusCalled: boolean = false;
  public monaco: any = null;

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

  focus() {
    this.windowFocusCalled = true;
  }
}

async function runPhase03FocusFreeDomInjectionTests() {
  console.log('=== Running Phase 03: True Focus-Free DOM Injection & Background Submission Tests ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge !== null, 'DOM Bridge module must be loaded');

  // ----------------------------------------------------------------------
  // Test 1: Zero Window-Focus Stealing Under Background State (document.hidden = true)
  // ----------------------------------------------------------------------
  console.log('[Test 1] Verifying zero window focus stealing when document.hidden = true and document.activeElement = null...');

  const mockWin1 = new MockWindow();
  const mockDoc1 = new MockDocument();
  mockDoc1.hidden = true;
  mockDoc1.activeElement = null;

  const chatContainer = mockDoc1.createElement('div');
  chatContainer.className = 'chat-input-container';
  const textarea1 = mockDoc1.createElement('textarea');
  textarea1.className = 'interactive-input-editor';
  chatContainer.appendChild(textarea1);
  mockDoc1.body.appendChild(chatContainer);

  const sendBtn1 = mockDoc1.createElement('button');
  sendBtn1.className = 'chat-submit-button';
  sendBtn1.setAttribute('aria-label', 'Send');
  mockDoc1.body.appendChild(sendBtn1);

  const promptText1 = 'Refactor core scheduler for zero-lock contention';
  const result1 = await domBridge.injectPromptAndSubmit(promptText1, {
    document: mockDoc1,
    window: mockWin1
  });

  assert.strictEqual(result1.success, true, 'Prompt injection must succeed');
  assert.strictEqual(mockWin1.windowFocusCalled, false, 'window.focus() must NOT be called (zero focus stealing)');
  assert.strictEqual(result1.isBackgroundSubmission, true, 'isBackgroundSubmission flag must be true when document is hidden');
  assert.strictEqual(textarea1.value, promptText1, 'Textarea value must match prompt');
  assert.strictEqual(sendBtn1.clicked, true, 'Send button must be clicked');
  assert.ok(textarea1.isFocused, 'Soft focus on input element was applied');
  assert.deepStrictEqual(textarea1.focusOptions, { preventScroll: true }, 'Focus must use { preventScroll: true }');

  console.log('  -> Passed: Prompt injected without window.focus() and with preventScroll soft focus.');

  // ----------------------------------------------------------------------
  // Test 2: Monaco Editor Model Text Insertion (Direct setValue)
  // ----------------------------------------------------------------------
  console.log('\n[Test 2] Verifying Monaco Editor model text insertion without requiring DOM caret focus...');

  const mockWin2 = new MockWindow();
  const mockDoc2 = new MockDocument();
  mockDoc2.hidden = true;

  const monacoContainer = mockDoc2.createElement('div');
  monacoContainer.className = 'interactive-session monaco-editor';
  const monacoInputarea = mockDoc2.createElement('textarea');
  monacoInputarea.className = 'inputarea';
  monacoContainer.appendChild(monacoInputarea);
  mockDoc2.body.appendChild(monacoContainer);

  let monacoModelText = '';
  const mockMonacoEditorInstance = {
    getDomNode: () => monacoContainer,
    getModel: () => ({
      setValue: (val: string) => {
        monacoModelText = val;
      }
    })
  };

  mockWin2.monaco = {
    editor: {
      getEditors: () => [mockMonacoEditorInstance]
    }
  };

  const monacoPrompt = 'Generate strict type guard assertions';
  const result2 = await domBridge.injectPromptAndSubmit(monacoPrompt, {
    document: mockDoc2,
    window: mockWin2
  });

  assert.strictEqual(result2.success, true, 'Monaco injection should succeed');
  assert.strictEqual(result2.injectionStrategy, 'monaco-model', 'Strategy must be monaco-model');
  assert.strictEqual(monacoModelText, monacoPrompt, 'Monaco model text must be updated via setValue');
  assert.strictEqual(mockWin2.windowFocusCalled, false, 'window.focus() must NOT be called');

  console.log('  -> Passed: Monaco Editor model text updated via direct model.setValue without caret focus.');

  // ----------------------------------------------------------------------
  // Test 3: ProseMirror Transaction Dispatch
  // ----------------------------------------------------------------------
  console.log('\n[Test 3] Verifying ProseMirror transaction dispatch for rich contentEditable containers...');

  const mockWin3 = new MockWindow();
  const mockDoc3 = new MockDocument();
  mockDoc3.hidden = true;

  const proseMirrorDiv = mockDoc3.createElement('div');
  proseMirrorDiv.className = 'ProseMirror';
  proseMirrorDiv.setAttribute('contenteditable', 'true');
  mockDoc3.body.appendChild(proseMirrorDiv);

  let proseMirrorDispatchedText = '';
  proseMirrorDiv.pmViewDesc = {
    view: {
      state: {
        doc: { content: { size: 0 } },
        schema: {
          text: (t: string) => ({ type: 'text', text: t })
        },
        tr: {
          replaceWith: (_from: number, _to: number, node: any) => {
            proseMirrorDispatchedText = node.text;
            return {};
          }
        }
      },
      dispatch: (_tr: any) => {}
    }
  };

  const pmPrompt = 'Implement zero-allocation streaming parser';
  const result3 = await domBridge.injectPromptAndSubmit(pmPrompt, {
    document: mockDoc3,
    window: mockWin3
  });

  assert.strictEqual(result3.success, true, 'ProseMirror injection should succeed');
  assert.strictEqual(result3.injectionStrategy, 'prosemirror-transaction', 'Strategy must be prosemirror-transaction');
  assert.strictEqual(proseMirrorDispatchedText, pmPrompt, 'ProseMirror transaction must dispatch prompt text');

  console.log('  -> Passed: ProseMirror transaction dispatched successfully.');

  // ----------------------------------------------------------------------
  // Test 4: Dual Synthetic Triggering (Enter KeyboardEvent + Send Button Click)
  // ----------------------------------------------------------------------
  console.log('\n[Test 4] Verifying dual synthetic triggering (KeyboardEvent Enter + Send Button Click)...');

  const mockWin4 = new MockWindow();
  const mockDoc4 = new MockDocument();

  const inputArea4 = mockDoc4.createElement('textarea');
  inputArea4.className = 'interactive-input-editor';
  mockDoc4.body.appendChild(inputArea4);

  const sendBtn4 = mockDoc4.createElement('button');
  sendBtn4.setAttribute('aria-label', 'Submit');
  mockDoc4.body.appendChild(sendBtn4);

  const dualPrompt = 'Validate boundary error conditions';
  const result4 = await domBridge.injectPromptAndSubmit(dualPrompt, {
    document: mockDoc4,
    window: mockWin4
  });

  assert.strictEqual(result4.success, true);
  assert.strictEqual(result4.enterDispatched, true, 'Enter keydown/keyup events must be dispatched');
  assert.strictEqual(result4.sendButtonClicked, true, 'Send button click must be triggered');

  // Verify Enter events on input element
  const keyEvents = inputArea4.dispatchedEvents.filter(e => e.type === 'keydown' || e.type === 'keyup');
  assert.strictEqual(keyEvents.length, 2, 'Should dispatch keydown and keyup');
  const kd = keyEvents.find(e => e.type === 'keydown') as MockKeyboardEvent;
  assert.strictEqual(kd.key, 'Enter');
  assert.strictEqual(kd.keyCode, 13);
  assert.strictEqual(kd.which, 13);

  // Verify button click
  assert.strictEqual(sendBtn4.clicked, true, 'Send button was clicked');

  console.log('  -> Passed: Dual synthetic triggering executed Enter KeyboardEvent and Send button click.');

  // ----------------------------------------------------------------------
  // Test 5: End-to-End Bridge Client Polling & Background ACK Metadata
  // ----------------------------------------------------------------------
  console.log('\n[Test 5] Verifying DomBridgeClient IPC polling loop with background submission ACK metadata...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-focus-free-'));
  const testWindowKey = 'win_focus_free_e2e';

  const server = new BridgeServer({
    portStart: 48891,
    portEnd: 48900,
    portsRegistryPath: path.join(tempDir, 'ports.json'),
    windowKey: testWindowKey
  });

  const serverPort = await server.start();
  assert.ok(serverPort > 0, 'Server should start and bind to port');

  // Create mock document with hidden = true
  const clientDoc = new MockDocument();
  clientDoc.hidden = true;
  clientDoc.activeElement = null;

  const clientInput = clientDoc.createElement('textarea');
  clientInput.className = 'interactive-input-editor';
  clientDoc.body.appendChild(clientInput);

  const clientSendBtn = clientDoc.createElement('button');
  clientSendBtn.setAttribute('aria-label', 'Chat Submit');
  clientDoc.body.appendChild(clientSendBtn);

  const clientWin = new MockWindow();

  // Create DomBridgeClient
  const client = new domBridge.DomBridgeClient({
    serverPort,
    windowKey: testWindowKey,
    pollIntervalMs: 40,
    autoApproval: false,
    document: clientDoc,
    window: clientWin,
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

  client.start();

  const dispatchedPrompt = 'Perform focus-free background batch prompt execution';
  const dispatchPromise = server.dispatchPromptCommand(dispatchedPrompt, {
    timeoutMs: 4000,
    windowKey: testWindowKey
  });

  const ackResult = await dispatchPromise;
  assert.strictEqual(ackResult.success, true, 'Dispatch command must succeed');
  assert.strictEqual(ackResult.status, 'submitClicked', 'ACK status must be submitClicked');
  assert.ok(ackResult.metadata, 'ACK must contain metadata');
  assert.strictEqual(ackResult.metadata.isBackgroundSubmission, true, 'isBackgroundSubmission metadata must be true');
  assert.strictEqual(ackResult.metadata.charsInjected, dispatchedPrompt.length, 'charsInjected must match');
  assert.strictEqual(ackResult.metadata.sendButtonClicked, true, 'sendButtonClicked must be true');
  assert.strictEqual(clientWin.windowFocusCalled, false, 'No window.focus() was called during client execution');

  client.stop();
  await server.stop();

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('  -> Passed: DomBridgeClient executed in background and returned full ACK metadata without window focus.');

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 03 FOCUS-FREE DOM INJECTION TESTS PASSED!');
  console.log('======================================================\n');
}

runPhase03FocusFreeDomInjectionTests().catch((err) => {
  console.error('Phase 03 Focus-Free DOM Injection Tests Failed:', err);
  process.exit(1);
});
