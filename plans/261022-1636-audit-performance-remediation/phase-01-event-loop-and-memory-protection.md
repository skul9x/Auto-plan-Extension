# Phase 01: Event Loop, Memory Protection & String Serialization

Status: ✅ Completed
Test: `src/test/phase01_dom_snapshot_logging_memory.test.ts`

## Objective
Eliminate Extension Host main-thread event loop blocking and unbounded memory retention caused by multi-megabyte DOM snapshot serialization and un-gated debug logging during command failures and active monitoring.

## Scope
- Diagnostic error reporting in `src/promptDispatcher.ts` (`dispatchTier1`, error capture, and logging call sites).
- String serialization, log entry formatting, ring-buffer payload retention, and output channel streaming in `src/debugLogger.ts`.
- Memory footprint bounding for failed dispatch entries and diagnostic payloads.

## Requirements
1. **DOM Snapshot Sanitization in Dispatcher**:
   - Prevent raw, multi-megabyte HTML `domSnapshot` strings from being passed directly into `DebugLogger.error()`, `DebugLogger.warn()`, or `DebugLogger.info()` details payloads.
   - Replace or summarize raw DOM snapshot strings with compact diagnostic descriptors (such as character length, element count summary, or bounded preview) before log ingestion.
   - Ensure the original full error details remain accessible to genuine error handlers without being serialized into the logging ring buffer.
2. **Defensive Serialization Bounds in DebugLogger**:
   - Enhance `safeStringify` in `src/debugLogger.ts` with hard bounds for individual string fields and total serialized payload size.
   - Ensure that deeply nested or unexpectedly large objects passed to `formatEntry` or `log` cannot freeze the V8 event loop during string conversion.
3. **Configuration-Gated Debug Log Streaming**:
   - Ensure `DEBUG`-level log entries do not execute expensive string formatting or transmit IPC messages across `OutputChannel.appendLine()` unless `enableVerboseBridgeLogs` is explicitly enabled.
   - Maintain bounded ring-buffer storage behavior while preventing continuous IPC overhead to the renderer process during normal execution.
4. **Ring Buffer Memory Stability**:
   - Ensure that even under sustained command timeouts and repeated failure loops, total memory retained by the 500-entry `DebugLogger.entries` ring buffer remains constrained within safe heap limits (< 10 MB overhead for log details).

## Constraints
- Do not remove existing error classifications, error codes, or diagnostic steps required by Tier 2 and Tier 3 fallback arbitration.
- Maintain circular reference detection (`WeakSet`) in `safeStringify`.
- Preserve the external API contract of `DebugLogger.log`, `DebugLogger.debug`, `DebugLogger.info`, `DebugLogger.warn`, and `DebugLogger.error`.

## Dependencies
- Source files: `src/promptDispatcher.ts`, `src/debugLogger.ts`, `src/config.ts`.
- Diagnostic contracts: `DispatchReadinessResult`, `CommandAckResult`, `LogEntry`.

## Acceptance Criteria
- Triggering Tier 1 errors containing a 5 MB synthetic DOM snapshot completes logging and formatting without blocking the event loop for more than 15ms.
- Log entries stored in `DebugLogger.entries` retain only bounded representations of DOM snapshots, keeping average entry footprint below 4 KB.
- `DebugLogger.debug()` calls do not invoke `OutputChannel.appendLine()` when `enableVerboseBridgeLogs` is set to `false`.
- Calling `DebugLogger.formatEntry()` on an object with oversized string properties truncates those properties cleanly with an indication of omission.

## Comprehensive File-Based Test
- **File**: `src/test/phase01_dom_snapshot_logging_memory.test.ts`
- **Scope**:
  - Simulates Tier 1 dispatch failure with a multi-megabyte DOM snapshot payload and verifies that logged details are sanitized and memory-bounded.
  - Benchmarks execution time of `safeStringify` and `formatEntry` when presented with massive DOM strings to ensure non-blocking performance.
  - Verifies that `OutputChannel.appendLine` is bypassed for `DEBUG` level when `enableVerboseBridgeLogs` is disabled, and active when enabled.
  - Verifies that 500 consecutive failed dispatch entries do not cause heap ballooning in `DebugLogger`.
