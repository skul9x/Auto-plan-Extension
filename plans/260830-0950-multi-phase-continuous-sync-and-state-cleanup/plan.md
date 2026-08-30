# Multi-Phase Continuous Transcript Sync & Execution State Cleanup Plan

**Created:** 2026-08-30T09:50:00+07:00  
**Status:** ✅ Completed  
**Objective:** Fix multi-phase sequential execution stalling in the same conversation session and ensure complete UI/State cleanup (Status Bar, Sidebar, Phase items) when stopped or completed.

---

## 1. Executive Problem Summary

1. **Multi-Phase Stalling in Same Conversation:**
   - In `src/orchestrator.ts` (`runPhaseSequence`), `waitForNewConversation` was called with `excludeConvId = this.lastConversationId` and a timeout of `config.timeoutPerLoopMinutes * 60 * 1000` (15 minutes).
   - When subsequent phases (e.g. Phase 2) execute in the **same continuous conversation session**, `waitForNewConversation` blocked the orchestrator for 15 minutes looking for a new directory that was never created, never calling `watchFile`/`watchLatest`.
2. **Persistent Spinning UI on Stop / Phase Incompletion:**
   - When stopped manually or on stall, `phase.status` remained `'Running'` in `this.phases`.
   - In `media/sidebar/sidebar.js`, `const isCurrent = ... || phase.status === 'Running'` caused stopped phases to continue rendering with the `🔄 Running` spinner.
   - Status Bar item retained `$(sync~spin)` instead of cleanly resetting to `$(rocket) Auto-Plan`.

---

## 2. Architecture & Implementation Phases

| Phase | Description | Status | Target Files |
| :--- | :--- | :---: | :--- |
| **01** | Multi-Phase Continuous Transcript Synchronization in Orchestrator & Watcher | ✅ Completed | `src/orchestrator.ts`, `src/transcriptWatcher.ts`, `src/test/phase01_multi_phase_continuous_sync.test.ts` |
| **02** | Execution State Cleanup & Sidebar/StatusBar UI Synchronization | ✅ Completed | `src/orchestrator.ts`, `src/extension.ts`, `media/sidebar/sidebar.js`, `media/sidebar/sidebar.css`, `src/sidebarProvider.ts`, `src/test/phase02_state_cleanup_and_ui_sync.test.ts` |
| **03** | End-to-End Multi-Phase Continuous Execution & Full Regression Verification | ✅ Completed | `src/test/phase03_continuous_execution_regression.test.ts` |

---

## 3. Verification & Testing Strategy
- Each phase is verified by exactly one comprehensive file-based automated test.
- Verified via `npx tsc && node out/test/<test-file>.js`.
