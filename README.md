# Antigravity Auto-Plan Extension

<p align="center">
  <a href="https://github.com/skul9x/Auto-plan-Extension/releases"><img src="https://img.shields.io/badge/version-1.5.0-blue.svg?style=flat-square" alt="Version"></a>
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/VS_Code-^1.80.0-informational.svg?style=flat-square" alt="VS Code Compatibility"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3.3-3178C6.svg?style=flat-square" alt="TypeScript"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/platforms-Linux_%7C_macOS_%7C_Windows-lightgrey.svg?style=flat-square" alt="Platform Support">
</p>

---

## Overview

**Antigravity Auto-Plan Extension** (`antigravity-auto-plan`) is an advanced automation orchestrator for **Antigravity IDE** and **Visual Studio Code**. It enables hands-free execution of multi-phase development plans (`phase-01-*.md`, `phase-02-*.md`, etc.), streams real-time AI conversation logs directly into a responsive sidebar dashboard, and automatically advances between execution phases upon detecting completion keywords (such as `"Done skul9x."`).

With in-process DOM injection and a 3-tier resilient transport engine, Auto-Plan submits prompts seamlessly in the background without stealing your window focus or interrupting active typing.

---

## Features

### ⚙️ Settings Panel
- Modern, full-featured Webview Settings Panel (`autoplan.openSettings`) supporting light, dark, and high-contrast VS Code themes.
- Visual control over dispatch tier strategies, fallback policies, phase timeouts, loop delays, and dynamic prompt formatting templates with real-time two-way synchronization to VS Code configuration.

### 🖼️ Sidebar Control Center
- Integrated Activity Bar container (`autoplan.sidebarView`) named **Plan Execution Dashboard**.
- Automatic workspace plan discovery, phase checklist toggling, live transcript streaming, and execution state monitoring (`IDLE`, `RUNNING`, `PAUSED`, `ERROR`, `COMPLETED`).
- Quick-action buttons for starting, stopping, pausing, and resuming automated execution.

### ⚡ Focus-Free DOM Bridge
- In-process DOM injection directly into the Electron Renderer context (`workbench.html`).
- Submits prompts and triggers chat submission buttons in the background without stealing keyboard or cursor focus.
- Embedded local REST HTTP bridge server dynamically binding to safe localhost ports (`48860-48900` / `49200-49220`).

### 🎯 3-Tier Resilient Transport
- **Tier 1 (DOM Bridge):** High-speed, focus-free background DOM injection via embedded HTTP IPC.
- **Tier 2 (VS Code Native Commands):** Fallback using native editor commands (`antigravity.sendTextToChat`).
- **Tier 3 (OS Keyboard Simulation):** Synthetic keystroke dispatch via OS automation (`xdotool` on Linux, PowerShell `WScript.Shell` on Windows, AppleScript on macOS).
- Dynamic tier fallback with configurable override preferences (`autoplan.executionMode`, `autoplan.allowTierFallback`).

### ⚡ Zero-Timeout Pre-Flight Guard
- Sub-100ms environment health check and transport validation executed before each phase loop.
- Prevents infinite loops and silent failures by ensuring transport prerequisites are met before execution begins.
- Provides actionable notifications with 1-click resolution buttons (`⚙️ Open Settings`, `⚡ 1-Click DOM Bridge Setup`).

### 🔍 Anti-Pollution Transcript Watcher
- Real-time incremental JSONL conversation log streaming from `~/.gemini/antigravity-ide/brain/`.
- Byte-offset tracking and root directory `mtime` modification guards to prevent stale log reads.
- Quiet-period debounce filter preventing false completion triggers on intermediate assistant chunks.

### 🩺 Phase Diagnostics & Stall Analyzer
- Detects phase stalls and provides root-cause classifications (*Sequence Dependency*, *Pre-Flight Transport Failure*, *AI Response Timeout*, *Malformed Header Syntax*).
- 1-click clipboard export (`autoplan.copyDebugLog`) and file export (`autoplan.exportDebugLog`) for diagnostic reports.

---

## Installation & Setup

### 1-Click DOM Bridge Setup (Recommended)
Open the VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and execute:
```
Auto-Plan: 1-Click DOM Bridge Setup (autoplan.oneClickSetup)
```
This command checks your installation, injects the DOM bridge script into `workbench.html`, and verifies client-server heartbeat connectivity.

### Linux Elevation (`pkexec`)
On Linux distributions, modifying system-installed `workbench.html` (e.g., `/usr/share/code/` or `/opt/Antigravity/`) requires elevated permissions:
- Auto-Plan utilizes Polkit (`pkexec`) for secure, graphical password prompting.
- When prompted, enter your administrator credentials to authorize the bridge installation.

