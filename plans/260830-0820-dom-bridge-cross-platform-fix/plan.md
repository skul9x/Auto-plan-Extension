# Plan: Cross-Platform DOM Bridge Fix & Linux/Windows Compatibility

**Plan Directory:** `plans/260830-0820-dom-bridge-cross-platform-fix`  
**Created:** 2026-08-30  
**Status:** 🟡 In Progress  
**Scope:** Windows & Linux Compatibility for DOM Bridge Injection & Prompt Dispatch

---

## 1. Overview & Problem Statement
During DOM Bridge prompt dispatch execution in Antigravity IDE (Electron 39 / Node 22), the renderer client failed with a critical Temporal Dead Zone (TDZ) ReferenceError:
```text
[ERROR] [CLIENT] Command cmd_... (sendPrompt) execution failed: Cannot access 'win' before initialization
```
This failure prevented prompt text from being injected into the chat input and submitted. Additionally, the cross-platform release verification tests contained hardcoded VSIX version assertions that failed during test runs.

This plan addresses the root-cause bug, solidifies cross-platform support across both **Windows** and **Linux** (including elevation handling, permission structures, and DOM event cascades), adds comprehensive file-based tests for each phase, and updates packaging/release verification.

---

## 2. Architecture & Compatibility Matrix

| OS Platform | Elevation Mechanism | Workbench Path Layout | Chat Input Target | Fallback Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **Windows** (win32) | PowerShell `Start-Process -Verb runAs` | `out/vs/code/electron-browser/workbench/workbench.html` | ContentEditable / Monaco / ProseMirror | DOM Bridge -> Native Commands -> Keyboard |
| **Linux** (linux) | Polkit `pkexec` + `chmod 644` | `/usr/share/...` or `~/.local/share/...` | ContentEditable / Monaco / ProseMirror | DOM Bridge -> Native Commands -> Keyboard |

---

## 3. Implementation Phases

| Phase | Phase Name | Focus Area | Verification Test File | Status |
| :--- | :--- | :--- | :--- | :--- |
| **01** | [Phase 01: DOM Bridge TDZ & Safe Context Resolution](file:///d:/skul9x/Auto-plan-Extension-main/plans/260830-0820-dom-bridge-cross-platform-fix/phase-01-dom-bridge-tdz-and-injection-fix.md) | Fix TDZ in `media/autoplan-dom-bridge.js`, safe `window`/`document` resolution, input injection cascade | `src/test/phase01_dom_bridge_tdz_fix.test.ts` | ⬜ Pending |
| **02** | [Phase 02: Cross-Platform Workbench Injection & Elevation](file:///d:/skul9x/Auto-plan-Extension-main/plans/260830-0820-dom-bridge-cross-platform-fix/phase-02-cross-platform-injection-and-elevation.md) | Windows & Linux elevation commands, path normalization, permission preservation, checksum verification | `src/test/phase02_cross_platform_injection.test.ts` | 0% |
| **03** | [Phase 03: End-to-End Regression & Release Packaging](file:///d:/skul9x/Auto-plan-Extension-main/plans/260830-0820-dom-bridge-cross-platform-fix/phase-03-full-regression-e2e-release-verification.md) | Fix dynamic VSIX verification in tests, full multi-tier execution regression, build & package | `src/test/phase03_e2e_cross_platform_release_fix.test.ts` | 0% |

---

## 4. Quick Execution Commands
- **Phase 01 Test:** `npx ts-node src/test/phase01_dom_bridge_tdz_fix.test.ts` or `npm run compile && node out/test/phase01_dom_bridge_tdz_fix.test.js`
- **Phase 02 Test:** `npm run compile && node out/test/phase02_cross_platform_injection.test.js`
- **Phase 03 Test:** `npm run compile && node out/test/phase03_e2e_cross_platform_release_fix.test.js`
- **Full Suite:** `npm test`
