# Phase 01: DOM Bridge Auto-Approver Removal
Status: ✅ Completed
Dependencies: None

## Objective
Completely eradicate the background auto-approval observer, keyword pattern lists, and DOM element scanning routines from `media/autoplan-dom-bridge.js`. This eliminates finding PERF-01 (Forced Reflow / Layout Thrashing) and frees the Electron Renderer from redundant button scanning loops.

## Requirements
### Functional
- [x] Remove `DEFAULT_APPROVAL_PATTERNS` constant array.
- [x] Remove `startAutoApprovalObserver(patterns, options)` function entirely, including its internal timers, `scanAndApprove` loop, and event bindings.
- [x] In class `DOMAutomationBridgeClient`:
  - Remove `this.approvalObserver` initialization.
  - Remove `this.autoApprovalEnabled` option handling.
  - Remove auto-approver startup call from `start()` method.
  - Remove auto-approver teardown logic from `stop()` method.
  - Remove `approvalObserver.scanNow()` invocation in prompt submission lifecycle.
- [x] Remove `startAutoApprovalObserver` and `DEFAULT_APPROVAL_PATTERNS` from module export list.
- [x] Ensure prompt injection, heartbeat, status monitoring, and DOM inspection continue operating without regressions.

### Non-Functional
- [x] Electron Renderer process executes zero periodic button scans or forced reflows for approval detection.
- [x] Zero background timers allocated for approval polling.
- [x] Clean script loading in both Node.js test environments (JSDOM) and real VS Code Electron runtime.

## Implementation Steps
1. Modify `media/autoplan-dom-bridge.js`:
   - Delete `DEFAULT_APPROVAL_PATTERNS` definition.
   - Delete `startAutoApprovalObserver` function implementation.
   - Clean up `DOMAutomationBridgeClient` constructor, `start()`, `stop()`, and submission hooks.
   - Clean up exports at the bottom of the script.
2. Create single comprehensive verification test `src/test/phase01_dom_bridge_auto_approve_removal.test.ts`:
   - Verify that `startAutoApprovalObserver` and `DEFAULT_APPROVAL_PATTERNS` are undefined or not exported.
   - Verify that instantiating and running `DOMAutomationBridgeClient` creates no `approvalObserver` instance and schedules no approval timers.
   - Verify core prompt injection and DOM bridge capabilities remain fully operational.

## Files to Create/Modify
- `media/autoplan-dom-bridge.js` - Remove auto-approver function, variables, and lifecycle bindings
- `src/test/phase01_dom_bridge_auto_approve_removal.test.ts` - Single comprehensive verification test

## Test Criteria
- [x] `node out/test/phase01_dom_bridge_auto_approve_removal.test.js` passes with code 0 (100% assertions verified).

---
Next Phase: [Phase 02: Configuration & Schema Cleanup](./phase-02-config-and-schema-cleanup.md)
