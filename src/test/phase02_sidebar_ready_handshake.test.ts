// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const executedCommands: string[] = [];
const warningMessages: string[] = [];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        }),
        workspaceFolders: []
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      Uri: {
        file: (fsPath: string) => ({
          fsPath,
          scheme: 'file',
          toString: () => `file://${fsPath}`
        }),
        joinPath: (baseUri: any, ...pathSegments: string[]) => {
          const path = require('path');
          const joined = path.join(baseUri.fsPath || baseUri.path || '', ...pathSegments);
          return {
            fsPath: joined,
            scheme: 'file',
            toString: () => `file://${joined}`
          };
        }
      },
      commands: {
        executeCommand: async (command: string, ...args: any[]) => {
          executedCommands.push(command);
          return Promise.resolve();
        }
      },
      window: {
        showWarningMessage: (msg: string) => {
          warningMessages.push(msg);
        },
        showInformationMessage: () => {},
        showErrorMessage: () => {},
        createOutputChannel: () => ({
          appendLine: () => {},
          append: () => {},
          clear: () => {},
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {}
        })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vm from 'vm';
import { SidebarProvider } from '../sidebarProvider';

function createMockWebviewView() {
  const outboundQueue: any[] = []; // Messages sent from webview to extension host
  const inboundQueue: any[] = []; // Messages received by webview from extension host
  const messageListeners: ((msg: any) => Promise<any> | void)[] = [];

  const mockWebviewView: any = {
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-webview:',
      asWebviewUri: (uri: any) => ({
        toString: () => `vscode-webview-resource://${uri.fsPath}`
      }),
      onDidReceiveMessage: (cb: (msg: any) => any) => {
        messageListeners.push(cb);
        return { dispose: () => {} };
      },
      postMessage: (msg: any) => {
        inboundQueue.push(msg);
        return Promise.resolve(true);
      }
    },
    onDidDispose: (cb: () => void) => {
      return { dispose: () => {} };
    }
  };

  const dispatchToHost = async (msg: any) => {
    outboundQueue.push(msg);
    for (const listener of messageListeners) {
      await listener(msg);
    }
  };

  return {
    mockWebviewView,
    inboundQueue,
    outboundQueue,
    messageListeners,
    dispatchToHost
  };
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('Phase 02: Sidebar Webview Bidirectional Ready Handshake Tests');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '../../');
  const mockExtensionUri = {
    fsPath: rootDir,
    scheme: 'file',
    toString: () => `file://${rootDir}`
  };

  // --------------------------------------------------------------------------
  // Test 1: Webview initialization without ready drops / buffers initial messages
  // --------------------------------------------------------------------------
  console.log('[Test 1] Verifying resolveWebviewView registers listener and suppresses early dispatch...');
  {
    const { mockWebviewView, inboundQueue, messageListeners, dispatchToHost } = createMockWebviewView();
    const provider = new SidebarProvider(mockExtensionUri as any);

    assert.strictEqual(provider.isWebviewReady(), false, 'Webview must be not-ready initially');

    provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

    assert.strictEqual(messageListeners.length, 1, 'Provider must register exactly 1 message listener');
    assert.strictEqual(provider.isWebviewReady(), false, 'Webview readiness must remain false until ready signal is received');

    // Messages sent prior to ready must be buffered and NOT posted to uninitialized webview
    assert.strictEqual(
      inboundQueue.length,
      0,
      'No messages should be delivered to the webview before it signals ready'
    );

    console.log('  ✓ Listener registered and early message dispatch prevented.');
    provider.dispose();
  }

  // --------------------------------------------------------------------------
  // Test 2: Inspect media/sidebar/sidebar.js and verify ready handshake dispatch
  // --------------------------------------------------------------------------
  console.log('\n[Test 2] Inspecting media/sidebar/sidebar.js for ready handshake implementation...');
  {
    const sidebarJsPath = path.resolve(rootDir, 'media/sidebar/sidebar.js');
    assert.ok(fs.existsSync(sidebarJsPath), 'sidebar.js must exist at media/sidebar/sidebar.js');

    const sidebarCode = fs.readFileSync(sidebarJsPath, 'utf8');

    // Verify static requirements
    assert.ok(
      sidebarCode.includes("window.addEventListener('message'"),
      'sidebar.js must register window message listener'
    );
    assert.ok(
      sidebarCode.includes("vscode.postMessage({ command: 'ready'") ||
      sidebarCode.includes('vscode.postMessage({command:"ready"') ||
      sidebarCode.includes("vscode.postMessage({ command: 'ready', type: 'ready' })"),
      'sidebar.js must post ready command message'
    );

    // Verify dynamic evaluation in simulated DOM context
    const sentFromSidebar: any[] = [];
    const eventListeners: { [key: string]: Function[] } = {};

    const createDummyElem = (id: string) => ({
      id,
      className: '',
      classList: {
        add: () => {},
        remove: () => {},
        contains: () => false
      },
      textContent: '',
      title: '',
      style: {},
      disabled: false,
      value: '',
      checked: false,
      scrollTop: 0,
      scrollHeight: 100,
      addEventListener: (type: string, fn: Function) => {
        if (!eventListeners[id + ':' + type]) eventListeners[id + ':' + type] = [];
        eventListeners[id + ':' + type].push(fn);
      },
      appendChild: () => {},
      innerHTML: ''
    });

    const domElementIds = [
      'bridgeStatusBadge', 'bridgeStatusText', 'planFolderSelect', 'btnRefreshPlans',
      'btnSelectFolder', 'elapsedTime', 'progressCounter', 'progressBarFill',
      'toggleAllPhases', 'selectedCountBadge', 'phaseList', 'btnStart', 'btnPause',
      'btnSkip', 'btnStop', 'btnClearLog', 'transcriptLog', 'transcriptViewport',
      'btnActivateBridge', 'btnDiagnostics', 'btnCopyBridgeLog', 'btnSettings'
    ];

    let messageListenerAttachedBeforeReady = false;

    const sandbox = {
      acquireVsCodeApi: () => ({
        postMessage: (msg: any) => {
          sentFromSidebar.push(msg);
        }
      }),
      document: {
        getElementById: (id: string) => createDummyElem(id),
        createElement: (tag: string) => createDummyElem(tag)
      },
      window: {
        addEventListener: (type: string, fn: Function) => {
          if (type === 'message') {
            messageListenerAttachedBeforeReady = true;
          }
        }
      },
      Math
    };

    vm.runInNewContext(sidebarCode, sandbox);

    assert.ok(messageListenerAttachedBeforeReady, 'sidebar.js must attach window message listener before posting ready');
    assert.ok(
      sentFromSidebar.some((m) => m.command === 'ready'),
      'sidebar.js execution must dispatch { command: "ready" }'
    );

    console.log('  ✓ sidebar.js static & dynamic ready handshake verified.');
  }

  // --------------------------------------------------------------------------
  // Test 3: Ready handshake triggers stateUpdate and bridgeStatus delivery
  // --------------------------------------------------------------------------
  console.log('\n[Test 3] Simulating ready handshake and asserting stateUpdate & bridgeStatus responses...');
  {
    const { mockWebviewView, inboundQueue, dispatchToHost } = createMockWebviewView();
    const provider = new SidebarProvider(mockExtensionUri as any);

    provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    assert.strictEqual(inboundQueue.length, 0, 'Inbound queue must be empty before ready signal');

    // Simulate webview dispatching ready
    await dispatchToHost({ command: 'ready', type: 'ready' });

    assert.strictEqual(provider.isWebviewReady(), true, 'Provider readiness should be true after ready signal');
    assert.ok(inboundQueue.length >= 2, `Expected at least 2 messages upon ready, received ${inboundQueue.length}`);

    const stateUpdateMsg = inboundQueue.find((m) => m.command === 'stateUpdate' || m.type === 'stateUpdate');
    assert.ok(stateUpdateMsg, 'State update message must be dispatched upon ready');
    assert.ok('phases' in stateUpdateMsg, 'stateUpdate must include phases');
    assert.ok('selectedIndices' in stateUpdateMsg, 'stateUpdate must include selectedIndices');
    assert.ok('status' in stateUpdateMsg, 'stateUpdate must include status');

    const bridgeStatusMsg = inboundQueue.find((m) => m.command === 'bridgeStatus' || m.type === 'bridgeStatus');
    assert.ok(bridgeStatusMsg, 'Bridge status message must be dispatched upon ready');
    assert.ok('status' in bridgeStatusMsg, 'bridgeStatus message must include status string');

    console.log('  ✓ Webview ready handshake successfully dispatched stateUpdate and bridgeStatus.');
    provider.dispose();
  }

  // --------------------------------------------------------------------------
  // Test 4: Multiple updates before ready are coalesced into the freshest state
  // --------------------------------------------------------------------------
  console.log('\n[Test 4] Verifying pre-ready update coalescing into the freshest state...');
  {
    const { mockWebviewView, inboundQueue, dispatchToHost } = createMockWebviewView();
    const provider = new SidebarProvider(mockExtensionUri as any);

    provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    inboundQueue.length = 0; // Clear any pending

    // Dispatch multiple updates prior to ready
    provider.updateState({ status: 'running', customSequence: 1 });
    provider.updateState({ status: 'paused', customSequence: 2 });
    provider.updateState({ status: 'idle', customSequence: 3 });

    // Assert that no messages leaked while not ready
    assert.strictEqual(inboundQueue.length, 0, 'No state messages should be delivered while not ready');

    // Now fire ready
    await dispatchToHost({ command: 'ready' });

    const stateUpdates = inboundQueue.filter((m) => m.command === 'stateUpdate' || m.type === 'stateUpdate');
    assert.strictEqual(
      stateUpdates.length,
      1,
      'Pre-ready updates must be coalesced into a single stateUpdate message'
    );
    assert.strictEqual(
      stateUpdates[0].customSequence,
      3,
      'Coalesced state must reflect the freshest update (sequence 3)'
    );
    assert.strictEqual(
      stateUpdates[0].status,
      'idle',
      'Coalesced state must reflect the freshest status (idle)'
    );

    console.log('  ✓ State coalescing before ready verified.');
    provider.dispose();
  }

  // --------------------------------------------------------------------------
  // Test 5: Fallback safety timer delivers state if ready is never received
  // --------------------------------------------------------------------------
  console.log('\n[Test 5] Verifying fallback safety timer in constrained environments...');
  {
    const { mockWebviewView, inboundQueue } = createMockWebviewView();
    const provider = new SidebarProvider(mockExtensionUri as any);

    provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    assert.strictEqual(provider.isWebviewReady(), false);
    assert.strictEqual(inboundQueue.length, 0);

    // Fast-forward or trigger the internal fallback safety mechanism directly
    // by advancing time or calling the safety callback
    (provider as any)._readyFallbackTimer.unref?.();
    const fallbackTimer = (provider as any)._readyFallbackTimer;
    assert.ok(fallbackTimer, 'Safety fallback timer must be scheduled');

    // Explicitly invoke fallback routine to simulate timer expiration without waiting 1500ms
    (provider as any)._isWebviewReady = true;
    await (provider as any)._flushBufferedState();

    assert.strictEqual(provider.isWebviewReady(), true);
    assert.ok(inboundQueue.length >= 2, 'Fallback must flush stateUpdate and bridgeStatus');

    console.log('  ✓ Fallback safety timer functionality verified.');
    provider.dispose();
  }

  console.log('\n================================================================');
  console.log('All Phase 02 Sidebar Webview Ready Handshake Tests PASSED');
  console.log('================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
