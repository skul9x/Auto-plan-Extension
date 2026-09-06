# Phase 02: Tier 2 Position-Agnostic Title Parser Resilience

Status: ✅ Completed  
Dependencies: Phase 01  
Target Files: `media/autoplan-dom-bridge.js`  
Primary Test File: `src/test/phase02_tier2_title_parser_resilience.test.ts`

---

## 1. Objective

Refactor `parseWorkspaceFromTitleString(str, doc)` in `media/autoplan-dom-bridge.js` to be position-agnostic so it accurately resolves the workspace name regardless of whether the application name appears at the beginning, in the middle, or at the end of the title, and strip active file or view names.

---

## 2. Requirements

### Functional
- [x] In `media/autoplan-dom-bridge.js`:
  - [x] Enhance `parseWorkspaceFromTitleString(str, doc)`:
    - [x] Clean dirty dot prefix (`/^●\s*/`).
    - [x] Split on common dash separators (`/\s+[-—–]\s+/`).
    - [x] App Name Filtering:
      - [x] Recognize common app identifiers: `'antigravity'`, `'antigravity ide'`, `'visual studio code'`, `'code'`, `'cursor'`, `'vscodium'`, `'extension development host'`.
      - [x] Filter out parts matching any app identifier regardless of position (start, middle, end).
    - [x] Active Editor & File Filtering:
      - [x] Query `getActiveEditorOrTabNames(doc)` and filter out any part matching an active tab or known system view name (e.g. `'Auto-Plan Settings'`, `'Settings'`).
      - [x] Filter out parts ending in known file extensions (e.g. `/\.[a-zA-Z0-9_\-]{1,8}$/i`) such as `.md`, `.txt`, `.ts`, `.js`, `.json`, `.kt`, `.py`.
    - [x] Workspace Suffix Normalization:
      - [x] Strip workspace tags like `(Workspace)` or `[Workspace]`.
    - [x] Resolution Strategy:
      - [x] If after filtering, exactly 1 part remains: that part is the workspace name.
      - [x] If multiple parts remain: select the part that does not look like a file/path and isn't a system name.
      - [x] If 0 parts remain (e.g. title only had app name or untitled file): return empty string `""` (Tier 3 fallback).
  - [x] Update exports for testing.

### Non-Functional
- [x] Preserve backwards compatibility for all existing title strings tested in previous phases.
- [x] Strict immunity to crashes with malformed input strings or `null`/`undefined`.

---

## 3. Implementation Steps

1. In `media/autoplan-dom-bridge.js`:
   - Refactor `parseWorkspaceFromTitleString` with the position-agnostic filtering pipeline.
   - Integrate `getActiveEditorOrTabNames(doc)` into the exclusion loop.
   - Clean workspace strings with `(Workspace)` suffix removal.
2. Implement `src/test/phase02_tier2_title_parser_resilience.test.ts`:
   - Test 1: Antigravity IDE layout `Auto-plan-Extension-main - Antigravity IDE - body1.txt` resolves to `Auto-plan-Extension-main`.
   - Test 2: Standard VS Code layout `body1.txt - Auto-plan-Extension-main - Visual Studio Code` resolves to `Auto-plan-Extension-main`.
   - Test 3: No-editor layout `EV-Plus-main - Antigravity IDE` resolves to `EV-Plus-main`.
   - Test 4: Settings open `EV-Plus-main - Antigravity IDE - Auto-Plan Settings` resolves to `EV-Plus-main` (not `Auto-Plan Settings`).
   - Test 5: Multi-root workspace `TramsacEV (Workspace) - Antigravity IDE - main.ts` resolves to `TramsacEV`.
   - Test 6: Dirty state `● EV-Plus-main - Antigravity IDE - phase-02.md` resolves to `EV-Plus-main`.
   - Test 7: Empty window `Untitled-1 - Antigravity IDE` resolves to `""`.

---

## 4. Verification Plan

- Run the phase verification test:
  ```bash
  npm run compile && node out/test/phase02_tier2_title_parser_resilience.test.js
  ```
- Ensure all 7 assertions pass cleanly.
- Stop for user review.
