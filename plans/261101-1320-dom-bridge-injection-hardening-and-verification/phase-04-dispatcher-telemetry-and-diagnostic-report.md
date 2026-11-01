# Phase 04: Dispatcher Telemetry, Diagnostic Report Integration & Error Attribution

Status: ✅ Completed
Test: `src/test/phase04_dispatcher_telemetry_diagnostic_report.test.ts`

## Objective
Wire the new DOM Bridge verification metadata (`charsExpected`, `charsDetectedInDOM`, `domExcerpt`, `elementContext`) through `BridgeServer` into `PromptDispatcher` and `DebugLogger`, upgrading diagnostic reports and providing actionable error attribution when prompt injection fails.

## Scope
- Update `src/bridgeServer.ts` and `src/promptDispatcher.ts` to consume and propagate the new Step 1 and Step 2 telemetry payloads.
- Update `src/debugLogger.ts` to surface paste verification status, character counts, and element context in diagnostic reports.
- Implement user-facing actionable error notifications when paste verification fails (e.g. "Auto-Plan: Khung chat Antigravity đang đóng hoặc không nhận prompt. Vui lòng mở panel Agent và thử lại.").
- Update `captureDomDiagnosticSnapshot` to summarize nearby input elements and their visibility.

## Requirements
1. **Bridge Server & Dispatcher Telemetry Propagation**:
   - Parse `ack.metadata.steps` to extract Step 1 (`elementContext`) and Step 2 (`charsExpected`, `charsDetectedInDOM`, `domExcerpt`).
   - Log structured dispatcher message:
     ```
     [INFO] [DISPATCHER] Prompt paste verified: 3321/3321 chars in '#antigravity.agentSidePanelInputBox' (strategy=contenteditable-text)
     ```
   - In case of failure (`PASTE_VERIFICATION_FAILED` or `NO_CHAT_INPUT_FOUND`), log clear actionable warning with full target diagnostics.
2. **Actionable Notification Attribution**:
   - When `PASTE_VERIFICATION_FAILED` or `NO_CHAT_INPUT_FOUND` occurs:
     - Show VS Code notification with an actionable button: "Open Chat Panel".
     - Clicking the button executes `workbench.action.chat.open` or `antigravity.prioritized.chat.open`.
3. **Debug Logger & Diagnostic Report Enhancement**:
   - In `generateDiagnosticReport()` (or equivalent diagnostics formatter in `debugLogger.ts`):
     - Add a section in Component Health:
       - **DOM Bridge Injection Health**: ✅ Verified (Last prompt: $N$ chars injected, buffer matched) / ❌ Failed (Buffer was empty).
       - **Target Element Container**: `#antigravity.agentSidePanelInputBox` (Verified in Chat Panel).
4. **Graceful Fallback Handling**:
   - If Tier 1 fails with `PASTE_VERIFICATION_FAILED` and `allowTierFallback: true`, ensure the dispatcher does not falsely report Tier 1 success, but cleanly transitions to Tier 2 / Tier 3 or reports failure per configuration.

## Constraints
- Do not bloat log files; truncate `domExcerpt` to max 60 characters and sanitize any sensitive tokens in prompt excerpts.
- Maintain compatibility with existing diagnostic report parsers and webview consumers.

## Dependencies
- Source files: `src/promptDispatcher.ts`, `src/bridgeServer.ts`, `src/debugLogger.ts`.
- Test harness: `src/test/phase04_dispatcher_telemetry_diagnostic_report.test.ts`.

## Acceptance Criteria
- Extension host logs explicitly show `charsExpected` vs `charsDetectedInDOM`.
- Diagnostic report displays the last injection verification state and target container.
- If paste fails, user receives an actionable error alert to open/focus the chat panel.

## Comprehensive File-Based Test
- **File**: `src/test/phase04_dispatcher_telemetry_diagnostic_report.test.ts`
- **Scope**:
  - Tests dispatcher handling of client ACK containing Step 2 verification metadata.
  - Tests diagnostic report output generation with hardened injection telemetry.
  - Verifies actionable notification triggers on `PASTE_VERIFICATION_FAILED`.

