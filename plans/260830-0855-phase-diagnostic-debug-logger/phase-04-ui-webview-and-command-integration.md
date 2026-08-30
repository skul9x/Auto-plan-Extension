# Phase 04: UI Webview Diagnostics, Actionable Export Commands & README Update

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02, Phase 03  
Target Files:
- `src/extension.ts`
- `src/sidebarProvider.ts`
- `src/settingsProvider.ts`
- `media/sidebar/sidebar.js`
- `media/sidebar/sidebar.css`
- `media/settings/settings.js`
- `media/settings/settings.css`
- `README.md`
- `src/test/phase04_phase_diagnostic_ui_e2e.test.ts`

---

## Objective
Expose phase execution and stall diagnostic information directly across the Auto-Plan UI interfaces (Sidebar Dashboard and Settings Panel), enhance clipboard and file export commands, provide actionable diagnostic notifications, and document phase diagnostic capabilities in `README.md`.

## Requirements

### Functional Requirements
1. **Sidebar Dashboard Stall Badges & Tooltips (`media/sidebar/*`)**:
   - In `sidebar.js`, render a status indicator and detailed tooltip on each phase item in the checklist:
     - Completed phases: Green checkmark `✅ Completed`.
     - Running phase: Blue spinning indicator `🔄 Running`.
     - Pending phases: Grey badge `⏳ Pending` with hover tooltip explaining the stall reason (e.g. *"Waiting for Phase 01 to complete"* or *"Blocked: Pre-flight check failed"*).
     - Failed phases: Red badge `❌ Failed` with error message tooltip.
2. **Settings Panel Phase Diagnostic Telemetry (`media/settings/*`)**:
   - Add a "Plan & Phase Diagnostics" card displaying active plan folder, completed/pending ratio, and real-time stall warnings.
3. **Commands & Actionable Notifications (`src/extension.ts`)**:
   - Enhance `autoplan.copyDebugLog` and `autoplan.exportDebugLog` to include phase stall diagnostics.
   - When a plan fails or stalls, display an actionable notification offering:
     - `📋 Copy Diagnostic Log`
     - `⚙️ Open Settings`
     - `🔄 Retry Failed Phase`
4. **Documentation (`README.md`)**:
   - Update `README.md` to document the Phase Diagnostics & Stall Analyzer features, explaining how to inspect executed vs. pending phases and troubleshoot stalled executions.

### Non-Functional Requirements
- Maintain fast, smooth Webview rendering with no layout shift or UI flickering.
- Full cross-platform compatibility across Windows, Linux, and macOS.

## Files to Create / Modify
- `src/extension.ts` - Update export commands and actionable notifications.
- `src/sidebarProvider.ts` & `media/sidebar/*` - Send and render phase stall diagnostic badges.
- `src/settingsProvider.ts` & `media/settings/*` - Display phase telemetry in settings.
- `README.md` - Document Phase Diagnostic & Stall Analyzer features.

## Verification Test
- **Single Test**: `src/test/phase04_phase_diagnostic_ui_e2e.test.ts`
- **Validation Scope**:
  - Verify Webview IPC messages contain `stallReason` for pending and failed phases.
  - Verify `autoplan.copyDebugLog` and `autoplan.exportDebugLog` output phase diagnostics.
  - Verify failure notifications present actionable options.
  - Verify `README.md` contains documentation for Phase Diagnostics and Stall Analysis.
