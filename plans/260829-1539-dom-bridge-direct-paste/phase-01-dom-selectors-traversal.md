# Phase 01: Deep DOM Traversal & Selector Engine Enhancement

Status: ✅ Completed  
Dependencies: None  
Target Files:
- `media/autoplan-dom-bridge.js`
- `src/test/phase01_dom_selectors_traversal.test.ts`

---

## 1. Objective
Enhance the DOM selector resolution engine and deep traversal algorithm (`queryDeep`, `findChatInput`, `findSendButton`) in `media/autoplan-dom-bridge.js`. Add comprehensive support for modern Antigravity IDE and VS Code chat containers (`.chat-widget`, `.chat-editor-widget`, `.chat-input-part`, `.composer-container`), input fields (Monaco `textarea.inputarea`, ProseMirror, contenteditables, textareas), and send buttons (`.codicon-arrow-up`, `.codicon-send`, `aria-label="Send message"`). Fix scoped container matching logic so descendants are correctly resolved without false positive container matches or dropped compound queries.

---

## 2. Requirements & Specification

### 2.1. Container & Input Selectors
- **Containers (`CONTAINER_SELECTORS`):**
  - `#antigravity\.agentSidePanelInputBox`, `div[id*="agentSidePanelInputBox"]`, `.chat-widget`, `.interactive-session`, `div.chat-input`, `.chat-input-container`, `.chat-input-part`, `.interactive-input`, `.chat-editor-widget`, `.composer-container`, `.composer-bar`, `.monaco-dialog-box`, `.notifications-toasts`
- **Chat Inputs (`findChatInput`):**
  - `div[data-lexical-editor="true"]` (Antigravity IDE Live Agent Input)
  - `div[aria-label="Message input"]`
  - `#antigravity\.agentSidePanelInputBox [contenteditable="true"]`
  - `div[contenteditable="true"][role="combobox"]`
  - `.chat-widget .monaco-editor textarea.inputarea`
  - `.interactive-session .monaco-editor textarea.inputarea`
  - `.interactive-input .monaco-editor textarea.inputarea`
  - `div.interactive-input-editor textarea`
  - `div.monaco-editor textarea.inputarea`
  - `div.monaco-editor[role="textbox"]`
  - `div.ProseMirror[contenteditable="true"]`
  - `div.ProseMirror`
  - `div[contenteditable="true"][role="textbox"]`
  - `[data-testid*="composer-input"]`
  - `[data-testid*="chat-input"]`
  - `[data-testid*="prompt-input"]`
  - `textarea[placeholder*="Ask"]`
  - `textarea[placeholder*="Message"]`
  - `textarea[placeholder*="Prompt"]`
  - `textarea[placeholder*="Chat"]`
  - `textarea[placeholder*="Type"]`
  - `textarea.inputarea`
  - `[role="textbox"]`

### 2.2. Send / Submit Button Selectors (`findSendButton`)
- `button[data-testid="send-button"]` (Antigravity IDE Live Send Button)
- `button[aria-label="Send message"]`, `button[aria-label*="Send message"]`, `button[title*="Send message"]`
- `button[data-tooltip-id*="send-button"]`
- `button[aria-label*="Send"]`, `button[title*="Send"]`
- `button[aria-label*="Submit"]`, `button[title*="Submit"]`
- `button[aria-label*="Generate"]`, `button[title*="Generate"]`
- `button[aria-label*="Accept"]`, `button[title*="Accept"]`
- `button.codicon-arrow-up`, `.codicon-arrow-up`
- `button.codicon-send`, `.codicon-send`
- `button.codicon-arrow-right`, `.codicon-arrow-right`
- `div.chat-input-toolbar button`
- `div.chat-input-actions button`
- `button[type="submit"]`
- `[data-testid*="send-button"]`, `[data-testid*="submit-button"]`

### 2.3. Scoped Traversal & Visibility Fixes in `queryDeep`
- When searching within matching containers, execute query on both container descendants and shadow roots.
- Handle compound selectors (e.g. `.chat-widget .monaco-editor textarea`): if `container` matches the selector prefix, ensure child queries resolve correctly without dropping matches.
- Ensure `isElementVisible` accommodates Monaco proxy `textarea.inputarea` (which has 1x1 dimensions or absolute positioning) while properly filtering elements with `display: none` or hidden parent containers.

---

## 3. Implementation Steps
1. Update `CONTAINER_SELECTORS`, `findChatInput`, `findSendButton`, and `queryDeep` in `media/autoplan-dom-bridge.js`.
2. Implement exactly one comprehensive file-based test in `src/test/phase01_dom_selectors_traversal.test.ts`.
3. Compile TypeScript and execute the single test:
   ```powershell
   $env:PATH = "C:\Program Files\nodejs;" + $env:PATH
   npx tsc
   node out/test/phase01_dom_selectors_traversal.test.js
   ```
4. Verify 100% test pass rate.

---

## 4. Verification Test Criteria
- Exactly one test file: `src/test/phase01_dom_selectors_traversal.test.ts`.
- Validates detection across `.chat-widget`, `.interactive-session`, `.ProseMirror`, `ShadowRoot`, and modern placeholder textareas.
- Validates send button detection with `.codicon-arrow-up`, `aria-label="Send message"`, and toolbar buttons.

---
Next Phase: [phase-02-direct-content-injection.md](./phase-02-direct-content-injection.md)
