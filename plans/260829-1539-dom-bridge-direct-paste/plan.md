# Plan: DOM Bridge Direct Paste & Submit Engine (Tier 1 Focus-Free)
Created: 2026-08-29
Status: 🟡 In Progress

## Overview
Enhance and harden the **DOM Bridge (Tier 1)** automation engine in Antigravity Auto-Plan Extension so that prompt text is injected directly into Antigravity IDE and VS Code chat editors and submitted seamlessly via native DOM APIs without requiring OS keyboard simulation (`xdotool`, PowerShell `WScript.Shell`, or `osascript`).

## Tech Stack & Architecture
- **Renderer Script:** `media/autoplan-dom-bridge.js` (Injected into Electron `workbench.html`)
- **IPC Server:** `src/bridgeServer.ts` (Local HTTP Server on `127.0.0.1:48860-48900`)
- **Coordinator:** `src/promptDispatcher.ts` (3-Tier Dispatcher with fast pre-flight readiness)
- **Runtime:** Electron Renderer DOM / Node.js Extension Host / TypeScript 5.3

## Phases

| Phase | Name | Target Files | Test File | Status |
|---|---|---|---|:---:|
| 01 | Deep DOM Traversal & Selector Engine Enhancement | `media/autoplan-dom-bridge.js` | `src/test/phase01_dom_selectors_traversal.test.ts` | ⬜ Pending |
| 02 | Multi-Strategy Direct Content Injection Engine | `media/autoplan-dom-bridge.js` | `src/test/phase02_direct_content_injection.test.ts` | ⬜ Pending |
| 03 | Direct Button Submission & Double-Tap Mechanics | `media/autoplan-dom-bridge.js` | `src/test/phase03_direct_submission_doubletap.test.ts` | ⬜ Pending |
| 04 | Prompt Dispatcher & Chat Reveal Coordination | `src/promptDispatcher.ts`, `src/bridgeServer.ts` | `src/test/phase04_tier1_dispatcher_integration.test.ts` | ⬜ Pending |

## Execution Guidelines
- Each phase contains **exactly one** comprehensive file-based test.
- After implementing each phase, run only that phase's single test file.
- Stop and wait for user review after each phase.

---
Next Phase: [phase-01-dom-selectors-traversal.md](./phase-01-dom-selectors-traversal.md)
