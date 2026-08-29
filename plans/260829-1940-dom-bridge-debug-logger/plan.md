# DOM Bridge Diagnostic & Debug Logger Implementation Plan

This engineering plan details the design and implementation of a comprehensive **Diagnostic & Debug Logging Subsystem** for the Auto-Plan DOM Bridge (`antigravity-auto-plan`), enabling full-lifecycle error capture, deep Electron DOM inspection diagnostics, real-time VS Code Output Channel streaming, interactive webview log inspection, and 1-click clipboard / text file export for frictionless AI-assisted troubleshooting.

---

## 1. Overview & Architecture

### 1.1. Core Objectives
1. **Full-Lifecycle Telemetry & Tracing**: Record end-to-end events across both the Extension Host process (Node.js) and the Electron Renderer DOM context (`workbench.html`), tracing server lifecycle, port binding resolution, client discovery probes, heartbeat signals, command dispatch lifecycles, and acknowledgment latencies.
2. **Deep DOM Inspection & Diagnostic Engine**: When prompt injection or submit button discovery fails, capture a structured DOM snapshot (evaluated selectors with match counts, visible textareas/inputs, contenteditable nodes, ProseMirror/Monaco editors, shadowRoot boundaries, and detected `iframe` / Webview containers) instead of failing silently with empty catches.
3. **Dedicated VS Code Log Output Channel**: Stream live bridge events with formatted timestamps, log levels (`[DEBUG]`, `[INFO]`, `[WARN]`, `[ERROR]`), and component tags (`[SERVER]`, `[CLIENT]`, `[DISPATCHER]`, `[DOM]`, `[INJECTOR]`) directly to the VS Code Output panel (`Auto-Plan DOM Bridge`).
4. **1-Click Copy & Text File Export**: Provide commands (`autoplan.copyDebugLog`, `autoplan.exportDebugLog`, `autoplan.clearDebugLog`, `autoplan.showOutputChannel`) and UI buttons in the Settings Panel, Sidebar, and Failure Notifications for instant diagnostic report export to clipboard or a `.txt` file.
5. **Interactive Webview Log Viewer**: Embed a live, auto-scrolling log console in the Full-Screen Settings Panel with real-time log ingestion and filtering.

---

## 2. Phase Breakdown

| Phase | Title | Target Files | Single Verification Test | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 01** | Extension Logger Subsystem & Output Channel | `src/debugLogger.ts`, `src/config.ts` | `src/test/phase01_debug_logger_subsystem.test.ts` | ✅ Completed |
| **Phase 02** | BridgeServer Log Ingestion API & IPC Tracing | `src/bridgeServer.ts`, `src/promptDispatcher.ts` | `src/test/phase02_bridgeserver_log_tracing.test.ts` | ✅ Completed |
| **Phase 03** | Renderer DOM Diagnostic Engine & Error Recording | `media/autoplan-dom-bridge.js`, `src/workbenchInjector.ts` | `src/test/phase03_renderer_dom_diagnostics.test.ts` | ⬜ Pending |
| **Phase 04** | Export Diagnostics Commands & Webview 1-Click Integration | `src/extension.ts`, `src/settingsProvider.ts`, `src/sidebarProvider.ts`, `package.json`, `media/settings/*` | `src/test/phase04_export_diagnostics_e2e.test.ts` | ✅ Completed |

---

## 3. Execution Rules
- All phase plan files are stored in `.md` format in `plans/260829-1940-dom-bridge-debug-logger/`.
- Each phase is verified by **exactly one comprehensive file-based test**.
- No additional tests or test files shall be created or executed.
- After completing each phase, only that single test will be run for verification.
- Once finished, the assistant will stop and say `"done."`.

