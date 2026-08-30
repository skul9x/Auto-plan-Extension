# Phase 01: Multi-Phase Continuous Transcript Synchronization in Orchestrator & Watcher

Status: ✅ Completed  
Dependencies: None  
Target Files:
- `src/orchestrator.ts`
- `src/transcriptWatcher.ts`
- `src/test/phase01_multi_phase_continuous_sync.test.ts`

---

## 1. Objective

Eliminate the 15-minute blocking delay during multi-phase execution by optimizing `waitForNewConversation` discovery timeout to 3000ms, pre-calculating byte offsets (`initialOffset` via `statSync`) before prompt dispatch to prevent re-matching previous phases' keywords, and enabling seamless non-blocking delta parsing within the existing conversation transcript file. Provide a comprehensive file-based verification test suite in `src/test/phase01_multi_phase_continuous_sync.test.ts`.

---

## 2. Technical Requirements

1. **Pre-Dispatch Offset Measurement (`src/orchestrator.ts`):**
   - Before prompt dispatch for each phase in `runPhaseSequence` (and each iteration in `start()`), inspect the active transcript file if `this.lastConversationId` is known.
   - Record `phase.startOffset = fs.statSync(transcriptPath).size` (or `0` if new file).
   - This ensures that when watching the same file for subsequent phases, `watchFile` strictly starts scanning bytes after `phase.startOffset`, preventing false-positive completions from keywords generated in earlier phases.
2. **Fast Discovery Timeout in `runPhaseSequence` (`src/orchestrator.ts`):**
   - Replace the `config.timeoutPerLoopMinutes * 60 * 1000` (15-minute) timeout in `waitForNewConversation` with a fast discovery window of `3000ms`.
   - If a new conversation folder appears within 3000ms (e.g. user clicked new chat or DOM bridge reset), bind to the new conversation (`initialOffset = 0`).
   - If no new conversation folder is detected within 3000ms, immediately fall back to `this.lastConversationId` or `'current_conversation'` and begin watching the active file from `phase.startOffset`.
3. **Seamless Multi-Phase Continuation:**
   - Verify that `watchFile` and `watchLatest` smoothly process incremental chunk additions in the active transcript without stalling.
4. **Dynamic Conversation Rebinding Resilience:**
   - Preserve dynamic arbitration checks (`performArbitrationCheck`) in `TranscriptWatcher` so if Antigravity spawns a new conversation mid-phase, the watcher automatically rebounds.

---

## 3. Automated File-Based Test (`src/test/phase01_multi_phase_continuous_sync.test.ts`)

Create exactly one comprehensive test verifying:
1. Multi-phase sequence simulation (Phase 1 followed by Phase 2) running in the **same conversation transcript file**.
2. Phase 1 dispatches and completes when `"Done skul9x."` is appended.
3. Phase 2 captures `phase.startOffset`, starts immediately without blocking in `waitForNewConversation`, correctly ignores Phase 1's existing keyword, and completes when Phase 2's `"Done skul9x."` is appended.
4. Total execution time across both phases is fast and within expected bounds (< 10 seconds total simulation time).

---

## 4. Verification Plan

```bash
npx tsc && node out/test/phase01_multi_phase_continuous_sync.test.js
```

---
Next Phase: [phase-02-state-cleanup-and-ui-sync.md](./phase-02-state-cleanup-and-ui-sync.md)
