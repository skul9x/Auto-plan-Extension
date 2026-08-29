# Phase 01: Configuration Schema & Strict Tier Fallback Engine

Status: ✅ Completed  
Dependencies: None  
Target Files:
- `src/config.ts`
- `src/promptDispatcher.ts`
- `package.json`
- `src/test/phase01_config_tier_fallback_engine.test.ts`

---

## 1. Objective
Enhance the configuration system and the prompt dispatching engine to support explicit Tier selection (`auto`, `domBridge`, `nativeCommand`, `keyboard`), strict vs fallback execution policies (`allowTierFallback`), strict pre-flight validation rules that fail fast when an un-fallbackable tier is missing prerequisites, and a live tier transport test method (`testTierDispatch`).

---

## 2. Detailed Technical Requirements

### 2.1. Configuration Schema Updates (`src/config.ts` & `package.json`)
1. **Extend `AutoPlanConfig` Interface**:
   - `executionMode: 'auto' | 'domBridge' | 'nativeCommand' | 'keyboard'` (Default: `'auto'`).
   - `allowTierFallback: boolean` (Default: `true`).
   - `strictMode: boolean` (Derived or explicit flag: if `false` or mode is `auto`, fallback is allowed; if `true` and mode is specific tier, fallback is disallowed).
2. **VS Code Settings Contributions (`package.json`)**:
   - Add `autoplan.allowTierFallback` (`boolean`, default: `true`, description: "Allow automated fallback to secondary tiers if the chosen execution tier fails").
   - Update `autoplan.executionMode` enum descriptions with explicit tier naming (`Auto (Tier 1 -> Tier 2 -> Tier 3)`, `Strict Tier 1 (DOM Bridge Focus-Free)`, `Strict Tier 2 (VS Code Native Commands)`, `Strict Tier 3 (OS Keyboard Simulation)`).
3. **Synchronize Sidecar File**:
   - Ensure `writeConfigJson` includes `allowTierFallback` and resolved execution mode for renderer bridge consumption.

### 2.2. Prompt Dispatcher Strict Mode & Validation Engine (`src/promptDispatcher.ts`)
1. **Extend `DispatchOptions` Interface**:
   - Add `allowFallback?: boolean` to `DispatchOptions`.
2. **Strict Pre-Flight Readiness Validation**:
   - Update `validateDispatchReadiness(platformOverride?: string, modeOverride?: ExecutionMode, allowFallbackOverride?: boolean)`:
     - If mode is `'domBridge'` and fallback is disabled (`allowFallback === false`): if no clients connected, return `ready: false`, `errorMessage: "Strict Tier 1 (DOM Bridge) requires active Electron bridge injection."`, `remediationAction: 'activateBridge'`, `selectedTier: 'domBridge'`.
     - If mode is `'nativeCommand'` and fallback is disabled: check readiness and return `ready: true`, `selectedTier: 'nativeCommand'`, `isFocusFree: false`, `requiresForegroundFocus: true`.
     - If mode is `'keyboard'` and fallback is disabled: if Linux and `xdotool` missing, return `ready: false`, `errorMessage: "Strict Tier 3 (Keyboard Simulation) on Linux requires xdotool to be installed."`, `remediationAction: 'installXdotool'`, `selectedTier: 'keyboard'`. If Windows or Linux with `xdotool`, return `ready: true`, `selectedTier: 'keyboard'`.
     - If mode is `'auto'` or fallback is enabled (`allowFallback !== false`): maintain existing 3-tier readiness cascade with backward-compatible defaults.
3. **Strict Dispatching with Fallback Guard**:
   - In `dispatchPrompt(promptText, options)`:
     - Check `allowFallback = options?.allowFallback ?? config.allowTierFallback ?? true`.
     - If fallback is disabled (`allowFallback === false` or strict mode): execute only the requested tier. If it throws, do NOT catch and fallback; instead wrap in a clear, formatted error message indicating the exact failure reason and remediation instructions.
     - If fallback is enabled: execute Tier 1 -> Tier 2 -> Tier 3 with fallback history tracking.
4. **Live Tier Test Method (`testTierDispatch`)**:
   - Implement `testTierDispatch(tier: DispatchTier, testPrompt?: string): Promise<{ success: boolean; tier: DispatchTier; latencyMs: number; error?: string; status?: string }>`:
     - For `'domBridge'`: Check bridge connection and send non-destructive `'ping'` command to measure round-trip latency.
     - For `'nativeCommand'`: Test command API executor availability and measure execution readiness latency.
     - For `'keyboard'`: Check OS platform prerequisites (e.g. `xdotool` on Linux, PowerShell on Windows) and measure validation latency.

---

## 3. Implementation Tasks
- [x] Task 1.1: Update `src/config.ts` with `allowTierFallback` in interface, `DEFAULT_CONFIG`, `getConfig()`, and `writeConfigJson()`.
- [x] Task 1.2: Update `package.json` configuration schema with `autoplan.allowTierFallback` and refined execution mode descriptions.
- [x] Task 1.3: Update `src/promptDispatcher.ts` to implement `DispatchOptions.allowFallback`, strict pre-flight checks, fallback policy enforcement in `dispatchPrompt()`, and non-destructive `testTierDispatch()`.
- [x] Task 1.4: Create comprehensive standalone verification test `src/test/phase01_config_tier_fallback_engine.test.ts`.

---

## 4. Verification Test Suite: `src/test/phase01_config_tier_fallback_engine.test.ts`
The test file must verify:
1. **Configuration Defaults & Serialization**:
   - Validate `getConfig()` returns valid defaults for `executionMode` and `allowTierFallback`.
   - Validate `writeConfigJson()` serializes new configuration properties correctly.
2. **Strict Pre-Flight Evaluation**:
   - Verify `validateDispatchReadiness()` fails fast with expected error and remediation action when `domBridge` is strict but 0 clients are connected.
   - Verify `validateDispatchReadiness()` fails fast when `keyboard` is strict on Linux without `xdotool`.
   - Verify `validateDispatchReadiness()` succeeds when `auto` mode has at least one valid tier.
3. **Strict Dispatch vs Fallback Dispatch Execution**:
   - Verify that when `allowTierFallback: false` and Tier 1 fails, it throws immediately without invoking Tier 2 or Tier 3.
   - Verify that when `allowTierFallback: true` and Tier 1 fails, it smoothly falls back to Tier 2 / Tier 3.
4. **Live Tier Test Ping**:
   - Verify `testTierDispatch` reports accurate latency and status for mock dispatchers.

---

## 5. Exit Criteria
- `npm run compile` succeeds with zero errors.
- `node out/test/phase01_config_tier_fallback_engine.test.js` passes 100% assertions.
