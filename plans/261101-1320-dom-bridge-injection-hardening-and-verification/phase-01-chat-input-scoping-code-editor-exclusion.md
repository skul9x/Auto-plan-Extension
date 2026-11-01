# Phase 01: Chat Input Scoping, Code Editor Exclusion & Target Fingerprinting

Status: ✅ Completed
Test: `src/test/phase01_dom_bridge_chat_input_scoping_exclusion.test.ts`

## Objective
Harden the DOM Bridge chat input discovery engine (`findChatInput`) to strictly isolate the Antigravity Agent chat panel, explicitly exclude all Monaco Code Editor tabs/elements (especially `.native-edit-context`), and capture comprehensive semantic fingerprints for diagnostic reporting.

## Scope
- Modify `findChatInput` in `media/autoplan-dom-bridge.js`.
- Remove dangerous global selectors like bare `[role="textbox"]`.
- Enforce strict container-scoped selectors prioritizing `#antigravity.agentSidePanelInputBox`, `div[data-lexical-editor="true"]`, and `div[aria-label="Message input"]`.
- Implement an active Exclusion Guard (`isCodeEditorElement`) rejecting any element rooted inside the main editor workbench (`.monaco-workbench .part.editor`).
- Capture rich target metadata in Step 1: `isInChatPanel`, `containerHierarchy`, `placeholder`, `ariaLabel`, and visual dimensions (`boundingBox`).

## Requirements
1. **Container-Scoped Selector Reorganization**:
   - Reorder selector cascades to evaluate only Antigravity Agent Chat container selectors first:
     1. `#antigravity\\.agentSidePanelInputBox [contenteditable="true"]`
     2. `#antigravity\\.agentSidePanelInputBox [data-lexical-editor="true"]`
     3. `div[data-lexical-editor="true"][aria-label="Message input"]`
     4. `div[data-lexical-editor="true"]`
     5. `div[aria-label="Message input"][contenteditable="true"]`
     6. `.chat-widget [contenteditable="true"]`
     7. `.interactive-session .interactive-input [contenteditable="true"], .interactive-input-editor textarea`
   - Completely eliminate un-scoped `[role="textbox"]` from the global discovery chain.
2. **Strict Code Editor Exclusion Guard**:
   - Create helper `isCodeEditorElement(el)`:
     - Returns `true` if element has or is descendant of `.monaco-editor` inside `.part.editor` (main editor tab container).
     - Returns `true` if class name matches `native-edit-context` or `overflow-guard` outside chat containers.
     - Returns `true` if element has attribute `aria-roledescription="editor"` without chat identifiers.
   - Any element flagged by `isCodeEditorElement` must be discarded immediately during candidate evaluation.
3. **Semantic Target Fingerprinting**:
   - Step 1 output in `injectPromptAndSubmit` must include:
     - `tagName` and `className`.
     - `isInChatPanel: boolean` (checking `closest('#antigravity\\.agentSidePanelInputBox, .chat-widget')`).
     - `ariaLabel`: attribute `aria-label` or `aria-roledescription`.
     - `placeholder`: placeholder text or empty string.
     - `boundingBox`: `{ width, height, top, left }` from `getBoundingClientRect()`.
     - `visible`: verified via `isElementVisible(el)`.

## Constraints
- Never target active document editor tabs when the chat panel is closed or unrendered.
- If no valid chat input element is found, `findChatInput` must return `null` and let the system report `NO_CHAT_INPUT_FOUND` instead of targeting arbitrary inputs.
- Maintain compatibility with mock DOM testing environments (JSDOM / headless runners).

## Dependencies
- Source file: `media/autoplan-dom-bridge.js`.
- Test harness: `src/test/phase01_dom_bridge_chat_input_scoping_exclusion.test.ts`.

## Acceptance Criteria
- When a mock DOM contains both a Monaco Code Editor (`<div class="native-edit-context" role="textbox">`) and a chat input (`<div data-lexical-editor="true">`), `findChatInput` 100% selects the chat input.
- When only a Monaco Code Editor is present in the DOM (chat panel closed), `findChatInput` rejects the code editor and returns `null`.
- Diagnostic snapshot logs contain full semantic fingerprints (`isInChatPanel: true/false`, `boundingBox`, `ariaLabel`).

## Comprehensive File-Based Test
- **File**: `src/test/phase01_dom_bridge_chat_input_scoping_exclusion.test.ts`
- **Scope**:
  - Tests selector matching against empirical Antigravity IDE 1.107 DOM fixtures (`Data/body1.txt`).
  - Verifies rejection of `.native-edit-context` across varied code editor tab DOM mockups.
  - Tests semantic fingerprint output format in Step 1 results.

