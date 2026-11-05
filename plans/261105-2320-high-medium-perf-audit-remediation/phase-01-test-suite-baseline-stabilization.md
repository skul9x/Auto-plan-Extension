# Phase 01: Test Suite Baseline Stabilization

Status: ✅ Completed  
Dependencies: None  

---

## 1. Objective
Restore green test status for the test suite by resolving test assertion regressions caused by the v1.7.4 version bump and the introduction of the Native Chat API dispatch tier, establishing an unambiguous verification baseline before architectural changes begin.

---

## 2. Scope
- Remediate **TEST-011**: Resolve hardcoded version mismatch in `src/test/phase04_telegram_rich_formatting_regression.test.ts`.
- Remediate **TEST-012**: Resolve legacy transport readiness expectation in `src/test/phase05_e2e_cross_platform_release.test.ts` when validating dispatch readiness negative assertion.
- Ensure both existing test suites pass cleanly without modifying runtime extension production code.

---

## 3. Requirements

### Functional Requirements
- **FR-01:** The Phase 04 regression test suite must dynamically match the extension version declared in `package.json` (or validate against `'1.7.4'`), preventing future release bumps from breaking packaging tests.
- **FR-02:** The Phase 05 cross-platform pre-flight test must correctly evaluate the simulated missing-transport condition by ensuring that the Native Chat API dispatch tier is explicitly mocked as unsupported for that negative test scenario, so that `validateDispatchReadiness('linux')` returns `ready: false` as expected by the assertion.
- **FR-03:** Both `npm run test:phase04-telegram-rich` and `node out/test/phase05_e2e_cross_platform_release.test.js` must execute to completion with 0 failed assertions.

### Non-Functional Requirements
- **NFR-01 Consistency:** Test assertions must reflect true system capabilities and must not rely on fragile cross-component assumptions.
- **NFR-02 Maintainability:** Avoid hardcoded version constants where dynamic package manifest queries are available.

---

## 4. Constraints
- Do not modify production runtime source code in `src/` outside the test directory.
- Preserve all existing passing test suites across Phase 04 and Phase 05.
- Do not introduce external npm dependencies for testing.

---

## 5. Dependencies
- `src/test/phase04_telegram_rich_formatting_regression.test.ts`
- `src/test/phase05_e2e_cross_platform_release.test.ts`
- `package.json`

---

## 6. Acceptance Criteria
- [x] Phase 04 test passes without version comparison assertion failures.
- [x] Phase 05 cross-platform pre-flight test passes without readiness mismatch assertion failures.
- [x] Exactly one file-based verification test executes and confirms both regression test targets succeed.

---

## 7. Verification Test Specification
- **Test File:** `src/test/phase01_test_suite_baseline_verification.test.ts`
- **Verification Target:**
  1. Validate that `package.json` version matches the expected release version (`1.7.4`).
  2. Validate that `phase04_telegram_rich_formatting_regression.test.ts` passes against the current `package.json`.
  3. Validate that `PromptDispatcher.validateDispatchReadiness('linux')` returns `ready === false` when both bridge and native chat capabilities are simulated as unavailable, and `ready === true` when native chat is available.
  4. Ensure zero test process failure exit codes.

