# Antigravity Auto-Plan Extension

<p align="center">
  <img src="https://raw.githubusercontent.com/skul9x/Auto-plan-Extension/main/docs/assets/banner.png" alt="Antigravity Auto-Plan Extension Banner" width="100%" onerror="this.style.display='none'"/>
</p>

<p align="center">
  <a href="https://github.com/skul9x/Auto-plan-Extension/releases"><img src="https://img.shields.io/badge/version-1.1.0-blue.svg?style=flat-square" alt="Version"></a>
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/VS%20Code-^1.80.0-informational.svg?style=flat-square" alt="VS Code Compatibility"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3.3-3178C6.svg?style=flat-square" alt="TypeScript"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey.svg?style=flat-square" alt="Platform Support">
</p>

---

## Overview

**Antigravity Auto-Plan Extension** (`antigravity-auto-plan`) is an advanced automation and orchestration tool designed for **Antigravity IDE** and **Visual Studio Code**. It automates multi-phase software development plan execution (`phase-01-*.md`, `phase-02-*.md`, etc.), streams AI agent transcripts in real time, and ensures smooth phase transitions upon completion signal (`"Done skul9x."`).

---

## Features

### 🖼️ Sidebar Control Center
- Dedicated Activity Bar view (`autoplan-sidebar-container`) featuring the **Plan Execution Dashboard**.
- Interactive plan folder discovery dropdown, active plan selection, phase checklist with custom phase toggling, and live transcript streaming output.
- Real-time status indicators (Running, Paused, Error, Completed) with progress counters and quick action controls.

### ⚡ Focus-Free DOM Bridge
- Background IPC prompt injection directly into the VS Code / Antigravity Workbench HTML renderer context.
- Direct DOM element injection for chat prompt text fields and trigger buttons, eliminating window focus requirements.
- Port-discovery HTTP server (`127.0.0.1:49200-49220`) for reliable IPC communication with the injected workbench script.

### 🎯 3-Tier Resilient Transport
- **Tier 1 (DOM Bridge):** High-speed, focus-free background IPC. Zero UI focus disruption.
- **Tier 2 (VS Code Native Commands):** Falls back to VS Code internal command palette dispatch when supported.
- **Tier 3 (OS Keyboard Simulation):** Uses platform-native automation (`xdotool` on Linux, PowerShell `WScript.Shell` on Windows) for ultimate system fallback.

### ⚡ Zero-Timeout Pre-Flight Guard
- Pre-flight readiness environment health checks running in `< 100ms`.
- Prevents infinite execution loops by validating available transports before initiating plan cycles.
- Clear error diagnostic notifications and automated remediation actions (e.g., prompting 1-Click Bridge Setup).

### 🔍 Anti-Pollution Transcript Watcher
- Real-time JSONL watcher inspecting `~/.gemini/antigravity-ide/brain/` transcript logs.
- Byte-offset incremental reading and root directory `mtime` modification guards.
- Dynamic quiet-period debounce detector preventing false positives from intermediate user messages or standard log updates.

---

## Installation

### 1-Click Bridge Setup
Run the command via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):
`Auto-Plan: 1-Click DOM Bridge Setup` (`autoplan.oneClickSetup`)

This command automatically inspects the environment, injects the DOM automation bridge script into `workbench.html`, and verifies client heartbeat connections.

### Linux Elevation & Permissions (Polkit `pkexec`)
On Linux systems, writing to `workbench.html` in system-protected directories (e.g., `/usr/share/code/` or `/opt/Antigravity/`) requires administrator privileges.
- Auto-Plan utilizes Polkit elevation (`pkexec`) to prompt for root authorization securely.
- After running the setup command, enter your password when prompted by Polkit.
- If elevation fails or is cancelled, Auto-Plan falls back to non-elevated methods or keyboard simulation.

### Linux `xdotool` Fallback Setup
If DOM Bridge mode is not used on Linux, Tier 3 OS Keyboard Simulation requires `xdotool`:
```bash
# Ubuntu / Debian
sudo apt-get install xdotool

# Arch Linux
sudo pacman -S xdotool

# Fedora
sudo dnf install xdotool
```

