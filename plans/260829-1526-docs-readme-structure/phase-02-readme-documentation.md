# Phase 02: Extension User & Developer Guide (`README.md`)

Status: ✅ Completed  
Dependencies: Phase 01  
Target Files:
- `README.md`
- `src/test/phase02_readme_documentation.test.ts`

---

## 1. Objective

Rewrite `README.md` into an exhaustive, production-grade extension manual for both end users and developers. Cover all modern features (Sidebar Control Center, DOM Bridge Focus-Free IPC, 3-Tier Prompt Dispatcher, Fail-Fast Pre-Flight Guards, Anti-Pollution Transcript Watcher), step-by-step setup guides, Linux troubleshooting (Polkit elevation, xdotool fallback, Electron CSP handling), configuration schemas, and developer test execution instructions. Create an automated test suite `src/test/phase02_readme_documentation.test.ts` to verify documentation completeness and configuration alignment.

---

## 2. Detailed Technical Requirements

### 2.1. README Sections & Content Requirements (`README.md`)
- **Header & Badge Bar:** Extension title, version, license, platform compatibility badges (Linux, macOS, Windows).
- **Core Features Overview:**
  - 🖼️ **Sidebar Control Center:** Dedicated Activity Bar webview with plan selectors, phase checkboxes, real-time log streaming, and status badges.
  - ⚡ **Focus-Free DOM Bridge:** Background IPC prompt injection directly into VS Code Workbench HTML renderer context.
  - 🎯 **3-Tier Resilient Transport:** Tier 1 (DOM Bridge) -> Tier 2 (VS Code Native Commands) -> Tier 3 (OS Keyboard Simulation).
  - ⚡ **Zero-Timeout Pre-Flight Guard:** < 100ms environment health check preventing broken execution loops.
  - 🔍 **Anti-Pollution Transcript Watcher:** Root mtime change guard and dynamic quiet-period debounce detector for JSONL logs.
- **Installation & Setup Guide:**
  - 1-Click Bridge Setup (`autoplan.oneClickSetup`).
  - Linux Polkit elevation (`pkexec`) & permission prompt handling.
  - Linux `xdotool` fallback installation instructions (`sudo apt-get install xdotool`).
- **User Interface Guide:**
  - Interactive Status Bar Item (`🚀 Auto-Plan`).
  - Sidebar Control Dashboard controls and log stream.
- **Configuration Schema Reference:** Detailed table of all `autoplan.*` settings matching `package.json`.
- **Troubleshooting Guide:**
  - "Linux Pre-Flight Failed" explanation and fixes.
  - Infinite popup loop resolution (Reload Window requirement).
  - CSP / Localhost port discovery details.
- **Developer Guide:** Building VSIX, running test suites, and project directory structure overview.

### 2.2. Automated File-Based Test (`src/test/phase02_readme_documentation.test.ts`)
- Verify `README.md` exists and is > 3000 bytes.
- Parse `package.json` configuration section and verify every configuration key (e.g., `autoplan.executionMode`, `autoplan.promptTemplate`, `autoplan.bridgeTimeoutMs`) is documented in `README.md`.
- Verify key sections are present (`# Antigravity Auto-Plan Extension`, `## Features`, `## Installation`, `## Configuration`, `## Troubleshooting`, `## Development`).

---

## 3. Implementation Steps

1. Update `README.md` with complete user and developer documentation.
2. Create `src/test/phase02_readme_documentation.test.ts` to programmatically validate `README.md` content against `package.json`.
3. Execute `npx tsc && node out/test/phase02_readme_documentation.test.js` to verify test suite pass.

---

## 4. Verification Plan

### Automated Tests
```bash
npx tsc && node out/test/phase02_readme_documentation.test.js
```

### Manual Verification
- Render `README.md` in VS Code Markdown Preview to confirm visual formatting, badges, tables, and code snippets.
