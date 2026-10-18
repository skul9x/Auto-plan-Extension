# Phase 01: Core Telegram Bridge & Lifecycle Engine

Status: ✅ Completed
Dependencies: None

## Objective
Establish the foundational Telegram Bot Bridge infrastructure inside `Auto-plan-Extension-main`. Implement the bot configuration schema, lifecycle activation/deactivation hooks, security whitelist authorization middleware, and a robust Multi-Window Leader Election mechanism utilizing `ag-autoplan-ports.json` to prevent Telegram polling conflict (`409 Conflict`) across multiple IDE windows.

## Requirements
### Functional
- [x] Add `grammy` (^1.21.0) dependency to `package.json`.
- [x] Define configuration properties in `package.json` and `src/config.ts`:
  - `autoplan.telegramEnabled`: boolean (default: `true`).
  - `autoplan.telegramBotToken`: string (default: `""`).
  - `autoplan.telegramAllowedUsers`: number[] or string[] (whitelist of authorized Telegram user IDs).
  - `autoplan.telegramThrottleMs`: number (default: `2500`).
- [x] Implement `TelegramBridge` in `src/telegramBridge.ts`:
  - Initializes `grammY` `Bot` instance when token is present and `telegramEnabled` is true.
  - Registers security whitelist middleware rejecting any message whose `ctx.from.id` is not in `autoplan.telegramAllowedUsers`.
  - Sends a secure denial message (`⛔ Unauthorized: Your Telegram ID {id} is not permitted.`) for unauthorized access attempts.
- [x] Implement Leader Election Guard:
  - Inspects `ag-autoplan-ports.json` (or designated lockfile) to determine if this extension window is the designated primary/leader instance.
  - If another window already holds active polling ownership, standby gracefully without starting polling.
  - When the primary window closes, allow election takeover.
- [x] Lifecycle Integration in `src/extension.ts`:
  - Starts Telegram polling during `activate()` when leader check passes.
  - Ensures clean shutdown (`bot.stop()`) on extension `deactivate()` or window reload (`Ctrl+R`).

### Non-Functional
- [x] Resilience: Bot polling crashes or network disconnects must reconnect automatically without crashing the VS Code extension host.
- [x] Isolation: Telegram bot errors must be logged to `debugLogger` without blocking Auto-Plan UI or orchestrator execution.

## Files to Create/Modify
- `package.json` - Add `grammy` dependency and `autoplan.telegram*` settings configuration schema.
- `src/config.ts` - Add getters for Telegram configuration properties.
- `src/telegramBridge.ts` - Core `TelegramBridge` class managing bot instance, authorization, and lifecycle.
- `src/extension.ts` - Integrate `telegramBridge` start and disposal lifecycle hooks.
- `src/test/phase01_telegram_bridge_lifecycle.test.ts` - Comprehensive file-based test for Phase 01.

## Test Criteria
- Exactly one file-based test: `src/test/phase01_telegram_bridge_lifecycle.test.ts`.
- [x] Verifies configuration loading and validation of `telegramBotToken`, `allowedUsers`, and `enabled` flag.
- [x] Verifies authorization middleware strictly permits whitelisted user IDs and denies unauthorized user IDs.
- [x] Verifies leader election logic correctly designates leader and suppresses secondary instance polling.
- [x] Verifies clean startup and graceful shutdown (`bot.stop()`) without dangling background timers.

---
Next Phase: phase-02-plan-folder-discovery-and-execution-selector.md
