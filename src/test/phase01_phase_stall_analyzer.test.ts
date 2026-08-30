// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_k: string, defaultValue: any) => defaultValue,
          update: async () => {}
        })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      window: {
        createOutputChannel: () => ({
          appendLine: () => {},
          show: () => {},
          dispose: () => {}
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
  PhaseStallCode,
  PhaseStallReason,
  PhaseDiagnosticInfo,
  PlanPhasesAuditReport,
  PhaseExecutionContext,
  inspectPhaseHeader,
  inspectPhaseHeaderAsync,
  analyzePhaseStallReason,
  auditPlanPhases,
  auditPlanPhasesAsync,
  scanPlanFolder,
  detectPhaseStatus
} from '../planScanner';
import {
  PhaseStallCode as LoggerStallCode,
  auditPlanPhases as loggerAuditPlanPhases
} from '../debugLogger';

async function runPhase01StallAnalyzerTests() {
  console.log('=== Running Phase 01: Phase Inspection & Stall Reason Analyzer Engine Tests ===\n');

  const testBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase01-stall-test-'));

  try {
    // ----------------------------------------------------------------------
    // Test 1: Header Inspection & Detection (Completed, Pending, Malformed)
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying inspectPhaseHeader and inspectPhaseHeaderAsync...');

    const fileCompleted = path.join(testBaseDir, 'phase-01-completed.md');
    fs.writeFileSync(fileCompleted, '# Phase 01\n\nStatus: ✅ Completed\n\nTask details.', 'utf8');

    const filePending = path.join(testBaseDir, 'phase-02-pending.md');
    fs.writeFileSync(filePending, '# Phase 02\n\nStatus: ⬜ Pending\n\nTask details.', 'utf8');

    const fileMalformed = path.join(testBaseDir, 'phase-03-malformed.md');
    fs.writeFileSync(fileMalformed, '# Phase 03\n\nStatus: ❓ UnknownStatusHeader\n\nTask details.', 'utf8');

    const fileNoHeader = path.join(testBaseDir, 'phase-04-noheader.md');
    fs.writeFileSync(fileNoHeader, '# Phase 04\n\nNo status header declared in file.', 'utf8');

    // Sync inspection
    const insCompleted = inspectPhaseHeader(fileCompleted);
    assert.strictEqual(insCompleted.status, 'Completed');
    assert.strictEqual(insCompleted.code, 'COMPLETED');
    assert.strictEqual(insCompleted.hasStatusHeader, true);
    assert.strictEqual(insCompleted.headerSyntaxValid, true);

    const insPending = inspectPhaseHeader(filePending);
    assert.strictEqual(insPending.status, 'Pending');
    assert.strictEqual(insPending.code, 'HEADER_STATUS_PENDING');
    assert.strictEqual(insPending.hasStatusHeader, true);
    assert.strictEqual(insPending.headerSyntaxValid, true);

    const insMalformed = inspectPhaseHeader(fileMalformed);
    assert.strictEqual(insMalformed.status, 'Unrecognized');
    assert.strictEqual(insMalformed.code, 'UNRECOGNIZED_HEADER_SYNTAX');
    assert.strictEqual(insMalformed.hasStatusHeader, true);
    assert.strictEqual(insMalformed.headerSyntaxValid, false);

    const insNoHeader = inspectPhaseHeader(fileNoHeader);
    assert.strictEqual(insNoHeader.status, 'Pending');
    assert.strictEqual(insNoHeader.code, 'HEADER_STATUS_PENDING');
    assert.strictEqual(insNoHeader.hasStatusHeader, false);

    // Async inspection
    const insAsyncComp = await inspectPhaseHeaderAsync(fileCompleted);
    assert.strictEqual(insAsyncComp.code, 'COMPLETED');

    const insAsyncMal = await inspectPhaseHeaderAsync(fileMalformed);
    assert.strictEqual(insAsyncMal.code, 'UNRECOGNIZED_HEADER_SYNTAX');

    console.log('  -> Passed: inspectPhaseHeader correctly parses headers and detects invalid syntax.');

    // ----------------------------------------------------------------------
    // Test 2: analyzePhaseStallReason - Cascade Failure Blocker (Phase 1 Failed -> Phase 2 Blocked)
    // ----------------------------------------------------------------------
    console.log('[Test 2] Verifying BLOCKED_BY_PREVIOUS_FAILURE cascade diagnosis...');

    const mockPhaseList1: PhaseDiagnosticInfo[] = [
      {
        index: 0,
        phaseNumber: 1,
        fileName: 'phase-01-setup.md',
        filePath: '/mock/phase-01-setup.md',
        status: 'Failed',
        isCompleted: false,
        isSelected: true,
        error: 'SyntaxError: unexpected token in generated file'
      },
      {
        index: 1,
        phaseNumber: 2,
        fileName: 'phase-02-api.md',
        filePath: '/mock/phase-02-api.md',
        status: 'Pending',
        isCompleted: false,
        isSelected: true
      },
      {
        index: 2,
        phaseNumber: 3,
        fileName: 'phase-03-ui.md',
        filePath: '/mock/phase-03-ui.md',
        status: 'Pending',
        isCompleted: false,
        isSelected: true
      }
    ];

    const phase1Stall = analyzePhaseStallReason(mockPhaseList1[0], mockPhaseList1, 0);
    assert.ok(phase1Stall, 'Failed phase should have stall reason');
    assert.strictEqual(phase1Stall!.code, 'BLOCKED_BY_PREVIOUS_FAILURE');
    assert.ok(phase1Stall!.description.includes('SyntaxError'));

    const phase2Stall = analyzePhaseStallReason(mockPhaseList1[1], mockPhaseList1, 1);
    assert.ok(phase2Stall, 'Phase 2 must have stall reason');
    assert.strictEqual(phase2Stall!.code, 'BLOCKED_BY_PREVIOUS_FAILURE');
    assert.strictEqual(phase2Stall!.blockedByPhaseIndex, 0);
    assert.strictEqual(phase2Stall!.blockedByPhaseName, 'phase-01-setup.md');
    assert.ok(phase2Stall!.description.includes('Blocked by failure in previous Phase 1'));

    const phase3Stall = analyzePhaseStallReason(mockPhaseList1[2], mockPhaseList1, 2);
    assert.strictEqual(phase3Stall!.code, 'BLOCKED_BY_PREVIOUS_FAILURE');
    assert.strictEqual(phase3Stall!.blockedByPhaseIndex, 0);

    console.log('  -> Passed: Cascade failure accurately links to the failed predecessor.');

    // ----------------------------------------------------------------------
    // Test 3: analyzePhaseStallReason - WAITING_FOR_PREVIOUS_PHASE Sequence Dependency
    // ----------------------------------------------------------------------
    console.log('[Test 3] Verifying WAITING_FOR_PREVIOUS_PHASE for queued sequence...');

    const mockPhaseList2: PhaseDiagnosticInfo[] = [
      {
        index: 0,
        phaseNumber: 1,
        fileName: 'phase-01-setup.md',
        filePath: '/mock/phase-01-setup.md',
        status: 'Completed',
        isCompleted: true,
        isSelected: true
      },
      {
        index: 1,
        phaseNumber: 2,
        fileName: 'phase-02-api.md',
        filePath: '/mock/phase-02-api.md',
        status: 'Running',
        isCompleted: false,
        isSelected: true
      },
      {
        index: 2,
        phaseNumber: 3,
        fileName: 'phase-03-ui.md',
        filePath: '/mock/phase-03-ui.md',
        status: 'Pending',
        isCompleted: false,
        isSelected: true
      }
    ];

    const p1Reason = analyzePhaseStallReason(mockPhaseList2[0], mockPhaseList2, 0);
    assert.strictEqual(p1Reason, undefined, 'Completed phase should have undefined stall reason');

    const p2Reason = analyzePhaseStallReason(mockPhaseList2[1], mockPhaseList2, 1);
    assert.strictEqual(p2Reason, undefined, 'Running phase should have undefined stall reason');

    const p3Reason = analyzePhaseStallReason(mockPhaseList2[2], mockPhaseList2, 2);
    assert.ok(p3Reason);
    assert.strictEqual(p3Reason!.code, 'WAITING_FOR_PREVIOUS_PHASE');
    assert.strictEqual(p3Reason!.blockedByPhaseIndex, 1);
    assert.strictEqual(p3Reason!.blockedByPhaseName, 'phase-02-api.md');
    assert.ok(p3Reason!.description.includes('Waiting for preceding Phase 2'));

    console.log('  -> Passed: WAITING_FOR_PREVIOUS_PHASE correctly identifies active queue blockers.');

    // ----------------------------------------------------------------------
    // Test 4: analyzePhaseStallReason - Preflight, Deselection, and Orchestrator States
    // ----------------------------------------------------------------------
    console.log('[Test 4] Verifying Preflight, Deselection, and Orchestrator state diagnostics...');

    const singlePendingPhase: PhaseDiagnosticInfo = {
      index: 0,
      phaseNumber: 1,
      fileName: 'phase-01-init.md',
      filePath: '/mock/phase-01-init.md',
      status: 'Pending',
      isCompleted: false,
      isSelected: true
    };

    // 4.1 Deselected by user
    const deselectedContext: PhaseExecutionContext = {
      selectedIndices: new Set<number>([1, 2]) // 0 is deselected
    };
    const deselectedReason = analyzePhaseStallReason(singlePendingPhase, [singlePendingPhase], 0, deselectedContext);
    assert.ok(deselectedReason);
    assert.strictEqual(deselectedReason!.code, 'DESELECTED_BY_USER');

    // 4.2 Preflight transport failure
    const preflightFailContext: PhaseExecutionContext = {
      preflightReady: false,
      preflightError: 'DOM Bridge client disconnected from port 49152'
    };
    const preflightReason = analyzePhaseStallReason(singlePendingPhase, [singlePendingPhase], 0, preflightFailContext);
    assert.ok(preflightReason);
    assert.strictEqual(preflightReason!.code, 'PREFLIGHT_TRANSPORT_FAILURE');
    assert.ok(preflightReason!.description.includes('DOM Bridge client disconnected'));

    // 4.3 Orchestrator idle
    const idleContext: PhaseExecutionContext = {
      orchestratorState: 'idle'
    };
    const idleReason = analyzePhaseStallReason(singlePendingPhase, [singlePendingPhase], 0, idleContext);
    assert.ok(idleReason);
    assert.strictEqual(idleReason!.code, 'ORCHESTRATOR_NOT_RUNNING');
    assert.strictEqual(idleReason!.remediationAction, 'Click Start Automation');

    // 4.4 Orchestrator running and ready
    const runningContext: PhaseExecutionContext = {
      orchestratorState: 'scanning'
    };
    const readyReason = analyzePhaseStallReason(singlePendingPhase, [singlePendingPhase], 0, runningContext);
    assert.ok(readyReason);
    assert.strictEqual(readyReason!.code, 'READY_FOR_EXECUTION');

    // 4.5 Malformed header syntax
    const malformedPhase: PhaseDiagnosticInfo & { headerSyntaxValid?: boolean } = {
      index: 0,
      phaseNumber: 1,
      fileName: 'phase-01-bad.md',
      filePath: '/mock/phase-01-bad.md',
      status: 'Pending',
      isCompleted: false,
      isSelected: true,
      headerSyntaxValid: false
    };
    const malformedReason = analyzePhaseStallReason(malformedPhase, [malformedPhase], 0);
    assert.ok(malformedReason);
    assert.strictEqual(malformedReason!.code, 'UNRECOGNIZED_HEADER_SYNTAX');

    console.log('  -> Passed: Accurately diagnoses PREFLIGHT, DESELECTION, ORCHESTRATOR_NOT_RUNNING, and UNRECOGNIZED_HEADER_SYNTAX.');

    // ----------------------------------------------------------------------
    // Test 5: Full Plan Directory Audit (auditPlanPhases & auditPlanPhasesAsync)
    // ----------------------------------------------------------------------
    console.log('[Test 5] Verifying auditPlanPhases() and auditPlanPhasesAsync() aggregation...');

    const planAuditDir = path.join(testBaseDir, 'plan-sample');
    fs.mkdirSync(planAuditDir, { recursive: true });

    fs.writeFileSync(path.join(planAuditDir, 'phase-01-db.md'), '# Phase 1\n\nStatus: ✅ Completed\n\nDB done.', 'utf8');
    fs.writeFileSync(path.join(planAuditDir, 'phase-02-api.md'), '# Phase 2\n\nStatus: ⬜ Pending\n\nAPI in progress.', 'utf8');
    fs.writeFileSync(path.join(planAuditDir, 'phase-03-ui.md'), '# Phase 3\n\nStatus: ⬜ Pending\n\nUI task.', 'utf8');
    fs.writeFileSync(path.join(planAuditDir, 'phase-04-deploy.md'), '# Phase 4\n\nStatus: ⬜ Pending\n\nDeploy task.', 'utf8');

    // Synchronous audit with runtime context (Phase 2 running, Phase 4 deselected)
    const auditSync = auditPlanPhases(planAuditDir, {
      orchestratorState: 'waiting',
      currentPhaseIndex: 1,
      selectedIndices: new Set([0, 1, 2]), // Phase 3 (index 2) selected, Phase 4 (index 3) deselected
      activePhases: [
        { index: 0, status: 'Completed', executionTimeMs: 1250 },
        { index: 1, status: 'Running', startTime: Date.now() - 5000 }
      ]
    });

    assert.strictEqual(auditSync.totalPhases, 4);
    assert.strictEqual(auditSync.completedCount, 1);
    assert.strictEqual(auditSync.pendingCount, 1); // Phase 3
    assert.strictEqual(auditSync.failedCount, 0);
    assert.strictEqual(auditSync.skippedCount, 1); // Phase 4 deselected
    assert.ok(auditSync.runningPhase);
    assert.strictEqual(auditSync.runningPhase!.fileName, 'phase-02-api.md');
    assert.strictEqual(auditSync.hasBlockers, false);

    // Check Phase 3 stall reason -> WAITING_FOR_PREVIOUS_PHASE (Phase 2)
    const p3Diag = auditSync.phases[2];
    assert.strictEqual(p3Diag.fileName, 'phase-03-ui.md');
    assert.ok(p3Diag.stallReason);
    assert.strictEqual(p3Diag.stallReason!.code, 'WAITING_FOR_PREVIOUS_PHASE');
    assert.strictEqual(p3Diag.stallReason!.blockedByPhaseName, 'phase-02-api.md');

    // Check Phase 4 stall reason -> DESELECTED_BY_USER
    const p4Diag = auditSync.phases[3];
    assert.strictEqual(p4Diag.fileName, 'phase-04-deploy.md');
    assert.strictEqual(p4Diag.status, 'Skipped');
    assert.ok(p4Diag.stallReason);
    assert.strictEqual(p4Diag.stallReason!.code, 'DESELECTED_BY_USER');

    // Asynchronous audit with failure injection
    const auditAsync = await auditPlanPhasesAsync(planAuditDir, {
      activePhases: [
        { index: 0, status: 'Completed' },
        { index: 1, status: 'Failed', error: 'AI agent returned exit code 1' }
      ]
    });

    assert.strictEqual(auditAsync.failedCount, 1);
    assert.strictEqual(auditAsync.hasBlockers, true);
    assert.ok(auditAsync.primaryBlockerReason?.includes('AI agent returned exit code 1'));

    // Check Phase 3 is now BLOCKED_BY_PREVIOUS_FAILURE
    assert.strictEqual(auditAsync.phases[2].stallReason?.code, 'BLOCKED_BY_PREVIOUS_FAILURE');
    assert.strictEqual(auditAsync.phases[2].stallReason?.blockedByPhaseName, 'phase-02-api.md');

    // Re-export validation from debugLogger
    const loggerAuditResult = loggerAuditPlanPhases(planAuditDir);
    assert.strictEqual(loggerAuditResult.totalPhases, 4);

    console.log('  -> Passed: auditPlanPhases and auditPlanPhasesAsync aggregate diagnostics with complete fidelity.');

    // ----------------------------------------------------------------------
    // Test 6: Resilience & Edge Cases (Empty folder, missing folder)
    // ----------------------------------------------------------------------
    console.log('[Test 6] Verifying edge cases (missing directory, empty directory)...');

    const emptyDir = path.join(testBaseDir, 'empty-dir');
    fs.mkdirSync(emptyDir, { recursive: true });

    const emptyAudit = auditPlanPhases(emptyDir);
    assert.strictEqual(emptyAudit.totalPhases, 0);
    assert.strictEqual(emptyAudit.hasBlockers, false);

    const nonExistentAudit = auditPlanPhases(path.join(testBaseDir, 'non-existent-folder'));
    assert.strictEqual(nonExistentAudit.totalPhases, 0);
    assert.strictEqual(nonExistentAudit.hasBlockers, false);

    console.log('  -> Passed: Gracefully handles empty and non-existent folders without unhandled exceptions.');

    // Cleanup
    fs.rmSync(testBaseDir, { recursive: true, force: true });
    console.log('\n=== ALL PHASE 01 STALL ANALYZER TESTS PASSED SUCCESSFULLY ===\n');
  } catch (err) {
    fs.rmSync(testBaseDir, { recursive: true, force: true });
    throw err;
  }
}

runPhase01StallAnalyzerTests().catch(err => {
  console.error('[Test Failure]', err);
  process.exit(1);
});
