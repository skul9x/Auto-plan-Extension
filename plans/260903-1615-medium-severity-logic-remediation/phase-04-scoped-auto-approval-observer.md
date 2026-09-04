# Phase 04: Scoped Auto-Approval Observer & False Trigger Prevention (LOGIC-011 Remediation)

Status: ⬜ Pending  
Dependencies: Phase 03  
Target Files:
- `media/autoplan-dom-bridge.js`
- `src/test/phase04_auto_approval_observer_scope.test.ts`

---

## 1. Objective

Prevent unintended, hazardous clicks by the background auto-approval observer on non-permission buttons. Scope DOM inspection strictly to confirmation modals, dialog boxes, and notification toasts. Eliminate false triggers caused by loose substring matching (e.g. clicking "Don't Run", "Never Allow", debug "Continue", or editor "Run Test") through strict keyword boundaries, negative keyword suppression, and UI container isolation.

---

## 2. Root Cause Analysis (LOGIC-011)

1. In `media/autoplan-dom-bridge.js`:
   ```javascript
   function startAutoApprovalObserver(patterns, options = {}) {
     ...
     const candidates = queryDeep('button, [role="button"], .monaco-button, .dialog-button, a.monaco-button', doc);
     for (let i = 0; i < candidates.length; i++) {
       const btn = candidates[i];
       const text = (btn.textContent || btn.innerText || btn.getAttribute?.('aria-label') || '').trim();

       for (let p = 0; p < targetPatterns.length; p++) {
         const pat = targetPatterns[p];
         if (text === pat || text.toLowerCase() === pat.toLowerCase() || (text.length < 50 && text.includes(pat))) {
           btn.click();
           ...
         }
       }
     }
   }
   ```
2. The observer scans all buttons across the entire VS Code window (`queryDeep`), including editor tab bars, status bars, debug control toolbars, and test runners.
3. The match condition `(text.length < 50 && text.includes(pat))` evaluates to `true` whenever any button contains "Run", "Allow", "Submit", or "Continue".
4. Consequently:
   - When a security modal prompts "Do you want to run this untrusted command?", clicking the "Don't Run" button satisfies `'Don\'t Run'.includes('Run')`.
   - "Never Allow" is clicked because it contains "Allow".
   - A developer debugging code has their debugger repeatedly resumed because the debug toolbar button "Continue" matches `'Continue'`.
   - Explorer or editor toolbar buttons like "Run Test" or "Run Without Debugging" are clicked indiscriminately.

---

## 3. Technical Requirements

### 3.1. Container Scoping (`media/autoplan-dom-bridge.js`)
1. Restrict button scanning to valid dialog, modal, notification, or confirmation containers:
   ```javascript
   const APPROVAL_CONTAINER_SELECTORS = [
     '.monaco-dialog-box',
     '.dialog-buttons-row',
     '.notifications-toasts',
     '.monaco-modal-dialog',
     '[role="dialog"]',
     '[role="alertdialog"]',
     '.quick-input-widget',
     '.notification-toast-container',
     '.antigravity-approval-modal',
     '.agent-permission-dialog'
   ];
   ```
2. Any candidate button must reside within one of these approved container classes (`btn.closest(APPROVAL_CONTAINER_SELECTORS.join(','))`).
3. Explicitly exclude active editor and debug toolbars:
   ```javascript
   if (btn.closest('.debug-toolbar, .editor-actions, .monaco-workbench .part.titlebar, .view-pane-container, .testing-explorer')) {
     continue;
   }
   ```

### 3.2. Strict Pattern Matching & Negative Phrase Suppression
1. Define explicit negative rejection patterns:
   ```javascript
   const NEGATIVE_APPROVAL_PATTERNS = [
     /\bdon'?t\b/i,
     /\bnever\b/i,
     /\bcancel\b/i,
     /\bdeny\b/i,
     /\breject\b/i,
     /\bblock\b/i,
     /\brefuse\b/i,
     /\bdisallow\b/i,
     /\bno\b/i
   ];
   ```
2. If `NEGATIVE_APPROVAL_PATTERNS.some(rgx => rgx.test(text))` is true, immediately reject the button regardless of positive matches.
3. Replace loose `text.includes(pat)` with whole-word or exact normalized matching:
   - Clean whitespace: `const cleanText = text.replace(/\s+/g, ' ').trim().toLowerCase();`
   - Test against exact patterns (`cleanText === pat.toLowerCase()`) or strict bounded regex (e.g. `^(always\s+)?(allow|run|submit|continue|keep waiting|accept all)$`).

---

## 4. Implementation Steps

1. [ ] In `media/autoplan-dom-bridge.js`, define `APPROVAL_CONTAINER_SELECTORS` and `NEGATIVE_APPROVAL_PATTERNS`.
2. [ ] In `startAutoApprovalObserver`, verify each candidate button against container selectors before checking text.
3. [ ] Check candidate button text against `NEGATIVE_APPROVAL_PATTERNS` to immediately reject "Don't Run", "Never Allow", "Cancel", etc.
4. [ ] Enforce exact / bounded pattern comparison rather than loose substring inclusion.
5. [ ] Ensure onApproved notifications reflect only legitimate approval actions.

---

## 5. Single Automated File-Based Test

Create `src/test/phase04_auto_approval_observer_scope.test.ts` to verify:
1. Setup a mocked DOM tree containing:
   - A `.monaco-dialog-box` container with buttons:
     - "Allow" (legitimate)
     - "Always Allow" (legitimate)
     - "Don't Run" (negative - must NOT click)
     - "Never Allow" (negative - must NOT click)
     - "Cancel" (negative - must NOT click)
   - A `.debug-toolbar` container with buttons:
     - "Continue" (debug control - must NOT click)
     - "Pause" (debug control - must NOT click)
   - An `.editor-actions` container with buttons:
     - "Run Test" (editor action - must NOT click)
2. Initialize `startAutoApprovalObserver` with `DEFAULT_APPROVAL_PATTERNS`.
3. Trigger `scanNow()` or MutationObserver event.
4. Assert that:
   - "Allow" and "Always Allow" buttons are clicked and recorded.
   - "Don't Run", "Never Allow", and "Cancel" are NEVER clicked.
   - "Continue" in `.debug-toolbar` and "Run Test" in `.editor-actions` are NEVER clicked.
5. Verify clean termination when `.stop()` is called.

---

## 6. Verification Protocol

Run only this single test for verification:
```bash
npx tsc && node out/test/phase04_auto_approval_observer_scope.test.js
```

After running this single test, stop immediately for user review. Once completed, output `done.`.

---
Next Phase: [Phase 05: Safe In-Place Workbench Uninstallation & Stale Backup Elimination](./phase-05-safe-workbench-uninstallation.md)
