# Plan: Audit Performance & Reliability Remediation
Created: 2026-08-28 00:45
Last Updated: 2026-08-28 00:45
Status: 🟡 In Progress

## Overview
Remediate all Critical Issues, Warnings, and Performance Bottlenecks identified in the Audit Report (`docs/reports/audit_2026-08-28.md`). This includes eliminating synchronous I/O polling in `transcriptWatcher.ts`, reducing PowerShell process spawns from 4+ processes to a single batch execution in `keyboardManager.ts`, resolving concurrency race conditions between `fs.watch` and polling, preventing `EventEmitter` listener leaks, and introducing chunked stream processing for large transcripts.

## Objectives & Remediation Targets
1. **Critical 1 (Sync I/O Throttling)**: Replace 100ms synchronous directory polling with root `mtime` change detection, in-memory directory caching, `fs.watch` triggers, and asynchronous I/O (`fs.promises`). Reduces disk stat operations by ~99.9%.
2. **Critical 2 (Process Explosion)**: Replace 4 sequential PowerShell invocations with a unified single-batch execution (`executeBatchPromptFlow`) using WScript/PowerShell command chaining with integrated delays. Reduces process spawn overhead by ~75%.
3. **Warning 3 (Race Condition / Redundancy)**: Add an atomic `isChecking` / `isProcessing` concurrency flag in `TranscriptWatcher.watchFile` and tune the fallback polling interval to 300–500ms.
4. **Warning 4 (EventEmitter Memory Leak)**: Raise listener thresholds with `setMaxListeners(50+)`, ensure rigorous listener cleanup during phase completion and `dispose()`, and integrate proper VS Code `Disposable` lifecycle hooks.
5. **Warning 5 (GC Pressure on Large Transcripts)**: Replace full-buffer reading (`Buffer.alloc(size)` + `split('\n')`) with bounded chunked streaming (64KB chunks) and index-based streaming line iteration (`indexOf('\n')`).
6. **Suggestions 6 & 7 (Tooltip & Discovery Caching)**: Optimize status bar tooltip updates (re-render only on second/state changes) and implement short-term caching for plan folder discovery.

## Phases

| Phase | Name | Status | Test File |
|-------|------|--------|-----------|
| 01 | Asynchronous Watcher & Non-Blocking I/O Optimization | ⬜ Pending | `src/test/phase01_async_watcher_io.test.ts` |
| 02 | Single-Batch PowerShell Keystroke Automation | ⬜ Pending | `src/test/phase02_batch_keyboard.test.ts` |
| 03 | Chunked Stream Processing & Listener Leak Elimination | ⬜ Pending | `src/test/phase03_memory_stream_cleanup.test.ts` |
| 04 | Orchestrator Integration, UX Caching & E2E Verification | ⬜ Pending | `src/test/phase04_audit_e2e_verification.test.ts` |

## Quick Commands
- Run Phase 01 Test: `npx ts-node src/test/phase01_async_watcher_io.test.ts` (or `node out/test/phase01_async_watcher_io.test.js`)
- Run Phase 02 Test: `npx ts-node src/test/phase02_batch_keyboard.test.ts` (or `node out/test/phase02_batch_keyboard.test.js`)
- Run Phase 03 Test: `npx ts-node src/test/phase03_memory_stream_cleanup.test.ts` (or `node out/test/phase03_memory_stream_cleanup.test.js`)
- Run Phase 04 Test: `npx ts-node src/test/phase04_audit_e2e_verification.test.ts` (or `node out/test/phase04_audit_e2e_verification.test.js`)
