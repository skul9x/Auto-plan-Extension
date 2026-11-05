# Phase 02: Single-Leader Delivery Gating & Standby Muting

Status: ✅ Completed  
Dependencies: Phase 01  

---

## 1. Objective
Eliminate duplicate Telegram messages (specifically the duplicate `🔄 Live Progress` message containers) by enforcing strict Single-Leader delivery gating across `ThrottledNotifier` and outbound Telegram dispatchers, cleanly muting all non-leader (Standby) IDE instances.

---

## 2. Scope
- Connect `TelegramBridge` leadership status (`isLeader`) to `ThrottledNotifier` and outbound dispatch channels.
- Guard `ThrottledNotifier.flushThrottleBuffer()`, `broadcastMessage()`, `sendInfo()`, and `safeSendMessage()` so that non-leader instances discard or skip outgoing Telegram Bot API calls.
- Ensure leader transition seamlessly activates Telegram delivery when a standby instance becomes leader.
- Prevent standby instances from creating or mutating `liveMessageIds` on Telegram.

---

## 3. Requirements

### Functional Requirements
- **FR-01:** `ThrottledNotifier` must maintain awareness of leadership state via a provider function or direct property (`isLeaderFn: () => boolean` or `setLeader(boolean)`).
- **FR-02:** When an instance is in standby (`isLeader === false`), any invocation of `flushThrottleBuffer`, `safeSendMessage`, `safeEditMessage`, `broadcastMessage`, or `sendApprovalNotification` must be safely suppressed without throwing errors.
- **FR-03:** When an instance is the active leader (`isLeader === true`), all notifications, live status updates, and approval requests must proceed normally.
- **FR-04:** Leadership takeover: When a standby instance successfully promotes to leader via `tryAcquireLeadership()`, its notifier must immediately un-mute and resume full Telegram delivery capabilities.
- **FR-05:** Leadership release / demotion: When an instance stops or relinquishes leadership, it must immediately mute outgoing Telegram deliveries and clear pending throttle timers.

### Non-Functional Requirements
- **NFR-01 Concurrency Safety:** Zero race conditions when multiple IDE windows share the same Telegram bot token and chat whitelist.
- **NFR-02 Zero Telegram 429 Collisions:** Eliminating duplicate requests across windows prevents hitting Telegram rate limits (1 message/sec per chat).

---

## 4. Constraints
- Must utilize the existing port registry file mechanism (`ag-autoplan-ports.json`) for leader coordination.
- Must not block local IDE functionalities (sidebar logs, local status bars, auto-submit evaluation) when Telegram delivery is muted on a standby window.
- Must preserve allowed user authorization checks before delivering messages.

---

## 5. Dependencies
- `src/telegramBridge.ts`
- `src/telegramNotifier.ts`
- `src/telegramChatMirror.ts`

---

## 6. Acceptance Criteria
- [x] `ThrottledNotifier` skips message creation and editing when `isLeader` is false.
- [x] `liveMessageIds` map remains empty on standby instances.
- [x] Simulated secondary window with matching bot token and chat IDs does not emit `sendMessage` or `editMessageText` calls.
- [x] Primary leader window creates exactly one live message per target chat.
- [x] Exactly one file-based verification test executes and passes all test assertions.

---

## 7. Verification Test Specification
- **Test File:** `src/test/phase02_single_leader_delivery_gating.test.ts`
- **Test Requirements:**
  1. Initialize two `ThrottledNotifier` instances representing Window 1 (Leader) and Window 2 (Standby) connected to mock Telegram bot.
  2. Verify that log updates and phase events on Window 2 (Standby) do not invoke `bot.api.sendMessage` or `bot.api.editMessageText`.
  3. Verify that log updates on Window 1 (Leader) invoke `bot.api.sendMessage` exactly once and subsequent updates invoke `bot.api.editMessageText`.
  4. Simulate leadership transfer from Window 1 to Window 2; verify Window 1 stops sending and Window 2 successfully acquires delivery rights.
  5. Verify broadcast and approval messages adhere to the same single-leader gating rule.

