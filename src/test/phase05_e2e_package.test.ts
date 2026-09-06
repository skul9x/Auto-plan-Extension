// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let createdStatusBarItems: any[] = [];
let shownInfoMessages: string[] = [];
let shownErrorMessages: string[] = [];
let shownWarningMessages: string[] = [];
let mockOpenDocUri: any = null;
let mockShowDocCalled = false;
let configStore: { [key: string]: any } = {
  defaultPromptTemplate: 'Implement the code closely following the file {xxx}\nNote, follow the requirements exactly. Do only what is asked, with no extra work. Once done, you must thoroughly test what you have just implemented using exactly one file-based test for this phase. The test must verify the core functionality of the entire phase as comprehensively as reasonably possible. Do not create or run any additional tests, test cases, or test files. After finishing, mark the phase plan file as completed. When done, say "Done skul9x." to save token.',
  promptTemplate: 'Implement the code closely following the file {xxx}\nNote, follow the requirements exactly. Do only what is asked, with no extra work. Once done, you must thoroughly test what you have just implemented using exactly one file-based test for this phase. The test must verify the core functionality of the entire phase as comprehensively as reasonably possible. Do not create or run any additional tests, test cases, or test files. After finishing, mark the phase plan file as completed. When done, say "Done skul9x." to save token.',
  promptText: 'Implement the code closely following the file {xxx}',
  repeatCount: 5,
  completionKeyword: 'Done skul9x.',
  delayBetweenLoopsMs: 40,
  timeoutPerLoopMinutes: 15,
  focusDelayMs: 800,
  defaultPlanFolder: ''
};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section?: string) => ({
          get: (key: string, defaultValue: any) =>
            configStore[key] !== undefined ? configStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            configStore[key] = val;
          }
        }),
        onDidChangeConfiguration: (cb: any) => ({
          dispose: () => {}
        }),
        openTextDocument: async (uri: any) => {
          mockOpenDocUri = uri;
          return { uri };
        },
        workspaceFolders: []
      },
      window: {
        activeTextEditor: undefined as any,
        createStatusBarItem: (alignmentOrId: any, alignmentOrPriority?: any, maybePriority?: any) => {
          const item = {
            id: typeof alignmentOrId === 'string' ? alignmentOrId : undefined,
            alignment: typeof alignmentOrId === 'number' ? alignmentOrId : alignmentOrPriority,
            priority: typeof alignmentOrPriority === 'number' ? alignmentOrPriority : maybePriority,
            text: '',
            tooltip: '' as any,
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
        showInformationMessage: async (msg: string, ...rest: any[]) => {
          shownInfoMessages.push(msg);
          if (rest.length > 0 && typeof rest[0] === 'object' && rest.includes('▶️ Start Auto-Run')) {
            return '▶️ Start Auto-Run';
          }
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
        showQuickPick: async (items: any[], opts?: any) => {
          if (Array.isArray(items) && items.length > 0) {
            return items[0];
          }
          return undefined;
        },
        showOpenDialog: async (opts: any) => undefined,
        showInputBox: async (opts: any) => 'Custom Value',
        showTextDocument: async (doc: any) => {
          mockShowDocCalled = true;
        }
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
      StatusBarAlignment: {
        Left: 1,
        Right: 2
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      MarkdownString: class MarkdownString {
        value: string;
        isTrusted?: boolean;
        constructor(val: string) {
          this.value = val;
        }
      },
      Uri: {
        file: (filePath: string) => ({ fsPath: filePath, path: filePath, scheme: 'file' })
      },
      env: {
        clipboard: {
          writeText: async (t: string) => {},
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
import { Orchestrator, OrchestratorProgressInfo, PhaseItem } from '../orchestrator';
import { KeyboardManager } from '../keyboardManager';
import { TranscriptWatcher, CompletionResult } from '../transcriptWatcher';
import { getConfig, setPromptTemplate, DEFAULT_PROMPT_TEMPLATE, DEFAULT_CONFIG } from '../config';
import { scanPlanFolder, renderPromptTemplate, normalizePath } from '../planScanner';
import {
  activate,
  deactivate,
  formatElapsedTime,
  buildRunningTooltip,
  buildFolderQuickPickItems
} from '../extension';

async function runPhase05ComprehensiveE2ETests() {
  console.log('======================================================================');
  console.log('🚀 Running Phase 05: Comprehensive E2E, Packaging & Verification Tests');
  console.log('======================================================================\n');

  const rootDir = path.resolve(__dirname, '..', '..');

  // -------------------------------------------------------------------------
  // 1. Package Configuration Schema & Defaults Verification
  // -------------------------------------------------------------------------
  console.log('--- 1. Testing package.json Configuration Schema & Defaults ---');
  const pkgJsonPath = path.join(rootDir, 'package.json');
  assert.ok(fs.existsSync(pkgJsonPath), 'package.json must exist');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

  assert.strictEqual(pkg.name, 'antigravity-auto-plan', 'Package name must be antigravity-auto-plan');
  assert.ok(pkg.version, 'Package version must be defined');

  const props = pkg.contributes?.configuration?.properties;
  assert.ok(props, 'configuration.properties must be defined in package.json');
  assert.ok(props['autoplan.defaultPromptTemplate'], 'autoplan.defaultPromptTemplate must be defined in package.json');
  assert.ok(props['autoplan.completionKeyword'], 'autoplan.completionKeyword must be defined in package.json');
  assert.ok(props['autoplan.delayBetweenLoopsMs'], 'autoplan.delayBetweenLoopsMs must be defined in package.json');
  assert.ok(props['autoplan.timeoutPerLoopMinutes'], 'autoplan.timeoutPerLoopMinutes must be defined in package.json');
  assert.ok(props['autoplan.focusDelayMs'], 'autoplan.focusDelayMs must be defined in package.json');
  assert.ok(props['autoplan.promptTemplate'], 'autoplan.promptTemplate must be defined in package.json');
  assert.ok(props['autoplan.promptText'], 'autoplan.promptText must be defined in package.json');

  assert.strictEqual(props['autoplan.completionKeyword'].default, 'Done skul9x.');
  assert.strictEqual(props['autoplan.delayBetweenLoopsMs'].default, 2000);
  assert.strictEqual(props['autoplan.timeoutPerLoopMinutes'].default, 15);
  assert.strictEqual(props['autoplan.focusDelayMs'].default, 800);
  assert.ok(props['autoplan.defaultPromptTemplate'].default.includes('{xxx}'));

  // Test config helper reader
  const loadedConfig = getConfig();
  assert.strictEqual(loadedConfig.completionKeyword, 'Done skul9x.');
  assert.strictEqual(loadedConfig.focusDelayMs, 800);
  assert.ok(loadedConfig.defaultPromptTemplate?.includes('{xxx}'));
  console.log('✔ Configuration schema, properties, and default values verified successfully');

  // -------------------------------------------------------------------------
  // 2. Documentation Verification in README.md
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Testing Documentation in README.md ---');
  const readmePath = path.join(rootDir, 'README.md');
  assert.ok(fs.existsSync(readmePath), 'README.md must exist');
  const readme = fs.readFileSync(readmePath, 'utf8');

  assert.ok(readme.includes('QuickPick'), 'README must mention QuickPick');
  assert.ok(readme.includes('Action Menu') || readme.includes('Running Action Menu'), 'README must cover Running Action Menu');
  assert.ok(readme.includes('{xxx}'), 'README must document {xxx} syntax');
  assert.ok(readme.includes('{path}'), 'README must document {path} syntax');
  assert.ok(readme.includes('{file}'), 'README must document {file} syntax');
  assert.ok(readme.includes('autoplan.focusDelayMs'), 'README must document focusDelayMs');
  assert.ok(readme.includes('.vsix'), 'README must contain VSIX packaging / installation instructions');
  console.log('✔ Comprehensive README.md documentation verified');

  // -------------------------------------------------------------------------
  // 3. Prompt Template Rendering Verification
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Testing Dynamic Prompt Template Rendering ---');
  const sampleFilePath = 'D:/project/plans/phase-03-orchestrator.md';
  const rendered1 = renderPromptTemplate(DEFAULT_PROMPT_TEMPLATE, sampleFilePath);
  assert.ok(rendered1.includes('D:/project/plans/phase-03-orchestrator.md'), 'Template with {xxx} should replace with normalized path');

  const customTemplate = 'Execute {file} from location {path}. Report status: {xxx}';
  const rendered2 = renderPromptTemplate(customTemplate, sampleFilePath);
  assert.strictEqual(rendered2, 'Execute phase-03-orchestrator.md from location D:/project/plans/phase-03-orchestrator.md. Report status: D:/project/plans/phase-03-orchestrator.md');
  console.log('✔ Prompt template rendering with {xxx}, {path}, and {file} verified');

  // -------------------------------------------------------------------------
  // 4. End-to-End 3-Phase Execution Simulation with Conversation Transitions
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Testing End-to-End Multi-Phase Simulation (3 Phases) ---');
  const tempPlanDir = path.join(os.tmpdir(), `antigravity_e2e_plan_${Date.now()}`);
  const tempBrainDir = path.join(os.tmpdir(), `antigravity_e2e_brain_${Date.now()}`);
  fs.mkdirSync(tempPlanDir, { recursive: true });
  fs.mkdirSync(tempBrainDir, { recursive: true });

  // Create 3 phase files in natural sequence
  fs.writeFileSync(path.join(tempPlanDir, 'phase-01-scaffold.md'), '# Phase 1: Scaffold\nStatus: Pending');
  fs.writeFileSync(path.join(tempPlanDir, 'phase-02-core-logic.md'), '# Phase 2: Core Logic\nStatus: Pending');
  fs.writeFileSync(path.join(tempPlanDir, 'phase-03-verification.md'), '# Phase 3: Verification\nStatus: Pending');

  const scannedPhases = scanPlanFolder(tempPlanDir);
  assert.strictEqual(scannedPhases.length, 3, 'Should scan exactly 3 phases');
  assert.strictEqual(scannedPhases[0].fileName, 'phase-01-scaffold.md');
  assert.strictEqual(scannedPhases[1].fileName, 'phase-02-core-logic.md');
  assert.strictEqual(scannedPhases[2].fileName, 'phase-03-verification.md');

  const clipboardPasted: string[] = [];
  const keySequence: string[] = [];

  const mockKb = new KeyboardManager({
    focusDelayMs: 5,
    selectDelayMs: 5,
    pasteDelayMs: 5,
    submitDelayMs: 5,
    customKeySender: async (keys: string) => {
      keySequence.push(`KEY:${keys}`);
    },
    customClipboardSetter: async (text: string) => {
      clipboardPasted.push(text);
    }
  });

  const watcher = new TranscriptWatcher({
    brainDir: tempBrainDir,
    keyword: 'Done skul9x.',
    pollIntervalMs: 20,
    settleQuietPeriodMs: 50
  });

  const progressEvents: OrchestratorProgressInfo[] = [];
  const startedPhases: string[] = [];
  const completedPhases: string[] = [];
  let allCompleteCount = 0;

  const orchestratorInstance = new Orchestrator({
    configProvider: () => ({
      promptText: 'Static Prompt',
      promptTemplate: 'Run phase: {file} at {xxx}',
      defaultPromptTemplate: 'Run phase: {file} at {xxx}',
      repeatCount: 3,
      completionKeyword: 'Done skul9x.',
      delayBetweenLoopsMs: 30,
      timeoutPerLoopMinutes: 1,
      focusDelayMs: 10
    }),
    keyboardManager: mockKb,
    transcriptWatcher: watcher,
    onStateChange: (info) => {
      progressEvents.push({ ...info });
    },
    onPhaseStart: (phase) => {
      startedPhases.push(phase.fileName);
    },
    onPhaseComplete: (phase, result) => {
      completedPhases.push(phase.fileName);
    },
    onAllComplete: (total) => {
      allCompleteCount = total;
    }
  });

  // Emulate agent responses creating new conversation sessions for each phase
  let currentSimConvIndex = 0;
  const simulateAgentPhaseResponse = () => {
    currentSimConvIndex++;
    const convId = `conv_e2e_phase_${currentSimConvIndex}_${Date.now()}`;
    const logDir = path.join(tempBrainDir, convId, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const transcriptPath = path.join(logDir, 'transcript.jsonl');

    // Emulate step 1: user input (should be ignored by strict matcher)
    const userLine = JSON.stringify({
      step_index: 1,
      type: 'USER_INPUT',
      content: `Prompt with keyword Done skul9x. in user prompt`
    });

    // Emulate step 2: model response with completion keyword
    const modelLine = JSON.stringify({
      step_index: 2,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      status: 'DONE',
      content: `Phase ${currentSimConvIndex} implementation completed successfully. Done skul9x.`
    });

    fs.writeFileSync(transcriptPath, `${userLine}\n${modelLine}\n`, 'utf8');
  };

  const simulationTimer = setInterval(() => {
    if (orchestratorInstance.getState() === 'waiting') {
      simulateAgentPhaseResponse();
    }
  }, 80);

  const runResult = await orchestratorInstance.startFolder(tempPlanDir);
  clearInterval(simulationTimer);

  assert.strictEqual(runResult, true, 'startFolder should succeed');
  assert.strictEqual(allCompleteCount, 3, 'All 3 phases should be reported as complete');
  assert.deepStrictEqual(startedPhases, ['phase-01-scaffold.md', 'phase-02-core-logic.md', 'phase-03-verification.md']);
  assert.deepStrictEqual(completedPhases, ['phase-01-scaffold.md', 'phase-02-core-logic.md', 'phase-03-verification.md']);
  assert.strictEqual(orchestratorInstance.getState(), 'completed');
  assert.strictEqual(orchestratorInstance.isRunning(), false);

  // Check that clipboard pasted dynamic prompts for all 3 phases
  assert.strictEqual(clipboardPasted.length, 3, 'Must copy 3 rendered prompts');
  assert.ok(clipboardPasted[0].includes('phase-01-scaffold.md'), 'Phase 1 clipboard text must match template');
  assert.ok(clipboardPasted[1].includes('phase-02-core-logic.md'), 'Phase 2 clipboard text must match template');
  assert.ok(clipboardPasted[2].includes('phase-03-verification.md'), 'Phase 3 clipboard text must match template');

  // Check key sequence (Ctrl+Shift+L, Ctrl+A, Ctrl+V, Enter for each phase)
  const openChatKeyCount = keySequence.filter(k => k.includes('^+l')).length;
  assert.strictEqual(openChatKeyCount, 3, 'Must trigger Ctrl+Shift+L 3 times');
  console.log('✔ Full 3-phase execution with conversation transitions verified');

  // -------------------------------------------------------------------------
  // 5. Test Phase Skipping and Stop Controls
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Testing Skip Phase and Abort Controls ---');
  let skipEventPhase: PhaseItem | null = null;
  const testSkipOrchestrator = new Orchestrator({
    configProvider: () => ({
      promptText: 'Skip Test',
      repeatCount: 3,
      completionKeyword: 'Done skul9x.',
      delayBetweenLoopsMs: 100,
      timeoutPerLoopMinutes: 1
    }),
    keyboardManager: mockKb,
    transcriptWatcher: watcher,
    onSkipped: (phase) => {
      skipEventPhase = phase;
    }
  });

  const skipExecutionPromise = testSkipOrchestrator.startFolder(tempPlanDir);
  await new Promise(r => setTimeout(r, 60));
  assert.strictEqual(testSkipOrchestrator.isRunning(), true);

  // Skip Phase 1
  testSkipOrchestrator.skipCurrentPhase();
  await new Promise(r => setTimeout(r, 60));
  assert.ok(skipEventPhase !== null, 'onSkipped event should have fired');

  // Stop Auto-Plan
  testSkipOrchestrator.stop();
  await skipExecutionPromise;
  assert.strictEqual(testSkipOrchestrator.isRunning(), false);
  assert.strictEqual(testSkipOrchestrator.getState(), 'stopped');
  console.log('✔ Skip phase and immediate stop controls verified');

  // -------------------------------------------------------------------------
  // 6. UI & Status Bar Tooltip / Formatting Verification
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Testing UI Formatting and Status Bar Tooltip ---');
  const elapsedFormatted = formatElapsedTime(125000);
  assert.strictEqual(elapsedFormatted, '02:05', 'formatElapsedTime should format 125000ms as 02:05');

  const tooltipMd = buildRunningTooltip('test-plan', 1, 3, 'phase-02.md', 'Waiting for Agent', 45000);
  assert.ok(tooltipMd.value.includes('Phase 2 of 3 (33%)'));
  assert.ok(tooltipMd.value.includes('`phase-02.md`'));
  assert.ok(tooltipMd.value.includes('00:45'));

  const mockExtContext: any = {
    subscriptions: [],
    workspaceState: {
      get: (k: string, d?: any) => d,
      update: async () => {}
    },
    globalState: {
      get: (k: string, d?: any) => d || [],
      update: async () => {}
    }
  };

  const quickPickItems = buildFolderQuickPickItems(mockExtContext);
  assert.ok(quickPickItems.some(i => i.type === 'browse'), 'QuickPick items must include Browse Folder option');
  assert.ok(quickPickItems.some(i => i.type === 'manual'), 'QuickPick items must include Manual Path option');

  // Extension activate & deactivate lifecycle
  registeredCommands = {};
  createdStatusBarItems = [];
  activate(mockExtContext);

  assert.ok(registeredCommands['autoplan.start'], 'autoplan.start command registered');
  assert.ok(registeredCommands['autoplan.stop'], 'autoplan.stop command registered');
  assert.ok(registeredCommands['autoplan.skipPhase'], 'autoplan.skipPhase command registered');
  assert.ok(registeredCommands['autoplan.actionMenu'], 'autoplan.actionMenu command registered');
  assert.ok(registeredCommands['autoplan.openTranscript'], 'autoplan.openTranscript command registered');
  assert.ok(registeredCommands['autoplan.setPrompt'], 'autoplan.setPrompt command registered');

  deactivate();
  for (const sub of mockExtContext.subscriptions) {
    if (sub.dispose) sub.dispose();
  }
  console.log('✔ UI QuickPick, Tooltip formatting, and Extension Lifecycle verified');

  // -------------------------------------------------------------------------
  // 7. VSIX Package Archive & Integrity Verification
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Testing VSIX Production Package Archive Integrity ---');
  const vsixPath = path.join(rootDir, 'antigravity-auto-plan-1.0.0.vsix');
  assert.ok(fs.existsSync(vsixPath), `VSIX package artifact must exist at: ${vsixPath}`);

  const vsixStats = fs.statSync(vsixPath);
  assert.ok(vsixStats.size > 2000, `VSIX size must be substantial (> 2KB), actual: ${vsixStats.size} bytes`);

  // Verify Zip Magic Header: 50 4B 03 04 (PK\x03\x04)
  const fd = fs.openSync(vsixPath, 'r');
  const headerBuf = Buffer.alloc(4);
  fs.readSync(fd, headerBuf, 0, 4, 0);
  fs.closeSync(fd);
  assert.strictEqual(headerBuf.toString('hex'), '504b0304', 'VSIX must have standard PK zip header 504b0304');
  console.log(`✔ VSIX archive integrity confirmed: ${vsixStats.size} bytes (Header: 504b0304)`);

  // Clean up test directories
  try {
    fs.rmSync(tempPlanDir, { recursive: true, force: true });
    fs.rmSync(tempBrainDir, { recursive: true, force: true });
  } catch {}

  console.log('\n======================================================================');
  console.log('🎉 ALL PHASE 05 E2E & PACKAGING VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('======================================================================\n');
}

runPhase05ComprehensiveE2ETests().catch((err) => {
  console.error('\n❌ Phase 05 Test Failed:', err);
  process.exit(1);
});
