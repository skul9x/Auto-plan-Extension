# Phase 02: Full-Screen Settings Panel Webview UI & Assets

Status: ✅ Completed  
Dependencies: Phase 01  
Target Files:
- `media/settings/settings.html`
- `media/settings/settings.css`
- `media/settings/settings.js`
- `src/test/phase02_settings_webview_assets.test.ts`

---

## 1. Objective
Design and implement the front-end assets for a dedicated **Full-Screen Settings Panel** (`media/settings/settings.html`, `settings.css`, `settings.js`). Provide a rich, modern, glassmorphic UI adhering to VS Code light and dark theme design tokens, featuring interactive Tier selection cards, an animated fallback switch, live health status pills, interactive prompt template editor, and quick diagnostic action buttons.

---

## 2. Detailed Technical Requirements

### 2.1. Visual Design & Layout (`media/settings/settings.html` & `settings.css`)
1. **Container & Header**:
   - Sticky hero header with extension branding, version pill, overall health status badge, and global Save/Reset action bar.
   - Clean tabbed or segmented layout with responsive grid (desktop 2-column, tablet/mobile 1-column).
2. **Interactive Tier Selection Cards**:
   - Card 1: **Tier 1 (DOM Bridge)** — Badge: `⚡ Focus-Free & High Speed`. Description, active status indicator, port display, clients count.
   - Card 2: **Tier 2 (VS Code Native Commands)** — Badge: `🔌 Command API`. Description, command ID status.
   - Card 3: **Tier 3 (OS Keyboard Simulation)** — Badge: `⌨️ Universal Fallback`. Description, OS binary prerequisite status (`xdotool` on Linux / PowerShell on Windows).
   - Card 4: **Auto Mode (Smart 3-Tier Cascade)** — Badge: `🛡️ Recommended`. Primary DOM Bridge with automatic fallback.
3. **Fallback Policy Controls**:
   - Modern switch/toggle for `Allow Tier Fallback` with contextual explanation ("When disabled, Auto-Plan will stop immediately if your selected Tier fails").
4. **General & Execution Configuration Cards**:
   - **Timing & Loop Controls**: Delay between loops (ms), Timeout per loop (minutes), Repeat count, Keyboard focus delay (ms), Bridge timeout (ms).
   - **Plan & File Automation**: Default plan folder path picker, Auto-approve permissions toggle, Auto-inject workbench on startup toggle.
   - **Prompt Template Editor**: Rich multi-line textarea with dynamic placeholder buttons (`+ {xxx}`, `+ {file}`, `+ {path}`) that insert tags at cursor position.
   - **Completion Keyword**: Input for AI completion keyword with preset button (`Done skul9x.`).
5. **Live Diagnostics & Testing Section**:
   - Live transport health pills (Server Port, Injected status, Connected clients, OS toolchain).
   - "Test Selected Tier" button with animated spinner and live latency output badge.
   - "1-Click DOM Bridge Setup" button and "Uninstall Bridge" button.

### 2.2. Client-Side Scripting (`media/settings/settings.js`)
1. **State Management & Dirty Checking**:
   - Track original vs modified settings; update bottom floating/sticky save bar (`Saved` vs `Unsaved changes`).
   - Enable/disable Save button accordingly.
2. **IPC Communication with Extension Host**:
   - Acquire VS Code API: `const vscode = acquireVsCodeApi();`.
   - Send messages:
     - `ready`: Post initial ready signal on DOMContentLoaded / load to request current settings and health status.
     - `saveSettings`: Post updated configuration object to Extension Host.
     - `resetSettings`: Request default configuration.
     - `testTier`: Trigger diagnostic test for the selected tier (`auto`, `domBridge`, `nativeCommand`, `keyboard`).
     - `setupBridge`: Trigger 1-Click DOM Bridge setup.
     - `uninstallBridge`: Trigger DOM bridge uninstallation.
     - `openFolderPicker`: Request workspace folder selection for default plan folder.
   - Handle incoming messages:
     - `initSettings`: Populate UI form fields with active configuration.
     - `healthUpdate`: Update live health pills and client counts.
     - `testResult`: Display latency/status of tier dispatch test with pass/fail indicator.
     - `saveConfirmed`: Reset dirty state and show success toast.
     - `folderSelected`: Update `txtDefaultPlanFolder` input value with chosen directory path.
     - `error`: Display error notification alert.

---

## 3. Implementation Tasks
- [x] Task 2.1: Create `media/settings/settings.html` with semantic structure, accessibility labels, and strict CSP placeholders.
- [x] Task 2.2: Create `media/settings/settings.css` with VS Code CSS variable bindings, glassmorphism, responsive breakpoints, and animations.
- [x] Task 2.3: Create `media/settings/settings.js` implementing state tracking, dirty-checking, tier selection cards, and IPC message handlers.
- [x] Task 2.4: Create comprehensive standalone verification test `src/test/phase02_settings_webview_assets.test.ts`.

---

## 4. Verification Test Suite: `src/test/phase02_settings_webview_assets.test.ts`
The test file must verify:
1. **HTML Structure & CSP Compatibility**:
   - Verify `settings.html` contains all required input IDs (`optTierAuto`, `optTier1`, `optTier2`, `optTier3`, `chkAllowFallback`, `txtDelayMs`, `txtTimeoutMinutes`, `txtPromptTemplate`, `txtCompletionKeyword`, `btnSave`, `btnReset`, `btnTestTier`).
   - Verify absence of unsafe inline scripts (uses nonce / external script references).
2. **CSS Token Coverage & Responsiveness**:
   - Verify `settings.css` binds to standard VS Code theme variables (`--vscode-editor-background`, `--vscode-button-background`, etc.).
   - Verify media queries exist for responsive grid adaptations.
3. **JS Logic & IPC Serialization**:
   - Verify JS logic parses configuration payloads and generates valid message structures for `saveSettings`, `testTier`, and `setupBridge`.
   - Verify template helper insertions place `{xxx}`, `{file}`, `{path}` correctly into template text.

---

## 5. Exit Criteria
- `npm run compile` succeeds with zero errors.
- `node out/test/phase02_settings_webview_assets.test.js` passes 100% assertions.
