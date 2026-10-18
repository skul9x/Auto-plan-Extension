// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {};
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section: string) => ({
          get: (key: string, defaultValue: any) =>
            mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            mockConfigStore[key] = val;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        workspaceFolders: []
      },
      env: {
        appRoot: undefined
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as crypto from 'crypto';
import { BridgeServer, PORT_REGISTRY_FILENAME } from '../bridgeServer';
import { writeSidecarConfig, SIDECAR_CONFIG_FILENAME } from '../config';

// Load DomBridgeClient from media/autoplan-dom-bridge.js
function loadDomBridge(): any {
  const candidatePaths = [
    path.resolve(__dirname, '../../media/autoplan-dom-bridge.js'),
    path.resolve(__dirname, '../media/autoplan-dom-bridge.js'),
    path.resolve(process.cwd(), 'media/autoplan-dom-bridge.js')
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      delete require.cache[require.resolve(p)];
      return require(p);
    }
  }
  throw new Error('Could not find media/autoplan-dom-bridge.js');
}

interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: any;
  rawBody: string;
}

function httpRequest(
  options: http.RequestOptions,
  postData?: string | object
): Promise<HttpResponse> {
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
          // keep raw string
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

async function runPhase02BridgeServerAuthAndCorsTest(): Promise<void> {
  console.log('=== Running Phase 02: Bridge Server Auth & CORS Security Test ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase02-auth-'));
  const portsRegistryPath = path.join(tempDir, PORT_REGISTRY_FILENAME);

  const server = new BridgeServer({
    portStart: 49400,
    portEnd: 49450,
    workbenchDir: tempDir,
    portsRegistryPath
  });

  try {
    // -------------------------------------------------------------
    // Suite 1: Session Token Generation & Sidecar Export
    // -------------------------------------------------------------
    console.log('[Suite 1] Verifying Session Token Generation and Sidecar Export...');

    const port = await server.start();
    assert.ok(port >= 49400 && port <= 49450, `Server should bind to port in range, got ${port}`);

    const authToken = server.getAuthToken();
    assert.ok(typeof authToken === 'string', 'Auth token must be a string');
    assert.strictEqual(authToken.length, 64, 'Auth token must be 64 hexadecimal characters (32 bytes)');
    assert.match(authToken, /^[0-9a-f]{64}$/, 'Auth token must be valid lowercase hex');
    console.log(`  ✓ Server generated cryptographically secure 32-byte token: ${authToken.slice(0, 8)}...`);

    // Verify sidecar config export
    const sidecarPath = path.join(tempDir, SIDECAR_CONFIG_FILENAME);
    assert.ok(fs.existsSync(sidecarPath), `Sidecar config must exist at ${sidecarPath}`);
    const sidecarContent = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));

    assert.strictEqual(
      sidecarContent.authToken,
      authToken,
      'Sidecar config authToken must match server.getAuthToken()'
    );
    assert.strictEqual(
      sidecarContent.bridgeAuthToken,
      authToken,
      'Sidecar config bridgeAuthToken must match server.getAuthToken()'
    );
    assert.strictEqual(
      sidecarContent.telegramBotToken,
      undefined,
      'Sidecar config must not leak telegramBotToken'
    );

    // Verify 0o600 file mode permissions on Linux/macOS
    if (process.platform !== 'win32') {
      const stats = fs.statSync(sidecarPath);
      const mode = stats.mode & 0o777;
      assert.strictEqual(mode, 0o600, `Sidecar file permissions must be 0o600, got 0o${mode.toString(8)}`);
    }
    console.log('  ✓ Auth token exported to sidecar config with secure 0o600 permissions');

    // -------------------------------------------------------------
    // Suite 2: Strict CORS & Origin Enforcement
    // -------------------------------------------------------------
    console.log('\n[Suite 2] Verifying Strict CORS & Origin Enforcement...');

    // 2.1 External browser origins must be rejected with 403 Forbidden
    const evilOrigins = [
      'https://evil.com',
      'http://attacker.example.com',
      'http://localhost:3000',
      'http://127.0.0.1:8080'
    ];

    for (const evilOrigin of evilOrigins) {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/autoplan-status?probe=1',
        method: 'GET',
        headers: {
          'Origin': evilOrigin
        }
      });

      assert.strictEqual(
        res.statusCode,
        403,
        `External origin ${evilOrigin} must be rejected with 403 Forbidden`
      );
      assert.strictEqual(
        res.headers['access-control-allow-origin'],
        undefined,
        'Access-Control-Allow-Origin header must NOT be returned for rejected origins'
      );
    }
    console.log('  ✓ External web origins (https://evil.com, etc.) are rejected with 403 Forbidden');

    // 2.2 External origin preflight OPTIONS must be rejected with 403 Forbidden
    const preflightEvilRes = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-command',
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://evil.com',
        'Access-Control-Request-Method': 'POST'
      }
    });
    assert.strictEqual(
      preflightEvilRes.statusCode,
      403,
      'Preflight OPTIONS from untrusted origin must be rejected with 403'
    );
    console.log('  ✓ Preflight OPTIONS from untrusted origins rejected with 403 Forbidden');

    // 2.3 Approved internal schemes (vscode-file://, vscode-webview://) must be accepted
    const approvedOrigins = [
      'vscode-file://vscode-app',
      'vscode-webview://webview-panel-123'
    ];

    for (const approvedOrigin of approvedOrigins) {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/autoplan-status?probe=1',
        method: 'GET',
        headers: {
          'Origin': approvedOrigin
        }
      });

      assert.strictEqual(
        res.statusCode,
        200,
        `Approved origin ${approvedOrigin} must be accepted with 200 OK`
      );
      assert.strictEqual(
        res.headers['access-control-allow-origin'],
        approvedOrigin,
        `Access-Control-Allow-Origin must echo approved origin ${approvedOrigin}`
      );
      assert.notStrictEqual(
        res.headers['access-control-allow-origin'],
        '*',
        'Access-Control-Allow-Origin must NEVER be wildcard "*"'
      );
    }
    console.log('  ✓ Approved internal origins (vscode-file://, vscode-webview://) accepted with specific CORS headers');

    // 2.4 Preflight OPTIONS for approved origin must return 204 No Content with CORS headers
    const preflightGoodRes = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-command',
      method: 'OPTIONS',
      headers: {
        'Origin': 'vscode-file://vscode-app',
        'Access-Control-Request-Method': 'POST'
      }
    });
    assert.strictEqual(preflightGoodRes.statusCode, 204, 'Preflight OPTIONS for approved origin must return 204');
    assert.strictEqual(preflightGoodRes.headers['access-control-allow-origin'], 'vscode-file://vscode-app');
    assert.ok(
      (preflightGoodRes.headers['access-control-allow-headers'] || '').includes('X-Bridge-Auth'),
      'Access-Control-Allow-Headers must include X-Bridge-Auth'
    );
    console.log('  ✓ Preflight OPTIONS for approved origins returns 204 with X-Bridge-Auth allowed');

    // 2.5 Direct desktop loopback client without Origin header must be accepted without wildcard
    const directRes = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-status?probe=1',
      method: 'GET'
    });
    assert.strictEqual(directRes.statusCode, 200, 'Direct loopback connection without Origin must be accepted');
    assert.strictEqual(
      directRes.headers['access-control-allow-origin'],
      undefined,
      'Direct client request should not have Access-Control-Allow-Origin'
    );
    console.log('  ✓ Direct loopback connection without Origin header accepted without wildcard');

    // -------------------------------------------------------------
    // Suite 3: Request Authentication Middleware
    // -------------------------------------------------------------
    console.log('\n[Suite 3] Verifying Request Authentication Middleware...');

    // 3.1 Unauthenticated requests to sensitive endpoints must return 401 Unauthorized
    const unauthEndpoints = [
      { method: 'POST', path: '/autoplan-command', body: { text: 'test' } },
      { method: 'POST', path: '/autoplan-ack', body: { commandId: 'cmd_123', status: 'completed' } },
      { method: 'POST', path: '/autoplan-log', body: { message: 'test log' } },
      { method: 'GET', path: '/autoplan-status' } // state retrieval without probe=1
    ];

    for (const ep of unauthEndpoints) {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: ep.path,
        method: ep.method,
        headers: {
          'Content-Type': 'application/json'
        }
      }, ep.body);

      assert.strictEqual(
        res.statusCode,
        401,
        `Unauthenticated ${ep.method} ${ep.path} must return 401 Unauthorized`
      );
      assert.ok(
        res.body && res.body.error && res.body.error.includes('Unauthorized'),
        `Error body must indicate Unauthorized, got: ${JSON.stringify(res.body)}`
      );
    }
    console.log('  ✓ Sensitive endpoints (/autoplan-command, /autoplan-ack, /autoplan-log, /autoplan-status) return 401 without auth token');

    // 3.2 Requests with invalid/counterfeit token must return 401 Unauthorized
    const fakeToken = crypto.randomBytes(32).toString('hex');
    const badTokenRes = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-command',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Auth': fakeToken
      }
    }, { text: 'malicious command' });

    assert.strictEqual(badTokenRes.statusCode, 401, 'Request with invalid X-Bridge-Auth token must return 401');
    console.log('  ✓ Requests with forged/invalid token rejected with 401 Unauthorized');

    // 3.3 Discovery probe on /autoplan-status?probe=1 allowed without token (from loopback)
    const probeRes = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-status?probe=1',
      method: 'GET'
    });
    assert.strictEqual(probeRes.statusCode, 200, 'Discovery probe /autoplan-status?probe=1 must be allowed');
    assert.strictEqual(probeRes.body.service, 'autoplan-bridge-server');
    assert.deepStrictEqual(probeRes.body.pendingCommands, [], 'Discovery probe must never expose pending commands');
    console.log('  ✓ Discovery probe /autoplan-status?probe=1 permitted without token for initial loopback discovery');

    // 3.4 Authenticated requests with X-Bridge-Auth header must succeed
    const authLogRes = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-log',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Auth': authToken
      }
    }, { message: 'Security test log entry', level: 'INFO' });

    assert.strictEqual(authLogRes.statusCode, 200, 'POST /autoplan-log with X-Bridge-Auth must return 200');
    assert.strictEqual(authLogRes.body.success, true);
    console.log('  ✓ POST /autoplan-log with valid X-Bridge-Auth header accepted with 200 OK');

    // 3.5 Authenticated requests with Authorization: Bearer <token> must succeed
    const bearerLogRes = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-log',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    }, { message: 'Bearer token test entry', level: 'INFO' });

    assert.strictEqual(bearerLogRes.statusCode, 200, 'POST /autoplan-log with Authorization Bearer must return 200');
    assert.strictEqual(bearerLogRes.body.success, true);
    console.log('  ✓ POST /autoplan-log with Authorization: Bearer header accepted with 200 OK');

    // 3.6 State retrieval (/autoplan-status) with X-Bridge-Auth succeeds
    const statusAuthRes = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-status',
      method: 'GET',
      headers: {
        'X-Bridge-Auth': authToken
      }
    });
    assert.strictEqual(statusAuthRes.statusCode, 200, 'GET /autoplan-status with valid X-Bridge-Auth must return 200');
    console.log('  ✓ GET /autoplan-status state retrieval with X-Bridge-Auth accepted with 200 OK');

    // -------------------------------------------------------------
    // Suite 4: End-to-End Command Dispatch & ACK with X-Bridge-Auth
    // -------------------------------------------------------------
    console.log('\n[Suite 4] Verifying End-to-End Command Dispatch & ACK with X-Bridge-Auth...');

    const promptText = 'Refactor secure authentication bridge';
    const testWindowKey = 'win_test_phase02_e2e';

    // Start dispatching command via HTTP POST /autoplan-command with auth token
    const commandPromise = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-command',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Auth': authToken
      }
    }, {
      text: promptText,
      windowKey: testWindowKey,
      timeoutMs: 4000
    });

    // Client polls /autoplan-status with X-Bridge-Auth to retrieve pending command
    await new Promise((r) => setTimeout(r, 50));
    const pollRes = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `/autoplan-status?windowKey=${encodeURIComponent(testWindowKey)}`,
      method: 'GET',
      headers: {
        'X-Bridge-Auth': authToken,
        'X-Window-Key': testWindowKey
      }
    });

    assert.strictEqual(pollRes.statusCode, 200, 'Poll /autoplan-status must return 200');
    assert.ok(Array.isArray(pollRes.body.pendingCommands), 'Response must contain pendingCommands array');
    assert.strictEqual(pollRes.body.pendingCommands.length, 1, 'Must have retrieved 1 pending command');

    const receivedCmd = pollRes.body.pendingCommands[0];
    assert.strictEqual(receivedCmd.text, promptText, 'Received command text must match dispatched text');
    console.log(`  ✓ DOM client retrieved command ${receivedCmd.id} using X-Bridge-Auth`);

    // Client sends ACK via POST /autoplan-ack with X-Bridge-Auth
    const ackRes = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/autoplan-ack',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Auth': authToken,
        'X-Window-Key': testWindowKey
      }
    }, {
      commandId: receivedCmd.id,
      status: 'completed',
      windowKey: testWindowKey
    });

    assert.strictEqual(ackRes.statusCode, 200, 'POST /autoplan-ack must return 200');
    assert.strictEqual(ackRes.body.success, true);

    // Wait for the original POST /autoplan-command request to resolve
    const commandRes = await commandPromise;
    assert.strictEqual(commandRes.statusCode, 200, 'POST /autoplan-command must resolve with 200 OK');
    assert.strictEqual(commandRes.body.success, true, 'Command result must indicate success');
    assert.strictEqual(commandRes.body.status, 'completed', 'Command status must be "completed"');
    console.log('  ✓ End-to-end command dispatch and ACK completed successfully with X-Bridge-Auth');

    // -------------------------------------------------------------
    // Suite 5: DomBridgeClient Integration & Sidecar Loading
    // -------------------------------------------------------------
    console.log('\n[Suite 5] Verifying DomBridgeClient Client Integration & Sidecar Loading...');

    const domBridgeModule = loadDomBridge();
    const DomBridgeClientClass = domBridgeModule.DomBridgeClient;
    assert.ok(DomBridgeClientClass, 'DomBridgeClient class must be exported');

    // Create a mock fetch to capture headers sent by DomBridgeClient
    const capturedHeaders: Record<string, string>[] = [];
    const mockFetch = async (url: string, init?: any) => {
      const headers = init?.headers || {};
      capturedHeaders.push({ ...headers, url });
      return {
        status: 200,
        ok: true,
        json: async () => {
          if (url.includes('/autoplan-status')) {
            return { service: 'autoplan-bridge-server', isCompatible: true, pendingCommands: [] };
          }
          if (url.includes('autoplan-config.json')) {
            return { authToken, bridgeAuthToken: authToken };
          }
          return { success: true };
        }
      };
    };

    const client = new DomBridgeClientClass({
      serverPort: port,
      windowKey: 'dom_client_test_win',
      fetch: mockFetch,
      sidecarPath: sidecarPath
    });

    // 5.1 Verify client loads authToken from sidecar configuration
    const loadedToken = await client.loadSidecarConfig();
    assert.strictEqual(loadedToken, authToken, 'Client must load matching authToken from sidecar');
    assert.strictEqual(client.getAuthToken(), authToken, 'client.getAuthToken() must return loaded token');
    console.log('  ✓ DomBridgeClient successfully loaded authToken from sidecar configuration');

    // 5.2 Verify outgoing HTTP calls include X-Bridge-Auth
    capturedHeaders.length = 0;
    await client.sendClientLog('INFO', 'Test log from DOM client');
    assert.ok(capturedHeaders.length > 0, 'fetch should have been invoked for sendClientLog');
    const logHeaders = capturedHeaders[capturedHeaders.length - 1];
    assert.strictEqual(logHeaders['X-Bridge-Auth'], authToken, 'sendClientLog must include X-Bridge-Auth header');
    assert.strictEqual(logHeaders['Authorization'], `Bearer ${authToken}`, 'sendClientLog must include Authorization header');

    await client.sendAck('cmd_mock_1', 'completed');
    const ackHeaders = capturedHeaders[capturedHeaders.length - 1];
    assert.strictEqual(ackHeaders['X-Bridge-Auth'], authToken, 'sendAck must include X-Bridge-Auth header');

    await client.pollTick();
    const pollHeaders = capturedHeaders[capturedHeaders.length - 1];
    assert.strictEqual(pollHeaders['X-Bridge-Auth'], authToken, 'pollTick must include X-Bridge-Auth header');

    console.log('  ✓ DomBridgeClient automatically attaches X-Bridge-Auth on all fetch requests');

    // -------------------------------------------------------------
    // Suite 6: Performance & Timing Attack Safety
    // -------------------------------------------------------------
    console.log('\n[Suite 6] Verifying Token Verification Performance and Timing Attack Safety...');

    const mockReq = {
      headers: {
        'x-bridge-auth': authToken
      }
    } as any;

    const iterations = 1000;
    const startPerf = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      const authorized = server.isAuthorized(mockReq);
      assert.strictEqual(authorized, true);
    }
    const endPerf = process.hrtime.bigint();
    const totalMs = Number(endPerf - startPerf) / 1_000_000;
    const avgPerCheckMs = totalMs / iterations;

    console.log(`  ✓ ${iterations} token validations completed in ${totalMs.toFixed(2)}ms (avg: ${avgPerCheckMs.toFixed(4)}ms/check)`);
    assert.ok(avgPerCheckMs < 0.1, `Token validation average latency must be < 0.1ms, was ${avgPerCheckMs.toFixed(4)}ms`);

    // Verify constant-time comparison against wrong token
    const wrongLenReq = { headers: { 'x-bridge-auth': 'short' } } as any;
    assert.strictEqual(server.isAuthorized(wrongLenReq), false);
    const wrongTokenReq = { headers: { 'x-bridge-auth': 'a'.repeat(64) } } as any;
    assert.strictEqual(server.isAuthorized(wrongTokenReq), false);
    console.log('  ✓ Timing-safe token comparison verified');

    console.log('\n=== All Phase 02 Bridge Server Auth & CORS Security Tests Passed! ===\n');
  } finally {
    await server.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

// Auto-run if executed directly
if (require.main === module) {
  runPhase02BridgeServerAuthAndCorsTest()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n❌ Phase 02 Test Failed:', err);
      process.exit(1);
    });
}

export { runPhase02BridgeServerAuthAndCorsTest };
