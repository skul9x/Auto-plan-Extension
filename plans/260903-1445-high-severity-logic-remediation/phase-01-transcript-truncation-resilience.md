# Phase 01: Transcript Truncation & Rotation Resilience (LOGIC-004 Remediation)

Status: ✅ Completed  
Dependencies: None  
Target Files:
- `src/transcriptWatcher.ts`
- `src/test/phase01_transcript_truncation_resilience.test.ts`

---

## 1. Objective

Eliminate the permanent watcher hang caused by transcript file truncation or log rotation. Guarantee that `TranscriptWatcher` detects when an active transcript file size shrinks below `this.readOffset`, cleanly resets its internal byte pointer and line buffers, and immediately resumes parsing new lines from byte 0 without stalling or triggering timeout failures.

---

## 2. Root Cause Analysis (LOGIC-004)

1. In `checkFileAndProcess()` (`src/transcriptWatcher.ts`):
   ```typescript
   if (exists && this.isWatching) {
     const stats = await fs.promises.stat(targetFile);
     if (this.isWatching && stats.size > this.readOffset) {
       // Read bytes from this.readOffset to stats.size
       ...
       this.readOffset += bytesRead;
     }
   }
   ```
2. If the user clears the chat session, compacts the log, or the IDE rotates/resets the transcript file (e.g., file size decreases from 45KB down to 1KB), `stats.size < this.readOffset`.
3. The block `stats.size > this.readOffset` evaluates to `false`.
4. Because there is no branch handling `stats.size < this.readOffset`, `this.readOffset` remains stuck at the obsolete high value (e.g. 45000).
5. All subsequent token generation and new completion steps appended up to 45KB are silently ignored, causing the watcher to remain permanently idle until the 15-minute orchestrator timeout triggers.

---

## 3. Technical Requirements

### 3.1. Truncation and Rotation Detection (`src/transcriptWatcher.ts`)
1. In `checkFileAndProcess()` before reading:
   - Check if `stats.size < this.readOffset`.
   - When detected, record a diagnostic warning and emit event:
     ```typescript
     console.warn(`[TranscriptWatcher] Detected file truncation/rotation (${stats.size} < ${this.readOffset}). Resetting read offset to 0.`);
     this.emit('fileTruncated', { filePath: targetFile, previousOffset: this.readOffset, newSize: stats.size });
     ```
   - Reset `this.readOffset = 0`.
   - Clear `this.lineBuffer = ''`.
   - Re-instantiate `this.stringDecoder = new StringDecoder('utf8')`.
   - Reset candidate baseline size for this file to prevent arbitration deadlocks:
     ```typescript
     this.candidateBaselineSizes.set(targetFile, 0);
     ```
2. Ensure that after resetting `readOffset` to 0, if `stats.size > 0`, the loop immediately proceeds to read the new content from byte 0 in the same cycle.

### 3.2. State Consistency & Edge Cases
1. Handle zero-byte files gracefully (`stats.size === 0`): reset `readOffset = 0` and wait for incoming data without attempting read chunks.
2. Cancel pending settle timers and completions from discarded lines prior to truncation:
   ```typescript
   if (this.settleTimer) {
     clearTimeout(this.settleTimer);
     this.settleTimer = null;
     this.pendingCompletion = null;
   }
   ```
3. Ensure that after truncation, any new line matching the completion keyword starts a fresh quiet-period cycle or immediate resolution.

---

## 4. Single Automated File-Based Test

Create `src/test/phase01_transcript_truncation_resilience.test.ts` to verify:
1. Setup standalone `vscode` module mock conforming to project test standards.
2. Create a simulated brain directory and transcript file.
3. Initialize `TranscriptWatcher` and watch the file.
4. Write initial content up to ~4KB. Verify watcher consumes data and updates `readOffset` to ~4KB.
5. Truncate the file to 300 bytes containing a brand new completion keyword step.
6. Trigger file check and verify:
   - Truncation is detected cleanly (`fileTruncated` event received).
   - `readOffset` resets to 0 without throwing `this.log` errors.
   - Pending settle timers are cleared.
   - The watcher immediately reads the 300 bytes of new content from byte 0 in the same cycle.
   - The new completion step is parsed and resolved without hanging or timing out.
7. Test zero-byte truncation edge case: truncate file to 0 bytes, write new content 200ms later, and verify clean recovery.
8. Clean up temporary test files.

---

## 5. Verification Protocol

Run only this single test for verification:
```bash
npx tsc && node out/test/phase01_transcript_truncation_resilience.test.js
```

After running this single test, stop immediately for user review. Once completed, output `done.`.
