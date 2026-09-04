# Phase 03: End-to-End Multi-Window Resilience & Hijack Prevention

Status: 🟢 Completed  
Dependencies: Phase 01, Phase 02  
Target Files: `src/extension.ts`, `src/bridgeServer.ts`, `src/transcriptWatcher.ts`, `src/orchestrator.ts`  
Primary Test File: `src/test/phase03_multi_window_e2e_resilience.test.ts`

---

## 1. Objective

Integrate the workspace-bound bridge server routing (Phase 01) and prompt fingerprint verification (Phase 02) into the extension lifecycle in `src/extension.ts`.
Verify end-to-end multi-window execution to guarantee that:
1. Reloading a window automatically re-attaches the DOM Bridge client without 409 rejection.
2. Prompts dispatched from one workspace never leak into another workspace.
3. Orchestrator never binds to foreign conversations or false-positive completions during multi-window operation.

---

## 2. Requirements

### Functional
- [x] In `src/extension.ts`:
  - When instantiating `BridgeServer`, supply the current workspace name and root path:
    ```typescript
    const activeWorkspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspaceName = activeWorkspaceFolder ? activeWorkspaceFolder.name : undefined;
    const workspacePath = activeWorkspaceFolder ? activeWorkspaceFolder.uri.fsPath : undefined;
    ```
  - Pass `workspaceName` and `workspacePath` to `BridgeServer` options.
  - Wire `orchestrator` with workspace ownership validation on every phase dispatch.
- [x] In `src/promptDispatcher.ts`:
  - Confirm that tier 1 dispatches propagate `workspaceName` diagnostics in error and trace logs.
- [x] Build comprehensive end-to-end integration test:
  - Simulate two active VS Code windows:
    - Window 1: Workspace `TramsacEV` on Port 48861
    - Window 2: Workspace `Auto-plan-Extension` on Port 48862
  - Verify that:
    - Window 1's DOM Bridge client discovers and binds only to Port 48861.
    - Window 2's DOM Bridge client discovers and binds only to Port 48862.
    - Window 1 undergoes a simulated window reload (generating a new client windowKey); the server allows instant takeover.
    - Window 1 dispatches `phase-02-favorites-sync-metric-preservation.md`.
    - While Window 1 is waiting for AI response, Window 2 receives an unrelated prompt and writes a new transcript file.
    - Window 1's Orchestrator rejects Window 2's conversation directory and remains patiently waiting for Window 1's transcript.
    - Window 1's transcript is subsequently written with keyword `"Done skul9x."`; Window 1 marks Phase 2 as Completed.

### Non-Functional
- [x] All tests run purely in memory or within isolated temporary sandbox directories without requiring real VS Code GUI or external network.
- [x] Zero unhandled promise rejections or lingering timer leaks.

---

## 3. Implementation Steps

1. In `src/extension.ts`:
   - Pass workspace metadata to `BridgeServer` initialization.
   - Ensure `PromptDispatcher` and `Orchestrator` receive workspace context.
2. Implement `src/test/phase03_multi_window_e2e_resilience.test.ts`:
   - Set up two concurrent mock `BridgeServer` instances and two simulated DOM bridge clients.
   - Execute the multi-window reload, dispatch, cross-talk rejection, and completion verification scenario.
3. Verify compile and test pass:
   ```bash
   npm run compile && node out/test/phase03_multi_window_e2e_resilience.test.js
   ```
4. Stop for user review.

---

## 4. Verification Plan

- Run the single comprehensive test for this phase:
  ```bash
  npm run compile && node out/test/phase03_multi_window_e2e_resilience.test.js
  ```
- Verify all assertions pass cleanly.
- Stop for user review.
