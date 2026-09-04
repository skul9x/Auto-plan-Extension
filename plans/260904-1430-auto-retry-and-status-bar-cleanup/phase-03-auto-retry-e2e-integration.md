# Phase 03: End-to-End Resilience & User Cancellation Integration

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02  
Target Files: `src/orchestrator.ts`, `src/extension.ts`, `src/sidebarProvider.ts`  
Primary Test File: `src/test/phase03_auto_retry_e2e_integration.test.ts`

---

## 1. Objective

Validate end-to-end integration across the entire extension:
1. Ensure the UI status bar, sidebar progress tracker, and debug logger remain smooth, responsive, and synchronized during auto-retry countdowns.
2. Confirm that `Bridge: Active` is permanently omitted from the status bar while the primary `🚀 Auto-Plan` status item displays live retry progress.
3. Validate that user cancellation via notification or sidebar Stop button halts all pending retry timers and leaves the system in a clean `Stopped` state.
4. Ensure full regression compatibility with existing multi-window isolation and transcript watching features.

---

## 2. Requirements

### Functional
- [x] Verify `extension.ts` event listeners (`phaseStart`, `error`, `stopped`) handle auto-retried phases seamlessly without duplicate status bar item registrations or premature error toasts.
- [x] Verify `sidebarProvider.ts` displays active retry state without resetting the selected phase indices or progress bar.
- [x] Verify debug logger writes clean diagnostic entries for every retry attempt, including timestamps and attempt counts.
- [x] Confirm full end-to-end flow with simulated DOM Bridge client and chat window interaction.

### Non-Functional
- [x] Clean process exit with zero hanging timers or unreferenced intervals.
- [x] Full regression safety across Linux, macOS, and Windows.

---

## 3. Implementation Steps

1. Review and refine any edge-case interactions between `orchestrator.ts`, `extension.ts`, and `sidebarProvider.ts`.
2. Implement comprehensive integration test in `src/test/phase03_auto_retry_e2e_integration.test.ts`:
   - Setup full mock environment with extension context, mocked VS Code window notifications, and orchestrator.
   - Scenario A (Recovery): Dispatches phase, triggers timeout, verifies countdown notification and status bar text, allows countdown to expire, verifies dispatch retry completes phase successfully.
   - Scenario B (Exhaustion): Forces 5 consecutive timeouts, verifies final failure notification with diagnostic options is displayed only after the 5th failure.
   - Scenario C (Cancellation): During 3s countdown, triggers `'⏹️ Hủy / Stop'`, verifies orchestrator halts immediately and status bar shows stopped.
   - Scenario D (Status Bar Cleanliness): Verifies `getBridgeStatusBarItem()` is hidden while `mainStatusBarItem` remains active and visible.

---

## 4. Verification Plan

- Run the single comprehensive test for this phase:
  ```bash
  npm run compile && node out/test/phase03_auto_retry_e2e_integration.test.js
  ```
- Verify all assertions pass.
- Stop for user review.
