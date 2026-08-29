# Changelog

All notable changes to the **Antigravity Auto-Plan Runner** extension will be documented in this file.

## [1.2.0] - 2026-08-29

### 🚀 Added
- **Full-Screen Settings Panel**: Dedicated Webview panel (`autoplan.openSettings`) featuring real-time tier transport testing, live bridge status diagnostics, fallback toggle controls, and seamless configuration management.
- **Strict Tier Execution**: Strict mode dispatch enforcement allowing users to lock prompt transport to a specific tier (Tier 1 DOM Bridge, Tier 2 Native Commands, or Tier 3 Keyboard Simulation) with immediate fail-fast error escalation.
- **Actionable Tier Pre-Flight Error Dialogs**: Interactive error notifications with direct 1-click links to open Settings Panel, trigger 1-Click DOM Bridge Setup, or view OS prerequisites guide.
- **Live Transport Testing Diagnostic**: On-demand diagnostic test in Settings Panel with latency tracking, simulated fallback path visualization, and status reporting.

### ⚡ Enhanced
- **Orchestrator Pre-Flight Readiness**: Enhanced pre-flight validation in `runPhaseSequence()` and `start()` incorporating `executionMode` and `allowTierFallback` parameters.
- **Resilient Fallback Policy Controls**: Granular configuration (`autoplan.allowTierFallback` and `autoplan.strictMode`) providing full control over multi-tier fallback cascade.

---

## [1.1.0] - 2026-08-29

### 🚀 Added
- **Sidebar Control Center UI**: Built-in Webview sidebar dashboard for viewing phase tree, toggling custom phase checkboxes, initiating execution, streaming real-time AI transcripts, and tracking overall progress.
- **Focus-Free DOM Automation Bridge**: Internal HTTP IPC bridge injected directly into VS Code / Antigravity workbench HTML for zero-focus prompt dispatching.
- **Cross-Platform Elevation & 1-Click Setup**:
  - **Linux**: Polkit (`pkexec`) elevation command builder for modifying system-protected workbench files and updating `product.json` SHA256 checksums.
  - **Windows**: PowerShell UAC (`Start-Process -Verb runAs`) elevation command builder.
  - `autoplan.oneClickSetup`, `autoplan.installBridge`, `autoplan.uninstallBridge`, and `autoplan.checkBridgeStatus` commands.
- **Zero-Timeout Fail-Fast Pre-Flight Guard**: Instant readiness validation (< 100ms) with multi-tier dispatch fallback matrix (`domBridge` -> `keyboard` -> `failFast`).
- **Actionable System Notifications**: Interactive warning dialogs with direct remediation actions (*Install Bridge*, *Reload Window*).
- **Multi-Platform E2E Verification Test Suite**: Added `src/test/phase05_e2e_cross_platform_release.test.ts`.

### ⚡ Enhanced
- **Strict Transcript Watcher**: Zero false-positive event parsing with byte offset tracking, UTF-8 chunk buffering, and distinct `USER_INPUT` vs `MODEL` event matching.
- **Dynamic Prompt Template Engine**: Multi-variable template replacement supporting `{xxx}`, `{path}`, `{file}`, `{phasePath}`, and `{phaseFile}`.
- **Status Bar & Tooltips**: Interactive running menu and Markdown status tooltips.

### 🐛 Fixed
- Resolved fragmented log JSONL parsing issues when agent streams large outputs.
- Handled Windows vs Linux path normalization inconsistencies for phase files.

---

## [1.0.5] - 2026-08-28

### 🚀 Added
- Initial release of Antigravity Auto-Plan Runner with folder scanning, natural alphanumeric sorting, 2-step QuickPick menu, and batch keyboard simulation.
