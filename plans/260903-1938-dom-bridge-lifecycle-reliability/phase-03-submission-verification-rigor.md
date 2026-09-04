# Phase 03: Rigid Input Submission Verification & False-Positive Elimination

Status: ✅ Completed  
Target Issue: Eliminating false-positive verification caused by loose body MutationObservers  
Test File: `src/test/phase03_submission_verification_rigor.test.ts`

---

## 1. Objective

Refactor `verifyInputSubmission` in `media/autoplan-dom-bridge.js` to eliminate false-positive ACKs. Generic mutations on `document.body` (such as tooltips or clock updates) must never verify submission. Submission verification must require concrete, unambiguous evidence derived from snapshots `body1.txt` and `body2.txt`.

---

## 2. Requirements

### Functional Requirements
1. **Elimination of Generic Body Mutation Observer**:
   - Remove `observer.observe(doc.body, { childList: true, subtree: true })`.
   - Generic mutations on the overall workbench must NOT set `containerMutated = true`.
2. **Three-Point Proof Verification Standard**:
   A submission is confirmed as verified if and only if at least ONE of the following 3 hard criteria evaluates to `true`:
   - **Proof 1 (Input Clearance)**: `isInputClearedOrSubmitted(inputElem, promptText)` returns `true` (the Lexical editor is empty or cleared of the prompt).
   - **Proof 2 (Active Agent Cancel Button)**: Based on snapshot `body2.txt`, the send button has been replaced by the active Cancel/Stop button:
     - `button[aria-label*="Cancel"][data-tooltip-id*="cancel"]` containing the red square indicator (`.bg-red-500`).
     - Or `#a11y-live-announcer` containing text `"Working..."`.
   - **Proof 3 (Message Count Increment)**: Based on snapshot `body1.txt`, the number of user message articles (`div[role="article"][aria-label="User message"]` or `div[data-testid="user-input-step"]`) has increased by at least +1 compared to the pre-submission count.
3. **Explicit Failure on Incomplete Submission**:
   - If none of the 3 proofs are observed within `observationTimeoutMs` (default 1000ms), return `{ verified: false, reason: 'unverified_input_remains' }`.

---

## 3. Implementation Steps

1. **Refactor `verifyInputSubmission` in `media/autoplan-dom-bridge.js`**:
   - Add helper `findCancelButton(doc)` targeting `button[aria-label*="Cancel"][data-tooltip-id*="input-send-button-cancel-tooltip"]`.
   - Add helper `countUserMessages(doc)` targeting `div[role="article"][aria-label="User message"], div[data-testid="user-input-step"]`.
   - Snapshot `initialMessageCount = countUserMessages(doc)` before submit.
   - In polling loop, check Proof 1, Proof 2, and Proof 3.
   - Completely remove the `containerMutated` fallback on `doc.body`.
2. **Create Unit Test**:
   - Implement `src/test/phase03_submission_verification_rigor.test.ts` using JSDOM.
   - Assert that adding random DOM elements to `document.body` (simulating tooltips or status bars) does NOT verify submission when the input retains the prompt.
   - Assert that clearing input, rendering the Cancel button, or appending a user message verifies submission immediately.

---

## 4. Files to Modify

- `media/autoplan-dom-bridge.js`: Refactor `verifyInputSubmission` with 3-point proof standard.

---

## 5. Verification Test

- **Test File**: `src/test/phase03_submission_verification_rigor.test.ts`
- **Command**: `npx mocha -r ts-node/register src/test/phase03_submission_verification_rigor.test.ts`
- **Scope**:
  - Validates that generic body mutations do NOT produce false positive verification.
  - Validates Proof 1 (cleared input), Proof 2 (Cancel button), and Proof 3 (user message increment) each verify submission reliably.
