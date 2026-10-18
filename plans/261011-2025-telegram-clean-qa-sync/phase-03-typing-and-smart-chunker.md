# Phase 03: Typing Action & Smart Assistant Response Chunker
Status: 🟢 Completed
Dependencies: `phase-02-dedup-origin-tracker.md`

## Objective
Build the presentation and delivery layer for assistant responses. When the AI is actively running tools or thinking, the engine triggers Telegram `sendChatAction('typing')` indicators. When the AI finalizes its response, `SmartMarkdownChunker` splits long responses exceeding 4000 characters without corrupting Markdown code fences (```) or hitting Telegram's 4096-character limit, delivering chunks with rate-limited throttling.

## Requirements

### Functional
- `TypingActionManager`:
  - Periodically invokes `bot.api.sendChatAction(chatId, 'typing')` every 4000ms while agent tools or thinking steps are in progress.
  - Automatically cancels the typing interval immediately when `PLANNER_RESPONSE` arrives or when an error occurs.
- `SmartMarkdownChunker`:
  - Enforces a safe chunk limit of 3800–4000 characters (leaving margin for headers).
  - Splits text along newline and paragraph boundaries (`\n\n` or `\n`), never cutting words or mid-line syntax.
  - Tracks code fence states (```): if a chunk split occurs within a code block, append `\n``` ` to close the chunk, and prepend ` ```<lang>\n ` to reopen the code block in the subsequent chunk.
- `ThrottledResponseDeliverer`:
  - Enforces a minimum 1000ms delay between consecutive chunk deliveries to avoid Telegram `429 Too Many Requests`.
  - Integrates `retry_after` handling when rate limits are encountered.

### Non-Functional
- Formatting safety: Prevent Telegram entity parser failures by ensuring clean, properly balanced fences.
- Clean presentation: Prepend the response with a neat header e.g. `🤖 Antigravity:` or clean plain text formatting.

## Implementation Steps
1. Create `src/smartMarkdownChunker.ts`.
2. Implement `splitMarkdownSafely(text: string, maxLen?: number): string[]`:
   - Iterate through lines while tracking `inCodeBlock: boolean` and `codeBlockLang: string`.
   - Accumulate lines into chunks up to `maxLen` (default 3800).
   - Close open code fences at the end of each chunk and reopen them at the start of the next chunk.
3. Create `src/typingActionManager.ts` managing active typing timers per target `chatId`.
4. Implement `deliverChunkedResponse(bot: Bot, chatId: string | number, text: string, options?: any): Promise<void>` in `src/telegramChatMirror.ts`.

## Files to Create/Modify
- `src/smartMarkdownChunker.ts` - Markdown-aware text splitting preserving code fences.
- `src/typingActionManager.ts` - Periodic typing indicator lifecycle management.
- `src/telegramChatMirror.ts` - Response delivery orchestration and chunk queue.
- `src/test/phase03_clean_qa_typing_and_smart_chunker.test.ts` - Dedicated test verifying chunking and typing lifecycles.

## Test Criteria
- Verify that short responses (< 3800 chars) return a single chunk unchanged.
- Verify that a long response (> 5000 chars) containing a massive code block is split into chunks where each chunk has matching opening and closing ` ``` ` fences.
- Verify that language identifiers (e.g. ` ```typescript `) are preserved when reopening the block in the next chunk.
- Verify that `TypingActionManager` starts intervals upon agent activity and stops promptly upon completion or abort.

## Notes
- Do not use naive substring slices (`slice(0, 4000)`); boundary detection must always be line-based.

---
Next Phase: `phase-04-mirror-integration-and-config.md`
