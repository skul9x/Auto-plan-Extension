# Phase 03: Renderer DOM Diagnostic Engine & Error Recording

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02  
Target Files:
- `media/autoplan-dom-bridge.js`
- `src/workbenchInjector.ts`
- `src/test/phase03_renderer_dom_diagnostics.test.ts`

---

## Objective
Upgrade the Electron Renderer DOM script (`media/autoplan-dom-bridge.js`) to eliminate silent error swallowing, fix `queryDeep()` container isolation bugs, implement a deep DOM inspection and diagnostic snapshot engine, and stream real-time client telemetry to the BridgeServer.

## Requirements

### Functional Requirements
1. **Remove Silent Error Swallowing**:
   - Replace all bare `catch (_) {}` blocks throughout `autoplan-dom-bridge.js` with structured warning/error logs.
   - Emit prefixed console logs (`[Auto-Plan DOM Bridge]`) to the Electron DevTools console so developers can inspect issues directly in DevTools.
   - Route caught exceptions to the client logging buffer and remote logger.
2. **Fix `queryDeep()` Isolation & Fallback**:
   - Traverse shadow roots and child iframes safely without throwing exceptions on cross-origin boundaries.
   - If scoped container searching (e.g. within `.interactive-session` or `.chat-input-container`) produces 0 matches, ALWAYS fall back to searching the full document tree and document shadow roots.
3. **Deep DOM Diagnostic Snapshot Engine**:
   - When `findChatInput(doc)` fails to locate an active input element:
     - Record all evaluated selector queries and their individual match counts (`{ selector: string, matches: number }`).
     - Capture a structured `DomDiagnosticSnapshot`:
       ```javascript
       {
         timestamp: Date.now(),
         activeElement: { tagName: string, className: string, id: string, isContentEditable: boolean },
         textareas: Array<{ className: string, placeholder: string, visible: boolean, disabled: boolean, rect: { width: number, height: number } }>,
         contentEditables: Array<{ tagName: string, className: string, role: string, rect: { width: number, height: number } }>,
         shadowRootsCount: number,
         iframes: Array<{ id: string, src: string, className: string, isAccessible: boolean }>,
         evaluatedSelectors: Array<{ selector: string, matches: number }>
       }
       ```
     - Attach this snapshot to the ACK error payload and client log message so the Extension Host and AI can immediately determine the exact state of the DOM.
   - When `findSendButton()` fails:
     - Capture evaluated submit button selectors and list nearby button elements within the chat container (aria-labels, titles, codicons, visibility).
4. **Step-by-Step Prompt Injection Diagnostics**:
   - In `injectPromptAndSubmit()`, record step-by-step progress:
     - Step 1: Input discovery & focus (`inputElem.focus()`)
     - Step 2: Content injection (`execCommand` vs `textarea-value` vs `contenteditable-text`)
     - Step 3: Event dispatching (`beforeinput`, `input`, `change`)
     - Step 4: Submit triggering (Enter keydown/keyup events + submit button click)
   - Return structured injection diagnostic report in the command acknowledgment payload.
5. **Startup Telemetry & Early Log Queue**:
   - Implement `sendClientLog(level, message, details)` inside `DomBridgeClient`.
   - Maintain an in-memory client log queue (capacity 50) before port discovery completes, and automatically flush queued startup logs via `POST /autoplan-log` once the BridgeServer connection is established.
   - Log client version, Electron window location URL, document title, and port probing attempts.
6. **Synchronize Workbench Injector**:
   - Ensure `src/workbenchInjector.ts` copies the updated diagnostic-enabled script into `workbench.html` directory during installation and update operations.

### Non-Functional Requirements
- Minimal DOM traversal overhead (< 15ms per search).
- Absolute exception safety avoiding any renderer frame drops, UI freezes, or editor crashes.

## Files to Create / Modify
- `media/autoplan-dom-bridge.js` - Diagnostic snapshot engine, selector fallback fixes, and remote log dispatcher.
- `src/workbenchInjector.ts` - Ensure script updates and bundle distribution.

## Verification Test
- **Single Test**: `src/test/phase03_renderer_dom_diagnostics.test.ts`
- **Validation Scope**:
  - Verify `queryDeep` traverses shadow roots, handles iframes gracefully, and falls back to full DOM if scoped containers miss.
  - Verify `findChatInput` captures detailed `DomDiagnosticSnapshot` when no element matches.
  - Verify `findSendButton` captures nearby button state on failure.
  - Verify `injectPromptAndSubmit` reports step-by-step execution details and strategy.
  - Verify `DomBridgeClient` queues early startup logs and flushes them to `POST /autoplan-log`.
