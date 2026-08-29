# Phase 03: Settings Panel Provider & Extension Host Integration

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02  
Target Files:
- `src/settingsProvider.ts`
- `src/extension.ts`
- `src/sidebarProvider.ts`
- `media/sidebar/sidebar.html`
- `media/sidebar/sidebar.js`
- `src/test/phase03_settings_panel_provider.test.ts`

---

## 1. Objective
Implement `src/settingsProvider.ts` as a singleton manager for the full-screen `vscode.WebviewPanel`, register the `autoplan.openSettings` command in `src/extension.ts`, connect bidirectional IPC message routing between the Settings Webview and VS Code configuration, and link the Settings Panel directly from the Sidebar Activity Bar and Status Bar.

---

## 2. Detailed Technical Requirements

### 2.1. `SettingsProvider` Class Architecture (`src/settingsProvider.ts`)
1. **Singleton Panel Lifecycle**:
   - `public static currentPanel: SettingsProvider | undefined;`
   - `public static readonly viewType = 'autoplan.settingsPanel';`
   - `public static render(extensionUri: vscode.Uri, promptDispatcher?: PromptDispatcher): SettingsProvider`
   - If panel already exists: reveal in `vscode.ViewColumn.Active` (or active text editor column).
   - If panel does not exist: create with `vscode.window.createWebviewPanel`:
     - `viewType = SettingsProvider.viewType`
     - `title = 'Auto-Plan Settings'`
     - `showOptions = vscode.ViewColumn.Active`
     - `options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')], retainContextWhenHidden: true }`
   - Set panel icon: `panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg')`.
   - Handle `panel.onDidDispose`: clear singleton reference `SettingsProvider.currentPanel = undefined`.
2. **HTML Assembly & CSP**:
   - Generate dynamic HTML replacing asset placeholders with `webview.asWebviewUri` for `settings.css`, `settings.js`, and `icon.svg`.
   - Inject crypto nonce into CSP meta tag:
     `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource};">`.
3. **IPC Message Router (`handleMessage`)**:
   - `ready`: Reply immediately with `initSettings` (containing active `getConfig()`) and `healthUpdate` (containing live bridge/toolchain diagnostics).
   - `saveSettings`: Iterate configuration keys, persist each to `vscode.workspace.getConfiguration('autoplan')` globally/workspace-wide, update sidecar file `ag-autoplan-config.json`, and broadcast `saveConfirmed` with a success notification.
   - `resetSettings`: Reset all `autoplan.*` configurations to `DEFAULT_CONFIG`, update sidecar file, and broadcast updated `initSettings`.
   - `testTier`: Run `promptDispatcher.testTierDispatch(message.tier)` and reply with `testResult` (success, latencyMs, status, error).
   - `setupBridge`: Execute `vscode.commands.executeCommand('autoplan.oneClickSetup')` and broadcast refreshed health status.
   - `uninstallBridge`: Execute `vscode.commands.executeCommand('autoplan.uninstallBridge')` and broadcast refreshed health status.
   - `openFolderPicker`: Open `vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Select Default Plan Folder' })` and reply with `folderSelected` containing selected path.
4. **Live Health Broadcast & Config Watchdog**:
   - Query `BridgeServer` client count, port status, and OS keyboard prerequisites to send periodic or on-demand `healthUpdate` messages to the webview.
   - When VS Code configuration changes externally, push updated `initSettings` to active webview.

### 2.2. Extension Command & Sidebar Linking (`src/extension.ts` & `src/sidebarProvider.ts`)
1. **Command Registration & Activation Events**:
   - Register `autoplan.openSettings` ("Auto-Plan: Open Settings Panel").
   - Update `package.json` contributes commands with `autoplan.openSettings` and `activationEvents` with `"onCommand:autoplan.openSettings"`.
2. **Sidebar & Status Bar Integration**:
   - In `media/sidebar/sidebar.html`, ensure the "⚙️ Settings" button sends a message to the extension.
   - In `src/sidebarProvider.ts`, handle the `settings` message by executing `autoplan.openSettings` (or calling `SettingsProvider.render(...)`).
   - In `src/extension.ts`, add an "Open Settings Panel" option to the Status Bar running action menu.

---

## 3. Implementation Tasks
- [x] Task 3.1: Implement `src/settingsProvider.ts` with complete lifecycle, CSP generator, and IPC message handlers (`ready`, `saveSettings`, `resetSettings`, `testTier`, `setupBridge`, `uninstallBridge`, `openFolderPicker`).
- [x] Task 3.2: Register `autoplan.openSettings` command in `src/extension.ts`, update `package.json` commands and activationEvents.
- [x] Task 3.3: Wire the Settings button in `src/sidebarProvider.ts` and Status Bar action menu.
- [x] Task 3.4: Create comprehensive standalone verification test `src/test/phase03_settings_panel_provider.test.ts`.

---

## 4. Verification Test Suite: `src/test/phase03_settings_panel_provider.test.ts`
The test file must verify:
1. **WebviewPanel Instantiation & HTML Generation**:
   - Verify `SettingsProvider.render()` creates panel with proper titles, options, and CSP nonces.
   - Verify subsequent calls reveal existing panel rather than duplicating instances.
2. **IPC Message Routing**:
   - Verify `handleMessage` processes `saveSettings` and invokes configuration update APIs.
   - Verify `handleMessage` processes `testTier` and responds with expected diagnostic payload.
   - Verify `handleMessage` processes `resetSettings` and restores default values.
3. **Extension Host Command & Sidebar Linking**:
   - Verify `autoplan.openSettings` executes without error.
   - Verify sidebar provider triggers settings panel opening when requested.

---

## 5. Exit Criteria
- `npm run compile` succeeds with zero errors.
- `node out/test/phase03_settings_panel_provider.test.js` passes 100% assertions.
