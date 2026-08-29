# Phase 03: Sidebar Control Center Webview Provider & Modern UI

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02  
Target Files:
- `src/sidebarProvider.ts`
- `media/sidebar/sidebar.html`
- `media/sidebar/sidebar.css`
- `media/sidebar/sidebar.js`
- `media/icon.svg`
- `src/test/phase03_sidebar_webview_provider.test.ts`

---

## 1. Objective
Transform the Auto-Plan Extension user experience by building a dedicated **Sidebar Control Center** inside the VS Code Activity Bar (`vscode.WebviewViewProvider`). Replace obscure modal quickpicks with an interactive dashboard showing connection status badges, plan folder selector, interactive phase checkboxes, progress bar, real-time AI transcript log stream, and large control buttons.

---

## 2. Detailed Technical Requirements

### 2.1. Webview Provider in `src/sidebarProvider.ts`
1. **Class Architecture**:
   - Implement `vscode.WebviewViewProvider` with static `viewType = 'autoplan.sidebarView'`.
   - Manage Webview life-cycle inside `resolveWebviewView(webviewView, context, token)`:
     - Set `webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] }`.
     - Secure with CSP: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">`.
     - Resolve local URIs for CSS (`sidebar.css`), JS (`sidebar.js`), and icons using `webview.asWebviewUri`.
2. **Bidirectional IPC Messaging Protocol**:
   - **Messages from Extension Host -> Webview**:
     - `stateUpdate`: Send current status (`idle`, `running`, `paused`, `stopped`), active plan path, discovered phases list, selected phase indices, and current execution index.
     - `bridgeStatus`: Send DOM bridge connection state (`connected` Focus-Free, `keyboard` Fallback, or `disconnected`).
     - `transcriptLog`: Stream latest parsed AI response snippet (3-5 lines) directly into the UI log view.
     - `progress`: Send overall completion percentage (`0% - 100%`) and elapsed time.
   - **Messages from Webview -> Extension Host**:
     - `start`: Trigger execution of selected phases.
     - `pause`: Pause execution.
     - `resume`: Resume paused execution.
     - `skip`: Skip current phase and advance to next.
     - `stop`: Immediately abort execution.
     - `selectPlanFolder`: Open folder picker or switch active plan.
     - `togglePhase`: Toggle selection checkbox for a specific phase index.
     - `toggleAllPhases`: Select / Deselect all phases.
     - `activateBridge`: Trigger 1-Click DOM Bridge injector & elevation.

### 2.2. Webview HTML/CSS/JS Assets (`media/sidebar/`)
1. **Design System & Aesthetics**:
   - Deep dark mode adhering to VS Code CSS theme tokens (`var(--vscode-editor-background)`, `var(--vscode-button-background)`, etc.).
   - Modern glassmorphism container cards, subtle glow accents, and responsive layout.
   - Crisp typography (Inter / System font stack) and smooth micro-animations.
2. **Key UI Components**:
   - **Header**: Extension Logo + Status Pill (🟢 Focus-Free Bridge Active / 🟡 Keyboard Fallback / 🔴 Inactive).
   - **Plan Selector**: Dropdown showing plan folders in the workspace with a Refresh button.
   - **Phase Checklist**: Scrollable list of phase items with checkboxes, status badges (Done, Running, Pending, Failed), file names, and individual duration badges.
   - **Progress Overview**: Animated progress bar + Phase counter (e.g., `Phase 3 of 5 - 60%`).
   - **Main Action Bar**: Primary Start/Run Button (`▶️ Run Selected Phases`), Pause (`⏸️`), Skip (`⏭️`), and Stop (`⏹️`).
   - **Live AI Activity Feed**: Terminal-like mini viewport displaying live decoded transcript entries from the AI assistant.
   - **Quick Actions Footer**: `⚡ Activate DOM Bridge`, `🛠️ Diagnostics`, `⚙️ Settings`.

---

## 3. Implementation Tasks
- [x] Task 3.1: Create `media/icon.svg` for the Activity Bar container.
- [x] Task 3.2: Implement `media/sidebar/sidebar.html`, `sidebar.css`, and `sidebar.js`.
- [x] Task 3.3: Implement `src/sidebarProvider.ts` implementing `vscode.WebviewViewProvider`.
- [x] Task 3.4: Establish message router and state synchronization between Extension Host and Webview.
- [x] Task 3.5: Create standalone test suite `src/test/phase03_sidebar_webview_provider.test.ts`.

---

## 4. Verification Test Suite: `src/test/phase03_sidebar_webview_provider.test.ts`
The test file must verify:
1. **HTML & Content Security Policy (CSP)**:
   - Ensure `sidebar.html` generation contains proper CSP meta tags, webview URI replacements, and script nonces.
2. **Inbound Message Router**:
   - Verify `handleWebviewMessage` correctly dispatches `start`, `pause`, `stop`, `skip`, `togglePhase`, and `activateBridge` to corresponding extension handlers.
3. **Outbound State Broadcast**:
   - Verify `updateState()`, `sendBridgeStatus()`, and `appendTranscriptLog()` post correctly structured JSON payloads to the webview view instance.
4. **State Persistence**:
   - Verify checkbox selection toggles maintain consistent state.

---

## 5. Exit Criteria
- [x] `npm run compile` succeeds with zero errors.
- [x] `node out/test/phase03_sidebar_webview_provider.test.js` passes 100% assertions.
