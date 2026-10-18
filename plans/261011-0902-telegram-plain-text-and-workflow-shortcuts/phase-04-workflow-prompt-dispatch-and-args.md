# Phase 04: Command Argument Forwarding & Free-Form Workflow Prompt Dispatch

Status: ✅ Completed
Dependencies: phase-03-workflow-command-registration-and-mapping.md

## Objective
Enhance the incoming text dispatcher in `src/telegramBridge.ts` to seamlessly handle both standalone workflow commands and workflow commands containing trailing arguments (e.g., `/brainstorm make an expense tracker app`, `/code implement login controller`, `/save_brain notes`). Ensure commands are properly normalized, trailing arguments are preserved and forwarded intact to Antigravity IDE, and responses are streamed back to Telegram as clean plain text.

## Requirements
### Functional
- [x] Update `registerTextDispatcher` in `src/telegramBridge.ts`:
  - Detect incoming slash commands matching registered AWF workflows.
  - Distinguish internal bot administration commands (e.g., `/plans`, `/screen`) from workflow commands (`/brainstorm`, `/code`, `/save_brain`).
  - Normalize workflow command names using `normalizeTelegramWorkflowCommand` (`/save_brain` ➔ `/save-brain`).
  - Extract and preserve any trailing user input/arguments following the command name (e.g. `/brainstorm my project idea` ➔ dispatched as `/brainstorm my project idea`).
  - If a user sends a standalone workflow command (e.g., `/recap`, `/audit`), forward `/recap` or `/audit` directly into the IDE to trigger the respective workflow discovery/interview mode.
- [x] Connect the prompt execution pipeline:
  - Dispatch the normalized workflow prompt through `promptDispatcher.dispatchPrompt`.
  - Maintain conversation continuity (`openNewConversation: false`).
  - Stream the resulting AI answer from transcript back to Telegram as plain text via `awaitAndReplyModelResponse`.

### Non-Functional
- [x] Latency: Prompt normalization and dispatch overhead must be < 2ms.
- [x] Robustness: Handle tricky argument patterns (multiple spaces, multi-line inputs, non-ASCII characters, quotes) without truncation or corrupting the command header.

## Implementation Steps
1. Refactor command filtering and normalization in `registerTextDispatcher`.
2. Extract command arguments cleanly with regex parsing.
3. Wire normalized prompts directly into `promptDispatcher.dispatchPrompt`.
4. Create and run standalone test `src/test/phase04_workflow_prompt_dispatch_and_args.test.ts`.

## Files to Create/Modify
- `src/telegramBridge.ts` - Refactor text dispatcher for workflow recognition, argument extraction, and normalization.
- `src/test/phase04_workflow_prompt_dispatch_and_args.test.ts` - Comprehensive single-file test for Phase 04.

## Test Criteria
- Exactly one file-based test: `src/test/phase04_workflow_prompt_dispatch_and_args.test.ts`.
- [x] Verifies `/brainstorm build a note app` is normalized and dispatched to IDE as `/brainstorm build a note app`.
- [x] Verifies `/save_brain custom note` is normalized and dispatched as `/save-brain custom note`.
- [x] Verifies standalone `/recap` without arguments is forwarded cleanly as `/recap`.
- [x] Verifies internal commands (`/plans`, `/screen`) continue to trigger their internal handlers and are not dispatched as raw prompts.

---
Next Phase: phase-05-e2e-integration-and-release-packaging.md
