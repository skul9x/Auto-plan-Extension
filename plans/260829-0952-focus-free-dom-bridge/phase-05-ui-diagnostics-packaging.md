# Phase 05: Extension Commands, UI Diagnostics, Settings & Packaging

Status: ✅ Completed
Dependencies: Phase 01, Phase 02, Phase 03, Phase 04  

## Objective
Finalize the user experience, extension commands, UI status indicators, diagnostic tooling, and production packaging. Provide user-friendly commands to install, verify, and uninstall the DOM Bridge, display real-time connection status in the Status Bar (e.g. `$(plug) Bridge: Active`), add automatic installation prompts on extension activation, update `package.json` configurations, run the full regression test suite across all 5 phases, and generate the final packaged `.vsix` extension.

---

## Requirements

### Functional Requirements
1. **VS Code Extension Commands**:
   - `autoplan.installBridge`: "Auto-Plan: Install / Update DOM Automation Bridge"
   - `autoplan.uninstallBridge`: "Auto-Plan: Uninstall DOM Automation Bridge"
   - `autoplan.checkBridgeStatus`: "Auto-Plan: Check Bridge Status & Run Diagnostic"
2. **Status Bar & UI Integration**:
   - Show DOM Bridge connectivity icon and tooltip in the VS Code Status Bar (`$(plug) Bridge: Active` or `$(alert) Bridge: Disconnected`).
   - Display actionable notification with "Install Bridge" button if the extension starts without the bridge installed.
3. **Configuration Schema in `package.json`**:
   - Register all new configuration properties (`autoplan.executionMode`, `autoplan.autoInjectWorkbench`, `autoplan.autoApprovePermissions`, `autoplan.bridgeTimeoutMs`).
   - Define command titles, categories, and icons.
   - Add test runner npm scripts: `npm run test:bridge`, `npm test`.
4. **Lifecycle Hooks in `src/extension.ts`**:
   - Start `BridgeServer` during extension activation.
   - Check `workbench.html` status; if `autoInjectWorkbench` is true and bridge is missing, prompt or auto-install.
   - Cleanly shut down `BridgeServer` on deactivation.
5. **Production Build & Packaging**:
   - Compile TypeScript cleanly (`npm run compile`).
   - Run all phase unit and integration tests (`npm run test:bridge`).
   - Package the updated extension into a `.vsix` bundle using `@vscode/vsce`.

### Non-Functional Requirements
- **User Clarity**: Clear, non-technical error and status messages.
- **Zero Regression**: All existing Auto-Plan features (plan scanning, custom selection, transcript watcher, status bar progress) continue to function flawlessly.

---

## Implementation Steps
1. Update `package.json` with new commands, scripts, and configuration settings.
2. Update `src/extension.ts` to register new commands, manage `BridgeServer` lifecycle, and update status bar indicators.
3. Implement `checkBridgeStatus` diagnostic runner showing workbench path, bridge version, active port, and connection health.
4. Create comprehensive end-to-end regression test suite in `src/test/phase05_full_e2e_regression.test.ts`.
5. Compile and run all file-based test suites via `npm run test:bridge`.
6. Package extension into `.vsix`.

---

## Files to Create / Modify
- `package.json` - [MODIFY] Register new commands, settings, and package metadata.
- `src/extension.ts` - [MODIFY] Hook BridgeServer lifecycle, commands, status bar, and diagnostics.
- `src/test/phase05_full_e2e_regression.test.ts` - [NEW] Full end-to-end regression and packaging test suite.

---

## File-Based Test Specification (`src/test/phase05_full_e2e_regression.test.ts`)
The test file must comprehensively verify:
1. **Full Lifecycle Flow**:
   - Bridge installation into mock workbench directory.
   - BridgeServer startup and port registration.
   - Simulated DOM client handshake and prompt dispatch.
   - Orchestrator multi-phase execution loop with transcript completion.
   - Bridge uninstallation and clean workbench restoration.
2. **Diagnostic Command Verification**: Tests that `checkBridgeStatus` accurately reports installation state, port binding, and client connectivity.
3. **Configuration Reactivity**: Verifies changing `executionMode` dynamically alters dispatcher behavior without requiring reload.
4. **Clean Build & Compilation**: Verifies TypeScript compiles with 0 errors and output bundles are valid.

---
All Phases Complete!
