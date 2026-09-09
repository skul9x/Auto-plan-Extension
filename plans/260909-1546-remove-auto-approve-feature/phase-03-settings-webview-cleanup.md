# Phase 03: Settings Webview UI Cleanup
Status: ✅ Completed
Dependencies: Phase 02

## Objective
Remove the Auto-Approve toggle switch and corresponding UI elements from the full-screen Settings Webview panel (`media/settings/settings.html` and `media/settings/settings.js`), ensuring seamless UI rendering, correct dirty-state tracking, and error-free IPC serialization.

## Requirements
### Functional
- [x] Remove the checkbox element `#chkAutoApprovePermissions` and its container `<div class="setting-item">` from `media/settings/settings.html`.
- [x] In `media/settings/settings.js`:
  - Remove `const chkAutoApprovePermissions = document.getElementById('chkAutoApprovePermissions');`.
  - Remove `chkAutoApprovePermissions.checked` binding in `initSettings()`.
  - Remove `autoApprovePermissions` payload serialization in `collectCurrentSettings()`.
  - Remove `chkAutoApprovePermissions` from dirty tracking listeners in `setupEventListeners()`.
  - Remove `chkAutoApprovePermissions` from baseline state snapshots in `markAsClean()`.
  - Remove `chkAutoApprovePermissions` from dirty evaluation comparison in `checkDirty()`.

### Non-Functional
- [x] Settings panel loads with zero null pointer errors or unhandled DOM exceptions.
- [x] Dirty state banner (`Save Changes`) triggers accurately without false positives or missing updates.
- [x] Settings IPC message serialization to the Extension Host remains 100% compliant.

## Implementation Steps
1. Modify `media/settings/settings.html`:
   - Delete the setting item row containing `#chkAutoApprovePermissions`.
2. Modify `media/settings/settings.js`:
   - Remove all DOM references, initializers, collectors, and dirty checkers for `chkAutoApprovePermissions`.
3. Create single comprehensive verification test `src/test/phase03_settings_webview_auto_approve_removal.test.ts`:
   - Load `settings.html` in JSDOM, confirm absence of `#chkAutoApprovePermissions`.
   - Execute `settings.js` logic with mock webview environment, verifying `initSettings()`, `collectCurrentSettings()`, and dirty checks operate without errors or orphaned properties.

## Files to Create/Modify
- `media/settings/settings.html` - Remove auto-approve toggle checkbox HTML
- `media/settings/settings.js` - Remove state binding, dirty tracking, and IPC serialization
- `src/test/phase03_settings_webview_auto_approve_removal.test.ts` - Single comprehensive verification test

## Test Criteria
- [x] `node out/test/phase03_settings_webview_auto_approve_removal.test.js` passes with code 0 (100% assertions verified).

---
Next Phase: [Phase 04: Test Suite Remediation & Global Regression Validation](./phase-04-test-suite-remediation-and-validation.md)
