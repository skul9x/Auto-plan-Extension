# Plan: DOM Bridge Send Button Scoping and Lexical Submission Fix

**Created:** 2026-08-29
**Status:** ✅ Completed
**Target:** Fix DOM Bridge prompt submission failure where text is pasted into chat input but send button is not triggered or clicks unrelated workbench icons.

## Overview
Recent diagnostic telemetry revealed that prompt injection via `document.execCommand('insertText')` succeeds in injecting text into Antigravity IDE's Lexical chat input (`#antigravity.agentSidePanelInputBox`), but submission fails to trigger. Root cause analysis identified:
1. `isElementVisible(el)` immediately returns `false` if `el.disabled === true`, preventing `findSendButton` from returning the real Antigravity send button (`button[data-testid="send-button"]` / `button[aria-label="Send message"]`) which starts in a disabled state before state reconciliation.
2. `findSendButton` full-document fallback matches global `.codicon-arrow-right` (such as VS Code breadcrumb / navigation icon) outside the chat container, dispatching clicks to unrelated IDE UI elements.
3. Lack of a state reconciliation delay after `execCommand` prevents Lexical/React from transitioning the send button to enabled state before keyboard Enter and click dispatch occur.

## Key Fixes & Architecture
- **Visibility & Disabled Handling:** Modify `isElementVisible` to accept an `allowDisabled` option or separate visibility from disabled checks so target buttons can be resolved and waited on.
- **Strict Container Scoping:** Eliminate global fallback for generic icons (`.codicon-arrow-right`, `.codicon-arrow-up`, `.codicon-send`) so they are only searched inside chat containers (`#antigravity.agentSidePanelInputBox`, `.chat-widget`, etc.).
- **Lexical/React State Sync Delay:** Introduce a micro-delay (25-50ms) after content injection to allow Lexical mutation listeners and React state batches to enable the send button.
- **Button Enablement Polling & Dispatch:** Poll for the send button to become enabled for up to 300ms before dispatching pointer/mouse click cascades and composed Enter keyboard events.

---

## Phases

| Phase | Phase File | Single Test File | Status |
| :--- | :--- | :--- | :--- |
| **Phase 01** | `phase-01-dom-selectors-scoping-visibility.md` | `src/test/phase01_dom_send_button_scoping_fix.test.ts` | ✅ Completed |
| **Phase 02** | `phase-02-lexical-sync-submit-cascade.md` | `src/test/phase02_lexical_submit_cascade_fix.test.ts` | ✅ Completed |
| **Phase 03** | `phase-03-dom-bridge-submission-e2e.md` | `src/test/phase03_dom_bridge_submission_e2e.test.ts` | ✅ Completed |

---

## Verification Strategy
- Each phase contains **exactly one** comprehensive file-based test.
- After implementing each phase, run only that single test to verify.
