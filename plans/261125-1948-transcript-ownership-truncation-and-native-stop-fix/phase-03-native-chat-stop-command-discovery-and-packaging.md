# Phase 3: Native Chat Stop Command Discovery & Release Verification

**Status:** Completed ✅

## 1. Objective
Eliminate `[WARN] [DISPATCHER] stopActiveGeneration failed: command 'workbench.action.chat.stop' not found` when stopping execution in Antigravity IDE (`1.107.0+`), register all new regression test scripts cleanly in `package.json`, and validate full compilation & test readiness for VSIX packaging.

---

## 2. Scope
- **Native Stop Command Discovery & Execution** (`src/promptDispatcher.ts`: `PromptDispatcherOptions`, `stopActiveGeneration`, constructor defaults)
- **Diagnostic Log / Command Script Registration** (`package.json` `"scripts"` for Phase 1–3 tests)

---

## 3. Requirements
1. **Runtime Stop Command Discovery (`PromptDispatcher`):**
   - Inject an optional `commandListProvider?: () => Promise<string[]>` into `PromptDispatcherOptions` (defaulting to `() => Promise.resolve(vscode.commands.getCommands(true))` when `vscode.commands?.getCommands` is available).
   - Define ordered stop command priority candidates:
     1. `'antigravity.prioritized.chat.stop'`
     2. `'antigravity.chat.stop'`
     3. `'antigravity.agent.stop'`
     4. `'antigravity.cancelGeneration'`
     5. `'workbench.action.chat.stop'`
     6. `'workbench.action.chat.cancel'`
     plus dynamic fallback search among registered commands matching `/^(antigravity|workbench\.action\.chat)\..*(stop|cancel|abort)/i`.
   - When `commandListProvider` returns registered commands:
     - Only invoke candidates confirmed to exist in the returned command set (avoiding `command '...' not found` exceptions).
     - If NONE of the stop/cancel commands exist in the current IDE build (e.g. headless/Antigravity versions exposing no public stop command), log cleanly at `DEBUG`/`INFO` (`No registered chat stop command available in host IDE; aborting orchestration loop locally`) and return `false` WITHOUT emitting a spurious `[WARN] stopActiveGeneration failed` stack/error.
   - **Backward Compatibility for Unit Mocks:** When `commandListProvider` is omitted AND `vscode.commands?.getCommands` is unavailable (pure unit tests mocking `commandExecutor` only), preserve legacy direct invocation of `'antigravity.prioritized.chat.stop'` -> `'workbench.action.chat.stop'` so existing unit suites continue passing identically.
2. **Short-TTL Command List Caching:**
   - Avoid invoking `vscode.commands.getCommands(true)` excessively inside rapid nudges/retries by caching the discovered candidate command briefly (e.g., 30s TTL) or resolving lazily per stop attempt, and invalidating if `executeCommand` unexpectedly throws not-found.
3. **Test Script Registration (`package.json`):**
   - Add npm test scripts for `phase01_truncated_transcript_ownership_fallback`, `phase02_orchestrator_duplicate_retry_and_snapshot_hygiene`, and `phase03_native_chat_stop_command_discovery` plus a combined `test:log-fix-regression` shortcut script in `package.json`.

---

## 4. How to Implement
1. **Update `src/promptDispatcher.ts`:**
   - Extend `PromptDispatcherOptions`:
     ```ts
     commandListProvider?: () => Promise<string[]>;
     ```
   - In `PromptDispatcher` constructor, wire `this.commandListProvider = options.commandListProvider;` (falling back at runtime to `vscode.commands?.getCommands ? async () => vscode.commands.getCommands(true) : undefined`).
   - Add private helper `resolveAvailableStopCommands(): Promise<string[] | null>`:
     - Returns `null` when no `commandListProvider` is available (legacy direct-execution mode for pure mocks).
     - Otherwise fetches commands via `commandListProvider()`, filters ordered priority list `STATIC_STOP_CANDIDATES`, and appends any remaining registered commands matching `/^(antigravity|workbench\.action\.chat)\..*(stop|cancel|abort)/i` (deduplicated while keeping exact ordered priority).
   - Update `stopActiveGeneration()` (`src/promptDispatcher.ts:1292-1307`):
     - If `availableCommands === null`: keep trying `'antigravity.prioritized.chat.stop'`, then `'workbench.action.chat.stop'`.
     - If `availableCommands.length === 0`: log `this.logger.info('DISPATCHER', 'No host chat stop command registered in Antigravity IDE; local orchestration stopped cleanly')` and return `false`.
     - Otherwise iterate through `availableCommands` in priority order, returning `true` on the first `await this.commandExecutor(cmd)` that succeeds without error; if all fail with real execution errors, log concise warning and return `false`.
