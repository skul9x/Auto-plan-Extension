# Phase 03: Tiered Workspace Detection End-to-End Integration

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02  
Target Files: `media/autoplan-dom-bridge.js`  
Primary Test File: `src/test/phase03_tiered_workspace_detection_e2e.test.ts`

---

## 1. Objective

Integrate Tier 1 (DOM Explorer extraction), Tier 2 (Position-agnostic title parsing), and Tier 3 (Safe fallback) into `detectWorkspaceName(doc)` and the `DomBridgeClient.prototype.discoverPort()` lifecycle, and verify end-to-end integration against real DOM samples (such as `body2.txt`).

---

## 2. Requirements

### Functional
- [x] In `media/autoplan-dom-bridge.js`:
  - Update `detectWorkspaceName(doc)`:
    - Step 1 (Tier 1): Call `extractWorkspaceFromExplorerDOM(doc)`. If non-empty, return immediately with high confidence.
    - Step 2 (Tier 2): Check `.window-title` or `[class*="window-title"]`. If present, run `parseWorkspaceFromTitleString(raw, doc)`. If non-empty, return it.
    - Step 3 (Tier 2 Fallback): Check `doc.title`. If present, run `parseWorkspaceFromTitleString(title, doc)`. If non-empty, return it.
    - Step 4 (Tier 3): Return `""`.
  - In `DomBridgeClient.prototype.discoverPort()`:
    - If `detectedWs` is empty `""`, do not append `&workspaceName=` parameter to probe URL or avoid asserting non-empty workspace requirement.
    - When `detectedWs` is found, ensure it passes through to discovery log and `/autoplan-status` query.
- [x] Maintain seamless integration with existing `BridgeServer` port discovery logic.

### Non-Functional
- [x] Zero regression across existing `src/test/phase03_multi_window_e2e_resilience.test.ts`.
- [x] Robust execution when running in Electron Renderer window context.

---

## 3. Implementation Steps

1. In `media/autoplan-dom-bridge.js`:
   - Wire `detectWorkspaceName(doc)` to execute the 3-tier cascade sequentially.
   - Refine `discoverPort()` to handle empty workspace gracefully.
2. Implement `src/test/phase03_tiered_workspace_detection_e2e.test.ts`:
   - Test 1: Full DOM fixture simulated from `body2.txt` (with `.window-title` and Explorer section) evaluates to `Auto-plan-Extension-main`.
   - Test 2: Full DOM fixture with Explorer sidebar hidden/collapsed correctly falls back to Tier 2 and extracts `Auto-plan-Extension-main`.
   - Test 3: Live `BridgeServer` instance on test port correctly accepts discovery probe from `DomBridgeClient` configured with real DOM fixture without 409 workspace-mismatch.
   - Test 4: Verify existing test suite compatibility.

---

## 4. Verification Plan

- Run the comprehensive end-to-end test:
  ```bash
  npm run compile && node out/test/phase03_tiered_workspace_detection_e2e.test.js
  ```
- Verify all tests pass cleanly.
- Stop for user review.
