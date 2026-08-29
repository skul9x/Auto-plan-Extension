// Standalone mock for 'vscode' module when executed directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let registeredCommands: { [cmd: string]: (...args: any[]) => any } = {};
let createdStatusBarItems: any[] = [];
let shownInfoMessages: string[] = [];
let shownErrorMessages: string[] = [];
let shownWarningMessages: string[] = [];
let mockOpenDocUri: any = null;
let mockShowDocCalled = false;

const configStore: { [key: string]: any } = {
  defaultPromptTemplate: 'Implement the code closely following the file {xxx}',
  promptTemplate: 'Implement the code closely following the file {xxx}',
  promptText: 'Implement the code closely following the file {xxx}',
  repeatCount: 2,
  completionKeyword: 'Done skul9x.',
  delayBetweenLoopsMs: 50,
  timeoutPerLoopMinutes: 1,
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
          get: (key: string, defaultValue: any) =>
            configStore[key] !== undefined ? configStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            configStore[key] = val;
          }
        }),
        onDidChangeConfiguration: (_cb: any) => ({
          dispose: () => {}
        }),
        openTextDocument: async (uri: any) => {
          mockOpenDocUri = uri;
          return { uri };
        }
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
          if (rest.includes('Install Bridge')) return 'Install Bridge';
          if (rest.includes('Reload Window')) return 'Reload Window';
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
        showQuickPick: async (items: any[]) => {
          if (Array.isArray(items) && items.length > 0) {
            return items[0];
          }
          return undefined;
        },
        showOpenDialog: async (_opts: any) => undefined,
        showInputBox: async (_opts: any) => 'Custom Input',
        showTextDocument: async (_doc: any) => {
          mockShowDocCalled = true;
        },
        registerWebviewViewProvider: (_viewId: string, _provider: any) => ({
          dispose: () => {}
        })
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
      Uri: {
        file: (f: string) => ({ fsPath: f, scheme: 'file' })
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
import { execSync } from 'child_process';

import {
  installBridgeScript,
  uninstallBridgeScript,
  isBridgeInstalled,
  TAG_START,
  TAG_END,
  BACKUP_SUFFIX
} from '../workbenchInjector';
import { BridgeServer, PORT_REGISTRY_FILENAME } from '../bridgeServer';
import { PromptDispatcher } from '../promptDispatcher';
import { Orchestrator } from '../orchestrator';
import {
  activate,
  deactivate,
  getMainStatusBarItem,
  getBridgeStatusBarItem,
  updateBridgeStatusBar,
  runBridgeDiagnostic,
  showBridgeDiagnosticDialog
} from '../extension';

// Helper for making HTTP requests in tests
function httpRequest(
  method: string,
  urlStr: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let resBody = '';
      res.on('data', (chunk) => (resBody += chunk));
      res.on('end', () => {
        try {
          const parsedData = resBody ? JSON.parse(resBody) : {};
          resolve({ status: res.statusCode || 0, data: parsedData, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode || 0, data: resBody, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body !== undefined) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runPhase05FullRegressionTests() {
  console.log('=== Running Phase 05: Extension Commands, UI Diagnostics & Packaging Regression Tests ===\n');

  const testTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-phase05-reg-'));
  const mockWbDir = path.join(testTmpDir, 'workbench');
  fs.mkdirSync(mockWbDir, { recursive: true });

  const mockWbPath = path.join(mockWbDir, 'workbench.html');
  const initialHtml = `<!DOCTYPE html>
<html>
<head><title>VS Code Workbench</title></head>
<body>
  <div id="workbench">App Container</div>
</body>
</html>`;
  fs.writeFileSync(mockWbPath, initialHtml, 'utf8');

  // Create mock product.json
  const mockProductPath = path.join(testTmpDir, 'product.json');
  fs.writeFileSync(mockProductPath, JSON.stringify({ checksums: {} }, null, 2), 'utf8');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Workbench DOM Bridge Installation, Verification, & Sidecar Copy
    // -------------------------------------------------------------------------
    console.log('[Test 1] Verifying DOM Bridge Installation & Sidecar Placement...');
    const installRes = installBridgeScript({ workbenchPath: mockWbPath, updateChecksums: false });
    assert.strictEqual(installRes.success, true, 'installBridgeScript should succeed');
    assert.strictEqual(isBridgeInstalled(mockWbPath), true, 'Bridge should be reported as installed');

    const injectedHtml = fs.readFileSync(mockWbPath, 'utf8');
    assert.ok(injectedHtml.includes(TAG_START), 'Injected HTML should contain TAG_START');
    assert.ok(injectedHtml.includes(TAG_END), 'Injected HTML should contain TAG_END');
    assert.ok(injectedHtml.includes('autoplan-dom-bridge.js?v='), 'Injected HTML should contain bridge script tag');

    const backupPath = `${mockWbPath}${BACKUP_SUFFIX}`;
    assert.ok(fs.existsSync(backupPath), 'Backup file workbench.html.autoplan.bak must exist');

    const copiedBridgeScript = path.join(mockWbDir, 'autoplan-dom-bridge.js');
    assert.ok(fs.existsSync(copiedBridgeScript), 'DOM Bridge sidecar script should be copied into workbench directory');
    console.log('  -> Passed: DOM Bridge installed, verified, and sidecar script created.\n');

    // -------------------------------------------------------------------------
    // TEST 2: BridgeServer Startup, Port Registry & HTTP Handshake Protocol
    // -------------------------------------------------------------------------
    console.log('[Test 2] Verifying BridgeServer startup, port registry, and HTTP protocol...');
    const customRegistryPath = path.join(testTmpDir, PORT_REGISTRY_FILENAME);
    const bridgeServer = new BridgeServer({
      portStart: 49200,
      portEnd: 49250,
      workbenchDir: mockWbDir,
      portsRegistryPath: customRegistryPath,
      windowKey: 'test_phase05_win'
    });

    const activePort = await bridgeServer.start();
    assert.ok(activePort >= 49200 && activePort <= 49250, 'Server should bind to available port in range');
    assert.strictEqual(bridgeServer.isListening(), true, 'BridgeServer should report listening');

    // Verify port registry file
    assert.ok(fs.existsSync(customRegistryPath), 'Port registry file must exist');
    const registryData = BridgeServer.readPortRegistry(customRegistryPath);
    assert.ok(registryData !== null && registryData.ports[String(activePort)], 'Registry should record active port');
    assert.strictEqual(registryData.ports[String(activePort)].windowKey, 'test_phase05_win');

    // Verify /autoplan-heartbeat
    const heartbeatRes = await httpRequest('GET', `http://127.0.0.1:${activePort}/autoplan-heartbeat?windowKey=test_phase05_win`);
    assert.strictEqual(heartbeatRes.status, 200);
    assert.strictEqual(heartbeatRes.data.status, 'ok');
    assert.strictEqual(heartbeatRes.data.serverPort, activePort);

    // Verify /autoplan-status
    const statusRes = await httpRequest('GET', `http://127.0.0.1:${activePort}/autoplan-status?windowKey=test_phase05_win`);
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.data.service, 'autoplan-bridge-server');
    console.log('  -> Passed: BridgeServer listening, registered in port registry, and responsive to HTTP endpoints.\n');

    // -------------------------------------------------------------------------
    // TEST 3: Simulated DOM Client Handshake & Prompt Dispatch Loop
    // -------------------------------------------------------------------------
    console.log('[Test 3] Verifying DOM client command polling and prompt acknowledgment...');
    const testPromptText = 'Phase 05 DOM Bridge Automation Test Prompt';

    // Start prompt dispatch asynchronously
    const dispatchPromise = bridgeServer.dispatchPromptCommand(testPromptText, {
      windowKey: 'test_phase05_win',
      timeoutMs: 4000
    });

    // Simulate DOM Bridge client polling for commands
    const pollRes = await httpRequest('GET', `http://127.0.0.1:${activePort}/autoplan-status?windowKey=test_phase05_win`);
    assert.strictEqual(pollRes.status, 200);
    assert.ok(Array.isArray(pollRes.data.pendingCommands), 'pendingCommands should be an array');
    assert.strictEqual(pollRes.data.pendingCommands.length, 1, 'Should have 1 pending command for client');

    const receivedCmd = pollRes.data.pendingCommands[0];
    assert.strictEqual(receivedCmd.text, testPromptText);

    // Simulate DOM Bridge client executing action and posting acknowledgment
    const ackRes = await httpRequest('POST', `http://127.0.0.1:${activePort}/autoplan-ack`, {}, {
      commandId: receivedCmd.id,
      status: 'submitClicked',
      windowKey: 'test_phase05_win',
      metadata: { selector: '.input-box-test', action: 'submit' }
    });
    assert.strictEqual(ackRes.status, 200);
    assert.strictEqual(ackRes.data.success, true);

    const dispatchResult = await dispatchPromise;
    assert.strictEqual(dispatchResult.success, true);
    assert.strictEqual(dispatchResult.status, 'submitClicked');
    assert.ok(dispatchResult.durationMs >= 0);
    console.log('  -> Passed: DOM Client command polling, execution, and acknowledgment resolved successfully.\n');

    await bridgeServer.stop();
    assert.strictEqual(bridgeServer.isListening(), false);

    // -------------------------------------------------------------------------
    // TEST 4: Unified Prompt Dispatcher Fallbacks & Reactivity
    // -------------------------------------------------------------------------
    console.log('[Test 4] Verifying Unified Prompt Dispatcher modes and reactivity...');
    let currentTestConfig = { ...configStore, executionMode: 'keyboard' };
    const dispatcher = new PromptDispatcher({
      configProvider: () => currentTestConfig as any,
      bridgeServer
    });

    assert.ok(dispatcher.getBridgeServer(), 'PromptDispatcher has BridgeServer');
    assert.ok(dispatcher.getKeyboardManager(), 'PromptDispatcher has KeyboardManager');

    // Test mode reactivity
    currentTestConfig.executionMode = 'domBridge';
    assert.strictEqual(dispatcher.getBridgeServer() !== undefined, true);

    console.log('  -> Passed: Dispatcher configuration and transport reactivity verified.\n');

    // -------------------------------------------------------------------------
    // TEST 5: Orchestrator Multi-Phase Execution Flow with File Completion
    // -------------------------------------------------------------------------
    console.log('[Test 5] Verifying Orchestrator multi-phase execution loop...');
    const plansDir = path.join(testTmpDir, 'plans');
    fs.mkdirSync(plansDir, { recursive: true });

    const phase1Path = path.join(plansDir, 'phase-01-core.md');
    const phase2Path = path.join(plansDir, 'phase-02-verify.md');

    fs.writeFileSync(phase1Path, '# Phase 1\nStatus: ⬜ Pending\n\nObjective: Setup\n', 'utf8');
    fs.writeFileSync(phase2Path, '# Phase 2\nStatus: ⬜ Pending\n\nObjective: Verify\n', 'utf8');

    const brainDir = path.join(testTmpDir, '.brain');
    const convId = 'test-phase05-conv-e2e';
    const convDir = path.join(brainDir, convId, '.system_generated', 'logs');
    fs.mkdirSync(convDir, { recursive: true });
    const transcriptPath = path.join(convDir, 'transcript.jsonl');

    // Write initial transcript with prompt
    fs.writeFileSync(transcriptPath, JSON.stringify({
      type: 'USER_INPUT',
      content: 'Implement the code closely following the file phase-01-core.md'
    }) + '\n', 'utf8');

    let watcherStep = 0;
    const mockWatcher: any = {
      getOptions: () => ({ brainDir, pollIntervalMs: 5 }),
      waitForNewConversation: async () => `conv-${++watcherStep}`,
      watchFile: async (_p: string, cid: string) => ({
        success: true,
        conversationId: cid,
        completionTimeMs: 20
      }),
      watchLatest: async () => ({
        success: true,
        conversationId: `conv-${watcherStep}`,
        completionTimeMs: 20
      }),
      stop: () => {},
      readConversationMessages: async () => []
    };

    const mockKeyboard: any = {
      executeBatchPromptFlow: async () => {},
      executePromptFlow: async () => {},
      checkLinuxKeyboardPrerequisites: () => ({ available: true, binary: '/usr/bin/xdotool' })
    };

    const orchestratorInstance = new Orchestrator({
      transcriptWatcher: mockWatcher,
      keyboardManager: mockKeyboard,
      configProvider: () => ({
        ...configStore,
        delayBetweenLoopsMs: 20,
        timeoutPerLoopMinutes: 1,
        completionKeyword: 'Done skul9x.'
      }) as any
    });

    let completedEvents = 0;
    orchestratorInstance.on('phaseComplete', () => {
      completedEvents++;
    });

    const phases = [
      {
        path: phase1Path,
        fileName: 'phase-01-core.md',
        filePath: phase1Path,
        nativePath: phase1Path,
        normalizedPath: phase1Path.replace(/\\/g, '/'),
        relativePath: 'phase-01-core.md',
        index: 1,
        status: 'Pending' as const,
        isCompleted: false,
        conversationId: convId
      },
      {
        path: phase2Path,
        fileName: 'phase-02-verify.md',
        filePath: phase2Path,
        nativePath: phase2Path,
        normalizedPath: phase2Path.replace(/\\/g, '/'),
        relativePath: 'phase-02-verify.md',
        index: 2,
        status: 'Pending' as const,
        isCompleted: false,
        conversationId: convId
      }
    ];

    const execPromise = orchestratorInstance.startPhases(phases);

    await execPromise;
    assert.strictEqual(orchestratorInstance.isRunning(), false, 'Orchestrator should finish running');
    assert.strictEqual(completedEvents, 2, 'Should have received 2 phaseComplete events');
    const orchestratorPhases = orchestratorInstance.getPhases();
    assert.strictEqual(orchestratorPhases[0].status, 'Completed', 'Phase 1 should be marked completed');
    assert.strictEqual(orchestratorPhases[1].status, 'Completed', 'Phase 2 should be marked completed');
    console.log('  -> Passed: Orchestrator multi-phase execution and transcript tracking verified.\n');

    // -------------------------------------------------------------------------
    // TEST 6: Extension Activation, Status Bar & Diagnostics Commands
    // -------------------------------------------------------------------------
    console.log('[Test 6] Verifying Extension Activation, UI Status Bar & Diagnostics...');
    activate(mockContext);

    const mainStatusBar = getMainStatusBarItem();
    const bridgeStatusBar = getBridgeStatusBarItem();

    assert.ok(mainStatusBar, 'Main status bar item must exist');
    assert.ok(bridgeStatusBar, 'Bridge status bar item must exist');

    updateBridgeStatusBar();
    assert.ok(bridgeStatusBar.text.length > 0, 'Bridge status bar item should have text');

    // Test runBridgeDiagnostic
    const diagReport = runBridgeDiagnostic();
    assert.strictEqual(typeof diagReport.isInstalled, 'boolean');
    assert.strictEqual(typeof diagReport.serverListening, 'boolean');
    assert.strictEqual(typeof diagReport.connectedClientsCount, 'number');
    assert.strictEqual(typeof diagReport.executionMode, 'string');

    // Test showBridgeDiagnosticDialog
    const dialogReport = await showBridgeDiagnosticDialog();
    assert.ok(dialogReport, 'showBridgeDiagnosticDialog should return diagnostic report');

    // Test registered commands
    assert.ok(registeredCommands['autoplan.start'], 'autoplan.start must be registered');
    assert.ok(registeredCommands['autoplan.stop'], 'autoplan.stop must be registered');
    assert.ok(registeredCommands['autoplan.skipPhase'], 'autoplan.skipPhase must be registered');
    assert.ok(registeredCommands['autoplan.installBridge'], 'autoplan.installBridge must be registered');
    assert.ok(registeredCommands['autoplan.uninstallBridge'], 'autoplan.uninstallBridge must be registered');
    assert.ok(registeredCommands['autoplan.checkBridgeStatus'], 'autoplan.checkBridgeStatus must be registered');

    console.log('  -> Passed: Status Bar items, diagnostic reports, and extension commands verified.\n');

    // -------------------------------------------------------------------------
    // TEST 7: DOM Bridge Uninstallation and Clean Restoration
    // -------------------------------------------------------------------------
    console.log('[Test 7] Verifying DOM Bridge Uninstallation and clean restoration...');
    const uninstallRes = uninstallBridgeScript({ workbenchPath: mockWbPath, updateChecksums: false });
    assert.strictEqual(uninstallRes.success, true, 'uninstallBridgeScript should succeed');
    assert.strictEqual(isBridgeInstalled(mockWbPath), false, 'isBridgeInstalled should report false after uninstall');

    const restoredHtml = fs.readFileSync(mockWbPath, 'utf8');
    assert.ok(!restoredHtml.includes(TAG_START), 'Restored HTML must not contain TAG_START');
    assert.ok(!restoredHtml.includes(TAG_END), 'Restored HTML must not contain TAG_END');
    assert.ok(!fs.existsSync(copiedBridgeScript), 'Sidecar script must be removed on uninstallation');
    console.log('  -> Passed: DOM Bridge cleanly uninstalled and workbench restored.\n');

    // -------------------------------------------------------------------------
    // TEST 8: Extension Packaging & Clean Build Verification
    // -------------------------------------------------------------------------
    console.log('[Test 8] Verifying packaging prerequisites & package.json schema integrity...');
    const pkgJsonPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

    assert.ok(pkg.name === 'antigravity-auto-plan', 'Package name must be antigravity-auto-plan');
    assert.ok(pkg.main === './out/extension.js', 'Main entry must point to ./out/extension.js');
    assert.ok(Array.isArray(pkg.activationEvents), 'activationEvents must be an array');
    assert.ok(pkg.activationEvents.includes('onCommand:autoplan.installBridge'), 'activationEvents must include installBridge');
    assert.ok(pkg.activationEvents.includes('onCommand:autoplan.uninstallBridge'), 'activationEvents must include uninstallBridge');
    assert.ok(pkg.activationEvents.includes('onCommand:autoplan.checkBridgeStatus'), 'activationEvents must include checkBridgeStatus');

    const commands = pkg.contributes?.commands || [];
    const commandNames = commands.map((c: any) => c.command);
    assert.ok(commandNames.includes('autoplan.installBridge'), 'Commands must include autoplan.installBridge');
    assert.ok(commandNames.includes('autoplan.uninstallBridge'), 'Commands must include autoplan.uninstallBridge');
    assert.ok(commandNames.includes('autoplan.checkBridgeStatus'), 'Commands must include autoplan.checkBridgeStatus');

    const props = pkg.contributes?.configuration?.properties || {};
    assert.ok(props['autoplan.executionMode'], 'Configuration must include autoplan.executionMode');
    assert.ok(props['autoplan.autoInjectWorkbench'], 'Configuration must include autoplan.autoInjectWorkbench');
    assert.ok(props['autoplan.autoApprovePermissions'], 'Configuration must include autoplan.autoApprovePermissions');
    assert.ok(props['autoplan.bridgeTimeoutMs'], 'Configuration must include autoplan.bridgeTimeoutMs');

    await deactivate();
    console.log('  -> Passed: Extension packaging metadata and configuration schema verified.\n');

  } finally {
    // Cleanup temporary test directory
    try {
      fs.rmSync(testTmpDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('========================================================================');
  console.log('✅ ALL PHASE 05 FULL E2E REGRESSION AND PACKAGING TESTS PASSED!');
  console.log('========================================================================\n');
}

runPhase05FullRegressionTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('❌ Phase 05 Full Regression Test Failure:', err);
  process.exit(1);
});
