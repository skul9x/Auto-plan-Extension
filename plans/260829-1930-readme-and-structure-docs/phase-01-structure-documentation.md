# Phase 01: Project Architecture & Codebase Structure Documentation (`structure.md`)

Status: ✅ Completed  
Dependencies: None  
Target Files:
- `structure.md`
- `src/test/phase01_structure_documentation.test.ts`

---

## 1. Objective

Produce an exhaustive, production-grade architectural specification and codebase directory structure reference in `structure.md`. Document all core modules, IPC protocols, lifecycle orchestrator, tier fallback dispatchers, webview panels (Sidebar & Settings), DOM bridge, background log watchers, and security elevation mechanics. Provide exactly one comprehensive file-based automated verification test in `src/test/phase01_structure_documentation.test.ts` to validate documentation integrity and physical file references on disk.

---

## 2. Detailed Technical Requirements

### 2.1. Codebase Architecture & Component Mapping (`structure.md`)
- **Directory Hierarchy:** Tree mapping `src/`, `media/`, `plans/`, `docs/`, `out/`, `.brain/`.
- **Core Module Responsibilities:**
  - `src/extension.ts`: Activation lifecycle, Status Bar Item (`🚀 Auto-Plan`), Command registration (13 commands), diagnostic health dialogs, webview view/panel providers registration.
  - `src/orchestrator.ts`: Sequential phase loop engine, state machine (idle, running, paused, error, completed), inter-loop delay, timeout guard, cancellation/skip flow.
  - `src/promptDispatcher.ts`: 3-Tier resilient prompt dispatch engine (Tier 1: DOM Bridge HTTP IPC, Tier 2: VS Code Command API, Tier 3: OS Keyboard Simulation) with dynamic fallback and user preferences.
  - `src/settingsProvider.ts`: Webview panel controller (`autoplan.openSettings`) offering visual configuration for Tier modes, fallback options, timeouts, delays, and prompt templates with bi-directional VS Code settings sync.
  - `src/sidebarProvider.ts`: `WebviewViewProvider` Activity Bar container (`autoplan.sidebarView`), plan folder scanner, phase checklist toggle, real-time transcript streaming, control buttons.
  - `src/bridgeServer.ts`: Local HTTP server (ports 48860-48900 / 49200-49220 dynamic scanning), command queue, ACK handling, auto-approval endpoint, port registry in tmp.
  - `src/transcriptWatcher.ts`: Non-blocking JSONL log stream watcher, byte-offset streaming, root mtime guard, quiet-period debounce completion detector.
  - `src/workbenchInjector.ts`: Cross-platform elevation-capable injector (`pkexec`, `runAs`, `osascript`), `workbench.html` backup/restore manager, product checksum updater.
  - `src/planScanner.ts`: Natural alphanumeric sorting of phase files, folder scanner, ignore filters, completion status detector.
  - `src/keyboardManager.ts`: Tier 3 fallback OS keyboard simulation (`xdotool`, PowerShell `WScript.Shell`, `osascript`), clipboard pasting, focus handling.
  - `src/config.ts`: Centralized configuration schema reader with typed defaults and validation.
  - `media/autoplan-dom-bridge.js`: Renderer DOM script injected into `workbench.html`, chat input locator, double-tap submitter, auto-approval observer.
  - `media/settings/*`: Settings webview interface (HTML, CSS, JS) supporting dark/light VS Code themes.
  - `media/sidebar/*`: Sidebar webview interface (HTML, CSS, JS) for the execution dashboard.
- **Data Flow & Sequence Diagram:** Mermaid and ASCII diagram illustrating:
  1. User triggers execution from Sidebar / Status Bar / Command Palette.
  2. Orchestrator loads active plan phases via `planScanner`.
  3. Prompt Dispatcher routes prompt through Tier 1 / Tier 2 / Tier 3.
  4. DOM Bridge submits prompt directly into Antigravity IDE chat input without stealing focus.
  5. Transcript Watcher monitors JSONL conversation file for keyword `"Done skul9x."`.
  6. Phase status and live logs broadcast to Sidebar Dashboard.
- **IPC & Network Specifications:**
  - Bridge Server HTTP REST endpoints (`GET /health`, `GET /command`, `POST /ack`, `GET /status`, `POST /approval`).
  - Webview message passing protocol between extension host and Sidebar / Settings panels.

### 2.2. Automated File-Based Test (`src/test/phase01_structure_documentation.test.ts`)
- **Single Test File Requirement:** Exactly one comprehensive file-based test suite verifying:
  - `structure.md` exists in project root and is non-empty (> 2500 bytes).
  - Contains required top-level architectural headings (`# Project Structure`, `## Directory Hierarchy`, `## Core Modules`, `## Webview Assets & UI Panels`, `## Data Flow & Architecture Diagrams`, `## IPC Protocols & Communication Channels`).
  - Contains references to all 11 TypeScript source files and webview assets (`src/extension.ts`, `src/orchestrator.ts`, `src/promptDispatcher.ts`, `src/settingsProvider.ts`, `src/sidebarProvider.ts`, `src/bridgeServer.ts`, `src/transcriptWatcher.ts`, `src/workbenchInjector.ts`, `src/planScanner.ts`, `src/keyboardManager.ts`, `src/config.ts`, `media/autoplan-dom-bridge.js`, `media/settings/settings.html`, `media/sidebar/sidebar.html`).
  - Checks that every referenced relative file path physically exists on disk.

---

## 3. Implementation Steps

1. Create `structure.md` in the project root with complete architectural specifications, directory hierarchy, component responsibility maps, sequence diagrams, and IPC protocols.
2. Update/create `src/test/phase01_structure_documentation.test.ts` to implement the comprehensive file-based verification test.
3. Compile TypeScript and execute the single test:
   ```bash
   npx tsc && node out/test/phase01_structure_documentation.test.js
   ```
4. Verify 100% test pass rate.

---

## 4. Verification Plan

### Automated Test
```bash
npx tsc && node out/test/phase01_structure_documentation.test.js
```

### Manual Verification
- Review formatting of `structure.md` in VS Code Markdown Preview.

---
Next Phase: [phase-02-readme-documentation.md](./phase-02-readme-documentation.md)
