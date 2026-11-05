// Standalone Mock Setup for 'vscode' before importing application modules
const Module = require('module');
const originalRequire = Module.prototype.require;

interface MockDisposable {
  dispose: () => void;
}

const registeredCommands: Map<string, Function> = new Map();
const executedCommands: { command: string; args: any[] }[] = [];
let mockConfigStore: Record<string, any> = {};
const configListeners: ((e: any) => void)[] = [];
const createdWebviewPanels: any[] = [];
let activeInfoMessages: string[] = [];
let activeErrorMessages: string[] = [];
let activeWarningMessages: string[] = [];

class MockWebview {
  public html: string = '';
  public options: any = {};
  public cspSource: string = 'vscode-webview:';
  private messageListeners: ((msg: any) => void)[] = [];
  public messagesPosted: any[] = [];

  asWebviewUri(uri: any): any {
    return {
      scheme: 'vscode-resource',
      authority: '',
      path: uri.path || uri.fsPath || '',
      toString: () => `vscode-resource://${uri.fsPath || uri.path || ''}`
    };
  }

  onDidReceiveMessage(listener: (msg: any) => void, _thisArgs?: any, disposables?: any[]): MockDisposable {
    this.messageListeners.push(listener);
    const disp = {
      dispose: () => {
        const idx = this.messageListeners.indexOf(listener);
        if (idx !== -1) {
          this.messageListeners.splice(idx, 1);
        }
      }
    };
    if (disposables) {
      disposables.push(disp);
    }
    return disp;
  }

  async postMessage(msg: any): Promise<boolean> {
    this.messagesPosted.push(msg);
    return true;
  }

  simulateMessageFromWebview(msg: any) {
    for (const l of [...this.messageListeners]) {
      l(msg);
    }
  }
}

class MockWebviewPanel {
  public viewType: string;
  public title: string;
  public showOptions: any;
  public options: any;
  public iconPath: any;
  public webview: MockWebview;
  public visible: boolean = true;
  public viewColumn: number = 1;
  public revealedColumns: number[] = [];
  public isDisposed: boolean = false;
  private disposeListeners: (() => void)[] = [];

  constructor(viewType: string, title: string, showOptions: any, options: any) {
    this.viewType = viewType;
    this.title = title;
    this.showOptions = showOptions;
    this.options = options;
    this.webview = new MockWebview();
  }

  reveal(column?: number) {
    if (column !== undefined) {
      this.viewColumn = column;
      this.revealedColumns.push(column);
    }
    this.visible = true;
  }

