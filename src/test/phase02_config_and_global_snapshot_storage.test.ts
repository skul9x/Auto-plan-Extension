// Standalone mock for 'vscode' module if run directly via Node / Mocha
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceFolders: any[] = [
  {
    name: 'Auto-plan-Extension-main',
    uri: { fsPath: '/test/Auto-plan-Extension-main' }
  }
];
let mockConfigValues: Record<string, any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        get workspaceFolders() {
          return mockWorkspaceFolders;
        },
        getConfiguration: (_section: string) => ({
          get: (key: string, defaultValue: any) => {
            if (key in mockConfigValues) {
              return mockConfigValues[key];
            }
            return defaultValue;
          }
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

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { DEFAULT_CONFIG, getConfig, AutoPlanConfig } from '../config';
import { Orchestrator } from '../orchestrator';
import { DebugLogger } from '../debugLogger';

async function runPhase02Tests() {
  console.log('=================================================================');
  console.log('Phase 02 Verification: Configuration Schema & Global Snapshot Storage');
  console.log('=================================================================\n');

  // Test Case 1: Configuration Schema & package.json validation
  console.log('▶ Test 1: Configuration Schema in package.json and src/config.ts...');
  {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    assert.ok(fs.existsSync(pkgPath), 'package.json must exist');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    const props = pkg.contributes?.configuration?.properties;
    assert.ok(props, 'package.json contributes.configuration.properties must exist');

    assert.ok(props['autoplan.enableDomSnapshots'], 'autoplan.enableDomSnapshots property must exist');
    assert.strictEqual(props['autoplan.enableDomSnapshots'].type, 'boolean');
    assert.strictEqual(props['autoplan.enableDomSnapshots'].default, true);
    assert.ok(
      props['autoplan.enableDomSnapshots'].description.includes('snapshots'),
      'Description should describe snapshot behavior'
    );

    assert.ok(props['autoplan.domSnapshotFolder'], 'autoplan.domSnapshotFolder property must exist');
    assert.strictEqual(props['autoplan.domSnapshotFolder'].type, 'string');
    assert.strictEqual(props['autoplan.domSnapshotFolder'].default, '');
    assert.ok(
      props['autoplan.domSnapshotFolder'].description.includes('DOM snapshots'),
      'Description should describe custom folder'
    );

    // Verify DEFAULT_CONFIG values
    assert.strictEqual(DEFAULT_CONFIG.enableDomSnapshots, true, 'DEFAULT_CONFIG.enableDomSnapshots must be true');
    assert.strictEqual(DEFAULT_CONFIG.domSnapshotFolder, '', 'DEFAULT_CONFIG.domSnapshotFolder must be empty string');

    // Verify getConfig() defaults
    mockConfigValues = {};
    const currentCfg = getConfig();
    assert.strictEqual(currentCfg.enableDomSnapshots, true, 'getConfig().enableDomSnapshots must default to true');
    assert.strictEqual(currentCfg.domSnapshotFolder, '', 'getConfig().domSnapshotFolder must default to empty string');

    // Verify getConfig() with overrides
    mockConfigValues = {
      enableDomSnapshots: false,
      domSnapshotFolder: '/tmp/custom-snapshots'
    };
    const overriddenCfg = getConfig();
    assert.strictEqual(overriddenCfg.enableDomSnapshots, false, 'getConfig() must respect enableDomSnapshots override');
    assert.strictEqual(overriddenCfg.domSnapshotFolder, '/tmp/custom-snapshots', 'getConfig() must respect domSnapshotFolder override');
    mockConfigValues = {};

    console.log('  ✓ Verified: package.json schema, DEFAULT_CONFIG, and getConfig() overrides work cleanly.');
  }

  // Test Case 2: Skip snapshot when enableDomSnapshots is false
  console.log('\n▶ Test 2: Bypassing snapshot when enableDomSnapshots is false...');
  {
    let captureCalled = false;
    const mockBridgeServer: any = {
      captureDomSnapshot: async () => {
        captureCalled = true;
        return { success: true, html: '<html><body>Mock</body></html>' };
      }
    };

    const orchestrator = new Orchestrator({
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        enableDomSnapshots: false
      }),
      bridgeServer: mockBridgeServer
    });

    const result = await orchestrator.saveWorkbenchSnapshot({
      phaseIndex: 0,
      phaseName: 'phase-01',
      attempt: 1,
      triggerType: 'initial'
    });

    assert.strictEqual(result, undefined, 'saveWorkbenchSnapshot must return undefined when disabled');
    assert.strictEqual(captureCalled, false, 'captureDomSnapshot must NOT be called when enableDomSnapshots is false');
    console.log('  ✓ Verified: Snapshot is skipped when enableDomSnapshots is disabled.');
  }

  // Test Case 3: Workspace Name Sanitization & Resolution Hierarchy
  console.log('\n▶ Test 3: Workspace Name Sanitization and Resolution Hierarchy...');
  {
    const tempTestDir = path.join(os.tmpdir(), `autoplan-test-${Date.now()}`);
    fs.mkdirSync(tempTestDir, { recursive: true });

    try {
      const mockBridgeServer: any = {
        captureDomSnapshot: async () => ({
          success: true,
          html: '<html><body>Sanitization Test</body></html>'
        })
      };

      // 3a. Explicit workspaceName with special characters
      const orchExplicit = new Orchestrator({
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: ''
        }),
        bridgeServer: mockBridgeServer,
        workspaceName: 'My Project (Testing) @2026/Special#Name!'
      });

      const savedPath1 = await orchExplicit.saveWorkbenchSnapshot({
        phaseIndex: 0,
        phaseName: 'phase-01',
        attempt: 1,
        triggerType: 'initial'
      });

      assert.ok(savedPath1, 'Snapshot should be saved');
      const expectedSanitized = 'My_Project__Testing___2026_Special_Name_';
      const expectedDir = path.join(os.homedir(), '.autoplan', 'snapshots', expectedSanitized);
      assert.ok(savedPath1.startsWith(expectedDir), `Path ${savedPath1} should start with ${expectedDir}`);
      console.log(`  ✓ Explicit workspace name sanitized: "${expectedSanitized}"`);

      // Clean up the created test snapshot file and directory
      if (fs.existsSync(savedPath1)) {
        fs.unlinkSync(savedPath1);
      }
      if (fs.existsSync(expectedDir)) {
        fs.rmdirSync(expectedDir);
      }

      // 3b. Fallback to activeWsFolder.name
      mockWorkspaceFolders = [{ name: 'VSCode*Workspace#Active', uri: { fsPath: '/test/ws' } }];
      const orchWsFolder = new Orchestrator({
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: ''
        }),
        bridgeServer: mockBridgeServer
      });

      const savedPath2 = await orchWsFolder.saveWorkbenchSnapshot({
        phaseIndex: 0,
        phaseName: 'phase-01',
        attempt: 1,
        triggerType: 'initial'
      });
      assert.ok(savedPath2, 'Snapshot should be saved');
      const expectedDir2 = path.join(os.homedir(), '.autoplan', 'snapshots', 'VSCode_Workspace_Active');
      assert.ok(savedPath2.startsWith(expectedDir2), `Path ${savedPath2} should start with ${expectedDir2}`);
      console.log('  ✓ Fallback to activeWsFolder.name sanitized: "VSCode_Workspace_Active"');

      if (fs.existsSync(savedPath2)) {
        fs.unlinkSync(savedPath2);
      }
      if (fs.existsSync(expectedDir2)) {
        fs.rmdirSync(expectedDir2);
      }

      // 3c. Fallback to workspacePath basename
      mockWorkspaceFolders = [];
      const orchWsPath = new Orchestrator({
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: ''
        }),
        bridgeServer: mockBridgeServer,
        workspacePath: '/home/user/projects/repo-from-path'
      });

      const savedPath3 = await orchWsPath.saveWorkbenchSnapshot({
        phaseIndex: 0,
        phaseName: 'phase-01',
        attempt: 1,
        triggerType: 'initial'
      });
      assert.ok(savedPath3, 'Snapshot should be saved');
      const expectedDir3 = path.join(os.homedir(), '.autoplan', 'snapshots', 'repo-from-path');
      assert.ok(savedPath3.startsWith(expectedDir3), `Path ${savedPath3} should start with ${expectedDir3}`);
      console.log('  ✓ Fallback to workspacePath basename: "repo-from-path"');

      if (fs.existsSync(savedPath3)) {
        fs.unlinkSync(savedPath3);
      }
      if (fs.existsSync(expectedDir3)) {
        fs.rmdirSync(expectedDir3);
      }

      // 3d. Fallback to 'default_project' when nothing is provided
      const orchDefault = new Orchestrator({
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: ''
        }),
        bridgeServer: mockBridgeServer
      });

      const savedPath4 = await orchDefault.saveWorkbenchSnapshot({
        phaseIndex: 0,
        phaseName: 'phase-01',
        attempt: 1,
        triggerType: 'initial'
      });
      assert.ok(savedPath4, 'Snapshot should be saved');
      const expectedDir4 = path.join(os.homedir(), '.autoplan', 'snapshots', 'default_project');
      assert.ok(savedPath4.startsWith(expectedDir4), `Path ${savedPath4} should start with ${expectedDir4}`);
      console.log('  ✓ Fallback to default_project: "default_project"');

      if (fs.existsSync(savedPath4)) {
        fs.unlinkSync(savedPath4);
      }
      if (fs.existsSync(expectedDir4)) {
        fs.rmdirSync(expectedDir4);
      }

      // Restore mockWorkspaceFolders
      mockWorkspaceFolders = [{ name: 'Auto-plan-Extension-main', uri: { fsPath: '/test/Auto-plan-Extension-main' } }];
    } finally {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    }
  }

  // Test Case 4: Standardized Filename Pattern Generation
  console.log('\n▶ Test 4: Standardized Filename Pattern Generation (initial vs retry)...');
  {
    const tempDir = path.join(os.tmpdir(), `autoplan-filename-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const mockBridgeServer: any = {
        captureDomSnapshot: async () => ({
          success: true,
          html: '<!DOCTYPE html><html><body>Test</body></html>'
        })
      };

      const orch = new Orchestrator({
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: tempDir
        }),
        bridgeServer: mockBridgeServer
      });

      // 4a. Initial trigger: phase index 0 (Phase 01), attempt 1
      const initialPath = await orch.saveWorkbenchSnapshot({
        phaseIndex: 0,
        phaseName: 'phase-01-scaffold',
        attempt: 1,
        triggerType: 'initial'
      });
      assert.ok(initialPath, 'initialPath should be returned');
      const initialFileName = path.basename(initialPath);
      console.log(`  Initial filename: ${initialFileName}`);
      const initialPattern = /^snapshot_phase_01_initial_attempt_1_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.html$/;
      assert.ok(
        initialPattern.test(initialFileName),
        `Filename "${initialFileName}" must match pattern ${initialPattern}`
      );

      // 4b. Retry trigger: phase index 4 (Phase 05), attempt 3
      const retryPath = await orch.saveWorkbenchSnapshot({
        phaseIndex: 4,
        phaseName: 'phase-05-e2e',
        attempt: 3,
        triggerType: 'retry'
      });
      assert.ok(retryPath, 'retryPath should be returned');
      const retryFileName = path.basename(retryPath);
      console.log(`  Retry filename: ${retryFileName}`);
      const retryPattern = /^snapshot_phase_05_retry_attempt_3_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.html$/;
      assert.ok(
        retryPattern.test(retryFileName),
        `Filename "${retryFileName}" must match pattern ${retryPattern}`
      );

      // 4c. Multi-digit phase index: phase index 11 (Phase 12), attempt 5
      const multiDigitPath = await orch.saveWorkbenchSnapshot({
        phaseIndex: 11,
        phaseName: 'phase-12-final',
        attempt: 5,
        triggerType: 'retry'
      });
      assert.ok(multiDigitPath, 'multiDigitPath should be returned');
      const multiDigitFileName = path.basename(multiDigitPath);
      console.log(`  Multi-digit filename: ${multiDigitFileName}`);
      const multiDigitPattern = /^snapshot_phase_12_retry_attempt_5_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.html$/;
      assert.ok(
        multiDigitPattern.test(multiDigitFileName),
        `Filename "${multiDigitFileName}" must match pattern ${multiDigitPattern}`
      );

      console.log('  ✓ Verified: Filename patterns correctly encode phase index, trigger type, attempt, and timestamp.');
    } finally {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }

  // Test Case 5: File Creation, Directory Creation & Byte-for-Byte Content Integrity
  console.log('\n▶ Test 5: File Creation, Directory Creation & Byte-for-Byte Content Integrity...');
  const testRootDir = path.join(os.tmpdir(), `autoplan-nested-dir-${Date.now()}`);
  const subTargetDir = path.join(testRootDir, 'deep', 'snapshots');
  assert.strictEqual(fs.existsSync(subTargetDir), false, 'Target dir should not exist initially');

  try {
    const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Workbench Snapshot - AutoPlan Verification</title>
  <style>body { background: #1e1e1e; color: #fff; }</style>
</head>
<body>
  <div id="workbench.main.container">
    <div class="monaco-workbench">
      <div class="part activitybar"></div>
      <div class="part sidebar">
        <div class="title">PLAN EXECUTION DASHBOARD</div>
      </div>
      <div class="part editor">
        <div class="view-lines">const a = 42;</div>
      </div>
    </div>
  </div>
</body>
</html>`;

    let capturedTimeout: number | undefined;
    const mockBridgeServer: any = {
      captureDomSnapshot: async (timeoutMs: number) => {
        capturedTimeout = timeoutMs;
        return {
          success: true,
          html: sampleHtml
        };
      }
    };

    const logs: Array<{ level: string; tag: string; message: string }> = [];
    const testLogger: any = {
      info: (tag: string, message: string) => logs.push({ level: 'INFO', tag, message }),
      warn: (tag: string, message: string) => logs.push({ level: 'WARN', tag, message }),
      error: (tag: string, message: string) => logs.push({ level: 'ERROR', tag, message }),
      registerPlanAuditProvider: () => {}
    };

    const orch = new Orchestrator({
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        enableDomSnapshots: true,
        domSnapshotFolder: subTargetDir
      }),
      bridgeServer: mockBridgeServer,
      debugLogger: testLogger
    });

    const savedPath = await orch.saveWorkbenchSnapshot({
      phaseIndex: 1,
      phaseName: 'phase-02-config',
      attempt: 1,
      triggerType: 'initial'
    });

    assert.ok(savedPath, 'Should return saved file path');
    assert.strictEqual(capturedTimeout, 6000, 'BridgeServer.captureDomSnapshot should be called with 6000ms timeout');
    assert.ok(fs.existsSync(subTargetDir), 'Target directory must be created recursively');
    assert.ok(fs.existsSync(savedPath), `Snapshot file ${savedPath} must exist on disk`);

    const fileContent = fs.readFileSync(savedPath, 'utf8');
    assert.strictEqual(fileContent, sampleHtml, 'File content on disk must match captured HTML byte-for-byte');

    const loggedInfo = logs.find(l => l.level === 'INFO' && l.message.includes('[DOM-SNAPSHOT] Saved workbench snapshot'));
    assert.ok(loggedInfo, 'Should log info message with [DOM-SNAPSHOT]');
    assert.ok(loggedInfo.message.includes(savedPath), 'Log message should contain the saved file path');

    console.log(`  ✓ Verified: Target dir created, file saved (${(fileContent.length / 1024).toFixed(1)} KB), content matches byte-for-byte.`);
  } finally {
    if (fs.existsSync(testRootDir)) {
      fs.rmSync(testRootDir, { recursive: true, force: true });
    }
  }

  // Test Case 6: Non-Blocking Fault Tolerance (Never Throws)
  console.log('\n▶ Test 6: Non-Blocking Fault Tolerance (Never Throws on Failure)...');
  {
    const logs: Array<{ level: string; tag: string; message: string }> = [];
    const testLogger: any = {
      info: (tag: string, message: string) => logs.push({ level: 'INFO', tag, message }),
      warn: (tag: string, message: string) => logs.push({ level: 'WARN', tag, message }),
      error: (tag: string, message: string) => logs.push({ level: 'ERROR', tag, message }),
      registerPlanAuditProvider: () => {}
    };

    // 6a: BridgeServer returns error response
    const mockFailingServer: any = {
      captureDomSnapshot: async () => ({
        success: false,
        error: 'Bridge socket connection closed'
      })
    };

    const orchFail = new Orchestrator({
      configProvider: () => ({ ...DEFAULT_CONFIG, enableDomSnapshots: true }),
      bridgeServer: mockFailingServer,
      debugLogger: testLogger
    });

    const resFail = await orchFail.saveWorkbenchSnapshot({
      phaseIndex: 0,
      phaseName: 'phase-01',
      attempt: 1,
      triggerType: 'initial'
    });
    assert.strictEqual(resFail, undefined, 'Must return undefined when capture returns success: false');
    assert.ok(
      logs.some(l => l.level === 'WARN' && l.message.includes('Bridge socket connection closed')),
      'Must log warning with failure error message'
    );
    console.log('  ✓ 6a: Graceful handling of { success: false, error } without throwing.');

    // 6b: BridgeServer throws an exception
    const mockThrowingServer: any = {
      captureDomSnapshot: async () => {
        throw new Error('IPC Bridge catastrophic failure');
      }
    };

    const orchThrow = new Orchestrator({
      configProvider: () => ({ ...DEFAULT_CONFIG, enableDomSnapshots: true }),
      bridgeServer: mockThrowingServer,
      debugLogger: testLogger
    });

    const resThrow = await orchThrow.saveWorkbenchSnapshot({
      phaseIndex: 0,
      phaseName: 'phase-01',
      attempt: 1,
      triggerType: 'initial'
    });
    assert.strictEqual(resThrow, undefined, 'Must return undefined when capture throws');
    assert.ok(
      logs.some(l => l.level === 'WARN' && l.message.includes('IPC Bridge catastrophic failure')),
      'Must log warning when exception occurs'
    );
    console.log('  ✓ 6b: Graceful handling of thrown exception without unhandled rejection.');

    // 6c: BridgeServer returns invalid HTML
    const mockNullHtmlServer: any = {
      captureDomSnapshot: async () => ({
        success: true,
        html: undefined
      })
    };

    const orchNullHtml = new Orchestrator({
      configProvider: () => ({ ...DEFAULT_CONFIG, enableDomSnapshots: true }),
      bridgeServer: mockNullHtmlServer,
      debugLogger: testLogger
    });

    const resNullHtml = await orchNullHtml.saveWorkbenchSnapshot({
      phaseIndex: 0,
      phaseName: 'phase-01',
      attempt: 1,
      triggerType: 'initial'
    });
    assert.strictEqual(resNullHtml, undefined, 'Must return undefined when HTML is missing');
    console.log('  ✓ 6c: Graceful handling of missing HTML string.');
  }

  console.log('\n=================================================================');
  console.log('✔ ALL PHASE 02 TESTS PASSED SUCCESSFULLY');
  console.log('=================================================================');
}

runPhase02Tests().catch((err) => {
  console.error('\n✖ PHASE 02 TEST FAILED:', err);
  process.exit(1);
});
