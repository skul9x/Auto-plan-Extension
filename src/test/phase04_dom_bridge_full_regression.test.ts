// Standalone mock for 'vscode' module when run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (_section: string) => ({
          get: (_key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      env: {
        clipboard: {
          writeText: async (_text: string) => {},
          readText: async () => ''
        }
      },
      window: {
        showErrorMessage: async () => undefined,
        showInformationMessage: async () => undefined
      },
      commands: {
        executeCommand: async () => undefined
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  injectWorkbenchHtml,
  installBridgeScript,
  uninstallBridgeScript,
  getInjectionStatus,
  isBridgeInstalled,
  TAG_START,
  TAG_END,
  DEFAULT_BRIDGE_SCRIPT_NAME
} from '../workbenchInjector';
import { Orchestrator, PhaseItem, OrchestratorProgressInfo } from '../orchestrator';
import { KeyboardManager } from '../keyboardManager';
import { PromptDispatcher } from '../promptDispatcher';
import { TranscriptWatcher, CompletionResult } from '../transcriptWatcher';
import { AutoPlanConfig, DEFAULT_COMPLETION_KEYWORD } from '../config';

// ----------------------------------------------------------------------------
// Helper Functions & Mock DOM for DOM Bridge Single-Submit Verification
// ----------------------------------------------------------------------------

function createTempDir(prefix: string): string {
  const dir = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

function loadDomBridge() {
  const candidatePaths = [
    path.resolve(__dirname, '../../media/autoplan-dom-bridge.js'),
    path.resolve(__dirname, '../media/autoplan-dom-bridge.js'),
    path.resolve(process.cwd(), 'media/autoplan-dom-bridge.js')
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return require(p);
    }
  }
  throw new Error('Could not find media/autoplan-dom-bridge.js');
}

class MockClassList {
  private classes: Set<string> = new Set();

  constructor(className: string = '') {
    if (className) {
      className.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
    }
  }

  add(...tokens: string[]) {
    tokens.forEach(t => this.classes.add(t));
  }

  remove(...tokens: string[]) {
    tokens.forEach(t => this.classes.delete(t));
  }

  contains(token: string): boolean {
    return this.classes.has(token);
  }

  toString() {
    return Array.from(this.classes).join(' ');
  }
}

class MockEvent {
  public type: string;
  public bubbles: boolean;
  public cancelable: boolean;
  public composed: boolean;
  public target: any = null;

  constructor(type: string, options: any = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    this.composed = Boolean(options.composed);
  }
}

class MockInputEvent extends MockEvent {
  public inputType: string;
  public data: string;

  constructor(type: string, options: any = {}) {
    super(type, options);
    this.inputType = options.inputType || '';
    this.data = options.data || '';
  }
}

class MockMouseEvent extends MockEvent {
  public button: number;

  constructor(type: string, options: any = {}) {
    super(type, options);
    this.button = options.button !== undefined ? options.button : 0;
  }
}

class MockPointerEvent extends MockMouseEvent {
  constructor(type: string, options: any = {}) {
    super(type, options);
  }
}

class MockKeyboardEvent extends MockEvent {
  public key: string;
  public code: string;
  public keyCode: number;
  public which: number;
  public shiftKey: boolean;
  public ctrlKey: boolean;
  public altKey: boolean;
  public metaKey: boolean;

  constructor(type: string, options: any = {}) {
    super(type, options);
    this.key = options.key || '';
    this.code = options.code || '';
    this.keyCode = options.keyCode || (options.key === 'Enter' ? 13 : 0);
    this.which = options.which || this.keyCode;
    this.shiftKey = Boolean(options.shiftKey);
    this.ctrlKey = Boolean(options.ctrlKey);
    this.altKey = Boolean(options.altKey);
    this.metaKey = Boolean(options.metaKey);
  }
}

class MockElement {
  public tagName: string;
  public id: string = '';
  public attributes: Map<string, string> = new Map();
  public classList: MockClassList;
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public parentNode: MockElement | null = null;
  public ownerDocument: MockDocument | null = null;
  public textContent: string = '';
  public value: string = '';
  public disabled: boolean = false;
  public clicked: boolean = false;
  public clickCount: number = 0;
  public dispatchedEvents: MockEvent[] = [];
  public rect = { width: 100, height: 30, top: 10, left: 10, right: 110, bottom: 40 };

  constructor(tagName: string, className: string = '') {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList(className);
  }

  get className(): string {
    return this.classList.toString();
  }

  set className(val: string) {
    this.classList = new MockClassList(val);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name.toLowerCase(), value);
    if (name.toLowerCase() === 'id') this.id = value;
    if (name.toLowerCase() === 'class') this.className = value;
    if (name.toLowerCase() === 'disabled') this.disabled = true;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name.toLowerCase()) || null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name.toLowerCase());
  }

  removeAttribute(name: string) {
    this.attributes.delete(name.toLowerCase());
    if (name.toLowerCase() === 'disabled') this.disabled = false;
    if (name.toLowerCase() === 'id') this.id = '';
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  click() {
    this.clicked = true;
    this.clickCount++;
    this.dispatchEvent(new MockMouseEvent('click', { bubbles: true, cancelable: true }));
  }

  focus() {
    this.dispatchEvent(new MockEvent('focus', { bubbles: false }));
  }

  getBoundingClientRect() {
    return this.rect;
  }

  dispatchEvent(event: MockEvent): boolean {
    event.target = this;
    this.dispatchedEvents.push(event);
    return true;
  }

  querySelector(selector: string): MockElement | null {
    const list = this.querySelectorAll(selector);
    return list.length > 0 ? list[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const traverse = (node: MockElement) => {
      for (const child of node.children) {
        if (child.matches(selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (curr.matches(selector)) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  matches(selector: string): boolean {
    const parts = selector.split(',').map(s => s.trim());
    for (const p of parts) {
      if (this.matchesSingle(p)) return true;
    }
    return false;
  }

  private matchesSingle(sel: string): boolean {
    if (!sel) return false;
    if (sel.includes(' ')) {
      const segs = sel.split(/\s+/);
      return this.matchesSingle(segs[segs.length - 1]);
    }

    let remaining = sel;
    if (/^[A-Z0-9_-]+/i.test(remaining)) {
      const tagMatch = remaining.match(/^[A-Z0-9_-]+/i);
      if (tagMatch) {
        if (this.tagName !== tagMatch[0].toUpperCase()) return false;
        remaining = remaining.slice(tagMatch[0].length);
      }
    }

    const classMatches = remaining.match(/\.([A-Z0-9_-]+)/gi);
    if (classMatches) {
      for (const cm of classMatches) {
        const cName = cm.slice(1);
        if (!this.classList.contains(cName)) return false;
        remaining = remaining.replace(cm, '');
      }
    }

    const attrMatches = remaining.match(/\[([A-Z0-9_-]+)([*^$]?=)?([^\]]*)\]/gi);
    if (attrMatches) {
      for (const am of attrMatches) {
        const parsed = am.match(/\[([A-Z0-9_-]+)([*^$]?=)?['"]?([^\]'"]*)['"]?\]/i);
        if (parsed) {
          const attrName = parsed[1].toLowerCase();
          const op = parsed[2] || '';
          const attrVal = parsed[3] || '';
          const actualVal = this.getAttribute(attrName);
          if (actualVal === null) return false;
          if (op === '=' && actualVal !== attrVal) return false;
          if (op === '*=' && !actualVal.includes(attrVal)) return false;
          if (op === '^=' && !actualVal.startsWith(attrVal)) return false;
          if (op === '$=' && !actualVal.endsWith(attrVal)) return false;
        }
        remaining = remaining.replace(am, '');
      }
    }

    return true;
  }
}

class MockDocument {
  public body: MockElement;
  public documentElement: MockElement;
  public activeElement: MockElement | null = null;
  public hidden: boolean = false;

  constructor() {
    this.documentElement = new MockElement('HTML');
    this.documentElement.ownerDocument = this;
    this.body = new MockElement('BODY');
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }

  createElement(tagName: string): MockElement {
    const el = new MockElement(tagName);
    el.ownerDocument = this;
    return el;
  }

  querySelector(selector: string): MockElement | null {
    if (this.documentElement.matches(selector)) return this.documentElement;
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    if (this.documentElement.matches(selector)) results.push(this.documentElement);
    results.push(...this.documentElement.querySelectorAll(selector));
    return results;
  }

  getElementById(id: string): MockElement | null {
    const list = this.querySelectorAll(`#${id}`);
    return list.length > 0 ? list[0] : null;
  }

  execCommand(_command: string, _showUI?: boolean, _value?: any): boolean {
    return true;
  }
}

function createMockWindow() {
  return {
    PointerEvent: MockPointerEvent,
    MouseEvent: MockMouseEvent,
    KeyboardEvent: MockKeyboardEvent,
    InputEvent: MockInputEvent,
    Event: MockEvent,
    getComputedStyle: (_el: any) => ({ display: 'block', visibility: 'visible' })
  };
}

function writeTranscriptStep(
  brainDir: string,
  convId: string,
  step: any
): void {
  const convLogsDir = path.join(brainDir, convId, '.system_generated', 'logs');
  fs.mkdirSync(convLogsDir, { recursive: true });
  const transcriptPath = path.join(convLogsDir, 'transcript.jsonl');
  fs.appendFileSync(transcriptPath, JSON.stringify(step) + '\n', 'utf-8');
}

// ----------------------------------------------------------------------------
// Comprehensive Phase 04 Regression Test Suite
// ----------------------------------------------------------------------------

async function runPhase04RegressionSuite() {
  console.log('=== Running Phase 04: Full DOM Bridge Regression & Cache Invalidation Test Suite ===\n');

  // ==========================================================================
  // Section 1: Workbench Injector Cache Invalidation & Script Copy Mechanics
  // ==========================================================================
  console.log('[Test 1] Verifying Workbench Injector Cache-Busting, Script Copy, and Diagnostic Status...');
  const tempWbDir = createTempDir('autoplan_wb_injector_test');
  const mockWbHtml = path.join(tempWbDir, 'workbench.html');
  const initialHtml = `<!DOCTYPE html>
<html>
<head><title>VS Code / Antigravity IDE</title></head>
<body>
  <div id="workbench.main.container"></div>
</body>
</html>`;
  fs.writeFileSync(mockWbHtml, initialHtml, 'utf8');

  // 1.1 Initial status check: bridge not yet installed
  const initialStatus = getInjectionStatus({ workbenchPath: mockWbHtml });
  assert.strictEqual(initialStatus.isInstalled, false, 'Initially isInstalled should be false');
  assert.strictEqual(initialStatus.tagPresent, false, 'Initially tagPresent should be false');
  assert.strictEqual(initialStatus.scriptFileExists, false, 'Initially scriptFileExists should be false');

  // 1.2 Inject workbench HTML with timestamp
  const ts1 = 1700000001000;
  const injectRes1 = injectWorkbenchHtml({
    workbenchPath: mockWbHtml,
    timestamp: ts1
  });
  assert.strictEqual(injectRes1.success, true, 'First injection should succeed');

  const contentAfterInject1 = fs.readFileSync(mockWbHtml, 'utf8');
  assert.strictEqual(contentAfterInject1.includes(TAG_START), true, 'TAG_START must be present');
  assert.strictEqual(contentAfterInject1.includes(TAG_END), true, 'TAG_END must be present');
  assert.strictEqual(contentAfterInject1.includes(`?v=${ts1}`), true, `Query string ?v=${ts1} must be present`);

  const statusAfterInject1 = getInjectionStatus({ workbenchPath: mockWbHtml });
  assert.strictEqual(statusAfterInject1.isInstalled, true, 'Status isInstalled must be true');
  assert.strictEqual(statusAfterInject1.tagPresent, true, 'Status tagPresent must be true');
  assert.strictEqual(statusAfterInject1.scriptFileExists, true, 'Status scriptFileExists must be true');
  assert.strictEqual(statusAfterInject1.versionTimestamp, String(ts1), 'Status versionTimestamp must match ts1');

  // Verify physical script file copy
  const targetScriptPath = path.join(tempWbDir, DEFAULT_BRIDGE_SCRIPT_NAME);
  assert.strictEqual(fs.existsSync(targetScriptPath), true, 'Physical script file must exist in workbench directory');
  const copiedContent1 = fs.readFileSync(targetScriptPath, 'utf8');
  assert.strictEqual(copiedContent1.length > 50, true, 'Copied script file must contain bridge code');

  // 1.3 Cache Invalidation with fresh timestamp
  const ts2 = 1700000099000;
  const injectRes2 = installBridgeScript({
    workbenchPath: mockWbHtml,
    timestamp: ts2,
    forceReinject: true
  });
  assert.strictEqual(injectRes2.success, true, 'Re-injection with new timestamp should succeed');

  const contentAfterInject2 = fs.readFileSync(mockWbHtml, 'utf8');
  assert.strictEqual(contentAfterInject2.includes(`?v=${ts2}`), true, `Updated query string ?v=${ts2} must be present`);
  assert.strictEqual(contentAfterInject2.includes(`?v=${ts1}`), false, `Old query string ?v=${ts1} must be stripped`);

  const statusAfterInject2 = getInjectionStatus({ workbenchPath: mockWbHtml });
  assert.strictEqual(statusAfterInject2.versionTimestamp, String(ts2), 'Status versionTimestamp must be updated to ts2');

  // 1.4 Uninstallation cleanup
  const uninstallRes = uninstallBridgeScript({ workbenchPath: mockWbHtml });
  assert.strictEqual(uninstallRes.success, true, 'Uninstallation should succeed');
  assert.strictEqual(isBridgeInstalled(mockWbHtml), false, 'isBridgeInstalled must return false after uninstallation');
  assert.strictEqual(fs.existsSync(targetScriptPath), false, 'Physical script file should be removed upon uninstallation');

  console.log('  -> Passed: Workbench Injector cache invalidation and status checks verified.\n');

  // ==========================================================================
  // Section 2: DOM Bridge Single-Submit Strategy Verification
  // ==========================================================================
  console.log('[Test 2] Verifying DOM Bridge Single-Submit Execution (Zero Enter Key Dispatched)...');
  const domBridge = loadDomBridge();
  assert.ok(domBridge, 'DOM Bridge module must be loaded');

  const doc = new MockDocument();
  const win = createMockWindow();

  const container = doc.createElement('div');
  container.setAttribute('id', 'antigravity.agentSidePanelInputBox');
  doc.body.appendChild(container);

  const inputElem = doc.createElement('div');
  inputElem.setAttribute('data-lexical-editor', 'true');
  inputElem.setAttribute('contenteditable', 'true');
  container.appendChild(inputElem);

  const sendBtn = doc.createElement('button');
  sendBtn.setAttribute('data-testid', 'send-button');
  sendBtn.setAttribute('aria-label', 'Send message');
  sendBtn.disabled = false;
  container.appendChild(sendBtn);

  const submitResult = await domBridge.injectPromptAndSubmit('Implement comprehensive regression suite', {
    document: doc,
    window: win,
    syncDelayMs: 0,
    pollTimeoutMs: 50
  });

  assert.strictEqual(submitResult.success, true, 'Submit result success must be true');
  assert.strictEqual(submitResult.sendButtonClicked, true, 'sendButtonClicked must be true');
  assert.strictEqual(submitResult.enterDispatched, false, 'enterDispatched must be strictly false');
  assert.strictEqual(submitResult.submitStrategy, 'buttonClick', 'submitStrategy must be buttonClick');
  assert.strictEqual(sendBtn.clicked, true, 'Send button click() must have been called');

  // Verify that ZERO keyboard events were dispatched to inputElem
  const inputKbEvents = inputElem.dispatchedEvents.filter(
    e => e instanceof MockKeyboardEvent || e.type === 'keydown' || e.type === 'keypress' || e.type === 'keyup'
  );
  assert.strictEqual(
    inputKbEvents.length,
    0,
    'Single-submit policy violation: Zero Keyboard Enter events should be dispatched when Send Button is present'
  );

  console.log('  -> Passed: DOM Bridge single-submit executed with zero redundant Enter events.\n');

  // ==========================================================================
  // Section 3: Transcript Watcher Multi-Conversation Sync & No Ghost Hangs
  // ==========================================================================
  console.log('[Test 3] Verifying Transcript Watcher Multi-Conversation Sync (Duplicate/Ghost Immunity)...');
  const brainDir = createTempDir('autoplan_brain_sync_test');
  const sinceTimestamp = Date.now() - 1000;

  // Stalled Ghost Conversation (0 bytes)
  const ghostConvId = 'ghost_conv_123';
  const ghostLogs = path.join(brainDir, ghostConvId, '.system_generated', 'logs');
  fs.mkdirSync(ghostLogs, { recursive: true });
  const ghostTranscript = path.join(ghostLogs, 'transcript.jsonl');
  fs.writeFileSync(ghostTranscript, '', 'utf-8');

  // Active Target Conversation
  const activeConvId = 'active_conv_456';
  const activeLogs = path.join(brainDir, activeConvId, '.system_generated', 'logs');
  fs.mkdirSync(activeLogs, { recursive: true });
  const activeTranscript = path.join(activeLogs, 'transcript.jsonl');
  fs.writeFileSync(activeTranscript, '', 'utf-8');

  const watcher = new TranscriptWatcher({
    brainDir,
    keyword: DEFAULT_COMPLETION_KEYWORD,
    pollIntervalMs: 25,
    arbitrationTimeoutMs: 100, // Rapid arbitration for test
    settleQuietPeriodMs: 40,
    timeoutMs: 4000,
    sinceTimestamp
  });

  let reboundDetected = false;
  watcher.on('conversationRebound', (_oldId, newId) => {
    reboundDetected = true;
    assert.strictEqual(newId, activeConvId, 'Rebounded conversation ID must match active stream');
  });

  // Watch the stalled ghost transcript
  const watchPromise = watcher.watchFile(ghostTranscript, ghostConvId, 0, sinceTimestamp);

  // Concurrently emit steps in the active sibling conversation
  setTimeout(() => {
    writeTranscriptStep(brainDir, activeConvId, {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'IN_PROGRESS',
      content: 'Working on phase 1 in active session...'
    });

    setTimeout(() => {
      writeTranscriptStep(brainDir, activeConvId, {
        step_index: 2,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: null,
        content: `Phase 01 completed successfully. ${DEFAULT_COMPLETION_KEYWORD}`
      });
    }, 60);
  }, 120);

  const completionResult = await watchPromise;
  assert.strictEqual(completionResult.success, true, 'Watcher must succeed after arbitrating to active conversation');
  assert.strictEqual(completionResult.conversationId, activeConvId, 'Must match active conversation ID');
  assert.ok(
    completionResult.matchedContent?.includes(DEFAULT_COMPLETION_KEYWORD),
    'Matched content must include completion keyword'
  );
  assert.strictEqual(reboundDetected, true, 'conversationRebound event must have been triggered');

  watcher.dispose();
  console.log('  -> Passed: Transcript Watcher synced properly without ghost conversation interference.\n');

  // ==========================================================================
  // Section 4: Orchestrator End-to-End Multi-Phase Loop Progression
  // ==========================================================================
  console.log('[Test 4] Verifying Orchestrator End-to-End Progression on "Done skul9x."...');
  const e2eDir = createTempDir('autoplan_e2e_orch');
  const plansDir = path.join(e2eDir, 'plans');
  const e2eBrainDir = path.join(e2eDir, 'brain');
  fs.mkdirSync(plansDir, { recursive: true });
  fs.mkdirSync(e2eBrainDir, { recursive: true });

  const phaseFile1 = path.join(plansDir, 'phase-01-core.md');
  const phaseFile2 = path.join(plansDir, 'phase-02-next.md');
  fs.writeFileSync(phaseFile1, '# Phase 01: Core Setup\nTask 1', 'utf8');
  fs.writeFileSync(phaseFile2, '# Phase 02: Next Setup\nTask 2', 'utf8');

  const testConfig: AutoPlanConfig = {
    promptText: 'Execute {path}',
    promptTemplate: 'Execute phase file {path} and output Done skul9x.',
    repeatCount: 1,
    completionKeyword: DEFAULT_COMPLETION_KEYWORD,
    delayBetweenLoopsMs: 40,
    timeoutPerLoopMinutes: 1,
    defaultPlanFolder: plansDir,
    executionMode: 'domBridge'
  };

  let phaseIndex = 0;
  const dispatchedPrompts: string[] = [];
  const mockKeyboard = new KeyboardManager({
    focusDelayMs: 2,
    selectDelayMs: 2,
    pasteDelayMs: 2,
    submitDelayMs: 2,
    customKeySender: async () => {},
    customClipboardSetter: async (text) => {
      dispatchedPrompts.push(text);
    },
    customBatchSender: async () => {}
  });

  const mockDispatcher = new PromptDispatcher({
    keyboardManager: mockKeyboard,
    configProvider: () => testConfig
  });

  // Mock prompt dispatcher dispatch to emit corresponding transcript steps
  mockDispatcher.dispatchPrompt = async (promptText: string) => {
    phaseIndex++;
    dispatchedPrompts.push(promptText);

    const activeConv = `conv_orch_phase_${phaseIndex}`;
    setTimeout(() => {
      writeTranscriptStep(e2eBrainDir, activeConv, {
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: [],
        content: `Phase ${phaseIndex} completed successfully! ${DEFAULT_COMPLETION_KEYWORD}`
      });
    }, 80);

    return {
      success: true,
      tier: 'domBridge',
      durationMs: 10
    };
  };

  const orchWatcher = new TranscriptWatcher({
    brainDir: e2eBrainDir,
    keyword: DEFAULT_COMPLETION_KEYWORD,
    pollIntervalMs: 20,
    arbitrationTimeoutMs: 100,
    settleQuietPeriodMs: 40,
    timeoutMs: 5000
  });

  const phaseCompleteEvents: PhaseItem[] = [];
  const orchestrator = new Orchestrator({
    configProvider: () => testConfig,
    keyboardManager: mockKeyboard,
    transcriptWatcher: orchWatcher,
    promptDispatcher: mockDispatcher,
    onPhaseComplete: (phase: PhaseItem) => {
      phaseCompleteEvents.push({ ...phase });
    }
  });

  // Start executing plan folder
  const runResult = await orchestrator.startFolder(plansDir);

  assert.strictEqual(runResult, true, 'startFolder must return true on completion');
  assert.strictEqual(orchestrator.getState(), 'completed', 'Orchestrator state must be completed');

  const phases = orchestrator.getPhases();
  assert.strictEqual(phases.length, 2, 'Must have executed exactly 2 phases');
  assert.strictEqual(phases[0].status, 'Completed', 'Phase 1 status must be Completed');
  assert.strictEqual(phases[1].status, 'Completed', 'Phase 2 status must be Completed');
  assert.strictEqual(phaseCompleteEvents.length, 2, '2 phase complete events must have fired');

  orchestrator.dispose();
  orchWatcher.dispose();

  console.log('  -> Passed: Orchestrator end-to-end multi-phase loop executed seamlessly.\n');

  // Cleanup temporary directories
  cleanupDir(tempWbDir);
  cleanupDir(brainDir);
  cleanupDir(e2eDir);

  console.log('=== All Phase 04 Regression Tests Passed Successfully (100%) ===\n');
}

// Execute tests
runPhase04RegressionSuite().catch((err) => {
  console.error('\n❌ Phase 04 Regression Test Failed:', err);
  process.exit(1);
});
