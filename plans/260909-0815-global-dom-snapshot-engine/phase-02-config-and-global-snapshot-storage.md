# Phase 02: Configuration Schema & Global Directory Snapshot Storage Engine

Status: ✅ Completed  
Primary Test File: `src/test/phase02_config_and_global_snapshot_storage.test.ts`

---

## 1. Objective

Define the user configuration schema in `package.json` and `src/config.ts` for DOM snapshots, and implement the global filesystem storage engine in `src/orchestrator.ts` that dynamically saves snapshots to `~/.autoplan/snapshots/<sanitized_project_name>/` based on the active VS Code window.

---

## 2. Technical Scope & Requirements

### 2.1. Configuration Schema (`package.json` & `src/config.ts`)
1. Add `autoplan.enableDomSnapshots` (boolean, default: `true`):
   - Description: "Automatically capture and save full workbench DOM HTML snapshots when creating or retrying conversations."
2. Add `autoplan.domSnapshotFolder` (string, default: `""`):
   - Description: "Custom directory path for DOM snapshots. When empty, defaults to centralized global directory ~/.autoplan/snapshots/<project_name>."
3. Update `AutoPlanConfig` interface in `src/config.ts`:
   - `enableDomSnapshots?: boolean;`
   - `domSnapshotFolder?: string;`
4. Update `DEFAULT_CONFIG` and `getConfig()` to read these properties with appropriate defaults.

### 2.2. Global Snapshot Storage Engine (`src/orchestrator.ts`)
1. Implement `saveWorkbenchSnapshot(options: { phaseIndex: number; phaseName: string; attempt: number; triggerType: 'initial' | 'retry' }): Promise<string | undefined>`:
   - Check if `enableDomSnapshots` is false; if so, skip and return `undefined`.
   - Resolve current workspace name dynamically:
     ```typescript
     const activeWsFolder = vscode?.workspace?.workspaceFolders?.[0];
     const wsName = this.workspaceName ||
       (activeWsFolder ? activeWsFolder.name : undefined) ||
       (this.workspacePath ? path.basename(this.workspacePath) : 'default_project');
     const sanitizedWsName = wsName.replace(/[^a-zA-Z0-9_-]/g, '_');
     ```
   - Resolve destination directory:
     - If `domSnapshotFolder` is provided and absolute, use it.
     - Otherwise, resolve `path.join(os.homedir(), '.autoplan', 'snapshots', sanitizedWsName)`.
   - Ensure target directory exists using `fs.mkdirSync(targetDir, { recursive: true })`.
   - Generate ISO-like filesystem-safe timestamp: `YYYY-MM-DD_HH-mm-ss`.
   - Generate standardized filename:
     `snapshot_phase_${pad(phaseIndex + 1)}_${triggerType}_attempt_${attempt}_${timestampStr}.html`
   - Retrieve HTML from `bridgeServer.captureDomSnapshot(6000)`.
   - Write snapshot file synchronously (`fs.writeFileSync(fullPath, res.html, 'utf8')`).
   - Log diagnostic entry to `debugLogger.info`.
   - Return saved file path.
   - Never throw: catch all exceptions and log warning to ensure orchestrator stability.

---

## 3. Implementation Steps

1. Update `package.json` configuration contributions.
2. Update `src/config.ts` interface and defaults.
3. Add `saveWorkbenchSnapshot` helper in `src/orchestrator.ts`.
4. Implement `src/test/phase02_config_and_global_snapshot_storage.test.ts`:
   - Test default configuration values and custom overrides.
   - Test workspace name sanitization and global destination path resolution.
   - Test filename pattern generation for initial and retry triggers.
   - Test file creation and content integrity with mock BridgeServer.
   - Test non-blocking behavior when BridgeServer capture fails.

---

## 4. Verification Test Criteria

- [x] Configuration keys `autoplan.enableDomSnapshots` and `autoplan.domSnapshotFolder` validate cleanly.
- [x] Directory correctly resolves to `~/.autoplan/snapshots/<project_name>/`.
- [x] Filenames correctly encode phase index, trigger type (`initial`/`retry`), attempt number, and timestamp.
- [x] File content written matches captured HTML byte-for-byte.
- [x] Error during capture does not throw and logs warning gracefully.

Verification Command:
```bash
npm run compile && node out/test/phase02_config_and_global_snapshot_storage.test.js
```

---
Next Phase: [Phase 03: Orchestrator Pipeline Integration & Multi-Window E2E Verification](./phase-03-orchestrator-snapshot-pipeline-e2e.md)
