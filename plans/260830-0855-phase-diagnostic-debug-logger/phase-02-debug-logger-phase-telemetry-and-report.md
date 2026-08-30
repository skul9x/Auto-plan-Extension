# Phase 02: DebugLogger Phase Telemetry, Markdown Export & Output Channel

Status: ✅ Completed  
Dependencies: Phase 01  
Target Files:
- `src/debugLogger.ts`
- `src/config.ts`
- `src/test/phase02_debug_logger_phase_telemetry.test.ts`

---

## Objective
Enhance `DebugLogger` (`src/debugLogger.ts`) to ingest phase telemetry, incorporate structured phase audit and stall diagnostic tables into `buildEnvironmentReport()` and `exportDiagnosticReportToString()`, and stream `[PHASE]` tagged events to the dedicated VS Code Output Channel.

## Requirements

### Functional Requirements
1. **Extended Environment & Diagnostic Report**:
   - Update `EnvironmentReport` interface to include `planPhases?: PlanPhasesAuditReport`.
   - Update `buildEnvironmentReport(serverOverride?: any, planAuditOverride?: PlanPhasesAuditReport): EnvironmentReport`.
   - Update `DebugLogger` with `registerPlanAuditProvider(provider: () => PlanPhasesAuditReport | null): void`.
2. **Phase Diagnostic Report Markdown Formatter**:
   - In `exportDiagnosticReportToString()`, add a dedicated section:
     ```markdown
     ## 2. Phase Execution & Stall Diagnostics

     - **Plan Folder:** `/path/to/plans/260830-0855-feature`
     - **Summary:** 5 total phases (2 Completed, 1 Running, 2 Pending, 0 Failed)
     - **Execution Health:** ⚠️ Stall Detected / ✅ Normal

     | # | Phase File | Status | Duration | Stall / Blocker Reason | Action / Remediation |
     | :--- | :--- | :--- | :--- | :--- | :--- |
     | 01 | `phase-01-setup.md` | ✅ Completed | 12.4s | None | - |
     | 02 | `phase-02-db.md` | 🔄 Running | 45.2s | Waiting on AI agent | - |
     | 03 | `phase-03-api.md` | ⏳ Pending | - | Waiting for Phase 02 | Queue in progress |
     | 04 | `phase-04-ui.md` | ⏳ Pending | - | Waiting for Phase 02 | Queue in progress |
     ```
3. **Log Component `PHASE` & Helper Methods**:
   - Add `'PHASE'` to `LogComponent` union: `'SERVER' | 'CLIENT' | 'DISPATCHER' | 'INJECTOR' | 'DOM' | 'ORCHESTRATOR' | 'SETTINGS' | 'PHASE'`.
   - Add helper methods on `DebugLogger`:
     - `logPhaseEvent(phase: PhaseDiagnosticInfo, event: 'START' | 'COMPLETE' | 'FAIL' | 'SKIP' | 'STALL', message: string, details?: any): LogEntry`
     - `logPhaseStall(phase: PhaseDiagnosticInfo, stallReason: PhaseStallReason): LogEntry`
4. **Real-Time Output Channel Streaming**:
   - Stream formatted `[PHASE]` log lines to VS Code Output Channel `Auto-Plan DOM Bridge` with high visibility for phase state transitions and stall alerts.

### Non-Functional Requirements
- Formatted markdown report must remain clean, scannable, and compatible with GitHub/VS Code markdown renderers.
- Logging operations must never throw exceptions or interrupt orchestrator loops.

## Files to Create / Modify
- `src/debugLogger.ts` - Add phase audit ingestion, markdown section formatting, and `[PHASE]` logging methods.
- `src/config.ts` - Maintain configuration options for phase diagnostic logging.

## Verification Test
- **Single Test**: `src/test/phase02_debug_logger_phase_telemetry.test.ts`
- **Validation Scope**:
  - Verify `buildEnvironmentReport()` contains phase audit metadata when provider is registered.
  - Verify `exportDiagnosticReportToString()` outputs formatted Markdown table with Phase index, filename, status, and stall reason.
  - Verify `logPhaseEvent()` and `logPhaseStall()` append structured entries with component `'PHASE'`.
  - Verify Output Channel receives formatted `[PHASE]` messages.
  - Verify `exportLogToFile()` creates file containing the complete phase diagnostic section.
