# Master Implementation Plan: Cross-Platform Support (Windows & Linux) & UI/UX Sidebar Overhaul

Created: 2026-08-29 11:00
Status: 🟢 Completed
Target Version: v1.1.0
Source Specification: `6.md`

## Executive Summary
This engineering plan upgrades the Auto-Plan Extension to achieve 100% feature parity on both **Windows** and **Linux** (macOS explicitly excluded), eliminates manual terminal interventions through **1-Click GUI Elevation** (Linux Polkit `pkexec` & Windows UAC `Start-Process -Verb runAs`), enforces **< 100ms Fail-Fast Pre-Flight Guards** against 15-minute hanging loops, introduces a native Linux keyboard simulation fallback (`xdotool`), and adds an **Activity Bar Sidebar Control Center** (VS Code `WebviewViewProvider`) for interactive phase management, real-time AI transcript monitoring, and execution controls.

## Tech Stack & Core Dependencies
- **Runtime**: Node.js 20+, TypeScript 5.3+, Electron WebContents Sandbox
- **VS Code Extension API**: `vscode.window.registerWebviewViewProvider`, `vscode.commands`, `vscode.env.appRoot`, `vscode.StatusBarItem`
- **IPC & Networking**: Node.js `http`, `events`, JSON-RPC over HTTP Bridge (`localhost:48860+`)
- **OS Elevation & Input**: 
  - Linux: Polkit `pkexec`, `xdotool` (X11/Wayland input synthesis)
  - Windows: PowerShell UAC (`Start-Process powershell -Verb runAs`), WScript.Shell SendKeys
- **UI & Webview**: Vanilla HTML5, Modern CSS (Glassmorphism, Dark Theme, Micro-animations), Vanilla ES6 JS (bidirectional `postMessage` IPC)
- **Testing**: Standalone Node.js TypeScript Test Suites (`src/test/*.test.ts`) executed via `npm run compile && node out/test/...`

---

## Phase Breakdown

| Phase | Phase Name | Status | Target Files | Verification Test File |
| :---: | :--- | :---: | :--- | :--- |
| **01** | Cross-Platform Elevation & Linux Keyboard Adapter | ✅ Completed | `src/workbenchInjector.ts`<br>`src/keyboardManager.ts` | `src/test/phase01_cross_platform_elevation_keyboard.test.ts` |
| **02** | Zero-Timeout Fail-Fast Pre-Flight Guard | ✅ Completed | `src/promptDispatcher.ts`<br>`src/orchestrator.ts` | `src/test/phase02_failfast_preflight_guard.test.ts` |
| **03** | Sidebar Control Center Webview Provider & UI | ✅ Completed | `src/sidebarProvider.ts`<br>`media/sidebar/*`<br>`media/icon.svg` | `src/test/phase03_sidebar_webview_provider.test.ts` |
| **04** | Actionable Notifications & System Integration | ✅ Completed | `package.json`<br>`src/extension.ts`<br>`src/orchestrator.ts` | `src/test/phase04_actionable_notifications_integration.test.ts` |
| **05** | Multi-Platform End-to-End Verification & Release | ✅ Completed | `package.json`<br>`README.md`<br>`CHANGELOG.md` | `src/test/phase05_e2e_cross_platform_release.test.ts` |

---

## Test Execution Matrix
```bash
# Compile TypeScript to JavaScript
npm run compile

# Run individual phase tests
node out/test/phase01_cross_platform_elevation_keyboard.test.js
node out/test/phase02_failfast_preflight_guard.test.js
node out/test/phase03_sidebar_webview_provider.test.js
node out/test/phase04_actionable_notifications_integration.test.js
node out/test/phase05_e2e_cross_platform_release.test.js

# Full Test Suite Verification
npm test
```
