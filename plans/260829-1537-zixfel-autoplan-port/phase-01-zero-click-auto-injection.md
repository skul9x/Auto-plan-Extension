# Phase 01: Zero-Click Startup Auto-Injection & Auto-Repair

Status: ✅ Completed
Completed At: 2026-08-29T15:39:10Z
Dependencies: None

## Objective
Implement background zero-click auto-detection and silent injection/repair of the DOM Bridge script during extension activation, removing the requirement for end-users to manually execute `autoplan.oneClickSetup`.

## Requirements
### Functional
- Automatically invoke `isBridgeInstalled()` upon `activate()` in `src/extension.ts`.
- If DOM Bridge tags are absent or missing from `workbench.html` (e.g. after IDE updates), execute `installBridgeScript({ updateChecksums: true })` silently in the background.
- Ensure auto-repair is idempotent and avoids redundant file writes when DOM Bridge is already injected and valid.

### Non-Functional
- Execution time on activation must complete in < 50ms when bridge is already installed.
- Maintain existing backup creation (`workbench.html.autoplan.bak`) and product checksum updating.

## Implementation Steps
1. Modify `src/extension.ts` inside `activate()`:
   - Add automated check `if (!isBridgeInstalled()) { installBridgeScript({ updateChecksums: true }); }`.
   - Update bridge status bar item state post-injection.
2. Create single file-based test suite `src/test/phase01_zero_click_auto_injection.test.ts`:
   - Test 1: Verify clean workbench HTML triggers zero-click auto-injection on mock activation.
   - Test 2: Verify already injected workbench HTML avoids redundant re-injection.
   - Test 3: Verify backup file creation and script tag presence.

## Files to Create/Modify
- `src/extension.ts` - Modify `activate()` to add zero-click background bridge check.
- `src/workbenchInjector.ts` - Ensure `isBridgeInstalled()` handles silent checks safely.
- `src/test/phase01_zero_click_auto_injection.test.ts` - Comprehensive single file-based test suite.

## Test Criteria
- `node out/test/phase01_zero_click_auto_injection.test.js` passes 100%.

---
Next Phase: [Phase 02: Silent Fallback & Non-Intrusive Error Handling](phase-02-silent-fallback-handling.md)
