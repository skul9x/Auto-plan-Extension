# Phase 01: Multi-Window Workspace-Bound Port Registry & Dynamic Window Rebind

Status: ⬜ Pending  
Dependencies: None  
Target Files: `src/bridgeServer.ts`, `media/autoplan-dom-bridge.js`  
Primary Test File: `src/test/phase01_multi_window_workspace_rebind.test.ts`

---

## 1. Objective

Eliminate port collision and stale window lockout in multi-window environments by:
1. Binding each `BridgeServer` instance to its active VS Code `workspacePath` and `workspaceName`.
2. Enabling `autoplan-dom-bridge.js` to probe and select only the server instance corresponding to its own workspace.
3. Implementing dynamic window takeover/rebind so that when a window is reloaded or refreshed (generating a new `windowKey`), the server gracefully evicts the stale window key instead of returning HTTP 409 `owner-mismatch`.

---

## 2. Requirements

### Functional
- [ ] In `src/bridgeServer.ts`:
  - Add optional `workspacePath?: string` and `workspaceName?: string` to `BridgeServerOptions`.
  - Record `workspacePath` and `workspaceName` in `PortRegistryEntry` written to `ag-autoplan-ports.json`.
  - In `handleGetStatus`:
    - Return `workspaceName` and `workspacePath` in `/autoplan-status` payload.
    - If `query.probe === '1'`:
      - If `query.workspaceName` is supplied and does NOT match this server's `workspaceName`, return HTTP 409 with `rejectReason: 'workspace-mismatch'` so the client moves on to probe the next port.
      - If `query.workspaceName` matches (or server has no workspace set):
        - Check if current `activeWindowKey` is stale (no heartbeat in > 5000ms, or `query.forceRebind === '1'`).
        - If stale or rebind requested, evict the stale key, bind `this.activeWindowKey = reqWindowKey`, and return HTTP 200 with `status: 'ready'`, avoiding `owner-mismatch` lockouts.
- [ ] In `media/autoplan-dom-bridge.js`:
  - Implement `detectWorkspaceName(doc)` to parse the workspace folder name from `doc.title` (e.g. splitting on `" - "` to extract the active project title like `"TramsacEV"`) or DOM element `.window-title`.
  - In `discoverPort()`:
    - Include `&workspaceName=${encodeURIComponent(workspaceName)}` in the `/autoplan-status` probe URL.
    - Validate that `data.workspaceName` matches the client's detected workspace name before confirming port ownership.
    - If a port returns 409 due to workspace mismatch, immediately skip to the next candidate port in range `48860-48900`.
    - If the matching port is found, successfully establish connection and start heartbeat cycle.

### Non-Functional
- [ ] Non-breaking backwards compatibility when `workspaceName` is not provided (single-window legacy behavior).
- [ ] Zero async deadlocks or event loop blocking.

---

## 3. Implementation Steps

1. In `src/bridgeServer.ts`:
   - Extend `BridgeServerOptions` with `workspacePath` and `workspaceName`.
   - Update `PortRegistryEntry` interface and `registerPortInRegistry()` method.
   - Refactor `handleGetStatus()` to support workspace-based validation and dynamic rebind logic.
2. In `media/autoplan-dom-bridge.js`:
   - Add `getWorkspaceIdentifier()` utility.
   - Update `discoverPort()` loop with workspace parameter matching and graceful skip.
3. Implement `src/test/phase01_multi_window_workspace_rebind.test.ts`:
   - Test 1: Port registration includes workspace metadata in registry.
   - Test 2: Client probe with mismatched workspace is rejected with 409 `workspace-mismatch`.
   - Test 3: Client probe with matching workspace against a stale previous window triggers clean takeover without 409.
   - Test 4: Two concurrent servers with distinct workspaces are correctly discovered and bound by their respective clients.

---

## 4. Verification Plan

- Run the single comprehensive test for this phase:
  ```bash
  npm run compile && node out/test/phase01_multi_window_workspace_rebind.test.js
  ```
- Verify all assertions pass cleanly.
- Stop for user review.
