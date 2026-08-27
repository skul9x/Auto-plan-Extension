# Plan: Custom Phase Selection & Interactive QuickPick Automation

Created: 2026-08-28 01:25
Status: 🟡 In Progress

## Overview
Enable granular, interactive selection of specific phase markdown files after choosing a plan directory in the VS Code Auto-Plan extension. The user can choose to run all phases, resume unfinished phases, run from a specific phase to the end, or custom-select phases using a multi-select QuickPick with smart completion detection, `Select All` / `Deselect All` buttons, natural sorting, and validation guards.

## Tech Stack & APIs
- TypeScript 5.3+ / Node.js 20+
- VS Code Extension API: `vscode.window.createQuickPick`, `vscode.QuickInputButton`, `vscode.QuickInputButtons.Back`, `vscode.ThemeIcon`, `vscode.StatusBarItem`
- Natural collation: `Intl.Collator`

## Phases

| Phase | Name | Status | Test File |
|-------|------|--------|-----------|
| 01 | Smart Phase Scanner & Status Detection | ⬜ Pending | `src/test/phase01_smart_phase_scanner.test.ts` |
| 02 | Interactive Multi-Select QuickPick UI & Action Menu | ⬜ Pending | `src/test/phase02_custom_phase_quickpick.test.ts` |
| 03 | Orchestrator & Status Bar Progress Integration | ⬜ Pending | `src/test/phase03_selected_phases_orchestrator.test.ts` |
| 04 | Full E2E Integration, Regression & VSIX Packaging | ⬜ Pending | `src/test/phase04_custom_phase_e2e_packaging.test.ts` |

## Quick Commands
- Phase 1 execution: Implement Phase 01 and run `node out/test/phase01_smart_phase_scanner.test.js`
- Phase 2 execution: Implement Phase 02 and run `node out/test/phase02_custom_phase_quickpick.test.js`
- Phase 3 execution: Implement Phase 03 and run `node out/test/phase03_selected_phases_orchestrator.test.js`
- Phase 4 execution: Implement Phase 04 and run `node out/test/phase04_custom_phase_e2e_packaging.test.js`
