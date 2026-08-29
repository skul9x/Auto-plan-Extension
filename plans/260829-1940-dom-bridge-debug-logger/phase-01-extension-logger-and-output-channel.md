# Phase 01: Extension Logger Subsystem & Output Channel

Status: ✅ Completed  
Dependencies: None  
Target Files:
- `src/debugLogger.ts`
- `src/config.ts`
- `src/test/phase01_debug_logger_subsystem.test.ts`

---

## Objective
Design and implement the core `DebugLogger` subsystem in the Extension Host (`src/debugLogger.ts`) to provide structured in-memory ring-buffer logging, dedicated VS Code Log Output Channel streaming, formatted diagnostic report compilation, and persistent file export.

## Requirements

### Functional Requirements
1. **Structured Data Models & Log Levels**:
   - Define type `LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'`.
   - Define type `LogComponent = 'SERVER' | 'CLIENT' | 'DISPATCHER' | 'INJECTOR' | 'DOM' | 'ORCHESTRATOR' | 'SETTINGS'`.
   - Define interface `LogEntry`:
     ```typescript
     export interface LogEntry {
       id: string;
       timestamp: number;
       isoTime: string;
       level: LogLevel;
       component: LogComponent;
       message: string;
       details?: any;
       error?: string;
     }
     ```
2. **In-Memory Ring Buffer**:
   - Maintain a bounded FIFO ring buffer (configurable capacity, default 500 entries) to prevent unbounded memory growth while retaining recent execution history.
   - Support `log(level, component, message, details?, error?)`, `debug()`, `info()`, `warn()`, `error()`, `getEntries()`, `getRecentEntries(count)`, and `clear()`.
   - Provide subscription mechanism `onLog((entry: LogEntry) => void)` for real-time webview and event streaming.
3. **VS Code Log Output Channel**:
   - Lazily instantiate and manage a dedicated output channel named `'Auto-Plan DOM Bridge'`.
   - Use `vscode.window.createOutputChannel('Auto-Plan DOM Bridge', { log: true })` if supported by the VS Code environment, falling back safely to standard `createOutputChannel('Auto-Plan DOM Bridge')`.
   - Format entries: `[YYYY-MM-DDTHH:mm:ss.sssZ] [LEVEL] [COMPONENT] Message {details}`.
   - Implement `showOutputChannel(preserveFocus?: boolean)` to reveal the channel on demand.
4. **Environment & System Diagnostic Formatter**:
   - Implement `buildEnvironmentReport()` capturing:
     - OS Platform, Arch, and Release (`process.platform`, `process.arch`, `os.release()`).
     - Node.js & Electron runtime versions (`process.versions.node`, `process.versions.electron`).
     - VS Code / Antigravity app details (`vscode.version`, `vscode.env.appName`, `vscode.env.appRoot`).
     - DOM Bridge installation state (`isBridgeInstalled()`, workbench.html path, backup presence).
     - Server binding state (active port, connected clients, active window key).
     - Execution configuration snapshot (mode, fallback enabled, timeout).
5. **Report Serialization & Export**:
   - Implement `exportDiagnosticReportToString()` to generate a clean, markdown-formatted report containing:
     - Header & Environment metadata table
     - Component health status checklist
     - Recent log traces (last N entries formatted)
   - Implement `exportLogToFile(targetFilePath: string): Promise<string>` to write the report directly to disk.
   - Implement prompt truncation / sanitization to keep logs compact and protect sensitive user code.

### Non-Functional Requirements
- Safe execution in standalone unit test environments where `vscode` runtime APIs may be partially initialized or mocked.
- Zero CPU / memory overhead when logging is idle.

## Files to Create / Modify
- `src/debugLogger.ts` - Core DebugLogger subsystem implementation and singleton `debugLogger`.
- `src/config.ts` - Add debug logging configuration options (`enableVerboseBridgeLogs`, `maxLogEntries`, `autoOpenBridgeLogOnError`).

## Verification Test
- **Single Test**: `src/test/phase01_debug_logger_subsystem.test.ts`
- **Validation Scope**:
  - Verify log entry creation across all levels (`DEBUG`, `INFO`, `WARN`, `ERROR`) and component tags.
  - Verify ring buffer capacity eviction behavior when exceeding max entries.
  - Verify `buildEnvironmentReport()` gathers OS, runtime, and workbench metadata.
  - Verify `exportDiagnosticReportToString()` produces clean, markdown-formatted diagnostic output.
  - Verify `exportLogToFile()` writes reports to disk with proper directory creation.
  - Verify Output Channel creation, formatted line appending, and reveal behavior without errors in test environments.
