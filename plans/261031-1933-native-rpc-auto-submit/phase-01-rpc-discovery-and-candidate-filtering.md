# Phase 01: Core RPC Discovery, Trajectory Traversal & Candidate Filtering

Status: ✅ Completed
Test: `src/test/phase01_rpc_discovery_candidate_filtering.test.ts`

## Objective
Establish a reliable, non-intrusive RPC bridge directly connecting to the built-in Antigravity extension, safely inspect active cascade trajectories, and accurately identify actionable permission requests belonging exclusively to the current workspace without relying on DOM elements or UI focus.

## Scope
- Built-in extension lookup and RPC client acquisition via `google.google-antigravity`.
- Workspace URI boundary normalization and strict matching against active editor folders.
- Trajectory summary traversal, schema validation, and waiting step status detection.
- Permission candidate extraction with differentiation between actionable system approvals and interactive user questionnaires.

## Requirements
1. **Built-in Extension Acquisition & Health Guarding**:
   - Query and discover the internal Antigravity IDE extension (`google.google-antigravity`) using standard VS Code extension discovery APIs.
   - Guard against un-activated states or missing exports gracefully, reporting informative lifecycle states (`waiting`, `legacy`, `unsupported`, or `ready`) without throwing uncaught exceptions.
   - Acquire the RPC client reference without blocking or stalling the Extension Host event loop, applying strict timeout bounds on acquisition attempts.
2. **Strict Workspace Boundary Isolation**:
   - Normalize file and remote workspace URIs (handling platform-specific case insensitivity and trailing slash variations).
   - Verify that any detected cascade trajectory strictly belongs to one of the currently open workspace folders before evaluating its steps.
   - Ensure trajectories belonging to other workspaces or closed projects are silently ignored.
3. **Trajectory Validation & Waiting Step Filtering**:
   - Traverse all active cascade trajectories returned by the RPC client.
   - Ignore trajectories that are marked as killed, archived, or mismatched in cascade identifier.
   - Identify waiting steps whose execution status indicates a pending interaction state (`status === 9` / `WAITING`).
   - Validate step lineage and step index integrity against trajectory metadata, rejecting malformed or orphaned step entries.
4. **Selective Actionable Permission Candidate Extraction**:
   - Discriminate between automated permission approval cards (`interaction.case === 'permission'`) and other interactive prompts (such as free-form questions, architectural planning inquiries, editor diff confirmations, or persistent grant configurations).
   - Validate that permission targets define valid resource actions and targets before presenting them as candidates.
   - Format eligible items into standardized candidate structures ready for downstream submission.

## Constraints
- Never inspect, scrape, or connect to arbitrary TCP ports or local HTTP debug endpoints; use only the window-bound RPC client exported by the extension.
- Do not force-activate or focus the Antigravity Agent window when polling for trajectory statuses.
- Zero dependencies on Electron renderer DOM nodes, CSS selectors, or `<iframe>` document trees.
- Maintain total backwards compatibility with environments where the Antigravity extension export is absent.

## Dependencies
- Source files: `src/antigravityRpcAutoSubmit.ts` (to be created), `src/config.ts`.
- VS Code APIs: `vscode.extensions.getExtension`, `vscode.workspace.workspaceFolders`.

## Acceptance Criteria
- Successfully discovers and acquires the RPC client from mock or live `google.google-antigravity` extension exports within 1,000ms.
- Correctly parses multi-trajectory responses, matching only trajectories associated with active workspace URIs.
- Filters out non-permission interactions (e.g., questions, diffs) and non-waiting steps with 100% accuracy.
- Produces valid candidate objects containing cascade IDs, trajectory IDs, step indices, and validated resource metadata.
- Gracefully handles missing exports, inactive extensions, and network/RPC timeouts by returning clean status descriptors.

## Comprehensive File-Based Test
- **File**: `src/test/phase01_rpc_discovery_candidate_filtering.test.ts`
- **Scope**:
  - Verifies RPC client discovery under various extension states (missing, unactivated, active with RPC export, and active with invalid export).
  - Tests workspace URI normalization and verification across cross-platform path formats (POSIX paths, Windows drive letters, `file://` and `vscode-remote://` protocols).
  - Verifies trajectory filtering against synthetic payloads with mixed states (archived, killed, active, mismatched IDs).
  - Validates extraction precision, ensuring only `case: 'permission'` steps in `WAITING` state are extracted as candidates.

