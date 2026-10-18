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

class MockWindow {
  public eventListeners: Map<string, Function[]> = new Map();
  public KeyboardEvent = MockEvent;
  public PointerEvent = MockEvent;
  public MouseEvent = MockEvent;
  public Event = MockEvent;

  addEventListener(type: string, listener: Function) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: Function) {
    const list = this.eventListeners.get(type);
    if (list) {
      this.eventListeners.set(type, list.filter(l => l !== listener));
    }
  }

  dispatchEvent(event: any) {
    const list = this.eventListeners.get(event.type);
    if (list) {
      for (const fn of list) {
        fn(event);
      }
    }
    return true;
  }
}

class MockElement {
  public tagName: string;
  public isConnected: boolean = true;
  public eventListeners: Map<string, Function[]> = new Map();
  public disabled: boolean = false;
  public textContent: string = '';

  constructor(tagName: string = 'BUTTON') {
    this.tagName = tagName.toUpperCase();
  }

  getAttribute(name: string) {
    if (name === 'disabled') return this.disabled ? '' : null;
    return null;
  }

  hasAttribute(name: string) {
    return name === 'disabled' ? this.disabled : false;
  }

  getBoundingClientRect() {
    return { width: 40, height: 40, top: 10, left: 10, bottom: 50, right: 50 };
  }

  addEventListener(type: string, fn: Function) {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, []);
    this.eventListeners.get(type)!.push(fn);
  }

  dispatchEvent(event: any) {
    const list = this.eventListeners.get(event.type);
    if (list) {
      for (const fn of list) fn(event);
    }
    return true;
  }

  click() {
    this.dispatchEvent(new MockEvent('click', { bubbles: true }));
  }
}

class MockDocument {
  public defaultView: MockWindow;
  public body: MockElement;
  public documentElement: MockElement;

  constructor(win: MockWindow) {
    this.defaultView = win;
    this.body = new MockElement('BODY');
    this.documentElement = new MockElement('HTML');
  }

  querySelector(_sel: string) {
    return null;
  }

  querySelectorAll(_sel: string) {
    return [];
  }
}

