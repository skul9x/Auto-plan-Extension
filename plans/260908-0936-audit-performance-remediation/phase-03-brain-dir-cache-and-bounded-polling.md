# Phase 03: Brain Directory Cache & Bounded Polling I/O
Status: 🟩 Completed
Dependencies: Phase 02

## Objective
Eliminate disk I/O storms and polling timeouts caused by un-cached repetitive `stat` calls across hundreds of conversation folders in `~/.gemini/antigravity-ide/brain/` during active polling and phase initialization.

## Requirements
### Functional
- [x] Activate `brainDirCacheMap` in `src/transcriptWatcher.ts`:
  - Cache sub-directory listings (`entry.name`, `fullPath`) indexed by root `brainDir` path and root directory `mtime`.
  - Avoid calling `fs.promises.readdir(brainDir)` when root `brainDir` modification time remains unchanged.
- [x] Implement Two-Tier Cold/Hot Conversation Filtering:
  - Mark conversation entries with `dirTime < sinceTimestamp` and inactive transcripts as "cold" within `BrainDirCacheEntry.dirMap`.
  - Skip redundant `fs.promises.stat` calls on cold conversations during repetitive polling cycles (300ms polling interval).
  - Only execute deep transcript `stat` and ownership verification on hot candidates (directories modified after `sinceTimestamp`).
- [x] Convert `initializeBaselineCandidates` to asynchronous non-blocking traversal:
  - Replace synchronous `fs.readdirSync` and `fs.statSync` loops with non-blocking async operations (`initializeBaselineCandidatesAsync`).
  - Populate initial baseline map using cached directory entries when available.
- [x] Cache Lifecycle & Invalidation:
  - Invalidate directory entry cache whenever root `brainDir` `mtime` changes (new conversation directory created).
  - Support programmatic cache clearing via `clearBrainDirCache(brainDir)`.

### Non-Functional
- [x] Disk I/O system calls during idle conversation polling reduced by >= 90% in large workspaces with 100+ historic conversations.
- [x] High-volume candidate discovery completes in < 15ms without blocking the Extension Host event loop.
- [x] Eliminates artificial timeouts in orchestrator conversation discovery.

## Implementation Steps
1. In `src/transcriptWatcher.ts`:
   - Connect `getCandidateConversationsAsync` to `brainDirCacheMap`.
   - Read root `brainDir` stat to check `mtimeMs`. If unchanged from cache, reuse cached folder entries.
   - Pre-filter out cold conversations based on cached timestamps before invoking detailed transcript stat queries.
   - Convert `initializeBaselineCandidates` to `initializeBaselineCandidatesAsync` using async I/O.
2. Create verification test `src/test/phase03_brain_cache_bounded_polling.test.ts`.

## Files to Create/Modify
- `src/transcriptWatcher.ts` - Brain directory caching, cold candidate pruning, and async baseline initialization
- `src/test/phase03_brain_cache_bounded_polling.test.ts` - Single comprehensive verification test

## Test Criteria
- [x] Verification test proves subsequent polling cycles execute with 0 redundant disk `readdir`/`stat` calls when `brainDir` is unchanged.
- [x] Verification test verifies that creating a new conversation directory immediately invalidates root cache and discovers the new conversation.
- [x] High-volume candidate benchmark (100+ simulated historic conversations) discovers the active candidate in < 15ms.

---
Next Phase: [Phase 04: Native Process Spawn & Traversal Optimization](file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main/plans/260908-0936-audit-performance-remediation/phase-04-process-spawn-and-workbench-traversal-optimization.md)
