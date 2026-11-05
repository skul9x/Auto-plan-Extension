# Phase 03: Settings Webview IPC Batching & DOM Pruning

Status: ✅ Completed  
Dependencies: Phase 02  

---

## 1. Objective
Eliminate IPC message queue congestion, layout thrashing, and renderer memory leaks in the Settings Webview panel by batching log messages at the Extension Host boundary and enforcing bounded DOM node retention.

---

## 2. Scope
- Remediate **PERF-002**: Implement message queue batching in `SettingsProvider` for log entries dispatched to the Webview, batch DOM element insertions in `settings.js`, and throttle auto-scroll layout recalculations using `requestAnimationFrame`.
- Remediate **PERF-005**: Enforce an upper bound on rendered DOM elements in the Settings log console (`logConsoleOutput`) to prevent unbounded renderer memory accumulation during extended sessions.

---

## 3. Requirements

### Functional Requirements
- **FR-01:** Log entries emitted by `DebugLogger` must be queued and dispatched to the Settings Webview in periodic batches (e.g. 50ms–100ms cadence) rather than triggering immediate individual `postMessage` calls per log event.
- **FR-02:** When the Webview receives a batch of log entries, it must append the corresponding DOM elements in a single layout operation (such as via `DocumentFragment`) rather than performing individual child appends.
- **FR-03:** Auto-scroll positioning (`scrollTop = scrollHeight`) must be synchronized with the browser rendering pipeline via `requestAnimationFrame`, preventing forced synchronous reflows on high-frequency log updates.
- **FR-04:** The number of child DOM elements in the Settings console log container (`logConsoleOutput`) must not exceed the maximum buffer capacity (`MAX_LOG_BUFFER_SIZE` = 1,000). Oldest child nodes must be pruned when this limit is reached.
- **FR-05:** Log filtering and count badges must continue to reflect the filtered log buffer accurately.

### Non-Functional Requirements
- **NFR-01 Memory Stability:** The Settings Webview memory footprint must remain bounded and stable over time, even during prolonged execution with tens of thousands of log events.
- **NFR-02 UI Responsiveness:** Log rendering must not cause visible UI jank or frame drops in the VS Code editor or Settings panel during rapid token streaming.

---

## 4. Constraints
- Preserve existing log entry data structures (`LogEntry`) and filter options (`all`, `error`, `warn`, `info`, `debug`).
- Ensure visual log display latency does not exceed 100ms during active streaming.
- Retain existing search and auto-scroll checkbox functionality in the Settings UI.

---

## 5. Dependencies
- `src/settingsProvider.ts`
- `media/settings/settings.js`

---

## 6. Acceptance Criteria
- [x] `SettingsProvider` dispatches batched log messages rather than 1:1 individual `postMessage` events.
- [x] `settings.js` handles batched incoming log messages and uses `requestAnimationFrame` for auto-scrolling.
- [x] `logConsoleOutput.childElementCount` never exceeds `MAX_LOG_BUFFER_SIZE` (1,000 items) when flooded with logs.
- [x] Exactly one file-based verification test executes and validates batching, message handling, and DOM element bounding.

---

## 7. Verification Test Specification
- **Test File:** `src/test/phase03_settings_webview_batching_and_memory_verification.test.ts`
- **Verification Target:**
  1. Verify `SettingsProvider` buffers rapid log bursts (e.g. 50 entries generated in 10ms) into batched messages.
  2. Verify that mock Webview message consumer receives batched arrays and processes them with single frame batching.
  3. Verify that generating 2,500 consecutive log entries in the webview console script results in exactly `MAX_LOG_BUFFER_SIZE` (1,000) DOM elements remaining in `logConsoleOutput`.
  4. Verify that log filtering and auto-scroll states function correctly with batched updates.

