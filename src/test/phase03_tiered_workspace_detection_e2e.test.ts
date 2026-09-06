// Self-healing ESM require guard for JSDOM in Node < 20.19 CommonJS
if (!process.env.__PHASE03_TIERED_E2E_REEXEC__) {
  try {
    require('jsdom');
  } catch (e: any) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      const { execFileSync } = require('child_process');
      const env = {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-require-module`.trim(),
        __PHASE03_TIERED_E2E_REEXEC__: '1'
      };
      try {
        execFileSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
          stdio: 'inherit',
          env
        });
        process.exit(0);
      } catch (err: any) {
        process.exit(err.status || 1);
      }
    }
    throw e;
  }
}

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

declare const describe: any;
declare const it: any;

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import { JSDOM } from 'jsdom';
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
          // keep as string
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

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Phase 03: Tiered Workspace Detection End-to-End Integration');
  console.log('================================================================\n');

  const domBridge = loadDomBridge();
  const {
    detectWorkspaceName,
    extractWorkspaceFromExplorerDOM,
    parseWorkspaceFromTitleString,
    DomBridgeClient
  } = domBridge;

  assert.strictEqual(
    typeof detectWorkspaceName,
    'function',
    'detectWorkspaceName should be exported as a function'
  );
  assert.strictEqual(
    typeof DomBridgeClient,
    'function',
    'DomBridgeClient should be exported as a constructor/class'
  );

  // Load real DOM snapshot from body2.txt
  const body2Path = path.resolve(process.cwd(), 'body2.txt');
  assert.ok(fs.existsSync(body2Path), 'body2.txt must exist in workspace root');
  const body2Html = fs.readFileSync(body2Path, 'utf8');

  // --------------------------------------------------------------------------
  // Test 1: Full DOM fixture simulated from body2.txt evaluates to Auto-plan-Extension-main
  // --------------------------------------------------------------------------
  console.log('▶ Test 1: Full DOM fixture from body2.txt evaluates to Auto-plan-Extension-main...');
  {
    const dom = new JSDOM(body2Html);
    const doc = dom.window.document;

    // Verify Tier 1 can directly extract from Explorer section
    const tier1Ws = extractWorkspaceFromExplorerDOM(doc);
    assert.strictEqual(
      tier1Ws,
      'Auto-plan-Extension-main',
      'Tier 1 must extract "Auto-plan-Extension-main" from body2.txt Explorer DOM'
    );

    // Verify detectWorkspaceName cascade returns Auto-plan-Extension-main via Tier 1
    const detected = detectWorkspaceName(doc);
    assert.strictEqual(
      detected,
      'Auto-plan-Extension-main',
      'detectWorkspaceName must return "Auto-plan-Extension-main" for body2.txt'
    );
    console.log('  ✓ Full DOM fixture correctly detected workspace via Tier 1.');
  }

  // --------------------------------------------------------------------------
  // Test 2: Explorer hidden/collapsed falls back to Tier 2 and Tier 3
  // --------------------------------------------------------------------------
  console.log('▶ Test 2: Explorer hidden/collapsed falls back through Tier 2 & Tier 3...');
  {
    // 2a: Hidden sidebar in body2.txt DOM -> Tier 1 yields "", Tier 2 catches .window-title
    const domHidden = new JSDOM(body2Html);
    const docHidden = domHidden.window.document;
    const sidebar = docHidden.querySelector('#workbench\\.parts\\.sidebar, .part.sidebar') as any;
    assert.ok(sidebar, 'Sidebar element must exist in body2 DOM');
    sidebar.classList.add('hidden');
    sidebar.style.display = 'none';

    assert.strictEqual(
      extractWorkspaceFromExplorerDOM(docHidden),
      '',
      'Tier 1 must return "" when sidebar is hidden'
    );

    const detectedHidden = detectWorkspaceName(docHidden);
    assert.strictEqual(
      detectedHidden,
      'Auto-plan-Extension-main',
      'detectWorkspaceName must fall back to Tier 2 (.window-title) and return "Auto-plan-Extension-main"'
    );

    // 2b: Collapsed pane header -> Tier 1 yields "", Tier 2 catches .window-title
    const domCollapsed = new JSDOM(body2Html);
    const docCollapsed = domCollapsed.window.document;
    const paneHeader = docCollapsed.querySelector('.pane-header');
    assert.ok(paneHeader, 'Pane header must exist in body2 DOM');
    paneHeader.setAttribute('aria-expanded', 'false');
    paneHeader.classList.add('collapsed');

    assert.strictEqual(
      extractWorkspaceFromExplorerDOM(docCollapsed),
      '',
      'Tier 1 must return "" when pane header is collapsed'
    );

    const detectedCollapsed = detectWorkspaceName(docCollapsed);
    assert.strictEqual(
      detectedCollapsed,
      'Auto-plan-Extension-main',
      'detectWorkspaceName must fall back to Tier 2 when Explorer header is collapsed'
    );

    // 2c: Entire sidebar removed, .window-title removed, but doc.title present -> Tier 2 fallback
    const domTitleOnly = new JSDOM('<!DOCTYPE html><html><head><title>MyProject - Antigravity IDE - file.ts</title></head><body></body></html>');
    const detectedTitleOnly = detectWorkspaceName(domTitleOnly.window.document);
    assert.strictEqual(
      detectedTitleOnly,
      'MyProject',
      'detectWorkspaceName must fall back to doc.title when Explorer and .window-title are missing'
    );

    // 2d: Bare window without workspace -> Safe Tier 3 fallback returning ""
    const domBare = new JSDOM('<!DOCTYPE html><html><head><title>Antigravity IDE</title></head><body><div class="window-title">Antigravity IDE</div></body></html>');
    const detectedBare = detectWorkspaceName(domBare.window.document);
    assert.strictEqual(
      detectedBare,
      '',
      'detectWorkspaceName must return "" (Tier 3 fallback) for bare app window without workspace'
    );

    console.log('  ✓ Cascading fallback behavior across Tier 1, Tier 2, and Tier 3 verified.');
  }

  // --------------------------------------------------------------------------
  // Test 3: Live BridgeServer instance accepts DomBridgeClient probe without 409 mismatch
  // --------------------------------------------------------------------------
  console.log('▶ Test 3: Live BridgeServer and DomBridgeClient e2e port discovery...');
  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-p03-tiered-'));
  const portRegistryPath = path.join(tempBaseDir, 'ag-autoplan-ports.json');
  const wsPath = path.join(tempBaseDir, 'Auto-plan-Extension-main');
  fs.mkdirSync(wsPath, { recursive: true });

  const testServer = new BridgeServer({
    portStart: 49750,
    portEnd: 49770,
    workspaceName: 'Auto-plan-Extension-main',
    workspacePath: wsPath,
    portsRegistryPath: portRegistryPath,
    staleClientMs: 5000
  });

  try {
    const serverPort = await testServer.start();
    console.log(`  ✓ BridgeServer started on port ${serverPort} bound to "Auto-plan-Extension-main"`);

    const clientFetch = async (url: string, opts: any = {}) => {
      const parsedUrl = new URL(url);
      const res = await httpRequest(
        {
          hostname: parsedUrl.hostname,
          port: parseInt(parsedUrl.port, 10),
          path: parsedUrl.pathname + parsedUrl.search,
          method: opts.method || 'GET',
          headers: opts.headers || {}
        },
        opts.body
      );
      return {
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        json: async () => res.body
      };
    };

    // Client using real DOM from body2.txt
    const dom = new JSDOM(body2Html);
    const client = new DomBridgeClient({
      portStart: serverPort,
      portEnd: serverPort,
      windowKey: 'win_p03_real_dom',
      document: dom.window.document,
      fetch: clientFetch
    });

    // Detect workspace from client
    const clientDetectedWs = client.detectWorkspaceName();
    assert.strictEqual(
      clientDetectedWs,
      'Auto-plan-Extension-main',
      'Client must detect "Auto-plan-Extension-main" from customDocument'
    );

    // Discover port
    const discoveredPort = await client.discoverPort();
    assert.strictEqual(
      discoveredPort,
      serverPort,
      'DomBridgeClient must successfully discover and bind to BridgeServer port'
    );

    // Verify heartbeat ping works
    const pingOk = await client.sendHeartbeatPing();
    assert.strictEqual(pingOk, true, 'DomBridgeClient heartbeat ping must succeed');

    const serverStatus = testServer.getStatus();
    assert.strictEqual(
      serverStatus.activeWindowKey,
      'win_p03_real_dom',
      'Server activeWindowKey must match client windowKey'
    );
    assert.strictEqual(
      serverStatus.workspaceName,
      'Auto-plan-Extension-main',
      'Server workspaceName must match "Auto-plan-Extension-main"'
    );
    console.log('  ✓ DomBridgeClient connected to BridgeServer smoothly without 409 workspace-mismatch.');

    // Verify that another client with mismatching workspace is rejected with 409
    const mismatchClientDom = new JSDOM('<!DOCTYPE html><html><head><title>OtherProject - Antigravity IDE</title></head><body><div class="window-title">OtherProject - Antigravity IDE</div></body></html>');
    const mismatchClient = new DomBridgeClient({
      portStart: serverPort,
      portEnd: serverPort,
      windowKey: 'win_p03_mismatch',
      document: mismatchClientDom.window.document,
      fetch: clientFetch
    });

    let mismatchDiscoveredPort: number | null = null;
    try {
      mismatchDiscoveredPort = await mismatchClient.discoverPort();
    } catch (_) {}

    assert.notStrictEqual(
      mismatchDiscoveredPort,
      serverPort,
      'Client with mismatching workspace "OtherProject" must not bind to "Auto-plan-Extension-main" server'
    );
    console.log('  ✓ Port isolation verified: mismatching workspace was correctly rejected.');

    // ------------------------------------------------------------------------
    // Test 4: Empty workspace client (Tier 3 fallback) discovery handling
    // ------------------------------------------------------------------------
    console.log('▶ Test 4: Empty workspace (Tier 3 fallback) discovery handling...');
    const emptyServer = new BridgeServer({
      portStart: 49780,
      portEnd: 49790,
      workspaceName: 'AnyWorkspace',
      workspacePath: wsPath,
      portsRegistryPath: portRegistryPath,
      staleClientMs: 5000
    });
    const emptyServerPort = await emptyServer.start();

    try {
      const emptyDom = new JSDOM('<!DOCTYPE html><html><head><title>Antigravity IDE</title></head><body></body></html>');
      const emptyClient = new DomBridgeClient({
        portStart: emptyServerPort,
        portEnd: emptyServerPort,
        windowKey: 'win_p03_empty_ws',
        document: emptyDom.window.document,
        fetch: clientFetch
      });

      assert.strictEqual(emptyClient.detectWorkspaceName(), '', 'Empty DOM must yield empty workspace');

      // Probe without workspace param
      const probeRes = await httpRequest({
        hostname: '127.0.0.1',
        port: emptyServerPort,
        path: `/autoplan-status?probe=1&windowKey=win_p03_empty_ws`,
        method: 'GET'
      });
      assert.strictEqual(probeRes.statusCode, 200, 'Probe from client with no workspace param must return 200');

      // DomBridgeClient.prototype.discoverPort() should bind cleanly without workspaceName requirement
      const discoveredEmptyPort = await emptyClient.discoverPort();
      assert.strictEqual(discoveredEmptyPort, emptyServerPort, 'Empty workspace client should bind to available BridgeServer');
      console.log('  ✓ Empty workspace probe and discovery handled cleanly without workspace parameter.');
    } finally {
      await emptyServer.stop();
    }
  } finally {
    await testServer.stop();
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log('\n================================================================');
  console.log('🎉 ALL Phase 03 Tiered Detection E2E Integration Tests PASSED!');
  console.log('================================================================\n');
}

// Support both Mocha runner and standalone node execution
const isMochaRunning = typeof (global as any).describe === 'function';
if (isMochaRunning) {
  (global as any).describe('Phase 03: Tiered Workspace Detection End-to-End Integration', function (this: any) {
    if (this && typeof this.timeout === 'function') {
      this.timeout(15000);
    }
    (global as any).it('executes full Phase 03 tiered workspace detection e2e integration test suite', async () => {
      await runTests();
    });
  });
} else {
  runTests().catch(err => {
    console.error('\n❌ Test failed with error:', err);
    process.exit(1);
  });
}
