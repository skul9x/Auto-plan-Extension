# Phase 02: Orchestrator Long-Phase Nudge Watchdog Engine

Status: ✅ Completed
Test: `src/test/phase02_orchestrator_nudge_watchdog.test.ts`

## Goals
1. Implement the proactive `PhaseNudgeWatchdog` lifecycle inside `src/orchestrator.ts`.
2. Guarantee strict one-shot execution per phase (`phase.hasNudged = true`).
3. Coordinate the stop-and-inject sequence without disrupting the active transcript watcher loop.
4. Validate with a single comprehensive file-based test: `src/test/phase02_orchestrator_nudge_watchdog.test.ts`.

## Implementation Details

### 1. Watchdog Timer Lifecycle
In `src/orchestrator.ts`:
- Add properties:
  - `private phaseNudgeTimer: NodeJS.Timeout | null = null;`
- Extend `PhaseItem` interface:
  - `hasNudged?: boolean;`
  - `nudgeTimestamp?: number;`
  - `nudgeError?: string;`
- Implement methods:
  - `startPhaseNudgeWatchdog(phase: PhaseItem, phaseIndex: number, thresholdMs: number): void`:
    - Checks `config.longPhaseNudgeEnabled` (default `true`).
    - Sets `setTimeout` for `thresholdMs` (default `180000` ms / 3 mins).
    - Ensures timer is cleaned up when phase finishes, aborts, or is skipped.
  - `stopPhaseNudgeWatchdog(): void`:
    - Clears `phaseNudgeTimer` safely.
  - `triggerPhaseNudge(phase: PhaseItem, phaseIndex: number): Promise<void>`:
    - Guard: If `phase.hasNudged` is already true, return immediately.
    - Sets `phase.hasNudged = true;` and `phase.nudgeTimestamp = Date.now();`.
    - Invokes `promptDispatcher.stopActiveGeneration()` to halt ongoing AI generation.
    - Waits 400ms stabilization delay.
    - Dispatches prompt via `promptDispatcher.dispatchPrompt(nudgeMessage, { openNewConversation: false })`.
    - Emits `'phaseNudged', { phase, phaseIndex, message: nudgeMessage }`.
    - Logs structured telemetry to `DebugLogger`.

### 2. Non-Fatal Resiliency
- If dispatch fails (e.g., bridge offline), records `phase.nudgeError = err.message`, logs warning to `DebugLogger`, and continues watching transcript. The phase itself does NOT mark as Failed.

## Verification
- Test: `src/test/phase02_orchestrator_nudge_watchdog.test.ts`
- Verifies timer ignition at threshold, one-shot enforcement, timer disposal upon phase completion, and non-fatal error recovery.
