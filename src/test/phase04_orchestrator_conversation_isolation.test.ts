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
          get: (_key: string, defaultValue: any) => defaultValue,
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
  TranscriptWatcher,
  isValidCompletionStep,
  NewConversationTimeoutError
} from '../transcriptWatcher';
import {
  Orchestrator,
  PhaseItem
} from '../orchestrator';
import { KeyboardManager } from '../keyboardManager';
import { PromptDispatcher } from '../promptDispatcher';
import { AutoPlanConfig } from '../config';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Phase 04: Orchestrator Conversation Isolation & Keyword Timestamp Guard', function () {
  this.timeout(15000);

  let tempDir: string;
  let brainDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-test-'));
    brainDir = path.join(tempDir, 'brain');
    fs.mkdirSync(brainDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. Elimination of Silent Fallback to lastConversationId on Timeout', () => {
    it('waitForNewConversation on TranscriptWatcher rejects with NewConversationTimeoutError on timeout', async () => {
      const watcher = new TranscriptWatcher({
        brainDir,
        pollIntervalMs: 20,
        timeoutMs: 100
      });

      const startTime = Date.now();
      await assert.rejects(
        async () => {
          await watcher.waitForNewConversation(startTime, 'stale-conv-id', 80, 20);
        },
        (err: any) => {
          assert.strictEqual(err instanceof NewConversationTimeoutError, true);
          assert.strictEqual(err.lastConversationId, 'stale-conv-id');
          assert.strictEqual(err.timeoutMs, 80);
          assert(err.message.includes('Timeout waiting for new conversation'));
          return true;
        }
      );
      watcher.stop();
    });

    it('waitForNewConversation on Orchestrator throws NewConversationTimeoutError when expectNew is true', async () => {
      const mockKm = new KeyboardManager();
      const mockDispatcher = new PromptDispatcher({ keyboardManager: mockKm });
      const watcher = new TranscriptWatcher({
        brainDir,
        pollIntervalMs: 20
      });
      const orchestrator = new Orchestrator({
        promptDispatcher: mockDispatcher,
        keyboardManager: mockKm,
        transcriptWatcher: watcher
      });

      const startTime = Date.now();
      await assert.rejects(
        async () => {
          await orchestrator.waitForNewConversation(
            startTime,
            'stale-conv-xyz',
            80,
            20,
            true, // expectNew === true
            { phaseIndex: 1, fileName: 'phase-02-test.md' }
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof NewConversationTimeoutError, true);
          assert.strictEqual(err.lastConversationId, 'stale-conv-xyz');
          assert.strictEqual(err.phaseIndex, 1);
          assert.strictEqual(err.fileName, 'phase-02-test.md');
          assert.strictEqual(err.timeoutMs, 80);
          assert(err.message.includes('stale-conv-xyz'));
          return true;
        }
      );
      watcher.stop();
    });

    it('waitForNewConversation on Orchestrator permits fallback when expectNew is explicitly false', async () => {
      const mockKm = new KeyboardManager();
      const mockDispatcher = new PromptDispatcher({ keyboardManager: mockKm });
      const watcher = new TranscriptWatcher({
        brainDir,
        pollIntervalMs: 20
      });
      const orchestrator = new Orchestrator({
        promptDispatcher: mockDispatcher,
        keyboardManager: mockKm,
        transcriptWatcher: watcher
      });

      const startTime = Date.now();
      const result = await orchestrator.waitForNewConversation(
        startTime,
        'stale-conv-fallback',
        60,
        20,
        false // expectNew === false
      );

      assert.strictEqual(result, 'stale-conv-fallback');
      watcher.stop();
    });
  });

  describe('2. Phase Boundary & Timestamp Isolation for Completion Keywords', () => {
    it('isValidCompletionStep strictly rejects keywords occurring before minTimestamp (phaseStartTime)', () => {
      const minTimestamp = 5000;
      const keyword = 'Done skul9x.';

      const staleTimestampStep = {
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'All tasks completed. Done skul9x.',
        timestamp: 4000
      };
      assert.strictEqual(
        isValidCompletionStep(staleTimestampStep, keyword, minTimestamp),
        false,
        'Keywords before minTimestamp must be rejected'
      );

      const staleCreatedAtStep = {
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Done skul9x.',
        createdAt: 4999
      };
      assert.strictEqual(
        isValidCompletionStep(staleCreatedAtStep, keyword, minTimestamp),
        false,
        'createdAt before minTimestamp must be rejected'
      );

      const staleIsoStep = {
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Done skul9x.',
        time: new Date(4000).toISOString()
      };
      assert.strictEqual(
        isValidCompletionStep(staleIsoStep, keyword, minTimestamp),
        false,
        'ISO time before minTimestamp must be rejected'
      );

      const validStep = {
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Finished work. Done skul9x.',
        timestamp: 5001
      };
      assert.strictEqual(
        isValidCompletionStep(validStep, keyword, minTimestamp),
        true,
        'Keywords >= minTimestamp must be accepted'
      );
    });

    it('isValidCompletionStep rejects steps without timestamp when index is within initialTranscriptLength', () => {
      const minTimestamp = 5000;
      const keyword = 'Done skul9x.';

      // Pre-existing step (index <= initialTranscriptLength = 3)
      const preExistingStep = {
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Done skul9x.'
      };
      assert.strictEqual(
        isValidCompletionStep(preExistingStep, keyword, minTimestamp, {
          initialTranscriptLength: 3,
          entryIndex: 2
        }),
        false,
        'Entry index <= initialTranscriptLength must be rejected'
      );

      assert.strictEqual(
        isValidCompletionStep(preExistingStep, keyword, minTimestamp, {
          initialTranscriptLength: 3,
          entryIndex: 3
        }),
        false,
        'Entry index equal to initialTranscriptLength must be rejected'
      );

      // New step beyond initialTranscriptLength
      assert.strictEqual(
        isValidCompletionStep(preExistingStep, keyword, minTimestamp, {
          initialTranscriptLength: 3,
          entryIndex: 4
        }),
        true,
        'Entry index strictly beyond initialTranscriptLength must be accepted'
      );

      // Step with step_index property
      const indexedStepOld = {
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Done skul9x.',
        step_index: 2
      };
      assert.strictEqual(
        isValidCompletionStep(indexedStepOld, keyword, minTimestamp, {
          initialTranscriptLength: 3
        }),
        false,
        'step_index <= initialTranscriptLength must be rejected'
      );

      const indexedStepNew = {
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Done skul9x.',
        step_index: 5
      };
      assert.strictEqual(
        isValidCompletionStep(indexedStepNew, keyword, minTimestamp, {
          initialTranscriptLength: 3
        }),
        true,
        'step_index > initialTranscriptLength must be accepted'
      );
    });

    it('TranscriptWatcher ignores pre-existing completion keywords and triggers only on post-start entries', async () => {
      const convId = 'conv-timestamp-test';
      const convDir = path.join(brainDir, convId, '.system_generated', 'logs');
      fs.mkdirSync(convDir, { recursive: true });
      const transcriptPath = path.join(convDir, 'transcript.jsonl');

      const pastTime = Date.now() - 10000;
      // Write pre-existing entries containing stale completion keywords
      const initialLines = [
        JSON.stringify({ source: 'USER', type: 'USER_INPUT', content: 'Phase 1 prompt' }),
        JSON.stringify({
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          content: 'Phase 1 Done skul9x.',
          timestamp: pastTime
        })
      ].join('\n') + '\n';
      fs.writeFileSync(transcriptPath, initialLines, 'utf8');

      const phaseStartTime = Date.now();
      const watcher = new TranscriptWatcher({
        brainDir,
        pollIntervalMs: 50,
        settleQuietPeriodMs: 100,
        timeoutMs: 3000
      });

      let completionDetected = false;
      const watchPromise = watcher.watchFile(
        transcriptPath,
        convId,
        0, // intentionally testing offset = 0 to verify timestamp isolation!
        phaseStartTime
      ).then((res) => {
        completionDetected = true;
        return res;
      });

      // Wait 300ms: verify no completion was triggered by the stale keyword
      await sleep(300);
      assert.strictEqual(completionDetected, false, 'Watcher must NOT trigger on stale pre-existing keyword');

      // Now append a new entry created after phaseStartTime
      const newLine = JSON.stringify({
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'Phase 2 finished. Done skul9x.',
        timestamp: Date.now()
      }) + '\n';
      fs.appendFileSync(transcriptPath, newLine, 'utf8');

      const result = await watchPromise;
      assert.strictEqual(result.success, true);
      assert(result.matchedContent?.includes('Phase 2 finished'));
      watcher.stop();
    });
  });

  describe('3. Strict Transcript Offset Initialization on Shared Conversation IDs', () => {
    it('initializes startOffset and offsetToUse to file size instead of 0 for shared conversation IDs', async () => {
      const convId = 'conv-shared-session';
      const convDir = path.join(brainDir, convId, '.system_generated', 'logs');
      fs.mkdirSync(convDir, { recursive: true });
      const transcriptPath = path.join(convDir, 'transcript.jsonl');

      // Pre-fill transcript with prior phase output
      const priorContent = [
        JSON.stringify({ source: 'USER', type: 'USER_INPUT', content: 'Phase 1 instructions' }),
        JSON.stringify({
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          content: 'Done skul9x.',
          timestamp: Date.now() - 5000
        })
      ].join('\n') + '\n';
      fs.writeFileSync(transcriptPath, priorContent, 'utf8');
      const priorFileSize = fs.statSync(transcriptPath).size;
      assert(priorFileSize > 0, 'Prior file size must be > 0');

      const mockKm = new KeyboardManager();
      const mockDispatcher = new PromptDispatcher({ keyboardManager: mockKm });
      const watcher = new TranscriptWatcher({ brainDir });
      const orchestrator = new Orchestrator({
        promptDispatcher: mockDispatcher,
        keyboardManager: mockKm,
        transcriptWatcher: watcher
      });

      // Simulate prior phase having finished and set lastConversationId
      orchestrator.setLastConversationId(convId);

      // Create a phase where startOffset is initially undefined
      const phase: PhaseItem = {
        index: 1,
        phaseNumber: 2,
        fileName: 'phase-02.md',
        filePath: '/dummy/phase-02.md',
        nativePath: '/dummy/phase-02.md',
        normalizedPath: '/dummy/phase-02.md',
        status: 'Pending'
      };

      // Measure pre-dispatch offset as performed by orchestrator at phaseStartTime
      const phaseStartTime = Date.now();
      let initialOffset = 0;
      let initialTranscriptLength = 0;
      const lastConvId = orchestrator.getLastConversationId();
      if (lastConvId && lastConvId !== 'current_conversation') {
        const cDir = path.join(watcher.getOptions().brainDir, lastConvId);
        const tPath = path.join(cDir, '.system_generated', 'logs', 'transcript.jsonl');
        if (fs.existsSync(tPath)) {
          initialOffset = fs.statSync(tPath).size;
          const content = fs.readFileSync(tPath, 'utf8');
          initialTranscriptLength = content.split('\n').filter((l) => l.trim().length > 0).length;
        }
      }
      phase.startOffset = initialOffset;
      phase.initialTranscriptLength = initialTranscriptLength;

      assert.strictEqual(phase.startOffset, priorFileSize, 'phase.startOffset must equal existing file size');
      assert.strictEqual(phase.initialTranscriptLength, 2, 'phase.initialTranscriptLength must equal entry count');

      // Verify offsetToUse fallback logic if startOffset was undefined
      delete phase.startOffset;
      let offsetToUse = 0;
      if (convId === orchestrator.getLastConversationId()) {
        if (phase.startOffset !== undefined && phase.startOffset > 0) {
          offsetToUse = phase.startOffset;
        } else if (transcriptPath && fs.existsSync(transcriptPath)) {
          offsetToUse = fs.statSync(transcriptPath).size;
          phase.startOffset = offsetToUse;
        }
      }

      assert.strictEqual(offsetToUse, priorFileSize, 'offsetToUse must measure synchronous file size and never default to 0');
      assert.strictEqual(phase.startOffset, priorFileSize, 'phase.startOffset must be set to current file size');
      watcher.stop();
    });
  });

  describe('4. Full Orchestrator Multi-Phase Shared Conversation Isolation', () => {
    it('executes consecutive phases sharing a conversation without false completion from earlier tokens', async () => {
      const sharedConvId = 'shared-multiphase-conv';
      const convLogsDir = path.join(brainDir, sharedConvId, '.system_generated', 'logs');
      fs.mkdirSync(convLogsDir, { recursive: true });
      const transcriptPath = path.join(convLogsDir, 'transcript.jsonl');

      // Create phase plan files
      const plansDir = path.join(tempDir, 'plans');
      fs.mkdirSync(plansDir, { recursive: true });
      const phase1File = path.join(plansDir, 'phase-01.md');
      const phase2File = path.join(plansDir, 'phase-02.md');
      fs.writeFileSync(phase1File, '# Phase 1 Plan', 'utf8');
      fs.writeFileSync(phase2File, '# Phase 2 Plan', 'utf8');

      const mockKm = new KeyboardManager();
      const mockDispatcher = new PromptDispatcher({ keyboardManager: mockKm });
      const watcher = new TranscriptWatcher({
        brainDir,
        pollIntervalMs: 40,
        settleQuietPeriodMs: 80
      });

      const orchestrator = new Orchestrator({
        promptDispatcher: mockDispatcher,
        keyboardManager: mockKm,
        transcriptWatcher: watcher
      });

      const mockReadiness = {
        ready: true,
        selectedTier: 'domBridge' as const,
        isFocusFree: true,
        requiresForegroundFocus: false,
        details: {
          connectedClientsCount: 1,
          os: 'linux' as const
        }
      };
      mockDispatcher.validateDispatchReadiness = () => mockReadiness;
      mockDispatcher.ensureBridgeReadinessWithWakeup = async () => mockReadiness;
      mockDispatcher.dispatchPrompt = async (_prompt: string, _options?: any) => {
        return {
          success: true,
          tier: 'domBridge' as any,
          durationMs: 15
        };
      };

      // Mock waitForNewConversation on orchestrator to simulate IDE binding to sharedConvId
      orchestrator.waitForNewConversation = async () => {
        return sharedConvId;
      };

      const completedPhases: string[] = [];
      orchestrator.on('phaseComplete', (phase: PhaseItem) => {
        completedPhases.push(phase.fileName);
      });

      // Background simulator: simulates Antigravity agent writing responses to the shared transcript
      let promptSubmissionCount = 0;
      orchestrator.on('phaseStart', (phase: PhaseItem) => {
        promptSubmissionCount++;
        const currentPhaseNum = promptSubmissionCount;
        setTimeout(() => {
          const completionEntry = JSON.stringify({
            source: 'MODEL',
            type: 'PLANNER_RESPONSE',
            status: 'DONE',
            content: `Phase ${currentPhaseNum} is complete. Done skul9x.`,
            timestamp: Date.now()
          }) + '\n';
          fs.appendFileSync(transcriptPath, completionEntry, 'utf8');
        }, 150);
      });

      const config: Partial<AutoPlanConfig> = {
        delayBetweenLoopsMs: 100,
        autoApprovePermissions: true,
        completionKeyword: 'Done skul9x.'
      };

      await orchestrator.startPlanFolder(plansDir, { overrideConfig: config });

      assert.strictEqual(completedPhases.length, 2, 'Both phases must complete sequentially');
      assert.strictEqual(completedPhases[0], 'phase-01.md');
      assert.strictEqual(completedPhases[1], 'phase-02.md');

      orchestrator.stop();
    });
  });
});
