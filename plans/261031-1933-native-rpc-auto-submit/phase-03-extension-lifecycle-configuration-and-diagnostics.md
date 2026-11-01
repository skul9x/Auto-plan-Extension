# Phase 03: Extension Lifecycle, Configuration Schema & Realtime Diagnostics

Status: ✅ Completed
Test: `src/test/phase03_auto_submit_lifecycle_and_diagnostics.test.ts`

## Objective
Seamlessly integrate the RPC Auto-Submit engine into the Auto-Plan extension lifecycle, register intuitive configuration properties with live hot-reloading, expose interactive diagnosis commands, and provide structured telemetry logging.

## Scope
- Configuration schema additions in `package.json` under `autoplan.autoSubmit.*`.
- Strongly-typed configuration access and live change listeners in `src/config.ts`.
- Lifecycle activation, startup scheduling, and clean disposal in `src/extension.ts`.
- Diagnostic command registration (`autoplan.diagnoseAutoSubmit`) outputting detailed connection states.
- Status bar item or health status reporting integration.

## Requirements
1. **Configuration Schema Specification**:
   - Register the following properties in `package.json`:
     - `autoplan.autoSubmit.enabled` (boolean, default: `false`): Master switch for automatic permission submission.
     - `autoplan.autoSubmit.intervalMs` (number, default: `1000`, min: `200`, max: `60000`): Polling interval in milliseconds.
     - `autoplan.autoSubmit.maxQuota` (number, default: `0`): Maximum approvals allowed per session (0 = unlimited).
     - `autoplan.autoSubmit.notifyTelegram` (boolean, default: `true`): Whether to forward approval events to Telegram.
   - Bind default values and validation rules cleanly in `src/config.ts`.
2. **Dynamic Configuration Hot-Reloading**:
   - Listen to `vscode.workspace.onDidChangeConfiguration` events targeting `autoplan.autoSubmit`.
   - Update active engine parameters dynamically without requiring window reloads.
   - Automatically trigger immediate scheduling when toggled from disabled to enabled, and cleanly stop active polling timers when disabled.
3. **Robust Extension Lifecycle Management**:
   - Instantiate and manage the RPC Auto-Submit service inside `activate()` in `src/extension.ts`.
   - Ensure that closing workspaces, switching folders, or deactivating the extension terminates all timers, cancels pending AbortControllers, and clears temporary state cleanly.
   - Prevent duplicate service instances from running simultaneously during Extension Host restarts.
4. **Interactive Diagnostics Command**:
   - Register the command `autoplan.diagnoseAutoSubmit` in `package.json`.
   - When executed, query the active engine status (RPC connectivity, trajectory summary counts, waiting step count, eligible permissions, total approved counter, and last error) and print a structured, human-readable report to the Auto-Plan Output Channel.
   - Surface actionable suggestions if the built-in extension is inactive or if the RPC client is unavailable.

## Constraints
- Never crash extension activation if `google.google-antigravity` is unavailable; start in a non-blocking `waiting` state.
- Keep diagnostic channel output clean and readable, adhering to existing logging styles in `src/debugLogger.ts`.
- Ensure settings hot-reload performs zero file I/O on unchanged properties.

## Dependencies
- Source files: `src/antigravityRpcAutoSubmit.ts`, `src/config.ts`, `src/extension.ts`, `package.json`.
- Prior phases: Phases 01 and 02.

## Acceptance Criteria
- Configuration properties are accessible via `AutoPlanConfig` and update dynamically when modified in VS Code settings.
- Activating and deactivating the extension registers and disposes the auto-submit service without resource leaks or dangling timers.
- Executing `autoplan.diagnoseAutoSubmit` outputs the current engine phase (`ready`, `waiting`, `disabled`, or `unsupported`) and detailed statistics to the output channel.
- Disabling `autoplan.autoSubmit.enabled` halts polling immediately; re-enabling resumes execution within 500ms.

## Comprehensive File-Based Test
- **File**: `src/test/phase03_auto_submit_lifecycle_and_diagnostics.test.ts`
- **Scope**:
  - Tests configuration schema parsing and hot-reload reactions when settings change from disabled to enabled.
  - Verifies extension activation and clean disposal, ensuring no unhandled promises or open timers remain after deactivation.
  - Verifies `autoplan.diagnoseAutoSubmit` command execution and formats of output channel diagnostic logs.
  - Tests multi-workspace folder switching behavior and validation of active workspace boundaries.

