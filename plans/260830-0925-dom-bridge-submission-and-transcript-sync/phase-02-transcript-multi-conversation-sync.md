# Phase 02: Transcript Watcher Multi-Conversation Activity Arbitration (`src/transcriptWatcher.ts`)

Status: ✅ Completed  
Dependencies: `phase-01-dom-bridge-single-submit.md`  
Target Files:
- `src/transcriptWatcher.ts`
- `src/test/phase02_transcript_multi_conversation_sync.test.ts`

---

## 1. Objective

Enhance `TranscriptWatcher` in `src/transcriptWatcher.ts` to implement resilient multi-conversation discovery and dynamic active-transcript arbitration. Ensure that if multiple conversation directories exist or if a discovered directory stalls without active step streaming, `TranscriptWatcher` evaluates candidate conversation directories created >= `sinceTimestamp`, binds to the active writing transcript, and correctly parses the completion keyword without hanging. Implement a single automated test in `src/test/phase02_transcript_multi_conversation_sync.test.ts`.

---

## 2. Detailed Technical Requirements

### 2.1. Dynamic Conversation Discovery & Activity Tracking (`src/transcriptWatcher.ts`)
- **Multi-Candidate Evaluation in `waitForNewConversation`**:
  - When scanning `.brain/` for directories modified or created after `sinceTimestamp`, retrieve all matching conversation directories (not just the first one).
  - If multiple candidate conversations are detected within the discovery window, sort candidates by most recent transcript modification time (`mtime`) and active file size growth.
- **Active Transcript Arbitration in `watchFile`**:
  - Introduce an activity monitor during `watchFile(filePath, convId)`:
    - If the current `filePath` receives no new lines for an arbitration timeout (e.g. 3000ms) or contains an empty/aborted step stream, while another conversation directory in `.brain/` created >= `sinceTimestamp` has an active `transcript.jsonl` with recent file modifications and active steps:
      - Emit an event `conversationRebound(oldConvId, newConvId, newFilePath)`.
      - Gracefully switch internal file watcher and offset to the active transcript file.
      - Continue parsing lines and debounced completion checking on the active stream without dropping connection or failing the phase.
- **Strict Turn Validation**:
  - Preserve `isValidCompletionStep` checks (`source: 'MODEL'`, `type: 'PLANNER_RESPONSE'`, `status: 'DONE'`, `tool_calls: null/empty`, keyword matching).

### 2.2. Automated File-Based Test (`src/test/phase02_transcript_multi_conversation_sync.test.ts`)
- **Single Test Suite Requirements**: Exactly one comprehensive file-based test suite verifying:
  1. Multi-candidate conversation discovery correctly selects the active conversation when multiple directories are created at the same timestamp.
  2. Dynamic stream arbitration:
     - Initialize `TranscriptWatcher` on a stalled dummy conversation directory (simulating an aborted ghost conversation).
     - Concurrently write steps and `"Done skul9x."` into a sibling conversation directory created at the same time.
     - Verify `TranscriptWatcher` automatically switches to the active conversation and resolves completion with `success: true`.
  3. Strict completion keyword detection is verified across the re-bound stream.
  4. Executed via Node.js test runner:
     ```bash
     npx tsc; node out/test/phase02_transcript_multi_conversation_sync.test.js
     ```

---

## 3. Implementation Steps

1. Update `src/transcriptWatcher.ts` with multi-candidate conversation discovery and dynamic transcript activity arbitration.
2. Implement the `conversationRebound` event and automatic stream switcher.
3. Create `src/test/phase02_transcript_multi_conversation_sync.test.ts`.
4. Compile TypeScript and execute the single verification test:
   ```bash
   npx tsc; node out/test/phase02_transcript_multi_conversation_sync.test.js
   ```
5. Verify 100% test pass rate.

---

## 4. Verification Plan

### Automated Test
```bash
npx tsc; node out/test/phase02_transcript_multi_conversation_sync.test.js
```

### Manual Verification
- Review debug log stream to confirm active conversation re-binding telemetry.

---
Next Phase: [phase-03-orchestrator-dynamic-sync-e2e.md](./phase-03-orchestrator-dynamic-sync-e2e.md)
