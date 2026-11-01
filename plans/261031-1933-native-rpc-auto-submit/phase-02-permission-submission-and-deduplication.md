# Phase 02: Safe Permission Submission, SHA-256 Deduplication & Rate Limiting

Status: ✅ Completed
Test: `src/test/phase02_rpc_auto_submit_execution_dedup.test.ts`

## Objective
Implement safe, idempotent permission approval execution over the Antigravity RPC client with cryptographic deduplication, scope bounding (`scope: ONCE`), exponential backoff retry scheduling, cancellation management, and session quota enforcement.

## Scope
- Interaction submission dispatch via `handleCascadeUserInteraction`.
- Cryptographic SHA-256 fingerprinting of permission interaction payloads.
- Quarantine cache and deduplication tracking for dispatched and in-flight permissions.
- Double-check candidate verification immediately prior to dispatch to prevent race conditions.
- Configurable approval quota tracking and adaptive backoff scheduling.

## Requirements
1. **Idempotent Single-Grant Approval Scope**:
   - Construct RPC interaction payloads explicitly specifying single-use approval scope (`scope: ONCE` / allow this time).
   - Ensure permissions are never granted persistently or globally (`ALWAYS_ALLOW` must never be automatically selected).
   - Enforce an AbortController-driven timeout on all RPC submission promises to prevent hung requests during IDE background processing.
2. **Cryptographic Deduplication & Stale Re-Reading**:
   - Generate a deterministic SHA-256 fingerprint for each candidate interaction payload based on its target resource properties.
   - Combine cascade ID, trajectory ID, step index, and the payload hash into a unique quarantine key.
   - Maintain a bounded deduplication cache with a 24-hour retention window.
   - Immediately before submitting an approval, re-query active trajectories to confirm the candidate remains in a waiting state and has not been altered, superseded, or cancelled by the user.
3. **Pre-Allocation & Race-Condition Guarding**:
   - Reserve quota counters and record quarantine entries *before* initiating the dispatch promise to prevent duplicate approvals if an acknowledgment is lost or delayed.
   - Quarantine ambiguous timeouts so that unconfirmed requests are not repeatedly re-submitted.
4. **Adaptive Backoff & Scheduling Engine**:
   - Execute poll ticks on a configurable schedule (default: 1,000ms; bounded between 200ms and 120,000ms).
   - Implement exponential backoff on consecutive RPC failures (scaling up to a maximum cap) to prevent tight failure loops when the IDE backend is temporarily restarting or unresponsive.
   - Support manual invalidation and immediate tick triggering when new activity is detected.
5. **Session Quota Limits**:
   - Enforce configurable per-pattern or total session limits on automatic approvals.
   - Automatically transition to an idle/dormant state once the configured threshold is reached, emitting appropriate telemetry.

## Constraints
- Do not perform elevated filesystem modifications or shell execution; all approvals must flow through `handleCascadeUserInteraction`.
- Total memory retained by the deduplication cache must remain bounded under 2 MB regardless of long-running session duration.
- Must not block the extension host or interfere with active editor typing or debugging sessions.

## Dependencies
- Source files: `src/antigravityRpcAutoSubmit.ts`, `src/config.ts`.
- Prior phases: Phase 01.

## Acceptance Criteria
- Successfully sends approval interactions with `scope: 1` (`ONCE`) to mock RPC server and registers an approved count increment.
- Re-reads trajectory state before dispatching; skips candidates that disappear between detection and submission.
- Rejects duplicate submission of identical permission requests across multiple poll cycles using SHA-256 quarantine keys.
- Backs off exponentially upon receiving mock RPC errors and recovers to base interval upon successful connection.
- Halts automatic submission when session quota is exhausted.

## Comprehensive File-Based Test
- **File**: `src/test/phase02_rpc_auto_submit_execution_dedup.test.ts`
- **Scope**:
  - Tests end-to-end submission flow against a simulated Antigravity RPC client.
  - Verifies payload SHA-256 fingerprint generation and quarantine cache hit/miss behavior under concurrent ticks.
  - Simulates stale candidate drop: removes waiting step during the pre-dispatch re-read and verifies that no submission is dispatched.
  - Verifies quota bounding: asserts that reaching the configured limit prevents further dispatches.
  - Tests error backoff timing and recovery mechanics under simulated RPC timeouts and socket disconnects.

