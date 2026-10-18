# Phase 01: Configuration Schema & DOM Bridge Stop Command Subsystem

Status: ✅ Completed
Test: `src/test/phase01_nudge_config_and_bridge_stop.test.ts`

## Goals
1. Define configuration settings for the Long-Running Phase Nudge Watchdog in `src/config.ts` and `package.json`.
2. Implement a dedicated `stopGeneration` command in the DOM Bridge client (`media/autoplan-dom-bridge.js`) leveraging `findCancelButton(doc)`.
3. Expose `dispatchStopGenerationCommand` on `BridgeServer` (`src/bridgeServer.ts`) and `stopActiveGeneration` on `PromptDispatcher` (`src/promptDispatcher.ts`).
4. Validate with a single comprehensive file-based test: `src/test/phase01_nudge_config_and_bridge_stop.test.ts`.

## Implementation Details

### 1. Configuration Settings
Add configuration entries with robust fallbacks:
- `autoplan.longPhaseNudgeEnabled` (boolean, default: `true`): Enables or disables automatic nudging for phases running longer than threshold.
- `autoplan.longPhaseThresholdSeconds` (number, default: `180`): Threshold in seconds (3 minutes) before triggering mid-flight nudge.
- `autoplan.longPhaseNudgeMessage` (string, default: `" Search online to find the best practices. Note, do not open a browser and directly access the DOM. Use search_web / read_url_content when you need to look something up. "`): Exact prompt message dispatched to the IDE.
- `autoplan.longPhaseNudgeRecurring` (boolean, default: `false`): Whether to trigger only once (false) or periodically (true).
- `autoplan.longPhaseNotifyTelegram` (boolean, default: `true`): Whether to alert the user on Telegram when a nudge is triggered.

### 2. DOM Bridge Stop Command
In `media/autoplan-dom-bridge.js`:
- Handle command `cmd.type === 'stopGeneration'`:
  - Query active Cancel button using `findCancelButton(doc)`.
  - If found:
    - Dispatch click event cascade to cancel ongoing AI generation.
    - Wait up to 500ms for input clearance / send button readiness.
    - Send ACK `status: 'stopped'`.
  - If not found (agent is already idle):
    - Send ACK `status: 'idle'`.

### 3. Bridge Server & Dispatcher Coordination
In `src/bridgeServer.ts`:
- Add `dispatchStopGenerationCommand(options?: CommandOptions): Promise<CommandAckResult>`
In `src/promptDispatcher.ts`:
- Add `stopActiveGeneration(options?: DispatchOptions): Promise<boolean>`:
  - Tier 1: Dispatches `stopGeneration` command to BridgeServer.
  - Tier 2 fallback: Executes VS Code native commands (e.g., `workbench.action.chat.stop` or `antigravity.prioritized.chat.stop`).

## Verification
- Test: `src/test/phase01_nudge_config_and_bridge_stop.test.ts`
- Verifies configuration retrieval, default values, command dispatch routing, and Cancel button trigger handling.
