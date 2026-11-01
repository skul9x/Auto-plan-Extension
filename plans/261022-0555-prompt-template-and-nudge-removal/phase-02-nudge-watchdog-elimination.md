# Phase 02: Nudge Watchdog Elimination & Settings UI Remediation

Status: ⬜ Pending
Test: `src/test/phase02_nudge_watchdog_removal.test.ts`

## Objective
Completely eliminate the 3-minute mid-flight nudge watchdog mechanism, purging all associated timer scheduling, prompt injection logic, Telegram nudge alerts, configuration schema definitions, and Webview settings controls to prevent intrusive mid-flight prompts and remove dead code.

## Scope
- Runtime orchestrator execution loop in `src/orchestrator.ts`.
- Core configuration types, interfaces, helpers, and default constants in `src/config.ts`.
- VS Code configuration contribution properties in `package.json`.
- Settings webview HTML structure, CSS styles, JavaScript bindings, and IPC synchronization in `media/settings/` and `src/settingsProvider.ts`.
- Telegram bridge notification pathways in `src/telegramBridge.ts` associated with nudge alerts.

## Requirements
1. **Orchestrator Watchdog Removal**:
   - Remove the mid-flight nudge timer initialization, countdown scheduling, and execution methods (such as `triggerLongPhaseNudge` and related timer variables) from `AutoPlanOrchestrator`.
   - Ensure phase execution lifecycle operates cleanly without setting, tracking, or clearing nudge timers.
   - Remove any nudge prompt tracking or consumption from prompt origin tracking modules if specifically dedicated to nudges.
2. **Configuration Schema Purge**:
   - In `src/config.ts`:
     - Remove `DEFAULT_LONG_PHASE_NUDGE_MESSAGE`.
     - Remove properties `longPhaseNudgeEnabled`, `longPhaseThresholdSeconds`, `longPhaseNudgeMessage`, `longPhaseNudgeRecurring`, and `longPhaseNotifyTelegram` from `AutoPlanConfig` and `DEFAULT_CONFIG`.
     - Remove `LongPhaseNudgeConfig` interface and `getLongPhaseNudgeConfig()` function.
   - In `package.json`:
     - Remove `autoplan.longPhaseNudgeEnabled`, `autoplan.longPhaseThresholdSeconds`, `autoplan.longPhaseNudgeMessage`, `autoplan.longPhaseNudgeRecurring`, and `autoplan.longPhaseNotifyTelegram` from `contributes.configuration.properties`.
3. **Settings Dashboard Webview Cleanup**:
   - Remove the Mid-Flight Nudge Watchdog settings card from the "Timing & Automation" tab in `media/settings/settings.html`.
   - Remove corresponding DOM selectors, event listeners, real-time search index terms, and debounced save field handlers in `media/settings/settings.js`.
   - In `src/settingsProvider.ts`, remove IPC handlers and configuration serialization for long-phase nudge settings.
4. **Telegram Bridge Cleanliness**:
   - Remove any Telegram message dispatching dedicated to nudge alerts in `src/telegramBridge.ts`.

## Constraints
- Ensure that removing the nudge timer does NOT disrupt the phase completion detection, transcript tailing, or timeout per loop handlers.
- Retain other timing configurations such as `delayBetweenLoopsMs`, `timeoutPerLoopMinutes`, and `focusDelayMs`.
- Maintain clean TypeScript compilation with zero unused variable warnings or broken references.

## Dependencies
- Phase 01: Prompt Template Modernization & Schema Defaults.
- Affected modules: `src/orchestrator.ts`, `src/config.ts`, `package.json`, `media/settings/`, `src/settingsProvider.ts`, `src/telegramBridge.ts`.

## Acceptance Criteria
- No timers or background intervals are created for mid-flight nudging when a phase runs beyond 180 seconds.
- `src/config.ts` and `package.json` contain zero references to `longPhaseNudge` properties or `DEFAULT_LONG_PHASE_NUDGE_MESSAGE`.
- The Settings Dashboard webview loads without errors, and the "Timing & Automation" tab renders remaining timing controls cleanly without broken layout or missing bindings.
- Saving settings from the Webview persists without errors or undefined key warnings.
- The project compiles cleanly with `npm run compile`.

## Comprehensive File-Based Test
- **File**: `src/test/phase02_nudge_watchdog_removal.test.ts`
- **Scope**:
  - Verifies that `AutoPlanConfig` and `getConfig()` do not expose or require `longPhaseNudge` fields.
  - Verifies that `package.json` no longer contains `autoplan.longPhase...` configuration keys.
  - Verifies that `AutoPlanOrchestrator` runs a mocked phase beyond 180s without scheduling timers, firing nudge events, or dispatching nudge prompts.
  - Verifies that `SettingsProvider` and the settings HTML markup do not contain orphaned nudge input elements or broken event bindings.
