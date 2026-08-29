// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      Uri: {
        file: (f: string) => ({ fsPath: f }),
        joinPath: (...args: any[]) => ({ fsPath: args.join('/') })
      },
      WebviewViewProvider: class {},
      window: {
        showWarningMessage: () => {},
        showInformationMessage: () => {},
        showErrorMessage: () => {}
      },
      commands: {
        executeCommand: async () => {}
      },
      workspace: {
        workspaceFolders: []
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectPhaseStatus,
  detectPhaseStatusAsync,
  scanPlanFolder,
  scanPlanFolderAsync
} from '../planScanner';
import {
  discoverWorkspacePlanFoldersAsync,
  clearPlanDiscoveryCache,
  getPlanDiscoveryCache
} from '../extension';

async function runPhase03Tests() {
  console.log('=== Running Phase 03: Async Plan Scanner & Bounded Header Read Tests ===\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-test-'));

  try {
    // ----------------------------------------------------------------------
    // Test 1: Bounded Header Read Performance & Accuracy Test
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying Bounded Header Read (5MB File with Status at Line 3)...');

    const largeFilePath = path.join(tmpDir, 'phase-01-large-file.md');
    const header = `# Phase 01: Large File Test\n\nStatus: Completed\n\n`;
    const padding = 'X'.repeat(5 * 1024 * 1024); // 5MB dummy text
    fs.writeFileSync(largeFilePath, header + padding, 'utf8');

    // Test sync detectPhaseStatus
    const syncStart = process.hrtime.bigint();
    const syncStatus = detectPhaseStatus(largeFilePath);
    const syncEnd = process.hrtime.bigint();
    const syncDurationMs = Number(syncEnd - syncStart) / 1e6;

    assert.strictEqual(syncStatus, 'Completed', 'Sync detectPhaseStatus must accurately parse "Status: Completed"');
    assert.ok(
      syncDurationMs < 10,
      `Sync 4KB bounded read should execute in < 10ms (actual: ${syncDurationMs.toFixed(2)}ms)`
    );

    // Test async detectPhaseStatusAsync
    const asyncStart = process.hrtime.bigint();
    const asyncStatus = await detectPhaseStatusAsync(largeFilePath);
    const asyncEnd = process.hrtime.bigint();
    const asyncDurationMs = Number(asyncEnd - asyncStart) / 1e6;

    assert.strictEqual(asyncStatus, 'Completed', 'Async detectPhaseStatusAsync must accurately parse "Status: Completed"');
    assert.ok(
      asyncDurationMs < 10,
      `Async 4KB bounded read should execute in < 10ms (actual: ${asyncDurationMs.toFixed(2)}ms)`
    );

    console.log(
      `  -> Passed: 5MB header read performed in ${syncDurationMs.toFixed(2)}ms (sync) / ${asyncDurationMs.toFixed(2)}ms (async) with accurate status detection.`
    );

    // ----------------------------------------------------------------------
    // Test 2: Async Plan Scanner Equivalence Test
    // ----------------------------------------------------------------------
    console.log('\n[Test 2] Verifying Sync vs Async Plan Scanner Equivalence (10 Phase Files)...');

    const planSubDir = path.join(tmpDir, 'plans-test');
    fs.mkdirSync(planSubDir, { recursive: true });

    for (let i = 1; i <= 10; i++) {
      const pNum = i < 10 ? `0${i}` : `${i}`;
      const statusText = i % 2 === 0 ? 'Status: Completed' : 'Status: Pending';
      const fileContent = `# Phase ${pNum} Title\n\n${statusText}\n\nSome detail lines...\n`;
      fs.writeFileSync(path.join(planSubDir, `phase-${pNum}-test.md`), fileContent, 'utf8');
    }

    const syncPhases = scanPlanFolder(planSubDir);
    const asyncPhases = await scanPlanFolderAsync(planSubDir);

    assert.strictEqual(syncPhases.length, 10, 'Sync scanner should find 10 phase files');
    assert.strictEqual(asyncPhases.length, 10, 'Async scanner should find 10 phase files');

    assert.deepStrictEqual(
      asyncPhases,
      syncPhases,
      'Async plan scanner output must be strictly identical to sync plan scanner output'
    );

    console.log('  -> Passed: scanPlanFolder and scanPlanFolderAsync returned identical phase structures, sorting, and status metadata.');

    // ----------------------------------------------------------------------
    // Test 3: Plan Discovery Cache & Async Discovery Test
    // ----------------------------------------------------------------------
    console.log('\n[Test 3] Verifying Plan Discovery Cache & Async Workspace Discovery...');

    clearPlanDiscoveryCache();
    assert.strictEqual(getPlanDiscoveryCache(), null, 'Cache must be null after clearPlanDiscoveryCache()');

    const res1 = await discoverWorkspacePlanFoldersAsync();
    const cacheAfterFirst = getPlanDiscoveryCache();
    assert.ok(cacheAfterFirst !== null, 'Cache should be populated after discoverWorkspacePlanFoldersAsync()');
    assert.strictEqual(cacheAfterFirst?.results, res1, 'Cached results object should match returned value');

    // Call again within TTL without forceRefresh
    const res2 = await discoverWorkspacePlanFoldersAsync();
    assert.strictEqual(res2, res1, 'Subsequent call within TTL must return cached object reference');

    // Force refresh
    const res3 = await discoverWorkspacePlanFoldersAsync(true);
    assert.ok(res3 !== res1, 'Call with forceRefresh = true must bypass cache and generate new object reference');

    // Invalidation
    clearPlanDiscoveryCache();
    assert.strictEqual(getPlanDiscoveryCache(), null, 'Cache must be cleared after explicit clearPlanDiscoveryCache() call');

    console.log('  -> Passed: In-memory TTL cache (5000ms) and forceRefresh invalidation operate correctly.');

    console.log('\n======================================================');
    console.log('✅ ALL PHASE 03 ASYNC PLAN SCANNER & BOUNDED I/O TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase03Tests().catch(err => {
  console.error('Phase 03 Test Suite Failed:', err);
  process.exit(1);
});
