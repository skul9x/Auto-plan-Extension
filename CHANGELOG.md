# Changelog

All notable changes to the **Antigravity Auto-Plan Runner** extension will be documented in this file.

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
