# Phase 02: Send Button Readiness Polling & Enter-Fallback Disabling

Status: ✅ Completed  
Target Issue: Fixing 250ms premature timeout and forbidding false synthetic Enter fallbacks  
Test File: `src/test/phase02_send_button_readiness.test.ts`

---

## 1. Objective

Prevent prompt submission drops caused by React state lag (~300-500ms) by increasing button enablement polling to 1500ms, aligning readiness checks with the verified `body4.txt` DOM structure, and forbidding synthetic `Enter` fallback when a send button exists in the DOM.

---

## 2. Requirements

### Functional Requirements
1. **Extended Button Enablement Polling**:
   - In `media/autoplan-dom-bridge.js` (`injectPromptAndSubmit`), increase the default `maxPollMs` from 250ms to **1500ms**, with a 50ms interval.
   - Re-evaluate `findSendButton` on every poll interval to capture newly rendered buttons.
2. **Strict Readiness Criteria (Aligned with `body4.txt`)**:
   - Based on empirical snapshot `body4.txt`, the send button is ready when:
     - `sendBtn.getAttribute('disabled') === null` (the `disabled` attribute is removed).
     - `!sendBtn.classList.contains('cursor-not-allowed')`.
     - `sendBtn.classList.contains('cursor-pointer')` or `sendBtn.classList.contains('bg-primary')`.
3. **Absolute Prohibition of Synthetic Enter when Send Button Exists**:
   - If a send button is present in the DOM (even if currently disabled), **NEVER dispatch `KeyboardEvent('Enter')`**.
   - Lexical editor explicitly ignores synthetic `Enter` events (`isTrusted === false`) while in a disabled or preparing state. Dispatching Enter only masks the failure and leaves text stuck in the input.
   - Synthetic Enter fallback is ONLY permitted if no send button element can be discovered anywhere in the DOM.
4. **Reliable Click Cascade**:
   - Once readiness criteria are met, trigger the full event cascade (`pointerdown`, `mousedown`, `pointerup`, `mouseup`, `click`).

---

## 3. Implementation Steps

1. **Update `injectPromptAndSubmit` in `media/autoplan-dom-bridge.js`**:
   - Update `maxPollMs` default to 1500ms.
   - Refactor `isButtonDisabled` to strictly check for `disabled` attribute, `cursor-not-allowed` class, and absence of `cursor-pointer`.
   - Update fallback logic around line 1590: only branch to `enterKey` if `!sendBtn` (no button found in DOM). If `sendBtn` was found but remained disabled after 1500ms, mark as failed rather than attempting a fake Enter.
2. **Create Unit Test**:
   - Implement `src/test/phase02_send_button_readiness.test.ts` using JSDOM simulating button enablement delays (e.g. enabling at 400ms) and verifying Enter is never called when button is present.

---

## 4. Files to Modify

- `media/autoplan-dom-bridge.js`: Button polling timeout, readiness check, and Enter fallback restriction.

---

## 5. Verification Test

- **Test File**: `src/test/phase02_send_button_readiness.test.ts`
- **Command**: `npx mocha -r ts-node/register src/test/phase02_send_button_readiness.test.ts`
- **Scope**:
  - Validates button enablement polling waits up to 1500ms and succeeds when the button enables at 400ms.
  - Validates synthetic Enter is NEVER dispatched if the send button is present in the DOM but disabled.
  - Validates click cascade is triggered properly when the button transitions to `cursor-pointer bg-primary`.
