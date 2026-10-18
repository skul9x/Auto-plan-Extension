# Phase 03: Modern Tab Navigation, Search Filter & Settings UI Overhaul

Status: ✅ Completed
Completed At: 2026-10-14T06:20:00+07:00
Test: `src/test/phase03_settings_tab_navigation_ui.test.ts`

## Goals
1. **Modern Tab Navigation Architecture**:
   - Refactor `media/settings/settings.html` to introduce a responsive tab bar with 4 categories:
     - 🔀 `tab-dispatch`: **Dispatch & Tiers** (Prompt Dispatch Tiers, Fallback Policy, Transport Diagnostics, 1-Click Bridge Setup).
     - 🤖 `tab-telegram`: **Telegram & Remote** (Dedicated Telegram Remote Control and Chat settings card).
     - ⏱️ `tab-automation`: **Timing & Automation** (Timing & Loop Controls, Plan & File Automation, Phase Prompt Template & AI Completion Keyword).
     - 🩺 `tab-diagnostics`: **Diagnostics & Logs** (Plan & Phase Diagnostics Telemetry, DOM Bridge Live Log Viewer Console).
   - Implement state preservation: save active tab in `vscode.setState({ activeTab: tabId })` so reopening the webview restores the last viewed category.
2. **Instant Search & Highlight Filter**:
   - Add a search input bar in the header (`#searchSettingsInput`) with placeholder *"🔍 Search settings (e.g. telegram, tier, timeout, token)..."*.
   - Filter algorithm in `media/settings/settings.js`:
     - On input event (debounced 100ms), search across all card titles, labels, hints, and descriptions.
     - When a query is entered, show matching cards across all categories (or switch to the tab containing the top match) and dim non-matching sections.
     - Highlight matched text fragments dynamically.
     - When cleared, restore normal tab filtering.
3. **Debounced Auto-Saving with Optimistic UI**:
   - Automatically trigger debounced saving (300ms) when any toggle, input, or slider is modified.
   - Update header status badge: transition from *"Saving changes..."* to *"All changes saved ✓"*.
   - Preserve the explicit *"Save Changes"* button as a force-save fallback.
4. **Verification**:
   - Exactly one test file: `src/test/phase03_settings_tab_navigation_ui.test.ts`.
   - Verify tab navigation switching, active classes, and ARIA attributes in DOM.
   - Verify search filter matching and visibility toggling.
   - Verify auto-save debounce triggering and message dispatching.

## Implementation Details

### 1. HTML Tab Structure
```html
<nav class="settings-nav-bar" role="tablist">
  <button class="nav-tab active" data-tab="tab-dispatch" role="tab" aria-selected="true">
    <span class="tab-icon">🔀</span> Dispatch & Tiers
  </button>
  <button class="nav-tab" data-tab="tab-telegram" role="tab" aria-selected="false">
    <span class="tab-icon">🤖</span> Telegram & Remote
  </button>
  <button class="nav-tab" data-tab="tab-automation" role="tab" aria-selected="false">
    <span class="tab-icon">⏱️</span> Timing & Automation
  </button>
  <button class="nav-tab" data-tab="tab-diagnostics" role="tab" aria-selected="false">
    <span class="tab-icon">🩺</span> Diagnostics & Logs
  </button>
</nav>
```

### 2. Search Filter in `media/settings/settings.js`
```javascript
function applySearchFilter(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    clearSearchHighlights();
    showTab(activeTab);
    return;
  }
  // Reveal all matching cards across tabs and highlight matching terms
}
```

## Verification
- Run: `node out/test/phase03_settings_tab_navigation_ui.test.js`.
- Ensure 100% of test assertions pass.
