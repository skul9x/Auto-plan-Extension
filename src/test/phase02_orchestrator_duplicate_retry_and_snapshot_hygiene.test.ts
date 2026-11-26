// Standalone test runner with mock for 'vscode' module
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      commands: {
        executeCommand: async () => undefined
      },
      window: {
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showInformationMessage: async () => undefined,
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
        workspaceFolders: [
          {
            name: 'VietDuc-HIS',
            uri: { fsPath: '/home/skul9x/Desktop/Code/VietDuc-HIS' }
          }
        ],
        name: 'VietDuc-HIS',
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
  extractPromptFingerprints
} from '../orchestrator';
import {
  CompletionResult,
  ConversationOwnershipCriteria,
  NewConversationTimeoutError,
  clearConversationOwnershipCache
} from '../transcriptWatcher';
import { DispatchResult } from '../promptDispatcher';
import { AutoPlanConfig, DEFAULT_CONFIG } from '../config';
import { DebugLogger } from '../debugLogger';

function createTempDir(prefix: string): string {
  const dir = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

class MockTranscriptWatcher extends EventEmitter {
  public brainDir: string;
  public pollIntervalMs: number = 10;
  public lastOwnershipCriteria?: ConversationOwnershipCriteria;
  public waitForNewConversationCalls = 0;
  public watchFileCalls = 0;
  public onTimeoutHook?: () => void;
  public shouldTimeoutOnce = false;

  constructor(brainDir: string) {
    super();
    this.brainDir = brainDir;
  }

  getOptions() {
    return { brainDir: this.brainDir, pollIntervalMs: this.pollIntervalMs };
  }

  setOptions(opts: any) {
    if (opts?.ownershipCriteria) {
      this.lastOwnershipCriteria = opts.ownershipCriteria;
    }
  }

  async waitForNewConversation(
    _phaseStartTime: number,
    _lastConvId?: string,
    _timeoutMs?: number,
    _pollIntervalMs?: number,
    ownershipCriteria?: ConversationOwnershipCriteria
  ): Promise<string> {
    this.waitForNewConversationCalls++;
    if (ownershipCriteria) {
      this.lastOwnershipCriteria = ownershipCriteria;
    }
    if (this.shouldTimeoutOnce) {
      this.shouldTimeoutOnce = false;
      if (this.onTimeoutHook) {
        this.onTimeoutHook();
      }
      throw new NewConversationTimeoutError('Simulated timeout at 8000ms boundary');
    }
    return 'conv_direct_fallback';
  }

  async watchFile(
    _filePath: string,
    convId: string
  ): Promise<CompletionResult> {
    this.watchFileCalls++;
    return {
      success: true,
      conversationId: convId,
      matchedContent: 'Done skul9x.'
    };
  }

  async watchLatest(): Promise<CompletionResult> {
    return {
      success: true,
      conversationId: 'latest_conv',
      matchedContent: 'Done skul9x.'
    };
  }

  stop() {}
}

async function runTests(): Promise<void> {
  console.log('=== Running Phase 02: Orchestrator Duplicate Retry & Snapshot Hygiene Tests ===\n');

  // ==========================================================================
  // Scenario 1: Fingerprint Extraction Helper
  // ==========================================================================
  console.log('[Test 1] Testing extractPromptFingerprints on short, multiline, and 6,356-char JSON prompts...');
  {
    const emptyRes = extractPromptFingerprints('');
    assert.deepStrictEqual(emptyRes, {}, 'Empty prompt should return empty fingerprints');

    const shortRes = extractPromptFingerprints('Short prompt under 48 chars');
    assert.deepStrictEqual(shortRes, {}, 'Prompt < 48 chars should return empty fingerprints');

    const multilinePrompt = 'Line 1: Execute phase\r\nLine 2: Inspect codebase carefully\r\nLine 3: Verify tests and report Done skul9x.';
    const multiRes = extractPromptFingerprints(multilinePrompt);
    assert.ok(multiRes.head && multiRes.head.length >= 24, 'Multiline head should be >= 24 chars');
    assert.ok(multiRes.tail && multiRes.tail.length >= 24, 'Multiline tail should be >= 24 chars');
    assert.ok(!multiRes.head!.includes('\r'), 'CRLF should be normalized to LF in head');

    // Build a 6,356-char JSON prompt matching the diagnostic report structure
    const phasePath = '/home/skul9x/Desktop/Code/VietDuc-HIS/plans/261125-1920-cleartext-network-guard/phase-03-webview-pacs-url-guard-and-diagnostics.md';
    const jsonTemplate = JSON.stringify({
      steps: [
        { id: 0, name: 'Project Recap', instructions: 'A'.repeat(2000) },
        { id: 1, name: 'Initial Codebase Analysis', instructions: 'B'.repeat(2000) },
        { id: 2, name: 'Online Research', instructions: 'C'.repeat(1700) }
      ],
      phase_file: phasePath,
      completion_response: 'Done skul9x.'
    }, null, 2);
    assert.ok(jsonTemplate.length >= 6000, `Expected large JSON prompt >= 6000 chars, got ${jsonTemplate.length}`);

    const jsonFp = extractPromptFingerprints(jsonTemplate);
    assert.ok(jsonFp.head && jsonFp.head.length >= 24 && jsonFp.head.length <= 120, 'JSON head length in [24, 120]');
    assert.ok(jsonFp.tail && jsonFp.tail.length >= 24 && jsonFp.tail.length <= 120, 'JSON tail length in [24, 120]');

    // Verify head and tail match decoded step_index: 0 content
    const step0 = {
      step_index: 0,
      truncated_fields: ['content'],
      content: `<USER_REQUEST>\n${jsonTemplate}\n</USER_REQUEST>`
    };
    const decoded = JSON.parse(JSON.stringify(step0)).content as string;
    assert.ok(decoded.includes(jsonFp.head!), 'Decoded step_index: 0 content must include extracted head');
    assert.ok(decoded.includes(jsonFp.tail!), 'Decoded step_index: 0 content must include extracted tail');
    console.log('✓ Test 1 passed.');
  }

  // ==========================================================================
  // Scenario 2: Pre-Retry Recovery Prevents Duplicate Dispatch
  // ==========================================================================
  console.log('\n[Test 2] Testing pre-retry recovery prevents duplicate prompt dispatch...');
  clearConversationOwnershipCache();
  const brainDir = createTempDir('agy_p2_brain');
  const planDir = createTempDir('agy_p2_plan');
  const snapshotDir = createTempDir('agy_p2_snaps');
  try {
    const phaseFileName = 'phase-03-webview-pacs-url-guard-and-diagnostics.md';
    const phaseFilePath = path.join(planDir, phaseFileName);
    fs.writeFileSync(phaseFilePath, '# Phase 03\nTest content\n', 'utf8');

    const convId = '83fd8d56-4b8a-4984-9eca-9e8cf58401c9';
    const convLogDir = path.join(brainDir, convId, '.system_generated', 'logs');
    fs.mkdirSync(convLogDir, { recursive: true });
    const transcriptPath = path.join(convLogDir, 'transcript.jsonl');
    const fullTranscriptPath = path.join(convLogDir, 'transcript_full.jsonl');

    const longTemplate =
      '{\n  "steps": [\n    {\n      "id": 0,\n      "name": "Project Recap",\n      "instructions": "' +
      'x'.repeat(2500) +
      '"\n    }\n  ],\n  "phase_file": "{xxx}",\n  "completion_response": "Done skul9x."\n}';

    const watcher = new MockTranscriptWatcher(brainDir);
    watcher.shouldTimeoutOnce = true;

    let dispatchCount = 0;
    const mockDispatcher: any = {
      validateDispatchReadiness: () => ({
        ready: true,
        selectedTier: 'nativeCommand',
        isFocusFree: true,
        requiresForegroundFocus: false,
        engine: 'Native Antigravity Dispatch',
        details: { connectedClientsCount: 0, os: process.platform }
      }),
      ensureBridgeReadinessWithWakeup: async () => ({
        ready: true,
        selectedTier: 'nativeCommand',
        isFocusFree: true,
        requiresForegroundFocus: false,
        engine: 'Native Antigravity Dispatch',
        details: { connectedClientsCount: 0, os: process.platform }
      }),
      dispatchPrompt: async (_prompt: string): Promise<DispatchResult> => {
        dispatchCount++;
        await new Promise((r) => setTimeout(r, 15));
        // Initially write truncated transcript.jsonl WITHOUT transcript_full.jsonl
        const compactStep0 = {
          step_index: 0,
          source: 'USER_EXPLICIT',
          type: 'USER_INPUT',
          status: 'DONE',
          truncated_fields: ['content'],
          content:
            `<USER_REQUEST>\n{\n  "steps": [\n    {\n      "id": 0,\n... [truncated] ...\n"completion_response": "Done skul9x."\n}\n</USER_REQUEST>\n` +
            `<user_information>\nActive Workspaces:\n- /home/skul9x/Desktop/Code/VietDuc-HIS\n</user_information>`
        };
        fs.writeFileSync(transcriptPath, JSON.stringify(compactStep0) + '\n', 'utf8');
        return { success: true, tier: 'nativeCommand', durationMs: 12 };
      },
      getBridgeServer: () => undefined
    };

    // Simulate sibling transcript_full.jsonl flushing right as waitForNewConversation times out
    watcher.onTimeoutHook = () => {
      watcher.emit('candidateSkipped', { convId, criteria: watcher.lastOwnershipCriteria });
      const fullStep0 = {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        content:
          `<USER_REQUEST>\n${longTemplate.replace('{xxx}', phaseFilePath)}\n</USER_REQUEST>\n` +
          `<user_information>\nActive Workspaces:\n- /home/skul9x/Desktop/Code/VietDuc-HIS\n</user_information>`
      };
      fs.writeFileSync(fullTranscriptPath, JSON.stringify(fullStep0) + '\n', 'utf8');
    };

    const testConfig: AutoPlanConfig = {
      ...DEFAULT_CONFIG,
      executionMode: 'nativeCommand',
      allowTierFallback: false,
      promptTemplate: longTemplate,
      autoRetryOnTimeout: true,
      maxAutoRetries: 3,
      retryDelaySeconds: 1,
      newConversationTimeoutMs: 3000,
      delayBetweenLoopsMs: 10,
      enableDomSnapshots: false
    };

    const logger = new DebugLogger();
    const orchestrator = new Orchestrator({
      configProvider: () => testConfig,
      transcriptWatcher: watcher as any,
      promptDispatcher: mockDispatcher,
      debugLogger: logger,
      workspacePath: '/home/skul9x/Desktop/Code/VietDuc-HIS',
      workspaceName: 'VietDuc-HIS',
      workspaceFolders: ['VietDuc-HIS']
    });

    const ok = await orchestrator.startPhases([phaseFilePath]);
    assert.strictEqual(ok, true, 'Orchestrator should complete phase via pre-retry recovery');
    assert.strictEqual(dispatchCount, 1, 'promptDispatcher.dispatchPrompt must be called ONLY ONCE (no duplicate retry dispatch)');
    assert.strictEqual(watcher.watchFileCalls, 1, 'Recovered conversation must be watched to completion');
    assert.ok(watcher.lastOwnershipCriteria?.expectedPromptHead, 'Orchestrator must populate expectedPromptHead');
    assert.ok(watcher.lastOwnershipCriteria?.expectedPromptTail, 'Orchestrator must populate expectedPromptTail');

    const recoveryLogs = logger.getEntries().filter(
      (l) => l.level === 'INFO' && l.message.includes('Recovered conversation') && l.message.includes('avoided duplicate dispatch')
    );
    assert.strictEqual(recoveryLogs.length, 1, 'Should log pre-retry conversation recovery');
    console.log('✓ Test 2 passed.');
  } finally {
    cleanupDir(brainDir);
    cleanupDir(planDir);
    cleanupDir(snapshotDir);
  }

  // ==========================================================================
  // Scenario 3: Native-Tier DOM Snapshot Warning Suppression
  // ==========================================================================
  console.log('\n[Test 3] Testing Native-tier DOM snapshot warning suppression & active client preservation...');
  const snapTmpDir = createTempDir('agy_p2_snap_hygiene');
  try {
    // 3a. Native mode with 0 connected clients -> 0 WARN logs, returns undefined
    const loggerNative = new DebugLogger();
    let captureCalledWhenZero = false;
    const mockBridgeZero: any = {
      getConnectedClients: () => [],
      captureDomSnapshot: async () => {
        captureCalledWhenZero = true;
        return { success: false, error: 'No active connected DOM bridge clients found' };
      }
    };
    const mockDispatcherNative: any = {
      validateDispatchReadiness: () => ({
        ready: true,
        selectedTier: 'nativeCommand',
        isFocusFree: true,
        requiresForegroundFocus: false,
        engine: 'Native Antigravity Dispatch',
        details: { connectedClientsCount: 0, os: process.platform }
      }),
      getBridgeServer: () => mockBridgeZero
    };
    const orchNative = new Orchestrator({
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        executionMode: 'nativeCommand',
        allowTierFallback: false,
        enableDomSnapshots: true,
        domSnapshotFolder: snapTmpDir
      }),
      promptDispatcher: mockDispatcherNative,
      bridgeServer: mockBridgeZero,
      debugLogger: loggerNative,
      workspaceName: 'VietDuc-HIS'
    });

    const resZero = await orchNative.saveWorkbenchSnapshot({
      phaseIndex: 0,
      phaseName: 'phase-01.md',
      attempt: 1,
      triggerType: 'initial'
    });
    assert.strictEqual(resZero, undefined, 'Native mode with 0 clients should skip snapshot and return undefined');
    assert.strictEqual(captureCalledWhenZero, false, 'Should not invoke captureDomSnapshot when 0 clients in Native mode');

    const warnLogsZero = loggerNative.getEntries().filter(
      (l) => l.level === 'WARN' && l.message.includes('Failed to capture DOM snapshot')
    );
    assert.strictEqual(warnLogsZero.length, 0, 'Must emit ZERO [WARN] Failed to capture DOM snapshot in Native mode');

    const debugLogsZero = loggerNative.getEntries().filter(
      (l) => l.level === 'DEBUG' && l.message.includes('Skipping DOM snapshot')
    );
    assert.strictEqual(debugLogsZero.length, 1, 'Should emit concise DEBUG entry when skipping DOM snapshot in Native mode');

    // 3b. Connected DOM bridge clients > 0 -> captures and saves snapshot normally
    const loggerConnected = new DebugLogger();
    let captureCalledWhenConnected = false;
    const mockBridgeConnected: any = {
      getConnectedClients: () => [{ clientId: 'win-1' }],
      captureDomSnapshot: async () => {
        captureCalledWhenConnected = true;
        return { success: true, html: '<html><body>Workbench</body></html>' };
      }
    };
    const orchConnected = new Orchestrator({
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        executionMode: 'auto',
        allowTierFallback: true,
        enableDomSnapshots: true,
        domSnapshotFolder: snapTmpDir
      }),
      promptDispatcher: mockDispatcherNative,
      bridgeServer: mockBridgeConnected,
      debugLogger: loggerConnected,
      workspaceName: 'VietDuc-HIS'
    });

    const savedPath = await orchConnected.saveWorkbenchSnapshot({
      phaseIndex: 0,
      phaseName: 'phase-01.md',
      attempt: 1,
      triggerType: 'initial'
    });
    assert.strictEqual(captureCalledWhenConnected, true, 'Must call captureDomSnapshot when connectedClientsCount > 0');
    assert.ok(savedPath && fs.existsSync(savedPath), 'Snapshot file must be written when DOM bridge client is connected');

    // 3c. Explicit domBridge mode with 0 clients -> still warns as expected
    const loggerDomBridge = new DebugLogger();
    const orchDomBridge = new Orchestrator({
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        executionMode: 'domBridge',
        allowTierFallback: false,
        enableDomSnapshots: true,
        domSnapshotFolder: snapTmpDir
      }),
      promptDispatcher: mockDispatcherNative,
      bridgeServer: mockBridgeZero,
      debugLogger: loggerDomBridge,
      workspaceName: 'VietDuc-HIS'
    });

    await orchDomBridge.saveWorkbenchSnapshot({
      phaseIndex: 0,
      phaseName: 'phase-01.md',
      attempt: 1,
      triggerType: 'initial'
    });
    const warnLogsDomBridge = loggerDomBridge.getEntries().filter(
      (l) => l.level === 'WARN' && l.message.includes('Failed to capture DOM snapshot')
    );
    assert.strictEqual(warnLogsDomBridge.length, 1, 'Explicit domBridge mode with 0 clients should still warn');
    console.log('✓ Test 3 passed.');
  } finally {
    cleanupDir(snapTmpDir);
  }

  console.log('\n🎉 All Phase 02 Orchestrator Duplicate Retry & Snapshot Hygiene tests PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
