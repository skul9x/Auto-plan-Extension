# Plan: Telegram Plain Text Output & Workflow Slash Autocomplete

Created: 2026-10-11 09:02
Status: ✅ Completed

## Overview
Enhance the Telegram Remote Control Bridge in Antigravity Auto-Plan Extension with two core capabilities:
1. **Clean Plain Text Output**: Strip 100% of Markdown formatting (headers, bold/italic, code fences, links, tables) from AI transcript responses before delivering to Telegram. Eliminate all HTML and markdown parse mode errors to guarantee clean, readable plain text on mobile.
2. **Workflow Slash Autocomplete (`/`)**: Dynamically register all Antigravity IDE workflows via Telegram Bot API `setMyCommands` with localized descriptions and icons. Normalize command naming (`_` to `-`) and support trailing argument forwarding (e.g., `/brainstorm <prompt>`, `/code <task>`) for rapid shortcut execution without premature message sending.

## Tech Stack
- Runtime: Node.js 20+ / VS Code Extension Host (TypeScript 5.3)
- Bot Framework: `grammY` (v1.21.0+)
- Telegram Bot API: `setMyCommands`, `sendMessage` with `parse_mode: undefined`
- Parsing & Sanitization: Dedicated Markdown-to-Plain-Text AST/Regex engine with table flattening
- IPC & Prompt Transport: `PromptDispatcher`, `BridgeServer` HTTP IPC loopback

## Phases

| Phase | Name | Status | Test |
|-------|------|--------|------|
| 01 | Markdown to Clean Plain Text Transformation Engine | ✅ Completed | `src/test/phase01_telegram_plain_text_stripper.test.ts` |
| 02 | Telegram Bot Response & Notification Plain Text Delivery | ✅ Completed | `src/test/phase02_telegram_plain_text_delivery.test.ts` |
| 03 | Workflow Slash Command Registration (`setMyCommands`) & Mapping | ✅ Completed | `src/test/phase03_workflow_command_registration_and_mapping.test.ts` |
| 04 | Command Argument Forwarding & Free-Form Workflow Prompt Dispatch | ✅ Completed | `src/test/phase04_workflow_prompt_dispatch_and_args.test.ts` |
| 05 | E2E Integration, Version Bump to 1.6.3 & Release Packaging | ✅ Completed | `src/test/phase05_plain_text_and_workflow_e2e_release.test.ts` |

## Quick Commands
- Start Phase 1: Implement `phase-01-markdown-to-plain-text-engine.md`
- Run Phase 1 Test: `node out/test/phase01_telegram_plain_text_stripper.test.js`
- Package Release: `npm run compile && vsce package`
