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
import { SidebarProvider } from '../sidebarProvider';

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

// Helper simulating media/sidebar/sidebar.js appendAndPruneLogLines logic
function simulateSidebarDomRenderer() {
  const transcriptLog = { textContent: '' };
  const transcriptViewport = { scrollTop: 0, scrollHeight: 1000 };

  function appendAndPruneLogLines(newLogLines: string[]) {
    if (!newLogLines || newLogLines.length === 0) return;

    let currentText = transcriptLog.textContent || '';
    if (currentText === 'Waiting for activity...' || currentText === 'Feed cleared.') {
      currentText = '';
    }

    let existingLines = currentText ? currentText.split('\n') : [];

    for (const item of newLogLines) {
      if (typeof item === 'string') {
        const splitItems = item.split('\n');
        existingLines.push(...splitItems);
      }
    }

    if (existingLines.length > 200) {
      existingLines = existingLines.slice(-200);
    }

    transcriptLog.textContent = existingLines.join('\n');
    transcriptViewport.scrollTop = transcriptViewport.scrollHeight;
  }

  return { transcriptLog, transcriptViewport, appendAndPruneLogLines };
}

async function runPhase02Tests() {
  console.log('=== Running Phase 02: Webview IPC Log Batching & Sliding Window DOM Pruning Tests ===\n');

  // ----------------------------------------------------------------------
  // Test 1: IPC Message Batching Test
  // ----------------------------------------------------------------------
  console.log('[Test 1] Verifying IPC Message Batching (100 rapid calls -> 1 batched postMessage after 150ms)...');

  const extensionUri = { fsPath: '/mock/extension' } as any;
  const provider = new SidebarProvider(extensionUri);
  const mockView = new MockWebviewView();
  provider.resolveWebviewView(mockView as any, {} as any, {} as any);

  // Clear any initial stateUpdate or bridgeStatus messages sent during resolveWebviewView
  mockView.webview.postedMessages = [];

  // Fire 100 rapid appendTranscriptLog calls within 10ms
  for (let i = 1; i <= 100; i++) {
    provider.appendTranscriptLog(`Log line ${i}`);
  }

  // Assert that zero immediate transcript log postMessage calls were dispatched synchronously
  const immediateTranscriptMsgs = mockView.webview.postedMessages.filter(
    m => m.type === 'transcriptLog' || m.type === 'transcriptLogBatch'
  );
  assert.strictEqual(
    immediateTranscriptMsgs.length,
    0,
    'Zero transcriptLog or transcriptLogBatch messages should be sent synchronously upon rapid log calls'
  );

  // Wait 150ms for batch timer to flush
  await new Promise(resolve => setTimeout(resolve, 150));

  // Filter transcript log messages after timer elapsed
  const flushedTranscriptMsgs = mockView.webview.postedMessages.filter(
    m => m.type === 'transcriptLog' || m.type === 'transcriptLogBatch'
  );
  assert.strictEqual(
    flushedTranscriptMsgs.length,
    1,
    'Exactly ONE batched IPC message should be dispatched after 150ms flush window'
  );

  const batchMsg = flushedTranscriptMsgs[0];
  assert.strictEqual(batchMsg.type, 'transcriptLogBatch', 'Message type must be transcriptLogBatch');
  assert.strictEqual(batchMsg.command, 'transcriptLogBatch', 'Message command must be transcriptLogBatch');
  assert.ok(Array.isArray(batchMsg.logs), 'Payload logs must be an array');
  assert.strictEqual(batchMsg.logs.length, 100, 'Batched payload must contain all 100 log lines');
  assert.strictEqual(batchMsg.logs[0], 'Log line 1', 'First log line must match');
  assert.strictEqual(batchMsg.logs[99], 'Log line 100', 'Last log line must match');

  console.log('  -> Passed: 100 rapid log calls correctly buffered and flushed as 1 IPC transcriptLogBatch message.');

  // ----------------------------------------------------------------------
  // Test 2: DOM Line Pruning Test (200 line cap)
  // ----------------------------------------------------------------------
  console.log('\n[Test 2] Verifying Webview Sliding Window DOM Line Pruning (350 lines -> capped at 200)...');

  const renderer = simulateSidebarDomRenderer();

  // Feed 350 log lines sequentially using the pruning logic
  for (let i = 1; i <= 350; i++) {
    renderer.appendAndPruneLogLines([`Log entry ${i}`]);
  }

  const domLines = renderer.transcriptLog.textContent.split('\n');

  assert.strictEqual(domLines.length, 200, 'DOM line count must be capped at exactly 200 lines');
  assert.strictEqual(domLines[0], 'Log entry 151', 'Lines 1..150 must be pruned; first remaining line must be Log entry 151');
  assert.strictEqual(domLines[199], 'Log entry 350', 'Last line must be Log entry 350');
  assert.strictEqual(domLines.includes('Log entry 1'), false, 'Log entry 1 must be pruned from DOM');
  assert.strictEqual(domLines.includes('Log entry 150'), false, 'Log entry 150 must be pruned from DOM');

  console.log('  -> Passed: 350 log lines pruned to 200 oldest-pruned lines with line 350 present at end.');

  // ----------------------------------------------------------------------
  // Test 3: Batch Teardown & Immediate Flush Test
  // ----------------------------------------------------------------------
  console.log('\n[Test 3] Verifying Teardown & Immediate Flush on dispose() / stateUpdate...');

  mockView.webview.postedMessages = [];

  // Push 50 log lines into SidebarProvider
  for (let i = 1; i <= 50; i++) {
    provider.appendTranscriptLog(`Buffered line ${i}`);
  }

  // Verify not yet sent
  let pendingMsgs = mockView.webview.postedMessages.filter(
    m => m.type === 'transcriptLog' || m.type === 'transcriptLogBatch'
  );
  assert.strictEqual(pendingMsgs.length, 0, 'Buffered logs should not be sent immediately');

  // Trigger explicit provider dispose/flush
  provider.dispose();

  pendingMsgs = mockView.webview.postedMessages.filter(
    m => m.type === 'transcriptLog' || m.type === 'transcriptLogBatch'
  );
  assert.strictEqual(pendingMsgs.length, 1, 'Immediate flush must send all pending logs upon dispose()');
  assert.strictEqual(pendingMsgs[0].type, 'transcriptLogBatch', 'Flushed message type must be transcriptLogBatch');
  assert.strictEqual(pendingMsgs[0].logs.length, 50, 'Flushed message must contain all 50 buffered lines');
  assert.strictEqual(pendingMsgs[0].logs[0], 'Buffered line 1', 'First line must match');
  assert.strictEqual(pendingMsgs[0].logs[49], 'Buffered line 50', 'Last line must match');

  console.log('  -> Passed: Pending buffered logs immediately flushed on provider teardown without data loss.');

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 02 IPC BATCHING & DOM PRUNING TESTS PASSED!');
  console.log('======================================================\n');
}

runPhase02Tests().catch(err => {
  console.error('Phase 02 Test Suite Failed:', err);
  process.exit(1);
});