2. **Update `package.json`:**
   - Add scripts:
     - `"test:phase01-truncation"`: `"node out/test/phase01_truncated_transcript_ownership_fallback.test.js"`
     - `"test:phase02-retry-hygiene"`: `"node out/test/phase02_orchestrator_duplicate_retry_and_snapshot_hygiene.test.js"`
     - `"test:phase03-stop-discovery"`: `"node out/test/phase03_native_chat_stop_command_discovery.test.js"`
     - `"test:fix-ownership-stop"`: `"npm run compile && npm run test:phase01-truncation && npm run test:phase02-retry-hygiene && npm run test:phase03-stop-discovery"`
   - Increment `"version"` (e.g., `"1.7.6"`) at implementation/release time before packaging `.vsix` via `npm run package` and `antigravity-ide --install-extension`.

---

## 5. Files to Create/Modify
- **Modify:**
  - `src/promptDispatcher.ts`
  - `package.json`
- **Create (Test only):**
  - `src/test/phase03_native_chat_stop_command_discovery.test.ts`

---

## 6. Dependencies
- **Phases 1 & 2:** Completes the full log-remediation series prior to compiling, running the regression suite, and packaging an updated `.vsix`.

---

## 7. Constraints
- MUST preserve `src/test/phase01_native_dispatcher_and_config.test.ts` (mock `commandExecutor` without `commandListProvider`) and `src/test/phase04_native_chat_regression_and_packaging.test.ts`.
- Do NOT execute `vscode.commands.getCommands()` in tight polling loops; only resolve lazily on `stopActiveGeneration` calls.
- Do NOT alter `antigravity.startNewConversation`, `antigravity.addContext`, or `antigravity.triggerSend` dispatch ordering or stabilization delays.

---

## 8. Acceptance Criteria
1. When host IDE registers only an alternate command (e.g., `antigravity.agent.stop` or `workbench.action.chat.cancel`), `stopActiveGeneration` executes that registered command without first failing on nonexistent commands.
2. When host Antigravity IDE (`1.107.0`) registers zero matching stop commands, `stopActiveGeneration` returns `false` gracefully with zero `[WARN] ... command 'workbench.action.chat.stop' not found` errors.
3. When run under legacy unit mocks without `commandListProvider`, `stopActiveGeneration` still invokes `antigravity.prioritized.chat.stop`.
4. `npm run compile` succeeds cleanly and all three new phase tests plus existing `phase01_native`, `phase02_transcript_conversation_ownership`, and `phase04_native` pass prior to `.vsix` packaging.

---

## 9. Comprehensive File-Based Test
- **Test File:** `src/test/phase03_native_chat_stop_command_discovery.test.ts`
- **Framework:** Standalone Node TypeScript (`assert` + mock `PromptDispatcher`) compiled via `npm run compile` and executed via `node out/test/phase03_native_chat_stop_command_discovery.test.js`
- **Test Scenarios Covered in One File:**
  1. **Dynamic Candidate Selection When Primary Commands Missing:** Supplies `commandListProvider` returning `['antigravity.agent.stop', 'workbench.action.chat.cancel']` (omitting `antigravity.prioritized.chat.stop` & `workbench.action.chat.stop`); verifies `stopActiveGeneration()` returns `true` and executes `'antigravity.agent.stop'` immediately with zero failed `executeCommand` calls.
  2. **Zero Registered Stop Commands Graceful No-Warn Handling:** Supplies `commandListProvider` returning unrelated editor commands only (`['workbench.action.files.save']`); asserts `stopActiveGeneration()` returns `false`, calls `commandExecutor` `0` times, and emits zero `'WARN'` logs.
  3. **Command Priority + Fallback on Registered Execution Failure:** Supplies `['antigravity.prioritized.chat.stop', 'workbench.action.chat.cancel']` where first command rejects; verifies fallback immediately runs `'workbench.action.chat.cancel'` and returns `true`.
  4. **Legacy Unit-Mock Compatibility (No `commandListProvider`):** Instantiates `PromptDispatcher` with only `commandExecutor` and no `getCommands`; verifies `'antigravity.prioritized.chat.stop'` is invoked directly.
