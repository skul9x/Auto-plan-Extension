# Phase 01: Project Architecture & Directory Structure Documentation (`structure.md`)

Status: ✅ Completed  
Dependencies: None  
Target Files:
- `structure.md`
- `src/test/phase01_structure_documentation.test.ts`

---

## 1. Objective

Create a comprehensive architectural blueprint and directory structure reference in `structure.md`. Document all core modules, IPC protocols, lifecycle managers, sidebar webview components, and background workers. Provide an automated, file-based verification test in `src/test/phase01_structure_documentation.test.ts` to validate documentation integrity and physical file references.

---

## 2. Detailed Technical Requirements

### 2.1. File Structure & Component Mapping (`structure.md`)
- **Directory Hierarchy:** Tree diagram mapping `src/`, `media/`, `plans/`, `docs/`, `out/`, `.brain/`.
- **Core Component Responsibilities:**
  - `src/extension.ts`: Activation entrypoint, status bar management, command registration, diagnostic dialogs.
  - `src/orchestrator.ts`: Sequential phase loop engine, state machine, delay management, cancellation/skip flow.
  - `src/promptDispatcher.ts`: 3-Tier fallback dispatcher (Tier 1: DOM Bridge HTTP IPC, Tier 2: VS Code Command API, Tier 3: OS Keyboard Simulation).
  - `src/bridgeServer.ts`: Local HTTP server (ports 48860-48900), command queueing, ACK handling, port registry (`ag-autoplan-ports.json`).
  - `src/transcriptWatcher.ts`: Non-blocking JSONL log stream watcher, root mtime guard, debounce quiet-period detector.
  - `src/workbenchInjector.ts`: Elevation-capable HTML tag injector (`pkexec`, `runAs`, `osascript`), `workbench.html` backup/restore manager, product checksum updater.
  - `src/planScanner.ts`: Natural alphanumeric sorting, blacklist filtering, header completion status detector.
  - `src/sidebarProvider.ts`: `WebviewViewProvider` sidebar controller, state synchronization, IPC message router.
  - `media/autoplan-dom-bridge.js`: Renderer DOM script, chat input locator, double-tap submitter, auto-approval observer.
  - `media/sidebar/*`: Webview HTML UI, CSS styles, and client-side JS handler.
- **Data Flow & Sequence Diagram:** ASCII / Mermaid diagram illustrating prompt injection, HTTP ACK flow, log stream watching, and Webview UI updates.

### 2.2. Automated File-Based Test (`src/test/phase01_structure_documentation.test.ts`)
- Verify that `structure.md` exists and is non-empty (> 1000 bytes).
- Parse `structure.md` content and verify all referenced source files (`src/extension.ts`, `src/orchestrator.ts`, `src/promptDispatcher.ts`, `src/bridgeServer.ts`, `src/transcriptWatcher.ts`, `src/workbenchInjector.ts`, `src/planScanner.ts`, `src/sidebarProvider.ts`, `media/autoplan-dom-bridge.js`) exist on disk.
- Verify key structural section headings are present (`# Project Structure`, `## Core Modules`, `## Data Flow Diagram`, `## IPC Protocols`).

---

## 3. Implementation Steps

1. Create `structure.md` in root directory with complete component maps, architecture diagrams, and IPC specifications.
2. Create `src/test/phase01_structure_documentation.test.ts` to programmatically verify `structure.md` content against the physical codebase.
3. Execute `npx tsc && node out/test/phase01_structure_documentation.test.js` to ensure 100% test pass rate.

---

## 4. Verification Plan

### Automated Tests
```bash
npx tsc && node out/test/phase01_structure_documentation.test.js
```

### Manual Verification
- Review `structure.md` formatting and markdown render quality in VS Code preview.
