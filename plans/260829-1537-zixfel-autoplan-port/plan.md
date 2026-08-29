# Plan: Porting Zixfel DOM Bridge Automation Features to Auto-Plan Extension

Created: 2026-08-29
Status: 🟡 In Progress

## Overview
Port the core UX automation enhancements from `zixfel.ag-auto-click-scroll-9.8.12` to `Auto-plan-Extension-main`.
This brings Zero-Click startup DOM Bridge auto-injection, silent fallback handling, and realtime sidecar config sync with renderer watchdog supervision.

## Architecture Improvements
1. **Zero-Click Startup Auto-Injection**: Auto-detect missing DOM Bridge script in `workbench.html` on extension activation and silently inject/repair without requiring manual user intervention.
2. **Silent Fallback Warning Suppressor**: Suppress non-critical fallback warning toasts (`vscode.window.showWarningMessage`) when switching between transport tiers (DOM Bridge -> Keyboard Simulation).
3. **Live Config Sidecar & Renderer Watchdog**: Sync configuration changes live to `ag-autoplan-config.json` alongside `workbench.html` and enforce periodic IPC connection watchdog supervision.

## Phases

| Phase | Name | Status | Progress | Test File |
|-------|------|--------|----------|-----------|
| 01 | Zero-Click Startup Auto-Injection & Auto-Repair | ⬜ Pending | 0% | `src/test/phase01_zero_click_auto_injection.test.ts` |
| 02 | Silent Fallback & Non-Intrusive Error Handling | ⬜ Pending | 0% | `src/test/phase02_silent_fallback_handling.test.ts` |
| 03 | Realtime Config Sidecar & Renderer Watchdog | ⬜ Pending | 0% | `src/test/phase03_sidecar_config_watchdog.test.ts` |
| 04 | Full E2E Integration & Regression Verification | ⬜ Pending | 0% | `src/test/phase04_zixfel_port_full_e2e_regression.test.ts` |

## Verification Strategy
Each phase includes exactly one comprehensive file-based test suite in TypeScript (`src/test/phaseXX_*.test.ts`) using the standalone Node test runner.
