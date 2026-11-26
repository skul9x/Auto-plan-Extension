# Phase 2: Orchestrator Prompt Fingerprinting, Retry Loop Guard & Snapshot Hygiene

**Status:** Completed ✅

## 1. Objective
Wire rich prompt-fingerprint metadata (`expectedPromptHead` / `expectedPromptTail`) from `Orchestrator` into `TranscriptWatcher`, prevent retry storms from launching duplicate concurrent conversations when ownership verification lags or retries occur, and eliminate false `[WARN] Failed to capture DOM snapshot` log pollution in Native Antigravity Dispatch mode.

---

## 2. Scope
- **Orchestration Loop, Ownership Criteria Assembly & Retry Guard** (`src/orchestrator.ts`)
- **DOM Snapshot Guard for Focus-Free Native Dispatch** (`src/orchestrator.ts`: `saveWorkbenchSnapshot`)

---

## 3. Requirements
1. **Attach Head/Tail Fingerprints to `ConversationOwnershipCriteria`:**
   - Before dispatching a phase prompt (`renderedPrompt`), derive normalized `expectedPromptHead` (e.g., compact slice from first ~120 chars skipping dynamic `<USER_REQUEST>` wrapper if needed, or exact raw leading ~100 chars matching `Prompt` step 0) and `expectedPromptTail` (last ~100 chars of `renderedPrompt`) and pass them into `ownershipCriteria` alongside `expectedPromptSnippet: phase.fileName`.
   - Choose substring lengths (`~80–120` chars) well within Antigravity IDE's untruncated prefix/suffix retention bounds (`> 1,200` chars preserved at both ends of truncated JSONL step 0).
2. **Duplicate-Spawn Guard Before Auto-Retrying `NewConversationTimeoutError`:**
   - Track conversations seen and skipped during a phase's `waitForNewConversation` attempt (`skippedConvIds`).
   - Inside the `catch (err instanceof NewConversationTimeoutError)` retry handler (around `orchestrator.ts:1614`):
     - Re-probe any post-`phaseStartTime` candidates using sibling `transcript_full.jsonl` / relaxed head+tail workspace criteria BEFORE dispatching another duplicate prompt via `startNewConversation` + `triggerSend`.
     - If an active candidate conversation from the previous dispatch already exists and passes recovery verification, adopt that conversation immediately instead of spawning a second parallel AI agent!
     - If retrying must proceed, attempt `promptDispatcher.stopActiveGeneration()` defensively only if explicitly safe/configured or cleanly log skipped IDs in diagnostics so developers can trace orphaned directories immediately.
3. **Suppress Obsolete DOM Snapshot Warnings in Native Mode (`saveWorkbenchSnapshot`):**
   - Check `bridgeServer?.getConnectedClientsCount()` (or whether DOM bridge fallback is actually disabled/inactive under `dispatchExecutionMode: 'nativeCommand'` or `'auto'` with 0 bridge clients) inside `saveWorkbenchSnapshot` (`orchestrator.ts:382-409`).
   - When running in Native Dispatch tier with `connectedClientsCount === 0` (DOM bridge intentionally removed/unloaded), log a single concise `DEBUG` entry (`Skipping DOM snapshot: running in focus-free Native Dispatch mode without DOM bridge clients`) and return `undefined` silently instead of emitting misleading `[WARN] Failed to capture DOM snapshot: No active connected DOM bridge clients found` across every phase and retry.

---

## 4. How to Implement
1. **Compute Head & Tail Fingerprints in `src/orchestrator.ts`:**
   - Add a pure helper `extractPromptFingerprints(renderedPrompt: string): { head?: string; tail?: string }`:
     - Trim leading/trailing whitespace; replace `\r\n` with `\n`.
     - If length >= 48: take first non-empty meaningful line/slice (`slice(0, 120).trim()`) for `head` and trailing slice (`slice(-120).trim()`) for `tail` (avoiding JSON-escape distortion by also picking plain ASCII/line slices if multiline, or keeping `head`/`tail` tested against `JSON.parse` decoded `promptContent` in `verifyConversationOwnershipAsync`!). Notice in Phase 1, `verifyConversationOwnershipAsync` already decodes line 0 JSON `parsed.content` before comparing! Even better: strip any leading `<USER_REQUEST>`/`\n` prefix inside comparison or pick a clean inner slice `renderedPrompt.trim().slice(0, 100)` and `renderedPrompt.trim().slice(-100)` — both survive JSON encoding intact once parsed by `JSON.parse`!
   - Populate `expectedPromptHead` and `expectedPromptTail` inside `ownershipCriteria` around `orchestrator.ts:1569`.
