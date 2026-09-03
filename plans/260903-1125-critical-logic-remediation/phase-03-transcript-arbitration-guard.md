# Phase 03: Transcript Arbitration Guard & Real-Time Completion Verification (LOGIC-003 Remediation)

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02  
Target Files:
- `src/transcriptWatcher.ts`
- `src/orchestrator.ts`
- `src/test/phase03_transcript_arbitration_guard.test.ts`

---

## 1. Objective

Prevent false-positive phase completions caused by premature conversation arbitration and replay of stale completion tokens. Guarantee that `TranscriptWatcher` never rebinds to an older completed conversation session when the AI model experiences initial response latency, and ensure completion events are only accepted if generated strictly within the active phase execution window.

---

## 2. Root Cause Analysis (LOGIC-003)

1. `arbitrationTimeoutMs` defaults to only `3000` (3 seconds). If an LLM model requires more than 3 seconds of prefill / thinking time before streaming its first token, arbitration is triggered.
2. In `performArbitrationCheck()`:
   ```typescript
   const activeCandidates = candidates.filter(
     (c) => c.convId !== this.activeConvId && c.transcriptPath && (c.transcriptSize > 0 || c.transcriptMtime >= this.lastActivityTime)
   );
   ```
   The standalone clause `c.transcriptSize > 0` matches every historical conversation transcript in `~/.gemini/antigravity-ide/brain/`.
3. When a historical candidate is selected, `this.readOffset` is reset to `0`, causing the watcher to parse the file from the very beginning.
4. `isValidCompletionStep()` evaluates only model source, status, and completion keyword (`Done skul9x.`), completely ignoring step creation timestamp.
5. Finding the historical completion keyword from a prior phase, the watcher immediately starts the settle timer and emits `completed`, marking the new phase finished in ~3.5 seconds with zero code generated.

---

## 3. Technical Requirements

### 3.1. Strict Temporal Candidate Filtering (`src/transcriptWatcher.ts`)
1. Remove the standalone `c.transcriptSize > 0` condition from `performArbitrationCheck()`.
2. Candidates must strictly satisfy:
   - `transcriptMtime >= this.sinceTimestamp` (where `sinceTimestamp` is the phase start boundary).
   - And the file must have experienced active byte growth since the phase started, or have a creation time after `sinceTimestamp`.
3. Raise the default `arbitrationTimeoutMs` from `3000ms` to `15000ms` (15s) so normal LLM thinking delays do not trigger premature candidate swapping.

### 3.2. Step Timestamp Validation in Completion Checks (`src/transcriptWatcher.ts`)
1. Update `isValidCompletionStep(step: any, keyword: string, minTimestamp?: number): boolean`:
   - Inspect step timestamp properties (`step.timestamp`, `step.createdAt`, `step.time`).
   - If `minTimestamp` is provided and a valid timestamp exists on `step`, verify `stepTimestamp >= minTimestamp`.
   - Reject any step whose recorded timestamp predates `minTimestamp`.
2. Pass `this.sinceTimestamp` to `isValidCompletionStep()` during streaming line evaluation.

### 3.3. Initial Offset Preservation on Candidate Rebind (`src/transcriptWatcher.ts`)
1. When rebinding to an existing candidate file during arbitration, do NOT reset `readOffset = 0` if the file already existed prior to `sinceTimestamp`.
2. Fast-forward the read offset to the end of the pre-existing content, so only newly appended tokens are processed.

### 3.4. Orchestrator Integration (`src/orchestrator.ts`)
1. Pass accurate `phaseStartTime` to `watchLatest` and ensure `sinceTimestamp` boundaries are preserved during phase transitions.

---

## 4. Single Automated File-Based Test

Create `src/test/phase03_transcript_arbitration_guard.test.ts` to verify:
1. Create a simulated brain directory with an existing historical conversation containing an old `Done skul9x.` completion token.
2. Initialize `TranscriptWatcher` with `sinceTimestamp = Date.now()`.
3. Simulate an LLM thinking delay of 4 seconds (exceeding old 3s arbitration timeout).
4. Verify that the watcher does NOT rebind to the historical conversation or emit false completion.
5. Write a brand new completion step to a new transcript file with timestamp `>= sinceTimestamp`.
6. Verify that the watcher detects the genuine completion step and resolves successfully.
7. Clean up test files.

---

## 5. Verification Protocol

Run only this single test for verification:
```bash
npx tsc && node out/test/phase03_transcript_arbitration_guard.test.js
```

After running this single test, stop immediately for user review. Once completed, output `done.`.
