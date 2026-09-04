// Standalone test runner with comprehensive mock for 'vscode' module
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      commands: {
        executeCommand: async (_cmd: string, ..._args: any[]) => undefined
      },
      window: {
        showWarningMessage: (_msg: string) => undefined,
        showErrorMessage: (_msg: string) => undefined,
        showInformationMessage: (_msg: string) => undefined,
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {}
        })
      },
      workspace: {
        workspaceFolders: [],
        getConfiguration: () => ({
          get: (key: string, defaultValue: any) => {
            if (key === 'newConversationTimeoutMs') return 8000;
            return defaultValue;
          },
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
import {
  Orchestrator,
  PhaseItem,
  NewConversationTimeoutError
} from '../orchestrator';
import { TranscriptWatcher } from '../transcriptWatcher';
import { KeyboardManager } from '../keyboardManager';
import { PromptDispatcher } from '../promptDispatcher';
import { DebugLogger } from '../debugLogger';
import { AutoPlanConfig, DEFAULT_CONFIG, getConfig } from '../config';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTests() {
  console.log('=== Starting Phase 03: Orchestrator Discovery Resilience & Adaptive Timeout Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-test-'));
  const brainDir = path.join(tempDir, 'brain');
  fs.mkdirSync(brainDir, { recursive: true });

  try {
    // -------------------------------------------------------------------------
    // Test 1: Configuration Key & Default Value Verification
    // -------------------------------------------------------------------------
    console.log('▶ Test 1: Configuration Key & Default Value Verification...');
    {
      assert.strictEqual(
        DEFAULT_CONFIG.newConversationTimeoutMs,
        8000,
        'DEFAULT_CONFIG.newConversationTimeoutMs must default to 8000ms'
      );

      const loadedConfig = getConfig();
      assert.strictEqual(
        loadedConfig.newConversationTimeoutMs,
        8000,
        'getConfig().newConversationTimeoutMs must default to 8000ms'
      );

      const orchestrator = new Orchestrator();
      assert.strictEqual(
        orchestrator.config.newConversationTimeoutMs,
        8000,
        'Orchestrator config getter must expose default 8000ms'
      );
      console.log('  ✓ newConversationTimeoutMs default is 8000ms across config and orchestrator');
    }

    // -------------------------------------------------------------------------
    // Test 2: Orchestrator waitForNewConversation Signature & Default Parameter
    // -------------------------------------------------------------------------
    console.log('\n▶ Test 2: Orchestrator waitForNewConversation Signature & Adaptive Parameter...');
    {
      const mockKm = new KeyboardManager();
      const mockDispatcher = new PromptDispatcher({ keyboardManager: mockKm });
      const watcher = new TranscriptWatcher({
        brainDir,
        pollIntervalMs: 50
      });
      const logger = new DebugLogger(500);
      const orchestrator = new Orchestrator({
        promptDispatcher: mockDispatcher,
        keyboardManager: mockKm,
        transcriptWatcher: watcher,
        debugLogger: logger
      });

      // Verify waitForNewConversation respects explicitly passed custom timeout
      const startTime = Date.now();
      await assert.rejects(
        async () => {
          await orchestrator.waitForNewConversation(
            startTime,
            'stale-conv-1',
            120, // 120ms timeout
            30,  // 30ms poll
            true,
            { phaseIndex: 0, fileName: 'phase-01.md' }
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof NewConversationTimeoutError, true);
          assert.strictEqual(err.timeoutMs, 120);
          assert.strictEqual(err.lastConversationId, 'stale-conv-1');
          assert.strictEqual(err.phaseIndex, 0);
          assert.strictEqual(err.fileName, 'phase-01.md');
          assert.ok(
            err.message.includes('Timeout waiting for new conversation after 120ms. Verify prompt submission status in chat panel.'),
            `Expected standard error message, got: ${err.message}`
          );
          return true;
        }
      );
      watcher.stop();
      console.log('  ✓ waitForNewConversation accurately honors custom timeout and sets diagnostic context');
    }

    // -------------------------------------------------------------------------
    // Test 3: Delayed Discovery Succeeding at 4500ms (Progressive Logging Trace)
    // -------------------------------------------------------------------------
    console.log('\n▶ Test 3: Delayed Discovery at 4500ms & Progressive Diagnostic Logging...');
    {
      const mockKm = new KeyboardManager();
      const mockDispatcher = new PromptDispatcher({ keyboardManager: mockKm });
      const watcher = new TranscriptWatcher({
        brainDir,
        pollIntervalMs: 100
      });
      const logger = new DebugLogger(500);
      const orchestrator = new Orchestrator({
        promptDispatcher: mockDispatcher,
        keyboardManager: mockKm,
        transcriptWatcher: watcher,
        debugLogger: logger
      });

      const startTime = Date.now();
      const delayedConvId = 'conv-delayed-4500';
      const convFolder = path.join(brainDir, delayedConvId);

      // Schedule directory & transcript creation at 4500ms
      const creationTimer = setTimeout(() => {
        fs.mkdirSync(convFolder, { recursive: true });
        const transcriptPath = path.join(convFolder, 'transcript.jsonl');
        fs.writeFileSync(
          transcriptPath,
          JSON.stringify({
            source: 'USER_EXPLICIT',
            type: 'USER_INPUT',
            content: 'Hello Antigravity'
          }) + '\n',
          'utf8'
        );
      }, 4500);

      const discoveryPromise = orchestrator.waitForNewConversation(
        startTime,
        undefined,
        8000, // 8000ms timeout window allows 4500ms discovery to succeed
        100,
        true,
        { phaseIndex: 1, fileName: 'phase-02-delayed.md' }
      );

      const detectedId = await discoveryPromise;
      clearTimeout(creationTimer);

      assert.strictEqual(
        detectedId,
        delayedConvId,
        `Expected ${delayedConvId} to be detected, got: ${detectedId}`
      );

      // Verify progressive discovery diagnostics were emitted during the 4500ms wait
      const entries = logger.getEntries();
      const info3s = entries.find(
        (e) =>
          e.component === 'ORCHESTRATOR' &&
          e.level === 'INFO' &&
          e.message.includes('Conversation directory detection in progress') &&
          e.message.includes('3000ms')
      );
      assert.ok(info3s, 'Expected 3000ms progressive heartbeat info log in DebugLogger');

      const warn4s = entries.find(
        (e) =>
          e.component === 'ORCHESTRATOR' &&
          e.level === 'WARN' &&
          e.message.includes('taking longer than expected') &&
          e.message.includes('phase-02-delayed.md')
      );
      assert.ok(warn4s, 'Expected 4000ms progressive warning log in DebugLogger');

      watcher.stop();
      console.log('  ✓ Conversation discovered at 4500ms successfully without timeout');
      console.log('  ✓ Progressive heartbeat info (3s) and warning (4s) verified in debug telemetry');
    }

    // -------------------------------------------------------------------------
    // Test 4: Accurate Error & Stall Reason on Timeout
    // -------------------------------------------------------------------------
    console.log('\n▶ Test 4: Accurate Error Message & Stall Reason on Timeout...');
    {
      const mockKm = new KeyboardManager();
      const mockDispatcher = new PromptDispatcher({ keyboardManager: mockKm });
      const watcher = new TranscriptWatcher({
        brainDir,
        pollIntervalMs: 50
      });
      const logger = new DebugLogger(500);
      const orchestrator = new Orchestrator({
        promptDispatcher: mockDispatcher,
        keyboardManager: mockKm,
        transcriptWatcher: watcher,
        debugLogger: logger
      });

      // Timeout with no lastConversationId
      await assert.rejects(
        async () => {
          await orchestrator.waitForNewConversation(
            Date.now(),
            undefined,
            8000,
            50,
            true,
            { phaseIndex: 2, fileName: 'phase-03.md' }
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof NewConversationTimeoutError, true);
          assert.strictEqual(
            err.message,
            'Timeout waiting for new conversation after 8000ms. Verify prompt submission status in chat panel.'
          );
          assert.strictEqual(err.timeoutMs, 8000);
          assert.strictEqual(err.phaseIndex, 2);
          assert.strictEqual(err.fileName, 'phase-03.md');
          return true;
        }
      );

      watcher.stop();
      console.log('  ✓ waitForNewConversation produces exact expected error message on timeout');
    }

    // -------------------------------------------------------------------------
    // Test 5: Full runPhaseSequence Adaptive Timeout & Stall Reason Handling
    // -------------------------------------------------------------------------
    console.log('\n▶ Test 5: runPhaseSequence Adaptive Timeout & Phase Stall Reason...');
    {
      const plansDir = path.join(tempDir, 'plans');
      fs.mkdirSync(plansDir, { recursive: true });
      fs.writeFileSync(
        path.join(plansDir, 'phase-01.md'),
        '# Phase 01\nStatus: Pending\n\nObjective: Test Orchestrator Discovery Resilience\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(plansDir, 'phase-02.md'),
        '# Phase 02\nStatus: Pending\n\nObjective: Subsequent Phase\n',
        'utf8'
      );

      const mockDispatcher: any = {
        validateDispatchReadiness: () => ({ ready: true }),
        dispatchPrompt: async () => ({
          success: true,
          tier: 'domBridge',
          commandId: 'test_cmd_1'
        })
      };

      const watcher = new TranscriptWatcher({
        brainDir,
        pollIntervalMs: 30
      });
      const logger = new DebugLogger(500);
      const orchestrator = new Orchestrator({
        promptDispatcher: mockDispatcher,
        transcriptWatcher: watcher,
        debugLogger: logger
      });

      let failedError: string | undefined;
      orchestrator.on('error', (err: Error) => {
        failedError = err.message;
      });

      // Execute with a fast timeout (150ms) to trigger adaptive timeout failure
      const runResult = await orchestrator.startPlanFolder(plansDir, {
        overrideConfig: {
          newConversationTimeoutMs: 150
        }
      });

      assert.strictEqual(runResult, false, 'Orchestration should return false on discovery timeout');

      const auditReport = orchestrator.getPhaseAuditReport();
      assert.strictEqual(auditReport.failedCount, 1, 'Phase 1 must be marked Failed');

      const phase1Diag = auditReport.phases[0];
      assert.strictEqual(phase1Diag.status, 'Failed');
      assert.ok(
        phase1Diag.error?.includes('Timeout waiting for new conversation after 150ms. Verify prompt submission status in chat panel.'),
        `Expected error message in phase diagnostics, got: ${phase1Diag.error}`
      );

      // Verify phase stall reason
      assert.ok(phase1Diag.stallReason, 'Phase 1 must possess a stallReason');
      assert.strictEqual(
        phase1Diag.stallReason?.code,
        'AI_RESPONSE_TIMEOUT',
        'Stall reason code must be AI_RESPONSE_TIMEOUT'
      );
      assert.strictEqual(
        phase1Diag.stallReason?.description,
        'Timeout waiting for new conversation after 150ms. Verify prompt submission status in chat panel.',
        'Stall reason description must state timeout and chat panel verification'
      );
      assert.strictEqual(
        phase1Diag.stallReason?.remediationAction,
        'Verify prompt submission status in chat panel.'
      );

      // Verify subsequent phase is blocked
      const phase2Diag = auditReport.phases[1];
      assert.strictEqual(phase2Diag.status, 'Pending');
      assert.strictEqual(
        phase2Diag.stallReason?.code,
        'BLOCKED_BY_PREVIOUS_FAILURE',
        'Subsequent Phase 2 must be blocked by previous failure'
      );

      orchestrator.stop();
      console.log('  ✓ runPhaseSequence sets accurate AI_RESPONSE_TIMEOUT stallReason on discovery timeout');
      console.log('  ✓ Subsequent phases cascade to BLOCKED_BY_PREVIOUS_FAILURE');
    }

    // -------------------------------------------------------------------------
    // Test 6: Successful Multi-Phase Run with Default Adaptive Timeout
    // -------------------------------------------------------------------------
    console.log('\n▶ Test 6: Successful runPhaseSequence with Adaptive Timeout Discovery...');
    {
      const plansSuccessDir = path.join(tempDir, 'plans_success');
      fs.mkdirSync(plansSuccessDir, { recursive: true });
      fs.writeFileSync(
        path.join(plansSuccessDir, 'phase-01.md'),
        '# Phase 01\nStatus: Pending\n',
        'utf8'
      );

      const mockDispatcher: any = {
        validateDispatchReadiness: () => ({ ready: true }),
        dispatchPrompt: async () => ({
          success: true,
          tier: 'domBridge',
          commandId: 'success_cmd_1'
        })
      };

      const watcher = new TranscriptWatcher({
        brainDir,
        pollIntervalMs: 30
      });
      const logger = new DebugLogger(500);
      const orchestrator = new Orchestrator({
        promptDispatcher: mockDispatcher,
        transcriptWatcher: watcher,
        debugLogger: logger
      });

      // Simulate AI writing conversation and completion when phase starts
      orchestrator.on('phaseStart', () => {
        setTimeout(() => {
          const convId = 'conv-success-run';
          const convDir = path.join(brainDir, convId);
          fs.mkdirSync(convDir, { recursive: true });
          const transcriptPath = path.join(convDir, 'transcript.jsonl');
          fs.writeFileSync(
            transcriptPath,
            JSON.stringify({
              source: 'MODEL',
              type: 'PLANNER_RESPONSE',
              status: 'DONE',
              content: 'Task completed! Done skul9x.',
              timestamp: Date.now()
            }) + '\n',
            'utf8'
          );
        }, 80);
      });

      const completedPhases: string[] = [];
      orchestrator.on('phaseComplete', (p: PhaseItem) => {
        completedPhases.push(p.fileName);
      });

      const successRun = await orchestrator.startPlanFolder(plansSuccessDir, {
        overrideConfig: {
          completionKeyword: 'Done skul9x.',
          delayBetweenLoopsMs: 50
        }
      });

      assert.strictEqual(successRun, true, 'startPlanFolder must succeed');
      assert.strictEqual(completedPhases.length, 1);
      assert.strictEqual(completedPhases[0], 'phase-01.md');

      orchestrator.stop();
      console.log('  ✓ Phase execution succeeds smoothly when new conversation is detected');
    }

    console.log('\n=== All Phase 03 Tests Passed Cleanly! ===\n');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error('\n❌ Phase 03 Test Suite Failed:', err);
  process.exit(1);
});
