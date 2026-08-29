# Plan: Background Focus-Free Automation Runner

**Created**: 2026-08-29 20:16  
**Status**: 🟡 In Progress  
**Objective**: Fix and enhance the extension so users can freely open Google Chrome, browse the web, or use other applications while Antigravity Auto-Plan runs completely focus-free in the background without stealing keyboard/mouse focus or dropping DOM Bridge connections.

---

## Technical Architecture & Core Problem Analysis

### Identified Root Causes
1. **Renderer Timer Throttling & Inactivity Eviction**: When Antigravity IDE is minimized, occluded, or in the background while the user browses Chrome, Chromium throttles renderer timers (`setInterval`), leading to delayed polling. The server's 30s timeout (`DEFAULT_STALE_CLIENT_MS = 30000`) prematurely evicts the client (`connectedClientsCount: 0`).
2. **Lack of Dedicated Background Worker Keep-Alive**: The DOM bridge script relied on standard `setInterval`, which gets throttled when the window loses focus.
3. **Singleton Disconnect in Dispatcher**: `PromptDispatcher` constructor defaulted to `new BridgeServer()` instead of using the shared singleton `bridgeServer`, causing state discrepancies during readiness validation.
4. **Instant Failure without Fast Wakeup Probe**: Strict Tier 1 evaluation instantly fails upon seeing 0 clients without performing an immediate 200ms discovery/wakeup probe.

---

## Phases Overview

| Phase | Name | Description | Verification Test | Status |
| :--- | :--- | :--- | :--- | :---: |
| **01** | Background Worker Keep-Alive & Adaptive Stale Threshold | Add unthrottled Web Worker keep-alive heartbeat loop and increase stale threshold to 120s | `src/test/phase01_background_keepalive_engine.test.ts` | ⬜ Pending |
| **02** | Shared Server Singleton & Fast Auto-Wakeup Dispatcher | Connect shared BridgeServer singleton and implement 200ms fast reconnect probe | `src/test/phase02_fast_reconnect_dispatcher.test.ts` | ✅ Completed |
| **03** | True Focus-Free DOM Injection & Background Submission | Ensure prompt injection and Enter/Submit triggers operate 100% focus-free | `src/test/phase03_focus_free_dom_injection.test.ts` | ✅ Completed |
| **04** | End-to-End Background Multi-Phase Automation Verification | Validate seamless multi-phase plan execution while IDE window is in background | `src/test/phase04_background_automation_e2e.test.ts` | ⬜ Pending |

---

## Verification & Execution Guidelines
- Exactly **one comprehensive file-based test** per phase.
- Only run that single test after completing the corresponding phase.
- Stop and wait for user review after each phase execution.
