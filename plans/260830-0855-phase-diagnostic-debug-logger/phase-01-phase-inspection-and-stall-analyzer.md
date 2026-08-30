# Phase 01: Phase Inspection & Stall Reason Analyzer Engine

Status: ✅ Completed  
Dependencies: None  
Target Files:
- `src/planScanner.ts`
- `src/debugLogger.ts`
- `src/test/phase01_phase_stall_analyzer.test.ts`

---

## Objective
Design and implement the core data models and analysis algorithms to inspect all phase markdown files (`phase-*.md`) in a plan directory, determine their execution status, and diagnose why any phase is currently pending or stalled (e.g., waiting for prior phase, blocked by earlier failure, transport pre-flight error, or malformed markdown headers).

## Requirements

### Functional Requirements
1. **Phase Diagnostic Data Models**:
   - Define type `PhaseStallCode`:
     - `'WAITING_FOR_PREVIOUS_PHASE'`: Phase is queued after an ongoing or pending phase.
     - `'BLOCKED_BY_PREVIOUS_FAILURE'`: A preceding phase failed with an error.
     - `'PREFLIGHT_TRANSPORT_FAILURE'`: Selected transport mode (DOM Bridge/Native/Keyboard) failed readiness check.
     - `'ORCHESTRATOR_NOT_RUNNING'`: Orchestrator is currently idle, stopped, or paused.
     - `'AI_RESPONSE_TIMEOUT'`: Waiting on AI agent response for longer than threshold.
     - `'HEADER_STATUS_PENDING'`: Markdown file header explicitly marks status as Pending.
     - `'UNRECOGNIZED_HEADER_SYNTAX'`: Markdown header status signature is missing or malformed.
     - `'DESELECTED_BY_USER'`: Phase was unchecked by user in the UI checklist.
     - `'READY_FOR_EXECUTION'`: Phase is next in queue and ready to run immediately.
     - `'COMPLETED'`: Phase was successfully executed.
   - Define interface `PhaseStallReason`:
     ```typescript
     export interface PhaseStallReason {
       code: PhaseStallCode;
       description: string;
       blockedByPhaseIndex?: number;
       blockedByPhaseName?: string;
       remediationAction?: string;
     }
     ```
   - Define interface `PhaseDiagnosticInfo`:
     ```typescript
     export interface PhaseDiagnosticInfo {
       index: number;
       phaseNumber: number;
       fileName: string;
       filePath: string;
       status: 'Completed' | 'Running' | 'Pending' | 'Failed' | 'Skipped';
       isCompleted: boolean;
       isSelected: boolean;
       stallReason?: PhaseStallReason;
       executionTimeMs?: number;
       conversationId?: string;
       error?: string;
     }
     ```
   - Define interface `PlanPhasesAuditReport`:
     ```typescript
     export interface PlanPhasesAuditReport {
       folderPath: string;
       totalPhases: number;
       completedCount: number;
       pendingCount: number;
       failedCount: number;
       skippedCount: number;
       runningPhase?: PhaseDiagnosticInfo;
       phases: PhaseDiagnosticInfo[];
       hasBlockers: boolean;
       primaryBlockerReason?: string;
     }
     ```
2. **Stall Diagnosis Algorithm (`analyzePhaseStallReason`)**:
   - Evaluate each phase in sequence:
     - If `status === 'Completed'`, stall reason is `undefined` (or code `'COMPLETED'`).
     - If `status === 'Failed'`, provide detailed failure reason from `error`.
     - If a preceding phase `i - 1` is `Failed`, mark phase as `'BLOCKED_BY_PREVIOUS_FAILURE'` referencing the failing phase.
     - If a preceding phase `i - 1` is `Running` or `Pending`, mark phase as `'WAITING_FOR_PREVIOUS_PHASE'`.
     - If all preceding phases are `Completed` and this is the first uncompleted phase:
       - If orchestrator is `idle`, mark `'ORCHESTRATOR_NOT_RUNNING'` (Action: "Click Start Automation").
       - If preflight failed, mark `'PREFLIGHT_TRANSPORT_FAILURE'` with remediation (e.g., "Run 1-Click DOM Bridge Setup").
       - If deselected by user, mark `'DESELECTED_BY_USER'`.
       - If header status is malformed, mark `'UNRECOGNIZED_HEADER_SYNTAX'`.
       - Otherwise mark `'READY_FOR_EXECUTION'`.
3. **Plan Directory Audit Function (`auditPlanPhases`)**:
   - Implement `auditPlanPhases(folderPath: string, executionContext?: Partial<OrchestratorProgressInfo & { selectedIndices?: Set<number>; preflightReady?: boolean; preflightError?: string }>): PlanPhasesAuditReport`.
   - Implement async variant `auditPlanPhasesAsync(...)`.

### Non-Functional Requirements
- High-efficiency synchronous and asynchronous file system parsing without memory leaks.
- Resilience against missing files, empty directories, and malformed markdown syntax.

## Files to Create / Modify
- `src/planScanner.ts` - Add phase stall analysis models, `analyzePhaseStallReason`, and `auditPlanPhases` functions.
- `src/debugLogger.ts` - Export phase diagnostic types.

## Verification Test
- **Single Test**: `src/test/phase01_phase_stall_analyzer.test.ts`
- **Validation Scope**:
  - Verify scanning and categorization of Completed vs. Pending vs. Failed phases.
  - Verify detection of `BLOCKED_BY_PREVIOUS_FAILURE` when Phase 1 fails and Phase 2 remains pending.
  - Verify detection of `WAITING_FOR_PREVIOUS_PHASE` for subsequent phases in the sequence.
  - Verify detection of `PREFLIGHT_TRANSPORT_FAILURE` when transport readiness is false.
  - Verify detection of `DESELECTED_BY_USER` when a phase is excluded from execution set.
  - Verify detection of `HEADER_STATUS_PENDING` vs. `COMPLETED` based on header parsing.
  - Verify `auditPlanPhases` aggregates counts and flags `hasBlockers` accurately.
