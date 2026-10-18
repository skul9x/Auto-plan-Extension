# Changelog

All notable changes to the **Antigravity Auto-Plan Runner** extension will be documented in this file.

## [1.6.7] - 2026-10-14

### 🤖 Telegram Remote Control & Settings UI Modernization
- **Free-Text Chat Silent Drop Gating (`autoplan.telegram.allowFreeChat`)**:
  - Independent configuration toggle allowing arbitrary text messages sent to the Telegram bot to be silently dropped without triggering prompts in Antigravity IDE.
  - Zero event-loop overhead, zero spurious error messages, and zero bot replies for unprompted messages when disabled.
  - Preserves 100% functionality for all management commands (`/plans`, `/plan_status`, `/screen`, `/new_chat`) and AWF workflow commands (`/init`, `/plan`, `/design`, `/code`, `/recap`, etc.).
  - Dynamic live options update via `applyOptions` and configuration reloading without requiring bot restart.
- **Modern Tab-Based Settings Dashboard & Instant Search Filter**:
  - Restructured the monolithic settings panel into 4 structured, responsive categories:
    - 🔀 **Dispatch & Tiers**: Prompt dispatch strategy (Smart Cascade / Tier 1/2/3), fallback policies, bridge injection, and transport diagnostic tools.
    - 🤖 **Telegram & Remote**: Master bot switch, free-text chat gating toggle, live Q&A mirroring toggle, SecretStorage token management, whitelist configuration, and throttle interval.
    - ⏱️ **Timing & Automation**: Delay intervals, timeout thresholds, repetition counts, phase nudge watchdog settings, default plan directory, and completion keywords.
    - 🩺 **Diagnostics & Logs**: Real-time phase audit summary, DOM bridge live log viewer, clipboard export, and buffer clearing.
  - Instant client-side search filter indexing all settings, descriptions, and labels across tabs with real-time highlighting and visual dimming.
  - Persistent tab selection state restored seamlessly across Webview sessions via `vscode.setState()` / `vscode.getState()`.
- **Optimistic Auto-Saving & Secure SecretStorage Token Management**:
  - Master Telegram bot toggle with optimistic rollback: prompts for token entry via VS Code modal when turned on without a token; if cancelled, immediately reverts switch to OFF.
  - Secure credential storage using VS Code `SecretStorage` (`context.secrets`) inside OS Keychains; Webview receives strictly boolean presence (`hasToken`) with zero plaintext leaks.
  - Seamless 300ms debounced auto-save with optimistic UI updates, visual status pill indicators (`Saving...`, `All changes saved`), and instant configuration synchronization.

---

## [1.6.6] - 2026-10-12

### ⚡ Performance, Resource & Event Loop Remediation
- **Event-Driven Transcript Tailing & Throttled Conversation Discovery (PERF-01)**:
  - Decoupled high-frequency periodic byte-offset polling (300ms) from heavy directory traversal (`findLatestConversation`).
  - Native filesystem event monitoring (`fs.watch`) on `.brain/` directory to trigger discovery immediately only upon conversation creation or folder rename.
  - Enforced a minimum 5000ms discovery throttle interval during steady-state polling, reducing disk I/O operations from 160–330 ops/sec down to near-zero (>90% I/O reduction).
  - Implemented top-N candidate folder pruning (`maxDiscoveryCandidates = 20`) to eliminate exhaustive recursive stats across hundreds of historical sessions.
- **Asynchronous Non-Blocking Telegram Legacy Fallback (PERF-02)**:
  - Completely eradicated synchronous filesystem calls (`fs.statSync`, `fs.readdirSync`, `fs.existsSync`) from `awaitAndReplyModelResponse` and path resolution.
  - Converted directory search routines to asynchronous `findLatestConversationAsync` and `fs.promises.stat()`.
  - Implemented 1500ms directory scan throttling during unresolved path waiting, eliminating event loop blocking on the Extension Host main thread.
- **Adaptive Dual-Tier DOM Bridge Polling with Instant Wakeup (PERF-03)**:
  - Replaced legacy fixed 500ms continuous HTTP polling in `media/autoplan-dom-bridge.js` with an adaptive dynamic state machine:
    - **Active Tier (400ms)**: Automatically engaged during plan execution, prompt injection, and for 30s following any user interaction or command dispatch.
    - **Idle Tier (2000ms)**: Engaged after 30s of inactivity, reducing loopback HTTP request volume by 75–80% (well exceeding 70% reduction target).
  - Instant wakeup listener hooks (`keydown`, `pointerdown`, `click`, `wheel`) immediately reset polling interval back to 400ms on first user interaction.
