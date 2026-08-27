# Phase 04: Orchestrator Integration, UX Caching & E2E Verification
Status: ✅ Completed
Dependencies: phase-03-stream-chunking-listener-leak-prevention.md

## Objective
Integrate all optimized subsystems into the core execution pipeline in `src/orchestrator.ts` and `src/extension.ts`. Wire `Orchestrator` to execute prompts using the new single-batch keyboard runner and asynchronous conversation watcher. Implement audit suggestions (Status Bar tooltip throttling and `plans/` discovery caching). Perform comprehensive End-to-End verification and packaging checks.

## Requirements
### Functional
- [x] **Orchestrator Pipeline Integration**:
  - Update `Orchestrator.runPhaseSequence` to utilize `keyboardManager.executeBatchPromptFlow(renderedPrompt)` instead of sequential multi-process calls.
  - Integrate non-blocking async conversation discovery (`transcriptWatcher.waitForNewConversation`).
- [x] **Status Bar Tooltip Render Throttling (Audit Suggestion 6)**:
  - Refactor `startElapsedTimer` in `src/extension.ts` to cache previously rendered tooltip values.
  - Only instantiate and assign a new `vscode.MarkdownString` when the elapsed second, phase index, or status message actually changes.
- [x] **Plan Folder Discovery Caching (Audit Suggestion 7)**:
  - Add a short-lived in-memory cache (e.g. 5-second TTL) or file watcher on `plans/` directory to prevent redundant disk traversal during quick repeated QuickPick opens.
- [x] **Disposable Lifecycle Registration**:
  - Register `orchestrator`, `transcriptWatcher`, and status bar items into `context.subscriptions` in `extension.ts` to ensure clean shutdown when deactivating the extension.
- [x] **Full Build & Package Verification**:
  - Ensure `npm run compile` completes with 0 TypeScript errors.
  - Verify extension packaging readiness with `@vscode/vsce`.

### Non-Functional
- [x] **End-to-End Performance**: Execution of multi-phase plans achieves < 1-3% CPU overhead on idle/waiting and zero memory leaks.
- [x] **Robustness**: 100% test pass rate across all new and existing test suites.

## Files to Create/Modify
- `src/orchestrator.ts` - Integrate batch prompt flow and async watcher.
- `src/extension.ts` - Implement tooltip throttling, plans cache, and disposable registration.
- `src/test/phase04_audit_e2e_verification.test.ts` - Comprehensive single test file for Phase 04.

## Test Criteria
- [x] Exactly one file-based test: `src/test/phase04_audit_e2e_verification.test.ts`.
- [x] Verifies full end-to-end multi-phase simulation: executes 3 consecutive simulated phases with batch prompt execution, non-blocking transcript watching, and debounced completion.
- [x] Verifies status bar tooltip throttling: validates that redundant renders within the same second are avoided.
- [x] Verifies plan discovery cache hit behavior on repeated calls.
- [x] Verifies clean stop and teardown without lingering timeouts or process handles.

---
All Phases Completed.
