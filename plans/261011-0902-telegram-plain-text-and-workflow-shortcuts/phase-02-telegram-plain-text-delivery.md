# Phase 02: Telegram Bot Response & Notification Plain Text Delivery

Status: ✅ Completed
Dependencies: phase-01-markdown-to-plain-text-engine.md

## Objective
Integrate the `stripMarkdownToPlainText` transformation engine directly into the outbound Telegram message delivery pipeline across `src/telegramBridge.ts` and `src/telegramNotifier.ts`. Ensure all AI transcript responses, status notifications, and plan progress updates are sent as clean, unadorned Plain Text with `parse_mode: undefined`, guaranteeing zero Telegram API entity parsing rejections and a comfortable mobile reading experience.

## Requirements
### Functional
- [x] Update `awaitAndReplyModelResponse` in `src/telegramBridge.ts`:
  - Run incoming transcript text through `stripMarkdownToPlainText` before chunk splitting and dispatch.
  - Pass sanitized plain text chunks to `ctx.reply(chunk)` without `parse_mode`.
- [x] Update `ThrottledNotifier` in `src/telegramNotifier.ts`:
  - Convert phase start, phase complete, and error notification messages to clean plain text.
  - Remove forced `{ parse_mode: 'Markdown' }` calls that trigger Telegram entity parse failures, using `parse_mode: undefined`.
- [x] Ensure `splitMessage` in `src/telegramUtils.ts` properly chunks plain text at clean line boundaries under 3800 characters without breaking words.
- [x] Guarantee zero HTML tags or Markdown delimiters (`*`, `_`, `` ` ``) are delivered to Telegram chats.

### Non-Functional
- [x] Reliability: 100% of outbound messages succeed on first transmission without catching Markdown parse rejections or triggering retries.
- [x] User Experience: Messages appear immediately readable, uncluttered by formatting markup on mobile devices.

## Implementation Steps
1. Wire `stripMarkdownToPlainText` into `awaitAndReplyModelResponse` in `src/telegramBridge.ts`.
2. Update notification dispatch in `src/telegramNotifier.ts` to format plain text and remove `parse_mode: 'Markdown'`.
3. Verify chunking behavior in `splitMessage` with long plain text responses.
4. Create and run standalone test `src/test/phase02_telegram_plain_text_delivery.test.ts`.

## Files to Create/Modify
- `src/telegramBridge.ts` - Update transcript response processing with plain text formatting.
- `src/telegramNotifier.ts` - Modernize notification methods to clean plain text without Markdown parse mode.
- `src/test/phase02_telegram_plain_text_delivery.test.ts` - Comprehensive single-file test for Phase 02.

## Test Criteria
- Exactly one file-based test: `src/test/phase02_telegram_plain_text_delivery.test.ts`.
- [x] Verifies `awaitAndReplyModelResponse` processes transcript content through `stripMarkdownToPlainText` and replies with clean plain text.
- [x] Verifies notification messages dispatched by `ThrottledNotifier` omit `parse_mode: 'Markdown'` and contain no raw Markdown tokens.
- [x] Verifies chunking splits long plain text messages (> 4000 characters) cleanly without truncating lines.
- [x] Verifies simulated Telegram API accepts messages without entity parsing errors.

---
Next Phase: phase-03-workflow-command-registration-and-mapping.md
