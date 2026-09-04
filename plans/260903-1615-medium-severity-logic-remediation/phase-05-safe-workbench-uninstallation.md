# Phase 05: Safe In-Place Workbench Uninstallation & Stale Backup Elimination (LOGIC-012 Remediation)

Status: ✅ Completed  
Dependencies: Phase 04  
Target Files:
- `src/workbenchInjector.ts`
- `src/test/phase05_safe_workbench_uninstallation.test.ts`

---

## 1. Objective

Prevent VS Code white-screen launch crashes and broken installations caused by restoring obsolete backup files during bridge uninstallation. Replace stale `.bak` file restoration with reliable in-place AST/regex script tag extraction directly from the active `workbench.html`. Ensure that updates to VS Code (e.g. newer HTML templates, updated bundle script tags, and fresh integrity checksums) are preserved intact upon uninstallation, while cleaning up any lingering backup and sidecar files.

---

## 2. Root Cause Analysis (LOGIC-012)

1. In `src/workbenchInjector.ts`:
   ```typescript
   export function uninstallBridgeScript(options: InjectorOptions = {}): UninstallationResult {
     ...
     const backupPath = `${wbPath}${BACKUP_SUFFIX}`;
     let restoredContent: string;

     if (fs.existsSync(backupPath)) {
       const backupRaw = fs.readFileSync(backupPath, 'utf8');
       restoredContent = removeBridgeTagsFromHtml(backupRaw);
       try { fs.unlinkSync(backupPath); } catch {}
     } else {
       const currentRaw = fs.readFileSync(wbPath, 'utf8');
       restoredContent = removeBridgeTagsFromHtml(currentRaw);
     }

     writeFileElevated(wbPath, restoredContent);
     ...
   ```
2. When the user installs the DOM bridge, `workbench.html.autoplan.bak` is created.
3. If VS Code is subsequently upgraded (e.g. from version 1.88 to 1.89), VS Code updates `workbench.html` to point to new chunk hashes and script bundles.
4. However, the existing `workbench.html.autoplan.bak` file remains untouched from version 1.88.
5. If the user later triggers "Uninstall Bridge", `uninstallBridgeScript` (or `uninstallBridgeScriptAsync`) detects `fs.existsSync(backupPath)` and overwrites `workbench.html` with `backupRaw` from version 1.88.
6. The updated VS Code 1.89 installation now has a 1.88 `workbench.html`.
7. When VS Code starts, Electron cannot find the obsolete 1.88 JavaScript bundles, resulting in an unrecoverable blank white screen.

---

## 3. Technical Requirements

### 3.1. In-Place Tag Extraction on Uninstallation (`src/workbenchInjector.ts`)
1. In both `uninstallBridgeScript()` and `uninstallBridgeScriptAsync()`:
   - Always read the **current** content of `wbPath`:
     ```typescript
     const currentRaw = fs.readFileSync(wbPath, 'utf8'); // or await fs.promises.readFile(...)
     ```
   - Strip only the Auto-Plan DOM bridge tags using `removeBridgeTagsFromHtml(currentRaw)`.
   - Write the cleaned content directly back to `wbPath`.
   - Never write content from `backupPath` into `wbPath`.
2. Unlink the backup file if it exists (`fs.unlinkSync(backupPath)` / `await fs.promises.unlink(backupPath)`) to prevent stale artifacts from remaining on disk.
3. Unlink the sidecar script file (`autoplan-dom-bridge.js`) from the workbench directory.
4. Update product checksums if required.

### 3.2. Backup Freshness Synchronization on Installation
1. In `installBridgeScript()` and `installBridgeScriptAsync()`:
   - When checking `backupPath`: if `backupPath` exists, ensure it is not preserved if the current active `workbench.html` is from a newer version.
   - Always derive the backup from the current clean content:
     ```typescript
     const cleanOriginalContent = removeBridgeTagsFromHtml(rawContent);
     ```
   - Only write backup if `!fs.existsSync(backupPath)` or `options.forceBackup` is set, but ensure uninstallation does not rely on it for content restoration.

---

## 4. Implementation Steps

1. [x] In `src/workbenchInjector.ts`, modify `uninstallBridgeScript` to read the active `workbench.html`, strip the bridge tags in-place, and remove `backupPath`.
2. [x] In `src/workbenchInjector.ts`, modify `uninstallBridgeScriptAsync` to apply the same safe in-place restoration asynchronously.
3. [x] Verify that both functions cleanly unlink any sidecar `autoplan-dom-bridge.js` files and recalculate product checksums.
4. [x] Ensure installation methods keep backup files synchronized without compromising future uninstallation.

---

## 5. Single Automated File-Based Test

Create `src/test/phase05_safe_workbench_uninstallation.test.ts` to verify:
1. Create a simulated VS Code v1.88 `workbench.html` file in a temporary folder.
2. Run `installBridgeScript()` to inject the bridge and generate the initial backup file.
3. Simulate a VS Code update to v1.89:
   - Overwrite the temporary `workbench.html` with v1.89 markup containing new bundle script tags (`workbench.desktop.main.v189.js`, new CSS links, new meta tags) plus the existing injected bridge tag.
   - Intentionally leave the v1.88 backup file untouched on disk.
4. Run `uninstallBridgeScript()` (and `uninstallBridgeScriptAsync()`).
5. Assert that:
   - The resulting `workbench.html` contains the v1.89 bundle scripts and markup.
   - The resulting `workbench.html` does NOT contain the obsolete v1.88 script bundles.
   - The Auto-Plan bridge script tags (`TAG_START` to `TAG_END`) are completely removed.
   - The obsolete `.bak` file is cleanly deleted.
   - The sidecar `autoplan-dom-bridge.js` file is deleted.
6. Clean up temporary test files.

---

## 6. Verification Protocol

Run only this single test for verification:
```bash
npx tsc && node out/test/phase05_safe_workbench_uninstallation.test.js
```

After running this single test, stop immediately for user review. Once completed, output `done.`.
