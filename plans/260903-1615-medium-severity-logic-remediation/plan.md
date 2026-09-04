# Plan: Medium-Severity Logic Remediation (LOGIC-008, LOGIC-009, LOGIC-010, LOGIC-011, LOGIC-012)

Created: 2026-09-03 16:15:00 UTC+7  
Status: 🟡 In Progress  
Target Scope: 5 Medium-Severity Logic Flaws in Auto-Plan DOM Bridge, Sidebar UI, Plan Scanner, and Workbench Injector Subsystems

---

## 1. Overview

This plan establishes a comprehensive, phased remediation for the **5 MEDIUM-SEVERITY** logic bugs documented in `phantich.md`:

1. **LOGIC-008: False-Positive Enter ACK in Non-Monaco Editors (DomBridgeClient)**  
   When the chat send button is disabled or not found, `injectPromptAndSubmit` dispatches synthetic Enter keyboard events (`isTrusted: false`). Modern rich-text editors (Lexical, ProseMirror) reject synthetic Enter events without submitting. However, the DOM bridge marks `enterDispatched = true`, flags `isSuccess = true`, and reports success to `BridgeServer`. `PromptDispatcher` assumes Tier 1 succeeded while the text sits unsubmitted in the chat box, causing Orchestrator to hang in `waiting` state for 15 minutes.

2. **LOGIC-009: Dropped Webview State due to Missing Ready Handshake (SidebarProvider & sidebar.js)**  
   In `SidebarProvider.resolveWebviewView`, `refreshAndSendState()` and `sendBridgeStatus()` are dispatched immediately after assigning `webview.html`. At that exact instant, the webview renderer has not yet parsed `sidebar.js` nor registered `window.addEventListener('message')`. Furthermore, `sidebar.js` does not send a `ready` signal back to the extension host. Consequently, initial phase and plan data is dropped, rendering an empty or uninitialized dashboard until manually refreshed.

3. **LOGIC-010: Phase Diagnostic Misattribution on Subsets (PlanScanner)**  
   In `auditPlanPhases` and `auditPlanPhasesAsync`, `activePhaseMap` maps execution states by integer index (`activePhaseMap.set(ap.index, ap)`). When the user selects a subset of phases (e.g., Phase 3 and Phase 5), Orchestrator assigns local indices `0` and `1`. During whole-plan directory auditing, `activePhaseMap.get(0)` improperly matches Phase 1 instead of Phase 3, transferring "Running" or "Failed" statuses to incorrect phases.

4. **LOGIC-011: Auto-Approval Observer False Triggers (DomBridgeClient)**  
   `startAutoApprovalObserver` continuously scans the entire document using broad selectors (`button, [role="button"], .monaco-button`) with loose substring matching (`text.includes(pat)`). This leads to unintended clicks on negative confirmation buttons (e.g. "Don't Run", "Never Allow"), debug control buttons ("Continue"), and editor action buttons ("Run Test").

5. **LOGIC-012: Stale Backup Restoration Downgrades VS Code on Uninstallation (WorkbenchInjector)**  
   When the DOM bridge is installed, `workbench.html.autoplan.bak` is created. When VS Code updates (e.g. from v1.88 to v1.89), the active `workbench.html` is upgraded with new scripts and integrity checksums, but the `.bak` file remains on the old version. On bridge uninstallation, `uninstallBridgeScript` blindly copies `backupRaw` over `workbench.html`, reverting VS Code to an obsolete version and causing white-screen launch crashes.

---

## 2. Phase Breakdown

| Phase | Title | Target Issue | Primary Test File |
|---|---|---|---|
| **01** | [False-Positive Enter ACK Guard & Input Clearance Verification](./phase-01-false-positive-enter-ack-guard.md) | LOGIC-008 | `src/test/phase01_enter_ack_verification.test.ts` |
| **02** | [Sidebar Webview Bidirectional Ready Handshake](./phase-02-sidebar-webview-ready-handshake.md) | LOGIC-009 | `src/test/phase02_sidebar_ready_handshake.test.ts` |
| **03** | [Subset Phase Diagnostic Attribution by File Name](./phase-03-subset-diagnostic-attribution.md) | LOGIC-010 | `src/test/phase03_subset_diagnostic_attribution.test.ts` |
| **04** | [Scoped Auto-Approval Observer & False Trigger Prevention](./phase-04-scoped-auto-approval-observer.md) | LOGIC-011 | `src/test/phase04_auto_approval_observer_scope.test.ts` |
| **05** | [Safe In-Place Workbench Uninstallation & Stale Backup Elimination](./phase-05-safe-workbench-uninstallation.md) | LOGIC-012 | `src/test/phase05_safe_workbench_uninstallation.test.ts` |

---

## 3. Strict Execution Protocol

Per user requirements:
- All phase files are written in English.
- Each phase contains **exactly one** comprehensive file-based test.
- No more than one test shall be created or run per phase.
- After completing each phase, run only that single test for verification.
- Stop immediately after running the test so the user can review.
- Once finished, output `done.`.
