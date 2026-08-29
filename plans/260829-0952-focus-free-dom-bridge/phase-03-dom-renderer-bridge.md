# Phase 03: Electron Renderer DOM Bridge Script & Prompt Automator

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02  

## Objective
Create the client-side JavaScript agent (`media/autoplan-dom-bridge.js`) that runs inside Antigravity IDE's Electron WebContents (DOM runtime). This script executes in the background independently of OS window focus. It polls the Bridge Server, finds the Antigravity chat input container (Monaco Editor inputarea, ProseMirror, Slate, textarea, or `contenteditable="true"` elements), sets the prompt text using a resilient multi-strategy text injector, dispatches synthetic DOM input and submit events, triggers the Send button directly via JavaScript `.click()`, and observes the DOM to automatically approve permission buttons (`Allow`, `Always Allow`, `Run`, `Submit`) when background auto-approval is enabled.

---

## Requirements

### Functional Requirements
1. **Chat Input Discovery Engine**:
   - Locate the active Antigravity/Cascade/VS Code chat input element using prioritized selector cascades:
     * `.interactive-session .monaco-editor textarea.inputarea`, `textarea.interactive-input-editor`
     * `div.interactive-input-editor textarea`, `textarea[placeholder*="Ask"]`, `textarea[placeholder*="Prompt"]`
     * `div.monaco-editor[contenteditable="true"]`, `div.ProseMirror`, `div[contenteditable="true"]`
     * Deep shadow DOM and nested iframe traversal if present.
2. **Multi-Strategy Focus-Free Prompt Injection**:
   - **Strategy 1 (Monaco / ContentEditable / ProseMirror)**: Focus the editor node in DOM; if supported, execute `document.execCommand('insertText', false, promptText)`.
   - **Strategy 2 (Direct Property & Synthetic Events)**: Set element `.value = promptText`, `.textContent = promptText`, or `.innerHTML = promptText`.
   - **Event Propagation**: Dispatch bubbling `beforeinput` and `InputEvent('input', { bubbles: true, inputType: 'insertText', data: promptText })` followed by `Event('change', { bubbles: true })`.
   - **Double-Tap Submit**: Dispatch bubbling `KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })` and `KeyboardEvent('keyup', ...)`. Also locate the Send/Submit button (`button[aria-label*="Send"]`, `.codicon-send`, `.interactive-item-submit-button`, `button[type="submit"]`) and invoke `.click()` to guarantee prompt submission.
3. **New Conversation Triggering**:
   - Locate and trigger the "New Conversation" / "Plus" button in the chat panel header (`button[aria-label*="New Chat"]`, `button[aria-label*="New Conversation"]`, `.codicon-plus`, `.codicon-add`) without requiring OS-level `Ctrl+Shift+L` keystrokes.
4. **Background Permission Auto-Approver**:
   - Continuous DOM scanner using `MutationObserver` on `document.body` + lightweight fallback interval (1000ms).
   - Scan for modal/inline permission buttons matching configurable patterns: `['Allow', 'Always Allow', 'Allow in Workspace', 'Run', 'Submit', 'Keep Waiting', 'Accept all']`.
   - Click approval buttons immediately via `btn.click()` so execution does not stall while the user is away or browsing the web.
5. **Bridge Server Connection Loop**:
   - Automatically detect local server port from `ag-autoplan-ports.json` or by scanning `48860` - `48900`.
   - Poll `/autoplan-status` every 500ms (configurable) when active.
   - Send execution telemetry and ACKs to `/autoplan-ack`.

### Non-Functional Requirements
- **Non-Intrusive**: Does not interfere with normal typing when Auto-Plan is idle.
- **Zero OS Focus Dependency**: Must execute 100% reliably even when the IDE is completely covered, minimized, or in the background while web browsing.

---

## Implementation Steps
1. Create `media/autoplan-dom-bridge.js`.
2. Implement DOM selector utilities: `findChatInput()`, `findSendButton()`, `findNewConversationButton()`.
3. Implement `injectPromptAndSubmit(promptText: string): Promise<boolean>` with multi-strategy text setting.
4. Implement `triggerNewConversation(): Promise<boolean>`.
5. Implement `startAutoApprovalObserver(patterns: string[])` using `MutationObserver`.
6. Implement server connection & polling loop with port discovery and ACK dispatch.
7. Create file-based test suite in `src/test/phase03_dom_bridge_script.test.ts` (using simulated DOM environment).

---

## Files to Create / Modify
- `media/autoplan-dom-bridge.js` - [NEW] Browser/Electron client script injected into `workbench.html`.
- `src/test/phase03_dom_bridge_script.test.ts` - [NEW] File-based verification test suite.

---

## File-Based Test Specification (`src/test/phase03_dom_bridge_script.test.ts`)
The test file must comprehensively verify:
1. **DOM Input Detection**: Tests input discovery across `<textarea>`, Monaco editor `inputarea`, `contenteditable="true"` divs, and ProseMirror structures.
2. **Multi-Strategy Text Injection**: Simulates prompt insertion across different node types and verifies `input`, `change`, and `keydown` events fire with correct payload.
3. **Send Button Click Trigger**: Verifies that when Enter key event does not auto-submit, the Send button is located and `.click()` is invoked.
4. **Auto-Approval Matching**: Creates mock permission dialogs (`Allow`, `Run`, `Always Allow`) and verifies the observer detects and clicks them automatically.
5. **IPC Polling & ACK Flow**: Simulates server responses and verifies the client processes `sendPrompt` commands and returns valid status ACKs.

---
Next Phase: [Phase 04: Unified 3-Tier Prompt Dispatcher & Orchestrator Integration](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/plans/260829-0952-focus-free-dom-bridge/phase-04-unified-prompt-dispatcher.md)
