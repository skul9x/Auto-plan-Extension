# Phase 04: Test Suite Remediation & Global Regression Validation
Status: ✅ Completed
Dependencies: Phase 01, Phase 02, Phase 03

## Objective
Update all existing test suites and fixtures that reference `autoApprovePermissions` or `startAutoApprovalObserver` across `src/test/`, ensuring the entire test suite passes cleanly, the project compiles without TypeScript diagnostics, and no regressions exist.

## Requirements
### Functional
- [x] Update `src/test/phase02_settings_webview_assets.test.ts`:
  - Remove `chkAutoApprovePermissions` from mock DOM element registry and dirty check tests.
  - Remove `autoApprovePermissions` from payload assertions.
- [x] Update `src/test/phase03_sidecar_config_watchdog.test.ts`:
  - Remove assertions asserting `autoApprovePermissions` existence on parsed default configs.
- [x] Update `src/test/phase05_full_e2e_regression.test.ts`:
  - Remove assertion `assert.ok(props['autoplan.autoApprovePermissions'])`.
  - Remove `autoApprovePermissions` from synthetic test config objects.
- [x] Update remaining test fixtures (`phase01_background_keepalive_engine.test.ts`, `phase01_dom_bridge_scoping_render_optimization.test.ts`, `phase04_background_automation_e2e.test.ts`, etc.) to clean up any obsolete autoApproval parameters.
- [x] Verify clean TypeScript build (`npm run compile`).

### Non-Functional
- [x] Zero compile-time errors or warnings regarding missing or extraneous configuration keys.
- [x] High test reliability and deterministic assertions.

## Implementation Steps
1. Refactor existing test files in `src/test/` to remove references to `autoApprovePermissions`.
2. Compile TypeScript project using `npm run compile`.
3. Create single comprehensive verification test `src/test/phase04_auto_approve_removal_regression_validation.test.ts`:
   - Validates that no production source file (`media/autoplan-dom-bridge.js`, `package.json`, `src/config.ts`, `src/extension.ts`, `media/settings/settings.html`, `media/settings/settings.js`) retains any references to `autoApprovePermissions` or `startAutoApprovalObserver`.
   - Executes the updated settings webview asset tests and sidecar config tests in memory to confirm 100% green status.

## Files to Create/Modify
- `src/test/phase02_settings_webview_assets.test.ts` - Remove obsolete mock assertions
- `src/test/phase03_sidecar_config_watchdog.test.ts` - Remove config watchdog assertions for autoApprove
- `src/test/phase05_full_e2e_regression.test.ts` - Remove schema contribution assertion
- Other test fixtures in `src/test/` as identified
- `src/test/phase04_auto_approve_removal_regression_validation.test.ts` - Single comprehensive verification test

## Test Criteria
- [x] `node out/test/phase04_auto_approve_removal_regression_validation.test.js` passes with code 0 (100% assertions verified).

---
Next Phase: None (Plan Complete)
