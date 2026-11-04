// Standalone mock for 'vscode' module when executed directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {};
const globalExecutedCommands: { command: string; args: any[]; timestamp: number }[] = [];
let mockAppRoot: string | undefined = undefined;
let mockCanWriteWorkbench = true;
const registeredCommandHandlers: Record<string, (...args: any[]) => any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          { name: 'test-workspace', uri: { fsPath: '/mock/workspace' } }
        ],
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) =>
            mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            mockConfigStore[key] = val;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} })
      },
      env: {
        get appRoot() {
          return mockAppRoot;
        }
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      window: {
        showInformationMessage: async (_msg: string, ..._items: string[]) => undefined,
        showErrorMessage: async (_msg: string, ..._items: string[]) => undefined,
        showWarningMessage: async (_msg: string, ..._items: string[]) => undefined,
        createStatusBarItem: (_alignment?: any, _priority?: any) => ({
          text: '',
          tooltip: '',
          command: '',
          show: () => {},
          hide: () => {},
          dispose: () => {}
        })
      },
      commands: {
        registerCommand: (command: string, callback: (...args: any[]) => any) => {
          registeredCommandHandlers[command] = callback;
          return { dispose: () => { delete registeredCommandHandlers[command]; } };
        },
        executeCommand: async (cmd: string, ...args: any[]) => {
          globalExecutedCommands.push({ command: cmd, args, timestamp: Date.now() });
          if (registeredCommandHandlers[cmd]) {
            return await registeredCommandHandlers[cmd](...args);
          }
          return undefined;
        },
        getCommands: async () => [
          'antigravity.startNewConversation',
          'antigravity.addContext',
          'antigravity.triggerSend',
          'antigravity.prioritized.chat.stop',
          'autoplan.cleanWorkbench',
          'autoplan.testNativeDispatch'
        ]
      },
      Uri: {
        file: (p: string) => ({ fsPath: p })
      },
      StatusBarAlignment: { Left: 1, Right: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  TAG_START,
  TAG_END,
  BACKUP_SUFFIX,
  LEGACY_BACKUP_SUFFIX,
  DEFAULT_BRIDGE_SCRIPT_NAME,
  cleanWorkbenchHtml,
  cleanWorkbenchHtmlAsync,
  cleanWorkbench,
  cleanWorkbenchAsync,
  uninstallBridgeScript,
  uninstallBridgeScriptAsync,
  removeBridgeTagsFromHtml,
  isBridgeInstalled,
  getWorkbenchPath,
  canWriteWorkbenchPath
} from '../workbenchInjector';
import {
  cleanWorkbench as extensionCleanWorkbench,
  performStartupWorkbenchCleanup,
  updateBridgeStatusBar,
  getBridgeStatusBarItem,
  setBridgeStatusBarItem
} from '../extension';

async function runPhase03Tests() {
  console.log('========================================================================');
  console.log(' Phase 03: Workbench Cleanup & Package Manifest Modernization Test Suite');
  console.log('========================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    totalTests++;
    process.stdout.write(`  Test ${totalTests}: ${name} ... `);
    try {
      await fn();
      console.log('✓ PASS');
      passedTests++;
    } catch (err: any) {
      console.log('✗ FAIL');
      console.error(err);
      throw err;
    }
  }

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-test-'));

  const sampleCleanHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Google Antigravity IDE</title>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="workbench.desktop.main.css">
  <script src="workbench.desktop.main.js"></script>
</head>
<body class="vs-dark">
  <div id="workbench.main.container">Workbench Content</div>
</body>
</html>`;

  const sampleInjectedHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Google Antigravity IDE</title>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="workbench.desktop.main.css">
  <script src="workbench.desktop.main.js"></script>
</head>
<body class="vs-dark">
  <div id="workbench.main.container">Workbench Content</div>
\t${TAG_START}
\t<script src="autoplan-dom-bridge.js?v=1730000000000"></script>
\t${TAG_END}
</body>
</html>`;

  try {
    // -------------------------------------------------------------------------
    // Suite 1: Synchronous Workbench Cleanup & In-Place Restoration
    // -------------------------------------------------------------------------
    console.log('--- Suite 1: Synchronous Workbench Cleanup & In-Place Restoration ---');

    await test('cleanWorkbenchHtml successfully strips legacy bridge tags from workbench.html', () => {
      const suiteDir = path.join(testTempDir, 'suite1-clean');
      fs.mkdirSync(suiteDir, { recursive: true });
      const mockWb = path.join(suiteDir, 'workbench.html');
      fs.writeFileSync(mockWb, sampleInjectedHtml, 'utf8');

      assert.strictEqual(isBridgeInstalled(mockWb), true, 'File must initially be recognized as having bridge tags');

      const result = cleanWorkbenchHtml({ workbenchPath: mockWb, updateChecksums: false });
      assert.strictEqual(result.success, true, 'cleanWorkbenchHtml must succeed');
      assert.strictEqual(result.modified, true, 'cleanWorkbenchHtml must mark file as modified');

      const restored = fs.readFileSync(mockWb, 'utf8');
      assert.strictEqual(restored.includes(TAG_START), false, 'TAG_START must be removed');
      assert.strictEqual(restored.includes(TAG_END), false, 'TAG_END must be removed');
      assert.strictEqual(restored.includes('autoplan-dom-bridge.js'), false, 'Bridge script reference must be removed');
      assert.strictEqual(restored.includes('Workbench Content'), true, 'Original workbench content must remain intact');
      assert.strictEqual(isBridgeInstalled(mockWb), false, 'isBridgeInstalled must return false after cleanup');
    });

    await test('cleanWorkbenchHtml is strictly idempotent: no writes or corruption on already clean file', () => {
      const suiteDir = path.join(testTempDir, 'suite1-idempotent');
      fs.mkdirSync(suiteDir, { recursive: true });
      const mockWb = path.join(suiteDir, 'workbench.html');
      fs.writeFileSync(mockWb, sampleCleanHtml, 'utf8');

      const initialStat = fs.statSync(mockWb);

      // Run cleanup on clean file
      const result1 = cleanWorkbenchHtml({ workbenchPath: mockWb, updateChecksums: false });
      assert.strictEqual(result1.success, true, 'First clean run must succeed');
      assert.strictEqual(result1.modified, false, 'No modification should be reported on clean file');

      // Verify content is unchanged
      const contentAfter1 = fs.readFileSync(mockWb, 'utf8');
      assert.strictEqual(contentAfter1, sampleCleanHtml, 'Content must remain verbatim');

      // Run multiple successive cleanups in a loop
      for (let i = 2; i <= 5; i++) {
        const loopResult = cleanWorkbenchHtml({ workbenchPath: mockWb, updateChecksums: false });
        assert.strictEqual(loopResult.success, true, `Clean run ${i} must succeed`);
        assert.strictEqual(loopResult.modified, false, `Clean run ${i} must not modify file`);
      }

      const finalContent = fs.readFileSync(mockWb, 'utf8');
      assert.strictEqual(finalContent, sampleCleanHtml, 'Content must stay verbatim after multiple no-ops');
    });

    await test('cleanWorkbenchHtml removes sidecar autoplan-dom-bridge.js file if present', () => {
      const suiteDir = path.join(testTempDir, 'suite1-sidecar');
      fs.mkdirSync(suiteDir, { recursive: true });
      const mockWb = path.join(suiteDir, 'workbench.html');
      const mockSidecar = path.join(suiteDir, DEFAULT_BRIDGE_SCRIPT_NAME);

      fs.writeFileSync(mockWb, sampleInjectedHtml, 'utf8');
      fs.writeFileSync(mockSidecar, 'console.log("sidecar script");', 'utf8');
      assert.ok(fs.existsSync(mockSidecar), 'Sidecar script must initially exist');

      const result = cleanWorkbenchHtml({ workbenchPath: mockWb, updateChecksums: false });
      assert.strictEqual(result.success, true);
      assert.strictEqual(fs.existsSync(mockSidecar), false, 'Sidecar script must be deleted upon cleanup');
    });

    // -------------------------------------------------------------------------
    // Suite 2: Asynchronous Workbench Cleanup
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 2: Asynchronous Workbench Cleanup ---');

    await test('cleanWorkbenchHtmlAsync cleans tags asynchronously and respects idempotency', async () => {
      const suiteDir = path.join(testTempDir, 'suite2-async');
      await fs.promises.mkdir(suiteDir, { recursive: true });
      const mockWb = path.join(suiteDir, 'workbench.html');
      await fs.promises.writeFile(mockWb, sampleInjectedHtml, 'utf8');

      const result = await cleanWorkbenchHtmlAsync({ workbenchPath: mockWb, updateChecksums: false });
      assert.strictEqual(result.success, true, 'Async cleanup must succeed');
      assert.strictEqual(result.modified, true, 'Async cleanup must report modified');

      const cleanedContent = await fs.promises.readFile(mockWb, 'utf8');
      assert.strictEqual(cleanedContent.includes(TAG_START), false);
      assert.strictEqual(cleanedContent.includes(TAG_END), false);

      // Idempotency re-check asynchronously
      const secondResult = await cleanWorkbenchHtmlAsync({ workbenchPath: mockWb, updateChecksums: false });
      assert.strictEqual(secondResult.success, true);
      assert.strictEqual(secondResult.modified, false, 'Async re-run must be a no-op');
    });

    await test('cleanWorkbench and cleanWorkbenchAsync aliases match cleanWorkbenchHtml', async () => {
      assert.strictEqual(cleanWorkbench, cleanWorkbenchHtml, 'cleanWorkbench must alias cleanWorkbenchHtml');
      assert.strictEqual(cleanWorkbenchAsync, cleanWorkbenchHtmlAsync, 'cleanWorkbenchAsync must alias cleanWorkbenchHtmlAsync');
      assert.strictEqual(typeof uninstallBridgeScript, 'function', 'uninstallBridgeScript must exist for backwards compatibility');
      assert.strictEqual(typeof uninstallBridgeScriptAsync, 'function', 'uninstallBridgeScriptAsync must exist for backwards compatibility');
    });

    // -------------------------------------------------------------------------
    // Suite 3: Backup Reconciliation and Preservation
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 3: Backup Reconciliation (.autoplan.backup / .autoplan.bak) ---');

    await test('Cleanup safely reconciles in-place and removes obsolete .autoplan.backup and .autoplan.bak', () => {
      const suiteDir = path.join(testTempDir, 'suite3-reconcile');
      fs.mkdirSync(suiteDir, { recursive: true });
      const mockWb = path.join(suiteDir, 'workbench.html');
      const mockBak1 = `${mockWb}${BACKUP_SUFFIX}`; // .autoplan.bak
      const mockBak2 = `${mockWb}${LEGACY_BACKUP_SUFFIX}`; // .autoplan.backup

      // Simulate VS Code v1.89 active workbench with bridge tags
      const v189Markup = `<!DOCTYPE html><html><body><h1>VS Code 1.89</h1>${TAG_START}<script src="autoplan-dom-bridge.js"></script>${TAG_END}</body></html>`;
      // Stale v1.88 backups
      const v188Markup = `<!DOCTYPE html><html><body><h1>VS Code 1.88</h1></body></html>`;

      fs.writeFileSync(mockWb, v189Markup, 'utf8');
      fs.writeFileSync(mockBak1, v188Markup, 'utf8');
      fs.writeFileSync(mockBak2, v188Markup, 'utf8');

      const result = cleanWorkbenchHtml({ workbenchPath: mockWb, updateChecksums: false });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.modified, true);

      // Active workbench must retain v1.89 code and not be clobbered by stale v1.88 backup
      const restoredHtml = fs.readFileSync(mockWb, 'utf8');
      assert.ok(restoredHtml.includes('VS Code 1.89'), 'Must retain active workbench version 1.89');
      assert.strictEqual(restoredHtml.includes('VS Code 1.88'), false, 'Must not be overwritten by obsolete v1.88 backup');
      assert.strictEqual(restoredHtml.includes(TAG_START), false, 'Must not contain TAG_START');

      // Obsolete backups should be cleanly purged
      assert.strictEqual(fs.existsSync(mockBak1), false, 'Stale .autoplan.bak must be removed');
      assert.strictEqual(fs.existsSync(mockBak2), false, 'Stale .autoplan.backup must be removed');
    });

    await test('Cleanup preserves backup integrity when preserveBackup option is enabled', () => {
      const suiteDir = path.join(testTempDir, 'suite3-preserve');
      fs.mkdirSync(suiteDir, { recursive: true });
      const mockWb = path.join(suiteDir, 'workbench.html');
      const mockBackup = `${mockWb}${LEGACY_BACKUP_SUFFIX}`;

      fs.writeFileSync(mockWb, sampleInjectedHtml, 'utf8');
      fs.writeFileSync(mockBackup, sampleInjectedHtml, 'utf8');

      const result = cleanWorkbenchHtml({
        workbenchPath: mockWb,
        preserveBackup: true,
        updateChecksums: false
      });
      assert.strictEqual(result.success, true);

      // Both workbench.html and .autoplan.backup must be preserved and cleaned of bridge tags
      assert.ok(fs.existsSync(mockBackup), 'Backup file must still exist when preserveBackup is true');
      const backupContent = fs.readFileSync(mockBackup, 'utf8');
      assert.strictEqual(backupContent.includes(TAG_START), false, 'Backup file tags must be cleaned');
      assert.ok(backupContent.includes('Workbench Content'), 'Backup file original content preserved');
    });

    // -------------------------------------------------------------------------
    // Suite 4: Tag Stripping Edge Cases & Malformed Markers
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 4: Malformed Markers & Tag Stripping Edge Cases ---');

    await test('removeBridgeTagsFromHtml handles partial or orphan bridge tags cleanly', () => {
      const partialStart = `<body><div>Content</div>\n${TAG_START}\n<script src="autoplan-dom-bridge.js"></script>\n</body>`;
      const cleanedStart = removeBridgeTagsFromHtml(partialStart);
      assert.strictEqual(cleanedStart.includes(TAG_START), false);
      assert.ok(cleanedStart.includes('Content'));

      const partialEnd = `<body><div>Content</div>\n<script src="autoplan-dom-bridge.js"></script>\n${TAG_END}\n</body>`;
      const cleanedEnd = removeBridgeTagsFromHtml(partialEnd);
      assert.strictEqual(cleanedEnd.includes(TAG_END), false);
      assert.ok(cleanedEnd.includes('Content'));

      const unadornedScript = `<body><div>Content</div>\n<script src="autoplan-dom-bridge.js?v=999"></script>\n</body>`;
      const cleanedScript = removeBridgeTagsFromHtml(unadornedScript);
      assert.strictEqual(cleanedScript.includes('autoplan-dom-bridge.js'), false);
      assert.ok(cleanedScript.includes('Content'));
    });

    await test('cleanWorkbenchHtml returns fail-safe result for non-existent path', () => {
      const result = cleanWorkbenchHtml({ workbenchPath: '/non/existent/path/workbench.html' });
      assert.strictEqual(result.success, false);
      assert.ok(String(result.error).includes('not found'));
    });

    // -------------------------------------------------------------------------
    // Suite 5: Extension Startup Hook & Command Handler Behavior
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 5: Extension Startup Hook & Commands in extension.ts ---');

    await test('performStartupWorkbenchCleanup detects and cleans legacy bridge tags during startup', async () => {
      const suiteDir = path.join(testTempDir, 'suite5-startup-clean');
      fs.mkdirSync(suiteDir, { recursive: true });
      const mockWb = path.join(suiteDir, 'workbench.html');
      fs.writeFileSync(mockWb, sampleInjectedHtml, 'utf8');

      // Set custom appRoot for VS Code environment discovery
      mockAppRoot = suiteDir;

      assert.strictEqual(isBridgeInstalled(mockWb), true);

      // Execute startup cleanup hook
      await performStartupWorkbenchCleanup();

      assert.strictEqual(isBridgeInstalled(mockWb), false, 'Startup cleanup must have stripped bridge tags');
      const content = fs.readFileSync(mockWb, 'utf8');
      assert.strictEqual(content.includes(TAG_START), false);
      assert.ok(content.includes('Workbench Content'));
    });

    await test('performStartupWorkbenchCleanup safely no-ops on already clean workbench', async () => {
      const suiteDir = path.join(testTempDir, 'suite5-startup-noop');
      fs.mkdirSync(suiteDir, { recursive: true });
      const mockWb = path.join(suiteDir, 'workbench.html');
      fs.writeFileSync(mockWb, sampleCleanHtml, 'utf8');

      mockAppRoot = suiteDir;

      let threw = false;
      try {
        await performStartupWorkbenchCleanup();
      } catch {
        threw = true;
      }
      assert.strictEqual(threw, false, 'Startup cleanup must not throw on clean file');
      assert.strictEqual(fs.readFileSync(mockWb, 'utf8'), sampleCleanHtml);
    });

    await test('cleanWorkbench extension command function executes restoration cleanly', async () => {
      const suiteDir = path.join(testTempDir, 'suite5-cmd');
      fs.mkdirSync(suiteDir, { recursive: true });
      const mockWb = path.join(suiteDir, 'workbench.html');
      fs.writeFileSync(mockWb, sampleInjectedHtml, 'utf8');

      mockAppRoot = suiteDir;

      const success = await extensionCleanWorkbench();
      assert.strictEqual(success, true, 'extensionCleanWorkbench must return true');
      assert.strictEqual(isBridgeInstalled(mockWb), false, 'Bridge tags must be cleaned');
    });

    await test('performStartupWorkbenchCleanup handles unwriteable workbench fail-safe without throwing', async () => {
      const suiteDir = path.join(testTempDir, 'suite5-unwriteable');
      fs.mkdirSync(suiteDir, { recursive: true });
      const mockWb = path.join(suiteDir, 'workbench.html');
      fs.writeFileSync(mockWb, sampleInjectedHtml, 'utf8');

      mockAppRoot = suiteDir;

      // Attempt to make file read-only
      try {
        fs.chmodSync(mockWb, 0o444);
      } catch {}

      let threw = false;
      try {
        await performStartupWorkbenchCleanup();
      } catch {
        threw = true;
      } finally {
        try {
          fs.chmodSync(mockWb, 0o666);
        } catch {}
      }

      assert.strictEqual(threw, false, 'performStartupWorkbenchCleanup must not throw when workbench is unwriteable');
    });

    await test('vscode command autoplan.cleanWorkbench and autoplan.testNativeDispatch are registered', async () => {
      const vscode = require('vscode');
      const cmds = await vscode.commands.getCommands();
      assert.ok(cmds.includes('autoplan.cleanWorkbench'), 'Commands list must contain autoplan.cleanWorkbench');
      assert.ok(cmds.includes('autoplan.testNativeDispatch'), 'Commands list must contain autoplan.testNativeDispatch');
    });

    // -------------------------------------------------------------------------
    // Suite 6: Package Manifest Modernization Validation (package.json)
    // -------------------------------------------------------------------------
    console.log('\n--- Suite 6: Package Manifest Modernization (package.json) ---');

    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    await test('package.json contributes autoplan.sendDelayMs with integer type and default 500', () => {
      const props = pkg.contributes?.configuration?.properties;
      assert.ok(props, 'contributes.configuration.properties must exist');
      const sendDelayProp = props['autoplan.sendDelayMs'];
      assert.ok(sendDelayProp, 'autoplan.sendDelayMs must be registered in properties');
      assert.strictEqual(sendDelayProp.type, 'integer', 'sendDelayMs type must be integer');
      assert.strictEqual(sendDelayProp.default, 500, 'sendDelayMs default must be 500');
      assert.strictEqual(sendDelayProp.minimum, 0, 'sendDelayMs minimum must be 0');
      assert.ok(sendDelayProp.description && sendDelayProp.description.length > 10, 'sendDelayMs must have a descriptive message');
    });

    await test('package.json deprecates obsolete tier configuration properties', () => {
      const props = pkg.contributes?.configuration?.properties;

      // 1. executionMode
      assert.ok(props['autoplan.executionMode'], 'autoplan.executionMode must exist');
      assert.ok(
        props['autoplan.executionMode'].markdownDeprecationMessage,
        'executionMode must have markdownDeprecationMessage'
      );

      // 2. allowTierFallback
      assert.ok(props['autoplan.allowTierFallback'], 'autoplan.allowTierFallback must exist');
      assert.ok(
        props['autoplan.allowTierFallback'].markdownDeprecationMessage,
        'allowTierFallback must have markdownDeprecationMessage'
      );

      // 3. strictMode
      assert.ok(props['autoplan.strictMode'], 'autoplan.strictMode must exist');
      assert.ok(
        props['autoplan.strictMode'].markdownDeprecationMessage,
        'strictMode must have markdownDeprecationMessage'
      );

      // 4. bridgeTimeoutMs
      assert.ok(props['autoplan.bridgeTimeoutMs'], 'autoplan.bridgeTimeoutMs must exist');
      assert.ok(
        props['autoplan.bridgeTimeoutMs'].markdownDeprecationMessage,
        'bridgeTimeoutMs must have markdownDeprecationMessage'
      );

      // 5. autoInjectWorkbench
      assert.ok(props['autoplan.autoInjectWorkbench'], 'autoplan.autoInjectWorkbench must exist');
      assert.ok(
        props['autoplan.autoInjectWorkbench'].markdownDeprecationMessage,
        'autoInjectWorkbench must have markdownDeprecationMessage'
      );
      assert.strictEqual(props['autoplan.autoInjectWorkbench'].default, false, 'autoInjectWorkbench default must be false');
    });

    await test('package.json commands remove manual DOM bridge injection commands', () => {
      const commands = pkg.contributes?.commands || [];
      const commandNames = commands.map((c: any) => c.command);

      // Manual DOM bridge injection commands must be removed
      assert.strictEqual(
        commandNames.includes('autoplan.installBridge'),
        false,
        'autoplan.installBridge must be removed from contributes.commands'
      );
      assert.strictEqual(
        commandNames.includes('autoplan.oneClickSetup'),
        false,
        'autoplan.oneClickSetup must be removed from contributes.commands'
      );

      // activationEvents must also remove them
      const actEvents = pkg.activationEvents || [];
      assert.strictEqual(
        actEvents.includes('onCommand:autoplan.installBridge'),
        false,
        'onCommand:autoplan.installBridge must be removed from activationEvents'
      );
      assert.strictEqual(
        actEvents.includes('onCommand:autoplan.oneClickSetup'),
        false,
        'onCommand:autoplan.oneClickSetup must be removed from activationEvents'
      );
    });

    await test('package.json contributes modern native dispatch and cleanup commands', () => {
      const commands = pkg.contributes?.commands || [];
      const commandNames = commands.map((c: any) => c.command);

      assert.ok(
        commandNames.includes('autoplan.cleanWorkbench'),
        'autoplan.cleanWorkbench must be registered in contributes.commands'
      );
      assert.ok(
        commandNames.includes('autoplan.testNativeDispatch'),
        'autoplan.testNativeDispatch must be registered in contributes.commands'
      );

      const actEvents = pkg.activationEvents || [];
      assert.ok(
        actEvents.includes('onCommand:autoplan.cleanWorkbench'),
        'onCommand:autoplan.cleanWorkbench must be registered in activationEvents'
      );
      assert.ok(
        actEvents.includes('onCommand:autoplan.testNativeDispatch'),
        'onCommand:autoplan.testNativeDispatch must be registered in activationEvents'
      );
    });

    await test('package.json commands do not contain obsolete Tier references in titles', () => {
      const commands = pkg.contributes?.commands || [];
      for (const cmd of commands) {
        const title = cmd.title || '';
        assert.strictEqual(
          /Tier\s*[123]/i.test(title),
          false,
          `Command ${cmd.command} title "${title}" must not contain obsolete Tier references`
        );
      }
    });

  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(` Summary: All ${passedTests}/${totalTests} tests PASSED cleanly!`);
  console.log('========================================================================\n');
}

runPhase03Tests().catch((err) => {
  console.error('\n❌ Phase 03 Tests FAILED:');
  console.error(err);
  process.exit(1);
});
