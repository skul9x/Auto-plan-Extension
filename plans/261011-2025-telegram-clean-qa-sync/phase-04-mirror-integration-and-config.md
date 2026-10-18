# Phase 04: Full End-to-End Chat Mirror Integration & Configuration
Status: ✅ Completed
Dependencies: `phase-03-typing-and-smart-chunker.md`

## Objective
Wire all components (`TranscriptTailEngine`, `PromptOriginTracker`, `TypingActionManager`, and `telegramChatMirror`) into the main extension lifecycle (`extension.ts` and `telegramBridge.ts`). Provide user configuration options in VS Code settings to enable or customize the Clean Q&A chat mirror behavior.

## Requirements

### Functional
- Add configuration settings in `package.json`:
  - `autoplan.telegram.enableChatMirror` (boolean, default: `true`): Enable or disable live Q&A chat mirroring to Telegram.
  - `autoplan.telegram.mirrorIncludePcPrompts` (boolean, default: `true`): Whether to forward prompts entered on the PC keyboard.
  - `autoplan.telegram.chatMirrorPrefix` (string, default: `🤖 Antigravity:`): Customizable header prefix for assistant responses.
- Lifecycle Binding:
  - On extension activation, instantiate and start `TelegramChatMirror` when Telegram token and authorized users are present.
  - Listen to VS Code configuration change events (`onDidChangeConfiguration`) to hot-reload settings without restarting the extension.
  - Support multi-workspace environments by attaching `[📁 <workspaceName>]` tag when multiple workspaces are registered.
- On extension deactivation, gracefully stop all background tailing watchers and clear timers.

### Non-Functional
- Graceful error isolation: Errors occurring within the chat mirror must never impact core extension operation or IDE responsiveness.
- Seamless compatibility with existing commands (`/plans`, `/start`, `/screen`, and AWF workflows).

## Implementation Steps
1. Update `package.json` with configuration definitions under `contributes.configuration.properties`.
2. Connect `TranscriptTailEngine` events in `src/telegramChatMirror.ts`:
   - `userInput` -> Check origin via `PromptOriginTracker` -> Forward if from PC.
   - `agentActivity` -> Start `TypingActionManager`.
   - `plannerResponse` -> Stop typing -> Format header -> Deliver via `SmartMarkdownChunker`.
3. Expose `telegramChatMirror` instance on `telegramBridge` and initialize it in `extension.ts`.
4. Implement integration tests covering both PC-to-Telegram and Telegram-to-IDE paths.

## Files to Create/Modify
- `package.json` - Configuration schema additions.
- `src/telegramChatMirror.ts` - Top-level coordinator for Clean Q&A mirroring.
- `src/telegramBridge.ts` - Integration with bot lifecycle and authorized user lookup.
- `src/extension.ts` - Extension startup and shutdown hooks.
- `src/test/phase04_clean_qa_e2e_mirror_integration.test.ts` - Dedicated end-to-end integration test.

## Test Criteria
- Verify complete flow for PC-originated prompts:
  1. `userInput` event triggered with PC prompt.
  2. Telegram receives `💻 You (on PC): ...`.
  3. Intermediate `agentActivity` activates typing indicator.
  4. `plannerResponse` triggers delivery of `🤖 Antigravity: ...` with typing halted.
- Verify complete flow for Telegram-originated prompts:
  1. Outbound prompt registered in `PromptOriginTracker`.
  2. `userInput` event triggered -> prompt forwarding suppressed.
  3. `plannerResponse` delivered normally to Telegram.
- Verify that setting `enableChatMirror: false` completely suppresses mirror dispatches.

## Notes
- Only broadcast to authorized users (`allowedUsers` or active Telegram chat sessions).

---
Next Phase: `phase-05-release-and-regression.md`
