# Phase 04: End-to-End Tier Execution & Diagnostics Integration

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02, Phase 03  
Target Files:
- `src/orchestrator.ts`
- `README.md`
- `CHANGELOG.md`
- `src/test/phase04_e2e_tier_execution_settings.test.ts`

---

## 1. Objective
Ensure end-to-end integration between user configurations selected in the Settings Panel (e.g. Strict Tier 1, Strict Tier 2, Strict Tier 3, Auto Fallback) and the real execution engine in `src/orchestrator.ts`. Ensure pre-flight failures escalate immediately to the user with actionable notifications when a strict tier fails. Update `README.md` and `CHANGELOG.md` to document the new Settings Panel and Tier Management features.

---

## 2. Detailed Technical Requirements

### 2.1. Orchestrator Strict Tier Enforcement (`src/orchestrator.ts`)
1. **Pre-flight Enforcement**:
   - In `runPhaseSequence()` and `start()`: Validate readiness using `promptDispatcher.validateDispatchReadiness(undefined, config.executionMode, config.allowTierFallback)`.
   - If pre-flight fails because the configured strict tier is unavailable:
     - Set state to `'error'`.
     - Emit detailed error event: `"Pre-flight check failed for selected mode '${config.executionMode}'. ${readiness.errorMessage}"`.
     - Show actionable error notification offering "⚙️ Open Settings Panel", "⚡ 1-Click DOM Bridge Setup", or "Install Guide".
     - Halt immediately without entering the phase loop.
2. **Phase Execution Dispatch**:
   - Pass `allowFallback: config.allowTierFallback` inside `DispatchOptions` to `promptDispatcher.dispatchPrompt()`.
   - If strict dispatch fails during a phase run: fail the current phase immediately with error metadata and record failure details.

### 2.2. Documentation Updates (`README.md` & `CHANGELOG.md`)
1. **README.md**:
   - Add section: **"🖼️ Bảng Điều Khiển Cấu Hình Toàn Màn Hình (Settings Panel)"**.
   - Document how to open the Settings Panel (`autoplan.openSettings`, Sidebar button, Status bar menu).
   - Document Tier 1 (Focus-Free DOM Bridge), Tier 2 (VS Code Native Commands), Tier 3 (OS Keyboard Simulation), and the Fallback toggle policy.
   - Document error handling when a strict tier is chosen and prerequisites are missing.
2. **CHANGELOG.md**:
   - Add entry for the new version documenting the Full-Screen Settings Panel, strict tier execution, fallback policy controls, and live transport testing.

---

## 3. Implementation Tasks
- [x] Task 4.1: Integrate `allowTierFallback` and strict pre-flight error escalation into `src/orchestrator.ts`.
- [x] Task 4.2: Update `README.md` and `CHANGELOG.md` with complete documentation for Settings Panel and Tier Management.
- [x] Task 4.3: Create comprehensive standalone E2E verification test `src/test/phase04_e2e_tier_execution_settings.test.ts`.

---

## 4. Verification Test Suite: `src/test/phase04_e2e_tier_execution_settings.test.ts`
The test file must verify:
1. **Orchestrator Execution under Strict Tier 1 vs Auto Fallback**:
   - Verify orchestrator runs when DOM bridge is connected.
   - Verify orchestrator halts with pre-flight error when strict Tier 1 is selected but DOM bridge is disconnected.
2. **Orchestrator Execution under Strict Tier 3 on Linux**:
   - Verify orchestrator halts with pre-flight error if strict Tier 3 is selected on Linux without `xdotool`.
3. **Settings Persistence & Integration**:
   - Verify changing execution mode via `updateConfig` immediately alters orchestrator pre-flight behavior.
4. **Documentation Completeness**:
   - Verify `README.md` contains mentions of the settings panel and tier selection commands.

---

## 5. Exit Criteria
- `npm run compile` succeeds with zero errors.
- `node out/test/phase04_e2e_tier_execution_settings.test.js` passes 100% assertions.
