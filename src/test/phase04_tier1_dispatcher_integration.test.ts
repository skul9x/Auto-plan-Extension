// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      commands: {
        executeCommand: async (_cmd: string, ..._args: any[]) => undefined
      },
      window: {
        showWarningMessage: (_msg: string) => undefined
      },
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue
        })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { PromptDispatcher } from '../promptDispatcher';
import { BridgeServer } from '../bridgeServer';
import { DebugLogger } from '../debugLogger';
import { AutoPlanConfig } from '../config';

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

const mockConfigProvider = (): AutoPlanConfig => ({
  executionMode: 'auto',
  bridgeTimeoutMs: 5000,
  allowTierFallback: true,
  strictMode: false,
  focusDelayMs: 50,
  enableDiagnosticTrace: false,
  suppressFallbackWarnings: true
} as any);

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
  public button?: number;
  public key?: string;
  public code?: string;
  public keyCode?: number;
  public which?: number;
  public inputType?: string;
  public data?: string;

  constructor(type: string, options: any = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    if (options.button !== undefined) this.button = options.button;
    if (options.key !== undefined) this.key = options.key;
    if (options.code !== undefined) this.code = options.code;
    if (options.keyCode !== undefined) this.keyCode = options.keyCode;
    if (options.which !== undefined) this.which = options.which;
    if (options.inputType !== undefined) this.inputType = options.inputType;
    if (options.data !== undefined) this.data = options.data;
  }
}

class MockPointerEvent extends MockEvent {
  constructor(type: string, options: any = {}) {
    super(type, options);
  }
}

class MockMouseEvent extends MockEvent {
  constructor(type: string, options: any = {}) {
    super(type, options);
  }
}

class MockKeyboardEvent extends MockEvent {
  constructor(type: string, options: any = {}) {
    super(type, options);
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
  public form: MockElement | null = null;
  public requestSubmitCalls: any[] = [];

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
    this.dispatchedEvents.push(new MockMouseEvent('native-click'));
  }

  requestSubmit(submitter?: any) {
    this.requestSubmitCalls.push(submitter);
    this.dispatchedEvents.push(new MockEvent('submit', { bubbles: true, cancelable: true }));
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
  public hidden: boolean = false;
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

  execCommand(_command: string, _showUI: boolean = false, _value: any = null): boolean {
    return this.execCommandReturnValue;
  }
}

function createMockWindow(doc: MockDocument) {
  return {
    document: doc,
    Event: MockEvent,
    InputEvent: MockEvent,
    PointerEvent: MockPointerEvent,
    MouseEvent: MockMouseEvent,
    KeyboardEvent: MockKeyboardEvent,
    HTMLTextAreaElement: MockElement,
    HTMLInputElement: MockElement
  };
}

function createHttpFetch() {
  return async (url: string, init?: any) => {
    const fetchUrl = new URL(url);
    const headers: Record<string, any> = { ...(init?.headers || {}) };
    const bodyData: any = init?.body;
    if (bodyData && typeof bodyData === 'string') {
      headers['Content-Length'] = Buffer.byteLength(bodyData);
    }
    return new Promise((resolve, reject) => {
      const req = require('http').request({
        hostname: fetchUrl.hostname,
        port: fetchUrl.port,
        path: fetchUrl.pathname + fetchUrl.search,
        method: init?.method || 'GET',
        headers
      }, (res: any) => {
        let body = '';
        res.on('data', (d: any) => body += d);
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              ok: res.statusCode >= 200 && res.statusCode < 300,
              json: async () => JSON.parse(body || '{}')
            });
          } catch (e) {
            resolve({
              status: res.statusCode,
              ok: res.statusCode >= 200 && res.statusCode < 300,
              json: async () => ({})
            });
          }
        });
      });
      req.on('error', reject);
      if (bodyData) req.write(bodyData);
      req.end();
    });
  };
}

