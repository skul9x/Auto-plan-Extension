# Phase 04: Export Diagnostics Commands & Webview 1-Click Integration

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02, Phase 03  
Target Files:
- `src/extension.ts`
- `src/settingsProvider.ts`
- `src/sidebarProvider.ts`
- `media/settings/settings.html`
- `media/settings/settings.js`
- `media/settings/settings.css`
- `media/sidebar/sidebar.html`
- `media/sidebar/sidebar.js`
- `package.json`
- `src/test/phase04_export_diagnostics_e2e.test.ts`

---

## Objective
Implement user-facing diagnostic export commands (`autoplan.copyDebugLog`, `autoplan.exportDebugLog`, `autoplan.clearDebugLog`, `autoplan.showOutputChannel`), integrate an interactive Diagnostics & Live Log Viewer section into the Full-Screen Settings Panel, add quick-copy actions to the Sidebar, and enhance failure notifications with 1-click debug log copy triggers.

## Requirements

### Functional Requirements
1. **VS Code Command Registrations**:
   - Register `autoplan.copyDebugLog`:
     - Compiles the full environment report + DOM bridge telemetry + in-memory log buffer.
     - Writes to clipboard via `vscode.env.clipboard.writeText(report)`.
     - Displays confirmation toast: `✅ DOM Bridge Debug Log copied to clipboard! (Ready to paste into chat)`.
   - Register `autoplan.exportDebugLog`:
     - Compiles diagnostic report and saves to workspace root (`dom-bridge-debug.txt`) or prompts user via `vscode.window.showSaveDialog`.
     - Opens the exported file in an active VS Code text editor tab (`vscode.window.showTextDocument`).
   - Register `autoplan.clearDebugLog`:
     - Clears the in-memory ring buffer and refreshes active webview panels.
   - Register `autoplan.showOutputChannel`:
     - Focuses and reveals the `Auto-Plan DOM Bridge` Log Output Channel.
2. **Settings Panel Webview Integration (`media/settings/`)**:
   - Add a dedicated **"DOM Bridge Diagnostics & Live Log Viewer"** Card to `settings.html`:
     - Action buttons:
       - `📋 Copy Full Debug Log`
       - `💾 Save Log to File (.txt)`
       - `📺 Show Output Channel`
       - `🗑️ Clear Log Buffer`
     - Collapsible **Live Log Viewer Console**:
       - Displays incoming log entries in real-time with color-coded badges (`[DEBUG]`, `[INFO]`, `[WARN]`, `[ERROR]`, `[CLIENT]`, `[SERVER]`, `[DOM]`).
       - Controls for level filtering (`All`, `Warn/Error Only`) and auto-scroll toggle.
   - Handle IPC messages in `SettingsProvider`:
     - `copyDebugLog`, `exportDebugLog`, `clearDebugLog`, `showOutputChannel`, `requestLogBuffer`.
     - Push live log updates via `logEntry` and `logBuffer` messages to the webview.
3. **Sidebar Control Center Integration (`src/sidebarProvider.ts` / `media/sidebar/`)**:
   - Add a quick action button `📋 Copy Bridge Log` inside the Sidebar diagnostics area.
4. **Actionable Failure Notifications**:
   - When Tier 1 DOM Bridge encounters an error or timeout during plan execution, include an action button `📋 Copy Diagnostic Log` and `⚙️ Open Settings` directly in the error/warning toast.
   - Clicking `📋 Copy Diagnostic Log` executes `autoplan.copyDebugLog` without requiring the user to open settings or menus.
5. **Package Manifest & Extension Lifecycle**:
   - Declare commands, titles, categories (`Auto-Plan`), and icons in `package.json`.
   - Ensure proper cleanup and disposal of logger listeners and commands on extension deactivation.

### Non-Functional Requirements
- Instant user feedback (< 100ms) on clipboard operations.
- Clean text formatting in exported reports for effortless copying into AI chats or issue trackers.

## Files to Create / Modify
- `src/extension.ts` - Register export/copy/clear/channel commands and notification action handlers.
- `src/settingsProvider.ts` - Handle diagnostic log webview messages, log buffer requests, and live streaming.
- `src/sidebarProvider.ts` - Handle quick-copy action from sidebar webview.
- `media/settings/settings.html`, `media/settings/settings.js`, `media/settings/settings.css` - UI controls and live log viewer console.
- `media/sidebar/sidebar.html`, `media/sidebar/sidebar.js` - Quick-copy button.
- `package.json` - Command contributions and activation events.

## Verification Test
- **Single Test**: `src/test/phase04_export_diagnostics_e2e.test.ts`
- **Validation Scope**:
  - Verify `autoplan.exportDebugLog` formats and writes complete reports to disk and opens editor tab.
  - Verify `autoplan.copyDebugLog` successfully formats and copies text to clipboard.
  - Verify `autoplan.clearDebugLog` resets log entries.
  - Verify `SettingsProvider` handles all diagnostic message types (`copyDebugLog`, `exportDebugLog`, `clearDebugLog`, `showOutputChannel`).
  - Verify error notification action triggers direct diagnostic log clipboard copy.
