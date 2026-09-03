# Phase 01: Fallback Abort Coordination (LOGIC-001 Remediation)

Status: ✅ Completed  
Dependencies: None  
Target Files:
- `src/bridgeServer.ts`
- `src/promptDispatcher.ts`
- `media/autoplan-dom-bridge.js`
- `src/test/phase01_uncoordinated_fallback_abort.test.ts`

---

## 1. Objective

Eliminate duplicate prompt submissions caused by uncoordinated tier fallback. When Tier 1 (DOM Bridge) times out after 5000ms, `BridgeServer` must mark the command as cancelled/aborted, and `DomBridgeClient` must verify command validity prior to triggering DOM click or Enter submission. If a command is cancelled, `DomBridgeClient` must immediately abort execution without submitting to the chat panel.

---

## 2. Root Cause Analysis (LOGIC-001)

1. `BridgeServer.dispatchPromptCommand()` registers a timeout timer (default 5000ms).
2. When the timer triggers, the server deletes `commandId` from `pendingCommands` and rejects the deferred promise without notifying the renderer.
3. `PromptDispatcher` catches the rejection and immediately dispatches Tier 2 (`antigravity.sendTextToChat`) or Tier 3 (Keyboard).
4. Meanwhile, `DomBridgeClient` in the renderer is still waiting for the Send button or resolving element selectors. Upon resolution, it triggers the click event.
5. Both Tier 1 and Tier 2 submit the prompt into Antigravity Chat within hundreds of milliseconds of each other.

---

## 3. Technical Requirements

### 3.1. Server-Side Cancellation Tracking (`src/bridgeServer.ts`)
1. Add a Set to track cancelled command IDs with TTL eviction (e.g. `cancelledCommandIds: Set<string>` or `Map<string, number>`).
2. When a command dispatch times out in `BridgeServer.dispatchPromptCommand()`:
   - Add `commandId` to `cancelledCommandIds`.
   - Include `cancelledCommandIds` in the JSON response of `/autoplan-status`.
3. Provide a helper method `isCommandCancelled(commandId: string): boolean`.
4. If an ACK arrives for a cancelled command, log a warning and discard without error.

### 3.2. Client-Side Pre-Submit Lease Check (`media/autoplan-dom-bridge.js`)
1. Maintain an internal `activeCommandId` and `activeCommandDeadline` in `DomBridgeClient`.
2. When receiving `cancelledCommands` list from `/autoplan-status`, populate a local set.
3. In `injectPromptAndSubmit` / `injectPrompt`:
   - Before executing step 4 (Submit triggering via button click or Enter key), check if `cmd.id` is in `cancelledCommands` or if elapsed time has exceeded `cmd.timeoutMs`.
   - If cancelled or expired, abort immediately with an explicit error code `COMMAND_ABORTED_BY_TIMEOUT`.
   - Do NOT click the submit button or dispatch Enter.
   - Send an ACK with status `aborted` or `cancelled`.

### 3.3. PromptDispatcher Coordination (`src/promptDispatcher.ts`)
1. Ensure explicit logging when Tier 1 times out, indicating that cancellation signal has been registered with BridgeServer.
2. In `dispatchTier1`, ensure error messages clearly distinguish between connection failure and submission cancellation.

---

## 4. Single Automated File-Based Test

Create `src/test/phase01_uncoordinated_fallback_abort.test.ts` to verify:
1. Start `BridgeServer` on a test port.
2. Enqueue a prompt command with a short timeout (e.g. 300ms).
3. Simulate client fetching the command, then stalling beyond 300ms.
4. Verify server marks command as timed out and adds it to cancelled commands list.
5. Verify `/autoplan-status` returns the cancelled command ID.
6. Verify client logic aborts submission and refuses to click/submit once the command ID is cancelled.
7. Clean up and terminate server.

---

## 5. Verification Protocol

Run only this single test for verification:
```bash
npx tsc && node out/test/phase01_uncoordinated_fallback_abort.test.js
```

After running this single test, stop immediately for user review. Once completed, output `done.`.
