// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let configStore: { [key: string]: any } = {
  promptText: 'Default Prompt',
  repeatCount: 5,
  completionKeyword: 'Done skul9x.',
  delayBetweenLoopsMs: 100,
  timeoutPerLoopMinutes: 15,
  autoInjectWorkbench: true,
  executionMode: 'auto',
  allowTierFallback: true,
  strictMode: false
};

const configChangeListeners: ((e: any) => void)[] = [];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section?: string) => ({
          get: (key: string, defaultValue: any) =>
            configStore[key] !== undefined ? configStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            configStore[key] = val;
            for (const listener of configChangeListeners) {
              listener({ affectsConfiguration: (s: string) => s === 'autoplan' || s === 'autoplan.' + key });
            }
          }
        }),
        onDidChangeConfiguration: (cb: any) => {
          configChangeListeners.push(cb);
          return {
            dispose: () => {
              const idx = configChangeListeners.indexOf(cb);
              if (idx >= 0) configChangeListeners.splice(idx, 1);
            }
          };
        }
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      window: {
        createStatusBarItem: () => ({
          text: '',
          tooltip: '',
          command: undefined,
          visible: false,
          show() { this.visible = true; },
          hide() { this.visible = false; },
          dispose() {}
        }),
        showInformationMessage: async (msg: string, ...items: string[]) => items[0],
        showWarningMessage: async (msg: string, ...items: string[]) => items[0],
        showErrorMessage: async (msg: string, ...items: string[]) => items[0]
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: async () => {}
      },
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
import * as childProcess from 'child_process';
import {
  writeConfigJson,
  getUserConfigStorageDir,
  SIDECAR_CONFIG_FILENAME,
  AutoPlanConfig
} from '../config';
import {
  writeFileElevated,
  writeFileElevatedAsync,
  installBridgeScriptAsync,
  uninstallBridgeScriptAsync,
  canWriteWorkbenchPath,
  ElevationLockedError,
  getIsElevationInProgress,
  setIsElevationInProgress
} from '../workbenchInjector';
import {
  triggerDebouncedConfigUpdate
} from '../extension';

