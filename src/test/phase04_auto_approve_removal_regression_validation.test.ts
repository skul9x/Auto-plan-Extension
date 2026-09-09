// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          { name: 'test-workspace', uri: { fsPath: '/mock/workspace' } }
        ],
        getConfiguration: (_section?: string) => ({
          get: (_key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
        createFileSystemWatcher: () => ({
          onDidChange: () => {},
          onDidCreate: () => {},
          onDidDelete: () => {},
          dispose: () => {}
        })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      window: {
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        registerWebviewViewProvider: () => ({ dispose: () => {} }),
        showInformationMessage: async () => {},
        showErrorMessage: async () => {},
        showWarningMessage: async () => {},
        createOutputChannel: () => ({
          appendLine: () => {},
          dispose: () => {}
        })
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: async () => {}
      },
      env: {
        appRoot: '',
        clipboard: {
          writeText: async () => {},
          readText: async () => ''
        }
      },
      Uri: {
        file: (f: string) => ({ fsPath: f, scheme: 'file' })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { DEFAULT_CONFIG, getConfig, AutoPlanConfig } from '../config';
import { runBridgeDiagnostic } from '../extension';

async function runPhase04RegressionValidationSuite() {
  console.log('========================================================================');
  console.log('=== Phase 04: Test Suite Remediation & Global Regression Validation ===');
  console.log('========================================================================\n');

  const rootDir = path.resolve(__dirname, '../../');

  // --------------------------------------------------------------------------
  // Test 1: Production Source Files Static Cleanliness Audit
  // --------------------------------------------------------------------------
  console.log('[Test 1] Auditing production source files for absence of auto-approval symbols...');

  const productionFiles = [
    { relativePath: 'media/autoplan-dom-bridge.js', banned: ['autoApprovePermissions', 'startAutoApprovalObserver', 'autoApproval'] },
    { relativePath: 'package.json', banned: ['autoApprovePermissions', 'autoplan.autoApprovePermissions'] },
    { relativePath: 'src/config.ts', banned: ['autoApprovePermissions'] },
    { relativePath: 'src/extension.ts', banned: ['autoApprovePermissions'] },
    { relativePath: 'media/settings/settings.html', banned: ['chkAutoApprovePermissions', 'autoApprovePermissions'] },
    { relativePath: 'media/settings/settings.js', banned: ['chkAutoApprovePermissions', 'autoApprovePermissions'] },
    { relativePath: 'README.md', banned: ['autoplan.autoApprovePermissions', 'autoApprovePermissions'] }
  ];

  for (const item of productionFiles) {
    const fullPath = path.join(rootDir, item.relativePath);
    assert.strictEqual(fs.existsSync(fullPath), true, `Target file must exist: ${item.relativePath}`);
    const content = fs.readFileSync(fullPath, 'utf8');

    for (const bannedSymbol of item.banned) {
      const found = content.includes(bannedSymbol);
      assert.strictEqual(
        found,
        false,
        `File ${item.relativePath} must NOT contain banned symbol '${bannedSymbol}'`
      );
    }
    console.log(`  ✓ ${item.relativePath} passed static symbol cleanliness.`);
  }

  // Deep package.json properties inspect
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const configProperties = packageJson.contributes?.configuration?.properties || {};
  const lingeringConfigKeys = Object.keys(configProperties).filter(k => /autoapprove/i.test(k));
  assert.strictEqual(
    lingeringConfigKeys.length,
    0,
    `No keys matching /autoapprove/i should exist in package.json, found: ${lingeringConfigKeys.join(', ')}`
  );
  console.log('  ✓ package.json contributes.configuration is completely free of autoApprove keys.');

  // Runtime config inspect
  assert.strictEqual(
    (DEFAULT_CONFIG as any).autoApprovePermissions,
    undefined,
    'DEFAULT_CONFIG.autoApprovePermissions must be undefined'
  );
  assert.strictEqual(
    'autoApprovePermissions' in DEFAULT_CONFIG,
    false,
    'DEFAULT_CONFIG must not have autoApprovePermissions key'
  );

  const runtimeDiag = runBridgeDiagnostic();
  assert.strictEqual(
    (runtimeDiag as any).autoApprovePermissions,
    undefined,
    'BridgeDiagnosticReport.autoApprovePermissions must be undefined'
  );
  assert.strictEqual(
    'autoApprovePermissions' in runtimeDiag,
    false,
    'BridgeDiagnosticReport must not contain autoApprovePermissions'
  );
  console.log('  ✓ Runtime DEFAULT_CONFIG and BridgeDiagnosticReport validated.\n');

  // --------------------------------------------------------------------------
  // Test 2: Test Suite Fixture Symbol Cleanliness Audit
  // --------------------------------------------------------------------------
  console.log('[Test 2] Auditing test suite fixtures for obsolete assertions and mock keys...');

  const remediatedTestFiles = [
    'src/test/phase02_settings_webview_assets.test.ts',
    'src/test/phase03_sidecar_config_watchdog.test.ts',
    'src/test/phase05_full_e2e_regression.test.ts',
    'src/test/phase02_dispatcher_handshake_and_retry.test.ts',
    'src/test/phase04_background_automation_e2e.test.ts',
    'src/test/phase04_orchestrator_conversation_isolation.test.ts',
    'src/test/phase05_e2e_cross_platform_release.test.ts',
    'src/test/phase04_zixfel_port_full_e2e_regression.test.ts',
    'src/test/phase03_e2e_cross_platform_release_fix.test.ts',
    'src/test/phase02_fast_reconnect_dispatcher.test.ts',
    'src/test/phase01_background_keepalive_engine.test.ts'
  ];

  for (const testFile of remediatedTestFiles) {
    const fullPath = path.join(rootDir, testFile);
    assert.strictEqual(fs.existsSync(fullPath), true, `Test file must exist: ${testFile}`);
    const content = fs.readFileSync(fullPath, 'utf8');

    // These files should have no autoApprovePermissions references
    assert.strictEqual(
      content.includes('autoApprovePermissions'),
      false,
      `Remediated test file ${testFile} must not contain autoApprovePermissions`
    );
    assert.strictEqual(
      content.includes('chkAutoApprovePermissions'),
      false,
      `Remediated test file ${testFile} must not contain chkAutoApprovePermissions`
    );
    console.log(`  ✓ ${testFile} verified free of obsolete autoApprove keys.`);
  }

  console.log('  ✓ All identified test files cleanly remediated.\n');

  // --------------------------------------------------------------------------
  // Test 3: In-Memory & Process Test Suite Execution Validation
  // --------------------------------------------------------------------------
  console.log('[Test 3] Executing key test suites to verify 100% green status across phases...');

  const suitesToRun = [
    { name: 'Phase 01 DOM Bridge Auto-Approve Removal', file: 'out/test/phase01_dom_bridge_auto_approve_removal.test.js' },
    { name: 'Phase 02 Config Schema Auto-Approve Removal', file: 'out/test/phase02_config_schema_auto_approve_removal.test.js' },
    { name: 'Phase 02 Settings Webview Assets', file: 'out/test/phase02_settings_webview_assets.test.js' },
    { name: 'Phase 03 Sidecar Config Watchdog', file: 'out/test/phase03_sidecar_config_watchdog.test.js' },
    { name: 'Phase 03 Settings Webview Auto-Approve Removal', file: 'out/test/phase03_settings_webview_auto_approve_removal.test.js' },
    { name: 'Phase 05 Full E2E Regression', file: 'out/test/phase05_full_e2e_regression.test.js' }
  ];

  for (const suite of suitesToRun) {
    const suitePath = path.join(rootDir, suite.file);
    assert.strictEqual(fs.existsSync(suitePath), true, `Compiled test file must exist: ${suite.file}`);

    console.log(`  -> Running ${suite.name} (${suite.file})...`);
    try {
      const output = execSync(`node "${suitePath}"`, {
        cwd: rootDir,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, NODE_ENV: 'test' }
      });
      assert.ok(output.length > 0, `Output should not be empty for ${suite.name}`);
      console.log(`     ✓ Passed with exit code 0`);
    } catch (err: any) {
      console.error(`❌ Suite failed: ${suite.name}`, err.stdout || err.message);
      throw new Error(`Suite ${suite.name} execution failed: ${err.message}`);
    }
  }

  console.log('\n========================================================================');
  console.log('🎉 PHASE 04 VALIDATION PASSED: 100% OF REMEDIATIONS & TESTS ARE GREEN! 🎉');
  console.log('========================================================================\n');
}

runPhase04RegressionValidationSuite().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('❌ Phase 04 Regression Validation Suite Failed:', err);
  process.exit(1);
});
