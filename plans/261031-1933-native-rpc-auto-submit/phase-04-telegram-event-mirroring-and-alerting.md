# Phase 04: Telegram Event Mirroring & Realtime Alerting

Status: ✅ Completed
Test: `src/test/phase04_auto_submit_telegram_mirroring.test.ts`

## Objective
Stream structured auto-approval events in realtime to connected Telegram chats, providing full visibility into autonomous background actions with actionable detail, deduplication, and zero rate-limit interference with active chat mirroring.

## Scope
- Auto-approval notification dispatcher hooks in `src/telegramNotifier.ts`.
- Bridge integration between `src/antigravityRpcAutoSubmit.ts` and the Telegram notification subsystem.
- Human-readable formatting of permission details (target resource, command string, file paths, tool call identity).
- Throttling and deduplication to ensure rapid consecutive approvals do not trigger Telegram 429 rate limit errors.

## Requirements
1. **Realtime Approval Event Dispatch**:
   - Provide an event hook or listener on the RPC Auto-Submit engine that triggers whenever a permission is successfully approved.
   - Forward approval events to `TelegramNotifier` when both `autoplan.autoSubmit.notifyTelegram` and `autoplan.telegram.enabled` are active.
   - Deliver events without blocking the Auto-Submit polling loop or delaying subsequent RPC operations.
2. **Human-Readable Notification Formatting**:
   - Format approval messages clearly: indicate the approved tool or action name (e.g., Terminal Command execution, File Modification), the target path or command summary, and the timestamp.
   - Cleanly sanitize and truncate overly lengthy shell command arguments (capping at safe message length bounds) while preserving the core command context.
   - Use plain-text formatting adhering to `parse_mode: undefined` rules to prevent Telegram markdown parsing errors.
3. **Burst Throttling & Deduplication**:
   - When a cascade triggers multiple rapid permission requests in immediate succession (e.g., batch file modifications), batch or throttle notifications to stay strictly within Telegram API rate limits (1 message per second limit).
   - Deduplicate consecutive identical messages within a rolling short window to eliminate redundant chat spam.
4. **Failure & Silent Mode Resilience**:
   - If Telegram API delivery fails due to network outage or token invalidation, record the error cleanly in the diagnostic log without disrupting the core RPC submission engine.
   - Respect user preferences when Telegram notifications are toggled off, operating in total silent mode.

## Constraints
- Telegram notification dispatch must be asynchronous (`void` / unawaited from the core RPC submission tick) so that network latency cannot slow down permission approvals.
- Do not expose secret environment variables or sensitive token values in Telegram approval messages.
- Comply with all existing Telegram rate-limiting, deduplication, and queuing mechanisms established in previous versions.

## Dependencies
- Source files: `src/antigravityRpcAutoSubmit.ts`, `src/telegramNotifier.ts`, `src/telegramBridge.ts`, `src/config.ts`.
- Prior phases: Phases 01, 02, and 03.

## Acceptance Criteria
- Successfully triggers a Telegram notification when mock RPC auto-approval succeeds.
- Formats messages with command summary, target resource, and single-use permission indicator without markdown parse errors.
- Handles rapid bursts of 5 consecutive approvals smoothly through the rate-limiting queue without dropping events or throwing 429 errors.
- Disables Telegram notification cleanly when `autoplan.autoSubmit.notifyTelegram` is set to `false`.

## Comprehensive File-Based Test
- **File**: `src/test/phase04_auto_submit_telegram_mirroring.test.ts`
- **Scope**:
  - Tests event hook connectivity between the RPC Auto-Submit engine and `TelegramNotifier`.
  - Verifies message string construction and formatting across diverse permission resource types (terminal command, file write, custom tool permission).
  - Simulates burst approval events and verifies rate-limiting queueing and throttling compliance.
  - Verifies silent operation when Telegram notification is disabled in configuration.

