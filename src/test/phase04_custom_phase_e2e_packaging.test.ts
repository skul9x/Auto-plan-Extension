// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let shownInfoMessages: string[] = [];
let shownErrorMessages: string[] = [];
let shownWarningMessages: string[] = [];
let mockStatusBarItem: any = null;

const mockWorkspaceStateStore: { [key: string]: any } = {};
const mockGlobalStateStore: { [key: string]: any } = {};

const mockContext: any = {
  subscriptions: [],
  workspaceState: {
    get: (key: string, defaultVal?: any) =>
      mockWorkspaceStateStore[key] !== undefined ? mockWorkspaceStateStore[key] : defaultVal,
    update: async (key: string, val: any) => {
      mockWorkspaceStateStore[key] = val;
    }
  },
  globalState: {
    get: (key: string, defaultVal?: any) =>
      mockGlobalStateStore[key] !== undefined ? mockGlobalStateStore[key] : defaultVal,
    update: async (key: string, val: any) => {
      mockGlobalStateStore[key] = val;
    }
  }
};

class MockThemeIcon {
  constructor(public id: string) {}
}

const MockQuickInputButtons = {
  Back: { iconPath: new MockThemeIcon('arrow-left'), tooltip: 'Back' }
};

class MockMarkdownString {
  public value: string;
  public isTrusted: boolean = false;
  constructor(value: string) {
    this.value = value;
  }
}

let mockActiveTextEditor: any = undefined;

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      ThemeIcon: MockThemeIcon,
      QuickInputButtons: MockQuickInputButtons,
      MarkdownString: MockMarkdownString,
      StatusBarAlignment: { Left: 1, Right: 2 },
      workspace: {
        workspaceFolders: [],
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        }),
        onDidChangeConfiguration: (_cb: any) => ({
          dispose: () => {}
        }),
        openTextDocument: async (uri: any) => ({ uri })
      },
      window: {
        get activeTextEditor() {
          return mockActiveTextEditor;
        },
        createStatusBarItem: (_arg1: any, _arg2?: any, _arg3?: any) => {
          mockStatusBarItem = {
            text: '',
            tooltip: '',
            command: undefined,
            visible: false,
            show() { this.visible = true; },
            hide() { this.visible = false; },
            dispose() {}
          };
          return mockStatusBarItem;
        },
        createQuickPick: () => ({
          title: '',
          placeholder: '',
          items: [],
          selectedItems: [],
          canSelectMany: false,
          buttons: [],
          ignoreFocusOut: false,
          activeItems: [],
          value: '',
          show() {},
          hide() {},
          dispose() {},
          onDidAccept: (cb: any) => ({ dispose: () => {} }),
          onDidChangeSelection: (cb: any) => ({ dispose: () => {} }),
          onDidTriggerButton: (cb: any) => ({ dispose: () => {} }),
          onDidHide: (cb: any) => ({ dispose: () => {} })
        }),
        showInformationMessage: async (msg: string, ...rest: any[]) => {
          shownInfoMessages.push(msg);
          if (rest.includes('▶️ Start Auto-Run')) {
            return '▶️ Start Auto-Run';
          }
          return rest[0];
        },
        showErrorMessage: async (msg: string) => {
          shownErrorMessages.push(msg);
          return msg;
        },
        showWarningMessage: async (msg: string) => {
          shownWarningMessages.push(msg);
          return msg;
        },
        showQuickPick: async (items: any[]) => {
          if (Array.isArray(items) && items.length > 0) {
            return items[0];
          }
          return undefined;
        },
        showOpenDialog: async () => undefined,
        showInputBox: async () => '',
        showTextDocument: async () => {}
      },
      commands: {
        registerCommand: (command: string, callback: (...args: any[]) => any) => {
          registeredCommands[command] = callback;
          return {
            dispose: () => {
              delete registeredCommands[command];
            }
          };
        },
        executeCommand: async (cmd: string, ...args: any[]) => {
          if (registeredCommands[cmd]) {
            return await registeredCommands[cmd](...args);
          }
          return undefined;
        }
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  scanPlanFolder,
  getPhasesFrom,
  detectPhaseStatus,
  PhaseFile
} from '../planScanner';
import {
  Orchestrator,
  OrchestratorProgressInfo,
  PhaseItem
} from '../orchestrator';
import {
  activate,
  deactivate,
  executePhases,
  getMainStatusBarItem
} from '../extension';

const execAsync = promisify(exec);

