# Phase 01: Cross-Platform Elevation & Linux Keyboard Adapter

Status: 🟢 Completed  
Dependencies: None  
Target Files:
- `src/workbenchInjector.ts`
- `src/keyboardManager.ts`
- `src/test/phase01_cross_platform_elevation_keyboard.test.ts`

---

## 1. Objective
Implement automated, zero-terminal graphical privilege elevation for both **Linux** (Polkit `pkexec`) and **Windows** (PowerShell `Start-Process -Verb runAs`), fix `product.json` checksum patching to avoid "installation corrupt" dialogs, and equip `keyboardManager.ts` with native Linux input simulation using `xdotool`.

---

## 2. Detailed Technical Requirements

### 2.1. Cross-Platform Elevation in `src/workbenchInjector.ts`
1. **Linux Polkit Elevation (`pkexec`)**:
   - When writing to protected locations (such as `/usr/share/antigravity/` or `/opt/antigravity/`), write payload to a temporary file in `os.tmpdir()`.
   - Invoke `pkexec bash -c "cp '<tmpPath>' '<targetPath>' && chmod 644 '<targetPath>'"` to trigger the standard desktop graphical authentication dialog (GNOME / KDE / XFCE).
   - Ensure clean error handling if the user dismisses or cancels the Polkit dialog.
2. **Windows UAC Elevation (`powershell -Verb runAs`)**:
   - Write payload to temporary file.
   - Execute elevated copy command: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb runAs -ArgumentList '-NoProfile -NonInteractive -Command Copy-Item -LiteralPath \\\"<tmpPath>\\\" -Destination \\\"<targetPath>\\\" -Force' -Wait"`.
3. **`product.json` Checksum Auto-Patcher**:
   - Read `product.json` in the IDE root.
   - Compute SHA256 checksum (base64 encoded, trailing '=' trimmed) of the patched `workbench.html` and update `checksums['vs/code/electron-sandbox/workbench/workbench.html']`.
   - Write updated `product.json` using `writeFileElevated` to handle root/admin permissions.

### 2.2. Linux Keyboard Input Adapter in `src/keyboardManager.ts`
1. **Linux `xdotool` Keyboard Synthesis**:
   - Implement `executeLinuxBatchPrompt(promptText: string, options?: BatchPromptOptions): Promise<void>`.
   - Implement single-process chained command builder: `buildLinuxBatchScript(options?: BatchPromptOptions): string`:
     - Calculates fractional seconds: `focusSec = (focusDelayMs / 1000).toFixed(3)`, `selectSec = (selectDelayMs / 1000).toFixed(3)`, `pasteSec = (pasteDelayMs / 1000).toFixed(3)`.
     - Single atomic chain: `xdotool key --clearmodifiers ctrl+shift+l sleep ${focusSec} key --clearmodifiers ctrl+a sleep ${selectSec} key --clearmodifiers ctrl+v sleep ${pasteSec} key --clearmodifiers Return`.
   - Flow:
     - Write prompt text to OS system clipboard via `vscode.env.clipboard.writeText(promptText)` (with fallback to `xclip -selection clipboard` / `xsel --clipboard --input`).
     - Execute the atomic `xdotool` command sequence via `child_process.exec`.
2. **Linux Tooling Prerequisite Check**:
   - Implement `checkLinuxKeyboardPrerequisites(): { available: boolean; binary: string | null; error?: string }`.
   - Execute `which xdotool` (or check system `$PATH`). Return true if executable exists in system `$PATH`.
3. **Platform Routing**:
   - Route `executeBatchPromptFlow()`:
     - `process.platform === 'win32'`: Call Windows PowerShell `WScript.Shell.SendKeys` / `Forms.SendKeys` batch.
     - `process.platform === 'linux'`: Call Linux atomic `xdotool` chain.
     - Unsupported platforms: Throw clear descriptive exception.

---

## 3. Implementation Tasks
- [x] Task 1.1: Refactor `writeFileElevated` in `src/workbenchInjector.ts` with dedicated Linux (`pkexec`) and Windows (`runAs`) handlers.
- [x] Task 1.2: Add SHA256 checksum computation and `product.json` updater in `src/workbenchInjector.ts`.
- [x] Task 1.3: Add `checkLinuxKeyboardPrerequisites()` and `executeLinuxBatchPrompt()` in `src/keyboardManager.ts`.
- [x] Task 1.4: Update `executeBatchPromptFlow()` in `src/keyboardManager.ts` to support both Windows and Linux OS keyboard synthesis.
- [x] Task 1.5: Create standalone verification test `src/test/phase01_cross_platform_elevation_keyboard.test.ts`.

---

## 4. Verification Test Suite: `src/test/phase01_cross_platform_elevation_keyboard.test.ts`
The test file must verify:
1. **Elevation Command Generation**:
   - Verify generated Linux elevation command uses valid `pkexec bash -c` escaping.
   - Verify generated Windows elevation command uses valid `Start-Process powershell -Verb runAs` syntax.
2. **Product.json Checksum Calculation**:
   - Verify SHA256 base64 hashing matches standard crypto outputs.
3. **Linux `xdotool` Detection & Sequence Generation**:
   - Mock `execSync` / `exec` calls to test both when `xdotool` is present and absent.
   - Validate constructed `xdotool key --clearmodifiers` command chains.
4. **Platform-Switching Logic**:
   - Ensure Windows runs PowerShell logic and Linux runs xdotool logic without throwing unrecognized OS errors.

---

## 5. Exit Criteria
- [x] `npm run compile` succeeds with zero TypeScript compilation errors.
- [x] `node out/test/phase01_cross_platform_elevation_keyboard.test.js` passes 100% assertions.
