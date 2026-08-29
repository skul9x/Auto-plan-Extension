// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockGlobalState = new Map<string, any>();
const mockWorkspaceState = new Map<string, any>();
const mockRegisteredCommands: Record<string, Function> = {};

let mockActiveTextEditor: any = null;
let mockAppRoot: string | undefined = undefined;

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        }),
        workspaceFolders: [],
        openTextDocument: async (uri: any) => ({ uri }),
        onDidChangeConfiguration: () => ({ dispose: () => {} })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      StatusBarAlignment: {
        Left: 1,
        Right: 2
      },
      ViewColumn: {
        Active: -1,
        One: 1
      },
      QuickInputButtons: {
        Back: { id: 'back' }
      },
      ThemeIcon: class {
        constructor(public id: string) {}
      },
      MarkdownString: class {
        public isTrusted: boolean = false;
        constructor(public value: string) {}
      },
      Uri: {
        file: (fsPath: string) => ({
          fsPath,
          scheme: 'file',
          toString: () => `file://${fsPath}`
        }),
        joinPath: (baseUri: any, ...segments: string[]) => {
          const joined = require('path').join(baseUri.fsPath || '', ...segments);
          return {
            fsPath: joined,
            scheme: 'file',
            toString: () => `file://${joined}`
          };
        }
      },
      env: {
        get appRoot() {
          return mockAppRoot;
        },
        clipboard: {
          writeText: async () => {},
          readText: async () => ''
        }
      },
      commands: {
        registerCommand: (command: string, callback: Function) => {
          mockRegisteredCommands[command] = callback;
          return { dispose: () => { delete mockRegisteredCommands[command]; } };
        },
        executeCommand: async (command: string, ...args: any[]) => {
          if (mockRegisteredCommands[command]) {
            return mockRegisteredCommands[command](...args);
          }
          return undefined;
        }
      },
      window: {
        get activeTextEditor() {
          return mockActiveTextEditor;
        },
        createStatusBarItem: (_align?: any, _priority?: number) => {
          return {
            text: '',
            tooltip: '',
            command: '',
            show: () => {},
            hide: () => {},
            dispose: () => {}
          };
        },
        createWebviewPanel: (_viewType: string, _title: string, _column: any, _options: any) => {
          return {
            webview: {
              html: '',
              options: {},
              cspSource: 'vscode-webview:',
              asWebviewUri: (uri: any) => uri,
              postMessage: async (_msg: any) => true,
              onDidReceiveMessage: () => ({ dispose: () => {} })
            },
            iconPath: undefined,
            reveal: () => {},
            dispose: () => {},
            onDidDispose: (cb: Function) => { cb(); return { dispose: () => {} }; }
          };
        },
        registerWebviewViewProvider: () => ({ dispose: () => {} }),
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showQuickPick: async (items: any[]) => items[0],
        showTextDocument: async () => {}
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
import { BridgeServer, bridgeServer as globalBridgeServer } from '../bridgeServer';
import { PromptDispatcher } from '../promptDispatcher';
import { KeyboardManager } from '../keyboardManager';
import { Orchestrator, PhaseItem } from '../orchestrator';
import { TranscriptWatcher, CompletionResult } from '../transcriptWatcher';
import { AutoPlanConfig, DEFAULT_CONFIG, DEFAULT_COMPLETION_KEYWORD } from '../config';
import {
  updateBridgeStatusBar,
  getBridgeStatusBarItem,
  setMainStatusBarItem,
  activate as activateExtension
} from '../extension';
import { SettingsProvider } from '../settingsProvider';
import { SidebarProvider } from '../sidebarProvider';
import { isBridgeInstalled, installBridgeScript } from '../workbenchInjector';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function writeTranscriptLog(convDir: string, content: string, delayMs: number = 0) {
  const logsDir = path.join(convDir, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const transcriptPath = path.join(logsDir, 'transcript.jsonl');

  if (delayMs > 0) {
    setTimeout(() => {
      fs.appendFileSync(transcriptPath, content + '\n', 'utf-8');
    }, delayMs);
  } else {
    fs.appendFileSync(transcriptPath, content + '\n', 'utf-8');
  }
}

async function runPhase04BackgroundAutomationE2ETests() {
  console.log('=== Running Phase 04: End-to-End Background Multi-Phase Automation Verification ===\n');

  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-bg-'));
  mockAppRoot = tempBaseDir;

  const wbDir = path.join(tempBaseDir, 'out', 'vs', 'code', 'electron-sandbox', 'workbench');
  fs.mkdirSync(wbDir, { recursive: true });
  const wbPath = path.join(wbDir, 'workbench.html');
  fs.writeFileSync(
    wbPath,
    '<!DOCTYPE html>\n<html><head><title>Workbench</title></head><body><div id="workbench"></div></body></html>',
    'utf-8'
  );

  const tempPlanDir = path.join(tempBaseDir, 'plans');
  const tempBrainDir = path.join(tempBaseDir, 'brain');

  fs.mkdirSync(tempPlanDir, { recursive: true });
  fs.mkdirSync(tempBrainDir, { recursive: true });

  const phase1Path = path.join(tempPlanDir, 'phase-01-scaffold.md');
  const phase2Path = path.join(tempPlanDir, 'phase-02-implement.md');
  const phase3Path = path.join(tempPlanDir, 'phase-03-verify.md');

  fs.writeFileSync(phase1Path, '# Phase 1: Scaffold Background Architecture\nVerify Tier 1 DOM Bridge prompt dispatch', 'utf-8');
  fs.writeFileSync(phase2Path, '# Phase 2: Implement Multi-Phase Progression\nVerify automated loop advancement', 'utf-8');
  fs.writeFileSync(phase3Path, '# Phase 3: Final Verification\nVerify zero foreground interruption and clean completion', 'utf-8');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Background Status Indications (Status Bar, Settings, Sidebar)
    // -------------------------------------------------------------------------
    console.log('[Test 1] Verifying Background Status Indications across Status Bar, Settings, and Sidebar...');

    const server1 = new BridgeServer({
      portStart: 49200,
      portEnd: 49220,
      windowKey: 'test-bg-win-1'
    });
    const port1 = await server1.start();

    // Start background simulated DOM client
    let domClient1Running = true;
    const client1Poll = setInterval(() => {
      if (!domClient1Running) return;
      try {
        const req = http.request({
          hostname: '127.0.0.1',
          port: port1,
          path: '/autoplan-status?windowKey=test-bg-win-1',
          method: 'GET'
        }, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {});
        });
        req.on('error', () => {});
        req.end();
      } catch {}
    }, 20);

    await sleep(60);

    // Verify Settings Diagnostics
    const settingsProviderInstance = SettingsProvider.render(
      { fsPath: tempBaseDir } as any,
      new PromptDispatcher({ bridgeServer: server1 })
    );
    const healthDiag = settingsProviderInstance.getHealthDiagnostics();
    assert.strictEqual(healthDiag.workerKeepAlive, 'Active', 'Settings diagnostics must show Worker Keep-Alive: Active when client connected');
    assert.strictEqual(healthDiag.latencyMs, '< 10ms', 'Settings diagnostics must show Latency: < 10ms');
    assert.strictEqual(healthDiag.clients, 1, 'Settings diagnostics must report 1 connected client');

    // Install bridge script into mock workbench.html and activate extension
    installBridgeScript({ workbenchPath: wbPath, updateChecksums: false });
    assert.strictEqual(isBridgeInstalled(wbPath), true, 'Bridge script should be installed in workbench.html');

    const mockContext: any = {
      subscriptions: [],
      workspaceState: { get: () => undefined, update: async () => {} },
      globalState: { get: () => undefined, update: async () => {} },
      extensionUri: { fsPath: tempBaseDir }
    };
    activateExtension(mockContext);

    // Start globalBridgeServer if not already listening
    if (!globalBridgeServer.isListening()) {
      await globalBridgeServer.start();
    }

    const globalPort = globalBridgeServer.getPort();
    let globalClientPoll: any = null;
    if (globalPort) {
      globalClientPoll = setInterval(() => {
        try {
          const req = http.request({
            hostname: '127.0.0.1',
            port: globalPort,
            path: `/autoplan-status?windowKey=${globalBridgeServer.getActiveWindowKey() || 'main'}`,
            method: 'GET'
          }, (res) => {
            let d = '';
            res.on('data', (c) => (d += c));
          });
          req.on('error', () => {});
          req.end();
        } catch {}
      }, 20);
      await sleep(60);
    }

    const bridgeStatusBar = getBridgeStatusBarItem();
    assert.ok(bridgeStatusBar, 'Bridge status bar item should exist');
    updateBridgeStatusBar();
    assert.ok(
      bridgeStatusBar.text.includes('Bridge: Online (Background Active)') || bridgeStatusBar.text.includes('Bridge: Active'),
      `Status bar text should indicate active bridge, got: ${bridgeStatusBar.text}`
    );

    if (globalClientPoll) {
      clearInterval(globalClientPoll);
    }
    await globalBridgeServer.stop();

    // Verify Sidebar Provider status dispatch
    const sidebarProvider = new SidebarProvider({ fsPath: tempBaseDir } as any, mockContext);
    let postedMessage: any = null;
    const mockWebviewView: any = {
      webview: {
        options: {},
        cspSource: 'vscode-webview:',
        asWebviewUri: (u: any) => u,
        postMessage: async (m: any) => { postedMessage = m; return true; },
        onDidReceiveMessage: () => ({ dispose: () => {} })
      }
    };
    sidebarProvider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    sidebarProvider.sendBridgeStatus('connected');
    assert.ok(postedMessage, 'Sidebar provider must post bridgeStatus update');
    assert.strictEqual(postedMessage.status, 'connected');

    domClient1Running = false;
    clearInterval(client1Poll);
    await server1.stop();
    settingsProviderInstance.dispose();

    console.log('  -> Passed: Status Bar, Settings Panel, and Sidebar correctly reflect Background Active state.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Full End-to-End Multi-Phase Background Orchestration (3 Phases)
    // -------------------------------------------------------------------------
    console.log('[Test 2] Simulating 3-Phase Plan execution in background mode (0 foreground focus)...');

    const server2 = new BridgeServer({
      portStart: 49230,
      portEnd: 49250,
      windowKey: 'test-bg-win-2'
    });
    const port2 = await server2.start();

    // Track foreground focus invocations (must remain 0)
    let foregroundFocusCount = 0;
    const keyboardManagerMock = new KeyboardManager({
      customKeySender: async () => {
        foregroundFocusCount++;
      },
      customClipboardSetter: async () => {
        foregroundFocusCount++;
      }
    });

    const mockConfig: AutoPlanConfig = {
      ...DEFAULT_CONFIG,
      executionMode: 'auto',
      allowTierFallback: true,
      bridgeTimeoutMs: 3000,
      delayBetweenLoopsMs: 30,
      timeoutPerLoopMinutes: 1,
      repeatCount: 3,
      promptTemplate: 'Execute {xxx}',
      promptText: 'Execute {xxx}',
      completionKeyword: DEFAULT_COMPLETION_KEYWORD,
      focusDelayMs: 50,
      autoApprovePermissions: true,
      autoInjectWorkbench: true,
      suppressFallbackWarnings: true
    };

    const dispatcher2 = new PromptDispatcher({
      bridgeServer: server2,
      keyboardManager: keyboardManagerMock,
      configProvider: () => mockConfig
    });

    const watcher2 = new TranscriptWatcher({
      brainDir: tempBrainDir,
      keyword: DEFAULT_COMPLETION_KEYWORD,
      timeoutMs: 4000,
      pollIntervalMs: 20,
      settleQuietPeriodMs: 30
    });

    const orchestrator2 = new Orchestrator({
      transcriptWatcher: watcher2,
      promptDispatcher: dispatcher2,
      keyboardManager: keyboardManagerMock,
      configProvider: () => mockConfig
    });

    let phaseExecutionCount = 0;
    const dispatchedPhases: string[] = [];
    let domClient2Running = true;

    // Simulated background DOM client handling prompts and writing transcript completions
    const client2Poll = setInterval(() => {
      if (!domClient2Running) return;
      try {
        const req = http.request({
          hostname: '127.0.0.1',
          port: port2,
          path: '/autoplan-status?windowKey=test-bg-win-2',
          method: 'GET'
        }, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.pendingCommands && parsed.pendingCommands.length > 0) {
                for (const cmd of parsed.pendingCommands) {
                  phaseExecutionCount++;
                  const currentIdx = phaseExecutionCount;
                  dispatchedPhases.push(cmd.text);

                  // Create new conversation folder in background
                  const convId = `conv_phase_${currentIdx}_${Date.now()}`;
                  const convDir = path.join(tempBrainDir, convId);
                  fs.mkdirSync(convDir, { recursive: true });

                  const stepJson = JSON.stringify({
                    source: 'MODEL',
                    type: 'PLANNER_RESPONSE',
                    status: 'DONE',
                    content: `Phase ${currentIdx} executed in background.\n${DEFAULT_COMPLETION_KEYWORD}`
                  });
                  writeTranscriptLog(convDir, stepJson, 10);

                  // Send instant ACK
                  const ackReq = http.request({
                    hostname: '127.0.0.1',
                    port: port2,
                    path: '/autoplan-ack',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                  });
                  ackReq.write(JSON.stringify({
                    commandId: cmd.id,
                    status: 'submitClicked',
                    windowKey: 'test-bg-win-2',
                    metadata: { promptLength: cmd.text?.length }
                  }));
                  ackReq.end();
                }
              }
            } catch {}
          });
        });
        req.on('error', () => {});
        req.end();
      } catch {}
    }, 20);

    // Give simulated client 60ms to connect
    await sleep(60);

    const completedPhases: PhaseItem[] = [];
    orchestrator2.on('phaseComplete', (phase: PhaseItem) => {
      completedPhases.push({ ...phase });
    });

    const executionSuccess = await orchestrator2.startPhases([phase1Path, phase2Path, phase3Path]);

    assert.strictEqual(executionSuccess, true, 'orchestrator2.startPhases should return true');
    assert.strictEqual(orchestrator2.getState(), 'completed', 'Orchestrator state should be completed');
    assert.strictEqual(completedPhases.length, 3, 'All 3 phases should be marked completed');
    assert.strictEqual(completedPhases[0].fileName, 'phase-01-scaffold.md');
    assert.strictEqual(completedPhases[1].fileName, 'phase-02-implement.md');
    assert.strictEqual(completedPhases[2].fileName, 'phase-03-verify.md');

    for (const p of completedPhases) {
      assert.strictEqual(p.status, 'Completed');
      assert.ok(p.result?.success, `Phase ${p.fileName} result must be successful`);
      assert.strictEqual(p.dispatchResult?.tier, 'domBridge', `Phase ${p.fileName} must use Tier 1 DOM Bridge`);
    }

    // Crucial check: 0 foreground focus interruptions throughout entire multi-phase execution
    assert.strictEqual(foregroundFocusCount, 0, 'Foreground focus count must be 0 (Zero window focus stealing)');

    domClient2Running = false;
    clearInterval(client2Poll);
    await server2.stop();
    orchestrator2.dispose();
    watcher2.dispose();

    console.log('  -> Passed: 3-Phase execution completed in background with 0 foreground focus interruptions.\n');

    // -------------------------------------------------------------------------
    // TEST 3: Graceful Error Recovery (Bridge Fast-Probe Reconnection)
    // -------------------------------------------------------------------------
    console.log('[Test 3] Verifying Graceful Recovery and Fast Reconnect on transient bridge glitch...');

    const server3 = new BridgeServer({
      portStart: 49260,
      portEnd: 49280,
      windowKey: 'test-bg-win-3'
    });
    const port3 = await server3.start();

    let client3Connected = false;
    let domClient3Running = true;

    // Simulate transient glitch: client connects after a 100ms delay when probe occurs
    setTimeout(() => {
      client3Connected = true;
    }, 80);

    const client3Poll = setInterval(() => {
      if (!domClient3Running || !client3Connected) return;
      try {
        const req = http.request({
          hostname: '127.0.0.1',
          port: port3,
          path: '/autoplan-status?windowKey=test-bg-win-3',
          method: 'GET'
        }, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.pendingCommands && parsed.pendingCommands.length > 0) {
                for (const cmd of parsed.pendingCommands) {
                  const ackReq = http.request({
                    hostname: '127.0.0.1',
                    port: port3,
                    path: '/autoplan-ack',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                  });
                  ackReq.write(JSON.stringify({
                    commandId: cmd.id,
                    status: 'submitClicked',
                    windowKey: 'test-bg-win-3'
                  }));
                  ackReq.end();
                }
              }
            } catch {}
          });
        });
        req.on('error', () => {});
        req.end();
      } catch {}
    }, 20);

    const dispatcher3 = new PromptDispatcher({
      bridgeServer: server3,
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        executionMode: 'domBridge',
        allowTierFallback: false,
        bridgeTimeoutMs: 3000
      })
    });

    // Ensure bridge readiness with wakeup will trigger fast probe and reconnect
    const readiness = await dispatcher3.ensureBridgeReadinessWithWakeup(300);
    assert.strictEqual(readiness.ready, true, 'ensureBridgeReadinessWithWakeup should succeed after fast probe reconnect');

    const dispatchRes = await dispatcher3.dispatchPrompt('Test recovery prompt');
    assert.strictEqual(dispatchRes.success, true, 'Dispatch should succeed after recovery');
    assert.strictEqual(dispatchRes.tier, 'domBridge');

    domClient3Running = false;
    clearInterval(client3Poll);
    await server3.stop();

    console.log('  -> Passed: Graceful recovery and fast probe reconnection verified.\n');

    console.log('=== All Phase 04 End-to-End Background Automation Tests Passed Successfully! ===');
    process.exit(0);
  } finally {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase04BackgroundAutomationE2ETests().catch((err) => {
  console.error('Phase 04 Test Failure:', err);
  process.exit(1);
});
