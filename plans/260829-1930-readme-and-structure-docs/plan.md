# Plan: Documentation Overhaul (structure.md & README.md)

Created: 2026-08-29 19:30  
Status: 🟡 In Progress  
Target: Establish comprehensive, production-grade architectural documentation in `structure.md` and complete user/developer manual in `README.md` reflecting the latest v1.2.0 features (3-Tier Transport Engine, Settings Webview Panel, Sidebar Control Center, Focus-Free DOM Bridge, Anti-Pollution Watcher).

---

## 🎯 Plan Objectives

1. **Phase 01: Project Architecture & Codebase Structure Documentation (`structure.md`)**
   - Document full directory tree, module responsibility maps for all 11 core TypeScript modules, webview assets, IPC communication protocols, state machines, and sequence diagrams.
   - Include exactly one comprehensive file-based test suite `src/test/phase01_structure_documentation.test.ts` verifying file existence, size, required architectural headings, and physical existence of all referenced files.

2. **Phase 02: Production-Grade Extension & Settings Guide (`README.md`)**
   - Rewrite `README.md` into an exhaustive user and developer guide detailing all v1.2.0 capabilities:
     - Settings Webview Panel (Tier selection, fallback toggle, timeouts, prompts)
     - Sidebar Control Center (Activity Bar view, phase selector, live log streamer)
     - Focus-Free DOM Bridge & 3-Tier Resilient Transport Engine
     - Zero-Timeout Pre-Flight Guard & Anti-Pollution Transcript Watcher
     - All 15 configuration schema properties and 13 extension commands
     - Linux elevation (`pkexec`), `xdotool` fallback, CSP troubleshooting, and test execution.
   - Include exactly one comprehensive file-based test suite `src/test/phase02_readme_documentation.test.ts` verifying complete documentation coverage against `package.json` configurations, commands, and feature keywords.

---

## 📅 Phase Summary

| Phase | Name | Status | Test File |
|-------|------|--------|-----------|
| 01 | Structure Documentation (`structure.md`) | ⬜ Pending | `src/test/phase01_structure_documentation.test.ts` |
| 02 | Extension Guide & Settings Documentation (`README.md`) | ⬜ Pending | `src/test/phase02_readme_documentation.test.ts` |

---

## 🚀 Quick Commands
- Start Phase 01: `/code phase-01`
- Start Phase 02: `/code phase-02`
