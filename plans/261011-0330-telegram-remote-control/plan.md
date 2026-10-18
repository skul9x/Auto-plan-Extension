# Plan: Telegram Bot Remote Control & Workflow Bridge

Created: 2026-10-11 03:30
Status: 🟡 In Progress

## Overview
Integrate a native Telegram Remote Control Bridge into the Antigravity Auto-Plan Extension (`antigravity-auto-plan`). This allows developers to remotely orchestrate multi-phase development plans, monitor real-time AI execution, trigger free chat prompts directly into the Antigravity IDE, capture desktop screenshots, and inspect execution progress from any Telegram client without requiring remote desktop tools (UltraViewer/AnyDesk).

## Tech Stack
- Runtime: Node.js / VS Code Extension Host (TypeScript 5.3)
- Bot Framework: `grammY` (Lightweight, pure TypeScript, zero native dependencies)
- Transport: Telegram Bot API Long Polling (`getUpdates`)
- Process Coordination: Port Registry Leader Election (`ag-autoplan-ports.json`)
- IDE Integration: VS Code Extension API, Auto-Plan `Orchestrator`, `PromptDispatcher`, `TranscriptWatcher`, `PlanScanner`
- System Utilities: `/usr/bin/gnome-screenshot` (Linux Mint / GNOME desktop capture)

## Phases

| Phase | Name | Status | Test |
|-------|------|--------|------|
| 01 | Core Telegram Bridge & Lifecycle Engine | ⬜ Pending | `src/test/phase01_telegram_bridge_lifecycle.test.ts` |
| 02 | Plan Folder Discovery & Execution Selector | ⬜ Pending | `src/test/phase02_plan_discovery_selector.test.ts` |
| 03 | Free Chat Dispatcher, Session & Message Chunking | ⬜ Pending | `src/test/phase03_free_chat_and_session.test.ts` |
| 04 | Real-Time Transcript Stream & Throttled Notifications | ⬜ Pending | `src/test/phase04_stream_notifications_throttle.test.ts` |
| 05 | Screen Capture, Status Dashboard & E2E Verification | ⬜ Pending | `src/test/phase05_telegram_integration_e2e.test.ts` |

## Quick Commands
- Start Phase 1: Implement `phase-01-core-telegram-bridge-and-lifecycle.md`
- Run Phase 1 Test: `node out/test/phase01_telegram_bridge_lifecycle.test.js`
- Extension Package: `npm run compile && vsce package`
