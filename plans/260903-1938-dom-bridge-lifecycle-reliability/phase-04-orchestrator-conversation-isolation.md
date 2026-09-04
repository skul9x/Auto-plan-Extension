# Phase 04: Orchestrator Conversation Isolation & Keyword Timestamp Guard

Status: ✅ Completed  
Target Issue: Stopping silent fallback to stale conversation IDs and enforcing keyword timestamp isolation  
Test File: `src/test/phase04_orchestrator_conversation_isolation.test.ts`

---

## 1. Objective

Prevent the Orchestrator from falsely concluding a phase has completed due to reading obsolete completion keywords (`"Done skul9x."`) from previous phases. This phase stops silent fallback to stale conversation IDs on timeout, enforces strict file offset initialization, and enforces timestamp/entry boundary guards during keyword scanning.

---

## 2. Requirements

### Functional Requirements
1. **Eliminate Silent Fallback to `lastConversationId` on Timeout**:
   - In `src/orchestrator.ts` (`waitForNewConversation`), when `openNewConversation` is requested, a timeout must NOT catch and silently return `this.lastConversationId`.
   - Returning the prior phase's conversation ID binds the active phase to an old conversation that already contains finished work and completion tokens, creating instant false-positive completions.
   - On timeout, `waitForNewConversation` must throw an explicit `NewConversationTimeoutError` allowing the orchestrator to initiate an explicit retry sequence or fail gracefully with clear diagnostic logs.
2. **Strict Transcript Offset Initialization**:
   - When a phase executes, if it re-uses or shares a conversation ID with a prior phase, `phase.startOffset` must be initialized to the current end-of-file byte length (`fs.statSync(transcriptPath).size`) at `phaseStartTime`, never defaulting to `0`.
   - Defaulting to `0` causes the watcher to replay the entire history of the session from the very first line.
3. **Phase Boundary & Timestamp Isolation for Completion Keywords**:
   - When monitoring conversation transcripts for completion keywords (such as `"Done skul9x."` or custom stop tokens), record:
     - `phaseStartTime = Date.now()`
     - `initialTranscriptLength` (number of entries or bytes prior to prompt submission).
   - Only consider an entry as a valid completion signal if:
     - Its creation/update timestamp is strictly >= `phaseStartTime`.
     - Or its index is strictly beyond `initialTranscriptLength`.
   - Any keyword occurring before `phaseStartTime` must be ignored as residue from earlier operations.

---

## 3. Implementation Steps

1. **Modify `waitForNewConversation` in `src/orchestrator.ts`**:
   - Locate lines 960–990 where `catch` falls back to `this.lastConversationId`.
   - Remove the silent fallback when `expectNew === true`.
   - Implement structured error `NewConversationTimeoutError` with actionable diagnostic information.
2. **Modify Offset Calculation in `src/orchestrator.ts`**:
   - Update line 1017: if `convId === this.lastConversationId` and `phase.startOffset === undefined`, measure the transcript file size synchronously at `phaseStartTime` and set `offsetToUse = currentFileSize`.
3. **Modify Keyword Detection in `src/orchestrator.ts` & `src/transcriptWatcher.ts`**:
   - Enforce offset/timestamp filtering when evaluating transcript chunks.
   - Reject any matches originating from entries prior to the phase prompt dispatch timestamp.
4. **Create Unit Test**:
   - Implement `src/test/phase04_orchestrator_conversation_isolation.test.ts`.
   - Verify that `waitForNewConversation` throws on timeout rather than returning stale conversation IDs.
   - Verify that pre-existing completion keywords in a transcript do NOT falsely trigger phase completion.
   - Verify that offset initialization defaults to file size instead of 0 for shared conversation IDs.

---

## 4. Files to Modify

- `src/orchestrator.ts`: Eliminate stale conversation ID fallback, fix offset calculation, and enforce keyword timestamp isolation.

---

## 5. Verification Test

- **Test File**: `src/test/phase04_orchestrator_conversation_isolation.test.ts`
- **Command**: `npx mocha -r ts-node/register src/test/phase04_orchestrator_conversation_isolation.test.ts`
- **Scope**:
  - Validates `waitForNewConversation` does NOT return stale conversation ID on timeout.
  - Validates completion keywords prior to `phaseStartTime` are strictly ignored.
  - Validates offset initialization uses file end-of-file size when starting a phase on an existing transcript.