  onDidDispose(listener: () => void, _thisArgs?: any, disposables?: any[]): MockDisposable {
    this.disposeListeners.push(listener);
    const disp = {
      dispose: () => {
        const idx = this.disposeListeners.indexOf(listener);
        if (idx !== -1) {
          this.disposeListeners.splice(idx, 1);
        }
      }
    };
    if (disposables) {
      disposables.push(disp);
    }
    return disp;
  }

  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.visible = false;
    for (const l of [...this.disposeListeners]) {
      l();
    }
  }
}

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section?: string) => ({
          get: (key: string, defaultValue: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            if (mockConfigStore[fullKey] !== undefined) return mockConfigStore[fullKey];
            if (mockConfigStore[key] !== undefined) return mockConfigStore[key];
            return defaultValue;
          },
          update: async (key: string, value: any, _target?: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            mockConfigStore[fullKey] = value;
            mockConfigStore[key] = value;
          }
        }),
        onDidChangeConfiguration: (listener: (e: any) => void) => {
          configListeners.push(listener);
          return {
            dispose: () => {
              const idx = configListeners.indexOf(listener);
              if (idx !== -1) configListeners.splice(idx, 1);
            }
          };
        },
        workspaceFolders: []
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      ViewColumn: {
        Active: -1,
        Beside: -2,
        One: 1,
        Two: 2
      },
      StatusBarAlignment: {
        Left: 1,
        Right: 2
      },
      Uri: {
        file: (fsPath: string) => ({
          fsPath,
          path: fsPath,
          scheme: 'file',
          toString: () => `file://${fsPath}`
        }),
        joinPath: (baseUri: any, ...pathSegments: string[]) => {
          const pathModule = require('path');
          const joined = pathModule.join(baseUri.fsPath || baseUri.path || '', ...pathSegments);
          return {
            fsPath: joined,
            path: joined,
            scheme: 'file',
            toString: () => `file://${joined}`
          };
        }
      },
      commands: {
        registerCommand: (command: string, callback: Function) => {
          registeredCommands.set(command, callback);
          return { dispose: () => registeredCommands.delete(command) };
        },
        executeCommand: async (command: string, ...args: any[]) => {
          executedCommands.push({ command, args });
          const fn = registeredCommands.get(command);
          if (fn) return fn(...args);
          return undefined;
        }
      },
      window: {
        activeTextEditor: undefined,
        createWebviewPanel: (viewType: string, title: string, showOptions: any, options: any) => {
          const panel = new MockWebviewPanel(viewType, title, showOptions, options);
          createdWebviewPanels.push(panel);
          return panel;
        },
        showInformationMessage: async (msg: string) => {
          activeInfoMessages.push(msg);
          return undefined;
        },
        showErrorMessage: async (msg: string) => {
          activeErrorMessages.push(msg);
          return undefined;
        },
        showWarningMessage: async (msg: string) => {
          activeWarningMessages.push(msg);
          return undefined;
        },
        showOpenDialog: async () => undefined,
        showInputBox: async () => undefined
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { JSDOM } from 'jsdom';
import { SettingsProvider } from '../settingsProvider';
import { DebugLogger, LogEntry } from '../debugLogger';

async function runPhase03Verification() {
  console.log('======================================================================');
  console.log('🧪 Phase 03: Settings Webview IPC Batching & DOM Pruning Verification');
  console.log('======================================================================\n');

  const rootDir = path.resolve(__dirname, '../../');
  const extensionUri = {
    fsPath: rootDir,
    path: rootDir,
    scheme: 'file',
    toString: () => `file://${rootDir}`
  } as any;

  let totalTests = 0;
  let passedTests = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    totalTests++;
    try {
      await fn();
      passedTests++;
      console.log(`  ✓ ${name}`);
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error(err);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Target 1: SettingsProvider IPC Log Batching & Buffering
  // --------------------------------------------------------------------------
  console.log('--- Target 1: SettingsProvider Buffer Rapid Log Bursts (FR-01) ---');

  await test('SettingsProvider buffers rapid log bursts into a single batched IPC message', async () => {
    const logger = new DebugLogger(500);
    const mockPanel = new MockWebviewPanel('autoplan.settingsPanel', 'Auto-Plan Settings', -1, {});
    const provider = new SettingsProvider(mockPanel as any, extensionUri, undefined, logger);

    // Initial messages posted on constructor: init HTML only, no log batches yet
    mockPanel.webview.messagesPosted = [];

    // Emit 50 log entries in rapid burst (< 10ms)
    const startTime = Date.now();
    for (let i = 1; i <= 50; i++) {
      logger.info('SERVER', `Burst log message #${i}`, { index: i });
    }

    // Synchronously, zero log messages should be posted yet because they are buffered
    const immediateBatchMsgs = mockPanel.webview.messagesPosted.filter(
      (m) => m.command === 'logBatch' || m.command === 'logEntry'
    );
    assert.strictEqual(
      immediateBatchMsgs.length,
      0,
      'SettingsProvider must not dispatch individual postMessage events synchronously'
    );

    // Verify buffer holds all 50 entries and batch timer is ticking
    const pending = provider.getPendingLogEntries();
    assert.strictEqual(pending.length, 50, 'Pending buffer must contain exactly 50 entries');
    assert.strictEqual(provider.isBatchTimerActive(), true, 'Batch timer must be active');

    // Wait for the batch cadence timer to flush (LOG_BATCH_CADENCE_MS = 50ms)
    await new Promise((resolve) => setTimeout(resolve, 80));

    // After timer expires, exactly 1 logBatch message must have been dispatched
    const flushedBatchMsgs = mockPanel.webview.messagesPosted.filter(
      (m) => m.command === 'logBatch'
    );
    assert.strictEqual(
      flushedBatchMsgs.length,
      1,
      'SettingsProvider must dispatch exactly 1 batched log message for the burst'
    );

    const batchPayload = flushedBatchMsgs[0];
    assert.strictEqual(batchPayload.type, 'logBatch');
    assert.ok(Array.isArray(batchPayload.entries), 'Batch payload must contain entries array');
    assert.strictEqual(batchPayload.entries.length, 50, 'Batch must contain all 50 entries');
    assert.strictEqual(batchPayload.entries[0].message, 'Burst log message #1');
    assert.strictEqual(batchPayload.entries[49].message, 'Burst log message #50');

    // Pending buffer must now be empty and timer cleared
    assert.strictEqual(provider.getPendingLogEntries().length, 0, 'Pending buffer must be cleared after flush');
    assert.strictEqual(provider.isBatchTimerActive(), false, 'Batch timer must be inactive after flush');

    provider.dispose();
  });

  await test('SettingsProvider auto-flushes immediately when MAX_LOG_BATCH_SIZE is reached', async () => {
    const logger = new DebugLogger(2000);
    const mockPanel = new MockWebviewPanel('autoplan.settingsPanel', 'Auto-Plan Settings', -1, {});
    const provider = new SettingsProvider(mockPanel as any, extensionUri, undefined, logger);

    mockPanel.webview.messagesPosted = [];

    // Push MAX_LOG_BATCH_SIZE (500) entries rapidly
    for (let i = 1; i <= SettingsProvider.MAX_LOG_BATCH_SIZE; i++) {
      logger.debug('CLIENT', `Max batch fill item #${i}`);
    }

    // Should have flushed immediately upon hitting the maximum batch threshold
    const batchMsgs = mockPanel.webview.messagesPosted.filter((m) => m.command === 'logBatch');
    assert.strictEqual(
      batchMsgs.length,
      1,
      'SettingsProvider must immediately flush when reaching MAX_LOG_BATCH_SIZE'
    );
    assert.strictEqual(
      batchMsgs[0].entries.length,
      SettingsProvider.MAX_LOG_BATCH_SIZE,
      'Flushed batch must have 500 entries'
    );
    assert.strictEqual(provider.getPendingLogEntries().length, 0);

    provider.dispose();
  });

  await test('SettingsProvider cleans up pending batch timer and entries on dispose and clearDebugLog', async () => {
    const logger = new DebugLogger(500);
    const mockPanel = new MockWebviewPanel('autoplan.settingsPanel', 'Auto-Plan Settings', -1, {});
    const provider = new SettingsProvider(mockPanel as any, extensionUri, undefined, logger);

    // Queue 5 entries
    for (let i = 1; i <= 5; i++) {
      provider.sendLogEntry({
        id: `test_${i}`,
        timestamp: Date.now(),
        isoTime: new Date().toISOString(),
        level: 'INFO',
        component: 'SERVER',
        message: `Pending entry ${i}`
      });
    }
    assert.strictEqual(provider.getPendingLogEntries().length, 5);
    assert.strictEqual(provider.isBatchTimerActive(), true);

    // Simulate clearDebugLog command from webview
    await provider.handleMessage({ command: 'clearDebugLog' });
    assert.strictEqual(provider.getPendingLogEntries().length, 0, 'clearDebugLog must clear pending queue');
    assert.strictEqual(provider.isBatchTimerActive(), false, 'clearDebugLog must cancel pending batch timer');

    // Re-queue 3 entries and test dispose
    for (let i = 1; i <= 3; i++) {
      provider.sendLogEntry({
        id: `test_disp_${i}`,
        timestamp: Date.now(),
        isoTime: new Date().toISOString(),
        level: 'WARN',
        component: 'SERVER',
        message: `Dispose test entry ${i}`
      });
    }
    assert.strictEqual(provider.getPendingLogEntries().length, 3);
    provider.dispose();
    assert.strictEqual(provider.getPendingLogEntries().length, 0, 'dispose must clear pending queue');
    assert.strictEqual(provider.isBatchTimerActive(), false, 'dispose must cancel active batch timer');
  });

  // --------------------------------------------------------------------------
  // Target 2: Webview Message Consumer & DocumentFragment Single Frame Batching
  // --------------------------------------------------------------------------
  console.log('\n--- Target 2: Webview DocumentFragment Batching & Message Handling (FR-02) ---');

  const settingsHtmlPath = path.join(rootDir, 'media/settings/settings.html');
  const settingsJsPath = path.join(rootDir, 'media/settings/settings.js');
  assert.ok(fs.existsSync(settingsHtmlPath), 'settings.html must exist');
  assert.ok(fs.existsSync(settingsJsPath), 'settings.js must exist');

  const htmlContent = fs.readFileSync(settingsHtmlPath, 'utf8');
  const jsContent = fs.readFileSync(settingsJsPath, 'utf8');

  // Setup JSDOM environment for Webview Client Script verification
  const dom = new JSDOM(htmlContent, {
    runScripts: 'dangerously',
    url: 'vscode-webview://settings'
  });
  const { window } = dom;
  const { document } = window;

  const postedFromWebview: any[] = [];
  (window as any).acquireVsCodeApi = () => ({
    postMessage: (msg: any) => {
      postedFromWebview.push(msg);
    },
    getState: () => ({ activeTab: 'tab-diagnostics' }),
    setState: () => {}
  });

  // Track requestAnimationFrame calls
  let rafCallbacks: Function[] = [];
  let rafCallCount = 0;
  (window as any).requestAnimationFrame = (callback: Function) => {
    rafCallCount++;
    rafCallbacks.push(callback);
    return rafCallCount;
  };

  // Evaluate settings.js inside JSDOM window
  const scriptEl = document.createElement('script');
  scriptEl.textContent = jsContent;
  document.body.appendChild(scriptEl);

  const logConsoleOutput = document.getElementById('logConsoleOutput') as HTMLElement;
  const logConsoleViewport = document.getElementById('logConsoleViewport') as HTMLElement;
  const logCountBadge = document.getElementById('logCountBadge') as HTMLElement;
  const chkAutoScroll = document.getElementById('chkAutoScroll') as HTMLInputElement;
  const logLevelFilter = document.getElementById('logLevelFilter') as HTMLSelectElement;

  assert.ok(logConsoleOutput, '#logConsoleOutput element must exist');
  assert.ok(logConsoleViewport, '#logConsoleViewport element must exist');
  assert.ok(logCountBadge, '#logCountBadge element must exist');
  assert.ok(chkAutoScroll, '#chkAutoScroll checkbox must exist');
  assert.ok(logLevelFilter, '#logLevelFilter select must exist');

  await test('Webview handles command: logBatch and inserts batch into DOM', async () => {
    // Dispatch a batch of 25 log entries
    const testBatch: LogEntry[] = [];
    for (let i = 1; i <= 25; i++) {
      testBatch.push({
        id: `batch_item_${i}`,
        timestamp: Date.now() + i,
        isoTime: new Date(Date.now() + i).toISOString(),
        level: i % 5 === 0 ? 'ERROR' : i % 3 === 0 ? 'WARN' : 'INFO',
        component: 'SERVER',
        message: `Batch message #${i}`,
        details: { num: i }
      });
    }

    window.dispatchEvent(
      new (window as any).MessageEvent('message', {
        data: {
          command: 'logBatch',
          type: 'logBatch',
          entries: testBatch
        }
      })
    );

    const rows = logConsoleOutput.querySelectorAll('.log-row');
    assert.strictEqual(rows.length, 25, 'logConsoleOutput must contain all 25 rendered rows from batch');
    assert.ok(rows[0].textContent?.includes('Batch message #1'), 'First row should match first batch item');
    assert.ok(rows[24].textContent?.includes('Batch message #25'), 'Last row should match 25th batch item');
    assert.strictEqual(logCountBadge.textContent, '25 / 25 entries');

    // Drain any scheduled auto-scroll rAF
    while (rafCallbacks.length) {
      const cb = rafCallbacks.shift();
      if (cb) cb();
    }
  });

  // --------------------------------------------------------------------------
  // Target 3: DOM Bounded Memory & Pruning (MAX_LOG_BUFFER_SIZE = 1,000)
  // --------------------------------------------------------------------------
  console.log('\n--- Target 3: DOM Element Bounding & Pruning (MAX_LOG_BUFFER_SIZE = 1,000) (FR-04, PERF-005) ---');

  await test('Flooding with 2,500 consecutive log entries leaves exactly MAX_LOG_BUFFER_SIZE (1,000) DOM nodes', async () => {
    // Generate 2,500 consecutive log entries dispatched across 5 batches of 500 entries
    const TOTAL_FLOOD_ENTRIES = 2500;
    const BATCH_SIZE = 500;
    const MAX_CAPACITY = 1000;

    for (let batchIdx = 0; batchIdx < TOTAL_FLOOD_ENTRIES / BATCH_SIZE; batchIdx++) {
      const batch: LogEntry[] = [];
      for (let i = 1; i <= BATCH_SIZE; i++) {
        const itemNumber = batchIdx * BATCH_SIZE + i;
        batch.push({
          id: `flood_${itemNumber}`,
          timestamp: Date.now() + itemNumber,
          isoTime: new Date(Date.now() + itemNumber).toISOString(),
          level: itemNumber % 10 === 0 ? 'ERROR' : itemNumber % 5 === 0 ? 'WARN' : 'INFO',
          component: 'DISPATCHER',
          message: `Flood item #${itemNumber}`,
          details: { itemNumber }
        });
      }

      window.dispatchEvent(
        new (window as any).MessageEvent('message', {
          data: {
            command: 'logBatch',
            entries: batch
          }
        })
      );
    }

    // Verify child element count never exceeds 1,000 and is exactly 1,000
    const renderedRows = logConsoleOutput.querySelectorAll('.log-row');
    assert.strictEqual(
      logConsoleOutput.childElementCount,
      MAX_CAPACITY,
      `logConsoleOutput.childElementCount must strictly equal ${MAX_CAPACITY}, found ${logConsoleOutput.childElementCount}`
    );
    assert.strictEqual(
      renderedRows.length,
      MAX_CAPACITY,
      `Rendered .log-row count must strictly equal ${MAX_CAPACITY}, found ${renderedRows.length}`
    );

    // Verify FIFO pruning: Oldest items 1-1500 were pruned. Items 1501 to 2500 remain.
    const expectedFirstItemNumber = TOTAL_FLOOD_ENTRIES - MAX_CAPACITY + 1; // 1501
    const expectedLastItemNumber = TOTAL_FLOOD_ENTRIES; // 2500

    const firstRowText = renderedRows[0].textContent || '';
    assert.ok(
      firstRowText.includes(`Flood item #${expectedFirstItemNumber}`),
      `First DOM row must be entry #${expectedFirstItemNumber}, found: "${firstRowText}"`
    );

    const lastRowText = renderedRows[renderedRows.length - 1].textContent || '';
    assert.ok(
      lastRowText.includes(`Flood item #${expectedLastItemNumber}`),
      `Last DOM row must be entry #${expectedLastItemNumber}, found: "${lastRowText}"`
    );

    // Verify badge accurately reflects 1,000 / 1,000 entries
    assert.strictEqual(logCountBadge.textContent, '1000 / 1000 entries');

    // Drain any scheduled auto-scroll rAF
    while (rafCallbacks.length) {
      const cb = rafCallbacks.shift();
      if (cb) cb();
    }
  });

  // --------------------------------------------------------------------------
  // Target 4: Log Filtering & Auto-scroll requestAnimationFrame Synchronization
  // --------------------------------------------------------------------------
  console.log('\n--- Target 4: Filtering & requestAnimationFrame Auto-Scroll (FR-03, FR-05) ---');

  await test('Log filtering updates DOM and count badge correctly with batched updates', async () => {
    // Switch filter to 'warn-error'
    logLevelFilter.value = 'warn-error';
    logLevelFilter.dispatchEvent(new (window as any).Event('change'));

    const filteredRows = logConsoleOutput.querySelectorAll('.log-row');
    // In our 1,000 entries (items 1501 to 2500):
    // itemNumber % 5 === 0 are WARN (every 5th) and itemNumber % 10 === 0 are ERROR (every 10th)
    // Exactly 200 items in 1501..2500 are divisible by 5 (and 10)
    assert.strictEqual(filteredRows.length, 200, 'Filtered DOM row count should be exactly 200 for warn-error');

    for (let i = 0; i < filteredRows.length; i++) {
      const row = filteredRows[i];
      const levelSpan = row.querySelector('.badge-level');
      assert.ok(
        levelSpan && (levelSpan.textContent === 'WARN' || levelSpan.textContent === 'ERROR'),
        'All visible rows must be either WARN or ERROR level'
      );
    }
    assert.strictEqual(logCountBadge.textContent, '200 / 1000 entries');

    // Revert filter to 'all'
    logLevelFilter.value = 'all';
    logLevelFilter.dispatchEvent(new (window as any).Event('change'));
    assert.strictEqual(logConsoleOutput.querySelectorAll('.log-row').length, 1000);
    assert.strictEqual(logCountBadge.textContent, '1000 / 1000 entries');

    // Drain any scheduled auto-scroll rAF
    while (rafCallbacks.length) {
      const cb = rafCallbacks.shift();
      if (cb) cb();
    }
  });

  await test('Auto-scroll synchronizes with requestAnimationFrame without layout thrashing', async () => {
    if (typeof (window as any).__resetAutoScroll === 'function') {
      (window as any).__resetAutoScroll();
    }
    while (rafCallbacks.length) {
      const cb = rafCallbacks.shift();
      if (cb) cb();
    }
    chkAutoScroll.checked = true;
    rafCallbacks = [];
    rafCallCount = 0;

    // Dispatch 5 rapid batches while simulation frame is unconsumed
    for (let i = 1; i <= 5; i++) {
      window.dispatchEvent(
        new (window as any).MessageEvent('message', {
          data: {
            command: 'logBatch',
            entries: [
              {
                id: `raf_test_${i}`,
                timestamp: Date.now(),
                isoTime: new Date().toISOString(),
                level: 'INFO',
                component: 'SERVER',
                message: `rAF test entry #${i}`
              }
            ]
          }
        })
      );
    }

    // Because rAF throttles until callback executes, exactly 1 rAF callback should be scheduled!
    assert.strictEqual(
      rafCallbacks.length,
      1,
      'Multiple rapid log batches must coalesce into a single pending requestAnimationFrame callback'
    );

    // Mock viewport dimensions
    Object.defineProperty(logConsoleViewport, 'scrollHeight', { value: 12000, configurable: true });
    logConsoleViewport.scrollTop = 0;

    // Execute the scheduled animation frame callback
    const cb = rafCallbacks.shift();
    if (cb) cb();

    // Verify scrollTop updated to scrollHeight on frame render
    assert.strictEqual(
      logConsoleViewport.scrollTop,
      12000,
      'Executing rAF callback must synchronize logConsoleViewport.scrollTop to scrollHeight'
    );

    // Now test with chkAutoScroll unchecked: no rAF callbacks should be scheduled
    chkAutoScroll.checked = false;
    rafCallbacks = [];
    rafCallCount = 0;

    window.dispatchEvent(
      new (window as any).MessageEvent('message', {
        data: {
          command: 'logBatch',
          entries: [
            {
              id: 'raf_uncheck_test',
              timestamp: Date.now(),
              isoTime: new Date().toISOString(),
              level: 'INFO',
              component: 'SERVER',
              message: 'Should not trigger auto-scroll when checkbox is unchecked'
            }
          ]
        }
      })
    );

    assert.strictEqual(
      rafCallbacks.length,
      0,
      'When chkAutoScroll is unchecked, scheduleAutoScroll must not request animation frames'
    );
  });

  // --------------------------------------------------------------------------
  // Target 5: End-to-End Logger -> SettingsProvider -> Webview Pipeline
  // --------------------------------------------------------------------------
  console.log('\n--- Target 5: End-to-End Logger -> Provider -> Webview Pipeline ---');

  await test('Full pipeline: DebugLogger bursts pipe through SettingsProvider batching into Webview DOM', async () => {
    const pipeLogger = new DebugLogger(2000);
    const pipePanel = new MockWebviewPanel('autoplan.settingsPanel', 'Auto-Plan Settings', -1, {});
    
    // Wire provider postMessage directly to Webview window event listener
    pipePanel.webview.postMessage = async (msg: any) => {
      window.dispatchEvent(new (window as any).MessageEvent('message', { data: msg }));
      return true;
    };

    const pipeProvider = new SettingsProvider(pipePanel as any, extensionUri, undefined, pipeLogger);

    // Emit 80 rapid entries via DebugLogger
    for (let i = 1; i <= 80; i++) {
      pipeLogger.info('ORCHESTRATOR', `Pipeline test log item #${i}`, { index: i });
    }

    // Flush batch to webview
    pipeProvider.flushLogBatch();

    // Verify DOM now contains the latest rows from the pipeline
    const rows = logConsoleOutput.querySelectorAll('.log-row');
    assert.strictEqual(
      rows.length,
      1000,
      'DOM row count must remain bounded at MAX_LOG_BUFFER_SIZE (1,000)'
    );

    const lastRowText = rows[rows.length - 1].textContent || '';
    assert.ok(
      lastRowText.includes('Pipeline test log item #80'),
      `Last DOM row must be the latest flushed pipeline entry: "${lastRowText}"`
    );

    pipeProvider.dispose();
  });

  console.log('\n======================================================================');
  console.log(`🎉 All ${passedTests}/${totalTests} Phase 03 verification tests passed successfully!`);
  console.log('======================================================================\n');
}

// Support running directly via Node
if (require.main === module) {
  runPhase03Verification().catch((err) => {
    console.error('Phase 03 verification failed:', err);
    process.exit(1);
  });
}

export { runPhase03Verification };