- **Zero-Allocation Fast-Path User Prompt Extraction (PERF-04)**:
  - Optimized `extractUserPrompt` with a delimiter-free fast path for plain text inputs lacking XML tags, completely bypassing expensive regular expression passes.
  - Replaced full-buffer multi-pass regex replacements with substring slicing and targeted tag stripping, eliminating large string heap allocations and GC pressure.

---

## [1.6.5] - 2026-10-11

### ⏱️ Long-Running Phase Nudge Watchdog & Mid-Flight Steering
- **Proactive Phase Nudge Watchdog (`Orchestrator`)**:
  - Automatically monitors active phase execution duration and triggers mid-flight steering if running longer than threshold (default 180s / 3 minutes).
  - Strict one-shot per-phase intervention guarantee with optional recurring scheduling support (`autoplan.longPhaseNudgeRecurring`).
  - Safe lifecycle management: watchdog timers immediately disposed on phase completion, phase skip, automation stop, or when disabled.
  - Non-fatal resilient error handling ensuring watchdog failures do not terminate or stall the main orchestrator loop.
- **Cooperative DOM Bridge Stop Generation (`stopGeneration` / `findCancelButton`)**:
  - Automatically detects active AI response generation via DOM Cancel button (`findCancelButton`) and dispatches focus-free synthetic click cascade to cleanly stop generation.
  - Multi-tier cancellation support: Tier 1 focus-free DOM Bridge command routing with fallback to Tier 2 VS Code native chat cancel command.
  - Waits for chat input stabilization and send button re-enablement before mid-flight prompt injection.
- **Mid-Flight Steering Prompt Injection & Origin Tracking (`PromptDispatcher` & `PromptOriginTracker`)**:
  - Seamlessly injects best-practice steering prompt into existing conversation without spinning up redundant new chats (`openNewConversation: false`).
  - Default nudge message: `" Search online to find the best practices. Note, do not open a browser and directly access the DOM. Use search_web / read_url_content when you need to look something up. "`.
  - Introduces `PromptOrigin.SYSTEM_NUDGE` in `PromptOriginTracker` to prevent duplicate mirroring while clearly distinguishing automated steering from user questions.
- **Telegram Nudge Alert Hooks & Live Dashboard Sync (`TelegramBridge` & `TelegramNotifier`)**:
  - Proactively delivers real-time Telegram alerts to authorized users upon watchdog trigger: `⏱️ [Auto-Plan Nudge] Phase X running > 3m: Dispatched best-practice steering prompt into IDE chat.`.
  - Dynamically displays visual nudge status indicators (`⏱️ Nudged`) in the interactive Live Control Dashboard and `/plan_status` overview.
  - Synchronizes nudge viewmodel state and telemetry events to the Sidebar Webview dashboard.
- **Configurable Settings Schema (`contributes.configuration`)**:
  - `autoplan.longPhaseNudgeEnabled` (boolean, default `true`): Enable/disable automated phase nudge watchdog.
  - `autoplan.longPhaseThresholdSeconds` (number, default `180`): Threshold in seconds before triggering mid-flight nudge.
  - `autoplan.longPhaseNudgeMessage` (string): Customizable prompt message dispatched to the IDE.
  - `autoplan.longPhaseNudgeRecurring` (boolean, default `false`): One-shot vs periodic recurring nudge.
  - `autoplan.longPhaseNotifyTelegram` (boolean, default `true`): Send real-time Telegram notification on nudge trigger.

---

## [1.6.4] - 2026-10-11

### 💬 Telegram Clean Q&A Sync (Two-Way Live Question & Answer Mirror)
- **Continuous Byte-Offset Transcript Tail Engine (`TranscriptTailEngine`)**:
  - Low-overhead persistent file tailing via `readOffset` byte tracking on active Antigravity conversation transcripts (`transcript.jsonl`).
  - High-performance streaming parser emitting typed events: `USER_INPUT`, `PLANNER_RESPONSE`, and `agent_activity` (tool execution, thinking steps).
  - O(1) constant RAM footprint regardless of transcript file size, with zero reliance on DOM attachment or browser inspection.
- **Prompt Deduplication & Origin Tracking (`PromptOriginTracker`)**:
  - In-memory normalized ring buffer with 60-second TTL tracking prompt origins (`Origin.TELEGRAM` vs `Origin.PC`).
  - Completely suppresses redundant mirroring of questions initiated from Telegram.
  - Forwards questions typed directly on the PC keyboard with a distinct identifier: `💻 You (on PC): <Question>`.
