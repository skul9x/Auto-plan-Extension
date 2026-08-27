# Phase 01: Folder Scanner & Dynamic Prompt Templating
Status: ✅ Completed
Dependencies: None

## Objective
Implement the plan folder scanner and dynamic prompt templating engine. The scanner discovers and isolates executable phase markdown files in a user-provided directory, excludes documentation/summary artifacts, sorts phases with natural alphanumeric ordering, normalizes file paths across operating systems, and renders customizable prompt templates with `{xxx}` placeholders.

## Requirements
### Functional
- [x] **Directory Scanning & Discovery**: Scan any target folder path and extract candidate `.md` files.
- [x] **Comprehensive Artifact Blacklist Filter**: Automatically ignore non-phase documentation files (case-insensitive and prefix/suffix matching):
  - `plan.md`, `plan-*.md` (if overview)
  - `summary.md`, `overview.md`
  - `walkthrough.md`, `walkthrough-*.md`
  - `implementation_plan.md`
  - `readme.md`, `notes.md`
  - Subdirectories such as `scratch/`, `.system_generated/`, `assets/`, `images/`
- [x] **Smart Phase Detection & Natural Sorting**:
  - Prioritize files matching phase naming conventions: `/^phase[-_]?\d+/i` or `/^\d+[-_]/i`.
  - Gracefully fallback to all remaining non-blacklisted `.md` files if no standard prefix exists.
  - Sort discovered files using natural alphanumeric comparison (`Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`), ensuring `phase-09.md` comes before `phase-10.md` and `phase-100.md`.
- [x] **Path Normalization**: Provide both native OS paths (Windows backslashes `\`) and normalized forward slashes (`/`) without escaping bugs.
- [x] **Template Engine & Multi-Placeholder Support**:
  - Support primary placeholder `{xxx}` as requested.
  - Support semantic aliases `{path}`, `{file}`, `{phasePath}`, `{phaseFile}`.
  - Default template:
    ```text
    Implement the code closely following the file {xxx}
    Note, follow the requirements exactly. Do only what is asked, with no extra work. Once done, you must thoroughly test what you have just implemented using exactly one file-based test for this phase. The test must verify the core functionality of the entire phase as comprehensively as reasonably possible. Do not create or run any additional tests, test cases, or test files. After finishing, mark the phase plan file as completed. When done, say "Done skul9x." to save token.
    ```
  - If a custom template lacks any placeholder, automatically append the absolute path to ensure the AI always receives the target file context.
- [x] **Configuration Updates**:
  - Update `src/config.ts` to include `defaultPromptTemplate`, `completionKeyword` (`Done skul9x.`), and plan scanning helper options.

### Non-Functional
- [x] High performance: Scan directory and parse file list in < 20ms.
- [x] Zero external runtime dependencies (using standard Node.js `fs` and `path`).

## Files to Create/Modify
- `src/planScanner.ts` - Core scanner, path validator, blacklist filter, sorter, and prompt formatter.
- `src/config.ts` - Configuration types, default template constant, and config getters/setters.
- `src/test/phase01_folder_scanner.test.ts` - Comprehensive single test file for Phase 01.

## Test Criteria
- [x] Exactly one file-based test: `src/test/phase01_folder_scanner.test.ts`.
- [x] Verifies scanning mock directories with mixed files (`plan.md`, `walkthrough.md`, `phase-01.md`, `phase-10.md`, `readme.md`).
- [x] Verifies exclusion of all blacklisted artifact patterns.
- [x] Verifies natural sorting (`phase-01`, `phase-02`, `phase-09`, `phase-10`, `phase-100`).
- [x] Verifies template rendering with `{xxx}` and alias placeholders using absolute file paths.
- [x] Verifies error throwing on invalid or empty folders.

---
Next Phase: [phase-02-strict-transcript-watcher.md](file:///d:/skul9x/Auto-Plan_Extension/plans/260828-0020-folder-plan-runner/phase-02-strict-transcript-watcher.md)