### Linux `xdotool` Fallback
If using Tier 3 OS Keyboard Simulation on Linux, install `xdotool`:
```bash
# Ubuntu / Debian
sudo apt-get install xdotool

# Arch Linux
sudo pacman -S xdotool

# Fedora
sudo dnf install xdotool
```

### VSIX Installation
```bash
# Install to Antigravity IDE
antigravity --install-extension antigravity-auto-plan-1.5.0.vsix

# Install to VS Code
code --install-extension antigravity-auto-plan-1.5.0.vsix
```

---

## Configuration Reference

All settings are available under the `autoplan.*` namespace in VS Code Settings (`Ctrl+,` or `Cmd+,`):

| Setting Key | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `autoplan.defaultPromptTemplate` | `string` | *(Template)* | Default prompt template for each phase (using `{xxx}`, `{path}`, or `{file}`). |
| `autoplan.promptTemplate` | `string` | *(Template)* | Dynamic prompt template applied to individual phase files. |
| `autoplan.promptText` | `string` | `"Hãy trả lời tôi..."` | Static fallback prompt content pasted into chat. |
| `autoplan.defaultPlanFolder` | `string` | `""` | Default folder path containing phase markdown plan files. |
| `autoplan.repeatCount` | `number` | `5` | Repetition count for static prompt execution cycles. |
| `autoplan.completionKeyword` | `string` | `"Done skul9x."` | Completion keyword in AI response marking phase completion. |
| `autoplan.delayBetweenLoopsMs` | `number` | `2000` | Inter-loop delay in milliseconds between consecutive phase runs. |
| `autoplan.timeoutPerLoopMinutes` | `number` | `15` | Maximum timeout in minutes per individual phase execution. |
| `autoplan.focusDelayMs` | `number` | `800` | Delay in milliseconds after opening chat before focusing input field. |
| `autoplan.executionMode` | `string` | `"auto"` | Transport mode: `"auto"`, `"domBridge"`, `"nativeCommand"`, or `"keyboard"`. |
| `autoplan.allowTierFallback` | `boolean` | `true` | Allow automated fallback to secondary tiers when primary tier encounters errors. |
| `autoplan.bridgeTimeoutMs` | `number` | `5000` | Timeout in milliseconds for DOM Bridge command acknowledgment. |
| `autoplan.staleClientMs` | `number` | `120000` | Timeout in milliseconds before an inactive DOM bridge client is marked stale. |
| `autoplan.autoApprovePermissions` | `boolean` | `true` | Automatically approve execution permissions via DOM bridge. |
| `autoplan.autoInjectWorkbench` | `boolean` | `true` | Automatically ensure workbench is injected with DOM bridge script on startup. |
| `autoplan.suppressFallbackWarnings` | `boolean` | `true` | Suppress warning toast popups when falling back between prompt dispatch tiers. |

---

## Commands Reference

The extension registers the following commands in the Command Palette:

| Command ID | Title | Description |
| :--- | :--- | :--- |
| `autoplan.start` | `Auto-Plan: Start Automation` | Scan plan phases and begin automated execution loop. |
| `autoplan.stop` | `Auto-Plan: Stop Automation` | Immediately abort active automation workflow. |
| `autoplan.skipPhase` | `Auto-Plan: Skip Current Phase` | Skip active phase and advance to next phase in queue. |
| `autoplan.actionMenu` | `Auto-Plan: Show Running Action Menu` | Display interactive action menu (Stop, Skip, Open Transcript). |
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
| `autoplan.clearDebugLog` | `Auto-Plan: Clear DOM Bridge Log Buffer` | Flush memory log buffer. |
| `autoplan.showOutputChannel` | `Auto-Plan: Show DOM Bridge Output Channel` | Reveal dedicated extension Output Channel. |

---

## Architecture Overview

