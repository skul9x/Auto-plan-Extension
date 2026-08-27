# Plan: Folder-Based Auto-Plan Runner & Status Bar Integration (Refined)
Created: 2026-08-28 00:20
Last Updated: 2026-08-28 00:23
Status: 🟡 In Progress

## Overview
Transform the Antigravity Auto-Plan extension into an enterprise-grade, folder-driven phase execution runner. The extension automatically scans plan folders, filters out documentation/summary artifacts, applies smart natural sorting, renders customizable prompt templates with absolute file paths, and executes phases sequentially in isolated conversations.

UI/UX is upgraded to a modern, keyboard-first **Smart 2-Tier QuickPick** and a bottom-right **Interactive Status Bar**, while the execution engine features **Anti-Pollution Conversation Isolation** and **Dynamic Debounce Settle Guards** to guarantee bulletproof reliability.

## Tech Stack & Architecture
- **Runtime**: VS Code Extension API (TypeScript 5.3)
- **Automation**: Windows SendKeys & Clipboard Automation (`wscript.shell` / PowerShell)
- **Log Monitoring**: Real-time JSON Lines Parser on Antigravity Brain Transcripts (`transcript.jsonl`)
- **State & Storage**: VS Code `workspaceState` / `globalState` (MEMENTO) for recent paths
- **Packaging**: `@vscode/vsce`

## Architecture Highlights & Safeguards
1. **Smart Plan Folder Discovery**: Auto-detects active open plan files, scans workspace `plans/`, and displays a 2-Tier QuickPick with recent history, native folder browse, and manual entry.
2. **Anti-Pollution Conversation Isolation**: Tracks `previousConversationId` and `phaseStartTime` timestamp to prevent Phase N+1 from falsely triggering on Phase N completion logs.
3. **Dynamic Quiet-Period Guard**: Implements a 1500ms debounce settle timer that resets if subsequent log entries occur, ensuring background tasks are fully quiescent before advancing.
4. **Phase Lifecycle & Resilience**: Tracks granular phase states (`Pending`, `Running`, `Completed`, `Failed`, `Skipped`) with support for Stop, Skip, and Resume.
5. **Rich Bottom-Right Status Bar**: Positioned at `StatusBarAlignment.Right` (priority 100) with running animations, rich markdown tooltips, and an interactive action menu.

## Phases

| Phase | Name | Status | Test File |
|-------|------|--------|-----------|
| 01 | Folder Scanner & Dynamic Prompt Templating | ✅ Completed | `src/test/phase01_folder_scanner.test.ts` |
| 02 | Strict Transcript Watcher & Anti-Pollution Guard | ✅ Completed | `src/test/phase02_strict_watcher.test.ts` |
| 03 | Orchestrator Sequential Runner & Phase Lifecycle | ⬜ Pending | `src/test/phase03_orchestrator_loop.test.ts` |
| 04 | Smart QuickPick UI & Interactive Status Bar UX | ⬜ Pending | `src/test/phase04_ui_ux.test.ts` |
| 05 | Packaging, Documentation & End-to-End Verification | ⬜ Pending | `src/test/phase05_e2e_package.test.ts` |

## Quick Commands
- Run Phase 01 Test: `npx ts-node src/test/phase01_folder_scanner.test.ts`
- Run Phase 02 Test: `npx ts-node src/test/phase02_strict_watcher.test.ts`
- Run Phase 03 Test: `npx ts-node src/test/phase03_orchestrator_loop.test.ts`
- Run Phase 04 Test: `npx ts-node src/test/phase04_ui_ux.test.ts`
- Run Phase 05 Test: `npx ts-node src/test/phase05_e2e_package.test.ts`
- Package Extension: `npm run package`
