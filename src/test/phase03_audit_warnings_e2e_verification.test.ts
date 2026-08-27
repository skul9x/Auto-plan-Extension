// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let createdStatusBarItems: any[] = [];
let shownInfoMessages: string[] = [];
let shownErrorMessages: string[] = [];
let shownWarningMessages: string[] = [];

const mockWorkspaceStateStore: { [key: string]: any } = {};
const mockGlobalStateStore: { [key: string]: any } = {};

const mockContext: any = {
  subscriptions: [],
  workspaceState: {
    get: (key: string, defaultVal?: any) => (mockWorkspaceStateStore[key] !== undefined ? mockWorkspaceStateStore[key] : defaultVal),
    update: async (key: string, val: any) => {
      mockWorkspaceStateStore[key] = val;
    }
  },
  globalState: {
    get: (key: string, defaultVal?: any) => (mockGlobalStateStore[key] !== undefined ? mockGlobalStateStore[key] : defaultVal),
    update: async (key: string, val: any) => {
      mockGlobalStateStore[key] = val;
    }
  }
};

class MockMarkdownString {
  public value: string;
  public isTrusted: boolean = false;
  constructor(value: string = '') {
    this.value = value;
  }
  appendMarkdown(value: string) {
    this.value += value;
    return this;
  }
}

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [],
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        }),
        onDidChangeConfiguration: (_cb: any) => ({
          dispose: () => {}
        }),
        openTextDocument: async (uri: any) => ({ uri }),
        asRelativePath: (p: string) => p
      },
      window: {
        activeTextEditor: undefined,
        createStatusBarItem: (_alignment?: any, _priority?: number) => {
          const item = {
            text: '',
            tooltip: '' as any,
            command: '',
            show: () => {},
            hide: () => {},
            dispose: () => {}
          };
          createdStatusBarItems.push(item);
          return item;
        },
        showInformationMessage: async (msg: string, ...choices: any[]) => {
          shownInfoMessages.push(msg);
          return choices[0];
        },
        showWarningMessage: async (msg: string) => {
          shownWarningMessages.push(msg);
        },
        showErrorMessage: async (msg: string) => {
          shownErrorMessages.push(msg);
        },
        showQuickPick: async () => undefined,
        showOpenDialog: async () => undefined,
        showInputBox: async () => undefined,
        showTextDocument: async () => {}
      },
      StatusBarAlignment: {
        Left: 1,
        Right: 2
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      commands: {
        registerCommand: (cmd: string, callback: (...args: any[]) => any) => {
          registeredCommands[cmd] = callback;
          return {
            dispose: () => {
              delete registeredCommands[cmd];
            }
          };
        },
        executeCommand: async () => {}
      },
      MarkdownString: MockMarkdownString,
      Uri: {
        file: (f: string) => ({ fsPath: f, scheme: 'file' })
      },
      env: {
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
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Orchestrator, PhaseItem } from '../orchestrator';
import { KeyboardManager, BatchAction } from '../keyboardManager';
import { TranscriptWatcher, clearBrainDirCache } from '../transcriptWatcher';
import { clearTooltipCache, clearPlanDiscoveryCache } from '../extension';

const execAsync = promisify(exec);

async function runPhase03AuditWarningsE2EVerification() {
  console.log('======================================================================');
  console.log('🧪 Phase 03: E2E Regression, Multi-Byte Stream & Packaging Integrity');
  console.log('======================================================================\n');

  const rootDir = path.resolve(__dirname, '..', '..');
  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-e2e-'));
  const tempPlansDir = path.join(tempBaseDir, 'plans');
  const tempBrainDir = path.join(tempBaseDir, 'brain');

  fs.mkdirSync(tempPlansDir, { recursive: true });
  fs.mkdirSync(tempBrainDir, { recursive: true });

  try {
    // -------------------------------------------------------------------------
    // Test 1: Multi-Phase E2E Orchestration with Multi-Byte Unicode & Chunk Boundary
    // -------------------------------------------------------------------------
    console.log('[Test 1] E2E Orchestration with Multi-Byte Stream Chunks & Unicode Keywords...');
    {
      clearBrainDirCache();
      clearTooltipCache();
      clearPlanDiscoveryCache();

      const unicodeKeyword = 'Đã hoàn thành skul9x 🚀';
      const phaseFiles = [
        'phase-01-khởi-tạo.md',
        'phase-02-xử-lý-dữ-liệu.md',
        'phase-03-tổng-kết-kiểm-thử.md'
      ];

      for (let i = 0; i < phaseFiles.length; i++) {
        const filePath = path.join(tempPlansDir, phaseFiles[i]);
        fs.writeFileSync(filePath, `# Phase ${i + 1}\nNội dung kế hoạch bằng tiếng Việt có dấu: ${phaseFiles[i]}`, 'utf-8');
      }

      const executedBatches: { script: string; actions: BatchAction[] }[] = [];
      const copiedPrompts: string[] = [];

      const customKeyboardManager = new KeyboardManager({
        focusDelayMs: 5,
        selectDelayMs: 5,
        pasteDelayMs: 5,
        submitDelayMs: 5,
        customClipboardSetter: async (text: string) => {
          copiedPrompts.push(text);
        },
        customBatchSender: async (batchScript: string, actions: BatchAction[]) => {
          executedBatches.push({ script: batchScript, actions });
        }
      });

      const customWatcher = new TranscriptWatcher({
        brainDir: tempBrainDir,
        keyword: unicodeKeyword,
        pollIntervalMs: 15,
        settleQuietPeriodMs: 30,
        timeoutMs: 5000
      });

      const completedPhases: PhaseItem[] = [];
      const stateTransitions: string[] = [];

      const orchestrator = new Orchestrator({
        keyboardManager: customKeyboardManager,
        transcriptWatcher: customWatcher,
        configProvider: () => ({
          repeatCount: 3,
          keyword: unicodeKeyword,
          completionKeyword: unicodeKeyword,
          promptText: 'Thực hiện phase: {file}',
          promptTemplate: 'Thực hiện phase: {file}',
          defaultPlanFolder: tempPlansDir,
          delayBetweenLoopsMs: 15,
          timeoutPerLoopMinutes: 1,
          autoStartOnOpen: false
        }),
        onStateChange: (info) => {
          stateTransitions.push(info.state);
        },
        onPhaseStart: (phase) => {
          // Simulate conversation logs being written with chunked / split multi-byte characters
          const convId = `conv_phase_${phase.index + 1}_${Date.now()}`;
          const convLogsDir = path.join(tempBrainDir, convId, '.system_generated', 'logs');
          fs.mkdirSync(convLogsDir, { recursive: true });
          const transcriptFile = path.join(convLogsDir, 'transcript.jsonl');

          // Write user prompt first
          const promptLine = JSON.stringify({
            step_index: 0,
            source: 'USER_INPUT',
            type: 'USER_INPUT',
            content: `Thực hiện phase: ${phase.fileName}`
          }) + '\n';
          fs.writeFileSync(transcriptFile, promptLine, 'utf-8');

          // Asynchronously write agent completion response with multi-byte unicode
          setTimeout(() => {
            const responseLine = JSON.stringify({
              step_index: 1,
              source: 'MODEL',
              type: 'PLANNER_RESPONSE',
              status: 'DONE',
              tool_calls: null,
              content: `Hoàn tất xử lý tiến trình ${phase.fileName}. ${unicodeKeyword}`
            }) + '\n';

            // Split into 2 buffer chunks at a boundary to exercise StringDecoder
            const fullBuffer = Buffer.from(responseLine, 'utf-8');
            // Split right in the middle
            const splitPoint = Math.floor(fullBuffer.length / 2);
            const chunk1 = fullBuffer.subarray(0, splitPoint);
            const chunk2 = fullBuffer.subarray(splitPoint);

            fs.appendFileSync(transcriptFile, chunk1);
            setTimeout(() => {
              fs.appendFileSync(transcriptFile, chunk2);
            }, 25);
          }, 30);
        },
        onPhaseComplete: (phase) => {
          completedPhases.push(phase);
        }
      });

      const success = await orchestrator.startFolder(tempPlansDir);

      assert.strictEqual(success, true, 'Orchestrator must complete successfully for all 3 unicode phases');
      assert.strictEqual(completedPhases.length, 3, 'All 3 phases must be completed');
      assert.strictEqual(executedBatches.length, 3, 'All 3 batch prompt scripts must be dispatched');
      assert.strictEqual(copiedPrompts.length, 3, 'All 3 prompts must be copied to clipboard');

      for (let i = 0; i < 3; i++) {
        assert.strictEqual(completedPhases[i].status, 'Completed', `Phase ${i + 1} must be marked Completed`);
        assert.ok(completedPhases[i].result?.matchedContent, `Phase ${i + 1} must match unicode completion keyword`);
      }

      orchestrator.dispose();
      customWatcher.dispose();
      console.log('  ✓ PASS: Multi-phase E2E execution with multi-byte chunking passed 100%.\n');
    }

    // -------------------------------------------------------------------------
    // Test 2: Full Workspace Regression Test Execution (All Compiled Test Files)
    // -------------------------------------------------------------------------
    console.log('[Test 2] Full Workspace Regression Validation (All Test Suites Exit Code 0)...');
    {
      const outTestDir = path.join(rootDir, 'out', 'test');
      assert.ok(fs.existsSync(outTestDir), `out/test directory must exist: ${outTestDir}`);

      const testFiles = fs.readdirSync(outTestDir)
        .filter((f) => f.endsWith('.test.js') && f !== 'phase03_audit_warnings_e2e_verification.test.js');

      console.log(`  Discovered ${testFiles.length} workspace regression test suites to execute.`);
      assert.ok(testFiles.length >= 15, `Expected at least 15 test suites in out/test, found ${testFiles.length}`);

      let passedSuites = 0;
      for (const file of testFiles) {
        const fullTestPath = path.join(outTestDir, file);
        const startTime = Date.now();
        const { stdout, stderr } = await execAsync(`node "${fullTestPath}"`, {
          timeout: 30000,
          env: { ...process.env, NODE_ENV: 'test' }
        });
        const duration = Date.now() - startTime;

        // Child process throws if exit code != 0
        console.log(`    ✓ [${passedSuites + 1}/${testFiles.length}] ${file} passed (${duration}ms)`);
        passedSuites++;
      }

      assert.strictEqual(passedSuites, testFiles.length, 'All workspace test suites must pass cleanly');
      console.log(`  ✓ PASS: All ${passedSuites} regression test suites exited with code 0.\n`);
    }

    // -------------------------------------------------------------------------
    // Test 3: VSIX Production Package Integrity & Archive Verification
    // -------------------------------------------------------------------------
    console.log('[Test 3] Production VSIX Package Archive & Integrity Verification...');
    {
      const pkgJsonPath = path.join(rootDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const vsixFileName = `antigravity-auto-plan-${pkg.version}.vsix`;
      const vsixPath = path.join(rootDir, vsixFileName);

      assert.ok(fs.existsSync(vsixPath), `VSIX package artifact must exist at: ${vsixPath}`);

      const vsixStats = fs.statSync(vsixPath);
      assert.ok(vsixStats.size > 2048, `VSIX package size should be > 2KB, actual: ${vsixStats.size} bytes`);

      // Verify Zip Magic Bytes: 50 4B 03 04 (PK\x03\x04)
      const fd = fs.openSync(vsixPath, 'r');
      const headerBuf = Buffer.alloc(4);
      fs.readSync(fd, headerBuf, 0, 4, 0);
      fs.closeSync(fd);

      assert.strictEqual(
        headerBuf.toString('hex'),
        '504b0304',
        'VSIX package must be a valid ZIP archive with magic header PK\\x03\\x04 (504b0304)'
      );

      console.log(`    Package File : ${vsixFileName}`);
      console.log(`    File Size    : ${vsixStats.size} bytes`);
      console.log(`    Magic Header : ${headerBuf.toString('hex')}`);
      console.log('  ✓ PASS: Production VSIX package structure and integrity verified.\n');
    }

    console.log('======================================================================');
    console.log('🎉 ALL PHASE 03 E2E REGRESSION & VSIX INTEGRITY CHECKS PASSED 100%!');
    console.log('======================================================================\n');
  } finally {
    clearBrainDirCache();
    clearTooltipCache();
    clearPlanDiscoveryCache();
    try {
      if (fs.existsSync(tempBaseDir)) {
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

if (require.main === module) {
  runPhase03AuditWarningsE2EVerification().catch((err) => {
    console.error('❌ Phase 03 Verification Failed:', err);
    process.exit(1);
  });
}

export { runPhase03AuditWarningsE2EVerification };
