# Phase 05: Screen Capture, Status Dashboard & E2E Verification

Status: ✅ Completed
Dependencies: phase-04-realtime-transcript-stream-and-throttle.md

## Objective
Implement desktop screenshot capture via `/screen` using the native Linux system utility `/usr/bin/gnome-screenshot`, build the status dashboard and control commands (`/plan_status`, `/plan_skip`, `/plan_stop`), and execute a single comprehensive end-to-end test verifying the full remote development bridge from Telegram request to Antigravity IDE action and back.

## Requirements
### Functional
- [x] Implement Screen Capture Engine in `src/telegramScreen.ts`:
  - Executes `/usr/bin/gnome-screenshot -f /tmp/antigravity_screen_<timestamp>.png` via child process on Linux.
  - Falls back to `scrot`, `import`, or Windows PowerShell / macOS `screencapture` if cross-platform fallback is needed.
  - Sends the captured image file directly to Telegram using `bot.api.sendPhoto(chatId, new InputFile(imagePath), { caption: '📸 Antigravity IDE Desktop Screen' })`.
  - Cleans up temporary image files immediately after dispatch.
- [x] Implement Plan Control Commands in `src/telegramBridge.ts`:
  - `/plan_status`: Returns current orchestrator state (`IDLE`, `RUNNING`, `PAUSED`, `ERROR`), current phase name, iteration count, and a text progress bar: `[████████░░] 80% (4/5 phases)`.
  - `/plan_skip`: Triggers `vscode.commands.executeCommand('autoplan.skipPhase')` and confirms in Telegram: `⏭️ Skipping current phase...`.
  - `/plan_stop`: Triggers `vscode.commands.executeCommand('autoplan.stop')` and confirms in Telegram: `🛑 Plan execution stopped.`.
  - `/help`: Displays a quick reference guide of all Telegram slash commands.
- [x] End-to-End Regression Verification:
  - Consolidate all integration points across Lifecycle, Folder Picker, Free Chat, Transcript Watcher, and Screen Capture.
  - Single comprehensive test in `src/test/phase05_telegram_integration_e2e.test.ts`.

### Non-Functional
- [x] Security: Temporary screenshot files must be stored in private temporary directories with secure permissions (0600) and unlinked immediately.
- [x] Performance: Screenshot capture and dispatch must complete in < 3 seconds.

## Files to Create/Modify
- `src/telegramScreen.ts` - Native screen capture runner and temporary file manager.
- `src/telegramBridge.ts` - Implement `/screen`, `/plan_status`, `/plan_skip`, `/plan_stop`, and `/help`.
- `src/test/phase05_telegram_integration_e2e.test.ts` - Single comprehensive file-based test for Phase 05.

## Test Criteria
- Exactly one file-based test: `src/test/phase05_telegram_integration_e2e.test.ts`.
- [x] Verifies `/screen` captures a valid image file, dispatches via Telegram API, and cleans up temporary files.
- [x] Verifies `/plan_status` correctly renders execution state, current phase, and percentage.
- [x] Verifies `/plan_skip` and `/plan_stop` successfully signal the orchestrator.
- [x] Verifies end-to-end command dispatch and response cycle across simulated Telegram inputs.

---
Next Phase: Completed (Ready for packaging and production release)
