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
      },
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
import * as http from 'http';
import { URL } from 'url';
import { PromptDispatcher } from '../promptDispatcher';
import { BridgeServer } from '../bridgeServer';
import { DebugLogger } from '../debugLogger';
import { AutoPlanConfig } from '../config';
import {
  installBridgeScript,
  uninstallBridgeScript,
  isBridgeInstalled,
  TAG_START,
  TAG_END,
  DEFAULT_BRIDGE_SCRIPT_NAME
} from '../workbenchInjector';

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

const mockConfigProvider = (overrides: Partial<AutoPlanConfig> = {}): AutoPlanConfig => ({
  executionMode: 'auto',
  bridgeTimeoutMs: 5000,
  allowTierFallback: true,
  strictMode: false,
  focusDelayMs: 50,
  enableDiagnosticTrace: false,
  suppressFallbackWarnings: true,
  ...overrides
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
  public composed: boolean;
  public target: any = null;
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
    this.composed = Boolean(options.composed);
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

class MockInputEvent extends MockEvent {
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
  public form: MockFormElement | null = null;

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

  focus(options?: any) {
    this.focused = true;
    this.focusOptions = options;
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  dispatchEvent(event: MockEvent): boolean {
    event.target = this;
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

class MockFormElement extends MockElement {
  public formSubmitted: boolean = false;
  public submitSubmitter: any = null;

  constructor() {
    super('form');
  }

  requestSubmit(submitter?: any) {
    this.formSubmitted = true;
    this.submitSubmitter = submitter;
    this.dispatchedEvents.push(new MockEvent('submit', { bubbles: true, cancelable: true }));
  }
}

class MockDocument {
  public nodeType: number = 9;
  public documentElement: MockElement;
  public body: MockElement;
  public activeElement: MockElement | null = null;
  public hidden: boolean = false;
  public execCommandCalls: Array<{ command: string; showUI: boolean; value: any }> = [];

  public onExecCommand?: (command: string, value: any) => void;

  constructor() {
    this.documentElement = new MockElement('html');
    this.documentElement.ownerDocument = this;
    this.body = new MockElement('body');
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }

  createElement(tagName: string, className: string = ''): MockElement {
    let el: MockElement;
    if (tagName.toLowerCase() === 'form') {
      el = new MockFormElement();
    } else {
      el = new MockElement(tagName, className);
    }
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
    if (this.onExecCommand) {
      this.onExecCommand(command, value);
    }
    return true;
  }
}

function createMockWindow(doc: MockDocument) {
  return {
    document: doc,
    Event: MockEvent,
    InputEvent: MockInputEvent,
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
      const req = http.request({
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

async function runPhase03E2ETests() {
  console.log('=== Running Phase 03: DOM Bridge Dispatcher E2E Integration & Verification Tests ===\n');

  const domBridgeModule = loadDomBridge();
  assert.ok(domBridgeModule, 'DOM Bridge module must be loaded');

  // ==========================================================================
  // Test 1: Full E2E Prompt Dispatch Round-Trip with Realistic Antigravity Lexical Chat DOM
  // ==========================================================================
  console.log('[Test 1] Verifying full E2E prompt dispatch round-trip with realistic Antigravity Lexical Chat DOM...');
  {
    const server = new BridgeServer({
      portStart: 48961,
      portEnd: 48970,
      windowKey: 'win_phase03_e2e_test1'
    });
    const port = await server.start();

    const doc = new MockDocument();
    const win = createMockWindow(doc);

    // 1. Global distraction elements in document outside chat container
    const breadcrumb = doc.createElement('div', 'monaco-breadcrumbs');
    const breadcrumbIcon = doc.createElement('a', 'action-label codicon codicon-arrow-right');
    breadcrumbIcon.setAttribute('title', 'Next Symbol');
    breadcrumb.appendChild(breadcrumbIcon);
    doc.body.appendChild(breadcrumb);

    const toolbar = doc.createElement('div', 'titlebar-actions');
    const navArrow = doc.createElement('button', 'codicon-arrow-right');
    toolbar.appendChild(navArrow);
    doc.body.appendChild(toolbar);

    // 2. Realistic Antigravity Chat Container
    const chatContainer = doc.createElement('div');
    chatContainer.setAttribute('id', 'antigravity.agentSidePanelInputBox');
    doc.body.appendChild(chatContainer);

    const lexicalInput = doc.createElement('div');
    lexicalInput.setAttribute('data-lexical-editor', 'true');
    lexicalInput.setAttribute('contenteditable', 'true');
    lexicalInput.setAttribute('role', 'textbox');
    chatContainer.appendChild(lexicalInput);

    const sendBtn = doc.createElement('button');
    sendBtn.setAttribute('data-testid', 'send-button');
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.disabled = true; // Starts disabled before prompt injection
    chatContainer.appendChild(sendBtn);

    // Simulate Lexical AST reconciliation enabling the button 60ms after prompt injection
    let buttonEnabledTimer: NodeJS.Timeout | null = null;
    doc.onExecCommand = (cmd: string) => {
      if (cmd === 'insertText') {
        buttonEnabledTimer = setTimeout(() => {
          sendBtn.disabled = false;
          sendBtn.setAttribute('aria-disabled', 'false');
        }, 60);
      }
    };

    const client = new domBridgeModule.DomBridgeClient({
      document: doc,
      window: win,
      fetch: createHttpFetch(),
      serverPort: port,
      windowKey: 'win_phase03_e2e_test1'
    });
    client.isRunning = true;

    const registered = await client.sendHeartbeatPing();
    assert.strictEqual(registered, true, 'Client must register with server');

    const dispatcher = new PromptDispatcher({
      bridgeServer: server,
      configProvider: () => mockConfigProvider({ strictMode: true, allowTierFallback: false }),
      commandExecutor: async () => undefined,
      logger: new DebugLogger()
    });

    // Start dispatching prompt
    const promptText = 'Execute Phase 03 DOM Bridge E2E Verification';
    const startTime = Date.now();

    const dispatchPromise = dispatcher.dispatchPrompt(promptText, {
      mode: 'domBridge',
      allowFallback: false,
      windowKey: 'win_phase03_e2e_test1',
      revealChat: false
    });

    // Fast polling cycle
    const pollInterval = setInterval(async () => {
      if (client.isRunning) {
        await client.pollTick();
      }
    }, 15);

    const result = await dispatchPromise;
    clearInterval(pollInterval);
    if (buttonEnabledTimer) clearTimeout(buttonEnabledTimer);

    client.stop();
    await new Promise(r => setTimeout(r, 50));
    await server.stop();

    const elapsed = Date.now() - startTime;

    // Assertions
    assert.strictEqual(result.success, true, 'Dispatch result must be successful');
    assert.strictEqual(result.tier, 'domBridge', 'Selected tier must be domBridge');
    assert.strictEqual(result.status, 'submitClicked', 'Status must be submitClicked');
    assert.ok(elapsed < 500, `Complete E2E dispatch round-trip (${elapsed}ms) must complete in < 500ms`);

    // Button click verification
    assert.strictEqual(sendBtn.clicked, true, 'Antigravity send button must be clicked');
    assert.ok(sendBtn.clickCount >= 1, 'Send button click count >= 1');

    // Distraction safety verification
    assert.strictEqual(breadcrumbIcon.clicked, false, 'Breadcrumb navigation icon must NOT be clicked');
    assert.strictEqual(navArrow.clicked, false, 'Global navigation arrow must NOT be clicked');

    // Telemetry and diagnostic verification
    assert.ok(result.metadata, 'Result metadata must be present');
    assert.strictEqual(result.metadata.charsInjected, promptText.length, 'Injected char count must match');
    assert.strictEqual(result.metadata.submitStrategy, 'buttonClick', 'Submit strategy must be buttonClick');
    assert.strictEqual(result.metadata.initialDisabled, true, 'initialDisabled must reflect initial disabled state');
    assert.ok(result.metadata.buttonWaitDurationMs >= 30, `buttonWaitDurationMs (${result.metadata.buttonWaitDurationMs}ms) >= 30ms`);

    // Verify diagnostic steps
    assert.ok(Array.isArray(result.metadata.steps), 'steps array must be present');
    assert.strictEqual(result.metadata.steps.length, 4, 'Must have 4 diagnostic steps');
    assert.strictEqual(result.metadata.steps[0].status, 'success');
    assert.strictEqual(result.metadata.steps[1].status, 'success');
    assert.strictEqual(result.metadata.steps[2].status, 'success');
    assert.strictEqual(result.metadata.steps[3].status, 'success');

    console.log(`  ✓ E2E Round-trip completed in ${elapsed}ms. Real Antigravity button clicked without clicking distraction icons.`);
  }

  // ==========================================================================
  // Test 2: Strict Mode Compliance & Non-Strict Mode Dispatch with Zero Fallback Triggers
  // ==========================================================================
  console.log('\n[Test 2] Verifying Strict Mode compliance & Auto Mode dispatch with zero fallback triggers...');
  {
    const server = new BridgeServer({
      portStart: 48971,
      portEnd: 48980,
      windowKey: 'win_phase03_e2e_test2'
    });
    const port = await server.start();

    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const chatWidget = doc.createElement('div', 'chat-widget');
    const input = doc.createElement('textarea', 'inputarea');
    input.setAttribute('placeholder', 'Type a message...');
    const sendBtn = doc.createElement('button', 'codicon-send');
    chatWidget.appendChild(input);
    chatWidget.appendChild(sendBtn);
    doc.body.appendChild(chatWidget);

    const client = new domBridgeModule.DomBridgeClient({
      document: doc,
      window: win,
      fetch: createHttpFetch(),
      serverPort: port,
      windowKey: 'win_phase03_e2e_test2'
    });
    client.isRunning = true;
    await client.sendHeartbeatPing();

    const dispatcher = new PromptDispatcher({
      bridgeServer: server,
      configProvider: () => mockConfigProvider({ strictMode: true, allowTierFallback: false }),
      commandExecutor: async () => undefined,
      logger: new DebugLogger()
    });

    // 1. Validate readiness check
    const readiness = dispatcher.validateDispatchReadiness();
    assert.strictEqual(readiness.ready, true, 'Dispatcher readiness must be true');
    assert.strictEqual(readiness.selectedTier, 'domBridge', 'Readiness tier must be domBridge');
    assert.strictEqual(readiness.isFocusFree, true, 'DOM bridge must be focus-free');
    assert.strictEqual(readiness.requiresForegroundFocus, false, 'DOM bridge does not require foreground focus');

    // 2. Strict mode dispatch
    const strictPromise = dispatcher.dispatchPrompt('Strict prompt test', {
      mode: 'domBridge',
      allowFallback: false,
      windowKey: 'win_phase03_e2e_test2',
      revealChat: false
    });

    await new Promise(r => setTimeout(r, 20));
    await client.pollTick();

    const strictResult = await strictPromise;
    assert.strictEqual(strictResult.success, true);
    assert.strictEqual(strictResult.tier, 'domBridge');
    assert.strictEqual(strictResult.fallbackHistory, undefined, 'Zero fallback history in strict mode');

    // 3. Auto mode dispatch (fallback enabled, bridge healthy)
    const autoPromise = dispatcher.dispatchPrompt('Auto prompt test', {
      mode: 'auto',
      allowFallback: true,
      windowKey: 'win_phase03_e2e_test2',
      revealChat: false
    });

    await new Promise(r => setTimeout(r, 20));
    await client.pollTick();

    const autoResult = await autoPromise;
    assert.strictEqual(autoResult.success, true);
    assert.strictEqual(autoResult.tier, 'domBridge');
    assert.strictEqual(autoResult.fallbackHistory, undefined, 'Zero fallback triggers when bridge is active in auto mode');

    client.stop();
    await server.stop();
    console.log('  ✓ Strict Mode compliance and zero-fallback auto mode verified successfully.');
  }

  // ==========================================================================
  // Test 3: Background Submission Diagnostic Verification
  // ==========================================================================
  console.log('\n[Test 3] Verifying background submission diagnostic reporting when document is hidden...');
  {
    const server = new BridgeServer({
      portStart: 48981,
      portEnd: 48990,
      windowKey: 'win_phase03_e2e_test3'
    });
    const port = await server.start();

    const doc = new MockDocument();
    doc.hidden = true; // Hidden workbench tab / background window
    const win = createMockWindow(doc);

    const container = doc.createElement('div', 'interactive-session');
    const input = doc.createElement('textarea', 'inputarea');
    const sendBtn = doc.createElement('button', 'codicon-send');
    container.appendChild(input);
    container.appendChild(sendBtn);
    doc.body.appendChild(container);

    const client = new domBridgeModule.DomBridgeClient({
      document: doc,
      window: win,
      fetch: createHttpFetch(),
      serverPort: port,
      windowKey: 'win_phase03_e2e_test3'
    });
    client.isRunning = true;
    await client.sendHeartbeatPing();

    const dispatcher = new PromptDispatcher({
      bridgeServer: server,
      configProvider: mockConfigProvider,
      commandExecutor: async () => undefined,
      logger: new DebugLogger()
    });

    const dispatchPromise = dispatcher.dispatchPrompt('Background automation prompt', {
      windowKey: 'win_phase03_e2e_test3',
      revealChat: false
    });

    await new Promise(r => setTimeout(r, 20));
    await client.pollTick();

    const result = await dispatchPromise;
    assert.strictEqual(result.success, true);
    assert.ok(result.metadata, 'Metadata must be present');
    assert.strictEqual(result.metadata.isBackgroundSubmission, true, 'isBackgroundSubmission must be true when document is hidden');
    assert.ok(result.metadata.diagnostics, 'diagnostics must be present');
    assert.strictEqual(result.metadata.diagnostics.documentHidden, true, 'diagnostics.documentHidden must be true');

    client.stop();
    await server.stop();
    console.log('  ✓ Background submission diagnostics accurately reported.');
  }

  // ==========================================================================
  // Test 4: Dynamic Send Button Replacement & Double-Tap Submission
  // ==========================================================================
  console.log('\n[Test 4] Verifying dynamically replaced send button & double-tap retry via Dispatcher E2E...');
  {
    const server = new BridgeServer({
      portStart: 48991,
      portEnd: 49000,
      windowKey: 'win_phase03_e2e_test4'
    });
    const port = await server.start();

    const doc = new MockDocument();
    const win = createMockWindow(doc);

    const container = doc.createElement('div', 'chat-widget');
    const input = doc.createElement('textarea');
    input.setAttribute('placeholder', 'Ask a question...');
    container.appendChild(input);

    const disabledBtn = doc.createElement('button', 'send-btn');
    disabledBtn.disabled = true;
    container.appendChild(disabledBtn);
    doc.body.appendChild(container);

    let mountedBtn: any = null;

    // Simulate UI framework replacing the disabled button with a new active button during typing
    setTimeout(() => {
      container.children = container.children.filter(c => c !== disabledBtn);
      mountedBtn = doc.createElement('button', 'send-btn');
      mountedBtn.setAttribute('aria-label', 'Send message');
      mountedBtn.disabled = false;
      container.appendChild(mountedBtn);
    }, 30);

    const client = new domBridgeModule.DomBridgeClient({
      document: doc,
      window: win,
      fetch: createHttpFetch(),
      serverPort: port,
      windowKey: 'win_phase03_e2e_test4'
    });
    client.isRunning = true;
    await client.sendHeartbeatPing();

    const dispatcher = new PromptDispatcher({
      bridgeServer: server,
      configProvider: mockConfigProvider,
      commandExecutor: async () => undefined,
      logger: new DebugLogger()
    });

    const dispatchPromise = dispatcher.dispatchPrompt('Dynamic button replacement test', {
      windowKey: 'win_phase03_e2e_test4',
      revealChat: false
    });

    const pollInterval = setInterval(async () => {
      if (client.isRunning) {
        await client.pollTick();
      }
    }, 15);

    const result = await dispatchPromise;
    clearInterval(pollInterval);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'submitClicked');
    assert.ok(mountedBtn, 'New button must have mounted');
    assert.strictEqual(mountedBtn!.clicked, true, 'Newly mounted button must be clicked');

    client.stop();
    await new Promise(r => setTimeout(r, 50));
    await server.stop();
    console.log('  ✓ Dynamic send button replacement and double-tap retry verified via dispatcher.');
  }

  // ==========================================================================
  // Test 5: Workbench Injector Script Synchronization & Cache-Busting Verification
  // ==========================================================================
  console.log('\n[Test 5] Verifying Workbench Injector script synchronization and cache-busting tag update...');
  {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-e2e-wb-'));
    const mockWbHtmlPath = path.join(tempDir, 'workbench.html');
    const mockProductJsonPath = path.join(tempDir, 'product.json');

    const initialWbHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Antigravity Workbench</title>
</head>
<body>
  <div id="workbench.main.container"></div>
</body>
</html>`;

    const initialProductJson = {
      nameShort: 'Antigravity',
      checksums: {
        'vs/code/electron-sandbox/workbench/workbench.html': 'initialhash'
      }
    };

    fs.writeFileSync(mockWbHtmlPath, initialWbHtml, 'utf8');
    fs.writeFileSync(mockProductJsonPath, JSON.stringify(initialProductJson, null, 2), 'utf8');

    // 1. Install Bridge Script
    const testTimestamp = 1724928000000;
    const installResult = installBridgeScript({
      workbenchPath: mockWbHtmlPath,
      timestamp: testTimestamp,
      updateChecksums: true
    });

    assert.strictEqual(installResult.success, true, 'installBridgeScript must succeed');
    assert.strictEqual(installResult.path, mockWbHtmlPath);

    // Verify injected HTML
    const updatedHtml = fs.readFileSync(mockWbHtmlPath, 'utf8');
    assert.ok(updatedHtml.includes(TAG_START), 'Injected HTML must include TAG_START');
    assert.ok(updatedHtml.includes(TAG_END), 'Injected HTML must include TAG_END');
    assert.ok(updatedHtml.includes(`<script src="${DEFAULT_BRIDGE_SCRIPT_NAME}?v=${testTimestamp}"></script>`), 'Must include cache-busting timestamp');
    assert.strictEqual(isBridgeInstalled(mockWbHtmlPath), true, 'isBridgeInstalled must return true');

    // Verify sidecar DOM bridge script is written to workbench directory
    const sidecarScriptPath = path.join(tempDir, DEFAULT_BRIDGE_SCRIPT_NAME);
    assert.ok(fs.existsSync(sidecarScriptPath), 'Sidecar bridge script file must exist in workbench directory');
    const sidecarContent = fs.readFileSync(sidecarScriptPath, 'utf8');
    assert.ok(sidecarContent.includes('Antigravity Auto-Plan DOM Bridge Client'), 'Sidecar script must contain bridge client implementation');
    assert.ok(sidecarContent.includes('injectPromptAndSubmit'), 'Sidecar script must contain injectPromptAndSubmit');

    // Verify backup created
    const backupPath = `${mockWbHtmlPath}.autoplan.bak`;
    assert.ok(fs.existsSync(backupPath), 'Backup file must exist');

    // 2. Idempotency test (re-running install does not corrupt or duplicate tags)
    const secondInstall = installBridgeScript({
      workbenchPath: mockWbHtmlPath,
      timestamp: testTimestamp,
      updateChecksums: true
    });
    assert.strictEqual(secondInstall.success, true);
    const idempHtml = fs.readFileSync(mockWbHtmlPath, 'utf8');
    const startTagCount = (idempHtml.match(new RegExp(TAG_START, 'g')) || []).length;
    assert.strictEqual(startTagCount, 1, 'There must only be 1 TAG_START in idempotent installation');

    // 3. Uninstall Bridge Script
    const uninstallResult = uninstallBridgeScript({
      workbenchPath: mockWbHtmlPath
    });
    assert.strictEqual(uninstallResult.success, true, 'uninstallBridgeScript must succeed');

    const restoredHtml = fs.readFileSync(mockWbHtmlPath, 'utf8');
    assert.strictEqual(isBridgeInstalled(restoredHtml), false, 'Bridge tags must be stripped');
    assert.strictEqual(fs.existsSync(sidecarScriptPath), false, 'Sidecar script must be unlinked on uninstall');

    // Cleanup temp dir
    try {
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      if (fs.existsSync(mockWbHtmlPath)) fs.unlinkSync(mockWbHtmlPath);
      if (fs.existsSync(mockProductJsonPath)) fs.unlinkSync(mockProductJsonPath);
      fs.rmdirSync(tempDir);
    } catch (_) {}

    console.log('  ✓ Workbench injector script synchronization, cache-busting tags, and uninstaller verified.');
  }

  console.log('\n=== All Phase 03 E2E Tests Passed Successfully! ===');
}

runPhase03E2ETests().catch(err => {
  console.error('\n❌ Phase 03 E2E Test Suite Failed:', err);
  process.exit(1);
});
