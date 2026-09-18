# Plan: Fix Workspace Title & Multi-Root Workspace Detection

Created: 2026-09-17 14:15:00 UTC+7  
Status: 📋 In Progress / Ready for Execution  
Target Scope: Client DOM Bridge (`media/autoplan-dom-bridge.js`), Extension Host (`src/extension.ts`, `src/orchestrator.ts`, `src/transcriptWatcher.ts`), and `BridgeServer` (`src/bridgeServer.ts`) to seamlessly support Untitled and Multi-Root Workspaces without triggering HTTP 409 mismatch rejections.

---

## 1. Problem Statement & Root Cause

From [workspace.txt](file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main/workspace.txt):
- In Antigravity IDE with an Untitled Workspace (or Multi-Root Workspace):
  - The Window Title is: `Untitled (Workspace) - Antigravity IDE - phase-05-compose-ui-localization.md`
  - The Explorer Header is: `Untitled (Workspace)`
  - The actual project folder inside Explorer is: `AI_Novel-main`
- The legacy DOM Bridge client picks `"Untitled (Workspace)"` as its `workspaceName`.
- The Extension Host initializes `BridgeServer` with `activeWorkspaceFolder.name = "AI_Novel-main"`.
- When DOM Bridge probes `http://127.0.0.1:48860/autoplan-status?workspaceName=Untitled (Workspace)`, `BridgeServer` strictly compares `"Untitled (Workspace)"` against `"AI_Novel-main"` and responds with `HTTP 409 Conflict (workspace-mismatch)`.
- This completely breaks Tier 1 (Focus-Free DOM Bridge) automation in workspace mode.

---

## 2. Remediation Strategy

1. **Client-side (`media/autoplan-dom-bridge.js`)**:
   - Strip `\s*\((Workspace|Workspace File)\)$` from candidate title strings.
   - Filter out `'untitled'`, `'untitled (workspace)'` as placeholder titles.
   - Extract actual root folder names from `.monaco-list-row [class*="rootfolder-icon"] .label-name`.
2. **Server-side (`src/bridgeServer.ts`)**:
   - Multi-root matching: accept probe if `query.workspaceName` matches any folder in `workspaceFolders`, `workspaceName`, or `workspaceTitle`.
   - Untitled tolerance: accept probe if both server and client are in untitled workspaces.
3. **Extension & Orchestrator (`src/extension.ts`, `src/orchestrator.ts`, `src/transcriptWatcher.ts`)**:
   - Provide `workspaceFolders` and `workspaceTitle` to `BridgeServer` and `Orchestrator`.
   - Support `workspaceFolders` in `TranscriptWatcher` to verify conversation ownership across multi-root workspaces.

---

## 3. Verification Plan

- `npm run compile`
- `npm run test:workspace`
- `npm run test:bridge`
- New test: `src/test/phase01_workspace_title_multiroot_fix.test.ts`
