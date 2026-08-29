# Phase 04: Unified 3-Tier Prompt Dispatcher & Orchestrator Integration

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02, Phase 03  

## Objective
Implement `src/promptDispatcher.ts` to coordinate prompt delivery across a resilient 3-tier fallback architecture:
1. **Tier 1 (Primary)**: Electron Renderer DOM Bridge (`BridgeServer` + `autoplan-dom-bridge.js`) — 100% focus-free, web-browsing safe, cross-platform.
2. **Tier 2 (Secondary)**: VS Code Command API (`antigravity.sendTextToChat`, `antigravity.prioritized.chat.openNewConversation`, `workbench.action.chat.open`).
3. **Tier 3 (Fallback)**: OS Keyboard Simulation (`KeyboardManager` via PowerShell / SendKeys) — preserved as legacy fallback with clear warnings.

Refactor `src/orchestrator.ts` to route all phase executions through `PromptDispatcher`, removing the hard dependency on `KeyboardManager.executeBatchPromptFlow()`.

---

## Requirements

### Functional Requirements
1. **3-Tier Dispatch Strategy**:
   - Attempt Tier 1 (DOM Bridge). If bridge is connected and ACKs prompt submission, return success.
   - If Tier 1 is unavailable or times out, attempt Tier 2 (VS Code Command API).
   - If Tier 2 is not supported or fails, fall back to Tier 3 (Keyboard Simulation) with user notification.
2. **Execution Mode Configuration**:
   - Support `autoplan.executionMode`: `"auto" | "domBridge" | "nativeCommand" | "keyboard"`.
   - In `"auto"` mode, automatically pick the highest available tier.
3. **Orchestrator Integration**:
   - Update `runPhaseSequence()` in `src/orchestrator.ts` to call `promptDispatcher.dispatchPrompt(renderedPrompt, options)`.
   - Capture detailed dispatch metadata (tier used, response latency, fallback reasons) in `PhaseItem.result`.
4. **Configuration & Schema Updates**:
   - Add new settings to `src/config.ts` and `package.json`:
     * `autoplan.executionMode`: string (`"auto"`, `"domBridge"`, `"nativeCommand"`, `"keyboard"`)
     * `autoplan.bridgeTimeoutMs`: number (default `5000`)
     * `autoplan.autoApprovePermissions`: boolean (default `true`)
     * `autoplan.autoInjectWorkbench`: boolean (default `true`)

### Non-Functional Requirements
- **Resilience**: Orchestrator never halts solely due to a single transport failure; it smoothly degrades down the fallback chain.
- **Observability**: Emits clear logs and progress events indicating which dispatch tier handled each phase.

---

## Implementation Steps
1. Create `src/promptDispatcher.ts`.
2. Implement `PromptDispatcher` class with `dispatchPrompt(promptText: string, options?: DispatchOptions): Promise<DispatchResult>`.
3. Implement Tier 1 dispatch via `bridgeServer.dispatchPromptCommand()`.
4. Implement Tier 2 dispatch via `vscode.commands.executeCommand('antigravity.sendTextToChat', ...)`.
5. Implement Tier 3 dispatch via `keyboardManager.executeBatchPromptFlow()`.
6. Update `src/config.ts` with new config properties.
7. Refactor `src/orchestrator.ts` to replace direct `keyboardManager` calls with `PromptDispatcher`.
8. Create file-based test suite in `src/test/phase04_prompt_dispatcher_orchestrator.test.ts`.

---

## Files to Create / Modify
- `src/promptDispatcher.ts` - [NEW] Multi-tier prompt dispatch coordinator.
- `src/config.ts` - [MODIFY] Add executionMode, bridgeTimeout, autoApprove options.
- `src/orchestrator.ts` - [MODIFY] Integrate PromptDispatcher into phase execution loop.
- `src/test/phase04_prompt_dispatcher_orchestrator.test.ts` - [NEW] File-based verification test suite.

---

## File-Based Test Specification (`src/test/phase04_prompt_dispatcher_orchestrator.test.ts`)
The test file must comprehensively verify:
1. **Tier 1 Direct Success**: Verifies `PromptDispatcher` successfully sends prompt via DOM Bridge when available.
2. **Tier 2 Command Fallback**: Mocks Tier 1 failure and verifies seamless fallback to VS Code Command API.
3. **Tier 3 Keyboard Fallback**: Mocks Tier 1 & 2 failures and verifies fallback to `KeyboardManager`.
4. **Execution Mode Override**: Verifies forced mode settings (`domBridge` only, `keyboard` only) strictly enforce the chosen transport.
5. **Orchestrator End-to-End Execution**: Runs a multi-phase test sequence through the updated `Orchestrator` using mock dispatchers and asserts all phases complete with correct tier tracking.

---
Next Phase: [Phase 05: Extension Commands, UI Diagnostics, Settings & Packaging](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/plans/260829-0952-focus-free-dom-bridge/phase-05-ui-diagnostics-packaging.md)
