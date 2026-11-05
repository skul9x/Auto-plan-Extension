# Phase 01: Nudge Watchdog Default Deactivation & Configuration

Status: ✅ Completed  
Dependencies: None  

---

## 1. Objective
Deactivate the automatic 180-second mid-flight steering nudge (`"Search online to find the best practices..."`) by default in configuration schemas, package manifest, and orchestrator initialization, while preserving manual/opt-in reactivation capabilities.

---

## 2. Scope
- Update `package.json` configuration property `autoplan.longPhaseNudgeEnabled` default from `true` to `false`.
- Update `src/config.ts` configuration parsing so `longPhaseNudgeEnabled` defaults to `false` when unspecified.
- Verify `Orchestrator.startPhaseNudgeWatchdog()` honors `config.longPhaseNudgeEnabled === false` without setting active watchdog timers or injecting steering prompts.
- Maintain backward compatibility for users who explicitly enable `autoplan.longPhaseNudgeEnabled: true`.

---

## 3. Requirements

### Functional Requirements
- **FR-01:** When `autoplan.longPhaseNudgeEnabled` is omitted or unspecified in user settings, its resolved configuration value must be `false`.
- **FR-02:** When `longPhaseNudgeEnabled` is `false`, `Orchestrator.startPhaseNudgeWatchdog` must immediately return without scheduling any `setTimeout` timer.
- **FR-03:** No mid-flight nudge steering prompt (`"Search online to find the best practices..."`) must be injected into the prompt dispatcher or recorded in `PromptOriginTracker` after 180 seconds.
- **FR-04:** No Telegram phase nudge alert (`handlePhaseNudged`) should be dispatched during standard phase execution when nudge is deactivated.
- **FR-05:** If a user explicitly sets `autoplan.longPhaseNudgeEnabled: true` in their settings, the watchdog must operate normally with its configured threshold.

### Non-Functional Requirements
- **NFR-01 Performance:** Zero memory leaks or hanging timeout references when phases begin and end.
- **NFR-02 Reliability:** Clean state transitions across multiple sequential phases without residual watchdog timers.

---

## 4. Constraints
- Do not alter existing native prompt dispatcher APIs (`antigravity.addContext`, `antigravity.triggerSend`).
- Do not delete the underlying nudge mechanism, ensuring it remains available if explicitly opted into.
- Preserve configuration property types and description documentation in `package.json`.

---

## 5. Dependencies
- `src/config.ts`
- `src/orchestrator.ts`
- `package.json`

---

## 6. Acceptance Criteria
- [x] `getConfig().longPhaseNudgeEnabled` returns `false` by default.
- [x] `getLongPhaseNudgeConfig().enabled` returns `false` by default.
- [x] `package.json` configuration schema specifies `"default": false` for `autoplan.longPhaseNudgeEnabled`.
- [x] Orchestrator phase lifecycle starts without allocating a `phaseNudgeTimer` when nudge is disabled.
- [x] Exactly one file-based verification test executes and passes all test assertions.

---

## 7. Verification Test Specification
- **Test File:** `src/test/phase01_nudge_watchdog_deactivation.test.ts`
- **Test Requirements:**
  1. Verify default resolution of `getConfig().longPhaseNudgeEnabled` equals `false`.
  2. Verify `package.json` declares `autoplan.longPhaseNudgeEnabled` default as `false`.
  3. Verify `startPhaseNudgeWatchdog` with default config does not schedule a timer (`phaseNudgeTimer` remains `null`).
  4. Verify simulated phase running past 180 seconds does not invoke `triggerPhaseNudge`, does not emit `phaseNudged`, and does not track nudge prompts.
  5. Verify explicit `longPhaseNudgeEnabled: true` override correctly schedules and triggers the nudge.

