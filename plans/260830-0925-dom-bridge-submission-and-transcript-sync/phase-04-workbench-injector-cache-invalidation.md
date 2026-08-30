# Phase 04: Workbench Injector Cache Invalidation & Full Regression (`src/workbenchInjector.ts`)

Status: ✅ Completed  
Dependencies: `phase-03-orchestrator-dynamic-sync-e2e.md`  
Target Files:
- `src/workbenchInjector.ts`
- `media/autoplan-dom-bridge.js`
- `src/test/phase04_dom_bridge_full_regression.test.ts`

---

## 1. Objective

Ensure that the updated `media/autoplan-dom-bridge.js` is automatically re-injected into VS Code / Antigravity IDE `workbench.html` with a cache-busting timestamp version query parameter (`autoplan-dom-bridge.js?v=...`), forcing Electron/Chromium renderer to execute the latest single-submit script. Run an exhaustive end-to-end regression test suite verifying all 4 phases and existing core features. Implement a single automated test in `src/test/phase04_dom_bridge_full_regression.test.ts`.

---

## 2. Detailed Technical Requirements

### 2.1. Workbench Injector Cache-Busting (`src/workbenchInjector.ts`)
- **Version Query Parameter Synchronization**:
  - Ensure `injectWorkbenchHtml` generates a fresh timestamp query string (e.g. `?v=${Date.now()}`) when injecting or updating the `<script src="autoplan-dom-bridge.js?v=...">` tag in `workbench.html`.
  - Ensure file copy from `media/autoplan-dom-bridge.js` to the target workbench directory preserves file integrity and overwrites older script versions.
- **Diagnostic Verification**:
  - Update `getInjectionStatus` to verify both the HTML script tag and physical script existence in the workbench directory.

### 2.2. Automated File-Based Test (`src/test/phase04_dom_bridge_full_regression.test.ts`)
- **Single Test Suite Requirements**: Exactly one comprehensive file-based test suite verifying:
  1. Workbench injector properly copies updated `autoplan-dom-bridge.js` and applies cache-busting version query string to HTML.
  2. DOM Bridge single-submit strategy: verifies that with Send Button present, only mouse click is dispatched and zero Enter key events are triggered.
  3. Transcript Watcher multi-conversation sync: verifies no hang when duplicate/ghost conversations are created.
  4. Orchestrator end-to-end loop: verifies Phase 1 -> Phase 2 instant progression upon `"Done skul9x."` completion keyword.
  5. Executed via Node.js test runner:
     ```bash
     npx tsc; node out/test/phase04_dom_bridge_full_regression.test.js
     ```

---

## 3. Implementation Steps

1. Review and refine `src/workbenchInjector.ts` cache-busting and file copy mechanics.
2. Create `src/test/phase04_dom_bridge_full_regression.test.ts`.
3. Compile TypeScript and execute the single verification test:
   ```bash
   npx tsc; node out/test/phase04_dom_bridge_full_regression.test.js
   ```
4. Verify 100% test pass rate.

---

## 4. Verification Plan

### Automated Test
```bash
npx tsc; node out/test/phase04_dom_bridge_full_regression.test.js
```

### Manual Verification
- Execute `Auto-Plan: Invalidate & Re-inject DOM Bridge` command in VS Code / Antigravity IDE and inspect `workbench.html`.

---
Next Phase: None (Final Phase)
