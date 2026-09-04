# Phase 01: New Conversation Transition & DOM Handshake

Status: ✅ Completed  
Target Issue: Eliminating race conditions and blind 100ms delays in `openNewConversation`  
Test File: `src/test/phase01_new_conversation_handshake.test.ts`

---

## 1. Objective

Replace the blind `setTimeout(100)` in `promptDispatcher.ts` and the fire-and-forget click in `triggerNewConversation` with a deterministic, state-aware DOM handshake based on empirical snapshots `body.txt`, `body1.txt`, and `body3.txt`. Also enrich VS Code command candidates with `workbench.action.chat.newChat`.

---

## 2. Requirements

### Functional Requirements
1. **Pre-check for Existing Empty Conversation**:
   - Locate `a[data-tooltip-id="new-conversation-tooltip"]` using `findNewConversationButton`.
   - If the element contains class `cursor-not-allowed` (as observed in `body.txt` and `body3.txt`), the chat panel is already on a blank/new conversation.
   - Do NOT click the button (clicking a disabled element is either a no-op or causes UI glitch). Return `{ success: true, alreadyNew: true }` immediately.
2. **Deterministic Click & Handshake Polling**:
   - If `newBtn` contains `cursor-pointer` (as observed in `body1.txt` and `body2.txt`), trigger the click cascade (`dispatchButtonClickCascade` and `newBtn.click()`).
   - Poll until all 3 readiness conditions are satisfied or timeout (default 3000ms):
     a) `newBtn` acquires `cursor-not-allowed`.
     b) The message input editor (`div[data-lexical-editor="true"]`) is empty or contains only whitespace / `<br>`.
     c) The send button (`button[data-testid="send-button"]`) is present and disabled (`disabled=""` or `cursor-not-allowed`).
3. **Command Candidate Enhancement & Dispatcher Awaiting Handshake**:
   - In `src/promptDispatcher.ts`, update `openNewConversation` command candidates to include standard VS Code `workbench.action.chat.newChat` alongside `antigravity.prioritized.chat.openNewConversation`.
   - Eliminate `await new Promise((r) => setTimeout(r, 100))` (line 490).
   - Await the completion result from `this.bridgeServer.dispatchPromptCommand('', { type: 'openNewConversation', ... })`.
   - Ensure `openedViaCommand` also triggers a fast readiness check on the DOM to guarantee input availability before prompt injection.

---

## 3. Implementation Steps

1. **Update `triggerNewConversation` in `media/autoplan-dom-bridge.js`**:
   - Check if `newBtn` is currently disabled via `newBtn.classList.contains('cursor-not-allowed')`. If true, log and return `true` immediately.
   - If enabled, click and enter a polling loop (interval 50ms, max 3000ms) waiting for the reset transition.
   - Return `{ success: true, durationMs }` or throw with descriptive error if timed out.
2. **Update `promptDispatcher.ts`**:
   - Add `workbench.action.chat.newChat` to command executor attempts.
   - Remove line 490: `await new Promise((r) => setTimeout(r, 100));`.
   - Check the response of `dispatchPromptCommand` for `openNewConversation` and ensure no prompt dispatch occurs until the bridge acknowledges the handshake.
3. **Create Unit Test**:
   - Implement `src/test/phase01_new_conversation_handshake.test.ts` to simulate both already-new and transition states using JSDOM.

---

## 4. Files to Modify

- `media/autoplan-dom-bridge.js`: Enhance `triggerNewConversation` with pre-check and handshake polling.
- `src/promptDispatcher.ts`: Add `workbench.action.chat.newChat`, remove hardcoded 100ms delay, and await handshake completion.

---

## 5. Verification Test

- **Test File**: `src/test/phase01_new_conversation_handshake.test.ts`
- **Command**: `npx mocha -r ts-node/register src/test/phase01_new_conversation_handshake.test.ts`
- **Scope**:
  - Validates `triggerNewConversation` returns immediately without click when `cursor-not-allowed` is present.
  - Validates `triggerNewConversation` clicks and waits for transition when `cursor-pointer` is present.
  - Validates `promptDispatcher.ts` does not execute static sleep, executes `workbench.action.chat.newChat` as a candidate, and properly propagates handshake status.
