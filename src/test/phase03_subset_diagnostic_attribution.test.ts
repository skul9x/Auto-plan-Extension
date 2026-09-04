// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      Uri: {
        file: (f: string) => ({ fsPath: f }),
        joinPath: (...args: any[]) => ({ fsPath: args.join('/') })
      },
      WebviewViewProvider: class {},
      window: {
        showWarningMessage: () => {},
        showInformationMessage: () => {},
        showErrorMessage: () => {}
      },
      commands: {
        executeCommand: async () => {}
      },
      workspace: {
        workspaceFolders: []
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
  auditPlanPhases,
  auditPlanPhasesAsync,
  PhaseExecutionContext
} from '../planScanner';

async function runPhase03SubsetDiagnosticAttributionTests() {
  console.log('=== Running Phase 03: Subset Diagnostic Attribution Test (LOGIC-010) ===\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-subset-test-'));

  try {
    // 1. Create mock workspace plan directory containing 5 phase files
    const phaseFiles = [
      { name: 'phase-01-setup.md', content: '# Phase 01: Setup\n\nStatus: ⬜ Pending\n\nContent' },
      { name: 'phase-02-database.md', content: '# Phase 02: Database\n\nStatus: ⬜ Pending\n\nContent' },
      { name: 'phase-03-backend.md', content: '# Phase 03: Backend\n\nStatus: ⬜ Pending\n\nContent' },
      { name: 'phase-04-frontend.md', content: '# Phase 04: Frontend\n\nStatus: ⬜ Pending\n\nContent' },
      { name: 'phase-05-testing.md', content: '# Phase 05: Testing\n\nStatus: ⬜ Pending\n\nContent' }
    ];

    for (const pf of phaseFiles) {
      fs.writeFileSync(path.join(tmpDir, pf.name), pf.content, 'utf8');
    }

    // 2. Construct executionContext representing subset run: only Phase 3 running and Phase 5 queued
    // Orchestrator local activePhases index 0 = Phase 3, index 1 = Phase 5
    const executionContext: PhaseExecutionContext = {
      selectedIndices: new Set([2, 4]),
      orchestratorState: 'running',
      activePhases: [
        {
          index: 0, // Orchestrator local array index 0 (Phase 3)
          phaseNumber: 1,
          fileName: 'phase-03-backend.md',
          status: 'Running',
          startTime: Date.now(),
          conversationId: 'conv-phase-3'
        },
        {
          index: 1, // Orchestrator local array index 1 (Phase 5)
          phaseNumber: 2,
          fileName: 'phase-05-testing.md',
          status: 'Pending'
        }
      ]
    };

    // 3. Test Synchronous auditPlanPhases
    console.log('[Test 1] Testing synchronous auditPlanPhases with subset execution context...');
    const syncReport = auditPlanPhases(tmpDir, executionContext);

    assert.strictEqual(syncReport.phases.length, 5, 'Must report all 5 discovered phases');

    // Phase 1 (idx 0): unselected phase must NOT inherit Phase 3's Running status or metadata
    assert.strictEqual(syncReport.phases[0].fileName, 'phase-01-setup.md');
    assert.notStrictEqual(syncReport.phases[0].status, 'Running', 'Phase 1 must not inherit Running status from activePhase 0');
    assert.ok(
      syncReport.phases[0].status === 'Pending' || syncReport.phases[0].status === 'Skipped',
      'Phase 1 must retain non-running status (Pending or Skipped)'
    );
    assert.strictEqual(syncReport.phases[0].conversationId, undefined, 'Phase 1 must not have conversationId');
    assert.strictEqual(syncReport.phases[0].isSelected, false, 'Phase 1 must not be selected');

    // Phase 2 (idx 1): unselected phase must NOT inherit Phase 5's metadata
    assert.strictEqual(syncReport.phases[1].fileName, 'phase-02-database.md');
    assert.notStrictEqual(syncReport.phases[1].status, 'Running', 'Phase 2 must not be Running');
    assert.ok(
      syncReport.phases[1].status === 'Pending' || syncReport.phases[1].status === 'Skipped',
      'Phase 2 must retain non-running status (Pending or Skipped)'
    );
    assert.strictEqual(syncReport.phases[1].isSelected, false, 'Phase 2 must not be selected');

    // Phase 3 (idx 2): must match activePhase by fileName even though its directory index is 2 and ap.index is 0
    assert.strictEqual(syncReport.phases[2].fileName, 'phase-03-backend.md');
    assert.strictEqual(syncReport.phases[2].status, 'Running', 'Phase 3 must be Running');
    assert.strictEqual(syncReport.phases[2].conversationId, 'conv-phase-3', 'Phase 3 must receive conversationId');
    assert.strictEqual(syncReport.phases[2].isSelected, true, 'Phase 3 must be selected');

    // Phase 4 (idx 3): unselected phase
    assert.strictEqual(syncReport.phases[3].fileName, 'phase-04-frontend.md');
    assert.strictEqual(syncReport.phases[3].isSelected, false, 'Phase 4 must not be selected');

    // Phase 5 (idx 4): selected queued phase
    assert.strictEqual(syncReport.phases[4].fileName, 'phase-05-testing.md');
    assert.strictEqual(syncReport.phases[4].status, 'Pending', 'Phase 5 must have status Pending');
    assert.strictEqual(syncReport.phases[4].isSelected, true, 'Phase 5 must be selected');

    console.log('✓ Synchronous auditPlanPhases passed.');

    // 4. Test Asynchronous auditPlanPhasesAsync
    console.log('[Test 2] Testing asynchronous auditPlanPhasesAsync with subset execution context...');
    const asyncReport = await auditPlanPhasesAsync(tmpDir, executionContext);

    assert.strictEqual(asyncReport.phases.length, 5, 'Must report all 5 discovered phases');

    // Phase 1 (idx 0)
    assert.strictEqual(asyncReport.phases[0].fileName, 'phase-01-setup.md');
    assert.notStrictEqual(asyncReport.phases[0].status, 'Running', 'Phase 1 must not inherit Running status');
    assert.ok(
      asyncReport.phases[0].status === 'Pending' || asyncReport.phases[0].status === 'Skipped',
      'Phase 1 must retain non-running status (Pending or Skipped)'
    );
    assert.strictEqual(asyncReport.phases[0].conversationId, undefined, 'Phase 1 must not have conversationId');
    assert.strictEqual(asyncReport.phases[0].isSelected, false, 'Phase 1 must not be selected');

    // Phase 2 (idx 1)
    assert.strictEqual(asyncReport.phases[1].fileName, 'phase-02-database.md');
    assert.notStrictEqual(asyncReport.phases[1].status, 'Running', 'Phase 2 must not be Running');
    assert.ok(
      asyncReport.phases[1].status === 'Pending' || asyncReport.phases[1].status === 'Skipped',
      'Phase 2 must retain non-running status (Pending or Skipped)'
    );
    assert.strictEqual(asyncReport.phases[1].isSelected, false, 'Phase 2 must not be selected');

    // Phase 3 (idx 2)
    assert.strictEqual(asyncReport.phases[2].fileName, 'phase-03-backend.md');
    assert.strictEqual(asyncReport.phases[2].status, 'Running', 'Phase 3 must be Running');
    assert.strictEqual(asyncReport.phases[2].conversationId, 'conv-phase-3', 'Phase 3 must receive conversationId');
    assert.strictEqual(asyncReport.phases[2].isSelected, true, 'Phase 3 must be selected');

    // Phase 4 (idx 3)
    assert.strictEqual(asyncReport.phases[3].fileName, 'phase-04-frontend.md');
    assert.strictEqual(asyncReport.phases[3].isSelected, false, 'Phase 4 must not be selected');

    // Phase 5 (idx 4)
    assert.strictEqual(asyncReport.phases[4].fileName, 'phase-05-testing.md');
    assert.strictEqual(asyncReport.phases[4].status, 'Pending', 'Phase 5 must have status Pending');
    assert.strictEqual(asyncReport.phases[4].isSelected, true, 'Phase 5 must be selected');

    console.log('✓ Asynchronous auditPlanPhasesAsync passed.');

    // 5. Test Static Inspection when no selectedIndices are specified (unselected retaining Pending)
    console.log('[Test 3] Testing static Pending retention when selectedIndices is not filtering...');
    const noSelectionContext: PhaseExecutionContext = {
      activePhases: [
        {
          index: 0,
          fileName: 'phase-03-backend.md',
          status: 'Running',
          conversationId: 'conv-phase-3'
        }
      ]
    };
    const noSelReport = await auditPlanPhasesAsync(tmpDir, noSelectionContext);
    assert.strictEqual(noSelReport.phases[0].status, 'Pending', 'Phase 1 must be Pending when not filtered by selectedIndices');
    assert.strictEqual(noSelReport.phases[0].conversationId, undefined, 'Phase 1 must not inherit conversationId');
    assert.strictEqual(noSelReport.phases[2].status, 'Running', 'Phase 3 must be Running');
    assert.strictEqual(noSelReport.phases[2].conversationId, 'conv-phase-3', 'Phase 3 must have conversationId');

    console.log('✓ Static Pending retention test passed.');

    // 6. Test Failure attribution: When Phase 3 fails, Phase 1 must NOT fail
    console.log('[Test 4] Testing failure attribution: Phase 3 failure must not be mapped to Phase 1...');
    const failedExecutionContext: PhaseExecutionContext = {
      selectedIndices: [2, 4],
      orchestratorState: 'idle',
      activePhases: [
        {
          index: 0,
          fileName: 'phase-03-backend.md',
          filePath: path.join(tmpDir, 'phase-03-backend.md'),
          status: 'Failed',
          error: 'Syntax error in backend logic',
          conversationId: 'conv-phase-3'
        }
      ]
    };

    const failureReport = await auditPlanPhasesAsync(tmpDir, failedExecutionContext);
    assert.notStrictEqual(failureReport.phases[0].status, 'Failed', 'Phase 1 must NOT be marked Failed');
    assert.strictEqual(failureReport.phases[0].error, undefined, 'Phase 1 must NOT have error message');
    assert.strictEqual(failureReport.phases[2].status, 'Failed', 'Phase 3 MUST be marked Failed');
    assert.strictEqual(failureReport.phases[2].error, 'Syntax error in backend logic', 'Phase 3 must have the error message');

    console.log('✓ Failure attribution passed.');

    console.log('\nAll Phase 03 Subset Diagnostic Attribution tests passed successfully!');
  } finally {
    // Clean up temporary test files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}

runPhase03SubsetDiagnosticAttributionTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
