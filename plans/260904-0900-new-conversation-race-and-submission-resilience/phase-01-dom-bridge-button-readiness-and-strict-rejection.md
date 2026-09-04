# Phase 01: DOM Bridge Button Readiness Polling & Strict Rejection

Status: 🟢 Completed  
Dependencies: None  
Target Files: `media/autoplan-dom-bridge.js`  
Primary Test File: `src/test/phase01_dom_bridge_readiness_and_strict_rejection.test.ts`

---

## 1. Objective

Enhance the DOM Bridge client (`media/autoplan-dom-bridge.js`) to:
1. Extend the send button enablement polling duration up to 2500ms (50ms interval) to allow React/Electron sufficient time to hydrate and enable the button after input changes or conversation reset.
2. Strictly prohibit falling back to synthetic `Enter` when a send button exists in the DOM and remains disabled (`cursor-not-allowed` / `aria-disabled="true"`).
3. Throw an explicit `BUTTON_DISABLED_TIMEOUT` error with diagnostic metadata rather than reporting a false-positive `status: submitClicked` / `isSuccess: true` ACK back to the bridge server.
4. Verify input container readiness and clear state when entering a new conversation.

---

## 2. Requirements

### Functional
- [x] Increase default `maxPollMs` for button enablement polling from 1500ms (or early 250ms timeouts) to 2500ms in `injectPromptAndSubmit`.
- [x] If `sendBtn && isButtonDisabled(sendBtn)` after `maxPollMs`, do NOT trigger `submitStrategy = 'enterKey'`.
- [x] Reject the injection promise with `code: 'BUTTON_DISABLED_TIMEOUT'` and return an error ACK payload with `status: 'failed'` and detailed diagnostics (button class, disabled duration, initial state).
- [x] Only dispatch button click when `isButtonDisabled(sendBtn)` evaluates to `false`.

### Non-Functional
- [x] Maintain backward compatibility with existing command ACK payload structure.
- [x] Zero runtime external dependencies (vanilla browser DOM API within Electron renderer).

---

## 3. Implementation Steps

1. In `media/autoplan-dom-bridge.js`:
   - Inspect `injectPromptAndSubmit` button polling loop: ensure `maxPollMs` defaults to `2500ms` if unprovided or less than 2000ms.
   - Audit the branching logic where `sendBtn && isButtonDisabled(sendBtn)`:
     - Ensure it marks `status: 'failed'` and sets `rejectionReason = 'button_disabled_timeout'`.
     - Prevent any fallback path from executing fake Enter when `sendBtn` is present in DOM.
   - Add post-open conversation readiness probe in `handleOpenNewConversation`: wait up to 1000ms for old chat container unmount and new editor container mount.
2. Implement test suite `src/test/phase01_dom_bridge_readiness_and_strict_rejection.test.ts` using JSDOM:
   - Test that button polling waits until button becomes enabled and clicks successfully.
   - Test that if button remains disabled after 2500ms, it rejects with `BUTTON_DISABLED_TIMEOUT` without dispatching Enter key.
   - Test that false-positive `submitClicked` is never emitted when the button is disabled.

---

## 4. Verification Plan

- Run the single comprehensive test for this phase:
  ```bash
  npm run compile && node out/test/phase01_dom_bridge_readiness_and_strict_rejection.test.js
  ```
- Verify all assertions pass cleanly.
- Stop for user review.

---
Next Phase: [Phase 02: Dispatcher Stabilization Handshake & Prompt Submission Retry](./phase-02-dispatcher-handshake-stabilization-and-retry.md)