### Installing Extension VSIX
```bash
# Install to Antigravity IDE
antigravity --install-extension antigravity-auto-plan-1.1.0.vsix

# Install to VS Code
code --install-extension antigravity-auto-plan-1.1.0.vsix
```

---

## User Interface Guide

### Interactive Status Bar Item (`🚀 Auto-Plan`)
- Displays real-time progress: `$(sync~spin) Auto-Plan: [2/5] phase-02-readme.md`
- Hovering over the status bar item displays a detailed Markdown tooltip showing the current folder, phase progress, execution timer, and current transport mode.
- Clicking the status bar item opens the **Running Action Menu**:
  - 🛑 **Stop Auto-Plan**: Immediately aborts automation execution.
  - ⏭️ **Skip Current Phase**: Skips the currently executing phase and proceeds to the next selected phase.
  - 📄 **Open Active Transcript Log**: Opens the active `transcript.jsonl` file directly in the editor.

### Sidebar Control Dashboard
- Access from the Activity Bar icon (Auto-Plan Control Center).
- View full phase tree, toggle individual phases on/off, start/stop automation, and monitor live streaming output logs without leaving your editor panel.

---

## Configuration

The extension can be customized via VS Code Settings (`Ctrl+,` or `Cmd+,`). All settings are under the `autoplan` prefix:

| Setting | Type | Default | Description |
|---|---|---|---|
| `autoplan.defaultPromptTemplate` | `string` | *(Standard Template)* | Default prompt template for each phase (using `{xxx}`, `{path}`, or `{file}`). |
| `autoplan.promptTemplate` | `string` | *(Standard Template)* | Dynamic prompt template for individual phase files (using `{xxx}`, `{path}`, or `{file}`). |
| `autoplan.promptText` | `string` | `"Hãy trả lời tôi..."` | Static prompt content automatically pasted into chat input. |
| `autoplan.defaultPlanFolder` | `string` | `""` | Default folder path containing phase plan Markdown files. |
| `autoplan.repeatCount` | `number` | `5` | Number of loop iterations for static prompt execution. |
| `autoplan.completionKeyword` | `string` | `"Done skul9x."` | Keyword string in agent responses indicating phase completion. |
| `autoplan.delayBetweenLoopsMs` | `number` | `2000` | Delay in milliseconds between plan phase iterations. |
| `autoplan.timeoutPerLoopMinutes` | `number` | `15` | Maximum execution timeout per phase in minutes. |
| `autoplan.focusDelayMs` | `number` | `800` | Delay in milliseconds after opening chat before focusing input field. |
| `autoplan.executionMode` | `string` | `"auto"` | Transport mode for prompt dispatch (`auto`, `domBridge`, `nativeCommand`, `keyboard`). |
| `autoplan.bridgeTimeoutMs` | `number` | `5000` | Timeout in milliseconds for DOM Bridge command acknowledgements. |
| `autoplan.autoApprovePermissions` | `boolean` | `true` | Automatically approve execution permissions via DOM bridge. |
| `autoplan.autoInjectWorkbench` | `boolean` | `true` | Automatically ensure workbench is injected with DOM bridge script on startup. |

---

## Command Reference

