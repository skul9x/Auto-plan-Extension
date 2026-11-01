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
  normalizeWorkspace,
  belongsToWorkspace,
  acquireRpcClient,
  discoverRpcClient,
  computePayloadFingerprint,
  extractPermissionCandidates,
  candidates,
  getActiveWorkspaceUris,
  createIdeAutoSubmit
} from '../antigravityRpcAutoSubmit';

async function runTests() {
  console.log('=== [TEST SUITE] Phase 01: Core RPC Discovery, Trajectory Traversal & Candidate Filtering ===\n');

  // =========================================================================
  // Group 1: Built-in Extension Acquisition & Health Guarding
  // =========================================================================
  console.log('--- Group 1: Built-in Extension Acquisition & Health Guarding ---');

  // Test 1.1: Extension missing ('legacy' state)
  {
    mockExtensions = {};
    const res = await acquireRpcClient();
    assert.strictEqual(res.state, 'legacy', 'Missing extension should report legacy');
    assert.strictEqual(res.client, null, 'Client should be null');
    assert.strictEqual(res.available, false, 'Available should be false');
    assert.ok(res.error?.includes(BUILTIN_EXTENSION_ID), 'Error should reference extension ID');
    console.log('  ✓ 1.1 Handles missing extension gracefully (legacy)');
  }

  // Test 1.2: Extension installed but unactivated ('waiting' state)
  {
    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: false,
      exports: null
    };
    const res = await acquireRpcClient();
    assert.strictEqual(res.state, 'waiting', 'Inactive extension should report waiting');
    assert.strictEqual(res.client, null, 'Client should be null');
    assert.strictEqual(res.available, false, 'Available should be false');
    console.log('  ✓ 1.2 Handles unactivated extension gracefully (waiting)');
  }

  // Test 1.3: Extension active but exports missing getRpcClient ('unsupported' state)
  {
    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: {}
    };
    const res = await acquireRpcClient();
    assert.strictEqual(res.state, 'unsupported', 'Missing getRpcClient export should report unsupported');
    assert.strictEqual(res.client, null, 'Client should be null');
    console.log('  ✓ 1.3 Handles active extension missing getRpcClient (unsupported)');
  }

  // Test 1.4: getRpcClient returns client missing required RPC methods
  {
    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: {
        getRpcClient: async () => ({
          getAllCascadeTrajectories: () => {}
          // missing handleCascadeUserInteraction
        })
      }
    };
    const res = await acquireRpcClient();
    assert.strictEqual(res.state, 'unsupported', 'RPC client missing handleCascadeUserInteraction should report unsupported');
    assert.strictEqual(res.client, null);
    console.log('  ✓ 1.4 Rejects RPC client missing handleCascadeUserInteraction (unsupported)');
  }

  // Test 1.5: getRpcClient throws / rejects
  {
    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: {
        getRpcClient: async () => {
          throw new Error('Internal RPC Socket Failed');
        }
      }
    };
    const res = await acquireRpcClient();
    assert.strictEqual(res.state, 'unsupported', 'Thrown error during getRpcClient should report unsupported');
    assert.ok(res.error?.includes('Internal RPC Socket Failed'), 'Error should be captured');
    console.log('  ✓ 1.5 Captures getRpcClient rejection without throwing uncaught exceptions');
  }

  // Test 1.6: Acquisition timeout enforcement
  {
    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: {
        getRpcClient: () => new Promise(resolve => setTimeout(resolve, 500))
      }
    };
    const res = await acquireRpcClient(undefined, 50); // 50ms timeout
    assert.strictEqual(res.state, 'unsupported', 'Slow getRpcClient should timeout gracefully');
    assert.ok(res.error?.includes('timed out'), 'Error should report timeout');
    console.log('  ✓ 1.6 Enforces strict timeout bounds on RPC client acquisition');
  }

  // Test 1.7: Successful acquisition ('ready' state)
  {
    const mockRpcClient = {
      getAllCascadeTrajectories: async () => ({ trajectorySummaries: {} }),
      handleCascadeUserInteraction: async () => ({ status: 'ok' })
    };
    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: {
        getRpcClient: async () => mockRpcClient
      }
    };
    const res = await discoverRpcClient();
    assert.strictEqual(res.state, 'ready', 'Valid RPC client should report ready');
    assert.strictEqual(res.available, true, 'Available should be true');
    assert.strictEqual(res.error, null, 'Error should be null');
    assert.strictEqual(res.client, mockRpcClient, 'Returned client should match export');
    console.log('  ✓ 1.7 Successfully acquires RPC client in ready state');
  }

  // =========================================================================
  // Group 2: Cross-Platform Workspace URI Normalization
  // =========================================================================
  console.log('\n--- Group 2: Cross-Platform Workspace URI Normalization ---');

  // Test 2.1: POSIX paths and file URIs
  {
    const uri1 = 'file:///home/skul9x/project';
    const uri2 = 'file:///home/skul9x/project/';
    const uri3 = '/home/skul9x/project/';
    assert.strictEqual(normalizeWorkspace(uri1), 'file:///home/skul9x/project');
    assert.strictEqual(normalizeWorkspace(uri2), 'file:///home/skul9x/project');
    assert.strictEqual(normalizeWorkspace(uri3), 'file:///home/skul9x/project');
    console.log('  ✓ 2.1 Normalizes POSIX paths, trailing slashes and file:// URIs');
  }

  // Test 2.2: Windows paths and drive letters (casing insensitivity)
  {
    const win1 = 'file:///C:/Users/skul9x/workspace';
    const win2 = 'file:///c:/Users/skul9x/workspace/';
    const win3 = 'C:\\Users\\skul9x\\workspace\\';
    const win4 = 'c:/Users/skul9x/workspace';
    const win5 = 'file://c:/Users/skul9x/workspace';
    const expected = 'file:///c:/Users/skul9x/workspace';

    assert.strictEqual(normalizeWorkspace(win1), expected);
    assert.strictEqual(normalizeWorkspace(win2), expected);
    assert.strictEqual(normalizeWorkspace(win3), expected);
    assert.strictEqual(normalizeWorkspace(win4), expected);
    assert.strictEqual(normalizeWorkspace(win5), expected);
    console.log('  ✓ 2.2 Normalizes Windows paths, drive letter casing and backslashes');
  }

  // Test 2.3: vscode-remote URIs
  {
    const remote1 = 'vscode-remote://ssh-remote%2Bhost.corp.internal/home/skul9x/dev/';
    const remote2 = 'vscode-remote://SSH-REMOTE%2BHOST.CORP.INTERNAL/home/skul9x/dev';
    const expected = 'vscode-remote://ssh-remote%2bhost.corp.internal/home/skul9x/dev';

    assert.strictEqual(normalizeWorkspace(remote1), expected);
    assert.strictEqual(normalizeWorkspace(remote2), expected);
    console.log('  ✓ 2.3 Normalizes vscode-remote:// URIs with case-insensitive authorities');
  }

  // Test 2.4: Invalid or non-file/remote URIs
  {
    assert.strictEqual(normalizeWorkspace('http://example.com/foo'), '');
    assert.strictEqual(normalizeWorkspace('ftp://files.org/bar'), '');
    assert.strictEqual(normalizeWorkspace(''), '');
    assert.strictEqual(normalizeWorkspace(null as any), '');
    assert.strictEqual(normalizeWorkspace(undefined as any), '');
    console.log('  ✓ 2.4 Safely rejects invalid, unsupported, or non-string URIs');
  }

  // =========================================================================
  // Group 3: Strict Workspace Boundary Isolation
  // =========================================================================
  console.log('\n--- Group 3: Strict Workspace Boundary Isolation ---');

  {
    const activeFolders = ['file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main'];

    // Summary with matching workspaceFolderAbsoluteUri
    const summaryMatch = {
      workspaces: [
        { workspaceFolderAbsoluteUri: 'file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main/' }
      ]
    };
    assert.strictEqual(belongsToWorkspace(summaryMatch, activeFolders), true);

    // Summary with matching trajectoryMetadata
    const summaryMetadataMatch = {
      workspaces: [],
      trajectoryMetadata: {
        workspaceUris: ['file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main']
      }
    };
    assert.strictEqual(belongsToWorkspace(summaryMetadataMatch, activeFolders), true);

    // Summary belonging to another workspace / closed project
    const summaryOther = {
      workspaces: [
        { workspaceFolderAbsoluteUri: 'file:///home/skul9x/Desktop/Code/OtherProject' }
      ]
    };
    assert.strictEqual(belongsToWorkspace(summaryOther, activeFolders), false);

    // Empty or missing summaries
    assert.strictEqual(belongsToWorkspace(null, activeFolders), false);
    assert.strictEqual(belongsToWorkspace({}, []), false);
    assert.strictEqual(belongsToWorkspace({}, activeFolders), false);

    console.log('  ✓ 3.1 Accurately isolates active workspace folders and rejects foreign workspaces');
  }

  // =========================================================================
  // Group 4: Trajectory Validation & Waiting Step Filtering
  // =========================================================================
  console.log('\n--- Group 4: Trajectory Validation & Waiting Step Filtering ---');

  const activeWorkspace = 'file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main';
  const policy = { enabled: true, patterns: ['Submit'], workspaceUris: [activeWorkspace] };

  // Test 4.1: Mixed synthetic payload
  {
    const payload = {
      trajectorySummaries: {
        // 1. Valid waiting permission
        'cascade-01': {
          trajectoryId: 'traj-01',
          cascadeId: 'cascade-01',
          killed: false,
          annotations: { archived: false },
          workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
          waitingSteps: [
            {
              stepIndex: 1,
              step: {
                status: WAITING, // 9
                metadata: {
                  sourceTrajectoryStepInfo: {
                    cascadeId: 'cascade-01',
                    trajectoryId: 'traj-01',
                    stepIndex: 1
                  }
                },
                requestedInteraction: {
                  interaction: {
                    case: 'permission',
                    value: {
                      resource: {
                        action: 'run_command',
                        target: 'npm test'
                      }
                    }
                  }
                }
              }
            }
          ]
        },

        // 2. Killed trajectory (must be ignored)
        'cascade-killed': {
          trajectoryId: 'traj-killed',
          cascadeId: 'cascade-killed',
          killed: true,
          workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
          waitingSteps: [
            {
              stepIndex: 0,
              step: {
                status: WAITING,
                metadata: { sourceTrajectoryStepInfo: { cascadeId: 'cascade-killed', trajectoryId: 'traj-killed', stepIndex: 0 } },
                requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'exec', target: 'ls' } } } }
              }
            }
          ]
        },

        // 3. Archived trajectory (must be ignored)
        'cascade-archived': {
          trajectoryId: 'traj-archived',
          cascadeId: 'cascade-archived',
          annotations: { archived: true },
          workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
          waitingSteps: [
            {
              stepIndex: 0,
              step: {
                status: WAITING,
                metadata: { sourceTrajectoryStepInfo: { cascadeId: 'cascade-archived', trajectoryId: 'traj-archived', stepIndex: 0 } },
                requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'exec', target: 'ls' } } } }
              }
            }
          ]
        },

        // 4. Cascade ID mismatch (must be ignored)
        'cascade-key': {
          trajectoryId: 'traj-mismatch',
          cascadeId: 'cascade-different-id',
          workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
          waitingSteps: [
            {
              stepIndex: 0,
              step: {
                status: WAITING,
                metadata: { sourceTrajectoryStepInfo: { cascadeId: 'cascade-key', trajectoryId: 'traj-mismatch', stepIndex: 0 } },
                requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'exec', target: 'ls' } } } }
              }
            }
          ]
        },

        // 5. Foreign workspace (must be ignored)
        'cascade-foreign': {
          trajectoryId: 'traj-foreign',
          cascadeId: 'cascade-foreign',
          workspaces: [{ workspaceFolderAbsoluteUri: 'file:///some/other/workspace' }],
          waitingSteps: [
            {
              stepIndex: 0,
              step: {
                status: WAITING,
                metadata: { sourceTrajectoryStepInfo: { cascadeId: 'cascade-foreign', trajectoryId: 'traj-foreign', stepIndex: 0 } },
                requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'exec', target: 'ls' } } } }
              }
            }
          ]
        }
      }
    };

    const results = candidates(payload, policy);
    assert.strictEqual(results.length, 1, 'Only valid active workspace candidate should be extracted');
    assert.strictEqual(results[0].cascadeId, 'cascade-01');
    assert.strictEqual(results[0].trajectoryId, 'traj-01');
    assert.strictEqual(results[0].stepIndex, 1);
    assert.strictEqual(results[0].pattern, 'Submit');
    assert.strictEqual(results[0].resource.action, 'run_command');
    assert.strictEqual(results[0].resource.target, 'npm test');
    console.log('  ✓ 4.1 Correctly ignores killed, archived, mismatched and foreign trajectories');
  }

  // Test 4.2: Step lineage and stepIndex integrity validation
  {
    const payload = {
      trajectorySummaries: {
        'cascade-lineage': {
          trajectoryId: 'traj-lineage',
          cascadeId: 'cascade-lineage',
          workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
          waitingSteps: [
            // Status not waiting (e.g. 4 - completed)
            {
              stepIndex: 0,
              step: {
                status: 4, // Not WAITING
                metadata: { sourceTrajectoryStepInfo: { cascadeId: 'cascade-lineage', trajectoryId: 'traj-lineage', stepIndex: 0 } },
                requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'exec', target: 'ls' } } } }
              }
            },
            // Missing sourceTrajectoryStepInfo (orphaned)
            {
              stepIndex: 1,
              step: {
                status: WAITING,
                metadata: {},
                requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'exec', target: 'ls' } } } }
              }
            },
            // Mismatched source stepIndex
            {
              stepIndex: 2,
              step: {
                status: WAITING,
                metadata: { sourceTrajectoryStepInfo: { cascadeId: 'cascade-lineage', trajectoryId: 'traj-lineage', stepIndex: 99 } },
                requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'exec', target: 'ls' } } } }
              }
            },
            // Duplicate stepIndex (only one should be evaluated)
            {
              stepIndex: 3,
              step: {
                status: WAITING,
                metadata: { sourceTrajectoryStepInfo: { cascadeId: 'cascade-lineage', trajectoryId: 'traj-lineage', stepIndex: 3 } },
                requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'write_file', target: 'test.ts' } } } }
              }
            },
            {
              stepIndex: 3, // Duplicate
              step: {
                status: WAITING,
                metadata: { sourceTrajectoryStepInfo: { cascadeId: 'cascade-lineage', trajectoryId: 'traj-lineage', stepIndex: 3 } },
                requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'write_file', target: 'test.ts' } } } }
              }
            }
          ]
        }
      }
    };

    const results = candidates(payload, policy);
    assert.strictEqual(results.length, 1, 'Only step 3 should pass lineage and deduplication');
    assert.strictEqual(results[0].stepIndex, 3);
    assert.strictEqual(results[0].resource.action, 'write_file');
    console.log('  ✓ 4.2 Validates step status, lineage metadata, and stepIndex integrity');
  }

  // =========================================================================
  // Group 5: Selective Actionable Permission Candidate Extraction
  // =========================================================================
  console.log('\n--- Group 5: Selective Actionable Permission Candidate Extraction ---');

  {
    const payload = {
      trajectorySummaries: {
        'cascade-discrim': {
          trajectoryId: 'traj-discrim',
          cascadeId: 'cascade-discrim',
          workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
          waitingSteps: [
            // 1. Interactive question (ask_question) -> must be rejected
            {
              stepIndex: 0,
              step: {
                status: WAITING,
                metadata: {
                  sourceTrajectoryStepInfo: { cascadeId: 'cascade-discrim', trajectoryId: 'traj-discrim', stepIndex: 0 },
                  toolCall: { name: 'ask_question' }
                },
                requestedInteraction: {
                  interaction: {
                    case: 'question',
                    value: { prompt: 'Proceed with refactoring?' }
                  }
                }
              }
            },

            // 2. Interactive permission prompt (ask_permission toolCall) -> must be rejected
            {
              stepIndex: 1,
              step: {
                status: WAITING,
                metadata: {
                  sourceTrajectoryStepInfo: { cascadeId: 'cascade-discrim', trajectoryId: 'traj-discrim', stepIndex: 1 },
                  toolCall: { name: 'ask_permission' }
                },
                requestedInteraction: {
                  interaction: {
                    case: 'permission',
                    value: { resource: { action: 'delete_file', target: 'foo.ts' } }
                  }
                }
              }
            },

            // 3. Diff confirmation -> must be rejected
            {
              stepIndex: 2,
              step: {
                status: WAITING,
                metadata: {
                  sourceTrajectoryStepInfo: { cascadeId: 'cascade-discrim', trajectoryId: 'traj-discrim', stepIndex: 2 }
                },
                requestedInteraction: {
                  interaction: {
                    case: 'diff',
                    value: { file: 'foo.ts' }
                  }
                }
              }
            },

            // 4. Missing resource target -> must be rejected
            {
              stepIndex: 3,
              step: {
                status: WAITING,
                metadata: {
                  sourceTrajectoryStepInfo: { cascadeId: 'cascade-discrim', trajectoryId: 'traj-discrim', stepIndex: 3 }
                },
                requestedInteraction: {
                  interaction: {
                    case: 'permission',
                    value: { resource: { action: 'run_command', target: '' } }
                  }
                }
              }
            },

            // 5. Valid actionable permission card -> MUST BE EXTRACTED
            {
              stepIndex: 4,
              step: {
                status: WAITING,
                metadata: {
                  sourceTrajectoryStepInfo: { cascadeId: 'cascade-discrim', trajectoryId: 'traj-discrim', stepIndex: 4 }
                },
                requestedInteraction: {
                  interaction: {
                    case: 'permission',
                    value: {
                      resource: {
                        action: 'edit_file',
                        target: '/home/skul9x/project/src/main.ts'
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

    const results = candidates(payload, policy);
    assert.strictEqual(results.length, 1, 'Only actionable permission approval card should be extracted');
    const c = results[0];
    assert.strictEqual(c.stepIndex, 4);
    assert.strictEqual(c.pattern, 'Submit');
    assert.strictEqual(c.resource.action, 'edit_file');
    assert.strictEqual(c.resource.target, '/home/skul9x/project/src/main.ts');

    // Assert submission request formatting
    assert.strictEqual(c.request.cascadeId, 'cascade-discrim');
    assert.strictEqual(c.request.interaction.trajectoryId, 'traj-discrim');
    assert.strictEqual(c.request.interaction.stepIndex, 4);
    assert.strictEqual(c.request.interaction.interaction.case, 'permission');
    assert.strictEqual(c.request.interaction.interaction.value.allow, true);
    assert.strictEqual(c.request.interaction.interaction.value.scope, SCOPE_ONCE); // 1 = ONCE

    // Assert SHA-256 fingerprinting
    assert.strictEqual(typeof c.fingerprint, 'string');
    assert.strictEqual(c.fingerprint.length, 64, 'SHA-256 hex string should be 64 chars');
    assert.strictEqual(c.key, `cascade-discrim:traj-discrim:4:${c.fingerprint}`);

    console.log('  ✓ 5.1 Discriminates between automated permission approvals and interactive questionnaires');
  }

  // Test 5.2: Direct workspace URI array parameter support
  {
    const payload = {
      trajectorySummaries: {
        'c-direct': {
          trajectoryId: 't-direct',
          cascadeId: 'c-direct',
          workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
          waitingSteps: [
            {
              stepIndex: 0,
              step: {
                status: WAITING,
                metadata: { sourceTrajectoryStepInfo: { cascadeId: 'c-direct', trajectoryId: 't-direct', stepIndex: 0 } },
                requestedInteraction: { interaction: { case: 'permission', value: { resource: { action: 'run', target: 'bash' } } } }
              }
            }
          ]
        }
      }
    };

    const res = extractPermissionCandidates(payload, [activeWorkspace]);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].cascadeId, 'c-direct');
    console.log('  ✓ 5.2 Supports passing direct workspace URI array as candidate policy');
  }

  // =========================================================================
  // Group 6: ideAutoSubmit End-to-End Orchestrator Integration
  // =========================================================================
  console.log('\n--- Group 6: ideAutoSubmit End-to-End Orchestrator Integration ---');

  {
    let handleCalls: any[] = [];
    const mockRpcClient = {
      getAllCascadeTrajectories: async () => ({
        trajectorySummaries: {
          'c-auto': {
            trajectoryId: 't-auto',
            cascadeId: 'c-auto',
            workspaces: [{ workspaceFolderAbsoluteUri: activeWorkspace }],
            waitingSteps: [
              {
                stepIndex: 1,
                step: {
                  status: WAITING,
                  metadata: { sourceTrajectoryStepInfo: { cascadeId: 'c-auto', trajectoryId: 't-auto', stepIndex: 1 } },
                  requestedInteraction: {
                    interaction: {
                      case: 'permission',
                      value: { resource: { action: 'run_command', target: 'git status' } }
                    }
                  }
                }
              }
            ]
          }
        }
      }),
      handleCascadeUserInteraction: async (req: any) => {
        handleCalls.push(req);
        return { status: 'acknowledged' };
      }
    };

    mockExtensions[BUILTIN_EXTENSION_ID] = {
      id: BUILTIN_EXTENSION_ID,
      isActive: true,
      exports: {
        getRpcClient: async () => mockRpcClient
      }
    };

    let submittedEvents: any[] = [];
    const autoSubmit = createIdeAutoSubmit({
      getExtension: (id: string) => mockExtensions[id],
      getPolicy: () => ({ enabled: true, patterns: ['Submit'], workspaceUris: [activeWorkspace] }),
      onClick: evt => submittedEvents.push(evt)
    });

    await autoSubmit.tick();

    assert.strictEqual(handleCalls.length, 1, 'handleCascadeUserInteraction should be invoked once');
    assert.strictEqual(handleCalls[0].cascadeId, 'c-auto');
    assert.strictEqual(handleCalls[0].interaction.interaction.value.allow, true);
    assert.strictEqual(handleCalls[0].interaction.interaction.value.scope, 1); // ONCE

    assert.strictEqual(submittedEvents.length, 1, 'onClick event should be fired');
    assert.strictEqual(submittedEvents[0].pattern, 'Submit');

    const status = autoSubmit.status();
    assert.strictEqual(status.phase, 'ready');
    assert.strictEqual(status.available, true);
    assert.strictEqual(status.approved, 1);
    assert.strictEqual(status.eligiblePermissions, 1);

    autoSubmit.dispose();
    console.log('  ✓ 6.1 ideAutoSubmit tick successfully submits permission approval with scope: ONCE');
  }

  console.log('\n=============================================================');
  console.log('✅ ALL PHASE 01 TESTS PASSED SUCCESSFULLY!');
  console.log('=============================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ [TEST FAILURE]', err);
  process.exit(1);
});

