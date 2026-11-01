# Phase 02: Telegram Rate Limiting, Throttling & Network Reliability

Status: ✅ Completed
Test: `src/test/phase02_telegram_throttling_reliability.test.ts`

## Objective
Enforce strict, stateful rate-limiting compliance with the Telegram Bot API across consecutive responses, eliminate redundant HTTP 400 entity parse failures by default, and implement proper exponential backoff on HTTP 429 rate-limit responses in background typing indicators.

## Scope
- Delivery pipeline and throttled chunk dispatcher in `src/telegramChatMirror.ts` (`deliverChunkedResponse`, `ThrottledResponseDeliverer`, `handlePlannerResponse`).
- Parse mode configuration and retry orchestration in `src/telegramChatMirror.ts`.
- Rate-limit error handling, timer pauses, and backoff in `src/typingActionManager.ts`.

## Requirements
1. **Persistent Rate-Limit State Across Messages**:
   - Ensure `TelegramChatMirror` reuses its persistent `ThrottledResponseDeliverer` instance for all AI response deliveries instead of re-instantiating a fresh deliverer per message.
   - Retain `lastDeliveryPerChat` timestamps across distinct user prompts and AI responses so that rapid consecutive messages to the same chat are throttled reliably.
   - Enforce rate-limiting on chunk `0` of any new delivery when the elapsed time since the previous message to that chat is less than `minChunkDelayMs`.
2. **Safe Default Parse Mode & Network Round-Trip Reduction**:
   - Change default delivery `parse_mode` from legacy `'Markdown'` to `undefined` (plain text) unless explicit formatting is requested or sanitized.
   - Ensure technical messages containing unmatched underscores, asterisks, brackets, or backticks succeed on the initial Telegram API call without incurring HTTP 400 errors or secondary fallback round-trips.
3. **Single-Pass Markdown Splitting for Multi-User Targets**:
   - Ensure `splitMarkdownSafely()` is executed once per message payload rather than redundantly computed for each recipient in `allowedUsers`.
   - Dispatch deliveries across independent chats without allowing one slow chat connection to block deliveries to other chats.
4. **HTTP 429 Backoff in Typing Action Manager**:
   - Update `TypingActionManager` to inspect HTTP `429 Too Many Requests` responses and extract `parameters.retry_after`.
   - Pause typing intervals for the affected `chatId` for the duration specified by `retry_after` (plus safety margin) rather than repeatedly firing requests into an active rate limit.
   - Guard `sendAction` with an in-flight status flag per chat to prevent overlapping network requests when network latency exceeds the 4000ms timer interval.

## Constraints
- Preserve message ordering per chat ID.
- Maintain existing code-fence preservation logic in `splitMarkdownSafely`.
- Do not drop messages or disrupt whitelisted user filtering.

## Dependencies
- Source files: `src/telegramChatMirror.ts`, `src/typingActionManager.ts`.
- External API specification: Telegram Bot API (HTTP 429 `retry_after`, `parse_mode` behavior).

## Acceptance Criteria
- Sending two consecutive single-chunk responses to the same chat within 100ms enforces the minimum delay between the first and second messages.
- Sending a response with unescaped markdown syntax (e.g. `file_path_test*name`) succeeds on the first HTTP call without triggering `400 Bad Request` retries.
- Simulating an HTTP 429 error on `sendChatAction` causes `TypingActionManager` to suspend outgoing requests for the designated duration.
- Multiple allowed users receive the message without redundant markdown re-chunking computations.

## Comprehensive File-Based Test
- **File**: `src/test/phase02_telegram_throttling_reliability.test.ts`
- **Scope**:
  - Validates inter-message rate-limiting across consecutive calls to `deliverChunkedResponse` using mock Telegram bots and virtual clocks.
  - Verifies that chunk `0` obeys throttling if preceded closely by an earlier message.
  - Verifies delivery payload options default to plain text (`parse_mode: undefined`) and complete without parse error fallbacks.
  - Validates `TypingActionManager` 429 backoff behavior and in-flight request deduplication.
