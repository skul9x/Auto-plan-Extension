# Phase 02: Sidebar Webview Bidirectional Ready Handshake (LOGIC-009 Remediation)

Status: ✅ Completed  
Dependencies: Phase 01  
Target Files:
- `media/sidebar/sidebar.js`
- `src/sidebarProvider.ts`
- `src/test/phase02_sidebar_ready_handshake.test.ts`

---

## 1. Objective

Eliminate dropped webview state updates during extension activation and sidebar initialization. Implement a reliable, bidirectional `ready` handshake protocol between `SidebarProvider` (Extension Host) and `sidebar.js` (Webview Context). Guarantee that initial plan selections, phase lists, execution status, and bridge connectivity states are never lost due to asynchronous script loading race conditions.

---

## 2. Root Cause Analysis (LOGIC-009)

1. In `src/sidebarProvider.ts`:
   ```typescript
   public resolveWebviewView(webviewView: vscode.WebviewView, ...) {
     this._view = webviewView;
     webviewView.webview.options = { ... };
     webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

     webviewView.webview.onDidReceiveMessage(async (message) => {
       await this.handleWebviewMessage(message);
     });

     this.refreshAndSendState();
     this.sendBridgeStatus();
   }
   ```
2. When `resolveWebviewView` runs, setting `webview.html` triggers an asynchronous process inside the VS Code renderer to parse the HTML, fetch scripts, and execute them in an isolated iframe.
3. The calls to `refreshAndSendState()` and `sendBridgeStatus()` post messages immediately in the same synchronous turn.
4. In `media/sidebar/sidebar.js`, the script has not yet executed `window.addEventListener('message', ...)`. Furthermore, `sidebar.js` does not emit any `ready` notification back to the host.
5. All initial messages sent by the extension host are discarded by the uninitialized webview.
6. When the sidebar finally loads, it displays "No plan loaded. Select a plan folder above." and remains blank until the user triggers a manual event (e.g. clicking a folder or switching tabs).

---

## 3. Technical Requirements

### 3.1. Webview Ready Signal (`media/sidebar/sidebar.js`)
1. Ensure `window.addEventListener('message', ...)` is attached before sending the ready signal.
2. At the conclusion of `sidebar.js` initialization, dispatch a ready message:
   ```javascript
   vscode.postMessage({ command: 'ready', type: 'ready' });
   ```

### 3.2. Ready Handshake & State Queuing (`src/sidebarProvider.ts`)
1. Introduce a readiness tracking flag:
   ```typescript
   private _isWebviewReady: boolean = false;
   ```
2. In `handleWebviewMessage(message: any)`:
   - Add a case for `ready`:
     ```typescript
     case 'ready': {
       this._isWebviewReady = true;
       await this.refreshAndSendState();
       this.sendBridgeStatus();
       this.flushPendingLogs();
       break;
     }
     ```
3. In `updateState()`, `sendBridgeStatus()`, and `sendProgress()`:
   - If `this._isWebviewReady` is false, cache the latest payload in an internal state buffer.
   - When `ready` is received, immediately dispatch the cached state.
4. In `resolveWebviewView()`:
   - Reset `this._isWebviewReady = false;`.
   - Maintain a fallback safety timer (e.g. 1500ms) to deliver state if a webview environment fails to send `ready` (e.g. in headless unit tests or constrained environments).

---

## 4. Implementation Steps

1. [x] In `media/sidebar/sidebar.js`, add `vscode.postMessage({ command: 'ready' });` once DOM listeners are bound.
2. [x] In `src/sidebarProvider.ts`, declare `_isWebviewReady: boolean = false` and handle `'ready'` in `handleWebviewMessage`.
3. [x] In `src/sidebarProvider.ts`, ensure `updateState()` and `sendBridgeStatus()` synchronize properly upon receiving the `'ready'` command.
4. [x] Maintain backward-compatible fallback delivery in `resolveWebviewView()` to prevent regression.

---

## 5. Single Automated File-Based Test

Create `src/test/phase02_sidebar_ready_handshake.test.ts` to verify:
1. Setup a mocked `vscode.WebviewView` with recorded inbound and outbound message queues.
2. Instantiate `SidebarProvider` and invoke `resolveWebviewView()`.
3. Verify that the provider registers a message listener for the webview.
4. Inspect `media/sidebar/sidebar.js` or evaluate its behavior to verify that `{ command: 'ready' }` is dispatched upon script execution.
5. Simulate the webview firing `{ command: 'ready' }` into `handleWebviewMessage()`.
6. Assert that `SidebarProvider` responds by sending:
   - A `stateUpdate` message containing active plan paths, phases, and selection indices.
   - A `bridgeStatus` message containing the current bridge server connection state.
7. Verify that multiple consecutive updates before `ready` are coalesced so the webview receives the freshest state upon declaring readiness.

---

## 6. Verification Protocol

Run only this single test for verification:
```bash
npx tsc && node out/test/phase02_sidebar_ready_handshake.test.js
```

After running this single test, stop immediately for user review. Once completed, output `done.`.

---
Next Phase: [Phase 03: Subset Phase Diagnostic Attribution by File Name](./phase-03-subset-diagnostic-attribution.md)
