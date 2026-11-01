# Phase 05: Full End-to-End Regression, Packaging & Release Verification (v1.7.1)

Status: ✅ Completed
Test: `src/test/phase05_dom_bridge_full_regression_release.test.ts`

## Objective
Execute the complete test suite across the extension, verify end-to-end regression safety, bump the extension version to `v1.7.1`, and package the production `.vsix` ready for release.

## Scope
- Bump `package.json` version to `1.7.1`.
- Update `README.md` and changelog notes documenting the DOM Bridge injection hardening and Two-Phase Verification diagnostics.
- Run complete test suite (`npm test`) across all test phases.
- Build and bundle the extension package using `vsce package`.
- Verify `.vsix` archive integrity and contents.

## Requirements
1. **Version Alignment & Documentation**:
   - Update `version` in `package.json` to `1.7.1`.
   - Add changelog entry for `v1.7.1` in `README.md` highlighting:
     - Hardened chat input discovery with Code Editor tab exclusion.
     - Two-Phase Buffer Verification (Post-Paste Check).
     - Elimination of False Positive Proof 1 instant clearances.
     - Enhanced semantic telemetry and diagnostic reporting.
2. **Comprehensive Test Suite Regression**:
   - Run all existing unit, integration, and E2E tests (`npm test`).
   - Ensure 0 test failures and 0 unhandled promise rejections.
   - Run the dedicated regression test: `src/test/phase05_dom_bridge_full_regression_release.test.ts`.
3. **Clean Packaging**:
   - Execute production build: `npm run compile`.
   - Package `.vsix`: `npx @vscode/vsce package --no-dependencies` (or workspace standard script).
   - Validate that `antigravity-auto-plan-1.7.1.vsix` is cleanly generated and under 25MB.

## Constraints
- No regressions in Telegram integration, RPC Auto-Submit, Settings Webview, or Nudge Watchdog features.
- Zero git diff artifacts outside designated source and test files.

## Dependencies
- Source files: `package.json`, `README.md`, `media/autoplan-dom-bridge.js`.
- Test harness: `src/test/phase05_dom_bridge_full_regression_release.test.ts`.

## Acceptance Criteria
- `npm test` passes 100% of test files.
- `package.json` reflects version `1.7.1`.
- `antigravity-auto-plan-1.7.1.vsix` builds without errors or warnings.

## Comprehensive File-Based Test
- **File**: `src/test/phase05_dom_bridge_full_regression_release.test.ts`
- **Scope**:
  - Tests package.json version and metadata integrity.
  - Verifies presence and syntax of updated bridge scripts in distribution bundle.
  - End-to-end sanity check of DOM Bridge injection, verification, and diagnostics.

