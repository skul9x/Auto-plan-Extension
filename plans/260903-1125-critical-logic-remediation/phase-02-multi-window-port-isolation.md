# Phase 02: Multi-Window Port Isolation (LOGIC-002 Remediation)

Status: ✅ Completed  
Dependencies: Phase 01  
Target Files:
- `src/bridgeServer.ts`
- `media/autoplan-dom-bridge.js`
- `src/test/phase02_multi_window_port_isolation.test.ts`

---

## 1. Objective

Resolve port collisions and client misdirection across concurrent VS Code windows. Ensure that `DomBridgeClient.discoverPort()` correctly discovers and binds exclusively to its own window's `BridgeServer` instance, rather than latching onto the first responding port owned by another active window.

---

## 2. Root Cause Analysis (LOGIC-002)

1. Window 1 starts `BridgeServer` on port `48860` with `activeWindowKey = 'win-1'`.
2. Window 2 starts `BridgeServer` on port `48861` with `activeWindowKey = 'win-2'`.
3. `DomBridgeClient` in Window 2 invokes `discoverPort()`, scanning from `48860` upward.
4. Port `48860` responds with status `200` and `{ service: 'autoplan-bridge-server' }`.
5. Window 2's client accepts port `48860` and halts port scanning immediately.
6. When Window 2 sends subsequent status requests to `48860`, Window 1's server flags `windowMismatch = true` because `win-2 !== win-1`.
7. As a consequence, Window 2's client is locked out, Window 2's actual server on `48861` never receives any client connection, and Window 2's automation fails with timeout.

---

## 3. Technical Requirements

### 3.1. Server-Side Window Ownership Handshake (`src/bridgeServer.ts`)
1. In `handleStatus()`, include window ownership metadata in the status response:
   - `serverWindowKey`: `this.windowKey`
   - `activeWindowKey`: `this.activeWindowKey || null`
   - `isCompatible`: `!this.activeWindowKey || this.activeWindowKey === reqWindowKey || this.windowKey === reqWindowKey`
2. During probe requests (`probe=1`), if `reqWindowKey` is provided and conflicts with an already active, non-stale window, explicitly return `{ status: 'occupied', activeWindowKey: this.activeWindowKey }` or HTTP 409 / 423 / status flag so the prober knows this port is reserved.

### 3.2. Client-Side Port Discovery Discrimination (`media/autoplan-dom-bridge.js`)
1. In `discoverPort()`:
   - Send `windowKey` in the probe request.
   - Inspect the returned JSON payload.
   - Only bind `this.serverPort = port` if the server confirms ownership (i.e. server has no active window key, or the active window key matches `this.windowKey`).
   - If the server reports it is actively bound to a different window, log an informational message and **continue probing the remaining ports** in `portStart..portEnd`.
2. Ensure fallback re-discovery retains this window-filtering constraint.

---

## 4. Single Automated File-Based Test

Create `src/test/phase02_multi_window_port_isolation.test.ts` to verify:
1. Start two distinct `BridgeServer` instances on consecutive ports (e.g. Port A and Port B), configured with `windowKey1 = 'window-alpha'` and `windowKey2 = 'window-beta'`.
2. Establish an active client connection on Port A with `windowKey = 'window-alpha'`.
3. Execute the `discoverPort` probe logic from the perspective of `window-beta` starting search from Port A.
4. Verify that `window-beta` skips Port A because it is owned by `window-alpha`.
5. Verify that `window-beta` successfully discovers and connects to Port B.
6. Verify commands sent to Port B are only received and acknowledged by `window-beta`.
7. Stop both servers cleanly.

---

## 5. Verification Protocol

Run only this single test for verification:
```bash
npx tsc && node out/test/phase02_multi_window_port_isolation.test.js
```

After running this single test, stop immediately for user review. Once completed, output `done.`.
