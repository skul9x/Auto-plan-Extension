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
import {
  BridgeServer,
  PORT_REGISTRY_FILENAME,
  BridgeCommandAck
} from '../bridgeServer';

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

async function runPhase02Tests() {
  console.log('=== Running Phase 02: Bridge Server & Dispatch Protocol Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase02-bridge-'));
  const customPortsRegistryPath = path.join(tempDir, PORT_REGISTRY_FILENAME);

  try {
    // ----------------------------------------------------------------------
    // Test 1: Server Lifecycle & Dynamic Port Allocation
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying server lifecycle and dynamic port auto-incrementing...');
    
    const server1 = new BridgeServer({
      portStart: 48860,
      portEnd: 48870,
      portsRegistryPath: customPortsRegistryPath,
      windowKey: 'win_test_1'
    });

    const port1 = await server1.start();
    assert.strictEqual(server1.isListening(), true, 'Server 1 should be listening');
    assert.strictEqual(port1 >= 48860 && port1 <= 48870, true, `Port ${port1} out of range`);
    assert.strictEqual(server1.getPort(), port1, 'getPort() should match start() return');

    // Start a second server in the same range; it should auto-increment to avoid EADDRINUSE
    const server2 = new BridgeServer({
      portStart: 48860,
      portEnd: 48870,
      portsRegistryPath: customPortsRegistryPath,
      windowKey: 'win_test_2'
    });

    const port2 = await server2.start();
    assert.strictEqual(server2.isListening(), true, 'Server 2 should be listening');
    assert.strictEqual(port2, port1 + 1, 'Server 2 should bind to the next available port');

    await server2.stop();
    assert.strictEqual(server2.isListening(), false, 'Server 2 should be stopped');
    assert.strictEqual(server2.getPort(), null, 'Server 2 getPort() should be null after stop');

    console.log(`  -> Passed: Server lifecycle and dynamic port increment verified (ports: ${port1}, ${port2}).`);

    // ----------------------------------------------------------------------
    // Test 2: CORS & Preflight OPTIONS Handling
    // ----------------------------------------------------------------------
    console.log('\n[Test 2] Verifying CORS headers and OPTIONS preflight...');

    const preflightRes = await httpRequest({
      hostname: '127.0.0.1',
      port: port1,
      path: '/autoplan-status',
      method: 'OPTIONS',
      headers: {
        'Origin': 'vscode-file://vscode-app',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type, X-Window-Key'
      }
    });

    assert.strictEqual(preflightRes.statusCode, 204, 'OPTIONS preflight should return 204');
    assert.strictEqual(preflightRes.headers['access-control-allow-origin'], '*', 'CORS Allow-Origin must be *');
    assert.ok(
      String(preflightRes.headers['access-control-allow-methods']).includes('OPTIONS'),
      'CORS Allow-Methods must include OPTIONS'
    );
    assert.ok(
      String(preflightRes.headers['access-control-allow-headers']).includes('X-Window-Key'),
      'CORS Allow-Headers must include X-Window-Key'
    );

    console.log('  -> Passed: CORS preflight request handled with required headers.');

    // ----------------------------------------------------------------------
    // Test 3: Handshake, Heartbeat & Port Registry Persistence
    // ----------------------------------------------------------------------
    console.log('\n[Test 3] Verifying heartbeat telemetry and port registry persistence...');

    // Test heartbeat endpoint
    const heartbeatRes = await httpRequest({
      hostname: '127.0.0.1',
      port: port1,
      path: '/autoplan-heartbeat',
      method: 'GET',
      headers: {
        'X-Window-Key': 'win_test_1'
      }
    });

    assert.strictEqual(heartbeatRes.statusCode, 200, 'Heartbeat endpoint should return 200');
    assert.strictEqual(heartbeatRes.body.status, 'ok', 'Heartbeat status should be ok');
    assert.strictEqual(heartbeatRes.body.serverPort, port1, 'Heartbeat serverPort should match');

    // Test port registry reading
    assert.strictEqual(fs.existsSync(customPortsRegistryPath), true, 'ag-autoplan-ports.json must exist');
    const registryData = BridgeServer.readPortRegistry(customPortsRegistryPath);
    assert.ok(registryData !== null, 'Registry data should be parsed');
    assert.ok(registryData!.ports[String(port1)] !== undefined, 'Registry should have entry for port1');
    assert.strictEqual(registryData!.ports[String(port1)].windowKey, 'win_test_1', 'Registry entry windowKey must match');

    console.log('  -> Passed: Heartbeat and port discovery registry verified.');

    // ----------------------------------------------------------------------
    // Test 4: Command Dispatching & Acknowledgment Flow
    // ----------------------------------------------------------------------
    console.log('\n[Test 4] Verifying command dispatch and DOM client ACK...');

    const promptText = 'Refactor the authentication flow to use OAuth2 PKCE';
    const dispatchPromise = server1.dispatchPromptCommand(promptText, {
      timeoutMs: 4000,
      windowKey: 'win_test_1'
    });

    // Simulate DOM client polling status
    const statusRes = await httpRequest({
      hostname: '127.0.0.1',
      port: port1,
      path: '/autoplan-status?windowKey=win_test_1',
      method: 'GET'
    });

    assert.strictEqual(statusRes.statusCode, 200, 'Status poll should return 200');
    assert.ok(Array.isArray(statusRes.body.pendingCommands), 'pendingCommands should be an array');
    assert.strictEqual(statusRes.body.pendingCommands.length, 1, 'Should have 1 pending command');

    const receivedCmd = statusRes.body.pendingCommands[0];
    assert.strictEqual(receivedCmd.text, promptText, 'Dispatched command text should match');
    assert.strictEqual(receivedCmd.type, 'sendPrompt', 'Command type should default to sendPrompt');

    // Simulate DOM client submitting ACK
    const ackPayload: BridgeCommandAck = {
      commandId: receivedCmd.id,
      status: 'submitClicked',
      windowKey: 'win_test_1',
      metadata: {
        charsInjected: promptText.length,
        buttonSelector: '.interactive-input-submit'
      }
    };

    const ackRes = await httpRequest({
      hostname: '127.0.0.1',
      port: port1,
      path: '/autoplan-ack',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, ackPayload);

    assert.strictEqual(ackRes.statusCode, 200, 'Ack POST should return 200');

    // Await the dispatched command promise and assert result
    const dispatchResult = await dispatchPromise;
    assert.strictEqual(dispatchResult.success, true, 'Dispatch result should be success');
    assert.strictEqual(dispatchResult.status, 'submitClicked', 'Status should match client ACK');
    assert.strictEqual(dispatchResult.commandId, receivedCmd.id, 'Command ID should match');
    assert.ok(dispatchResult.durationMs >= 0, 'Duration should be recorded');
    assert.strictEqual(dispatchResult.metadata?.charsInjected, promptText.length, 'Metadata should be passed through');

    console.log(`  -> Passed: Command dispatched and acknowledged in ${dispatchResult.durationMs}ms.`);

    // ----------------------------------------------------------------------
    // Test 5: Command Timeout Handling
    // ----------------------------------------------------------------------
    console.log('\n[Test 5] Verifying graceful timeout when DOM client does not respond...');

    let timeoutError: Error | null = null;
    try {
      await server1.dispatchPromptCommand('This command should time out', {
        timeoutMs: 300,
        windowKey: 'win_test_1'
      });
    } catch (err: any) {
      timeoutError = err;
    }

    assert.ok(timeoutError !== null, 'dispatchPromptCommand should reject on timeout');
    assert.ok(
      timeoutError!.message.includes('timed out after 300ms'),
      `Error message should contain timeout info: ${timeoutError!.message}`
    );

    console.log('  -> Passed: Timeout error handled gracefully.');

    // ----------------------------------------------------------------------
    // Test 6: Multi-Window Isolation
    // ----------------------------------------------------------------------
    console.log('\n[Test 6] Verifying multi-window isolation and command routing...');

    // Dispatch command targeted specifically to win_test_1
    const isolatedPrompt = 'Command exclusively for Window 1';
    const isolatedPromise = server1.dispatchPromptCommand(isolatedPrompt, {
      timeoutMs: 3000,
      windowKey: 'win_test_1'
    });

    // Window 2 polls server1; should NOT receive Window 1's pending command
    const window2PollRes = await httpRequest({
      hostname: '127.0.0.1',
      port: port1,
      path: '/autoplan-status?windowKey=win_test_2',
      method: 'GET'
    });

    assert.strictEqual(window2PollRes.statusCode, 200);
    assert.strictEqual(
      window2PollRes.body.bindRejected,
      true,
      'Window 2 should be flagged with bindRejected due to owner mismatch'
    );
    assert.strictEqual(
      window2PollRes.body.pendingCommands.length,
      0,
      'Window 2 should not receive Window 1 pending commands'
    );

    // Window 1 polls server1; should receive its command
    const window1PollRes = await httpRequest({
      hostname: '127.0.0.1',
      port: port1,
      path: '/autoplan-status?windowKey=win_test_1',
      method: 'GET'
    });

    assert.strictEqual(window1PollRes.statusCode, 200);
    assert.strictEqual(window1PollRes.body.bindRejected, false);
    assert.strictEqual(window1PollRes.body.pendingCommands.length, 1);
    assert.strictEqual(window1PollRes.body.pendingCommands[0].text, isolatedPrompt);

    // Ack from Window 1 to clean up
    await httpRequest({
      hostname: '127.0.0.1',
      port: port1,
      path: '/autoplan-ack',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      commandId: window1PollRes.body.pendingCommands[0].id,
      status: 'completed',
      windowKey: 'win_test_1'
    });

    const isolatedResult = await isolatedPromise;
    assert.strictEqual(isolatedResult.success, true);

    console.log('  -> Passed: Multi-window isolation verified.');

    // Clean up server1
    await server1.stop();

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 02 BRIDGE SERVER & PROTOCOL TESTS PASSED!');
  console.log('======================================================\n');
}

runPhase02Tests().catch((err) => {
  console.error('Phase 02 Test Suite Failed:', err);
  process.exit(1);
});
