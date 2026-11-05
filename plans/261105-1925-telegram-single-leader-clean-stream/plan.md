# Plan: Telegram Single-Leader Policy, Clean Final-Only Delivery & Nudge Watchdog Deactivation
Created: 2026-11-05T19:25:00+07:00  
Status: ✅ Completed  
Target Version: v1.7.4  

---

## Overview
This plan implements three critical refinements based on user requirements and real-world behavior:
1. **Mid-Flight Nudge Deactivation:** Disables automatic injection of `"Search online to find the best practices..."` after 180 seconds by default, preserving uninterrupted AI context flow.
2. **Single-Leader Telegram Delivery Gating:** Eliminates duplicate `🔄 Live Progress` messages by ensuring only the active leader window (`getIsLeader() === true`) is permitted to call Telegram Bot delivery APIs, cleanly muting standby instances.
3. **Clean Single-Message Delivery & Continuous Typing:** Eliminates progress notification noise by introducing a clean `'final_only'` delivery mode that maintains a smooth typing indicator during background work and delivers a single, polished Rich HTML response upon phase/completion.

---

## Phases

| Phase | Name | Description | Status | Progress |
|-------|------|-------------|--------|----------|
| 01 | Nudge Watchdog Default Deactivation & Configuration | Disable `longPhaseNudgeEnabled` by default across config schemas and manifest, verify clean prompt dispatch. | ✅ Completed | 100% |
| 02 | Single-Leader Delivery Gating & Standby Muting | Gate `ThrottledNotifier` and outbound Telegram deliveries so only the leader instance dispatches messages. | ✅ Completed | 100% |
| 03 | Clean Final-Only Delivery Mode & Typing State Lifecycle | Add `liveProgressMode` (`final_only` vs `live_edit`), continuous typing action, and single final Rich HTML response delivery. | ✅ Completed | 100% |
| 04 | Full End-to-End Regression & VSIX Packaging | Comprehensive integration tests verifying nudge deactivation, single-leader deduplication, final-only delivery, and packaging v1.7.4. | ✅ Completed | 100% |

---

## Quick Commands
- Start Phase 1: `/code phase-01`
- Next steps: `/next`
- Check context: `/recap`

