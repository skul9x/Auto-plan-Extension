# Phase 01: Configuration Schema & Status Bar Cleanup

Status: ✅ Completed  
Dependencies: None  
Target Files: `package.json`, `src/config.ts`, `src/extension.ts`  
Primary Test File: `src/test/phase01_config_and_statusbar_cleanup.test.ts`

---

## 1. Objective

1. Define user-configurable settings for automatic phase retry upon `NewConversationTimeoutError`:
   - `autoplan.autoRetryOnTimeout` (default: `true`)
   - `autoplan.retryDelaySeconds` (default: `3`, range: `1-30`)
   - `autoplan.maxAutoRetries` (default: `5`, range: `1-20`)
2. Hide the redundant `🔌 Bridge: Active` item from the VS Code Status Bar on the bottom right (next to `Antigravity - Settings`), while keeping the item instance internally available for programmatic/diagnostic queries and existing test suites.

---

## 2. Requirements

### Functional
- [x] In `package.json`:
  - Add `autoplan.autoRetryOnTimeout` boolean configuration property (default: `true`, title: "Auto Retry On Timeout").
  - Add `autoplan.retryDelaySeconds` number configuration property (default: `3`, minimum: `1`, maximum: `30`).
  - Add `autoplan.maxAutoRetries` number configuration property (default: `5`, minimum: `1`, maximum: `20`).
- [x] In `src/config.ts`:
  - Extend `AutoPlanConfig` interface with `autoRetryOnTimeout?: boolean`, `retryDelaySeconds?: number`, and `maxAutoRetries?: number`.
  - Update `DEFAULT_CONFIG` with default values:
    - `autoRetryOnTimeout: true`
    - `retryDelaySeconds: 3`
    - `maxAutoRetries: 5`
  - In `getConfig()`: correctly extract and return these configuration values from `vscode.workspace.getConfiguration('autoplan')`.
- [x] In `src/extension.ts`:
  - In `updateBridgeStatusBar()`: replace `bridgeStatusBarItem.show()` with `bridgeStatusBarItem.hide()`, ensuring the item does not render onto the status bar row in the UI.
  - Retain `getBridgeStatusBarItem()` export so tests and background state inspection continue to operate without breaking changes.

### Non-Functional
- [x] Maintain full backwards compatibility for existing settings.
- [x] Keep TypeScript compilation strictly clean with zero type errors.

---

## 3. Implementation Steps

1. In `package.json`:
   - Append `autoplan.autoRetryOnTimeout`, `autoplan.retryDelaySeconds`, and `autoplan.maxAutoRetries` schemas to `contributes.configuration.properties`.
2. In `src/config.ts`:
   - Add fields to `AutoPlanConfig` interface and `DEFAULT_CONFIG`.
   - Update `getConfig()` mapping.
3. In `src/extension.ts`:
   - In `updateBridgeStatusBar()`, call `bridgeStatusBarItem.hide()` instead of `.show()`.
4. Implement `src/test/phase01_config_and_statusbar_cleanup.test.ts`:
   - Test 1: Verify `DEFAULT_CONFIG` has `autoRetryOnTimeout === true`, `retryDelaySeconds === 3`, `maxAutoRetries === 5`.
   - Test 2: Verify `getConfig()` reads defaults and custom overrides accurately.
   - Test 3: Verify `updateBridgeStatusBar()` sets correct text and properties but calls `hide()` instead of `show()`.

---

## 4. Verification Plan

- Run the single comprehensive test for this phase:
  ```bash
  npm run compile && node out/test/phase01_config_and_statusbar_cleanup.test.js
  ```
- Verify all assertions pass.
- Stop for user review.
