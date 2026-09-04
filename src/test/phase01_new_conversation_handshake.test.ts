// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      commands: {
        executeCommand: async (_cmd: string, ..._args: any[]) => undefined
      },
      window: {
        showWarningMessage: (_msg: string) => undefined
      },
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue
        })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

declare const describe: any;
declare const it: any;

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { PromptDispatcher } from '../promptDispatcher';
import { BridgeServer, CommandAckResult } from '../bridgeServer';
import { DebugLogger } from '../debugLogger';
import { AutoPlanConfig } from '../config';

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

class MockElement {
  public tagName: string;
  public attributes: Map<string, string> = new Map();
  public classList: MockClassList;
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public disabled: boolean = false;
  public value: string = '';
  public textContent: string = '';
  public innerText: string = '';
  public innerHTML: string = '';
  public clickCount: number = 0;
  public dispatchedEvents: any[] = [];
  public nodeType: number = 1;

  constructor(tagName: string, className: string = '') {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList(className);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === 'class') {
      this.classList = new MockClassList(value);
    }
    if (name === 'disabled') {
      this.disabled = true;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === 'disabled') {
      this.disabled = false;
    }
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  click() {
    this.clickCount++;
  }

  dispatchEvent(event: any) {
    this.dispatchedEvents.push(event);
    return true;
  }

