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
import { BridgeServer } from '../bridgeServer';

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
  add(...tokens: string[]) { tokens.forEach((t) => this.classes.add(t)); }
  remove(...tokens: string[]) { tokens.forEach((t) => this.classes.delete(t)); }
  contains(token: string): boolean { return this.classes.has(token); }
  toString() { return Array.from(this.classes).join(' '); }
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

function matchesSingleToken(el: MockElement, token: string): boolean {
  if (token === '*') return true;

  let remaining = token;
  const tagMatch = remaining.match(/^([a-zA-Z0-9_-]+)/);
  if (tagMatch) {
    if (el.tagName !== tagMatch[1].toUpperCase()) return false;
    remaining = remaining.slice(tagMatch[1].length);
  }

  while (remaining.length > 0) {
    if (remaining.startsWith('.')) {
      const clsMatch = remaining.match(/^\.([a-zA-Z0-9_-]+)/);
      if (!clsMatch) return false;
      if (!el.classList.contains(clsMatch[1])) return false;
      remaining = remaining.slice(clsMatch[0].length);
    } else if (remaining.startsWith('#')) {
      const idMatch = remaining.match(/^#([a-zA-Z0-9_\\-]+)/);
      if (!idMatch) return false;
      const cleanId = idMatch[1].replace(/\\/g, '');
      if (el.getAttribute('id') !== cleanId) return false;
      remaining = remaining.slice(idMatch[0].length);
    } else if (remaining.startsWith('[')) {
      const attrMatch = remaining.match(/^\[([a-zA-Z0-9_-]+)([*^$]?=)?["']?([^"']*)?["']?\]/);
      if (!attrMatch) return false;
      const [, attr, op, val] = attrMatch;
      const attrVal = el.getAttribute(attr);
      if (attrVal === null) return false;
      if (op === '=' && attrVal !== val) return false;
      if (op === '*=' && !attrVal.includes(val)) return false;
      if (op === '^=' && !attrVal.startsWith(val)) return false;
      if (op === '$=' && !attrVal.endsWith(val)) return false;
      remaining = remaining.slice(attrMatch[0].length);
    } else {
      break;
    }
  }
  return true;
}

function matchesSelector(el: MockElement, selector: string): boolean {
  const selectors = selector.split(',').map(s => s.trim());
  for (const sel of selectors) {
    const tokens = sel.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const lastToken = tokens[tokens.length - 1];
    if (!matchesSingleToken(el, lastToken)) continue;

    if (tokens.length === 1) return true;

    let curr: MockElement | null = el.parentElement;
    let tokenIdx = tokens.length - 2;
    while (curr && tokenIdx >= 0) {
      if (matchesSingleToken(curr, tokens[tokenIdx])) {
        tokenIdx--;
      }
      curr = curr.parentElement;
    }
    if (tokenIdx < 0) return true;
  }
  return false;
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
  public ownerDocument: MockDocument | null = null;

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
    const val = this.attributes.get(name);
    return val !== undefined ? val : null;
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
    if (this.ownerDocument) {
      child.ownerDocument = this.ownerDocument;
    }
    this.children.push(child);
  }

  addEventListener(event: string, handler: (e: any) => void) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(handler);
  }

  dispatchEvent(event: MockEvent): boolean {
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

  querySelector(selector: string): MockElement | null {
    const results = this.querySelectorAll(selector);
    return results.length > 0 ? results[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const matched: MockElement[] = [];
    const check = (el: MockElement) => {
      if (matchesSelector(el, selector)) {
        matched.push(el);
      }
      for (const child of el.children) {
        check(child);
      }
    };

    for (const child of this.children) {
      check(child);
    }
    return matched;
  }

  matches(selector: string): boolean {
    return matchesSelector(this, selector);
  }

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (matchesSelector(curr, selector)) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  getBoundingClientRect() {
    return {
      x: 10,
      y: 10,
      top: 10,
      left: 10,
      width: 100,
      height: 30,
      right: 110,
      bottom: 40
    };
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }
}

class MockDocument extends MockElement {
  public body: MockElement;
  public activeElement: MockElement | null = null;

  constructor() {
    super('#document');
    this.nodeType = 9;
    this.ownerDocument = this;
    this.body = new MockElement('body');
    this.body.ownerDocument = this;
    this.appendChild(this.body);
  }

  createElement(tag: string): MockElement {
    const el = new MockElement(tag);
    el.ownerDocument = this;
    return el;
  }

  execCommand(command: string, showUI?: boolean, value?: any): boolean {
    return true;
  }
}

async function runMultiWindowPortIsolationTest() {
  console.log('=== Starting Phase 02: Multi-Window Port Isolation Test ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge.DomBridgeClient, 'DomBridgeClient should be exported');

  // Create temporary directory for isolated port registries
  const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-phase02-'));
  const portRegistryPath = path.join(testTmpDir, 'ag-autoplan-ports.json');

  const portRangeStart = 48920;
  const portRangeEnd = 48940;

  // 1. Start Server Alpha and Server Beta on consecutive ports
  console.log('[Step 1] Initializing two distinct BridgeServers on consecutive ports...');
  const serverAlpha = new BridgeServer({
    portStart: portRangeStart,
    portEnd: portRangeEnd,
    windowKey: 'window-alpha',
    portsRegistryPath: portRegistryPath,
    staleClientMs: 5000
  });

  const portA = await serverAlpha.start();
  console.log(`✓ Server Alpha started on port: ${portA} with windowKey: "window-alpha"`);

  const serverBeta = new BridgeServer({
    portStart: portA + 1,
    portEnd: portRangeEnd,
    windowKey: 'window-beta',
    portsRegistryPath: portRegistryPath,
    staleClientMs: 5000
  });

  const portB = await serverBeta.start();
  console.log(`✓ Server Beta started on port: ${portB} with windowKey: "window-beta"`);

  assert.strictEqual(portB, portA + 1, 'Server Beta must bind to consecutive port (Port A + 1)');
  assert.strictEqual(serverAlpha.getStatus().serverWindowKey, 'window-alpha');
  assert.strictEqual(serverBeta.getStatus().serverWindowKey, 'window-beta');

  const clientFetch = async (url: string, opts: any = {}) => {
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

  try {
    // 2. Establish an active client connection on Port A with windowKey = 'window-alpha'
    console.log('\n[Step 2] Establishing active client connection on Port A with windowKey = "window-alpha"...');
    const mockDocAlpha = new MockDocument();
    const clientAlpha = new domBridge.DomBridgeClient({
      portStart: portA,
      portEnd: portB,
      windowKey: 'window-alpha',
      document: mockDocAlpha,
      window: { KeyboardEvent: MockEvent, Event: MockEvent },
      fetch: clientFetch
    });

    const alphaDiscoveredPort = await clientAlpha.discoverPort();
    assert.strictEqual(alphaDiscoveredPort, portA, 'Client Alpha must discover and bind to Port A');
    assert.strictEqual(clientAlpha.serverPort, portA, 'Client Alpha serverPort must be portA');

    // Send heartbeat from Alpha to firmly register as active client
    const alphaHeartbeatOk = await clientAlpha.sendHeartbeatPing();
    assert.strictEqual(alphaHeartbeatOk, true, 'Client Alpha heartbeat ping must succeed on Port A');

    const statusAlpha = await httpRequest({
      hostname: '127.0.0.1',
      port: portA,
      path: '/autoplan-status?windowKey=window-alpha',
      method: 'GET'
    });
    assert.strictEqual(statusAlpha.statusCode, 200);
    assert.strictEqual(statusAlpha.body.serverWindowKey, 'window-alpha');
    assert.strictEqual(statusAlpha.body.activeWindowKey, 'window-alpha');
    assert.strictEqual(statusAlpha.body.isCompatible, true);
    console.log(`✓ Client Alpha successfully registered on Port A (serverWindowKey: ${statusAlpha.body.serverWindowKey}, activeWindowKey: ${statusAlpha.body.activeWindowKey})`);

    // 3. Direct probe request to Port A from window-beta
    console.log('\n[Step 3] Sending probe request from window-beta directly to Port A...');
    const probeResA = await httpRequest({
      hostname: '127.0.0.1',
      port: portA,
      path: '/autoplan-status?probe=1&windowKey=window-beta',
      method: 'GET'
    });

    assert.strictEqual(probeResA.statusCode, 409, 'Probing occupied Port A from alien window must return HTTP 409 Conflict');
    assert.strictEqual(probeResA.body.status, 'occupied', 'Status payload must be "occupied"');
    assert.strictEqual(probeResA.body.activeWindowKey, 'window-alpha', 'activeWindowKey must report window-alpha');
    assert.strictEqual(probeResA.body.serverWindowKey, 'window-alpha', 'serverWindowKey must report window-alpha');
    assert.strictEqual(probeResA.body.isCompatible, false, 'isCompatible must be false');
    assert.strictEqual(probeResA.body.bindRejected, true, 'bindRejected must be true');
    console.log(`✓ Port A returned HTTP 409 and explicitly reported status="occupied", activeWindowKey="window-alpha"`);

    // 4. Client Beta runs discoverPort starting from Port A
    console.log('\n[Step 4] Executing discoverPort probe logic for window-beta starting search from Port A...');
    const mockDocBeta = new MockDocument();
    const clientBetaLogs: string[] = [];

    const clientBeta = new domBridge.DomBridgeClient({
      portStart: portA,
      portEnd: portB,
      windowKey: 'window-beta',
      document: mockDocBeta,
      window: { KeyboardEvent: MockEvent, Event: MockEvent },
      fetch: async (url: string, opts: any = {}) => {
        const res = await clientFetch(url, opts);
        if (url.includes('/autoplan-log') && opts.body) {
          try {
            const parsed = JSON.parse(opts.body);
            if (Array.isArray(parsed.logs)) {
              for (const l of parsed.logs) {
                clientBetaLogs.push(l.message || '');
              }
            }
          } catch (_) {}
        }
        return res;
      }
    });

    const betaDiscoveredPort = await clientBeta.discoverPort();

    // 5. Verify that window-beta skipped Port A and connected to Port B
    console.log('\n[Step 5] Verifying window-beta skipped Port A and bound to Port B...');
    assert.strictEqual(betaDiscoveredPort, portB, `window-beta must skip Port A (${portA}) and bind to Port B (${portB})`);
    assert.strictEqual(clientBeta.serverPort, portB, 'clientBeta.serverPort must equal portB');
    console.log(`✓ window-beta correctly skipped Port A and bound exclusively to Port B (${portB})`);

    // Verify status on Port B
    const statusBeta = await httpRequest({
      hostname: '127.0.0.1',
      port: portB,
      path: '/autoplan-status?windowKey=window-beta',
      method: 'GET'
    });
    assert.strictEqual(statusBeta.statusCode, 200);
    assert.strictEqual(statusBeta.body.serverWindowKey, 'window-beta');
    assert.strictEqual(statusBeta.body.activeWindowKey, 'window-beta');
    assert.strictEqual(statusBeta.body.isCompatible, true);
    assert.strictEqual(statusBeta.body.bindRejected, false);

    // 6. Verify command dispatch isolation: command on Port B only received and acknowledged by window-beta
    console.log('\n[Step 6] Verifying command isolation and acknowledgment on Port B...');

    // Setup chat input & send button on mock DOM for Beta
    const chatWidget = new MockElement('div', 'chat-widget');
    const inputArea = new MockElement('textarea', 'inputarea');
    inputArea.setAttribute('placeholder', 'Ask anything...');
    chatWidget.appendChild(inputArea);

    let betaSubmitClicks = 0;
    const sendBtn = new MockElement('button', 'send-button');
    sendBtn.setAttribute('data-testid', 'send-button');
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.addEventListener('click', () => {
      betaSubmitClicks++;
    });
    chatWidget.appendChild(sendBtn);
    mockDocBeta.appendChild(chatWidget);

    clientBeta.isRunning = true;

    // Dispatch prompt command targeted to window-beta on Server Beta
    const promptText = 'Test prompt for window-beta isolated execution';
    const dispatchPromise = serverBeta.dispatchPromptCommand(promptText, {
      windowKey: 'window-beta',
      timeoutMs: 3000
    });

    // Client Alpha attempts to poll Port B (malicious or mistaken window)
    const roguePollRes = await httpRequest({
      hostname: '127.0.0.1',
      port: portB,
      path: '/autoplan-status?windowKey=window-alpha',
      method: 'GET'
    });
    assert.strictEqual(roguePollRes.statusCode, 200);
    assert.strictEqual(roguePollRes.body.bindRejected, true, 'Port B must reject client Alpha with bindRejected=true');
    assert.strictEqual(roguePollRes.body.rejectReason, 'owner-mismatch');
    assert.strictEqual(roguePollRes.body.pendingCommands.length, 0, 'Alien window must NEVER receive pending commands for window-beta');
    console.log(`✓ Port B correctly rejected window-alpha poll and refused to leak window-beta commands`);

    // Client Beta polls Port B and handles the command
    await clientBeta.pollTick();

    // Await server ACK completion
    const ackResult = await dispatchPromise;
    assert.strictEqual(ackResult.success, true, 'dispatchPromptCommand should succeed');
    assert.strictEqual(ackResult.status, 'submitClicked', 'Status should be submitClicked');
    assert.strictEqual(betaSubmitClicks, 1, 'Client Beta submit button must be clicked exactly once');
    console.log(`✓ Command on Port B successfully executed and acknowledged exclusively by window-beta`);

    // 7. Verify Fallback Re-discovery retains window-filtering constraint
    console.log('\n[Step 7] Verifying fallback re-discovery retains window filtering constraint...');
    clientBeta.serverPort = null;
    const redisoveredPort = await clientBeta.discoverPort();
    assert.strictEqual(redisoveredPort, portB, 'Fallback re-discovery must skip Port A and discover Port B again');

    // Simulate clientBeta temporarily mispointed to Port A
    clientBeta.serverPort = portA;
    // pollTick against Port A will receive 200 with bindRejected / 409 and immediately trigger re-discovery
    await clientBeta.pollTick();
    assert.strictEqual(clientBeta.serverPort, portB, 'pollTick on alien port must reset and re-discover Port B');
    console.log(`✓ Fallback re-discovery correctly resets and rebinds to Port B`);

    // Cleanup clients
    clientAlpha.stop();
    clientBeta.stop();

    console.log('\n[Step 8] Stopping both servers cleanly...');
  } finally {
    await serverAlpha.stop();
    await serverBeta.stop();
    try {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log('✓ Both servers stopped cleanly');
  console.log('\n=== All Phase 02 Multi-Window Port Isolation Tests PASSED ===\n');
}

// Execute test
runMultiWindowPortIsolationTest()
  .then(() => {
    console.log('Phase 02 test completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Phase 02 test FAILED:', err);
    process.exit(1);
  });
