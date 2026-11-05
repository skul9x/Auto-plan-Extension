# Phase 04: Full End-to-End Regression & VSIX Packaging

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02, Phase 03  

---

## 1. Objective
Perform comprehensive end-to-end regression testing across the entire Auto-Plan Extension pipeline (nudge deactivation, multi-window single-leader gating, clean final-only delivery, Rich HTML formatting, and native chat dispatch), update project documentation, bump version to `v1.7.4`, and produce a tested VSIX package ready for deployment.

---

## 2. Scope
- Author a comprehensive regression test suite verifying the combined interactions of:
  - Deactivated 180s nudge watchdog.
  - Single-leader gating suppressing duplicate notifications from standby windows.
  - Final-only Telegram delivery with active typing indicators.
  - Native Antigravity dispatch commands (`antigravity.addContext`, `antigravity.triggerSend`).
- Update documentation:
  - `README.md` (Documenting new Telegram live progress modes and default settings).
  - `CHANGELOG.md` (Add `[1.7.4]` release entry).
  - `package.json` (Bump version to `1.7.4`).
- Compile TypeScript codebase and package `antigravity-auto-plan-1.7.4.vsix`.
- Verify VSIX package contents and extension installation compatibility.

---

## 3. Requirements

### Functional Requirements
- **FR-01:** Full system test must simulate an end-to-end phase execution lifecycle with two concurrent workspace windows (Leader + Standby):
  - No 180s nudge prompt dispatched by either window.
  - Standby window remains completely silent on Telegram.
  - Leader window issues typing indicators and exactly one completion message.
- **FR-02:** Verify that native dispatch tier execution (`promptDispatcher`) continues to function reliably without regression.
- **FR-03:** Version string in `package.json` must be incremented to `1.7.4`.
- **FR-04:** `README.md` and `CHANGELOG.md` must clearly document the new `autoplan.telegram.liveProgressMode` option and default nudge deactivation.
- **FR-05:** Produce an installable `.vsix` file using `npm run package`.

### Non-Functional Requirements
- **NFR-01 Backward Compatibility:** All existing commands, settings keys, and remote Telegram commands (`/start`, `/plans`, `/plan_start`, `/new_chat`, `/stop`) must remain functional.
- **NFR-02 Zero Errors:** Compilation via `npm run vscode:prepublish` must succeed with zero TypeScript errors or warnings.

---

## 4. Constraints
- The test suite must be self-contained and run in a standard Node.js test environment using mock IDE namespaces.
- Packaging must include all compiled artifacts in `out/`, `media/`, and required production dependencies.

---

## 5. Dependencies
- Phase 01
- Phase 02
- Phase 03
- `package.json`
- `README.md`
- `CHANGELOG.md`

---

## 6. Acceptance Criteria
- [x] Comprehensive regression test file passes with 100% assertions satisfied.
- [x] TypeScript compilation (`tsc -p ./`) finishes with 0 errors.
- [x] Version `1.7.4` is reflected in `package.json`, `README.md`, and `CHANGELOG.md`.
- [x] `antigravity-auto-plan-1.7.4.vsix` is created and validated.
- [x] Exactly one file-based verification test executes and passes all test assertions.

---

## 7. Verification Test Specification
- **Test File:** `src/test/phase04_single_leader_clean_stream_regression.test.ts`
- **Test Requirements:**
  1. Initialize full multi-window mock environment (Leader + Follower) with active Telegram bot.
  2. Execute orchestrator phase run for > 200 seconds virtual time:
     - Verify 0 nudge prompts injected.
     - Verify 0 duplicate live messages generated.
     - Verify typing indicator active during execution.
     - Verify 1 final Rich HTML message dispatched upon phase completion.
  3. Validate fallback behavior: trigger simulated HTTP 400 on final message delivery and assert clean plain-text zero-drop fallback.
  4. Verify package metadata and schema declarations.

