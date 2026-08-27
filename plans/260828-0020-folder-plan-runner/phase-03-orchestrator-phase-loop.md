# Phase 03: Orchestrator Sequential Runner & Phase Lifecycle
Status: ✅ Completed
Dependencies: Phase 01, Phase 02

## Objective
Update the `Orchestrator` engine to execute a sequence of phase files derived from a plan folder. The orchestrator isolates each phase into a clean conversation (`Ctrl + Shift + L`), passes previous conversation IDs to prevent pollution, tracks granular phase lifecycle states (`Pending`, `Running`, `Completed`, `Failed`, `Skipped`), and provides resilient pause/skip/stop/resume capabilities.

## Requirements
### Functional
- [x] **Execution APIs**:
  - `startFolder(folderPath: string, options?: { startFromIndex?: number })`: Automatically scan folder using `PlanScanner` and run all discovered phases.
  - `startPhases(phaseFiles: string[], options?: { startFromIndex?: number })`: Run an explicit list of phase file paths.
  - Backward compatibility: Retain `start(overrideConfig?)` for count-based loops.
- [x] **Sequential Phase Execution Loop**:
  For each phase `i` in `[0 ... N-1]`:
  1. **Emit Phase Start**: Emit `phaseStart` event with index, total, filename, and file path.
  2. **Timestamp & Reset**: Record `phaseStartTime = Date.now()` and prepare conversation isolation.
  3. **New Conversation Trigger**: Send `Ctrl + Shift + L` (`^+l`) via `KeyboardManager` to initiate a pristine chat thread.
  4. **Focus & Render**: Wait `focusDelayMs` and render the prompt template with the absolute phase path.
  5. **Paste & Submit**: Paste rendered prompt via clipboard (`Ctrl + A`, `Ctrl + V`, `Enter`).
  6. **Anti-Pollution Watcher**: Call `waitForNewConversation(phaseStartTime - 1000, lastConversationId)`.
  7. **Strict Completion Await**: Watch the new conversation transcript until strict `"Done skul9x."` completes with debounce quiet guard.
  8. **Update Tracking**: Set `lastConversationId = activeConvId`, mark phase status as `Completed`.
  9. **Inter-Phase Delay**: Wait `delayBetweenLoopsMs` (cancellable) before advancing to next phase.
- [x] **Phase Lifecycle & Resilience**:
  - Maintain phase list with state: `Pending | Running | Completed | Failed | Skipped`.
  - Support control methods:
    - `stop()`: Immediately cancel delays, watchers, and abort execution.
    - `skipCurrentPhase()`: Skip active phase and advance to the next.
    - `resumeFrom(phaseIndex: number)`: Resume execution from a specific phase without starting over from phase 1.
- [x] **Granular State Events**:
  - Emit `stateChange`, `phaseStart`, `phaseComplete`, `allComplete`, `error`, `stopped`, `skipped`.

### Non-Functional
- [x] Robust error handling: Capture errors per-phase with descriptive diagnostics.
- [x] Clean resource disposal on abort or completion.

## Files to Create/Modify
- `src/orchestrator.ts` - Implement folder/phase sequence runner, anti-pollution conversation handoff, and phase lifecycle state machine.
- `src/test/phase03_orchestrator_loop.test.ts` - Comprehensive single test file for Phase 03.

## Test Criteria
- [x] Exactly one file-based test: `src/test/phase03_orchestrator_loop.test.ts`.
- [x] **Sequential Flow Test**: Verifies running 3 mock phase files sequentially end-to-end.
- [x] **Conversation Handoff Test**: Verifies `lastConversationId` is properly propagated to prevent cross-phase pollution.
- [x] **Skip & Abort Test**: Verifies `skipCurrentPhase()` advances immediately and `stop()` halts all timers instantly.
- [x] **Resume Test**: Verifies resuming execution from index 1 (Phase 2) skips Phase 1 cleanly.

---
Next Phase: [phase-04-status-bar-and-input-ux.md](file:///d:/skul9x/Auto-Plan_Extension/plans/260828-0020-folder-plan-runner/phase-04-status-bar-and-input-ux.md)
