# Phase 05: Webview Memory Pruning, Documentation & Release Packaging (v1.6.9)

Status: ✅ Completed
Test: `src/test/phase05_full_performance_regression_release.test.ts`

## Objective
Prevent Webview memory leaks from unbounded DOM node accumulation in the live log console, reconcile dual transcript tailing arbitration, correct and align quantitative performance claims in project documentation with empirical reality, and package the release as version 1.6.9.

## Scope
- Live log streaming and DOM row pruning in `media/settings/settings.js`.
- DOM Bridge polling activity listener throttling in `media/autoplan-dom-bridge.js`.
- Transcript tailing coordination between `src/orchestrator.ts` and `src/telegramChatMirror.ts`.
- Documentation and release versioning in `README.md`, `CHANGELOG.md`, and `package.json`.

## Requirements
1. **Bounded DOM Node Retention in Webview Log Console**:
   - In `media/settings/settings.js` (`appendLogEntry`), ensure that as new log rows are appended to `logConsoleOutput`, older DOM rows exceeding `MAX_LOG_BUFFER_SIZE` (500 entries) are explicitly removed from the DOM tree.
   - Prevent unbounded memory growth and layout degradation in long-running sessions when the Settings log console is active.
2. **DOM Bridge Event Listener Hygiene**:
   - Verify that event listeners attached to `focus`, `pointerdown`, and `keydown` in `media/autoplan-dom-bridge.js` use `{ passive: true }` where supported and include debounced/throttled invocation to prevent event storms during rapid keyboard or pointer activity.
   - Ensure the polling frequency transition between active (400ms) and idle (2000ms) states behaves predictably without spamming localhost HTTP requests.
3. **Transcript Watcher & Tail Engine Arbitration**:
   - Ensure that when Telegram Chat Mirror is active alongside an executing Orchestrator session, both components share or coordinate transcript discovery without running redundant duplicate file watchers or competing disk streams on the same `transcript.jsonl`.
4. **Documentation Alignment & Truthful Performance Metrics**:
   - Audit and revise quantitative performance claims in `README.md` to accurately describe actual benchmarked improvements (e.g. clarify that 75% polling reduction applies in idle states, document single-pass phase file inspection, and note bounded log payload limits).
   - Document the complete list of resolved performance issues (PERF-F01 through PERF-F11) in `CHANGELOG.md` under version `v1.6.9`.
5. **Release Manifest Bump**:
   - Increment extension version in `package.json` to `1.6.9`.
   - Ensure all build and bundle validations pass without warnings.

## Constraints
- Do not alter the visual styling, theme integration, or UI interaction of the Settings or Sidebar webviews.
- Preserve complete compatibility with existing plan file formats and Telegram bot configurations.
- Ensure all previously established regression suites remain 100% passing.

## Dependencies
- Source files: `media/settings/settings.js`, `media/autoplan-dom-bridge.js`, `package.json`, `README.md`, `CHANGELOG.md`.
- Prior phases: Phases 01 through 04.

## Acceptance Criteria
- Streaming 2,000 log entries into the Settings log console retains no more than 500 row elements in the DOM tree.
- `package.json` version is updated to `1.6.9`.
- `CHANGELOG.md` documents v1.6.9 with all forensic audit fixes clearly itemized.
- `README.md` contains accurate, verified descriptions of all performance optimizations.
- The comprehensive release test suite verifies end-to-end integration and passes without regressions.

## Comprehensive File-Based Test
- **File**: `src/test/phase05_full_performance_regression_release.test.ts`
- **Scope**:
  - Verifies DOM row pruning logic in the settings log console script under high-throughput log volume.
  - Verifies `package.json` version consistency against `CHANGELOG.md`.
  - Runs full-system health checks ensuring all Phase 01 through Phase 04 optimizations operate cohesively.
  - Verifies that no unhandled exceptions, memory leaks, or duplicate listeners persist after orchestrator and telegram mirror teardown.
