# Phase 02: Dispatcher Stabilization Handshake & Prompt Submission Retry

Status: ✅ Completed  
Dependencies: Phase 01  
Target Files: `src/promptDispatcher.ts`, `src/bridgeServer.ts`  
Primary Test File: `src/test/phase02_dispatcher_handshake_and_retry.test.ts`

---

## 1. Objective

Enhance `PromptDispatcher` and `BridgeServer` to:
1. Introduce a mandatory stabilization delay (400ms - 500ms) after completing `openNewConversation` before queuing or dispatching `sendPrompt`, preventing premature prompt injection into an unhydrated DOM.
2. Implement an intelligent retry policy in `PromptDispatcher` when Tier 1 (DOM Bridge) returns a transient rejection such as `BUTTON_DISABLED_TIMEOUT` or `NOT_READY`.
3. Support up to 2 automatic retries (with a 500ms backoff) before escalating or failing, ensuring that transient UI transition hiccups do not break automation sequences.

---

## 2. Requirements

### Functional
- [x] In `PromptDispatcher.sendPromptWithFallback` (and `dispatchViaTier1`): when `options.openNewConversation` is executed, wait `450ms` (stabilization delay) before issuing `sendPrompt`.
- [x] When `bridgeServer.dispatchPromptCommand` returns an error indicating `BUTTON_DISABLED_TIMEOUT` or transient button disabled status:
  - If retry count < 2, pause for 500ms and retry dispatching `sendPrompt` via DOM Bridge.
  - Log diagnostic warnings indicating transient retry attempt (`"DOM send button temporarily unready, retrying (attempt 1/2)..."`).
- [x] If all retries are exhausted and `allowTierFallback: false`, throw a clear, diagnostic-rich error rather than masking the failure.
- [x] Update `bridgeServer.ts` command timeout handling to accommodate the extended button polling window without premature rejection.

### Non-Functional
- [x] Non-blocking async delays using standard `setTimeout` promises.
- [x] Retain full compatibility with cancellation tokens and abort protocols.

---

## 3. Implementation Steps

1. In `src/promptDispatcher.ts`:
   - In `dispatchViaTier1`, after `bridgeServer.dispatchNewConversationCommand` succeeds, add:
     ```typescript
     await new Promise(resolve => setTimeout(resolve, 450));
     ```
   - Wrap `bridgeServer.dispatchPromptCommand` in an async retry loop for transient `BUTTON_DISABLED_TIMEOUT` errors (max 2 retries).
2. In `src/bridgeServer.ts`:
   - Adjust `bridgeTimeoutMs` default to ensure it covers the 2500ms client polling window plus network/IPC buffer (e.g. 6000ms).
3. Implement `src/test/phase02_dispatcher_handshake_and_retry.test.ts`:
   - Verify that `openNewConversation` is followed by stabilization timing before `sendPrompt`.
   - Verify that transient `BUTTON_DISABLED_TIMEOUT` triggers automatic retry and succeeds if the second attempt passes.
   - Verify that persistent failures throw descriptive error after retries are exhausted.

---

## 4. Verification Plan

- Run the single comprehensive test for this phase:
  ```bash
  npm run compile && node out/test/phase02_dispatcher_handshake_and_retry.test.js
  ```
- Verify all assertions pass cleanly.
- Stop for user review.

---
Next Phase: [Phase 03: Orchestrator Resilient Discovery & Adaptive Timeout](./phase-03-orchestrator-discovery-resilience-and-adaptive-timeout.md)
