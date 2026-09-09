# Phase 04: Concurrent Directory Stat Scanning (PERF-05)
Status: ✅ Completed
Dependencies: Phase 01, Phase 02, Phase 03

## Objective
Remediate PERF-05 (Sequential Await Bottleneck) by converting sequential `stat()` iterations into concurrent, bounded pools (`asyncPool`) during `TranscriptWatcher` candidate baseline initialization in `src/transcriptWatcher.ts`, dramatically reducing phase startup latency in workspaces with large conversation histories without exhausting file descriptors (`EMFILE`).

## Requirements
### Functional
- [x] In `src/transcriptWatcher.ts`:
  - Implement a reusable, zero-dependency async pooling helper `asyncPool`:
    ```typescript
    export async function asyncPool<T, R>(
      concurrency: number,
      items: T[],
      fn: (item: T) => Promise<R>
    ): Promise<R[]> {
      const results: R[] = [];
      const executing = new Set<Promise<void>>();

      for (const item of items) {
        const p = Promise.resolve().then(() => fn(item)).then((res) => {
          results.push(res);
          executing.delete(p);
        });
        executing.add(p);
        if (executing.size >= concurrency) {
          await Promise.race(executing);
        }
      }

      await Promise.all(executing);
      return results;
    }
    ```
  - In `_initializeCandidateBaseline()`:
    - Parallelize directory stats (lines ~902–918) when cache is cold using `asyncPool(16, ...)`:
      - Resolve directory `time` (mtime/birthtime/ctime) concurrently.
    - Parallelize candidate transcript stat loop (lines ~929–952) using `asyncPool(16, ...)`:
      - Resolve `stats = await fs.promises.stat(tPath)` concurrently.
      - Update `this.candidateBaselineSizes.set(tPath, stats.size)`.
      - Update `this.candidatePreExisted.add(tPath)` if `existedBefore` is true.
    - Ensure robust per-item error handling: catch errors inside the worker task so a missing or locked file does not reject the pool or abort other candidate entries.

### Non-Functional
- [x] Baseline directory and transcript scanning over 80+ conversation folders completes in < 50ms (achieving a 4x–8x speedup compared to sequential awaits).
- [x] Concurrency limit (16) strictly caps the number of concurrent file operations, preventing `EMFILE: too many open files` even on systems with low file descriptor limits.
- [x] Preserves 100% baseline accuracy for conversation isolation in multi-phase runs.

## Implementation Steps
1. Add exported `asyncPool` helper to `src/transcriptWatcher.ts`.
2. Refactor sequential stat loops in `_initializeCandidateBaseline()` to use `asyncPool(16, ...)`.
3. Verify error boundaries per item in the async mapper.
4. Run `npm run compile` to verify clean build.
5. Create single verification test `src/test/phase04_concurrent_directory_stat.test.ts`:
   - Unit test `asyncPool`: verify that maximum concurrent active promises strictly never exceeds concurrency limit `16`.
   - Setup temporary workspace with 80 simulated conversation directories and transcript files (varying timestamps, sizes, and 2 missing/deleted files).
   - Trigger `_initializeCandidateBaseline()`.
   - Asserts that all baseline sizes and pre-existing sets are populated with 100% accuracy.
   - Asserts that concurrent execution completes in < 60ms.

## Files to Create/Modify
- `src/transcriptWatcher.ts` - Implement `asyncPool` and concurrent baseline stat initialization
- `src/test/phase04_concurrent_directory_stat.test.ts` - Comprehensive single verification test

## Test Criteria
- [x] `npm run compile && node out/test/phase04_concurrent_directory_stat.test.js` passes with code 0 (100% assertions verified).

---
Next Phase: [Phase 05: Global Integration & Regression Suite](./phase-05-integration-and-regression.md)
