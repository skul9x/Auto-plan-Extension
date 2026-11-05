# Phase 03: Clean Final-Only Delivery Mode & Typing State Lifecycle

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02  

---

## 1. Objective
Provide a noise-free Telegram user experience by adding a configurable `liveProgressMode` (`'final_only'` vs `'live_edit'`), defaulting to `'final_only'` where intermediate edit updates are replaced with a continuous Telegram typing indicator (`sendChatAction('typing')`), and only a single final Rich HTML summary is dispatched upon completion.

---

## 2. Scope
- Add configuration property `autoplan.telegram.liveProgressMode` with options `final_only` (default) and `live_edit`.
- Extend `ThrottledNotifier` to support `final_only` mode:
  - In `final_only` mode, intermediate `handleLogUpdate` events maintain an active typing indicator rather than creating/editing `🔄 Live Progress` text messages.
  - When a phase completes, fails, or stops, dispatch exactly one finalized message.
- Ensure that if `live_edit` is explicitly selected by the user, the single-message edit loop functions smoothly without duplication.
- Ensure clean lifecycle management for the typing indicator timer across phase transitions.

---

## 3. Requirements

### Functional Requirements
- **FR-01:** Add `autoplan.telegram.liveProgressMode` to `package.json` with enum `["final_only", "live_edit"]` and default `"final_only"`.
- **FR-02:** When `liveProgressMode === 'final_only'`:
  - Do not create or post `🔄 Live Progress` messages during phase execution.
  - While work is ongoing, periodically trigger Telegram `sendChatAction(chatId, 'typing')` (interval <= 4500ms, as Telegram typing indicators naturally expire after 5000ms).
  - Stop the typing indicator immediately when the phase finishes, fails, or stops.
  - Deliver a single comprehensive completion message formatted with Telegram Rich HTML upon phase completion.
- **FR-03:** When `liveProgressMode === 'live_edit'`:
  - Preserve the existing behavior of updating a single live status message via throttled `editMessageText` calls.
  - Ensure existing live progress containers are unpinned and finalized upon phase completion.
- **FR-04:** Setting reload: Changing `autoplan.telegram.liveProgressMode` dynamically reconfigures `ThrottledNotifier` without restarting the IDE.
- **FR-05:** Zero-drop fallback: If the final message fails entity formatting (Telegram 400), seamlessly fall back to plain-text delivery.

### Non-Functional Requirements
- **NFR-01 User Experience:** Completely eliminates distracting message edit notifications on mobile Telegram clients while maintaining clear visibility that the AI assistant is actively working.
- **NFR-02 Network & Quota Efficiency:** Greatly reduces the volume of Telegram Bot API calls from dozens of edits per phase down to periodic typing pings and one final delivery.

---

## 4. Constraints
- Must not interfere with `TelegramChatMirror` Q&A responses when interacting in free-chat mode.
- Must cleanly cancel typing intervals upon extension disposal or orchestrator stop.
- Must honor `allowedUsers` whitelist for all typing actions and final messages.

---

## 5. Dependencies
- `src/config.ts`
- `src/telegramNotifier.ts`
- `src/telegramBridge.ts`
- `package.json`

---

## 6. Acceptance Criteria
- [x] `getConfig().telegramLiveProgressMode` defaults to `'final_only'`.
- [x] In `final_only` mode, no `🔄 Live Progress` text messages are dispatched to Telegram during log streaming.
- [x] In `final_only` mode, `bot.api.sendChatAction(chatId, 'typing')` is triggered during active processing.
- [x] Exactly one final completion message is sent when the phase completes.
- [x] Switching to `live_edit` restores single-message live editing.
- [x] Exactly one file-based verification test executes and passes all test assertions.

---

## 7. Verification Test Specification
- **Test File:** `src/test/phase03_clean_final_only_delivery.test.ts`
- **Test Requirements:**
  1. Test configuration resolution for `autoplan.telegram.liveProgressMode`.
  2. Verify that in `final_only` mode, streaming 20 log updates produces 0 `sendMessage` calls and produces periodic `sendChatAction('typing')` calls.
  3. Verify that on `handlePhaseComplete`, typing is stopped and exactly one completion message is sent.
  4. Verify that in `live_edit` mode, streaming log updates creates exactly one live message and edits it with throttled intervals.
  5. Verify dynamic mode toggling updates notifier behavior without requiring instance recreation.