async function runPhase04E2ERegressionPackagingTests() {
  console.log('======================================================================');
  console.log('🧪 Phase 04: Full E2E Integration, Regression & VSIX Packaging Tests');
  console.log('======================================================================\n');

  const rootDir = path.resolve(__dirname, '..', '..');
  const outDir = path.resolve(rootDir, 'out');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-e2e-'));

  try {
    // ----------------------------------------------------------------------
    // Part 1: Full E2E Workflow Simulation
    // ----------------------------------------------------------------------
    console.log('[E2E 1] Setting up mock plan with mixed phase statuses...');
    const phaseFilesData = [
      { name: 'phase-01-core.md', content: '# Phase 1\n\nStatus: ✅ Completed\n\nTask 1 done.' },
      { name: 'phase-02-api.md', content: '# Phase 2\n\nStatus: 🔄 In Progress\n\nTask 2 working.' },
      { name: 'phase-03-ui.md', content: '# Phase 3\n\nStatus: ⬜ Pending\n\nTask 3 pending.' },
      { name: 'phase-04-test.md', content: '# Phase 4\n\nStatus: ⬜ Pending\n\nTask 4 pending.' }
    ];

    for (const item of phaseFilesData) {
      fs.writeFileSync(path.join(tempDir, item.name), item.content, 'utf8');
    }

    console.log('[E2E 2] Testing smart scanner and phase status detection...');
    const scannedPhases = scanPlanFolder(tempDir);
    assert.strictEqual(scannedPhases.length, 4, 'Should detect 4 phase files');
    assert.strictEqual(scannedPhases[0].status, 'Completed');
    assert.strictEqual(scannedPhases[0].fileName, 'phase-01-core.md');
    assert.strictEqual(scannedPhases[1].status, 'Pending'); // In progress is not completed, status is Pending or parsed
    assert.strictEqual(scannedPhases[2].status, 'Pending');
    assert.strictEqual(scannedPhases[3].status, 'Pending');

    console.log('[E2E 3] Testing getPhasesFrom offset slicing...');
    const fromPhase3 = getPhasesFrom(scannedPhases, 'phase-03-ui.md');
    assert.strictEqual(fromPhase3.length, 2);
    assert.strictEqual(fromPhase3[0].fileName, 'phase-03-ui.md');
    assert.strictEqual(fromPhase3[1].fileName, 'phase-04-test.md');

    console.log('[E2E 4] Testing extension activation and status bar initialization...');
    activate(mockContext);
    const statusBar = getMainStatusBarItem();
    assert.ok(statusBar, 'Main status bar item should be created');

    console.log('[E2E 5] Testing orchestrator custom execution flow with mock services...');
    const incompletePhases = scannedPhases.filter(p => !p.isCompleted);
    assert.strictEqual(incompletePhases.length, 3);

    const executedPrompts: string[] = [];
    const mockKeyboardManager: any = {
      executeBatchPromptFlow: async (p: string) => {
        executedPrompts.push(p);
      },
      executePromptFlow: async (p: string) => {
        executedPrompts.push(p);
      }
    };

    let watcherStep = 0;
    const mockTranscriptWatcher: any = {
      getOptions: () => ({ brainDir: tempDir, pollIntervalMs: 5 }),
      waitForNewConversation: async () => `conv-${++watcherStep}`,
      watchFile: async (_path: string, convId: string) => ({
        success: true,
        conversationId: convId,
        completionTimeMs: 50
      }),
      watchLatest: async () => ({
        success: true,
        conversationId: `conv-${watcherStep}`,
        completionTimeMs: 50
      }),
      stop: () => {},
      readConversationMessages: async () => []
    };

    const progressEvents: OrchestratorProgressInfo[] = [];
    const customOrchestrator = new Orchestrator({
      configProvider: () => ({
        defaultPromptTemplate: 'Run phase {xxx}',
        promptTemplate: 'Run phase {xxx}',
        promptText: 'Run phase {xxx}',
        defaultPlanFolder: tempDir,
        repeatCount: 1,
        completionKeyword: 'Done skul9x.',
        delayBetweenLoopsMs: 10,
        timeoutPerLoopMinutes: 1,
        focusDelayMs: 10
      }),
      keyboardManager: mockKeyboardManager,
      transcriptWatcher: mockTranscriptWatcher,
      onStateChange: (info) => {
        progressEvents.push({ ...info });
      }
    });

    const success = await customOrchestrator.startPhases(incompletePhases, {
      overrideConfig: { delayBetweenLoopsMs: 5 }
    });

    assert.strictEqual(success, true, 'Orchestrator should successfully run all incomplete phases');
    assert.strictEqual(executedPrompts.length, 3, 'Should execute 3 prompts for 3 incomplete phases');
    assert.ok(progressEvents.length >= 3, 'Should record progress events');
    console.log('  ✓ E2E Smart Resume and Custom Phase execution succeeded');

    // ----------------------------------------------------------------------
    // Part 2: TypeScript Compilation Output Verification
    // ----------------------------------------------------------------------
    console.log('\n[Artifacts] Verifying TypeScript output artifacts in out/...');
    const expectedOutFiles = [
      'extension.js',
      'planScanner.js',
      'orchestrator.js',
      'transcriptWatcher.js',
      'keyboardManager.js',
      'config.js'
    ];

    for (const file of expectedOutFiles) {
      const filePath = path.join(outDir, file);
      assert.ok(fs.existsSync(filePath), `Expected artifact out/${file} to exist`);
      const stat = fs.statSync(filePath);
      assert.ok(stat.size > 100, `Expected out/${file} size > 100 bytes (got ${stat.size})`);
      console.log(`  ✓ out/${file} verified (${stat.size} bytes)`);
    }

    // ----------------------------------------------------------------------
    // Part 3: Regression Test Suite Verification
    // ----------------------------------------------------------------------
    console.log('\n[Regression] Executing previous test suites to verify zero regression...');
    const regressionSuites = [
      'phase01_smart_phase_scanner.test.js',
      'phase02_custom_phase_quickpick.test.js',
      'phase03_selected_phases_orchestrator.test.js',
      'phase01_folder_scanner.test.js',
      'phase01_async_watcher_io.test.js',
      'phase02_strict_watcher.test.js',
      'phase03_orchestrator_loop.test.js'
    ];

    for (const testFile of regressionSuites) {
      const testPath = path.join(outDir, 'test', testFile);
      if (fs.existsSync(testPath)) {
        const startTime = Date.now();
        const { stderr } = await execAsync(`node "${testPath}"`, {
          cwd: rootDir,
          timeout: 30000,
          env: { ...process.env, NODE_ENV: 'test' }
        });
        const elapsed = Date.now() - startTime;
        assert.ok(!stderr.includes('Error:'), `Suite ${testFile} failed with error in stderr`);
        console.log(`  ✓ Regression passed: ${testFile} (${elapsed}ms)`);
      } else {
        console.log(`  ⚠️ Test ${testFile} not present in out/test, skipping`);
      }
    }

    // ----------------------------------------------------------------------
    // Part 4: VSIX Packaging & Archive Structural Integrity Verification
    // ----------------------------------------------------------------------
    console.log('\n[Packaging] Building and verifying VSIX package integrity...');
    const packageCmd = 'npx @vscode/vsce package --allow-missing-repository --no-git-tag-version';
    const pkgStartTime = Date.now();
    await execAsync(packageCmd, {
      cwd: rootDir,
      timeout: 60000,
      env: { ...process.env, NODE_ENV: 'production' }
    });
    const pkgElapsed = Date.now() - pkgStartTime;
    console.log(`  ✓ VSIX package command succeeded in ${pkgElapsed}ms`);

    // Find the generated vsix file
    const rootFiles = fs.readdirSync(rootDir);
    const vsixFiles = rootFiles.filter(f => f.endsWith('.vsix'));
    assert.ok(vsixFiles.length > 0, 'At least one .vsix file should be generated in root directory');
    
    const latestVsix = vsixFiles.sort((a, b) => {
      return fs.statSync(path.join(rootDir, b)).mtimeMs - fs.statSync(path.join(rootDir, a)).mtimeMs;
    })[0];

    const vsixPath = path.join(rootDir, latestVsix);
    const vsixStat = fs.statSync(vsixPath);
    console.log(`  ✓ Generated VSIX: ${latestVsix} (Size: ${vsixStat.size} bytes)`);

    assert.ok(vsixStat.size > 10240, `VSIX package should be > 10KB (got ${vsixStat.size} bytes)`);

    // Verify ZIP magic header bytes (0x50 0x4B 0x03 0x04)
    const vsixBuffer = Buffer.alloc(4);
    const fd = fs.openSync(vsixPath, 'r');
    fs.readSync(fd, vsixBuffer, 0, 4, 0);
    fs.closeSync(fd);

    const magicHex = vsixBuffer.toString('hex');
    assert.strictEqual(
      magicHex,
      '504b0304',
      `VSIX header magic bytes must be 504b0304 (standard PK zip), got ${magicHex}`
    );
    console.log(`  ✓ VSIX ZIP binary header verified: ${magicHex}`);

    console.log('\n======================================================================');
    console.log('🎉 ALL PHASE 04 E2E INTEGRATION, REGRESSION & PACKAGING TESTS PASSED!');
    console.log('======================================================================\n');
  } finally {
    deactivate();
    // Cleanup temporary directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

runPhase04E2ERegressionPackagingTests().catch((err) => {
  console.error('❌ Phase 04 E2E Tests Failed:', err);
  process.exit(1);
});
