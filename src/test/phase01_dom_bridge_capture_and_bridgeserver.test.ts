// Standalone mock for 'vscode' module if run directly via Node / Mocha
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          {
            name: 'Auto-plan-Extension-main',
            uri: { fsPath: '/test/Auto-plan-Extension-main' }
          }
        ],
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue
        })
      },
      commands: {
        executeCommand: async (_cmd: string, ..._args: any[]) => undefined
      },
      window: {
        showWarningMessage: (_msg: string) => undefined,
        showInformationMessage: (_msg: string) => undefined,
        showErrorMessage: (_msg: string) => undefined
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
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

async function runPhase01Tests() {
  console.log('=================================================================');
  console.log('Phase 01 Verification: DOM Bridge Capture & BridgeServer Streaming');
  console.log('=================================================================\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge.DomBridgeClient, 'DomBridgeClient must be exported');
  assert.ok(domBridge.BridgeClient, 'BridgeClient alias must be exported');
  assert.strictEqual(domBridge.BridgeClient, domBridge.DomBridgeClient, 'BridgeClient should alias DomBridgeClient');

  // --------------------------------------------------------------------------
  // Test Case 1: readJsonBody payload limit & flood protection
  // --------------------------------------------------------------------------
  console.log('▶ Test 1: readJsonBody payload limit and flood safety threshold...');
  {
    const server = new BridgeServer({ portStart: 48870, portEnd: 48875 });

    // 1a. Accept 2.5MB payload without calling req.destroy()
    const largePayload = {
      type: 'testPayload',
      content: 'A'.repeat(2.5 * 1024 * 1024)
    };
    const jsonString = JSON.stringify(largePayload);
    assert.ok(jsonString.length > 2 * 1024 * 1024, 'Payload must be > 2MB');

    const mockReq = new EventEmitter() as any;
    let destroyed = false;
    mockReq.destroy = () => {
      destroyed = true;
    };

    const readPromise = new Promise<{ err: Error | null; data?: any }>((resolve) => {
      (server as any).readJsonBody(mockReq, (err: Error | null, data?: any) => {
        resolve({ err, data });
      });
    });

    // Feed in 64KB chunks
    const chunkSize = 64 * 1024;
    for (let i = 0; i < jsonString.length; i += chunkSize) {
      mockReq.emit('data', jsonString.slice(i, i + chunkSize));
    }
    mockReq.emit('end');

    const { err, data } = await readPromise;
    assert.strictEqual(err, null, '2.5MB payload must parse without error');
    assert.strictEqual(destroyed, false, 'req.destroy() must NOT be called for 2.5MB payload');
    assert.strictEqual(data?.type, 'testPayload');
    assert.strictEqual(data?.content?.length, largePayload.content.length);
    console.log('  ✓ Verified: readJsonBody accepted 2.5MB JSON payload without socket termination.');

    // 1b. Payload exceeding 20MB triggers req.destroy()
    const floodReq = new EventEmitter() as any;
    let floodDestroyed = false;
    floodReq.destroy = () => {
      floodDestroyed = true;
    };

    (server as any).readJsonBody(floodReq, () => {});

    // Feed chunks totaling > 20MB (e.g. 21MB)
    const chunk10MB = 'B'.repeat(10 * 1024 * 1024);
    floodReq.emit('data', chunk10MB);
    assert.strictEqual(floodDestroyed, false, 'Should not destroy at 10MB');
    floodReq.emit('data', chunk10MB);
    assert.strictEqual(floodDestroyed, false, 'Should not destroy at 20MB exactly');
    floodReq.emit('data', 'B'.repeat(1024 * 1024)); // now 21MB
    assert.strictEqual(floodDestroyed, true, 'Should call req.destroy() once payload exceeds 20MB limit');
    console.log('  ✓ Verified: readJsonBody triggers req.destroy() when incoming payload exceeds 20MB.');
  }

  // --------------------------------------------------------------------------
  // Test Case 2: DomBridgeClient / BridgeClient captureWorkbenchDom handler
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 2: DomBridgeClient handleCommand for captureWorkbenchDom...');
  {
    const expectedHtml = '<!DOCTYPE html><html lang="en"><head><title>VSCode Workbench</title></head><body><div id="workbench.main.container"><span>Workbench Content</span></div></body></html>';
    const mockWindow = {
      location: {
        href: 'vscode-workbench://local/window/test'
      }
    };
    const mockDocument = {
      documentElement: {
        outerHTML: expectedHtml
      },
      location: {
        href: 'vscode-workbench://local/window/test'
      }
    };

    let ackSent: any = null;
    const client = new domBridge.DomBridgeClient({
      document: mockDocument,
      window: mockWindow,
      serverPort: 48870,
      fetchFn: async (_url: string, opts: any) => {
        ackSent = JSON.parse(opts.body);
        return { ok: true, status: 200 };
      }
    });

    // 2a. Successful capture
    const testCmd = {
      id: 'cmd_capture_123',
      type: 'captureWorkbenchDom',
      timeoutMs: 5000,
      createdAt: Date.now()
    };

    await client.handleCommand(testCmd);

    assert.ok(ackSent, 'Client must call sendAck');
    assert.strictEqual(ackSent.commandId, 'cmd_capture_123');
    assert.strictEqual(ackSent.status, 'completed');
    assert.strictEqual(ackSent.error, undefined);
    assert.ok(ackSent.metadata, 'ACK must include metadata');
    assert.strictEqual(ackSent.metadata.html, expectedHtml);
    assert.strictEqual(ackSent.metadata.url, 'vscode-workbench://local/window/test');
    assert.strictEqual(ackSent.metadata.byteLength, Buffer.byteLength(expectedHtml, 'utf8'));
    assert.ok(typeof ackSent.metadata.timestamp === 'number', 'Timestamp must be a number');
    console.log('  ✓ Verified: captureWorkbenchDom returns completed ACK with HTML, byteLength, URL, and timestamp.');

    // 2b. Inaccessible documentElement returns explicit error ACK
    ackSent = null;
    const brokenClient = new domBridge.DomBridgeClient({
      document: { documentElement: null },
      window: mockWindow,
      serverPort: 48870,
      fetchFn: async (_url: string, opts: any) => {
        ackSent = JSON.parse(opts.body);
        return { ok: true, status: 200 };
      }
    });

    await brokenClient.handleCommand({
      id: 'cmd_capture_broken',
      type: 'captureWorkbenchDom'
    });

    assert.ok(ackSent, 'Client must send error ACK');
    assert.strictEqual(ackSent.commandId, 'cmd_capture_broken');
    assert.strictEqual(ackSent.status, 'error');
    assert.ok(ackSent.error.includes('inaccessible'), `Error message should mention inaccessible, got: ${ackSent.error}`);
    console.log('  ✓ Verified: Inaccessible documentElement returns explicit error ACK.');

    // 2c. outerHTML getter throws exception
    ackSent = null;
    const throwingDoc = {
      get documentElement() {
        throw new Error('Simulated DOM access violation');
      }
    };
    const throwingClient = new domBridge.DomBridgeClient({
      document: throwingDoc,
      window: mockWindow,
      serverPort: 48870,
      fetchFn: async (_url: string, opts: any) => {
        ackSent = JSON.parse(opts.body);
        return { ok: true, status: 200 };
      }
    });

    await throwingClient.handleCommand({
      id: 'cmd_capture_throw',
      type: 'captureWorkbenchDom'
    });

    assert.ok(ackSent, 'Client must send error ACK on exception');
    assert.strictEqual(ackSent.commandId, 'cmd_capture_throw');
    assert.strictEqual(ackSent.status, 'error');
    assert.ok(ackSent.error.includes('Simulated DOM access violation'));
    console.log('  ✓ Verified: Exception during DOM capture is caught and returns error ACK.');
  }

  // --------------------------------------------------------------------------
  // Test Case 3: Live BridgeServer.captureDomSnapshot() e2e dispatch and resolution
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 3: BridgeServer.captureDomSnapshot() e2e dispatch and resolution...');
  {
    const server = new BridgeServer({
      portStart: 48871,
      portEnd: 48880,
      windowKey: 'win_test_live'
    });

    const boundPort = await server.start();
    console.log(`  - BridgeServer started on port ${boundPort}`);

    const expectedHtml = '<html><head><title>Workbench Snapshot</title></head><body><main>Live DOM Content</main></body></html>';
    const mockDocument = {
      documentElement: {
        outerHTML: expectedHtml
      },
      location: {
        href: 'vscode-workbench://local/window/test'
      }
    };
    const mockWindow = {
      location: {
        href: 'vscode-workbench://local/window/test'
      }
    };

    const client = new domBridge.DomBridgeClient({
      portStart: boundPort,
      portEnd: boundPort,
      windowKey: 'win_test_live',
      document: mockDocument,
      window: mockWindow,
      fetchFn: async (url: string, opts: any = {}) => {
        return new Promise((resolve, reject) => {
          const parsed = new URL(url);
          const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            method: opts.method || 'GET',
            headers: opts.headers || {}
          }, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
              resolve({
                ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
                status: res.statusCode || 200,
                json: async () => JSON.parse(body || '{}'),
                text: async () => body
              });
            });
          });
          req.on('error', reject);
          if (opts.body) {
            req.write(opts.body);
          }
          req.end();
        });
      }
    });

    // Trigger initial client poll tick to register client with BridgeServer
    client.isRunning = true;
    await client.pollTick();
    const activeClients = server.getConnectedClients();
    assert.strictEqual(activeClients.length, 1, 'Client should be registered with BridgeServer');

    // Launch background poll loop for client so it receives and answers commands
    let stopPolling = false;
    const pollingLoop = (async () => {
      while (!stopPolling) {
        await client.pollTick();
        await new Promise(r => setTimeout(r, 50));
      }
    })();

    const snapshotResult = await server.captureDomSnapshot(5000);
    stopPolling = true;
    await pollingLoop;

    assert.strictEqual(snapshotResult.success, true, 'captureDomSnapshot should succeed');
    assert.strictEqual(snapshotResult.html, expectedHtml, 'Captured HTML must match mock document outerHTML');
    console.log('  ✓ Verified: BridgeServer.captureDomSnapshot() dispatched command and resolved HTML successfully.');

    await server.stop();
    console.log('  - BridgeServer stopped.');
  }

  // --------------------------------------------------------------------------
  // Test Case 4: Graceful handling of missing clients, stopped server, and timeouts
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 4: Graceful failure handling (missing client, unstarted server, timeout)...');
  {
    // 4a. Unstarted server
    const unstartedServer = new BridgeServer({ portStart: 48881, portEnd: 48885 });
    const res1 = await unstartedServer.captureDomSnapshot(1000);
    assert.strictEqual(res1.success, false);
    assert.ok(res1.error?.includes('not listening'), `Error should state not listening, got: ${res1.error}`);
    console.log('  ✓ Verified: Unstarted server returns { success: false, error: "BridgeServer is not listening" }.');

    // 4b. Server listening but 0 connected clients
    const serverNoClients = new BridgeServer({ portStart: 48881, portEnd: 48885 });
    await serverNoClients.start();

    const res2 = await serverNoClients.captureDomSnapshot(1000);
    assert.strictEqual(res2.success, false);
    assert.ok(res2.error?.includes('No active connected DOM bridge clients'), `Error should mention no active clients, got: ${res2.error}`);
    console.log('  ✓ Verified: Server with no active clients returns { success: false, error: "No active connected DOM bridge clients found" }.');

    // 4c. Client registered but times out without sending ACK
    // Simulate active client registration via probe
    const mockProbeRes = {
      writeHead: () => {},
      end: () => {}
    } as any;
    serverNoClients.handleStatus('win_silent_client', { probe: '1' }, mockProbeRes);
    assert.strictEqual(serverNoClients.getConnectedClients().length, 1, 'Client should now be recognized as active');

    const timeoutStart = Date.now();
    const res3 = await serverNoClients.captureDomSnapshot(300); // 300ms timeout
    const timeoutDuration = Date.now() - timeoutStart;

    assert.strictEqual(res3.success, false);
    assert.ok(res3.error?.includes('timed out'), `Error should mention timeout, got: ${res3.error}`);
    assert.ok(timeoutDuration >= 280, `Should have waited at least timeout duration, waited ${timeoutDuration}ms`);
    console.log('  ✓ Verified: Timeout returns { success: false, error } without unhandled promise rejection.');

    await serverNoClients.stop();
  }

  console.log('\n=================================================================');
  console.log('✔ ALL PHASE 01 TESTS PASSED SUCCESSFULLY');
  console.log('=================================================================');
}

runPhase01Tests().catch((err) => {
  console.error('\n✖ PHASE 01 TEST FAILED:', err);
  process.exit(1);
});
