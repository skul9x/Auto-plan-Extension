# Phase 03: Delivery Pipelines Integration & Safe Plain-Text Fallback

Status: ✅ Completed  
Test: `src/test/phase03_telegram_html_delivery_and_fallback.test.ts`

## Objective
Integrate the Markdown-to-HTML engine and HTML-aware chunk splitter into Telegram delivery channels (`telegramChatMirror.ts`, `telegramBridge.ts`, and `telegramNotifier.ts`), setting default `parse_mode: 'HTML'` with an automatic, resilient fallback to plain text if Telegram rejects a message with a parsing entity error (HTTP 400).

## Scope
- Live transcript mirroring in `src/telegramChatMirror.ts`.
- Direct bot reply handling in `src/telegramBridge.ts`.
- Notification broadcasting in `src/telegramNotifier.ts`.
- Fallback mechanics on Telegram API `400 Bad Request: can't parse entities` errors.

## Requirements
### Functional
- In `src/telegramChatMirror.ts`:
  1. Update `deliverChunks` and `sendSingleChunkWithRetry` to use `parse_mode: 'HTML'` as the default delivery format.
  2. Use `markdownToTelegramHtml` to format transcript model responses before chunking.
  3. When Telegram API rejects a chunk with an entity parse error (`isEntityParseError`), fallback to sending the chunk stripped via `stripMarkdownToPlainText` with `parse_mode: undefined`.
- In `src/telegramBridge.ts`:
  1. Replace plain-text conversion in `finishAndReply` with `markdownToTelegramHtml`.
  2. Split the resulting HTML using `splitHtmlMessage`.
  3. Send replies with `{ parse_mode: 'HTML' }`.
  4. Wrap send operations with error catching: if sending with `parse_mode: 'HTML'` fails due to entity parsing, immediately fallback to plain text via `stripMarkdownToPlainText`.
- In `src/telegramNotifier.ts`:
  1. Allow callers of `safeSendMessage` and `safeEditMessage` to specify `parse_mode: 'HTML'` when structured notification formatting is desired.
  2. Maintain `isRateLimitError` pause and backoff logic.

### Non-Functional
- **Zero Message Loss Guarantee:** Under no circumstances should an entity formatting error cause a message to be dropped; fallback to plain text must execute immediately on failure.
- **Clean Logging:** Log a clear diagnostic warning when a fallback is triggered, indicating the reason and chat ID.

## Constraints
- Do not alter `telegramPlanManager.ts` command buttons or interactive keyboards which already operate with their specialized safe formatting.
- Preserve all existing rate-limiting throttles and chunk delay parameters (`minChunkDelayMs`).

## Dependencies
- Phase 01: `markdownToTelegramHtml` in `src/telegramUtils.ts`.
- Phase 02: `splitHtmlMessage` in `src/telegramUtils.ts`.
- Files to modify:
  - `src/telegramChatMirror.ts`
  - `src/telegramBridge.ts`
  - `src/telegramNotifier.ts`

## Acceptance Criteria
- AI model responses mirrored from Antigravity IDE to Telegram are formatted as rich HTML with `parse_mode: 'HTML'`.
- Interactive prompts sent via `/new_chat` or direct chat to the bot receive rich HTML replies.
- Simulated Telegram 400 entity parse errors trigger automatic plain-text retry without dropping the response chunk.
- Throttling and chunk delay intervals are strictly maintained during multi-chunk HTML delivery.

## Comprehensive File-Based Test
- **File**: `src/test/phase03_telegram_html_delivery_and_fallback.test.ts`
- **Scope**:
  - Tests `TelegramChatMirror.deliverChunks` dispatching with `parse_mode: 'HTML'`.
  - Simulates Telegram 400 Bad Request entity parse error on chunk 1 and verifies immediate retry with plain text and `parse_mode: undefined`.
  - Tests `telegramBridge` response delivery with mock Telegram context verifying `ctx.reply` receives HTML formatted payloads.
  - Verifies rate limit (HTTP 429) backoff behavior remains operational.

