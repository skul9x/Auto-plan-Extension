# Phase 04: Background Engine Polling & Stream Optimization

Status: ✅ Completed  
Dependencies: Phase 03  

---

## 1. Objective
Reduce idle CPU consumption, minor Garbage Collection allocation churn, and renderer thread saturation across the background RPC auto-submit engine, the transcript tailing engine, and the DOM bridge submission clearance loop.

---

## 2. Scope
- Remediate **PERF-003**: Implement adaptive polling backoff (e.g. 3000ms–5000ms when idle), cache payload fingerprints to eliminate redundant deep key sorting and SHA-256 hashing, and eliminate duplicate RPC trajectory queries immediately before submission.
- Remediate **PERF-008**: Replace repeated creation of `fs.createReadStream` and `readline.createInterface` instances on token appends with a persistent file handle and reusable buffer tailing mechanism in `TranscriptTailEngine`, and relax fallback polling interval when active filesystem watchers are healthy.
- Remediate **PERF-009**: Increase the prompt submission clearance polling interval from 15ms to a safe bounded cadence (e.g. 80ms) or implement scoped event-driven observation in `autoplan-dom-bridge.js`.

---

## 3. Requirements

### Functional Requirements
- **FR-01:** The RPC auto-submit loop must dynamically increase its polling interval when no trajectories have pending user interaction steps, and reduce the interval back to 1000ms when pending steps are discovered.
- **FR-02:** Computed payload fingerprints must be cached by trajectory ID and step index, bypassing key sorting and SHA-256 recalculation for unmodified steps.
- **FR-03:** The auto-submit submission path must avoid executing redundant duplicate trajectory queries within the same second when the current snapshot is already valid.
- **FR-04:** `TranscriptTailEngine` must read newly appended bytes using a persistent open `FileHandle` and a reusable buffer, appending parsed lines without re-instantiating read streams, decoders, and event emitters on each chunk.
- **FR-05:** `TranscriptTailEngine` must handle file truncation or log rotation gracefully by resetting its byte offset tracker when file size decreases.
- **FR-06:** The DOM bridge clearance verification loop must poll at a relaxed interval (minimum 80ms) or leverage targeted mutation listeners, preventing 100% renderer CPU saturation during prompt submission.

### Non-Functional Requirements
- **NFR-01 CPU Overhead:** Idle CPU consumption from background auto-submit and tail polling must decrease by at least 60% when the IDE is inactive.
- **NFR-02 Memory Efficiency:** Minor GC allocation rate during token streaming must decrease substantially by eliminating per-chunk stream allocation.
- **NFR-03 Responsiveness:** Auto-submission latency for pending interactions must remain within 3 seconds, preserving prompt automation responsiveness.

---

## 4. Constraints
- Preserve exact SHA-256 deduplication semantics to guarantee identical actions are not approved more than once.
- Maintain full compatibility with Antigravity RPC client methods (`getAllCascadeTrajectories`, `handleCascadeUserInteraction`).
- Do not alter the three hard-proof criteria used by DOM Bridge clearance verification (`checkProof1`, `checkProof2`, `checkProof3`).

---

## 5. Dependencies
- `src/antigravityRpcAutoSubmit.ts`
- `src/transcriptTailEngine.ts`
- `media/autoplan-dom-bridge.js`

---

## 6. Acceptance Criteria
- [x] Auto-submit polling backs off to $\ge 3000$ms when zero pending interactions exist.
- [x] Payload fingerprinting is skipped for previously processed, unmodified steps via cache hits.
- [x] Pre-approval duplicate trajectory fetch is eliminated.
- [x] `TranscriptTailEngine.readAppendedLines` reads new bytes using a persistent file handle without creating `fs.createReadStream` on every append.
- [x] DOM bridge clearance verification loop executes with a polling interval $\ge 80$ms.
- [x] Exactly one file-based verification test executes and validates adaptive polling, tailing efficiency, and relaxed DOM verification.

---

## 7. Verification Test Specification
- **Test File:** `src/test/phase04_rpc_engine_and_dom_performance_verification.test.ts`
- **Verification Target:**
  1. Verify auto-submit scheduler increases delay when trajectory summaries contain 0 pending steps, and resumes fast polling when steps appear.
  2. Verify payload fingerprint cache returns existing hash without executing redundant SHA-256 computation for identical step payloads.
  3. Verify `TranscriptTailEngine` reads incremental appended lines using a persistent file handle and handles simulated file truncation.
  4. Verify DOM bridge clearance options enforce a minimum verification poll interval $\ge 80$ms.
  5. Verify end-to-end correctness of prompt clearance and tail event dispatch.

