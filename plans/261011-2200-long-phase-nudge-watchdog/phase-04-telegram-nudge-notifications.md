# Phase 04: Telegram Nudge Notification & Dashboard State Integration

Status: ✅ Completed
Test: `src/test/phase04_telegram_nudge_notification_e2e.test.ts`

## Goals
1. Connect Orchestrator's `phaseNudged` event to `TelegramNotifier` and `TelegramBridge`.
2. Send an informative, throttled notification to all authorized Telegram users when a phase receives a nudge.
3. Reflect nudge status in Sidebar Webview Control Center and Telegram Live Dashboard.
4. Validate with a single comprehensive file-based test: `src/test/phase04_telegram_nudge_notification_e2e.test.ts`.

## Implementation Details

### 1. Telegram Event Wiring
In `src/telegramBridge.ts`:
- Subscribe to `orchestrator.on('phaseNudged', async ({ phase, phaseIndex, message }) => { ... })`:
  - Verify `config.telegramEnabled` and `config.longPhaseNotifyTelegram`.
  - Format notification:
    ```text
    ⏱️ [Auto-Plan Nudge]
    Phase ${phase.phaseNumber || phaseIndex + 1} (${phase.fileName}) running > 3 minutes.
    Automatically paused AI and injected online search guidance into IDE chat.
    ```
  - Dispatch through `telegramNotifier.sendInfo(text)`.

### 2. Live Dashboard & Sidebar Visibility
In `src/sidebarProvider.ts`:
- Update phase viewmodel to display a `Nudged` pill or warning indicator if `phase.hasNudged` is true.
- Add telemetry log entry visible in the in-memory Log Console.

In `src/telegramPlanManager.ts`:
- If active status is rendered on Telegram (via `/plan_status`), show `⚠️ Nudged (guidance sent)` next to the running phase.

## Verification
- Test: `src/test/phase04_telegram_nudge_notification_e2e.test.ts`
- Verifies event propagation from Orchestrator through TelegramBridge, notification composition, and dashboard status rendering.