async function runPhase04NonblockingElevationAndConfigIsolationTests() {
  console.log('=== Running Phase 04: Non-Blocking Elevation & Config Storage Isolation Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-test-'));
  const originalWriteFileSync = fs.writeFileSync;

  try {
    // -------------------------------------------------------------
    // Test Case 1: Config Storage Isolation (writeConfigJson)
    // -------------------------------------------------------------
    console.log('[Test Case 1] Verifying Safe Config Storage Resolution & Fallback...');
    {
      const customConfig: AutoPlanConfig = {
        promptText: 'Custom Test Prompt',
        repeatCount: 10,
        completionKeyword: 'Done skul9x.',
        delayBetweenLoopsMs: 1500,
        timeoutPerLoopMinutes: 20
      };

      // 1.1 Writable directory write
      const writableDir = path.join(tempDir, 'writable_target');
      fs.mkdirSync(writableDir, { recursive: true });

      const writtenPath = writeConfigJson(customConfig, writableDir);
      assert.strictEqual(writtenPath, path.join(writableDir, SIDECAR_CONFIG_FILENAME));
      assert.ok(fs.existsSync(writtenPath!), 'Config file must exist in writable targetDir');
      const savedData = JSON.parse(fs.readFileSync(writtenPath!, 'utf8'));
      assert.strictEqual(savedData.promptText, 'Custom Test Prompt');
      assert.strictEqual(savedData.repeatCount, 10);

      // 1.2 Non-writable simulated directory (EACCES) fallback to user storage
      const simulatedProtectedDir = path.join(tempDir, 'protected_sys_dir');
      fs.mkdirSync(simulatedProtectedDir, { recursive: true });

      const isolatedUserStorageDir = path.join(tempDir, 'isolated_user_storage');
      fs.mkdirSync(isolatedUserStorageDir, { recursive: true });
      const mockContext = {
        globalStorageUri: {
          fsPath: isolatedUserStorageDir
        }
      };

      // Monkeypatch writeFileSync only for simulatedProtectedDir to throw EACCES
      let interceptedEacces = false;
      (fs as any).writeFileSync = function (filePath: any, content: any, options: any) {
        if (typeof filePath === 'string' && filePath.startsWith(simulatedProtectedDir)) {
          interceptedEacces = true;
          const err: any = new Error('Permission denied (EACCES)');
          err.code = 'EACCES';
          throw err;
        }
        return originalWriteFileSync.apply(this, arguments as any);
      };

      try {
        const fallbackPath = writeConfigJson(customConfig, simulatedProtectedDir, mockContext);
        assert.ok(interceptedEacces, 'EACCES error must have been caught on protected dir write attempt');
        assert.strictEqual(
          fallbackPath,
          path.join(isolatedUserStorageDir, SIDECAR_CONFIG_FILENAME),
          'writeConfigJson must fall back cleanly to user storage directory without elevation'
        );
        assert.ok(fs.existsSync(fallbackPath!), 'Config file must be created in user storage directory');
        const fallbackData = JSON.parse(fs.readFileSync(fallbackPath!, 'utf8'));
        assert.strictEqual(fallbackData.promptText, 'Custom Test Prompt');
      } finally {
        (fs as any).writeFileSync = originalWriteFileSync;
      }

      // 1.3 TargetDir omitted, falls back safely to user storage if workbench directory is non-writable
      const defaultFallbackPath = writeConfigJson(customConfig, undefined, mockContext);
      assert.ok(defaultFallbackPath !== null, 'Fallback path should not be null');
      assert.ok(
        defaultFallbackPath === path.join(isolatedUserStorageDir, SIDECAR_CONFIG_FILENAME) ||
        defaultFallbackPath!.endsWith(SIDECAR_CONFIG_FILENAME),
        'Must resolve to a valid sidecar config file path'
      );

      console.log('  ✓ Config writes safely without elevation and falls back seamlessly on EACCES.');
    }

    // -------------------------------------------------------------
    // Test Case 2: canWriteWorkbenchPath Verification
    // -------------------------------------------------------------
    console.log('\n[Test Case 2] Verifying canWriteWorkbenchPath Permission Detection...');
    {
      const writableWb = path.join(tempDir, 'wb_test', 'workbench.html');
      fs.mkdirSync(path.dirname(writableWb), { recursive: true });
      fs.writeFileSync(writableWb, '<html></html>', 'utf8');

      const isWritable = canWriteWorkbenchPath(writableWb);
      assert.strictEqual(isWritable, true, 'User writable workbench file must return true');

      const nonExistent = path.join(tempDir, 'non_existent_wb', 'workbench.html');
      assert.strictEqual(canWriteWorkbenchPath(nonExistent), false, 'Non-existent path must return false');

      console.log('  ✓ canWriteWorkbenchPath correctly detects writable vs non-writable paths.');
    }

    // -------------------------------------------------------------
    // Test Case 3: Asynchronous Non-Blocking Elevation & Event Loop
    // -------------------------------------------------------------
    console.log('\n[Test Case 3] Verifying writeFileElevatedAsync Non-Blocking Event Loop Execution...');
    {
      // 3.1 Direct write when path is writable
      const asyncDirectFile = path.join(tempDir, 'async_direct.txt');
      await writeFileElevatedAsync(asyncDirectFile, 'Direct async write content');
      assert.strictEqual(fs.readFileSync(asyncDirectFile, 'utf8'), 'Direct async write content');

      // 3.2 Simulated elevated write with event loop tick verification
      const originalExec = childProcess.exec;
      const originalFsWriteFile = fs.promises.writeFile;

      let eventLoopTicks = 0;
      const tickInterval = setInterval(() => {
        eventLoopTicks++;
      }, 10);

      const simulatedRootTarget = path.join(tempDir, 'protected_root_file.txt');

      // Force writeFile on target to throw EACCES to trigger elevation branch
      (fs.promises as any).writeFile = async function (filePath: any, content: any, options: any) {
        if (typeof filePath === 'string' && filePath === simulatedRootTarget) {
          const err: any = new Error('Permission denied');
          err.code = 'EACCES';
          throw err;
        }
        return originalFsWriteFile.apply(this, arguments as any);
      };

      // Mock childProcess.exec to simulate non-blocking asynchronous execution taking ~80ms
      let simulatedExecCalled = false;
      let capturedTempPath: string | null = null;
      (childProcess as any).exec = function (cmd: string, options: any, callback: any) {
        simulatedExecCalled = true;
        // Parse temporary file path from command
        const match = cmd.match(/'([^']+\.tmp)'/);
        if (match) {
          capturedTempPath = match[1];
        }

        setTimeout(() => {
          // Simulate successful elevation copying
          originalWriteFileSync(simulatedRootTarget, 'Elevated content', 'utf8');
          callback(null, 'OK', '');
        }, 80);
      };

      try {
        await writeFileElevatedAsync(simulatedRootTarget, 'Elevated content');
        clearInterval(tickInterval);

        assert.ok(simulatedExecCalled, 'Simulated childProcess.exec must have been invoked');
        assert.ok(eventLoopTicks >= 3, `Event loop must continue ticking during async elevation (ticks: ${eventLoopTicks})`);
        assert.strictEqual(fs.readFileSync(simulatedRootTarget, 'utf8'), 'Elevated content');

        // Verify temporary file is cleanly unlinked after elevation
        if (capturedTempPath) {
          assert.strictEqual(fs.existsSync(capturedTempPath), false, 'Temporary elevation file must be unlinked');
        }
      } finally {
        clearInterval(tickInterval);
        (fs.promises as any).writeFile = originalFsWriteFile;
        (childProcess as any).exec = originalExec;
      }

      console.log('  ✓ writeFileElevatedAsync executes asynchronously without blocking the event loop.');
    }

    // -------------------------------------------------------------
    // Test Case 4: Elevation Mutex & Single-Flight Lock
    // -------------------------------------------------------------
    console.log('\n[Test Case 4] Verifying Elevation Mutex (ElevationLockedError)...');
    {
      const originalExec = childProcess.exec;
      const originalFsWriteFile = fs.promises.writeFile;
      const originalFsWriteFileSync = fs.writeFileSync;

      const simulatedTarget = path.join(tempDir, 'mutex_target.txt');

      (fs.promises as any).writeFile = async function (filePath: any, content: any, options: any) {
        if (typeof filePath === 'string' && filePath === simulatedTarget) {
          const err: any = new Error('Permission denied');
          err.code = 'EACCES';
          throw err;
        }
        return originalFsWriteFile.apply(this, arguments as any);
      };

      (fs as any).writeFileSync = function (filePath: any, content: any, options: any) {
        if (typeof filePath === 'string' && filePath === simulatedTarget) {
          const err: any = new Error('Permission denied');
          err.code = 'EACCES';
          throw err;
        }
        return originalFsWriteFileSync.apply(this, arguments as any);
      };

      let execInvoked = false;
      (childProcess as any).exec = function (cmd: string, options: any, callback: any) {
        execInvoked = true;
        setTimeout(() => {
          callback(null, 'OK', '');
        }, 60);
      };

      try {
        // Start first elevated call (holds mutex lock)
        const firstPromise = writeFileElevatedAsync(simulatedTarget, 'Call 1');
        // Allow microtask to process initial writeFile rejection and acquire elevation mutex
        await new Promise((resolve) => setImmediate(resolve));

        // Verify mutex is actively locked
        assert.strictEqual(getIsElevationInProgress(), true, 'Mutex must be active during elevation');

        // Concurrent second async call must fail fast with ElevationLockedError
        let secondFailedFast = false;
        try {
          await writeFileElevatedAsync(simulatedTarget, 'Call 2');
        } catch (err: any) {
          assert.ok(
            err instanceof ElevationLockedError || err.name === 'ElevationLockedError',
            `Expected ElevationLockedError, got: ${err}`
          );
          assert.ok(
            err.message.includes('An elevation prompt is already active'),
            'Error message should indicate active elevation dialog'
          );
          secondFailedFast = true;
        }
        assert.ok(secondFailedFast, 'Second concurrent elevated write must fail fast with ElevationLockedError');

        // Concurrent sync call must also fail fast with ElevationLockedError
        let syncFailedFast = false;
        try {
          writeFileElevated(simulatedTarget, 'Call Sync');
        } catch (err: any) {
          assert.ok(
            err instanceof ElevationLockedError || err.name === 'ElevationLockedError',
            `Expected ElevationLockedError on sync call, got: ${err}`
          );
          syncFailedFast = true;
        }
        assert.ok(syncFailedFast, 'Synchronous elevation call during active mutex must fail fast');

        // Wait for first elevation to complete
        await firstPromise;

        assert.ok(execInvoked, 'Simulated exec must have been invoked');
        assert.strictEqual(getIsElevationInProgress(), false, 'Mutex must be released after completion');
      } finally {
        setIsElevationInProgress(false);
        (fs.promises as any).writeFile = originalFsWriteFile;
        (fs as any).writeFileSync = originalFsWriteFileSync;
        (childProcess as any).exec = originalExec;
      }

      console.log('  ✓ Elevation mutex prevents concurrent modal dialog flooding.');
    }

    // -------------------------------------------------------------
    // Test Case 5: Async Install & Uninstall Bridge Script
    // -------------------------------------------------------------
    console.log('\n[Test Case 5] Verifying installBridgeScriptAsync & uninstallBridgeScriptAsync...');
    {
      const mockWb = path.join(tempDir, 'bridge_async_test', 'workbench.html');
      fs.mkdirSync(path.dirname(mockWb), { recursive: true });
      fs.writeFileSync(mockWb, '<html><head></head><body><div id="root">Hello</div></body></html>', 'utf8');

      // Install asynchronously
      const installRes = await installBridgeScriptAsync({
        workbenchPath: mockWb,
        updateChecksums: false
      });
      assert.strictEqual(installRes.success, true, 'installBridgeScriptAsync must succeed');
      const installedContent = fs.readFileSync(mockWb, 'utf8');
      assert.ok(installedContent.includes('<!-- AUTO-PLAN-BRIDGE-START -->'), 'Must contain bridge tag');
      assert.ok(installedContent.includes('autoplan-dom-bridge.js'), 'Must reference script');

      // Verify sidecar script created
      const scriptFile = path.join(path.dirname(mockWb), 'autoplan-dom-bridge.js');
      assert.ok(fs.existsSync(scriptFile), 'Sidecar script file must exist');

      // Uninstall asynchronously
      const uninstallRes = await uninstallBridgeScriptAsync({
        workbenchPath: mockWb,
        updateChecksums: false
      });
      assert.strictEqual(uninstallRes.success, true, 'uninstallBridgeScriptAsync must succeed');
      const uninstalledContent = fs.readFileSync(mockWb, 'utf8');
      assert.ok(!uninstalledContent.includes('<!-- AUTO-PLAN-BRIDGE-START -->'), 'Tag must be removed');
      assert.ok(!fs.existsSync(scriptFile), 'Sidecar script file must be cleaned up');

      console.log('  ✓ installBridgeScriptAsync and uninstallBridgeScriptAsync execute cleanly.');
    }

    // -------------------------------------------------------------
    // Test Case 6: Debounced Configuration Change Handler (Coalescing 15 Updates)
    // -------------------------------------------------------------
    console.log('\n[Test Case 6] Verifying Debounced Config Updates (15 Rapid Changes -> 1 Execution)...');
    {
      let executionCount = 0;

      // Fire 15 rapid consecutive configuration updates
      for (let i = 0; i < 15; i++) {
        triggerDebouncedConfigUpdate(
          undefined,
          () => {
            executionCount++;
          },
          100 // Use 100ms for fast, deterministic test execution
        );
      }

      // Immediately after rapid loop, executionCount must still be 0
      assert.strictEqual(executionCount, 0, 'No execution should run immediately during debounce window');

      // Wait for debounce timer to fire
      await new Promise((resolve) => setTimeout(resolve, 160));

      // After debounce timeout, exactly 1 coalesced execution should have occurred
      assert.strictEqual(
        executionCount,
        1,
        `15 rapid consecutive config changes must be coalesced into exactly 1 execution (got: ${executionCount})`
      );

      console.log('  ✓ 15 rapid consecutive configuration changes coalesced into exactly 1 execution.');
    }

    console.log('\n=============================================================');
    console.log('🎉 ALL PHASE 04 TESTS COMPLETED SUCCESSFULLY!');
    console.log('=============================================================\n');

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}

// Execute test suite
runPhase04NonblockingElevationAndConfigIsolationTests().catch((err) => {
  console.error('\n❌ Phase 04 Test Failure:', err);
  process.exit(1);
});
