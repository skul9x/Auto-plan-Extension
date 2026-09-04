// Standalone test runner with comprehensive mock for 'vscode' module
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockInformationMessageCalls: { message: string; items: string[] }[] = [];
let mockInformationMessageResponse: string | undefined = undefined;

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      commands: {
        executeCommand: async () => undefined
      },
      window: {
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showInformationMessage: async (msg: string, ...items: string[]) => {
          mockInformationMessageCalls.push({ message: msg, items });
          return mockInformationMessageResponse;
        },
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        createOutputChannel: () => ({
          appendLine: () => {},
          show: () => {},
          clear: () => {},
          dispose: () => {}
        })
      },
      workspace: {
        workspaceFolders: [{ name: 'test-workspace', uri: { fsPath: '/test/workspace' } }],
        getConfiguration: () => ({
          get: (_k: string, d: any) => d,
          update: async () => {}
        })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
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
  Orchestrator,
  NewConversationTimeoutError
} from '../orchestrator';
import { CompletionResult } from '../transcriptWatcher';
import { DispatchResult } from '../promptDispatcher';
import { AutoPlanConfig, DEFAULT_CONFIG } from '../config';

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
        fileName: 'test-phase.md'
      });
    }
    const convId = `conv-test-${this.waitForNewConversationCalls}`;
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

