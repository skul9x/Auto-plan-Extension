# Plan: Prompt Template Modernization & Nudge Watchdog Elimination

Created: 2026-10-22T05:55:00+07:00
Target Version: v1.6.8
Status: 🟢 Completed

## Overview
This plan modernizes the Auto-Plan phase execution prompt template to incorporate rigorous online research, architecture analysis, and single-test verification guidelines as defined in `newprompt.txt`. Concurrently, it cleanly eliminates the legacy 3-minute mid-flight nudge watchdog (`longPhaseNudge`), purging all associated timers, configuration settings, Telegram notifications, and dashboard UI controls to prevent unwarranted prompt injections and unnecessary resource overhead.

## Phases

| Phase | Name | Status | Test |
|---|---|---|---|
| 01 | Prompt Template Modernization & Schema Defaults | ✅ Completed | `src/test/phase01_prompt_template_modernization.test.ts` |
| 02 | Nudge Watchdog Elimination & Settings UI Remediation | ✅ Completed | `src/test/phase02_nudge_watchdog_removal.test.ts` |
| 03 | Regression Benchmark, Documentation & Release Packaging (v1.6.8) | ✅ Completed | `src/test/phase03_release_v1_6_8.test.ts` |

## Quick Commands
- Start Phase 01: `/code phase-01`
- Check progress: `/next`
- Save context: `/save-brain`
