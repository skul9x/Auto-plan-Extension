# Phase 03: Free Chat Dispatcher, Session Continuity & Message Chunking

Status: ✅ Completed
Dependencies: phase-01-core-telegram-bridge-and-lifecycle.md

## Objective
Implement seamless bidirectional free-text chat between Telegram and Antigravity IDE. Normal text messages sent to the bot are dispatched directly into the active Antigravity chat session using `promptDispatcher`. Support conversation continuity (Option A) by default, provide a `/new_chat` command to spawn a fresh conversation (`Ctrl+Shift+L`), and enforce safe message chunking (~3800 characters) to prevent Telegram 4096-character limit exceptions.

## Requirements
### Functional
- [x] Implement Text Message Dispatcher in `src/telegramBridge.ts`:
  - Intercepts incoming `message:text` that do not begin with a command slash (`/`).
  - Dispatches the prompt into Antigravity IDE using `promptDispatcher.dispatchPrompt(text, { timeoutMs: 15000 })`.
  - Immediately acknowledges receipt in Telegram with a status indicator (`⏳ Prompt sent to Antigravity IDE...`).
- [x] Session Continuity & Fresh Conversation:
  - Default behavior: Injects text into the currently active IDE conversation panel to maintain uninterrupted conversational memory and context.
  - Implement `/new_chat` command: Triggers `keyboardManager.sendNewConversationShortcut()` or native command (`antigravity.newConversation` / `Ctrl+Shift+L`) and confirms in Telegram: `🆕 New conversation initialized`.
- [x] Safe Message Chunking Engine:
  - Implement `splitMessage(text: string, maxChunkLength = 3800): string[]` in `src/telegramUtils.ts`.
  - Intelligently splits long text on paragraph boundaries (`\n\n`), line breaks (`\n`), or whitespace to avoid splitting markdown formatting tags, URLs, or code blocks in the middle.
  - Automatically closes and re-opens unclosed fenced code blocks (```) across message chunks to preserve syntax highlighting on the Telegram client.
- [x] Implement Error & Fallback Notification:
  - If prompt dispatch fails (e.g. DOM bridge timeout), report the exact error and fallback status back to Telegram.

### Non-Functional
- [x] Safety: Sanitize input strings to prevent shell escaping issues if Tier 3 OS keyboard simulation is used.
- [x] Performance: Chunking splitting algorithm must execute in < 5ms for outputs up to 500KB.

## Files to Create/Modify
- `src/telegramUtils.ts` - Message chunking, code-block preservation, and Markdown sanitization utilities.
- `src/telegramBridge.ts` - Free text handler, `/new_chat` command, and dispatch acknowledgment.
- `src/test/phase03_free_chat_and_session.test.ts` - Comprehensive file-based test for Phase 03.

## Test Criteria
- Exactly one file-based test: `src/test/phase03_free_chat_and_session.test.ts`.
- [x] Verifies prompt dispatcher invocation when receiving free-form text messages.
- [x] Verifies `/new_chat` command triggers new conversation shortcut.
- [x] Verifies `splitMessage` correctly breaks long text into chunks <= 3800 characters without breaking mid-word.
- [x] Verifies preservation and proper balancing of markdown code blocks across split message boundaries.

---
Next Phase: phase-04-realtime-transcript-stream-and-throttle.md
