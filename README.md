# Antigravity Auto-Plan Extension

<p align="center">
  <a href="https://github.com/skul9x/Auto-plan-Extension/releases"><img src="https://img.shields.io/badge/version-1.6.7-blue.svg?style=flat-square" alt="Version"></a>
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/VS_Code-^1.80.0-informational.svg?style=flat-square" alt="VS Code Compatibility"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3.3-3178C6.svg?style=flat-square" alt="TypeScript"></a>
  <a href="https://grammy.dev/"><img src="https://img.shields.io/badge/Telegram-grammY_1.21.0-26A5E4.svg?style=flat-square" alt="grammY Framework"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/platforms-Linux_%7C_Windows_%7C_macOS-lightgrey.svg?style=flat-square" alt="Platform Support">
</p>

---

## 📌 Table of Contents
- [Overview](#overview)
- [Key Features](#key-features)
  - [🤖 Telegram Chat Gating & Modern Tabbed Settings (v1.6.7)](#-telegram-chat-gating--modern-tabbed-settings-v167)
  - [⚡ High-Performance Remediation & Resource Optimization (v1.6.6)](#-high-performance-remediation--resource-optimization)
  - [⏱️ Long-Running Phase Nudge Watchdog & Mid-Flight Steering](#️-long-running-phase-nudge-watchdog--mid-flight-steering)
  - [💬 Telegram Clean Q&A Sync (Two-Way Live Mirror)](#-telegram-clean-qa-sync-two-way-live-mirror)
  - [🤖 Telegram Remote Control & Mobile Bridge](#-telegram-remote-control--mobile-bridge)
  - [⚡ Focus-Free DOM Bridge (Tier 1)](#-focus-free-dom-bridge)
  - [🎯 3-Tier Resilient Transport Fallback](#-3-tier-resilient-transport)
  - [🖼️ Sidebar Control Center & Full-Screen Settings](#️-sidebar-control-center)
  - [🔒 Enterprise Security & SecretStorage Integration](#-enterprise-security--secretstorage-integration)
  - [🚀 High-Performance Caching & Stream Engine](#-high-performance-caching--stream-engine)
- [Comprehensive Tech Stack](#comprehensive-tech-stack)
  - [1. Core Platforms & Runtimes](#1-core-platforms--runtimes)
  - [2. Programming Languages & Compilers](#2-programming-languages--compilers)
  - [3. Automation Transport & IPC Subsystems](#3-automation-transport--ipc-subsystems)
  - [4. Telegram Bot & Real-Time Sync Subsystems](#4-telegram-bot--real-time-sync-subsystems)
  - [5. System Security, Elevation & Credential Management](#5-system-security-elevation--credential-management)
  - [6. High-Performance Data Streaming & Caching](#6-high-performance-data-streaming--caching)
  - [7. Front-End UI Architecture & Design System](#7-front-end-ui-architecture--design-system)
  - [8. Testing, Diagnostics & Packaging Pipeline](#8-testing-diagnostics--packaging-pipeline)
  - [Complete Tech Stack Matrix](#complete-tech-stack-matrix)
- [Architecture & Workflow Flowchart](#architecture--workflow-flowchart)
- [Installation & Setup](#installation--setup)
  - [1-Click DOM Bridge Setup](#1-click-dom-bridge-setup-recommended)
  - [Linux Elevation & Prerequisites](#linux-elevation-pkexec)
  - [Telegram Bot Remote Setup](#telegram-bot-setup-optional---remote-control)
  - [VSIX Package Installation](#vsix-installation)
- [Configuration Reference](#configuration-reference)
- [Commands Reference](#commands-reference)
- [Troubleshooting & Diagnostics](#troubleshooting)
- [Development, Testing & Release](#development--testing)
- [License](#license)

---

## Overview

**Antigravity Auto-Plan Extension** (`antigravity-auto-plan`) is an enterprise-grade automation orchestrator, resilient multi-tier transport engine, and remote control bridge engineered specifically for **Antigravity IDE** and **Visual Studio Code**. It enables hands-free, autonomous execution of multi-phase development plans (`phase-01-*.md`, `phase-02-*.md`, etc.), streams real-time AI conversation logs directly into a responsive sidebar dashboard, and automatically advances between execution phases upon detecting completion keywords (such as `"Done skul9x."`).

Equipped with an in-process DOM injection engine, a 3-tier resilient transport fallback mechanism, an asynchronous anti-pollution log streaming pipeline, and a dedicated **Telegram Bot Remote Control Bridge** (`grammY`), Auto-Plan allows developers to automate heavy coding workflows locally without stealing window focus—or steer the IDE completely from their mobile phone on the go.

---

## Key Features

### 🤖 Telegram Chat Gating & Modern Tabbed Settings (v1.6.7)
- **Free-Text Silent Drop Gating (`autoplan.telegram.allowFreeChat`)**: Independent control toggle enabling arbitrary text messages from Telegram to be silently ignored without prompt dispatching or error replies into Antigravity IDE. All workflow commands (`/code`, `/recap`, `/init`, etc.) and management commands (`/plans`, `/plan_status`, `/screen`, `/new_chat`) remain active.
- **Modern 4-Category Tabbed Settings Dashboard**: Replaces long scrolling forms with 4 dedicated, organized tabs:
  - 🔀 **Dispatch & Tiers**: Prompt dispatch strategy, fallback policies, and 1-click bridge injection.
  - 🤖 **Telegram & Remote**: Master switch, free-text gating, Q&A mirroring, token management, whitelist, and throttle.
  - ⏱️ **Timing & Automation**: Delay, loop timeouts, repeat counts, watchdog nudge, and folder settings.
  - 🩺 **Diagnostics & Logs**: Phase audit summary, DOM bridge live log viewer, and log export utilities.
- **Instant Cross-Tab Search Filtering**: Real-time client-side search across all tabs with live element highlighting and non-matching element dimming.
- **Secure SecretStorage Token Management & Optimistic Rollback**: Master Telegram bot switch automatically prompts for token entry via VS Code modal when turned on without a token; if cancelled, immediately rolls back switch to OFF. Zero plaintext tokens in Webview DOM.
- **Debounced Auto-Save (300ms)**: Seamless optimistic configuration persistence with visual status badges (`Saving...`, `All changes saved`).

### ⚡ High-Performance Remediation & Resource Optimization
- **Event-Driven Transcript Discovery (PERF-01)**: Decoupled periodic 300ms byte-offset streaming from directory scanning. Employs native `fs.watch` event notifications on `.brain/` directory alongside a 5000ms discovery throttle, slashing steady-state disk I/O operations by >= 90%.
- **Zero Event-Loop Blocking in Telegram Fallback (PERF-02)**: Completely eliminates synchronous `*Sync` filesystem calls in `awaitAndReplyModelResponse` and path resolution, replacing them with asynchronous non-blocking streaming and a 1500ms directory scan throttle during unresolved waits.
- **Adaptive Dual-Tier DOM Bridge Polling (PERF-03)**: Dynamic state machine in `media/autoplan-dom-bridge.js` switches between Active (400ms) during tasks/prompts and Idle (2000ms) after 30 seconds of inactivity, reducing loopback HTTP request volume by 75–80% with instantaneous wakeup on any user interaction (`keydown`, `pointerdown`, `click`, `wheel`).
- **Zero-Allocation Fast-Path User Prompt Extraction (PERF-04)**: Delimiter-free fast path for plain text inputs and substring isolation for heavy XML payloads, eradicating redundant global regex copies and excessive GC pressure.

### ⏱️ Long-Running Phase Nudge Watchdog & Mid-Flight Steering
- **Automated 3-Minute Watchdog**: Monitors phase elapsed runtime and intervenes if execution exceeds threshold (default 180s / 3 minutes via `autoplan.longPhaseThresholdSeconds`).
- **Cooperative Generation Interruption**: Safely detects active agent generation via DOM Cancel button (`findCancelButton`) and dispatches a focus-free synthetic click cascade to halt generation before inputting new instructions.
- **Mid-Flight Steering Prompt Injection**: Injects best-practice steering prompt into existing conversation (`openNewConversation: false`) without losing context or spinning up new tabs:
  ```text
  Search online to find the best practices. Note, do not open a browser and directly access the DOM. Use search_web / read_url_content when you need to look something up.
  ```
- **Origin Separation & Echo Prevention**: Tracks steering prompts in `PromptOriginTracker` with `Origin.SYSTEM_NUDGE`, eliminating duplicate echo loops while formatting output distinctly on Telegram (`🤖 [Auto-Plan Nudge]: ...`).
- **Telegram Alert & Live Dashboard Synchronization**: Sends instant push alert on Telegram (`⏱️ [Auto-Plan Nudge] Phase X running > 3m...`) and updates dashboard viewmodels with live nudge state indicators.
- **Strict One-Shot Guarantee**: Nudges at most once per phase (`phase.hasNudged = true`) to prevent repetitive interruptions during long-running tasks like builds or bundle tests.

### 💬 Telegram Clean Q&A Sync (Two-Way Live Mirror)
- **Single Source of Truth (SSOT)**: Continuous byte-offset tailing of Antigravity conversation transcripts (`transcript.jsonl`) via Node.js streams without touching Electron DOM or opening browser tabs.
- **Prompt Deduplication & Origin Tracking**: Maintains an in-memory normalized ring buffer with a 60-second TTL (`PromptOriginTracker`). Suppresses duplicate mirroring for prompts originating from Telegram, while cleanly forwarding prompts typed on the PC keyboard with a distinct header: `💻 You (on PC): <Question>`.
- **Live Typing Indicators**: Periodically emits Telegram chat actions (`sendChatAction: typing`) every 4 seconds during agent thinking and tool execution, immediately clearing status when assistant response delivery begins.
- **Smart Markdown Code Block Chunking**: Splits responses exceeding Telegram's 4096-character limit into safe chunks (<= 4000 characters) along line and paragraph boundaries. Tracks open/close triple backtick code fences (` ``` `) and automatically re-opens code blocks across chunk boundaries to prevent Telegram formatting distortion or `400 Bad Request: can't parse entities` errors.
- **Throttled Delivery & Rate-Limit Resilience**: Enforces a minimum 1000ms delay between consecutive chunk deliveries to adhere strictly to Telegram API limits, with automatic retry and backoff on HTTP `429 Too Many Requests`.

### 🤖 Telegram Remote Control & Mobile Bridge
- **Remote Mobile Orchestration:** Full mobile workflow management via Telegram Bot powered by **grammY** (`^1.21.0`).
- **Clean Plain Text Output Engine:** Strips Markdown headings, bold/italic, code blocks, links, and tables into clean plain text (`parse_mode: undefined`), eliminating Telegram parsing failures.
- **Workflow Slash Autocomplete (`/`):** Full auto-complete menu (`setMyCommands`) for Antigravity workflows (`/code`, `/plan`, `/save_brain`, etc.) with emoji icons, automatic argument forwarding, and command normalization.
- **Interactive Plan Selector & 4-Screen Remote Flow (`/plans`, `/plan_start`):**
  - **Screen 1 (Main Folder List & Quick Resume):** 1-Click `[⚡ Tiếp tục: <Tên>]` quick resume button at position 0, visual block progress bars (`▰▰▰▰▱▱▱`), and editor active plan auto-detection.
  - **Screen 2 (Execution Mode Selector):** Choose between `Chạy pending`, `Chạy toàn bộ`, and `Tùy chọn thủ công`.
  - **Screen 3 (Smart Phase Picker):** Mobile-optimized 2-column compact grid, batch controls (`[✅ Tất cả]`, `[⚡ Chưa chạy]`, `[⬜ Bỏ chọn]`), dynamic count button (`[▶️ Bắt đầu (X/Y phase)]`), and zero-selection modal guard.
  - **Screen 4 (Interactive Live Control Dashboard):** In-place message transformation (`editMessageText`) with real-time Unicode block progress bars (`▰▰▰▱▱`), operational controls (`[⏭️ Bỏ qua Phase]`, `[🛑 Dừng lại]`), utility buttons (`[📸 Chụp màn hình]`, `[🔄 Cập nhật]`), and navigation (`[📂 Danh sách Plans]`).
  - **Resilient Safety Architecture:** 100% inline keyboard callback payloads <= 64 bytes, underscore markdown escape safety, 1200ms `DashboardThrottler` to prevent HTTP 429 rate limits, and seamless handling of "message is not modified" errors.
- **Live Remote Screen Capture (`/screen`):** Instant desktop screenshot capture using system utilities (`gnome-screenshot` on Linux, PowerShell .NET on Windows, `screencapture` on macOS) sent directly to your phone.
- **Remote Free-Chat & Session Control:** Prompt the active Antigravity AI session directly from Telegram or spin up a new conversation (`/new_chat`).
- **Multi-Window Leader Election:** Mutex locking via temp file registry (`ag-autoplan-ports.json`) ensures only one active IDE window runs Telegram Long Polling, preventing `409 Conflict` errors.
- **Security Whitelist & Anti-Spam Throttle:** Hardened user whitelist verification (`autoplan.telegramAllowedUsers`) and rate-limiting throttle (`autoplan.telegramThrottleMs`) to prevent `429 Too Many Requests`.

### ⚡ Focus-Free DOM Bridge
- In-process DOM injection directly into the Electron Renderer context (`workbench.html`).
- Submits prompts and triggers chat submission buttons in the background without stealing keyboard or cursor focus.
- Embedded local REST HTTP bridge server dynamically binding to safe localhost port ranges (`48860-48900` / `49200-49220`).
- Lexical editor mutation, synthetic input dispatching (`KeyboardEvent`, `InputEvent`), and focus-free double-tap submission.
- Zero Node.js deprecation warnings with standardized WHATWG `new URL()` protocol implementation.

### 🎯 3-Tier Resilient Transport
- **Tier 1 (Focus-Free DOM Bridge):** High-speed, focus-free background DOM injection via embedded HTTP IPC.
- **Tier 2 (VS Code Native Commands):** Fallback using native editor commands (`antigravity.sendTextToChat`).
- **Tier 3 (OS Keyboard Simulation):** Synthetic keystroke dispatch via OS automation (`xdotool` on Linux, PowerShell `WScript.Shell` on Windows, AppleScript on macOS).
- Dynamic tier fallback with configurable override preferences (`autoplan.executionMode`, `autoplan.allowTierFallback`, `autoplan.suppressFallbackWarnings`).

### 🖼️ Sidebar Control Center
- Integrated Activity Bar container (`autoplan.sidebarView`) titled **Plan Execution Dashboard**.
- Automatic workspace plan discovery and natural alphanumeric ordering (`phase-01` → `phase-02` → `phase-10`).
- Interactive phase checklist toggling, custom phase execution via Sidebar or 2-step **QuickPick** dialog.
- Live transcript streaming directly inside the editor and execution state monitoring (`IDLE`, `RUNNING`, `PAUSED`, `ERROR`, `COMPLETED`).
- Quick-action buttons for starting, stopping, pausing, skipping phases, or opening logs.

### ⚙️ Settings Panel
- Modern, full-featured Webview Settings Panel (`autoplan.openSettings`) supporting light, dark, and high-contrast VS Code themes.
- Visual control over dispatch tier strategies, fallback policies, phase timeouts, loop delays, and dynamic prompt formatting templates with real-time two-way synchronization to VS Code configuration.
- Dedicated live transport testing diagnostic and real-time DOM bridge log console with level filtering (`[DEBUG]`, `[INFO]`, `[WARN]`, `[ERROR]`).
- Pre-flight diagnostic warnings provide actionable resolutions (`⚙️ Open Settings Panel`, `⚡ 1-Click DOM Bridge Setup`).

### 🔒 Enterprise Security & SecretStorage Integration
- **Zero Hardcoded Secrets**: Secrets are never saved in source code, package manifests, or insecure workspace JSON files.
- **VS Code SecretStorage API**: Bot tokens are securely held inside operating system credential vaults (Linux `libsecret` / Secret Service, Windows Credential Manager, macOS Keychain) via `context.secrets`.
- **Sidecar Config Sanitization**: Sidecar config files (`ag-autoplan-config.json`) automatically strip authentication tokens and enforce POSIX `0o600` restricted read/write permissions.
- **Cryptographic IPC Token Auth**: Embedded bridge server generates a 32-byte cryptographic session token (`crypto.randomBytes(32)`), requiring `X-Bridge-Auth` or `Authorization: Bearer` headers.
- **Strict Loopback CORS Whitelisting**: Rejects external web origins (`403 Forbidden`) and strictly authorizes `vscode-file://`, `vscode-webview://`, and localhost discovery probes.

### 🚀 High-Performance Caching & Stream Engine
- **2-Tier LRU Memoization Cache**: Eliminates >98% of redundant disk polling I/O with 256-entry LRU stat caching (`mtimeMs`, `size`).
- **Bounded Log Sliding Buffer**: In-memory ring buffer clamped to `MAX_PENDING_LOGS = 150` prevents heap memory growth when webviews are backgrounded.
- **Non-Blocking Async DOM Snapshots**: Writes multi-megabyte diagnostic snapshots through `fs.promises.writeFile` to avoid blocking the Extension Host event loop.
- **Concurrent I/O Throttle (`asyncPool(16)`)**: Safely limits concurrent directory scans to avoid OS file descriptor exhaustion (`EMFILE`).

---

## Comprehensive Tech Stack

Auto-Plan is built upon a high-performance, hybrid automation architecture combining native Node.js APIs, VS Code Extension primitives, Electron Chromium DOM injection, OS system utilities, and modern Telegram bot frameworks.

### 1. Core Platforms & Runtimes
- **VS Code Extension API (`^1.80.0`)**: Extension host runtime providing `WebviewViewProvider`, `WebviewPanel`, `SecretStorage`, Status Bar items, Output Channels, configuration schemas, and command registrations.
- **Antigravity IDE Platform**: Native deep-hook integration with Google Antigravity Agent UI, chat layout containers, conversation transcript pipelines (`~/.gemini/antigravity-ide/brain/`), and multi-root workspace titlebar patterns.
- **Node.js (v20+ LTS)**: Powers the Extension Host asynchronous event loop, `fs.promises` asynchronous file I/O, `child_process` spawns, cryptographic random generation (`node:crypto`), and native HTTP networking.
- **Electron Renderer Context**: Target runtime for in-process DOM injection inside `workbench.html`, shadow root inspection, and Lexical input state dispatching.

### 2. Programming Languages & Compilers
- **TypeScript 5.3.3**: Core language across the entire codebase. Configured with strict type checking (`strict: true`), ES2022 output targets, and modular asynchronous design patterns.
- **JavaScript (ES2022+ / Vanilla JS)**: Lightweight, dependency-free client scripts for DOM bridge injection (`media/autoplan-dom-bridge.js`) and Webview interaction layers.
- **Bash & Shell Scripting**: Secure positional privilege execution scripts for Linux elevation.
- **PowerShell Scripting**: UTF-16LE Base64-encoded privilege execution scripts and native `.NET` Graphics automation for Windows.

### 3. Automation Transport & IPC Subsystems
- **Tier 1: Focus-Free DOM Bridge**: In-process synthetic event dispatching (`KeyboardEvent`, `InputEvent`, `MouseEvent`), Lexical editor paragraph insertion, and double-tap Enter cascades without stealing OS window focus.
- **Tier 2: VS Code Command API**: Native fallback invoking `antigravity.sendTextToChat` directly through the extension host command broker.
- **Tier 3: OS Keystroke Engines**: Synthetic keyboard automation fallback utilizing `xdotool` on Linux, PowerShell `WScript.Shell` on Windows, and AppleScript (`osascript`) on macOS.
- **Embedded REST HTTP IPC Server**: Low-latency loopback communication (`node:http`) binding dynamically to safe port ranges (`48860-48900` / `49200-49220`).
- **WHATWG URL Standard**: Standardized `new URL()` request routing complying fully with Node.js 20+ runtime specifications (zero `[DEP0169]` warnings).
- **Leader Election Mutex**: Multi-window port registry (`ag-autoplan-ports.json`) ensuring isolated port allocation and single-leader Telegram polling across multiple open workspaces.

### 4. Telegram Bot & Real-Time Sync Subsystems
- **grammY Framework (`^1.21.0`)**: Modern TypeScript Telegram Bot Framework for Node.js powering Long Polling, inline keyboard generation, filter pipelines, and webhook/polling lifecycle management.
- **Transcript Tail Engine**: Continuous byte-offset tail reader (`fs.createReadStream` + `readline`) tailing `transcript.jsonl` with constant $O(1)$ memory complexity.
- **Prompt Origin Tracker**: In-memory normalized ring buffer with 60-second TTL categorizing prompts as `TELEGRAM`, `PC_KEYBOARD`, or `SYSTEM_NUDGE`, suppressing duplicate bot echoes.
- **Smart Markdown Chunker**: Custom line/paragraph chunker splitting responses at `<= 4000` characters while automatically tracking and balancing markdown code fences (` ``` `).
- **Typing Action Manager**: Periodic heartbeat emitting `sendChatAction: typing` every 4000ms during AI reasoning and tool calls, automatically cleared upon message dispatch.
- **Throttled Deliverer & Dashboard Throttler**: Inter-message delay throttling (>= 1000ms) with exponential backoff on HTTP 429 and `editMessageText` update throttling (1200ms).
- **Clean Plain Text Output Engine**: Regex and AST-free string pipeline (`stripMarkdownToPlainText`) converting markdown headers, bold text, links, and GFM tables into readable plain text (`parse_mode: undefined`).

### 5. System Security, Elevation & Credential Management
- **VS Code SecretStorage (`context.secrets`)**: Hardware-backed OS Keychain storage for Telegram bot tokens:
  - **Linux**: Secret Service API via `libsecret`
  - **Windows**: Windows Credential Manager
  - **macOS**: Apple Keychain Services
- **Cryptographic Token Middleware**: 32-byte cryptographically secure session tokens (`crypto.randomBytes(32)` -> 64 hex characters) validating `X-Bridge-Auth` and `Authorization: Bearer` headers.
- **Strict CORS Origin Whitelisting**: Blocks unauthorized browser access (`403 Forbidden`), accepting only `vscode-file://`, `vscode-webview://`, and local probe handshakes.
- **Linux Polkit Elevation (`pkexec`)**: Administrator privilege elevation using safe positional arguments (`$1`, `$2`) wrapped in single quotes, eliminating shell injection vulnerabilities.
- **Windows PowerShell UAC Hardening**: Privileged elevation utilizing Base64-encoded UTF-16LE scripts and `-LiteralPath` parameter bindings.
- **Content Security Policy (CSP) Manager**: Automatic injection of `connect-src http://127.0.0.1:*` meta tags into `workbench.html`.
- **Integrity Checksum Engine**: Recalculates SHA-256 hashes inside `product.json` to prevent VS Code "corrupted installation" warnings.

### 6. High-Performance Data Streaming & Caching
- **2-Tier LRU Ownership Memoization Cache**: LRU cache (256 entries) caching `(transcriptPath, mtimeMs, size)` tuples to eliminate >98% of disk polling overhead.
- **Bounded Sliding-Window Queue**: FIFO ring buffer clamped to `MAX_PENDING_LOGS = 150` ensuring stable RAM footprint during background operation.
- **Non-Blocking Async DOM I/O**: Multi-megabyte DOM snapshots written asynchronously via `fs.promises.writeFile`.
- **Bounded Parallel Scanner (`asyncPool(16)`)**: Concurrent filesystem traversal throttled to 16 workers, preventing `EMFILE` descriptor limits.
- **Natural Alphanumeric Sorter**: Natural collation engine (`Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`) ensuring correct ordering of phase files (`phase-01` to `phase-10`).

### 7. Front-End UI Architecture & Design System
- **HTML5 & Vanilla CSS3**: Ultra-lightweight, zero-framework frontend maintaining 60fps rendering in Webview environments.
- **Native VS Code CSS Variables**: Full styling integration utilizing native theme tokens (`--vscode-editor-background`, `--vscode-foreground`, `--vscode-button-background`, etc.).
- **Modern Dark Glassmorphic Design**: Sleek translucent panels, card containers, subtle borders, and smooth transitions matching Antigravity IDE aesthetic standards.
- **Diagnostic Log Console**: In-webview live log streaming with interactive level filtering (`DEBUG`, `INFO`, `WARN`, `ERROR`), auto-scroll locking, and 1-click clipboard export.

### 8. Testing, Diagnostics & Packaging Pipeline
- **Mocha (`^11.8.0`) & `ts-node` (`^10.9.2`)**: Enterprise test harness driving automated regression, integration, and contract verification test suites.
- **JSDOM (`^27.0.1`)**: Headless browser DOM simulation environment validating selector discovery and synthetic event cascades offline.
- **Native Node.js Assertion Engine (`node:assert`)**: High-speed, zero-dependency contract validation.
- **VS Code Extension Packaging (`@vscode/vsce ^2.32.0`)**: Official production build packager creating hardened `.vsix` release archives.

---

### Complete Tech Stack Matrix

| Architecture Layer | Core Technologies & Libraries | Architectural Responsibility |
| :--- | :--- | :--- |
| **Host Runtime** | VS Code API `^1.80.0`, Antigravity IDE, Node.js v20+ LTS, Electron Renderer | Extension lifecycle, workspace resolution, and runtime environment. |
| **Language & Compilers** | TypeScript 5.3.3, Vanilla JavaScript (ES2022+), Bash, PowerShell | Strongly typed backend, lightweight client scripts, and OS execution scripts. |
| **Automation Transport** | 3-Tier Dispatcher: Focus-Free DOM Bridge, VS Code Commands, OS Keystrokes (`xdotool`, PowerShell) | Zero-focus prompt injection and automatic multi-tier fallback. |
| **Inter-Process IPC** | Embedded Node.js HTTP Server (`48860-48900`), WHATWG URL Standard, Webview `postMessage` | High-speed local IPC, CORS isolation, and Webview RPC messaging. |
| **Remote Telegram Bot** | grammY `^1.21.0`, Long Polling, Inline Keyboards, Leader Election Mutex | Mobile orchestration, 4-screen remote flow, and multi-window conflict prevention. |
| **Real-Time Q&A Sync** | `TranscriptTailEngine`, `PromptOriginTracker` (60s TTL), `TypingActionManager` | Byte-offset JSONL streaming, typing indicators, and prompt deduplication. |
| **Content Formatting** | `SmartMarkdownChunker` (<= 4000 chars), `stripMarkdownToPlainText` | Markdown code-fence balancing, table flattening, and `parse_mode: undefined` delivery. |
| **Watchdog & Steering** | Long-Running Phase Nudge Watchdog (180s timer), DOM `findCancelButton`, `SYSTEM_NUDGE` Origin | Runaway phase prevention, cooperative cancellation, and mid-flight steering injection. |
| **Security & Vault** | VS Code `SecretStorage` (`context.secrets`), 32-byte crypto token, POSIX `0o600` sidecar files | OS Keychain credential storage, IPC authentication, and secret sanitization. |
| **Privilege Elevation** | Linux Polkit (`pkexec`), Windows PowerShell UAC Base64 UTF-16LE, CSP Header Injection | Safe administrator elevation for `workbench.html` and CSP modification. |
| **Performance Engine** | 2-Tier LRU Cache (256 entries), `MAX_PENDING_LOGS = 150`, `asyncPool(16)`, `fs.promises` | Disk I/O reduction (>98%), memory bounds, and non-blocking snapshot writing. |
| **Front-End UI** | Sidebar Control Center (`WebviewViewProvider`), Settings Panel (`WebviewPanel`), Vanilla CSS | Activity Bar dashboard, full-screen settings, and diagnostic log console. |
| **Test & Build** | Mocha 11.8.0, JSDOM 27.0.1, `node:assert`, `@vscode/vsce ^2.32.0` | 120+ unit/integration test suites, headless DOM simulation, and VSIX packaging. |

---

## Architecture & Workflow Flowchart

```
 +-----------------------------------------------------------------------------------------+
 |                                  VS Code Extension Host                                 |
 |                                                                                         |
 |  +-----------------------+     Trigger      +-----------------------------------------+ |
 |  |  Sidebar / QuickPick  | ---------------> |           src/orchestrator.ts           | |
 |  +-----------------------+                  |   (State Machine, Auto-Retry Engine)    | |
 |              |                              +-----------------------------------------+ |
 |              | Reads Phases                      | Watchdog (180s)   |                  |
 |              v                                   v                   v Dispatches Phase |
 |  +-----------------------+           +-----------------------+  +---------------------+ |
 |  |   src/planScanner.ts  |           | Long Phase Watchdog   |  | promptDispatcher.ts | |
 |  +-----------------------+           | (Nudge & Steering)    |  +---------------------+ |
 |              ^                       +-----------------------+       |                  |
 |              | Remote Trigger                    | Cancel            |                  |
 |  +-----------------------+                       v                   v                  |
 |  | src/telegramBridge.ts |             +----------------------------------------------+ |
 |  |     (grammY Bot)      |             | Tier 1: DOM Bridge  Tier 2: API  Tier 3: Kbd | |
 |  +-----------------------+             +----------------------------------------------+ |
 |              ^                                   |                                      |
 |              | Long Polling                      v HTTP REST IPC (X-Bridge-Auth)        |
 +--------------|-----------------------------------|--------------------------------------+
                |                                   v
                |          +---------------------------------------------------------------+
                |          |                  Electron Renderer / Webview                  |
                |          |                                                               |
                |          |   +------------------------------------+      Submits Text    |
                |          |   |    media/autoplan-dom-bridge.js    | -------------------> |
                |          |   +------------------------------------+ (Focus-Free DOM Tap) |
                |          +-------------------------------------------------------|-------+
                |                                                                  |
                |                                                                  | Produces
                |                                                                  v Logs
                |          +---------------------------------------------------------------+
                |          |                   Filesystem / Brain Storage                  |
                |          |                                                               |
                | Streams  |   +------------------------------------+      Streams To      |
                +------------- |     transcriptTailEngine.ts        | <------------------- |
                           |   | (Continuous Byte-Offset Tail)      |      JSONL Logs      |
                           |   +------------------------------------+      Transcript      |
                           |                    |                                          |
                           |                    v Signals Phase Completion                 |
                           |   +------------------------------------+                      |
                           |   |  Orchestrator advances to next     |                      |
                           |   |  phase or completes run loop       |                      |
                           |   +------------------------------------+                      |
                           +---------------------------------------------------------------+
```

---

## Installation & Setup

### 1-Click DOM Bridge Setup (Recommended)
Open the VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and execute:
```
Auto-Plan: 1-Click DOM Bridge Setup (autoplan.oneClickSetup)
```
This command checks your installation, injects the DOM bridge script into `workbench.html`, updates CSP headers, and verifies client-server heartbeat connectivity.

### Linux Elevation (`pkexec`)
On Linux distributions, modifying system-installed `workbench.html` (e.g., `/usr/share/code/` or `/opt/Antigravity/`) requires elevated permissions:
- Auto-Plan utilizes Polkit (`pkexec`) for secure, graphical password prompting.
- When prompted, enter your administrator credentials to authorize the bridge installation.

### Linux Prerequisites (`xdotool` & `gnome-screenshot`)
If using Tier 3 OS Keyboard Simulation or the Telegram `/screen` command on Linux, install the required packages:
```bash
# Ubuntu / Debian / Linux Mint
sudo apt-get update && sudo apt-get install -y xdotool gnome-screenshot

# Arch Linux
sudo pacman -S xdotool gnome-screenshot

# Fedora
sudo dnf install xdotool gnome-screenshot
```

### Telegram Bot Setup (Optional - Remote Control)
1. Create a bot with [@BotFather](https://t.me/BotFather) on Telegram and copy the HTTP API Token.
2. Get your numeric Telegram User ID (e.g. from [@userinfobot](https://t.me/userinfobot)).
3. Securely store your token into OS Keychain via the command palette:
   ```
   Auto-Plan: Set Telegram Bot Token (autoplan.setTelegramToken)
   ```
4. Open Settings (`Ctrl+,` or `Cmd+,`) and configure:
   - `autoplan.telegramEnabled`: `true`
   - `autoplan.telegramAllowedUsers`: `[<YOUR_NUMERIC_TELEGRAM_USER_ID>]`
5. Send `/start` to your bot to begin managing your IDE remotely!

### VSIX Installation
```bash
# Install to Antigravity IDE
antigravity --install-extension antigravity-auto-plan-1.6.7.vsix

# Install to Visual Studio Code
code --install-extension antigravity-auto-plan-1.6.7.vsix
```

---

## Configuration Reference

All settings are available under the `autoplan.*` namespace in VS Code Settings (`Ctrl+,` or `Cmd+,`) or via the Settings Panel (`autoplan.openSettings`):

| Setting Key | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `autoplan.defaultPromptTemplate` | `string` | *(Template)* | Default prompt template for each phase (using `{xxx}`, `{path}`, `{file}`, `{phasePath}`, or `{phaseFile}`). |
| `autoplan.promptTemplate` | `string` | *(Template)* | Dynamic prompt template applied to individual phase files. |
| `autoplan.promptText` | `string` | `"Hãy trả lời tôi..."` | Static fallback prompt content pasted into chat. |
| `autoplan.defaultPlanFolder` | `string` | `""` | Default folder path containing phase markdown plan files. |
| `autoplan.repeatCount` | `number` | `5` | Repetition count for static prompt execution cycles. |
| `autoplan.completionKeyword` | `string` | `"Done skul9x."` | Completion keyword in AI response marking phase completion. |
| `autoplan.delayBetweenLoopsMs` | `number` | `2000` | Inter-loop delay in milliseconds between consecutive phase runs. |
| `autoplan.timeoutPerLoopMinutes` | `number` | `0` | Maximum timeout in minutes per individual phase execution (`0` = infinite / no timeout). |
| `autoplan.focusDelayMs` | `number` | `800` | Delay in milliseconds after opening chat before focusing input field. |
| `autoplan.executionMode` | `string` | `"auto"` | Transport mode: `"auto"`, `"domBridge"`, `"nativeCommand"`, or `"keyboard"`. |
| `autoplan.allowTierFallback` | `boolean` | `true` | Allow automated fallback to secondary tiers when primary tier encounters errors. |
| `autoplan.bridgeTimeoutMs` | `number` | `5000` | Timeout in milliseconds for DOM Bridge command acknowledgment. |
| `autoplan.newConversationTimeoutMs` | `number` | `8000` | Timeout in milliseconds waiting for a new conversation directory to be detected. |
| `autoplan.staleClientMs` | `number` | `120000` | Timeout in milliseconds before an inactive DOM bridge client is marked stale. |
| `autoplan.autoInjectWorkbench` | `boolean` | `true` | Automatically ensure workbench is injected with DOM bridge script on startup. |
| `autoplan.suppressFallbackWarnings` | `boolean` | `true` | Suppress warning toast popups when falling back between prompt dispatch tiers. |
| `autoplan.enableDomSnapshots` | `boolean` | `true` | Automatically capture and save full workbench DOM HTML snapshots when creating or retrying conversations. |
| `autoplan.domSnapshotFolder` | `string` | `""` | Custom directory path for DOM snapshots. Defaults to `~/.autoplan/snapshots/<project_name>`. |
| `autoplan.autoRetryOnTimeout` | `boolean` | `true` | Automatically retry the phase when `NewConversationTimeoutError` occurs. |
| `autoplan.retryDelaySeconds` | `number` | `3` | Delay in seconds before triggering automatic retry on timeout. |
| `autoplan.maxAutoRetries` | `number` | `5` | Maximum number of automatic retries per phase on timeout error. |
| `autoplan.telegramEnabled` | `boolean` | `true` | Enable Telegram remote control bot bridge (`grammY`). |
| `autoplan.telegramBotToken` | `string` | `""` | Telegram Bot API token for remote IDE control (stored securely in SecretStorage). |
| `autoplan.telegramAllowedUsers` | `array` | `[]` | Whitelist of authorized Telegram user IDs permitted to interact with the bot. |
| `autoplan.telegramThrottleMs` | `number` | `2500` | Throttle interval in milliseconds for Telegram updates and rate limiting. |
| `autoplan.telegram.allowFreeChat` | `boolean` | `true` | Allow arbitrary free-text messages from Telegram to be dispatched as prompts into Antigravity IDE. When disabled, non-command messages are silently dropped. |
| `autoplan.telegram.enableChatMirror` | `boolean` | `true` | Enable or disable live Q&A chat mirroring to Telegram. |
| `autoplan.telegram.mirrorIncludePcPrompts` | `boolean` | `true` | Whether to forward prompts entered on the PC keyboard (`💻 You (on PC): ...`). |
| `autoplan.telegram.chatMirrorPrefix` | `string` | `"🤖 Antigravity:"` | Customizable header prefix for assistant responses mirrored to Telegram. |
| `autoplan.longPhaseNudgeEnabled` | `boolean` | `true` | Enables or disables automatic nudging for phases running longer than threshold. |
| `autoplan.longPhaseThresholdSeconds` | `number` | `180` | Threshold in seconds (3 minutes) before triggering mid-flight nudge. |
| `autoplan.longPhaseNudgeMessage` | `string` | *(Prompt)* | Exact prompt message dispatched to the IDE during long phase nudge. |
| `autoplan.longPhaseNudgeRecurring` | `boolean` | `false` | Whether to trigger nudge only once per phase (`false`) or periodically (`true`). |
| `autoplan.longPhaseNotifyTelegram` | `boolean` | `true` | Whether to alert the user on Telegram when a nudge is triggered. |

### Dynamic Prompt Template Variables
The template engine supports the following dynamic placeholder replacements:
- `{xxx}`: Absolute normalized file path of the current phase plan file.
- `{path}`: Absolute normalized directory or file path of the current phase.
- `{file}`: Basename of the phase plan file (e.g. `phase-01-core-architecture.md`).
- `{phasePath}`: Same as `{path}`.
- `{phaseFile}`: Same as `{file}`.

---

## Commands Reference

The extension registers the following commands in the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command ID | Title | Description |
| :--- | :--- | :--- |
| `autoplan.start` | `Auto-Plan: Start Automation` | Scan plan phases and begin automated execution loop. |
| `autoplan.stop` | `Auto-Plan: Stop Automation` | Immediately abort active automation workflow. |
| `autoplan.skipPhase` | `Auto-Plan: Skip Current Phase` | Skip active phase and advance to next phase in queue. |
| `autoplan.actionMenu` | `Auto-Plan: Show Running Action Menu` | Display interactive Running Action Menu (Stop, Skip, Open Transcript). |
| `autoplan.openTranscript` | `Auto-Plan: Open Active Transcript Log` | Open active `transcript.jsonl` log file in editor. |
| `autoplan.setPrompt` | `Auto-Plan: Set Prompt` | Dynamically update active prompt content. |
| `autoplan.installBridge` | `Auto-Plan: Install / Update DOM Automation Bridge` | Inject DOM automation script into `workbench.html`. |
| `autoplan.uninstallBridge` | `Auto-Plan: Uninstall DOM Automation Bridge` | Restore clean backup of `workbench.html`. |
| `autoplan.checkBridgeStatus` | `Auto-Plan: Check Bridge Status & Run Diagnostic` | Check HTTP server and DOM bridge client connectivity. |
| `autoplan.openSidebar` | `Auto-Plan: Open Auto-Plan Control Center` | Open Sidebar Activity Bar control dashboard. |
| `autoplan.oneClickSetup` | `Auto-Plan: 1-Click DOM Bridge Setup` | 1-Click installation and health verification of DOM bridge. |
| `autoplan.checkStatus` | `Auto-Plan: Check Status & Diagnostics` | Run pre-flight health diagnostic check across all tiers. |
| `autoplan.openSettings` | `Auto-Plan: Open Settings Panel` | Open dedicated Settings Webview Panel. |
| `autoplan.copyDebugLog` | `Auto-Plan: Copy DOM Bridge Debug Log to Clipboard` | Copy diagnostic debug logs and stall report to clipboard. |
| `autoplan.exportDebugLog` | `Auto-Plan: Export DOM Bridge Diagnostic Log to File` | Save diagnostic log buffer to Markdown/text file. |
| `autoplan.clearDebugLog` | `Auto-Plan: Clear DOM Bridge Log Buffer` | Flush in-memory log buffer. |
| `autoplan.showOutputChannel` | `Auto-Plan: Show DOM Bridge Output Channel` | Reveal dedicated extension Output Channel. |
| `autoplan.setTelegramToken` | `Auto-Plan: Set Telegram Bot Token` | Securely store Telegram bot token in VS Code SecretStorage. |
| `autoplan.clearTelegramToken` | `Auto-Plan: Clear Telegram Bot Token` | Remove Telegram bot token from SecretStorage. |

### Telegram Bot Commands Reference
When the Telegram Bridge is enabled, authorized users can interact with the IDE via:

| Telegram Command | Purpose & Action |
| :--- | :--- |
| `/start` | Welcome greeting, permissions validation, and interactive quick-start menu. |
| `/help` | Detailed command manual and operational instructions. |
| `/plans` or `/plan_start` | Interactive 4-screen remote flow: Quick Resume -> Mode Selector -> Smart Phase Picker -> Live Control Dashboard. |
| `/plan_status` | View current phase progress, completion percentage, active phase name, and execution state. |
| `/plan_skip` | Remotely trigger `autoplan.skipPhase` to advance to the next phase in the queue. |
| `/plan_stop` | Remotely trigger `autoplan.stop` to immediately halt execution. |
| `/new_chat` | Dispatch new conversation focus-free shortcut inside Antigravity IDE. |
| `/screen` | Capture desktop screenshot using native OS utilities and send photo to Telegram. |
| *(Any free text)* | Dispatches the message directly as a prompt into the active IDE AI conversation. |

---

## Troubleshooting

### "Linux Pre-Flight Failed"
- **Cause:** DOM Bridge is disconnected and `xdotool` is missing from the Linux environment.
- **Resolution:**
  1. Run `Auto-Plan: 1-Click DOM Bridge Setup` (`autoplan.oneClickSetup`) to enable Tier 1 Focus-Free DOM Bridge.
  2. Or install `xdotool` using your system package manager (`sudo apt-get install xdotool`).

### Infinite Reload Popup Prevention
- **Cause:** Electron integrity checks detecting modifications to `workbench.html`.
- **Resolution:** Execute `Developer: Reload Window` (`Reload Window`) in VS Code after running the 1-Click setup. Auto-Plan automatically manages backup files (`workbench.html.backup`) and repairs checksums in `product.json`.

### Port Conflicts & CSP Configuration
- **Cause:** Content Security Policy (CSP) or local port collisions.
- **Resolution:** Auto-Plan dynamically scans and selects free ports within `48860-48900` / `49200-49220` and automatically updates CSP meta tags in `workbench.html` with `connect-src http://127.0.0.1:*` to allow localhost IPC traffic.

### Telegram Bot Conflict (`409 Conflict: terminated by other getUpdates request`)
- **Cause:** Multiple VS Code windows running Telegram polling simultaneously with the same token.
- **Resolution:** Auto-Plan includes built-in Multi-Window Leader Election mutex via `ag-autoplan-ports.json`. The first window acts as the Leader. When closing or switching windows, leadership is automatically re-elected within seconds.

### Status Bar Status Indicators
- `🚀 Auto-Plan` indicates idle/ready state.
- `$(sync~spin) Auto-Plan: [1/4] phase-01.md` indicates active phase execution.
- Click the Status Bar item at any time to open the **Running Action Menu** for instant pause, stop, or skip actions.

---

## Development & Testing

### Project Directory Layout
```text
Auto-plan-Extension/
├── media/                          # Webview front-end assets & DOM bridge script
│   ├── autoplan-dom-bridge.js      # Injected renderer DOM script (WHATWG URL, Lexical tap)
│   ├── settings/                   # Settings Webview UI (HTML, CSS, JS)
│   └── sidebar/                    # Sidebar Activity Bar UI (HTML, CSS, JS)
├── src/                            # TypeScript source codebase
│   ├── bridgeServer.ts             # Embedded HTTP REST IPC server & leader lock
│   ├── config.ts                   # Centralized typed settings reader
│   ├── debugLogger.ts              # Diagnostic logging subsystem & ring buffer
│   ├── extension.ts                # Entrypoint, Status Bar, command registry
│   ├── keyboardManager.ts          # Tier 3 OS keystroke simulation
│   ├── orchestrator.ts             # Phase loop engine, watchdog & retry pipeline
│   ├── planScanner.ts              # Natural alphanumeric plan sorter (async I/O)
│   ├── promptDispatcher.ts         # 3-Tier resilient prompt dispatcher
│   ├── promptOriginTracker.ts      # Prompt origin tagging & dedup ring buffer (60s TTL)
│   ├── secretStorageManager.ts     # VS Code SecretStorage keychain integration
│   ├── settingsProvider.ts         # Settings Webview panel provider
│   ├── sidebarProvider.ts          # Sidebar WebviewViewProvider
│   ├── smartMarkdownChunker.ts     # Markdown code-fence preserving chunker (<= 4000 chars)
│   ├── telegramBridge.ts           # grammY Telegram bot lifecycle & leader election
│   ├── telegramChatMirror.ts       # Two-way live Q&A chat mirror & throttled deliverer
│   ├── telegramNotifier.ts         # Throttled notification engine
│   ├── telegramPlanManager.ts      # Interactive plan folder discovery & keyboard UI
│   ├── telegramScreen.ts           # Cross-platform screen capture manager
│   ├── telegramUtils.ts            # Markdown plain-text flattener & sanitizer
│   ├── transcriptTailEngine.ts     # Continuous byte-offset JSONL transcript tail engine
│   ├── transcriptWatcher.ts        # JSONL stream watcher, LRU cache & keyword detector
│   ├── typingActionManager.ts      # Periodic Telegram typing indicator lifecycle manager
│   ├── workbenchInjector.ts        # Privileged workbench patcher, CSP & checksum manager
│   └── test/                       # Automated regression test suites (120+ tests)
├── package.json                    # Extension manifest & configuration schema
├── tsconfig.json                   # TypeScript compiler configuration
└── README.md                       # Comprehensive user and developer manual
```

### Build & Package Commands
```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package production VSIX extension bundle
npm run package
```

### Running Automated Test Suites
```bash
# Run Long-Running Phase Nudge Watchdog & Release verification
npm run test:phase05-nudge

# Run Telegram Bridge integration test
npm run test:phase02-telegram

# Run full cross-platform release regression test suite
npm test
```

---

## License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.
