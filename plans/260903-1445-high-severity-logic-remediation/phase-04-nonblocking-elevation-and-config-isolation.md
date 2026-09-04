# Phase 04: Non-Blocking Elevation & Config Storage Isolation (LOGIC-007 Remediation)

Status: ✅ Completed  
Dependencies: Phase 01, Phase 02, Phase 03  
Target Files:
- `src/workbenchInjector.ts`
- `src/config.ts`
- `src/extension.ts`
- `src/settingsProvider.ts`
- `src/test/phase04_nonblocking_elevation_and_config_isolation.test.ts`

---

## 1. Objective

Prevent Extension Host event loop freezing and eliminate elevation dialog flooding. Refactor privilege elevation from blocking synchronous calls (`execSync`) to non-blocking asynchronous operations with concurrency deduplication. Isolate configuration sidecar storage so that setting changes never trigger OS root elevation dialogs (`pkexec`, UAC, `osascript administrator privileges`).

---

## 2. Root Cause Analysis (LOGIC-007)

1. **Blocking Synchronous Elevation**:
   `writeFileElevated()` in `src/workbenchInjector.ts` executes `execSync(cmd, { timeout: 30000 })`. When an OS modal authentication dialog appears (`pkexec` on Linux, UAC on Windows, AppleScript admin prompt on macOS), the Node.js event loop inside the Extension Host is completely blocked for up to 30 seconds. VS Code becomes unresponsive: editor typing lags, language servers halt, and status bar updates freeze.
2. **Config File In System-Owned Directory**:
   `writeConfigJson()` in `src/config.ts` attempts to write `ag-autoplan-config.json` inside the directory containing `workbench.html` (`/usr/share/code/...`). On Linux and macOS systems, this directory requires root permissions. Writing there throws `EACCES`, forcing `writeFileElevated` to run.
3. **Elevation Flooding on Settings Save**:
   In `src/settingsProvider.ts`, `saveSettings` iterates over ~15 settings keys and sequentially updates `vscode.workspace.getConfiguration('autoplan')`. Each key update immediately triggers `vscode.workspace.onDidChangeConfiguration` in `src/extension.ts`, which calls `writeConfigJson()`. Consequently, saving settings launches up to 15 sequential `pkexec` dialogs, flooding the user with password prompts.
4. **Startup Auto-Elevation**:
   On extension activation in `src/extension.ts`, `isBridgeInstalled()` is checked and `installBridgeScript({ updateChecksums: true })` is executed synchronously if not installed, triggering root password prompts immediately when the IDE opens.

---

## 3. Technical Requirements

### 3.1. Config Storage Isolation & Backward Compatibility (`src/config.ts`)
1. Never invoke root elevation (`writeFileElevated` / `execSync`) to write configuration data.
2. Implement safe, non-elevated storage resolution:
   - If `targetDir` is provided (e.g. In unit tests): attempt `fs.writeFileSync(configPath, content, 'utf8')`. If writable, return `configPath`.
   - If writing throws `EACCES` or `EPERM` (e.g. system directory `/usr/share/code/...`), catch it, DO NOT call `writeFileElevated`, and fall back to user-writable storage directory:
     `getUserConfigStorageDir()`: `path.join(os.homedir(), '.gemini', 'antigravity-ide')` or `context.globalStorageUri.fsPath`.
   - If `targetDir` is not provided: check user storage directory first, or attempt writing to workbench directory ONLY if non-elevated permissions exist; fall back cleanly to user storage directory.
   - Return the active config file path or `null` if directory creation fails.
3. Guarantee that DOM Bridge communication is not dependent on sidecar disk sync, as the HTTP REST bridge server handles live parameters dynamically.

### 3.2. Asynchronous Non-Blocking Elevation & Mutex (`src/workbenchInjector.ts`)
1. Provide `writeFileElevatedAsync(filePath: string, content: string): Promise<void>`:
   - Use `child_process.exec` (asynchronous) instead of `execSync`.
   - Implement an elevation mutex / single-flight lock (`isElevationInProgress`):
     - If an elevation prompt is already pending, queue subsequent requests or fail fast with `ElevationLockedError: An elevation prompt is already active. Please respond to the existing modal dialog.`
   - Guarantee temporary files are cleanly unlinked in both success and error branches.
2. Retain synchronous `writeFileElevated` for backward compatibility with existing tests that write to mock temporary files, but ensure it throws clean errors instead of freezing if elevation is denied.
3. Provide async variants: `installBridgeScriptAsync(options?: InjectorOptions): Promise<InjectionResult>` and `uninstallBridgeScriptAsync(options?: InjectorOptions): Promise<UninstallationResult>`.

### 3.3. Debouncing Configuration Updates (`src/extension.ts`)
1. In `vscode.workspace.onDidChangeConfiguration`:
   - Debounce config change handling by 300ms using a timer (`configDebounceTimer`).
   - Coalesce multiple consecutive setting key updates (such as saving 15 settings in the webview) into exactly one execution of `writeConfigJson()` and UI status refreshes.

### 3.4. Safe Settings Persistence (`src/settingsProvider.ts`)
1. In `saveSettings` message handler:
   - Persist settings via `configSection.update(key, settings[key], vscode.ConfigurationTarget.Global)`.
   - Rely on the debounced `onDidChangeConfiguration` handler (or a single post-loop call to `writeConfigJson(settings)`) so that multiple redundant write cycles are avoided.

### 3.5. Non-Blocking Startup Lifecycle (`src/extension.ts`)
1. During `activate()`:
   - Remove synchronous call to `installBridgeScript({ updateChecksums: true })`.
   - Perform bridge status inspection asynchronously. If bridge script is not installed and `autoInjectWorkbench` is true, check write permissions first; if elevated permissions are required, prompt the user with an actionable notification ("DOM Bridge requires installation. Click Install to proceed.") rather than popping root password dialogs during IDE boot.

---

## 4. Single Automated File-Based Test

Create `src/test/phase04_nonblocking_elevation_and_config_isolation.test.ts` to verify:
1. Setup standalone `vscode` module mock conforming to project test standards.
2. Verify `writeConfigJson()` behavior:
   - When given a writable test directory, successfully writes `ag-autoplan-config.json` without elevation.
   - When given a non-writable simulated directory (`EACCES`), catches error and falls back cleanly to user storage directory without calling `writeFileElevated`.
3. Verify `writeFileElevatedAsync` executes asynchronously without blocking the event loop (verify `setInterval` timers continue ticking during elevated write execution).
4. Verify elevation mutex prevents concurrent elevation command execution (second concurrent call fails fast or queues cleanly).
5. Verify debounced configuration change handler coalesces 15 rapid consecutive config changes into a single execution.
6. Clean up temporary test files.

---

## 5. Verification Protocol

Run only this single test for verification:
```bash
npx tsc && node out/test/phase04_nonblocking_elevation_and_config_isolation.test.js
```

After running this single test, stop immediately for user review. Once completed, output `done.`.
