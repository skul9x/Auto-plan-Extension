# Plan: Fix Truncated Transcript Ownership Verification, Duplicate Retry Loops & Native Chat Stop Discovery

**Repository:** `/home/skul9x/Desktop/Code/Auto-plan-Extension-main`  
**Date:** 2026-11-25  
**Source Diagnostic Report:** `/home/skul9x/Desktop/Code/Auto-plan-Extension-main/log.txt`

---

## 1. Verified Root Causes from Diagnostic Trace (`log.txt`)

1. **Critical Bug — False Foreign Conversation Rejection on Long Prompts (`src/transcriptWatcher.ts`, `src/orchestrator.ts`):**
   - When dispatching a large custom `promptTemplate` (e.g., 6,356 chars JSON prompt where `{xxx}` sits mid-payload), Antigravity IDE compacts `step_index: 0` inside `transcript.jsonl`, truncating the middle of `"content"` and adding `"truncated_fields":["content"]` (`First line byte length: 4394`).
   - Meanwhile, `verifyConversationOwnershipAsync` in `src/transcriptWatcher.ts` only inspects the first `8,192` bytes of `transcript.jsonl`. Because `phase-03-webview-pacs-url-guard-and-diagnostics.md` was stripped from line 0 and does not reappear until later steps (`byte offset 13,971`), `expectedPromptSnippet` check evaluates to `false`.
   - Prior phases only passed accidentally when their `.md` file happened to be the active editor tab in `<ADDITIONAL_METADATA>`. Whenever the phase file is not the active editor tab, `TranscriptWatcher` emits `candidateSkipped`, hits `NewConversationTimeoutError` after `8000ms`, and retries 1..5 times—spawning duplicate parallel AI conversations (`83fd8d56...`, `8169fba6...`, `32961cc0...`).
2. **Secondary Issue — Obsolete DOM Snapshot Warning Spam (`src/orchestrator.ts`):**
   - `saveWorkbenchSnapshot` emits `[WARN] Failed to capture DOM snapshot: No active connected DOM bridge clients found` on every phase start/retry even when operating purely on `Native Antigravity Chat API (Focus-Free)` with 0 DOM bridge clients.
3. **Minor Defect — Unregistered Stop Command Failure (`src/promptDispatcher.ts`):**
   - `stopActiveGeneration` attempts `antigravity.prioritized.chat.stop` then unconditionally falls back to `workbench.action.chat.stop`, which throws `command 'workbench.action.chat.stop' not found` in Antigravity IDE `1.107.0`.

---

## 2. Architecture & Existing Test Contracts to Preserve

- **`src/test/phase02_transcript_conversation_ownership.test.ts`:** Untruncated alien prompts in `transcript.jsonl` (without `truncated_fields`) MUST still be rejected (`verifyConversationOwnershipAsync === false`).
- **`src/test/phase01_native_dispatcher_and_config.test.ts` & `src/test/phase04_native_chat_regression_and_packaging.test.ts`:** Pure unit-test mocks injecting `commandExecutor` (without mocking `vscode.commands.getCommands`) must still observe `antigravity.prioritized.chat.stop` attempted in `stopActiveGeneration()`.
- **Standalone Node Test Runner Convention:** Every new phase test must be a self-executing TypeScript test under `src/test/` compiled via `npm run compile` (`tsc -p ./`) into `out/test/` and registered cleanly in `package.json` `"scripts"`.

---

## 3. Phased Implementation Roadmap

| Phase | File | Focus | Comprehensive Test File | Depends On |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | [phase-01-truncated-transcript-ownership-fallback.md](./phase-01-truncated-transcript-ownership-fallback.md) | Sibling `transcript_full.jsonl` fallback on `truncated_fields`, expanded JSONL read bounds, prompt head/tail structural fallback, and cache-stamp accuracy | `src/test/phase01_truncated_transcript_ownership_fallback.test.ts` | None |
| **Phase 2** | [phase-02-orchestrator-duplicate-retry-and-snapshot-hygiene.md](./phase-02-orchestrator-duplicate-retry-and-snapshot-hygiene.md) | Orchestrator `expectedPromptHead` / `expectedPromptTail` extraction, duplicate-conversation retry guard, and Native-tier DOM snapshot warning suppression | `src/test/phase02_orchestrator_duplicate_retry_and_snapshot_hygiene.test.ts` | Phase 1 |
| **Phase 3** | [phase-03-native-chat-stop-command-discovery-and-packaging.md](./phase-03-native-chat-stop-command-discovery-and-packaging.md) | Runtime command discovery via `vscode.commands.getCommands(true)` for `stopActiveGeneration`, fallback probing, and VSIX/script manifest registration | `src/test/phase03_native_chat_stop_command_discovery.test.ts` | Phases 1 & 2 |
| **Phase 4** | [phase-04-default-json-prompt-template.md](./phase-04-default-json-prompt-template.md) | Update `DEFAULT_PROMPT_TEMPLATE`, `autoplan.defaultPromptTemplate`, and `autoplan.promptTemplate` defaults to the 7-step structured JSON prompt | `src/test/phase04_default_json_prompt_template.test.ts` | Phases 1 & 2 |
