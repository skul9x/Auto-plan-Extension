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
      StatusBarAlignment: { Left: 1, Right: 2 },
      env: { appRoot: undefined },
      Uri: { file: (p: string) => ({ fsPath: p }) }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

async function runPhase02Verification() {
  console.log('================================================================');
  console.log(' Phase 02: Config & Schema Auto-Approve Removal Test');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '../..');

  // -------------------------------------------------------------------------
  // 1. package.json Schema Verification
  // -------------------------------------------------------------------------
  console.log('[Test 1] Inspecting package.json configuration schema...');
  const packageJsonPath = path.join(rootDir, 'package.json');
  assert.ok(fs.existsSync(packageJsonPath), 'package.json must exist');

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const configProperties = pkg.contributes?.configuration?.properties;
  assert.ok(configProperties, 'package.json contributes.configuration.properties must be defined');

  // Verify autoplan.autoApprovePermissions is absent
  assert.strictEqual(
    configProperties['autoplan.autoApprovePermissions'],
    undefined,
    'autoplan.autoApprovePermissions must be completely absent from package.json'
  );

  // Scan all config keys to ensure no lingering auto-approve keys
  const lingeringKeys = Object.keys(configProperties).filter(k => /autoapprove/i.test(k));
  assert.deepStrictEqual(
    lingeringKeys,
    [],
    `No keys matching autoapprove pattern should exist in package.json, found: ${lingeringKeys.join(', ')}`
  );

  // Verify sibling properties are intact
  assert.ok(configProperties['autoplan.executionMode'], 'autoplan.executionMode must exist');
  assert.ok(configProperties['autoplan.autoInjectWorkbench'], 'autoplan.autoInjectWorkbench must exist');
  assert.ok(configProperties['autoplan.staleClientMs'], 'autoplan.staleClientMs must exist');
  assert.ok(configProperties['autoplan.bridgeTimeoutMs'], 'autoplan.bridgeTimeoutMs must exist');
  console.log('  ✓ Verified: package.json schema has zero auto-approve entries and sibling properties are preserved.\n');

  // -------------------------------------------------------------------------
  // 2. src/config.ts Source Code Cleanliness
  // -------------------------------------------------------------------------
  console.log('[Test 2] Inspecting src/config.ts source code...');
  const configTsPath = path.join(rootDir, 'src/config.ts');
  assert.ok(fs.existsSync(configTsPath), 'src/config.ts must exist');
  const configTsContent = fs.readFileSync(configTsPath, 'utf8');

  assert.strictEqual(
    configTsContent.includes('autoApprovePermissions'),
    false,
    'src/config.ts must not contain any reference to autoApprovePermissions'
  );
  console.log('  ✓ Verified: src/config.ts source code is completely free of autoApprovePermissions.\n');

  // -------------------------------------------------------------------------
  // 3. Runtime DEFAULT_CONFIG and getConfig() Verification
  // -------------------------------------------------------------------------
  console.log('[Test 3] Verifying runtime DEFAULT_CONFIG, getConfig(), and config serialization...');
  const configModule = require(path.join(rootDir, 'out/config'));
  const { DEFAULT_CONFIG, getConfig, writeConfigJson, SIDECAR_CONFIG_FILENAME } = configModule;

  // Verify DEFAULT_CONFIG
  assert.strictEqual(
    (DEFAULT_CONFIG as any).autoApprovePermissions,
    undefined,
    'DEFAULT_CONFIG.autoApprovePermissions must be undefined'
  );
  assert.strictEqual(
    'autoApprovePermissions' in DEFAULT_CONFIG,
    false,
    'DEFAULT_CONFIG must not own autoApprovePermissions property'
  );
  assert.strictEqual(
    Object.keys(DEFAULT_CONFIG).includes('autoApprovePermissions'),
    false,
    'Object.keys(DEFAULT_CONFIG) must not include autoApprovePermissions'
  );

  // Verify getConfig()
  const runtimeConfig = getConfig();
  assert.strictEqual(
    (runtimeConfig as any).autoApprovePermissions,
    undefined,
    'runtimeConfig.autoApprovePermissions must be undefined'
  );
  assert.strictEqual(
    'autoApprovePermissions' in runtimeConfig,
    false,
    'runtimeConfig must not contain autoApprovePermissions property'
  );

  // Verify writeConfigJson serialization cleanly excludes autoApprovePermissions
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-phase02-config-test-'));
  try {
    const writtenPath = writeConfigJson(runtimeConfig, tempDir);
    assert.ok(writtenPath, 'writeConfigJson should successfully return written file path');
    assert.ok(fs.existsSync(writtenPath), 'Serialized config file must exist');

    const fileContent = fs.readFileSync(writtenPath, 'utf8');
    assert.strictEqual(
      fileContent.includes('autoApprovePermissions'),
      false,
      'Serialized sidecar JSON must not contain autoApprovePermissions'
    );

    const parsed = JSON.parse(fileContent);
    assert.strictEqual(
      parsed.autoApprovePermissions,
      undefined,
      'Parsed serialized config must not have autoApprovePermissions'
    );
    assert.strictEqual(
      'autoApprovePermissions' in parsed,
      false,
      'Parsed serialized config object must not contain autoApprovePermissions key'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.log('  ✓ Verified: Runtime DEFAULT_CONFIG, getConfig(), and serialized sidecar JSON are clean.\n');

  // -------------------------------------------------------------------------
  // 4. src/extension.ts Source & Diagnostic Report Verification
  // -------------------------------------------------------------------------
  console.log('[Test 4] Inspecting src/extension.ts source code and BridgeDiagnosticReport...');
  const extensionTsPath = path.join(rootDir, 'src/extension.ts');
  assert.ok(fs.existsSync(extensionTsPath), 'src/extension.ts must exist');
  const extensionTsContent = fs.readFileSync(extensionTsPath, 'utf8');

  assert.strictEqual(
    extensionTsContent.includes('autoApprovePermissions'),
    false,
    'src/extension.ts must not contain any reference to autoApprovePermissions'
  );

  const extensionModule = require(path.join(rootDir, 'out/extension'));
  const { runBridgeDiagnostic } = extensionModule;
  assert.strictEqual(typeof runBridgeDiagnostic, 'function', 'runBridgeDiagnostic must be exported as a function');

  const diagReport = runBridgeDiagnostic();
  assert.strictEqual(
    (diagReport as any).autoApprovePermissions,
    undefined,
    'BridgeDiagnosticReport.autoApprovePermissions must be undefined'
  );
  assert.strictEqual(
    'autoApprovePermissions' in diagReport,
    false,
    'BridgeDiagnosticReport must not have autoApprovePermissions key'
  );
  assert.ok('executionMode' in diagReport, 'Diagnostic report must retain executionMode');
  assert.ok('autoInjectWorkbench' in diagReport, 'Diagnostic report must retain autoInjectWorkbench');
  assert.ok('bridgeTimeoutMs' in diagReport, 'Diagnostic report must retain bridgeTimeoutMs');
  console.log('  ✓ Verified: src/extension.ts and runBridgeDiagnostic() report have no autoApprovePermissions.\n');

  // -------------------------------------------------------------------------
  // 5. README.md Documentation Verification
  // -------------------------------------------------------------------------
  console.log('[Test 5] Inspecting README.md documentation table...');
  const readmePath = path.join(rootDir, 'README.md');
  assert.ok(fs.existsSync(readmePath), 'README.md must exist');
  const readmeContent = fs.readFileSync(readmePath, 'utf8');

  assert.strictEqual(
    readmeContent.includes('autoplan.autoApprovePermissions'),
    false,
    'README.md must not contain autoplan.autoApprovePermissions'
  );
  assert.strictEqual(
    readmeContent.includes('autoApprovePermissions'),
    false,
    'README.md must not contain autoApprovePermissions'
  );
  console.log('  ✓ Verified: README.md configuration documentation does not advertise autoApprovePermissions.\n');

  console.log('================================================================');
  console.log(' ALL PHASE 02 TESTS PASSED SUCCESSFULLY! (100% VERIFIED)');
  console.log('================================================================\n');
}

runPhase02Verification().catch(err => {
  console.error('Phase 02 Verification Test Failed:', err);
  process.exit(1);
});
