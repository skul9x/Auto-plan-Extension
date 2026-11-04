# Phase 01: Core Dispatcher & Configuration Refactoring

Status: ✅ Completed  
Test: `src/test/phase01_native_dispatcher_and_config.test.ts`

## Objective
Refactor the prompt dispatch engine and configuration schema to execute 100% via Antigravity IDE's official internal commands (`antigravity.startNewConversation`, `antigravity.addContext`, `antigravity.triggerSend`), deprecate legacy tier fallback mechanisms, and introduce configurable dispatch delays.

## Scope
- Configuration management in `src/config.ts`.
- Prompt dispatch engine in `src/promptDispatcher.ts`.
- Orchestrator execution loop alignment in `src/orchestrator.ts`.
- Diagnostic readiness reporting for native commands.

## Requirements
### Functional
- Add a configurable dispatch delay setting `autoplan.sendDelayMs` (numeric, default: 500 ms) to configuration schemas and reading utilities.
- Deprecate obsolete configuration keys (`executionMode`, `allowTierFallback`, `strictMode`, `bridgeTimeoutMs`) while providing safe default fallbacks for existing installations.
- Redesign `PromptDispatcher.dispatchPrompt` to execute a pure native pipeline:
  1. If a new conversation is requested (or at the start of a phase), execute `antigravity.startNewConversation` followed by a fixed 400 ms stabilization delay.
  2. Execute `antigravity.addContext` with the target prompt string.
  3. Wait for `sendDelayMs` (default: 500 ms) to ensure the chat UI enables the send state.
  4. Execute `antigravity.triggerSend` to fire the prompt.
- Refactor `validateDispatchReadiness` to verify availability and callable status of the native Antigravity commands rather than polling DOM bridge HTTP clients or checking external OS keyboard simulation binaries.
- Ensure orchestrator execution routines (`runPlanAsync`, `runLoop`, `executeNudgeProcedure`) cleanly pass dispatch requests to the refactored native dispatcher.

### Non-Functional
- **True Background Execution:** Dispatching prompts must never steal window focus, switch editor focus, or simulate OS keyboard strokes.
- **Graceful Error Handling:** If native command execution throws (e.g., in a non-Antigravity VS Code host), return structured failure diagnostics with clear actionable messages.

## Constraints
- Do not remove `keyboardManager.ts` from the repository; keep it decoupled and uncalled as a reference archive.
- Ensure no dependency on HTTP DOM bridge clients for standard prompt dispatch.
- Preserve backward-compatible dispatch return types (`DispatchResult`) expected by the orchestrator and Telegram mirror services.

## Dependencies
- Reference specification: `docs/BRIEF.md`.
- Files to modify:
  - `src/config.ts`
  - `src/promptDispatcher.ts`
  - `src/orchestrator.ts`

## Acceptance Criteria
- `PromptDispatcher.dispatchPrompt` dispatches prompts using sequential calls to `antigravity.addContext` and `antigravity.triggerSend` without calling DOM bridge HTTP endpoints or OS keyboard tools.
- When `newConversation: true` is provided, `antigravity.startNewConversation` is invoked first with a 400 ms stabilization pause.
- Configurable delay `sendDelayMs` is respected prior to calling `antigravity.triggerSend`.
- `validateDispatchReadiness` reports `ready: true` and identifies the engine as Native Antigravity Dispatch.
- Deprecated configuration properties read safely without runtime errors or crashes.

## Comprehensive File-Based Test
- **File**: `src/test/phase01_native_dispatcher_and_config.test.ts`
- **Scope**:
  - Tests `src/config.ts` loading and defaulting of `sendDelayMs`.
  - Mocks `vscode.commands.executeCommand` calls to record and assert the execution sequence: `startNewConversation` -> delay -> `addContext` -> `sendDelayMs` -> `triggerSend`.
  - Asserts that neither DOM bridge HTTP endpoints nor keyboard simulator binaries are invoked during dispatch.
  - Verifies readiness validation output structure and error handling when native commands fail.