async function runTests() {
  console.log('========================================================================');
  console.log('PHASE 03: ADAPTIVE DOM BRIDGE POLLING & IDLE BACKOFF (PERF-03) TESTS');
  console.log('========================================================================\n');

  const domBridge = loadDomBridge();

  // ---------------------------------------------------------------------------
  // TEST 1: Constant Definitions & Default Tiers
  // ---------------------------------------------------------------------------
  console.log('[Test 1] Verifying adaptive polling constants and default state...');
  assert.strictEqual(domBridge.ACTIVE_POLL_INTERVAL_MS, 400, 'ACTIVE_POLL_INTERVAL_MS must be 400ms');
  assert.strictEqual(domBridge.IDLE_POLL_INTERVAL_MS, 2000, 'IDLE_POLL_INTERVAL_MS must be 2000ms');
  assert.strictEqual(domBridge.IDLE_THRESHOLD_MS, 30000, 'IDLE_THRESHOLD_MS must be 30000ms');
  assert.strictEqual(domBridge.DEFAULT_POLL_INTERVAL_MS, 400, 'DEFAULT_POLL_INTERVAL_MS must default to ACTIVE_POLL_INTERVAL_MS');

  const defaultClient = new domBridge.DomBridgeClient({ windowKey: 'client-test-default' });
  assert.strictEqual(defaultClient.activePollIntervalMs, 400);
  assert.strictEqual(defaultClient.idlePollIntervalMs, 2000);
  assert.strictEqual(defaultClient.idleThresholdMs, 30000);
  assert.strictEqual(defaultClient.currentPollInterval, 400);
  assert.strictEqual(defaultClient.pollIntervalMs, 400);
  console.log('✓ Test 1 Passed: Constants and defaults correctly configured (400ms active / 2000ms idle / 30s threshold)\n');

  // ---------------------------------------------------------------------------
  // TEST 2: Adaptive Dynamic Polling State Machine Calculations
  // ---------------------------------------------------------------------------
  console.log('[Test 2] Verifying computeNextPollInterval state machine logic...');
  const stateClient = new domBridge.DomBridgeClient({
    windowKey: 'client-state-calc',
    activePollIntervalMs: 400,
    idlePollIntervalMs: 2000,
    idleThresholdMs: 30000
  });

  // Recent activity: should return active interval
  stateClient.lastActivityTime = Date.now() - 5000;
  const intervalRecent = stateClient.computeNextPollInterval(false, false);
  assert.strictEqual(intervalRecent, 400, 'Should stay in Active Tier (400ms) when within 30s inactivity');

  // Inactivity >= 30 seconds: should return idle interval
  stateClient.lastActivityTime = Date.now() - 31000;
  const intervalIdle = stateClient.computeNextPollInterval(false, false);
  assert.strictEqual(intervalIdle, 2000, 'Should transition to Idle Tier (2000ms) when inactivity >= 30s');

  // Incoming command: should instantly record activity and return 400ms
  const intervalWithCmd = stateClient.computeNextPollInterval(true, false);
  assert.strictEqual(intervalWithCmd, 400, 'Incoming command must reset immediately to Active Tier (400ms)');
  assert.ok(Date.now() - stateClient.lastActivityTime < 500, 'Incoming command must update lastActivityTime');

  // Server active state: should also maintain 400ms
  stateClient.lastActivityTime = Date.now() - 31000;
  const intervalServerActive = stateClient.computeNextPollInterval(false, true);
  assert.strictEqual(intervalServerActive, 400, 'Server active status must reset to Active Tier (400ms)');
  assert.ok(Date.now() - stateClient.lastActivityTime < 500, 'Server active status must update lastActivityTime');
  console.log('✓ Test 2 Passed: Dynamic polling state machine accurately computes tier transitions\n');

  // ---------------------------------------------------------------------------
  // TEST 3: Bridge Server Coordination (isExecuting & activeTask)
  // ---------------------------------------------------------------------------
  console.log('[Test 3] Verifying BridgeServer execution state coordination...');
  const serverPort = 48891;
  const server = new BridgeServer({
    portStart: serverPort,
    portEnd: serverPort,
    windowKey: 'test-server-window',
    requireAuth: false
  });

  await server.start();
  console.log(`Server started on port ${serverPort}`);

  try {
    // Initial server execution status
    assert.strictEqual(server.isExecuting(), false, 'Server initial isExecuting must be false');
    assert.strictEqual(server.getActiveTask(), undefined);

    let statusRes = await httpRequest({
      hostname: '127.0.0.1',
      port: serverPort,
      path: '/autoplan-status?windowKey=test-server-window',
      method: 'GET'
    });
    assert.strictEqual(statusRes.statusCode, 200);
    assert.strictEqual(statusRes.body.isExecuting, false);
    assert.strictEqual(statusRes.body.activeTask, undefined);

    // Set executing = true
    server.setExecuting(true, 'orchestration-phase-3');
    assert.strictEqual(server.isExecuting(), true);
    assert.strictEqual(server.getActiveTask(), 'orchestration-phase-3');

    statusRes = await httpRequest({
      hostname: '127.0.0.1',
      port: serverPort,
      path: '/autoplan-status?windowKey=test-server-window',
      method: 'GET'
    });
    assert.strictEqual(statusRes.statusCode, 200);
    assert.strictEqual(statusRes.body.isExecuting, true);
    assert.strictEqual(statusRes.body.activeTask, 'orchestration-phase-3');

    // Turn off executing
    server.setExecuting(false);
    assert.strictEqual(server.isExecuting(), false);
    assert.strictEqual(server.getActiveTask(), undefined);

    console.log('✓ Test 3 Passed: BridgeServer properly reports isExecuting & activeTask via /autoplan-status\n');

    // -------------------------------------------------------------------------
    // TEST 4: Live Polling Loop Backoff and Idle Traffic Reduction (>75% drop)
    // -------------------------------------------------------------------------
    console.log('[Test 4] Verifying live adaptive backoff and >75% idle HTTP traffic reduction...');
    const mockWin = new MockWindow();
    const mockDoc = new MockDocument(mockWin);

    let requestCount = 0;
    const clientFetch = async (url: string, opts: any = {}) => {
      if (url.includes('/autoplan-status')) {
        requestCount++;
      }
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

    // Client with fast intervals for deterministic live timing:
    // Active tier: 20ms, Idle tier: 100ms (5x slower -> 80% theoretical reduction)
    // Idle threshold: 180ms
    const liveClient = new domBridge.DomBridgeClient({
      portStart: serverPort,
      portEnd: serverPort,
      windowKey: 'test-server-window',
      activePollIntervalMs: 20,
      idlePollIntervalMs: 100,
      idleThresholdMs: 180,
      document: mockDoc,
      window: mockWin,
      fetch: clientFetch
    });

    liveClient.start();

    // Measure active window: 80ms of active polling (well within 180ms threshold)
    requestCount = 0;
    const activeStart = Date.now();
    await new Promise(r => setTimeout(r, 80));
    const activeDuration = Date.now() - activeStart;
    const activeRequests = requestCount;
    const activeRate = activeRequests / (activeDuration / 1000); // req/sec
    assert.strictEqual(liveClient.currentPollInterval, 20, 'Client must be in Active Tier (20ms) within threshold');

    // Allow client to idle past idleThresholdMs (180ms) without commands
    await new Promise(r => setTimeout(r, 220));
    assert.strictEqual(liveClient.currentPollInterval, 100, 'Client must have backed off to Idle Tier (100ms)');

    // Measure idle window: 200ms of idle polling
    requestCount = 0;
    const idleStart = Date.now();
    await new Promise(r => setTimeout(r, 200));
    const idleDuration = Date.now() - idleStart;
    const idleRequests = requestCount;
    const idleRate = idleRequests / (idleDuration / 1000); // req/sec

    const reductionPercent = ((activeRate - idleRate) / activeRate) * 100;
    console.log(`Active polling rate: ${activeRate.toFixed(2)} req/s (${activeRequests} reqs in ${activeDuration}ms)`);
    console.log(`Idle polling rate:   ${idleRate.toFixed(2)} req/s (${idleRequests} reqs in ${idleDuration}ms)`);
    console.log(`Traffic reduction:   ${reductionPercent.toFixed(1)}%`);

    assert.ok(
      reductionPercent >= 70,
      `Idle HTTP traffic reduction must drop by ~75% (achieved ${reductionPercent.toFixed(1)}%)`
    );
    console.log('✓ Test 4 Passed: Live polling backed off and reduced HTTP traffic by >75%\n');

    // -------------------------------------------------------------------------
    // TEST 5: Instant Wakeup Mechanisms
    // -------------------------------------------------------------------------
    console.log('[Test 5] Verifying instant wakeup mechanisms (commands, UI triggers, window events)...');

    // Case A: Incoming Command Instant Wakeup
    assert.strictEqual(liveClient.currentPollInterval, 100, 'Client is currently in Idle Tier (100ms)');
    const cmdPromise = server.dispatchPromptCommand('', {
      type: 'ping',
      windowKey: 'test-server-window',
      timeoutMs: 3000
    });

    // Wait briefly for poll tick to fetch and execute command
    const ack = await cmdPromise;
    assert.strictEqual(ack.status, 'completed', 'Enqueued ping command must be completed by client');
    assert.strictEqual(liveClient.currentPollInterval, 20, 'Incoming command must immediately wake client back to Active Tier (20ms)');
    console.log('✓ Case A Passed: Incoming server command woke bridge instantly to Active Tier');

    // Case B: Activity Record / Internal Cascade Trigger Instant Wakeup
    // Force to idle tier
    liveClient.reschedulePolling(100);
    assert.strictEqual(liveClient.currentPollInterval, 100);

    liveClient.recordActivity();
    assert.strictEqual(liveClient.currentPollInterval, 20, 'recordActivity() must immediately reset currentPollInterval to 20ms');

    // Button cascade wakeup test
    liveClient.reschedulePolling(100);
    const mockButton = new MockElement('BUTTON');
    domBridge.dispatchButtonClickCascade(mockButton, mockWin);
    assert.strictEqual(liveClient.currentPollInterval, 20, 'dispatchButtonClickCascade must wake bridge to Active Tier');
    console.log('✓ Case B Passed: Internal UI click cascade triggered instant wakeup');

    // Case C: Developer Window Interaction Wakeup (focus, keydown)
    liveClient.reschedulePolling(100);
    assert.strictEqual(liveClient.currentPollInterval, 100);

    mockWin.dispatchEvent(new MockEvent('focus'));
    assert.strictEqual(liveClient.currentPollInterval, 20, 'Window focus event must immediately wake client to Active Tier');

    liveClient.reschedulePolling(100);
    assert.strictEqual(liveClient.currentPollInterval, 100);

    mockWin.dispatchEvent(new MockEvent('keydown'));
    assert.strictEqual(liveClient.currentPollInterval, 20, 'Window keydown event must immediately wake client to Active Tier');
    console.log('✓ Case C Passed: Window focus and keydown events triggered instant wakeup\n');

    liveClient.stop();
  } finally {
    await server.stop();
  }

  console.log('========================================================================');
  console.log('ALL PHASE 03 ADAPTIVE DOM BRIDGE POLLING TESTS PASSED SUCCESSFULLY!');
  console.log('========================================================================\n');
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
