// Self-healing ESM require guard for JSDOM in Node < 20.19 CommonJS
if (!process.env.__PHASE03_TAB_NAV_REEXEC__) {
  try {
    require('jsdom');
  } catch (e: any) {
    if (e.code === 'ERR_REQUIRE_ESM') {
      const { execFileSync } = require('child_process');
      const env = {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --experimental-require-module`.trim(),
        __PHASE03_TAB_NAV_REEXEC__: '1'
      };
      try {
        execFileSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
          stdio: 'inherit',
          env
        });
        process.exit(0);
      } catch (err: any) {
        process.exit(err.status || 1);
      }
    }
    throw e;
  }
}

// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          { name: 'test-workspace', uri: { fsPath: '/mock/workspace' } }
        ],
        getConfiguration: (_section?: string) => ({
          get: (_key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      window: {
        showInformationMessage: async () => {},
        showErrorMessage: async () => {},
        showWarningMessage: async () => {}
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: async () => {}
      },
      Uri: { file: (p: string) => ({ fsPath: p }) }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { JSDOM } from 'jsdom';

interface MockVsCodeApi {
  postMessage: (msg: any) => void;
  getState: () => any;
  setState: (state: any) => void;
  postedMessages: any[];
}

function createMockVsCode(initialState: any = null): MockVsCodeApi {
  let state = initialState ? { ...initialState } : null;
  const postedMessages: any[] = [];

  return {
    postMessage: (msg: any) => {
      postedMessages.push(msg);
    },
    getState: () => state,
    setState: (newState: any) => {
      state = { ...newState };
    },
    postedMessages
  };
}

function setupTestDom(initialState: any = null): {
  dom: JSDOM;
  window: any;
  document: Document;
  mockVsCode: MockVsCodeApi;
  exports: any;
} {
  const rootDir = path.resolve(__dirname, '../..');
  const htmlPath = path.join(rootDir, 'media/settings/settings.html');
  const jsPath = path.join(rootDir, 'media/settings/settings.js');

  const rawHtml = fs.readFileSync(htmlPath, 'utf8');
  // Strip out CSP and template placeholders for standalone test harness
  const cleanHtml = rawHtml
    .replace(/\$\{webview\.cspSource\}/g, '')
    .replace(/\$\{nonce\}/g, 'test-nonce')
    .replace(/\$\{styleUri\}/g, '')
    .replace(/\$\{scriptUri\}/g, '');

  const dom = new JSDOM(cleanHtml, {
    runScripts: 'outside-only',
    url: 'http://localhost'
  });

  const { window } = dom;
  const { document } = window;
  const mockVsCode = createMockVsCode(initialState);
  (window as any).__mockVsCode = mockVsCode;

  // Execute settings.js inside the window context
  const jsCode = fs.readFileSync(jsPath, 'utf8');
  const scriptFunction = new Function('window', 'document', 'acquireVsCodeApi', 'module', 'exports', jsCode);
  const mockModule: any = { exports: {} };
  scriptFunction(window, document, () => mockVsCode, mockModule, mockModule.exports);

  return {
    dom,
    window,
    document,
    mockVsCode,
    exports: mockModule.exports
  };
}

async function runPhase03SettingsTabNavigationTest(): Promise<void> {
  console.log('================================================================');
  console.log(' Phase 03: Modern Tab Navigation, Search Filter & Settings UI Test');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // Test Suite 1: Tab Navigation Architecture & ARIA Semantic Verification
  // -------------------------------------------------------------------------
  console.log('[Suite 1] Verifying Tab Bar HTML structure and ARIA attributes...');
  {
    const { document } = setupTestDom();

    const navBar = document.querySelector('.settings-nav-bar');
    assert.ok(navBar, '.settings-nav-bar navigation container must exist');
    assert.strictEqual(navBar.getAttribute('role'), 'tablist', 'Navigation bar must have role="tablist"');

    const tabs = Array.from(document.querySelectorAll('.nav-tab'));
    assert.strictEqual(tabs.length, 4, 'Must have exactly 4 category tabs');

    const expectedTabs = [
      { id: 'tab-dispatch', title: 'Dispatch & Tiers' },
      { id: 'tab-telegram', title: 'Telegram & Remote' },
      { id: 'tab-automation', title: 'Timing & Automation' },
      { id: 'tab-diagnostics', title: 'Diagnostics & Logs' }
    ];

    expectedTabs.forEach((exp, idx) => {
      const tab = tabs[idx];
      assert.strictEqual(tab.getAttribute('data-tab'), exp.id, `Tab ${idx} data-tab must be ${exp.id}`);
      assert.strictEqual(tab.getAttribute('role'), 'tab', `Tab ${idx} must have role="tab"`);
      assert.strictEqual(tab.getAttribute('aria-controls'), exp.id, `Tab ${idx} aria-controls must be ${exp.id}`);
      assert.ok(tab.textContent?.includes(exp.title), `Tab ${idx} text must contain ${exp.title}`);
    });

    // Verify 4 corresponding Tab Panes
    const tabPanes = Array.from(document.querySelectorAll('.tab-pane'));
    assert.strictEqual(tabPanes.length, 4, 'Must have exactly 4 tab-pane elements');

    expectedTabs.forEach((exp) => {
      const pane = document.getElementById(exp.id);
      assert.ok(pane, `Tab pane with id="${exp.id}" must exist`);
      assert.strictEqual(pane?.getAttribute('role'), 'tabpanel', `Tab pane ${exp.id} must have role="tabpanel"`);
      assert.ok(pane?.classList.contains('tab-pane'), `Tab pane ${exp.id} must have .tab-pane class`);
    });

    // Default active tab must be tab-dispatch
    const dispatchTab = document.querySelector('.nav-tab[data-tab="tab-dispatch"]');
    const dispatchPane = document.getElementById('tab-dispatch');
    assert.ok(dispatchTab?.classList.contains('active'), 'tab-dispatch must be active by default');
    assert.strictEqual(dispatchTab?.getAttribute('aria-selected'), 'true', 'tab-dispatch aria-selected must be true');
    assert.strictEqual(dispatchPane?.style.display, 'block', 'tab-dispatch pane must be visible');

    // Other panes must be hidden
    ['tab-telegram', 'tab-automation', 'tab-diagnostics'].forEach((otherId) => {
      const otherTab = document.querySelector(`.nav-tab[data-tab="${otherId}"]`);
      const otherPane = document.getElementById(otherId);
      assert.strictEqual(otherTab?.classList.contains('active'), false, `${otherId} must not be active`);
      assert.strictEqual(otherTab?.getAttribute('aria-selected'), 'false', `${otherId} aria-selected must be false`);
      assert.strictEqual(otherPane?.style.display, 'none', `${otherId} pane must be hidden`);
    });

    console.log('  ✓ 4 category tabs and tab panels with full ARIA semantics validated.');
  }

  // -------------------------------------------------------------------------
  // Test Suite 2: Interactive Tab Switching & State Serialization
  // -------------------------------------------------------------------------
  console.log('\n[Suite 2] Verifying interactive tab switching and vscode.setState persistence...');
  {
    const { document, mockVsCode, exports } = setupTestDom();

    // 2.1 Switch to tab-telegram
    const telegramTabBtn = document.querySelector('.nav-tab[data-tab="tab-telegram"]') as HTMLButtonElement;
    assert.ok(telegramTabBtn, 'Telegram tab button must exist');
    telegramTabBtn.click();

    assert.strictEqual(exports.getActiveTab(), 'tab-telegram', 'activeTab state must be tab-telegram');
    assert.ok(telegramTabBtn.classList.contains('active'), 'tab-telegram button must have active class');
    assert.strictEqual(telegramTabBtn.getAttribute('aria-selected'), 'true');
    assert.strictEqual(document.getElementById('tab-telegram')?.style.display, 'block', 'tab-telegram pane must be displayed');
    assert.strictEqual(document.getElementById('tab-dispatch')?.style.display, 'none', 'tab-dispatch pane must now be hidden');

    // Verify vscode.setState was invoked with activeTab
    assert.deepStrictEqual(mockVsCode.getState(), { activeTab: 'tab-telegram' }, 'vscode.setState must preserve activeTab');

    // 2.2 Switch to tab-automation
    const automationTabBtn = document.querySelector('.nav-tab[data-tab="tab-automation"]') as HTMLButtonElement;
    automationTabBtn.click();

    assert.strictEqual(exports.getActiveTab(), 'tab-automation');
    assert.ok(automationTabBtn.classList.contains('active'));
    assert.strictEqual(document.getElementById('tab-automation')?.style.display, 'block');
    assert.strictEqual(document.getElementById('tab-telegram')?.style.display, 'none');
    assert.deepStrictEqual(mockVsCode.getState(), { activeTab: 'tab-automation' });

    // 2.3 Switch to tab-diagnostics
    const diagTabBtn = document.querySelector('.nav-tab[data-tab="tab-diagnostics"]') as HTMLButtonElement;
    diagTabBtn.click();

    assert.strictEqual(exports.getActiveTab(), 'tab-diagnostics');
    assert.ok(diagTabBtn.classList.contains('active'));
    assert.strictEqual(document.getElementById('tab-diagnostics')?.style.display, 'block');
    assert.strictEqual(document.getElementById('tab-automation')?.style.display, 'none');
    assert.deepStrictEqual(mockVsCode.getState(), { activeTab: 'tab-diagnostics' });

    console.log('  ✓ Interactive tab clicks update active classes, visibility, and vscode.setState.');
  }

  // -------------------------------------------------------------------------
  // Test Suite 3: State Restoration on Reopen
  // -------------------------------------------------------------------------
  console.log('\n[Suite 3] Verifying state restoration from previous vscode.getState()...');
  {
    // Initialize DOM with previousState = { activeTab: 'tab-automation' }
    const { document, exports } = setupTestDom({ activeTab: 'tab-automation' });

    assert.strictEqual(exports.getActiveTab(), 'tab-automation', 'Active tab must be restored to tab-automation');

    const automationTab = document.querySelector('.nav-tab[data-tab="tab-automation"]');
    const automationPane = document.getElementById('tab-automation');
    const dispatchPane = document.getElementById('tab-dispatch');

    assert.ok(automationTab?.classList.contains('active'), 'Restored tab must have active class');
    assert.strictEqual(automationTab?.getAttribute('aria-selected'), 'true');
    assert.strictEqual(automationPane?.style.display, 'block', 'Restored tab pane must be visible');
    assert.strictEqual(dispatchPane?.style.display, 'none', 'Default tab pane must not be visible when restored');

    console.log('  ✓ Webview automatically restores previously viewed tab category from state.');
  }

  // -------------------------------------------------------------------------
  // Test Suite 4: Instant Search & Highlight Filter Algorithm
  // -------------------------------------------------------------------------
  console.log('\n[Suite 4] Verifying instant search filter, dimming, and text highlighting...');
  {
    const { document, exports } = setupTestDom();

    const searchInput = document.getElementById('searchSettingsInput') as HTMLInputElement;
    const clearBtn = document.getElementById('btnClearSearch') as HTMLButtonElement;
    assert.ok(searchInput, '#searchSettingsInput must exist');
    assert.ok(clearBtn, '#btnClearSearch must exist');
    assert.strictEqual(
      searchInput.placeholder,
      '🔍 Search settings (e.g. telegram, tier, timeout, token)...',
      'Search input must have required placeholder'
    );

    // 4.1 Search for "telegram"
    exports.applySearchFilter('telegram');

    // Verify search mode and clear button visibility
    assert.strictEqual(clearBtn.classList.contains('hidden'), false, 'Clear search button must be shown when searching');

    // Matching card should have .search-match and not .search-dimmed
    const tgCard = document.getElementById('sectionTelegramSettings');
    assert.ok(tgCard, '#sectionTelegramSettings card must exist');
    assert.ok(tgCard?.classList.contains('search-match'), 'Telegram card must have .search-match');
    assert.strictEqual(tgCard?.classList.contains('search-dimmed'), false, 'Telegram card must not be dimmed');

    // Non-matching card should have .search-dimmed
    const dispatchCard = document.getElementById('sectionDispatchTiers');
    assert.ok(dispatchCard?.classList.contains('search-dimmed'), 'Dispatch card must be dimmed when searching telegram');

    // Tab pane with match must be displayed
    assert.strictEqual(document.getElementById('tab-telegram')?.style.display, 'block', 'tab-telegram pane must be displayed');

    // Verify dynamic text highlight inside matching card
    const markTags = tgCard?.querySelectorAll('mark.search-highlight');
    assert.ok(markTags && markTags.length > 0, 'Text highlights (<mark class="search-highlight">) must be generated');
    const hasTelegramMark = Array.from(markTags || []).some((m) => m.textContent?.toLowerCase() === 'telegram');
    assert.ok(hasTelegramMark, 'Mark tag must wrap "telegram" query text');

    // 4.2 Search for "timeout"
    exports.applySearchFilter('timeout');
    const timingCard = document.getElementById('sectionTimingControls');
    assert.ok(timingCard?.classList.contains('search-match'), 'Timing controls card must match "timeout"');
    assert.strictEqual(document.getElementById('tab-automation')?.style.display, 'block', 'tab-automation pane must be displayed');

    // 4.3 Clear search
    exports.applySearchFilter('');

    // Verify all highlights cleaned up
    const remainingMarks = document.querySelectorAll('mark.search-highlight');
    assert.strictEqual(remainingMarks.length, 0, 'All search highlights must be cleared on empty query');

    const elementsWithOrigHtml = document.querySelectorAll('[data-orig-html]');
    assert.strictEqual(elementsWithOrigHtml.length, 0, 'All data-orig-html cache attributes must be cleaned up');

    // Verify normal active tab filtering is restored
    assert.strictEqual(document.getElementById('tab-dispatch')?.style.display, 'block', 'Active tab pane must be visible');
    assert.strictEqual(document.getElementById('tab-telegram')?.style.display, 'none', 'Non-active pane must be hidden');
    assert.strictEqual(clearBtn.classList.contains('hidden'), true, 'Clear button must be hidden after reset');

    console.log('  ✓ Instant search accurately filters, highlights text leaf nodes, and cleanly resets.');
  }

  // -------------------------------------------------------------------------
  // Test Suite 5: Debounced Auto-Saving & Optimistic Status Transitions
  // -------------------------------------------------------------------------
  console.log('\n[Suite 5] Verifying debounced auto-save (300ms) and status badge transitions...');
  {
    const { document, mockVsCode, exports } = setupTestDom();

    const saveStatusText = document.getElementById('saveStatusText');
    const btnSave = document.getElementById('btnSave') as HTMLButtonElement;
    const txtDelayMs = document.getElementById('txtDelayMs') as HTMLInputElement;

    assert.ok(saveStatusText, '#saveStatusText must exist');
    assert.ok(btnSave, '#btnSave must exist');
    assert.ok(txtDelayMs, '#txtDelayMs must exist');
    assert.strictEqual(saveStatusText?.textContent, 'All changes saved ✓');

    // 5.1 Modify an input value
    txtDelayMs.value = '4500';
    txtDelayMs.dispatchEvent(new (document.defaultView as any).Event('input', { bubbles: true }));

    // Status immediately transitions to "Saving changes..."
    assert.strictEqual(saveStatusText?.textContent, 'Saving changes...', 'Status must immediately indicate Saving changes...');
    assert.ok(saveStatusText?.classList.contains('saving'), 'Status must have .saving class');
    assert.ok(exports.getAutoSaveTimer(), 'Debounce timer must be active');

    // 5.2 Rapid secondary edit should reset debounce timer
    const prevTimer = exports.getAutoSaveTimer();
    const txtRepeatCount = document.getElementById('txtRepeatCount') as HTMLInputElement;
    txtRepeatCount.value = '12';
    txtRepeatCount.dispatchEvent(new (document.defaultView as any).Event('input', { bubbles: true }));

    const newTimer = exports.getAutoSaveTimer();
    assert.notStrictEqual(prevTimer, newTimer, 'Secondary input must reset debounce timer');

    // Verify no save message has been dispatched prematurely
    assert.strictEqual(
      mockVsCode.postedMessages.filter((m) => m.command === 'saveSettings').length,
      0,
      'No saveSettings message before debounce expiry'
    );

    // 5.3 Trigger auto-save directly (simulating 300ms debounce expiration)
    exports.triggerAutoSave();

    const saveMessages = mockVsCode.postedMessages.filter((m) => m.command === 'saveSettings');
    assert.strictEqual(saveMessages.length, 1, 'Exactly one saveSettings message must be posted');
    assert.strictEqual(saveMessages[0].settings.delayBetweenLoopsMs, 4500, 'Saved settings must contain modified delay');
    assert.strictEqual(saveMessages[0].settings.repeatCount, 12, 'Saved settings must contain modified repeatCount');

    // 5.4 Extension Host responds with saveConfirmed
    const messageEvent = new (document.defaultView as any).MessageEvent('message', {
      data: { command: 'saveConfirmed' }
    });
    document.defaultView?.dispatchEvent(messageEvent);

    assert.strictEqual(saveStatusText?.textContent, 'All changes saved ✓', 'Status must transition to All changes saved ✓');
    assert.ok(saveStatusText?.classList.contains('saved'), 'Status must have .saved class');
    assert.strictEqual(btnSave.disabled, true, 'btnSave must be disabled when clean');

    // 5.5 Force save button fallback
    txtDelayMs.value = '8000';
    txtDelayMs.dispatchEvent(new (document.defaultView as any).Event('input', { bubbles: true }));
    btnSave.click();

    const secondSaveMessages = mockVsCode.postedMessages.filter((m) => m.command === 'saveSettings');
    assert.strictEqual(secondSaveMessages.length, 2, 'Force save button must immediately dispatch saveSettings');
    assert.strictEqual(secondSaveMessages[1].settings.delayBetweenLoopsMs, 8000);

    console.log('  ✓ Debounced auto-save (300ms) and force-save fallback validated with optimistic UI.');
  }

  console.log('\n================================================================');
  console.log(' ✓ All Phase 03 Tab Navigation & Search UI Tests Passed! (100%)');
  console.log('================================================================\n');
}

runPhase03SettingsTabNavigationTest().catch((err) => {
  console.error('\n❌ Phase 03 Test Suite Failed:', err);
  process.exit(1);
});
