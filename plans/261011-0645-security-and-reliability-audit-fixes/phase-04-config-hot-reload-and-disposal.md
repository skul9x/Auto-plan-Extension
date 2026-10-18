# Phase 04: Dynamic Configuration Hot-Reload & Extension Lifecycle Cleanup

Status: ✅ Completed
Dependencies: phase-03-elevation-command-safety.md

## Objective
Repair the configuration change watcher so that modifications to Telegram settings in VS Code Settings take effect immediately without requiring an IDE window reload. Clean up extension resource management by registering `bridgeServer` within `context.subscriptions` to guarantee automated teardown upon deactivation or unexpected activation faults.

## Requirements
### Functional
- [x] Fix Configuration Change Listener in `src/extension.ts`:
  - Update `vscode.workspace.onDidChangeConfiguration` callback.
  - Check for specific Telegram setting keys:
    - `e.affectsConfiguration('autoplan.telegramEnabled')`
    - `e.affectsConfiguration('autoplan.telegramBotToken')`
    - `e.affectsConfiguration('autoplan.telegramAllowedUsers')`
    - `e.affectsConfiguration('autoplan.telegramThrottleMs')`
  - Trigger `telegramBridge.reloadConfig()` immediately when any of these keys change.
- [x] Register `bridgeServer` Lifecycle in `context.subscriptions`:
  - Wrap `bridgeServer.stop()` in a disposable object `{ dispose: () => { bridgeServer.stop().catch(() => {}); } }`.
  - Add to `context.subscriptions.push(...)` in `src/extension.ts`.
- [x] Graceful Teardown:
  - Verify `deactivate()` safely stops all running servers, timers, and bot pollers idempotently.

### Non-Functional
- [x] Developer Experience: Changing Telegram bot token or toggling Telegram on/off takes effect dynamically without manual IDE restart.
- [x] Reliability: Zero dangling TCP listeners or orphaned child processes when extension is deactivated or reloaded.

## Files to Create/Modify
- `src/extension.ts` - Fix `onDidChangeConfiguration` logic and push `bridgeServer` to `context.subscriptions`.
- `src/test/phase04_config_hot_reload_and_disposal.test.ts` - Comprehensive file-based test for Phase 04.

## Test Criteria
- Exactly one file-based test: `src/test/phase04_config_hot_reload_and_disposal.test.ts`.
- [x] Verifies configuration change event triggers `telegramBridge.reloadConfig()` for all 4 Telegram configuration keys.
- [x] Verifies `context.subscriptions` contains disposal wrapper for `bridgeServer`.
- [x] Verifies `deactivate()` terminates both `bridgeServer` and `telegramBridge` cleanly without unhandled rejections.

---
Next Phase: phase-05-devdeps-packaging-and-e2e.md