async function runPhase04Tests() {
  console.log('=== Running Phase 04: Tier 1 Prompt Dispatcher & Chat Reveal Integration Tests ===\n');

  const domBridgeModule = loadDomBridge();
  assert.ok(domBridgeModule, 'DOM Bridge module must be loaded');

  // Test 1: Chat Reveal Hook Execution in dispatchTier1
  console.log('[Test 1] Verifying Chat Reveal Hook in dispatchTier1...');
  {
    const executedCommands: string[] = [];
    const mockExecutor = async (cmd: string, ..._args: any[]) => {
      executedCommands.push(cmd);
      return undefined;
    };

    const server = new BridgeServer({
      portStart: 48910,
      portEnd: 48920,
      windowKey: 'win_phase04_test1'
    });
    const port = await server.start();

    // Register a simulated client in BridgeServer
    const doc = new MockDocument();
    const win = createMockWindow(doc);
    const input = doc.createElement('textarea', 'inputarea');
    input.setAttribute('placeholder', 'Ask a question...');
    const sendBtn = doc.createElement('button', 'codicon-send');
    sendBtn.setAttribute('data-testid', 'send-button');
    doc.body.appendChild(input);
    doc.body.appendChild(sendBtn);

    const client = new domBridgeModule.DomBridgeClient({
      document: doc,
      window: win,
      fetch: createHttpFetch(),
      serverPort: port,
      windowKey: 'win_phase04_test1'
    });
    client.isRunning = true;

    // Register client with heartbeat
    const registered = await client.sendHeartbeatPing();
    assert.strictEqual(registered, true, 'Client must register with server');

    const dispatcher = new PromptDispatcher({
      bridgeServer: server,
      configProvider: mockConfigProvider,
      commandExecutor: mockExecutor,
      logger: new DebugLogger()
    });

    const promptText = 'Refactor event loop dispatcher';
    const dispatchPromise = dispatcher.dispatchTier1(promptText, {
      revealChat: true,
      windowKey: 'win_phase04_test1'
    });

    // Poll to receive and process command
    await new Promise(r => setTimeout(r, 50));
    await client.pollTick();

    const result = await dispatchPromise;

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.tier, 'domBridge');
    assert.ok(executedCommands.includes('workbench.action.chat.open'), 'Reveal chat command must be executed');
    assert.strictEqual(result.status, 'submitClicked');

    await server.stop();
    console.log('  ✓ Chat reveal hook executed and prompt dispatched via Tier 1 DOM Bridge successfully.');
  }

  // Test 2: options.revealChat === false suppresses reveal chat command
  console.log('\n[Test 2] Verifying options.revealChat === false suppresses chat reveal command...');
  {
    const executedCommands: string[] = [];
    const mockExecutor = async (cmd: string) => {
      executedCommands.push(cmd);
      return undefined;
    };

    const server = new BridgeServer({
      portStart: 48921,
      portEnd: 48930,
      windowKey: 'win_phase04_test2'
    });
    const port = await server.start();

    const doc = new MockDocument();
    const win = createMockWindow(doc);
    const input = doc.createElement('textarea', 'inputarea');
    const sendBtn = doc.createElement('button', 'codicon-send');
    doc.body.appendChild(input);
    doc.body.appendChild(sendBtn);

    const client = new domBridgeModule.DomBridgeClient({
      document: doc,
      window: win,
      fetch: createHttpFetch(),
      serverPort: port,
      windowKey: 'win_phase04_test2'
    });
    client.isRunning = true;

    await client.sendHeartbeatPing();

    const dispatcher = new PromptDispatcher({
      bridgeServer: server,
      configProvider: mockConfigProvider,
      commandExecutor: mockExecutor,
      logger: new DebugLogger()
    });

    const dispatchPromise = dispatcher.dispatchTier1('Suppress reveal test', {
      revealChat: false,
      windowKey: 'win_phase04_test2'
    });

    await new Promise(r => setTimeout(r, 50));
    await client.pollTick();

    const result = await dispatchPromise;

    assert.strictEqual(result.success, true);
    assert.strictEqual(executedCommands.length, 0, 'No commands should be executed when revealChat is false');

    await server.stop();
    console.log('  ✓ revealChat: false properly bypassed chat reveal execution.');
  }

  // Test 3: Robust Error Forwarding with domSnapshot and Step Diagnostics
  console.log('\n[Test 3] Verifying diagnostic error forwarding when DOM bridge rejects...');
  {
    const server = new BridgeServer({
      portStart: 48931,
      portEnd: 48940,
      windowKey: 'win_phase04_test3'
    });
    const port = await server.start();

    // Client with empty DOM document (no textarea or input) -> will fail to find input
    const emptyDoc = new MockDocument();
    const emptyWin = createMockWindow(emptyDoc);

    const client = new domBridgeModule.DomBridgeClient({
      document: emptyDoc,
      window: emptyWin,
      fetch: createHttpFetch(),
      serverPort: port,
      windowKey: 'win_phase04_test3'
    });
    client.isRunning = true;

    await client.sendHeartbeatPing();

    const dispatcher = new PromptDispatcher({
      bridgeServer: server,
      configProvider: mockConfigProvider,
      commandExecutor: async () => undefined,
      logger: new DebugLogger()
    });

    let caughtError: any = null;

    const dispatchPromise = dispatcher.dispatchTier1('Prompt with missing input', {
      windowKey: 'win_phase04_test3'
    }).catch(err => {
      caughtError = err;
    });

    await new Promise(r => setTimeout(r, 50));
    await client.pollTick();
    await dispatchPromise;

    assert.ok(caughtError, 'dispatchTier1 must throw on DOM rejection');
    assert.ok(caughtError.message.includes('No valid chat input element found in DOM'), 'Error message must match missing input');
    assert.ok(caughtError.domSnapshot || caughtError.metadata?.domSnapshot, 'Error must include domSnapshot');
    assert.ok(caughtError.steps || caughtError.metadata?.steps, 'Error must include step diagnostics');

    await server.stop();
    console.log('  ✓ DOM Bridge rejection forwarded with domSnapshot and step diagnostics.');
  }

  // Test 4: Seamless Transition to Tier Fallback Chain
  console.log('\n[Test 4] Verifying seamless fallback transition without hanging when allowFallback is enabled...');
  {
    const executedNativeCommands: string[] = [];
    const server = new BridgeServer({
      portStart: 48941,
      portEnd: 48950,
      windowKey: 'win_phase04_test4'
    });
    const port = await server.start();

    // Client with empty DOM (will fail Tier 1)
    const emptyDoc = new MockDocument();
    const emptyWin = createMockWindow(emptyDoc);
    const client = new domBridgeModule.DomBridgeClient({
      document: emptyDoc,
      window: emptyWin,
      fetch: createHttpFetch(),
      serverPort: port,
      windowKey: 'win_phase04_test4'
    });
    client.isRunning = true;

    await client.sendHeartbeatPing();

    const dispatcher = new PromptDispatcher({
      bridgeServer: server,
      configProvider: mockConfigProvider,
      commandExecutor: async (cmd: string, ...args: any[]) => {
        executedNativeCommands.push(cmd);
        if (cmd === 'antigravity.sendTextToChat') {
          return { sent: args[0] };
        }
        return undefined;
      },
      logger: new DebugLogger()
    });

    const resultPromise = dispatcher.dispatchPrompt('Fallback prompt test', {
      mode: 'auto',
      allowFallback: true,
      windowKey: 'win_phase04_test4'
    });

    await new Promise(r => setTimeout(r, 50));
    await client.pollTick();

    const result = await resultPromise;

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.tier, 'nativeCommand', 'Should have seamlessly transitioned to Tier 2 nativeCommand');
    assert.ok(result.fallbackHistory, 'Must contain fallbackHistory');
    assert.strictEqual(result.fallbackHistory.length, 1);
    assert.strictEqual(result.fallbackHistory[0].tier, 'domBridge');
    assert.ok(result.fallbackHistory[0].error.includes('No valid chat input element found in DOM'));
    assert.ok(executedNativeCommands.includes('antigravity.sendTextToChat'), 'Native command must be invoked');

    await server.stop();
    console.log('  ✓ Seamless fallback from Tier 1 to Tier 2 verified with recorded fallbackHistory.');
  }

  console.log('\n=== All Phase 04 Tests Passed Successfully! ===');
}

runPhase04Tests().catch(err => {
  console.error('\n❌ Phase 04 Test Suite Failed:', err);
  process.exit(1);
});
