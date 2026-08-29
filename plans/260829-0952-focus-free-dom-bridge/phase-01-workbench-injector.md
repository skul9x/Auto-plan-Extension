# Phase 01: Workbench HTML Injector & Safe Patcher

Status: ✅ Completed  
Dependencies: None  

## Objective
Implement a robust, cross-platform Workbench Injector (`src/workbenchInjector.ts`) that locates `workbench.html` in Antigravity IDE, VS Code, or Cursor across Windows, macOS, and Linux. It must safely inject and remove the `<script src="autoplan-dom-bridge.js"></script>` tag, manage automatic file backups (`workbench.html.autoplan.bak`), safely handle file permissions (with GUI elevation on Linux/macOS and admin guidance on Windows), clean up legacy injection scripts, and suppress editor corruption warning banners.

---

## Requirements

### Functional Requirements
1. **Dynamic Workbench Path Discovery**:
   - Detect `workbench.html` via `vscode.env.appRoot` across candidate directory layouts:
     * `out/vs/code/electron-sandbox/workbench/workbench.html`
     * `out/vs/code/electron-browser/workbench/workbench.html`
     * `out/vs/workbench/workbench.html`
     * `out/vs/code/browser/workbench/workbench.html`
     * `out/vs/code/electron-main/workbench/workbench.html`
   - Provide recursive fallback directory search with depth limiting (depth <= 6).
2. **Safe Idempotent HTML Script Injection**:
   - Inject `<script src="autoplan-dom-bridge.js?v={timestamp}"></script>` wrapped in unique HTML comment tags:
     ```html
     <!-- AUTO-PLAN-BRIDGE-START -->
     <script src="autoplan-dom-bridge.js?v=1740800000000"></script>
     <!-- AUTO-PLAN-BRIDGE-END -->
     ```
   - Inject before `</body>`, fallback before `</html>`, or append to file.
   - Ensure re-running injection updates the timestamp and template content without duplicating tags.
3. **Automated Backup & Safe Restore**:
   - Create a clean backup `workbench.html.autoplan.bak` prior to first modification.
   - Provide an uninstallation/restore function that cleanly reverts `workbench.html` to its original state.
4. **Elevated / Safe File Writing**:
   - Write files atomically via temp files (`.tmp-{timestamp}`).
   - Handle permission errors (`EACCES`, `EPERM`):
     * **Linux**: Auto-elevate via `pkexec` (native Linux authentication dialog).
     * **macOS**: Auto-elevate via `osascript` (native macOS authentication dialog).
     * **Windows**: Detect system directory restriction and prompt user with actionable notification ("Please restart IDE as Administrator to complete installation").
5. **Corruption Banner Suppression**:
   - Include auto-dismissal logic for VS Code's "Your Code installation is corrupt" notification toasts (matching `.notification-toast`, clicking `.codicon-close` / `.clear-notification-action`, or hiding element).

### Non-Functional Requirements
- **Reliability**: Zero risk of corrupting IDE startup if injection fails midway.
- **Cross-Platform**: Works identically on Windows, Linux, and macOS.

---

## Implementation Steps
1. Create `src/workbenchInjector.ts`.
2. Implement `getWorkbenchPath(customAppRoot?: string): string | null`.
3. Implement `writeFileElevated(filePath: string, content: string): void`.
4. Implement `isBridgeInstalled(htmlContent?: string): boolean`.
5. Implement `installBridgeScript(options?: InjectorOptions): { success: boolean; path?: string; error?: string }`.
6. Implement `uninstallBridgeScript(options?: InjectorOptions): { success: boolean; error?: string }`.
7. Implement `buildBridgeScriptContent(context: vscode.ExtensionContext): string`.
8. Implement `suppressCorruptBannerScript(): string`.
9. Create file-based unit test suite in `src/test/phase01_workbench_injector.test.ts`.

---

## Files to Create / Modify
- `src/workbenchInjector.ts` - [NEW] Core workbench locator, patcher, backup manager, and uninstaller.
- `src/test/phase01_workbench_injector.test.ts` - [NEW] File-based verification test suite.

---

## File-Based Test Specification (`src/test/phase01_workbench_injector.test.ts`)
The test file must comprehensively verify:
1. **Path Resolution**: Verifies `getWorkbenchPath()` correctly finds `workbench.html` in standard and non-standard candidate directory structures.
2. **Injection Correctness**: Verifies `installBridgeScript()` inserts valid HTML comment markers (`<!-- AUTO-PLAN-BRIDGE-START -->`) and `<script>` tag before `</body>` or `</html>`.
3. **Idempotency**: Verifies calling `installBridgeScript()` multiple times updates the version query parameter without creating duplicate tags.
4. **Uninstallation & Clean Revert**: Verifies `uninstallBridgeScript()` removes all injected markers and restores original HTML verbatim.
5. **Backup Resilience**: Verifies `.autoplan.bak` file creation and recovery if the active file is damaged.

---
Next Phase: [Phase 02: Local HTTP/IPC Bridge Server & Dispatch Protocol](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/plans/260829-0952-focus-free-dom-bridge/phase-02-bridge-server-protocol.md)
