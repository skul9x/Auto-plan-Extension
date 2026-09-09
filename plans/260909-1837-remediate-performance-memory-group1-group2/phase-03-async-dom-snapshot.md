# Phase 03: Asynchronous DOM Snapshot Disk Writing (PERF-04)
Status: ✅ Completed
Dependencies: Phase 01, Phase 02

## Objective
Remediate PERF-04 (Event Loop Block) by replacing blocking synchronous directory and file writing (`fs.mkdirSync` and `fs.writeFileSync`) with non-blocking asynchronous file operations (`await fs.promises.mkdir` and `await fs.promises.writeFile`) in `saveWorkbenchSnapshot()` in `src/orchestrator.ts` when saving DOM snapshots (5MB–20MB), keeping the Extension Host main thread and UI responsive.

## Requirements
### Functional
- [x] In `src/orchestrator.ts`:
  - In `saveWorkbenchSnapshot(options)` (lines ~274–341):
    - Replace synchronous folder creation:
      ```typescript
      // From:
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      // To:
      await fs.promises.mkdir(targetDir, { recursive: true });
      ```
    - Replace synchronous file write:
      ```typescript
      // From:
      fs.writeFileSync(fullPath, res.html, 'utf8');
      // To:
      await fs.promises.writeFile(fullPath, res.html, 'utf8');
      ```
    - Preserve cancellation checks before and after async calls:
      ```typescript
      if (this.isAborted) {
        return undefined;
      }
      ```
    - Ensure errors during async directory creation or file writing are caught in the existing `try/catch (snapshotErr: any)` block, logged via `this.debugLogger.warn`, and cleanly return `undefined` without unhandled promise rejections.
    - Return `fullPath` on success.

### Non-Functional
- [x] Extension Host main thread event loop latency remains under 25ms even while persisting a 10MB+ DOM snapshot HTML string to disk.
- [x] Status bar updates, background timers, and IPC message processing continue executing smoothly without blocking freezes.
- [x] Fully backward compatible with existing snapshot pipeline callers and tests (e.g., `phase02_config_and_global_snapshot_storage.test.ts` and `phase03_orchestrator_snapshot_pipeline_e2e.test.ts`).

## Implementation Steps
1. Update `saveWorkbenchSnapshot` in `src/orchestrator.ts` to use `await fs.promises.mkdir` and `await fs.promises.writeFile`.
2. Verify cancellation and error logging pathways.
3. Run `npm run compile` to verify zero TypeScript compilation diagnostics.
4. Create single verification test `src/test/phase03_async_dom_snapshot.test.ts`:
   - Mocks `BridgeServer.captureDomSnapshot()` returning a large synthetic HTML payload (10MB).
   - Monitors event loop responsiveness using a high-frequency interval timer (every 2ms) during snapshot writing.
   - Asserts that no timer tick experiences blocking delays (> 30ms).
   - Verifies the snapshot file is persisted accurately on disk with exact byte match.
   - Verifies that aborted or failing writes return `undefined` cleanly without uncaught rejections.

## Files to Create/Modify
- `src/orchestrator.ts` - Convert synchronous directory creation and file writing to asynchronous `fs.promises`
- `src/test/phase03_async_dom_snapshot.test.ts` - Comprehensive single verification test

## Test Criteria
- [x] `npm run compile && node out/test/phase03_async_dom_snapshot.test.js` passes with code 0 (100% assertions verified).

---
Next Phase: [Phase 04: Concurrent Directory Stat Scanning](./phase-04-concurrent-directory-stat.md)
