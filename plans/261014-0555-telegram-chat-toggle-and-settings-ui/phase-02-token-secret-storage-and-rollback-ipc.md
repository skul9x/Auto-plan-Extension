# Phase 02: Token SecretStorage Bridge API & Rollback Handler

Status: ✅ Completed
Test: `src/test/phase02_settings_telegram_token_ipc.test.ts`

## Goals
1. **Extend `SettingsProvider` with Secure Token IPC & Status Introspection**:
   - In `src/settingsProvider.ts`, implement a secure method `getTelegramStatus()` that checks:
     - `enabled`: `autoplan.telegramEnabled` (boolean)
     - `allowFreeChat`: `autoplan.telegram.allowFreeChat` (boolean)
     - `enableChatMirror`: `autoplan.telegram.enableChatMirror` (boolean)
     - `hasToken`: whether `SecretStorageManager.getTelegramToken()` or `config.telegramBotToken` is non-empty (boolean only, never returning the raw secret token to webview).
     - `allowedUsers`: array of allowed user IDs.
     - `throttleMs`: rate limit interval.
2. **Handle Interactive Token Modal & Cancellation Rollback in Webview IPC**:
   - In `SettingsProvider.handleMessage()`:
     - Handle `requestSetTelegramToken`:
       - Invoke `vscode.commands.executeCommand('autoplan.setTelegramToken')` or display `vscode.window.showInputBox({ password: true, prompt: 'Enter Telegram Bot Token from @BotFather' })`.
       - If user inputs a valid token: save to `SecretStorageManager.setTelegramToken(token)`, update configuration `telegramEnabled: true`, and send `telegramTokenUpdated` message with `{ hasToken: true, enabled: true }`.
       - If user cancels (`token === undefined` or user presses `Esc`): post `tokenPromptCancelled` message back to the webview with `{ rollback: true, enabled: false }` to trigger an automatic optimistic toggle reversal.
     - Handle `requestClearTelegramToken`:
       - Invoke `SecretStorageManager.deleteTelegramToken()`, clear config token, and post `telegramTokenCleared` with `{ hasToken: false }`.
3. **Verification**:
   - Exactly one test file: `src/test/phase02_settings_telegram_token_ipc.test.ts`.
   - Verify `getTelegramStatus()` correctly reflects token presence without leaking secrets.
   - Verify that token cancellation triggers the `tokenPromptCancelled` IPC payload with `rollback: true`.
   - Verify successful token submission updates SecretStorage and responds with `telegramTokenUpdated`.

## Implementation Details

### 1. `SettingsProvider` Methods
```typescript
public async getTelegramStatus(): Promise<{
  enabled: boolean;
  allowFreeChat: boolean;
  enableChatMirror: boolean;
  hasToken: boolean;
  allowedUsers: (number | string)[];
  throttleMs: number;
}> {
  const cfg = getTelegramConfig();
  let hasToken = false;
  try {
    const sec = await this._secretManager.getTelegramToken();
    hasToken = !!(sec && sec.trim().length > 0) || !!(cfg.botToken && cfg.botToken.trim().length > 0);
  } catch {
    hasToken = !!(cfg.botToken && cfg.botToken.trim().length > 0);
  }
  return {
    enabled: cfg.enabled,
    allowFreeChat: cfg.allowFreeChat ?? true,
    enableChatMirror: cfg.enableChatMirror ?? true,
    hasToken,
    allowedUsers: cfg.allowedUsers || [],
    throttleMs: cfg.throttleMs ?? 2500
  };
}
```

### 2. Message Dispatcher in `SettingsProvider`
```typescript
case 'requestSetTelegramToken': {
  const token = await vscode.window.showInputBox({
    password: true,
    prompt: 'Enter Telegram Bot API Token from @BotFather',
    placeHolder: '1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ',
    ignoreFocusOut: true
  });
  if (token && token.trim()) {
    await this._secretManager.setTelegramToken(token.trim());
    await vscode.workspace.getConfiguration('autoplan').update('telegramEnabled', true, vscode.ConfigurationTarget.Global);
    this._panel.webview.postMessage({
      command: 'telegramStatusUpdate',
      type: 'telegramStatusUpdate',
      status: await this.getTelegramStatus()
    });
  } else {
    // User pressed Esc or Cancel -> Signal optimistic rollback to webview
    this._panel.webview.postMessage({
      command: 'tokenPromptCancelled',
      type: 'tokenPromptCancelled',
      rollback: true
    });
  }
  break;
}
```

## Verification
- Run: `node out/test/phase02_settings_telegram_token_ipc.test.js`.
- Ensure 100% of test assertions pass.
