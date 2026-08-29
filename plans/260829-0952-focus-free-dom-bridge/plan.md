# Plan: Focus-Free DOM Bridge Automation for Auto-Plan Extension

Created: 2026-08-29 09:52
Status: ✅ Completed

## Overview
Upgrade `Auto-plan-Extension-main` from OS-level keyboard simulation (`SendKeys` via PowerShell) to a robust, focus-independent background execution architecture inspired by the Electron Renderer DOM injection pattern (as utilized in `zixfel.ag-auto-click-scroll`). This eliminates failures when users multitask or browse the web (which causes OS window focus loss), enables full cross-platform compatibility (Windows, Linux, macOS), introduces a resilient 3-tier prompt dispatching chain (DOM Bridge -> VS Code Native Commands -> Keyboard Simulation), and adds background permission approval handling.

## Tech Stack & APIs
- **Runtime**: Node.js 20+, TypeScript 5.3+, Electron WebContents DOM API
- **VS Code Extension API**: `vscode.window`, `vscode.commands`, `vscode.workspace`, `vscode.StatusBarItem`, `vscode.env.appRoot`
- **Networking & IPC**: Node.js `http`, `events`, JSON-over-HTTP polling & WebSocket/SSE-ready bridge protocol
- **DOM Technologies**: `MutationObserver`, synthetic DOM `InputEvent` & `KeyboardEvent`, `HTMLElement.click()`
- **Testing**: Node.js Test Suite & File-based integration test runners (`src/test/*.test.ts`)

## Architecture Comparison

| Capability | Legacy Auto-Plan | Upgraded Auto-Plan (DOM Bridge Architecture) |
| :--- | :--- | :--- |
| **Execution Mechanism** | OS-level keystroke injection (`PowerShell` / `SendKeys`) | Electron Renderer DOM Bridge + IPC Server + Command API |
| **Window Focus Required** | **YES** (Must be active foreground window) | **NO** (Runs entirely in background while browsing web) |
| **Multitasking Safety** | ❌ Sends prompts/keystrokes into active browser tabs | ✅ 100% isolated inside IDE Electron WebContents |
| **OS Compatibility** | Windows only | Cross-platform: Windows, macOS, Linux |
| **Permission Dialogs** | Blocks if AI requires "Allow" / "Run" approval | Background Auto-Approver for permission dialogues |
| **Fallback Resilience** | Single point of failure | 3-Tier Fallback: DOM Bridge -> Command API -> Keyboard |

---

## Phases

| Phase | Name | Status | Test File |
|---|---|---|---|
| 01 | Workbench HTML Injector & Safe Patcher | ✅ Completed | `src/test/phase01_workbench_injector.test.ts` |
| 02 | Local HTTP/IPC Bridge Server & Dispatch Protocol | ✅ Completed | `src/test/phase02_bridge_server.test.ts` |
| 03 | Electron Renderer DOM Bridge Script & Prompt Automator | ✅ Completed | `src/test/phase03_dom_bridge_script.test.ts` |
| 04 | Unified 3-Tier Prompt Dispatcher & Orchestrator Integration | ✅ Completed | `src/test/phase04_prompt_dispatcher_orchestrator.test.ts` |
| 05 | Extension Commands, UI Diagnostics, Settings & Packaging | ✅ Completed | `src/test/phase05_full_e2e_regression.test.ts` |

---

## Quick Execution Commands
- **Run Phase 01 Test**: `npm run compile && node out/test/phase01_workbench_injector.test.js`
- **Run Phase 02 Test**: `npm run compile && node out/test/phase02_bridge_server.test.js`
- **Run Phase 03 Test**: `npm run compile && node out/test/phase03_dom_bridge_script.test.js`
- **Run Phase 04 Test**: `npm run compile && node out/test/phase04_prompt_dispatcher_orchestrator.test.js`
- **Run Phase 05 Test**: `npm run compile && node out/test/phase05_full_e2e_regression.test.js`
- **Full Test Suite**: `npm test`
