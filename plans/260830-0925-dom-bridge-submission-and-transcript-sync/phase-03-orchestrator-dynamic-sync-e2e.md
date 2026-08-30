# Phase 03: Orchestrator Dynamic Sync & End-to-End Phase Progression (`src/orchestrator.ts`)

Status: ✅ Completed  
Dependencies: `phase-02-transcript-multi-conversation-sync.md`  
Target Files:
- `src/orchestrator.ts`
- `src/test/phase03_orchestrator_dynamic_sync_e2e.test.ts`

---

## 1. Objective

Update `Orchestrator` in `src/orchestrator.ts` to integrate seamlessly with the dynamic conversation re-binding events from `TranscriptWatcher`, ensure phase tracking metadata and `lastConversationId` are updated accurately, and guarantee immediate, zero-lag phase progression (Phase 01 ➔ Phase 02) upon completion keyword detection. Implement a single automated test in `src/test/phase03_orchestrator_dynamic_sync_e2e.test.ts`.

---

## 2. Detailed Technical Requirements

### 2.1. Orchestrator Dynamic Re-binding & Phase Transition Pipeline (`src/orchestrator.ts`)
- **Listen for `conversationRebound`**:
  - Attach a dynamic event listener to `this.transcriptWatcher` during the phase execution loop.
  - When `conversationRebound` fires:
    - Update `phase.conversationId` and `this.lastConversationId` to the newly active conversation.
    - Log an informational diagnostic event via `debugLogger.info('ORCHESTRATOR', ...)`.
    - Update sidebar / webview state if active.
- **Immediate Inter-Phase Transition**:
  - Verify that upon `completionResult.success === true`:
    - Phase status is set to `'Completed'`.
    - `phase.endTime` is recorded.
    - `emit('phaseComplete', ...)` and `emit('iterationComplete', ...)` are dispatched immediately.
    - Inter-phase delay (`config.delayBetweenLoopsSeconds`) begins without any unhandled blocking or stall watchdog timeouts.
    - Loop advances seamlessly to Phase 02 (`phaseIndex = 1`).
- **Clean Listener Cleanup**:
  - Ensure all temporary watcher event listeners are detached in `finally` / teardown to prevent listener leaks across multi-phase loops.

### 2.2. Automated File-Based Test (`src/test/phase03_orchestrator_dynamic_sync_e2e.test.ts`)
- **Single Test Suite Requirements**: Exactly one comprehensive file-based test suite verifying:
  1. Multi-phase plan execution with simulated 2-phase sequence (`phase-01.md` and `phase-02.md`).
  2. In Phase 1, dispatch triggers a prompt and simulates a conversation rebound from a ghost conversation to an active conversation emitting `"Done skul9x."`.
  3. Orchestrator accurately catches completion, marks Phase 1 completed, updates `lastConversationId`, and automatically initiates Phase 2.
  4. Phase 2 completes successfully with its own completion keyword, finishing the entire loop with status `'Completed'`.
  5. Executed via Node.js test runner:
     ```bash
     npx tsc; node out/test/phase03_orchestrator_dynamic_sync_e2e.test.js
     ```

---

## 3. Implementation Steps

1. Modify `src/orchestrator.ts` to handle dynamic transcript re-binding and ensure fast phase transitions.
2. Create `src/test/phase03_orchestrator_dynamic_sync_e2e.test.ts`.
3. Compile TypeScript and execute the single verification test:
   ```bash
   npx tsc; node out/test/phase03_orchestrator_dynamic_sync_e2e.test.js
   ```
4. Verify 100% test pass rate.

---

## 4. Verification Plan

### Automated Test
```bash
npx tsc; node out/test/phase03_orchestrator_dynamic_sync_e2e.test.js
```

### Manual Verification
- Verify orchestrator logs display clean phase transition messages without timeout warnings.

---
Next Phase: [phase-04-workbench-injector-cache-invalidation.md](./phase-04-workbench-injector-cache-invalidation.md)
