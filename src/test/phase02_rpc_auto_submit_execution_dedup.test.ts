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
import {
  BUILTIN_EXTENSION_ID,
  BUILTIN_ID,
  STATUS_WAITING,
  WAITING,
  SCOPE_ONCE,
  ONCE,
  DEFAULT_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  MAX_POLL_INTERVAL_MS,
  MAX_BACKOFF_DELAY_MS,
  DEFAULT_CACHE_RETENTION_MS,
  MAX_CACHE_ENTRIES,
  sortObjectKeys,
  computePayloadFingerprint,
  QuarantineCache,
  BoundedDeduplicationCache,
  calculateBackoffDelay,
  extractPermissionCandidates,
  candidates,
  createIdeAutoSubmit
} from '../antigravityRpcAutoSubmit';

async function runTests() {
  console.log('=== [TEST SUITE] Phase 02: Safe Permission Submission, SHA-256 Deduplication & Rate Limiting ===\n');

  const activeWorkspace = 'file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main';
  mockWorkspaceFolders = [{ uri: { toString: () => activeWorkspace } }];

  // =========================================================================
  // Group 1: Deterministic SHA-256 Fingerprinting & Canonical Key Ordering
  // =========================================================================
  console.log('--- Group 1: Deterministic SHA-256 Fingerprinting & Canonical Key Ordering ---');

  // Test 1.1: Canonical key sorting handles primitives, nested objects, and arrays
  {
    const unordered = {
      z: 100,
      a: 'first',
      nested: {
        gamma: 3,
        alpha: 1,
        beta: 2
      },
      list: [{ y: 20, x: 10 }, 'str', 42]
    };

    const sorted = sortObjectKeys(unordered);
    const topKeys = Object.keys(sorted);
    assert.deepStrictEqual(topKeys, ['a', 'list', 'nested', 'z'], 'Top-level keys must be sorted alphabetically');
    assert.deepStrictEqual(Object.keys(sorted.nested), ['alpha', 'beta', 'gamma'], 'Nested keys must be sorted');
    assert.deepStrictEqual(Object.keys(sorted.list[0]), ['x', 'y'], 'Object keys in arrays must be sorted');
    console.log('  ✓ 1.1 Recursively canonicalizes object keys alphabetically across nested structures');
  }

  // Test 1.2: Deterministic fingerprint invariance to property order
  {
    const payloadA = {
      action: 'run_command',
      target: 'npm test',
      extra: { timeout: 5000, silent: false }
    };
    const payloadB = {
      extra: { silent: false, timeout: 5000 },
      target: 'npm test',
      action: 'run_command'
    };

    const hashA = computePayloadFingerprint(payloadA);
    const hashB = computePayloadFingerprint(payloadB);

    assert.strictEqual(typeof hashA, 'string');
    assert.strictEqual(hashA.length, 64, 'SHA-256 hash must be 64 characters hex');
    assert.strictEqual(hashA, hashB, 'Identical objects with different key insertion orders must yield identical hashes');
    console.log('  ✓ 1.2 Invariant SHA-256 fingerprint generation regardless of key insertion order');
  }

  // Test 1.3: Different payloads produce distinct fingerprints
  {
    const p1 = { action: 'run_command', target: 'npm test' };
    const p2 = { action: 'run_command', target: 'npm run build' };
    assert.notStrictEqual(computePayloadFingerprint(p1), computePayloadFingerprint(p2));
    console.log('  ✓ 1.3 Distinct payloads produce unique cryptographic fingerprints');
  }

  // =========================================================================
  // Group 2: Bounded Quarantine Cache & 24-Hour Retention Window
  // =========================================================================
  console.log('\n--- Group 2: Bounded Quarantine Cache & 24-Hour Retention Window ---');

  // Test 2.1: Cache basic get, set, has, delete
  {
    let currentTime = 1_000_000;
    const cache = new QuarantineCache({ now: () => currentTime });

    assert.strictEqual(cache.has('k1'), false);
    cache.set('k1');
    assert.strictEqual(cache.has('k1'), true);
    assert.strictEqual(cache.get('k1'), 1_000_000);
    assert.strictEqual(cache.size, 1);

    cache.delete('k1');
    assert.strictEqual(cache.has('k1'), false);
    assert.strictEqual(cache.size, 0);
    console.log('  ✓ 2.1 QuarantineCache supports basic insert, query, delete and sizing');
  }

  // Test 2.2: Bounded size and LRU eviction (under 2 MB constraint)
  {
    const cache = new QuarantineCache({ maxEntries: 3 });
    cache.set('key-1');
    cache.set('key-2');
    cache.set('key-3');
    assert.strictEqual(cache.size, 3);

    // Adding 4th entry evicts oldest (key-1)
    cache.set('key-4');
    assert.strictEqual(cache.size, 3);
    assert.strictEqual(cache.has('key-1'), false, 'Oldest item key-1 should be evicted');
    assert.strictEqual(cache.has('key-2'), true);
    assert.strictEqual(cache.has('key-3'), true);
    assert.strictEqual(cache.has('key-4'), true);

    // Re-setting key-2 updates recency (moves it to the end)
    cache.set('key-2');
    // Adding key-5 should evict key-3 now, NOT key-2
    cache.set('key-5');
    assert.strictEqual(cache.has('key-3'), false, 'key-3 was least recently used and should be evicted');
    assert.strictEqual(cache.has('key-2'), true, 'key-2 recency was refreshed');
    assert.strictEqual(cache.has('key-4'), true);
    assert.strictEqual(cache.has('key-5'), true);
    console.log('  ✓ 2.2 Enforces bounded capacity with LRU eviction to prevent unbounded memory growth');
  }

  // Test 2.3: 24-hour retention window expiration and lazy / active prune
  {
    let virtualTime = 100_000;
    const retentionMs = 24 * 60 * 60 * 1000; // 24 hours (86,400,000 ms)
    const cache = new QuarantineCache({ retentionMs, now: () => virtualTime });

    cache.set('fresh-key', virtualTime);
    assert.strictEqual(cache.has('fresh-key'), true);

    // Advance virtual time by 23 hours -> still valid
    virtualTime += 23 * 60 * 60 * 1000;
    assert.strictEqual(cache.has('fresh-key'), true, 'Entry within 24h retention window must remain valid');

    // Advance virtual time past 24 hours -> expired
    virtualTime += 2 * 60 * 60 * 1000; // total 25 hours elapsed
    assert.strictEqual(cache.has('fresh-key'), false, 'Entry older than 24h must be rejected lazily');
    assert.strictEqual(cache.size, 0, 'Expired entry must be pruned on query');

    // Test active prune()
    cache.set('old-1', 100_000);
    cache.set('old-2', 100_000);
    cache.set('recent', virtualTime);
    assert.strictEqual(cache.size, 3);

    const prunedCount = cache.prune(virtualTime);
    assert.strictEqual(prunedCount, 2, 'Should prune exactly 2 expired entries');
    assert.strictEqual(cache.size, 1);
    assert.strictEqual(cache.has('recent'), true);
    console.log('  ✓ 2.3 Enforces 24-hour retention window with lazy and active sweep pruning');
  }

  // =========================================================================
  // Group 3: End-to-End Safe Permission Submission Flow (scope: ONCE)
  // =========================================================================
  console.log('\n--- Group 3: End-to-End Safe Permission Submission Flow (scope: ONCE) ---');

  {
    const dispatchedInteractions: any[] = [];
    const mockRpcClient = {
      getAllCascadeTrajectories: async () => ({
        trajectorySummaries: {
          'cascade-safe': {
            trajectoryId: 'traj-safe',
            cascadeId: 'cascade-safe',
            workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
            waitingSteps: [
              {
                stepIndex: 2,
                step: {
                  status: WAITING,
                  metadata: { sourceTrajectoryStepInfo: { cascadeId: 'cascade-safe', trajectoryId: 'traj-safe', stepIndex: 2 } },
                  requestedInteraction: {
                    interaction: {
                      case: 'permission',
                      value: { resource: { action: 'write_file', target: '/workspace/src/app.ts' } }
                    }
                  }
                }
              }
            ]
          }
        }
      }),
      handleCascadeUserInteraction: async (req: any, opts: any) => {
        dispatchedInteractions.push({ req, opts });
        return { status: 'acknowledged' };
      }
    };

    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: { getRpcClient: async () => mockRpcClient }
    };

    const clickedEvents: any[] = [];
    const stateTransitions: any[] = [];

    const autoSubmit = createIdeAutoSubmit({
      getExtension: id => mockExtensions[id],
      getPolicy: () => ({ enabled: true, patterns: ['Submit'], workspaceUris: [activeWorkspace] }),
      onClick: evt => clickedEvents.push(evt),
      onState: st => stateTransitions.push(st),
      requestTimeoutMs: 2000
    });

    await autoSubmit.tick();

    // 1. Verify single dispatch
    assert.strictEqual(dispatchedInteractions.length, 1, 'Exactly one interaction must be dispatched');
    const { req, opts } = dispatchedInteractions[0];

    // 2. Verify payload structure and explicit scope: 1 (SCOPE_ONCE)
    assert.strictEqual(req.cascadeId, 'cascade-safe');
    assert.strictEqual(req.interaction.trajectoryId, 'traj-safe');
    assert.strictEqual(req.interaction.stepIndex, 2);
    assert.strictEqual(req.interaction.interaction.case, 'permission');
    assert.strictEqual(req.interaction.interaction.value.allow, true);
    assert.strictEqual(req.interaction.interaction.value.scope, SCOPE_ONCE, 'Must strictly enforce scope: ONCE (1)');
    assert.notStrictEqual(req.interaction.interaction.value.scope, 2, 'Must NEVER select persistent or ALWAYS_ALLOW scope');

    // 3. Verify AbortController timeout options passed to RPC call
    assert.ok(opts.signal instanceof AbortSignal, 'Must forward AbortSignal to RPC client');
    assert.strictEqual(opts.timeoutMs, 2000, 'Must forward request timeout bound');

    // 4. Verify telemetry / onClick event
    assert.strictEqual(clickedEvents.length, 1);
    assert.strictEqual(clickedEvents[0].pattern, 'Submit');
    assert.strictEqual(clickedEvents[0].button, 'Submit (IDE permission, allow once)');
    assert.strictEqual(clickedEvents[0].candidate.cascadeId, 'cascade-safe');

    // 5. Verify engine status
    const status = autoSubmit.status();
    assert.strictEqual(status.phase, 'ready');
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.approved, 1);
    assert.strictEqual(status.quarantineSize, 1);

    autoSubmit.dispose();
    console.log('  ✓ 3.1 Dispatches single-grant approval with scope: ONCE and timeout bounds');
  }

  // =========================================================================
  // Group 4: Deduplication & Concurrent Tick Race-Condition Guarding
  // =========================================================================
  console.log('\n--- Group 4: Deduplication & Concurrent Tick Race-Condition Guarding ---');

  // Test 4.1: Repeated poll cycles skip already quarantined candidates
  {
    let handleCalls = 0;
    const trajectoryPayload = {
      trajectorySummaries: {
        'c-dedup': {
          trajectoryId: 't-dedup',
          cascadeId: 'c-dedup',
          workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
          waitingSteps: [
            {
              stepIndex: 0,
              step: {
                status: WAITING,
                metadata: { sourceTrajectoryStepInfo: { cascadeId: 'c-dedup', trajectoryId: 't-dedup', stepIndex: 0 } },
                requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'run', target: 'test' } } } }
              }
            }
          ]
        }
      }
    };

    const mockRpc = {
      getAllCascadeTrajectories: async () => trajectoryPayload,
      handleCascadeUserInteraction: async () => {
        handleCalls++;
        return { status: 'ok' };
      }
    };

    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: { getRpcClient: async () => mockRpc }
    };

    const autoSubmit = createIdeAutoSubmit({
      getExtension: id => mockExtensions[id],
      getPolicy: () => ({ enabled: true, patterns: ['Submit'], workspaceUris: [activeWorkspace] })
    });

    // Tick 1: First submission -> dispatches
    await autoSubmit.tick();
    assert.strictEqual(handleCalls, 1, 'Initial tick must dispatch approval');
    assert.strictEqual(autoSubmit.status().approved, 1);

    // Tick 2: Identical candidate still waiting in IDE -> must be skipped by quarantine cache
    await autoSubmit.tick();
    assert.strictEqual(handleCalls, 1, 'Second tick must NOT re-dispatch already approved candidate');
    assert.strictEqual(autoSubmit.status().approved, 1);

    // Tick 3: Third tick -> still skipped
    await autoSubmit.tick();
    assert.strictEqual(handleCalls, 1);

    autoSubmit.dispose();
    console.log('  ✓ 4.1 Deduplication cache prevents redundant submissions across multiple poll cycles');
  }

  // Test 4.2: Guard against concurrent tick race conditions
  {
    let concurrentDispatches = 0;
    const mockRpc = {
      getAllCascadeTrajectories: async () => ({
        trajectorySummaries: {
          'c-race': {
            trajectoryId: 't-race',
            cascadeId: 'c-race',
            workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
            waitingSteps: [
              {
                stepIndex: 1,
                step: {
                  status: WAITING,
                  metadata: { sourceTrajectoryStepInfo: { cascadeId: 'c-race', trajectoryId: 't-race', stepIndex: 1 } },
                  requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'sh', target: 'pwd' } } } }
                }
              }
            ]
          }
        }
      }),
      handleCascadeUserInteraction: async () => {
        concurrentDispatches++;
        // Simulate async I/O delay to expose race condition if busy guard is absent
        await new Promise(r => setTimeout(r, 20));
        return { status: 'ok' };
      }
    };

    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: { getRpcClient: async () => mockRpc }
    };

    const autoSubmit = createIdeAutoSubmit({
      getExtension: id => mockExtensions[id],
      getPolicy: () => ({ enabled: true, patterns: ['Submit'], workspaceUris: [activeWorkspace] })
    });

    // Trigger multiple simultaneous tick promises
    await Promise.all([
      autoSubmit.tick(),
      autoSubmit.tick(),
      autoSubmit.tick()
    ]);

    assert.strictEqual(concurrentDispatches, 1, 'Busy lock must prevent concurrent duplicate dispatches');
    assert.strictEqual(autoSubmit.status().approved, 1);

    autoSubmit.dispose();
    console.log('  ✓ 4.2 Guards against concurrent tick execution and duplicate submissions');
  }

  // Test 4.3: Ambiguous timeout quarantine prevents loop re-submissions
  {
    let dispatchAttempts = 0;
    const mockRpc = {
      getAllCascadeTrajectories: async () => ({
        trajectorySummaries: {
          'c-timeout': {
            trajectoryId: 't-timeout',
            cascadeId: 'c-timeout',
            workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
            waitingSteps: [
              {
                stepIndex: 0,
                step: {
                  status: WAITING,
                  metadata: { sourceTrajectoryStepInfo: { cascadeId: 'c-timeout', trajectoryId: 't-timeout', stepIndex: 0 } },
                  requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'sh', target: 'sleep 5' } } } }
                }
              }
            ]
          }
        }
      }),
      handleCascadeUserInteraction: async () => {
        dispatchAttempts++;
        throw new Error('request-timeout');
      }
    };

    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: { getRpcClient: async () => mockRpc }
    };

    const autoSubmit = createIdeAutoSubmit({
      getExtension: id => mockExtensions[id],
      getPolicy: () => ({ enabled: true, patterns: ['Submit'], workspaceUris: [activeWorkspace] })
    });

    // First tick throws timeout
    await autoSubmit.tick();
    assert.strictEqual(dispatchAttempts, 1);
    assert.strictEqual(autoSubmit.status().phase, 'retrying');

    // Second tick: because candidate was pre-quarantined before dispatch,
    // ambiguous timeout does not cause tight loop re-submission of the unconfirmed request!
    await autoSubmit.tick();
    assert.strictEqual(dispatchAttempts, 1, 'Ambiguous timeout must remain quarantined to avoid duplicate dispatch');

    autoSubmit.dispose();
    console.log('  ✓ 4.3 Pre-allocation quarantines ambiguous timeouts against repeated re-submission');
  }

  // =========================================================================
  // Group 5: Stale Candidate Drop (Pre-Dispatch Double Check)
  // =========================================================================
  console.log('\n--- Group 5: Stale Candidate Drop (Pre-Dispatch Double Check) ---');

  {
    let getTrajectoriesCallCount = 0;
    let handleCalls = 0;

    const mockRpc = {
      getAllCascadeTrajectories: async () => {
        getTrajectoriesCallCount++;
        if (getTrajectoriesCallCount === 1) {
          // First snapshot: candidate is waiting
          return {
            trajectorySummaries: {
              'c-stale': {
                trajectoryId: 't-stale',
                cascadeId: 'c-stale',
                workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
                waitingSteps: [
                  {
                    stepIndex: 3,
                    step: {
                      status: WAITING,
                      metadata: { sourceTrajectoryStepInfo: { cascadeId: 'c-stale', trajectoryId: 't-stale', stepIndex: 3 } },
                      requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'rm', target: 'temp.txt' } } } }
                    }
                  }
                ]
              }
            }
          };
        } else {
          // Second snapshot (pre-dispatch re-read): candidate disappeared (e.g. user cancelled or step finished)
          return {
            trajectorySummaries: {
              'c-stale': {
                trajectoryId: 't-stale',
                cascadeId: 'c-stale',
                workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
                waitingSteps: [] // Disappeared!
              }
            }
          };
        }
      },
      handleCascadeUserInteraction: async () => {
        handleCalls++;
        return { status: 'ok' };
      }
    };

    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: { getRpcClient: async () => mockRpc }
    };

    let clickFired = false;
    const autoSubmit = createIdeAutoSubmit({
      getExtension: id => mockExtensions[id],
      getPolicy: () => ({ enabled: true, patterns: ['Submit'], workspaceUris: [activeWorkspace] }),
      onClick: () => { clickFired = true; }
    });

    await autoSubmit.tick();

    assert.strictEqual(getTrajectoriesCallCount, 2, 'Must perform immediate pre-dispatch re-read');
    assert.strictEqual(handleCalls, 0, 'Must NOT submit interaction if candidate disappeared in re-read');
    assert.strictEqual(clickFired, false, 'Must NOT emit click event for stale candidate');
    assert.strictEqual(autoSubmit.status().approved, 0);

    autoSubmit.dispose();
    console.log('  ✓ 5.1 Re-reads trajectory state before dispatch and cleanly drops stale candidates');
  }

  // =========================================================================
  // Group 6: Quota Bounding & Session Dormancy
  // =========================================================================
  console.log('\n--- Group 6: Quota Bounding & Session Dormancy ---');

  // Test 6.1: Per-pattern limit enforcement
  {
    let submittedCount = 0;
    let stepIndexCounter = 0;

    const mockRpc = {
      getAllCascadeTrajectories: async () => ({
        trajectorySummaries: {
          'c-limit': {
            trajectoryId: 't-limit',
            cascadeId: 'c-limit',
            workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
            waitingSteps: [
              {
                stepIndex: stepIndexCounter,
                step: {
                  status: WAITING,
                  metadata: { sourceTrajectoryStepInfo: { cascadeId: 'c-limit', trajectoryId: 't-limit', stepIndex: stepIndexCounter } },
                  requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'run', target: `task-${stepIndexCounter}` } } } }
                }
              }
            ]
          }
        }
      }),
      handleCascadeUserInteraction: async () => {
        submittedCount++;
        return { status: 'ok' };
      }
    };

    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: { getRpcClient: async () => mockRpc }
    };

    const autoSubmit = createIdeAutoSubmit({
      getExtension: id => mockExtensions[id],
      getPolicy: () => ({
        enabled: true,
        patterns: ['Submit'],
        workspaceUris: [activeWorkspace],
        limits: { Submit: 1 } // Limit to exactly 1 approval for 'Submit'
      })
    });

    // Tick 1: Submits task-0
    await autoSubmit.tick();
    assert.strictEqual(submittedCount, 1);
    assert.strictEqual(autoSubmit.status().approved, 1);

    // New candidate arrives in trajectory
    stepIndexCounter = 1;

    // Tick 2: Candidate task-1 is pending, but per-pattern limit (1) is reached
    await autoSubmit.tick();
    assert.strictEqual(submittedCount, 1, 'Per-pattern limit must prevent second dispatch');
    assert.strictEqual(autoSubmit.status().approved, 1);

    autoSubmit.dispose();
    console.log('  ✓ 6.1 Enforces per-pattern approval quota limits');
  }

  // Test 6.2: Total session quota exhaustion transitions to dormant state
  {
    let submittedCount = 0;
    let currentStep = 0;

    const mockRpc = {
      getAllCascadeTrajectories: async () => ({
        trajectorySummaries: {
          'c-quota': {
            trajectoryId: 't-quota',
            cascadeId: 'c-quota',
            workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
            waitingSteps: [
              {
                stepIndex: currentStep,
                step: {
                  status: WAITING,
                  metadata: { sourceTrajectoryStepInfo: { cascadeId: 'c-quota', trajectoryId: 't-quota', stepIndex: currentStep } },
                  requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'run', target: `cmd-${currentStep}` } } } }
                }
              }
            ]
          }
        }
      }),
      handleCascadeUserInteraction: async () => {
        submittedCount++;
        return { status: 'ok' };
      }
    };

    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: { getRpcClient: async () => mockRpc }
    };

    let reportedDormant = false;
    const autoSubmit = createIdeAutoSubmit({
      getExtension: id => mockExtensions[id],
      getPolicy: () => ({
        enabled: true,
        patterns: ['Submit'],
        workspaceUris: [activeWorkspace],
        maxQuota: 2 // Max 2 approvals total
      }),
      onState: st => {
        if (st.phase === 'dormant' && st.quotaExhausted) {
          reportedDormant = true;
        }
      }
    });

    // 1st approval
    currentStep = 1;
    await autoSubmit.tick();
    assert.strictEqual(submittedCount, 1);
    assert.strictEqual(autoSubmit.status().approved, 1);
    assert.strictEqual(autoSubmit.status().phase, 'ready');

    // 2nd approval (hits maxQuota: 2)
    currentStep = 2;
    await autoSubmit.tick();
    assert.strictEqual(submittedCount, 2);
    assert.strictEqual(autoSubmit.status().approved, 2);
    assert.strictEqual(autoSubmit.status().phase, 'dormant');
    assert.strictEqual(autoSubmit.status().quotaExhausted, true);
    assert.strictEqual(reportedDormant, true, 'Must report dormant state on quota exhaustion');

    // 3rd tick: should not dispatch anything
    currentStep = 3;
    await autoSubmit.tick();
    assert.strictEqual(submittedCount, 2, 'Further ticks while dormant must not dispatch');
    assert.strictEqual(autoSubmit.status().phase, 'dormant');

    autoSubmit.dispose();
    console.log('  ✓ 6.2 Halts submission and enters dormant state when total session quota is exhausted');
  }

  // =========================================================================
  // Group 7: Adaptive Exponential Backoff & Connection Recovery
  // =========================================================================
  console.log('\n--- Group 7: Adaptive Exponential Backoff & Connection Recovery ---');

  // Test 7.1: calculateBackoffDelay formula and bounds
  {
    assert.strictEqual(calculateBackoffDelay(0, 1000), 1000, 'Zero errors -> base delay');
    assert.strictEqual(calculateBackoffDelay(1, 1000), 2000, '1 error -> 2x base');
    assert.strictEqual(calculateBackoffDelay(2, 1000), 4000, '2 errors -> 4x base');
    assert.strictEqual(calculateBackoffDelay(3, 1000), 8000, '3 errors -> 8x base');
    assert.strictEqual(calculateBackoffDelay(4, 1000), 16000, '4 errors -> 16x base');
    assert.strictEqual(calculateBackoffDelay(5, 1000), 30000, '5 errors -> capped at MAX_BACKOFF_DELAY_MS (30000)');
    assert.strictEqual(calculateBackoffDelay(10, 1000), 30000, '10 errors -> capped at 30000');

    // Interval boundary clamping
    assert.strictEqual(calculateBackoffDelay(0, 50), MIN_POLL_INTERVAL_MS, 'Must clamp below minimum 200ms');
    assert.strictEqual(calculateBackoffDelay(0, 500000), MAX_POLL_INTERVAL_MS, 'Must clamp above maximum 120000ms');
    console.log('  ✓ 7.1 Correctly computes exponential backoff scaling and interval bounds');
  }

  // Test 7.2: Backoff scaling on consecutive RPC errors and recovery
  {
    let mode: 'timeout' | 'disconnect' | 'success' = 'timeout';

    const mockRpc = {
      getAllCascadeTrajectories: async () => {
        if (mode === 'timeout') {
          throw new Error('request-timeout');
        }
        if (mode === 'disconnect') {
          const err: any = new Error('UNAVAILABLE: Socket closed');
          err.code = 14;
          throw err;
        }
        return { trajectorySummaries: {} };
      },
      handleCascadeUserInteraction: async () => ({ status: 'ok' })
    };

    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: { getRpcClient: async () => mockRpc }
    };

    const autoSubmit = createIdeAutoSubmit({
      getExtension: id => mockExtensions[id],
      getPolicy: () => ({ enabled: true, patterns: ['Submit'], workspaceUris: [activeWorkspace], intervalMs: 1000 })
    });

    // Tick 1: Timeout error
    await autoSubmit.tick();
    let status = autoSubmit.status();
    assert.strictEqual(status.phase, 'retrying');
    assert.strictEqual(status.available, false);
    assert.strictEqual(status.lastError, 'timeout');
    assert.strictEqual(status.consecutiveFailures, 1);
    assert.strictEqual(status.currentDelayMs, 2000, 'Backoff after 1 error should be 2000ms');

    // Tick 2: Socket disconnect error (code: 14)
    mode = 'disconnect';
    await autoSubmit.tick();
    status = autoSubmit.status();
    assert.strictEqual(status.phase, 'retrying');
    assert.strictEqual(status.available, false);
    assert.strictEqual(status.lastError, 'rpc-14');
    assert.strictEqual(status.consecutiveFailures, 2);
    assert.strictEqual(status.currentDelayMs, 4000, 'Backoff after 2 errors should be 4000ms');

    // Tick 3: Connection recovers
    mode = 'success';
    await autoSubmit.tick();
    status = autoSubmit.status();
    assert.strictEqual(status.phase, 'ready');
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.lastError, null);
    assert.strictEqual(status.consecutiveFailures, 0);
    assert.strictEqual(status.currentDelayMs, 1000, 'Backoff delay must recover to base interval (1000ms)');

    autoSubmit.dispose();
    console.log('  ✓ 7.2 Backs off exponentially upon RPC errors and recovers to base interval upon reconnection');
  }

  console.log('\n=============================================================');
  console.log('✅ ALL PHASE 02 TESTS PASSED SUCCESSFULLY!');
  console.log('=============================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ [TEST FAILURE]', err);
  process.exit(1);
});

