// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let createdStatusBarItems: any[] = [];
let shownInfoMessages: string[] = [];
let shownErrorMessages: string[] = [];
let shownWarningMessages: string[] = [];

const configStore: { [key: string]: any } = {
  defaultPromptTemplate: 'Implement the code closely following the file {xxx}',
  promptTemplate: 'Implement the code closely following the file {xxx}',
  promptText: 'Implement the code closely following the file {xxx}',
  repeatCount: 3,
  completionKeyword: 'Done skul9x.',
  delayBetweenLoopsMs: 30,
  timeoutPerLoopMinutes: 15,
  focusDelayMs: 50,
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
import { SidebarProvider } from '../sidebarProvider';
import {
  buildLinuxElevationCommand,
  buildWindowsElevationCommand,
  isBridgeInstalled
} from '../workbenchInjector';

async function runPhase03E2ECrossPlatformReleaseFixTests() {
  console.log('======================================================================');
  console.log('🚀 Running Phase 03: Full Regression E2E Release Verification Tests');
  console.log('======================================================================\n');

  const rootDir = path.resolve(__dirname, '..', '..');

  // -------------------------------------------------------------------------
  // 1. Cross-Platform Elevation & Dispatcher Matrix
  // -------------------------------------------------------------------------
  console.log('--- 1. Testing Elevation Command Builders & Transport Matrix ---');

  // 1.1 Linux Elevation Command (pkexec)
  const linuxElev = buildLinuxElevationCommand('/tmp/src.tmp', '/usr/share/code/workbench.html');
  assert.ok(linuxElev.includes('pkexec'), 'Linux elevation command must use pkexec');
  assert.ok(linuxElev.includes('/tmp/src.tmp'), 'Linux command must reference source file');
  assert.ok(linuxElev.includes('/usr/share/code/workbench.html'), 'Linux command must reference target file');

  // 1.2 Windows Elevation Command (PowerShell runAs)
  const winElev = buildWindowsElevationCommand('C:\\src.tmp', 'C:\\Program Files\\VSCode\\workbench.html');
  assert.ok(winElev.includes('powershell'), 'Windows elevation command must use powershell');
  assert.ok(winElev.includes('runAs'), 'Windows command must use Verb runAs');

  // 1.3 Dispatcher Fallback Readiness Checks
  const emptyBridgeServer = new BridgeServer({ portStart: 49450, portEnd: 49460, windowKey: 'e2e-p03-win' });
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

  const unreadyResult = unreadyDispatcher.validateDispatchReadiness('linux');
  assert.strictEqual(unreadyResult.ready, false, 'Pre-flight check must return ready=false on Linux without xdotool or bridge');

  const mockKmWithXdotool = new KeyboardManager();
  mockKmWithXdotool.checkLinuxKeyboardPrerequisites = () => ({ available: true, binary: '/usr/bin/xdotool' });
  const linuxFallbackDispatcher = new PromptDispatcher({
    bridgeServer: emptyBridgeServer,
    keyboardManager: mockKmWithXdotool
  });
  const linuxFallbackRes = linuxFallbackDispatcher.validateDispatchReadiness('linux');
  assert.strictEqual(linuxFallbackRes.ready, true);
  assert.strictEqual(linuxFallbackRes.selectedTier, 'keyboard');

  const winFallbackDispatcher = new PromptDispatcher({ bridgeServer: emptyBridgeServer });
  const winFallbackRes = winFallbackDispatcher.validateDispatchReadiness('win32');
  assert.strictEqual(winFallbackRes.ready, true);
  assert.strictEqual(winFallbackRes.selectedTier, 'keyboard');

  console.log('✔ Cross-platform elevation commands & dispatch fallback matrix verified.');

  // -------------------------------------------------------------------------
  // 2. Port Range Dynamic Probing & Server Lifecycle
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Testing Port Range Probing & Bridge Server ---');
  const customBridge = new BridgeServer({ portStart: 48860, portEnd: 48900, windowKey: 'p03-probe-win' });
  const activePort = await customBridge.start();
  assert.ok(activePort >= 48860 && activePort <= 48900, `Active port ${activePort} must be within range 48860-48900`);
  assert.strictEqual(customBridge.getPort(), activePort);
  assert.strictEqual(customBridge.isListening(), true);

  // Status endpoint verification
  const statusRes = await new Promise<any>((resolve) => {
    http.get(`http://127.0.0.1:${activePort}/autoplan-status?clientVersion=1.4.0&windowKey=p03-probe-win`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({});
        }
      });
    }).on('error', () => resolve({}));
  });

  assert.strictEqual(statusRes.service, 'autoplan-bridge-server');
  assert.strictEqual(statusRes.activeWindowKey, 'p03-probe-win');
  assert.ok(customBridge.getConnectedClients().length > 0, 'BridgeServer should record connected client');

  await customBridge.stop();
  assert.strictEqual(customBridge.isListening(), false);
  console.log('✔ Port range probing and Bridge Server lifecycle verified.');

  // -------------------------------------------------------------------------
  // 3. Multi-Phase Automated Execution Loop (Synthetic E2E Run)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Testing Multi-Phase Orchestrator & Dispatch Pipeline ---');
  const tempPlanDir = path.join(os.tmpdir(), `ag_p03_plan_${Date.now()}`);
  const tempBrainDir = path.join(os.tmpdir(), `ag_p03_brain_${Date.now()}`);
  fs.mkdirSync(tempPlanDir, { recursive: true });
  fs.mkdirSync(tempBrainDir, { recursive: true });

  fs.writeFileSync(path.join(tempPlanDir, 'phase-01-setup.md'), '# Phase 1: Setup\nStatus: Pending');
  fs.writeFileSync(path.join(tempPlanDir, 'phase-02-core.md'), '# Phase 2: Core\nStatus: Pending');
  fs.writeFileSync(path.join(tempPlanDir, 'phase-03-verify.md'), '# Phase 3: Verify\nStatus: Pending');

  const e2eBridgeServer = new BridgeServer({ portStart: 49470, portEnd: 49490, windowKey: 'p03-e2e-win' });
  const e2ePort = await e2eBridgeServer.start();

  // Register client
  await new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: e2ePort,
        path: '/autoplan-status?clientVersion=1.4.0&windowKey=p03-e2e-win',
        method: 'GET'
      },
      () => resolve(true)
    );
    req.on('error', () => resolve(false));
    req.end();
  });

  const dispatcherReady = new PromptDispatcher({ bridgeServer: e2eBridgeServer });
  assert.strictEqual(dispatcherReady.validateDispatchReadiness('win32').selectedTier, 'domBridge');

  const watcher = new TranscriptWatcher({
    brainDir: tempBrainDir,
    keyword: 'Done skul9x.',
    pollIntervalMs: 20,
    settleQuietPeriodMs: 40
  });

  const mockKb = new KeyboardManager({
    customClipboardSetter: async () => {},
    customKeySender: async () => {}
  });

  const startedPhases: string[] = [];
  const completedPhases: string[] = [];
  let allDone = false;

  const orchestrator = new Orchestrator({
    configProvider: () => ({
      promptText: 'Implement phase: {file}',
      promptTemplate: 'Implement phase: {file}',
      defaultPromptTemplate: 'Implement phase: {file}',
      repeatCount: 3,
      completionKeyword: 'Done skul9x.',
      delayBetweenLoopsMs: 20,
      timeoutPerLoopMinutes: 1,
      focusDelayMs: 10
    }),
    keyboardManager: mockKb,
    transcriptWatcher: watcher,
    promptDispatcher: dispatcherReady,
    onPhaseStart: (p) => startedPhases.push(p.fileName),
    onPhaseComplete: (p) => completedPhases.push(p.fileName),
    onAllComplete: () => { allDone = true; }
  });

  let loopIndex = 0;
  const responder = setInterval(async () => {
    // Ack pending bridge commands
    const sRes = await new Promise<any>((resolve) => {
      http.get(`http://127.0.0.1:${e2ePort}/autoplan-status?windowKey=p03-e2e-win`, (r) => {
        let b = '';
        r.on('data', chunk => b += chunk);
        r.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } });
      }).on('error', () => resolve({}));
    });

    if (sRes.pendingCommands && sRes.pendingCommands.length > 0) {
      for (const cmd of sRes.pendingCommands) {
        const postData = JSON.stringify({
          commandId: cmd.id,
          status: 'submitClicked',
          windowKey: 'p03-e2e-win'
        });
        const req = http.request({
          host: '127.0.0.1',
          port: e2ePort,
          path: '/autoplan-ack',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        });
        req.write(postData);
        req.end();
      }
    }

    if (orchestrator.getState() === 'waiting') {
      loopIndex++;
      const convId = `conv_p03_${loopIndex}_${Date.now()}`;
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
  }, 50);

  const startSuccess = await orchestrator.startFolder(tempPlanDir);
  clearInterval(responder);
  await e2eBridgeServer.stop();

  assert.strictEqual(startSuccess, true);
  assert.strictEqual(startedPhases.length, 3);
  assert.strictEqual(completedPhases.length, 3);
  assert.strictEqual(allDone, true);

  console.log('✔ Multi-phase automated execution loop verified.');

  // -------------------------------------------------------------------------
  // 4. Sidebar Control Center Webview IPC
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Testing Sidebar Provider & Webview IPC ---');
  let postedMessages: any[] = [];
  const mockWebview: any = {
    webview: {
      options: {},
      html: '',
      cspSource: 'https://mock.csp',
      asWebviewUri: (uri: any) => uri,
      postMessage: async (msg: any) => {
        postedMessages.push(msg);
        return true;
      },
      onDidReceiveMessage: (cb: any) => {
        mockWebview._onDidReceiveMessage = cb;
        return { dispose: () => {} };
      }
    }
  };

  const sidebarProvider = new SidebarProvider(mockContext.extensionUri, mockContext);
  sidebarProvider.resolveWebviewView(mockWebview, {} as any, {} as any);

  // Send selectPlanFolder
  await mockWebview._onDidReceiveMessage({ command: 'selectPlanFolder', folderPath: tempPlanDir });
  const lastState = postedMessages.filter(m => m.type === 'stateUpdate').pop();
  assert.ok(lastState, 'Sidebar must post stateUpdate after selecting folder');
  assert.strictEqual(lastState.phases.length, 3);

  // Send togglePhase
  await mockWebview._onDidReceiveMessage({ command: 'togglePhase', index: 0, selected: true });
  await new Promise(r => setTimeout(r, 20));
  const toggledState1 = postedMessages.filter(m => m.type === 'stateUpdate').pop();
  assert.ok(toggledState1.selectedIndices.includes(0), 'selectedIndices should include 0 after toggling on');

  await mockWebview._onDidReceiveMessage({ command: 'togglePhase', index: 0, selected: false });
  await new Promise(r => setTimeout(r, 20));
  const toggledState2 = postedMessages.filter(m => m.type === 'stateUpdate').pop();
  assert.ok(!toggledState2.selectedIndices.includes(0), 'selectedIndices should not include 0 after toggling off');

  console.log('✔ Sidebar Provider Webview IPC communications verified.');

  // -------------------------------------------------------------------------
  // 5. Release Package (.vsix) Integrity Verification
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Testing VSIX Package Integrity & Header ---');
  const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const vsixFileName = `antigravity-auto-plan-${pkgJson.version}.vsix`;
  let vsixPath = path.join(rootDir, vsixFileName);

  if (!fs.existsSync(vsixPath)) {
    const rootFiles = fs.readdirSync(rootDir);
    const candidate = rootFiles.find(f => f.startsWith('antigravity-auto-plan-') && f.endsWith('.vsix'));
    if (candidate) {
      vsixPath = path.join(rootDir, candidate);
    }
  }

  assert.ok(fs.existsSync(vsixPath), `VSIX package must exist at ${vsixPath}`);
  const vsixStat = fs.statSync(vsixPath);
  assert.ok(vsixStat.size > 2048, `VSIX package size must be > 2KB (actual: ${vsixStat.size} bytes)`);

  const vsixFd = fs.openSync(vsixPath, 'r');
  const magicBuf = Buffer.alloc(4);
  fs.readSync(vsixFd, magicBuf, 0, 4, 0);
  fs.closeSync(vsixFd);

  assert.strictEqual(magicBuf.toString('hex'), '504b0304', 'VSIX archive must have valid ZIP magic bytes (50 4B 03 04)');
  console.log(`✔ VSIX archive ${path.basename(vsixPath)} (${(vsixStat.size / 1024).toFixed(1)} KB) validated.`);

  // Cleanup temporary directories
  try {
    fs.rmSync(tempPlanDir, { recursive: true, force: true });
    fs.rmSync(tempBrainDir, { recursive: true, force: true });
  } catch {}

  console.log('\n======================================================================');
  console.log('🎉 ALL PHASE 03 E2E RELEASE VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('======================================================================\n');
}

runPhase03E2ECrossPlatformReleaseFixTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ Phase 03 E2E Release Verification Test Failed:', err);
  process.exit(1);
});
