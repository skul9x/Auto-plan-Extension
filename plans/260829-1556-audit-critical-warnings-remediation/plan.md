# Plan: Audit Critical & Warnings Performance Remediation
Created: 2026-08-29 15:56
Last Updated: 2026-08-29 16:00
Status: 🟡 In Progress

## Overview
Remediate all 4 Critical Issues and 3 Warnings identified in the Performance & Resource Audit Report (`docs/reports/audit_20260829.md`). This includes eliminating unrestricted `querySelectorAll('*')` DOM scans and unthrottled MutationObserver callbacks in `media/autoplan-dom-bridge.js`, preventing Webview IPC message floods with batched throttling in `src/sidebarProvider.ts`, replacing synchronous I/O file scanning with asynchronous non-blocking stream/bounded reads in `src/planScanner.ts` and `src/extension.ts`, relaxing dual polling intervals in `src/transcriptWatcher.ts`, pruning DOM logs in `media/sidebar/sidebar.js`, and replacing unconditional 1-second tooltip timers with event-driven updates.

## Remediation Scope & Audit Mapping

| Audit Item | Severity | Target Component | Remediation Strategy | Phase |
|---|---|---|---|---|
| **Critical 1** (Unrestricted `querySelectorAll('*')` in DOM Bridge) | 🔴 Critical | `media/autoplan-dom-bridge.js` | Scope search to target containers (`.interactive-session`, `div.chat-input`, modal dialogs) & debounce MutationObserver callback (300ms–500ms). | **Phase 01** |
| **Critical 2** (Webview IPC Message Storm on `logUpdate`) | 🔴 Critical | `src/sidebarProvider.ts`, `src/extension.ts` | Implement queue buffering & 100ms–200ms batch throttling for `postMessage` updates. | **Phase 02** |
| **Warning 1** (Unbounded DOM Growth in Sidebar Transcript) | 🟡 Warning | `media/sidebar/sidebar.js` | Implement sliding window DOM line-capping (max 200 lines) with automatic oldest-line pruning. | **Phase 02** |
| **Critical 3** (Main Thread Event Loop Sync I/O) | 🔴 Critical | `src/planScanner.ts`, `src/extension.ts`, `src/sidebarProvider.ts` | Migrate to async `fs.promises` operations with in-memory caching and non-blocking discovery. | **Phase 03** |
| **Warning 2** (Full-File Read for Header Status Detection) | 🟡 Warning | `src/planScanner.ts` | Bounded file reading: slice initial 2KB–4KB header chunk rather than loading entire multi-MB files. | **Phase 03** |
| **Critical 4** (Dual Polling vs `fs.watch` Redundancy) | 🔴 Critical | `src/transcriptWatcher.ts` | Prioritize `fs.watch`, relax fallback polling interval to 1000ms–1500ms with adaptive backoff. | **Phase 04** |
| **Warning 3** (Unconditional 1s Status Bar Tooltip Timer) | 🟡 Warning | `src/extension.ts` | Replace 1000ms continuous timer with event-driven tooltip generation on state / phase change. | **Phase 04** |

## Phases

| Phase | Name | File | Status | Test File |
|---|---|---|---|---|
| 01 | Scoped DOM Traversal & Debounced MutationObserver | [`phase-01-dom-bridge-scoping-throttle.md`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/plans/260829-1556-audit-critical-warnings-remediation/phase-01-dom-bridge-scoping-throttle.md) | ⬜ Pending | [`src/test/phase01_dom_bridge_scoped_throttle.test.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/test/phase01_dom_bridge_scoped_throttle.test.ts) |
| 02 | Webview IPC Log Batching & DOM Pruning | [`phase-02-webview-ipc-batching-dom-pruning.md`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/plans/260829-1556-audit-critical-warnings-remediation/phase-02-webview-ipc-batching-dom-pruning.md) | ⬜ Pending | [`src/test/phase02_webview_ipc_batching_dom_pruning.test.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/test/phase02_webview_ipc_batching_dom_pruning.test.ts) |
| 03 | Asynchronous Plan Scanner & Bounded Header Reading | [`phase-03-async-plan-scanner-bounded-io.md`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/plans/260829-1556-audit-critical-warnings-remediation/phase-03-async-plan-scanner-bounded-io.md) | ⬜ Pending | [`src/test/phase03_async_plan_scanner_bounded_io.test.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/test/phase03_async_plan_scanner_bounded_io.test.ts) |
| 04 | Watcher Polling Backoff & Event-Driven Status Bar Tooltip | [`phase-04-watcher-backoff-event-tooltip.md`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/plans/260829-1556-audit-critical-warnings-remediation/phase-04-watcher-backoff-event-tooltip.md) | ⬜ Pending | [`src/test/phase04_watcher_backoff_event_tooltip.test.ts`](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/src/test/phase04_watcher_backoff_event_tooltip.test.ts) |

## Quick Commands
- Run Phase 01 Test: `npx ts-node src/test/phase01_dom_bridge_scoped_throttle.test.ts`
- Run Phase 02 Test: `npx ts-node src/test/phase02_webview_ipc_batching_dom_pruning.test.ts`
- Run Phase 03 Test: `npx ts-node src/test/phase03_async_plan_scanner_bounded_io.test.ts`
- Run Phase 04 Test: `npx ts-node src/test/phase04_watcher_backoff_event_tooltip.test.ts`
- Compile Codebase: `npm run compile`
- Full Regression Test Suite: `npm test`
