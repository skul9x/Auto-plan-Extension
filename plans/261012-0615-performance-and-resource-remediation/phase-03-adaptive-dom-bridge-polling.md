# Phase 03: Adaptive DOM Bridge Polling & Idle Backoff (PERF-03)

Status: ✅ Completed
Test: `src/test/phase03_adaptive_dom_bridge_polling.test.ts`

## Goals
1. **Remediate PERF-03 (Idle Loopback HTTP Polling Overhead)**:
   - In `media/autoplan-dom-bridge.js`, replace the fixed `DEFAULT_POLL_INTERVAL_MS = 500` with an **Adaptive Dynamic Polling State Machine**.
   - Establish two operational tiers:
     - **Active Tier (`ACTIVE_POLL_INTERVAL_MS = 400ms`)**: Engaged during plan execution, prompt injection, and for 30 seconds following the most recent command or user activity.
     - **Idle Tier (`IDLE_POLL_INTERVAL_MS = 2000ms`)**: Engaged when no commands have been queued or executed for more than 30 seconds (`IDLE_TIMEOUT_MS = 30000ms`).
   - **Instant Wakeup Mechanism**:
     - Reset immediately to the Active Tier (`400ms`) whenever a command is received from the Bridge Server.
     - Reset immediately whenever an internal prompt dispatch or click cascade is triggered.
     - Optionally listen for window focus or interaction events to wake the bridge instantly when the developer interacts with the IDE.
2. **Bridge Server Coordination**:
   - In `src/bridgeServer.ts`, provide an `isExecuting` or `activeTask` indicator in the `/autoplan-status` JSON payload, allowing the client to maintain the active tier as long as an orchestrated automation phase is running.
3. **Verification**:
   - Provide exactly one comprehensive test file: `src/test/phase03_adaptive_dom_bridge_polling.test.ts`.
   - Verify that polling dynamically backs off from 400ms to 2000ms after 30 seconds of inactivity.
   - Verify that incoming commands trigger an immediate poll switch back to 400ms without delay.
   - Verify that HTTP traffic in idle state drops by 75% while maintaining instantaneous dispatch when active.

## Implementation Details

### 1. `DomBridgeClient` Polling State Machine
- In `media/autoplan-dom-bridge.js`:
  - Define interval constants:
    ```javascript
    const ACTIVE_POLL_INTERVAL_MS = 400;
    const IDLE_POLL_INTERVAL_MS = 2000;
    const IDLE_THRESHOLD_MS = 30000;
    ```
  - Maintain state variables:
    ```javascript
    let lastActivityTime = Date.now();
    let currentPollInterval = ACTIVE_POLL_INTERVAL_MS;
    ```
  - Dynamic scheduler function:
    ```javascript
    function recordActivity() {
      lastActivityTime = Date.now();
      if (currentPollInterval !== ACTIVE_POLL_INTERVAL_MS) {
        currentPollInterval = ACTIVE_POLL_INTERVAL_MS;
        reschedulePolling(currentPollInterval);
      }
    }

    function computeNextPollInterval(hasCommand, serverIsActive) {
      if (hasCommand || serverIsActive) {
        recordActivity();
        return ACTIVE_POLL_INTERVAL_MS;
      }
      const idleElapsed = Date.now() - lastActivityTime;
      return (idleElapsed >= IDLE_THRESHOLD_MS) ? IDLE_POLL_INTERVAL_MS : ACTIVE_POLL_INTERVAL_MS;
    }
    ```

## Verification
- Run: `node out/test/phase03_adaptive_dom_bridge_polling.test.js`.
- Confirm transition between Active and Idle tiers and instant wakeup behavior.
