# Full-Screen Settings Panel & Tier Management Implementation Plan

This engineering plan details the design and implementation of a dedicated **Full-Screen Settings Panel Webview** for the Auto-Plan Extension (`antigravity-auto-plan`), paired with an advanced **Tier Selection & Fallback Policy Engine**.

---

## 1. Overview & Architecture

### 1.1. Core Objectives
1. **Full-Screen Settings Webview Panel**: Implement a state-of-the-art, high-aesthetic configuration panel loaded in an editor tab (`vscode.WebviewPanel`) replacing plain settings forms with an interactive, responsive dashboard.
2. **Tier 1 / Tier 2 / Tier 3 Selection & Fallback Policy**:
   - **Mode Selection**: Allow users to explicitly configure the dispatch transport:
     - `Auto (Smart 3-Tier Fallback: Tier 1 -> Tier 2 -> Tier 3)`
     - `Strict Tier 1 (DOM Bridge Only - Focus-Free)`
     - `Strict Tier 2 (VS Code Native Commands Only)`
     - `Strict Tier 3 (OS Keyboard Simulation Only)`
   - **Fallback Policy**: Provide a dedicated switch `allowTierFallback` to either enable automated fallback when the primary tier fails or enforce strict single-tier execution with instant error escalation.
   - **Error Escalation**: If strict mode is chosen and the selected tier is unavailable (e.g., bridge uninstalled, command unavailable, or `xdotool` missing on Linux), the system halts immediately with actionable diagnostic feedback.
3. **Live Transport Tester & Diagnostics**: Integrated diagnostic tool inside the Settings Panel allowing 1-click live testing of any transport tier with real-time latency and status feedback.
4. **Bidirectional State Synchronization**: Live synchronization between VS Code Global/Workspace Configuration, the DOM bridge sidecar JSON (`ag-autoplan-config.json`), the Sidebar Activity Bar dashboard, and the Settings Webview.

---

## 2. Phase Breakdown

| Phase | Title | Target Files | Single Verification Test | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 01** | Configuration Schema & Strict Tier Fallback Engine | `src/config.ts`, `src/promptDispatcher.ts`, `package.json` | `src/test/phase01_config_tier_fallback_engine.test.ts` | ✅ Completed |
| **Phase 02** | Full-Screen Settings Panel Webview UI & Assets | `media/settings/settings.html`, `media/settings/settings.css`, `media/settings/settings.js` | `src/test/phase02_settings_webview_assets.test.ts` | ✅ Completed |
| **Phase 03** | Settings Panel Provider & Extension Host Integration | `src/settingsProvider.ts`, `src/extension.ts`, `src/sidebarProvider.ts`, `media/sidebar/*` | `src/test/phase03_settings_panel_provider.test.ts` | ✅ Completed |
| **Phase 04** | End-to-End Tier Execution & Diagnostics Integration | `src/orchestrator.ts`, `README.md`, `CHANGELOG.md` | `src/test/phase04_e2e_tier_execution_settings.test.ts` | ✅ Completed |

---

## 3. Execution Rules
- All phase plan files are stored in `.md` format in `plans/260829-1845-settings-panel-tier-management/`.
- Each phase is verified by **exactly one comprehensive file-based test**.
- No additional tests or test files shall be created or executed.
- Once completed, the assistant will stop and say `"done."`.
