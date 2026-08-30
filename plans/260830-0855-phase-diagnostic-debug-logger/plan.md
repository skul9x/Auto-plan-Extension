# Phase Diagnostic & Stall Analyzer Debug Logger Implementation Plan

This engineering plan details the design and implementation of an advanced **Phase Diagnostic, Execution Tracking & Stall Analyzer Subsystem** for the Auto-Plan Extension (`antigravity-auto-plan`). This subsystem enhances the existing diagnostic and debug logging infrastructure to provide granular introspection into all phase markdown files (`phase-*.md`), tracking executed vs. pending phases, and diagnosing the exact root cause behind stalled or pending phases (e.g., sequence dependencies, cascade failure blockers, pre-flight transport failures, AI transcript timeouts, or malformed markdown headers).

---

## 1. Overview & Architecture

### 1.1. Core Objectives
1. **Granular Phase Lifecycle Telemetry**: Inspect and report the lifecycle status of every `phase-*.md` file in the active plan folder (`Completed`, `Running`, `Pending`, `Failed`, `Skipped`).
2. **Intelligent Stall & Blocker Diagnostic Engine**: Automatically determine and explain *why* any phase remains pending or failed:
   - **Sequence Dependency**: Waiting for preceding phase (`phase-XX`) to finish.
   - **Cascade Failure Blocker**: Blocked because an earlier phase failed with an unhandled exception or failed dispatch.
   - **Transport & Pre-flight Blocker**: Blocked because required transport tier (DOM Bridge, VS Code native command, or OS keyboard) is disconnected, misconfigured, or missing dependencies (`xdotool`).
   - **Orchestrator State Blocker**: Blocked because orchestrator is in `idle`, `paused`, `stopped`, or `error` state.
   - **AI Response / Transcript Timeout**: Stalled because AI agent response did not emit the completion keyword (`"Done skul9x."`) within the configured timeout period.
   - **Phase Header / Markdown Syntax Issue**: Blocked or unrecognized due to missing or invalid `Status: Completed` header tags.
   - **User Deselection**: Excluded from execution queue via the Sidebar Dashboard checklist.
3. **Enhanced Diagnostic Export & Output Streaming**: Incorporate full Phase Audit & Stall Diagnostics into:
   - VS Code Log Output Channel (`Auto-Plan DOM Bridge`) with `[PHASE]` component tags.
   - 1-Click Clipboard Copy (`autoplan.copyDebugLog`).
   - Markdown Diagnostic File Export (`autoplan.exportDebugLog`).
4. **Interactive UI Visualization**:
   - Sidebar Dashboard (`media/sidebar/*`): Tooltips and visual badges highlighting the exact stall/blocker reason for pending phases.
   - Full-Screen Settings Panel (`media/settings/*`): Live Phase Execution & Diagnostic telemetry card.

---

## 2. Phase Breakdown

| Phase | Title | Target Files | Single Verification Test | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 01** | Phase Inspection & Stall Reason Analyzer Engine | `src/planScanner.ts`, `src/debugLogger.ts` | `src/test/phase01_phase_stall_analyzer.test.ts` | ✅ Completed |
| **Phase 02** | DebugLogger Phase Telemetry, Markdown Export & Output Channel | `src/debugLogger.ts`, `src/config.ts` | `src/test/phase02_debug_logger_phase_telemetry.test.ts` | ⬜ Pending |
| **Phase 03** | Orchestrator Real-Time Phase Lifecycle Tracing & Stall Watchdog | `src/orchestrator.ts` | `src/test/phase03_orchestrator_stall_watchdog.test.ts` | ✅ Completed |
| **Phase 04** | UI Webview Diagnostics, Actionable Export Commands & README Update | `src/extension.ts`, `src/sidebarProvider.ts`, `src/settingsProvider.ts`, `media/sidebar/*`, `media/settings/*`, `README.md` | `src/test/phase04_phase_diagnostic_ui_e2e.test.ts` | ✅ Completed |

---

## 3. Execution Rules
- All phase plan files are stored in `.md` format in `plans/260830-0855-phase-diagnostic-debug-logger/`.
- All phase contents and documentation are written in English.
- Each phase is verified by **exactly one comprehensive file-based test**.
- No additional tests or test files shall be created or executed.
- After completing each phase, only that single test will be run for verification.
- Once finished, the assistant will stop and say `"done."`.
