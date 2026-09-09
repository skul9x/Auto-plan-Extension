# Phase 02: Configuration & Schema Cleanup
Status: ✅ Completed
Dependencies: Phase 01

## Objective
Remove all configuration schemas, TypeScript interface properties, default configurations, and runtime config readers associated with `autoplan.autoApprovePermissions` across `package.json`, `src/config.ts`, `src/extension.ts`, and `README.md`.

## Requirements
### Functional
- [x] Remove `autoplan.autoApprovePermissions` configuration block from `package.json` contributes section.
- [x] Remove `autoApprovePermissions?: boolean;` from `AutoPlanConfig` interface in `src/config.ts`.
- [x] Remove `autoApprovePermissions: true` from `DEFAULT_CONFIG` in `src/config.ts`.
- [x] Remove `config.get<boolean>('autoApprovePermissions', ...)` in `src/config.ts`.
- [x] Remove `autoApprovePermissions: boolean;` from client config payload types in `src/extension.ts`.
- [x] Remove `autoApprovePermissions` initialization and parameter passing in `src/extension.ts`.
- [x] Remove `autoplan.autoApprovePermissions` entry from configuration table in `README.md`.

### Non-Functional
- [x] TypeScript compilation (`tsc -p ./`) succeeds with zero errors for production configuration and extension host modules.
- [x] Configuration serialization between Extension Host and Webview/Sidecar remains clean and valid.
- [x] No stale or deprecated config keys lingering in published manifests.

## Implementation Steps
1. Modify `package.json` to delete the `autoplan.autoApprovePermissions` schema entry.
2. Modify `src/config.ts` to remove `autoApprovePermissions` from interface, default object, and getter method.
3. Modify `src/extension.ts` to remove `autoApprovePermissions` from runtime interfaces and config dispatch objects.
4. Modify `README.md` to remove the auto-approve setting from the documentation table.
5. Create single comprehensive verification test `src/test/phase02_config_schema_auto_approve_removal.test.ts`:
   - Inspect `package.json` to verify `autoplan.autoApprovePermissions` is absent.
   - Inspect `DEFAULT_CONFIG` and `AutoPlanConfig` in compiled code to confirm absence of `autoApprovePermissions`.
   - Verify `README.md` does not advertise the removed setting.

## Files to Create/Modify
- `package.json` - Remove schema contribution
- `src/config.ts` - Remove TypeScript interface, default config, and getter
- `src/extension.ts` - Remove config payload propagation
- `README.md` - Update documentation
- `src/test/phase02_config_schema_auto_approve_removal.test.ts` - Single comprehensive verification test

## Test Criteria
- [x] `node out/test/phase02_config_schema_auto_approve_removal.test.js` passes with code 0 (100% assertions verified).

---
Next Phase: [Phase 03: Settings Webview UI Cleanup](./phase-03-settings-webview-cleanup.md)
