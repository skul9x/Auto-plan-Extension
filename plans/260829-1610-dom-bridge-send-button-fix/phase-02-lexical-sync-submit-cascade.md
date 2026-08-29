# Phase 02: Lexical React State Sync & Enter/Click Cascade Submission
**Status:** ✅ Completed
**Dependencies:** Phase 01 (`phase-01-dom-selectors-scoping-visibility.md`)

## Objective
Enhance `injectPromptAndSubmit` in `media/autoplan-dom-bridge.js` to ensure reliable prompt submission with Lexical/React editors by:
1. Adding a micro-delay tick (25-50ms) after content injection so Lexical AST and React batching update the input state and enable the send button.
2. Polling for the send button to become enabled (up to 300ms) before executing the pointer/mouse click cascade.
3. Upgrading the Enter key keyboard event dispatch with `composed: true`, `key: 'Enter'`, `code: 'Enter'`, `keyCode: 13`, `which: 13`, `bubbles: true`, `cancelable: true` across `keydown`, `keypress`, and `keyup`.
4. Ensuring double-tap retry operates strictly on the confirmed send button.

## Requirements

### Functional
- [x] In `injectPromptAndSubmit`:
  - After injection (Step 2) & event dispatching (Step 3), await a micro-tick (`setTimeout(r, 30)`).
  - Search for send button using the scoped `findSendButton(containerOrDoc)`.
  - If send button is initially disabled, poll every 25ms up to 250ms waiting for `sendBtn.disabled === false` or `aria-disabled === 'false'`.
  - Dispatch native click cascade (`pointerdown`, `mousedown`, `click()`, `pointerup`, `mouseup`, `click`) on the target button.
  - Dispatch full KeyboardEvent sequence on `inputElem` with `composed: true` for Lexical compatibility.
  - Execute double-tap retry if button was disabled or if submit state did not settle.
- [x] Update diagnostic report steps in `injectPromptAndSubmit` to reflect accurate button resolution, wait duration, and submission strategy.

### Non-Functional
- [x] Fast execution (< 150ms typical for enabled buttons, < 350ms for transitioning buttons).
- [x] Zero unhandled rejections or race conditions on detached DOM elements.

## Implementation Steps
1. [x] Update `injectPromptAndSubmit` in `media/autoplan-dom-bridge.js` with state sync delay and button enablement polling.
2. [x] Refine keyboard event dispatching for Lexical/ProseMirror compatibility.
3. [x] Create comprehensive file test `src/test/phase02_lexical_submit_cascade_fix.test.ts` verifying asynchronous button enablement polling, Lexical event firing, double-tap execution, and diagnostic report correctness.

## Files to Create/Modify
- `media/autoplan-dom-bridge.js` - Update `injectPromptAndSubmit` submission cascade.
- `src/test/phase02_lexical_submit_cascade_fix.test.ts` - Single test for Lexical sync & submission cascade.

## Single Phase Test
- `src/test/phase02_lexical_submit_cascade_fix.test.ts`

---
Next Phase: [phase-03-dom-bridge-submission-e2e.md](./phase-03-dom-bridge-submission-e2e.md)
