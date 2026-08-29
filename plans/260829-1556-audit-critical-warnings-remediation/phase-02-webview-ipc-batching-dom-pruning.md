# Phase 02: Webview IPC Log Batching & Sliding Window DOM Pruning

Status: ✅ Completed  
Audit Items Addressed: **Critical Issue 2** (Webview IPC Message Storm on `logUpdate`) & **Warning 1** (Unbounded DOM Growth in Sidebar Transcript).

## Objective
Prevent Webview freezing and UI unresponsiveness caused by rapid streams of `postMessage` log updates during AI execution. Buffer log updates in `src/sidebarProvider.ts` and dispatch them in batched IPC messages at 100ms–200ms intervals. Enforce a sliding window cap (max 200 lines) in `media/sidebar/sidebar.js` with automatic oldest-line DOM pruning.

## Requirements

### Functional Requirements
- **IPC Log Queue Buffering & Batching:**
  - `SidebarProvider` in `src/sidebarProvider.ts` must maintain a pending log queue array (`_pendingLogQueue: string[]`) and a batch flush timer (`_logFlushTimer: NodeJS.Timeout | null`).
  - Calls to `appendTranscriptLog(log: string)` must push log strings into `_pendingLogQueue` and schedule a flush within a 100ms–200ms window.
  - When flushed, if multiple logs are queued, `SidebarProvider` dispatches a single batched IPC message `{ type: 'transcriptLogBatch', command: 'transcriptLogBatch', logs: string[] }`.
  - Maintain backward compatibility for single log messages `{ type: 'transcriptLog', command: 'transcriptLog', log: string }`.
- **Sliding Window DOM Pruning in Webview:**
  - `media/sidebar/sidebar.js` must handle both `transcriptLogBatch` and `transcriptLog` messages.
  - `transcriptLog` element in `sidebar.js` must be capped at a maximum of 200 text lines.
  - When line count exceeds 200, automatically slice/prune the top (oldest) lines from `transcriptLog.textContent` to prevent DOM tree bloating and memory leaks.

### Non-Functional Requirements
- **IPC Efficiency:** Reduced IPC postMessage traffic by up to 90% during high-speed AI output streaming.
- **UI Smoothness:** Webview controls and buttons must remain interactive and crisp even when processing hundreds of log lines per second.

## Implementation Steps

1. **Update `SidebarProvider` in [`src/sidebarProvider.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/sidebarProvider.ts):**
   - Add `private _pendingLogQueue: string[] = [];` and `private _logFlushTimer: NodeJS.Timeout | null = null;`.
   - Refactor `appendTranscriptLog(log: string)` to push to `_pendingLogQueue`.
   - Implement `flushPendingLogs()` method that sends batched IPC message and resets the timer.
   - Add `dispose()` or cleanup method to flush pending logs when provider is destroyed.

2. **Update `renderTranscriptLog` in [`media/sidebar/sidebar.js`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/media/sidebar/sidebar.js):**
   - Add message listener support for `transcriptLogBatch`.
   - Create a helper `appendAndPruneLogLines(lines: string[])`.
   - Split existing `transcriptLog.textContent` by newline, append new lines, and if total lines > 200, retain only the last 200 lines (`lines.slice(-200).join('\n')`).

3. **Update TranscriptWatcher Listener in [`src/extension.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/extension.ts):**
   - Verify `transcriptWatcher.on('logUpdate', ...)` cleanly routes to `sidebarProvider.appendTranscriptLog`.

4. **Create Detailed Verification Test (`src/test/phase02_webview_ipc_batching_dom_pruning.test.ts`):**
   - Construct a unit test suite to verify IPC batching and DOM pruning logic.

## Files to Create / Modify
- `[MODIFY]` [`src/sidebarProvider.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/sidebarProvider.ts) - Implement log buffering queue and batched IPC postMessage dispatcher.
- `[MODIFY]` [`media/sidebar/sidebar.js`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/media/sidebar/sidebar.js) - Implement `transcriptLogBatch` handler and 200-line sliding window DOM pruning.
- `[NEW]` [`src/test/phase02_webview_ipc_batching_dom_pruning.test.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/test/phase02_webview_ipc_batching_dom_pruning.test.ts) - Verification test for log batching and sliding window DOM line capping.

## Detailed Verification Test Plan

### Test File: `src/test/phase02_webview_ipc_batching_dom_pruning.test.ts`

The test file will execute the following automated verifications:

1. **IPC Message Batching Test:**
   - Instantiate `SidebarProvider` with a mock Webview object.
   - Fire 100 rapid `appendTranscriptLog` calls within 10ms.
   - Assert that zero immediate `postMessage` calls are dispatched instantly.
   - Advance clock by 150ms.
   - Assert that `postMessage` is called exactly ONCE with a `transcriptLogBatch` payload containing all 100 log lines.

2. **DOM Line Pruning Test:**
   - Simulate Webview transcript renderer with initial empty content.
   - Feed 350 log lines sequentially using the pruning logic.
   - Split `transcriptLog.textContent` by `\n`.
   - Assert that line count does not exceed 200 lines.
   - Assert that lines 1..150 are correctly pruned and line 350 is present at the end of the text content.

3. **Batch Teardown & Immediate Flush Test:**
   - Push 50 log lines into `SidebarProvider`, then trigger explicit state refresh or provider shutdown.
   - Assert that all pending buffered logs are flushed immediately without data loss.

---
Next Phase: [`phase-03-async-plan-scanner-bounded-io.md`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/plans/260829-1556-audit-critical-warnings-remediation/phase-03-async-plan-scanner-bounded-io.md)
