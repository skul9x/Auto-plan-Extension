# Phase 02: Extension Guide & Settings Documentation (`README.md`)

Status: ⬜ Pending  
Dependencies: Phase 01  
Target Files:
- `README.md`
- `src/test/phase02_readme_documentation.test.ts`

---

## 1. Objective

Rewrite `README.md` into an exhaustive, production-ready user and developer manual. Document all modern v1.2.0 capabilities, including the Settings Webview Panel, Sidebar Control Center, Focus-Free DOM Bridge, 3-Tier Resilient Transport Engine, Zero-Timeout Pre-Flight Guards, Anti-Pollution Transcript Watcher, full configuration table (all 15 `autoplan.*` settings), all 13 extension commands, Linux troubleshooting (`pkexec`, `xdotool`, CSP handling), and developer testing instructions. Provide exactly one comprehensive file-based test suite in `src/test/phase02_readme_documentation.test.ts` to verify documentation completeness and configuration alignment against `package.json`.

---

## 2. Detailed Technical Requirements

### 2.1. README Structure & Content Requirements (`README.md`)
- **Header & Badge Bar:** Extension name, version (`1.2.0`), license (`MIT`), VS Code engine (`^1.80.0`), platforms (Linux, macOS, Windows).
- **Executive Overview:** Purpose of Antigravity Auto-Plan Extension, automated multi-phase loop execution, real-time AI transcript streaming, zero-interruption workflow.
- **Core Features Overview:**
  - ⚙️ **Settings Webview Panel:** Visual preference manager (`autoplan.openSettings`) for Tier modes, automated fallback toggles, timeout limits, loop delays, and dynamic prompt templates.
  - 🖼️ **Sidebar Control Center:** Dedicated Activity Bar dashboard (`autoplan.sidebarView`) with automated plan folder scanner, phase checklist toggle, live transcript stream, and quick action buttons.
  - ⚡ **Focus-Free DOM Bridge:** In-process DOM injection into Electron Renderer context (`workbench.html`), background prompt typing and submission without focus theft.
  - 🎯 **3-Tier Resilient Transport Engine:** Tier 1 (DOM Bridge) -> Tier 2 (VS Code Native Commands) -> Tier 3 (OS Keyboard Simulation) with automatic fallback and user mode override.
  - ⚡ **Zero-Timeout Pre-Flight Guard:** < 100ms environment health check preventing broken execution loops before running any phase.
  - 🔍 **Anti-Pollution Transcript Watcher:** Root mtime change detection, byte-offset incremental JSONL parser, quiet-period debounce filter.
- **Installation & Setup Guide:**
  - 1-Click DOM Bridge Setup (`autoplan.oneClickSetup`).
  - Linux Polkit elevation (`pkexec`) & permission prompt handling.
  - Linux `xdotool` fallback installation (`sudo apt-get install xdotool`).
- **Configuration Reference Table:** Full table documenting all 15 configuration keys from `package.json`:
  1. `autoplan.defaultPromptTemplate`
  2. `autoplan.promptTemplate`
  3. `autoplan.promptText`
  4. `autoplan.defaultPlanFolder`
  5. `autoplan.repeatCount`
  6. `autoplan.completionKeyword`
  7. `autoplan.delayBetweenLoopsMs`
  8. `autoplan.timeoutPerLoopMinutes`
  9. `autoplan.focusDelayMs`
  10. `autoplan.executionMode`
  11. `autoplan.allowTierFallback`
  12. `autoplan.bridgeTimeoutMs`
  13. `autoplan.autoApprovePermissions`
  14. `autoplan.autoInjectWorkbench`
  15. `autoplan.suppressFallbackWarnings`
- **Commands Reference Table:** All 13 registered commands from `package.json` (`autoplan.start`, `autoplan.stop`, `autoplan.skipPhase`, `autoplan.actionMenu`, `autoplan.openTranscript`, `autoplan.setPrompt`, `autoplan.installBridge`, `autoplan.uninstallBridge`, `autoplan.checkBridgeStatus`, `autoplan.openSidebar`, `autoplan.oneClickSetup`, `autoplan.checkStatus`, `autoplan.openSettings`).
- **Troubleshooting Guide:**
  - Linux Pre-Flight check failure resolution (`pkexec` privileges, `xdotool` installation).
  - Infinite reload/popup prevention.
  - Port conflict resolution (automatic fallback across ports 48860-48900 / 49200-49220).
  - Checksum warning suppression / repair (`product.json`).
- **Development & Testing Guide:** Compiling TypeScript (`npm run compile`), running tests (`npm test`), packaging VSIX (`npm run package`).

### 2.2. Automated File-Based Test (`src/test/phase02_readme_documentation.test.ts`)
- **Single Test File Requirement:** Exactly one comprehensive file-based test suite verifying:
  - `README.md` exists in root and is non-empty (> 5000 bytes).
  - Every configuration key in `package.json` contributes.configuration.properties is documented in `README.md`.
  - Every command in `package.json` contributes.commands is documented in `README.md`.
  - Required structural markdown headings exist (`# Antigravity Auto-Plan Extension`, `## Features`, `## Installation & Setup`, `## Configuration Reference`, `## Commands Reference`, `## Architecture Overview`, `## Troubleshooting`, `## Development & Testing`).
  - Required feature keywords and topics exist (`Settings Panel`, `Sidebar Control Center`, `Focus-Free DOM Bridge`, `3-Tier Resilient Transport`, `Zero-Timeout Pre-Flight Guard`, `Anti-Pollution Transcript Watcher`, `pkexec`, `xdotool`, `autoplan.openSettings`, `autoplan.oneClickSetup`).

---

## 3. Implementation Steps

1. Rewrite `README.md` in project root incorporating all technical documentation, tables, guides, and troubleshooting instructions.
2. Update/create `src/test/phase02_readme_documentation.test.ts` to implement the comprehensive file-based verification test.
3. Compile TypeScript and execute the single test:
   ```bash
   npx tsc && node out/test/phase02_readme_documentation.test.js
   ```
4. Verify 100% test pass rate.

---

## 4. Verification Plan

### Automated Test
```bash
npx tsc && node out/test/phase02_readme_documentation.test.js
```

### Manual Verification
- Review formatting, badges, tables, and links of `README.md` in VS Code Markdown Preview.
