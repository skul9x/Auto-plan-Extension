# Phase 03: Realtime Config Sidecar & Renderer Watchdog

Status: ✅ Completed
Dependencies: Phase 02

## Objective
Port `zixfel`'s sidecar JSON config syncing (`ag-autoplan-config.json`) and periodic heartbeat watchdog supervision into `BridgeServer` to maintain active IPC health without window reloads.

## Requirements
### Functional
- Create `writeConfigJson()` helper in `src/config.ts` or `src/extension.ts` to write `ag-autoplan-config.json` alongside `workbench.html` whenever extension settings change.
- Add heartbeat watchdog timer in `src/bridgeServer.ts` to automatically check client telemetry, evict stale clients (> 30s), and log status transitions.
- Expose `getWatchdogStatus()` diagnostic info in `BridgeServer`.

### Non-Functional
- File write operations must use safe elevated write handles (`writeFileElevated`).
- Watchdog timer must dispose cleanly upon `bridgeServer.stop()`.

## Implementation Steps
1. Modify `src/config.ts` / `src/extension.ts`:
   - Implement `writeConfigJson(config)` helper writing to workbench directory.
   - Hook into `vscode.workspace.onDidChangeConfiguration`.
2. Modify `src/bridgeServer.ts`:
   - Implement watchdog interval checking connected clients and updating telemetry.
3. Create single file-based test suite `src/test/phase03_sidecar_config_watchdog.test.ts`:
   - Test 1: Verify `writeConfigJson` creates valid JSON file alongside `workbench.html`.
   - Test 2: Verify `BridgeServer` watchdog auto-evicts stale clients (> 30s).
   - Test 3: Verify config updates trigger sidecar sync seamlessly.

## Files to Create/Modify
- `src/config.ts` / `src/extension.ts` - Add sidecar config writer.
- `src/bridgeServer.ts` - Add connection watchdog supervision.
- `src/test/phase03_sidecar_config_watchdog.test.ts` - Comprehensive single file-based test suite.

## Test Criteria
- `node out/test/phase03_sidecar_config_watchdog.test.js` passes 100%.

---
Next Phase: [Phase 04: Full E2E Integration & Regression Verification](phase-04-full-e2e-regression.md)
