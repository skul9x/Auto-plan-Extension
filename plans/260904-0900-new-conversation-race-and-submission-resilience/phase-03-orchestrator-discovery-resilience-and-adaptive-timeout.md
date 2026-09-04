# Phase 03: Orchestrator Resilient Discovery & Adaptive Timeout

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02  
Target Files: `src/orchestrator.ts`, `src/config.ts`  
Primary Test File: `src/test/phase03_orchestrator_discovery_resilience.test.ts`

---

## 1. Objective

Enhance the `Orchestrator` conversation discovery mechanism to:
1. Replace the rigid, hardcoded 3000ms discovery timeout in `runPhaseSequence` with an adaptive, configurable timeout defaulting to 7000ms - 8000ms (`config.newConversationTimeoutMs || 8000`).
2. Add progressive discovery diagnostics during `waitForNewConversation` (e.g. logging intermediate heartbeat checks after 3s and 6s) so the user and diagnostic log clearly show whether the orchestrator is awaiting backend filesystem creation rather than failing abruptly.
3. Provide graceful error reporting with clear diagnostic remediation when a timeout does occur.

---

## 2. Requirements

### Functional
- [x] In `src/config.ts`, add configuration key `autoplan.newConversationTimeoutMs` with default `8000` (min: 3000, max: 30000).
- [x] In `src/orchestrator.ts`, update `waitForNewConversation` calls in `runPhaseSequence`:
  - Use `this.config.newConversationTimeoutMs || 8000` instead of hardcoded `3000`.
- [x] Enhance diagnostic logging in `orchestrator.ts` when conversation discovery is taking longer than 3000ms: emit a debug/info trace informing that conversation directory detection is in progress.
- [x] Ensure that if `waitForNewConversation` fails, the error message and stall reason explicitly state:
  `"Timeout waiting for new conversation after ${timeoutMs}ms. Verify prompt submission status in chat panel."`

### Non-Functional
- [x] Preserve existing non-blocking async architecture of `TranscriptWatcher`.
- [x] Fully pass orchestrator state machine tests without regressions.

---

## 3. Implementation Steps

1. In `src/config.ts` and `package.json`:
   - Declare `newConversationTimeoutMs` in `AutoPlanConfig` interface and VS Code settings schema (default: `8000`).
2. In `src/orchestrator.ts`:
   - Replace literal `3000` in `runPhaseSequence` with `this.config.newConversationTimeoutMs || 8000`.
   - Update `waitForNewConversation` method signature and default parameter.
   - Add progressive warning/diagnostic if waiting crosses 4000ms.
3. Implement `src/test/phase03_orchestrator_discovery_resilience.test.ts`:
   - Verify `waitForNewConversation` respects the configured 8000ms timeout.
   - Verify conversation discovery succeeding at 4500ms is accepted without throwing `NewConversationTimeoutError`.
   - Verify that timeouts after 8000ms produce accurate diagnostic metadata.

---

## 4. Verification Plan

- Run the single comprehensive test for this phase:
  ```bash
  npm run compile && node out/test/phase03_orchestrator_discovery_resilience.test.js
  ```
- Verify all assertions pass cleanly.
- Stop for user review.
