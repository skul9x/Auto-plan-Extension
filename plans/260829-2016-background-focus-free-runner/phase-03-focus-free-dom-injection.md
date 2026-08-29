# Phase 03: True Focus-Free DOM Injection & Background Submission

**Status**: ✅ Completed  
**Target Files**: 
- `media/autoplan-dom-bridge.js`
- `src/workbenchInjector.ts`

---

## 1. Objective
Ensure that prompt injection, content manipulation, and submission event dispatching in `autoplan-dom-bridge.js` execute 100% focus-free without stealing OS foreground window focus, without moving the hardware mouse cursor, and without disrupting external applications like Google Chrome.

---

## 2. Requirements

### Functional Requirements
1. **Zero Window-Focus Stealing**: Guarantee that `injectPromptAndSubmit` does NOT call `window.focus()` or `remote.getCurrentWindow().focus()`, allowing other OS applications (e.g. Google Chrome, terminal, editors) to retain active window focus undisturbed.
2. **Background DOM Input Discovery**: Enhance `findChatInput` and `findSendButton` to correctly find input elements even when `document.activeElement` is `body` or null due to the window being in the background.
3. **Multi-Model Input Setting**: Support direct value setters, Monaco Editor model text insertion, ProseMirror transaction dispatch, and `beforeinput`/`input`/`change` synthetic events without requiring DOM caret focus.
4. **Dual Synthetic Triggering**: Trigger chat submission using both synthetic KeyboardEvent (`Enter`) and direct element dispatch (`sendBtn.click()`) so the chat engine processes the prompt seamlessly in the background.

### Non-Functional Requirements
- Submission latency must remain < 150ms.
- Must not produce unhandled renderer console exceptions when the document is in a background state (`document.hidden === true`).

---

## 3. Implementation Steps
1. In `media/autoplan-dom-bridge.js`:
   - Audit all focus calls in `injectPromptAndSubmit` and make them soft/synthetic without stealing OS focus.
   - Add support for background DOM state handling (`document.hidden` awareness).
   - Ensure `sendAck` returns detailed metadata including `isBackgroundSubmission: true`.
2. In `src/workbenchInjector.ts`:
   - Verify script injection wrapper maintains isolation in Electron Renderer context.

---

## 4. Verification Test
- **Single Test File**: `src/test/phase03_focus_free_dom_injection.test.ts`
- **Scope**:
  - Test prompt injection and submission when `document.hidden = true` and `document.activeElement = null`.
  - Verify no `window.focus()` is called.
  - Verify Monaco / Textarea / ContentEditable receive correct prompt strings.
  - Verify submit button click and Enter keyboard event dispatch return successful ACK.
