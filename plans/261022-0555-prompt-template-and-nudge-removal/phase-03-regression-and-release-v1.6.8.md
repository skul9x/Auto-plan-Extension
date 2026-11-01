# Phase 03: Regression Benchmark, Documentation & Release Packaging (v1.6.8)

Status: ✅ Completed
Test: `src/test/phase03_release_v1_6_8.test.ts`

## Objective
Execute a comprehensive end-to-end regression validation covering the modernized prompt template, purged nudge watchdog behavior, 3-tier dispatching, and settings persistence, update all project documentation and metadata, bump version to `v1.6.8`, and verify production VSIX packaging.

## Scope
- End-to-end regression test suite verifying core system operation without nudge interference.
- Project version bump in `package.json` to `1.6.8`.
- Documentation updates in `README.md`, `CHANGELOG.md`, `.brain/brain.json`, and `.brain/session.json`.
- Production bundle verification for `antigravity-auto-plan-1.6.8.vsix`.

## Requirements
1. **End-to-End Regression Verification**:
   - Verify that prompt generation formats instructions correctly using the new prompt template from `newprompt.txt`.
   - Verify that phases run to completion when `Done skul9x.` is detected, with no mid-flight nudge prompts injected under any circumstance.
   - Verify that settings webview reads, filters, and saves settings accurately without references to nudge parameters.
   - Verify that Telegram bot commands (`/plans`, `/plan_status`, `/screen`, `/new_chat`, and AWF workflow shortcuts) remain 100% functional.
2. **Documentation & Brain Knowledge Updates**:
   - Update `CHANGELOG.md` with release notes for `v1.6.8`:
     - Feature: Modernized default phase prompt template with multi-step research, codebase inspection, and single-test verification workflow.
     - Remediation: Removal of 3-minute mid-flight nudge watchdog timer, configuration keys, and settings UI controls.
   - Update `README.md` to reflect the updated default prompt structure and clean configuration settings tables.
   - Update `.brain/brain.json` and `.brain/session.json` to record the completed migration, current version (`1.6.8`), and updated architecture state.
3. **Release Packaging**:
   - Ensure `npm run compile` completes with 0 errors.
   - Verify creation of `antigravity-auto-plan-1.6.8.vsix` via `vsce package`.
   - Validate that the package archive contains valid compiled output, runtime dependencies (`grammy`), and no extraneous development files.

## Constraints
- Zero regressions in existing prompt dispatch tiers (Tier 1 DOM Bridge, Tier 2 Workbench, Tier 3 Clipboard).
- Do not introduce new third-party dependencies.
- Follow existing versioning and packaging conventions.

## Dependencies
- Phase 01: Prompt Template Modernization & Schema Defaults.
- Phase 02: Nudge Watchdog Elimination & Settings UI Remediation.

## Acceptance Criteria
- Full regression test `src/test/phase03_release_v1_6_8.test.ts` passes 100%.
- `package.json` version is `1.6.8`.
- `CHANGELOG.md` and `README.md` accurately document changes for `v1.6.8`.
- `antigravity-auto-plan-1.6.8.vsix` is generated and valid.
- `.brain/session.json` and `.brain/handover.md` are refreshed with final release state.

## Comprehensive File-Based Test
- **File**: `src/test/phase03_release_v1_6_8.test.ts`
- **Scope**:
  - Validates package manifest version is `1.6.8` with updated configuration properties.
  - Validates end-to-end prompt formatting and completion keyword cycle using the new prompt template.
  - Validates that orchestrator handles mock long-running execution without mid-flight prompt interference.
  - Validates that documentation files (`CHANGELOG.md`, `README.md`) contain entries for `1.6.8`.
  - Validates VSIX packaging artifact integrity (ZIP structure, manifest, compiled bundle).
