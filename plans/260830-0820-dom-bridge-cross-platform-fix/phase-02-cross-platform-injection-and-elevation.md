# Phase 02: Cross-Platform Workbench Injection & Elevation

**Status:** ✅ Completed  
**Plan Reference:** `plans/260830-0820-dom-bridge-cross-platform-fix/plan.md`  
**Target Files:**
- `src/workbenchInjector.ts`
- `src/test/phase02_cross_platform_injection.test.ts`

---

## 1. Objective
Ensure that DOM Bridge injection, uninstallation, file permissions, and OS elevation work seamlessly and reliably across both **Windows** (PowerShell UAC) and **Linux** (Polkit `pkexec` with `chmod 644`), with robust path normalization, backup preservation, and checksum calculation.

---

## 2. Requirements

### Functional Requirements
- [x] Verify `buildWindowsElevationCommand()` correctly escapes PowerShell arguments and paths containing spaces.
- [x] Verify `buildLinuxElevationCommand()` properly formats `pkexec bash -c "cp ... && chmod 644 ..."` commands.
- [x] Verify `installBridgeScript()` and `uninstallBridgeScript()` maintain clean idempotency and backup files (`workbench.html.autoplan.bak`) across Linux (`/` forward slash) and Windows (`\` backslash) path formats.
- [x] Verify `updateProductChecksums()` accurately locates and updates `product.json` checksums on both platforms without corrupting JSON formatting.
- [x] Ensure `buildBridgeScriptContent()` correctly bundles the updated `media/autoplan-dom-bridge.js` without path resolution errors.

### Non-Functional Requirements
- [x] Non-blocking privilege elevation fallback.
- [x] Atomic file write safeguards with automatic cleanup of temporary `.tmp` files.

---

## 3. Implementation Steps
1. **Review & Harden `src/workbenchInjector.ts`**:
   - Audit cross-platform path handling (`path.join`, `path.normalize`, `path.sep`).
   - Validate elevation command strings and escaping for Linux (`pkexec`), macOS (`osascript`), and Windows (`powershell Start-Process`).
   - Confirm proper script synchronization between `media/autoplan-dom-bridge.js` and the IDE workbench directory.

2. **Implement File-Based Verification Test**:
   - Create `src/test/phase02_cross_platform_injection.test.ts`.
   - Test scenarios:
     - Injection and uninstallation lifecycle on mock Windows and Linux directory structures.
     - Linux elevation command builder syntax and permissions test (`chmod 644`).
     - Windows elevation command builder syntax and execution policy test.
     - Checksum calculation (`computeSha256Base64`) consistency on UTF-8 and CRLF/LF line endings.

---

## 4. Test Criteria & Verification
- [x] `src/test/phase02_cross_platform_injection.test.ts` passes 100% on Windows and Linux runtimes.
- [x] Bridge script injection and removal test correctly modifies `workbench.html` and creates/cleans up backup files.
- [x] Product checksum update logic verified against simulated `product.json`.

