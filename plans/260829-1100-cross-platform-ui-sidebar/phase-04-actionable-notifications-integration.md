# Phase 04: Actionable Notifications & System Integration

Status: ✅ Completed  
Completed At: 2026-08-29T15:01:00+07:00  
Dependencies: Phase 01, Phase 02, Phase 03  
Target Files:
- `package.json`
- `src/extension.ts`
- `src/orchestrator.ts`
- `src/test/phase04_actionable_notifications_integration.test.ts`

---

## 1. Objective
Wire the Sidebar Provider, Pre-Flight Guard, and Cross-Platform Elevation directly into `extension.ts` and `package.json`. Replace passive warning messages with interactive **Actionable Notifications** (with 1-Click fix buttons) and establish seamless bidirectional event hooks between the Orchestrator engine and the Sidebar UI.

---

## 2. Detailed Technical Requirements

### 2.1. Manifest Contributions in `package.json`
1. **Activity Bar View Container**:
   ```json
   "viewsContainers": {
     "activitybar": [
       {
         "id": "autoplan-sidebar-container",
         "title": "Auto-Plan Control Center",
         "icon": "media/icon.svg"
       }
     ]
   }
   ```
2. **View Contribution**:
   ```json
   "views": {
     "autoplan-sidebar-container": [
       {
         "type": "webview",
         "id": "autoplan.sidebarView",
         "name": "Plan Execution Dashboard"
       }
     ]
   }
   ```
3. **Commands Registration**:
   - `autoplan.openSidebar`: Reveal and focus the Sidebar View via `vscode.commands.executeCommand('autoplan.sidebarView.focus')`.
   - `autoplan.oneClickSetup`: Run automated DOM Bridge elevation and injection.
   - `autoplan.checkStatus`: Display diagnostics modal.
4. **Activation Events in `package.json`**:
   - Add `"onView:autoplan.sidebarView"` to `activationEvents` so the provider wakes up whenever the sidebar is opened.

### 2.2. Extension Lifecycle & Event Integration in `src/extension.ts`
1. **Sidebar Provider Initialization**:
   - Register `SidebarProvider` in `vscode.window.registerWebviewViewProvider('autoplan.sidebarView', sidebarProvider)`.
2. **Actionable Notifications System**:
   - Replace generic warnings with actionable `vscode.window.showWarningMessage` / `showErrorMessage` items:
     - When DOM Bridge is missing: `vscode.window.showWarningMessage('Auto-Plan DOM Bridge is not active (Focus-Free mode unavailable).', '⚡ 1-Click Setup', '🛠️ Open Diagnostics', 'Dismiss')`.
     - When Linux Pre-Flight fails: `vscode.window.showErrorMessage('Linux Pre-Flight Failed: Missing DOM Bridge and xdotool.', '⚡ Activate Bridge (Recommended)', '📦 Install xdotool Guide')`.
     - When patch completes: `vscode.window.showInformationMessage('DOM Bridge injected successfully. Reload IDE to apply.', '🔄 Reload Window', 'Later')`.
3. **Orchestrator to Sidebar Event Hooks**:
   - Hook `orchestrator.onPhaseStart`: Broadcast active phase index, name, and total count to Sidebar Webview.
   - Hook `orchestrator.onPhaseComplete`: Broadcast phase success, duration, and advance progress bar.
   - Hook `transcriptWatcher.onLogUpdate`: Forward parsed snippets into `sidebarProvider.appendTranscriptLog()`.
   - Hook `orchestrator.onStateChange`: Update Sidebar buttons (toggle Run / Pause / Stop states).

---

## 3. Implementation Tasks
- [x] Task 4.1: Update `package.json` with `viewsContainers.activitybar`, `views`, new commands, and npm test runner scripts for Phases 1-5.
- [x] Task 4.2: Wire `SidebarProvider` and command registrations in `src/extension.ts`.
- [x] Task 4.3: Implement Actionable Notification handlers with interactive button actions in `src/extension.ts`.
- [x] Task 4.4: Connect `orchestrator` lifecycle events and `transcriptWatcher` data streams to `sidebarProvider`.
- [x] Task 4.5: Create integration test in `src/test/phase04_actionable_notifications_integration.test.ts`.

---

## 4. Verification Test Suite: `src/test/phase04_actionable_notifications_integration.test.ts`
The test file must verify:
1. **Manifest Schema Compliance**:
   - Verify `package.json` contains valid `viewsContainers`, `views`, `activationEvents`, and command IDs.
2. **Actionable Notification Handling**:
   - Mock user selection of notification buttons (`1-Click Setup`, `Reload Window`, `Install Guide`) and verify proper command execution.
3. **Orchestrator Event Propagation**:
   - Fire mock orchestrator phase events and verify data is translated and delivered to `sidebarProvider`.
4. **Command Execution**:
   - Verify `autoplan.openSidebar` and `autoplan.oneClickSetup` execute cleanly.

---

## 5. Exit Criteria
- [x] `npm run compile` succeeds with zero errors.
- [x] `node out/test/phase04_actionable_notifications_integration.test.js` passes 100% assertions.
