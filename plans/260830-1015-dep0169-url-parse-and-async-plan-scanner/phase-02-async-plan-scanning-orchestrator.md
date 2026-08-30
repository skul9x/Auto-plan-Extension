# Phase 02: Async Plan Scanning in Orchestrator & Extension Workflows

Status: ✅ Completed  
Dependencies: Phase 01  
Target Files:
- `src/planScanner.ts`
- `src/orchestrator.ts`
- `src/extension.ts`
- `src/test/phase02_async_orchestrator_scanner.test.ts`

---

## 1. Objective

Eliminate synchronous blocking filesystem I/O across asynchronous execution and discovery paths by migrating `orchestrator.startPlanFolder` and `extension.ts` command workflows to `scanPlanFolderAsync`. Annotate legacy synchronous methods in `planScanner.ts` with `@deprecated` while preserving full backward compatibility for existing sync tests.

---

## 2. Technical Requirements

1. **Migrate `orchestrator.startPlanFolder` (`src/orchestrator.ts`):**
   - Replace `const phaseFiles = scanPlanFolder(folderPath);` with `const phaseFiles = await scanPlanFolderAsync(folderPath);`.
   - Ensure errors thrown when no phase markdown files are found continue to be propagated cleanly.
2. **Optimize Asynchronous Command Handlers (`src/extension.ts`):**
   - Update `selectPlanFolder(context)` to use `await discoverWorkspacePlanFoldersAsync()` and `await scanPlanFolderAsync(folderPath)`.
   - Update `findActivePlanFolderAsync` or callers in async flows to prefer asynchronous scanning.
3. **Deprecation Annotations (`src/planScanner.ts`):**
   - Add `@deprecated` JSDoc tags to `scanPlanFolder` and synchronous `auditPlanPhases` recommending `scanPlanFolderAsync` and `auditPlanPhasesAsync`.
   - Keep the implementation intact for backward compatibility with legacy test suites.

---

## 3. Automated File-Based Test (`src/test/phase02_async_orchestrator_scanner.test.ts`)

Create a comprehensive standalone test that:
1. Creates a temporary workspace directory containing multiple phase markdown files (`phase-01.md`, `phase-02.md`, `phase-03.md`) with various completion statuses.
2. Calls `orchestrator.startPlanFolder(tempDir, ...)` (with simulated dispatcher) and verifies:
   - Phase files are resolved asynchronously without blocking the event loop.
   - Phases are accurately indexed and sorted.
   - Initial state transitions to `'running'`.
3. Verifies that `scanPlanFolderAsync` output exactly matches `scanPlanFolder` metadata (normalization, sorting, completion detection).
4. Cleans up temporary files.

---

## 4. Verification Plan

```bash
npx tsc && node out/test/phase02_async_orchestrator_scanner.test.js
```

---
Next Phase: [phase-03-e2e-regression-verification.md](./phase-03-e2e-regression-verification.md)
