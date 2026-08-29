# Phase 01: Scoped DOM Traversal & Debounced MutationObserver

Status: 🟢 Completed  
Audit Item Addressed: **Critical Issue 1** (Unrestricted `querySelectorAll('*')` in DOM Bridge scan causing CPU spikes during DOM mutations).

## Objective
Eliminate high CPU consumption (80-100%) and Renderer process freezes caused by unrestricted `querySelectorAll('*')` DOM queries across all shadow roots during MutationObserver notifications in `media/autoplan-dom-bridge.js`. Restrict shadow root discovery to relevant container subtrees and debounce MutationObserver callbacks with a 300ms–500ms quiet period.

## Requirements

### Functional Requirements
- **Scoped Shadow DOM Traversal:** `queryDeep(selector, root)` must restrict its `querySelectorAll('*')` shadowRoot discovery scan to relevant container subtrees (e.g. `.interactive-session`, `div.chat-input`, `.chat-input-container`, `.monaco-dialog-box`, `.dialog-shadow`, `.notifications-toasts`, `.monaco-alert-dialog`) when searching from top-level `document` or `document.body`, rather than iterating through every DOM node in VS Code Electron workbench context (`.monaco-workbench` MUST NOT be searched directly as it wraps the entire IDE window).
- **Throttled Observer Executions:** `startAutoApprovalObserver` must wrap `scanAndApprove()` in a throttled callback with a 300ms window and 500ms maxWait so that rapid consecutive DOM mutation events (e.g., cursor blinking, terminal streaming, text editor scrolling) do not trigger repetitive synchronous DOM scans, while ensuring permission buttons are clicked without delay even during sustained text streaming.
- **Immediate Initial Scan:** `startAutoApprovalObserver` must execute an immediate synchronous scan upon initialization before delegating subsequent dynamic mutations to the throttled observer.
- **Clean Teardown:** The returned observer handle from `startAutoApprovalObserver` must clear any active throttle/debounce timers and disconnect `MutationObserver` on `.stop()`.

### Non-Functional Requirements
- **CPU Efficiency:** CPU utilization during active DOM mutations must stay low without spikes.
- **Backward Compatibility:** Injection into chat inputs and permission button auto-approvals must remain 100% reliable.

## Implementation Steps

1. **Update `queryDeep` in [`media/autoplan-dom-bridge.js`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/media/autoplan-dom-bridge.js):**
   - Introduce candidate container selectors (`CONTAINER_SELECTORS = ['.interactive-session', 'div.chat-input', '.chat-input-container', '.monaco-dialog-box', '.dialog-shadow', '.notifications-toasts', '.monaco-alert-dialog']`).
   - When searching from `document` or `document.body`, first collect target container nodes and search within them and their shadow roots, instead of calling `doc.querySelectorAll('*')`.
   - Maintain full fallback to `doc` if no container subtrees match.

2. **Implement Throttled Debouncing in `startAutoApprovalObserver` in [`media/autoplan-dom-bridge.js`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/media/autoplan-dom-bridge.js):**
   - Add a `throttleTimer` and `lastScanTime` variable inside `startAutoApprovalObserver`.
   - Create a `throttledScan` helper with 300ms throttle interval and 500ms maxWait.
   - Pass `throttledScan` to `new MutationObserverClass(...)`.
   - In `stop()`, clear `throttleTimer` alongside `observer.disconnect()` and `clearInterval(intervalId)`.

3. **Create Detailed Verification Test (`src/test/phase01_dom_bridge_scoped_throttle.test.ts`):**
   - Construct a file-based unit test to verify scoping and debouncing functionality.

## Files to Create / Modify
- `[MODIFY]` [`media/autoplan-dom-bridge.js`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/media/autoplan-dom-bridge.js) - Refactor `queryDeep` and add debouncing to `startAutoApprovalObserver`.
- `[NEW]` [`src/test/phase01_dom_bridge_scoped_throttle.test.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/test/phase01_dom_bridge_scoped_throttle.test.ts) - Unit test suite for verifying scoped DOM query execution and MutationObserver debounce behavior.

## Detailed Verification Test Plan

### Test File: `src/test/phase01_dom_bridge_scoped_throttle.test.ts`

The test file will execute the following automated verifications:

1. **Scoped DOM Query Test:**
   - Create a mock DOM structure containing 1,000 irrelevant elements outside target containers and 5 matching buttons inside a container (e.g., `.interactive-session`).
   - Execute `queryDeep('button')`.
   - Assert that matching buttons are correctly returned without traversing all 1,000 irrelevant DOM elements.

2. **Observer Debounce Test:**
   - Instantiates `startAutoApprovalObserver` with mock `MutationObserver` and `window`.
   - Fires 50 consecutive DOM mutation events within a 100ms window.
   - Asserts that `scanAndApprove` is executed only once after the 300ms debounce quiet period elapses, confirming binned execution.

3. **Observer Teardown Test:**
   - Triggers mutation events, then immediately calls `stop()`.
   - Asserts that `debounceTimer` is cleared, `observer.disconnect()` is called, and no deferred `scanAndApprove` callbacks fire afterwards.

---
Next Phase: [`phase-02-webview-ipc-batching-dom-pruning.md`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/plans/260829-1556-audit-critical-warnings-remediation/phase-02-webview-ipc-batching-dom-pruning.md)
