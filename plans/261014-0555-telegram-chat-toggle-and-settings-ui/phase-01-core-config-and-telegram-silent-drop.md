# Phase 01: Core Configuration & Telegram Free-Text Silent Drop Gating

Status: ✅ Completed
Test: `src/test/phase01_telegram_free_chat_gating.test.ts`

## Goals
1. **Define `autoplan.telegram.allowFreeChat` Configuration**:
   - Add `autoplan.telegram.allowFreeChat` to `package.json` under `contributes.configuration` (type `boolean`, default `true`, description: *"Allow arbitrary free-text messages from Telegram to be dispatched as prompts into Antigravity IDE. When disabled, non-command messages are silently dropped."*).
   - Update `AutoPlanConfig` and `TelegramConfig` in `src/config.ts` to include `telegramAllowFreeChat?: boolean;` and `allowFreeChat: boolean;`.
   - Update `DEFAULT_CONFIG` with `telegramAllowFreeChat: true`.
   - Update `getTelegramConfig()` to read `telegram.allowFreeChat` with global/workspace resolution.
2. **Implement Silent Drop Gating in `TelegramBridge`**:
   - In `src/telegramBridge.ts`:
     - Add `allowFreeChat: boolean = true;` to `TelegramBridgeOptions` and bridge instance fields.
     - Update `reloadConfig()` to refresh `allowFreeChat` dynamically on config changes.
     - In `registerTextDispatcher(bot: Bot)`:
       - If message matches an internal management command (`/plans`, `/plan_status`, `/screen`, `/new_chat`, etc.) or workflow command (`/code`, `/brainstorm`, etc.), process normally regardless of `allowFreeChat`.
       - If `!this.allowFreeChat` and message is NOT a recognized slash command:
         - Log debug event: `Silent dropping free-text message from user ${ctx.from?.id} (allowFreeChat is false)`.
         - Return immediately without sending any acknowledgment reply to Telegram and without dispatching prompt to `PromptDispatcher`.
3. **Verification**:
   - Exactly one test file: `src/test/phase01_telegram_free_chat_gating.test.ts`.
   - Verify that when `allowFreeChat = false`:
     - Free-form text prompts are silently dropped (0 messages sent to Telegram, 0 calls to PromptDispatcher).
     - Slash commands (`/plans`, `/plan_status`, `/code`, `/recap`) execute normally and dispatch appropriately.
   - Verify that when `allowFreeChat = true`, free-form text messages are dispatched and acknowledged as expected.

## Implementation Details

### 1. `src/config.ts` Updates
```typescript
export interface AutoPlanConfig {
  // ... existing options ...
  telegramAllowFreeChat?: boolean;
}

export interface TelegramConfig {
  // ... existing options ...
  allowFreeChat: boolean;
}
```

### 2. `src/telegramBridge.ts` Updates
```typescript
// In registerTextDispatcher:
const isInternalCommand = trimmed.startsWith('/') && INTERNAL_BOT_COMMANDS.has(cmdName);
const parsedWorkflow = parseWorkflowCommand(rawText);

if (!this.allowFreeChat && !isInternalCommand && !parsedWorkflow) {
  this.logger.debug('TELEGRAM', `Silent dropping free-text message from user ${ctx.from?.id} (allowFreeChat = false)`);
  return;
}
```

## Verification
- Run: `node out/test/phase01_telegram_free_chat_gating.test.js`.
- Ensure 100% of test assertions pass.
