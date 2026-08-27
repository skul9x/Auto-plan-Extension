# Phase 02: Legacy Test Modernization & Alignment
Status: ✅ Completed
Dependencies: phase-01-stream-decoder-buffer-guard.md

## Objective
Modernize and align legacy test suites (`src/test/phase01.test.ts`, `src/test/phase02.test.ts`, `src/test/phase03_orchestrator_loop.test.ts`, and `src/test/phase01_folder_scanner.test.ts`) so they conform to the single-batch prompt execution flow, dynamic prompt templates, `{file}` vs `{path}` placeholder semantics, and current configuration defaults.

## Requirements
### Functional
- [x] Update `src/test/phase01.test.ts`: Update assertion on `DEFAULT_CONFIG.promptText` to match `DEFAULT_PROMPT_TEMPLATE`.
- [x] Update `src/test/phase02.test.ts`: Update `executePromptFlow` assertion to reflect single-batch clipboard priming + SendKeys sequencing order.
- [x] Update `src/test/phase03_orchestrator_loop.test.ts`: Intercept `executeBatchPromptFlow` and `customBatchSender` so automated conversation creation triggers reliably during orchestrator loop tests without hanging.
- [x] Update `src/test/phase01_folder_scanner.test.ts`: Fix placeholder test assertion to correctly distinguish `{file}`/`{phaseFile}` (file basename) from `{path}`/`{phasePath}` (full path).
- [x] Update `package.json` test runner scripts or test discovery script to allow running all test suites cleanly.

### Non-Functional
- [x] 100% test pass rate across all test files in `src/test/`.

## Files to Create/Modify
- `src/test/phase01.test.ts` - Modernize config assertions.
- `src/test/phase02.test.ts` - Align SendKeys batch flow assertions.
- `src/test/phase03_orchestrator_loop.test.ts` - Wire batch runner mocks.
- `src/test/phase01_folder_scanner.test.ts` - Align `{file}` placeholder test.
- `src/test/phase02_test_suite_modernization.test.ts` - Single comprehensive test for Phase 02 verifying execution of all aligned suites.

## Test Criteria
- Exactly one file-based test: `src/test/phase02_test_suite_modernization.test.ts`.
- [x] Executes each modernized legacy test suite and verifies zero failures.
- [x] Verifies all 4 modernized test files execute cleanly and exit with code 0.

---
Next Phase: phase-03-e2e-regression-packaging.md
