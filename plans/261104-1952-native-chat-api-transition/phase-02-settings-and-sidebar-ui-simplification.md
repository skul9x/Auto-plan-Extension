# Phase 02: Settings Webview & Sidebar UI Simplification

Status: ✅ Completed  
Test: `src/test/phase02_native_ui_and_settings_simplification.test.ts`

## Objective
Streamline the Settings Webview, Sidebar UI, and Status Bar by removing legacy tier cards, tier fallback toggles, and 1-click DOM injection controls, replacing them with a clean "Native Dispatch" management interface and clear engine health indicators.

## Scope
- Settings Webview markup and client script: `media/settings/settings.html`, `media/settings/settings.js`.
- Settings Webview provider backend: `src/settingsWebviewProvider.ts`.
- Sidebar Webview markup and provider: `media/sidebar/sidebar.html`, `media/sidebar/sidebar.js`, `src/sidebarProvider.ts`.
- Status bar presentation in `src/extension.ts`.

## Requirements
### Functional
- **Settings UI Redesign (Option A Minimalist)**:
  - Transform the tab header from "Dispatch & Tiers" to "Native Dispatch".
  - Remove the 4 Tier cards (Tier 1 DOM Bridge, Tier 2 Native Command, Tier 3 OS Keyboard, Tier 4 Reserved).
  - Remove obsolete controls: "Enable Tier Fallback" switch, "Strict Mode" switch, and the "1-Click DOM Bridge Setup" button.
  - Present an Antigravity Native Engine status badge indicating runtime readiness (e.g., `🟢 Antigravity Native Engine: Ready`).
  - Provide an input field for `Send Delay (ms)` bound to `autoplan.sendDelayMs` with live validation and persistence.
  - Provide a `[🧪 Test Send Prompt]` action button that triggers a sample native dispatch test from the UI.
- **Sidebar & Status Bar Simplification**:
  - Update sidebar header indicators to display the Native Dispatch status instead of DOM Bridge client counts.
  - Remove obsolete "⚡ DOM Bridge" action buttons and diagnostic dialog triggers from the sidebar.
  - Update extension status bar items in `src/extension.ts` to reflect Native Engine readiness cleanly and compactly.
- **IPC Message Protocol Alignment**:
  - Update webview-to-extension messages in `src/settingsWebviewProvider.ts` to handle native test dispatch requests and delay settings updates, cleanly ignoring or removing deprecated tier control messages.

### Non-Functional
- **Usability:** Eliminate visual clutter and eliminate user confusion around obsolete tier configurations.
- **Responsiveness:** Settings updates and test dispatch actions must provide immediate visual feedback in the UI without freezing.

## Constraints
- Preserve existing styling themes (VS Code CSS variables) across all modified webview templates.
- Maintain existing non-tier tabs (General, Execution & Timeouts, Telegram Remote, Plan Rules) without functional regressions.

## Dependencies
- Phase 01: Core Dispatcher & Configuration Refactoring (`src/config.ts`, `src/promptDispatcher.ts`).
- Files to modify:
  - `media/settings/settings.html`
  - `media/settings/settings.js`
  - `src/settingsWebviewProvider.ts`
  - `media/sidebar/sidebar.html`
  - `media/sidebar/sidebar.js`
  - `src/sidebarProvider.ts`
  - `src/extension.ts`

## Acceptance Criteria
- Settings page contains the "Native Dispatch" tab with no trace of legacy 4 Tier cards or fallback toggles.
- Changing the `Send Delay (ms)` input persists the value into workspace configuration.
- Clicking `[Test Send Prompt]` sends a test dispatch message to the extension backend and reports results back to the webview.
- Sidebar reflects Native Engine readiness without displaying DOM Bridge injection buttons.
- Status bar displays simplified, relevant engine status.

## Comprehensive File-Based Test
- **File**: `src/test/phase02_native_ui_and_settings_simplification.test.ts`
- **Scope**:
  - Parses `settings.html` to verify absence of tier cards, tier fallback checkboxes, and injection buttons, and asserts presence of the Native Dispatch tab, send delay field, and test dispatch button.
  - Validates `settings.js` and `src/settingsWebviewProvider.ts` message handling contracts for test dispatch and configuration updates.
  - Parses `sidebar.html` to confirm removal of obsolete DOM Bridge controls and validates updated sidebar status rendering logic.

