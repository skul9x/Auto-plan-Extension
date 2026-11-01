# Phase 03: Submission Proof Transition Hardening & False-Positive Elimination

Status: ✅ Completed
Test: `src/test/phase03_dom_bridge_submission_proof_transition.test.ts`

## Objective
Eliminate the critical "False Positive Proof 1" bug in `verifyInputSubmission` and `isInputClearedOrSubmitted` where empty inputs return instant verification (`input_cleared_immediately` in 0ms). Enforce state transition verification requiring confirmed pre-submit content presence before clearance can be declared.

## Scope
- Modify `isInputClearedOrSubmitted` and `verifyInputSubmission` in `media/autoplan-dom-bridge.js`.
- Introduce a pre-condition flag: `hasConfirmedContentBeforeSubmit`.
- Ensure Proof 1 (`input_cleared`) is only eligible if the element previously verified containing $\ge 1$ characters of the prompt.
- Fix immediate evaluation in `verifyInputSubmission`: if `!hasConfirmedContentBeforeSubmit`, immediate clearance returns `false`.
- Refine Proof 2 (Cancel button) and Proof 3 (User message count increment) to prevent race conditions during new conversation creations.

## Requirements
1. **Content Transition Requirement for Proof 1**:
   - In `isInputClearedOrSubmitted(inputElem, promptText, options)`:
     - Check `options.hasConfirmedContentBeforeSubmit`. If this flag is `false` or unverified, the element CANNOT be considered cleared (return `false`).
     - An initially empty input element must NOT return `true` under any circumstances.
2. **Immediate Evaluation Hardening in `verifyInputSubmission`**:
   - At $t=0$, if the input was verified populated in Phase 02, verify whether it was cleared on the instantaneous submission tick.
   - If `charsDetectedInDOM` prior to submit was 0, `checkProof1()` must evaluate to `false`.
3. **Observation Window & Polling Calibration**:
   - Maintain the observation window (default 1000ms, 15ms poll interval).
   - If during polling the buffer transitions from populated to empty ($\le 2$ non-printable characters or `<p><br></p>`), confirm Proof 1:
     - `reason: 'input_cleared'`
     - `proof: 'proof1_input_clearance'`
     - `durationMs: Date.now() - startTime`
4. **Untrusted Fallback Rejection Guard**:
   - If synthetic `enterKey` was dispatched because no send button was present, and none of the 3 proofs succeed within the observation window:
     - Flag `rejectionReason: 'untrusted_enter_rejected'`.
     - Mark `submissionVerified: false`.
     - Do not mask the failure as success.

## Constraints
- Never report `verified: true` with `durationMs: 0` unless Proof 2 (Active Cancel Button) or Proof 3 (Message Count increment) is genuinely active in the DOM.
- Preserve support for fast submissions where the framework clears the input on the first microtask.

## Dependencies
- Source file: `media/autoplan-dom-bridge.js`.
- Test harness: `src/test/phase03_dom_bridge_submission_proof_transition.test.ts`.

## Acceptance Criteria
- Given an element that starts empty, `isInputClearedOrSubmitted` returns `false` when called without pre-confirmed content.
- Given an element that verified 3,000 characters in Phase 02, when Enter is pressed and the framework clears the text, `verifyInputSubmission` returns `verified: true, reason: 'input_cleared'`.
- Eliminates 100% of false-positive clearance detections on empty mock elements.

## Comprehensive File-Based Test
- **File**: `src/test/phase03_dom_bridge_submission_proof_transition.test.ts`
- **Scope**:
  - Tests `isInputClearedOrSubmitted` with empty inputs (verifying `false` return).
  - Tests transition from populated buffer to cleared buffer (verifying `true` return).
  - Tests edge case where prompt contains special characters or whitespace.

