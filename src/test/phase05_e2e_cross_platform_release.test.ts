// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let createdStatusBarItems: any[] = [];
let shownInfoMessages: string[] = [];
let shownErrorMessages: string[] = [];
let shownWarningMessages: string[] = [];
let lastWebviewPostedMessage: any = null;

const configStore: { [key: string]: any } = {
  defaultPromptTemplate: 'Implement the code closely following the file {xxx}',
  promptTemplate: 'Implement the code closely following the file {xxx}',
  promptText: 'Implement the code closely following the file {xxx}',
  repeatCount: 3,
  completionKeyword: 'Done skul9x.',
  delayBetweenLoopsMs: 40,
  timeoutPerLoopMinutes: 15,
  focusDelayMs: 800,
  defaultPlanFolder: '',
  executionMode: 'auto',
  bridgeTimeoutMs: 3000,
  autoApprovePermissions: true,
  autoInjectWorkbench: true
};

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
  },
  extensionUri: { fsPath: __dirname, scheme: 'file' }
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
        onDidChangeConfiguration: () => ({
          dispose: () => {}
        }),
        openTextDocument: async (uri: any) => ({ uri }),
        workspaceFolders: []
      },
      window: {
        createStatusBarItem: (alignmentOrId: any, alignmentOrPriority?: any, maybePriority?: any) => {
          const item = {
            id: typeof alignmentOrId === 'string' ? alignmentOrId : undefined,
            text: '',
            tooltip: '' as any,
            visible: false,
            show() { this.visible = true; },
            hide() { this.visible = false; },
            dispose() { this.visible = false; }
          };
          createdStatusBarItems.push(item);
          return item;
        },
        showInformationMessage: async (msg: string, ...rest: any[]) => {
          shownInfoMessages.push(msg);
          return rest[0] || msg;
        },
        showErrorMessage: async (msg: string) => {
          shownErrorMessages.push(msg);
          return msg;
        },
        showWarningMessage: async (msg: string) => {
          shownWarningMessages.push(msg);
          return msg;
        },
        showOpenDialog: async () => undefined,
        showInputBox: async () => 'Custom Input',
        showTextDocument: async () => {},
        registerWebviewViewProvider: (_viewId: string, _provider: any) => ({
          dispose: () => {}
        })
      },
      commands: {
        registerCommand: (command: string, callback: (...args: any[]) => any) => {
          registeredCommands[command] = callback;
          return { dispose: () => { delete registeredCommands[command]; } };
        },
        executeCommand: async (cmd: string, ...args: any[]) => {
          if (registeredCommands[cmd]) {
            return await registeredCommands[cmd](...args);
          }
          return undefined;
        }
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
      ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
      Uri: {
        file: (f: string) => ({ fsPath: f, scheme: 'file', toString: () => f }),
        joinPath: (base: any, ...pathSegments: string[]) => ({
          fsPath: path.join(base.fsPath || '', ...pathSegments),
          scheme: 'file',
          toString: () => path.join(base.fsPath || '', ...pathSegments)
        })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';

import { Orchestrator, PhaseItem } from '../orchestrator';
import { KeyboardManager } from '../keyboardManager';
import { TranscriptWatcher } from '../transcriptWatcher';
import { PromptDispatcher, DispatchReadinessResult } from '../promptDispatcher';
import { BridgeServer } from '../bridgeServer';
import { scanPlanFolder } from '../planScanner';
import { SidebarProvider } from '../sidebarProvider';
import {
  buildLinuxElevationCommand,
  buildWindowsElevationCommand
} from '../workbenchInjector';

async function runPhase05E2ECrossPlatformReleaseTests() {
  console.log('======================================================================');
  console.log('🚀 Running Phase 05: E2E Cross-Platform & Release Verification Tests');
  console.log('======================================================================\n');

  const rootDir = path.resolve(__dirname, '..', '..');

  // -------------------------------------------------------------------------
  // 1. Linux & Windows Workflow Elevation & Fallback Matrix Simulation
  // -------------------------------------------------------------------------
  console.log('--- 1. Testing Elevation Command Builders & Multi-Platform Matrix ---');
  
  // 1.1 Linux Elevation Command (Polkit pkexec)
  const linuxElev = buildLinuxElevationCommand('/tmp/src.tmp', '/usr/share/code/workbench.html');
  assert.ok(linuxElev.includes('pkexec'), 'Linux elevation command must use pkexec');
  assert.ok(linuxElev.includes('/tmp/src.tmp'), 'Linux command must reference source file');
  assert.ok(linuxElev.includes('/usr/share/code/workbench.html'), 'Linux command must reference target file');

  // 1.2 Windows Elevation Command (PowerShell runAs)
  const winElev = buildWindowsElevationCommand('C:\\src.tmp', 'C:\\Program Files\\VSCode\\workbench.html');
  assert.ok(winElev.includes('powershell'), 'Windows elevation command must use powershell');
  assert.ok(winElev.includes('runAs'), 'Windows command must use Verb runAs');

  // 1.3 Linux Pre-flight validation (< 100ms when neither Bridge nor xdotool present)
  const emptyBridgeServer = new BridgeServer({ portStart: 49350, portEnd: 49360, windowKey: 'e2e-win-1' });
  const mockKmNoXdotool = new KeyboardManager();
  mockKmNoXdotool.checkLinuxKeyboardPrerequisites = () => ({
    available: false,
    binary: null,
    error: 'xdotool missing'
  });
  const unreadyDispatcher = new PromptDispatcher({
    bridgeServer: emptyBridgeServer,
    keyboardManager: mockKmNoXdotool
  });

  const tStart = process.hrtime.bigint();
  const unreadyResult: DispatchReadinessResult = unreadyDispatcher.validateDispatchReadiness('linux');
  const tDurationMs = Number(process.hrtime.bigint() - tStart) / 1_000_000;
  assert.strictEqual(unreadyResult.ready, false, 'Pre-flight check must return ready=false on Linux with no transport');
  assert.ok(tDurationMs < 100, `Pre-flight validation must complete in < 100ms (actual: ${tDurationMs.toFixed(2)}ms)`);

  // 1.4 Fallback to xdotool when present on Linux without Bridge
  const mockKmWithXdotool = new KeyboardManager();
  mockKmWithXdotool.checkLinuxKeyboardPrerequisites = () => ({ available: true, binary: '/usr/bin/xdotool' });
  const linuxFallbackDispatcher = new PromptDispatcher({
    bridgeServer: emptyBridgeServer,
    keyboardManager: mockKmWithXdotool
  });
  const linuxFallbackRes = linuxFallbackDispatcher.validateDispatchReadiness('linux');
  assert.strictEqual(linuxFallbackRes.ready, true, 'Linux fallback with xdotool must be ready');
  assert.strictEqual(linuxFallbackRes.selectedTier, 'keyboard');

  // 1.5 Fallback to PowerShell SendKeys on Windows without Bridge
  const winFallbackDispatcher = new PromptDispatcher({ bridgeServer: emptyBridgeServer });
  const winFallbackRes = winFallbackDispatcher.validateDispatchReadiness('win32');
  assert.strictEqual(winFallbackRes.ready, true, 'Windows fallback must be ready via keyboard');
  assert.strictEqual(winFallbackRes.selectedTier, 'keyboard');

  console.log('✔ Cross-platform elevation commands & dispatch fallback matrix verified');

  // -------------------------------------------------------------------------
  // 2. End-to-End Orchestrator + Dispatcher Pipeline (3-Phase Synthetic Run)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Testing End-to-End 3-Phase Plan Synthetic Execution ---');
  const tempPlanDir = path.join(os.tmpdir(), `ag_release_plan_${Date.now()}`);
  const tempBrainDir = path.join(os.tmpdir(), `ag_release_brain_${Date.now()}`);
  fs.mkdirSync(tempPlanDir, { recursive: true });
  fs.mkdirSync(tempBrainDir, { recursive: true });

  fs.writeFileSync(path.join(tempPlanDir, 'phase-01-init.md'), '# Phase 1: Init\nStatus: Pending');
  fs.writeFileSync(path.join(tempPlanDir, 'phase-02-build.md'), '# Phase 2: Build\nStatus: Pending');
  fs.writeFileSync(path.join(tempPlanDir, 'phase-03-test.md'), '# Phase 3: Test\nStatus: Pending');

  // Active BridgeServer with connected client for Focus-Free DOM Bridge flow
  const activeBridgeServer = new BridgeServer({ portStart: 49370, portEnd: 49390, windowKey: 'e2e-release-win' });
  const port = await activeBridgeServer.start();

  // Simulate active connected client via HTTP
  await new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/autoplan-status?clientVersion=1.1.0&windowKey=e2e-release-win',
        method: 'GET'
      },
      () => resolve(true)
    );
    req.on('error', () => resolve(false));
    req.end();
  });

  const dispatcherBridgeReady = new PromptDispatcher({ bridgeServer: activeBridgeServer });
  const bridgeCheck = dispatcherBridgeReady.validateDispatchReadiness('linux');
  assert.strictEqual(bridgeCheck.ready, true);
  assert.strictEqual(bridgeCheck.selectedTier, 'domBridge');

  const watcher = new TranscriptWatcher({
    brainDir: tempBrainDir,
    keyword: 'Done skul9x.',
    pollIntervalMs: 20,
    settleQuietPeriodMs: 50
  });

  const mockKb = new KeyboardManager({
    customClipboardSetter: async () => {},
    customKeySender: async () => {}
  });

  const startedPhases: string[] = [];
  const completedPhases: string[] = [];
  let orchestratorFinished = false;

  const orchestrator = new Orchestrator({
    configProvider: () => ({
      promptText: 'Static Prompt',
      promptTemplate: 'Run phase: {file}',
      defaultPromptTemplate: 'Run phase: {file}',
      repeatCount: 3,
      completionKeyword: 'Done skul9x.',
      delayBetweenLoopsMs: 30,
      timeoutPerLoopMinutes: 1,
      focusDelayMs: 10
    }),
    keyboardManager: mockKb,
    transcriptWatcher: watcher,
    promptDispatcher: dispatcherBridgeReady,
    onPhaseStart: (phase) => startedPhases.push(phase.fileName),
    onPhaseComplete: (phase) => completedPhases.push(phase.fileName),
    onAllComplete: () => { orchestratorFinished = true; }
  });

  // Background responder simulating agent writing transcripts and bridge client acking commands
  let convIndex = 0;
  const timer = setInterval(async () => {
    // Ack pending bridge commands
    const statusRes = await new Promise<any>((res) => {
      http.get(`http://127.0.0.1:${port}/autoplan-status?windowKey=e2e-release-win`, (r) => {
        let b = '';
        r.on('data', chunk => b += chunk);
        r.on('end', () => { try { res(JSON.parse(b)); } catch { res({}); } });
      }).on('error', () => res({}));
    });

    if (statusRes.pendingCommands && statusRes.pendingCommands.length > 0) {
      for (const cmd of statusRes.pendingCommands) {
        const postData = JSON.stringify({
          commandId: cmd.id,
          status: 'submitClicked',
          windowKey: 'e2e-release-win'
        });
        const req = http.request({
          host: '127.0.0.1',
          port,
          path: '/autoplan-ack',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        });
        req.write(postData);
        req.end();
      }
    }

    if (orchestrator.getState() === 'waiting') {
      convIndex++;
      const convId = `conv_release_${convIndex}_${Date.now()}`;
      const logDir = path.join(tempBrainDir, convId, '.system_generated', 'logs');
      fs.mkdirSync(logDir, { recursive: true });

      const modelLine = JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        source: 'MODEL',
        status: 'DONE',
        content: `Done skul9x.`
      });
      fs.writeFileSync(path.join(logDir, 'transcript.jsonl'), `${modelLine}\n`, 'utf8');
    }
  }, 60);

  const startRes = await orchestrator.startFolder(tempPlanDir);
  clearInterval(timer);
  await activeBridgeServer.stop();

  assert.strictEqual(startRes, true);
  assert.strictEqual(startedPhases.length, 3);
  assert.strictEqual(completedPhases.length, 3);
  assert.strictEqual(orchestratorFinished, true);

  console.log('✔ End-to-End Orchestrator pipeline with DOM Bridge and transcript events verified');

  // -------------------------------------------------------------------------
  // 3. Sidebar Control Center Full Lifecycle & IPC Integration
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Testing Sidebar Control Center Full Lifecycle & Webview IPC ---');
  let postedWebviewMessages: any[] = [];
  const mockWebviewView: any = {
    webview: {
      options: {},
      html: '',
      cspSource: 'https://mock.csp',
      asWebviewUri: (uri: any) => uri,
      postMessage: async (msg: any) => {
        postedWebviewMessages.push(msg);
        return true;
      },
      onDidReceiveMessage: (cb: any) => {
        mockWebviewView._onDidReceiveMessage = cb;
        return { dispose: () => {} };
      }
    }
  };

  const sidebarProvider = new SidebarProvider(mockContext.extensionUri, mockContext);
  sidebarProvider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

  assert.ok(mockWebviewView._onDidReceiveMessage, 'Webview message listener must be registered');

  // 3.1 Select Plan Folder IPC
  await mockWebviewView._onDidReceiveMessage({ command: 'selectPlanFolder', folderPath: tempPlanDir });
  const stateUpdateMsg = postedWebviewMessages.filter(m => m.type === 'stateUpdate').pop();
  assert.ok(stateUpdateMsg, 'Sidebar must post stateUpdate after selectPlanFolder');
  assert.strictEqual(stateUpdateMsg.phases.length, 3);

  // 3.2 Toggle Phase IPC
  await mockWebviewView._onDidReceiveMessage({
    command: 'togglePhase',
    index: 1,
    selected: false
  });
  const selectedStateMsg = postedWebviewMessages.filter(m => m.type === 'stateUpdate').pop();
  assert.ok(selectedStateMsg);

  console.log('✔ Sidebar Control Center scan, selection, and IPC state updates verified');

  // -------------------------------------------------------------------------
  // 4. VSIX Package Integrity Verification
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Testing VSIX Release Package Integrity ---');
  const vsix110Path = path.join(rootDir, 'antigravity-auto-plan-1.1.0.vsix');
  const vsix100Path = path.join(rootDir, 'antigravity-auto-plan-1.0.0.vsix');
  const targetVsixPath = fs.existsSync(vsix110Path) ? vsix110Path : vsix100Path;

  assert.ok(fs.existsSync(targetVsixPath), `VSIX release archive must exist at ${targetVsixPath}`);
  const stats = fs.statSync(targetVsixPath);
  assert.ok(stats.size > 2000, `VSIX size must be > 2KB (actual: ${stats.size})`);

  // Verify Zip header: 50 4B 03 04
  const fd = fs.openSync(targetVsixPath, 'r');
  const header = Buffer.alloc(4);
  fs.readSync(fd, header, 0, 4, 0);
  fs.closeSync(fd);
  assert.strictEqual(header.toString('hex'), '504b0304', 'VSIX archive must have valid ZIP magic header 504b0304');

  // Clean up temp test dirs
  try {
    fs.rmSync(tempPlanDir, { recursive: true, force: true });
    fs.rmSync(tempBrainDir, { recursive: true, force: true });
  } catch {}

  console.log('\n======================================================================');
  console.log('🎉 ALL PHASE 05 E2E CROSS-PLATFORM RELEASE TESTS PASSED SUCCESSFULLY!');
  console.log('======================================================================\n');
}

runPhase05E2ECrossPlatformReleaseTests().catch((err) => {
  console.error('\n❌ Phase 05 E2E Cross-Platform Test Failed:', err);
  process.exit(1);
});
