// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceFolders: any[] = [];
let mockExtensions: Record<string, any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      extensions: {
        getExtension: (id: string) => mockExtensions[id]
      },
      workspace: {
        workspaceFolders: mockWorkspaceFolders,
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue
        })
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
  BUILTIN_EXTENSION_ID,
  STATUS_WAITING,
  SCOPE_ONCE,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_IDLE_POLL_INTERVAL_MS,
  PayloadFingerprintCache,
  computePayloadFingerprint,
  extractPermissionCandidates,
  createIdeAutoSubmit
} from '../antigravityRpcAutoSubmit';
import { TranscriptTailEngine } from '../transcriptTailEngine';

// Require the DOM Bridge script (runs in node via CommonJS export)
const domBridge = require('../../media/autoplan-dom-bridge.js');

async function runTestSuite() {
  console.log('=== [PHASE 04 VERIFICATION] Background Engine Adaptive Polling & Tailing Optimization ===\n');

  const activeWorkspace = 'file:///test/workspace/autoplan';
  mockWorkspaceFolders = [{ uri: { toString: () => activeWorkspace } }];

  let testCount = 0;
  function markTest(name: string) {
    testCount++;
    console.log(`[Test ${testCount}] ${name}`);
  }

  // =========================================================================
  // Section 1: Auto-Submit Adaptive Idle Polling & Fast Active Resumption
  // =========================================================================
  console.log('--- Section 1: Auto-Submit Adaptive Polling Backoff & Duplicate Query Elimination ---');

  {
    markTest('Auto-submit loop backs off to >= 3000ms when zero pending interactions exist');

    let rpcQueryCount = 0;
    let interactionCalls: any[] = [];

    const mockClient = {
      getAllCascadeTrajectories: async () => {
        rpcQueryCount++;
        return {
          trajectorySummaries: {
            'cascade-idle': {
              trajectoryId: 'traj-idle',
              workspaces: [activeWorkspace],
              waitingSteps: [] // 0 waiting steps
            }
          }
        };
      },
      handleCascadeUserInteraction: async (req: any) => {
        interactionCalls.push(req);
        return { success: true };
      }
    };

    mockExtensions[BUILTIN_EXTENSION_ID] = {
      isActive: true,
      exports: {
        getRpcClient: () => mockClient
      }
    };

    const autoSubmit = createIdeAutoSubmit({
      getPolicy: () => ({
        enabled: true,
        patterns: ['Submit'],
        workspaceUris: [activeWorkspace]
      }),
      idlePollIntervalMs: 3000
    });

    // Before any tick, current delay is default 1000ms
    assert.strictEqual(
      autoSubmit.status().currentDelayMs,
      DEFAULT_POLL_INTERVAL_MS,
      'Initial poll delay must start at base interval (1000ms)'
    );

    // Execute one tick with 0 pending steps
    await autoSubmit.tick();

    // Verify delay backed off to 3000ms (>= 3000ms)
    const idleStatus = autoSubmit.status();
    assert.ok(
      idleStatus.currentDelayMs! >= 3000,
      `Polling delay must back off to >= 3000ms when 0 pending steps exist (got ${idleStatus.currentDelayMs}ms)`
    );
    assert.strictEqual(idleStatus.currentDelayMs, 3000, 'Current delay must equal 3000ms idle cadence');
    assert.strictEqual(idleStatus.eligiblePermissions, 0, 'Eligible permissions must be 0');

    autoSubmit.dispose();
  }

  {
    markTest('Auto-submit loop resumes 1000ms active interval when pending steps appear');

    let currentPendingSteps: any[] = [];
    let rpcQueryCount = 0;
    let approvedInteractions: any[] = [];

    const mockClient = {
      getAllCascadeTrajectories: async () => {
        rpcQueryCount++;
        return {
          trajectorySummaries: {
            'cascade-1': {
              trajectoryId: 'traj-1',
              workspaces: [activeWorkspace],
              waitingSteps: currentPendingSteps
            }
          }
        };
      },
      handleCascadeUserInteraction: async (req: any) => {
        approvedInteractions.push(req);
        return { success: true };
      }
    };

    mockExtensions[BUILTIN_EXTENSION_ID] = {
      isActive: true,
      exports: {
        getRpcClient: () => mockClient
      }
    };

    const autoSubmit = createIdeAutoSubmit({
      getPolicy: () => ({
        enabled: true,
        patterns: ['Submit'],
        workspaceUris: [activeWorkspace]
      }),
      idlePollIntervalMs: 3000
    });

    // 1. Tick while idle
    await autoSubmit.tick();
    assert.strictEqual(autoSubmit.status().currentDelayMs, 3000, 'Must be 3000ms when idle');

    // 2. Introduce a pending actionable step
    currentPendingSteps = [
      {
        stepIndex: 1,
        step: {
          status: STATUS_WAITING,
          metadata: {
            sourceTrajectoryStepInfo: {
              cascadeId: 'cascade-1',
              trajectoryId: 'traj-1',
              stepIndex: 1
            },
            toolCall: { name: 'edit_file' }
          },
          requestedInteraction: {
            interaction: {
              case: 'permission',
              value: {
                resource: {
                  action: 'edit',
                  target: '/path/to/file.ts'
                }
              }
            }
          }
        }
      }
    ];

    const prevQueryCount = rpcQueryCount;
    // 3. Tick with active step
    await autoSubmit.tick();

    // Verify fast polling resumption
    assert.strictEqual(approvedInteractions.length, 1, 'Actionable step must be approved');
    assert.strictEqual(autoSubmit.status().approved, 1, 'Approved count must increment to 1');

    // PERF-003: Duplicate trajectory query before approval must be eliminated
    // Only 1 getAllCascadeTrajectories call must have occurred during this tick
    const queriesInThisTick = rpcQueryCount - prevQueryCount;
    assert.strictEqual(
      queriesInThisTick,
      1,
      `Pre-approval duplicate query must be eliminated: expected 1 query in tick, got ${queriesInThisTick}`
    );

    autoSubmit.dispose();
  }

  // =========================================================================
  // Section 2: Payload Fingerprint Caching & Computation Bypass
  // =========================================================================
  console.log('\n--- Section 2: Payload Fingerprint Caching ---');

  {
    markTest('PayloadFingerprintCache caches SHA-256 hashes and skips redundant computation');

    const cache = new PayloadFingerprintCache(100);
    const payload = {
      resource: {
        action: 'write',
        target: '/workspace/src/app.ts'
      },
      scope: SCOPE_ONCE
    };

    // First call: computation executed
    const hash1 = cache.getOrCompute('traj-1', 0, payload);
    assert.ok(hash1 && hash1.length === 64, 'Must return a valid 64-char hex SHA-256 fingerprint');
    assert.strictEqual(cache.stats.computations, 1, 'Initial computation count must be 1');
    assert.strictEqual(cache.stats.misses, 1, 'Initial miss count must be 1');
    assert.strictEqual(cache.stats.hits, 0, 'Initial hits must be 0');

    // Second call with same reference: cache hit, zero new computations
    const hash2 = cache.getOrCompute('traj-1', 0, payload);
    assert.strictEqual(hash2, hash1, 'Fingerprints must match exactly');
    assert.strictEqual(cache.stats.hits, 1, 'Cache hits must increment to 1');
    assert.strictEqual(cache.stats.computations, 1, 'Computations must remain 1 (bypassed)');

    // Third call with identical cloned content: structural cache hit
    const clonedPayload = JSON.parse(JSON.stringify(payload));
    const hash3 = cache.getOrCompute('traj-1', 0, clonedPayload);
    assert.strictEqual(hash3, hash1, 'Fingerprints for identical payload content must match');
    assert.strictEqual(cache.stats.hits, 2, 'Cache hits must increment to 2');
    assert.strictEqual(cache.stats.computations, 1, 'Computations must remain 1');

    // Fourth call with modified payload: cache miss, triggers computation
    const modifiedPayload = {
      resource: {
        action: 'delete',
        target: '/workspace/src/app.ts'
      },
      scope: SCOPE_ONCE
    };
    const hash4 = cache.getOrCompute('traj-1', 0, modifiedPayload);
    assert.notStrictEqual(hash4, hash1, 'Modified payload must produce distinct fingerprint');
    assert.strictEqual(cache.stats.computations, 2, 'Computations must increment to 2 on payload change');
    assert.strictEqual(cache.stats.misses, 2, 'Misses must increment to 2');
  }

  {
    markTest('extractPermissionCandidates uses PayloadFingerprintCache across repeated poll cycles');

    const fpCache = new PayloadFingerprintCache();
    const testResponse = {
      trajectorySummaries: {
        'casc-cache-test': {
          trajectoryId: 'traj-cache-test',
          workspaces: [activeWorkspace],
          waitingSteps: [
            {
              stepIndex: 0,
              step: {
                status: STATUS_WAITING,
                metadata: {
                  sourceTrajectoryStepInfo: {
                    cascadeId: 'casc-cache-test',
                    trajectoryId: 'traj-cache-test',
                    stepIndex: 0
                  },
                  toolCall: { name: 'run_command' }
                },
                requestedInteraction: {
                  interaction: {
                    case: 'permission',
                    value: {
                      resource: {
                        action: 'execute',
                        target: 'npm test'
                      }
                    }
                  }
                }
              }
            }
          ]
        }
      }
    };

    // Cycle 1: initial candidate extraction
    const candidates1 = extractPermissionCandidates(testResponse, [activeWorkspace], fpCache);
    assert.strictEqual(candidates1.length, 1);
    assert.strictEqual(fpCache.stats.computations, 1, 'Cycle 1 must compute 1 fingerprint');

    // Cycle 2: repeated poll with unchanged response
    const candidates2 = extractPermissionCandidates(testResponse, [activeWorkspace], fpCache);
    assert.strictEqual(candidates2.length, 1);
    assert.strictEqual(candidates2[0].fingerprint, candidates1[0].fingerprint);
    assert.strictEqual(candidates2[0].key, candidates1[0].key);
    assert.strictEqual(fpCache.stats.hits, 1, 'Cycle 2 must hit cache');
    assert.strictEqual(fpCache.stats.computations, 1, 'Cycle 2 must NOT recalculate SHA-256');
  }

  // =========================================================================
  // Section 3: TranscriptTailEngine Persistent FileHandle & Tailing
  // =========================================================================
  console.log('\n--- Section 3: TranscriptTailEngine Persistent FileHandle & Tailing ---');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-test-'));
  const testTranscriptPath = path.join(tmpDir, 'transcript.jsonl');

  try {
    markTest('TranscriptTailEngine reads incremental lines using persistent FileHandle');

    // Write initial line
    const step1 = JSON.stringify({
      step_index: 1,
      type: 'USER_INPUT',
      content: '<USER_REQUEST>Implement feature X</USER_REQUEST>',
      timestamp: Date.now()
    }) + '\n';
    fs.writeFileSync(testTranscriptPath, step1, 'utf8');

    const tailEngine = new TranscriptTailEngine({
      transcriptPath: testTranscriptPath,
      pollIntervalMs: 100,
      relaxedPollIntervalMs: 400
    });

    const userInputsReceived: any[] = [];
    const plannerResponsesReceived: any[] = [];

    tailEngine.on('userInput', (e) => userInputsReceived.push(e));
    tailEngine.on('plannerResponse', (e) => plannerResponsesReceived.push(e));

    // First read
    const lines1 = await tailEngine.readAppendedLines(testTranscriptPath);
    assert.strictEqual(lines1.length, 1, 'Must read 1 initial line');
    assert.strictEqual(userInputsReceived.length, 1);
    assert.strictEqual(userInputsReceived[0].prompt, 'Implement feature X');
    assert.ok(tailEngine.hasActiveHandle(), 'Persistent FileHandle must be opened and active');
    const handleRef1 = tailEngine.getFileHandle();
    assert.ok(handleRef1, 'FileHandle must not be null');

    // Append second line
    const step2 = JSON.stringify({
      step_index: 2,
      type: 'PLANNER_RESPONSE',
      source: 'MODEL',
      content: 'I will now implement feature X',
      timestamp: Date.now()
    }) + '\n';
    fs.appendFileSync(testTranscriptPath, step2, 'utf8');

    // Second read
    const lines2 = await tailEngine.readAppendedLines(testTranscriptPath);
    assert.strictEqual(lines2.length, 1, 'Must read 1 appended line');
    assert.strictEqual(plannerResponsesReceived.length, 1);
    assert.strictEqual(plannerResponsesReceived[0].response, 'I will now implement feature X');

    // Ensure the persistent FileHandle was reused, not recreated
    const handleRef2 = tailEngine.getFileHandle();
    assert.strictEqual(handleRef2, handleRef1, 'The same persistent FileHandle must be reused across appends');

    markTest('TranscriptTailEngine safely buffers partial lines and rolls offset back');

    // Append an incomplete line (simulating in-flight token append without trailing newline)
    const partialText = '{"step_index":3,"type":"PLANNER_RESPONSE","source":"MODEL","content":"In progress';
    fs.appendFileSync(testTranscriptPath, partialText, 'utf8');

    const offsetBeforePartial = tailEngine.getReadOffset();
    const partialLinesRead = await tailEngine.readAppendedLines(testTranscriptPath);
    assert.strictEqual(partialLinesRead.length, 0, 'Partial line must not be emitted as complete line');
    assert.strictEqual(
      tailEngine.getReadOffset(),
      offsetBeforePartial,
      'readOffset must roll back to start of partial line'
    );

    // Complete the line with remaining payload and newline
    const remainingText = ' complete"}\n';
    fs.appendFileSync(testTranscriptPath, remainingText, 'utf8');

    const completedLines = await tailEngine.readAppendedLines(testTranscriptPath);
    assert.strictEqual(completedLines.length, 1, 'Completed line must now be read');
    assert.strictEqual(plannerResponsesReceived.length, 2, 'Total planner responses must be 2');
    assert.strictEqual(plannerResponsesReceived[1].response, 'In progress complete');

    markTest('TranscriptTailEngine handles file truncation and resets readOffset');

    // Truncate file to empty
    fs.writeFileSync(testTranscriptPath, '', 'utf8');
    assert.strictEqual(fs.statSync(testTranscriptPath).size, 0);

    // Read should detect truncation (size < readOffset) and reset readOffset to 0
    const linesAfterTruncate = await tailEngine.readAppendedLines(testTranscriptPath);
    assert.strictEqual(linesAfterTruncate.length, 0);
    assert.strictEqual(tailEngine.getReadOffset(), 0, 'readOffset must reset to 0 after file truncation');

    // Append new line to truncated file
    const stepReset = JSON.stringify({
      step_index: 10,
      type: 'USER_INPUT',
      content: 'Fresh start after truncation',
      timestamp: Date.now()
    }) + '\n';
    fs.writeFileSync(testTranscriptPath, stepReset, 'utf8');

    const recoveredLines = await tailEngine.readAppendedLines(testTranscriptPath);
    assert.strictEqual(recoveredLines.length, 1, 'Must read new lines from offset 0 after truncation');
    assert.strictEqual(userInputsReceived.length, 2);
    assert.strictEqual(userInputsReceived[1].prompt, 'Fresh start after truncation');

    tailEngine.stop();

    markTest('TranscriptTailEngine relaxes polling cadence when fs.watch is healthy');

    const watcherEngine = new TranscriptTailEngine({
      transcriptPath: testTranscriptPath,
      pollIntervalMs: 250,
      relaxedPollIntervalMs: 1000
    });

    await watcherEngine.start();
    // With valid transcript path, fs.watch is attached and interval relaxes to 1000ms
    assert.strictEqual(
      watcherEngine.getActivePollIntervalMs(),
      1000,
      'Active poll interval must relax to 1000ms when native fs.watch is healthy'
    );

    watcherEngine.stop();
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }

  // =========================================================================
  // Section 4: DOM Bridge Clearance Polling Relaxation (>= 80ms)
  // =========================================================================
  console.log('\n--- Section 4: DOM Bridge Clearance Relaxation ---');

  {
    markTest('DOM bridge getEffectiveClearancePollInterval enforces minimum >= 80ms');

    const getEffective = domBridge.getEffectiveClearancePollInterval;
    assert.strictEqual(typeof getEffective, 'function', 'getEffectiveClearancePollInterval must be exported');

    assert.strictEqual(
      getEffective({ pollIntervalMs: 15 }),
      80,
      'Aggressive 15ms interval must be clamped to safe minimum 80ms'
    );
    assert.strictEqual(
      getEffective({ pollIntervalMs: 5 }),
      80,
      'Sub-10ms interval must be clamped to 80ms'
    );
    assert.strictEqual(
      getEffective({ pollIntervalMs: 120 }),
      120,
      'Interval >= 80ms must be preserved'
    );
    assert.strictEqual(
      getEffective({}),
      80,
      'Default options must yield 80ms clearance polling interval'
    );
  }

  {
    markTest('verifyInputSubmission executes polling loop with >= 80ms cadence');

    const verifyInputSubmission = domBridge.verifyInputSubmission;
    assert.strictEqual(typeof verifyInputSubmission, 'function', 'verifyInputSubmission must be exported');

    // Create a mock input element that retains content (never cleared)
    const mockInput = {
      tagName: 'TEXTAREA',
      value: 'My unsubmitted prompt',
      ownerDocument: {}
    };

    // Execute verifyInputSubmission with legacy 15ms option and short observation window (160ms)
    const startMs = Date.now();
    const res = await verifyInputSubmission(mockInput, 'My unsubmitted prompt', {
      pollIntervalMs: 15,
      observationTimeoutMs: 160,
      document: {
        querySelectorAll: () => []
      }
    });

    // Verification must fail (input remained uncleared)
    assert.strictEqual(res.verified, false);
    assert.strictEqual(res.reason, 'unverified_input_remains');
    // Result must confirm that pollIntervalMs was enforced at >= 80ms
    assert.ok(
      res.pollIntervalMs >= 80,
      `Effective pollIntervalMs in verification result must be >= 80ms (got ${res.pollIntervalMs})`
    );
    assert.strictEqual(res.pollIntervalMs, 80);
  }

  // =========================================================================
  // Section 5: End-to-End Clearance Verification & Tail Event Dispatch
  // =========================================================================
  console.log('\n--- Section 5: End-to-End Submission Clearance & Tail Pipeline ---');

  {
    markTest('Full submission clearance Proof 1 followed by tail engine response event dispatch');

    // Step A: DOM clearance verification (Proof 1)
    const verifyInputSubmission = domBridge.verifyInputSubmission;
    const promptText = 'Refactor database connection pool';

    // Simulate input that had confirmed content and was cleared by submit handler
    const mockClearedInput = {
      tagName: 'TEXTAREA',
      value: '', // Cleared!
      ownerDocument: {}
    };

    const clearanceResult = await verifyInputSubmission(mockClearedInput, promptText, {
      hasConfirmedContentBeforeSubmit: true,
      observationTimeoutMs: 200,
      document: { querySelectorAll: () => [] }
    });

    assert.strictEqual(clearanceResult.verified, true, 'Submission must verify as cleared');
    assert.strictEqual(clearanceResult.proof, 'proof1_input_clearance');
    assert.strictEqual(clearanceResult.reason, 'input_cleared');

    // Step B: Transcript Tail Engine detects agent response after clearance
    const e2eDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-e2e-'));
    const e2eTranscript = path.join(e2eDir, 'transcript.jsonl');

    try {
      fs.writeFileSync(e2eTranscript, '', 'utf8');

      const tailEngine = new TranscriptTailEngine({
        transcriptPath: e2eTranscript,
        pollIntervalMs: 50,
        relaxedPollIntervalMs: 200
      });

      const eventsCaptured: any[] = [];
      tailEngine.on('plannerResponse', (evt) => eventsCaptured.push(evt));

      // Append model response
      const modelStep = JSON.stringify({
        step_index: 4,
        type: 'PLANNER_RESPONSE',
        source: 'MODEL',
        content: 'Database connection pool refactored successfully.',
        timestamp: Date.now()
      }) + '\n';
      fs.appendFileSync(e2eTranscript, modelStep, 'utf8');

      await tailEngine.readAppendedLines(e2eTranscript);

      assert.strictEqual(eventsCaptured.length, 1, 'Must dispatch plannerResponse event');
      assert.strictEqual(eventsCaptured[0].response, 'Database connection pool refactored successfully.');
      assert.strictEqual(eventsCaptured[0].stepIndex, 4);

      tailEngine.stop();
    } finally {
      try {
        fs.rmSync(e2eDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }

  console.log(`\n======================================================================`);
  console.log(`  All ${testCount} Verification Tests in Phase 04 Passed Successfully!`);
  console.log(`======================================================================\n`);
}

runTestSuite().catch((err) => {
  console.error('\n❌ Phase 04 Verification Failed:\n', err);
  process.exit(1);
});

