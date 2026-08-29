# Phase 04: Prompt Dispatcher & Chat Reveal Coordination

Status: ✅ Completed  
Dependencies: Phase 03  
Target Files:
- `src/promptDispatcher.ts`
- `src/bridgeServer.ts`
- `src/test/phase04_tier1_dispatcher_integration.test.ts`

---

## 1. Objective
Ensure seamless end-to-end coordination between Extension Host (`PromptDispatcher`, `BridgeServer`) and the DOM Bridge script. Provide a lightweight chat reveal hook in `dispatchTier1` so that the chat DOM tree is guaranteed to be mounted before prompt dispatching without requiring user intervention.

---

## 2. Requirements & Specification

### 2.1. Chat Reveal Hook in `dispatchTier1`
- In `PromptDispatcher.dispatchTier1(promptText, options)`:
  - If `options.revealChat !== false`, execute lightweight command `vscode.commands.executeCommand('workbench.action.chat.open')` or `antigravity.prioritized.chat.open` in a guarded `try...catch` block to ensure chat DOM nodes are mounted.
  - Forward `promptText` directly to `bridgeServer.dispatchPromptCommand()`.

### 2.2. Robust Error Forwarding & Diagnostics
- If DOM Bridge rejects with `No valid chat input element found in DOM`, include `domSnapshot` and step-by-step diagnostic failure details in the error object.
- When `allowTierFallback` is enabled, seamlessly transition to fallback without hanging.

---

## 3. Implementation Steps
1. Update `PromptDispatcher.ts` and `BridgeServer.ts` to handle chat reveal and structured telemetry.
2. Implement exactly one comprehensive file-based test in `src/test/phase04_tier1_dispatcher_integration.test.ts`.
3. Compile TypeScript and execute the single test:
   ```powershell
   $env:PATH = "C:\Program Files\nodejs;" + $env:PATH
   npx tsc
   node out/test/phase04_tier1_dispatcher_integration.test.js
   ```
4. Verify 100% test pass rate.

---

## 4. Verification Test Criteria
- Exactly one test file: `src/test/phase04_tier1_dispatcher_integration.test.ts`.
- Validates end-to-end Tier 1 prompt dispatching, chat reveal triggering, and ACK processing.
- Validates error forwarding when DOM bridge returns diagnostic snapshots.

---
Plan Complete.
