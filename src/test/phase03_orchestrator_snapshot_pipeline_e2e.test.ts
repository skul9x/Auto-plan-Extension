// Standalone test runner for Phase 03: Orchestrator Snapshot Pipeline & Multi-Window E2E Verification
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceFolders: any[] = [];
let mockConfigValues: Record<string, any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        get workspaceFolders() {
          return mockWorkspaceFolders;
        },
        getConfiguration: (_section: string) => ({
          get: (key: string, defaultValue: any) => {
            if (key in mockConfigValues) {
              return mockConfigValues[key];
            }
            return defaultValue;
          }
        })
      },
      commands: {
        executeCommand: async (_cmd: string, ..._args: any[]) => undefined
      },
      window: {
        showWarningMessage: async (_msg: string) => undefined,
        showInformationMessage: async (_msg: string, ..._items: string[]) => undefined,
        showErrorMessage: async (_msg: string, ..._items: string[]) => undefined
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { EventEmitter } from 'events';
import { Orchestrator, NewConversationTimeoutError } from '../orchestrator';
import { CompletionResult } from '../transcriptWatcher';
import { DispatchResult } from '../promptDispatcher';
import { DEFAULT_CONFIG } from '../config';

class MockTranscriptWatcher extends EventEmitter {
  public brainDir: string;
  public pollIntervalMs: number = 10;
  public waitForNewConversationCalls = 0;
  public watchFileCalls = 0;
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
    _expectNew?: boolean,
    _context?: any,
    _ownershipCriteria?: any
  ): Promise<string> {
    this.waitForNewConversationCalls++;
    if (this.timeoutFailuresRemaining > 0) {
      this.timeoutFailuresRemaining--;
      throw new NewConversationTimeoutError(`Timeout waiting for new conversation after ${timeoutMs}ms`, {
        timeoutMs,
        fileName: 'phase-test.md'
      });
    }
    const convId = `conv-snapshot-e2e-${this.waitForNewConversationCalls}`;
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

class MockBridgeServer {
  public captureCalls = 0;
  public captureTimestamps: number[] = [];
  public htmlPayload = '<!DOCTYPE html><html><head><title>VS Code Workbench</title></head><body><div class="monaco-workbench">Live Test Workbench DOM</div></body></html>';

  async captureDomSnapshot(_timeoutMs?: number) {
    this.captureCalls++;
    this.captureTimestamps.push(Date.now());
    return {
      success: true,
      html: this.htmlPayload
    };
  }
}

async function runPhase03Tests() {
  console.log('=================================================================');
  console.log('Phase 03 Verification: Orchestrator Snapshot Pipeline & Multi-Window E2E');
  console.log('=================================================================\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-test-'));
  const brainDir = path.join(tempDir, 'brain');
  const planDir = path.join(tempDir, 'plans');
  fs.mkdirSync(brainDir, { recursive: true });
  fs.mkdirSync(planDir, { recursive: true });

  const phase1Path = path.join(planDir, 'phase-01-pipeline.md');
  fs.writeFileSync(phase1Path, '# Phase 01: Test Pipeline\nStatus: ⬜ Pending\n');

  const createdSnapshotDirs: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // Scenario A: Normal Run (Initial Snapshot Generation)
    // -------------------------------------------------------------------------
    console.log('▶ Scenario A: Normal Execution - Initial attempt_1 snapshot generated in project global folder...');
    {
      const wsNameA = 'Project_Snapshot_A';
      const expectedDirA = path.join(os.homedir(), '.autoplan', 'snapshots', wsNameA);
      createdSnapshotDirs.push(expectedDirA);
      if (fs.existsSync(expectedDirA)) {
        fs.rmSync(expectedDirA, { recursive: true, force: true });
      }

      const watcher = new MockTranscriptWatcher(brainDir);
      watcher.timeoutFailuresRemaining = 0;
      const dispatcher = new MockPromptDispatcher();
      const bridgeServer = new MockBridgeServer();

      const orchestrator = new Orchestrator({
        transcriptWatcher: watcher as any,
        promptDispatcher: dispatcher as any,
        bridgeServer: bridgeServer as any,
        workspaceName: wsNameA,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: ''
        })
      });

      const success = await orchestrator.startPhases([phase1Path]);
      assert.strictEqual(success, true, 'Phase execution should succeed');
      assert.strictEqual(dispatcher.dispatchCalls, 1, 'Should dispatch prompt once');
      assert.strictEqual(bridgeServer.captureCalls, 1, 'BridgeServer.captureDomSnapshot should be called once');

      // Verify file existence in expected directory
      assert.ok(fs.existsSync(expectedDirA), `Target directory ${expectedDirA} must exist`);
      const files = fs.readdirSync(expectedDirA);
      assert.strictEqual(files.length, 1, 'Exactly one snapshot should be saved');

      const snapshotFile = files[0];
      const initialRegex = /^snapshot_phase_01_initial_attempt_1_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.html$/;
      assert.ok(
        initialRegex.test(snapshotFile),
        `Snapshot filename "${snapshotFile}" must match format snapshot_phase_01_initial_attempt_1_<timestamp>.html`
      );

      const content = fs.readFileSync(path.join(expectedDirA, snapshotFile), 'utf8');
      assert.strictEqual(content, bridgeServer.htmlPayload, 'Snapshot content must match captured HTML byte-for-byte');
      console.log(`  ✓ Successfully generated initial snapshot: ${snapshotFile}`);
    }

    // -------------------------------------------------------------------------
    // Scenario B: Retry on Timeout (Retry Snapshot Generation & Sequence)
    // -------------------------------------------------------------------------
    console.log('\n▶ Scenario B: Retry on Timeout - Retry attempt_1 snapshot generated before countdown & retry succeeds...');
    {
      const wsNameB = 'Project_Snapshot_B';
      const expectedDirB = path.join(os.homedir(), '.autoplan', 'snapshots', wsNameB);
      createdSnapshotDirs.push(expectedDirB);
      if (fs.existsSync(expectedDirB)) {
        fs.rmSync(expectedDirB, { recursive: true, force: true });
      }

      const watcher = new MockTranscriptWatcher(brainDir);
      watcher.timeoutFailuresRemaining = 1; // Fails once, then succeeds on retry
      const dispatcher = new MockPromptDispatcher();
      const bridgeServer = new MockBridgeServer();

      const timeline: string[] = [];
      const origCapture = bridgeServer.captureDomSnapshot.bind(bridgeServer);
      bridgeServer.captureDomSnapshot = async (timeoutMs?: number) => {
        timeline.push(`snapshot_capture_${bridgeServer.captureCalls + 1}`);
        return origCapture(timeoutMs);
      };

      const orchestrator = new Orchestrator({
        transcriptWatcher: watcher as any,
        promptDispatcher: dispatcher as any,
        bridgeServer: bridgeServer as any,
        workspaceName: wsNameB,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: '',
          autoRetryOnTimeout: true,
          maxAutoRetries: 3,
          retryDelaySeconds: 2
        })
      });

      const origSleep = orchestrator.sleepWithAbort.bind(orchestrator);
      orchestrator.sleepWithAbort = async function (ms: number, abortCheck: () => boolean) {
        timeline.push('countdown_sleep_start');
        return origSleep(10, abortCheck);
      };

      const success = await orchestrator.startPhases([phase1Path]);
      assert.strictEqual(success, true, 'Execution should succeed after retry');
      assert.strictEqual(dispatcher.dispatchCalls, 2, 'Should dispatch twice (initial + 1 retry)');
      assert.strictEqual(bridgeServer.captureCalls, 2, 'BridgeServer should capture 2 snapshots (initial + retry)');

      // Verify timeline: initial snapshot -> sleep -> retry snapshot?
      // Wait, initial snapshot happens BEFORE first dispatch
      // Then timeout occurs -> retry snapshot happens BEFORE countdown sleep!
      // Timeline order: snapshot_capture_1 -> snapshot_capture_2 -> countdown_sleep_start
      assert.strictEqual(
        timeline[0],
        'snapshot_capture_1',
        'First event must be initial snapshot capture before prompt dispatch'
      );
      assert.strictEqual(
        timeline[1],
        'snapshot_capture_2',
        'Second snapshot (retry) must occur immediately upon timeout before countdown delay'
      );
      assert.strictEqual(
        timeline[2],
        'countdown_sleep_start',
        'Countdown sleep must start after retry snapshot has been saved'
      );

      const files = fs.readdirSync(expectedDirB);
      assert.strictEqual(files.length, 2, 'Exactly two snapshots should be saved in Project B');

      const initialFile = files.find(f => f.includes('_initial_attempt_1_'));
      const retryFile = files.find(f => f.includes('_retry_attempt_1_'));

      assert.ok(initialFile, 'Initial attempt 1 snapshot must exist');
      assert.ok(retryFile, 'Retry attempt 1 snapshot must exist');

      const retryRegex = /^snapshot_phase_01_retry_attempt_1_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.html$/;
      assert.ok(
        retryRegex.test(retryFile!),
        `Retry filename "${retryFile}" must match format snapshot_phase_01_retry_attempt_1_<timestamp>.html`
      );

      console.log(`  ✓ Successfully generated retry snapshot: ${retryFile}`);
      console.log(`  ✓ Verified sequence: retry snapshot saved BEFORE countdown sleep started.`);
    }

    // -------------------------------------------------------------------------
    // Scenario C: Multi-Window Workspace Isolation
    // -------------------------------------------------------------------------
    console.log('\n▶ Scenario C: Multi-Window Isolation - Distinct folders and zero cross-contamination...');
    {
      const wsNameC = 'Project_Snapshot_C_MultiWindow';
      const expectedDirC = path.join(os.homedir(), '.autoplan', 'snapshots', wsNameC);
      createdSnapshotDirs.push(expectedDirC);
      if (fs.existsSync(expectedDirC)) {
        fs.rmSync(expectedDirC, { recursive: true, force: true });
      }

      const watcher = new MockTranscriptWatcher(brainDir);
      const dispatcher = new MockPromptDispatcher();
      const bridgeServer = new MockBridgeServer();

      const orchestrator = new Orchestrator({
        transcriptWatcher: watcher as any,
        promptDispatcher: dispatcher as any,
        bridgeServer: bridgeServer as any,
        workspaceName: wsNameC,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: ''
        })
      });

      await orchestrator.startPhases([phase1Path]);

      const dirA = path.join(os.homedir(), '.autoplan', 'snapshots', 'Project_Snapshot_A');
      const dirB = path.join(os.homedir(), '.autoplan', 'snapshots', 'Project_Snapshot_B');

      assert.ok(fs.existsSync(expectedDirC), 'Project C directory must exist');
      assert.ok(fs.existsSync(dirA), 'Project A directory must still exist');
      assert.ok(fs.existsSync(dirB), 'Project B directory must still exist');

      const filesA = fs.readdirSync(dirA);
      const filesB = fs.readdirSync(dirB);
      const filesC = fs.readdirSync(expectedDirC);

      assert.strictEqual(filesA.length, 1, 'Project A must still have exactly 1 file');
      assert.strictEqual(filesB.length, 2, 'Project B must still have exactly 2 files');
      assert.strictEqual(filesC.length, 1, 'Project C must have exactly 1 file');

      console.log('  ✓ Verified: Separate folders for Project_A (1), Project_B (2), and Project_C (1)');
      console.log('  ✓ No cross-contamination across different workspace contexts.');
    }

    // -------------------------------------------------------------------------
    // Scenario D: Disable Flag (enableDomSnapshots: false)
    // -------------------------------------------------------------------------
    console.log('\n▶ Scenario D: Disabling enableDomSnapshots prevents any file creation...');
    {
      const wsNameDisabled = 'Project_Snapshot_Disabled';
      const expectedDirDisabled = path.join(os.homedir(), '.autoplan', 'snapshots', wsNameDisabled);
      createdSnapshotDirs.push(expectedDirDisabled);
      if (fs.existsSync(expectedDirDisabled)) {
        fs.rmSync(expectedDirDisabled, { recursive: true, force: true });
      }

      const watcher = new MockTranscriptWatcher(brainDir);
      const dispatcher = new MockPromptDispatcher();
      const bridgeServer = new MockBridgeServer();

      const orchestrator = new Orchestrator({
        transcriptWatcher: watcher as any,
        promptDispatcher: dispatcher as any,
        bridgeServer: bridgeServer as any,
        workspaceName: wsNameDisabled,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: false
        })
      });

      const success = await orchestrator.startPhases([phase1Path]);
      assert.strictEqual(success, true, 'Execution should succeed even when snapshots disabled');
      assert.strictEqual(dispatcher.dispatchCalls, 1, 'Prompt dispatch should proceed normally');
      assert.strictEqual(bridgeServer.captureCalls, 0, 'BridgeServer must NOT be called when enableDomSnapshots is false');
      assert.strictEqual(fs.existsSync(expectedDirDisabled), false, 'Snapshot directory must NOT be created');

      console.log('  ✓ Verified: Zero snapshots generated when enableDomSnapshots: false');
    }

    // -------------------------------------------------------------------------
    // Scenario E: Abort / Stop Responsiveness
    // -------------------------------------------------------------------------
    console.log('\n▶ Scenario E: Abort / Stop Responsiveness...');
    {
      const bridgeServer = new MockBridgeServer();
      const orchestrator = new Orchestrator({
        bridgeServer: bridgeServer as any,
        workspaceName: 'Project_Abort_Test',
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true
        })
      });

      orchestrator.stop();
      const snapshotResult = await orchestrator.saveWorkbenchSnapshot({
        phaseIndex: 0,
        phaseName: 'phase-01',
        attempt: 1,
        triggerType: 'initial'
      });

      assert.strictEqual(snapshotResult, undefined, 'saveWorkbenchSnapshot must immediately return undefined when aborted');
      assert.strictEqual(bridgeServer.captureCalls, 0, 'Must not attempt capture when aborted');
      console.log('  ✓ Verified: saveWorkbenchSnapshot respects isAborted cleanly.');
    }

  } finally {
    // Cleanup generated directories
    for (const dir of createdSnapshotDirs) {
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }
    // Cleanup temp files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  console.log('\n=================================================================');
  console.log('✔ ALL PHASE 03 PIPELINE E2E TESTS PASSED SUCCESSFULLY');
  console.log('=================================================================');
}

runPhase03Tests().catch((err) => {
  console.error('\n✖ PHASE 03 PIPELINE E2E TEST FAILED:', err);
  process.exit(1);
});