  querySelector(selector: string): MockElement | null {
    const results = this.querySelectorAll(selector);
    return results.length > 0 ? results[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const traverse = (el: MockElement) => {
      if (el.matchesSelector(selector)) {
        results.push(el);
      }
      for (const child of el.children) {
        traverse(child);
      }
    };
    for (const child of this.children) {
      traverse(child);
    }
    return results;
  }

  matchesSelector(selector: string): boolean {
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return this.classList.contains(className);
    }
    if (selector.startsWith('#')) {
      return this.getAttribute('id') === selector.slice(1);
    }
    const attrMatch = selector.match(/^([a-zA-Z0-9_-]+)?\[([a-zA-Z0-9_-]+)([\*~^$|]?=)?["']?([^"']*)?["']?\]$/);
    if (attrMatch) {
      const tag = attrMatch[1];
      const attr = attrMatch[2];
      const op = attrMatch[3];
      const val = attrMatch[4];

      if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      if (!this.hasAttribute(attr)) return false;
      if (!op) return true;
      const actual = this.getAttribute(attr) || '';
      if (op === '=') return actual === val;
      if (op === '*=') return actual.includes(val);
      if (op === '^=') return actual.startsWith(val);
      if (op === '$=') return actual.endsWith(val);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  getBoundingClientRect() {
    return { width: 100, height: 40, top: 0, left: 0, bottom: 40, right: 100 };
  }
}

class MockDocument {
  public body: MockElement;

  constructor() {
    this.body = new MockElement('body');
  }

  createElement(tagName: string, className: string = ''): MockElement {
    return new MockElement(tagName, className);
  }

  querySelector(selector: string): MockElement | null {
    if (this.body.matchesSelector(selector)) return this.body;
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    return this.body.querySelectorAll(selector);
  }
}

const mockConfigProvider = (): AutoPlanConfig => ({
  executionMode: 'auto',
  bridgeTimeoutMs: 3000,
  allowTierFallback: true,
  strictMode: false,
  focusDelayMs: 50,
  enableDiagnosticTrace: false,
  suppressFallbackWarnings: true
} as any);

async function runTests() {
  console.log('\n=============================================================');
  console.log('🧪 Starting Phase 01: New Conversation Handshake Verification');
  console.log('=============================================================\n');

  const domBridge = loadDomBridge();

  // -------------------------------------------------------------
  // Test 1: Pre-check returns immediately when already on new conversation
  // (Empirical snapshot body.txt / body3.txt: cursor-not-allowed)
  // -------------------------------------------------------------
  console.log('▶ Test 1: Pre-check for Existing Empty Conversation (cursor-not-allowed)...');
  {
    const doc = new MockDocument();
    const newBtn = doc.createElement('a', 'cursor-not-allowed');
    newBtn.setAttribute('data-tooltip-id', 'new-conversation-tooltip');
    doc.body.appendChild(newBtn);

    const inputEditor = doc.createElement('div', 'editor');
    inputEditor.setAttribute('data-lexical-editor', 'true');
    inputEditor.innerHTML = '<p><br></p>';
    doc.body.appendChild(inputEditor);

    const sendBtn = doc.createElement('button', 'cursor-not-allowed');
    sendBtn.setAttribute('data-testid', 'send-button');
    sendBtn.setAttribute('disabled', '');
    doc.body.appendChild(sendBtn);

    const startTime = Date.now();
    const result = await domBridge.triggerNewConversation({
      document: doc,
      timeoutMs: 2000,
      intervalMs: 20
    });

    const elapsed = Date.now() - startTime;
    assert.strictEqual(result.success, true, 'Result success must be true');
    assert.strictEqual(result.alreadyNew, true, 'alreadyNew flag must be true');
    assert.ok(elapsed < 200, `Pre-check must return immediately without polling delay (took ${elapsed}ms)`);
    assert.strictEqual(newBtn.clickCount, 0, 'New button must NOT be clicked when already-new');
    console.log('  ✓ Pre-check correctly identified existing empty conversation without clicking button.');
  }

  // -------------------------------------------------------------
  // Test 2: Deterministic Click & Handshake Polling
  // (Empirical snapshot body1.txt / body2.txt: cursor-pointer -> transition to ready)
  // -------------------------------------------------------------
  console.log('▶ Test 2: Deterministic Click and Handshake Polling Transition...');
  {
    const doc = new MockDocument();
    const newBtn = doc.createElement('a', 'cursor-pointer');
    newBtn.setAttribute('data-tooltip-id', 'new-conversation-tooltip');
    doc.body.appendChild(newBtn);

    const inputEditor = doc.createElement('div', 'editor');
    inputEditor.setAttribute('data-lexical-editor', 'true');
    inputEditor.innerText = 'Prior unfinished draft conversation prompt';
    inputEditor.innerHTML = '<p>Prior unfinished draft conversation prompt</p>';
    doc.body.appendChild(inputEditor);

    const sendBtn = doc.createElement('button', 'cursor-pointer');
    sendBtn.setAttribute('data-testid', 'send-button');
    doc.body.appendChild(sendBtn);

    // Simulate transition in the DOM after 80ms
    setTimeout(() => {
      newBtn.classList.remove('cursor-pointer');
      newBtn.classList.add('cursor-not-allowed');

      inputEditor.innerText = '';
      inputEditor.innerHTML = '<p dir="auto"><br></p>';

      sendBtn.classList.remove('cursor-pointer');
      sendBtn.classList.add('cursor-not-allowed');
      sendBtn.setAttribute('disabled', '');
    }, 80);

    const startTime = Date.now();
    const result = await domBridge.triggerNewConversation({
      document: doc,
      timeoutMs: 2000,
      intervalMs: 20
    });

    assert.strictEqual(result.success, true, 'Result success must be true');
    assert.strictEqual(result.alreadyNew, false, 'alreadyNew must be false for transitioned conversation');
    assert.ok(newBtn.clickCount >= 1, 'New conversation button must receive click event');
    assert.ok(result.durationMs >= 60, `Handshake duration should be >= transition delay (was ${result.durationMs}ms)`);
    console.log('  ✓ Click cascade triggered and polling loop awaited state transition.');
  }

  // -------------------------------------------------------------
  // Test 3: Polling Timeout when Handshake conditions fail
  // -------------------------------------------------------------
  console.log('▶ Test 3: Handshake Polling Timeout Detection...');
  {
    const doc = new MockDocument();
    const newBtn = doc.createElement('a', 'cursor-pointer');
    newBtn.setAttribute('data-tooltip-id', 'new-conversation-tooltip');
    doc.body.appendChild(newBtn);

    // Leave editor dirty and button active
    const inputEditor = doc.createElement('div', 'editor');
    inputEditor.setAttribute('data-lexical-editor', 'true');
    inputEditor.innerText = 'Persisting draft text that never clears';
    doc.body.appendChild(inputEditor);

    let caughtError: any = null;
    try {
      await domBridge.triggerNewConversation({
        document: doc,
        timeoutMs: 150,
        intervalMs: 30
      });
    } catch (err: any) {
      caughtError = err;
    }

    assert.ok(caughtError, 'triggerNewConversation must throw when handshake conditions are not met');
    assert.ok(/timed?\s*out/i.test(caughtError.message), 'Error message must describe timeout');
    console.log('  ✓ Timeout triggered when DOM fails to reach empty/ready state.');
  }

  // -------------------------------------------------------------
  // Test 4: PromptDispatcher Command Candidate Enhancement
  // (antigravity.prioritized.chat.openNewConversation fails -> workbench.action.chat.newChat succeeds)
  // -------------------------------------------------------------
  console.log('▶ Test 4: PromptDispatcher Command Candidate Enhancement...');
  {
    const executedCommands: string[] = [];
    const commandExecutor = async (cmd: string) => {
      executedCommands.push(cmd);
      if (cmd === 'antigravity.prioritized.chat.openNewConversation') {
        throw new Error('Command not found in this IDE build');
      }
      if (cmd === 'workbench.action.chat.newChat') {
        return true;
      }
      return true;
    };

    const mockBridgeServer: any = {
      isListening: () => true,
      getConnectedClients: () => ['client-1'],
      probeActiveClients: async () => {},
      dispatchPromptCommand: async (_text: string, options: any) => {
        if (options.type === 'openNewConversation') {
          assert.strictEqual(options.extra?.readyCheckOnly, true, 'openedViaCommand should trigger fast readiness check');
          return {
            success: true,
            commandId: 'cmd_new_conv',
            status: 'completed',
            durationMs: 25,
            metadata: { durationMs: 25, alreadyNew: true }
          };
        }
        return {
          success: true,
          commandId: 'cmd_send_prompt',
          status: 'completed',
          durationMs: 30,
          metadata: { submitted: true }
        };
      }
    };

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      keyboardManager: {} as any,
      configProvider: mockConfigProvider,
      commandExecutor,
      logger: new DebugLogger(50)
    });

    const result = await dispatcher.dispatchTier1('Hello world', {
      openNewConversation: true
    });

    assert.strictEqual(result.success, true);
    assert.ok(executedCommands.includes('workbench.action.chat.newChat'), 'Must execute workbench.action.chat.newChat fallback');
    assert.ok(result.metadata?.handshake, 'Result must propagate handshake result');
    assert.strictEqual(result.metadata?.handshakeStatus, 'completed', 'Handshake status must be completed');
    console.log('  ✓ Command candidates include workbench.action.chat.newChat and readiness handshake is triggered.');
  }

