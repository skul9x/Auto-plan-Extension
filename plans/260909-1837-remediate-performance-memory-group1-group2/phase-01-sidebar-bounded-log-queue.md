# Phase 01: Sidebar Bounded Log Queue & Memory Leak Prevention (MEM-03)
Status: ✅ Completed
Dependencies: None

## Objective
Eliminate the unbounded memory leak in `src/sidebarProvider.ts` where `_pendingLogQueue` grows without restriction when the Sidebar webview is hidden or unready, ensuring memory stability over thousands of background log events, safe teardown on disposal, and smooth reopening of the webview.

## Requirements
### Functional
- [x] In `src/sidebarProvider.ts`:
  - Define explicit constant `MAX_PENDING_LOGS = 150` (sliding-window queue cap).
  - In `appendTranscriptLog(log: string)`:
    - Enforce sliding-window FIFO eviction on `this._pendingLogQueue`:
      ```typescript
      this._pendingLogQueue.push(log);
      if (this._pendingLogQueue.length > MAX_PENDING_LOGS) {
        this._pendingLogQueue.shift();
      }
      ```
  - In `flushPendingLogs()`:
    - Clear and nullify `this._logFlushTimer`.
    - If `!this._isWebviewReady`, return early without throwing, ensuring `this._pendingLogQueue` remains clamped to `MAX_PENDING_LOGS`.
  - In `dispose()`:
    - Cancel `_readyFallbackTimer` if running.
    - If webview is ready, flush pending logs (`this.flushPendingLogs()`).
    - Cancel active `_logFlushTimer` if still present (`clearTimeout(this._logFlushTimer); this._logFlushTimer = null;`).
    - Unconditionally clear `this._pendingLogQueue = []` and `this._transcriptLogs = []` to prevent memory leaks when webview is disposed while unready.
  - Add public `clearLogs(): void`:
    - Resets both `this._transcriptLogs = []` and `this._pendingLogQueue = []`, cancelling any active `_logFlushTimer`.
  - Add public inspection helper `getPendingLogsCount(): number`:
    - Returns `this._pendingLogQueue.length` for deterministic unit test assertions.

### Non-Functional
- [x] Memory footprint remains strictly O(1) bounded regardless of how many thousands of transcript log lines arrive while the webview is hidden or unready.
- [x] Zero impact on normal log delivery when webview is active and ready.
- [x] Backwards compatible with existing disposal and batching contracts in `phase02_webview_ipc_batching_dom_pruning.test.ts`.

## Implementation Steps
1. Define `MAX_PENDING_LOGS = 150` in `src/sidebarProvider.ts`.
2. Update `appendTranscriptLog`, `flushPendingLogs`, `clearLogs`, and `dispose` in `src/sidebarProvider.ts`.
3. Add `getPendingLogsCount()` helper method to `SidebarProvider`.
4. Run `npm run compile` to ensure zero compilation diagnostics.
5. Create single verification test `src/test/phase01_sidebar_log_queue_memory_leak.test.ts` to verify:
   - Emitting 2,500 log events while `_isWebviewReady === false` keeps `getPendingLogsCount() <= 150`.
   - When webview transitions to ready, exactly 150 most recent logs flush cleanly as a single batch without IPC errors.
   - Calling `dispose()` resets `_pendingLogQueue` to 0 and clears the timer even when webview was never ready.
   - Calling `clearLogs()` resets queues immediately.

## Files to Create/Modify
- `src/sidebarProvider.ts` - Implement bounding cap on `_pendingLogQueue`, `clearLogs`, and complete disposal cleanup
- `src/test/phase01_sidebar_log_queue_memory_leak.test.ts` - Comprehensive single verification test

## Test Criteria
- [x] `npm run compile && node out/test/phase01_sidebar_log_queue_memory_leak.test.js` passes with code 0 (100% assertions verified).

---
Next Phase: [Phase 02: Transcript Ownership Stat & Content Cache](./phase-02-transcript-ownership-cache.md)
