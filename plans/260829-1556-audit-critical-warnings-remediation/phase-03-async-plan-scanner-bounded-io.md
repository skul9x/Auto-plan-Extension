# Phase 03: Asynchronous Non-Blocking Plan Scanner & Bounded Header Reading

Status: ✅ Completed  
Audit Items Addressed: **Critical Issue 3** (Main Thread Event Loop Sync I/O blocking Extension Host) & **Warning 2** (Full-File Read for Header Status Detection).

## Objective
Eliminate Extension Host Event Loop freezes and UI micro-stutters caused by synchronous file I/O operations (`fs.existsSync`, `fs.readdirSync`, `fs.readFileSync`, `fs.statSync`) in `src/planScanner.ts`, `src/extension.ts`, and `src/sidebarProvider.ts`. Implement bounded initial 4KB header reading for phase completion status detection, non-blocking asynchronous directory scanning (`fs.promises`), and in-memory plan discovery caching.

## Requirements

### Functional Requirements
- **Bounded Header Chunk Read:**
  - `detectPhaseStatus(filePath: string)` in `src/planScanner.ts` must be refactored to read only the initial 4KB chunk of the target markdown file using a bounded file descriptor stream/buffer slice (`fs.openSync` + `fs.readSync` into 4KB `Buffer` or async equivalent), rather than loading full multi-MB file contents into RAM via `fs.readFileSync(filePath, 'utf8')`.
  - Add async variant `detectPhaseStatusAsync(filePath: string): Promise<'Completed' | 'Pending'>`.
- **Asynchronous Plan Scanner:**
  - Provide `scanPlanFolderAsync(folderPath: string, options?: ScanOptions): Promise<PhaseFile[]>` in `src/planScanner.ts` utilizing `fs.promises.readdir`, `fs.promises.stat`, and `detectPhaseStatusAsync`.
- **Asynchronous Workspace Plan Discovery:**
  - Provide `discoverWorkspacePlanFoldersAsync(forceRefresh?: boolean): Promise<{ folderPath: string; relName: string; phaseCount: number }[]>` in `src/extension.ts` backed by `PLAN_DISCOVERY_CACHE_TTL_MS` (5000ms TTL).
- **Non-Blocking Sidebar Integration:**
  - Update `SidebarProvider.refreshAndSendState()` in `src/sidebarProvider.ts` to execute plan scanning asynchronously without blocking the VS Code Extension Host main thread.

### Non-Functional Requirements
- **Zero Event Loop Blocking:** Extension Host main thread frame duration stays under 16ms during workspace-wide plan scanning.
- **Memory Optimization:** Reading 5MB markdown files consumes <10KB RAM instead of multi-megabyte buffer allocations.

## Implementation Steps

1. **Refactor Status Detection in [`src/planScanner.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/planScanner.ts):**
   - Implement `detectPhaseStatus(filePath: string)` with bounded 4KB read using `fs.openSync` / `fs.readSync` wrapped in `try...finally` with `fs.closeSync(fd)` to guarantee file handle cleanup.
   - Implement `detectPhaseStatusAsync(filePath: string): Promise<'Completed' | 'Pending'>` using `fs.promises.open` wrapped in `try...finally` with `handle.close()`.
   - Parse top 30 lines of the 4KB header chunk using `PHASE_COMPLETED_SIGNATURE`.

2. **Add `scanPlanFolderAsync` in [`src/planScanner.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/planScanner.ts):**
   - Implement async directory traversal with `fs.promises.readdir` (with `{ withFileTypes: true }`).
   - Map candidates to `PhaseFile` using `detectPhaseStatusAsync`.

3. **Add Async Discovery in [`src/extension.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/extension.ts):**
   - Implement `discoverWorkspacePlanFoldersAsync(forceRefresh?: boolean)`.
   - Maintain backwards-compatible fallback wrappers for synchronous calls.

4. **Update `SidebarProvider` in [`src/sidebarProvider.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/sidebarProvider.ts):**
   - Update `refreshAndSendState()` to await async scanning and workspace discovery.

5. **Create Detailed Verification Test (`src/test/phase03_async_plan_scanner_bounded_io.test.ts`):**
   - Construct a unit test suite to verify bounded header reading performance and async plan scanner correctness.

## Files to Create / Modify
- `[MODIFY]` [`src/planScanner.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/planScanner.ts) - Bounded header reading & `scanPlanFolderAsync`.
- `[MODIFY]` [`src/extension.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/extension.ts) - `discoverWorkspacePlanFoldersAsync` & async cache integration.
- `[MODIFY]` [`src/sidebarProvider.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/sidebarProvider.ts) - Non-blocking async state refresh.
- `[NEW]` [`src/test/phase03_async_plan_scanner_bounded_io.test.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/test/phase03_async_plan_scanner_bounded_io.test.ts) - Verification test suite for bounded I/O reading and async plan scanning.

## Detailed Verification Test Plan

### Test File: `src/test/phase03_async_plan_scanner_bounded_io.test.ts`

The test file will execute the following automated verifications:

1. **Bounded Header Read Performance Test:**
   - Generate a mock 5MB markdown file with `Status: Completed` located at line 3, followed by 5,000,000 bytes of dummy text.
   - Measure time and RAM required by `detectPhaseStatus` and `detectPhaseStatusAsync`.
   - Assert that execution completes in < 5ms.
   - Assert that `detectPhaseStatus` returns `'Completed'` accurately without reading beyond the initial 4KB buffer.

2. **Async Plan Scanner Equivalence Test:**
   - Create a temporary directory containing 10 phase markdown files (some completed, some pending).
   - Execute both `scanPlanFolder` (sync) and `scanPlanFolderAsync` (async).
   - Assert that both functions return identical phase file objects, natural sorting, and status flags.

3. **Plan Discovery Cache & Async Discovery Test:**
   - Call `discoverWorkspacePlanFoldersAsync()`.
   - Verify cached result is returned instantly on consecutive calls within TTL (5000ms).
   - Verify cache invalidation when `forceRefresh = true` or `clearPlanDiscoveryCache()` is called.

---
Next Phase: [`phase-04-watcher-backoff-event-tooltip.md`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/plans/260829-1556-audit-critical-warnings-remediation/phase-04-watcher-backoff-event-tooltip.md)
