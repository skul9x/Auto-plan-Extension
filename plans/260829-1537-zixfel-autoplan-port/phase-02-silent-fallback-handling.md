# Phase 02: Silent Fallback & Non-Intrusive Error Handling

Created At: 2026-08-29T08:39:20Z
Completed At: 2026-08-29T15:40:00Z
Status: ✅ Completed
Dependencies: Phase 01

## Objective
Eliminate intrusive yellow warning toasts (`vscode.window.showWarningMessage`) when falling back between prompt dispatch tiers (DOM Bridge -> Keyboard Simulation), logging silently to console/output channel instead.

## Requirements
### Functional
- Add `suppressFallbackWarnings?: boolean` option in `AutoPlanConfig` in `src/config.ts` (default `true`).
- Update `PromptDispatcher` in `src/promptDispatcher.ts` to log fallback messages quietly to output channel / console when `suppressFallbackWarnings` is enabled.
- Ensure critical fatal errors (where all 3 tiers fail) still throw proper descriptive errors.

### Non-Functional
- Prevent UI toast pollution during auto-plan execution.
- Maintain full diagnostic logging in developer logs and transcript files.

## Implementation Steps
1. Modify `src/config.ts`:
   - Add `suppressFallbackWarnings` setting to `AutoPlanConfig` schema and defaults.
2. Modify `src/promptDispatcher.ts`:
   - Update `this.warningNotifier` invocation in Tier 3 fallback to check config setting and avoid popping `vscode.window.showWarningMessage` when suppressed.
3. Create single file-based test suite `src/test/phase02_silent_fallback_handling.test.ts`:
   - Test 1: Verify fallback to Tier 3 keyboard mode emits console log without invoking warning toast when suppressed.
   - Test 2: Verify fallback warning toast can still be enabled if setting is explicitly set to `false`.
   - Test 3: Verify fatal errors across all tiers still throw properly.

## Files to Create/Modify
- `src/config.ts` - Add `suppressFallbackWarnings` config property.
- `src/promptDispatcher.ts` - Update warning notifier logic.
- `src/test/phase02_silent_fallback_handling.test.ts` - Comprehensive single file-based test suite.

## Test Criteria
- `node out/test/phase02_silent_fallback_handling.test.js` passes 100%.

---
Next Phase: [Phase 03: Realtime Config Sidecar & Renderer Watchdog](phase-03-sidecar-config-watchdog.md)
