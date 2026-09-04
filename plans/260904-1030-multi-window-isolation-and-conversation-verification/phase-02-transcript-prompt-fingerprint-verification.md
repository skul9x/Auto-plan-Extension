# Phase 02: Transcript Prompt Fingerprint & Workspace Ownership Verification

Status: 🟢 Completed  
Dependencies: Phase 01  
Target Files: `src/transcriptWatcher.ts`, `src/orchestrator.ts`  
Primary Test File: `src/test/phase02_transcript_conversation_ownership.test.ts`

---

## 1. Objective

Prevent cross-workspace conversation hijacking where Orchestrator binds to a conversation created by another open VS Code window or manual chat.
By implementing **Prompt Fingerprint Verification**, Orchestrator and `TranscriptWatcher` will inspect candidate `transcript.jsonl` files and only accept conversations whose initial user request explicitly matches the dispatched phase's fingerprint (phase file name or prompt prefix).

---

## 2. Requirements

### Functional
- [x] In `src/transcriptWatcher.ts`:
  - Define `ConversationOwnershipCriteria`:
    ```typescript
    export interface ConversationOwnershipCriteria {
      expectedPromptSnippet?: string;
      workspacePath?: string;
      workspaceName?: string;
    }
    ```
  - Implement `verifyConversationOwnershipAsync(transcriptPath: string, criteria: ConversationOwnershipCriteria): Promise<boolean>`:
    - Non-blocking read of the first 8KB of `transcript.jsonl` (sufficient to encompass step 0 `USER_INPUT`).
    - Parse or pattern-match the `content` of the first step.
    - If `expectedPromptSnippet` is provided, confirm it is present in the prompt text.
    - If `workspacePath` or `workspaceName` is provided, check for matching workspace hints in metadata or content.
    - Return `true` if verified, `false` otherwise.
  - In `getCandidateConversationsAsync()`:
    - Accept optional `criteria?: ConversationOwnershipCriteria`.
    - When `criteria` is present, filter out candidate directories that fail ownership verification.
  - In `TranscriptWatcher.waitForNewConversation()`:
    - Accept `criteria?: ConversationOwnershipCriteria` and apply it during polling.
- [x] In `src/orchestrator.ts`:
  - In `runPhaseSequence()`:
    - Before calling `waitForNewConversation()`, build `ownershipCriteria`:
      - `expectedPromptSnippet`: `phase.fileName` (e.g. `"phase-02-favorites-sync-metric-preservation.md"`).
      - `workspacePath`: current workspace root or plan folder path.
    - Pass `ownershipCriteria` into `waitForNewConversation()` and `this.transcriptWatcher.setOptions()`.
  - Ensure diagnostic logs indicate when candidate conversations are skipped due to ownership mismatch (`"Skipping foreign conversation [id] (failed ownership verification for [fileName])"`).

### Non-Functional
- [x] Bounded I/O: Initial verification reads at most 8KB per candidate file, avoiding memory spikes on large transcripts.
- [x] Fallback: If `transcript.jsonl` has not yet been flushed to disk (0 bytes), keep polling until the file contains initial bytes or the timeout expires.

---

## 3. Implementation Steps

1. In `src/transcriptWatcher.ts`:
   - Implement `verifyConversationOwnershipAsync()` using asynchronous file descriptors (`fs.promises.open`).
   - Update `getCandidateConversationsAsync()` and `findLatestConversationAsync()` signatures to accept `criteria`.
   - Update `TranscriptWatcher` polling methods to enforce ownership matching.
2. In `src/orchestrator.ts`:
   - Update `waitForNewConversation()` method signature to pass `ownershipCriteria`.
   - Wire `phase.fileName` as the default ownership verification snippet during phase execution.
3. Implement `src/test/phase02_transcript_conversation_ownership.test.ts`:
   - Test 1: Candidate with foreign user prompt (e.g. from Auto-Plan chat) is rejected when searching for TramsacEV phase.
   - Test 2: Candidate with matching `phase-02-favorites-sync-metric-preservation.md` snippet is accepted immediately.
   - Test 3: Polling loop waits through temporary 0-byte transcript until step 0 is written and verified.
   - Test 4: Regression check: When no criteria is provided, legacy behavior (time-only matching) remains functional.

---

## 4. Verification Plan

- Run the single comprehensive test for this phase:
  ```bash
  npm run compile && node out/test/phase02_transcript_conversation_ownership.test.js
  ```
- Verify all assertions pass cleanly.
- Stop for user review.
