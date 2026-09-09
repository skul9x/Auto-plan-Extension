// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceFolders: any[] = [
  {
    name: 'Auto-plan-Extension-main',
    uri: { fsPath: '/test/Auto-plan-Extension-main' }
  }
];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        get workspaceFolders() {
          return mockWorkspaceFolders;
        },
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue
        })
      },
      commands: {
        executeCommand: async () => undefined
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
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { DEFAULT_CONFIG } from '../config';
import { Orchestrator } from '../orchestrator';

async function runPhase03Tests() {
  console.log('=================================================================');
  console.log('Phase 03 Verification: Asynchronous DOM Snapshot Disk Writing');
  console.log('=================================================================\n');

  const testTempRoot = path.join(os.tmpdir(), `autoplan-phase03-test-${Date.now()}`);
  await fs.promises.mkdir(testTempRoot, { recursive: true });

  const testLogger: any = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    registerPlanAuditProvider: () => {}
  };

  try {
    // Test Case 1: Large Synthetic 10MB HTML snapshot persistence & Event Loop Responsiveness
    console.log('▶ Test 1: 10MB Synthetic Snapshot Non-Blocking Write & Exact Byte Persistence...');
    {
      const snapshotDir = path.join(testTempRoot, 'snapshots-async');
      const payloadSize = 10 * 1024 * 1024; // 10MB
      const baseChunk = '<div><span>DOM Snapshot Test Element Chunk 1234567890</span></div>\n';
      const repeatCount = Math.ceil(payloadSize / baseChunk.length);
      const syntheticHtml = '<html><head><title>Large Snapshot</title></head><body>' +
        baseChunk.repeat(repeatCount).slice(0, payloadSize) +
        '</body></html>';

      const mockBridgeServer: any = {
        captureDomSnapshot: async () => ({
          success: true,
          html: syntheticHtml
        })
      };

      const orchestrator = new Orchestrator({
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: snapshotDir
        }),
        bridgeServer: mockBridgeServer,
        debugLogger: testLogger
      });

      // High-frequency event loop latency tracker (ticks every 2ms)
      let tickCount = 0;
      let maxTickLatency = 0;
      let lastTickTime = Date.now();

      const timer = setInterval(() => {
        const now = Date.now();
        const delta = now - lastTickTime;
        if (delta > maxTickLatency) {
          maxTickLatency = delta;
        }
        lastTickTime = now;
        tickCount++;
      }, 2);

      const savedPath = await orchestrator.saveWorkbenchSnapshot({
        phaseIndex: 0,
        phaseName: 'phase-01',
        attempt: 1,
        triggerType: 'initial'
      });

      clearInterval(timer);

      assert.ok(savedPath, 'saveWorkbenchSnapshot must return the full saved file path on success');
      assert.ok(fs.existsSync(savedPath), `Snapshot file must exist at ${savedPath}`);

      // Verify exact byte content matches
      const persistedContent = await fs.promises.readFile(savedPath, 'utf8');
      assert.strictEqual(
        persistedContent.length,
        syntheticHtml.length,
        `Persisted HTML size (${persistedContent.length}) must match synthetic HTML (${syntheticHtml.length})`
      );
      assert.strictEqual(
        persistedContent,
        syntheticHtml,
        'Persisted HTML content must match synthetic HTML byte-for-byte'
      );

      console.log(`  ✓ Snapshot saved: ${savedPath} (${(syntheticHtml.length / (1024 * 1024)).toFixed(2)} MB)`);
      console.log(`  ✓ Event loop ticks recorded: ${tickCount}, max tick latency: ${maxTickLatency}ms`);

      // Verify event loop did not suffer blocking latency (> 35ms)
      assert.ok(
        maxTickLatency < 35,
        `Event loop tick latency (${maxTickLatency}ms) exceeded 35ms threshold during 10MB snapshot write`
      );
      console.log('  ✓ Verified: Non-blocking event loop responsiveness maintained.');
    }

    // Test Case 2: Cancellation / Abort Handling
    console.log('\n▶ Test 2: Cancellation (isAborted) Handling...');
    {
      const snapshotDir = path.join(testTempRoot, 'snapshots-abort');

      const mockBridgeServer: any = {
        captureDomSnapshot: async () => ({
          success: true,
          html: '<html><body>Content should not be saved</body></html>'
        })
      };

      // 2a: Aborted before calling saveWorkbenchSnapshot
      const orchPreAborted = new Orchestrator({
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: snapshotDir
        }),
        bridgeServer: mockBridgeServer,
        debugLogger: testLogger
      });
      orchPreAborted.stop();

      const resPreAborted = await orchPreAborted.saveWorkbenchSnapshot({
        phaseIndex: 0,
        phaseName: 'phase-01',
        attempt: 1,
        triggerType: 'initial'
      });

      assert.strictEqual(resPreAborted, undefined, 'Must return undefined immediately when orchestrator is stopped before call');
      console.log('  ✓ 2a: Abort prior to snapshot call cleanly returns undefined.');

      // 2b: Aborted during captureDomSnapshot async resolution
      const orchMidAborted = new Orchestrator({
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: snapshotDir
        }),
        bridgeServer: {
          captureDomSnapshot: async () => {
            // Trigger abort while capturing
            orchMidAborted.stop();
            return {
              success: true,
              html: '<html><body>Mid-aborted content</body></html>'
            };
          }
        } as any,
        debugLogger: testLogger
      });

      const resMidAborted = await orchMidAborted.saveWorkbenchSnapshot({
        phaseIndex: 1,
        phaseName: 'phase-02',
        attempt: 1,
        triggerType: 'initial'
      });

      assert.strictEqual(resMidAborted, undefined, 'Must return undefined when orchestrator is stopped during capture');
      console.log('  ✓ 2b: Abort during snapshot capture cleanly returns undefined.');
    }

    // Test Case 3: Robust Error Handling & No Uncaught Rejections
    console.log('\n▶ Test 3: Robust Error Handling & Rejection Safety...');
    {
      let warnLogged = false;
      const loggingWatcher: any = {
        info: () => {},
        warn: (_tag: string, _msg: string) => {
          warnLogged = true;
        },
        error: () => {},
        debug: () => {},
        registerPlanAuditProvider: () => {}
      };

      // 3a: Directory creation error (targetDir is a regular file)
      const obstacleFile = path.join(testTempRoot, 'dir-conflict-file');
      await fs.promises.writeFile(obstacleFile, 'not-a-directory', 'utf8');
      const invalidTargetDir = path.join(obstacleFile, 'nested-snapshots');

      const orchDirError = new Orchestrator({
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: invalidTargetDir
        }),
        bridgeServer: {
          captureDomSnapshot: async () => ({ success: true, html: '<html><body>Test</body></html>' })
        } as any,
        debugLogger: loggingWatcher
      });

      const resDirError = await orchDirError.saveWorkbenchSnapshot({
        phaseIndex: 0,
        phaseName: 'phase-01',
        attempt: 1,
        triggerType: 'initial'
      });

      assert.strictEqual(resDirError, undefined, 'Must return undefined on directory creation failure');
      assert.strictEqual(warnLogged, true, 'Warning must be logged on directory creation failure');
      console.log('  ✓ 3a: Directory creation error caught cleanly without unhandled rejection.');

      // 3b: BridgeServer returns error or throws
      warnLogged = false;
      const orchBridgeThrow = new Orchestrator({
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: path.join(testTempRoot, 'snapshots-bridge-throw')
        }),
        bridgeServer: {
          captureDomSnapshot: async () => {
            throw new Error('Bridge IPC socket closed unexpectedly');
          }
        } as any,
        debugLogger: loggingWatcher
      });

      const resBridgeThrow = await orchBridgeThrow.saveWorkbenchSnapshot({
        phaseIndex: 0,
        phaseName: 'phase-01',
        attempt: 1,
        triggerType: 'initial'
      });

      assert.strictEqual(resBridgeThrow, undefined, 'Must return undefined when BridgeServer throws');
      assert.strictEqual(warnLogged, true, 'Warning must be logged when BridgeServer throws');
      console.log('  ✓ 3b: BridgeServer throw caught cleanly without unhandled rejection.');

      // 3c: BridgeServer returns success: false
      warnLogged = false;
      const orchBridgeFail = new Orchestrator({
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: path.join(testTempRoot, 'snapshots-bridge-fail')
        }),
        bridgeServer: {
          captureDomSnapshot: async () => ({
            success: false,
            error: 'Snapshot capture timeout (6000ms)'
          })
        } as any,
        debugLogger: loggingWatcher
      });

      const resBridgeFail = await orchBridgeFail.saveWorkbenchSnapshot({
        phaseIndex: 0,
        phaseName: 'phase-01',
        attempt: 1,
        triggerType: 'initial'
      });

      assert.strictEqual(resBridgeFail, undefined, 'Must return undefined when BridgeServer returns success: false');
      assert.strictEqual(warnLogged, true, 'Warning must be logged when BridgeServer returns success: false');
      console.log('  ✓ 3c: BridgeServer failure handled cleanly.');
    }

    console.log('\n=================================================================');
    console.log('✔ ALL PHASE 03 TESTS PASSED SUCCESSFULLY');
    console.log('=================================================================');
  } finally {
    // Cleanup temporary test directory
    try {
      await fs.promises.rm(testTempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}

runPhase03Tests().catch((err) => {
  console.error('\n✖ PHASE 03 TEST FAILED:', err);
  process.exit(1);
});
