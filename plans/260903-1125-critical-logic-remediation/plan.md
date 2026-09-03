# Plan: Critical Logic Remediation (LOGIC-001, LOGIC-002, LOGIC-003)

Created: 2026-09-03 11:25:00 UTC+7  
Status: 🟡 In Progress  
Target Scope: 3 Critical Architectural Logic Flaws in Auto-Plan Automation Engine

---

## 1. Overview

This plan comprehensively remediates the **3 CRITICAL** logic bugs identified during the architecture audit in `phantich.md`:

1. **LOGIC-001: Duplicate Action via Uncoordinated Fallback**  
   When Tier 1 (DOM Bridge) dispatch times out after 5s, `BridgeServer` rejects the pending Promise, triggering `PromptDispatcher` to execute Tier 2 / Tier 3. However, `BridgeServer` emits no abort signal to `DomBridgeClient`, which continues DOM typing/submission and eventually fires a second duplicate prompt into the chat agent.

2. **LOGIC-002: Multi-Window Port Collision & Window Identity Hijacking**  
   `DomBridgeClient.discoverPort()` scans sequentially starting from port `48860`. When multiple VS Code windows are running concurrently, subsequent windows probe port `48860`, connect to Window 1's server, and fail with `windowMismatch`, while Window 2's own server (e.g. `48861`) is completely starved of client connections.

3. **LOGIC-003: Stale Conversation False Completion in TranscriptWatcher**  
   When the AI agent takes longer than 3 seconds (`arbitrationTimeoutMs = 3000`) to generate its first stream chunk, `performArbitrationCheck` selects historical conversation folders because `c.transcriptSize > 0` is satisfied by any past session. Watcher resets `readOffset = 0` and re-reads the historical completion phrase (`Done skul9x.`), causing Orchestrator to falsely mark the phase as completed before any code is generated.

---

## 2. Phase Breakdown

| Phase | Title | Target Issue | Status | Primary Test File |
|---|---|---|---|---|
| **01** | [Fallback Abort Coordination](./phase-01-fallback-abort-coordination.md) | LOGIC-001 | ✅ Completed | `src/test/phase01_uncoordinated_fallback_abort.test.ts` |
| **02** | [Multi-Window Port Isolation](./phase-02-multi-window-port-isolation.md) | LOGIC-002 | ✅ Completed | `src/test/phase02_multi_window_port_isolation.test.ts` |
| **03** | [Transcript Arbitration Guard](./phase-03-transcript-arbitration-guard.md) | LOGIC-003 | ⬜ Pending | `src/test/phase03_transcript_arbitration_guard.test.ts` |

---

## 3. Strict Execution Protocol

Per user requirements:
- All phase files are written in English.
- Each phase contains **exactly one** comprehensive file-based test.
- No more than one test shall be created or run per phase.
- After completing each phase, run only that single test for verification.
- Stop immediately after running the test so the user can review.
- Once finished, output `done.`.
