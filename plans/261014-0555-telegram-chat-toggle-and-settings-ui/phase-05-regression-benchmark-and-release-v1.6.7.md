# Phase 05: Regression, Release Packaging & Documentation (v1.6.7)

Status: ✅ Completed
Completed At: 2026-10-14T06:49:00+07:00
Test: `src/test/phase05_telegram_chat_toggle_release.test.ts`

## Goals
1. **End-to-End Regression Verification**:
   - Verify all existing capabilities:
     - 3-tier prompt dispatching (DOM Bridge, VS Code Commands, OS Keyboard).
     - Telegram remote control commands (`/plans`, `/plan_status`, `/screen`, `/new_chat`).
     - AWF workflow commands (`/init`, `/plan`, `/design`, `/code`, `/recap`, etc.).
     - Silent drop of free-form text prompts when `allowFreeChat = false`.
     - Watchdog long-phase nudge notifications.
     - Settings Webview 4-tab navigation, search filtering, and auto-save.
2. **Release Manifest & Documentation Alignment (v1.6.7)**:
   - Update `package.json` version from `1.6.6` to `1.6.7`.
   - Add npm test script `"test:phase05-release": "node out/test/phase05_telegram_chat_toggle_release.test.js"`.
   - Update `CHANGELOG.md` with detailed v1.6.7 release notes:
     - Free-text chat silent drop gating (`autoplan.telegram.allowFreeChat`).
     - Modern tab-based settings dashboard with instant search filter.
     - Optimistic auto-saving and secure SecretStorage token management with rollback.
   - Update `README.md` and `.brain/` state files (`brain.json`, `session.json`, `handover.md`).
3. **Production VSIX Packaging**:
   - Execute `npm run compile`.
   - Package production bundle: `antigravity-auto-plan-1.6.7.vsix` with production dependencies included.
   - Verify package integrity and size.
4. **Verification**:
   - Exactly one test file: `src/test/phase05_telegram_chat_toggle_release.test.ts`.
   - Ensure 100% of end-to-end regression tests pass.

## Implementation Details

### 1. Version Bump in `package.json`
```json
{
  "name": "antigravity-auto-plan",
  "version": "1.6.7"
}
```

### 2. Packaging Command
```bash
npx @vscode/vsce package --out antigravity-auto-plan-1.6.7.vsix
```

## Verification
- Run: `node out/test/phase05_telegram_chat_toggle_release.test.js`.
- Ensure all 4 regression suites pass.
