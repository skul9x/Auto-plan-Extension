# Plan: DOM Bridge Lifecycle Reliability & Orchestration Remediation

Created: 2026-09-03 19:38:00 UTC+7  
Status: 🟢 Completed  
Target Scope: DOM Bridge Handshake, Send Button Readiness, Submission Verification Rigor, and Orchestrator Conversation Isolation

---

## 1. Overview

Diagnostic log analysis and empirical DOM comparisons across `body.txt`, `body1.txt`, `body2.txt`, `body3.txt`, and `body4.txt` exposed a cascading failure chain:
1. `promptDispatcher.ts` dispatches `openNewConversation` and blindly sleeps 100ms without validating whether the new conversation DOM has mounted.
2. `injectPromptAndSubmit` in `autoplan-dom-bridge.js` polls for send button enablement for only 250ms. React takes ~300-500ms to update state after pasting text.
3. When the send button remains disabled at 250ms, the script falls back to dispatching synthetic `KeyboardEvent('Enter')`. In Antigravity's Lexical editor, synthetic Enter events are ignored when the input is not ready/disabled, leaving the prompt stranded unsubmitted.
4. `verifyInputSubmission` suffers from false-positive verification: a loose `MutationObserver` on `doc.body` triggers `containerMutated = true` from unrelated DOM churn (tooltips, clock changes, status icons), falsely reporting successful submission.
5. `orchestrator.ts` times out waiting for a new conversation ID, catches the timeout, and silently falls back to `this.lastConversationId` from the previous phase. It then encounters the previous phase's completion keyword (`"Done skul9x."`) and falsely reports the new phase as completed.

This plan resolves these flaws across 4 targeted phases.

---

## 2. Phase Breakdown

| Phase | Title | Target Scope | Primary Test File |
|---|---|---|---|
| **01** | [New Conversation Transition & DOM Handshake](./phase-01-new-conversation-handshake.md) | `autoplan-dom-bridge.js`, `src/promptDispatcher.ts` | `src/test/phase01_new_conversation_handshake.test.ts` |
| **02** | [Send Button Readiness Polling & Enter-Fallback Disabling](./phase-02-send-button-readiness.md) | `autoplan-dom-bridge.js` | `src/test/phase02_send_button_readiness.test.ts` |
| **03** | [Rigid Input Submission Verification & False-Positive Elimination](./phase-03-submission-verification-rigor.md) | `autoplan-dom-bridge.js` | `src/test/phase03_submission_verification_rigor.test.ts` |
| **04** | [Orchestrator Conversation Isolation & Keyword Timestamp Guard](./phase-04-orchestrator-conversation-isolation.md) | `src/orchestrator.ts` | `src/test/phase04_orchestrator_conversation_isolation.test.ts` |

---

## 3. Strict Execution Protocol

Per user requirements:
- All phase files are written in English.
- Exactly one comprehensive file-based test per phase verifies core functionality after implementation.
- No more than one test file created or executed per phase.
- After completing each phase, execute only that single test for verification, then stop for user review.
- Final output upon full completion: `done.`.
