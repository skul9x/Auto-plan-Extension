import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

// Helper class to mock DOM elements in Node.js VM context
class MockClassList {
  private classes: Set<string> = new Set();

  constructor(initial: string = '') {
    if (initial) {
      initial.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
    }
  }

  add(c: string) {
    this.classes.add(c);
  }

  remove(c: string) {
    this.classes.delete(c);
  }

  contains(c: string): boolean {
    return this.classes.has(c);
  }

  toString(): string {
    return Array.from(this.classes).join(' ');
  }
}

class MockElement {
  public id: string = '';
  public tagName: string = 'DIV';
  public value: string = '';
  public checked: boolean = false;
  public disabled: boolean = false;
  public textContent: string = '';
  public classList: MockClassList;
  public selectionStart: number = 0;
  public selectionEnd: number = 0;
  public attributes: Record<string, string> = {};
  public children: MockElement[] = [];
  public parent: MockElement | null = null;
  private listeners: Record<string, Function[]> = {};

  constructor(id: string = '', tagName: string = 'DIV') {
    this.id = id;
    this.tagName = tagName;
    this.classList = new MockClassList();
  }

  get className(): string {
    return this.classList.toString();
  }

  set className(val: string) {
    this.classList = new MockClassList(val);
  }

  setAttribute(name: string, val: string) {
    this.attributes[name] = val;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  appendChild(child: MockElement) {
    child.parent = this;
    this.children.push(child);
  }

  addEventListener(event: string, handler: Function) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(handler);
  }

