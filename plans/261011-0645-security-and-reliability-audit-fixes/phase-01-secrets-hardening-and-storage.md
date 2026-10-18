# Phase 01: Secrets Hardening & Secure Credential Storage

Status: ✅ Completed
Dependencies: None

## Objective
Eliminate hardcoded sensitive Telegram credentials from the repository, configuration schemas, documentation, and build artifacts. Introduce a secure credential manager backed by VS Code's native `SecretStorage` API (`context.secrets`) to safely store the bot token in OS keychains. Sanitize the sidecar configuration generator to exclude sensitive credentials and enforce restrictive `0600` file permissions.

## Requirements
### Functional
- [x] Remove hardcoded Telegram Bot token and user ID from `package.json` (`default: ""` and empty whitelist).
- [x] Remove hardcoded Telegram Bot token and user ID from `src/config.ts` (`DEFAULT_CONFIG.telegramBotToken = ""` and `DEFAULT_CONFIG.telegramAllowedUsers = []`).
- [x] Scrub hardcoded tokens from project docs (`docs/BRIEF_TELEGRAM_REMOTE.md` and old plan briefs).
- [x] Implement `SecretStorageManager` in `src/config.ts` (or `src/secretManager.ts`):
  - Wraps `vscode.SecretStorage` (`context.secrets`).
  - Implements `getTelegramToken(): Promise<string | undefined>`, `setTelegramToken(token: string): Promise<void>`, and `deleteTelegramToken(): Promise<void>`.
  - Supports token resolution hierarchy: SecretStorage token takes precedence over workspace configuration `autoplan.telegramBotToken`.
- [x] Register user-facing commands in `src/extension.ts`:
  - `autoplan.setTelegramToken`: Prompts user with `vscode.window.showInputBox({ password: true, prompt: "Enter Telegram Bot Token from @BotFather" })` and stores it into SecretStorage.
  - `autoplan.clearTelegramToken`: Safely deletes the token from SecretStorage.
- [x] Sanitize `writeSidecarConfig` in `src/config.ts`:
  - Explicitly strip `telegramBotToken` from the serialized JSON payload written to `autoplan-config.json`.
  - Enforce file permission mode `0o600` (owner read/write only) on `autoplan-config.json`.

### Non-Functional
- [x] Security: No plaintext bot tokens written to disk, version control, or sidecar config files.
- [x] Zero Regression: Existing configurations without SecretStorage fall back gracefully to settings without crashing.

## Files to Create/Modify
- `package.json` - Clear default token value; register `autoplan.setTelegramToken` and `autoplan.clearTelegramToken` commands.
- `src/config.ts` - Implement `SecretStorageManager`, update `DEFAULT_CONFIG`, sanitize `writeSidecarConfig` with `0o600`.
- `src/telegramBridge.ts` - Read bot token via `SecretStorageManager` with fallback to `getConfig().telegramBotToken`.
- `src/extension.ts` - Register secret management commands and initialize `SecretStorageManager` during `activate()`.
- `src/test/phase01_secrets_hardening_and_storage.test.ts` - Comprehensive file-based test for Phase 01.

## Test Criteria
- Exactly one file-based test: `src/test/phase01_secrets_hardening_and_storage.test.ts`.
- [x] Verifies `DEFAULT_CONFIG` does not contain hardcoded production tokens or user IDs.
- [x] Verifies `SecretStorageManager` stores, retrieves, and deletes token via mock SecretStorage.
- [x] Verifies token precedence: SecretStorage overrides workspace config.
- [x] Verifies `writeSidecarConfig` strips `telegramBotToken` and writes with `0o600` permissions.

---
Next Phase: phase-02-bridge-server-auth-and-cors.md
