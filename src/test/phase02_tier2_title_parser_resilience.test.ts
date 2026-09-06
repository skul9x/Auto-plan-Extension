// Self-healing ESM require guard for JSDOM in Node < 20.19 CommonJS
if (!process.env.__PHASE02_TIER2_REEXEC__) {
  try {
    require('jsdom');
  } catch (e: any) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      const { execFileSync } = require('child_process');
      const env = {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-require-module`.trim(),
        __PHASE02_TIER2_REEXEC__: '1'
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
      commands: {
        executeCommand: async (_cmd: string, ..._args: any[]) => undefined
      },
      window: {
        showWarningMessage: (_msg: string) => undefined
      },
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue
        })
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
import { JSDOM } from 'jsdom';

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
  console.log('================================================================');
  console.log('🧪 Phase 02: Tier 2 Position-Agnostic Title Parser Resilience');
  console.log('================================================================\n');

  const domBridge = loadDomBridge();
  const { parseWorkspaceFromTitleString, detectWorkspaceName } = domBridge;

  assert.strictEqual(
    typeof parseWorkspaceFromTitleString,
    'function',
    'parseWorkspaceFromTitleString should be exported as a function'
  );

  // --------------------------------------------------------------------------
  // Test 1: Antigravity IDE layout (Auto-plan-Extension-main - Antigravity IDE - body1.txt)
  // --------------------------------------------------------------------------
  console.log('▶ Test 1: Antigravity IDE layout (Workspace - App - File)...');
  {
    const title = 'Auto-plan-Extension-main - Antigravity IDE - body1.txt';
    const ws = parseWorkspaceFromTitleString(title);
    assert.strictEqual(ws, 'Auto-plan-Extension-main', 'Should resolve workspace from Antigravity IDE layout');
    console.log('  ✓ Antigravity IDE layout correctly resolved.');
  }

  // --------------------------------------------------------------------------
  // Test 2: Standard VS Code layout (body1.txt - Auto-plan-Extension-main - Visual Studio Code)
  // --------------------------------------------------------------------------
  console.log('▶ Test 2: Standard VS Code layout (File - Workspace - App)...');
  {
    const title = 'body1.txt - Auto-plan-Extension-main - Visual Studio Code';
    const ws = parseWorkspaceFromTitleString(title);
    assert.strictEqual(ws, 'Auto-plan-Extension-main', 'Should resolve workspace from standard VS Code layout');
    console.log('  ✓ Standard VS Code layout correctly resolved.');
  }

  // --------------------------------------------------------------------------
  // Test 3: No-editor layout (EV-Plus-main - Antigravity IDE)
  // --------------------------------------------------------------------------
  console.log('▶ Test 3: No-editor layout (Workspace - App)...');
  {
    const title = 'EV-Plus-main - Antigravity IDE';
    const ws = parseWorkspaceFromTitleString(title);
    assert.strictEqual(ws, 'EV-Plus-main', 'Should resolve workspace when no editor is open');
    console.log('  ✓ No-editor layout correctly resolved.');
  }

  // --------------------------------------------------------------------------
  // Test 4: Settings open (EV-Plus-main - Antigravity IDE - Auto-Plan Settings)
  // --------------------------------------------------------------------------
  console.log('▶ Test 4: Settings open (Workspace - App - Auto-Plan Settings)...');
  {
    // Test 4a: Direct title parsing without doc
    const title = 'EV-Plus-main - Antigravity IDE - Auto-Plan Settings';
    const wsWithoutDoc = parseWorkspaceFromTitleString(title);
    assert.strictEqual(wsWithoutDoc, 'EV-Plus-main', 'Should resolve to EV-Plus-main, filtering out Auto-Plan Settings');

    // Test 4b: Title parsing with mock DOM having active tab
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head><title>EV-Plus-main - Antigravity IDE - Auto-Plan Settings</title></head>
        <body>
          <div class="tabs-and-actions-container">
            <div class="tab active">
              <span class="label-name">Auto-Plan Settings</span>
            </div>
          </div>
          <div class="window-title">EV-Plus-main - Antigravity IDE - Auto-Plan Settings</div>
        </body>
      </html>
    `);
    const wsWithDoc = parseWorkspaceFromTitleString(title, dom.window.document);
    assert.strictEqual(wsWithDoc, 'EV-Plus-main', 'Should resolve to EV-Plus-main using active tab context');

    // Test 4c: detectWorkspaceName integration
    const detected = detectWorkspaceName(dom.window.document);
    assert.strictEqual(detected, 'EV-Plus-main', 'detectWorkspaceName should correctly resolve via DOM title');

    console.log('  ✓ Settings view successfully filtered out from title.');
  }

  // --------------------------------------------------------------------------
  // Test 5: Multi-root workspace (TramsacEV (Workspace) - Antigravity IDE - main.ts)
  // --------------------------------------------------------------------------
  console.log('▶ Test 5: Multi-root workspace with (Workspace) suffix...');
  {
    const title = 'TramsacEV (Workspace) - Antigravity IDE - main.ts';
    const ws = parseWorkspaceFromTitleString(title);
    assert.strictEqual(ws, 'TramsacEV', 'Should strip (Workspace) tag and return clean workspace name');

    // Also test square brackets [Workspace]
    const titleBracket = 'TramsacEV [Workspace] - Antigravity IDE - main.ts';
    const wsBracket = parseWorkspaceFromTitleString(titleBracket);
    assert.strictEqual(wsBracket, 'TramsacEV', 'Should strip [Workspace] tag and return clean workspace name');

    console.log('  ✓ (Workspace) and [Workspace] suffix normalization passed.');
  }

  // --------------------------------------------------------------------------
  // Test 6: Dirty state (● EV-Plus-main - Antigravity IDE - phase-02.md)
  // --------------------------------------------------------------------------
  console.log('▶ Test 6: Dirty state indicator (● Workspace - App - File)...');
  {
    const title = '● EV-Plus-main - Antigravity IDE - phase-02.md';
    const ws = parseWorkspaceFromTitleString(title);
    assert.strictEqual(ws, 'EV-Plus-main', 'Should strip dirty dot prefix and resolve EV-Plus-main');

    const titleAsterisk = '* EV-Plus-main - Antigravity IDE - phase-02.md';
    const wsAsterisk = parseWorkspaceFromTitleString(titleAsterisk);
    assert.strictEqual(wsAsterisk, 'EV-Plus-main', 'Should strip asterisk dirty marker and resolve EV-Plus-main');

    console.log('  ✓ Dirty state prefix stripping passed.');
  }

  // --------------------------------------------------------------------------
  // Test 7: Empty window (Untitled-1 - Antigravity IDE)
  // --------------------------------------------------------------------------
  console.log('▶ Test 7: Empty window with untitled buffer (Untitled-1 - Antigravity IDE)...');
  {
    const title = 'Untitled-1 - Antigravity IDE';
    const ws = parseWorkspaceFromTitleString(title);
    assert.strictEqual(ws, '', 'Should return empty string "" for untitled window without workspace');

    const titleBare = 'Antigravity IDE';
    const wsBare = parseWorkspaceFromTitleString(titleBare);
    assert.strictEqual(wsBare, '', 'Should return empty string "" for bare app window title');

    // Edge cases: null, undefined, empty string, non-string
    assert.strictEqual(parseWorkspaceFromTitleString(null), '', 'Null input must return empty string');
    assert.strictEqual(parseWorkspaceFromTitleString(undefined), '', 'Undefined input must return empty string');
    assert.strictEqual(parseWorkspaceFromTitleString(''), '', 'Empty string input must return empty string');
    assert.strictEqual(parseWorkspaceFromTitleString(123 as any), '', 'Non-string input must return empty string');

    console.log('  ✓ Empty window and input edge cases correctly returned empty string.');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL Phase 02 Tier 2 Title Parser Resilience Tests PASSED!');
  console.log('================================================================\n');
}

// Support both Mocha runner and standalone node execution
const isMochaRunning = typeof (global as any).describe === 'function';
if (isMochaRunning) {
  (global as any).describe('Phase 02: Tier 2 Position-Agnostic Title Parser Resilience', function (this: any) {
    if (this && typeof this.timeout === 'function') {
      this.timeout(15000);
    }
    (global as any).it('executes full Phase 02 title parser resilience test suite', async () => {
      await runTests();
    });
  });
} else {
  runTests().catch(err => {
    console.error('\n❌ Test failed with error:', err);
    process.exit(1);
  });
}
