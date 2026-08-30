# Phase 03: Orchestrator Real-Time Phase Lifecycle Tracing & Stall Watchdog

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02  
Target Files:
- `src/orchestrator.ts`
- `src/planScanner.ts`
- `src/test/phase03_orchestrator_stall_watchdog.test.ts`

---

## Objective
Integrate real-time phase lifecycle tracing and a proactive stall watchdog into `Orchestrator` (`src/orchestrator.ts`), logging phase state transitions and diagnosing reasons when phases stall, timeout, or get blocked during execution.

## Requirements

### Functional Requirements
1. **Real-Time Phase Lifecycle Tracing**:
   - At phase start: Emit and log `[PHASE]` event with phase index, file path, and rendered prompt preview.
   - At prompt dispatch: Log dispatch tier used (DOM Bridge / Native / Keyboard), duration, and response status.
   - At transcript watch: Log conversation ID, watcher start timestamp, and poll intervals.
   - At phase complete: Log completion keyword detection, total duration, and updated markdown status.
   - At phase failure / skip: Record error stack, failing step, and trigger stall analysis for subsequent phases.
2. **Proactive Stall Watchdog**:
   - Implement watchdog timer during phase execution:
     - If a phase remains in `'waiting'` state without AI response for longer than a configurable threshold (e.g., 2 minutes or 50% of timeout), log a diagnostic warning with stall reason `'AI_RESPONSE_TIMEOUT'`.
     - If pre-flight readiness fails before execution starts, immediately log `'PREFLIGHT_TRANSPORT_FAILURE'` with actionable instructions.
     - If a phase fails, automatically record `'BLOCKED_BY_PREVIOUS_FAILURE'` on all subsequent queued phases.
3. **Audit Provider Registration**:
   - Link `Orchestrator` to `DebugLogger` via `debugLogger.registerPlanAuditProvider(() => this.getPhaseAuditReport())`.
   - Implement `getPhaseAuditReport(): PlanPhasesAuditReport` on `Orchestrator`.

### Non-Functional Requirements
- Watchdog must run asynchronously with zero impact on normal prompt dispatch and transcript parsing speeds.
- Clean resource disposal on pause, skip, stop, or extension deactivation.

## Files to Create / Modify
- `src/orchestrator.ts` - Add phase lifecycle logging, stall watchdog timer, and `getPhaseAuditReport()`.

## Verification Test
- **Single Test**: `src/test/phase03_orchestrator_stall_watchdog.test.ts`
- **Validation Scope**:
  - Verify Orchestrator logs start, dispatch, and completion events with `[PHASE]` tags.
  - Verify stall watchdog triggers diagnostic warnings when phase wait duration exceeds threshold.
  - Verify subsequent phases are diagnosed as `BLOCKED_BY_PREVIOUS_FAILURE` when an active phase errors.
  - Verify `getPhaseAuditReport()` returns accurate real-time state of running and pending phases.