- **Live Typing Action Indicators (`TypingActionManager`)**:
  - Emits Telegram `sendChatAction: typing` every 4 seconds while the AI agent is actively executing tools or reasoning.
  - Automatically cancels typing status as soon as response chunk delivery begins.
- **Smart Markdown Code Block Aware Chunker (`SmartMarkdownChunker`)**:
  - Partitions oversized assistant responses into safe chunks (<= 4000 characters) strictly respecting Telegram's 4096-character limit.
  - Line- and paragraph-aware splitting preserving markdown syntax integrity.
  - Tracks open code fences (```) across boundaries, automatically closing fences at chunk ends and re-opening them at the start of succeeding chunks to prevent formatting corruption.
- **Two-Way Live Chat Mirror & Throttled Delivery (`TelegramChatMirror`)**:
  - Unified orchestrator synchronizing PC prompt mirroring, typing indicator lifecycles, and AI response chunk delivery.
  - Enforces minimum 1000ms delay between consecutive chunk transmissions to adhere to Telegram rate limit policies.
  - Resilient handling of Telegram HTTP `429 Too Many Requests` with automatic exponential backoff (`retry_after`).
  - Configurable settings: `autoplan.telegram.enableChatMirror`, `autoplan.telegram.mirrorIncludePcPrompts`, and `autoplan.telegram.chatMirrorPrefix`.

### 🚀 Interactive Telegram Remote Control & Live Control Dashboard UX Optimization
- **4-Screen End-to-End Interactive Remote Flow (`/plans`)**:
  - **Screen 1 (Main Folder List & Quick Resume)**:
    - Automatically discovers pending plan folders and surfaces a prominent `[⚡ Tiếp tục: <Tên>]` one-click resume button at the top of the list for instant continuation.
    - Displays interactive folder cards with visual progress bar indicators (`▰▰▰▰▱▱▱`) and status metrics.
    - Integrates active text editor detection to immediately prompt execution for open phase plan markdown files.
  - **Screen 2 (Execution Mode Selector)**:
    - Provides a dedicated mode selection screen with overall progress details and 3 tailored execution modes: Run Only Pending, Run All, and Manual Selection.
  - **Screen 3 (Smart Phase Picker with Batch Controls & Compact 2-Column Grid)**:
    - Mobile-optimized 2-column inline keyboard grid eliminating label ellipsis (`...`) and button wrapping on mobile devices.
    - Batch selection controls (`[✅ Tất cả]`, `[⚡ Chưa chạy]`, `[⬜ Bỏ chọn]`) with instant toast notifications.
    - Dynamic execution counter button (`[▶️ Bắt đầu (X/Y phase)]`) reflecting live selection state.
    - Zero-selection safeguard preventing empty executions with alert modal feedback.
  - **Screen 4 (Interactive Live Control Dashboard)**:
    - In-place message transformation (`editMessageText`) into a real-time execution dashboard with Unicode block progress bars (`▰▰▰▱▱`) and percentage counters.
    - Live operational controls: `[⏭️ Bỏ qua Phase]`, `[🛑 Dừng lại]`, `[📸 Chụp màn hình]`, `[🔄 Cập nhật]`, and `[📂 Danh sách Plans]`.
    - Event-driven integration with Orchestrator lifecycle (`phaseStart`, `phaseComplete`, `allComplete`, `stopped`).
- **Telegram Safety & Reliability Hardening**:
  - **Strict 64-Byte Callback Constraint**: 100% of generated InlineKeyboard buttons adhere to Telegram's 64-byte payload limit with compact namespaced keys (`p:res:`, `p:fld:`, `p:mod:`, `p:bt:`, `p:tog:`, `p:run:`, `p:db:`).
  - **Parse Mode Safety**: Bulletproof text and markdown sanitization preventing Telegram syntax parsing errors when plan directory or file names contain underscores (`_`).
  - **Dashboard Anti-Rate-Limit Throttler (`DashboardThrottler`)**: 1200ms throttling interval preventing Telegram API HTTP `429 Too Many Requests` during rapid phase transitions.
  - **Soft Error Resilience**: Graceful handling of Telegram `400 Bad Request: message is not modified` on manual dashboard refresh.
- **Packaging & Quality Assurance**:
  - Clean TypeScript compilation with zero errors.
  - Comprehensive standalone E2E validation suite (`phase05_plans_ux_optimization_e2e.test.ts`).
  - Production-ready packaged release artifact `antigravity-auto-plan-1.6.4.vsix`.

---

## [1.6.3] - 2026-10-11

### 💬 Clean Plain Text Engine & Telegram Workflow Slash Autocomplete
- **Markdown-to-Plain-Text AST/Regex Stripping Engine (`stripMarkdownToPlainText`)**:
  - Eliminates 100% of Markdown formatting from AI conversation transcript responses before forwarding to Telegram.
  - Strips complex Markdown syntax: headers (`#` to `######`), bold/italic (`**`, `*`, `__`, `_`), strikethrough (`~~`), code fences (```lang ... ```), inline code (`` ` ``), and blockquotes (`>`).
  - Unrolls and aligns GitHub Flavored Markdown (GFM) tables into clean, readable tabular text rows.
  - Formats bulleted lists (`*`, `-`, `+`), numbered lists, and task list checkboxes (`[ ]`, `[x]`).
  - Converts Markdown links (`[label](url)` -> `label (url)` or clean labels).
  - Completely eliminates Telegram API `400 Bad Request: can't parse entities` errors by disabling HTML/Markdown parse modes (`parse_mode: undefined`).
- **Workflow Slash Autocomplete Integration (`setMyCommands`)**:
  - Dynamically registers all Antigravity Workflow Framework (AWF) commands (`/init`, `/plan`, `/design`, `/code`, `/run`, `/debug`, `/test`, `/audit`, `/deploy`, `/next`, `/recap`, `/help`, `/customize`, `/refactor`, `/review`, `/save-brain`, `/rollback`, `/awf-update`, `/cloudflare-tunnel`, `/brainstorm`, `/visualize`) via Telegram Bot API `setMyCommands`.
  - Enriches commands with localized descriptions and recognizable emoji icons for seamless mobile typing suggestions.
  - Provides bidirectional command normalization between Telegram Bot constraints and Antigravity workflow names (mapping snake_case `/save_brain` to hyphenated `/save-brain`).
- **Trailing Argument Forwarding & Free-Form Prompt Dispatch**:
  - Automatically parses and preserves trailing user parameters (e.g. `/brainstorm create a finance dashboard`, `/code implement auth guard`, `/save_brain sprint notes`).
  - Intelligently separates bot internal administration commands (`/plans`, `/screen`, `/status`, etc.) from workflow invocations.
  - Forwards normalized workflow prompts directly into Antigravity IDE via `PromptDispatcher.dispatchPrompt` while preserving active conversation continuity (`openNewConversation: false`).
  - Streams resulting model responses back to the user on Telegram formatted as pristine plain text.
- **Packaging & Quality Assurance**:
  - Clean TypeScript compilation with zero errors or warnings.
  - Packaged production release artifact `antigravity-auto-plan-1.6.3.vsix`.
  - Comprehensive end-to-end regression validation suite (`phase05_plain_text_and_workflow_e2e_release.test.ts`).

---

## [1.6.2] - 2026-10-11

### 🔒 Security & Reliability Hardening (Audit Remediation)
- **SecretStorage Credential Integration**:
  - Removed all hardcoded Telegram bot tokens and user IDs from source code and package manifests.
  - Implemented `SecretStorageManager` leveraging VS Code's native `SecretStorage` API (`context.secrets`) to securely persist bot tokens in OS keychains.
  - Added dedicated commands `autoplan.setTelegramToken` and `autoplan.clearTelegramToken`.
  - Established a strict credential precedence hierarchy: OS keychain (`SecretStorage`) > workspace settings (`autoplan.telegramBotToken`).
- **Sidecar File Permissions & Credential Stripping**:
  - Enforced POSIX `0600` (`-rw-------`) mode on sidecar configuration files (`~/.autoplan/telegram-bot.json` and `~/.autoplan/ports.json`).
  - Explicitly stripped sensitive credentials (`telegramBotToken`) from serialized disk payloads written by `writeSidecarConfig`.
- **Loopback HTTP Bridge Security & Session Token Auth**:
  - Secured localhost HTTP bridge with a high-entropy cryptographic session token (`crypto.randomBytes(32)`).
  - Enforced mandatory token authentication (`X-Bridge-Auth` or `Authorization: Bearer`) across all privileged IPC routes (`/autoplan-command`, `/autoplan-ack`, `/autoplan-log`, `/autoplan-status`).
  - Implemented strict CORS origin verification rejecting untrusted external web origins while strictly whitelisting internal VS Code origins (`vscode-file://`, `vscode-webview://`) and direct loopback IPC.
- **Elevated Shell Command Injection Hardening**:
  - Refactored Linux Polkit (`pkexec`) elevation command generator to use safe positional parameters (`bash -c '...' -- "$1" "$2"`) with single-quoted wrapping, eliminating arbitrary shell metacharacter and variable expansion.
  - Hardened Windows PowerShell UAC elevation using Base64 UTF-16LE encoded scripts with `-LiteralPath` parameter binding.
- **Dynamic Configuration Hot-Reload & Disposal Lifecycle**:
  - Fixed configuration watcher (`onDidChangeConfiguration`) to dynamically trigger `telegramBridge.reloadConfig()` whenever `autoplan.telegramEnabled`, `autoplan.telegramBotToken`, `autoplan.telegramAllowedUsers`, or `autoplan.telegramThrottleMs` changes.
  - Bound server lifecycle disposables to `context.subscriptions` ensuring graceful shutdown and zero dangling listeners upon extension deactivation.
- **DevDependencies Modernization & Pristine Release Packaging**:
  - Updated `@vscode/vsce` and development dependencies for engine security and compatibility.
  - Packaged pristine release artifact `antigravity-auto-plan-1.6.2.vsix` verified to contain zero leaked secrets.

---

## [1.6.1] - 2026-09-18

### ⚡ Added & Enhanced (Infinite Loop Timeout & Watcher Improvements)
- **Infinite Loop Timeout (`0 = Infinite`)**: Chuyển đổi cấu hình `autoplan.timeoutPerLoopMinutes` sang hỗ trợ giá trị `0` biểu thị chế độ vô hạn (không ngắt timeout khi AI phản hồi lâu).
- **Default Timeout Update**: Cập nhật giá trị mặc định của `timeoutPerLoopMinutes` thành `0` trong `package.json`, `src/config.ts`, `media/settings/settings.html` và `media/settings/settings.js`.
- **Timer & Watchdog Suppression**: Khi `timeoutMs <= 0` hoặc `timeoutPerLoopMinutes <= 0`, `TranscriptWatcher` hoàn toàn bỏ timer `setTimeout` và `Orchestrator` tắt watchdog stall alert để tránh ngắt quãng tác vụ AI chạy dài.
- **New Conversation Offset Reset**: Đảm bảo `offsetToUse = 0` và `initialTranscriptLength = 0` khi `Orchestrator` theo dõi file transcript của conversation mới, triệt tiêu lỗi bỏ sót dòng log hoàn thành.
- **Full Test Suite & VSIX**: Vượt qua 100% các bộ kiểm thử E2E Cross-Platform, Multi-Root, và đóng gói lại `antigravity-auto-plan-1.6.1.vsix`.

---

## [1.6.1] - 2026-09-17

### ⚡ Fixed & Enhanced (Workspace Title & Multi-Root Support)
- **Workspace Suffix Normalization**: Loại bỏ hậu tố `\s*\((Workspace|Workspace File)\)$` trong `parseWorkspaceFromTitleString` và `BridgeServer`, chuẩn hóa các tiêu đề như `Untitled (Workspace)` hoặc `MyProject (Workspace)`.
- **Untitled Workspace Filtering**: Bổ sung `untitled (workspace)` vào danh sách loại trừ tab/placeholder để không nhận nhầm tiêu đề tạm thời làm tên thư mục code.
- **Explorer DOM Root Folder Extraction**: Bổ sung cơ chế trích xuất trực tiếp tên thư mục gốc từ DOM Explorer (`.monaco-list-row [class*="rootfolder-icon"] .label-name`) khi chạy trong Multi-Root hoặc Untitled Workspace, tự động nhận diện đúng thư mục (ví dụ `AI_Novel-main`).
- **Multi-Root BridgeServer Handshake**: Nâng cấp `BridgeServer` hỗ trợ mảng `workspaceFolders` và `workspaceTitle`, cho phép bắt tay HTTP probe thành công với bất kỳ thư mục nào trong multi-root workspace (triệt tiêu lỗi HTTP 409 workspace-mismatch).
- **Multi-Root Transcript Ownership**: Cập nhật `ConversationOwnershipCriteria` và `verifyConversationOwnershipAsync` trong `TranscriptWatcher`, cho phép đối chiếu log transcript theo toàn bộ danh sách thư mục trong multi-root workspace.
- **Automated Verification**: Bổ sung bộ kiểm thử tự động `test:multiroot` (13/13 test cases pass) và đóng gói `antigravity-auto-plan-1.6.1.vsix`.

---

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
