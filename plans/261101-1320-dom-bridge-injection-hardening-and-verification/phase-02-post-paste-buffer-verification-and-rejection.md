# Phase 02: Post-Paste Buffer Verification & Fail-Fast Rejection Engine

Status: ✅ Completed
Test: `src/test/phase02_dom_bridge_post_paste_verification.test.ts`

## Objective
Establish a mandatory Two-Phase Buffer Verification barrier immediately following Step 2 (`Content injection`) in `media/autoplan-dom-bridge.js`. Verify that prompt text has physically materialized inside the target DOM buffer, and immediately abort with `PASTE_VERIFICATION_FAILED` if the buffer is empty, strictly prohibiting premature submit actions.

## Scope
- Implement `verifyBufferHasText(inputElem, expectedText, options)` in `media/autoplan-dom-bridge.js`.
- Inspect DOM content using multiple extraction pathways (`innerText`, `textContent`, `value`, Monaco model getValue).
- Calculate `charsDetectedInDOM`, verify length matching ($\ge \min(\text{expected} \times 0.75, 50)$), and check sample substring prefix/suffix containment.
- Insert verification gate between Step 2 and Step 3/4.
- Throw structured error `PASTE_VERIFICATION_FAILED` if buffer verification fails, halting the submission pipeline.

## Requirements
1. **Multi-Pathway DOM Content Extraction**:
   - For standard input/textarea: evaluate `inputElem.value`.
   - For Lexical / ContentEditable: evaluate `inputElem.innerText` (falling back to `inputElem.textContent`).
   - Clean non-printable zero-width spaces (`\u200B`) and normalize newline representations (`\r\n` to `\n`).
2. **Buffer Verification Standard**:
   - Compare `charsDetectedInDOM` against `expectedText.length`.
   - Ensure the detected text contains at least the initial 30 non-whitespace characters of `promptText`.
   - For prompts $> 50$ characters, verify `charsDetectedInDOM >= expectedText.length * 0.75` (accounting for markdown formatting or trailing whitespace variations).
3. **Fail-Fast Enforcement (Rejection Engine)**:
   - If `verifyBufferHasText` evaluates to `false`:
     - Mark Step 2 as `failed`.
     - Record diagnostic details: `charsExpected`, `charsDetectedInDOM`, `domExcerpt` (first 60 characters of detected DOM text).
     - Construct error `PASTE_VERIFICATION_FAILED` with attached step diagnostics.
     - **Immediately throw the error**: NEVER proceed to Step 3 (event dispatching) or Step 4 (submit triggering) with an empty or unverified buffer.
4. **Step 2 Success Telemetry Payload**:
   - When verification succeeds, emit rich Step 2 metadata:
     - `charsExpected: number`
     - `charsDetectedInDOM: number`
     - `domExcerpt: string`
     - `strategy: string` (e.g. `lexical-execCommand`, `contenteditable-text`, `textarea-value`)
     - `verified: true`

## Constraints
- Never dispatch fake key events or click send buttons when the input buffer is empty.
- Keep verification computation synchronous or sub-15ms to avoid introducing UI perceptible lag.

## Dependencies
- Source file: `media/autoplan-dom-bridge.js`.
- Test harness: `src/test/phase02_dom_bridge_post_paste_verification.test.ts`.

## Acceptance Criteria
- When prompt text fails to inject (e.g. read-only element or unhandled editor type resulting in 0 detected chars), Step 2 throws `PASTE_VERIFICATION_FAILED`.
- Submit triggering (Step 4) is completely bypassed when paste verification fails.
- Step 2 diagnostics reliably output `charsExpected` and `charsDetectedInDOM`.
- Legitimate prompt injections into Lexical and standard inputs pass verification with 100% accuracy.

## Comprehensive File-Based Test
- **File**: `src/test/phase02_dom_bridge_post_paste_verification.test.ts`
- **Scope**:
  - Tests `verifyBufferHasText` against empty, partial, and full inputs.
  - Verifies fail-fast rejection when injecting into non-responsive DOM nodes.
  - Tests error formatting and payload fields on failed injections.

