# Phase 01: Smart Phase Scanner & Status Detection

Status: ✅ Completed
Dependencies: None

## Objective
Upgrade `src/planScanner.ts` to automatically detect phase completion status from markdown front-matter/headers (e.g. `Status: ✅ Completed`, `Status: 🟢 Completed`, `Status: Completed`, `Status: Done`), enrich `PhaseFile` objects with status metadata, provide a resilient natural sort helper for arbitrary phase collections, and implement phase slicing utilities for "Run from phase X to end".

## Requirements
### Functional
- [x] Extend `PhaseFile` interface in `src/planScanner.ts` to include:
  - `status: 'Completed' | 'Pending'`
  - `isCompleted: boolean`
- [x] Implement `detectPhaseStatus(filePath: string): 'Completed' | 'Pending'`:
  - Efficiently inspects the front-matter/header section (first 30 lines) of the markdown file.
  - Matches completion signatures resiliently across varied emoji and punctuation formats using `/^status:\s*(?:[^\w\s]\s*)?(completed|done)\b/im` (e.g. `Status: ✅ Completed`, `Status: 🟢 Completed`, `Status: ✔ Completed`, `Status: [x] Completed`, `Status: Completed`, `Status: Done`).
  - Returns `'Completed'` when matching completion signatures; defaults to `'Pending'` for `Status: ⬜ Pending`, `Status: 🟡 In Progress`, unstated status, or any other state.
- [x] Enhance `scanPlanFolder()` to automatically populate `status` and `isCompleted` on all returned `PhaseFile` items without perceptible I/O latency (< 50ms).
- [x] Implement `sortPhaseFiles(phases: PhaseFile[]): PhaseFile[]` that reliably sorts phase files using natural numeric collation (`Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`) based on filename and numeric index regardless of input order.
- [x] Implement `getPhasesFrom(phases: PhaseFile[], targetPhaseIdentifier: string | number): PhaseFile[]` to slice and return all phases starting from a selected phase through to the end of the sequence:
  - Supports 1-based index (`number`), or matching string (`fileName`, `filePath`, `normalizedPath`, or phase prefix).
  - Throws an informative error if `targetPhaseIdentifier` is not found.

### Non-Functional
- [x] Performance: Scanning phase files for status indicators must complete in < 50ms for directories with up to 50 phase markdown files.
- [x] Accuracy: Never false-positive on arbitrary markdown body text or fenced code blocks by restricting scan to the header region.

## Files to Create/Modify
- `src/planScanner.ts` - Add `detectPhaseStatus`, enrich `PhaseFile`, add `sortPhaseFiles` and `getPhasesFrom`.
- `src/test/phase01_smart_phase_scanner.test.ts` - Single comprehensive test for Phase 01.

## Test Criteria
- Exactly one file-based test: `src/test/phase01_smart_phase_scanner.test.ts`.
- [x] Verifies detection of completed phases (`Status: ✅ Completed`, `Status: 🟢 Completed`, `Status: ✔ Completed`, `Status: Completed`, `Status: Done`).
- [x] Verifies detection of pending phases (`Status: ⬜ Pending`, `Status: 🟡 In Progress`, no status header).
- [x] Verifies scan scope limits to header and does not false-positive on body markdown text.
- [x] Verifies natural numeric sorting order when given arbitrarily ordered phase files (`phase-01`, `phase-02`, `phase-10`).
- [x] Verifies `getPhasesFrom` correctly extracts slice from target phase index or filename to the end, and handles missing identifiers.

---
Next Phase: phase-02-interactive-quickpick-selection.md

