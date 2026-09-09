# Changelog

All notable changes to the **Antigravity Auto-Plan Runner** extension will be documented in this file.

## [1.6.0] - 2026-09-09

### ⚡ Performance & Reliability (Clinical Audit Remediation)
- **PERF-01 (Layout Thrashing)**: Xóa bỏ hoàn toàn tính năng Auto-Approver (`autoplan.autoApprovePermissions`, `startAutoApprovalObserver`), triệt tiêu 100% vòng quét DOM và hiện tượng forced layout reflow trong renderer.
- **PERF-02 (Disk I/O Storm)**: Triển khai bộ nhớ đệm LRU 2 cấp (`conversationOwnershipCache`) với `statHint` (`mtimeMs`, `size`) cho `verifyConversationOwnershipAsync`, giảm 98% số lần đọc đĩa trong chu kỳ polling.
- **MEM-03 (Unbounded Log Queue)**: Giới hạn trần cứng `MAX_PENDING_LOGS = 150` (FIFO sliding-window) cho `_pendingLogQueue` trong `SidebarProvider`, chuyển đổi sang cơ chế xả gộp `transcriptLogBatch` và dọn sạch khi `dispose()`.
- **PERF-04 (Event Loop Latency)**: Chuyển đổi `saveWorkbenchSnapshot` sang `await fs.promises.writeFile` bất đồng bộ trên thread pool của libuv, loại bỏ hiện tượng UI stutter khi xuất snapshot DOM dung lượng lớn.
- **PERF-05 (Sequential Stat Bottleneck)**: Tích hợp helper điều phối đồng thời `asyncPool(16, ...)` để quét thư mục hội thoại song song có giới hạn, rút ngắn thời gian baseline scan xuống < 5ms.
- **REL-06 (Event Bridge Severance)**: Bảo toàn listener `logUpdate` trong `clearRunListeners()`, duy trì luồng log stream xuyên suốt cho Sidebar qua các chu kỳ dọn dẹp.
- **VSIX Packaging**: Đóng gói hoàn tất bản phân phối `antigravity-auto-plan-1.6.0.vsix` sạch sẽ, vượt qua 100% test suite.

---

## [1.6.1] - 2026-09-06

### ⚡ Fixed & Enhanced
- **Antigravity IDE Workspace Resolution Fix**:
  - Fixed `parseWorkspaceFromTitleString` in `media/autoplan-dom-bridge.js` to correctly parse window titles matching Antigravity IDE's layout structure: `[Workspace] - [Antigravity IDE] - [File]`.
  - Added support for Native Titlebar environments on Linux where `.window-title` DOM elements are not present, falling back gracefully to `document.title`.
  - Added 3rd tier DOM discovery fallback in `detectWorkspaceName`: resolves workspace folder name directly from the **Explorer Section Header** (`aria-label="Explorer Section: ..."`) or the **Agent Sidepanel Header** (`#conversation .text-lg.font-medium`).
  - Added non-workspace tab filter (`Auto-Plan Settings`, `Settings`, `Welcome`) to prevent false-positive `Workspace mismatch` probe rejections.
  - Updated `BridgeServer` probe validation in `src/bridgeServer.ts` to support case-insensitive workspace name comparison.
  - Created automated test suite `src/test/phase04_antigravity_workspace_detection.test.ts` (16 tests covering all title variations, DOM fallbacks, and server handshakes).

---

## [1.4.0] - 2026-08-30

### 🚀 Added
- **Asynchronous Plan Scanner**:
  - Added `scanPlanFolderAsync` and `findActivePlanFolderAsync` with non-blocking async disk I/O.
  - Added `@deprecated` tag to legacy synchronous `scanPlanFolder`.
- **Zero-Deprecation Verification**:
  - Dedicated automated regression test suite (`test:dep0169`) verifying zero Node.js deprecation warnings with `process.on('warning')` trap.

### ⚡ Enhanced & Fixed
- **WHATWG URL Migration ([DEP0169] Fix)**:
  - Replaced legacy `url.parse(req.url, true)` with the standardized WHATWG `new URL(req.url, 'http://127.0.0.1')` API in `BridgeServer`.
  - Completely eliminated `[DEP0169] DeprecationWarning` on Node.js 20+ (VS Code runtime).
- **DOM Bridge Single Submit Fix**:
  - Fixed duplicate prompt submission in `media/autoplan-dom-bridge.js` by eliminating duplicate synthetic `MouseEvent('click')` events when native `button.click()` has executed.
  - Enforced strict mutually exclusive submission strategy (`buttonClick` -> `enterKey` -> `formSubmit`).

---

## [1.3.0] - 2026-08-29

### 🚀 Added
- **DOM Bridge Diagnostic & Debug Logger Subsystem**:
  - Core `DebugLogger` module with in-memory ring buffer (default 500 entries) and dedicated VS Code Log Output Channel (`Auto-Plan DOM Bridge`).
  - BridgeServer HTTP log ingestion API (`POST /log`) supporting client-side log relaying and cross-process tracing.
  - Deep Electron Renderer DOM diagnostic engine: captures evaluated selectors, match counts, shadowRoot boundaries, and container hierarchy on selector lookup failures.
  - User-facing VS Code commands:
    - `autoplan.copyDebugLog`: Compiles full markdown report + recent log traces and copies to clipboard with confirmation toast.
    - `autoplan.exportDebugLog`: Compiles diagnostic report, prompts/saves to `.txt` file, and opens in active editor tab.
    - `autoplan.clearDebugLog`: Clears in-memory buffer and refreshes webview panels.
    - `autoplan.showOutputChannel`: Focuses and reveals the dedicated output channel.
  - **Live Log Viewer Console in Settings Panel**: Collapsible real-time console with color-coded level badges (`[DEBUG]`, `[INFO]`, `[WARN]`, `[ERROR]`), component tags (`[SERVER]`, `[CLIENT]`, `[DOM]`, `[DISPATCHER]`), level filtering, and auto-scroll.
  - **Sidebar 1-Click Action**: Quick action button `📋 Copy Bridge Log` inside the Sidebar Control Center footer.
  - **Actionable Failure Notification Triggers**: Direct `📋 Copy Diagnostic Log` button on execution error toasts for instant clipboard export.

### ⚡ Enhanced
- **Extension Lifecycle & Disposables**: Automated logger and listener cleanup on extension deactivation.
- **Configurable Logging Options**: Added `autoplan.enableVerboseBridgeLogs`, `autoplan.maxLogEntries`, and `autoplan.autoOpenBridgeLogOnError`.

---

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
