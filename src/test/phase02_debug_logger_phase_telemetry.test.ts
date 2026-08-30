// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

const channelLines: string[] = [];
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
        createOutputChannel: (name: string) => ({
          name,
          appendLine: (line: string) => {
            channelLines.push(line);
          },
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
  DebugLogger,
  LogEntry,
  EnvironmentReport
} from '../debugLogger';
import {
  PhaseDiagnosticInfo,
  PhaseStallReason,
  PlanPhasesAuditReport
} from '../planScanner';

async function runPhase02DebugLoggerTelemetryTests() {
  console.log('=== Running Phase 02: DebugLogger Phase Telemetry & Report Tests ===\n');

  const testBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase02-logger-test-'));

  try {
    // ----------------------------------------------------------------------
    // Test 1: Provider Registration & buildEnvironmentReport()
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying registerPlanAuditProvider and buildEnvironmentReport...');

    const logger = new DebugLogger(50);

    const mockPhase1: PhaseDiagnosticInfo = {
      index: 0,
      phaseNumber: 1,
      fileName: 'phase-01-setup.md',
      filePath: '/mock/phase-01-setup.md',
      status: 'Completed',
      isCompleted: true,
      isSelected: true,
      executionTimeMs: 12400
    };

    const mockPhase2: PhaseDiagnosticInfo = {
      index: 1,
      phaseNumber: 2,
      fileName: 'phase-02-db.md',
      filePath: '/mock/phase-02-db.md',
      status: 'Running',
      isCompleted: false,
      isSelected: true,
      executionTimeMs: 45200,
      stallReason: {
        code: 'WAITING_FOR_PREVIOUS_PHASE',
        description: 'Waiting on AI agent',
        remediationAction: '-'
      }
    };

    const mockPhase3: PhaseDiagnosticInfo = {
      index: 2,
      phaseNumber: 3,
      fileName: 'phase-03-api.md',
      filePath: '/mock/phase-03-api.md',
      status: 'Pending',
      isCompleted: false,
      isSelected: true,
      stallReason: {
        code: 'WAITING_FOR_PREVIOUS_PHASE',
        description: 'Waiting for Phase 02',
        blockedByPhaseIndex: 1,
        blockedByPhaseName: 'phase-02-db.md',
        remediationAction: 'Queue in progress'
      }
    };

    const mockPhase4: PhaseDiagnosticInfo = {
      index: 3,
      phaseNumber: 4,
      fileName: 'phase-04-ui.md',
      filePath: '/mock/phase-04-ui.md',
      status: 'Pending',
      isCompleted: false,
      isSelected: true,
      stallReason: {
        code: 'WAITING_FOR_PREVIOUS_PHASE',
        description: 'Waiting for Phase 02',
        blockedByPhaseIndex: 1,
        blockedByPhaseName: 'phase-02-db.md',
        remediationAction: 'Queue in progress'
      }
    };

    const mockAuditReport: PlanPhasesAuditReport = {
      folderPath: '/path/to/plans/260830-0855-feature',
      totalPhases: 4,
      completedCount: 1,
      pendingCount: 2,
      failedCount: 0,
      skippedCount: 0,
      runningPhase: mockPhase2,
      phases: [mockPhase1, mockPhase2, mockPhase3, mockPhase4],
      hasBlockers: false
    };

    // Before registering provider, buildEnvironmentReport has no planPhases
    const initialReport = logger.buildEnvironmentReport();
    assert.strictEqual(initialReport.planPhases, undefined);

    // Register provider
    logger.registerPlanAuditProvider(() => mockAuditReport);

    const reportWithProvider = logger.buildEnvironmentReport();
    assert.ok(reportWithProvider.planPhases, 'planPhases should be present after registering provider');
    assert.strictEqual(reportWithProvider.planPhases!.folderPath, '/path/to/plans/260830-0855-feature');
    assert.strictEqual(reportWithProvider.planPhases!.totalPhases, 4);
    assert.strictEqual(reportWithProvider.planPhases!.completedCount, 1);
    assert.strictEqual(reportWithProvider.planPhases!.phases.length, 4);

    // Direct override parameter takes precedence
    const overrideAuditReport: PlanPhasesAuditReport = {
      folderPath: '/custom/override/path',
      totalPhases: 1,
      completedCount: 1,
      pendingCount: 0,
      failedCount: 0,
      skippedCount: 0,
      phases: [mockPhase1],
      hasBlockers: false
    };
    const overriddenReport = logger.buildEnvironmentReport(null, overrideAuditReport);
    assert.strictEqual(overriddenReport.planPhases!.folderPath, '/custom/override/path');
    assert.strictEqual(overriddenReport.planPhases!.totalPhases, 1);

    console.log('  -> Passed: registerPlanAuditProvider and buildEnvironmentReport accurately aggregate phase telemetry.');

    // ----------------------------------------------------------------------
    // Test 2: exportDiagnosticReportToString() Section 2 Markdown Formatting
    // ----------------------------------------------------------------------
    console.log('[Test 2] Verifying exportDiagnosticReportToString() Markdown formatting...');

    const markdownOutput = logger.exportDiagnosticReportToString(100);

    assert.ok(markdownOutput.includes('## 2. Phase Execution & Stall Diagnostics'), 'Should contain Section 2 header');
    assert.ok(markdownOutput.includes('- **Plan Folder:** `/path/to/plans/260830-0855-feature`'), 'Should include Plan Folder');
    assert.ok(markdownOutput.includes('- **Summary:** 4 total phases (1 Completed, 1 Running, 2 Pending, 0 Failed)'), 'Should include Summary line');
    assert.ok(markdownOutput.includes('- **Execution Health:** ✅ Normal'), 'Should indicate normal health');
    assert.ok(markdownOutput.includes('| # | Phase File | Status | Duration | Stall / Blocker Reason | Action / Remediation |'), 'Should have table headers');
    assert.ok(markdownOutput.includes('| 01 | `phase-01-setup.md` | ✅ Completed | 12.4s | None | - |'), 'Row 1 check');
    assert.ok(markdownOutput.includes('| 02 | `phase-02-db.md` | 🔄 Running | 45.2s | Waiting on AI agent | - |'), 'Row 2 check');
    assert.ok(markdownOutput.includes('| 03 | `phase-03-api.md` | ⏳ Pending | - | Waiting for Phase 02 | Queue in progress |'), 'Row 3 check');
    assert.ok(markdownOutput.includes('| 04 | `phase-04-ui.md` | ⏳ Pending | - | Waiting for Phase 02 | Queue in progress |'), 'Row 4 check');

    // Section 3 & 4 presence check
    assert.ok(markdownOutput.includes('## 3. Component Health Status Checklist'));
    assert.ok(markdownOutput.includes('## 4. Recent Log Traces'));

    // Test health status when blocker is present
    const blockerReport: PlanPhasesAuditReport = {
      ...mockAuditReport,
      failedCount: 1,
      hasBlockers: true,
      primaryBlockerReason: 'Phase 2 failed with AI timeout',
      phases: [
        mockPhase1,
        {
          ...mockPhase2,
          status: 'Failed',
          error: 'Phase 2 failed with AI timeout'
        },
        {
          ...mockPhase3,
          stallReason: {
            code: 'BLOCKED_BY_PREVIOUS_FAILURE',
            description: 'Blocked by Phase 2 failure',
            remediationAction: 'Fix error in Phase 2'
          }
        }
      ]
    };
    const blockerMarkdown = logger.exportDiagnosticReportToString(100, null, blockerReport);
    assert.ok(blockerMarkdown.includes('⚠️ Stall Detected (Phase 2 failed with AI timeout)'));
    assert.ok(blockerMarkdown.includes('❌ Failed'));

    console.log('  -> Passed: exportDiagnosticReportToString() renders clean, structured markdown table.');

    // ----------------------------------------------------------------------
    // Test 3: logPhaseEvent() and logPhaseStall() Logging & Component 'PHASE'
    // ----------------------------------------------------------------------
    console.log('[Test 3] Verifying logPhaseEvent() and logPhaseStall()...');

    logger.clear();

    const startEntry = logger.logPhaseEvent(mockPhase1, 'START', 'Starting phase execution');
    assert.strictEqual(startEntry.component, 'PHASE');
    assert.strictEqual(startEntry.level, 'INFO');
    assert.ok(startEntry.message.includes('[PHASE_START] Phase 1 (phase-01-setup.md): Starting phase execution'));
    assert.strictEqual(startEntry.details.phaseNumber, 1);
    assert.strictEqual(startEntry.details.event, 'START');

    const completeEntry = logger.logPhaseEvent(mockPhase1, 'COMPLETE', 'Phase completed successfully', { duration: '12.4s' });
    assert.strictEqual(completeEntry.component, 'PHASE');
    assert.strictEqual(completeEntry.level, 'INFO');
    assert.ok(completeEntry.message.includes('[PHASE_COMPLETE]'));
    assert.strictEqual(completeEntry.details.duration, '12.4s');

    const skipEntry = logger.logPhaseEvent(mockPhase4, 'SKIP', 'Phase was skipped by user selection');
    assert.strictEqual(skipEntry.component, 'PHASE');
    assert.strictEqual(skipEntry.level, 'WARN');
    assert.ok(skipEntry.message.includes('[PHASE_SKIP]'));

    const failEntry = logger.logPhaseEvent(mockPhase2, 'FAIL', 'Phase timed out waiting for response', { error: 'TimeoutError: 15m elapsed' });
    assert.strictEqual(failEntry.component, 'PHASE');
    assert.strictEqual(failEntry.level, 'ERROR');
    assert.ok(failEntry.message.includes('[PHASE_FAIL]'));
    assert.ok(failEntry.error?.includes('TimeoutError'));

    const stallReason: PhaseStallReason = {
      code: 'WAITING_FOR_PREVIOUS_PHASE',
      description: 'Waiting for preceding Phase 1 to finish',
      remediationAction: 'Wait for execution'
    };
    const stallEntry = logger.logPhaseStall(mockPhase2, stallReason);
    assert.strictEqual(stallEntry.component, 'PHASE');
    assert.strictEqual(stallEntry.level, 'WARN');
    assert.ok(stallEntry.message.includes('[PHASE_STALL]'));
    assert.strictEqual(stallEntry.details.stallReason.code, 'WAITING_FOR_PREVIOUS_PHASE');

    assert.strictEqual(logger.getEntries().length, 5);

    console.log('  -> Passed: logPhaseEvent and logPhaseStall accurately record structured PHASE entries.');

    // ----------------------------------------------------------------------
    // Test 4: Real-Time Output Channel Streaming
    // ----------------------------------------------------------------------
    console.log('[Test 4] Verifying real-time streaming to Output Channel...');

    assert.ok(channelLines.length >= 5, 'Output channel should receive logged entries');
    const phaseLines = channelLines.filter(l => l.includes('[PHASE]'));
    assert.ok(phaseLines.length >= 5, 'Output channel must contain [PHASE] tagged entries');
    assert.ok(phaseLines.some(l => l.includes('[PHASE_START]')));
    assert.ok(phaseLines.some(l => l.includes('[PHASE_COMPLETE]')));
    assert.ok(phaseLines.some(l => l.includes('[PHASE_STALL]')));

    console.log('  -> Passed: Formatted [PHASE] events stream immediately to VS Code Output Channel.');

    // ----------------------------------------------------------------------
    // Test 5: exportLogToFile() with Phase Diagnostics
    // ----------------------------------------------------------------------
    console.log('[Test 5] Verifying exportLogToFile()...');

    const targetLogPath = path.join(testBaseDir, 'reports', 'diagnostic-report.md');
    const exportedPath = await logger.exportLogToFile(targetLogPath, 50, null, mockAuditReport);

    assert.strictEqual(exportedPath, targetLogPath);
    assert.ok(fs.existsSync(targetLogPath), 'Report file should be written to disk');

    const fileContent = fs.readFileSync(targetLogPath, 'utf8');
    assert.ok(fileContent.includes('# Auto-Plan DOM Bridge Diagnostic Report'));
    assert.ok(fileContent.includes('## 2. Phase Execution & Stall Diagnostics'));
    assert.ok(fileContent.includes('| 01 | `phase-01-setup.md` | ✅ Completed | 12.4s | None | - |'));
    assert.ok(fileContent.includes('## 4. Recent Log Traces'));

    console.log('  -> Passed: exportLogToFile() creates complete markdown diagnostic report on disk.');

    // Cleanup
    logger.dispose();
    fs.rmSync(testBaseDir, { recursive: true, force: true });
    console.log('\n=== ALL PHASE 02 DEBUG LOGGER TELEMETRY TESTS PASSED SUCCESSFULLY ===\n');
  } catch (err) {
    fs.rmSync(testBaseDir, { recursive: true, force: true });
    throw err;
  }
}

runPhase02DebugLoggerTelemetryTests().catch(err => {
  console.error('[Test Failure]', err);
  process.exit(1);
});
