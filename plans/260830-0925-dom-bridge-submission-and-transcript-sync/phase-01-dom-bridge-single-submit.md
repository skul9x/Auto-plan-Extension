# Phase 01: DOM Bridge Mutually Exclusive Single-Submit Engine (`media/autoplan-dom-bridge.js`)

Status: ✅ Completed  
Dependencies: None  
Target Files:
- `media/autoplan-dom-bridge.js`
- `src/test/phase01_dom_bridge_single_submit.test.ts`

---

## 1. Objective

Refactor the prompt submission pipeline in `media/autoplan-dom-bridge.js` to enforce strict mutual exclusivity across submission mechanisms (Send Button Click vs. Keyboard Enter vs. Form RequestSubmit). Ensure that when a valid, clickable Send button is identified, no synthetic Keyboard Enter events are dispatched into the DOM, eliminating duplicate/triple message triggers and ghost conversation directories in Electron/VS Code. Implement a single automated test in `src/test/phase01_dom_bridge_single_submit.test.ts`.

---

## 2. Detailed Technical Requirements

### 2.1. Submission Pipeline Refactoring (`media/autoplan-dom-bridge.js`)
- **Mutually Exclusive Triggering Strategy**:
  1. **Primary Strategy (`buttonClick`)**: If `sendBtn` is found and is clickable / ready, execute `dispatchButtonClickCascade(sendBtn, win)` and record `submitStrategy = 'buttonClick'`. Under this branch, **DO NOT** dispatch `keydown`, `keypress`, or `keyup` Enter events.
  2. **Fallback Strategy (`enterKey`)**: If `sendBtn` is NOT present or disabled and cannot be clicked, dispatch the `KeyboardEvent('Enter')` cascade (`keydown`, `keypress`, `keyup`) on `inputElem` and record `submitStrategy = 'enterKey'`.
  3. **Form Fallback Strategy (`formSubmit`)**: If neither `sendBtn` nor Enter key submission succeeds, attempt `form.requestSubmit()`.
- **Debounce & Concurrency Guard**:
  - Add an in-memory submission mutex / lock in `DomBridgeClient` preventing overlapping `injectPrompt` / submit operations within 500ms unless explicitly flagged.
  - Retain double-tap retry logic only when explicitly passed in options (`options.doubleTap === true`) or when the initial button was in a transitionally disabled state and required a delayed second tap.
- **Accurate Telemetry Payload**:
  - Return diagnostic metadata clearly reporting `submitStrategy`, `enterDispatched` (boolean), `sendButtonClicked` (boolean), `doubleTapExecuted` (boolean), and `formSubmitted` (boolean). Ensure `sendButtonClicked === true` strictly implies `enterDispatched === false` for primary button submissions.

### 2.2. Automated File-Based Test (`src/test/phase01_dom_bridge_single_submit.test.ts`)
- **Single Test Suite Requirements**: Exactly one comprehensive file-based test verifying:
  1. When a mock DOM container contains an active `inputElem` and a clickable `sendBtn`:
     - Calling submission results in `sendButtonClicked: true`, `enterDispatched: false`, `submitStrategy: 'buttonClick'`.
     - Event listener spy confirms `button.click` / mouse events were fired, while zero `keydown` Enter events were dispatched.
  2. When no `sendBtn` is present in the DOM:
     - Submission automatically falls back to `enterKey` strategy (`enterDispatched: true`, `sendButtonClicked: false`, `submitStrategy: 'enterKey'`).
     - Event listener spy confirms Enter `keydown`, `keypress`, and `keyup` were dispatched to `inputElem`.
  3. When an action is rapidly triggered twice:
     - Mutex lock protects against concurrent submission overlap.
  4. Verified via JSDOM / Node.js test runner:
     ```bash
     npx tsc; node out/test/phase01_dom_bridge_single_submit.test.js
     ```

---

## 3. Implementation Steps

1. Modify `media/autoplan-dom-bridge.js` to isolate `sendBtn` clicking from `inputElem` Enter key dispatching.
2. Ensure `submitStrategy` is strictly single-path with updated diagnostic reporting.
3. Create `src/test/phase01_dom_bridge_single_submit.test.ts`.
4. Compile TypeScript and execute the single verification test:
   ```bash
   npx tsc; node out/test/phase01_dom_bridge_single_submit.test.js
   ```
5. Verify 100% test pass rate.

---

## 4. Verification Plan

### Automated Test
```bash
npx tsc; node out/test/phase01_dom_bridge_single_submit.test.js
```

### Manual Verification
- Inspect returned ACK metadata payload from `DomBridgeClient` to ensure `enterDispatched: false` when `sendButtonClicked: true`.

---
Next Phase: [phase-02-transcript-multi-conversation-sync.md](./phase-02-transcript-multi-conversation-sync.md)
