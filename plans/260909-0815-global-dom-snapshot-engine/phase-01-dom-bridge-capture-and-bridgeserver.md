# Phase 01: DOM Bridge Capture Handler & BridgeServer Payload Streaming Protocol

Status: ✅ Completed  
Primary Test File: `src/test/phase01_dom_bridge_capture_and_bridgeserver.test.ts`

---

## 1. Objective

Enable the Electron Renderer DOM Bridge script (`media/autoplan-dom-bridge.js`) to capture the full workbench DOM tree (`document.documentElement.outerHTML`) upon request, and update `BridgeServer` in `src/bridgeServer.ts` to support receiving large HTML payloads (up to 20MB) without connection termination or payload dropping.

---

## 2. Technical Scope & Requirements

### 2.1. DOM Bridge (`media/autoplan-dom-bridge.js`)
1. Implement a dedicated command handler for `cmd.type === 'captureWorkbenchDom'` within `BridgeClient.handleCommand()`.
2. Access `this.customDocument || (typeof document !== 'undefined' ? document : null)`.
3. Extract `document.documentElement.outerHTML` safely. If `documentElement` is inaccessible, return an explicit error ACK.
4. Attach diagnostic metadata to the ACK response:
   - `html`: The full HTML string.
   - `byteLength`: Byte length of the captured HTML.
   - `url`: Current window location URL.
   - `timestamp`: Timestamp of capture.
5. Wrap execution in try/catch to log warnings via `logBridge` and return error ACK if DOM extraction throws.

### 2.2. BridgeServer Payload Limit & Helper (`src/bridgeServer.ts`)
1. In `readJsonBody()`, update the payload flood safety threshold from 1MB (`1024 * 1024`) to 20MB (`20 * 1024 * 1024`).
2. Log a diagnostic warning if incoming request payload exceeds this 20MB limit before destroying the socket.
3. Add `public async captureDomSnapshot(timeoutMs: number = 8000): Promise<{ success: boolean; html?: string; error?: string }>` to `BridgeServer`:
   - Validates that server is listening and has active connected clients.
   - Dispatches a command with `type: 'captureWorkbenchDom'`.
   - Resolves with the captured HTML string from `ackResult.metadata.html`.
   - Gracefully catches timeouts or errors and returns `{ success: false, error: message }` without throwing unhandled rejections.

---

## 3. Implementation Steps

1. Modify `media/autoplan-dom-bridge.js`:
   - In `handleCommand(cmd)`, add branch for `captureWorkbenchDom`.
   - Ensure complete `outerHTML` serialization.
2. Modify `src/bridgeServer.ts`:
   - Increase `MAX_PAYLOAD_BYTES` to `20 * 1024 * 1024` in `readJsonBody`.
   - Implement `captureDomSnapshot()` helper method on `BridgeServer`.
3. Implement `src/test/phase01_dom_bridge_capture_and_bridgeserver.test.ts`:
   - Test DOM Bridge command handler execution with mock DOM environment.
   - Test `readJsonBody` handling a 2MB+ JSON payload without socket termination.
   - Test `BridgeServer.captureDomSnapshot()` dispatching command and resolving HTML metadata.

---

## 4. Verification Test Criteria

- [x] `readJsonBody` accepts 2MB+ payload successfully without calling `req.destroy()`.
- [x] `BridgeClient` handles `captureWorkbenchDom` and returns full `outerHTML`.
- [x] `BridgeServer.captureDomSnapshot()` dispatches and resolves captured HTML.
- [x] Missing client or timeout returns `{ success: false, error }` gracefully.

Verification Command:
```bash
npm run compile && node out/test/phase01_dom_bridge_capture_and_bridgeserver.test.js
```

---
Next Phase: [Phase 02: Configuration Schema & Global Directory Snapshot Storage Engine](./phase-02-config-and-global-snapshot-storage.md)
