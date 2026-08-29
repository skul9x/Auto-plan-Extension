# Phase 02: Shared Server Singleton & Fast Auto-Wakeup Dispatcher

**Status**: ✅ Completed  
**Target Files**: 
- `src/promptDispatcher.ts`
- `src/bridgeServer.ts`
- `src/orchestrator.ts`

---

## 1. Objective
Ensure `PromptDispatcher` and `Orchestrator` share the primary active `BridgeServer` singleton instance rather than instantiating isolated/unstarted servers. Implement a 200ms fast wakeup probe in `validateDispatchReadiness` so that if background clients are in an unprobed state, they are refreshed immediately before evaluating readiness.

---

## 2. Requirements

### Functional Requirements
1. **Shared Singleton Default**: Update `PromptDispatcher` constructor to use `bridgeServer as defaultBridgeServer` from `src/bridgeServer.ts` instead of `new BridgeServer()`.
2. **Fast Pre-Flight Wakeup Probe**: In `PromptDispatcher.validateDispatchReadiness` and `dispatchTier1`:
   - If `connectedClientsCount === 0`, perform an asynchronous fast port probe (`GET /autoplan-status?probe=1`) or query `PortRegistry` to detect any active Electron window before failing.
   - Wait up to 200ms for active client discovery before finalizing readiness decision.
3. **Dispatcher Auto-Reconnect Retry**: If client drops right before command dispatch, perform a 1-second auto-reconnect retry loop before falling back or failing.
4. **Synchronized Readiness Logging**: Log detailed port, client telemetry, and windowKey status in `DISPATCHER` output channel.

### Non-Functional Requirements
- Pre-flight fast probe must finish in < 250ms under all network conditions.

---

## 3. Implementation Steps
1. In `src/promptDispatcher.ts`:
   - Import `bridgeServer as defaultBridgeServer` from `./bridgeServer`.
   - Update `constructor(options?: PromptDispatcherOptions)`: `this.bridgeServer = options?.bridgeServer ?? defaultBridgeServer`.
   - Implement `async ensureBridgeReadinessWithWakeup(timeoutMs: number = 250)` method.
   - Update `dispatchTier1` to invoke fast wakeup probe if client count is 0.
2. In `src/bridgeServer.ts`:
   - Expose `probeActiveClients(timeoutMs?: number)` method.
3. In `src/orchestrator.ts`:
   - Ensure orchestrator uses the shared dispatcher and propagates active bridge status.

---

## 4. Verification Test
- **Single Test File**: `src/test/phase02_fast_reconnect_dispatcher.test.ts`
- **Scope**:
  - Verify default `PromptDispatcher` shares the `bridgeServer` singleton instance.
  - Verify `validateDispatchReadiness` executes fast wakeup probe when client count starts at 0 and successfully marks ready when client responds.
  - Verify `dispatchTier1` succeeds in focus-free mode with background client.