| Command ID | Title | Description |
|---|---|---|
| `autoplan.start` | `Auto-Plan: Start Automation` | Open plan selector and begin automated phase execution. |
| `autoplan.stop` | `Auto-Plan: Stop Automation` | Immediately stop running automation. |
| `autoplan.skipPhase` | `Auto-Plan: Skip Current Phase` | Skip current phase and move to next phase in queue. |
| `autoplan.actionMenu` | `Auto-Plan: Show Running Action Menu` | Display active action menu (Stop, Skip, View Transcript). |
| `autoplan.openTranscript` | `Auto-Plan: Open Active Transcript Log` | Open current active `transcript.jsonl` in editor. |
| `autoplan.setPrompt` | `Auto-Plan: Set Prompt` | Interactively modify the active prompt text. |
| `autoplan.installBridge` | `Auto-Plan: Install / Update DOM Automation Bridge` | Inject DOM automation script into `workbench.html`. |
| `autoplan.uninstallBridge` | `Auto-Plan: Uninstall DOM Automation Bridge` | Remove DOM automation script from `workbench.html`. |
| `autoplan.checkBridgeStatus` | `Auto-Plan: Check Bridge Status & Run Diagnostic` | Run health check on DOM bridge server and clients. |
| `autoplan.openSidebar` | `Auto-Plan: Open Auto-Plan Control Center` | Open sidebar view in Activity Bar. |
| `autoplan.oneClickSetup` | `Auto-Plan: 1-Click DOM Bridge Setup` | Automated 1-click bridge installation and verification. |
| `autoplan.checkStatus` | `Auto-Plan: Check Status & Diagnostics` | Perform full system pre-flight transport check. |

---

## Troubleshooting

### "Linux Pre-Flight Failed"
**Cause:** DOM Bridge is disconnected and `xdotool` is not installed on Linux.  
**Fix:**
1. Run `Auto-Plan: 1-Click DOM Bridge Setup` (`autoplan.oneClickSetup`) to enable focus-free DOM Bridge mode.
2. Alternatively, install `xdotool` via your package manager (`sudo apt-get install xdotool`).

### Infinite Popup Loop Resolution
**Cause:** After modifying VS Code core workbench files (`workbench.html`), Electron security integrity prompts may trigger repeatedly until reloaded.  
**Fix:** Run `Developer: Reload Window` (`Ctrl+R` / `Cmd+R`) in VS Code after completing 1-Click setup.

### CSP & Localhost Port Discovery
**Cause:** Content Security Policy (CSP) blocking localhost HTTP connections between extension host and renderer.  
**Fix:** Auto-Plan automatically injects CSP meta tag updates allowing connections to `http://127.0.0.1:49200-49220`. If connection issues persist, check local firewall settings or anti-virus software blocking local loopback sockets.

---

## Development

### Project Directory Structure
```text
Auto-plan-Extension/
├── media/                     # Sidebar Webview UI & DOM Bridge scripts
│   ├── bridge/                # Workbench injected DOM bridge scripts
│   └── sidebar/               # Sidebar control dashboard HTML/CSS/JS
├── src/                       # TypeScript extension source code
│   ├── bridgeServer.ts        # Local IPC HTTP server for DOM Bridge
│   ├── keyboardManager.ts     # Tier 3 OS keyboard automation
│   ├── orchestrator.ts        # Main phase execution orchestrator
│   ├── promptDispatcher.ts    # 3-Tier prompt dispatcher
│   ├── sidebarViewProvider.ts # Activity Bar webview provider
│   ├── transcriptWatcher.ts   # Anti-pollution JSONL log watcher
│   └── test/                  # Test suites for each implementation phase
├── package.json               # Extension manifest & configuration schemas
├── tsconfig.json              # TypeScript compilation setup
└── README.md                  # Extension documentation manual
```

### Building & Packaging VSIX
```bash
# Clone repository
git clone https://github.com/skul9x/Auto-plan-Extension.git
cd Auto-plan-Extension

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package VSIX extension package
npm run package
```

### Running Test Suites
Execute specific phase tests or full regression test suite:
```bash
# Run Phase 01: Elevation & Keyboard tests
npm run test:phase01

# Run Phase 02: Fail-Fast Pre-Flight & Documentation tests
npm run test:phase02

# Run Phase 03: Sidebar Webview tests
npm run test:phase03

# Run Phase 04: Actionable Notifications tests
npm run test:phase04

# Run Phase 05: E2E Cross-Platform Release tests
npm run test:phase05

# Run Phase 02 Documentation test specifically
npx tsc && node out/test/phase02_readme_documentation.test.js
```

---

## License

Distributed under the **MIT License**. See `LICENSE` for details.
