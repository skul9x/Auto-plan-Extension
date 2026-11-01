# Phase 04: Dispatch Latency, Fallback Resilience & Algorithmic Optimization

Status: ✅ Completed
Test: `src/test/phase04_dispatch_latency_algorithmic_cleanup.test.ts`

## Objective
Reduce prompt dispatch latency by removing artificial delays and pre-flight ordering flaws, optimize prompt fingerprinting and deduplication data structures, and eliminate $O(N^2)$ algorithmic bottlenecks and repeated object allocations in core plan analysis.

## Scope
- Dispatch execution order, client probing, and post-handshake timing in `src/promptDispatcher.ts` (`dispatchTier1`, `dispatchPrompt`, `testTierDispatch`).
- Prompt origin tracking, hashing, and ring buffer pruning in `src/promptOriginTracker.ts` (`pruneExpired`, `registerTelegramPrompt`, `hashPrompt`).
- Natural collation, stall diagnosis, and buffer allocation in `src/planScanner.ts` (`sortPhaseFiles`, `analyzePhaseStallReason`, `inspectPhaseHeaderAsync`).

## Requirements
1. **Pre-Flight Readiness Check & Fallback De-duplication in Dispatcher**:
   - Reorder `dispatchTier1` in `src/promptDispatcher.ts` so that active client connection status is evaluated *before* triggering `openNewConversation` commands.
   - If zero DOM Bridge clients are connected and cannot be awakened, transition immediately to the configured fallback tier without executing `openNewConversation` or stalling for 1.2 seconds.
   - Prevent duplicate blank chat tab creation when falling back from Tier 1 to Tier 2 or Tier 3.
2. **Elimination of Artificial Dispatch Sleep**:
   - Eliminate the hardcoded 450ms sleep following `dispatchNewConversationCommand` when the renderer client has already acknowledged conversation readiness (`readyCheckOnly`).
   - Allow prompt submission to proceed immediately upon positive readiness confirmation, saving 450ms on every phase execution.
3. **Optimized Deduplication Ring Buffer in PromptOriginTracker**:
   - Refactor `pruneExpired()` in `src/promptOriginTracker.ts` to perform $O(1)$ amortized FIFO eviction from the head of the chronological entry list instead of rebuilding new arrays and re-hashing maps on every query.
   - Eliminate redundant duplicate calls to `normalizePromptText()` within `hashPrompt()`.
   - Remove unused raw prompt string retention from `PromptFingerprintEntry` to save memory.
   - Eliminate the unreferenced background 15-second `setInterval` timer, switching to lazy on-access expiration.
4. **Linear ($O(N)$) Stall Reason Analysis & Hoisted Collator**:
   - Refactor `analyzePhaseStallReason()` in `src/planScanner.ts` to replace repetitive $O(N^2)$ slice and search operations with a single-pass scan that precomputes blocker indices.
   - Hoist `Intl.Collator` instances to module-level reusable singletons rather than instantiating new collators on every sort call.
   - Replace zero-filled buffer allocations (`Buffer.alloc(4096)`) with `Buffer.allocUnsafe(4096)` where buffers are immediately overwritten by file reads.
5. **Lightweight Command Verification in Settings**:
   - Replace expensive `vscode.commands.getCommands(true)` serialization in `PromptDispatcher.testTierDispatch('nativeCommand')` with lightweight direct command existence checks.

## Constraints
- Ensure prompt deduplication accuracy between Telegram and PC IDE remains 100% reliable.
- Maintain identical sort orders for plan files with numeric and alphanumeric suffixes.
- Do not bypass handshake verification for Tier 1 when the DOM Bridge client is genuinely not ready.

## Dependencies
- Source files: `src/promptDispatcher.ts`, `src/promptOriginTracker.ts`, `src/planScanner.ts`.
- Core types: `PromptFingerprintEntry`, `PhaseDiagnosticInfo`, `DispatchResult`.

## Acceptance Criteria
- When DOM Bridge is disconnected in `"auto"` mode, fallback dispatch initiates without opening redundant blank conversation tabs.
- Tier 1 prompt submission latency is reduced by at least 400ms when DOM Bridge confirms immediate readiness.
- `PromptOriginTracker` handles 1,000 prompt lookups and registrations without background timer wakeups or full array rebuilds.
- `analyzePhaseStallReason` execution time scales linearly ($O(N)$) rather than quadratically ($O(N^2)$) for plans with 100+ phases.

## Comprehensive File-Based Test
- **File**: `src/test/phase04_dispatch_latency_algorithmic_cleanup.test.ts`
- **Scope**:
  - Simulates Tier 1 dispatch with zero connected clients and verifies immediate fallback without duplicate chat creation.
  - Verifies removal of unnecessary 450ms delays when fast readiness ack is returned.
  - Benchmarks `PromptOriginTracker` operations verifying zero background timers and $O(1)$ amortized pruning.
  - Benchmarks `sortPhaseFiles` and stall analysis on 100-phase datasets to prove $O(N)$ scaling and singleton collator reuse.
