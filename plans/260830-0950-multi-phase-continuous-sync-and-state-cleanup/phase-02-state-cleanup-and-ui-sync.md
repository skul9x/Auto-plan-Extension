# Phase 02: Execution State Cleanup & Sidebar/StatusBar UI Synchronization

Status: ✅ Completed  
Dependencies: Phase 01  
Target Files:
- `src/orchestrator.ts`
- `src/extension.ts`
- `src/sidebarProvider.ts`
- `media/sidebar/sidebar.js`
- `media/sidebar/sidebar.css`
- `src/test/phase02_state_cleanup_and_ui_sync.test.ts`

---

## 1. Objective

Ensure 100% clean state transitions across the Orchestrator, Status Bar item, and Sidebar Webview dashboard when automation is stopped, cancelled, paused, or finished. Ensure stopped phases are converted from `'Running'` to `'Stopped'`, remove persistent spinning icons (`$(sync~spin)` and `🔄 Running`), and render correct badges and tooltips. Provide a comprehensive file-based verification test suite in `src/test/phase02_state_cleanup_and_ui_sync.test.ts`.

---

## 2. Technical Requirements

1. **Orchestrator Stop & Abort Cleanup (`src/orchestrator.ts`):**
   - In `public stop()` and when handling abort signals, iterate through `this.phases` and update any phase with `status === 'Running'` to `status = 'Stopped'` with `endTime = Date.now()`.
   - In `runPhaseSequence` catch blocks when not aborted, ensure current phase status transitions to `'Failed'`.
   - Ensure `this.state` transitions cleanly to `'stopped'`.
2. **Sidebar View Rendering Fix (`media/sidebar/sidebar.js` & `src/sidebarProvider.ts`):**
   - In `renderPhaseList`, change the `isCurrent` predicate from:
     ```javascript
     const isCurrent = (index === currentIdx && currentState === 'running') || phase.status === 'Running';
     ```
     to:
     ```javascript
     const isCurrent = currentState === 'running' && (index === currentIdx || phase.status === 'Running');
     ```
   - Add explicit support for `phase.status === 'Stopped'` with class `tag-stopped`, label `⏹️ Stopped`, and tooltip `Execution was stopped.`
   - In `media/sidebar/sidebar.css`, add styling for `.tag-stopped`:
     ```css
     .status-tag.tag-stopped {
       background: rgba(255, 165, 0, 0.2);
       color: #ffa500;
       border: 1px solid rgba(255, 165, 0, 0.4);
     }
     ```
3. **Status Bar Item Reset (`src/extension.ts`):**
   - In `orchestrator.on('stopped')`, explicitly trigger `updateStatusBar({ state: 'stopped' })` and `sidebarProvider?.refreshAndSendState()`.
   - In `updateStatusBar()`, ensure that whenever `info.state === 'stopped'` or `info.state === 'idle'`, `mainStatusBarItem.text` is reset to `'$(rocket) Auto-Plan'` and all spin intervals and elapsed timers are terminated.

---

## 3. Automated File-Based Test (`src/test/phase02_state_cleanup_and_ui_sync.test.ts`)

Create exactly one comprehensive test verifying:
1. When `orchestrator.stop()` is triggered while a phase is in `'Running'` state:
   - The phase status transitions from `'Running'` to `'Stopped'`.
   - `orchestrator.getState()` returns `'stopped'`.
2. Status bar logic updates text from `$(sync~spin) ...` to `$(rocket) Auto-Plan`.
3. Simulated Webview `renderStateUpdate` does not mark stopped phases as `running` and renders the `⏹️ Stopped` badge correctly.

---

## 4. Verification Plan

```bash
npx tsc && node out/test/phase02_state_cleanup_and_ui_sync.test.js
```

---
Next Phase: [phase-03-continuous-execution-regression.md](./phase-03-continuous-execution-regression.md)
