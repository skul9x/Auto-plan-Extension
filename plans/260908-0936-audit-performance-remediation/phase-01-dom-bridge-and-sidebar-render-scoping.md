# Phase 01: DOM Bridge Scoping & Sidebar Render Optimization
Status: ✅ Completed
Dependencies: None

## Objective
Eliminate CPU spikes, typing latency, and frame drops in the Electron Renderer process by scoping `MutationObserver` to dialog/notification events, eliminating `querySelectorAll('*')` deep scans in `media/autoplan-dom-bridge.js`, and replacing full `innerHTML` wipeouts with in-place DOM reconciliation in `media/sidebar/sidebar.js`.

## Requirements
### Functional
- [x] Refactor `MutationObserver` in `media/autoplan-dom-bridge.js`:
  - Dynamically target dialog/toast containers (`.notifications-toasts`, `.monaco-dialog-box`, `.action-widget`) when present.
  - When observing `document.body`, inspect `mutation.addedNodes` to filter specifically for dialog/notification elements before triggering scans, ignoring unrelated editor cursor blinks, typing, terminal mutations, and minimap repaints.
- [x] Remove `querySelectorAll('*')` from `queryDeep()` container traversal:
  - Replace wildcard query with targeted selectors (`container.querySelectorAll('iframe, frame')`).
  - Eliminate deep exhaustive iteration across all DOM elements in the VS Code window.
- [x] Implement adaptive throttle & backoff for `scanAndApprove`:
  - When no dialog buttons are detected, increase idle polling interval from 50ms up to 800ms–1000ms.
  - Instantly trigger immediate scan upon detecting relevant dialog mutations.
- [x] Update `renderPhaseList` in `media/sidebar/sidebar.js`:
  - Reconcile and update existing `.phase-item` DOM elements by index/key instead of destroying and re-instantiating `phaseList.innerHTML = ''` on every state tick.
  - Preserve checkbox event listeners and update only modified attributes (classes, status badges, tooltips).

### Non-Functional
- [x] Renderer idle CPU usage drops to near 0%.
- [x] Typing latency and UI responsiveness in VS Code editor remains completely unaffected by DOM bridge background polling.
- [x] Full backwards compatibility with all permission auto-approval patterns and sidebar interactive controls.

## Implementation Steps
1. Modify `media/autoplan-dom-bridge.js`:
   - Implement `isRelevantDialogMutation(mutationList)` filter helper.
   - Attach targeted observer or filter mutations at the root observer callback.
   - Refactor `queryDeep` to remove `container.querySelectorAll('*')` loops.
   - Add adaptive backoff interval logic for idle state.
2. Modify `media/sidebar/sidebar.js`:
   - Refactor `renderPhaseList` to reuse existing `.phase-item` DOM elements, updating class names, status badges, and tooltip text in-place.
3. Create verification test `src/test/phase01_dom_bridge_scoping_render_optimization.test.ts`.

## Files to Create/Modify
- `media/autoplan-dom-bridge.js` - Filtered/scoped MutationObserver, wildcard query elimination, and adaptive backoff
- `media/sidebar/sidebar.js` - In-place DOM reconciliation for phase list
- `src/test/phase01_dom_bridge_scoping_render_optimization.test.ts` - Single comprehensive verification test

## Test Criteria
- [x] Verification test asserts `MutationObserver` ignores editor typing/cursor mutations and only triggers on dialog/toast additions.
- [x] Verification test confirms `queryDeep` does not execute wildcard `*` element iteration.
- [x] Verification test validates in-place DOM updates in `renderPhaseList` preserving existing element references across state updates.

---
Next Phase: [Phase 02: Transcript Non-blocking Stream & Line Counter](file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main/plans/260908-0936-audit-performance-remediation/phase-02-transcript-nonblocking-stream-reader.md)
