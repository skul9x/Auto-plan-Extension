# Plan: High and Medium Performance & Reliability Audit Remediation
Created: 2026-11-05T23:20:00+07:00  
Status: ✅ Completed  
Target Version: v1.7.4  

---

## Overview
This implementation plan addresses all 10 High and Medium severity performance defects, architectural bottlenecks, and test regressions documented in `audit.5.11.2026.md`. The remediation eliminates event-loop blocking disk/subprocess I/O, resolves IPC queue congestion and DOM memory leaks in the webview, reduces background CPU and GC churn across RPC polling and transcript tailing, and restores clean test execution across the entire test suite.

---

## Remediation Scope Matrix

| Bug ID | Severity | Focus Area | Phase |
|---|:---:|---|:---:|
| **TEST-011** | Medium | Hardcoded version assertion failure in Phase 04 regression test | Phase 01 |
| **TEST-012** | Medium | Outdated transport assumption in Phase 05 cross-platform test | Phase 01 |
| **PERF-001** | High | Synchronous multi-window registry disk I/O on main event loop | Phase 02 |
| **PERF-004** | Medium | Synchronous file I/O during active plan folder scanning | Phase 02 |
| **PERF-007** | High | Synchronous subprocess execution & Roslyn C# compilation | Phase 02 |
| **PERF-002** | High | Unbatched Webview postMessage IPC & synchronous reflow thrashing | Phase 03 |
| **PERF-005** | Medium | Unbounded DOM node accumulation in Settings console | Phase 03 |
| **PERF-003** | Medium | Continuous 1-second RPC polling with deep key sorting & SHA-256 | Phase 04 |
| **PERF-008** | Medium | Redundant stream & readline re-allocation on token append | Phase 04 |
| **PERF-009** | Medium | 15ms deep DOM traversal polling in DOM bridge clearance | Phase 04 |

---

## Phases

| Phase | Name | Description | Status | Verification Test |
|---|---|---|:---:|---|
| **01** | Test Suite Baseline Stabilization | Fix outdated test assertions for v1.7.4 and native chat API dispatch capability | ✅ Completed | `src/test/phase01_test_suite_baseline_verification.test.ts` |
| **02** | Event Loop Unblocking & Non-Blocking I/O | Migrate registry I/O, plan scanning, and subprocess handling to asynchronous operations | ✅ Completed | `src/test/phase02_event_loop_and_async_io_verification.test.ts` |
| **03** | Settings Webview IPC Batching & DOM Pruning | Batch extension-to-webview IPC messages and prune obsolete console DOM nodes | ✅ Completed | `src/test/phase03_settings_webview_batching_and_memory_verification.test.ts` |
| **04** | Background Engine Polling & Stream Optimization | Implement adaptive RPC backoff, reusable buffer tailing, and relaxed DOM verification | ✅ Completed | `src/test/phase04_rpc_engine_and_dom_performance_verification.test.ts` |

---

## Execution Guidelines
1. Execute phases sequentially from Phase 01 to Phase 04.
2. For each phase, run exactly one comprehensive verification test to validate functionality.
3. Stop after each phase verification for user review before proceeding.

