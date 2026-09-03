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
import * as http from 'http';
import { BridgeServer, PORT_REGISTRY_FILENAME } from '../bridgeServer';

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

function httpRequest(
  options: http.RequestOptions,
  postData?: string | object
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any; rawBody: string }> {
  return new Promise((resolve, reject) => {
    const dataString = typeof postData === 'object' ? JSON.stringify(postData) : postData;
    const req = http.request(options, (res) => {
      let rawBody = '';
      res.on('data', (chunk) => {
        rawBody += chunk;
      });
      res.on('end', () => {
        let body = rawBody;
        try {
          body = JSON.parse(rawBody);
        } catch {
          // Keep raw string if not JSON
        }
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body,
          rawBody
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (dataString) {
      req.write(dataString);
    }
    req.end();
  });
}

class MockClassList {
  private classes: Set<string> = new Set();

  constructor(className: string = '') {
    if (className) {
      className.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
    }
  }

  add(...tokens: string[]) {
    tokens.forEach((t) => this.classes.add(t));
  }

  remove(...tokens: string[]) {
    tokens.forEach((t) => this.classes.delete(t));
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

  constructor(type: string, options: any = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    this.composed = Boolean(options.composed);
  }
}

class MockElement {
  public tagName: string;
  public className: string;
  public classList: MockClassList;
  public attributes: Map<string, string> = new Map();
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public parentNode: MockElement | null = null;
  public nodeType: number = 1;
  public disabled: boolean = false;
  public value: string = '';
  public innerText: string = '';
  public textContent: string = '';
  public isContentEditable: boolean = false;
  public eventListeners: Map<string, ((e: any) => void)[]> = new Map();
  public style: Record<string, string> = {};

  constructor(tagName: string, className: string = '') {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.classList = new MockClassList(className);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === 'class') {
      this.className = value;
      this.classList = new MockClassList(value);
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

  appendChild(child: MockElement) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
  }

  addEventListener(type: string, handler: (e: any) => void) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(handler);
  }

  dispatchEvent(event: any): boolean {
    event.target = this;
    const handlers = this.eventListeners.get(event.type) || [];
    for (const h of handlers) {
      h(event);
    }
    if (event.bubbles && this.parentElement) {
      this.parentElement.dispatchEvent(event);
    }
    return true;
  }

  click() {
    this.dispatchEvent(new MockEvent('click', { bubbles: true, cancelable: true }));
  }

  focus() {}

  getBoundingClientRect() {
    return { x: 10, y: 10, width: 100, height: 40, top: 10, right: 110, bottom: 50, left: 10 };
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const check = (el: MockElement) => {
      if (matchesSimpleSelector(el, selector)) {
        results.push(el);
      }
      for (const child of el.children) {
        check(child);
      }
    };
    for (const child of this.children) {
      check(child);
    }
    return results;
  }

  matches(selector: string): boolean {
    return matchesSimpleSelector(this, selector);
  }

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (matchesSimpleSelector(curr, selector)) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }
}

function matchesSimpleSelector(el: MockElement, selector: string): boolean {
  const parts = selector.split(',').map((s) => s.trim());
  for (const part of parts) {
    if (part.startsWith('.')) {
      const cls = part.slice(1);
      if (el.classList.contains(cls)) return true;
    } else if (part.startsWith('#')) {
      const id = part.slice(1).replace(/\\/g, '');
      if (el.getAttribute('id') === id) return true;
    } else if (part.includes('[') && part.endsWith(']')) {
      const tagMatch = part.match(/^([a-zA-Z0-9_-]+)?\[([a-zA-Z0-9_-]+)([*^$]?=)?["']?([^"']*)?["']?\]/);
      if (tagMatch) {
        const [, tag, attr, op, val] = tagMatch;
        if (tag && el.tagName !== tag.toUpperCase()) continue;
        const attrVal = el.getAttribute(attr);
        if (attrVal === null) continue;
        if (!op) return true;
        if (op === '=' && attrVal === val) return true;
        if (op === '*=' && attrVal.includes(val)) return true;
      }
    } else if (el.tagName === part.toUpperCase()) {
      return true;
    }
  }
  return false;
}

class MockDocument extends MockElement {
  public activeElement: MockElement | null = null;

  constructor() {
    super('#document');
  }

  createElement(tagName: string): MockElement {
    return new MockElement(tagName);
  }

  execCommand(command: string, showUI: boolean, value: any): boolean {
    return true;
  }
}

async function runPhase01Tests() {
  console.log('=== Running Phase 01: Fallback Abort Coordination (LOGIC-001) Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase01-abort-'));
  const customPortsRegistryPath = path.join(tempDir, PORT_REGISTRY_FILENAME);
  const domBridge = loadDomBridge();

  const server = new BridgeServer({
    portStart: 48870,
    portEnd: 48890,
    portsRegistryPath: customPortsRegistryPath,
    windowKey: 'win_phase01_test',
    defaultTimeoutMs: 300
  });

  try {
    // ----------------------------------------------------------------------
    // 1. Start BridgeServer on a test port
    // ----------------------------------------------------------------------
    console.log('[Step 1] Starting BridgeServer on test port...');
    const serverPort = await server.start();
    assert.strictEqual(server.isListening(), true, 'Server should be listening');
    console.log(`✓ BridgeServer started on port ${serverPort}\n`);

    // ----------------------------------------------------------------------
    // 2. Enqueue a prompt command with a short timeout (300ms)
    // ----------------------------------------------------------------------
    console.log('[Step 2] Enqueuing prompt command with 300ms timeout...');
    let commandPromiseRejected = false;
    let commandRejectionError: any = null;

    const dispatchPromise = server.dispatchPromptCommand('Test abort prompt coordination', {
      timeoutMs: 300,
      windowKey: 'win_phase01_test'
    }).catch((err) => {
      commandPromiseRejected = true;
      commandRejectionError = err;
      return null;
    });

    // ----------------------------------------------------------------------
    // 3. Simulate client fetching command, then stalling beyond 300ms
    // ----------------------------------------------------------------------
    console.log('[Step 3] Fetching command via /autoplan-status and simulating client stall...');
    const statusRes = await httpRequest({
      hostname: '127.0.0.1',
      port: serverPort,
      path: '/autoplan-status?windowKey=win_phase01_test',
      method: 'GET'
    });

    assert.strictEqual(statusRes.statusCode, 200, 'GET /autoplan-status should return 200');
    assert.ok(statusRes.body && Array.isArray(statusRes.body.pendingCommands), 'Response should have pendingCommands array');
    assert.strictEqual(statusRes.body.pendingCommands.length, 1, 'Should contain 1 pending command');

    const fetchedCmd = statusRes.body.pendingCommands[0];
    const commandId = fetchedCmd.id;
    console.log(`✓ Fetched commandId: ${commandId}`);

    // Verify command is not yet cancelled
    assert.strictEqual(server.isCommandCancelled(commandId), false, 'Command should not be cancelled yet');

    // Wait 350ms to exceed 300ms timeout
    console.log('Stalling 350ms to allow server timeout timer to trigger...');
    await new Promise((resolve) => setTimeout(resolve, 350));
    await dispatchPromise;

    // ----------------------------------------------------------------------
    // 4. Verify server marks command as timed out and adds it to cancelled commands
    // ----------------------------------------------------------------------
    console.log('[Step 4] Verifying server marks command as timed out and adds to cancelledCommandIds...');
    assert.strictEqual(commandPromiseRejected, true, 'Dispatch promise must be rejected on timeout');
    assert.ok(
      commandRejectionError && /timed?\s*out/i.test(commandRejectionError.message),
      `Rejection message should mention timeout, got: ${commandRejectionError?.message}`
    );
    assert.strictEqual(server.isCommandCancelled(commandId), true, 'server.isCommandCancelled(commandId) must return true');
    assert.ok(server.getCancelledCommandIds().includes(commandId), 'cancelledCommandIds array must contain commandId');
    console.log(`✓ Server correctly rejected dispatch promise and recorded commandId in cancelledCommandIds\n`);

    // ----------------------------------------------------------------------
    // 5. Verify /autoplan-status returns the cancelled command ID
    // ----------------------------------------------------------------------
    console.log('[Step 5] Verifying /autoplan-status returns cancelled command ID...');
    const statusAfterTimeout = await httpRequest({
      hostname: '127.0.0.1',
      port: serverPort,
      path: '/autoplan-status?windowKey=win_phase01_test',
      method: 'GET'
    });

    assert.strictEqual(statusAfterTimeout.statusCode, 200);
    assert.ok(
      Array.isArray(statusAfterTimeout.body.cancelledCommandIds) &&
        statusAfterTimeout.body.cancelledCommandIds.includes(commandId),
      'cancelledCommandIds in status response must contain commandId'
    );
    assert.ok(
      Array.isArray(statusAfterTimeout.body.cancelledCommands) &&
        statusAfterTimeout.body.cancelledCommands.includes(commandId),
      'cancelledCommands in status response must contain commandId'
    );
    console.log(`✓ /autoplan-status successfully returned cancelledCommandIds: ${JSON.stringify(statusAfterTimeout.body.cancelledCommandIds)}\n`);

    // ----------------------------------------------------------------------
    // 6. Verify client logic aborts submission and refuses to click/submit
    // ----------------------------------------------------------------------
    console.log('[Step 6] Verifying client logic aborts submission and refuses to click/submit...');

    // Setup mock DOM environment
    const mockDoc = new MockDocument();
    const chatWidget = new MockElement('div', 'chat-widget');
    const inputArea = new MockElement('textarea', 'inputarea');
    inputArea.setAttribute('placeholder', 'Ask anything...');
    chatWidget.appendChild(inputArea);

    let submitClickCount = 0;
    let enterKeyPressCount = 0;

    const sendBtn = new MockElement('button', 'send-button');
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.addEventListener('click', () => {
      submitClickCount++;
    });
    chatWidget.appendChild(sendBtn);
    mockDoc.appendChild(chatWidget);

    inputArea.addEventListener('keydown', (e: any) => {
      if (e.key === 'Enter') enterKeyPressCount++;
    });

    // Test 6a: DomBridgeClient polling populates cancelledCommands and aborts handleCommand
    const mockFetch = async (url: string, opts: any = {}) => {
      const parsedUrl = new URL(url);
      const res = await httpRequest({
        hostname: parsedUrl.hostname,
        port: Number(parsedUrl.port),
        path: parsedUrl.pathname + parsedUrl.search,
        method: opts.method || 'GET',
        headers: opts.headers
      }, opts.body);
      return {
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        json: async () => res.body
      };
    };

    const client = new domBridge.DomBridgeClient({
      serverPort,
      windowKey: 'win_phase01_test',
      document: mockDoc,
      window: {
        KeyboardEvent: MockEvent,
        Event: MockEvent,
        monaco: undefined
      },
      fetch: mockFetch
    });
    client.isRunning = true;

    // Poll status: client populates this.cancelledCommands
    await client.pollTick();
    assert.strictEqual(client.isCommandCancelled(commandId), true, 'Client cancelledCommands set must have commandId');

    // Attempt to handle the cancelled command
    await client.handleCommand(fetchedCmd);

    // Verify submit button was NEVER clicked and Enter was NEVER pressed
    assert.strictEqual(submitClickCount, 0, 'Submit button click count MUST be 0');
    assert.strictEqual(enterKeyPressCount, 0, 'Enter keypress count MUST be 0');
    console.log('✓ client.handleCommand aborted cleanly without clicking send button or pressing Enter');

    // Test 6b: Direct injectPromptAndSubmit with cancelled command throws COMMAND_ABORTED_BY_TIMEOUT
    let abortThrown = false;
    let abortError: any = null;

    try {
      await domBridge.injectPromptAndSubmit('Test cancelled prompt', {
        document: mockDoc,
        commandId,
        cancelledCommands: client.cancelledCommands,
        sendButton: sendBtn
      });
    } catch (err: any) {
      abortThrown = true;
      abortError = err;
    }

    assert.strictEqual(abortThrown, true, 'injectPromptAndSubmit must throw when commandId is in cancelledCommands');
    assert.strictEqual(abortError?.code, 'COMMAND_ABORTED_BY_TIMEOUT', 'Error code must be COMMAND_ABORTED_BY_TIMEOUT');
    assert.strictEqual(submitClickCount, 0, 'Submit button must still NOT have been clicked');
    assert.strictEqual(enterKeyPressCount, 0, 'Enter key must still NOT have been dispatched');
    console.log('✓ injectPromptAndSubmit threw COMMAND_ABORTED_BY_TIMEOUT and refused submit dispatch');

    // Test 6c: Direct injectPromptAndSubmit with expired lease deadline
    let expiredThrown = false;
    let expiredError: any = null;

    try {
      await domBridge.injectPromptAndSubmit('Test expired prompt', {
        document: mockDoc,
        commandId: 'cmd_expired_test_123',
        commandDeadline: Date.now() - 50, // Deadline already passed
        sendButton: sendBtn
      });
    } catch (err: any) {
      expiredThrown = true;
      expiredError = err;
    }

    assert.strictEqual(expiredThrown, true, 'injectPromptAndSubmit must throw when commandDeadline has elapsed');
    assert.strictEqual(expiredError?.code, 'COMMAND_ABORTED_BY_TIMEOUT', 'Expired command must have COMMAND_ABORTED_BY_TIMEOUT code');
    assert.strictEqual(submitClickCount, 0, 'Submit button must still NOT have been clicked after expired test');
    console.log('✓ injectPromptAndSubmit aborted on expired lease deadline');

    // Test 6d: Server handles ACK for cancelled command without error
    const ackRes = await httpRequest({
      hostname: '127.0.0.1',
      port: serverPort,
      path: '/autoplan-ack',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      commandId,
      status: 'aborted',
      windowKey: 'win_phase01_test',
      error: 'COMMAND_ABORTED_BY_TIMEOUT'
    });

    assert.strictEqual(ackRes.statusCode, 200, 'Server must return 200 for ACK of cancelled command');
    assert.strictEqual(ackRes.body?.ignored, true, 'Server must mark cancelled ACK as ignored');
    assert.strictEqual(ackRes.body?.reason, 'command-cancelled', 'Server reason must be command-cancelled');
    console.log('✓ Server gracefully discarded ACK for cancelled command without error\n');

  } finally {
    // ----------------------------------------------------------------------
    // 7. Clean up and terminate server
    // ----------------------------------------------------------------------
    console.log('[Step 7] Cleaning up and stopping server...');
    await server.stop();
    assert.strictEqual(server.isListening(), false, 'Server should no longer be listening');
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    console.log('✓ Server stopped and temporary test registry cleaned up\n');
  }

  console.log('=== All Phase 01 Tests Passed Successfully! ===');
}

runPhase01Tests().catch((err) => {
  console.error('Phase 01 Test Failed:', err);
  process.exit(1);
});
