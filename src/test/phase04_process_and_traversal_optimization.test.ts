// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      window: {
        showErrorMessage: async () => {},
        showInformationMessage: async () => {},
        showWarningMessage: async () => {}
      },
      env: {
        appRoot: undefined,
        clipboard: {
          writeText: async () => {},
          readText: async () => ''
        }
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
  checkLinuxKeyboardPrerequisites,
  clearLinuxKeyboardPrerequisitesCache,
  inspectLinuxActiveWindow,
  inspectWindowsActiveWindow,
  clearWindowsActiveWindowCache,
  isApprovedEditor,
  KeyboardManager
} from '../keyboardManager';
import {
  findFileRecursive,
  getWorkbenchPath,
  IGNORED_SEARCH_DIRS
} from '../workbenchInjector';

async function runPhase04Verification(): Promise<void> {
  console.log('====================================================================');
  console.log(' Phase 04: Native Process Spawn & Traversal Optimization Test Suite');
  console.log('====================================================================\n');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-test-'));

  try {
    // -------------------------------------------------------------------------
    // Test 1: Memoize checkLinuxKeyboardPrerequisites (<1ms cached latency)
    // -------------------------------------------------------------------------
    console.log('[Test 1] Verifying checkLinuxKeyboardPrerequisites memoization and performance...');
    clearLinuxKeyboardPrerequisitesCache();

    const t0 = performance.now();
    const firstCheck = checkLinuxKeyboardPrerequisites();
    const tFirst = performance.now() - t0;
    assert.strictEqual(typeof firstCheck.available, 'boolean', 'Prereqs check must return boolean availability');

    // Subsequent call should hit cache and complete in < 1ms
    const t1 = performance.now();
    const cachedCheck = checkLinuxKeyboardPrerequisites();
    const tCached = performance.now() - t1;

    assert.strictEqual(cachedCheck.available, firstCheck.available, 'Cached status must match original check');
    assert.strictEqual(cachedCheck.binary, firstCheck.binary, 'Cached binary path must match original');
    assert.ok(tCached < 5, `Cached check must resolve in < 5ms (was ${tCached.toFixed(3)}ms, first was ${tFirst.toFixed(3)}ms)`);

    // Verify forceRefresh forces re-check
    const refreshedCheck = checkLinuxKeyboardPrerequisites(true);
    assert.strictEqual(refreshedCheck.available, firstCheck.available, 'Refreshed check must be valid');

    // Verify KeyboardManager class method delegates properly
    const km = new KeyboardManager();
    const kmCheck = km.checkLinuxKeyboardPrerequisites();
    assert.strictEqual(kmCheck.available, firstCheck.available, 'KeyboardManager method must return consistent memoized result');
    console.log(`  ✓ checkLinuxKeyboardPrerequisites memoized: first=${tFirst.toFixed(2)}ms, cached=${tCached.toFixed(3)}ms\n`);

    // -------------------------------------------------------------------------
    // Test 2: Unified Asynchronous inspectLinuxActiveWindow Pipeline
    // -------------------------------------------------------------------------
    console.log('[Test 2] Verifying unified asynchronous inspectLinuxActiveWindow pipeline...');

    // Scenario 2A: Simulated xdotool pipeline success (single async command execution)
    let callCount2A = 0;
    let lastCmd2A = '';
    const mockExec2A = async (cmd: string) => {
      callCount2A++;
      lastCmd2A = cmd;
      // Output format: pid\n---AUTOPLAN_DELIM---\ncomm\n---AUTOPLAN_DELIM---\nname
      return {
        stdout: `98765\n---AUTOPLAN_DELIM---\ncode\n---AUTOPLAN_DELIM---\nMy Project - Visual Studio Code`,
        stderr: ''
      };
    };

    const windowInfo2A = await inspectLinuxActiveWindow(mockExec2A);
    assert.strictEqual(callCount2A, 1, 'xdotool pipeline must execute in exactly 1 single async command');
    assert.ok(lastCmd2A.includes('xdotool getactivewindow'), 'Pipeline command must query xdotool');
    assert.ok(lastCmd2A.includes('---AUTOPLAN_DELIM---'), 'Pipeline command must use delimiter separation');
    assert.strictEqual(windowInfo2A.pid, 98765, 'PID must be parsed correctly');
    assert.strictEqual(windowInfo2A.processName, 'code', 'Process name must be parsed correctly');
    assert.strictEqual(windowInfo2A.windowTitle, 'My Project - Visual Studio Code', 'Window title must be parsed correctly');
    assert.strictEqual(windowInfo2A.isTarget, true, 'Visual Studio Code must be recognized as target editor');

    // Scenario 2B: xdotool fails, fallback to unified xprop async pipeline
    let callCount2B = 0;
    const mockExec2B = async (cmd: string) => {
      callCount2B++;
      if (cmd.includes('xdotool')) {
        throw new Error('xdotool: command not found');
      }
      if (cmd.includes('xprop')) {
        return {
          stdout: `4567\n---AUTOPLAN_DELIM---\nantigravity-ide\n---AUTOPLAN_DELIM---\n_NET_WM_NAME(UTF8_STRING) = "main.ts - Antigravity IDE"`,
          stderr: ''
        };
      }
      throw new Error(`Unexpected command: ${cmd}`);
    };

    const windowInfo2B = await inspectLinuxActiveWindow(mockExec2B);
    assert.strictEqual(callCount2B, 2, 'Fallback should execute xdotool first, then xprop pipeline');
    assert.strictEqual(windowInfo2B.pid, 4567, 'Fallback xprop PID must be parsed');
    assert.strictEqual(windowInfo2B.processName, 'antigravity-ide', 'Fallback xprop process name must be parsed');
    assert.strictEqual(windowInfo2B.windowTitle, 'main.ts - Antigravity IDE', 'Fallback xprop window title regex must strip formatting');
    assert.strictEqual(windowInfo2B.isTarget, true, 'Antigravity IDE must be recognized as approved editor');

    // Scenario 2C: Both tools fail (headless or unknown)
    const mockExec2C = async () => {
      throw new Error('Command failed');
    };
    const windowInfo2C = await inspectLinuxActiveWindow(mockExec2C);
    assert.strictEqual(windowInfo2C.isTarget, false, 'Failed inspection must return isTarget: false');
    assert.strictEqual(windowInfo2C.windowTitle, 'Unknown / Headless Window');

    // Scenario 2D: Native Linux runtime check (if running on Linux)
    if (process.platform === 'linux') {
      const nativeT0 = performance.now();
      const nativeInfo = await inspectLinuxActiveWindow();
      const nativeDuration = performance.now() - nativeT0;
      assert.ok(typeof nativeInfo.isTarget === 'boolean', 'Native inspection must resolve with valid boolean target');
      console.log(`  ✓ Native Linux async inspection completed in ${nativeDuration.toFixed(2)}ms (isTarget=${nativeInfo.isTarget}, title="${nativeInfo.windowTitle}")`);
    }
    console.log('  ✓ inspectLinuxActiveWindow unified async pipeline verified.\n');

    // -------------------------------------------------------------------------
    // Test 3: Windows inspectWindowsActiveWindow 500ms TTL Memoization Cache
    // -------------------------------------------------------------------------
    console.log('[Test 3] Verifying inspectWindowsActiveWindow 500ms TTL memoization cache...');
    clearWindowsActiveWindowCache();

    let winExecCount = 0;
    const mockWinExec = async () => {
      winExecCount++;
      return {
        stdout: JSON.stringify({
          Title: 'index.ts - Visual Studio Code',
          Process: 'Code',
          Pid: 1010
        }),
        stderr: ''
      };
    };

    const winInfo1 = await inspectWindowsActiveWindow(false, mockWinExec);
    assert.strictEqual(winExecCount, 1, 'First call must invoke runner');
    assert.strictEqual(winInfo1.windowTitle, 'index.ts - Visual Studio Code');
    assert.strictEqual(winInfo1.isTarget, true);

    // Call 2 within 500ms should return cached info without invoking runner
    const winInfo2 = await inspectWindowsActiveWindow(false, mockWinExec);
    assert.strictEqual(winExecCount, 1, 'Second call within 500ms TTL must NOT invoke runner again (memoized)');
    assert.strictEqual(winInfo2.windowTitle, winInfo1.windowTitle);

    // Force refresh must bypass cache
    const winInfo3 = await inspectWindowsActiveWindow(true, mockWinExec);
    assert.strictEqual(winExecCount, 2, 'forceRefresh=true must invoke runner again');
    assert.strictEqual(winInfo3.isTarget, true);

    clearWindowsActiveWindowCache();
    console.log('  ✓ inspectWindowsActiveWindow 500ms TTL cache prevents repetitive Roslyn JIT compilation.\n');

    // -------------------------------------------------------------------------
    // Test 4: Trae & Multi-IDE Approved Editor Whitelist
    // -------------------------------------------------------------------------
    console.log('[Test 4] Verifying expanded approved editor support (Trae, Cursor, Windsurf, Antigravity)...');
    assert.strictEqual(isApprovedEditor('project - Trae', 'trae'), true, 'Trae editor must be approved');
    assert.strictEqual(isApprovedEditor('project - Cursor', 'cursor'), true, 'Cursor editor must be approved');
    assert.strictEqual(isApprovedEditor('project - Windsurf', 'windsurf'), true, 'Windsurf editor must be approved');
    assert.strictEqual(isApprovedEditor('project - Antigravity', 'antigravity'), true, 'Antigravity editor must be approved');
    assert.strictEqual(isApprovedEditor('Calculator', 'calc.exe'), false, 'Non-editor app must be rejected');
    console.log('  ✓ Approved editor whitelist validated for all supported IDEs.\n');

    // -------------------------------------------------------------------------
    // Test 5: Directory Pruning in findFileRecursive
    // -------------------------------------------------------------------------
    console.log('[Test 5] Verifying directory pruning in findFileRecursive...');
    const searchRoot = path.join(tempRoot, 'search_tree');
    fs.mkdirSync(searchRoot, { recursive: true });

    // Populate blacklisted directories with decoy target files
    for (const ignoredDir of IGNORED_SEARCH_DIRS) {
      const dirPath = path.join(searchRoot, ignoredDir);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, 'workbench.html'), `decoy in ${ignoredDir}`, 'utf8');
    }

    // Populate hidden directory
    const hiddenDir = path.join(searchRoot, '.hidden_dir');
    fs.mkdirSync(hiddenDir, { recursive: true });
    fs.writeFileSync(path.join(hiddenDir, 'workbench.html'), 'decoy in hidden', 'utf8');

    // When no legitimate file exists, findFileRecursive should return null (all decoys pruned)
    const pruneOnlyResult = findFileRecursive(searchRoot, 'workbench.html', 3);
    assert.strictEqual(pruneOnlyResult, null, 'Decoy files in blacklisted directories must be ignored');

    // Place legitimate file in a valid nested directory: sub/nested/workbench.html (depth 2)
    const validDir = path.join(searchRoot, 'sub', 'nested');
    fs.mkdirSync(validDir, { recursive: true });
    const legitimatePath = path.join(validDir, 'workbench.html');
    fs.writeFileSync(legitimatePath, '<html>Valid Workbench</html>', 'utf8');

    const foundLegitimate = findFileRecursive(searchRoot, 'workbench.html', 3);
    assert.strictEqual(foundLegitimate, legitimatePath, 'Must discover legitimate workbench file in non-pruned directory');
    console.log('  ✓ Directory pruning correctly skipped blacklisted & hidden folders.\n');

    // -------------------------------------------------------------------------
    // Test 6: Constrained MaxDepth Bounding (Reduced from 6 down to 3)
    // -------------------------------------------------------------------------
    console.log('[Test 6] Verifying maxDepth constraint in findFileRecursive...');
    const depthRoot = path.join(tempRoot, 'depth_tree');
    // Create hierarchy: d1 / d2 / d3 / d4 / deep.html (depth 4)
    const deepDir = path.join(depthRoot, 'd1', 'd2', 'd3', 'd4');
    fs.mkdirSync(deepDir, { recursive: true });
    const deepFilePath = path.join(deepDir, 'deep.html');
    fs.writeFileSync(deepFilePath, 'deep content', 'utf8');

    // Default maxDepth 3 must NOT reach depth 4
    const depth3Result = findFileRecursive(depthRoot, 'deep.html', 3);
    assert.strictEqual(depth3Result, null, 'Default maxDepth=3 must not traverse beyond 3 directory levels');

    // Explicit maxDepth 4 SHOULD find it
    const depth4Result = findFileRecursive(depthRoot, 'deep.html', 4);
    assert.strictEqual(depth4Result, deepFilePath, 'maxDepth=4 must reach and find file at depth 4');
    console.log('  ✓ maxDepth constraint verified (bounded to 3 levels).\n');

    // -------------------------------------------------------------------------
    // Test 7: Expanded Static Candidate Whitelist in getWorkbenchPath
    // -------------------------------------------------------------------------
    console.log('[Test 7] Verifying expanded static candidate layouts in getWorkbenchPath (<5ms)...');

    const testLayouts = [
      { name: 'VS Code standard sandbox', rel: path.join('out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html') },
      { name: 'Antigravity layout', rel: path.join('out', 'antigravity', 'workbench.html') },
      { name: 'Cursor layout', rel: path.join('out', 'cursor', 'workbench.html') },
      { name: 'Windsurf layout', rel: path.join('out', 'windsurf', 'workbench.html') },
      { name: 'Trae layout', rel: path.join('out', 'trae', 'workbench.html') }
    ];

    for (const layout of testLayouts) {
      const appRoot = path.join(tempRoot, `app_${layout.name.replace(/\s+/g, '_')}`);
      const fullTarget = path.join(appRoot, layout.rel);
      fs.mkdirSync(path.dirname(fullTarget), { recursive: true });
      fs.writeFileSync(fullTarget, `<html>${layout.name}</html>`, 'utf8');

      const start = performance.now();
      const resolved = getWorkbenchPath(appRoot);
      const duration = performance.now() - start;

      assert.strictEqual(resolved, fullTarget, `Failed resolving ${layout.name}`);
      assert.ok(duration < 5, `Candidate resolution for ${layout.name} must resolve in < 5ms (was ${duration.toFixed(3)}ms)`);
      console.log(`  ✓ ${layout.name} candidate resolved in ${duration.toFixed(3)}ms`);
    }
    console.log('  ✓ Expanded candidate paths verified for Antigravity, VS Code, Cursor, Windsurf, and Trae.\n');

    console.log('====================================================================');
    console.log(' ALL PHASE 04 OPTIMIZATION TESTS PASSED SUCCESSFULLY!');
    console.log('====================================================================');
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

runPhase04Verification().catch((err) => {
  console.error('\n❌ Phase 04 Verification Failed:', err);
  process.exit(1);
});
