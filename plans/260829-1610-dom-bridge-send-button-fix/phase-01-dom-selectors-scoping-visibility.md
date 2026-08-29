# Phase 01: DOM Selectors Scoping & Visibility Fix
**Status:** ✅ Completed
**Dependencies:** None

## Objective
Refactor `isElementVisible` and `findSendButton` in `media/autoplan-dom-bridge.js` so that:
1. `isElementVisible` does not treat `disabled` elements as invisible when checking button targets.
2. `findSendButton` strictly prioritizes containers (such as `#antigravity.agentSidePanelInputBox`, `div[id*="agentSidePanelInputBox"]`, `.chat-widget`) and directly targets Antigravity specific attributes (`button[data-testid="send-button"]`, `button[aria-label="Send message"]`, `button[data-tooltip-id*="send-tooltip"]`).
3. Generic icon selectors (like `.codicon-arrow-right`) are excluded from global whole-document queries so unrelated VS Code workbench buttons are never matched or clicked.

## Requirements

### Functional
- [x] Update `isElementVisible(el, { allowDisabled = false } = {})` so disabled state check does not mask valid DOM buttons that are currently disabled waiting for input state.
- [x] Refactor `findSendButton(contextOrDoc, options)`:
  - Check input container first (`inputElem.closest('#antigravity\\.agentSidePanelInputBox')`, `#antigravity.agentSidePanelInputBox`, etc.).
  - Search scoped container for `button[data-testid="send-button"]`, `button[aria-label="Send message"]`, `button[data-tooltip-id*="send-tooltip"]`.
  - Only query generic codicons within valid chat container boundaries.
  - Return the real send button element even if currently disabled.
- [x] Prevent full document search from matching `.action-label.codicon.codicon-arrow-right` or non-chat workbench elements.

### Non-Functional
- [x] No regression in finding input elements or new conversation buttons.
- [x] Backward compatibility with Monaco and Webview chat containers.

## Implementation Steps
1. [x] Modify `isElementVisible` in `media/autoplan-dom-bridge.js` to allow disabled check bypass when evaluating action buttons.
2. [x] Update `findSendButton` in `media/autoplan-dom-bridge.js` to enforce scoped searching and Antigravity-specific button selectors.
3. [x] Strip out global-level fallback matching on `.codicon-arrow-right` and `.action-label`.
4. [x] Create comprehensive file test `src/test/phase01_dom_send_button_scoping_fix.test.ts` verifying exact matching of Antigravity send button (both enabled and disabled states) and rejection of unrelated workbench buttons.

## Files to Create/Modify
- `media/autoplan-dom-bridge.js` - Refactor `isElementVisible` and `findSendButton`.
- `src/test/phase01_dom_send_button_scoping_fix.test.ts` - Single test verifying selector scoping and visibility logic.

## Single Phase Test
- `src/test/phase01_dom_send_button_scoping_fix.test.ts`

---
Next Phase: [phase-02-lexical-sync-submit-cascade.md](./phase-02-lexical-sync-submit-cascade.md)
