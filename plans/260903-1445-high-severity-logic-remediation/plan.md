# Plan: High-Severity Logic Remediation (LOGIC-004, LOGIC-005, LOGIC-006, LOGIC-007)

Created: 2026-09-03 14:45:00 UTC+7  
Status: 🟡 In Progress  
Target Scope: 4 High-Severity Logic Flaws in Auto-Plan Automation & Elevation Subsystems

---

## 1. Overview

This plan establishes a comprehensive, phased remediation for the **4 HIGH-SEVERITY** logic bugs documented in `phantich.md`:

1. **LOGIC-004: Permanent Hang on Truncation (TranscriptWatcher)**  
   When a transcript file is truncated or rotated (e.g. chat cleared, compacted, or reset), `stats.size < this.readOffset`. Because `stats.size > this.readOffset` evaluates to false and truncation is unhandled, `this.readOffset` is never reset. The watcher enters a permanent hang until the 15-minute orchestrator timeout expires.

2. **LOGIC-005: Blind OS Keystroke Injection in Tier 3 (KeyboardManager)**  
   When falling back to Tier 3 keyboard automation (`xdotool` on Linux, PowerShell on Windows), the engine sends `Ctrl+Shift+L` -> `Ctrl+A` -> `Ctrl+V` -> `Enter` without verifying that VS Code is currently the active OS foreground window. If the user switched windows (e.g., to a terminal or browser), the prompt is blindly pasted and executed in the foreign application.

3. **LOGIC-006: macOS Fallback Crash in Tier 3 (KeyboardManager)**  
   While clipboard copying supports macOS (`pbcopy`), `executeBatchPromptFlow` throws an unhandled exception (`Unsupported platform for keyboard automation: darwin`). When Tier 1 and Tier 2 fail on macOS, Tier 3 crashes the execution pipeline instead of executing native AppleScript automation.

4. **LOGIC-007: Blocking Elevation Flooding & UI Freeze (WorkbenchInjector / Config / ExtensionLifecycle)**  
   `writeFileElevated` uses synchronous `execSync` (`pkexec`, UAC, `osascript`), blocking the Extension Host event loop for up to 30 seconds. Furthermore, `writeConfigJson` writes `ag-autoplan-config.json` into system-owned directories (`/usr/share/code/...`), triggering root elevation prompts on every config change. Saving settings with ~15 keys invokes 15 sequential modal elevation prompts and freezes VS Code.

---

## 2. Phase Breakdown

| Phase | Title | Target Issue | Primary Test File |
|---|---|---|---|
| **01** | [Transcript Truncation & Rotation Resilience](./phase-01-transcript-truncation-resilience.md) | LOGIC-004 | `src/test/phase01_transcript_truncation_resilience.test.ts` |
| **02** | [Blind Keystroke Injection Guard & Window Focus Verification](./phase-02-blind-keystroke-injection-guard.md) | LOGIC-005 | `src/test/phase02_blind_keystroke_injection_guard.test.ts` |
| **03** | [macOS Tier 3 AppleScript Keystroke Fallback](./phase-03-macos-tier3-applescript-fallback.md) | LOGIC-006 | `src/test/phase03_macos_tier3_applescript_fallback.test.ts` |
| **04** | [Non-Blocking Elevation & Config Storage Isolation](./phase-04-nonblocking-elevation-and-config-isolation.md) | LOGIC-007 | `src/test/phase04_nonblocking_elevation_and_config_isolation.test.ts` |

---

## 3. Strict Execution Protocol

Per user requirements:
- All phase files are written in English.
- Each phase contains **exactly one** comprehensive file-based test.
- No more than one test shall be created or run per phase.
- After completing each phase, run only that single test for verification.
- Stop immediately after running the test so the user can review.
- Once finished, output `done.`.
