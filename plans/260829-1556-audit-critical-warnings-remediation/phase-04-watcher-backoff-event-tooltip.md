# Phase 04: Watcher Polling Backoff & Event-Driven Status Bar Tooltip

Status: ✅ Completed  
Audit Items Addressed: **Critical Issue 4** (Dual Polling vs `fs.watch` Redundancy) & **Warning 3** (Unconditional 1s Status Bar Tooltip Timer).

## Objective
Reduce idle CPU cycles and energy waste caused by redundant 300ms fallback polling timers in `TranscriptWatcher` (`src/transcriptWatcher.ts`) and unconditional 1000ms Status Bar tooltip rebuilding timers in `src/extension.ts`. Relax polling interval to 1000ms–1500ms when native `fs.watch` is active, and update Status Bar tooltip on event state transitions instead of unconditioned 1-second ticks.

## Requirements

### Functional Requirements
- **TranscriptWatcher Adaptive Polling Backoff:**
  - In `src/transcriptWatcher.ts`, when native `fs.watch` is successfully established, relax the backup polling timer interval from 300ms to 1000ms–1500ms (`relaxedPollIntervalMs = 1200`).
  - Keep 300ms rapid polling active ONLY when `fs.watch` fails, is unsupported, or throws an error.
  - Automatically fallback to 300ms if native watcher emits an error or drops events.
- **Event-Driven Status Bar Tooltip Updates:**
  - In `src/extension.ts`, remove continuous 1000ms `setInterval` tooltip generation inside `startElapsedTimer`.
  - Update `mainStatusBarItem.tooltip` on state change events: phase start, phase progress update, phase completion, pause, resume, or error.
  - Maintain a light minute tick (every 60s) for updating elapsed time in tooltip, rather than updating every 1,000ms when text content is unchanged.

### Non-Functional Requirements
- **Energy & CPU Savings:** Lower idle CPU cycles for inactive extension state by 85–95%.
- **Responsive Status Bar:** Tooltip and status text reflect exact phase transitions immediately when emitted by the orchestrator.

## Implementation Steps

1. **Update `TranscriptWatcher` in [`src/transcriptWatcher.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/transcriptWatcher.ts):**
   - Add `activePollIntervalMs` option logic (default 1200ms when `fs.watch` is active, 300ms when fallback).
   - In `watchFile` and `waitForNewConversation`, adjust interval parameters depending on `fsWatcher` / `brainFsWatcher` success.
   - Attach `.on('error')` listener on `fsWatcher` and `brainFsWatcher` to automatically downgrade polling interval to 300ms if native watcher fails or emits errors.

2. **Refactor Tooltip Timer in [`src/extension.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/extension.ts):**
   - Update `startElapsedTimer(info)` to trigger tooltip recalculation only when elapsed minute boundary rolls over or on progress change events.
   - Refactor `updateStatusBar(info)` to set `mainStatusBarItem.tooltip` directly upon receiving orchestrator progress events.

3. **Create Detailed Verification Test (`src/test/phase04_watcher_backoff_event_tooltip.test.ts`):**
   - Construct a unit test suite to verify watcher polling backoff and event-driven tooltip generation.

## Files to Create / Modify
- `[MODIFY]` [`src/transcriptWatcher.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/transcriptWatcher.ts) - Relax polling interval when native `fs.watch` is active.
- `[MODIFY]` [`src/extension.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/extension.ts) - Replace continuous 1s tooltip timer with event-driven updates.
- `[NEW]` [`src/test/phase04_watcher_backoff_event_tooltip.test.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/test/phase04_watcher_backoff_event_tooltip.test.ts) - Verification test for watcher polling backoff and event-driven tooltip generation.

## Detailed Verification Test Plan

### Test File: `src/test/phase04_watcher_backoff_event_tooltip.test.ts`

The test file will execute the following automated verifications:

1. **Watcher Polling Backoff Test:**
   - Instantiate `TranscriptWatcher` and trigger file watching with a working native `fs.watch`.
   - Verify that the active backup polling interval is relaxed to 1200ms instead of 300ms.
   - Simulate native `fs.watch` failure/error event.
   - Assert that polling interval adaptively falls back to 300ms for high responsiveness.

2. **Event-Driven Tooltip Caching & Update Test:**
   - Call `updateStatusBar(info)` with an active phase execution state.
   - Verify initial tooltip is built and cached in `getCachedRunningTooltip`.
   - Advance fake clock by 500ms without state change; verify tooltip calculation function is NOT re-invoked.
   - Pass updated `info` state; verify tooltip updates immediately upon event notification.

---
Next Phase: N/A (Remediation Plan Complete)
