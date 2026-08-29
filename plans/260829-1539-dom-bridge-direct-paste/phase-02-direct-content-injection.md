# Phase 02: Multi-Strategy Direct Content Injection Engine

Status: ✅ Completed  
Dependencies: Phase 01  
Target Files:
- `media/autoplan-dom-bridge.js`
- `src/test/phase02_direct_content_injection.test.ts`

---

## 1. Objective
Implement a multi-tier direct content injection strategy in `media/autoplan-dom-bridge.js` (`injectPromptAndSubmit`) that reliably sets prompt text in Monaco Editor inputs, contenteditable ProseMirror containers, and standard textareas without relying on OS keyboard simulation.

---

## 2. Requirements & Specification

### 2.1. Multi-Strategy Content Injection Cascade
1. **Strategy 1: Monaco Editor Model API**
   - Query active editor instance from `win.monaco.editor.getEditors()` (via DOM container matching).
   - If model is available, use `model.setValue(promptText)` or `editor.executeEdits('autoplan', [{ range: model.getFullModelRange(), text: promptText, forceMoveMarkers: true }])` and set cursor to end.
2. **Strategy 2: `document.execCommand('insertText')` (Antigravity Lexical & Monaco Textarea)**
   - Focus target element with `preventScroll: true`.
   - Execute `doc.execCommand('selectAll', false, null)` followed by `doc.execCommand('insertText', false, promptText)`.
   - Natively triggers internal input listeners for Antigravity Lexical Editor (`div[data-lexical-editor="true"]`), Monaco `textarea.inputarea`, and `contenteditable="true"` elements without stealing window focus.
3. **Strategy 3: ProseMirror / Lexical Direct View & Transaction Dispatch**
   - Query `inputElem.pmViewDesc?.view` or `inputElem._pmView` or `inputElem.closest('.ProseMirror')?.pmViewDesc?.view`.
   - If available, execute `view.pasteText(promptText)` or dispatch `tr.replaceWith(0, doc.content.size, schema.text(promptText))`.
4. **Strategy 4: W3C Input Events Level 2 Dispatching (Textarea / Input)**
   - Dispatch `beforeinput` event (`inputType: 'insertText'`, `data: promptText`).
   - Assign value using `HTMLTextAreaElement.prototype` descriptor setter (bypassing React / framework state proxy setters).
   - Dispatch `input` and `change` events (`inputType: 'insertText'`, `data: promptText`).
5. **Strategy 5: ContentEditable / Text Direct Fallback**
   - Assign `inputElem.innerText = promptText` or `textContent = promptText`.
   - Dispatch `input` and `change` events.

### 2.2. Pre-Injection Focus Guard
- Ensure element is focused with `el.focus({ preventScroll: true })`.
- If element is not active, attempt focus on parent container editor.

---

## 3. Implementation Steps
1. Refactor `injectPromptAndSubmit` in `media/autoplan-dom-bridge.js` to execute the multi-tier injection cascade in order of reliability.
2. Implement exactly one comprehensive file-based test in `src/test/phase02_direct_content_injection.test.ts`.
3. Compile TypeScript and execute the single test:
   ```powershell
   $env:PATH = "C:\Program Files\nodejs;" + $env:PATH
   npx tsc
   node out/test/phase02_direct_content_injection.test.js
   ```
4. Verify 100% test pass rate.

---

## 4. Verification Test Criteria
- Exactly one test file: `src/test/phase02_direct_content_injection.test.ts`.
- Validates successful injection via Monaco Model API and `execCommand('insertText')` for Monaco inputarea.
- Validates successful injection via ProseMirror view / contenteditable.
- Validates successful injection and event dispatch (`beforeinput`, `input`, `change`) for standard textareas.

---
Next Phase: [phase-03-direct-submission-doubletap.md](./phase-03-direct-submission-doubletap.md)
