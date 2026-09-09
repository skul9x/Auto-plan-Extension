// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      Uri: {
        file: (f: string) => ({ fsPath: f }),
        joinPath: (...args: any[]) => ({ fsPath: args.join('/') })
      },
      WebviewViewProvider: class {},
      window: {
        showWarningMessage: () => {},
        showInformationMessage: () => {},
        showErrorMessage: () => {}
      },
      commands: {
        executeCommand: async () => {}
      },
      workspace: {
        workspaceFolders: []
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import { SidebarProvider, MAX_PENDING_LOGS } from '../sidebarProvider';

class MockWebview {
  public postedMessages: any[] = [];
  public options = {};
  public html = '';
  public cspSource = "'none'";

  public asWebviewUri(uri: any) {
    return uri;
  }

  public async postMessage(message: any): Promise<boolean> {
    this.postedMessages.push(message);
    return true;
  }

  public onDidReceiveMessage(_listener: any) {}
}

class MockWebviewView {
  public webview: MockWebview;
  constructor() {
    this.webview = new MockWebview();
  }
}

async function runPhase01Tests() {
  console.log('=== Running Phase 01: Sidebar Bounded Log Queue & Memory Leak Prevention Tests ===\n');

  const extensionUri = { fsPath: '/mock/extension' } as any;

  // ----------------------------------------------------------------------
  // Test 1: Bounded sliding window with 2,500 logs while webview unready
  // ----------------------------------------------------------------------
  console.log('[Test 1] Emitting 2,500 log events while webview unready (verifying getPendingLogsCount() <= 150)...');
  const provider = new SidebarProvider(extensionUri);
  assert.strictEqual(provider.isWebviewReady(), false, 'Webview should initially be unready');
  assert.strictEqual(MAX_PENDING_LOGS, 150, 'MAX_PENDING_LOGS constant must be 150');

  for (let i = 1; i <= 2500; i++) {
    provider.appendTranscriptLog(`Background log ${i}`);
  }

  assert.strictEqual(
    provider.getPendingLogsCount(),
    150,
    `Queue length must be bounded to exactly ${MAX_PENDING_LOGS} regardless of 2,500 arriving items`
  );
  console.log('  -> Passed: Sliding-window queue capped strictly at 150 items under heavy unready load.');

  // ----------------------------------------------------------------------
  // Test 2: Flush exactly 150 most recent logs as single batch when ready
  // ----------------------------------------------------------------------
  console.log('\n[Test 2] Transitioning webview to ready and verifying single-batch flush of 150 newest logs...');
  const mockView = new MockWebviewView();
  provider.resolveWebviewView(mockView as any, {} as any, {} as any);

  // Clear initial lifecycle messages
  mockView.webview.postedMessages = [];

  // Notify webview ready
  await provider.handleWebviewMessage({ command: 'ready' });
  assert.strictEqual(provider.isWebviewReady(), true, 'Webview state should be ready');

  const logMessages = mockView.webview.postedMessages.filter(
    m => m.type === 'transcriptLog' || m.type === 'transcriptLogBatch'
  );

  assert.strictEqual(logMessages.length, 1, 'Exactly one batched message should be sent on ready flush');
  assert.strictEqual(logMessages[0].type, 'transcriptLogBatch', 'Flushed message must be transcriptLogBatch');
  assert.strictEqual(logMessages[0].logs.length, 150, 'Flushed batch must contain exactly 150 logs');
  assert.strictEqual(logMessages[0].logs[0], 'Background log 2351', 'First log in batch must be log 2351 (FIFO eviction)');
  assert.strictEqual(logMessages[0].logs[149], 'Background log 2500', 'Last log in batch must be log 2500');
  assert.strictEqual(provider.getPendingLogsCount(), 0, 'Pending queue must be emptied after flush');
  console.log('  -> Passed: Webview readiness triggered clean single-batch flush of 150 most recent logs.');

  // ----------------------------------------------------------------------
  // Test 3: Clear logs resets queues and cancels timer
  // ----------------------------------------------------------------------
  console.log('\n[Test 3] Verifying clearLogs() resets both queues immediately...');
  provider.appendTranscriptLog('Log before clear 1');
  provider.appendTranscriptLog('Log before clear 2');
  assert.strictEqual(provider.getPendingLogsCount(), 2, 'Pending queue should have 2 logs');

  provider.clearLogs();
  assert.strictEqual(provider.getPendingLogsCount(), 0, 'Pending queue must be 0 after clearLogs()');

  // Wait 150ms to ensure no pending timer flushes anything
  mockView.webview.postedMessages = [];
  await new Promise(resolve => setTimeout(resolve, 150));
  const postClearMessages = mockView.webview.postedMessages.filter(
    m => m.type === 'transcriptLog' || m.type === 'transcriptLogBatch'
  );
  assert.strictEqual(postClearMessages.length, 0, 'No logs should be flushed after clearLogs()');
  console.log('  -> Passed: clearLogs() immediately clears queues and prevents delayed flushes.');

  // ----------------------------------------------------------------------
  // Test 4: Disposal when webview was never ready clears queue & cancels timer
  // ----------------------------------------------------------------------
  console.log('\n[Test 4] Verifying dispose() on unready webview cleans up queues and timers...');
  const unreadyProvider = new SidebarProvider(extensionUri);
  for (let i = 1; i <= 200; i++) {
    unreadyProvider.appendTranscriptLog(`Unready log ${i}`);
  }
  assert.strictEqual(unreadyProvider.getPendingLogsCount(), 150, 'Unready provider clamped to 150');

  unreadyProvider.dispose();
  assert.strictEqual(unreadyProvider.getPendingLogsCount(), 0, 'Queue must be 0 after dispose() on unready provider');

  // Wait 150ms to ensure no timer callback fires
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.strictEqual(unreadyProvider.getPendingLogsCount(), 0, 'Queue remains 0 after timer period');
  console.log('  -> Passed: dispose() cleanly tears down unready provider without leaks.');

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 01 BOUNDED LOG QUEUE TESTS PASSED!');
  console.log('======================================================\n');
}

runPhase01Tests().catch(err => {
  console.error('Phase 01 Test Suite Failed:', err);
  process.exit(1);
});
