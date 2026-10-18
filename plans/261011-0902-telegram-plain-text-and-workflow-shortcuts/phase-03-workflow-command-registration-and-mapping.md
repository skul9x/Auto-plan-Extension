# Phase 03: Workflow Slash Command Registration (`setMyCommands`) & Mapping

Status: ✅ Completed
Dependencies: phase-02-telegram-plain-text-delivery.md

## Objective
Implement dynamic registration of all Antigravity IDE workflows and bot management commands using the Telegram Bot API `setMyCommands` method. Standardize command identifiers to strictly comply with Telegram's regex constraint (`^[a-z0-9_]{1,32}$`) by mapping hyphens to underscores, attach intuitive Vietnamese descriptions with icons, and provide bidirectional normalization between Telegram command identifiers and Antigravity IDE workflow commands.

## Requirements
### Functional
- [x] Define the complete Antigravity IDE workflow command catalog in `src/telegramBridge.ts`:
  - Core Workflows: `init`, `brainstorm`, `plan`, `design`, `visualize`, `code`, `run`, `debug`, `test`, `audit`, `deploy`, `next`, `recap`, `help`, `review`, `refactor`, `customize`, `rollback`.
  - Hyphenated Workflows mapped to underscores:
    - `/save_brain` ↔ `/save-brain`
    - `/awf_update` ↔ `/awf-update`
    - `/cloudflare_tunnel` ↔ `/cloudflare-tunnel`
  - Management Commands: `plans`, `plan_status`, `plan_skip`, `plan_stop`, `screen`, `new_chat`.
- [x] Implement `syncBotCommands(bot: Bot): Promise<boolean>`:
  - Call `bot.api.setMyCommands(...)` during bot startup / leader election.
  - Ensure total command count is strictly <= 100 (current list is ~27 commands).
  - Handle Telegram API network failures gracefully with retries/logging without halting the bot lifecycle.
- [x] Implement command normalization helpers:
  - `normalizeTelegramWorkflowCommand(cmd: string): string` to convert Telegram underscore aliases back to IDE hyphenated commands (`/save_brain` -> `/save-brain`).
  - `isWorkflowCommand(cmd: string): boolean` to distinguish workflow commands from internal bot administration commands.

### Non-Functional
- [x] Compliance: 100% adherence to Telegram Bot API naming restrictions (lowercase alphanumeric and underscore only, max 32 chars).
- [x] Usability: Pop-up autocomplete menu immediately reveals all workflows whenever the user types `/` or taps the Telegram command menu button.

## Implementation Steps
1. Define workflow commands catalog and descriptions in `src/telegramBridge.ts`.
2. Implement `normalizeTelegramWorkflowCommand` and `syncBotCommands` methods.
3. Call `syncBotCommands` during bot initialization after authentication setup.
4. Create and run standalone test `src/test/phase03_workflow_command_registration_and_mapping.test.ts`.

## Files to Create/Modify
- `src/telegramBridge.ts` - Implement workflow catalog, `setMyCommands` synchronization, and command normalization.
- `src/test/phase03_workflow_command_registration_and_mapping.test.ts` - Comprehensive single-file test for Phase 03.

## Test Criteria
- Exactly one file-based test: `src/test/phase03_workflow_command_registration_and_mapping.test.ts`.
- [x] Verifies all registered command names match Telegram API regex `^[a-z0-9_]{1,32}$` (no hyphens or uppercase letters).
- [x] Verifies `syncBotCommands` invokes `bot.api.setMyCommands` with expected command entries and descriptions.
- [x] Verifies bidirectional mapping: `/save_brain` converts to `/save-brain`, `/awf_update` to `/awf-update`.
- [x] Verifies graceful error recovery if `setMyCommands` fails or encounters network timeout.

---
Next Phase: phase-04-workflow-prompt-dispatch-and-args.md