async function runPhase02Tests() {
  console.log('--- Running Phase 02 Tests: Orchestrator Resilient Auto-Retry Engine ---');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase02-test-'));
  const brainDir = path.join(tempDir, 'brain');
  const planDir = path.join(tempDir, 'plans');
  fs.mkdirSync(brainDir, { recursive: true });
  fs.mkdirSync(planDir, { recursive: true });

  const phase1Path = path.join(planDir, 'phase-01-first.md');
  const phase2Path = path.join(planDir, 'phase-02-second.md');
  fs.writeFileSync(phase1Path, '# Phase 01\nStatus: ⬜ Pending\n');
  fs.writeFileSync(phase2Path, '# Phase 02\nStatus: ⬜ Pending\n');

  try {
    // =========================================================================
    // Test 1: Simulates 1 timeout failure followed by successful conversation detection;
    // verifies retry occurred after 3s delay, status & notification messages, and phase succeeded.
    // =========================================================================
    console.log('Test 1: 1 timeout failure followed by successful conversation detection');
    {
      mockInformationMessageCalls = [];
      mockInformationMessageResponse = undefined;

      const watcher = new MockTranscriptWatcher(brainDir);
      watcher.timeoutFailuresRemaining = 1; // Fails once, then succeeds on retry 1
      const dispatcher = new MockPromptDispatcher();

      const sleepCalls: { ms: number }[] = [];
      const stateLog: { state: string; message?: string }[] = [];

      const orchestrator = new Orchestrator({
        transcriptWatcher: watcher as any,
        promptDispatcher: dispatcher as any,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          autoRetryOnTimeout: true,
          maxAutoRetries: 5,
          retryDelaySeconds: 3,
          delayBetweenLoopsMs: 10
        }),
        onStateChange: (info) => {
          stateLog.push({ state: info.state, message: info.message });
        }
      });

      const origSleep = orchestrator.sleepWithAbort.bind(orchestrator);
      orchestrator.sleepWithAbort = async function (ms: number, abortCheck: () => boolean) {
        sleepCalls.push({ ms });
        // Fast-forward delay in test to complete swiftly
        return origSleep(10, abortCheck);
      };

      const result = await orchestrator.startPhases([phase1Path]);

      assert.strictEqual(result, true, 'Phase sequence must succeed after successful retry');
      assert.strictEqual(dispatcher.dispatchCalls, 2, 'Must dispatch twice (initial attempt + 1 retry)');
      assert.strictEqual(dispatcher.lastDispatchOptions?.openNewConversation, true, 'Retry must set openNewConversation: true');
      assert.strictEqual(sleepCalls.length, 1, 'sleepWithAbort must be called once for the retry');
      assert.strictEqual(sleepCalls[0].ms, 3000, 'sleepWithAbort must wait for configured 3s (3000ms)');

      // Verify countdown notification
      assert.strictEqual(mockInformationMessageCalls.length, 1, 'Exactly one countdown notification must be displayed');
      const notif = mockInformationMessageCalls[0];
      assert.ok(
        notif.message.includes('timeout tạo phiên mới. Đang thử lại sau 3s... (Lần 1/5)'),
        `Notification message must match requirement, got: "${notif.message}"`
      );
      assert.deepStrictEqual(notif.items, ['⏹️ Hủy / Stop'], 'Notification action must provide "⏹️ Hủy / Stop"');

      // Verify status message transition during retry
      const retryState = stateLog.find((s) => s.message && s.message.includes('Retrying Phase 1 (1/5) in 3s...'));
      assert.ok(retryState, 'Orchestrator must transition status message to Retrying Phase 1 (1/5) in 3s...');
      assert.strictEqual(retryState?.state, 'delaying', 'Retry delay state should be delaying');

      const phases = orchestrator.getPhases();
      assert.strictEqual(phases[0].status, 'Completed', 'Phase status must be Completed');
      console.log('✓ Test 1 passed: Successfully retried after 3s delay and phase succeeded.');
    }

    // =========================================================================
    // Test 2: Simulates 5 consecutive timeouts; verifies exactly 5 retry attempts
    // were executed before throwing NewConversationTimeoutError and failing phase.
    // =========================================================================
    console.log('Test 2: 5 consecutive timeouts; verifies exactly 5 retry attempts before failing');
    {
      mockInformationMessageCalls = [];
      mockInformationMessageResponse = undefined;

      const watcher = new MockTranscriptWatcher(brainDir);
      watcher.timeoutFailuresRemaining = 99; // Always timeout
      const dispatcher = new MockPromptDispatcher();

      const sleepCalls: { ms: number }[] = [];
      const orchestrator = new Orchestrator({
        transcriptWatcher: watcher as any,
        promptDispatcher: dispatcher as any,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          autoRetryOnTimeout: true,
          maxAutoRetries: 5,
          retryDelaySeconds: 3,
          delayBetweenLoopsMs: 10
        })
      });

      const origSleep = orchestrator.sleepWithAbort.bind(orchestrator);
      orchestrator.sleepWithAbort = async function (ms: number, abortCheck: () => boolean) {
        sleepCalls.push({ ms });
        return origSleep(10, abortCheck);
      };

      let errorCaught: Error | undefined = undefined;
      orchestrator.on('error', (err) => {
        errorCaught = err;
      });

      const result = await orchestrator.startPhases([phase1Path]);

      assert.strictEqual(result, false, 'Orchestrator must fail when retries are exhausted');
      // Total dispatches = 1 initial + 5 retries = 6 dispatches
      assert.strictEqual(dispatcher.dispatchCalls, 6, 'Must execute exactly 1 initial + 5 retries = 6 dispatches');
      assert.strictEqual(sleepCalls.length, 5, 'sleepWithAbort must be called exactly 5 times');
      assert.strictEqual(mockInformationMessageCalls.length, 5, '5 countdown notifications must be displayed');

      // Verify 5th notification text
      const lastNotif = mockInformationMessageCalls[4];
      assert.ok(
        lastNotif.message.includes('(Lần 5/5)'),
        `5th notification must indicate attempt 5/5, got: "${lastNotif.message}"`
      );

      const phases = orchestrator.getPhases();
      assert.strictEqual(phases[0].status, 'Failed', 'Phase status must be Failed after exhausting retries');
      assert.ok(
        phases[0].error?.includes('Timeout waiting for new conversation'),
        `Phase error must record timeout, got: ${phases[0].error}`
      );
      assert.ok(errorCaught, 'Error event must be emitted on final failure');
      console.log('✓ Test 2 passed: Exactly 5 retries executed before gracefully failing phase.');
    }

    // =========================================================================
    // Test 3: Simulates user clicking '⏹️ Hủy / Stop' during countdown;
    // verifies sequence aborts immediately without proceeding to next retry.
    // =========================================================================
    console.log('Test 3: User clicks "⏹️ Hủy / Stop" during countdown; verifies immediate abort');
    {
      mockInformationMessageCalls = [];
      // Simulate user clicking '⏹️ Hủy / Stop' on notification
      mockInformationMessageResponse = '⏹️ Hủy / Stop';

      const watcher = new MockTranscriptWatcher(brainDir);
      watcher.timeoutFailuresRemaining = 5;
      const dispatcher = new MockPromptDispatcher();

      let stoppedEmitted = false;
      const orchestrator = new Orchestrator({
        transcriptWatcher: watcher as any,
        promptDispatcher: dispatcher as any,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          autoRetryOnTimeout: true,
          maxAutoRetries: 5,
          retryDelaySeconds: 3,
          delayBetweenLoopsMs: 10
        }),
        onStopped: () => {
          stoppedEmitted = true;
        }
      });

      const startTime = Date.now();
      const result = await orchestrator.startPhases([phase1Path]);
      const durationMs = Date.now() - startTime;

      assert.strictEqual(result, false, 'Orchestrator must return false when stopped');
      assert.strictEqual(orchestrator.getState(), 'stopped', 'State must be "stopped"');
      assert.strictEqual(stoppedEmitted, true, 'stopped event must be emitted');
      assert.strictEqual(dispatcher.dispatchCalls, 1, 'Only initial dispatch should have run, no retry dispatch');
      assert.ok(
        durationMs < 1000,
        `Sequence should abort immediately on stop click without waiting full 3s (took ${durationMs}ms)`
      );

      const phases = orchestrator.getPhases();
      assert.strictEqual(phases[0].status, 'Stopped', 'Phase status must be Stopped');
      console.log('✓ Test 3 passed: User abort via "⏹️ Hủy / Stop" stopped sequence immediately.');
    }

    // =========================================================================
    // Test 4: Verifies retry count resets for the next phase in the list.
    // =========================================================================
    console.log('Test 4: Verifies retry count resets for the next phase in the list');
    {
      mockInformationMessageCalls = [];
      mockInformationMessageResponse = undefined;

      const watcher = new MockTranscriptWatcher(brainDir);
      // Phase 1 fails once, then succeeds.
      // Phase 2 fails once, then succeeds.
      // If retry counter didn't reset, Phase 2 would show attempt 2 or higher.
      const dispatcher = new MockPromptDispatcher();

      // Custom waitForNewConversation that fails on call 1 and call 3
      let callCount = 0;
      watcher.waitForNewConversation = async function (
        _startTime: number,
        _lastConvId?: string,
        timeoutMs: number = 8000
      ) {
        callCount++;
        if (callCount === 1 || callCount === 3) {
          throw new NewConversationTimeoutError(`Timeout waiting for new conversation after ${timeoutMs}ms`, {
            timeoutMs,
            fileName: 'test.md'
          });
        }
        const convId = `conv-multi-${callCount}`;
        const logDir = path.join(this.brainDir, convId, '.system_generated', 'logs');
        fs.mkdirSync(logDir, { recursive: true });
        fs.writeFileSync(path.join(logDir, 'transcript.jsonl'), '{"type":"MODEL"}\n');
        return convId;
      };

      const orchestrator = new Orchestrator({
        transcriptWatcher: watcher as any,
        promptDispatcher: dispatcher as any,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          autoRetryOnTimeout: true,
          maxAutoRetries: 5,
          retryDelaySeconds: 3,
          delayBetweenLoopsMs: 10
        })
      });

      const origSleep = orchestrator.sleepWithAbort.bind(orchestrator);
      orchestrator.sleepWithAbort = async function (ms: number, abortCheck: () => boolean) {
        return origSleep(10, abortCheck);
      };

      const result = await orchestrator.startPhases([phase1Path, phase2Path]);

      assert.strictEqual(result, true, 'Both phases must succeed');
      assert.strictEqual(dispatcher.dispatchCalls, 4, '2 phases x 2 dispatches each = 4 total dispatches');
      assert.strictEqual(mockInformationMessageCalls.length, 2, '2 notifications must be shown (1 per phase)');

      // Phase 1 notification
      assert.ok(
        mockInformationMessageCalls[0].message.includes('Phase 1') &&
          mockInformationMessageCalls[0].message.includes('(Lần 1/5)'),
        `Phase 1 notification should be Lần 1/5, got: "${mockInformationMessageCalls[0].message}"`
      );

      // Phase 2 notification must also be (Lần 1/5) because retry count reset
      assert.ok(
        mockInformationMessageCalls[1].message.includes('Phase 2') &&
          mockInformationMessageCalls[1].message.includes('(Lần 1/5)'),
        `Phase 2 notification MUST reset to Lần 1/5, got: "${mockInformationMessageCalls[1].message}"`
      );

      const phases = orchestrator.getPhases();
      assert.strictEqual(phases[0].status, 'Completed', 'Phase 1 must be Completed');
      assert.strictEqual(phases[1].status, 'Completed', 'Phase 2 must be Completed');
      console.log('✓ Test 4 passed: Retry counter successfully reset to 0 for subsequent phase.');
    }

    // =========================================================================
    // Test 5: Verifies sleepWithAbort responsiveness and autoRetryOnTimeout=false
    // =========================================================================
    console.log('Test 5: Verifies autoRetryOnTimeout=false disables retry loop');
    {
      const watcher = new MockTranscriptWatcher(brainDir);
      watcher.timeoutFailuresRemaining = 1;
      const dispatcher = new MockPromptDispatcher();

      const orchestrator = new Orchestrator({
        transcriptWatcher: watcher as any,
        promptDispatcher: dispatcher as any,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          autoRetryOnTimeout: false // Disabled
        })
      });

      const result = await orchestrator.startPhases([phase1Path]);
      assert.strictEqual(result, false, 'Must fail immediately without retries when autoRetryOnTimeout=false');
      assert.strictEqual(dispatcher.dispatchCalls, 1, 'Must only dispatch once when autoRetryOnTimeout=false');
      console.log('✓ Test 5 passed: autoRetryOnTimeout=false skips retry completely.');
    }

    console.log('\nAll Phase 02 tests passed successfully with 100% assertions satisfied!');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase02Tests().catch((err) => {
  console.error('Phase 02 Test Failure:', err);
  process.exit(1);
});
