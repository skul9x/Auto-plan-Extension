# Phase 02: Event Loop Unblocking & Non-Blocking I/O

Status: ✅ Completed  
Dependencies: Phase 01  

---

## 1. Objective
Eliminate event-loop blocking synchronous filesystem operations and subprocess invocations from the Extension Host, ensuring file I/O and process execution do not degrade editor responsiveness or frame rates.

---

## 2. Scope
- Remediate **PERF-001**: Replace synchronous disk I/O in multi-window port registry heartbeat and reading with non-blocking asynchronous operations, safe atomic write patterns with transient lock retry handling on Windows (`EPERM`), and in-memory caching for workspace count detection.
- Remediate **PERF-004**: Ensure editor focus change detection uses asynchronous plan folder scanning (`findActivePlanFolderAsync`) instead of synchronous `scanPlanFolder`.
- Remediate **PERF-007**: Replace synchronous child process spawning (`execSync`) in clipboard utilities and eliminate runtime Roslyn C# compilation (`Add-Type`) in active window inspection.

---

## 3. Requirements

### Functional Requirements
- **FR-01:** Multi-window registry file writing must be performed asynchronously and atomically without blocking the V8 event loop during periodic heartbeats.
- **FR-02:** Multi-window registry reading must be non-blocking and resilient to transient Windows file locks (`EPERM` / `EBUSY`), retrying with backoff if access is temporarily contested.
- **FR-03:** Multi-workspace registration checks in `TelegramChatMirror` must utilize cached workspace state rather than synchronously reading and parsing `ag-autoplan-ports.json` on every model message.
- **FR-04:** Active plan folder detection triggered during editor focus or tab switching must execute asynchronously, preventing synchronous directory walks on markdown files.
- **FR-05:** Clipboard reading and writing operations across Linux, macOS, and Windows must use asynchronous process execution rather than synchronous execution (`execSync`).
- **FR-06:** Foreground window inspection must avoid on-the-fly C# compilation via PowerShell `Add-Type`, relying instead on native VS Code window focus properties or non-compiling process inspection commands.

### Non-Functional Requirements
- **NFR-01 Performance:** Event loop execution delays caused by registry heartbeats and folder scanning must be less than 5ms under regular operating conditions.
- **NFR-02 Concurrency Safety:** Multi-window port registry writes must remain crash-consistent and prevent zero-byte corruptions across concurrent IDE instances.
- **NFR-03 Cross-Platform Compatibility:** Asynchronous execution must function identically on Windows, Linux, and macOS.

---

## 4. Constraints
- Preserve port registry JSON schema structure in `ag-autoplan-ports.json`.
- Preserve existing leadership election semantics across multiple open IDE windows.
- Maintain existing plan folder structure and markdown file discovery rules.

---

## 5. Dependencies
- `src/telegramBridge.ts`
- `src/telegramChatMirror.ts`
- `src/planScanner.ts`
- `src/extension.ts`
- `src/keyboardManager.ts`

---

## 6. Acceptance Criteria
- [x] No `fs.writeFileSync` or `fs.readFileSync` calls are executed during background heartbeat cycles or chat mirror message formatting.
- [x] Active editor change listeners call `findActivePlanFolderAsync` instead of synchronous `findActivePlanFolder`.
- [x] Clipboard operations (`copyToClipboard`, `readClipboard`) do not invoke `execSync`.
- [x] Windows active window check executes without dynamic `Add-Type` C# source compilation.
- [x] Exactly one file-based verification test executes and validates the non-blocking behavior of registry I/O, plan scanning, and process execution.

---

## 7. Verification Test Specification
- **Test File:** `src/test/phase02_event_loop_and_async_io_verification.test.ts`
- **Verification Target:**
  1. Verify multi-window registry read/write operations complete asynchronously without blocking the event loop (measured via timer drift / microtask latency < 10ms).
  2. Verify atomic write resilience when handling simulated transient file locks.
  3. Verify `TelegramChatMirror.isMultiWorkspaceRegistered()` uses cached state during repeated invocations without repeated disk reads.
  4. Verify plan folder scanning executes asynchronously via `findActivePlanFolderAsync`.
  5. Verify clipboard helper and active window detection execute asynchronously without invoking `execSync` or compiling dynamic C# types.

