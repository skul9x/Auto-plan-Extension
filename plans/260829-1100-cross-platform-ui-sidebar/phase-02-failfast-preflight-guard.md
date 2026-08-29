# Phase 02: Zero-Timeout Fail-Fast Pre-Flight Guard

Status: ✅ Completed  
Created At: 2026-08-29T07:51:40Z
Completed At: 2026-08-29T14:53:35Z
Dependencies: Phase 01  
Target Files:
- `src/promptDispatcher.ts`
- `src/orchestrator.ts`
- `src/test/phase02_failfast_preflight_guard.test.ts`

---

## 1. Objective
Eliminate the critical issue where missing DOM Bridge or missing OS keyboard tools causes the automation engine to hang silently for 15 minutes. Implement an instant (< 100ms) **Fail-Fast Pre-Flight Health Guard** that proactively checks transport tier readiness before launching phase execution.

---

## 2. Detailed Technical Requirements

### 2.1. Pre-Flight Health Guard in `src/promptDispatcher.ts`
1. **Interface Definition**:
   ```typescript
   export interface DispatchReadinessResult {
     ready: boolean;
     selectedTier: 'domBridge' | 'nativeCommand' | 'keyboard';
     isFocusFree: boolean;
     requiresForegroundFocus: boolean;
     warningMessage?: string;
     errorMessage?: string;
     remediationAction?: 'activateBridge' | 'installXdotool' | 'openDocs';
     details: {
       connectedClientsCount: number;
       os: 'win32' | 'linux' | 'darwin' | 'other';
       xdotoolAvailable?: boolean;
       bridgePort?: number;
     };
   }
   ```
2. **Readiness Evaluation Algorithm (< 100ms Execution Time)**:
   - **Step 1 (Check Tier 1 - DOM Bridge)**:
     - Check `bridgeServer.getConnectedClients().length > 0`.
     - If clients connected: return `{ ready: true, selectedTier: 'domBridge', isFocusFree: true, requiresForegroundFocus: false }`.
   - **Step 2 (Check Tier 3 - OS Keyboard Simulation)**:
     - If on Windows (`win32`): return `{ ready: true, selectedTier: 'keyboard', isFocusFree: false, requiresForegroundFocus: true, warningMessage: 'DOM Bridge not active. Using Windows PowerShell keyboard simulation. Please keep IDE focused.' }`.
     - If on Linux (`linux`):
       - Run `checkLinuxKeyboardPrerequisites()`.
       - If `xdotool` is available: return `{ ready: true, selectedTier: 'keyboard', isFocusFree: false, requiresForegroundFocus: true, warningMessage: 'DOM Bridge not active. Using Linux xdotool keyboard simulation. Please keep IDE focused.' }`.
       - If `xdotool` is NOT available: return `{ ready: false, selectedTier: 'keyboard', isFocusFree: false, requiresForegroundFocus: true, errorMessage: 'No usable prompt transport available on Linux. Neither DOM Bridge is connected nor xdotool is installed.', remediationAction: 'activateBridge' }`.

### 2.2. Fail-Fast Integration in `src/orchestrator.ts`
1. **Synchronous Validation Gate**:
   - In `orchestrator.startPhases(...)`, immediately call `promptDispatcher.validateDispatchReadiness()` before entering the phase loop or touching the transcript watcher.
2. **Immediate Abort on Readiness Failure**:
   - If `readiness.ready === false`:
     - Do NOT start phase execution timer.
     - Emit event `orchestrator.onError` or status change.
     - Return `{ success: false, abortedDueToPreflight: true, error: readiness.errorMessage, remediationAction: readiness.remediationAction }`.
3. **Streamlined Warning Dispatch**:
   - If `readiness.requiresForegroundFocus === true`, notify listeners / webview with active warning state.

---

## 3. Implementation Tasks
- [x] Task 2.1: Define `DispatchReadinessResult` and implement `validateDispatchReadiness()` in `src/promptDispatcher.ts`.
- [x] Task 2.2: Add readiness check gate at the start of `orchestrator.startPhases()` in `src/orchestrator.ts`.
- [x] Task 2.3: Ensure `orchestrator` aborts in < 100ms without starting timers when unready.
- [x] Task 2.4: Create comprehensive unit/integration test in `src/test/phase02_failfast_preflight_guard.test.ts`.

---

## 4. Verification Test Suite: `src/test/phase02_failfast_preflight_guard.test.ts`
The test file must verify:
1. **Tier 1 Ready Condition**:
   - When Bridge Server reports connected client, returns `ready: true`, `isFocusFree: true`, execution time < 50ms.
2. **Windows Fallback Condition**:
   - When Bridge has 0 clients on `win32`, returns `ready: true`, `selectedTier: 'osKeyboard'`, `isFocusFree: false`.
3. **Linux With xdotool Condition**:
   - When Bridge has 0 clients on `linux` with `xdotool` present, returns `ready: true`, `selectedTier: 'osKeyboard'`.
4. **Linux Without xdotool Condition (Fail-Fast)**:
   - When Bridge has 0 clients on `linux` and `xdotool` is missing, returns `ready: false`, `errorMessage` present, `remediationAction === 'activateBridge'`.
5. **Orchestrator Pre-Flight Abort Execution**:
   - When invoked on unready system, `orchestrator.startPhases()` resolves immediately with failure within 100ms and creates no hanging timers.

---

## 5. Exit Criteria
- [x] `npm run compile` succeeds with zero errors.
- [x] `node out/test/phase02_failfast_preflight_guard.test.js` passes all tests.
