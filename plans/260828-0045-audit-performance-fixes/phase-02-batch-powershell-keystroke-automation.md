# Phase 02: Single-Batch PowerShell Keystroke Automation
Status: ✅ Completed
Dependencies: phase-01-async-watcher-io-optimization.md

## Objective
Remediate **Critical Issue 2 (PowerShell Process Explosion when Sending Keystrokes)** in `src/keyboardManager.ts`. Consolidate the multi-step keystroke sequence (open new chat `^+l`, wait focus, select all `^a`, paste `^v`, and submit `{ENTER}`) into a single, unified batch execution script. This replaces 4–5 individual `powershell.exe` spawns per phase with 1 single process invocation, cutting execution latency and eliminating CPU spikes on Windows.

## Requirements
### Functional
- [x] **Unified Batch Keystroke Execution**:
  - Implement `executeBatchPromptFlow(promptText: string, options?: BatchPromptOptions): Promise<void>`.
  - Combine keystroke sequences into a single PowerShell/WScript script string containing built-in sleep delays:
    ```powershell
    $ws = New-Object -ComObject WScript.Shell;
    $ws.SendKeys('^+l');
    Start-Sleep -Milliseconds {focusDelay};
    $ws.SendKeys('^a');
    Start-Sleep -Milliseconds {selectDelay};
    $ws.SendKeys('^v');
    Start-Sleep -Milliseconds {pasteDelay};
    $ws.SendKeys('{ENTER}');
    ```
- [x] **In-Process Clipboard Priming**:
  - Write `promptText` to the clipboard via `vscode.env.clipboard.writeText(promptText)` before triggering the single-batch automation process.
  - Provide a fallback clipboard embedding (via base64 encoded text or `Set-Clipboard`) when running outside VS Code or if clipboard API fails.
- [x] **Batch Keystroke Custom Sender Hook**:
  - Extend `KeyboardManagerOptions` to support `customBatchSender?: (batchScript: string, actions: BatchAction[]) => Promise<void>` for deterministic unit and integration testing without spawning live OS processes.
- [x] **Backward-Compatible Granular Methods**:
  - Retain `openNewConversation()`, `selectAll()`, `paste()`, `submit()`, and `pasteAndSubmit()` for modular usage, while routing full-flow automation through the new batch engine.
- [x] **Configurable Timing & Delays**:
  - Ensure all timing parameters (`focusDelayMs`, `selectDelayMs`, `pasteDelayMs`, `submitDelayMs`) are respected and formatted cleanly into the batch script.

### Non-Functional
- [x] **Process Reduction**: Reduce OS process creation by 75% (from 4 processes per phase to 1).
- [x] **Prompt Latency**: Reduce total prompt submission startup time from 1500–3000ms down to 300–600ms.

## Files to Create/Modify
- `src/keyboardManager.ts` - Implement `executeBatchPromptFlow`, batch command builder, in-process clipboard priming, and batch mock sender hooks.
- `src/test/phase02_batch_keyboard.test.ts` - Comprehensive single test file for Phase 02.

## Test Criteria
- [x] Exactly one file-based test: `src/test/phase02_batch_keyboard.test.ts`.
- [x] Verifies batch script construction: validates exact command syntax, delay parameters, and SendKeys ordering in a single execution block.
- [x] Verifies process execution count: asserts that executing a full prompt flow triggers exactly 1 command invocation instead of 4 separate calls.
- [x] Verifies clipboard text synchronization prior to batch keystroke delivery.
- [x] Verifies error handling and graceful fallbacks when clipboard or process errors occur.

---
Next Phase: [phase-03-stream-chunking-listener-leak-prevention.md](file:///D:/skul9x/Auto-Plan_Extension/plans/260828-0045-audit-performance-fixes/phase-03-stream-chunking-listener-leak-prevention.md)
