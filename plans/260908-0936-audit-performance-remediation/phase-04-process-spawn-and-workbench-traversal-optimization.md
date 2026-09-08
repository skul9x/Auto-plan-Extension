# Phase 04: Native Process Spawn & Traversal Optimization
Status: ✅ Completed
Dependencies: Phase 03

## Objective
Eliminate latency, CPU spikes, and Extension Host event loop stalls caused by synchronous process spawning (`execSync`), repetitive Windows PowerShell C# JIT compilation, and unbounded depth-6 directory walks for workbench HTML files.

## Requirements
### Functional
- [x] In `src/keyboardManager.ts`:
  - Memoize `checkLinuxKeyboardPrerequisites`: Cache the outcome of `which xdotool` so subsequent readiness checks return immediately without spawning child processes. Provide a `forceRefresh?: boolean` option for testing and re-configuration.
  - Refactor `inspectLinuxActiveWindow` to be fully asynchronous and unified:
    - Replace 4 consecutive synchronous `execSync` invocations with a single asynchronous shell command pipeline (`execAsync`) combining `xdotool getactivewindow`, `getwindowname`, `getwindowpid`, and `ps -p`.
    - Fallback to asynchronous `xprop` execution if `xdotool` is absent.
  - Optimize Windows `inspectWindowsActiveWindow`:
    - Eliminate repetitive Roslyn JIT compilation (`Add-Type`) on every call by implementing a short-lived memoization cache (e.g. 500ms TTL) or an optimized lightweight query script.
- [x] In `src/workbenchInjector.ts`:
  - Expand static candidate path list in `getWorkbenchPath()` to cover standard layouts for Antigravity, VS Code, Cursor, Windsurf, and Trae.
  - Constrain `findFileRecursive`:
    - Reduce `maxDepth` from 6 down to 3.
    - Ignore non-target subdirectories (`node_modules`, `languages`, `extensions`, `test`, `media`, `static`) to avoid scanning tens of thousands of compiled files in the `out/` directory.

### Non-Functional
- [x] Prerequisite check execution latency drops from ~30ms down to < 1ms on cached invocations.
- [x] Active window inspection on Linux runs in < 25ms total without stalling the Node.js event loop.
- [x] Workbench path resolution resolves in < 5ms for standard installations without scanning deep directory trees.

## Implementation Steps
1. Modify `src/keyboardManager.ts`:
   - Add module-level memoization for `checkLinuxKeyboardPrerequisites` with optional `forceRefresh`.
   - Refactor `inspectLinuxActiveWindow` to execute a combined async shell query via `execAsync`.
   - Add result caching or optimized execution for `inspectWindowsActiveWindow`.
2. Modify `src/workbenchInjector.ts`:
   - Add directory pruning and reduced maxDepth in `findFileRecursive`.
   - Expand static candidate paths in `getWorkbenchPath`.
3. Create verification test `src/test/phase04_process_and_traversal_optimization.test.ts`.

## Files to Create/Modify
- `src/keyboardManager.ts` - Prerequisite memoization, single-shot async window inspection, and Windows call optimization
- `src/workbenchInjector.ts` - Bounded, pruned workbench discovery and expanded candidate whitelist
- `src/test/phase04_process_and_traversal_optimization.test.ts` - Single comprehensive verification test

## Test Criteria
- [x] Verification test asserts `checkLinuxKeyboardPrerequisites` returns cached status without spawning `which xdotool`.
- [x] Verification test asserts `inspectLinuxActiveWindow` executes asynchronously and parses combined output correctly.
- [x] Verification test verifies that `findFileRecursive` prunes blacklisted directories and obeys the constrained depth limit.

---
Plan Complete!
