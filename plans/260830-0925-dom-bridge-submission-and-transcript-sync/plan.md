# DOM Bridge Single-Submit Isolation & Transcript Watcher Synchronization Plan

This engineering plan details the architecture, implementation steps, and automated verification tests to eliminate double-trigger prompt submission in the DOM Bridge client (`media/autoplan-dom-bridge.js`) and prevent conversation tracking desynchronization in `src/transcriptWatcher.ts` and `src/orchestrator.ts`.

---

## 1. Overview & Problem Definition

### 1.1. Root Causes
1. **DOM Bridge Double-Trigger Race Condition (`media/autoplan-dom-bridge.js`)**:
   - In `media/autoplan-dom-bridge.js`, prompt dispatching currently fires both synthetic `KeyboardEvent('Enter')` events (`keydown`, `keypress`, `keyup`) on the input element AND triggers `dispatchButtonClickCascade(sendBtn)`.
   - In Electron / VS Code webview environments, this triggers multiple concurrent message submissions in the same millisecond, spawning 2–3 simultaneous conversation directories in `.brain/` (e.g., duplicate ghost sessions).

2. **Transcript Watcher Ghost Session Lock (`src/transcriptWatcher.ts` & `src/orchestrator.ts`)**:
   - When multiple conversation directories are created with identical or near-identical timestamps, `waitForNewConversation()` may pick a ghost/aborted conversation directory.
   - The orchestrator binds `watchFile` to the aborted conversation transcript, which stops appending steps before emitting the completion keyword (`"Done skul9x."`).
   - The actual response containing `"Done skul9x."` completes in a sibling conversation, leaving the Orchestrator stuck indefinitely on the stalled phase without advancing to subsequent phases.

### 1.2. Core Objectives
1. **Mutually Exclusive Single-Submit Strategy**: Ensure DOM Bridge dispatches prompt via exactly ONE mechanism (Send Button click IF available; otherwise fallback to synthetic Enter key; otherwise form submit), completely eliminating duplicate conversation triggers.
2. **Multi-Conversation Active Arbitration & Re-binding**: Enhance `TranscriptWatcher` to detect active transcript activity across candidate conversation directories created >= `sinceTimestamp`, preventing the watcher from locking onto aborted ghost sessions.
3. **Orchestrator Seamless Transition & Telemetry**: Ensure `Orchestrator` receives dynamic conversation re-bind events and transitions immediately to subsequent phases upon completion keyword detection.
4. **Injector Cache-Busting & Full Regression**: Bump bridge version query parameters to force renderer reload, ensuring clean DOM bridge injection in the live IDE environment.

---

## 2. Phase Breakdown

| Phase | Title | Target Files | Single Verification Test | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 01** | DOM Bridge Mutually Exclusive Single-Submit Engine | `media/autoplan-dom-bridge.js` | `src/test/phase01_dom_bridge_single_submit.test.ts` | ⬜ Pending |
| **Phase 02** | Transcript Watcher Multi-Conversation Activity Arbitration | `src/transcriptWatcher.ts` | `src/test/phase02_transcript_multi_conversation_sync.test.ts` | ⬜ Pending |
| **Phase 03** | Orchestrator Dynamic Sync & End-to-End Phase Progression | `src/orchestrator.ts` | `src/test/phase03_orchestrator_dynamic_sync_e2e.test.ts` | ⬜ Pending |
| **Phase 04** | Workbench Injector Cache Invalidation & Full Regression | `src/workbenchInjector.ts`, `media/autoplan-dom-bridge.js` | `src/test/phase04_dom_bridge_full_regression.test.ts` | ✅ Completed |

---

## 3. Execution Rules
- All phase plan files are stored in `.md` format in `plans/260830-0925-dom-bridge-submission-and-transcript-sync/`.
- All phase contents and documentation are written in English.
- Each phase is verified by **exactly one comprehensive file-based test**.
- No additional tests or test files shall be created or executed.
- After completing each phase, only that single test will be run for verification.
- Once finished, the assistant will stop and say `"done."`.
