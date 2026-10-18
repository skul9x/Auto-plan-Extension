# Phase 02: Plan Folder Discovery & Execution Selector

Status: ✅ Completed
Dependencies: phase-01-core-telegram-bridge-and-lifecycle.md

## Objective
Implement an interactive plan discovery and execution selection engine over Telegram. When triggered via `/plans` or `/plan_start`, the bot scans the workspace for plan folders containing uncompleted phases, renders them as interactive Telegram Inline Keyboards, and allows the user to choose between: (1) Running all phases, (2) Running only uncompleted phases, or (3) Manually choosing individual phases.

## Requirements
### Functional
- [x] Implement `discoverPlanFolders()` in `src/telegramPlanManager.ts` (leveraging `src/planScanner.ts`):
  - Traverses the workspace root, `plans/` directory, and configured `defaultPlanFolder`.
  - Discovers directories containing `phase-*.md` files.
  - Checks phase completion status (using `detectPhaseStatus`) to determine which folders contain uncompleted phases.
- [x] Implement Telegram Interactive Folder Picker (`/plans` and `/plan_start`):
  - If a `.md` plan file is already active in the editor, offer to run it immediately or browse other plan folders.
  - If no `.md` file is active, display an inline keyboard listing available plan folders with pending phases:
    `[📁 plans/feature-auth (3/5 done)]`
    `[📁 plans/feature-payment (0/4 done)]`
- [x] Implement Execution Mode Selector Callback:
  - When the user selects a plan folder, display 3 execution mode buttons:
    - 🚀 `[Run All Phases]`
    - ⚡ `[Run Only Pending/Uncompleted Phases]`
    - 📋 `[Select Phases Manually]`
- [x] Implement Manual Phase Selection Flow:
  - Displays individual phase files with toggleable buttons:
    `[✅ phase-01-setup.md] [⬜ phase-02-api.md]`
  - Includes a `[▶️ Start Selected Phases]` confirmation button.
- [x] Wire selected phases directly into `orchestrator.startCustomExecution()` or `vscode.commands.executeCommand('autoplan.start')`.

### Non-Functional
- [x] Usability: Pagination for workspaces with more than 8 plan folders (Next/Prev buttons) to avoid oversized inline keyboards.
- [x] Feedback: Instant callback acknowledgment (`ctx.answerCallbackQuery()`) to eliminate loading spinners on the Telegram client.

## Files to Create/Modify
- `src/telegramPlanManager.ts` - Plan folder discovery, status aggregation, and inline keyboard builders.
- `src/planScanner.ts` - Expose multi-folder scanning utilities if needed.
- `src/telegramBridge.ts` - Register `/plans`, `/plan_start`, and callback query handlers for plan execution.
- `src/test/phase02_plan_discovery_selector.test.ts` - Comprehensive file-based test for Phase 02.

## Test Criteria
- Exactly one file-based test: `src/test/phase02_plan_discovery_selector.test.ts`.
- [x] Verifies scanning and identification of plan folders with pending phases vs fully completed folders.
- [x] Verifies generation of inline keyboard buttons for plan folder selection.
- [x] Verifies handling of the 3 execution options (Run All, Run Uncompleted, Manual Selection).
- [x] Verifies that manual selection accurately aggregates chosen phase files and triggers orchestrator start.

---
Next Phase: phase-03-free-chat-session-and-message-chunking.md
