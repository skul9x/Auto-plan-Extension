# Phase 02: Transcript Ownership Stat & Content Cache (PERF-02)
Status: ✅ Completed
Dependencies: Phase 01

## Objective
Remediate the Disk I/O Storm in `src/transcriptWatcher.ts` during candidate conversation polling by introducing an in-memory memoization cache for conversation ownership verification, eliminating redundant file handles, chunk reads, and JSON parsing when transcript files are unmutated.

## Requirements
### Functional
- [x] In `src/transcriptWatcher.ts`:
  - Introduce `ConversationOwnershipCache` data structure:
    - Composite cache key: `${transcriptPath}::${criteriaKey}` where:
      ```typescript
      const criteriaKey = `${criteria?.expectedPromptSnippet || ''}::${criteria?.workspacePath || ''}::${criteria?.workspaceName || ''}`;
      ```
    - Cached entry structure:
      ```typescript
      interface CachedOwnershipEntry {
        mtimeMs: number;
        size: number;
        isOwner: boolean;
        checkedAt: number;
      }
      ```
    - Implement LRU bounding (maximum 500 entries) to prevent unbounded memory growth:
      - On cache hit: re-insert key to maintain LRU recency (`cache.delete(key); cache.set(key, entry);`).
      - On insertion exceeding cap: evict oldest entry (`cache.delete(cache.keys().next().value)`).
  - In `verifyConversationOwnershipAsync(transcriptPath: string, criteria: ConversationOwnershipCriteria, statHint?: { mtimeMs: number; size: number })`:
    - Early return `true` if criteria is blank.
    - Resolve current `mtimeMs` and `size`:
      - If `statHint` is provided, use `statHint.mtimeMs` and `statHint.size`.
      - If `statHint` is omitted, query `await fs.promises.stat(transcriptPath)` inside a `try/catch` block (return `false` if file does not exist or stat fails).
    - If `size === 0`, return `false`.
    - Check cache: if entry exists and `cached.mtimeMs === mtimeMs && cached.size === size`, return `cached.isOwner` immediately (O(1), zero disk I/O, zero JSON parsing).
    - If cache miss or modified:
      - Read first 8KB chunk with safe handle management:
        ```typescript
        let fileHandle: fs.promises.FileHandle | null = null;
        try {
          fileHandle = await fs.promises.open(transcriptPath, 'r');
          // read 8KB buffer & evaluate ownership...
        } finally {
          if (fileHandle) {
            try { await fileHandle.close(); } catch {}
          }
        }
        ```
      - Store result in cache: `cache.set(key, { mtimeMs, size, isOwner, checkedAt: Date.now() })`.
      - Return `isOwner`.
  - In `waitForNewConversation`:
    - Pass available stat hints at call sites:
      - Line ~434: pass `{ mtimeMs: tMtime, size: tSize }`.
      - Line ~489: pass `{ mtimeMs: transcriptMtime, size: transcriptSize }`.
  - Provide public/exported helpers for testing and telemetry:
    - `clearConversationOwnershipCache(): void`
    - `getConversationOwnershipCacheStats(): { size: number; hits: number; misses: number }`

### Non-Functional
- [x] Over a 10-second polling window (100 ticks) with 5 static candidate transcripts, total disk reads drop from 500+ reads to exactly 5 reads (99% reduction).
- [x] Modifying any transcript file (altering `mtimeMs` or `size`) immediately invalidates its cached entry and triggers a re-read.
- [x] Fully backward compatible with callers that do not supply `statHint` (e.g. existing tests in `phase02_transcript_conversation_ownership.test.ts`).

## Implementation Steps
1. Implement LRU `ConversationOwnershipCache` and stats tracking in `src/transcriptWatcher.ts`.
2. Update `verifyConversationOwnershipAsync` to support `statHint?: { mtimeMs: number; size: number }` and check the cache before opening file descriptors.
3. Update call sites in `waitForNewConversation` to pass `{ mtimeMs, size }` stat hints.
4. Export `clearConversationOwnershipCache` and `getConversationOwnershipCacheStats`.
5. Run `npm run compile` to verify clean build.
6. Create single comprehensive verification test `src/test/phase02_transcript_ownership_cache.test.ts`:
   - Simulates candidate polling across 100 ticks with 5 candidate transcript files.
   - Asserts that disk reads occur exactly 5 times on tick 1, and 0 times on ticks 2..100 (495 cache hits).
   - Updates content and mtime on 1 file; verifies that only that 1 file triggers a re-read on the next tick.
   - Verifies 0-byte file handling and LRU cache eviction when cache capacity is exceeded.

## Files to Create/Modify
- `src/transcriptWatcher.ts` - Implement memoization cache, stat hint propagation, and cache lifecycle functions
- `src/test/phase02_transcript_ownership_cache.test.ts` - Comprehensive single verification test

## Test Criteria
- [x] `npm run compile && node out/test/phase02_transcript_ownership_cache.test.js` passes with code 0 (100% assertions verified).

---
Next Phase: [Phase 03: Asynchronous DOM Snapshot Disk Writing](./phase-03-async-dom-snapshot.md)
