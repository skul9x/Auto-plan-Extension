# Phase 03: Chunked Stream Processing & Listener Leak Elimination
Status: 🟢 Completed
Dependencies: phase-02-batch-powershell-keystroke-automation.md

## Objective
Remediate **Warning 4 (Accumulation of Event Listener Leaks / `MaxListenersExceededWarning`)** and **Warning 5 (GC Pressure on Large Transcript File Reads)**. Refactor `TranscriptWatcher.watchFile` to read file appends using bounded chunk streaming (64KB chunks) and index-based streaming line iteration (`indexOf('\n')`) instead of allocating massive memory buffers and large line arrays with `split('\n')`. Implement comprehensive `EventEmitter` listener cleanup and lifecycle management across `TranscriptWatcher`, `Orchestrator`, and `extension.ts`.

## Requirements
### Functional
- [x] **Bounded Chunked Transcript Streaming**:
  - Replace `Buffer.alloc(bytesToRead)` with a fixed maximum chunk size (e.g., `MAX_CHUNK_SIZE = 64 * 1024` / 64KB).
  - Read large file deltas in incremental chunks via a reusable buffer pool or bounded allocations.
- [x] **Zero-Array Index-Based Line Parsing**:
  - Eliminate `.split('\n')` on multi-megabyte string buffers.
  - Stream lines sequentially using index scanning (`indexOf('\n')`), extracting and parsing individual JSON lines on the fly without retaining intermediate line arrays in memory.
  - Preserve incomplete trailing lines in `this.lineBuffer` for subsequent chunks.
- [x] **EventEmitter Listener Protection**:
  - Configure `this.setMaxListeners(50)` in constructors of `TranscriptWatcher` and `Orchestrator`.
  - Provide explicit helper methods to detach transient execution listeners (e.g. `clearRunListeners()`).
- [x] **Thorough Disposal & Teardown**:
  - Ensure `TranscriptWatcher.dispose()` and `Orchestrator.dispose()` completely remove all event listeners (`removeAllListeners()`), terminate all active timers (`settleTimer`, `pollInterval`, `activeTimer`, `delayTimer`), and close file system watchers without leaving dangling references.
  - Register all singleton disposables into VS Code `context.subscriptions` in `extension.ts`.

### Non-Functional
- [x] **Memory Safety**: Zero V8 Garbage Collection spikes or memory bloat when processing transcript files > 20MB.
- [x] **Leak-Free Runtime**: Eliminate all `MaxListenersExceededWarning` alerts during repeated or long-running multi-phase runs.

## Files to Create/Modify
- `src/transcriptWatcher.ts` - Implement chunked stream reading, index-based line parsing, `setMaxListeners`, and thorough cleanup.
- `src/orchestrator.ts` - Implement listener cleanup, `setMaxListeners`, and disposable management.
- `src/test/phase03_memory_stream_cleanup.test.ts` - Comprehensive single test file for Phase 03.

## Test Criteria
- [x] Exactly one file-based test: `src/test/phase03_memory_stream_cleanup.test.ts`.
- [x] Verifies stream chunking: streams a large mock transcript file (10MB+) containing hundreds of steps, verifying accurate completion keyword detection without high memory allocation.
- [x] Verifies partial line boundary handling: splits JSON objects across 64KB chunk boundaries and asserts seamless reconstruction.
- [x] Verifies listener leak prevention: registers and unregisters listeners across 100+ simulated phase iterations, confirming zero `MaxListenersExceededWarning` emissions.
- [x] Verifies `dispose()` contract: confirms that calling `dispose()` cleans up all active timers, watchers, and listeners.

---
Next Phase: [phase-04-orchestrator-integration-e2e-verification.md](file:///D:/skul9x/Auto-Plan_Extension/plans/260828-0045-audit-performance-fixes/phase-04-orchestrator-integration-e2e-verification.md)
