# Phase 03: Orchestrator & Status Bar Progress Integration

Status: 🟢 Completed
Dependencies: phase-02-interactive-quickpick-selection.md

## Objective
Integrate the selected phase subset with `Orchestrator` and the interactive Status Bar in `src/extension.ts` and `src/orchestrator.ts`, ensuring accurate progress tracking formatted as `[1/K] phase-XX.md` (where K is the number of chosen phases), consistent tooltip progress reporting, folder context preservation, clean phase skipping, and graceful user aborts.

## Requirements
### Functional
- [x] Connect selected `PhaseFile[]` directly to `orchestrator.startPhases(selectedPhases)` from the extension UI:
  - Preserve `currentPlanFolder` in `src/extension.ts` so the status bar tooltip accurately displays the target plan folder name.
  - In `orchestrator.ts`, map each selected phase to `PhaseItem` with `index: 0..K-1` for loop execution and preserve `fileName`, `filePath`, and `nativePath`.
- [x] Update Status Bar formatting to reflect the selected subset count:
  - Text format: `$(sync~spin) Auto-Plan: [i/K] ${phaseFileName}` where `K = selectedPhases.length` and `i = currentPhaseIndex + 1`.
  - Tooltip: Show progress based on `K` total selected phases, matching existing formula `Progress: Phase ${i} of ${K} (${Math.round((currentPhaseIndex / K) * 100)}%)`.
- [x] Ensure `Skip Current Phase` action (`autoplan.skipPhase`) cleanly advances to the next phase in the selected list.
- [x] Ensure `Stop Auto-Plan` action (`autoplan.stop`) immediately aborts execution without triggering subsequent selected phases and resets the status bar.
- [x] On completion of all selected phases, display:
  - Status Bar: `$(check) Auto-Plan (Done)`
  - Information Message: `🎉 Auto-Plan: Successfully completed all K phases!`

### Non-Functional
- [x] State consistency: No lingering timers, memory leaks, or desynchronized status bar counters when running a custom subset of phases.

## Files to Create/Modify
- `src/orchestrator.ts` - Verify and refine `startPhases()` and progress reporting for custom phase arrays.
- `src/extension.ts` - Refine `promptAndStartAutoPlan`, `updateStatusBar()`, and `buildRunningTooltip()` to cleanly handle custom phase counts and folder context.
- `src/test/phase03_selected_phases_orchestrator.test.ts` - Single comprehensive test for Phase 03.

## Test Criteria
- Exactly one file-based test: `src/test/phase03_selected_phases_orchestrator.test.ts`.
- [x] Verifies orchestrator sequentially processes a custom subset of phases (e.g. Phase 2 and Phase 5).
- [x] Verifies progress events emit correct 1-based indexing relative to the selected total (`[1/2]` and `[2/2]`).
- [x] Verifies tooltip reflects selected phase subset and plan folder context.
- [x] Verifies phase skipping correctly moves to the next selected phase in the custom subset.
- [x] Verifies stop command aborts mid-sequence cleanly and halts further phase triggers.
- [x] Verifies `allComplete` event fires with exact count of selected phases.

---
Next Phase: phase-04-e2e-regression-packaging.md


