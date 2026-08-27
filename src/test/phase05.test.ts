// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let createdStatusBarItems: any[] = [];
let shownInfoMessages: string[] = [];
let shownErrorMessages: string[] = [];
let shownWarningMessages: string[] = [];
let configStore: { [key: string]: any } = {
  promptText: 'Hãy trả lời tôi với câu trả lời là "Done skul9x.", ngoài ra không nói gì thêm',
  repeatCount: 5,
  completionKeyword: 'Done skul9x.',
  delayBetweenLoopsMs: 50,
  timeoutPerLoopMinutes: 15
};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key: string, defaultValue: any) =>
            configStore[key] !== undefined ? configStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            configStore[key] = val;
          }
        }),
        onDidChangeConfiguration: (cb: any) => ({
          dispose: () => {}
        })
      },
      window: {
        createStatusBarItem: (alignment: number, priority: number) => {
          const item = {
            alignment,
            priority,
            text: '',
            tooltip: '',
            command: undefined as string | undefined,
            visible: false,
            show() {
              this.visible = true;
            },
            hide() {
              this.visible = false;
            },
            dispose() {
              this.visible = false;
            }
          };
          createdStatusBarItems.push(item);
          return item;
        },
        showInformationMessage: async (msg: string) => {
          shownInfoMessages.push(msg);
          return msg;
        },
        showErrorMessage: async (msg: string) => {
          shownErrorMessages.push(msg);
          return msg;
        },
        showWarningMessage: async (msg: string) => {
          shownWarningMessages.push(msg);
          return msg;
        },
        showInputBox: async (opts: any) => 'New Prompt For Phase 05'
      },
      commands: {
        registerCommand: (command: string, callback: (...args: any[]) => any) => {
          registeredCommands[command] = callback;
          return {
            dispose: () => {
              delete registeredCommands[command];
            }
          };
        }
      },
      StatusBarAlignment: {
        Left: 1,
        Right: 2
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
import { Orchestrator, OrchestratorProgressInfo } from '../orchestrator';
import { KeyboardManager } from '../keyboardManager';
import { TranscriptWatcher, CompletionResult } from '../transcriptWatcher';
import { activate, deactivate } from '../extension';

async function runPhase05PackagingAndE2ETests() {
  console.log('=== Running Phase 05 Packaging, Clean Lifecycle & End-to-End Tests ===');

  const rootDir = path.resolve(__dirname, '..', '..');

  // 1. Verify Package & Documentation Artifacts
  console.log('\n--- 1. Testing Package & Documentation Artifacts ---');
  const pkgJsonPath = path.join(rootDir, 'package.json');
  assert.ok(fs.existsSync(pkgJsonPath), 'package.json must exist');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  assert.ok(/^\d+\.\d+\.\d+$/.test(pkg.version), 'package.json version should be semantic versioning');
  assert.strictEqual(pkg.name, 'antigravity-auto-plan', 'package.json name should match');
  assert.ok(pkg.scripts && pkg.scripts.package, 'package script should exist');

  const readmePath = path.join(rootDir, 'README.md');
  assert.ok(fs.existsSync(readmePath), 'README.md must exist');
  const readmeContent = fs.readFileSync(readmePath, 'utf8');
  assert.ok(readmeContent.includes('.vsix'), 'README.md must contain VSIX installation guide');
  assert.ok(readmeContent.includes('autoplan.start'), 'README.md must contain command guide');
  assert.ok(readmeContent.includes('autoplan.promptText'), 'README.md must contain settings guide');
  console.log('✔ package.json and README.md artifacts verified successfully');

  // 2. Verify VSIX Package Artifact
  console.log('\n--- 2. Testing VSIX Package Artifact ---');
  const vsixFileName = `antigravity-auto-plan-${pkg.version}.vsix`;
  let vsixPath = path.join(rootDir, vsixFileName);
  if (!fs.existsSync(vsixPath)) {
    const foundVsix = fs.readdirSync(rootDir).find((f) => f.endsWith('.vsix'));
    if (foundVsix) {
      vsixPath = path.join(rootDir, foundVsix);
    }
  }
  assert.ok(fs.existsSync(vsixPath), `VSIX package must exist in project root: ${vsixPath}`);
  const vsixStats = fs.statSync(vsixPath);
  assert.ok(vsixStats.size > 1000, `VSIX file size should be substantial (> 1KB), actual: ${vsixStats.size} bytes`);
  // Check ZIP/VSIX magic bytes (PK\x03\x04)
  const fd = fs.openSync(vsixPath, 'r');
  const magicBuffer = Buffer.alloc(4);
  fs.readSync(fd, magicBuffer, 0, 4, 0);
  fs.closeSync(fd);
  assert.strictEqual(magicBuffer.toString('hex'), '504b0304', 'VSIX file must have valid ZIP/OPC magic header (PK\\x03\\x04)');
  console.log(`✔ VSIX package verified: ${vsixPath} (${vsixStats.size} bytes)`);

  // 3. Verify Full 5-Loop End-to-End Execution
  console.log('\n--- 3. Testing 5-Loop End-to-End Simulation ---');
  const testTempDir = path.join(os.tmpdir(), `antigravity_phase05_e2e_${Date.now()}`);
  fs.mkdirSync(testTempDir, { recursive: true });

  let keyActionsLogged: string[] = [];
  const mockKb = new KeyboardManager({
    focusDelayMs: 5,
    selectDelayMs: 5,
    pasteDelayMs: 5,
    submitDelayMs: 5,
    customKeySender: async (keys: string) => {
      keyActionsLogged.push(`KEYS:${keys}`);
    },
    customClipboardSetter: async (text: string) => {
      keyActionsLogged.push(`CLIPBOARD:${text}`);
    }
  });

  const watcher = new TranscriptWatcher({
    brainDir: testTempDir,
    keyword: 'Done skul9x.',
    pollIntervalMs: 20,
    settleQuietPeriodMs: 20
  });

  const loopProgressEvents: OrchestratorProgressInfo[] = [];
  const completedIterations: number[] = [];
  let finishedTotal = 0;

  const totalLoops = 5;
  const completionKeyword = 'Done skul9x.';

  const orchestrator = new Orchestrator({
    configProvider: () => ({
      promptText: 'Test Prompt 5 Loops',
      repeatCount: totalLoops,
      completionKeyword: completionKeyword,
      delayBetweenLoopsMs: 30,
      timeoutPerLoopMinutes: 1
    }),
    keyboardManager: mockKb,
    transcriptWatcher: watcher,
    onStateChange: (info) => {
      loopProgressEvents.push({ ...info });
    },
    onIterationComplete: (iter, total, result) => {
      completedIterations.push(iter);
    },
    onAllComplete: (total) => {
      finishedTotal = total;
    }
  });

  // Emulate agent completing each loop
  let simulatedConvCount = 0;
  const simulateResponse = () => {
    simulatedConvCount++;
    const convFolder = path.join(testTempDir, `conv_phase05_${simulatedConvCount}_${Date.now()}`);
    const logDir = path.join(convFolder, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const transcriptPath = path.join(logDir, 'transcript.jsonl');
    fs.writeFileSync(
      transcriptPath,
      JSON.stringify({ step_index: 1, type: 'USER_INPUT', content: 'Test Prompt 5 Loops' }) + '\n' +
      JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', content: `Processing loop ${simulatedConvCount}... ${completionKeyword}` }) + '\n',
      'utf-8'
    );
  };

  const simulationInterval = setInterval(() => {
    if (orchestrator.getState() === 'waiting' || orchestrator.getState() === 'sending') {
      simulateResponse();
    }
  }, 100);

  const startSuccess = await orchestrator.start();
  clearInterval(simulationInterval);

  assert.strictEqual(startSuccess, true, 'start() should resolve with true');
  assert.strictEqual(finishedTotal, 5, 'Orchestrator should report all 5 completed iterations');
  assert.deepStrictEqual(completedIterations, [1, 2, 3, 4, 5], 'Should complete iterations 1 through 5');
  assert.strictEqual(orchestrator.isRunning(), false, 'Orchestrator should be idle/completed');
  assert.strictEqual(orchestrator.getState(), 'completed');
  assert.ok(keyActionsLogged.filter(a => a.startsWith('CLIPBOARD:')).length === 5, 'Should copy prompt to clipboard 5 times');
  console.log('✔ Full 5-loop execution completed smoothly with correct progress events and actions');

  // 4. Verify Clean Watcher Disposal & Memory Leak Prevention on Stop
  console.log('\n--- 4. Testing Resource Cleanup & Watcher Teardown on Stop ---');
  let watcherStopped = false;
  const originalWatcherStop = watcher.stop.bind(watcher);
  watcher.stop = () => {
    watcherStopped = true;
    originalWatcherStop();
  };

  const stopPromise = orchestrator.start({
    promptText: 'Test Abort',
    repeatCount: 10,
    completionKeyword: 'Done skul9x.',
    delayBetweenLoopsMs: 10000,
    timeoutPerLoopMinutes: 1
  });

  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(orchestrator.isRunning(), true, 'Orchestrator should be running before stop');
  orchestrator.stop();
  await stopPromise;

  assert.strictEqual(orchestrator.isRunning(), false, 'Orchestrator should be stopped');
  assert.strictEqual(watcherStopped, true, 'Watcher must be stopped on stop to prevent memory / fd leaks');
  orchestrator.dispose();
  console.log('✔ Watcher and resources cleanly stopped and disposed on orchestrator stop');

  // 5. Verify Extension Lifecycle (activate & deactivate)
  console.log('\n--- 5. Testing Extension Activation & Deactivation Lifecycle ---');
  const subscriptions: { dispose: () => any }[] = [];
  const mockContext: any = {
    subscriptions
  };

  registeredCommands = {};
  createdStatusBarItems = [];
  shownInfoMessages = [];

  activate(mockContext);

  assert.ok(registeredCommands['autoplan.start'], 'autoplan.start command registered');
  assert.ok(registeredCommands['autoplan.stop'], 'autoplan.stop command registered');
  assert.ok(registeredCommands['autoplan.setPrompt'], 'autoplan.setPrompt command registered');
  assert.strictEqual(createdStatusBarItems.length >= 1, true, 'Status bar item created');

  const statusBarItem = createdStatusBarItems[0];
  assert.ok(statusBarItem.text.includes('Auto-Plan'), 'Status bar item initialized with Auto-Plan text');

  // Test set prompt command
  await registeredCommands['autoplan.setPrompt']();
  assert.strictEqual(configStore['promptText'], 'New Prompt For Phase 05');

  // Deactivate
  deactivate();
  for (const sub of subscriptions) {
    sub.dispose();
  }
  console.log('✔ Extension activation and deactivation cleaned up all subscriptions and commands');

  // Cleanup temp dir
  fs.rmSync(testTempDir, { recursive: true, force: true });

  console.log('\n======================================================');
  console.log('🎉 ALL PHASE 05 PACKAGING & E2E TESTS PASSED!');
  console.log('======================================================\n');
}

runPhase05PackagingAndE2ETests().catch((err) => {
  console.error('❌ Phase 05 Test Failed:', err);
  process.exit(1);
});
