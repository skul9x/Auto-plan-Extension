# Phase 05: Modern Settings Webview Card, End-to-End Regression & Release Packaging (v1.7.0)

Status: ✅ Completed
Test: `src/test/phase05_auto_submit_settings_ui_and_release.test.ts`

## Objective
Design and integrate an interactive control card for the RPC Auto-Submit engine into the Auto-Plan Settings Webview Dashboard, execute comprehensive end-to-end regression benchmarks, update user documentation, and package the release artifact as version `v1.7.0`.

## Scope
- Settings Webview markup and UI components in `media/settings/settings.html`, `settings.css`, and `settings.js`.
- Webview IPC message handlers in `src/settingsProvider.ts` for real-time status synchronization.
- Status badge display (`Connected`, `Waiting`, `Disabled`, `Unsupported`) and live approval counters.
- Comprehensive end-to-end regression validation covering 3-tier dispatch, Telegram controls, RPC auto-submit, and settings dashboard.
- Documentation updates in `README.md` and `CHANGELOG.md`, and version bump in `package.json` to `1.7.0`.
- VSIX packaging and production bundle verification.

## Requirements
1. **Settings Webview Card in Timing & Automation Tab**:
   - Add a dedicated "RPC Native Auto-Submit & Permission Approval" settings card inside `#tab-timing` in `media/settings/settings.html`.
   - Include controls for:
     - Master Auto-Submit Switch (On/Off).
     - Poll Interval Slider / Input (200ms - 10,000ms) with human-readable unit display.
     - Session Quota Input (max approvals before automatic pause; 0 for unlimited).
     - Telegram Notification Toggle for approval events.
   - Design controls using existing Auto-Plan design tokens, typography, and responsive CSS grid styling.
2. **Real-time Status Badge & Telemetry Synchronization**:
   - Provide IPC communication between `settingsProvider.ts` and the frontend Webview script (`settings.js`).
   - Display a live connection badge reflecting current engine state:
     - `🟢 Connected (Ready)`: RPC client discovered, listening for trajectories.
     - `🟡 Waiting for Agent`: Extension active, waiting for Antigravity Agent to start.
     - `⚪ Disabled`: Auto-Submit switched off.
     - `🔴 Unsupported`: Antigravity RPC API not detected.
   - Display total approved permissions count for the current session with a quick reset button.
3. **Instant Search & Debounced Auto-Save Integration**:
   - Ensure all new inputs, labels, and helper descriptions participate seamlessly in the existing Settings Webview Instant Search Filter with keyword highlighting and dimming.
   - Bind all input changes to the existing 300ms debounced auto-save mechanism, providing visual feedback (`Saving...`, `All changes saved`).
4. **Comprehensive Regression Benchmark Suite**:
   - Verify that adding RPC Auto-Submit introduces zero regressions to:
     - Tier 1 DOM Bridge prompt injection and double-tap submit.
     - Tier 2 VS Code command dispatch and Tier 3 keyboard simulation fallback.
     - Telegram Free-Chat gating, AWF command forwarding, and Live Q&A sync.
     - Watchdog timeout monitoring and transcript tailing performance.
5. **Documentation & Release Artifact Packaging**:
   - Update `package.json` version to `1.7.0` and register any new npm scripts.
   - Update `CHANGELOG.md` with a detailed breakdown of the v1.7.0 RPC Auto-Submit feature set.
   - Update `README.md` with clear setup, security boundaries, and usage guidelines for autonomous permission submission.
   - Verify production VSIX packaging (`antigravity-auto-plan-1.7.0.vsix`) with zero missing dependencies.

## Constraints
- Do not alter existing tab layout structure or break theme styling compatibility across Light, Dark, and High Contrast themes.
- Webview DOM elements must follow memory bounding rules established in earlier performance audits.
- Packaging must include all required production runtime dependencies while keeping VSIX size compact.

## Dependencies
- Source files: `media/settings/settings.html`, `media/settings/settings.js`, `media/settings/settings.css`, `src/settingsProvider.ts`, `package.json`, `README.md`, `CHANGELOG.md`.
- Prior phases: Phases 01 through 04.

## Acceptance Criteria
- Settings Webview displays the Auto-Submit card in `#tab-timing` with live status indicator and interactive controls.
- Modifying Auto-Submit settings in Webview updates extension configuration within 300ms.
- All unit, integration, and regression test suites pass with 100% success rate.
- `package.json` is updated to `1.7.0` and `antigravity-auto-plan-1.7.0.vsix` is created successfully.
- `README.md` and `CHANGELOG.md` accurately document the new feature set.

## Comprehensive File-Based Test
- **File**: `src/test/phase05_auto_submit_settings_ui_and_release.test.ts`
- **Scope**:
  - Validates Webview DOM elements, controls, and event listeners in `settings.html` and `settings.js`.
  - Tests IPC round-trip messages between Settings Webview and `SettingsProvider` for auto-submit configuration and status queries.
  - Executes end-to-end regression validation asserting seamless co-existence of RPC Auto-Submit with 3-tier prompt dispatch and Telegram mirroring.
  - Verifies manifest version bump and integrity of package build artifacts.

