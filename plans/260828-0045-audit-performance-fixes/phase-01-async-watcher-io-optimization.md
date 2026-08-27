# Phase 01: Asynchronous Watcher & Non-Blocking I/O Optimization
Status: 🟢 Completed
Dependencies: None

## Objective
Remediate **Critical Issue 1 (Synchronous Disk I/O Throttling in 100ms Polling Loop)** and **Warning 3 (Race Condition between `fs.watch` and Polling)** in `src/transcriptWatcher.ts`. Transition conversation discovery from CPU-blocking synchronous directory traversal to high-performance asynchronous directory inspection with root `mtime` modification guards, in-memory folder cache, active `fs.watch` directory monitoring, and an atomic `isChecking` concurrency lock.

## Requirements
### Functional
- [x] **Root `mtime` Change Guard**:
  - Before scanning subdirectories in `brainDir`, check the root folder's `mtime`. If the root directory `mtime` has not changed since the last inspection and the cached result is valid, immediately skip traversing subdirectories.
- [x] **In-Memory Directory Stat Cache**:
  - Maintain a cache `Map<string, { mtime: number }>` for known conversation directories.
  - Only perform `fs.stat` / `fs.promises.stat` on newly discovered directory entries rather than repeatedly statting hundreds or thousands of existing folders on every tick.
- [x] **Asynchronous Conversation Discovery**:
  - Introduce `findLatestConversationAsync(brainDir, sinceTimestamp, excludeConvId)` using non-blocking `fs.promises.readdir` and `fs.promises.stat`.
  - Refactor `waitForNewConversation` to utilize async non-blocking iteration so the VS Code Extension Host main event loop is never frozen.
  - Maintain synchronous `findLatestConversation` as an optimized backwards-compatible helper backed by the directory cache.
- [x] **Instant Directory Watcher with `fs.watch`**:
  - Attach an active `fs.watch` on `brainDir` to trigger conversation checks instantly upon directory creation events (`rename` / `change`).
  - Tune fallback polling interval from 100ms to 300ms–500ms when `fs.watch` is operational.
- [x] **Concurrency Mutex Lock (`isChecking` / `isProcessing`)**:
  - Implement a boolean lock (`isCheckingFile` / `isProcessing`) inside `watchFile` to guarantee that concurrent `fs.watch` events and fallback timer ticks never execute overlapping reads against the transcript file.
  - Ensure the lock is always reset in a `finally` block even if errors occur.

### Non-Functional
- [x] **CPU & I/O Reduction**: Reduce `fs.stat` calls during idle waiting by > 99% in environments with 500+ conversations.
- [x] **Low Latency Detection**: Maintain sub-200ms detection latency for newly created conversation directories.

## Files to Create/Modify
- `src/transcriptWatcher.ts` - Implement folder caching, root mtime guard, `findLatestConversationAsync`, async `waitForNewConversation`, `fs.watch` on `brainDir`, and concurrency lock.
- `src/test/phase01_async_watcher_io.test.ts` - Comprehensive single test file for Phase 01.

## Test Criteria
- [x] Exactly one file-based test: `src/test/phase01_async_watcher_io.test.ts`.
- [x] Verifies async conversation detection with `waitForNewConversation` on simulated brain directories.
- [x] Verifies root `mtime` guard and folder cache: ensures 0 repeated `stat` calls for previously indexed directories when no directory changes occur.
- [x] Verifies anti-pollution isolation: correctly ignores `excludeConvId` and older timestamps asynchronously.
- [x] Verifies concurrency mutex lock: simulates simultaneous `fs.watch` triggers and polling ticks, confirming zero duplicate line processing or overlapping reads.
- [x] Verifies proper resource cleanup on `stop()` / `dispose()`.

---
Next Phase: [phase-02-batch-powershell-keystroke-automation.md](file:///D:/skul9x/Auto-Plan_Extension/plans/260828-0045-audit-performance-fixes/phase-02-batch-powershell-keystroke-automation.md)

