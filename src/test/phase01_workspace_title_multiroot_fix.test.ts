// Self-healing ESM require guard for JSDOM in Node < 20.19 CommonJS
if (!process.env.__PHASE01_WORKSPACE_REEXEC__) {
  try {
    require('jsdom');
  } catch (e: any) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      const { execFileSync } = require('child_process');
      const env = {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-require-module`.trim(),
        __PHASE01_WORKSPACE_REEXEC__: '1'
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
        workspaceFolders: [
          {
            name: 'Auto-plan-Extension-main',
            uri: { fsPath: '/test/Auto-plan-Extension-main' }
          }
        ],
        name: 'Untitled (Workspace)',
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue
        })
      },
      window: {
        showWarningMessage: () => undefined,
        showInformationMessage: () => undefined,
        showErrorMessage: () => undefined
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { JSDOM } from 'jsdom';
import { BridgeServer } from '../bridgeServer';
import { verifyConversationOwnershipAsync, ConversationOwnershipCriteria } from '../transcriptWatcher';

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
  url: string,
  options: http.RequestOptions = {}
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        let body = raw;
        try {
          body = JSON.parse(raw);
        } catch {}
        resolve({ statusCode: res.statusCode || 0, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('=== [TEST] Workspace Title & Multi-Root Detection Test Suite ===\n');
  const bridge = loadDomBridge();
  const { parseWorkspaceFromTitleString, detectWorkspaceName } = bridge;

  // --- Group 1: Title Parsing & Workspace Suffix Normalization ---
  console.log('--- Test Group 1: parseWorkspaceFromTitleString & Normalization ---');

  // 1. Untitled Workspace title from real workspace.txt
  const rawTitle1 = 'Untitled (Workspace) - Antigravity IDE - phase-05-compose-ui-localization.md';
  const parsed1 = parseWorkspaceFromTitleString(rawTitle1);
  assert.strictEqual(parsed1, 'Untitled', `Expected "Untitled", got "${parsed1}"`);
  console.log('  1. Strips (Workspace) from Untitled Workspace title: PASS');

  // 2. Named Workspace with (Workspace) suffix
  const rawTitle2 = 'MyProject (Workspace) - Antigravity IDE - main.ts';
  const parsed2 = parseWorkspaceFromTitleString(rawTitle2);
  assert.strictEqual(parsed2, 'MyProject', `Expected "MyProject", got "${parsed2}"`);
  console.log('  2. Strips (Workspace) from named Workspace: PASS');

  // 3. VS Code format with (Workspace) suffix
  const rawTitle3 = 'main.ts - MyProject (Workspace) - Visual Studio Code';
  const parsed3 = parseWorkspaceFromTitleString(rawTitle3);
  assert.strictEqual(parsed3, 'MyProject', `Expected "MyProject", got "${parsed3}"`);
  console.log('  3. VS Code layout with (Workspace) suffix: PASS');

  // 4. Standard single folder title without suffix
  const rawTitle4 = 'EV-Plus-main - Antigravity IDE - phase-01.md';
  const parsed4 = parseWorkspaceFromTitleString(rawTitle4);
  assert.strictEqual(parsed4, 'EV-Plus-main', `Expected "EV-Plus-main", got "${parsed4}"`);
  console.log('  4. Standard single folder title: PASS');

  // --- Group 2: DOM detectWorkspaceName with Multi-Root Explorer Tree ---
  console.log('\n--- Test Group 2: detectWorkspaceName with DOM Explorer Tree ---');

  // 5. Exact DOM structure from workspace.txt: window-title has Untitled (Workspace),
  // but Explorer monaco-list-row contains rootfolder-icon with "AI_Novel-main"
  const domHtmlFromSnapshot = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Untitled (Workspace) - Antigravity IDE - phase-05-compose-ui-localization.md</title>
      </head>
      <body>
        <div class="window-title">Untitled (Workspace) - Antigravity IDE - phase-05-compose-ui-localization.md</div>
        <div class="explorer-folders-view">
          <div class="monaco-list-row" aria-label="AI_Novel-main">
            <div class="monaco-icon-label rootfolder-icon explorer-item" aria-label="~/Desktop/Code/AI_Novel-main">
              <a class="label-name"><span class="monaco-highlighted-label">AI_Novel-main</span></a>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
  const dom1 = new JSDOM(domHtmlFromSnapshot);
  const detectedWs1 = detectWorkspaceName(dom1.window.document);
  assert.strictEqual(detectedWs1, 'AI_Novel-main', `Expected "AI_Novel-main", got "${detectedWs1}"`);
  console.log('  5. Recovers concrete root folder "AI_Novel-main" from Untitled Workspace DOM: PASS');

  // 6. Native Titlebar with Untitled Workspace and root folder in DOM
  const domHtmlNative = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Untitled (Workspace) - Antigravity IDE</title>
      </head>
      <body>
        <div class="explorer-folders-view">
          <div class="monaco-list-row">
            <div class="monaco-icon-label rootfolder-icon" aria-label="/home/user/Project_Omega">
              <span class="label-name">Project_Omega</span>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
  const dom2 = new JSDOM(domHtmlNative);
  const detectedWs2 = detectWorkspaceName(dom2.window.document);
  assert.strictEqual(detectedWs2, 'Project_Omega', `Expected "Project_Omega", got "${detectedWs2}"`);
  console.log('  6. Native Titlebar Untitled Workspace falls back to root folder "Project_Omega": PASS');

  // 7. Regular single folder window
  const domHtmlSingle = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Auto-plan-Extension-main - Antigravity IDE - README.md</title>
      </head>
      <body>
        <div class="window-title">Auto-plan-Extension-main - Antigravity IDE - README.md</div>
      </body>
    </html>
  `;
  const dom3 = new JSDOM(domHtmlSingle);
  const detectedWs3 = detectWorkspaceName(dom3.window.document);
  assert.strictEqual(detectedWs3, 'Auto-plan-Extension-main', `Expected "Auto-plan-Extension-main", got "${detectedWs3}"`);
  console.log('  7. Single folder window detects pure workspace name: PASS');

  // --- Group 3: BridgeServer Multi-Root & Untitled Handshake ---
  console.log('\n--- Test Group 3: BridgeServer Multi-Root & Untitled Handshake ---');

  const testServer = new BridgeServer({
    portStart: 49100,
    portEnd: 49120,
    workspaceName: 'AI_Novel-main',
    workspaceFolders: ['AI_Novel-main', 'Secondary-Folder'],
    workspaceTitle: 'Untitled (Workspace)'
  });

  const port = await testServer.start();
  assert.ok(port >= 49100, `Expected server to start on port >= 49100, got ${port}`);
  console.log(`  BridgeServer started on port ${port}`);

  try {
    // 8. Probe with primary workspaceName
    const res1 = await httpRequest(`http://127.0.0.1:${port}/autoplan-status?probe=1&windowKey=win_1&workspaceName=AI_Novel-main`);
    assert.strictEqual(res1.statusCode, 200, `Expected 200 for primary folder, got ${res1.statusCode}`);
    console.log('  8. Probe with primary workspaceName "AI_Novel-main": HTTP 200 PASS');

    // 9. Probe with secondary workspaceFolder
    const res2 = await httpRequest(`http://127.0.0.1:${port}/autoplan-status?probe=1&windowKey=win_2&workspaceName=Secondary-Folder`);
    assert.strictEqual(res2.statusCode, 200, `Expected 200 for secondary folder, got ${res2.statusCode}`);
    console.log('  9. Probe with secondary folder "Secondary-Folder": HTTP 200 PASS');

    // 10. Probe with workspaceTitle "Untitled (Workspace)"
    const res3 = await httpRequest(`http://127.0.0.1:${port}/autoplan-status?probe=1&windowKey=win_3&workspaceName=${encodeURIComponent('Untitled (Workspace)')}`);
    assert.strictEqual(res3.statusCode, 200, `Expected 200 for Untitled (Workspace), got ${res3.statusCode}`);
    console.log('  10. Probe with workspaceTitle "Untitled (Workspace)": HTTP 200 PASS');

    // 11. Probe with stripped "Untitled"
    const res4 = await httpRequest(`http://127.0.0.1:${port}/autoplan-status?probe=1&windowKey=win_4&workspaceName=Untitled`);
    assert.strictEqual(res4.statusCode, 200, `Expected 200 for "Untitled", got ${res4.statusCode}`);
    console.log('  11. Probe with stripped title "Untitled": HTTP 200 PASS');

    // 12. Probe with Alien workspace should be rejected with 409
    const resAlien = await httpRequest(`http://127.0.0.1:${port}/autoplan-status?probe=1&windowKey=win_alien&workspaceName=CompletelyDifferentApp`);
    assert.strictEqual(resAlien.statusCode, 409, `Expected 409 for Alien workspace, got ${resAlien.statusCode}`);
    console.log('  12. Probe with alien workspace correctly returns HTTP 409: PASS');
  } finally {
    await testServer.stop();
    console.log('  BridgeServer stopped cleanly');
  }

  // --- Group 4: Transcript Ownership Verification with Multi-Root ---
  console.log('\n--- Test Group 4: Transcript Ownership Multi-Root Verification ---');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-trans-'));
  const tmpTranscript = path.join(tmpDir, 'transcript.jsonl');
  fs.writeFileSync(
    tmpTranscript,
    JSON.stringify({
      step_index: 0,
      content: 'The user has 1 active workspaces: /home/skul9x/Desktop/Code/AI_Novel-main -> AI_Novel-main'
    }) + '\n'
  );

  const criteriaMultiRoot: ConversationOwnershipCriteria = {
    workspaceName: 'Untitled (Workspace)',
    workspaceFolders: ['AI_Novel-main', 'Secondary-Folder']
  };

  const isOwner = await verifyConversationOwnershipAsync(tmpTranscript, criteriaMultiRoot);
  assert.strictEqual(isOwner, true, 'Expected multi-root folders to match transcript ownership');
  console.log('  13. verifyConversationOwnershipAsync matches via workspaceFolders: PASS');

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\n========================================================');
  console.log('✅ ALL WORKSPACE TITLE & MULTI-ROOT TESTS PASSED (13/13)!');
  console.log('========================================================\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
