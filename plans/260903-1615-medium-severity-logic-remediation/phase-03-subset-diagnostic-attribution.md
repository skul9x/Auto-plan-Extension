# Phase 03: Subset Phase Diagnostic Attribution by File Name (LOGIC-010 Remediation)

Status: ✅ Completed  
Dependencies: Phase 02  
Target Files:
- `src/planScanner.ts`
- `src/test/phase03_subset_diagnostic_attribution.test.ts`

---

## 1. Objective

Fix phase diagnostic and status misattribution when running a custom subset of plan phases. Guarantee that `auditPlanPhases` and `auditPlanPhasesAsync` match active phase execution states strictly by file name and path rather than ordinal array index. Ensure that selecting and running a non-zero starting phase (such as Phase 3 or Phase 5) never improperly maps runtime statuses ("Running", "Failed", or error messages) onto preceding unselected phases (such as Phase 1).

---

## 2. Root Cause Analysis (LOGIC-010)

1. In `src/planScanner.ts` (`auditPlanPhases` and `auditPlanPhasesAsync`):
   ```typescript
   const activePhaseMap = new Map<number | string, any>();
   if (executionContext?.activePhases) {
     for (const ap of executionContext.activePhases) {
       activePhaseMap.set(ap.index, ap);
       if (ap.fileName) {
         activePhaseMap.set(ap.fileName.toLowerCase(), ap);
       }
     }
   }

   const diagnosticPhases: PhaseDiagnosticInfo[] = phaseFiles.map((pf, idx) => {
     const headerInfo = inspectPhaseHeader(pf.nativePath || pf.filePath);
     const active = activePhaseMap.get(idx) || activePhaseMap.get(pf.fileName.toLowerCase());
     ...
   ```
2. In Orchestrator, when a user selects a subset of phases (for example, only Phase 3 and Phase 5), Orchestrator re-indexes the selected array, setting `ap.index = 0` for Phase 3 and `ap.index = 1` for Phase 5.
3. In `PlanScanner`, `phaseFiles` lists all phases discovered in the directory: Phase 1 (`idx = 0`), Phase 2 (`idx = 1`), Phase 3 (`idx = 2`), Phase 4 (`idx = 3`), Phase 5 (`idx = 4`).
4. When mapping Phase 1 (`idx = 0`), the code executes `activePhaseMap.get(idx)`.
5. Because `activePhaseMap.set(0, Phase 3)` was registered, `activePhaseMap.get(0)` resolves to Phase 3!
6. Phase 1 erroneously inherits Phase 3's status (`Running`), start time, error message, and conversation ID.
7. Meanwhile, Phase 3 (`idx = 2`) has `activePhaseMap.get(2)` undefined, falling back to `pf.fileName.toLowerCase()`. If Phase 3 fails, Phase 1 turns red ("Failed") while Phase 3 remains stuck in "Pending".

---

## 3. Technical Requirements

### 3.1. File-Based Active Phase Mapping (`src/planScanner.ts`)
1. In both `auditPlanPhases` and `auditPlanPhasesAsync`, remove all integer-based index indexing and lookups:
   ```typescript
   const activePhaseMap = new Map<string, any>();
   if (executionContext?.activePhases) {
     for (const ap of executionContext.activePhases) {
       if (ap.fileName) {
         activePhaseMap.set(ap.fileName.toLowerCase(), ap);
         activePhaseMap.set(path.basename(ap.fileName).toLowerCase(), ap);
       }
       if (ap.filePath) {
         activePhaseMap.set(path.normalize(ap.filePath).toLowerCase(), ap);
       }
     }
   }
   ```
2. When looking up the active phase for a discovered `pf` in `phaseFiles`:
   ```typescript
   const fileKey = (pf.fileName || '').toLowerCase();
   const baseKey = path.basename(pf.filePath || pf.nativePath || '').toLowerCase();
   const pathKey = (pf.filePath || pf.nativePath ? path.normalize(pf.filePath || pf.nativePath).toLowerCase() : '');

   const active = activePhaseMap.get(fileKey) || activePhaseMap.get(baseKey) || (pathKey ? activePhaseMap.get(pathKey) : undefined);
   ```
3. Ensure that `activePhaseMap.get(idx)` is completely removed from both synchronous and asynchronous auditing paths.
4. Verify that `isSelected` logic continues to evaluate `executionContext.selectedIndices` correctly based on the directory-level phase index `idx`.

---

## 4. Implementation Steps

1. [x] In `src/planScanner.ts`, refactor `auditPlanPhases` to index `activePhaseMap` strictly by normalized filename and basename.
2. [x] In `src/planScanner.ts`, apply the identical change to `auditPlanPhasesAsync`.
3. [x] Verify that unselected phases (e.g. Phase 1 when only Phase 3 is selected) retain their static inspected status from disk (e.g. `Pending` or `Completed`) and are not modified by Phase 3's active runtime state.

---

## 5. Single Automated File-Based Test

Create `src/test/phase03_subset_diagnostic_attribution.test.ts` to verify:
1. Create a mock workspace plan directory containing 5 phase files:
   - `phase-01-setup.md`
   - `phase-02-database.md`
   - `phase-03-backend.md`
   - `phase-04-frontend.md`
   - `phase-05-testing.md`
2. Construct an `executionContext` representing a subset run where only Phase 3 is executing and Phase 5 is queued:
   ```typescript
   executionContext = {
     selectedIndices: new Set([2, 4]),
     orchestratorState: 'running',
     activePhases: [
       {
         index: 0, // Orchestrator local index 0
         phaseNumber: 1,
         fileName: 'phase-03-backend.md',
         status: 'Running',
         startTime: Date.now(),
         conversationId: 'conv-phase-3'
       },
       {
         index: 1, // Orchestrator local index 1
         phaseNumber: 2,
         fileName: 'phase-05-testing.md',
         status: 'Pending'
       }
     ]
   };
   ```
3. Execute `auditPlanPhases` and `auditPlanPhasesAsync`.
4. Assert that:
   - `diagnosticPhases[0]` (`phase-01-setup.md`) has status `Pending` (or disk status) and `conversationId === undefined`. It is NOT `Running`.
   - `diagnosticPhases[1]` (`phase-02-database.md`) has status `Pending` and is NOT `Pending` with Phase 5's metadata.
   - `diagnosticPhases[2]` (`phase-03-backend.md`) has status `Running` and `conversationId === 'conv-phase-3'`.
   - `diagnosticPhases[4]` (`phase-05-testing.md`) has status `Pending` and `isSelected === true`.
5. Clean up temporary test files.

---

## 6. Verification Protocol

Run only this single test for verification:
```bash
npx tsc && node out/test/phase03_subset_diagnostic_attribution.test.js
```

After running this single test, stop immediately for user review. Once completed, output `done.`.

---
Next Phase: [Phase 04: Scoped Auto-Approval Observer & False Trigger Prevention](./phase-04-scoped-auto-approval-observer.md)
