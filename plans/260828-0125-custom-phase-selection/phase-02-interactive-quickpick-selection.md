# Phase 02: Interactive Multi-Select QuickPick UI & Action Menu

Status: ✅ Completed
Dependencies: phase-01-smart-phase-scanner.md

## Objective
Build the 2-step interactive action menu and multi-select QuickPick UI in `src/extension.ts` (or supporting UI helper), incorporating smart pre-selection via `quickPick.selectedItems`, `Select All` / `Deselect All` / `Back` title bar buttons, item-level "Run from this phase to end" buttons, validation guards against empty selections, and guaranteed natural sorting.

## Requirements
### Functional
- [x] Implement 2-Step Action Menu triggered after selecting a plan folder:
  - `▶️ Run All (N phases)`: Runs all scanned phases sequentially.
  - `⏩ Resume Unfinished (K phases)`:
    - Filters and executes only phases with `Pending` status.
    - Guard: If `K === 0`, show detail `(All N phases completed)`. If selected, display info message `"Auto-Plan: All phases in this plan are already completed."` without failing.
  - `🎯 Run from Phase... to End`: Displays a single-pick menu with `QuickInputButtons.Back` allowing user to select starting phase, then executes from that phase through to the end.
  - `☑️ Custom Select Phases...`: Navigates to the multi-select QuickPick (Step 2/2).
- [x] Implement the Multi-Select QuickPick using `vscode.window.createQuickPick<PhaseQuickPickItem>()`:
  - Configure multi-select: `quickPick.canSelectMany = true`.
  - Configure step indicator: `quickPick.title = 'Auto-Plan: Select Phases'`, `quickPick.step = 2`, `quickPick.totalSteps = 2`.
  - Item representation:
    - Completed phases: label `$(check) ${fileName}`, detail `[Completed]`.
    - Pending phases: label `$(circle-outline) ${fileName}`, detail `[Pending]`.
  - **Smart Pre-selection via `quickPick.selectedItems`**:
    - *Critical API note*: `vscode.window.createQuickPick()` ignores `picked: true` on `QuickPickItem`.
    - Pre-selection MUST be set programmatically after assigning `quickPick.items`:
      `quickPick.selectedItems = quickPick.items.filter(item => !item.phase.isCompleted);`
- [x] Title Bar Action Buttons (`quickPick.buttons` via `vscode.QuickInputButton`):
  - `vscode.QuickInputButtons.Back`: Listened via `quickPick.onDidTriggerButton`. Re-opens the Step 1 Action Menu without terminating the folder selection session.
  - `$(check-all)` (tooltip `Select All`): Sets `quickPick.selectedItems = [...quickPick.items]`.
  - `$(clear-all)` (tooltip `Deselect All`): Sets `quickPick.selectedItems = []`.
- [x] Item-Level Action Buttons (`QuickPickItem.buttons`):
  - `$(run-below)` (tooltip `Run from this phase to end`): Listened via `quickPick.onDidTriggerItemButton`. Immediately hides QuickPick, slices phases from the triggered item to the end, and dispatches to the orchestrator.
- [x] Validation Guard on Accept:
  - Listened via `quickPick.onDidAccept`.
  - If `quickPick.selectedItems.length === 0`: display warning `"Auto-Plan: Please select at least one phase to execute."` and DO NOT hide/dispose the QuickPick.
  - If valid: sort selected items using `sortPhaseFiles()`, hide/dispose QuickPick, and dispatch to orchestrator.
- [x] Resource Lifecycle:
  - Cleanly dispose QuickPick and associated listener disposables on `onDidHide`.

### Non-Functional
- [x] UX Responsiveness: Smooth interaction, no UI freezing or double-prompting.
- [x] Robustness: Proper disposal of `QuickPick` instances and event listeners on hide/accept/error.

## Files to Create/Modify
- `src/extension.ts` - Update `promptAndStartAutoPlan` to integrate the 2-step menu and interactive multi-select QuickPick.
- `src/test/phase02_custom_phase_quickpick.test.ts` - Single comprehensive test for Phase 02.

## Test Criteria
- Exactly one file-based test: `src/test/phase02_custom_phase_quickpick.test.ts`.
- [x] Verifies the 2-step menu choices and execution path routing (Run All, Resume Unfinished, Run from X to End, Custom Selection).
- [x] Verifies smart pre-selection sets `quickPick.selectedItems` strictly to pending phases.
- [x] Verifies title bar button triggers (`Select All` checks all, `Deselect All` clears all, `Back` navigates back to Step 1).
- [x] Verifies item button trigger (`Run from this phase to end` slices and dispatches correctly).
- [x] Verifies empty selection validation guard prevents execution of 0 phases and leaves QuickPick active.
- [x] Verifies accepted items are returned sorted in natural order before orchestrator hand-off.
- [x] Verifies Resume Unfinished handles 0 pending phases gracefully.

---
Next Phase: phase-03-orchestrator-status-bar-integration.md

