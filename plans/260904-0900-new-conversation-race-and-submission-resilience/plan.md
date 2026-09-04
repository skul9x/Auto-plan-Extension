# Plan: New Conversation Transition Race & Submission Resilience

Created: 2026-09-04 09:00:00 UTC+7  
Status: 🟡 In Progress  
Target Scope: DOM Bridge Button Readiness Polling, Strict Submission Rejection, Dispatcher Stabilization Handshake, and Orchestrator Adaptive Discovery Timeout

---

## 1. Overview & Problem Analysis

Diagnostic analysis of recent execution logs revealed a cascading race condition during multi-phase transitions (specifically Phase 2 -> Phase 3):

1. **Premature Prompt Injection**: Immediately upon receiving the `openNewConversation` ACK, `PromptDispatcher` dispatched `sendPrompt` without a stabilization pause. The newly rendered conversation view in Antigravity IDE had not finished hydrating, leaving the send button in a disabled state (`cursor-not-allowed`, `text-muted-foreground bg-secondary`).
2. **Premature Polling Abort & False-Positive Synthetic Enter**: In `media/autoplan-dom-bridge.js`, button polling lasted only ~268ms before giving up. It then fell back to dispatching a synthetic `KeyboardEvent('Enter')`. Because the input container was disabled/not ready, the synthetic Enter was rejected by the IDE's Lexical editor, leaving the prompt stranded and unsubmitted. Despite this, the DOM bridge returned `status: submitClicked`, misleading the extension host into believing submission succeeded.
3. **Aggressive Conversation Discovery Timeout**: In `src/orchestrator.ts`, `waitForNewConversation` was called with a hardcoded `3000ms` timeout. Because the prompt was never actually submitted, no new conversation directory was generated in `~/.gemini/antigravity-ide/brain/`. After 3000ms, `waitForNewConversation` threw `NewConversationTimeoutError`, terminating the phase sequence and stalling all downstream phases.

This plan addresses all three bottlenecks across 3 structured phases.

---

## 2. Phase Breakdown

| Phase | Title | Target Scope | Primary Test File |
|---|---|---|---|
| **01** | [DOM Bridge Button Readiness Polling & Strict Rejection](./phase-01-dom-bridge-button-readiness-and-strict-rejection.md) | `media/autoplan-dom-bridge.js` | `src/test/phase01_dom_bridge_readiness_and_strict_rejection.test.ts` |
| **02** | [Dispatcher Stabilization Handshake & Prompt Submission Retry](./phase-02-dispatcher-handshake-stabilization-and-retry.md) | `src/promptDispatcher.ts`, `src/bridgeServer.ts` | `src/test/phase02_dispatcher_handshake_and_retry.test.ts` |
| **03** | [Orchestrator Resilient Discovery & Adaptive Timeout](./phase-03-orchestrator-discovery-resilience-and-adaptive-timeout.md) | `src/orchestrator.ts`, `src/config.ts` | `src/test/phase03_orchestrator_discovery_resilience.test.ts` |

---

## 3. Strict Execution Protocol

Per user requirements:
- All phase files are written in English.
- For each phase, add exactly one comprehensive file-based test to verify the core functionality of that phase after implementation.
- Do not create or run more than one test per phase.
- After completing each phase, run only that single test for verification.
- Then stop so the user can review.
- Final completion output: `done.`.
