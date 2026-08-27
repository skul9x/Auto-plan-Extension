# Phase 02: Strict Transcript Watcher & Anti-Pollution Guard
Status: ✅ Completed
Dependencies: Phase 01

## Objective
Upgrade `TranscriptWatcher` with anti-pollution conversation isolation, strict model response validation, and a dynamic debounce quiet-period guard. This guarantees that:
1. Phase N+1 never matches completion keywords from Phase N's conversation log.
2. The keyword `"Done skul9x."` only triggers on actual model responses after all scripts, terminal tools, and file writes have completely ceased.

## Requirements
### Functional
- [x] **Anti-Pollution Conversation Tracking**:
  - Enhance `waitForNewConversation(sinceTimestamp, excludeConvId, timeoutMs)` to explicitly reject `excludeConvId` (the conversation ID from the previous phase).
  - Ensure the watcher only locks onto a newly created conversation directory belonging to the active phase.
  - When watching files, enforce a `sinceTimestamp` filter or byte-offset barrier so log lines written prior to the current phase trigger are ignored.
- [x] **Strict Step Validation**:
  - Discard steps where `source !== 'MODEL'` or `type !== 'PLANNER_RESPONSE'`.
  - Completely ignore `USER_INPUT`, `USER_EXPLICIT`, `SYSTEM`, `CONVERSATION_HISTORY`, and `CHECKPOINT` steps (preventing prompt echo false triggers).
  - Require `status === 'DONE'`.
  - Guard against active tools: Require `tool_calls` to be `null`, `undefined`, or `[]` (empty). If tools are present, the agent is still executing.
  - Content check: Ensure `content` or response text strictly includes `"Done skul9x."` (case-insensitive, trimmed).
- [x] **Dynamic Debounce Settle Guard**:
  - When a valid completion match is found, enter a **1500ms Quiet Period**.
  - If *any* new transcript line or activity is logged during this 1500ms window (e.g. subagent execution, follow-up tool call, or delayed output), **cancel and reset the timer**.
  - Resolve the completion promise only after a full 1500ms of silence from the agent.
- [x] **Clean Buffer & Stream Reset**:
  - Reset `lineBuffer`, `readOffset`, and active timers when watching a new file or starting a new phase.
  - Combine native `fs.watch` with a fast backup polling interval (100ms) for sub-200ms detection without event dropping.

### Non-Functional
- [x] Non-blocking streaming I/O with low CPU overhead.
- [x] Guaranteed cleanup on `stop()` or timeout with zero orphaned timers or open file handles.

## Files to Create/Modify
- `src/transcriptWatcher.ts` - Implement anti-pollution filtering, strict step validator, and dynamic debounce quiet period.
- `src/test/phase02_strict_watcher.test.ts` - Comprehensive single test file for Phase 02.

## Test Criteria
- [x] Exactly one file-based test: `src/test/phase02_strict_watcher.test.ts`.
- [x] **Anti-Pollution Test**: Simulates Phase 1 conversation containing `"Done skul9x."` and verifies that Phase 2 ignores Phase 1's directory and waits for the new conversation.
- [x] **Echo Prevention Test**: Verifies `USER_INPUT` containing `"Done skul9x."` does NOT trigger completion.
- [x] **Pending Tool Test**: Verifies `MODEL` step with pending `tool_calls` does NOT trigger completion even if keyword is mentioned in thought or arguments.
- [x] **Dynamic Debounce Test**: Verifies that new lines arriving during the 1500ms settle window reset the timer.
- [x] **Clean Completion Test**: Verifies a clean `MODEL` step (`status: 'DONE'`, no tools, `"Done skul9x."`) completes successfully after 1500ms quiet period.

---
Next Phase: [phase-03-orchestrator-phase-loop.md](file:///d:/skul9x/Auto-Plan_Extension/plans/260828-0020-folder-plan-runner/phase-03-orchestrator-phase-loop.md)
