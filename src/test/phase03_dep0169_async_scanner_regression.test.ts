// Standalone test runner with comprehensive mock for 'vscode' module
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let shownInfoMessages: string[] = [];
let shownErrorMessages: string[] = [];
let shownWarningMessages: string[] = [];

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
        onDidChangeConfiguration: () => ({ dispose: () => {} })
      },
      window: {
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        showInformationMessage: async (msg: string, ...items: string[]) => {
          shownInfoMessages.push(msg);
          return items[0];
        },
        showWarningMessage: async (msg: string, ...items: string[]) => {
          shownWarningMessages.push(msg);
          return items[0];
        },
        showErrorMessage: async (msg: string, ...items: string[]) => {
          shownErrorMessages.push(msg);
          return items[0];
        },
        createOutputChannel: () => ({
          appendLine: () => {},
          append: () => {},
          clear: () => {},
          show: () => {},
          dispose: () => {}
        }),
        activeTextEditor: undefined
      },
      commands: {
        registerCommand: (command: string, callback: (...args: any[]) => any) => {
          registeredCommands[command] = callback;
          return { dispose: () => delete registeredCommands[command] };
        },
        executeCommand: async (cmd: string, ...args: any[]) => {
          if (registeredCommands[cmd]) {
            return registeredCommands[cmd](...args);
          }
          return undefined;
        }
      },
      env: {
        appRoot: undefined
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
import { BridgeServer } from '../bridgeServer';
import { Orchestrator } from '../orchestrator';
import { PromptDispatcher } from '../promptDispatcher';
import { TranscriptWatcher, CompletionResult } from '../transcriptWatcher';
import { scanPlanFolderAsync, scanPlanFolder, renderPromptTemplate } from '../planScanner';
import { AutoPlanConfig } from '../config';

// ---------------------------------------------------------------------------
// Global Warning Listener Trap to Detect Node.js [DEP0169] Deprecation
// ---------------------------------------------------------------------------
const capturedWarnings: Error[] = [];
const dep0169Warnings: Error[] = [];

process.on('warning', (warning) => {
  capturedWarnings.push(warning);
  if (
    warning.name === 'DeprecationWarning' &&
    ((warning as any).code === 'DEP0169' ||
      warning.message.includes('url.parse') ||
      warning.message.includes('DEP0169'))
  ) {
    dep0169Warnings.push(warning);
    console.error('🚨 [CAUGHT DEP0169 WARNING]:', warning);
  }
});

function httpRequest(
  options: http.RequestOptions,
  postData?: string | object
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any; rawBody: string }> {
  return new Promise((resolve, reject) => {
    const dataString = typeof postData === 'object' ? JSON.stringify(postData) : postData;
    const req = http.request(options, (res) => {
      let rawBody = '';
      res.on('data', (chunk) => {
        rawBody += chunk;
      });
      res.on('end', () => {
        let body = rawBody;
        try {
          body = JSON.parse(rawBody);
        } catch {
          // raw
        }
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body,
          rawBody
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (dataString) {
      req.write(dataString);
    }
    req.end();
  });
}

async function runPhase03RegressionTests() {
  console.log('======================================================================');
  console.log('🚀 Running Phase 03: End-to-End Regression & Zero-Deprecation Tests');
  console.log('======================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-dep0169-regression-'));

  try {
    // -----------------------------------------------------------------------
    // 1. WHATWG URL HTTP Bridge Routing & Query Parameter Verification
    // -----------------------------------------------------------------------
    console.log('--- 1. Testing BridgeServer WHATWG URL HTTP Routes & Query Handling ---');
    const bridge = new BridgeServer({
      portStart: 49200,
      portEnd: 49250,
      defaultTimeoutMs: 3000
    });

    const port = await bridge.start();
    assert.ok(port >= 49200 && port <= 49250, `Port ${port} should be in test range`);
    console.log(`✔ BridgeServer started on port ${port} with zero deprecation warnings`);

    // Status query with probe=1 and windowKey
    const testWindowKey = 'win_test_dep0169_' + Date.now();
    const probeRes = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `/autoplan-status?probe=1&windowKey=${encodeURIComponent(testWindowKey)}&clientVersion=2.0.0`,
      method: 'GET'
    });
    assert.strictEqual(probeRes.statusCode, 200, 'Probe query should return 200');
    assert.strictEqual(probeRes.body.service, 'autoplan-bridge-server');

    // Heartbeat endpoint
    const hbRes = await httpRequest({
      hostname: '127.0.0.1',
      port,
      path: `/autoplan-heartbeat?windowKey=${encodeURIComponent(testWindowKey)}`,
      method: 'GET'
    });
    assert.strictEqual(hbRes.statusCode, 200, 'Heartbeat should return 200');
    assert.strictEqual(hbRes.body.status, 'ok');

    // Log ingestion
    const logRes = await httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/autoplan-log',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      {
        windowKey: testWindowKey,
        logs: [{ level: 'INFO', message: 'Test zero deprecation log ingestion', timestamp: Date.now() }]
      }
    );
    assert.strictEqual(logRes.statusCode, 200, 'Log ingestion should return 200');
    assert.strictEqual(logRes.body.success, true);
    console.log('✔ BridgeServer status, heartbeat, and log routes verified without [DEP0169]');

    // -----------------------------------------------------------------------
    // 2. Asynchronous Plan Scanning & Orchestrator Execution Pipeline
    // -----------------------------------------------------------------------
    console.log('\n--- 2. Testing Asynchronous Plan Discovery & Orchestrator Flow ---');
    const planFolder = path.join(testTempDir, 'test-plan');
    fs.mkdirSync(planFolder, { recursive: true });

    fs.writeFileSync(
      path.join(planFolder, 'phase-01-dep-check.md'),
      '# Phase 01: Deprecation check\nTask description'
    );
    fs.writeFileSync(
      path.join(planFolder, 'phase-02-async-scan.md'),
      '# Phase 02: Async scanner\nTask description'
    );

    // Verify async scanning
    const scannedPhases = await scanPlanFolderAsync(planFolder);
    assert.strictEqual(scannedPhases.length, 2, 'Should asynchronously discover 2 phases');
    assert.strictEqual(scannedPhases[0].fileName, 'phase-01-dep-check.md');
    assert.strictEqual(scannedPhases[1].fileName, 'phase-02-async-scan.md');
    console.log('✔ scanPlanFolderAsync executed cleanly on disk folder');

    // Synthetic Orchestrator with TranscriptWatcher Mock
    const mockBrainDir = path.join(testTempDir, 'brain');
    fs.mkdirSync(mockBrainDir, { recursive: true });

    class MockTranscriptWatcher extends TranscriptWatcher {
      async waitForNewConversation(): Promise<string> {
        return 'conv_dep0169_test_101';
      }
      async watchFile(): Promise<CompletionResult> {
        return {
          success: true,
          matchedContent: 'Done skul9x.',
          conversationId: 'conv_dep0169_test_101'
        };
      }
      async watchLatest(): Promise<CompletionResult> {
        return {
          success: true,
          matchedContent: 'Done skul9x.',
          conversationId: 'conv_dep0169_test_101'
        };
      }
    }

    const mockWatcher = new MockTranscriptWatcher({ brainDir: mockBrainDir });

    const dispatcher = new PromptDispatcher({
      bridgeServer: bridge
    });

    const testConfig: AutoPlanConfig = {
      promptText: 'Done skul9x.',
      repeatCount: 1,
      timeoutPerLoopMinutes: 1,
      executionMode: 'domBridge',
      allowTierFallback: false,
      completionKeyword: 'Done skul9x.',
      delayBetweenLoopsMs: 10,
      bridgeTimeoutMs: 3000
    };

    const orchestrator = new Orchestrator({
      configProvider: () => testConfig,
      promptDispatcher: dispatcher,
      transcriptWatcher: mockWatcher
    });

    // Start background simulated DOM Bridge Client to ACK prompts
    let activeClientRunning = true;
    const clientPollLoop = async () => {
      while (activeClientRunning) {
        try {
          const status = await httpRequest({
            hostname: '127.0.0.1',
            port,
            path: `/autoplan-status?windowKey=${encodeURIComponent(testWindowKey)}`,
            method: 'GET'
          });

          if (status.body && Array.isArray(status.body.pendingCommands)) {
            for (const cmd of status.body.pendingCommands) {
              await httpRequest(
                {
                  hostname: '127.0.0.1',
                  port,
                  path: '/autoplan-ack',
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' }
                },
                {
                  commandId: cmd.id,
                  status: 'submitClicked',
                  windowKey: testWindowKey,
                  metadata: {
                    submitStrategy: 'buttonClick',
                    sendButtonClicked: true,
                    enterDispatched: false,
                    charsInjected: (cmd.text || '').length
                  }
                }
              );
            }
          }
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    const clientPromise = clientPollLoop();

    const runSuccess = await orchestrator.startPlanFolder(planFolder);
    assert.strictEqual(runSuccess, true, 'Orchestrator plan execution should succeed');
    assert.strictEqual(orchestrator.getPhases().length, 2, 'Orchestrator should have 2 phases');
    assert.strictEqual(orchestrator.getPhases()[0].status, 'Completed');
    assert.strictEqual(orchestrator.getPhases()[1].status, 'Completed');
    console.log('✔ Orchestrator completed 2-phase workflow with DOM Bridge ACK and zero warnings');

    activeClientRunning = false;
    await clientPromise;

    // -----------------------------------------------------------------------
    // 3. Clean Teardown & Verification of Zero [DEP0169] Warnings
    // -----------------------------------------------------------------------
    console.log('\n--- 3. Verifying Zero [DEP0169] Deprecation Warnings ---');
    await bridge.stop();
    assert.strictEqual(bridge.isListening(), false, 'BridgeServer should be stopped');

    assert.strictEqual(
      dep0169Warnings.length,
      0,
      `Expected 0 [DEP0169] warnings, but found ${dep0169Warnings.length}: ${JSON.stringify(
        dep0169Warnings.map((w) => w.message)
      )}`
    );
    console.log('✔ Zero [DEP0169] (url.parse) deprecation warnings captured across entire run.');

    console.log('\n======================================================================');
    console.log('🎉 ALL PHASE 03 REGRESSION & ZERO-DEPRECATION TESTS PASSED!');
    console.log('======================================================================');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runPhase03RegressionTests().catch((err) => {
  console.error('\n❌ Phase 03 Regression Test Failed:', err);
  process.exit(1);
});
