# Phase 03: End-to-End Regression & Zero-Deprecation Verification

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02  
Target Files:
- `package.json`
- `src/test/phase03_dep0169_async_scanner_regression.test.ts`

---

## 1. Objective

Perform an end-to-end regression verification verifying that all BridgeServer HTTP routes (WHATWG URL), asynchronous plan folder scanning in the Orchestrator, and test execution run completely free of `[DEP0169]` deprecation warnings with 100% test pass rate across the full suite.

---

## 2. Technical Requirements

1. **End-to-End Integrated Regression (`src/test/phase03_dep0169_async_scanner_regression.test.ts`):**
   - Attach global warning traps (`process.on('warning')`) to fail if any `DEP0169` or deprecated `url.parse` usage occurs anywhere during:
     - BridgeServer startup and client discovery probe.
     - Status queries with window key query strings.
     - Asynchronous plan discovery and folder execution in Orchestrator.
     - Command dispatch, DOM Bridge acknowledgment, and transcript events.
     - Orchestrator completion and cleanup.
2. **NPM Scripts Integration (`package.json`):**
   - Ensure `npm test` runs cleanly with zero deprecation warnings output.

---

## 3. Verification Plan

```bash
# 1. Run Phase 03 dedicated regression test
npx tsc && node out/test/phase03_dep0169_async_scanner_regression.test.js

# 2. Run standard full test suite to confirm zero warnings
npm test
```

---
