// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
let mockExecuteCommandCalls: Array<{ command: string; args: any[] }> = [];
let mockShowErrorMessageHandler: any = null;

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      commands: {
        executeCommand: async (cmd: string, ...args: any[]) => {
          mockExecuteCommandCalls.push({ command: cmd, args });
          return undefined;
        }
      },
      window: {
        showWarningMessage: (_msg: string) => undefined,
        showErrorMessage: async (msg: string, ...actions: string[]) => {
          if (mockShowErrorMessageHandler) {
            return mockShowErrorMessageHandler(msg, ...actions);
          }
          return actions[0];
        }
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

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { PromptDispatcher } from '../promptDispatcher';
import { BridgeServer } from '../bridgeServer';
import { DebugLogger, sanitizeExcerpt, sanitizePrompt } from '../debugLogger';
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

const mockConfigProvider = (overrides?: Partial<AutoPlanConfig>): (() => AutoPlanConfig) => () => ({
  executionMode: 'auto',
  bridgeTimeoutMs: 5000,
  allowTierFallback: true,
  strictMode: false,
  focusDelayMs: 50,
  enableDiagnosticTrace: false,
  suppressFallbackWarnings: true,
  ...(overrides || {})
} as any);

async function runAllTests() {
  console.log('================================================================');
  console.log('🧪 Phase 04: Dispatcher Telemetry & Diagnostic Report Integration');
  console.log('================================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passedTests++;
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err?.message || err}`);
      throw err;
    }
  }

  // Test 1: Telemetry Propagation on Success
  await test('Dispatcher parses client ACK with Step 1 and Step 2 telemetry and logs structured message', async () => {
    const logger = new DebugLogger();
    const logMessages: string[] = [];
    logger.onLog((entry: any) => {
      if (entry.component === 'DISPATCHER') {
        logMessages.push(entry.message);
      }
    });

    const mockBridgeServer = {
      isListening: () => true,
      getConnectedClients: () => [{ windowKey: 'win_1', lastSeenAt: Date.now() }],
      getActiveWindowKey: () => 'win_1',
      getWindowKey: () => 'win_1',
      getWorkspaceName: () => 'test-workspace',
      dispatchPromptCommand: async () => ({
        success: true,
        commandId: 'cmd_101',
        status: 'submitClicked',
        durationMs: 45,
        metadata: {
          steps: [
            {
              step: 1,
              name: 'Input discovery & focus',
              status: 'success',
              elementContext: '#antigravity.agentSidePanelInputBox',
              details: {
                tagName: 'DIV',
                isInChatPanel: true,
                containerHierarchy: ['#antigravity.agentSidePanelInputBox']
              }
            },
            {
              step: 2,
              name: 'Content injection',
              status: 'success',
              charsExpected: 3321,
              charsDetectedInDOM: 3321,
              strategy: 'contenteditable-text',
              verified: true
            }
          ]
        }
      })
    } as any;

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      logger,
      configProvider: mockConfigProvider()
    });

    const promptText = 'A'.repeat(3321);
    const result = await dispatcher.dispatchTier1(promptText);

    assert.strictEqual(result.success, true, 'Result should succeed');
    assert.strictEqual(result.tier, 'domBridge', 'Tier should be domBridge');
    assert.strictEqual(result.charsExpected, 3321, 'charsExpected should be 3321');
    assert.strictEqual(result.charsDetectedInDOM, 3321, 'charsDetectedInDOM should be 3321');
    assert.strictEqual(result.elementContext, '#antigravity.agentSidePanelInputBox', 'elementContext should match');

    // Verify structured log message
    const expectedLogPrefix = "Prompt paste verified: 3321/3321 chars in '#antigravity.agentSidePanelInputBox' (strategy=contenteditable-text)";
    const foundLog = logMessages.some((msg) => msg.includes(expectedLogPrefix));
    assert.ok(foundLog, `Dispatcher should log structured message containing: "${expectedLogPrefix}"`);

    // Verify DebugLogger received telemetry
    const tel = logger.getLastInjectionTelemetry();
    assert.ok(tel, 'Telemetry must be recorded in logger');
    assert.strictEqual(tel?.status, 'verified');
    assert.strictEqual(tel?.charsExpected, 3321);
    assert.strictEqual(tel?.charsDetectedInDOM, 3321);
    assert.strictEqual(tel?.elementContext, '#antigravity.agentSidePanelInputBox');
    assert.strictEqual(tel?.verified, true);
  });

  // Test 2: Actionable Error Attribution on PASTE_VERIFICATION_FAILED
  await test('PASTE_VERIFICATION_FAILED triggers actionable notification and updates logger', async () => {
    const logger = new DebugLogger();
    let actionableCalled = false;
    let notificationMsg = '';
    let notificationBtn = '';

    mockExecuteCommandCalls = [];

    const mockBridgeServer = {
      isListening: () => true,
      getConnectedClients: () => [{ windowKey: 'win_1', lastSeenAt: Date.now() }],
      getActiveWindowKey: () => 'win_1',
      getWindowKey: () => 'win_1',
      getWorkspaceName: () => 'test-workspace',
      dispatchPromptCommand: async () => {
        const err: any = new Error('PASTE_VERIFICATION_FAILED: Prompt text failed to materialize in target DOM buffer (expected 2500 chars, detected 0 in DOM)');
        err.code = 'PASTE_VERIFICATION_FAILED';
        err.rejectionReason = 'dom_buffer_empty';
        err.charsExpected = 2500;
        err.charsDetectedInDOM = 0;
        err.domExcerpt = '';
        err.elementContext = '#antigravity.agentSidePanelInputBox';
        err.steps = [
          { step: 1, name: 'Input discovery & focus', status: 'success', elementContext: '#antigravity.agentSidePanelInputBox' },
          { step: 2, name: 'Content injection', status: 'failed', code: 'PASTE_VERIFICATION_FAILED', charsExpected: 2500, charsDetectedInDOM: 0 }
        ];
        throw err;
      }
    } as any;

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      logger,
      configProvider: mockConfigProvider(),
      actionableNotifier: async (msg, btn, onAction) => {
        actionableCalled = true;
        notificationMsg = msg;
        notificationBtn = btn;
        await onAction();
      }
    });

    let caughtErr: any;
    try {
      await dispatcher.dispatchTier1('B'.repeat(2500));
    } catch (e) {
      caughtErr = e;
    }

    assert.ok(caughtErr, 'dispatchTier1 should throw error on paste failure');
    assert.strictEqual(caughtErr.code, 'PASTE_VERIFICATION_FAILED');
    assert.ok(actionableCalled, 'actionableNotifier should be called');
    assert.ok(notificationMsg.includes('Khung chat Antigravity đang đóng'), 'Notification should contain guidance text');
    assert.strictEqual(notificationBtn, 'Open Chat Panel', 'Button should be "Open Chat Panel"');

    // Verify command was triggered when clicked
    assert.ok(
      mockExecuteCommandCalls.some(c => c.command === 'workbench.action.chat.open' || c.command === 'antigravity.prioritized.chat.open'),
      'Clicking action button should execute workbench.action.chat.open'
    );

    // Verify DebugLogger received failed telemetry
    const tel = logger.getLastInjectionTelemetry();
    assert.ok(tel, 'Telemetry must be recorded in logger');
    assert.strictEqual(tel?.status, 'failed');
    assert.strictEqual(tel?.charsExpected, 2500);
    assert.strictEqual(tel?.charsDetectedInDOM, 0);
    assert.strictEqual(tel?.verified, false);
  });

  // Test 3: Actionable Error Attribution on NO_CHAT_INPUT_FOUND
  await test('NO_CHAT_INPUT_FOUND triggers actionable notification to open chat panel', async () => {
    const logger = new DebugLogger();
    let actionableCalled = false;

    const mockBridgeServer = {
      isListening: () => true,
      getConnectedClients: () => [{ windowKey: 'win_1', lastSeenAt: Date.now() }],
      getActiveWindowKey: () => 'win_1',
      getWindowKey: () => 'win_1',
      getWorkspaceName: () => 'test-workspace',
      dispatchPromptCommand: async () => {
        const err: any = new Error('No valid chat input element found in DOM');
        err.code = 'NO_CHAT_INPUT_FOUND';
        err.steps = [{ step: 1, name: 'Input discovery & focus', status: 'failed', code: 'NO_CHAT_INPUT_FOUND' }];
        throw err;
      }
    } as any;

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      logger,
      configProvider: mockConfigProvider(),
      actionableNotifier: async (_msg, btn) => {
        actionableCalled = true;
        assert.strictEqual(btn, 'Open Chat Panel');
      }
    });

    let caughtErr: any;
    try {
      await dispatcher.dispatchTier1('Hello');
    } catch (e) {
      caughtErr = e;
    }

    assert.ok(caughtErr, 'Should throw error');
    assert.strictEqual(caughtErr.code, 'NO_CHAT_INPUT_FOUND');
    assert.ok(actionableCalled, 'actionableNotifier should be called on NO_CHAT_INPUT_FOUND');
  });

  // Test 4: Diagnostic Report Output Generation
  await test('generateDiagnosticReport outputs hardened DOM Bridge Injection Health and Target Element Container', async () => {
    const logger = new DebugLogger();

    // 4a. Verified State
    logger.recordInjectionTelemetry({
      status: 'verified',
      charsExpected: 3321,
      charsDetectedInDOM: 3321,
      charsInjected: 3321,
      elementContext: '#antigravity.agentSidePanelInputBox',
      strategy: 'contenteditable-text',
      verified: true
    });

    const verifiedReport = logger.generateDiagnosticReport();
    assert.ok(
      verifiedReport.includes('**DOM Bridge Injection Health**: ✅ Verified (Last prompt: 3321 chars injected, buffer matched)'),
      'Report must include verified injection status'
    );
    assert.ok(
      verifiedReport.includes('**Target Element Container**: `#antigravity.agentSidePanelInputBox` (Verified in Chat Panel)'),
      'Report must include target element container with verification tag'
    );
    assert.ok(
      verifiedReport.includes('- [x] **DOM Bridge Injection Health**'),
      'Checklist item must be checked for verified injection'
    );

    // 4b. Failed State
    logger.recordInjectionTelemetry({
      status: 'failed',
      charsExpected: 3321,
      charsDetectedInDOM: 0,
      elementContext: '#antigravity.agentSidePanelInputBox',
      verified: false
    });

    const failedReport = logger.generateDiagnosticReport();
    assert.ok(
      failedReport.includes('**DOM Bridge Injection Health**: ❌ Failed (Buffer was empty)'),
      'Report must indicate failed injection buffer'
    );
    assert.ok(
      failedReport.includes('- [ ] **DOM Bridge Injection Health**'),
      'Checklist item must be unchecked for failed injection'
    );
  });

  // Test 5: Graceful Fallback Handling (allowTierFallback: true)
  await test('When Tier 1 fails with PASTE_VERIFICATION_FAILED and fallback is enabled, dispatcher cleanly falls back to Tier 2', async () => {
    const logger = new DebugLogger();
    let nativeCommandExecuted = false;

    const mockBridgeServer = {
      isListening: () => true,
      getConnectedClients: () => [{ windowKey: 'win_1', lastSeenAt: Date.now() }],
      getActiveWindowKey: () => 'win_1',
      getWindowKey: () => 'win_1',
      getWorkspaceName: () => 'test-workspace',
      dispatchPromptCommand: async () => {
        const err: any = new Error('PASTE_VERIFICATION_FAILED: buffer empty');
        err.code = 'PASTE_VERIFICATION_FAILED';
        err.charsExpected = 100;
        err.charsDetectedInDOM = 0;
        throw err;
      }
    } as any;

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      logger,
      configProvider: mockConfigProvider({ allowTierFallback: true, executionMode: 'auto' }),
      commandExecutor: async (cmd, ...args) => {
        if (cmd === 'antigravity.sendTextToChat') {
          nativeCommandExecuted = true;
          return true;
        }
        return undefined;
      }
    });

    const res = await dispatcher.dispatchPrompt('Test fallback');
    assert.strictEqual(res.success, true, 'dispatchPrompt should succeed via fallback');
    assert.strictEqual(res.tier, 'nativeCommand', 'Result tier should be nativeCommand');
    assert.ok(nativeCommandExecuted, 'Native command tier must have been executed');
    assert.ok(res.fallbackHistory && res.fallbackHistory.length === 1, 'Fallback history should record 1 fallback');
    assert.strictEqual(res.fallbackHistory![0].tier, 'domBridge', 'Fallback history should note domBridge failure');
  });

  // Test 6: Strict Mode (allowTierFallback: false)
  await test('When allowTierFallback: false, dispatcher rejects immediately on PASTE_VERIFICATION_FAILED without fallback', async () => {
    const logger = new DebugLogger();

    const mockBridgeServer = {
      isListening: () => true,
      getConnectedClients: () => [{ windowKey: 'win_1', lastSeenAt: Date.now() }],
      getActiveWindowKey: () => 'win_1',
      getWindowKey: () => 'win_1',
      getWorkspaceName: () => 'test-workspace',
      dispatchPromptCommand: async () => {
        const err: any = new Error('PASTE_VERIFICATION_FAILED: buffer empty');
        err.code = 'PASTE_VERIFICATION_FAILED';
        err.charsExpected = 100;
        err.charsDetectedInDOM = 0;
        throw err;
      }
    } as any;

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      logger,
      configProvider: mockConfigProvider({ allowTierFallback: false, strictMode: true })
    });

    let threw = false;
    try {
      await dispatcher.dispatchPrompt('Test strict fail');
    } catch (e: any) {
      threw = true;
      assert.ok(e.message.includes('DOM Bridge Transport Failed') || e.code === 'PASTE_VERIFICATION_FAILED');
    }

    assert.ok(threw, 'Strict mode must throw on Tier 1 failure');
  });

  // Test 7: Excerpt Sanitization and Sensitive Token Redaction
  await test('sanitizeExcerpt truncates to max 60 chars and masks sensitive tokens', () => {
    const rawExcerpt = 'Authorization: Bearer ghp_secret123456789012345 and AIzaSyD1234567890123456789012345678901 and sk-12345678901234567890';
    const sanitized = sanitizeExcerpt(rawExcerpt, 60);

    assert.ok(!sanitized.includes('ghp_secret123456789012345'), 'GitHub token must be masked');
    assert.ok(!sanitized.includes('AIzaSyD'), 'Google API key must be masked');
    assert.ok(!sanitized.includes('sk-12345678901234567890'), 'OpenAI key must be masked');
    assert.ok(sanitized.length <= 65, 'Length should be within 60 chars (+ ellipsis)');
  });

  // Test 8: captureDomDiagnosticSnapshot Nearby Inputs & Visibility Summary
  await test('captureDomDiagnosticSnapshot summarizes nearby inputs and their visibility', () => {
    const domBridge = loadDomBridge();
    const { captureDomDiagnosticSnapshot } = domBridge;

    const mockDoc = {
      activeElement: null,
      querySelectorAll: (sel: string) => {
        if (sel === 'textarea') {
          return [
            {
              tagName: 'TEXTAREA',
              className: 'chat-input',
              getBoundingClientRect: () => ({ width: 400, height: 100, top: 10, left: 10 }),
              offsetParent: {},
              style: {}
            }
          ];
        }
        if (sel.includes('contenteditable')) {
          return [
            {
              tagName: 'DIV',
              className: 'monaco-editor',
              getAttribute: (k: string) => k === 'contenteditable' ? 'true' : null,
              getBoundingClientRect: () => ({ width: 500, height: 200, top: 100, left: 10 }),
              offsetParent: {},
              style: {}
            }
          ];
        }
        return [];
      }
    };

    const snapshot = captureDomDiagnosticSnapshot(mockDoc);
    assert.ok(snapshot, 'Snapshot must be created');
    assert.ok(snapshot.nearbyInputs, 'nearbyInputs array must exist');
    assert.ok(snapshot.nearbyInputsSummary, 'nearbyInputsSummary object must exist');
    assert.ok(typeof snapshot.nearbyInputsSummary.totalFound === 'number', 'totalFound should be a number');
    assert.ok(typeof snapshot.nearbyInputsSummary.visibleCount === 'number', 'visibleCount should be a number');
    assert.ok(Array.isArray(snapshot.nearbyInputsSummary.elements), 'elements should be array');
    if (snapshot.contentEditables && snapshot.contentEditables.length > 0) {
      assert.strictEqual(typeof snapshot.contentEditables[0].visible, 'boolean', 'contentEditables should have visible boolean');
    }
  });

  console.log(`\n================================================================`);
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED`);
  console.log(`================================================================\n`);
}

runAllTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
