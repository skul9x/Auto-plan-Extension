// Standalone test runner for Phase 03: End-to-End Resilience & User Cancellation Integration
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockInformationMessageCalls: { message: string; items: string[] }[] = [];
let mockInformationMessageResponse: string | undefined = undefined;
let mockErrorMessageCalls: { message: string; items: string[] }[] = [];
let mockErrorMessageResponse: string | undefined = undefined;
let mockWarningMessageCalls: string[] = [];
let mockExecutedCommands: { command: string; args: any[] }[] = [];

class MockStatusBarItem {
  public id?: string;
  public alignment?: any;
  public priority?: number;
  public text: string = '';
  public tooltip: any = '';
  public command: string = '';
  public visible: boolean = false;
  public showCalls: number = 0;
  public hideCalls: number = 0;
  public disposeCalls: number = 0;

  constructor(id?: string, alignment?: any, priority?: number) {
    this.id = id;
    this.alignment = alignment;
    this.priority = priority;
  }

  show() {
    this.showCalls++;
    this.visible = true;
  }

  hide() {
    this.hideCalls++;
    this.visible = false;
  }

  dispose() {
    this.disposeCalls++;
  }
}

let mockStatusBarRegistry: MockStatusBarItem[] = [];
let registeredWebviewProviders: Map<string, any> = new Map();

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      commands: {
        executeCommand: async (cmd: string, ...args: any[]) => {
          mockExecutedCommands.push({ command: cmd, args });
          return undefined;
        },
        registerCommand: (cmd: string, callback: (...args: any[]) => any) => ({
          dispose: () => {}
        })
      },
      window: {
        showWarningMessage: async (msg: string) => {
          mockWarningMessageCalls.push(msg);
          return undefined;
        },
        showErrorMessage: async (msg: string, ...items: string[]) => {
          mockErrorMessageCalls.push({ message: msg, items });
          return mockErrorMessageResponse;
        },
        showInformationMessage: async (msg: string, ...items: string[]) => {
          mockInformationMessageCalls.push({ message: msg, items });
          return mockInformationMessageResponse;
        },
        createStatusBarItem: (first?: any, second?: any, third?: any) => {
          let item: MockStatusBarItem;
          if (typeof first === 'string') {
            item = new MockStatusBarItem(first, second, third);
          } else {
            item = new MockStatusBarItem(undefined, first, second);
          }
          mockStatusBarRegistry.push(item);
          return item;
        },
        registerWebviewViewProvider: (viewType: string, provider: any) => {
          registeredWebviewProviders.set(viewType, provider);
          return { dispose: () => registeredWebviewProviders.delete(viewType) };
        },
        createOutputChannel: () => ({
          appendLine: () => {},
          show: () => {},
          clear: () => {},
          dispose: () => {}
        }),
        showInputBox: async () => undefined,
        activeTextEditor: undefined
      },
      workspace: {
        workspaceFolders: [{ name: 'test-workspace', uri: { fsPath: '/test/workspace' } }],
        getConfiguration: () => ({
          get: (_k: string, d: any) => d,
          update: async () => {}
        }),
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
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
      Uri: {
        file: (fPath: string) => ({
          fsPath: fPath,
          scheme: 'file',
          toString: () => `file://${fPath}`
        }),
        joinPath: (base: any, ...segments: string[]) => {
          const basePath = typeof base === 'string' ? base : (base.fsPath || base.path || '');
          const res = path.join(basePath, ...segments);
          return {
            fsPath: res,
            scheme: 'file',
            toString: () => `file://${res}`
          };
        }
      },
      MarkdownString: class {
        public value: string;
        public isTrusted: boolean = false;
        constructor(val: string) {
          this.value = val;
        }
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import {
  activate,
  deactivate,
  getMainStatusBarItem,
  getBridgeStatusBarItem,
  updateStatusBar,
  updateBridgeStatusBar,
  sidebarProvider
} from '../extension';
import {
  orchestrator,
  Orchestrator,
  NewConversationTimeoutError
} from '../orchestrator';
import { CompletionResult } from '../transcriptWatcher';
import { DispatchResult } from '../promptDispatcher';
import { DEFAULT_CONFIG } from '../config';
import { debugLogger } from '../debugLogger';

class MockTranscriptWatcher extends EventEmitter {
  public brainDir: string;
  public pollIntervalMs: number = 10;
  public waitForNewConversationCalls = 0;
  public watchFileCalls = 0;
  public watchLatestCalls = 0;
  public timeoutFailuresRemaining = 0;

  constructor(brainDir: string) {
    super();
    this.brainDir = brainDir;
  }

  getOptions() {
    return { brainDir: this.brainDir, pollIntervalMs: this.pollIntervalMs };
  }

  setOptions(_opts: any) {}

  async waitForNewConversation(
    _phaseStartTime: number,
    _lastConvId?: string,
    timeoutMs: number = 8000,
    _pollIntervalMs?: number,
    _ownershipCriteria?: any
  ): Promise<string> {
    this.waitForNewConversationCalls++;
    if (this.timeoutFailuresRemaining > 0) {
      this.timeoutFailuresRemaining--;
      throw new NewConversationTimeoutError(`Timeout waiting for new conversation after ${timeoutMs}ms`, {
        timeoutMs,
        fileName: 'phase-01-integration.md'
      });
    }
    const convId = `conv-integration-${this.waitForNewConversationCalls}`;
    const logDir = path.join(this.brainDir, convId, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'transcript.jsonl'), '{"type":"MODEL"}\n');
    return convId;
  }

  async watchFile(
    _transcriptPath: string,
    convId: string,
    _offset: number,
    _startTime: number,
    _initLength?: number
  ): Promise<CompletionResult> {
    this.watchFileCalls++;
    return {
      success: true,
      conversationId: convId,
      matchedContent: 'Done skul9x.',
      timestamp: Date.now()
    };
  }

  async watchLatest(
    _startTime: number,
    convId?: string,
    _initLength?: number
  ): Promise<CompletionResult> {
    this.watchLatestCalls++;
    return {
      success: true,
      conversationId: convId || 'conv-latest',
      matchedContent: 'Done skul9x.',
      timestamp: Date.now()
    };
  }

  stop() {}
  dispose() {}
}

class MockPromptDispatcher {
  public dispatchCalls = 0;
  public dispatchedPrompts: string[] = [];
  public lastDispatchOptions: any = null;

  validateDispatchReadiness() {
    return { ready: true, requiresForegroundFocus: false };
  }

  async ensureBridgeReadinessWithWakeup() {
    return { ready: true, requiresForegroundFocus: false };
  }

  async dispatchPrompt(renderedPrompt: string, options: any): Promise<DispatchResult> {
    this.dispatchCalls++;
    this.dispatchedPrompts.push(renderedPrompt);
    this.lastDispatchOptions = options;
    return {
      success: true,
      tier: 'domBridge',
      durationMs: 5
    };
  }
}

async function runPhase03E2EIntegrationTests() {
  console.log('=== Running Phase 03: End-to-End Resilience & User Cancellation Integration Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-e2e-'));
  const brainDir = path.join(tempDir, 'brain');
  const planDir = path.join(tempDir, 'plans');
  fs.mkdirSync(brainDir, { recursive: true });
  fs.mkdirSync(planDir, { recursive: true });

  const phasePath = path.join(planDir, 'phase-01-integration.md');
  fs.writeFileSync(phasePath, '# Phase 01: Integration\nStatus: ⬜ Pending\n');

  const mockContext: any = {
    extensionUri: { fsPath: tempDir, scheme: 'file', toString: () => `file://${tempDir}` },
    subscriptions: [],
    workspaceState: {
      get: () => undefined,
      update: async () => {}
    },
    globalState: {
      get: () => [],
      update: async () => {}
    }
  };

  try {
    // -------------------------------------------------------------------------
    // Setup extension environment
    // -------------------------------------------------------------------------
    activate(mockContext);

    const mainStatusBar = getMainStatusBarItem();
    const bridgeStatusBar = getBridgeStatusBarItem();

    assert.ok(mainStatusBar, 'mainStatusBarItem must be instantiated on activate');
    assert.ok(bridgeStatusBar, 'bridgeStatusBarItem must be instantiated on activate');
    assert.strictEqual(mockStatusBarRegistry.length, 2, 'Exactly two status bar items registered');

    // Attach mock webview to sidebarProvider
    const webviewPostedMessages: any[] = [];
    const mockWebviewView: any = {
      webview: {
        options: {},
        html: '',
        onDidReceiveMessage: () => ({ dispose: () => {} }),
        postMessage: async (msg: any) => {
          webviewPostedMessages.push(msg);
          return true;
        },
        asWebviewUri: (uri: any) => uri,
        cspSource: 'vscode-resource:'
      },
      show: () => {}
    };

    assert.ok(sidebarProvider, 'sidebarProvider must be instantiated');
    await sidebarProvider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    await sidebarProvider.handleWebviewMessage({ command: 'ready' });

    // -------------------------------------------------------------------------
    // Scenario D (Status Bar Cleanliness):
    // Verifies getBridgeStatusBarItem() is hidden while mainStatusBarItem is visible.
    // -------------------------------------------------------------------------
    console.log('[Scenario D] Verifying Status Bar Cleanliness & "Bridge: Active" Omission...');
    {
      updateBridgeStatusBar();
      assert.strictEqual(
        (bridgeStatusBar as any).visible,
        false,
        'Bridge status bar item must be hidden'
      );
      assert.strictEqual(
        (bridgeStatusBar as any).hideCalls >= 1,
        true,
        'Bridge status bar item hide() must have been called'
      );
      assert.ok(
        (bridgeStatusBar as any).text.includes('Bridge:'),
        'Bridge status bar text configured internally'
      );

      // Main status bar item should remain visible and initialized
      assert.strictEqual((mainStatusBar as any).visible, true, 'Main status bar item must be visible');
      assert.strictEqual((mainStatusBar as any).text, '$(rocket) Auto-Plan');
      console.log('  ✓ Verified: Bridge status bar item is permanently hidden while main item remains visible.\n');
    }

    // -------------------------------------------------------------------------
    // Scenario A (Recovery):
    // Dispatches phase, triggers timeout, verifies countdown notification and status bar text,
    // allows countdown to expire, verifies dispatch retry completes phase successfully.
    // -------------------------------------------------------------------------
    console.log('[Scenario A] Verifying Auto-Retry Recovery Flow, Live Countdown & Logger Telemetry...');
    {
      mockInformationMessageCalls = [];
      mockErrorMessageCalls = [];
      mockInformationMessageResponse = undefined;
      webviewPostedMessages.length = 0;
      debugLogger.clear();

      const watcher = new MockTranscriptWatcher(brainDir);
      watcher.timeoutFailuresRemaining = 1; // 1 timeout failure, recovers on retry 1
      const dispatcher = new MockPromptDispatcher();

      (orchestrator as any).transcriptWatcher = watcher;
      (orchestrator as any).promptDispatcher = dispatcher;
      (orchestrator as any).configProvider = () => ({
        ...DEFAULT_CONFIG,
        autoRetryOnTimeout: true,
        maxAutoRetries: 5,
        retryDelaySeconds: 3,
        delayBetweenLoopsMs: 10
      });

      const sleepCalls: number[] = [];
      const origSleep = orchestrator.sleepWithAbort.bind(orchestrator);
      orchestrator.sleepWithAbort = async function (ms: number, abortCheck: () => boolean) {
        sleepCalls.push(ms);
        // Fast-forward delay for test execution
        return origSleep(10, abortCheck);
      };

      // Track status bar texts seen during run
      const observedStatusBarTexts: string[] = [];
      const stateChangeListener = (info: any) => {
        observedStatusBarTexts.push((mainStatusBar as any).text);
      };
      orchestrator.on('stateChange', stateChangeListener);

      const success = await orchestrator.startPhases([phasePath]);
      orchestrator.removeListener('stateChange', stateChangeListener);

      assert.strictEqual(success, true, 'Phase sequence must succeed after retry recovery');
      assert.strictEqual(dispatcher.dispatchCalls, 2, 'Phase must be dispatched twice (initial + 1 retry)');
      assert.strictEqual(dispatcher.lastDispatchOptions?.openNewConversation, true, 'Retry must request new conversation');

      // Verify sleep duration requested was 3s
      assert.strictEqual(sleepCalls.length, 1, 'sleepWithAbort must be called once');
      assert.strictEqual(sleepCalls[0], 3000, 'sleepWithAbort delay must be 3000ms');

      // Verify countdown notification
      const retryNotifs = mockInformationMessageCalls.filter((m) =>
        m.message.includes('timeout tạo phiên mới')
      );
      assert.strictEqual(retryNotifs.length, 1, 'Exactly one countdown notification displayed');
      const retryNotif = retryNotifs[0];
      assert.ok(
        retryNotif.message.includes('timeout tạo phiên mới. Đang thử lại sau 3s... (Lần 1/5)'),
        `Notification message mismatch: ${retryNotif.message}`
      );
      assert.deepStrictEqual(retryNotif.items, ['⏹️ Hủy / Stop'], 'Action button must be "⏹️ Hủy / Stop"');

      // Verify completion notification was also emitted by extension.ts allComplete listener
      const completeNotif = mockInformationMessageCalls.find((m) =>
        m.message.includes('Successfully completed')
      );
      assert.ok(completeNotif, 'Completion notification must be displayed upon phase sequence completion');

      // Verify no premature error toasts were shown
      assert.strictEqual(
        mockErrorMessageCalls.length,
        0,
        'No error toast should be shown during recoverable auto-retry'
      );

      // Verify live status bar retry progress text
      const retryStatusText = observedStatusBarTexts.find((txt) =>
        txt.includes('Retrying Phase 1 (1/5) in 3s...')
      );
      assert.ok(
        retryStatusText,
        `Main status bar must display live retry countdown, got: ${JSON.stringify(observedStatusBarTexts)}`
      );
      assert.ok(
        retryStatusText?.includes('$(sync~spin)'),
        'Retry status bar text must include spinner'
      );

      // Verify sidebar progress and phase selection integrity
      const stateMessages = webviewPostedMessages.filter(
        (m) => m.type === 'stateUpdate' || m.command === 'stateUpdate'
      );
      assert.ok(stateMessages.length > 0, 'Sidebar must receive state updates');
      const lastStateMsg = stateMessages[stateMessages.length - 1];
      assert.ok(
        lastStateMsg.selectedIndices && Array.isArray(lastStateMsg.selectedIndices),
        'Sidebar stateUpdate message must contain selectedIndices array'
      );

      // Verify debugLogger recorded diagnostic entries for retry
      const recentLogs = debugLogger.getRecentEntries(50);
      const retryLog = recentLogs.find(
        (l) =>
          l.component === 'ORCHESTRATOR' &&
          l.message.includes('Auto-retrying (1/5) in 3s...')
      );
      assert.ok(retryLog, 'Debug logger must record retry attempt with attempt count');
      assert.strictEqual(retryLog?.level, 'INFO');
      assert.ok(retryLog?.timestamp > 0, 'Debug log entry must have a valid timestamp');

      // Verify bridge item stayed hidden throughout execution
      assert.strictEqual((bridgeStatusBar as any).visible, false, 'Bridge item must remain hidden');

      console.log('  ✓ Verified: Recovery completed seamlessly with live status bar countdown & diagnostic log.\n');
    }

    // -------------------------------------------------------------------------
    // Scenario B (Exhaustion):
    // Forces 5 consecutive timeouts, verifies final failure notification with
    // diagnostic options is displayed only after the 5th failure.
    // -------------------------------------------------------------------------
    console.log('[Scenario B] Verifying Retry Exhaustion (5/5) & Actionable Failure Notification...');
    {
      mockInformationMessageCalls = [];
      mockErrorMessageCalls = [];
      mockInformationMessageResponse = undefined;

      // Reset phase status
      fs.writeFileSync(phasePath, '# Phase 01: Integration\nStatus: ⬜ Pending\n');

      const watcher = new MockTranscriptWatcher(brainDir);
      watcher.timeoutFailuresRemaining = 99; // Always timeout
      const dispatcher = new MockPromptDispatcher();

      (orchestrator as any).transcriptWatcher = watcher;
      (orchestrator as any).promptDispatcher = dispatcher;
      (orchestrator as any).configProvider = () => ({
        ...DEFAULT_CONFIG,
        autoRetryOnTimeout: true,
        maxAutoRetries: 5,
        retryDelaySeconds: 3,
        delayBetweenLoopsMs: 10
      });

      const origSleep = orchestrator.sleepWithAbort.bind(orchestrator);
      orchestrator.sleepWithAbort = async function (ms: number, abortCheck: () => boolean) {
        return origSleep(5, abortCheck);
      };

      const success = await orchestrator.startPhases([phasePath]);

      assert.strictEqual(success, false, 'startPhases must return false when retries are exhausted');
      // 1 initial dispatch + 5 retries = 6 total dispatches
      assert.strictEqual(dispatcher.dispatchCalls, 6, 'Must attempt exactly 1 initial + 5 retries = 6 dispatches');
      assert.strictEqual(
        mockInformationMessageCalls.length,
        5,
        'Exactly 5 countdown notifications displayed before final failure'
      );
      assert.ok(
        mockInformationMessageCalls[4].message.includes('(Lần 5/5)'),
        '5th notification must be Lần 5/5'
      );

      // Verify failure notification is shown only after 5th failure
      assert.strictEqual(
        mockErrorMessageCalls.length,
        1,
        'Failure notification must be shown exactly once after exhausting all retries'
      );
      const errNotif = mockErrorMessageCalls[0];
      assert.ok(
        errNotif.message.includes('Timeout waiting for new conversation'),
        `Error notification message must describe timeout failure: ${errNotif.message}`
      );
      assert.ok(
        errNotif.items.includes('📋 Copy Diagnostic Log'),
        'Notification must provide "📋 Copy Diagnostic Log"'
      );
      assert.ok(
        errNotif.items.includes('⚙️ Open Settings'),
        'Notification must provide "⚙️ Open Settings"'
      );
      assert.ok(
        errNotif.items.includes('🔄 Retry Failed Phase'),
        'Notification must provide "🔄 Retry Failed Phase"'
      );

      // Status bar must be reset to idle state
      assert.strictEqual((mainStatusBar as any).text, '$(rocket) Auto-Plan');
      assert.strictEqual((bridgeStatusBar as any).visible, false);

      console.log('  ✓ Verified: Exactly 5 retries executed; diagnostic error toast displayed only upon exhaustion.\n');
    }

    // -------------------------------------------------------------------------
    // Scenario C (Cancellation):
    // During 3s countdown, triggers '⏹️ Hủy / Stop', verifies orchestrator halts
    // immediately and status bar shows stopped.
    // -------------------------------------------------------------------------
    console.log('[Scenario C] Verifying User Cancellation via "⏹️ Hủy / Stop" during Countdown...');
    {
      mockInformationMessageCalls = [];
      mockErrorMessageCalls = [];
      // User clicks '⏹️ Hủy / Stop' on the countdown notification
      mockInformationMessageResponse = '⏹️ Hủy / Stop';

      fs.writeFileSync(phasePath, '# Phase 01: Integration\nStatus: ⬜ Pending\n');

      const watcher = new MockTranscriptWatcher(brainDir);
      watcher.timeoutFailuresRemaining = 5;
      const dispatcher = new MockPromptDispatcher();

      (orchestrator as any).transcriptWatcher = watcher;
      (orchestrator as any).promptDispatcher = dispatcher;
      (orchestrator as any).configProvider = () => ({
        ...DEFAULT_CONFIG,
        autoRetryOnTimeout: true,
        maxAutoRetries: 5,
        retryDelaySeconds: 3,
        delayBetweenLoopsMs: 10
      });

      const start = Date.now();
      const success = await orchestrator.startPhases([phasePath]);
      const duration = Date.now() - start;

      assert.strictEqual(success, false, 'startPhases must return false when stopped by user');
      assert.strictEqual(orchestrator.getState(), 'stopped', 'State must transition to "stopped"');
      assert.strictEqual(dispatcher.dispatchCalls, 1, 'Only initial dispatch ran; retry aborted immediately');
      assert.ok(duration < 2000, `Halt must be immediate without waiting (took ${duration}ms)`);

      const phases = orchestrator.getPhases();
      assert.strictEqual(phases[0].status, 'Stopped', 'Phase status must be "Stopped"');

      // Status bar reset
      assert.strictEqual((mainStatusBar as any).text, '$(rocket) Auto-Plan');
      assert.strictEqual((bridgeStatusBar as any).visible, false);

      console.log('  ✓ Verified: User cancellation halts orchestrator immediately and resets status bar.\n');
    }

    // Clean up extension activation
    await deactivate();

    console.log('========================================================================');
    console.log('All Phase 03 integration scenarios (A, B, C, D) passed with 100% assertions satisfied!');
    console.log('========================================================================\n');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase03E2EIntegrationTests().catch((err) => {
  console.error('Phase 03 Test Failure:', err);
  process.exit(1);
});
