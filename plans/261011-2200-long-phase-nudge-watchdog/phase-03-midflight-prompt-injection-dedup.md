# Phase 03: Mid-Flight Prompt Injection & Origin Tracking Integration

Status: ✅ Completed
Test: `src/test/phase03_prompt_injection_and_origin_tracking.test.ts`

## Goals
1. Differentiate automated system steering prompts from human PC/Telegram inputs via `PromptOriginTracker`.
2. Ensure mid-flight prompt injection (`openNewConversation: false`) flows seamlessly through `PromptDispatcher`.
3. Integrate with `TelegramChatMirror` so that the steering prompt is labeled appropriately (`🤖 [Auto-Plan Nudge]: ...`) without false user attribution or echo loops.
4. Validate with a single comprehensive file-based test: `src/test/phase03_prompt_injection_and_origin_tracking.test.ts`.

## Implementation Details

### 1. Origin Tracking Enhancement
In `src/promptOriginTracker.ts`:
- Extend `PromptOrigin` type/enum:
  ```typescript
  export type PromptOrigin = 'pc' | 'telegram' | 'system_nudge';
  ```
- Add helper `trackNudgePrompt(promptText: string): void`:
  - Registers normalized hash into the 60-second TTL ring buffer with origin `'system_nudge'`.

### 2. Telegram Chat Mirror Adaptation
In `src/telegramChatMirror.ts`:
- When processing incoming `USER_INPUT` lines from `transcript.jsonl`:
  - Check `promptOriginTracker.getOrigin(userText)`.
  - If origin is `'system_nudge'`:
    - Mirror to Telegram using clear system attribution:
      `🤖 [Auto-Plan Nudge]: <text>`
    - Avoid prefixing with `💻 You (on PC):`.
  - If origin is `'telegram'`: Suppress mirror (already posted by user).
  - If origin is `'pc'`: Mirror with `💻 You (on PC):`.

### 3. Prompt Dispatcher Integration
In `src/promptDispatcher.ts`:
- Ensure `dispatchPrompt` with `openNewConversation: false` executes direct DOM/native insertion into the active conversation without triggering `antigravity.prioritized.chat.openNewConversation` or DOM new chat clicks.
- Preserves conversation continuity in Antigravity IDE.

## Verification
- Test: `src/test/phase03_prompt_injection_and_origin_tracking.test.ts`
- Verifies `SYSTEM_NUDGE` origin classification, proper mirror formatting in Telegram, and suppression of echo anomalies.
