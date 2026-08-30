# Phase 03: End-to-End Regression & Release Packaging

**Status:** ✅ Completed  
**Plan Reference:** `plans/260830-0820-dom-bridge-cross-platform-fix/plan.md`  
**Target Files:**
- `src/test/phase05_e2e_cross_platform_release.test.ts`
- `src/test/phase03_e2e_cross_platform_release_fix.test.ts`
- `package.json`

---

## 1. Objective
Update the end-to-end regression test suite to resolve hardcoded VSIX version expectations, verify end-to-end multi-tier prompt dispatching (Tier 1 DOM Bridge -> Tier 2 Native Commands -> Tier 3 Keyboard Simulation) on both Windows and Linux, compile the codebase, and produce a verified, fully working VSIX release package.

---

## 2. Requirements

### Functional Requirements
- [x] Fix `phase05_e2e_cross_platform_release.test.ts` to dynamically resolve the current VSIX package name based on `package.json` (`antigravity-auto-plan-${version}.vsix`) rather than hardcoding legacy version numbers.
- [x] Execute full E2E regression suite covering:
  - Multi-phase automated execution loop.
  - Sidebar Control Center Webview IPC communications.
  - Port registry tracking and dynamic port probing across 48860-48900.
  - VSIX package integrity verification (valid ZIP header `50 4B 03 04` and size > 2KB).
- [x] Rebuild and package clean release archive via `npm run package`.

### Non-Functional Requirements
- [x] Clean test runs with zero unhandled rejections or unclosed HTTP servers.
- [x] Cross-platform CI/CD compatibility.

---

## 3. Implementation Steps
1. **Update `src/test/phase05_e2e_cross_platform_release.test.ts`**:
   - Dynamically load package version from `package.json`.
   - Support matching any generated `antigravity-auto-plan-*.vsix` file in the project root.

2. **Implement Dedicated Verification Test**:
   - Create `src/test/phase03_e2e_cross_platform_release_fix.test.ts` to validate the end-to-end flow with the fixed DOM Bridge script.

3. **Compile, Test & Package**:
   - Run `npm run compile` to build all TypeScript files to `out/`.
   - Run `npm test` and ensure all test suites pass.
   - Run `npm run package` to generate the updated `.vsix` file.

---

## 4. Test Criteria & Verification
- [x] `npm test` passes 100% with exit code 0.
- [x] `npm run test:bridge` passes 100% with exit code 0.
- [x] `antigravity-auto-plan-1.4.0.vsix` is successfully packaged and verified.
