// Self-healing ESM require guard for JSDOM in Node < 20.19 CommonJS
if (!process.env.__PHASE01_TIER1_REEXEC__) {
  try {
    require('jsdom');
  } catch (e: any) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      const { execFileSync } = require('child_process');
      const env = {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-require-module`.trim(),
        __PHASE01_TIER1_REEXEC__: '1'
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
  console.log('🧪 Phase 01: Tier 1 DOM Explorer Extraction & Tab Exclusion');
  console.log('================================================================\n');

  const domBridge = loadDomBridge();
  const { extractWorkspaceFromExplorerDOM, getActiveEditorOrTabNames } = domBridge;

  assert.strictEqual(
    typeof extractWorkspaceFromExplorerDOM,
    'function',
    'extractWorkspaceFromExplorerDOM should be exported as a function'
  );
  assert.strictEqual(
    typeof getActiveEditorOrTabNames,
    'function',
    'getActiveEditorOrTabNames should be exported as a function'
  );

  // --------------------------------------------------------------------------
  // Test 1: Extract workspace name correctly from standard aria-label
  // --------------------------------------------------------------------------
  console.log('▶ Test 1: Extract workspace name correctly from standard aria-label...');
  {
    // Test 1a: Standard VS Code / Antigravity Explorer header
    const dom1 = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="workbench.parts.sidebar" class="part sidebar">
            <div class="composite viewlet explorer-viewlet">
              <div class="pane-header expanded" tabindex="0" role="button" aria-label="Explorer Section: Auto-plan-Extension-main" aria-expanded="true">
                <h3 class="title" aria-label="Explorer Section: Auto-plan-Extension-main">Auto-plan-Extension-main</h3>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);
    const ws1 = extractWorkspaceFromExplorerDOM(dom1.window.document);
    assert.strictEqual(ws1, 'Auto-plan-Extension-main', 'Should extract "Auto-plan-Extension-main" from aria-label');

    // Test 1b: Only aria-label without title element child
    const dom2 = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div class="pane-header" aria-label="Explorer Section: MySpecialApp" aria-expanded="true"></div>
        </body>
      </html>
    `);
    const ws2 = extractWorkspaceFromExplorerDOM(dom2.window.document);
    assert.strictEqual(ws2, 'MySpecialApp', 'Should extract "MySpecialApp" directly from aria-label');

    // Test 1c: Multi-root workspace with (Workspace) suffix
    const dom3 = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div class="pane-header" aria-label="Explorer Section: TramsacEV (Workspace)" aria-expanded="true">
            <h3 class="title">TramsacEV (Workspace)</h3>
          </div>
        </body>
      </html>
    `);
    const ws3 = extractWorkspaceFromExplorerDOM(dom3.window.document);
    assert.strictEqual(ws3, 'TramsacEV', 'Should strip (Workspace) suffix and return "TramsacEV"');

    console.log('  ✓ Standard aria-label extraction and workspace suffix cleaning passed.');
  }

  // --------------------------------------------------------------------------
  // Test 2: Extract workspace name from .pane-header .title element inside explorer
  // --------------------------------------------------------------------------
  console.log('▶ Test 2: Extract workspace name from .pane-header .title inside explorer...');
  {
    // Test 2a: Explorer folders view with pane-header title
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div class="explorer-folders-view">
            <div class="pane-header" aria-expanded="true">
              <h3 class="title">Custom-Project-Core</h3>
            </div>
          </div>
        </body>
      </html>
    `);
    const ws = extractWorkspaceFromExplorerDOM(dom.window.document);
    assert.strictEqual(ws, 'Custom-Project-Core', 'Should extract workspace name from secondary selector .explorer-folders-view .pane-header .title');

    // Test 2b: Generic sections (Outline, Timeline, Open Editors, Explorer) should be ignored
    const genericDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div class="pane-header" aria-expanded="true">
            <h3 class="title">Outline</h3>
          </div>
          <div class="pane-header" aria-expanded="true">
            <h3 class="title">Timeline</h3>
          </div>
        </body>
      </html>
    `);
    const genericWs = extractWorkspaceFromExplorerDOM(genericDom.window.document);
    assert.strictEqual(genericWs, '', 'Generic section names must return empty string');

    console.log('  ✓ Explorer header .title extraction and generic system filtering passed.');
  }

  // --------------------------------------------------------------------------
  // Test 3: Return empty string gracefully when Explorer sidebar is collapsed, hidden, or absent
  // --------------------------------------------------------------------------
  console.log('▶ Test 3: Return empty string gracefully when sidebar is collapsed, hidden, or absent...');
  {
    // Test 3a: Completely absent explorer
    const emptyDom = new JSDOM(`<!DOCTYPE html><html><body><div class="editor"></div></body></html>`);
    const wsAbsent = extractWorkspaceFromExplorerDOM(emptyDom.window.document);
    assert.strictEqual(wsAbsent, '', 'Should return empty string when explorer is absent');

    // Test 3b: Pane header collapsed (aria-expanded="false" and class="collapsed")
    const collapsedDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div class="pane-header collapsed" aria-label="Explorer Section: Auto-plan-Extension-main" aria-expanded="false">
            <h3 class="title">Auto-plan-Extension-main</h3>
          </div>
        </body>
      </html>
    `);
    const wsCollapsed = extractWorkspaceFromExplorerDOM(collapsedDom.window.document);
    assert.strictEqual(wsCollapsed, '', 'Should return empty string when pane header is collapsed');

    // Test 3c: Sidebar container hidden (style="display: none;")
    const hiddenSidebarDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="workbench.parts.sidebar" class="part sidebar" style="display: none;">
            <div class="pane-header expanded" aria-label="Explorer Section: Auto-plan-Extension-main" aria-expanded="true">
              <h3 class="title">Auto-plan-Extension-main</h3>
            </div>
          </div>
        </body>
      </html>
    `);
    const wsHidden = extractWorkspaceFromExplorerDOM(hiddenSidebarDom.window.document);
    assert.strictEqual(wsHidden, '', 'Should return empty string when sidebar has display: none');

    // Test 3d: Sidebar with aria-hidden="true"
    const ariaHiddenSidebarDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="workbench.parts.sidebar" class="part sidebar" aria-hidden="true">
            <div class="pane-header expanded" aria-label="Explorer Section: Auto-plan-Extension-main" aria-expanded="true">
              <h3 class="title">Auto-plan-Extension-main</h3>
            </div>
          </div>
        </body>
      </html>
    `);
    const wsAriaHidden = extractWorkspaceFromExplorerDOM(ariaHiddenSidebarDom.window.document);
    assert.strictEqual(wsAriaHidden, '', 'Should return empty string when sidebar is aria-hidden');

    // Test 3e: Non-DOM object or null
    assert.strictEqual(extractWorkspaceFromExplorerDOM(null), '', 'Null doc must return empty string');
    assert.strictEqual(extractWorkspaceFromExplorerDOM({}), '', 'Plain object doc must return empty string');

    console.log('  ✓ Collapsed, hidden, and absent explorer edge cases correctly returned empty string.');
  }

  // --------------------------------------------------------------------------
  // Test 4: getActiveEditorOrTabNames correctly collects .tab.active and system views
  // --------------------------------------------------------------------------
  console.log('▶ Test 4: getActiveEditorOrTabNames correctly collects .tab.active and system screens...');
  {
    // Test 4a: System view names present even without active tabs
    const emptyDom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`);
    const emptyNames = getActiveEditorOrTabNames(emptyDom.window.document);
    assert.ok(Array.isArray(emptyNames), 'Should return an array');
    assert.ok(emptyNames.includes('Auto-Plan Settings'), 'Should include "Auto-Plan Settings"');
    assert.ok(emptyNames.includes('Settings'), 'Should include "Settings"');
    assert.ok(emptyNames.includes('Welcome'), 'Should include "Welcome"');
    assert.ok((emptyNames as any).has('Auto-Plan Settings'), '.has() should return true for system view');

    // Test 4b: Active editor tab and breadcrumbs present
    const editorDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div class="tabs-and-actions-container">
            <div class="tab active" aria-selected="true">
              <span class="label-name">● body1.txt</span>
            </div>
            <div class="tab">
              <span class="label-name">inactive.ts</span>
            </div>
          </div>
          <div class="breadcrumbs-control">
            <span class="monaco-breadcrumb-item last">body1.txt</span>
          </div>
        </body>
      </html>
    `);

    const names = getActiveEditorOrTabNames(editorDom.window.document);
    assert.ok(names.includes('body1.txt'), 'Should collect and normalize "body1.txt" (stripping dirty bullet)');
    assert.ok(!names.includes('inactive.ts'), 'Should NOT collect inactive tab name');
    assert.ok((names as any).has('body1.txt'), '.has("body1.txt") should return true');
    assert.ok((names as any).has('BODY1.TXT'), '.has() should be case-insensitive');
    assert.ok((names as any).has('Auto-Plan Settings'), 'System view name should still be present');

    // Test 4c: Safe execution on null or empty input
    const nullNames = getActiveEditorOrTabNames(null);
    assert.ok(Array.isArray(nullNames), 'Should return array on null input');
    assert.ok((nullNames as any).has('Auto-Plan Settings'), 'Should retain system views on null input');

    console.log('  ✓ Active editor tabs, breadcrumb items, and system views correctly collected.');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL Phase 01 Tier 1 Explorer & Tab Exclusion Tests PASSED!');
  console.log('================================================================\n');
}

// Support both Mocha runner and standalone node execution
const isMochaRunning = typeof (global as any).describe === 'function';
if (isMochaRunning) {
  (global as any).describe('Phase 01: Tier 1 DOM Explorer Extraction & Active Tab Exclusion', function (this: any) {
    if (this && typeof this.timeout === 'function') {
      this.timeout(15000);
    }
    (global as any).it('executes full Phase 01 explorer detection and exclusion test suite', async () => {
      await runTests();
    });
  });
} else {
  runTests().catch(err => {
    console.error('\n❌ Test failed with error:', err);
    process.exit(1);
  });
}
