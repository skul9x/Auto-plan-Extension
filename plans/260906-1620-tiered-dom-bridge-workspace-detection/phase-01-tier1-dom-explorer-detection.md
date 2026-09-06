# Phase 01: Tier 1 DOM Explorer Extraction & Active Tab Exclusion

Status: ✅ Completed  
Dependencies: None  
Target Files: `media/autoplan-dom-bridge.js`  
Primary Test File: `src/test/phase01_tier1_explorer_workspace_detection.test.ts`

---

## 1. Objective

Implement Tier 1 of the workspace detection engine in `media/autoplan-dom-bridge.js` to extract the workspace folder name directly from the DOM Explorer tree, and introduce an active tab/editor exclusion helper to prevent active file or settings view names from masquerading as workspace names.

---

## 2. Requirements

### Functional
- [x] In `media/autoplan-dom-bridge.js`:
  - [x] Implement `extractWorkspaceFromExplorerDOM(doc)`:
    - Query `doc.querySelector('[aria-label^="Explorer Section: "]')` or `doc.querySelector('[aria-label*="Explorer Section"]')`.
    - If matched, parse the section title from the `aria-label` attribute (e.g. `"Explorer Section: Auto-plan-Extension-main"` -> `"Auto-plan-Extension-main"`).
    - Also check `.pane-header[aria-label*="Explorer Section"] .title` or `.explorer-folders-view .pane-header .title` text content as a secondary selector within Explorer.
    - Validate that the candidate is non-empty and does not contain generic system strings.
  - [x] Implement `getActiveEditorOrTabNames(doc)`:
    - Query active editor tabs: `doc.querySelectorAll('.tab.active .label-name, .tab[aria-selected="true"] .label-name, .tabs-and-actions-container .tab.active')`.
    - Collect active tab names, current breadcrumb names, and known system view names (`"Auto-Plan Settings"`, `"Settings"`, `"Welcome"`, `"Release Notes"`).
    - Return a Set/array of normalized active item names to be excluded by title parsers.
  - [x] Export `extractWorkspaceFromExplorerDOM` and `getActiveEditorOrTabNames` on the module root (for browser global and CommonJS test harnesses).

### Non-Functional
- [x] Safe execution with zero throw on detached or mock DOM objects.
- [x] O(1) DOM query latency with bounded element traversal.

---

## 3. Implementation Steps

1. In `media/autoplan-dom-bridge.js`:
   - Add `extractWorkspaceFromExplorerDOM(doc)` function with robust attribute matching.
   - Add `getActiveEditorOrTabNames(doc)` helper to collect active tab titles and system view identifiers.
   - Wire export in `if (typeof module !== 'undefined' && module.exports)` block.
2. Implement `src/test/phase01_tier1_explorer_workspace_detection.test.ts`:
   - Test 1: Extract workspace name correctly from standard `aria-label="Explorer Section: Auto-plan-Extension-main"`.
   - Test 2: Extract workspace name from `.pane-header .title` element inside explorer.
   - Test 3: Return empty string gracefully when Explorer sidebar is collapsed, hidden, or absent.
   - Test 4: `getActiveEditorOrTabNames` correctly collects `.tab.active` label names and system screens (`Auto-Plan Settings`).

---

## 4. Verification Plan

- Run the phase verification test:
  ```bash
  npm run compile && node out/test/phase01_tier1_explorer_workspace_detection.test.js
  ```
- Ensure all assertions pass without error.
- Stop for user review.
