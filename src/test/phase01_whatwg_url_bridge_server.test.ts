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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { BridgeServer, PORT_REGISTRY_FILENAME } from '../bridgeServer';

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
          // keep raw
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

async function runPhase01WhatwgUrlTests() {
  console.log('=== Running Phase 01: WHATWG URL Migration & DEP0169 Remediation Test ===\n');

  // 1. Install warning listener to catch DEP0169 or any DeprecationWarning
  const warningsEmitted: Error[] = [];
  const warningListener = (warning: Error) => {
    warningsEmitted.push(warning);
    console.warn(`[Emitted Warning] Name: ${warning.name}, Code: ${(warning as any).code}, Message: ${warning.message}`);
  };
  process.on('warning', warningListener);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase01-url-'));
  const customPortsRegistryPath = path.join(tempDir, PORT_REGISTRY_FILENAME);

  const server = new BridgeServer({
    portStart: 49100,
    portEnd: 49150,
    portsRegistryPath: customPortsRegistryPath
  });

  try {
    // 2. Start server
    console.log('[Step 1] Starting BridgeServer on ephemeral loopback port...');
    const port = await server.start();
    assert.strictEqual(server.isListening(), true, 'BridgeServer should be listening');
    console.log(`BridgeServer started on port ${port}`);

    // 3. GET /autoplan-status?windowKey=test-win-1&probe=1
    console.log('[Step 2] Sending GET /autoplan-status?windowKey=test-win-1&probe=1...');
    const resProbe = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-status?windowKey=test-win-1&probe=1',
      method: 'GET'
    });
    assert.strictEqual(resProbe.statusCode, 200, 'GET probe status should return 200');
    assert.strictEqual(typeof resProbe.body, 'object', 'Probe response should be JSON object');
    assert.strictEqual(resProbe.body.service, 'autoplan-bridge-server', 'Service name should match');
    assert.strictEqual(resProbe.body.activeWindowKey, null, 'Active window key should not bind on probe');

    // 4. GET /autoplan-status?windowKey=test-win-2
    console.log('[Step 3] Sending GET /autoplan-status?windowKey=test-win-2...');
    const resStatus = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-status?windowKey=test-win-2',
      method: 'GET'
    });
    assert.strictEqual(resStatus.statusCode, 200, 'GET status should return 200');
    assert.strictEqual(resStatus.body.activeWindowKey, 'test-win-2', 'Active window key should be bound to test-win-2');

    // 5. GET /autoplan-heartbeat with x-window-key header
    console.log('[Step 4] Sending GET /autoplan-heartbeat with x-window-key header...');
    const resHeartbeat = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-heartbeat',
      method: 'GET',
      headers: {
        'x-window-key': 'test-win-2'
      }
    });
    assert.strictEqual(resHeartbeat.statusCode, 200, 'Heartbeat should return 200');
    assert.strictEqual(resHeartbeat.body.status, 'ok', 'Heartbeat status should be ok');

    // Dispatch a command so we can test POST /autoplan-ack
    console.log('[Step 5] Dispatching prompt command to test POST /autoplan-ack...');
    const dispatchPromise = server.dispatchPromptCommand('Test message for ack', {
      windowKey: 'test-win-2',
      timeoutMs: 3000
    });

    // Client fetches pending command
    const resFetch = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-status?windowKey=test-win-2',
      method: 'GET'
    });
    assert.strictEqual(resFetch.body.pendingCommands.length, 1, 'Should have 1 pending command');
    const fetchedCommandId = resFetch.body.pendingCommands[0].id;

    // 6. POST /autoplan-ack with payload
    console.log(`[Step 6] Sending POST /autoplan-ack for command ${fetchedCommandId}...`);
    const resAck = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-ack',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, {
      commandId: fetchedCommandId,
      status: 'completed',
      windowKey: 'test-win-2',
      metadata: { steps: ['injected', 'submitted'] }
    });
    assert.strictEqual(resAck.statusCode, 200, 'Ack should return 200');
    assert.strictEqual(resAck.body.success, true, 'Ack should be successful');

    const ackResult = await dispatchPromise;
    assert.strictEqual(ackResult.success, true, 'Dispatch promise should resolve successfully');
    assert.strictEqual(ackResult.status, 'completed', 'ACK status should be completed');

    // 7. POST /autoplan-log with logs
    console.log('[Step 7] Sending POST /autoplan-log...');
    const resLog = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-log',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, {
      windowKey: 'test-win-2',
      logs: [
        { level: 'INFO', component: 'CLIENT', message: 'Test log message 1' },
        { level: 'DEBUG', component: 'DOM', message: 'Test log message 2' }
      ]
    });
    assert.strictEqual(resLog.statusCode, 200, 'Log POST should return 200');
    assert.strictEqual(resLog.body.success, true, 'Log response should be success');
    assert.strictEqual(resLog.body.accepted, 2, 'Should have accepted 2 log lines');

    // 8. GET /unknown-path (verifying 404 response structure)
    console.log('[Step 8] Sending GET /unknown-path...');
    const res404 = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/unknown-path?foo=bar',
      method: 'GET'
    });
    assert.strictEqual(res404.statusCode, 404, 'Unknown path should return 404');
    assert.strictEqual(res404.body.error, 'Not found', 'Should return Not found error message');
    assert.strictEqual(res404.body.pathname, '/unknown-path', 'Should return parsed pathname');

    // 9. Check DEP0169 or legacy url deprecation warnings
    console.log('[Step 9] Checking for Node.js DEP0169 deprecation warnings...');
    const dep0169Warnings = warningsEmitted.filter((w) => {
      return (w as any).code === 'DEP0169' || (w.message && w.message.includes('DEP0169')) || (w.message && w.message.includes('url.parse()'));
    });
    assert.strictEqual(dep0169Warnings.length, 0, `DEP0169 deprecation warning was emitted: ${JSON.stringify(dep0169Warnings.map(w => w.message))}`);
    console.log('Zero DEP0169 deprecation warnings emitted.');

    console.log('\n✅ All Phase 01 WHATWG URL tests passed successfully!');
  } finally {
    process.removeListener('warning', warningListener);
    await server.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

runPhase01WhatwgUrlTests().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
