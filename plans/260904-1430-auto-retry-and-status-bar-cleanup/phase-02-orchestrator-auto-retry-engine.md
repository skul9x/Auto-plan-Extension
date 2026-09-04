# Phase 02: Orchestrator Resilient Auto-Retry Engine

Status: ✅ Completed  
Dependencies: Phase 01  
Target Files: `src/orchestrator.ts`  
Primary Test File: `src/test/phase02_orchestrator_auto_retry_engine.test.ts`

---

## 1. Objective

Implement an automatic, resilient retry loop directly inside `Orchestrator.runPhaseSequence()` when `waitForNewConversation` encounters a `NewConversationTimeoutError`:
1. Check `config.autoRetryOnTimeout` (default: `true`) and maximum retry threshold (`config.maxAutoRetries`, default: `5`).
2. Delay for `config.retryDelaySeconds` (default: `3` seconds) before triggering the retry.
3. Show an actionable notification: `"Auto-Plan: Phase X gặp timeout tạo phiên mới. Đang thử lại sau 3s... (Lần 1/5)"` with a `"⏹️ Hủy / Stop"` action.
4. If the user clicks `"⏹️ Hủy / Stop"`, immediately abort the run and transition to `Stopped`. If dismissed or ignored, proceed with auto-retry.
5. While waiting during countdown, maintain `Running` status on Status Bar / Logger with spinning icon `$(sync~spin)`: `"Auto-Plan: Retrying Phase X (1/5) in 3s..."`.
6. When retrying (Option A), execute the complete dispatch sequence from the beginning with `openNewConversation: true` to guarantee a clean chat input session without duplicate text.
7. If 5 retries are exhausted and still timing out, gracefully fail the phase and trigger the diagnostic error handler as before.
8. Reset the retry counter to 0 upon successful conversation detection or when advancing to subsequent phases.

---

## 2. Requirements

### Functional
- [x] In `src/orchestrator.ts` within `runPhaseSequence()`:
  - Initialize `let phaseRetryCount = 0;` at the start of each phase loop iteration.
  - Wrap the prompt dispatch and `waitForNewConversation` sequence in a resilient retry loop:
    ```typescript
    const maxRetries = config.autoRetryOnTimeout ? (config.maxAutoRetries ?? 5) : 0;
    const retryDelayMs = (config.retryDelaySeconds ?? 3) * 1000;
    ```
  - When `waitForNewConversation` throws `NewConversationTimeoutError`:
    - If `phaseRetryCount < maxRetries`:
      1. Increment `phaseRetryCount++`.
      2. Set status message: `Auto-Plan: Retrying Phase ${phase.phaseNumber || i + 1} (${phaseRetryCount}/${maxRetries}) in ${config.retryDelaySeconds ?? 3}s...`.
      3. Log debug event in `debugLogger`:
         `[ORCHESTRATOR] New conversation timeout for ${phase.fileName}. Auto-retrying (${phaseRetryCount}/${maxRetries}) in ${config.retryDelaySeconds ?? 3}s...`.
      4. Display countdown notification via `vscode.window.showInformationMessage`:
         `Auto-Plan: Phase ${phase.phaseNumber || i + 1} gặp timeout tạo phiên mới. Đang thử lại sau ${config.retryDelaySeconds ?? 3}s... (Lần ${phaseRetryCount}/${maxRetries})` with button action `['⏹️ Hủy / Stop']`.
      5. Wait `retryDelayMs` asynchronously with abort monitoring:
         - If user accepts `"⏹️ Hủy / Stop"`, call `this.stop()` and break the sequence.
         - If notification is dismissed or no button clicked, continue automatically.
      6. On delay completion, re-execute fresh dispatch:
         - Re-render prompt.
         - Call `promptDispatcher.dispatchPrompt(renderedPrompt, { ...dispatchOptions, openNewConversation: true })`.
         - Await `waitForNewConversation` with fresh `phaseStartTime`.
    - If `phaseRetryCount >= maxRetries`:
      - Preserve existing behavior: mark `phase.status = 'Failed'`, log stall event, diagnose subsequent phases, and throw the error.
  - Reset `phaseRetryCount = 0` when `convId` is successfully resolved.

### Non-Functional
- [x] Avoid state flickering between `running` and `idle` during retry countdown.
- [x] Prevent unhandled promise rejections if user stops execution mid-countdown.

---

## 3. Implementation Steps

1. In `src/orchestrator.ts`:
   - Add helper method `sleepWithAbort(ms: number, abortCheck: () => boolean): Promise<boolean>` to support responsive cancellation.
   - Refactor the inner dispatch & conversation detection block in `runPhaseSequence()` into a retry-aware loop.
   - Integrate notification display with `'⏹️ Hủy / Stop'` handler.
2. Implement `src/test/phase02_orchestrator_auto_retry_engine.test.ts`:
   - Test 1: Simulates 1 timeout failure followed by successful conversation detection; verifies retry occurred after 3s delay and phase succeeded.
   - Test 2: Simulates 5 consecutive timeouts; verifies exactly 5 retry attempts were executed before throwing `NewConversationTimeoutError` and failing phase.
   - Test 3: Simulates user clicking `'⏹️ Hủy / Stop'` during 3s countdown; verifies sequence aborts immediately without proceeding to next retry.
   - Test 4: Verifies retry count resets for the next phase in the list.

---

## 4. Verification Plan

- Run the single comprehensive test for this phase:
  ```bash
  npm run compile && node out/test/phase02_orchestrator_auto_retry_engine.test.js
  ```
- Verify all assertions pass.
- Stop for user review.
