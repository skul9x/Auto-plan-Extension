# Phase 04: Smart QuickPick UI & Interactive Status Bar UX
Status: ✅ Completed
Dependencies: Phase 01, Phase 02, Phase 03

## Objective
Implement a top-tier VS Code UI/UX workflow. Replace manual text input with a **Smart 2-Tier QuickPick Folder Picker** (auto-detecting active files, workspace `plans/`, and recent history), add pre-flight phase preview confirmation, position the interactive Status Bar at the bottom-right (`StatusBarAlignment.Right`, priority 100), and wire rich tooltips and running action menus.

## Requirements
### Functional
- [x] **Smart 2-Tier QuickPick Folder Picker (`autoplan.start`)**:
  When the user triggers Auto-Plan, present a curated `vscode.window.showQuickPick` menu:
  1. **Active Editor Detection**: If the currently active document is inside a plan directory (e.g. `plans/.../phase-01.md`), display it as the primary option:
     `$(star) Active Plan: <folder-name> (N phases)`
  2. **Workspace Discovery**: Automatically scan `plans/*` within all active workspace folders and list valid candidates with phase counts:
     `$(folder) plans/<folder-name> (N phases)`
  3. **Recent History**: Display previously run plan folders stored in `workspaceState` / `globalState`:
     `$(history) <path>`
  4. **Native File Browser**: `$(folder-opened) Browse Folder from Disk...` -> Opens OS folder selector via `vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false })`.
  5. **Manual Entry Fallback**: `$(edit) Enter Path Manually...` -> Opens `vscode.window.showInputBox` prefilled with the last used path.
- [x] **Pre-Flight Preview Confirmation**:
  - Scan the chosen folder with `PlanScanner`.
  - If 0 phases found, show error warning and return to picker.
  - If valid phases found, display confirmation notification / quick modal:
    `Auto-Plan: Found N phases in "<folder>". Ready to start?`
    Options: `[▶️ Start Auto-Run]`, `[⚙️ Settings]`, `[Cancel]`.
  - Persist selected folder path in `context.workspaceState` (`lastPlanFolder`) and `context.globalState` (`recentPlanFolders`).
- [x] **Bottom-Right Interactive Status Bar**:
  - Created with `vscode.window.createStatusBarItem('autoplan.statusBar', vscode.StatusBarAlignment.Right, 100)`.
  - **Idle State**:
    - Text: `$(rocket) Auto-Plan`
    - Tooltip: `Auto-Plan: Click to select plan folder and run`
    - Command: `autoplan.start`
  - **Running State**:
    - Text: `$(sync~spin) Auto-Plan: [X/Y] <phase-filename>`
    - Command: `autoplan.actionMenu`
    - Markdown Tooltip:
      ```markdown
      ### 🚀 Auto-Plan Runner
      - **Folder:** `<folder-name>`
      - **Progress:** Phase X of Y (Z%)
      - **Current Phase:** `<phase-filename>`
      - **Status:** Waiting for Agent completion...
      - **Elapsed Time:** mm:ss
      ```
  - **Completion State**:
    - Display `$(check) Auto-Plan (Done)` briefly, show toast notification: `🎉 Auto-Plan: Successfully completed all N phases!`, then restore Idle state.
- [x] **Running Action Menu (`autoplan.actionMenu`)**:
  Clicking the status bar while Auto-Plan is running opens an instant QuickPick:
  - `$(stop) Stop Auto-Plan` -> Aborts orchestrator immediately.
  - `$(debug-step-over) Skip Current Phase` -> Advances to next phase immediately.
  - `$(output) Open Active Transcript Log` -> Opens the active `transcript.jsonl` in editor for real-time inspection.

### Non-Functional
- [x] Responsive & Non-blocking: All UI operations run asynchronously without lagging the IDE.
- [x] Comprehensive disposal of all subscriptions, timers, and status bar items.

## Files to Create/Modify
- `src/extension.ts` - Smart QuickPick workflow, pre-flight confirmation, bottom-right status bar, action menu, and state storage.
- `src/test/phase04_ui_ux.test.ts` - Comprehensive single test file for Phase 04.

## Test Criteria
- [x] Exactly one file-based test: `src/test/phase04_ui_ux.test.ts`.
- [x] Verifies status bar creation at `StatusBarAlignment.Right` with priority 100.
- [x] Verifies QuickPick candidate generation (active file detection, workspace scan, recent list, browse, manual).
- [x] Verifies pre-flight phase preview and orchestrator invocation.
- [x] Verifies running action menu commands (`stop`, `skipCurrentPhase`).
- [x] Verifies state persistence in mock `workspaceState` / `globalState`.

---
Next Phase: [phase-05-e2e-packaging-verification.md](file:///d:/skul9x/Auto-Plan_Extension/plans/260828-0020-folder-plan-runner/phase-05-e2e-packaging-verification.md)
