# Phase 03: Direct Button Submission & Double-Tap Mechanics

Status: ✅ Completed
Dependencies: Phase 02  
Target Files:
- `media/autoplan-dom-bridge.js`
- `src/test/phase03_direct_submission_doubletap.test.ts`

---

## 1. Objective
Enhance prompt submission triggering in `media/autoplan-dom-bridge.js` by combining comprehensive mouse/pointer event cascades, Enter keyboard event dispatching, double-tap submission guards, form requestSubmit fallbacks, and structured execution telemetry in ACK payloads.

---

## 2. Requirements & Specification

### 2.1. Native Button Click & Pointer Event Cascade
When a send button is located via `findSendButton`:
1. Dispatch `PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })`.
2. Dispatch `MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })`.
3. Call `button.click()`.
4. Dispatch `PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 })`.
5. Dispatch `MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 })`.
6. Dispatch `MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })`.

### 2.2. Keyboard Enter Event Dispatching on Input
- Dispatch `KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })`.
- Dispatch `KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })`.

### 2.3. Double-Tap Submission Guard
- To accommodate asynchronous UI state transitions (e.g. React / Webview state enabling the send button after input events), introduce an asynchronous double-tap retry after 50ms (`await new Promise(r => setTimeout(r, 50))`) if the first click is dispatched while the button is disabled or state-transitioning.

### 2.4. Form Submission Fallback
- If button is inside an HTML `<form>`, execute `form.requestSubmit(btn)` or `form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`.

### 2.5. Detailed Diagnostics in ACK Payload
- Return `submitStrategy: 'buttonClick' | 'formSubmit' | 'enterKey'`, `sendButtonClicked: boolean`, `enterDispatched: boolean`, `buttonSelector: string | null`, `charsInjected: number`, and `steps: Array<any>` in the `/autoplan-ack` response.

---

## 3. Implementation Steps
1. Update `injectPromptAndSubmit` and `handleCommand` in `media/autoplan-dom-bridge.js`.
2. Implement exactly one comprehensive file-based test in `src/test/phase03_direct_submission_doubletap.test.ts`.
3. Compile TypeScript and execute the single test:
   ```powershell
   $env:PATH = "C:\Program Files\nodejs;" + $env:PATH
   npx tsc
   node out/test/phase03_direct_submission_doubletap.test.js
   ```
4. Verify 100% test pass rate.

---

## 4. Verification Test Criteria
- Exactly one test file: `src/test/phase03_direct_submission_doubletap.test.ts`.
- Validates full pointer and mouse event dispatching on target send button.
- Validates Enter key event dispatching.
- Validates double-tap submission triggering.
- Validates structured execution metadata returned in ACK payload.

---
Next Phase: [phase-04-dispatcher-bridge-coordination.md](./phase-04-dispatcher-bridge-coordination.md)