2. **Pass Skipped-Candidate History & Pre-Retry Recovery in `src/orchestrator.ts`:**
   - Maintain a per-attempt `skippedConvIds = new Set<string>()` listening to `'candidateSkipped'` during `waitForNewConversation`.
   - On `NewConversationTimeoutError` inside `executeLoop`, before calling `sleepWithAbort` and re-dispatching `renderedPrompt`:
     - Perform one non-intrusive recovery lookup via `getCandidateConversationsAsync(brainDir, phaseStartTime, this.lastConversationId, recoveryCriteria)` checking sibling `transcript_full.jsonl` and structural fingerprints in case the conversation finished flushing right around the `8000ms` boundary.
     - If found, adopt `convId = candidates[0].convId`, emit `conversationDetected`, reset `phaseRetryCount = 0`, and break out of the retry loop cleanly to wait for completion without sending a duplicate prompt!
3. **Downgrade Native-Mode DOM Snapshot No-Op in `saveWorkbenchSnapshot` (`orchestrator.ts:382-386`):**
   - Before warning `'Failed to capture DOM snapshot: BridgeServer instance not available'` or calling `server.captureDomSnapshot(6000)` when `server.getConnectedClientsCount() === 0`:
     - Inspect active dispatcher readiness (`this.promptDispatcher?.validateDispatchReadiness?.()`) or config (`cfg.dispatchExecutionMode`).
     - If DOM bridge has `0` connected clients AND native dispatch is active (`!cfg.allowTierFallback` or `dispatchExecutionMode === 'nativeCommand'` or readiness `selectedTier === 'nativeCommand'`), log at `this.debugLogger.debug('ORCHESTRATOR', ...)` and return `undefined` cleanly without emitting `[WARN]`.

---

## 5. Files to Create/Modify
- **Modify:**
  - `src/orchestrator.ts`
- **Create (Test only):**
  - `src/test/phase02_orchestrator_duplicate_retry_and_snapshot_hygiene.test.ts`

---

## 6. Dependencies
- **Phase 1:** Requires `expectedPromptHead` / `expectedPromptTail` fields on `ConversationOwnershipCriteria` and `transcript_full.jsonl` fallback in `src/transcriptWatcher.ts`.

---

## 7. Constraints
- Do NOT break existing `waitForNewConversation` method signature defaults (`phase02_transcript_conversation_ownership.test.ts`).
- Do NOT alter `DEFAULT_PROMPT_TEMPLATE` or mutate user-configured `config.promptTemplate`.
- Keep retry limit (`maxRetries`), abort (`isAborted`), and skip (`isSkippingCurrentPhase`) semantics intact when a real conversation genuinely fails to appear.

---

## 8. Acceptance Criteria
1. `Orchestrator` populates `expectedPromptHead` and `expectedPromptTail` from the dispatched prompt into `ownershipCriteria`.
2. When `waitForNewConversation` times out at the exact moment a conversation finishes flushing on disk, `Orchestrator` recovers and attaches to that existing conversation without spawning a duplicate conversation.
3. In Native Dispatch mode with `0` connected DOM bridge clients, `saveWorkbenchSnapshot` produces zero `[WARN] Failed to capture DOM snapshot` lines while still warning/attempting snapshots when `domBridge` clients are expected/connected.

---

## 9. Comprehensive File-Based Test
- **Test File:** `src/test/phase02_orchestrator_duplicate_retry_and_snapshot_hygiene.test.ts`
- **Framework:** Standalone Node TypeScript (`assert` + mock `PromptDispatcher` + temp `brainDir`) compiled via `npm run compile` and executed via `node out/test/phase02_orchestrator_duplicate_retry_and_snapshot_hygiene.test.js`
- **Test Scenarios Covered in One File:**
  1. **Fingerprint Extraction Helper:** Tests `extractPromptFingerprints` on short text, multi-line prompts, and the 6,356-char JSON prompt structure verifying `head` and `tail` stay non-empty and match decoded `step_index: 0` content.
  2. **Pre-Retry Recovery Prevents Duplicate Dispatch:** Simulates `Orchestrator` dispatching a phase whose `transcript.jsonl` is truncated initially, timing out once, then having sibling `transcript_full.jsonl` appear right before retry execution; asserts `promptDispatcher.dispatchPrompt` was called only **once** (no duplicate retry prompt fired) and phase still completes.
  3. **Native-Tier DOM Snapshot Warning Suppression:** Invokes `saveWorkbenchSnapshot` with a mock `BridgeServer` reporting `connectedClientsCount = 0` and dispatcher tier `'nativeCommand'`; inspects captured `DebugLogger` entries asserting zero `'WARN'` logs contain `'Failed to capture DOM snapshot'`, while preserving snapshot capture when `connectedClientsCount > 0`.
