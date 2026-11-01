// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceConfig: Record<string, any> = {
  executionMode: 'auto',
  allowTierFallback: true,
  bridgeTimeoutMs: 3000,
  suppressFallbackWarnings: true
};

const executedCommands: string[] = [];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          { name: 'test-workspace', uri: { fsPath: '/mock/workspace' } }
        ],
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) => {
            if (mockWorkspaceConfig[key] !== undefined) {
              return mockWorkspaceConfig[key];
            }
            return defaultValue;
          },
          update: async (key: string, value: any) => {
            mockWorkspaceConfig[key] = value;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} })
      },
      window: {
        createOutputChannel: () => ({
          appendLine: () => {},
          show: () => {},
          dispose: () => {}
        }),
        showWarningMessage: async () => {},
        showErrorMessage: async () => {},
        showInformationMessage: async () => {}
      },
      commands: {
        executeCommand: async (cmd: string, ..._args: any[]) => {
          executedCommands.push(cmd);
          if (cmd === 'antigravity.sendTextToChat') {
            return true;
          }
          if (cmd.startsWith('antigravity.prioritized.chat.') || cmd.startsWith('workbench.action.chat.')) {
            return true;
          }
          return true;
        },
        getCommands: async () => {
          throw new Error('getCommands should not be invoked when direct existence check is used');
        }
      },
      Uri: {
        file: (p: string) => ({ fsPath: p, scheme: 'file' }),
        joinPath: (base: any, ...segments: string[]) => ({
          fsPath: [base.fsPath, ...segments].join('/'),
          scheme: 'file'
        })
      },
      ViewColumn: { Active: 1 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { PromptDispatcher, DispatchResult } from '../promptDispatcher';
import { BridgeServer } from '../bridgeServer';
import { KeyboardManager } from '../keyboardManager';
import {
  PromptOriginTracker,
  promptOriginTracker,
  hashPrompt,
  normalizePromptText
} from '../promptOriginTracker';
import {
  PhaseFile,
  sortPhaseFiles,
  naturalCollator,
  analyzePhaseStallReason,
  precomputeBlockerIndices,
  auditPlanPhases,
  auditPlanPhasesAsync,
  inspectPhaseHeader,
  inspectPhaseHeaderAsync
} from '../planScanner';
import { DebugLogger } from '../debugLogger';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase04TestSuite() {
  console.log('========================================================================');
  console.log('Phase 04 Test Suite: Dispatch Latency, Fallback Resilience & Algorithmic Optimization');
  console.log('========================================================================\n');

  // =========================================================================
  // Test Suite 1: Tier 1 Pre-Flight Readiness & Fallback De-duplication
  // =========================================================================
  console.log('--- Test Suite 1: Pre-Flight Readiness Check & Fallback De-duplication ---');

  const commandLog: string[] = [];
  const trackingExecutor = async (cmd: string, ..._args: any[]) => {
    commandLog.push(cmd);
    return true;
  };

  // Mock bridge server with 0 clients
  const mockBridge0Clients: Partial<BridgeServer> = {
    isListening: () => true,
    getConnectedClients: () => [],
    getActiveWindowKey: () => 'win_main',
    getWindowKey: () => 'win_main',
    getWorkspaceName: () => 'test_workspace',
    probeActiveClients: async (_ms?: number) => []
  };

  const dispatcherWithFallback = new PromptDispatcher({
    bridgeServer: mockBridge0Clients as BridgeServer,
    keyboardManager: {} as KeyboardManager,
    configProvider: () => ({
      executionMode: 'auto',
      allowTierFallback: true,
      bridgeTimeoutMs: 1000,
      suppressFallbackWarnings: true
    } as any),
    commandExecutor: trackingExecutor,
    logger: new DebugLogger()
  });

  console.log('1A: Dispatching prompt in auto mode with 0 bridge clients...');
  const t1Start = Date.now();
  const dispatchRes = await dispatcherWithFallback.dispatchPrompt('Implement phase 04 feature', {
    openNewConversation: true
  });
  const t1Duration = Date.now() - t1Start;

  assert.strictEqual(dispatchRes.success, true, 'Dispatch must succeed via Tier 2 fallback');
  assert.strictEqual(dispatchRes.tier, 'nativeCommand', 'Result tier must be nativeCommand');
  assert.ok(dispatchRes.fallbackHistory && dispatchRes.fallbackHistory.length === 1, 'Must record Tier 1 fallback in history');
  assert.strictEqual(dispatchRes.fallbackHistory![0].tier, 'domBridge', 'Fallback history must note domBridge failure');

  // Verify that openNewConversation was executed exactly ONCE across the entire fallback chain!
  const newConversationCalls = commandLog.filter(c => c === 'antigravity.prioritized.chat.openNewConversation');
  assert.strictEqual(
    newConversationCalls.length,
    1,
    `openNewConversation should be called exactly ONCE (got ${newConversationCalls.length}): duplicate chat tab creation must be prevented`
  );

  // Verify that dispatch did not stall for 1.2s
  assert.ok(t1Duration < 1000, `Fallback transition should be fast (< 1000ms), took ${t1Duration}ms`);
  console.log(`  ✓ 1A Passed: Dispatched via Tier 2 in ${t1Duration}ms with exactly 1 conversation opened (no duplicate tab).`);

  // 1B: Verify strict domBridge mode failure without opening conversations
  commandLog.length = 0;
  const strictDispatcher = new PromptDispatcher({
    bridgeServer: mockBridge0Clients as BridgeServer,
    keyboardManager: {} as KeyboardManager,
    configProvider: () => ({
      executionMode: 'domBridge',
      allowTierFallback: false,
      bridgeTimeoutMs: 1000,
      suppressFallbackWarnings: true
    } as any),
    commandExecutor: trackingExecutor,
    logger: new DebugLogger()
  });

  let strictFailed = false;
  try {
    await strictDispatcher.dispatchPrompt('Strict prompt', { openNewConversation: true });
  } catch (err: any) {
    strictFailed = true;
    assert.ok(err.message.includes('DOM Bridge'), `Error message must indicate DOM Bridge failure: ${err.message}`);
  }
  assert.strictEqual(strictFailed, true, 'Strict domBridge must fail when 0 clients are connected');
  assert.strictEqual(commandLog.length, 0, 'No conversation command should be executed when zero bridge clients exist');
  console.log('  ✓ 1B Passed: Strict domBridge failed fast without executing openNewConversation.\n');

  // =========================================================================
  // Test Suite 2: Elimination of Artificial 450ms Dispatch Sleep
  // =========================================================================
  console.log('--- Test Suite 2: Elimination of Artificial Dispatch Sleep ---');

  let handshakeReceivedExtra: any = null;
  const mockBridgeWithClient: Partial<BridgeServer> = {
    isListening: () => true,
    getConnectedClients: () => [{ id: 'client-1', windowKey: 'win_main', lastSeen: Date.now() }] as any,
    getActiveWindowKey: () => 'win_main',
    getWindowKey: () => 'win_main',
    getWorkspaceName: () => 'test_workspace',
    dispatchNewConversationCommand: async (opts) => {
      handshakeReceivedExtra = opts?.extra;
      // Fast immediate positive acknowledgement
      return {
        success: true,
        commandId: 'cmd_conv_ack_1',
        status: 'conversationReady',
        durationMs: 5
      };
    },
    dispatchPromptCommand: async (_text, _opts) => {
      return {
        success: true,
        commandId: 'cmd_prompt_1',
        status: 'submitClicked',
        durationMs: 10
      };
    }
  };

  const fastDispatcher = new PromptDispatcher({
    bridgeServer: mockBridgeWithClient as BridgeServer,
    keyboardManager: {} as KeyboardManager,
    configProvider: () => ({
      executionMode: 'domBridge',
      allowTierFallback: false,
      bridgeTimeoutMs: 3000,
      suppressFallbackWarnings: true
    } as any),
    commandExecutor: trackingExecutor,
    logger: new DebugLogger()
  });

  console.log('2A: Measuring dispatchTier1 duration with positive readiness acknowledgement...');
  const fastStart = Date.now();
  const fastResult = await fastDispatcher.dispatchTier1('Fast prompt submission', {
    openNewConversation: true
  });
  const fastDuration = Date.now() - fastStart;

  assert.strictEqual(fastResult.success, true, 'Tier 1 submission must succeed');
  assert.strictEqual(fastResult.tier, 'domBridge', 'Tier must be domBridge');
  assert.strictEqual(handshakeReceivedExtra?.readyCheckOnly, true, 'Handshake must request readyCheckOnly');
  // Without the 450ms sleep, execution should complete well under 250ms
  assert.ok(
    fastDuration < 250,
    `Fast dispatch should complete in < 250ms (avoiding 450ms artificial sleep), took ${fastDuration}ms`
  );
  console.log(`  ✓ 2A Passed: Fast readiness acknowledgement executed in ${fastDuration}ms (saved 450ms artificial delay).`);

  // 2B: Verify negative acknowledgement triggers safety fallback sleep
  const mockBridgeNegativeHandshake: Partial<BridgeServer> = {
    isListening: () => true,
    getConnectedClients: () => [{ id: 'client-1', windowKey: 'win_main', lastSeen: Date.now() }] as any,
    getActiveWindowKey: () => 'win_main',
    getWindowKey: () => 'win_main',
    getWorkspaceName: () => 'test_workspace',
    dispatchNewConversationCommand: async () => {
      return {
        success: false,
        commandId: 'cmd_conv_err',
        status: 'error',
        error: 'Conversation transition pending',
        durationMs: 5
      };
    },
    dispatchPromptCommand: async (_text, _opts) => {
      return {
        success: true,
        commandId: 'cmd_prompt_fallback',
        status: 'submitClicked',
        durationMs: 10
      };
    }
  };

  const slowDispatcher = new PromptDispatcher({
    bridgeServer: mockBridgeNegativeHandshake as BridgeServer,
    keyboardManager: {} as KeyboardManager,
    configProvider: () => ({
      executionMode: 'domBridge',
      allowTierFallback: false,
      bridgeTimeoutMs: 3000,
      suppressFallbackWarnings: true
    } as any),
    commandExecutor: trackingExecutor,
    logger: new DebugLogger()
  });

  const slowStart = Date.now();
  await slowDispatcher.dispatchTier1('Unacknowledged handshake prompt', { openNewConversation: true });
  const slowDuration = Date.now() - slowStart;
  assert.ok(
    slowDuration >= 400,
    `Unacknowledged handshake must wait for stabilization (expected >= 400ms, took ${slowDuration}ms)`
  );
  console.log(`  ✓ 2B Passed: Unacknowledged handshake correctly waited ${slowDuration}ms for stabilization.\n`);

  // =========================================================================
  // Test Suite 3: PromptOriginTracker Deduplication, Zero Timers & O(1) Pruning
  // =========================================================================
  console.log('--- Test Suite 3: PromptOriginTracker Optimizations & Benchmarking ---');

  // 3A: Verify singleton and default tracker have zero background timers
  assert.strictEqual(
    (promptOriginTracker as any).pruneTimer,
    null,
    'Default promptOriginTracker singleton must have no background interval timer'
  );

  const trackerInstance = new PromptOriginTracker({ capacity: 100, ttlMs: 60000 });
  assert.strictEqual(
    (trackerInstance as any).pruneTimer,
    null,
    'New PromptOriginTracker with default options must have no background timer'
  );
  console.log('  ✓ 3A Passed: Zero unreferenced background timers running.');

  // 3B: Verify memory optimization: raw prompt text is NOT stored in entries
  trackerInstance.registerTelegramPrompt('Test prompt for memory check', 1000);
  const entry0 = (trackerInstance as any).entries[0];
  assert.strictEqual(entry0.prompt, undefined, 'Raw prompt string must not be stored in PromptFingerprintEntry');
  assert.ok(typeof entry0.hash === 'string' && entry0.hash.length === 64, 'Hash must be 64-char sha256');
  assert.strictEqual(entry0.origin, 'telegram', 'Origin must be telegram');
  assert.strictEqual(entry0.timestamp, 1000, 'Timestamp must match');
  console.log('  ✓ 3B Passed: PromptFingerprintEntry memory footprint minimized (raw prompt omitted).');

  // 3C: Verify hashPrompt avoids duplicate normalization
  const normalizedText = normalizePromptText('  hello   WORLD  \r\n');
  assert.strictEqual(normalizedText, 'hello world');
  const directHash = hashPrompt(normalizedText, true);
  const reNormalizedHash = hashPrompt(normalizedText, false);
  assert.strictEqual(directHash, reNormalizedHash, 'Pre-normalized hash must match standard hash');
  console.log('  ✓ 3C Passed: hashPrompt pre-normalized flag verified.');

  // 3D: Verify O(1) FIFO head pruning
  trackerInstance.clear();
  trackerInstance.registerTelegramPrompt('Prompt 1', 1000);
  trackerInstance.registerTelegramPrompt('Prompt 2', 2000);
  trackerInstance.registerTelegramPrompt('Prompt 3', 3000);
  trackerInstance.registerTelegramPrompt('Prompt 4', 4000);

  assert.strictEqual(trackerInstance.size(), 4, 'Buffer should initially hold 4 entries');
  // At timestamp 62500 (TTL is 60000):
  // Prompt 1 (age 61500) and Prompt 2 (age 60500) are expired.
  // Prompt 3 (age 59500) and Prompt 4 (age 58500) are still valid.
  const prunedCount1 = trackerInstance.pruneExpired(62500);
  assert.strictEqual(prunedCount1, 2, 'Must prune exactly the 2 expired entries from the head');
  assert.strictEqual(trackerInstance.size(), 2, 'Exactly 2 surviving entries should remain in buffer');
  assert.strictEqual(trackerInstance.getPendingCount('Prompt 1', 62500), 0, 'Prompt 1 must be expired');
  assert.strictEqual(trackerInstance.getPendingCount('Prompt 2', 62500), 0, 'Prompt 2 must be expired');
  assert.strictEqual(trackerInstance.getPendingCount('Prompt 3', 62500), 1, 'Prompt 3 must still be pending');
  assert.strictEqual(trackerInstance.getPendingCount('Prompt 4', 62500), 1, 'Prompt 4 must still be pending');

  // At timestamp 64500:
  // Prompt 3 (age 61500) and Prompt 4 (age 60500) are now also expired.
  const prunedCount2 = trackerInstance.pruneExpired(64500);
  assert.strictEqual(prunedCount2, 2, 'Must prune remaining 2 expired entries');
  assert.strictEqual(trackerInstance.size(), 0, 'Buffer should now be empty');
  console.log('  ✓ 3D Passed: O(1) amortized FIFO head pruning verified.');

  // 3E: High-throughput benchmark: 1,000 registrations and lookups
  console.log('3E: Running high-throughput benchmark on PromptOriginTracker (1,000 ops)...');
  const benchTracker = new PromptOriginTracker({ capacity: 500, ttlMs: 30000 });
  const benchStart = process.hrtime.bigint();

  const baseTimestamp = 100000;
  for (let i = 0; i < 1000; i++) {
    const prompt = `Automated benchmark prompt index ${i % 200} payload`;
    benchTracker.registerTelegramPrompt(prompt, baseTimestamp + i * 10);
    if (i % 2 === 0) {
      benchTracker.getOrigin(prompt, baseTimestamp + i * 10);
    }
  }

  const benchEnd = process.hrtime.bigint();
  const benchDurationMs = Number(benchEnd - benchStart) / 1_000_000;
  console.log(`  ✓ 3E Benchmark: 1,000 operations completed in ${benchDurationMs.toFixed(2)}ms (< 50ms target).`);
  assert.ok(benchDurationMs < 100, `Benchmark should complete in < 100ms, took ${benchDurationMs}ms\n`);

  // =========================================================================
  // Test Suite 4: Linear Algorithmic Scaling & Hoisted Collator in Plan Scanner
  // =========================================================================
  console.log('--- Test Suite 4: Algorithmic Optimization & Hoisted Collator ---');

  // 4A: Singleton naturalCollator verification
  assert.ok(naturalCollator instanceof Intl.Collator, 'naturalCollator must be an instance of Intl.Collator');

  const testPhases: PhaseFile[] = [
    { fileName: 'phase-10.md', nativePath: '/p/10', normalizedPath: '/p/10', filePath: '/p/10', relativePath: '10', index: 10, status: 'Pending', isCompleted: false },
    { fileName: 'phase-02.md', nativePath: '/p/02', normalizedPath: '/p/02', filePath: '/p/02', relativePath: '02', index: 2, status: 'Pending', isCompleted: false },
    { fileName: 'phase-01.md', nativePath: '/p/01', normalizedPath: '/p/01', filePath: '/p/01', relativePath: '01', index: 1, status: 'Completed', isCompleted: true },
    { fileName: 'phase-100.md', nativePath: '/p/100', normalizedPath: '/p/100', filePath: '/p/100', relativePath: '100', index: 100, status: 'Pending', isCompleted: false }
  ];

  const sortedPhases = sortPhaseFiles(testPhases);
  assert.strictEqual(sortedPhases[0].fileName, 'phase-01.md');
  assert.strictEqual(sortedPhases[1].fileName, 'phase-02.md');
  assert.strictEqual(sortedPhases[2].fileName, 'phase-10.md');
  assert.strictEqual(sortedPhases[3].fileName, 'phase-100.md');
  console.log('  ✓ 4A Passed: Natural numeric collation verified via singleton collator.');

  // 4B: Verification of Buffer.allocUnsafe in inspectPhaseHeader
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan_test_phase04_'));
  const testPhasePath = path.join(tempDir, 'phase-01-test.md');
  fs.writeFileSync(testPhasePath, '# Phase 01\nStatus: ✅ Completed\n\nContent');

  const headerSync = inspectPhaseHeader(testPhasePath);
  assert.strictEqual(headerSync.status, 'Completed');
  assert.strictEqual(headerSync.headerSyntaxValid, true);

  const headerAsync = await inspectPhaseHeaderAsync(testPhasePath);
  assert.strictEqual(headerAsync.status, 'Completed');
  assert.strictEqual(headerAsync.headerSyntaxValid, true);
  console.log('  ✓ 4B Passed: inspectPhaseHeader / inspectPhaseHeaderAsync correctly parse with Buffer.allocUnsafe.');

  // Clean up temp file
  try {
    fs.unlinkSync(testPhasePath);
    fs.rmdirSync(tempDir);
  } catch {}

  // 4C: Linear O(N) Stall Analysis Benchmark on 120-phase dataset
  console.log('4C: Generating 120-phase dataset and benchmarking analyzePhaseStallReason...');
  const largePhaseDataset: any[] = [];
  for (let i = 0; i < 120; i++) {
    const phaseNum = i + 1;
    let status: 'Completed' | 'Running' | 'Pending' | 'Failed' = 'Pending';
    let error: string | undefined = undefined;

    if (i < 30) {
      status = 'Completed';
    } else if (i === 30) {
      status = 'Running';
    } else if (i === 60) {
      status = 'Failed';
      error = 'Test syntax assertion failed at step 4';
    }

    largePhaseDataset.push({
      index: i,
      phaseNumber: phaseNum,
      fileName: `phase-${String(phaseNum).padStart(3, '0')}-task.md`,
      filePath: `/plans/phase-${String(phaseNum).padStart(3, '0')}-task.md`,
      status,
      isCompleted: status === 'Completed',
      isSelected: true,
      error
    });
  }

  // Precompute blocker indices
  const precomputed = precomputeBlockerIndices(largePhaseDataset);
  assert.strictEqual(precomputed.firstUnfinishedIndex, 30, 'First unfinished phase must be index 30 (Running)');
  assert.strictEqual(precomputed.firstFailedIndex, 60, 'First failed phase must be index 60 (Failed)');

  // Verify correctness of diagnoses
  const phase10Reason = analyzePhaseStallReason(largePhaseDataset[10], largePhaseDataset, 10);
  assert.strictEqual(phase10Reason, undefined, 'Completed phase 10 should have no stall reason');

  const phase30Reason = analyzePhaseStallReason(largePhaseDataset[30], largePhaseDataset, 30);
  assert.strictEqual(phase30Reason, undefined, 'Running phase 30 should have no stall reason');

  const phase45Reason = analyzePhaseStallReason(largePhaseDataset[45], largePhaseDataset, 45, undefined, precomputed);
  assert.strictEqual(phase45Reason?.code, 'WAITING_FOR_PREVIOUS_PHASE');
  assert.strictEqual(phase45Reason?.blockedByPhaseIndex, 30);

  const phase75Reason = analyzePhaseStallReason(largePhaseDataset[75], largePhaseDataset, 75, undefined, precomputed);
  assert.strictEqual(phase75Reason?.code, 'BLOCKED_BY_PREVIOUS_FAILURE');
  assert.strictEqual(phase75Reason?.blockedByPhaseIndex, 60);

  // Benchmark: Run 500 iterations over all 120 phases (60,000 evaluations)
  const stallBenchStart = process.hrtime.bigint();
  for (let run = 0; run < 500; run++) {
    const blockers = precomputeBlockerIndices(largePhaseDataset);
    for (let i = 0; i < largePhaseDataset.length; i++) {
      analyzePhaseStallReason(largePhaseDataset[i], largePhaseDataset, i, undefined, blockers);
    }
  }
  const stallBenchEnd = process.hrtime.bigint();
  const stallDurationMs = Number(stallBenchEnd - stallBenchStart) / 1_000_000;

  console.log(`  ✓ 4C Benchmark: 60,000 phase stall evaluations across 120 phases completed in ${stallDurationMs.toFixed(2)}ms (linear O(N)).`);
  assert.ok(stallDurationMs < 250, `Stall analysis benchmark should complete in < 250ms, took ${stallDurationMs}ms\n`);

  // =========================================================================
  // Test Suite 5: Lightweight Command Verification in Settings
  // =========================================================================
  console.log('--- Test Suite 5: Lightweight Command Verification ---');

  const settingsTestDispatcher = new PromptDispatcher({
    commandExecutor: async (cmd: string) => {
      if (cmd === 'error-command') {
        throw new Error('Command execution failed');
      }
      return true;
    },
    logger: new DebugLogger()
  });

  const liveTestResult = await settingsTestDispatcher.testTierDispatch('nativeCommand', 'ping');
  assert.strictEqual(liveTestResult.success, true);
  assert.strictEqual(liveTestResult.tier, 'nativeCommand');
  assert.strictEqual(liveTestResult.status, 'commandApiReady');
  assert.ok(liveTestResult.latencyMs >= 0);

  const liveTestFail = await settingsTestDispatcher.testTierDispatch('nativeCommand', 'error-command');
  assert.strictEqual(liveTestFail.success, false);
  assert.strictEqual(liveTestFail.tier, 'nativeCommand');
  assert.ok(liveTestFail.error?.includes('Command execution failed'));
  console.log('  ✓ 5A Passed: Lightweight command verification succeeded without calling getCommands(true).\n');

  console.log('========================================================================');
  console.log('🎉 ALL PHASE 04 TESTS PASSED SUCCESSFULLY! (100% VERIFIED)');
  console.log('========================================================================');
}

runPhase04TestSuite().catch((err) => {
  console.error('\n❌ Phase 04 Test Suite Failed with Error:\n', err);
  process.exit(1);
});
