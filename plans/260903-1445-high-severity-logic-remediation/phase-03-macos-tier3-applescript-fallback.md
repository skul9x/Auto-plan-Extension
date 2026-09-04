# Phase 03: macOS Tier 3 AppleScript Keystroke Fallback (LOGIC-006 Remediation)

Status: ✅ Completed  
Dependencies: Phase 02  
Target Files:
- `src/keyboardManager.ts`
- `src/test/phase03_macos_tier3_applescript_fallback.test.ts`

---

## 1. Objective

Provide native macOS Tier 3 keyboard automation using AppleScript via `osascript`. Eliminate the unhandled platform exception (`Unsupported platform for keyboard automation: darwin`) so that macOS users benefit from reliable Tier 3 fallback without crashes when Tier 1 (DOM Bridge) and Tier 2 (Native Command) are unavailable.

---

## 2. Root Cause Analysis (LOGIC-006)

1. In `src/keyboardManager.ts` (`executeBatchPromptFlow`):
   ```typescript
   if (process.platform === 'win32') { ... }
   else if (process.platform === 'linux') { ... }
   else {
     throw new Error(`Unsupported platform for keyboard automation: ${process.platform}`);
   }
   ```
2. Although clipboard support (`copyToClipboard`) explicitly supports macOS via `/usr/bin/pbcopy`, keystroke execution was never implemented for macOS (`darwin`).
3. If Tier 1 and Tier 2 fail on macOS, PromptDispatcher switches to Tier 3, which throws an unhandled exception and halts the orchestrator loop, leaving the phase deadlocked.

---

## 3. Technical Requirements

### 3.1. AppleScript Command Generation & Architecture Parity (`src/keyboardManager.ts`)
1. Implement and export `buildDarwinBatchScript(options?: BatchPromptOptions, defaults?: BatchPromptOptions): string`:
   - Generate an AppleScript command sequence executed via `osascript`:
     - Open Chat shortcut: `keystroke "l" using {command down, shift down}`
     - Delay: `delay <focusDelaySec>`
     - Select All: `keystroke "a" using {command down}`
     - Delay: `delay <selectDelaySec>`
     - Paste: `keystroke "v" using {command down}`
     - Delay: `delay <pasteDelaySec>`
     - Return: `key code 36` (standard hardware virtual key code for Return on macOS, preferred over `keystroke return`)
   - Example script structure:
     ```applescript
     tell application "System Events"
       keystroke "l" using {command down, shift down}
       delay 0.8
       keystroke "a" using {command down}
       delay 0.1
       keystroke "v" using {command down}
       delay 0.15
       key code 36
     end tell
     ```
2. Implement and export `checkDarwinKeyboardPrerequisites()`:
   - Check if `/usr/bin/osascript` exists and is executable.
   - Return `{ available: boolean; binary: string | null; error?: string }`.
3. Implement and export `executeDarwinBatchPrompt(promptText: string, options?: BatchPromptOptions)`:
   - Maintain architectural symmetry with `executeLinuxBatchPrompt`.

### 3.2. macOS Platform Routing & Safe Execution (`src/keyboardManager.ts`)
1. In `executeBatchPromptFlow`:
   - Add branch for `process.platform === 'darwin'`:
     - Verify active foreground window first (Phase 02 guard).
     - Prime clipboard via `copyToClipboard(promptText)`.
     - Execute script safely without shell interpolation vulnerabilities:
       - Pipe script to `osascript` via `child_process.execFile('/usr/bin/osascript', ['-e', ...])` or stdin piping, avoiding raw multi-line template string quoting issues.
2. Provide actionable error translation:
   - If `osascript` throws error -1743 or message includes "Not authorized to send Apple events", translate to:
     `"macOS Accessibility permission denied: Antigravity/VS Code requires Accessibility permission to simulate keystrokes. Please enable it in: System Settings > Privacy & Security > Accessibility."`

---

## 4. Single Automated File-Based Test

Create `src/test/phase03_macos_tier3_applescript_fallback.test.ts` to verify:
1. Setup standalone `vscode` module mock conforming to project test standards.
2. Verify `buildDarwinBatchScript()` generates syntactically valid AppleScript containing `{command down, shift down}`, `key code 36`, and exact computed delay seconds.
3. Verify `checkDarwinKeyboardPrerequisites()` correctly detects osascript availability.
4. Verify platform routing in `executeBatchPromptFlow`:
   - When running with `platform === 'darwin'` (mocked or native), verify `executeBatchPromptFlow` does NOT throw `Unsupported platform for keyboard automation: darwin`.
   - Verify script is dispatched cleanly to custom/mock batch sender with expected actions.
5. Verify permission error translation:
   - Simulate `osascript` error -1743 ("Not authorized to send Apple events").
   - Verify error thrown contains clear actionable guidance pointing to `System Settings > Privacy & Security > Accessibility`.

---

## 5. Verification Protocol

Run only this single test for verification:
```bash
npx tsc && node out/test/phase03_macos_tier3_applescript_fallback.test.js
```

After running this single test, stop immediately for user review. Once completed, output `done.`.