  // -------------------------------------------------------------
  // Test 5: PromptDispatcher DOM Bridge Handshake Fallback (No 100ms static sleep)
  // -------------------------------------------------------------
  console.log('▶ Test 5: PromptDispatcher DOM Bridge Handshake Fallback without Blind Sleep...');
  {
    const commandExecutor = async (_cmd: string) => {
      throw new Error('All native commands disabled');
    };

    let handshakeDispatched = false;
    let promptDispatched = false;
    let handshakeCompletedTime = 0;
    let promptStartTime = 0;

    const mockBridgeServer: any = {
      isListening: () => true,
      getConnectedClients: () => ['client-1'],
      probeActiveClients: async () => {},
      dispatchPromptCommand: async (text: string, options: any) => {
        if (options.type === 'openNewConversation') {
          handshakeDispatched = true;
          // Simulate 40ms handshake completion
          await new Promise(r => setTimeout(r, 40));
          handshakeCompletedTime = Date.now();
          return {
            success: true,
            commandId: 'cmd_handshake',
            status: 'completed',
            durationMs: 40,
            metadata: { durationMs: 40, alreadyNew: false }
          };
        }
        if (options.type === 'sendPrompt') {
          promptDispatched = true;
          promptStartTime = Date.now();
          assert.ok(handshakeDispatched, 'Handshake must precede prompt dispatch');
          assert.ok(promptStartTime >= handshakeCompletedTime, 'Prompt dispatch must not start before handshake completes');
          return {
            success: true,
            commandId: 'cmd_prompt',
            status: 'completed',
            durationMs: 30,
            metadata: { submitted: true }
          };
        }
        throw new Error(`Unexpected command: ${options.type}`);
      }
    };

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      keyboardManager: {} as any,
      configProvider: mockConfigProvider,
      commandExecutor,
      logger: new DebugLogger(50)
    });

    const startTime = Date.now();
    const result = await dispatcher.dispatchTier1('Execute test', {
      openNewConversation: true
    });
    const totalElapsed = Date.now() - startTime;

    assert.strictEqual(result.success, true);
    assert.strictEqual(handshakeDispatched, true, 'DOM Bridge openNewConversation must be dispatched');
    assert.strictEqual(promptDispatched, true, 'Prompt must be dispatched after handshake');
    assert.strictEqual(result.metadata?.handshakeStatus, 'completed');
    // Ensure no blind 100ms artificial sleep is added (40ms handshake + 30ms prompt should be well under 150ms)
    assert.ok(totalElapsed < 250, `Dispatcher flow should be fast and deterministic without blind delays (took ${totalElapsed}ms)`);
    console.log('  ✓ Handshake awaited cleanly and propagated without blind static sleep.');
  }

  // -------------------------------------------------------------
  // Test 6: Tier 2 Candidate Enhancement Verification
  // -------------------------------------------------------------
  console.log('▶ Test 6: Tier 2 Command Candidate Enhancement...');
  {
    const executedCommands: string[] = [];
    const commandExecutor = async (cmd: string) => {
      executedCommands.push(cmd);
      if (cmd === 'antigravity.prioritized.chat.openNewConversation') {
        throw new Error('Command unavailable');
      }
      return true;
    };

    const dispatcher = new PromptDispatcher({
      bridgeServer: {} as any,
      keyboardManager: {} as any,
      configProvider: mockConfigProvider,
      commandExecutor,
      logger: new DebugLogger(50)
    });

    const result = await dispatcher.dispatchTier2('Tier 2 prompt', {
      openNewConversation: true
    });

    assert.strictEqual(result.success, true);
    assert.ok(executedCommands.includes('workbench.action.chat.newChat'), 'Tier 2 must try workbench.action.chat.newChat');
    console.log('  ✓ Tier 2 command candidate verified.');
  }

  console.log('\n=============================================================');
  console.log('🎉 ALL Phase 01 New Conversation Handshake Tests PASSED!');
  console.log('=============================================================\n');
}

// Support both Mocha runner and standalone node execution
const isMochaRunning = typeof (global as any).describe === 'function';
if (isMochaRunning) {
  (global as any).describe('Phase 01: New Conversation Transition & DOM Handshake', function (this: any) {
    if (this && typeof this.timeout === 'function') {
      this.timeout(10000);
    }
    (global as any).it('executes full Phase 01 handshake verification suite', async () => {
      await runTests();
    });
  });
} else {
  runTests().catch(err => {
    console.error('\n❌ Test failed with error:', err);
    process.exit(1);
  });
}
