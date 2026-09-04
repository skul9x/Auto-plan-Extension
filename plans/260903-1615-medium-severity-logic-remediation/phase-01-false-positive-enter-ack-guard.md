# Phase 01: False-Positive Enter ACK Guard & Input Clearance Verification (LOGIC-008 Remediation)

Status: ✅ Completed  
Dependencies: None  
Target Files:
- `media/autoplan-dom-bridge.js`
- `src/test/phase01_enter_ack_verification.test.ts`

---

## 1. Objective

Prevent false-positive success acknowledgments when dispatching synthetic Enter keyboard events to rich-text editors (such as Lexical or ProseMirror). Guarantee that `injectPromptAndSubmit` verifies that the editor actually processed the submission (by confirming the input buffer was cleared or updated) before reporting success. If the synthetic Enter was rejected, immediately return a verifiable failure result so `PromptDispatcher` can seamlessly activate Tier 2 (`antigravity.sendTextToChat`) fallback without hanging.

---

## 2. Root Cause Analysis (LOGIC-008)

1. In `media/autoplan-dom-bridge.js`:
   ```javascript
   // Fallback Strategy (enterKey): Only if sendBtn is NOT present or disabled
   try {
     const kbEventInit = { key: 'Enter', code: 'Enter', keyCode: 13, ... };
     inputElem.dispatchEvent(new KbEventClass('keydown', kbEventInit));
     inputElem.dispatchEvent(new KbEventClass('keypress', kbEventInit));
     inputElem.dispatchEvent(new KbEventClass('keyup', kbEventInit));
     enterDispatched = true;
     submitStrategy = 'enterKey';
   } catch (kbErr) { ... }

   const isSuccess = Boolean(sendButtonClicked || formSubmitted || enterDispatched);
   ```
2. When the send button is disabled or unavailable, synthetic keyboard events are dispatched.
3. Modern rich-text editors (Lexical, ProseMirror) enforce security and design constraints against untrusted events (`isTrusted === false`) and suppress default Enter form submissions.
4. The synthetic Enter events are swallowed without clearing the input or dispatching the message.
5. Because `enterDispatched` is set to `true`, `isSuccess` is calculated as `true`.
6. The DOM bridge returns `{ success: true, submitStrategy: 'enterKey' }` to `BridgeServer`.
7. `PromptDispatcher` assumes Tier 1 succeeded and resolves.
8. The prompt text remains sitting in the chat input box unsubmitted.
9. Orchestrator enters the `waiting` state awaiting transcript log activity that will never occur, resulting in a 15-minute freeze until timeout.

---

## 3. Technical Requirements

### 3.1. Post-Submission Verification (`media/autoplan-dom-bridge.js`)
1. Implement a helper `isInputClearedOrSubmitted(inputElem, promptText)`:
   - For `textarea` / `input`: inspect `inputElem.value.trim()`.
   - For `contenteditable` / ProseMirror / Lexical containers: inspect `inputElem.textContent.trim()` and inner HTML structure (e.g. `<p><br></p>` or empty paragraphs).
   - If the current text content still contains or closely matches `promptText` (or is not empty/cleared), submission did NOT occur.
2. In `injectPromptAndSubmit`:
   - When using `enterKey` fallback (or `formSubmit` fallback without button click), execute an asynchronous verification check:
     - Wait a brief clearance observation window (configurable, default 60ms-120ms).
     - Check if `isInputClearedOrSubmitted(inputElem, promptText)` is true, OR if the chat container mutated to append a new message item.
   - If the input element still retains the prompt text and no submission occurred:
     - Mark `enterDispatched = false` (or set `submissionVerified = false`).
     - Set `isSuccess = false`.
     - Record diagnostic details: `error: 'Synthetic Enter event was not accepted by the editor (input was not cleared)'`.
     - Do not report success to BridgeServer.
3. Ensure button-click submissions (`submitStrategy = 'buttonClick'`) remain fast and uninhibited while still benefiting from submission verification when button state remains disabled.

---

## 4. Implementation Steps

1. [x] In `media/autoplan-dom-bridge.js`, create `verifyInputSubmission(inputElem, promptText, options)` to test for input buffer clearance and chat list changes.
2. [x] In `injectPromptAndSubmit()`, after dispatching Enter key events, await `verifyInputSubmission()`.
3. [x] If verification fails (editor retains prompt), set `isSuccess = false` and attach an explicit `rejectionReason: 'untrusted_enter_rejected'` to the report and steps history.
4. [x] Ensure the returned report correctly sets `success: false` so `BridgeServer` and `PromptDispatcher` detect the failure and transition to Tier 2 fallback immediately.

---

## 5. Single Automated File-Based Test

Create `src/test/phase01_enter_ack_verification.test.ts` to verify:
1. Setup a mocked DOM environment simulating both Monaco-style inputs and Lexical/ProseMirror contenteditable editors.
2. **Test Case 1 (Untrusted Enter Rejection):**
   - Provide a contenteditable input element that ignores synthetic `KeyboardEvent('Enter')` and retains the injected text.
   - Call `injectPromptAndSubmit` without a valid send button.
   - Verify that the function detects that the input was not cleared, returns `success: false`, and includes `submitStrategy: 'enterKey'` with a verification failure diagnostic.
3. **Test Case 2 (Successful Enter Submission):**
   - Provide an input element that clears its value/textContent upon receiving the Enter key event.
   - Call `injectPromptAndSubmit`.
   - Verify that verification succeeds and `success: true` is returned.
4. **Test Case 3 (Button Click Cascade):**
   - Provide an active send button.
   - Verify that button click succeeds immediately with `submitStrategy: 'buttonClick'` and `success: true`.

---

## 6. Verification Protocol

Run only this single test for verification:
```bash
npx tsc && node out/test/phase01_enter_ack_verification.test.js
```

After running this single test, stop immediately for user review. Once completed, output `done.`.

---
Next Phase: [Phase 02: Sidebar Webview Bidirectional Ready Handshake](./phase-02-sidebar-webview-ready-handshake.md)
