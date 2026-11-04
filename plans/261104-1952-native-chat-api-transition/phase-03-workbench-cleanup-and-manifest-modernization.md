# Phase 03: Workbench Cleanup & Package Manifest Modernization

Status: ✅ Completed  
Test: `src/test/phase03_workbench_cleanup_and_package_manifest.test.ts`

## Objective
Implement an automated cleanup routine that safely inspects and restores any previously modified `workbench.html` files by removing legacy bridge script tags, modernize `package.json` to register the native dispatch configurations, and deprecate obsolete extension commands.

## Scope
- Workbench restoration utilities in `src/workbenchInjector.ts`.
- Extension lifecycle activation hooks in `src/extension.ts`.
- Package manifest declarations in `package.json`.

## Requirements
### Functional
- **Automated Workbench Cleanup Routine**:
  - Implement an automated cleanup check executed on extension startup.
  - If legacy bridge tags (`TAG_START` / `TAG_END`) are detected in the active `workbench.html`, automatically strip them and safely restore the file to its original clean state.
  - If a backup file exists (`.autoplan.backup`), ensure the cleanup safely reconciles or preserves backup integrity without corrupting the active workbench.
  - Provide an explicit manual command `autoplan.cleanWorkbench` to allow users to trigger workbench restoration on demand.
  - Disable and deprecate automatic injection on startup (`autoInjectWorkbench`).
- **Package Manifest Modernization**:
  - Add configuration property `autoplan.sendDelayMs` with integer type, default value `500`, and user-friendly description.
  - Deprecate or remove configuration properties related to the obsolete tier architecture: `autoplan.executionMode`, `autoplan.allowTierFallback`, `autoplan.strictMode`, `autoplan.bridgeTimeoutMs`.
  - Clean up command contributions: remove commands intended for manual DOM bridge injection, add `autoplan.cleanWorkbench` and `autoplan.testNativeDispatch`.
  - Update menus and command palettes to remove obsolete Tier references.

### Non-Functional
- **Safety and Idempotency:** The cleanup routine must be strictly idempotent. Running cleanup multiple times on an already clean `workbench.html` must produce no changes, no file corruption, and no errors.
- **Fail-Safe Operation:** If file permissions prevent writing to `workbench.html` during auto-cleanup, log a diagnostic notice without crashing the extension or blocking extension activation.

## Constraints
- Never attempt to inject new scripts or tags into `workbench.html`.
- Maintain valid JSON formatting and schema compliance in `package.json`.

## Dependencies
- Phase 01: Core Dispatcher & Configuration Refactoring.
- Phase 02: Settings Webview & Sidebar UI Simplification.
- Files to modify:
  - `src/workbenchInjector.ts`
  - `src/extension.ts`
  - `package.json`

## Acceptance Criteria
- Extension startup inspects `workbench.html` and automatically removes any lingering DOM Bridge script tags without prompting for admin elevation if the file is writable.
- Running `autoplan.cleanWorkbench` on a modified workbench file removes tags cleanly and leaves valid HTML markup.
- Running cleanup on an already clean workbench file performs a no-op safely.
- `package.json` contributes `autoplan.sendDelayMs` and modern native dispatch commands while removing obsolete tier setup commands.
- The extension activates cleanly without warnings regarding missing command handlers or malformed configurations.

## Comprehensive File-Based Test
- **File**: `src/test/phase03_workbench_cleanup_and_package_manifest.test.ts`
- **Scope**:
  - Tests `src/workbenchInjector.ts` cleanup logic against mock `workbench.html` files containing legacy tags, asserting clean removal and idempotency.
  - Tests startup hook behavior in `src/extension.ts` when legacy tags are present vs when the file is already clean.
  - Validates `package.json` schema to ensure `autoplan.sendDelayMs` is correctly registered and deprecated tier commands/settings are modernized.

