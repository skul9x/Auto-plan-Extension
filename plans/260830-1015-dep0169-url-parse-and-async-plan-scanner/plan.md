# Node.js Deprecation [DEP0169] Fix & Async Plan Scanner Migration Plan

**Created:** 2026-08-30T10:15:00+07:00  
**Status:** 🟡 Pending Review  
**Objective:** Resolve the Node.js `[DEP0169]` deprecation warning by replacing legacy `url.parse()` with the modern WHATWG `new URL()` API in `BridgeServer`, and eliminate synchronous blocking I/O by migrating `orchestrator.startPlanFolder` and related extension workflows to `scanPlanFolderAsync`.

---

## 1. Executive Problem Summary

1. **Node.js Deprecation Warning `[DEP0169]`:**
   - In [`src/bridgeServer.ts`](file:///d:/skul9x/Auto-plan-Extension-main/src/bridgeServer.ts#L512), `url.parse(req.url || '', true)` is used to parse incoming HTTP request URLs and query parameters.
   - On Node.js 20+ (VS Code runtime), this produces runtime deprecation warnings (`[DEP0169] DeprecationWarning: url.parse() behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead.`).
   - This clutters output logs and poses potential URL confusion vulnerabilities.

2. **Synchronous Plan Scanning in Async Workflows:**
   - In [`src/orchestrator.ts`](file:///d:/skul9x/Auto-plan-Extension-main/src/orchestrator.ts#L556), the `startPlanFolder` method is declared `async` but calls synchronous `scanPlanFolder(folderPath)` using `fs.readdirSync`.
   - In [`src/extension.ts`](file:///d:/skul9x/Auto-plan-Extension-main/src/extension.ts#L145), commands such as `selectPlanFolder` execute synchronous disk scanning on the main thread, potentially freezing the VS Code Extension Host UI during large folder scans.
   - Legacy `scanPlanFolder` in [`src/planScanner.ts`](file:///d:/skul9x/Auto-plan-Extension-main/src/planScanner.ts) lacks `@deprecated` annotations.

---

## 2. Architecture & Implementation Phases

| Phase | Description | Status | Target Files |
| :--- | :--- | :---: | :--- |
| **01** | WHATWG URL Migration & Node.js `[DEP0169]` Deprecation Remediation | ✅ Completed | `src/bridgeServer.ts`, `src/test/phase01_whatwg_url_bridge_server.test.ts` |
| **02** | Async Plan Scanning in Orchestrator & Extension Workflows | ✅ Completed | `src/planScanner.ts`, `src/orchestrator.ts`, `src/extension.ts`, `src/test/phase02_async_orchestrator_scanner.test.ts` |
| **03** | End-to-End Regression & Zero-Deprecation Verification | ✅ Completed | `package.json`, `src/test/phase03_dep0169_async_scanner_regression.test.ts` |

---

## 3. Verification & Testing Strategy

- Each phase will be backed by a dedicated file-based automated test suite located in `src/test/`.
- Tests will strictly monitor Node.js warning events (`process.on('warning')`) to assert zero `DEP0169` warnings during execution.
- Verification commands:
  - Phase 01: `npx tsc && node out/test/phase01_whatwg_url_bridge_server.test.js`
  - Phase 02: `npx tsc && node out/test/phase02_async_orchestrator_scanner.test.js`
  - Phase 03: `npx tsc && node out/test/phase03_dep0169_async_scanner_regression.test.js`
  - Overall E2E: `npm test`
