// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

const executedCommands: string[] = [];
let warningMessages: string[] = [];

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
        showErrorMessage: () => {}
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SidebarProvider, getNonce } from '../sidebarProvider';

async function runSidebarWebviewProviderTestSuite() {
  console.log('=== Running Phase 03: Sidebar Control Center Webview Provider Tests ===\n');

  const rootDir = path.resolve(__dirname, '../../');
  const mockExtensionUri = {
    fsPath: rootDir,
    scheme: 'file',
    toString: () => `file://${rootDir}`
  };

  try {
    // --------------------------------------------------------------------------
    // Test 1: HTML Generation & Content Security Policy (CSP)
    // --------------------------------------------------------------------------
    console.log('[Test 1] Verifying HTML generation & Content Security Policy (CSP)...');
    {
      const provider = new SidebarProvider(mockExtensionUri as any);

      const mockWebview: any = {
        cspSource: 'vscode-webview:',
        asWebviewUri: (uri: any) => ({
          toString: () => `vscode-webview-resource://${uri.fsPath}`
        })
      };

      const html = provider._getHtmlForWebview(mockWebview);

      assert.ok(html.includes('<meta http-equiv="Content-Security-Policy"'), 'HTML must contain CSP meta tag');
      assert.ok(html.includes("default-src 'none'"), 'CSP must enforce default-src none');
      assert.ok(html.includes("style-src vscode-webview: 'unsafe-inline'"), 'CSP must specify valid style-src');
      assert.ok(html.includes("script-src 'nonce-"), 'CSP must require script nonces');
      assert.ok(html.includes('vscode-webview-resource://'), 'Webview URIs must be replaced correctly');

      const nonce = getNonce();
      assert.strictEqual(typeof nonce, 'string', 'Nonce should be a string');
      assert.ok(nonce.length >= 16, 'Nonce should be at least 16 chars');

      console.log('  ✓ HTML generation & CSP policy verified.');
    }

    // --------------------------------------------------------------------------
    // Test 2: Inbound Message Router
    // --------------------------------------------------------------------------
    console.log('\n[Test 2] Verifying Inbound Message Router...');
    {
      const provider = new SidebarProvider(mockExtensionUri as any);
      executedCommands.length = 0;

      // Skip command dispatch
      await provider.handleWebviewMessage({ command: 'skip' });
      assert.ok(executedCommands.includes('autoplan.skipPhase'), 'Should execute autoplan.skipPhase command');

      // Stop command dispatch
      await provider.handleWebviewMessage({ command: 'stop' });
      assert.ok(executedCommands.includes('autoplan.stop'), 'Should execute autoplan.stop command');

      // Activate DOM Bridge dispatch
      await provider.handleWebviewMessage({ command: 'activateBridge' });
      assert.ok(executedCommands.includes('autoplan.installBridge'), 'Should execute autoplan.installBridge command');

      // Settings dispatch
      await provider.handleWebviewMessage({ command: 'settings' });
      assert.ok(executedCommands.includes('workbench.action.openSettings'), 'Should execute openSettings command');

      console.log('  ✓ Inbound message routing verified.');
    }

    // --------------------------------------------------------------------------
    // Test 3: Outbound State Broadcast
    // --------------------------------------------------------------------------
    console.log('\n[Test 3] Verifying Outbound State Broadcast...');
    {
      const provider = new SidebarProvider(mockExtensionUri as any);
      const postedMessages: any[] = [];

      const mockWebviewView: any = {
        webview: {
          options: {},
          html: '',
          cspSource: 'vscode-webview:',
          asWebviewUri: (uri: any) => ({
            toString: () => `vscode-webview-resource://${uri.fsPath}`
          }),
          onDidReceiveMessage: () => {},
          postMessage: (msg: any) => {
            postedMessages.push(msg);
            return Promise.resolve(true);
          }
        }
      };

      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      // Broadcast updateState
      provider.updateState({ status: 'running', activePlanPath: '/test/plan' });
      const stateMsgs = postedMessages.filter((m) => m.type === 'stateUpdate');
      const lastStateMsg = stateMsgs[stateMsgs.length - 1];
      assert.ok(lastStateMsg, 'State update message should be posted');
      assert.strictEqual(lastStateMsg.status, 'running');
      assert.strictEqual(lastStateMsg.activePlanPath, '/test/plan');

      // Broadcast sendBridgeStatus
      provider.sendBridgeStatus('connected');
      const bridgeMsgs = postedMessages.filter((m) => m.type === 'bridgeStatus');
      const bridgeMsg = bridgeMsgs[bridgeMsgs.length - 1];
      assert.ok(bridgeMsg, 'Bridge status message should be posted');
      assert.strictEqual(bridgeMsg.status, 'connected');

      // Broadcast appendTranscriptLog
      provider.appendTranscriptLog('AI Agent response line 1');
      const logMsgs = postedMessages.filter((m) => m.type === 'transcriptLog');
      const logMsg = logMsgs[logMsgs.length - 1];
      assert.ok(logMsg, 'Transcript log message should be posted');
      assert.strictEqual(logMsg.log, 'AI Agent response line 1');

      // Broadcast sendProgress
      provider.sendProgress({ percentage: 75, elapsedTime: '02:45' });
      const progressMsgs = postedMessages.filter((m) => m.type === 'progress');
      const progressMsg = progressMsgs[progressMsgs.length - 1];
      assert.ok(progressMsg, 'Progress message should be posted');
      assert.strictEqual(progressMsg.percentage, 75);
      assert.strictEqual(progressMsg.elapsedTime, '02:45');

      console.log('  ✓ Outbound state broadcast verified.');
    }

    // --------------------------------------------------------------------------
    // Test 4: State Persistence & Phase Toggle
    // --------------------------------------------------------------------------
    console.log('\n[Test 4] Verifying State Persistence & Phase Selection Toggles...');
    {
      const provider = new SidebarProvider(mockExtensionUri as any);

      // Toggle phase index 0 -> selected
      await provider.handleWebviewMessage({ command: 'togglePhase', index: 0, selected: true });
      // Toggle phase index 2 -> selected
      await provider.handleWebviewMessage({ command: 'togglePhase', index: 2, selected: true });

      let selected = provider.getSelectedIndices();
      assert.ok(selected.has(0), 'Index 0 should be selected');
      assert.ok(selected.has(2), 'Index 2 should be selected');
      assert.strictEqual(selected.has(1), false, 'Index 1 should not be selected');

      // Toggle phase index 0 -> deselected
      await provider.handleWebviewMessage({ command: 'togglePhase', index: 0, selected: false });
      selected = provider.getSelectedIndices();
      assert.strictEqual(selected.has(0), false, 'Index 0 should be deselected');
      assert.ok(selected.has(2), 'Index 2 should remain selected');

      // Toggle all phases -> deselected
      await provider.handleWebviewMessage({ command: 'toggleAllPhases', selected: false });
      selected = provider.getSelectedIndices();
      assert.strictEqual(selected.size, 0, 'All phases should be deselected');

      console.log('  ✓ State persistence & phase selection toggles verified.');
    }

  } finally {
  }

  console.log('\n=============================================================');
  console.log('🎉 ALL PHASE 03 SIDEBAR WEBVIEW PROVIDER TESTS PASSED! (100%)');
  console.log('=============================================================\n');
}

runSidebarWebviewProviderTestSuite().catch((err) => {
  console.error('Phase 03 Sidebar Webview Provider Test Failed:', err);
  process.exit(1);
});