```
 +-----------------------------------------------------------------------------------+
 |                               VS Code Extension Host                              |
 |                                                                                   |
 |  +-----------------------+     Trigger      +----------------------------------+  |
 |  |  Sidebar / Commands   | ---------------> |         src/orchestrator.ts      |  |
 |  +-----------------------+                  +----------------------------------+  |
 |              |                                                |                   |
 |              | Reads Phases                                   | Dispatches Phase  |
 |              v                                                v                   |
 |  +-----------------------+                  +----------------------------------+  |
 |  |   src/planScanner.ts  |                  |     src/promptDispatcher.ts      |  |
 |  +-----------------------+                  +----------------------------------+  |
 |                                                               |                   |
 |              +------------------------------------------------+                   |
 |              |                               |                                    |
 |     (Tier 1: DOM Bridge)            (Tier 2: VS Code API)          (Tier 3: OS)   |
 |              v                               v                               v    |
 |  +-----------------------+          +-----------------+            +-----------+  |
 |  |  src/bridgeServer.ts  |          | VS Code Command |            |  Keyboard |  |
 |  +-----------------------+          +-----------------+            |  Manager  |  |
 |              ^                                                     +-----------+  |
 |              | HTTP REST IPC                                                      |
 +--------------|--------------------------------------------------------------------+
                v
 +-----------------------------------------------------------------------------------+
 |                            Electron Renderer / Webview                            |
 |                                                                                   |
 |   +------------------------------------+      Submits Text       +-------------+  |
 |   |    media/autoplan-dom-bridge.js    | ----------------------> | Chat Editor |  |
 |   +------------------------------------+ (Focus-Free Double-Tap) | Input (DOM) |  |
 |                                                                  +-------------+  |
 +-------------------------------------------------------------------------|---------+
                                                                           |
                                                                           | Produces
                                                                           v Logs
 +-----------------------------------------------------------------------------------+
 |                             Filesystem / Brain Storage                            |
 |                                                                                   |
 |   +------------------------------------+      Streams To         +-------------+  |
 |   |    src/transcriptWatcher.ts        | <---------------------- | JSONL Logs  |  |
 |   | (Detects "Done skul9x." Keyword)   |                         | Transcript  |  |
 |   +------------------------------------+                         +-------------+  |
 |                    |                                                              |
 |                    v Signals Phase Completion                                     |
 |   +------------------------------------+                                          |
 |   |  Orchestrator advances to next     |                                          |
 |   |  phase or completes run loop       |                                          |
 |   +------------------------------------+                                          |
 +-----------------------------------------------------------------------------------+
```

---

## Troubleshooting

### "Linux Pre-Flight Failed"
- **Cause:** DOM Bridge is disconnected and `xdotool` is missing from the Linux environment.
- **Resolution:**
  1. Run `Auto-Plan: 1-Click DOM Bridge Setup` (`autoplan.oneClickSetup`) to enable Tier 1 Focus-Free DOM Bridge.
  2. Or install `xdotool` using your system package manager (`sudo apt-get install xdotool`).

### Infinite Reload Popup Prevention
- **Cause:** Electron integrity checks detecting modifications to `workbench.html`.
- **Resolution:** Execute `Developer: Reload Window` (`Reload Window`) in VS Code after running the 1-Click setup. Auto-Plan automatically manages backup files (`workbench.html.backup`) and repairs checksums.

### Port Conflicts & CSP Configuration
- **Cause:** Content Security Policy (CSP) or local port collisions.
- **Resolution:** Auto-Plan dynamically scans and selects free ports within `48860-48900` / `49200-49220` and automatically updates CSP meta tags in `workbench.html` to allow localhost IPC traffic.

### Status Bar Status Indicators
- `🚀 Auto-Plan` indicates idle/ready state.
- `$(sync~spin) Auto-Plan: [1/4] phase-01.md` indicates active phase execution.
- Click the Status Bar item at any time to open the **Action Menu** for instant pause, stop, or skip actions.

---

## Development & Testing

### Project Directory Layout
```text
Auto-plan-Extension/
├── media/                          # Webview front-end assets & DOM bridge script
│   ├── autoplan-dom-bridge.js      # Injected renderer DOM script
│   ├── settings/                   # Settings Webview UI (HTML, CSS, JS)
│   └── sidebar/                    # Sidebar Activity Bar UI (HTML, CSS, JS)
├── src/                            # TypeScript source codebase
│   ├── bridgeServer.ts             # Embedded HTTP REST IPC server
│   ├── config.ts                   # Centralized typed settings reader
│   ├── debugLogger.ts              # Diagnostic logging subsystem
│   ├── extension.ts                # Entrypoint, Status Bar, command registry
│   ├── keyboardManager.ts          # Tier 3 OS keystroke simulation
│   ├── orchestrator.ts             # Phase loop engine & state machine
│   ├── planScanner.ts              # Natural alphanumeric plan sorter
│   ├── promptDispatcher.ts         # 3-Tier resilient prompt dispatcher
│   ├── settingsProvider.ts         # Settings Webview panel provider
│   ├── sidebarProvider.ts          # Sidebar WebviewViewProvider
│   ├── transcriptWatcher.ts        # JSONL stream watcher & keyword detector
│   ├── workbenchInjector.ts        # Privileged workbench patcher & manager
│   └── test/                       # Automated test suites
├── package.json                    # Extension manifest & configuration schema
├── tsconfig.json                   # TypeScript compiler configuration
├── structure.md                    # Architecture and codebase reference
└── README.md                       # Comprehensive user and developer manual
```

### Build & Package Commands
```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package VSIX extension bundle
npm run package
```

### Running Automated Test Suites
```bash
# Run Phase 01 Architecture & Structure documentation test
npx tsc; node out/test/phase01_structure_documentation.test.js

# Run Phase 02 README & Configuration validation test
npx tsc; node out/test/phase02_readme_documentation.test.js
```

---

## License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.
