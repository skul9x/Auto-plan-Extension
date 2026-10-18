# Phase 04: Real-Time Transcript Stream & Throttled Notifications

Status: ✅ Completed
Dependencies: phase-03-free-chat-session-and-message-chunking.md

## Objective
Wire the Auto-Plan `transcriptWatcher` and `orchestrator` event pipelines directly to Telegram. Implement a throttled live-updating message mechanism (2.5-second debounce) to stream real-time progress while strictly adhering to Telegram Bot API rate limits (avoiding HTTP 429 Too Many Requests), and broadcast rich notifications upon phase starts, stalls, errors, and keyword completion (`Done skul9x.`).

## Requirements
### Functional
- [x] Implement `ThrottledNotifier` in `src/telegramNotifier.ts`:
  - Maintains a current live status message ID in Telegram.
  - Buffers and debounces updates from `transcriptWatcher.on('logUpdate')` and `transcriptWatcher.on('settleStarted')`.
  - Edits the live status message at most once every `autoplan.telegramThrottleMs` (default: 2500ms).
  - Previews current agent activity (e.g. `⏳ Reading src/auth.ts...`, `🛠️ Editing controllers...`).
- [x] Connect Orchestrator Lifecycle Events to Telegram:
  - `orchestrator.on('phaseStart')`: Sends new message `🚀 Phase Started: {phaseName} ({index}/{total})`.
  - `orchestrator.on('phaseComplete')`: Sends `✅ Phase Completed: {phaseName}` with iteration summary.
  - `orchestrator.on('skipped')`: Sends `⏭️ Phase Skipped: {phaseName}`.
  - `orchestrator.on('allComplete')`: Sends `🎉 All Phases Completed Successfully!`.
  - `orchestrator.on('stopped')`: Sends `🛑 Plan Execution Stopped`.
  - `orchestrator.on('error')`: Sends `❌ Error: {errorMessage}`.
- [x] Completion Keyword & Final Response Delivery:
  - On `transcriptWatcher.on('onCompletionDetected')` (detection of `Done skul9x.` or completion step):
    - Flushes any pending throttled stream updates.
    - Sends a dedicated completion summary to Telegram containing the final output excerpt.
    - If the final output is lengthy (> 3800 chars), chunks and sends sequentially using `splitMessage`.

### Non-Functional
- [x] Rate Limit Protection: Gracefully handle Telegram API `429 Too Many Requests` by extracting `retry_after` header and pausing subsequent edits accordingly.
- [x] Message History Hygiene: Finalize and unpin progress messages upon phase completion so subsequent phases generate fresh clean progress containers.

## Files to Create/Modify
- `src/telegramNotifier.ts` - Throttled live update controller, event wire-up, and error recovery.
- `src/telegramBridge.ts` - Attach notifier to active `orchestrator` and `transcriptWatcher` instances.
- `src/test/phase04_stream_notifications_throttle.test.ts` - Comprehensive file-based test for Phase 04.

## Test Criteria
- Exactly one file-based test: `src/test/phase04_stream_notifications_throttle.test.ts`.
- [x] Verifies throttled message edits do not exceed the configured throttle interval under rapid event bursts.
- [x] Verifies orchestrator lifecycle events (`phaseStart`, `phaseComplete`, `error`) trigger proper notification formatting.
- [x] Verifies detection of `Done skul9x.` triggers final output flush and completion message.
- [x] Verifies rate-limit (429) backoff handling without uncaught promise rejections.

---
Next Phase: phase-05-screen-capture-status-dashboard-and-e2e.md
