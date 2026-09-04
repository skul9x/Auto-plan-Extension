# Phase 02: Blind Keystroke Injection Guard & Window Focus Verification (LOGIC-005 Remediation)

Status: ✅ Completed  
Dependencies: Phase 01  
Target Files:
- `src/keyboardManager.ts`
- `src/test/phase02_blind_keystroke_injection_guard.test.ts`

---

## 1. Objective

Prevent blind OS keystroke injection into foreign applications. Ensure that Tier 3 OS automation (`KeyboardManager`) strictly validates that VS Code / Antigravity is the currently active OS foreground window prior to emitting shortcut keys (`Ctrl+Shift+L`, `Ctrl+A`, `Ctrl+V`, `Enter`). If an external application (e.g. bash terminal, web browser, messaging app) has focus, execution must be aborted immediately without modifying clipboard contents or dispatching keystrokes.

---

## 2. Root Cause Analysis (LOGIC-005)

1. When Tier 1 (DOM Bridge) and Tier 2 (Native Commands) fail, `PromptDispatcher` triggers Tier 3 (`KeyboardManager.executeBatchPromptFlow`).
2. Tier 3 automates input by placing prompt text into the system clipboard and executing a chained OS keystroke script:
   - On Linux: `xdotool key --clearmodifiers ctrl+shift+l sleep 0.8 key --clearmodifiers ctrl+a sleep 0.1 key --clearmodifiers ctrl+v sleep 0.15 key --clearmodifiers Return`
   - On Windows: PowerShell script using `WScript.Shell SendKeys` (`^+l`, `^a`, `^v`, `{ENTER}`)
3. Neither script inspects the currently active OS window before injecting key events.
4. If the user switches focus to another application (e.g. a terminal) during the 800ms delay, the script selects all text in the terminal (`Ctrl+A`), replaces it with the entire multi-line prompt via clipboard paste (`Ctrl+V`), and submits it (`Enter`), executing arbitrary lines of prompt text as live shell commands.

---

## 3. Technical Requirements

### 3.1. Active Window Verification & Error Definition (`src/keyboardManager.ts`)
1. Define and export dedicated error class:
   ```typescript
   export class ForeignWindowFocusError extends Error {
     public readonly detectedTitle: string;
     public readonly detectedProcess?: string;
     constructor(detectedTitle: string, detectedProcess?: string) {
       const procInfo = detectedProcess ? ` [process: ${detectedProcess}]` : '';
       super(`ForeignWindowFocusError: Active window is not VS Code (detected: "${detectedTitle}"${procInfo}). Keystroke injection aborted to prevent blind input corruption.`);
       this.name = 'ForeignWindowFocusError';
       this.detectedTitle = detectedTitle;
       this.detectedProcess = detectedProcess;
     }
   }
   ```
2. Implement cross-platform foreground window inspection:
   - **Linux**:
     - Query active window title: `xdotool getactivewindow getwindowname`
     - Query active window PID: `xdotool getactivewindow getwindowpid`
     - When `xdotool` is unavailable or running under Wayland, fallback to `xprop -root _NET_ACTIVE_WINDOW` or safe headless bypass.
   - **Windows**:
     - Query foreground window handle, process name, and window title via PowerShell Win32 `GetForegroundWindow` / `GetWindowThreadProcessId` / `Get-Process`.
   - **macOS**:
     - Query frontmost application process name and window title via AppleScript:
       `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`
3. Verify that the foreground window belongs to an approved editor instance:
   - Match BOTH process/application names and window titles against approved regex/patterns:
     - Application / process patterns: `code`, `electron`, `visual studio code`, `antigravity`, `vscodium`, `cursor`, `windsurf`
     - Window title patterns: `Visual Studio Code`, `Code`, `Antigravity`, `VSCodium`, `Cursor`, `Windsurf`
   - Or check that the active window PID matches `process.pid` or an ancestor/sibling process.
4. **Execution Order Guarantee**:
   - Active window verification MUST be executed **BEFORE** any clipboard modification (`this.copyToClipboard`) and **BEFORE** dispatching keystrokes.
   - If the active foreground window is NOT verified:
     - Abort execution immediately.
     - Throw `ForeignWindowFocusError`.
     - Do NOT overwrite the system clipboard with prompt text.
     - Do NOT emit any keypresses or paste events into the foreign window.

### 3.2. Testability & Dependency Injection
1. Add to `KeyboardManagerOptions` and `BatchPromptOptions`:
   - `activeWindowValidator?: () => Promise<{ isTarget: boolean; windowTitle: string; processName?: string; pid?: number }>`
   - `skipFocusCheck?: boolean` (defaults to false, allows skipping in headless CI containers without display servers).
2. Export `inspectActiveWindow(): Promise<{ isTarget: boolean; windowTitle: string; processName?: string; pid?: number }>` for direct unit verification.

---

## 4. Single Automated File-Based Test

Create `src/test/phase02_blind_keystroke_injection_guard.test.ts` to verify:
1. Setup standalone `vscode` module mock conforming to project test standards.
2. Initialize `KeyboardManager` with mock clipboard setter and mock batch sender to monitor all actions.
3. Test Case 1: Configure mock active window returning `windowTitle: "bash - Terminal"`, `processName: "gnome-terminal"`.
   - Verify `executeBatchPromptFlow` immediately throws `ForeignWindowFocusError`.
   - Verify clipboard setter was NEVER called (clipboard preserved).
   - Verify zero keystrokes were dispatched to the batch sender.
4. Test Case 2: Configure mock active window returning `windowTitle: "Google Chrome"`, `processName: "chrome"`.
   - Verify execution aborts immediately with `ForeignWindowFocusError`.
   - Verify clipboard setter was NEVER called.
5. Test Case 3: Configure mock active window returning `windowTitle: "extension.ts - Auto-plan-Extension-main - Visual Studio Code"`, `processName: "Code"`.
   - Verify execution proceeds normally: clipboard is primed and keystrokes are dispatched.
6. Test Case 4: Verify `instanceof ForeignWindowFocusError` accurately identifies thrown errors.
7. Test Case 5: Verify native window inspector function handles non-target windows or headless environments gracefully without crashing.

---

## 5. Verification Protocol

Run only this single test for verification:
```bash
npx tsc && node out/test/phase02_blind_keystroke_injection_guard.test.js
```

After running this single test, stop immediately for user review. Once completed, output `done.`.