  dispatchEvent(event: { type: string; [key: string]: any; preventDefault?: () => void }) {
    if (!event.preventDefault) {
      event.preventDefault = () => {};
    }
    const handlers = this.listeners[event.type] || [];
    for (const h of handlers) {
      h(event);
    }
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  focus() {}

  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  querySelector(selector: string): MockElement | null {
    // Basic selector matching for mock DOM
    for (const child of this.children) {
      if (matchesSelector(child, selector)) {
        return child;
      }
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    for (const child of this.children) {
      if (matchesSelector(child, selector)) {
        results.push(child);
      }
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }
}

function matchesSelector(el: MockElement, selector: string): boolean {
  if (selector.startsWith('#')) {
    return el.id === selector.substring(1);
  }
  if (selector.startsWith('.')) {
    return el.classList.contains(selector.substring(1));
  }
  if (selector.includes('[name="executionMode"]')) {
    if (el.getAttribute('name') === 'executionMode') {
      if (selector.includes('[value="')) {
        const match = selector.match(/\[value="([^"]+)"\]/);
        return match ? el.value === match[1] : true;
      }
      if (selector.includes(':checked')) {
        return el.checked;
      }
      return true;
    }
    return false;
  }
  if (selector === 'input[type="radio"]') {
    return el.tagName === 'INPUT' && el.getAttribute('type') === 'radio';
  }
  return false;
}

function buildMockDocument(elementsById: Record<string, MockElement>) {
  const root = new MockElement('root', 'BODY');
  for (const el of Object.values(elementsById)) {
    root.appendChild(el);
  }

  return {
    getElementById: (id: string) => elementsById[id] || null,
    querySelector: (sel: string) => {
      if (sel.startsWith('#')) {
        return elementsById[sel.substring(1)] || null;
      }
      return root.querySelector(sel);
    },
    querySelectorAll: (sel: string) => {
      if (sel.startsWith('.')) {
        const cls = sel.substring(1);
        return Object.values(elementsById).filter(el => el.classList.contains(cls));
      }
      return root.querySelectorAll(sel);
    },
    body: root
  };
}

async function runPhase02TestSuite() {
  console.log('=== Running Phase 02: Full-Screen Settings Panel Webview UI & Assets Tests ===\n');

  const rootDir = path.resolve(__dirname, '../../');
  const mediaSettingsDir = path.join(rootDir, 'media', 'settings');
  const htmlPath = path.join(mediaSettingsDir, 'settings.html');
  const cssPath = path.join(mediaSettingsDir, 'settings.css');
  const jsPath = path.join(mediaSettingsDir, 'settings.js');

  try {
    // --------------------------------------------------------------------------
    // Test 1: HTML Structure & CSP Compatibility
    // --------------------------------------------------------------------------
    console.log('[Test 1] Verifying HTML Structure & Content Security Policy (CSP)...');
    {
      assert.strictEqual(fs.existsSync(htmlPath), true, 'settings.html must exist in media/settings/');
      assert.strictEqual(fs.existsSync(cssPath), true, 'settings.css must exist in media/settings/');
      assert.strictEqual(fs.existsSync(jsPath), true, 'settings.js must exist in media/settings/');

      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      // Required IDs specified in Phase 02 section 4.1
      const requiredIds = [
        'optTierAuto',
        'optTier1',
        'optTier2',
        'optTier3',
        'chkAllowFallback',
        'txtDelayMs',
        'txtTimeoutMinutes',
        'txtPromptTemplate',
        'txtCompletionKeyword',
        'btnSave',
        'btnReset',
        'btnTestTier'
      ];

      for (const id of requiredIds) {
        assert.ok(
          htmlContent.includes(`id="${id}"`),
          `settings.html must contain element with id="${id}"`
        );
      }

      // Additional UI controls check
      const additionalIds = [
        'txtRepeatCount',
        'txtFocusDelayMs',
        'txtBridgeTimeoutMs',
        'txtDefaultPlanFolder',
        'btnBrowseFolder',
        'chkAutoApprovePermissions',
        'chkAutoInjectWorkbench',
        'chkSuppressFallbackWarnings',
        'btnSetupBridge',
        'btnUninstallBridge',
        'btnPresetKeyword',
        'testTierBadge',
        'testTierSpinner',
        'healthPort',
        'healthInjected',
        'healthClients',
        'healthToolchain',
        'overallHealthBadge',
        'saveStatusText',
        'toastNotification'
      ];

      for (const id of additionalIds) {
        assert.ok(
          htmlContent.includes(`id="${id}"`),
          `settings.html should contain secondary element with id="${id}"`
        );
      }

      // CSP Verification
      assert.ok(
        htmlContent.includes('Content-Security-Policy'),
        'settings.html must declare a Content-Security-Policy meta tag'
      );
      assert.ok(
        htmlContent.includes("default-src 'none'"),
        'CSP must set default-src to none'
      );
      assert.ok(
        htmlContent.includes("script-src 'nonce-${nonce}'"),
        'CSP must restrict scripts using nonce'
      );
      assert.ok(
        htmlContent.includes('${webview.cspSource}'),
        'CSP must allow resources from webview.cspSource'
      );

      // Verify absence of unsafe inline scripts or script bodies
      const scriptMatches = htmlContent.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
      assert.ok(scriptMatches && scriptMatches.length > 0, 'settings.html must include script tags');
      for (const tag of scriptMatches) {
        // Must reference external script with nonce
        assert.ok(tag.includes('nonce="${nonce}"'), 'All script tags must have nonce="${nonce}"');
        assert.ok(tag.includes('src="${scriptUri}"'), 'Script tag must point to external ${scriptUri}');
        const inner = tag.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '').trim();
        assert.strictEqual(inner, '', 'Script tags must not contain inline JavaScript');
      }

      // Verify no inline event attributes (onclick, onload, etc.)
      const inlineEventHandlerMatches = htmlContent.match(/\son[a-z]+="[^"]*"/gi);
      assert.strictEqual(
        inlineEventHandlerMatches,
        null,
        'settings.html must not contain inline event handlers (e.g. onclick=)'
      );

      console.log('  ✓ settings.html structure and CSP are 100% compliant.\n');
    }

    // --------------------------------------------------------------------------
    // Test 2: CSS Token Coverage & Responsiveness
    // --------------------------------------------------------------------------
    console.log('[Test 2] Verifying CSS Token Coverage & Responsive Media Queries...');
    {
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      // Check standard VS Code theme token bindings
      const requiredTokens = [
        '--vscode-editor-background',
        '--vscode-editor-foreground',
        '--vscode-button-background',
        '--vscode-button-foreground',
        '--vscode-button-hoverBackground',
        '--vscode-input-background',
        '--vscode-input-foreground',
        '--vscode-input-border',
        '--vscode-focusBorder'
      ];

      for (const token of requiredTokens) {
        assert.ok(
          cssContent.includes(token),
          `settings.css must bind to VS Code theme variable ${token}`
        );
      }

      // Check glassmorphic & visual design properties
      assert.ok(
        cssContent.includes('backdrop-filter') || cssContent.includes('-webkit-backdrop-filter'),
        'settings.css should implement glassmorphic backdrop-filter effects'
      );
      assert.ok(
        cssContent.includes('border-radius'),
        'settings.css should use border-radius for modern card styling'
      );
      assert.ok(
        cssContent.includes('box-shadow'),
        'settings.css should utilize box-shadow for depth'
      );

      // Check responsive grid media queries
      const mediaMatches = cssContent.match(/@media[^{]+\{/gi);
      assert.ok(
        mediaMatches && mediaMatches.length >= 2,
        'settings.css must include responsive @media breakpoints for mobile and tablet adaptation'
      );
      assert.ok(
        cssContent.includes('max-width: 900px'),
        'settings.css must have a tablet breakpoint adapting grid layout'
      );
      assert.ok(
        cssContent.includes('max-width: 600px'),
        'settings.css must have a mobile breakpoint'
      );

      console.log('  ✓ settings.css theme token coverage and responsiveness are 100% compliant.\n');
    }

    // --------------------------------------------------------------------------
    // Test 3: JS Logic, State Tracking & IPC Serialization
    // --------------------------------------------------------------------------
    console.log('[Test 3] Verifying JS State Management, Dirty Checking & IPC Serialization...');
    {
      const jsCode = fs.readFileSync(jsPath, 'utf8');

      // Setup simulated DOM elements matching settings.html
      const elements: Record<string, MockElement> = {
        optTierAuto: new MockElement('optTierAuto', 'INPUT'),
        optTier1: new MockElement('optTier1', 'INPUT'),
        optTier2: new MockElement('optTier2', 'INPUT'),
        optTier3: new MockElement('optTier3', 'INPUT'),
        chkAllowFallback: new MockElement('chkAllowFallback', 'INPUT'),
        txtDelayMs: new MockElement('txtDelayMs', 'INPUT'),
        txtTimeoutMinutes: new MockElement('txtTimeoutMinutes', 'INPUT'),
        txtRepeatCount: new MockElement('txtRepeatCount', 'INPUT'),
        txtFocusDelayMs: new MockElement('txtFocusDelayMs', 'INPUT'),
        txtBridgeTimeoutMs: new MockElement('txtBridgeTimeoutMs', 'INPUT'),
        txtDefaultPlanFolder: new MockElement('txtDefaultPlanFolder', 'INPUT'),
        btnBrowseFolder: new MockElement('btnBrowseFolder', 'BUTTON'),
        chkAutoApprovePermissions: new MockElement('chkAutoApprovePermissions', 'INPUT'),
        chkAutoInjectWorkbench: new MockElement('chkAutoInjectWorkbench', 'INPUT'),
        chkSuppressFallbackWarnings: new MockElement('chkSuppressFallbackWarnings', 'INPUT'),
        txtPromptTemplate: new MockElement('txtPromptTemplate', 'TEXTAREA'),
        txtCompletionKeyword: new MockElement('txtCompletionKeyword', 'INPUT'),
        btnPresetKeyword: new MockElement('btnPresetKeyword', 'BUTTON'),
        btnTestTier: new MockElement('btnTestTier', 'BUTTON'),
        testTierSpinner: new MockElement('testTierSpinner', 'SPAN'),
        testTierBadge: new MockElement('testTierBadge', 'SPAN'),
        btnSetupBridge: new MockElement('btnSetupBridge', 'BUTTON'),
        btnUninstallBridge: new MockElement('btnUninstallBridge', 'BUTTON'),
        overallHealthBadge: new MockElement('overallHealthBadge', 'DIV'),
        overallHealthText: new MockElement('overallHealthText', 'SPAN'),
        healthPort: new MockElement('healthPort', 'SPAN'),
        healthInjected: new MockElement('healthInjected', 'SPAN'),
        healthClients: new MockElement('healthClients', 'SPAN'),
        healthToolchain: new MockElement('healthToolchain', 'SPAN'),
        tier1StatusIndicator: new MockElement('tier1StatusIndicator', 'SPAN'),
        tier1ClientsIndicator: new MockElement('tier1ClientsIndicator', 'SPAN'),
        tier2StatusIndicator: new MockElement('tier2StatusIndicator', 'SPAN'),
        tier3StatusIndicator: new MockElement('tier3StatusIndicator', 'SPAN'),
        btnSave: new MockElement('btnSave', 'BUTTON'),
        btnReset: new MockElement('btnReset', 'BUTTON'),
        saveStatusText: new MockElement('saveStatusText', 'SPAN'),
        toastNotification: new MockElement('toastNotification', 'DIV')
      };

      // Set input types and radio attributes
      elements.optTierAuto.setAttribute('type', 'radio');
      elements.optTierAuto.setAttribute('name', 'executionMode');
      elements.optTierAuto.value = 'auto';
      elements.optTierAuto.checked = true;

      elements.optTier1.setAttribute('type', 'radio');
      elements.optTier1.setAttribute('name', 'executionMode');
      elements.optTier1.value = 'domBridge';

      elements.optTier2.setAttribute('type', 'radio');
      elements.optTier2.setAttribute('name', 'executionMode');
      elements.optTier2.value = 'nativeCommand';

      elements.optTier3.setAttribute('type', 'radio');
      elements.optTier3.setAttribute('name', 'executionMode');
      elements.optTier3.value = 'keyboard';

      // Create mock tier cards wrapping radios
      const cardAuto = new MockElement('cardAuto', 'LABEL');
      cardAuto.classList.add('tier-card');
      cardAuto.classList.add('active');
      cardAuto.appendChild(elements.optTierAuto);
      elements['cardAuto'] = cardAuto;

      const card1 = new MockElement('card1', 'LABEL');
      card1.classList.add('tier-card');
      card1.appendChild(elements.optTier1);
      elements['card1'] = card1;

      const card2 = new MockElement('card2', 'LABEL');
      card2.classList.add('tier-card');
      card2.appendChild(elements.optTier2);
      elements['card2'] = card2;

      const card3 = new MockElement('card3', 'LABEL');
      card3.classList.add('tier-card');
      card3.appendChild(elements.optTier3);
      elements['card3'] = card3;

      // Tag helper buttons
      const btnInsertXxx = new MockElement('btnInsertXxx', 'BUTTON');
      btnInsertXxx.classList.add('tag-btn');
      btnInsertXxx.setAttribute('data-tag', '{xxx}');
      elements['btnInsertXxx'] = btnInsertXxx;

      const btnInsertFile = new MockElement('btnInsertFile', 'BUTTON');
      btnInsertFile.classList.add('tag-btn');
      btnInsertFile.setAttribute('data-tag', '{file}');
      elements['btnInsertFile'] = btnInsertFile;

      const btnInsertPath = new MockElement('btnInsertPath', 'BUTTON');
      btnInsertPath.classList.add('tag-btn');
      btnInsertPath.setAttribute('data-tag', '{path}');
      elements['btnInsertPath'] = btnInsertPath;

      const mockDocument = buildMockDocument(elements);
      const postedVsCodeMessages: any[] = [];
      const windowMessageListeners: Function[] = [];

      const mockWindow = {
        addEventListener: (event: string, handler: Function) => {
          if (event === 'message') {
            windowMessageListeners.push(handler);
          }
        },
        dispatchEvent: (msgEvent: any) => {
          for (const listener of windowMessageListeners) {
            listener(msgEvent);
          }
        }
      };

      const mockVsCodeApi = {
        postMessage: (msg: any) => {
          postedVsCodeMessages.push(JSON.parse(JSON.stringify(msg)));
        }
      };

      const sandboxContext = {
        window: mockWindow,
        document: mockDocument,
        acquireVsCodeApi: () => mockVsCodeApi,
        setTimeout: (fn: Function, _ms: number) => fn(),
        clearTimeout: () => {},
        module: { exports: {} },
        console: console
      };

      vm.createContext(sandboxContext);
      vm.runInContext(jsCode, sandboxContext);

      // Verify Step 3.1: initial ready signal sent to extension host
      assert.strictEqual(
        postedVsCodeMessages.length,
        1,
        'On load, settings.js must send exactly 1 ready message'
      );
      assert.deepStrictEqual(
        postedVsCodeMessages[0],
        { command: 'ready' },
        'Initial message must be { command: "ready" }'
      );

      // Verify Step 3.2: processing incoming initSettings message
      console.log('  -> Testing initSettings payload deserialization...');
      mockWindow.dispatchEvent({
        data: {
          command: 'initSettings',
          settings: {
            executionMode: 'nativeCommand',
            allowTierFallback: false,
            delayBetweenLoopsMs: 4500,
            timeoutPerLoopMinutes: 25,
            repeatCount: 8,
            focusDelayMs: 650,
            bridgeTimeoutMs: 7500,
            defaultPlanFolder: 'plans/test-suite',
            promptTemplate: 'Run phase {xxx} carefully',
            promptText: 'Run phase {xxx} carefully',
            completionKeyword: 'Done phase test.',
            autoApprovePermissions: false,
            autoInjectWorkbench: true,
            suppressFallbackWarnings: false
          }
        }
      });

      // Verify form elements reflect incoming settings
      assert.strictEqual(elements.optTier2.checked, true, 'optTier2 should be checked');
      assert.strictEqual(elements.optTierAuto.checked, false, 'optTierAuto should be unchecked');
      assert.strictEqual(card2.classList.contains('active'), true, 'Card 2 should have active class');
      assert.strictEqual(cardAuto.classList.contains('active'), false, 'Card Auto should not have active class');
      assert.strictEqual(elements.chkAllowFallback.checked, false, 'Allow fallback should be false');
      assert.strictEqual(elements.txtDelayMs.value, 4500);
      assert.strictEqual(elements.txtTimeoutMinutes.value, 25);
      assert.strictEqual(elements.txtRepeatCount.value, 8);
      assert.strictEqual(elements.txtFocusDelayMs.value, 650);
      assert.strictEqual(elements.txtBridgeTimeoutMs.value, 7500);
      assert.strictEqual(elements.txtDefaultPlanFolder.value, 'plans/test-suite');
      assert.strictEqual(elements.txtPromptTemplate.value, 'Run phase {xxx} carefully');
      assert.strictEqual(elements.txtCompletionKeyword.value, 'Done phase test.');
      assert.strictEqual(elements.chkAutoApprovePermissions.checked, false);
      assert.strictEqual(elements.chkAutoInjectWorkbench.checked, true);
      assert.strictEqual(elements.chkSuppressFallbackWarnings.checked, false);

      // Verify Save button is disabled when pristine
      assert.strictEqual(elements.btnSave.disabled, true, 'btnSave should be disabled after initSettings');
      assert.strictEqual(elements.saveStatusText.textContent, 'All changes saved');

      // Verify Step 3.3: Dirty checking
      console.log('  -> Testing dirty state tracking on input modification...');
      elements.txtDelayMs.value = '9000';
      elements.txtDelayMs.dispatchEvent({ type: 'input' });

      assert.strictEqual(elements.btnSave.disabled, false, 'btnSave should be enabled when dirty');
      assert.strictEqual(elements.saveStatusText.textContent, 'Unsaved changes');

      // Verify Step 3.4: saveSettings serialization
      console.log('  -> Testing saveSettings serialization...');
      elements.btnSave.click();
      const lastSaveMsg = postedVsCodeMessages[postedVsCodeMessages.length - 1];
      assert.strictEqual(lastSaveMsg.command, 'saveSettings');
      assert.strictEqual(lastSaveMsg.settings.executionMode, 'nativeCommand');
      assert.strictEqual(lastSaveMsg.settings.allowTierFallback, false);
      assert.strictEqual(lastSaveMsg.settings.delayBetweenLoopsMs, 9000);
      assert.strictEqual(lastSaveMsg.settings.defaultPlanFolder, 'plans/test-suite');
      assert.strictEqual(lastSaveMsg.settings.completionKeyword, 'Done phase test.');

      // Verify Step 3.5: saveConfirmed resets dirty state
      console.log('  -> Testing saveConfirmed event...');
      mockWindow.dispatchEvent({ data: { command: 'saveConfirmed' } });
      assert.strictEqual(elements.btnSave.disabled, true, 'btnSave should be disabled after saveConfirmed');
      assert.strictEqual(elements.saveStatusText.textContent, 'All changes saved');
      assert.ok(elements.toastNotification.textContent.includes('saved'), 'Toast should report success');

      // Verify Step 3.6: testTier IPC trigger
      console.log('  -> Testing testTier message...');
      elements.btnTestTier.click();
      const lastTestMsg = postedVsCodeMessages[postedVsCodeMessages.length - 1];
      assert.strictEqual(lastTestMsg.command, 'testTier');
      assert.strictEqual(lastTestMsg.tier, 'nativeCommand');
      assert.strictEqual(elements.testTierSpinner.classList.contains('hidden'), false, 'Spinner should be shown');

      // Verify testResult handling (success)
      mockWindow.dispatchEvent({
        data: {
          command: 'testResult',
          success: true,
          latencyMs: 38
        }
      });
      assert.strictEqual(elements.testTierSpinner.classList.contains('hidden'), true, 'Spinner should hide');
      assert.ok(elements.testTierBadge.textContent.includes('38ms'), 'Latency badge should display 38ms');
      assert.strictEqual(elements.testTierBadge.classList.contains('badge-success'), true);

      // Verify testResult handling (failure)
      mockWindow.dispatchEvent({
        data: {
          command: 'testResult',
          success: false,
          error: 'Bridge connection failed'
        }
      });
      assert.ok(elements.testTierBadge.textContent.includes('Failed: Bridge connection failed'));
      assert.strictEqual(elements.testTierBadge.classList.contains('badge-danger'), true);

      // Verify Step 3.7: setupBridge and uninstallBridge IPC triggers
      console.log('  -> Testing bridge management buttons...');
      elements.btnSetupBridge.click();
      assert.strictEqual(postedVsCodeMessages[postedVsCodeMessages.length - 1].command, 'setupBridge');

      elements.btnUninstallBridge.click();
      assert.strictEqual(postedVsCodeMessages[postedVsCodeMessages.length - 1].command, 'uninstallBridge');

      // Verify Step 3.8: openFolderPicker and folderSelected response
      console.log('  -> Testing folder picker flow...');
      elements.btnBrowseFolder.click();
      assert.strictEqual(postedVsCodeMessages[postedVsCodeMessages.length - 1].command, 'openFolderPicker');

      mockWindow.dispatchEvent({
        data: {
          command: 'folderSelected',
          folderPath: '/custom/workspace/plans'
        }
      });
      assert.strictEqual(elements.txtDefaultPlanFolder.value, '/custom/workspace/plans');

      // Verify Step 3.9: resetSettings button
      elements.btnReset.click();
      assert.strictEqual(postedVsCodeMessages[postedVsCodeMessages.length - 1].command, 'resetSettings');

      // Verify Step 3.10: Template helper tag insertion at cursor position
      console.log('  -> Testing template helper tag insertions...');
      elements.txtPromptTemplate.value = 'Step 1: Execute ';
      elements.txtPromptTemplate.selectionStart = elements.txtPromptTemplate.value.length;
      elements.txtPromptTemplate.selectionEnd = elements.txtPromptTemplate.value.length;

      btnInsertXxx.click();
      assert.strictEqual(elements.txtPromptTemplate.value, 'Step 1: Execute {xxx}');

      elements.txtPromptTemplate.value = 'File:  and path';
      elements.txtPromptTemplate.selectionStart = 6;
      elements.txtPromptTemplate.selectionEnd = 6;
      btnInsertFile.click();
      assert.strictEqual(elements.txtPromptTemplate.value, 'File: {file} and path');

      elements.txtPromptTemplate.selectionStart = elements.txtPromptTemplate.value.length;
      elements.txtPromptTemplate.selectionEnd = elements.txtPromptTemplate.value.length;
      btnInsertPath.click();
      assert.strictEqual(elements.txtPromptTemplate.value, 'File: {file} and path{path}');

      // Verify Step 3.11: Preset keyword button
      console.log('  -> Testing preset keyword button...');
      elements.txtCompletionKeyword.value = 'custom text';
      elements.btnPresetKeyword.click();
      assert.strictEqual(elements.txtCompletionKeyword.value, 'Done skul9x.');

      // Verify Step 3.12: Live Health telemetry update
      console.log('  -> Testing healthUpdate telemetry ingestion...');
      mockWindow.dispatchEvent({
        data: {
          command: 'healthUpdate',
          port: 49153,
          injected: true,
          clients: 2,
          toolchain: 'xdotool-v3.2',
          nativeCommandStatus: 'Registered (OK)',
          isHealthy: true
        }
      });

      assert.strictEqual(elements.healthPort.textContent, '49153');
      assert.strictEqual(elements.healthInjected.textContent, 'Ready');
      assert.strictEqual(elements.healthClients.textContent, '2 clients');
      assert.strictEqual(elements.healthToolchain.textContent, 'xdotool-v3.2');
      assert.strictEqual(elements.tier1StatusIndicator.textContent, 'Port: 49153');
      assert.strictEqual(elements.tier1ClientsIndicator.textContent, 'Clients: 2');
      assert.strictEqual(elements.tier2StatusIndicator.textContent, 'Registered (OK)');
      assert.strictEqual(elements.tier3StatusIndicator.textContent, 'Toolchain: xdotool-v3.2');
      assert.strictEqual(elements.overallHealthText.textContent, 'Engine Ready');

      console.log('  ✓ Client-side JS logic, state tracking, and IPC serialization are 100% compliant.\n');
    }

    console.log('=== All Phase 02 Settings Webview Assets Tests Passed Successfully (100%) ===\n');
  } catch (error) {
    console.error('Phase 02 Test Suite Failed:', error);
    process.exit(1);
  }
}

runPhase02TestSuite();
