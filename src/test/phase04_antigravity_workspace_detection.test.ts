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

// Load autoplan-dom-bridge.js dynamically
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

async function runTests() {
  console.log('=== [TEST] Antigravity IDE Workspace Detection & Handshake Suite ===\n');

  const domBridge = loadDomBridge();
  const { parseWorkspaceFromTitleString, detectWorkspaceName } = domBridge;

  assert.strictEqual(typeof parseWorkspaceFromTitleString, 'function', 'parseWorkspaceFromTitleString must be exported as a function');
  assert.strictEqual(typeof detectWorkspaceName, 'function', 'detectWorkspaceName must be exported as a function');

  console.log('--- Test Group 1: parseWorkspaceFromTitleString Title Variations ---');

  // Test 1: Real-world Antigravity IDE title from all2.txt / user screenshot
  {
    const title = 'EV-Plus-main - Antigravity IDE - phase-01-focus-mode-20kw.md';
    const parsed = parseWorkspaceFromTitleString(title);
    console.log(`  1. Antigravity with open phase file: "${title}" -> "${parsed}"`);
    assert.strictEqual(parsed, 'EV-Plus-main', 'Must extract EV-Plus-main as workspace name');
  }

  // Test 2: Real-world Antigravity IDE title from all.txt
  {
    const title = 'Auto-plan-Extension-main - Antigravity IDE - README.md';
    const parsed = parseWorkspaceFromTitleString(title);
    console.log(`  2. Antigravity with README: "${title}" -> "${parsed}"`);
    assert.strictEqual(parsed, 'Auto-plan-Extension-main', 'Must extract Auto-plan-Extension-main as workspace name');
  }

  // Test 3: Antigravity IDE when Settings tab is active
  {
    const title = 'EV-Plus-main - Antigravity IDE - Auto-Plan Settings';
    const parsed = parseWorkspaceFromTitleString(title);
    console.log(`  3. Antigravity with Settings tab: "${title}" -> "${parsed}"`);
    assert.strictEqual(parsed, 'EV-Plus-main', 'Must extract EV-Plus-main and ignore Auto-Plan Settings tab');
  }

  // Test 4: Antigravity IDE without any active editor
  {
    const title = 'EV-Plus-main - Antigravity IDE';
    const parsed = parseWorkspaceFromTitleString(title);
    console.log(`  4. Antigravity with no open editor: "${title}" -> "${parsed}"`);
    assert.strictEqual(parsed, 'EV-Plus-main', 'Must extract EV-Plus-main when no editor is open');
  }

  // Test 5: Dirty dot indicator prefix
  {
    const title = '● EV-Plus-main - Antigravity IDE - phase-01-focus-mode-20kw.md';
    const parsed = parseWorkspaceFromTitleString(title);
    console.log(`  5. Dirty indicator dot: "${title}" -> "${parsed}"`);
    assert.strictEqual(parsed, 'EV-Plus-main', 'Must handle leading bullet dot cleanly');
  }

  // Test 6: Standard VS Code title format: [File] - [Workspace] - [AppName]
  {
    const title = 'phase-01-focus-mode-20kw.md - EV-Plus-main - Visual Studio Code';
    const parsed = parseWorkspaceFromTitleString(title);
    console.log(`  6. Standard VS Code format: "${title}" -> "${parsed}"`);
    assert.strictEqual(parsed, 'EV-Plus-main', 'Must extract EV-Plus-main in standard VS Code layout');
  }

  // Test 7: Standard VS Code format without open editor
  {
    const title = 'EV-Plus-main - Visual Studio Code';
    const parsed = parseWorkspaceFromTitleString(title);
    console.log(`  7. VS Code with no open editor: "${title}" -> "${parsed}"`);
    assert.strictEqual(parsed, 'EV-Plus-main', 'Must extract EV-Plus-main in VS Code layout without file');
  }

  // Test 8: Cursor IDE title format
  {
    const title = 'phase-01.md - EV-Plus-main - Cursor';
    const parsed = parseWorkspaceFromTitleString(title);
    console.log(`  8. Cursor IDE layout: "${title}" -> "${parsed}"`);
    assert.strictEqual(parsed, 'EV-Plus-main', 'Must extract EV-Plus-main in Cursor layout');
  }

  // Test 9: VSCodium title format
  {
    const title = 'phase-01.md - EV-Plus-main - VSCodium';
    const parsed = parseWorkspaceFromTitleString(title);
    console.log(`  9. VSCodium layout: "${title}" -> "${parsed}"`);
    assert.strictEqual(parsed, 'EV-Plus-main', 'Must extract EV-Plus-main in VSCodium layout');
  }

  console.log('\n--- Test Group 2: detectWorkspaceName DOM Traversal & Fallback ---');

  // Test 10: DOM with Custom Titlebar (.window-title present like in all.txt)
  {
    const mockDoc = {
      querySelector: (selector: string) => {
        if (selector === '.window-title' || selector.includes('window-title')) {
          return { textContent: 'Auto-plan-Extension-main - Antigravity IDE - README.md' };
        }
        return null;
      },
      title: 'Auto-plan-Extension-main - Antigravity IDE - README.md'
    };
    const detected = detectWorkspaceName(mockDoc);
    console.log(`  10. DOM .window-title detection: "${detected}"`);
    assert.strictEqual(detected, 'Auto-plan-Extension-main', 'Must resolve from .window-title');
  }

  // Test 11: DOM with Native Titlebar (no .window-title element, title in doc.title like in all2.txt)
  {
    const mockDoc = {
      querySelector: () => null,
      title: 'EV-Plus-main - Antigravity IDE - phase-01-focus-mode-20kw.md'
    };
    const detected = detectWorkspaceName(mockDoc);
    console.log(`  11. Native titlebar doc.title detection: "${detected}"`);
    assert.strictEqual(detected, 'EV-Plus-main', 'Must resolve from doc.title when .window-title is absent');
  }

  // Test 12: DOM with Settings tab active falling back to Explorer Section Header
  {
    const mockDoc = {
      title: 'Auto-Plan Settings',
      querySelector: (selector: string) => {
        if (selector.includes('Explorer Section:')) {
          return {
            getAttribute: (attr: string) => (attr === 'aria-label' ? 'Explorer Section: EV-Plus-main' : null)
          };
        }
        return null;
      }
    };
    const detected = detectWorkspaceName(mockDoc);
    console.log(`  12. Settings tab fallback to Explorer Section: "${detected}"`);
    assert.strictEqual(detected, 'EV-Plus-main', 'Must resolve from Explorer Section when title is non-workspace tab');
  }

  // Test 13: DOM with Settings tab active falling back to Agent Sidepanel Header (from all2.txt line 2980)
  {
    const mockDoc = {
      title: 'Auto-Plan Settings',
      querySelector: (selector: string) => {
        if (selector === '#conversation .text-lg.font-medium') {
          return { textContent: 'EV-Plus-main' };
        }
        return null;
      }
    };
    const detected = detectWorkspaceName(mockDoc);
    console.log(`  13. Settings tab fallback to Agent Header: "${detected}"`);
    assert.strictEqual(detected, 'EV-Plus-main', 'Must resolve from Agent Sidepanel header when title is non-workspace tab');
  }

  console.log('\n--- Test Group 3: Bridge Server Handshake Verification ---');

  // Test 14: Verify BridgeServer accepts probe when client passes resolved workspace name
  {
    const testPortStart = 48895;
    const server = new BridgeServer({
      portStart: testPortStart,
      portEnd: 48905,
      workspaceName: 'EV-Plus-main',
      workspacePath: '/home/skul9x/Desktop/Test_Code/EV-Plus-main'
    });

    await server.start();

    try {
      // Send HTTP probe with the detected workspace name: EV-Plus-main
      const response = await new Promise<{ statusCode: number; data: any }>((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${server.getPort()}/autoplan-status?probe=1&windowKey=dom_win_test_123&workspaceName=EV-Plus-main&forceRebind=1`,
          (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
              try {
                resolve({ statusCode: res.statusCode || 0, data: JSON.parse(body) });
              } catch (e) {
                reject(e);
              }
            });
          }
        );
        req.on('error', reject);
      });

      console.log(`  14. BridgeServer probe status with "EV-Plus-main": HTTP ${response.statusCode}`);
      assert.strictEqual(response.statusCode, 200, 'BridgeServer must return HTTP 200 OK for matched workspace');
      assert.strictEqual(response.data.workspaceName, 'EV-Plus-main');
      assert.strictEqual(response.data.isCompatible, true);
      assert.strictEqual(response.data.bindRejected, false);

      // Verify case-insensitive match also succeeds
      const caseInsensitiveResponse = await new Promise<{ statusCode: number; data: any }>((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${server.getPort()}/autoplan-status?probe=1&windowKey=dom_win_test_123&workspaceName=ev-plus-main&forceRebind=1`,
          (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
              try {
                resolve({ statusCode: res.statusCode || 0, data: JSON.parse(body) });
              } catch (e) {
                reject(e);
              }
            });
          }
        );
        req.on('error', reject);
      });

      console.log(`  15. BridgeServer probe status with case-insensitive "ev-plus-main": HTTP ${caseInsensitiveResponse.statusCode}`);
      assert.strictEqual(caseInsensitiveResponse.statusCode, 200, 'BridgeServer must return HTTP 200 OK for case-insensitive workspace match');

      // Verify alien workspace is still properly rejected with 409
      const alienResponse = await new Promise<{ statusCode: number; data: any }>((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${server.getPort()}/autoplan-status?probe=1&windowKey=dom_win_test_456&workspaceName=completely-different-project&forceRebind=1`,
          (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
              try {
                resolve({ statusCode: res.statusCode || 0, data: JSON.parse(body) });
              } catch (e) {
                reject(e);
              }
            });
          }
        );
        req.on('error', reject);
      });

      console.log(`  16. Alien workspace rejection check: HTTP ${alienResponse.statusCode}`);
      assert.strictEqual(alienResponse.statusCode, 409, 'BridgeServer must still return HTTP 409 Conflict for alien workspace');
      assert.strictEqual(alienResponse.data.bindRejected, true);

    } finally {
      await server.stop();
    }
  }

  console.log('\n✅ ALL TESTS PASSED! Antigravity IDE workspace detection & handshake verified.');
}

runTests().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
