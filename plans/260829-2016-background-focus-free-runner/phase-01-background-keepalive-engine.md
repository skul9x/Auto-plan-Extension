# Phase 01: Background Worker Keep-Alive & Adaptive Stale Threshold

**Status**: ✅ Completed  
**Target Files**: 
- `media/autoplan-dom-bridge.js`
- `src/bridgeServer.ts`
- `src/config.ts`

---

## 1. Objective
Implement an unthrottled Web Worker-based background keep-alive loop and periodic heartbeat mechanism in `autoplan-dom-bridge.js` so that Chromium/Electron timer throttling does not degrade DOM bridge communication when Antigravity IDE is in the background or minimized. Increase the server-side stale client threshold to prevent premature client eviction.

---

## 2. Requirements

### Functional Requirements
1. **Unthrottled Worker-based Ticks**: Create a lightweight inline Blob Web Worker timer inside `DomBridgeClient` that fires ticks every `pollIntervalMs` (default 500ms) without being throttled by Chromium's background tab timer clamp (which can throttle to 1000ms - 60000ms).
2. **Dedicated Background Heartbeat Loop**: Introduce periodic heartbeat pings (`GET /autoplan-heartbeat?windowKey=...`) every 10 seconds regardless of pending command queue state to maintain continuous client registration in `BridgeServer`.
3. **Adaptive Stale Client Threshold**: Increase `DEFAULT_STALE_CLIENT_MS` from `30000` (30s) to `120000` (120s / 2 minutes) in `src/bridgeServer.ts`. Allow configuration via `config.staleClientMs`.
4. **Resilient Port Reconnection**: When `fetch` fails during background polling, trigger immediate discovery probe without halting the worker loop.

### Non-Functional Requirements
- **Low CPU Overhead**: Inline Web Worker must consume < 0.1% CPU when idle.
- **Graceful Fallback**: If `Worker` or `URL.createObjectURL` is unavailable in the environment, fall back to standard `setInterval` seamlessly.

---

## 3. Implementation Steps
1. In `src/bridgeServer.ts`:
   - Increase `DEFAULT_STALE_CLIENT_MS` to `120000`.
   - Ensure `runWatchdogCheck` logs eviction events only after 120s of silence.
2. In `media/autoplan-dom-bridge.js`:
   - Implement `createWorkerTimer(callback, intervalMs)` using inline Blob URL.
   - Add background heartbeat loop in `DomBridgeClient` sending `GET /autoplan-heartbeat`.
   - Update `start()` and `stop()` to manage worker lifecycle and heartbeat timer.
3. In `src/config.ts`:
   - Add `staleClientMs` configuration property with default `120000`.

---

## 4. Verification Test
- **Single Test File**: `src/test/phase01_background_keepalive_engine.test.ts`
- **Scope**:
  - Test inline worker timer creation and tick execution under simulated background environment.
  - Verify `BridgeServer` heartbeat registration updates `lastSeenAt` continuously.
  - Verify that idle periods of 45-60 seconds do NOT evict the client under the 120s threshold.
  - Verify client recovers port binding after simulated server restart.
