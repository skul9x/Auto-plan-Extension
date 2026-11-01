# Phase 03: Disk I/O Deduplication & Concurrency Bounding

Status: ✅ Completed
Test: `src/test/phase03_disk_io_deduplication_concurrency.test.ts`

## Objective
Eliminate redundant filesystem I/O operations, transition synchronous blocking disk calls on the Extension Host main thread to non-blocking cached operations, and bound concurrent file descriptor usage to prevent file descriptor exhaustion (`EMFILE`).

## Scope
- Multi-workspace registration checks in `src/telegramChatMirror.ts` (`isMultiWorkspaceRegistered`, `getWorkspaceTag`).
- Phase scanning and auditing pipelines in `src/planScanner.ts` (`scanPlanFolderAsync`, `scanMultiplePlanFoldersAsync`, `auditPlanPhasesAsync`, `auditPlanPhases`).
- Environment inspection and telemetry aggregation in `src/debugLogger.ts` (`buildEnvironmentReport`, `registerPlanAuditProvider`).
- Synchronous phase audit call-sites in `src/extension.ts` and `src/settingsProvider.ts`.

## Requirements
1. **Asynchronous Cached Workspace Registration**:
   - Eliminate synchronous `fs.existsSync()`, `fs.readFileSync()`, and `JSON.parse()` calls within `TelegramChatMirror.isMultiWorkspaceRegistered()`.
   - Implement an in-memory cached state for multi-workspace port registry resolution with time-to-live (TTL) invalidation or asynchronous file watching.
   - Ensure `getWorkspaceTag()` executes in $O(1)$ memory without disk syscalls during active Q&A mirroring.
2. **Single-Pass Phase File Inspection in Plan Scanner**:
   - Enhance `PhaseFile` and the scanning pipeline in `src/planScanner.ts` to retain phase header validation status (`headerSyntaxValid`, raw status, errors) during initial discovery.
   - Refactor `auditPlanPhasesAsync()` so that it consumes pre-parsed header metadata produced by `scanPlanFolderAsync()` rather than re-opening and re-reading the exact same 4 KB chunk from every phase file a second time.
   - Eliminate duplicate file reads, halving the total disk I/O operations for every phase audit.
3. **Concurrency Bounded File Operations**:
   - Replace unbounded `Promise.all()` over phase files and directories in `scanPlanFolderAsync()`, `scanMultiplePlanFoldersAsync()`, and `auditPlanPhasesAsync()` with a concurrency-bounded worker pool (e.g., maximum 16 concurrent file descriptors).
   - Ensure repositories with dozens or hundreds of phase markdown files cannot exhaust the `libuv` thread pool or trigger OS `EMFILE` errors.
4. **Non-Blocking Audit Telemetry & Environment Reporting**:
   - Convert synchronous call-sites of `auditPlanPhases` in `src/extension.ts` and `src/settingsProvider.ts` to async equivalents or cached snapshots.
   - Ensure `buildEnvironmentReport()` in `src/debugLogger.ts` does not execute synchronous file reads of `workbench.html` on the Extension Host main thread during active execution.

## Constraints
- Preserve exact sorting and numbering invariants for phase files across workspaces.
- Maintain backward compatibility of return types for `scanPlanFolderAsync` and `auditPlanPhasesAsync`.
- Do not introduce race conditions when plan files are modified while an audit is in progress.

## Dependencies
- Source files: `src/telegramChatMirror.ts`, `src/planScanner.ts`, `src/debugLogger.ts`, `src/extension.ts`, `src/settingsProvider.ts`.
- Node.js APIs: `fs.promises`, `path`.

## Acceptance Criteria
- `getWorkspaceTag()` performs zero synchronous disk reads on repeated invocations during chat mirroring.
- Auditing a plan directory with $N$ phase files performs exactly $N$ file read operations instead of $2N$.
- Concurrently scanning multiple plan directories respects the maximum concurrency limit of 16 file descriptors.
- Diagnostic telemetry and settings panel interactions execute without invoking synchronous `fs` methods on the main thread.

## Comprehensive File-Based Test
- **File**: `src/test/phase03_disk_io_deduplication_concurrency.test.ts`
- **Scope**:
  - Tracks file system syscall counts (`open`, `read`, `stat`) during `auditPlanPhasesAsync` on a fixture containing multiple phase files to prove exact single-pass I/O.
  - Verifies that `isMultiWorkspaceRegistered` uses cached state and makes no synchronous disk reads during rapid message simulations.
  - Tests concurrency bounding on a large plan fixture (50+ files) verifying that active file descriptors never exceed 16.
  - Validates that environment reports and phase telemetry are assembled asynchronously without main-thread blocking.
