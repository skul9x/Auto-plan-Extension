// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      env: {
        appRoot: undefined
      },
      workspace: {
        getConfiguration: () => ({
          get: (key: string, defaultVal: any) => defaultVal
        })
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
import { BridgeServer, DEFAULT_STALE_CLIENT_MS, PORT_REGISTRY_FILENAME } from '../bridgeServer';
import { DEFAULT_CONFIG, getConfig } from '../config';

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
 * Mock Web Worker environment for simulating inline Blob Web Worker timer in Node.js
 */
class MockWorkerBlob {
  public content: string;
  public type: string;
  constructor(parts: any[], options: any = {}) {
    this.content = parts.join('');
    this.type = options.type || '';
  }
}

class MockWorkerURL {
  private static blobMap = new Map<string, MockWorkerBlob>();
  private static idSeq = 1;

  static createObjectURL(blob: MockWorkerBlob): string {
    const url = `blob:nodedata://worker_${this.idSeq++}`;
    this.blobMap.set(url, blob);
    return url;
  }

  static revokeObjectURL(url: string): void {
    this.blobMap.delete(url);
  }

  static has(url: string): boolean {
    return this.blobMap.has(url);
  }
}

class MockWorker {
  public url: string;
  public onmessage: ((e: any) => void) | null = null;
  public isTerminated: boolean = false;
  public messagesSent: any[] = [];
  public intervalTimer: any = null;

  constructor(url: string) {
    this.url = url;
  }

  postMessage(msg: any) {
    this.messagesSent.push(msg);
    if (msg === 'start') {
      if (this.intervalTimer) clearInterval(this.intervalTimer);
      this.intervalTimer = setInterval(() => {
        if (!this.isTerminated && typeof this.onmessage === 'function') {
          this.onmessage({ data: 'tick' });
        }
      }, 50);
    } else if (msg === 'stop') {
      if (this.intervalTimer) {
        clearInterval(this.intervalTimer);
        this.intervalTimer = null;
      }
    }
  }

  terminate() {
    this.isTerminated = true;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }
}

async function runPhase01BackgroundKeepaliveTests() {
  console.log('=== Running Phase 01: Background Keep-Alive Engine & Adaptive Stale Threshold Tests ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge, 'DOM Bridge module must load successfully');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase01-keepalive-'));
  const portsRegistryPath = path.join(tempDir, PORT_REGISTRY_FILENAME);

  try {
    // ----------------------------------------------------------------------
    // Test 1: Configuration & Default Stale Threshold
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying adaptive stale threshold constants and configuration...');

    assert.strictEqual(DEFAULT_STALE_CLIENT_MS, 120000, 'DEFAULT_STALE_CLIENT_MS in bridgeServer.ts must be 120000 (120s)');
    assert.strictEqual(DEFAULT_CONFIG.staleClientMs, 120000, 'DEFAULT_CONFIG.staleClientMs must be 120000');

    const loadedConfig = getConfig();
    assert.strictEqual(loadedConfig.staleClientMs, 120000, 'getConfig().staleClientMs must default to 120000');

    console.log('  -> Passed: Stale threshold defaults to 120,000ms (2 minutes).');

    // ----------------------------------------------------------------------
    // Test 2: Inline Worker Timer & Fallback Timer Mechanics
    // ----------------------------------------------------------------------
    console.log('\n[Test 2] Verifying inline Blob Web Worker timer creation, ticks, and fallback...');

    // 2A: Worker creation with Blob URL
    let workerTicks = 0;
    const workerTimer = domBridge.createWorkerTimer(() => {
      workerTicks++;
    }, 50, {
      Worker: MockWorker,
      Blob: MockWorkerBlob,
      URL: MockWorkerURL
    });

    assert.strictEqual(workerTimer.type, 'worker', 'Timer type should be "worker" when Worker/Blob is supported');
    assert.ok(workerTimer.blobUrl, 'Timer should have created a Blob URL');
    assert.strictEqual(MockWorkerURL.has(workerTimer.blobUrl), true, 'Blob URL should be registered in URL registry');

    // Wait for ~150ms to allow ~2-3 ticks
    await new Promise(resolve => setTimeout(resolve, 160));
    assert.ok(workerTicks >= 2, `Expected at least 2 ticks from worker, got ${workerTicks}`);

    // Teardown worker timer
    workerTimer.stop();
    const ticksAfterStop = workerTicks;
    assert.strictEqual(MockWorkerURL.has(workerTimer.blobUrl), false, 'Blob URL should be revoked on stop()');

    await new Promise(resolve => setTimeout(resolve, 100));
    assert.strictEqual(workerTicks, ticksAfterStop, 'Worker should not fire ticks after stop()');

    // 2B: Fallback to setInterval when Worker/Blob is unavailable
    let fallbackTicks = 0;
    const fallbackTimer = domBridge.createWorkerTimer(() => {
      fallbackTicks++;
    }, 30, {
      Worker: null,
      Blob: null,
      URL: null
    });

    assert.strictEqual(fallbackTimer.type, 'interval', 'Timer type should fall back to "interval"');
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.ok(fallbackTicks >= 1, `Expected at least 1 tick from fallback interval, got ${fallbackTicks}`);

    fallbackTimer.stop();
    const fallbackTicksAfterStop = fallbackTicks;
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.strictEqual(fallbackTicks, fallbackTicksAfterStop, 'Fallback interval should not fire after stop()');

    console.log('  -> Passed: Worker timer runs unthrottled and gracefully falls back to setInterval.');

    // ----------------------------------------------------------------------
    // Test 3: Server Watchdog Inactivity Eviction under 120s Threshold
    // ----------------------------------------------------------------------
    console.log('\n[Test 3] Verifying BridgeServer client inactivity retention up to 120s threshold...');

    const watchdogServer = new BridgeServer({
      portStart: 49400,
      portEnd: 49420,
      portsRegistryPath,
      windowKey: 'win_keepalive_1',
      staleClientMs: 120000
    });

    const watchdogPort = await watchdogServer.start();
    assert.ok(watchdogPort > 0, 'Server should bind to port');

    // Manually register a client via probe/status
    const clientKey = 'client_window_test_1';
    await fetch(`http://127.0.0.1:${watchdogPort}/autoplan-status?windowKey=${clientKey}&probe=1`);

    let connected = watchdogServer.getConnectedClients();
    assert.strictEqual(connected.length, 1, 'Client should be registered');
    assert.strictEqual(connected[0].windowKey, clientKey);

    // Simulate 60 seconds of idle silence (should NOT evict under 120s threshold)
    const now = Date.now();
    (watchdogServer as any).clients.get(clientKey).lastSeenAt = now - 60000;

    let evicted = watchdogServer.runWatchdogCheck();
    assert.strictEqual(evicted, 0, 'Client should NOT be evicted after 60s silence (< 120s threshold)');
    assert.strictEqual(watchdogServer.getConnectedClients().length, 1, 'Client should remain connected');

    // Simulate 121 seconds of idle silence (exceeds 120s threshold -> should evict)
    (watchdogServer as any).clients.get(clientKey).lastSeenAt = now - 121000;
    evicted = watchdogServer.runWatchdogCheck();
    assert.strictEqual(evicted, 1, 'Client should be evicted after 121s silence (> 120s threshold)');
    assert.strictEqual(watchdogServer.getConnectedClients().length, 0, 'Client map should be empty after eviction');

    const watchdogStatus = watchdogServer.getWatchdogStatus();
    assert.strictEqual(watchdogStatus.evictedCount, 1, 'Evicted count should be 1');
    assert.strictEqual(watchdogStatus.lastEvictedWindowKey, clientKey, 'Last evicted key should match');

    await watchdogServer.stop();
    console.log('  -> Passed: Inactive clients retained for 60s and correctly evicted after 120s silence.');

    // ----------------------------------------------------------------------
    // Test 4: Dedicated Background Heartbeat Ping Registration
    // ----------------------------------------------------------------------
    console.log('\n[Test 4] Verifying dedicated background heartbeat endpoint & client registration...');

    const heartbeatServer = new BridgeServer({
      portStart: 49430,
      portEnd: 49450,
      portsRegistryPath,
      windowKey: 'win_keepalive_2',
      staleClientMs: 120000
    });

    const hbPort = await heartbeatServer.start();

    const client = new domBridge.DomBridgeClient({
      portStart: 49430,
      portEnd: 49450,
      serverPort: hbPort,
      windowKey: 'win_heartbeat_client',
      pollIntervalMs: 50,
      heartbeatIntervalMs: 80,
      fetch: globalThis.fetch,
      Worker: MockWorker,
      Blob: MockWorkerBlob,
      URL: MockWorkerURL,
      autoApproval: false
    });

    // Send direct heartbeat ping
    const hbSuccess = await client.sendHeartbeatPing();
    assert.strictEqual(hbSuccess, true, 'sendHeartbeatPing() should return true on 200 OK');

    const statusAfterHb = heartbeatServer.getStatus();
    assert.ok(statusAfterHb.lastHeartbeatAt && statusAfterHb.lastHeartbeatAt > 0, 'Server status must have lastHeartbeatAt timestamp');

    const connectedHbClients = heartbeatServer.getConnectedClients();
    assert.strictEqual(connectedHbClients.length, 1, 'Heartbeat client must be registered in server');
    assert.strictEqual(connectedHbClients[0].windowKey, 'win_heartbeat_client');
    assert.strictEqual(connectedHbClients[0].status, 'alive');

    // Start client keepalive & heartbeat loops
    client.start();
    assert.strictEqual(client.isRunning, true, 'Client should be running');
    assert.ok(client.workerTimer, 'Worker poll timer should be initialized');
    assert.ok(client.heartbeatTimer, 'Worker heartbeat timer should be initialized');

    // Allow multiple worker-based ticks and heartbeats
    await new Promise(resolve => setTimeout(resolve, 200));

    const updatedClients = heartbeatServer.getConnectedClients();
    assert.strictEqual(updatedClients.length, 1);
    assert.strictEqual(updatedClients[0].windowKey, 'win_heartbeat_client');

    client.stop();
    assert.strictEqual(client.isRunning, false, 'Client should be stopped');
    assert.strictEqual(client.workerTimer, null, 'Worker timer should be null after stop');
    assert.strictEqual(client.heartbeatTimer, null, 'Heartbeat timer should be null after stop');

    await heartbeatServer.stop();
    console.log('  -> Passed: Heartbeat ping continuously updates client lastSeenAt and server status.');

    // ----------------------------------------------------------------------
    // Test 5: Resilient Port Reconnection after Server Restart
    // ----------------------------------------------------------------------
    console.log('\n[Test 5] Verifying resilient port re-discovery after simulated server restart...');

    // Start Server 1
    const serverRestart1 = new BridgeServer({
      portStart: 49460,
      portEnd: 49480,
      portsRegistryPath,
      windowKey: 'win_keepalive_restart_1'
    });
    const portR1 = await serverRestart1.start();

    const reconnectClient = new domBridge.DomBridgeClient({
      portStart: 49460,
      portEnd: 49480,
      windowKey: 'win_reconnect_client',
      pollIntervalMs: 50,
      heartbeatIntervalMs: 50,
      fetch: globalThis.fetch,
      autoApproval: false
    });

    reconnectClient.start();
    const discoveredPort1 = await reconnectClient.discoverPort();
    assert.strictEqual(discoveredPort1, portR1, 'Client should discover Server 1 port');

    // Stop Server 1 (simulating server restart / disconnect)
    await serverRestart1.stop();

    // Start Server 2 on the next port in range
    const serverRestart2 = new BridgeServer({
      portStart: portR1 + 1,
      portEnd: 49480,
      portsRegistryPath,
      windowKey: 'win_keepalive_restart_2'
    });
    const portR2 = await serverRestart2.start();

    // Trigger poll tick on disconnected client; should catch failure, reset serverPort, and re-discover Server 2
    await reconnectClient.pollTick();

    assert.strictEqual(reconnectClient.serverPort, portR2, 'Client should have auto-rediscovered and bound to Server 2 port');

    // Verify heartbeat works against new server port
    const hbNewServer = await reconnectClient.sendHeartbeatPing();
    assert.strictEqual(hbNewServer, true, 'Heartbeat ping should succeed on newly discovered port');

    reconnectClient.stop();
    await serverRestart2.stop();
    console.log('  -> Passed: Client automatically probed and reconnected to new server port after failure.');

    console.log('\n========================================================================');
    console.log('✅ ALL PHASE 01 BACKGROUND KEEP-ALIVE & STALE THRESHOLD TESTS PASSED!');
    console.log('========================================================================\n');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runPhase01BackgroundKeepaliveTests().catch(err => {
  console.error('Phase 01 Test Suite Failed:', err);
  process.exit(1);
});
