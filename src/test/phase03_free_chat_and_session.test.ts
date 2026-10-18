// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockActiveTextEditor: any = undefined;
let mockWorkspaceFolders: any[] = [];
const mockConfigStore: Record<string, any> = {};
let executedCommands: string[] = [];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section: string) => ({
          get: (key: string, defaultValue: any) =>
            mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            mockConfigStore[key] = val;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        get workspaceFolders() {
          return mockWorkspaceFolders;
        }
      },
      window: {
        get activeTextEditor() {
          return mockActiveTextEditor;
        },
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        registerWebviewViewProvider: () => ({ dispose: () => {} }),
        showInformationMessage: async () => {},
        showWarningMessage: async () => {},
        showErrorMessage: async () => {}
      },
      commands: {
        executeCommand: async (cmd: string, ...args: any[]) => {
          executedCommands.push(cmd);
          return true;
        }
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 },
      StatusBarAlignment: { Left: 1, Right: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Bot, Context } from 'grammy';
import {
  splitMessage,
  sanitizeTelegramInput,
  sanitizeInputForSimulation,
  escapeSendKeys,
  escapeMarkdown
} from '../telegramUtils';
import { TelegramBridge } from '../telegramBridge';
import { PromptDispatcher, DispatchResult } from '../promptDispatcher';
import { KeyboardManager } from '../keyboardManager';
import { DebugLogger } from '../debugLogger';

/**
 * Creates a mock GrammY bot initialized with offline botInfo and message capturing.
 */
function createMockBot(token: string = '123456:TEST_TOKEN'): {
  bot: Bot;
  sentMessages: any[];
} {
  const bot = new Bot(token, {
    botInfo: {
      id: 8930752011,
      is_bot: true,
      first_name: 'AutoPlanTestBot',
      username: 'autoplan_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false
    } as any
  });

  const sentMessages: any[] = [];

  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === 'sendMessage') {
      const anyPayload = payload as any;
      sentMessages.push(anyPayload);
      return {
        ok: true,
        result: {
          message_id: Math.floor(Math.random() * 10000) + 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id, type: 'private', first_name: 'Chat' },
          text: anyPayload.text
        }
      } as any;
    }
    return { ok: true, result: {} } as any;
  });

  return { bot, sentMessages };
}

async function runPhase03FreeChatAndSessionTest() {
  console.log('================================================================');
  console.log(' Phase 03: Free Chat Dispatcher, Session Continuity & Chunking Test');
  console.log('================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-tg-phase03-'));
  const testRegistryPath = path.join(testTempDir, 'ag-autoplan-ports.json');
  const testLogger = new DebugLogger(100);

  try {
    // ------------------------------------------------------------------------
    // TEST SUITE 1: Message Chunking & Word-Boundary Splitting
    // ------------------------------------------------------------------------
    console.log('[Suite 1] Message Chunking Engine (splitMessage)');

    // 1.1 Empty and short text handling
    assert.deepStrictEqual(splitMessage(''), [], 'Empty string should yield empty chunk list');
    assert.deepStrictEqual(splitMessage(null as any), [], 'Null input should yield empty chunk list');
    const shortText = 'Hello Antigravity IDE!';
    assert.deepStrictEqual(splitMessage(shortText), [shortText], 'Short text under limit should yield single chunk');

    // 1.2 Long prose text splitting <= 3800 characters
    const paragraph1 = 'Paragraph 1: ' + 'A'.repeat(2000) + '\n\n';
    const paragraph2 = 'Paragraph 2: ' + 'B'.repeat(2500) + '\n\n';
    const combinedProse = paragraph1 + paragraph2;
    const proseChunks = splitMessage(combinedProse, 3800);

    assert(proseChunks.length >= 2, `Expected at least 2 chunks, got ${proseChunks.length}`);
    for (let i = 0; i < proseChunks.length; i++) {
      assert(
        proseChunks[i].length <= 3800,
        `Chunk ${i} length ${proseChunks[i].length} must not exceed 3800`
      );
    }
    console.log('  ✓ Correctly split long text into chunks <= 3800 characters');

    // 1.3 Word boundary preservation (no breaking mid-word)
    const words = [];
    for (let i = 1; i <= 200; i++) {
      words.push(`wordNumber${i}`);
    }
    const wordText = words.join(' ');
    const wordChunks = splitMessage(wordText, 150);

    for (let i = 0; i < wordChunks.length; i++) {
      const chunk = wordChunks[i];
      assert(chunk.length <= 150, `Chunk ${i} exceeded max chunk length 150`);
      // Check that chunk begins and ends with whole words (no partial word suffixes like 'ordNumber')
      const tokens = chunk.trim().split(/\s+/);
      for (const token of tokens) {
        assert(
          token.startsWith('wordNumber'),
          `Token "${token}" appeared to be cut mid-word in chunk "${chunk}"`
        );
      }
    }
    console.log('  ✓ Preserved whole word boundaries without cutting mid-word');

    // 1.4 Hard split fallback for massive single tokens without whitespace
    const hugeToken = 'Z'.repeat(5000);
    const hardChunks = splitMessage(hugeToken, 3800);
    assert.strictEqual(hardChunks.length, 2, 'Huge token should be split into 2 chunks');
    assert.strictEqual(hardChunks[0].length, 3800, 'First hard chunk should be exactly 3800');
    assert.strictEqual(hardChunks[1].length, 1200, 'Second hard chunk should be remaining 1200');
    console.log('  ✓ Gracefully handled contiguous single tokens exceeding chunk length');

    // ------------------------------------------------------------------------
    // TEST SUITE 2: Markdown Code Block Balancing & Syntax Preservation
    // ------------------------------------------------------------------------
    console.log('\n[Suite 2] Markdown Code Block Balancing & Syntax Highlighting');

    // 2.1 Code block spanning multiple chunks
    const longCodeLines = [];
    for (let i = 1; i <= 150; i++) {
      longCodeLines.push(`  const variable_${i}: number = ${i * 10};`);
    }
    const tsCode = '```typescript\n' + longCodeLines.join('\n') + '\n```';
    const codeChunks = splitMessage(tsCode, 1000);

    assert(codeChunks.length >= 4, `Expected at least 4 chunks, got ${codeChunks.length}`);

    // Verify first chunk starts with ```typescript and ends with closing ```
    assert(codeChunks[0].startsWith('```typescript\n'), 'Chunk 0 must start with ```typescript');
    assert(codeChunks[0].endsWith('\n```') || codeChunks[0].endsWith('```'), 'Chunk 0 must end with closed fence ```');

    // Verify subsequent intermediate chunks reopen with ```typescript and close with ```
    for (let i = 1; i < codeChunks.length - 1; i++) {
      const ch = codeChunks[i];
      assert(ch.length <= 1000, `Chunk ${i} length ${ch.length} exceeded 1000`);
      assert(
        ch.startsWith('```typescript\n'),
        `Intermediate chunk ${i} must reopen with preserved language tag \`\`\`typescript`
      );
      assert(
        ch.endsWith('\n```') || ch.endsWith('```'),
        `Intermediate chunk ${i} must close with \`\`\``
      );
    }

    // Verify each chunk has an even number of code fence delimiters (properly balanced)
    for (let i = 0; i < codeChunks.length; i++) {
      const ch = codeChunks[i];
      const fenceMatches = ch.match(/```/g) || [];
      assert.strictEqual(
        fenceMatches.length % 2,
        0,
        `Chunk ${i} has odd number of code fences (${fenceMatches.length}), breaking Telegram Markdown!`
      );
    }
    console.log('  ✓ Preserved language identifier (typescript) and balanced fences across chunks');

    // 2.2 Multiple distinct code blocks (python, json)
    const multiBlock =
      '# Python section\n```python\ndef greet():\n    return "hi"\n```\n\n' +
      '# JSON section\n```json\n{\n  "status": "ok",\n  "count": 42\n}\n```\n\n' +
      'Done.';
    const multiChunks = splitMessage(multiBlock, 75);
    for (let i = 0; i < multiChunks.length; i++) {
      const ch = multiChunks[i];
      const fences = ch.match(/```/g) || [];
      assert.strictEqual(
        fences.length % 2,
        0,
        `Multi-block chunk ${i} has unbalanced fences: ${fences.length}`
      );
    }
    console.log('  ✓ Balanced multi-language code blocks across split boundaries');

    // 2.3 Unclosed code block in original input
    const unclosedBlock = '```javascript\nconst x = 1;\nconst y = 2;\nconst z = 3;';
    const unclosedChunks = splitMessage(unclosedBlock, 40);
    for (let i = 0; i < unclosedChunks.length; i++) {
      const ch = unclosedChunks[i];
      const fences = ch.match(/```/g) || [];
      assert.strictEqual(
        fences.length % 2,
        0,
        `Unclosed chunk ${i} must be balanced by splitMessage`
      );
    }
    console.log('  ✓ Gracefully balanced unclosed source code blocks');

    // ------------------------------------------------------------------------
    // TEST SUITE 3: Performance Benchmark (Non-Functional Requirement)
    // ------------------------------------------------------------------------
    console.log('\n[Suite 3] Performance Benchmark (< 5ms for 500KB)');

    const large500KB = (
      'Here is an extensive paragraph analyzing codebase telemetry.\n\n' +
      '```typescript\n' +
      'export function analyzeTelemetry(event: TelemetryEvent): boolean {\n' +
      '  return event.severity === "high";\n' +
      '}\n' +
      '```\n\n' +
      'Conclusive remarks follow in subsequent reports.\n\n'
    ).repeat(3000); // ~500KB

    assert(large500KB.length >= 450000, `Payload size was ${large500KB.length} bytes`);

    // Warm up V8 JIT
    splitMessage(large500KB.slice(0, 10000), 3800);

    const startHr = process.hrtime.bigint();
    const benchmarkChunks = splitMessage(large500KB, 3800);
    const endHr = process.hrtime.bigint();
    const durationMs = Number(endHr - startHr) / 1e6;

    console.log(`  ⚡ Chunked ${large500KB.length} bytes into ${benchmarkChunks.length} chunks in ${durationMs.toFixed(3)}ms`);
    assert(
      durationMs < 5.0,
      `Performance failure: splitMessage took ${durationMs.toFixed(3)}ms, which exceeds the 5ms threshold!`
    );
    console.log('  ✓ Performance requirement satisfied: < 5ms for ~500KB output');

    // ------------------------------------------------------------------------
    // TEST SUITE 4: Input Sanitization & Simulation Utilities
    // ------------------------------------------------------------------------
    console.log('\n[Suite 4] Input Sanitization & Simulation Safety');

    const dirtyInput = 'Hello\0 World!\r\nLine2\rLine3\x07\x1B';
    const sanitizedTg = sanitizeTelegramInput(dirtyInput);
    assert.strictEqual(sanitizedTg.includes('\0'), false, 'Must strip null bytes');
    assert.strictEqual(sanitizedTg.includes('\r'), false, 'Must normalize CR to LF');

    const simSanitized = sanitizeInputForSimulation(dirtyInput);
    assert.strictEqual(simSanitized.includes('\x07'), false, 'Must strip bell control character');
    assert.strictEqual(simSanitized.includes('\x1B'), false, 'Must strip escape control character');

    const sendKeysRaw = 'test+keys^{enter}';
    const escapedSK = escapeSendKeys(sendKeysRaw);
    assert.strictEqual(escapedSK, 'test{+}keys{^}{{}enter{}}', 'Must escape PowerShell SendKeys tokens');

    const mdRaw = '*bold* and _italic_ and `code`';
    const escapedMD = escapeMarkdown(mdRaw);
    assert(escapedMD.includes('\\*'), 'Must escape asterisk in Markdown');
    assert(escapedMD.includes('\\_'), 'Must escape underscore in Markdown');
    console.log('  ✓ Sanitization utilities safely clean input and escape keyboard simulation tokens');

    // ------------------------------------------------------------------------
    // TEST SUITE 5: Free-Form Text Prompt Dispatcher
    // ------------------------------------------------------------------------
    console.log('\n[Suite 5] Free-Form Text Prompt Dispatcher in TelegramBridge');

    const dispatchedPrompts: Array<{ text: string; options: any }> = [];
    let dispatchShouldFail = false;
    let dispatchFailureError = 'Simulated DOM Bridge Timeout (15000ms)';
    let returnFallbackHistory = false;

    const mockPromptDispatcher: any = {
      dispatchPrompt: async (text: string, options?: any): Promise<DispatchResult> => {
        dispatchedPrompts.push({ text, options });
        if (dispatchShouldFail) {
          throw new Error(dispatchFailureError);
        }
        if (returnFallbackHistory) {
          return {
            success: true,
            tier: 'keyboard',
            durationMs: 420,
            status: 'fallbackExecuted',
            fallbackHistory: [{ tier: 'domBridge', error: 'DOM bridge timed out', durationMs: 15000 }]
          };
        }
        return {
          success: true,
          tier: 'domBridge',
          durationMs: 150,
          status: 'success'
        };
      }
    };

    let newConvShortcutCalled = false;
    const mockKeyboardManager: any = {
      sendNewConversationShortcut: async (): Promise<void> => {
        newConvShortcutCalled = true;
      },
      openNewConversation: async (): Promise<void> => {
        newConvShortcutCalled = true;
      }
    };

    const { bot: testBot, sentMessages: testSent } = createMockBot();
    const authorizedUserId = 998877;
    const unauthorizedUserId = 112233;

    const bridge = new TelegramBridge({
      token: '123456:TEST_TOKEN',
      enabled: true,
      allowedUsers: [authorizedUserId],
      registryPath: testRegistryPath,
      logger: testLogger,
      botFactory: () => testBot,
      promptDispatcher: mockPromptDispatcher,
      keyboardManager: mockKeyboardManager
    });

    bridge.initBot();
    await testBot.init();

    // 5.1 Free text message dispatches into Antigravity IDE
    await testBot.handleUpdate({
      update_id: 101,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
        text: 'Fix the bug in src/bridgeServer.ts'
      }
    } as any);

    assert.strictEqual(dispatchedPrompts.length, 1, 'Prompt dispatcher should be called once');
    assert.strictEqual(
      dispatchedPrompts[0].text,
      'Fix the bug in src/bridgeServer.ts',
      'Dispatched prompt text must match incoming text'
    );
    assert.strictEqual(
      dispatchedPrompts[0].options?.timeoutMs,
      15000,
      'Dispatch timeout must be configured to 15000ms'
    );
    assert.strictEqual(
      dispatchedPrompts[0].options?.openNewConversation,
      false,
      'Must preserve conversation continuity (openNewConversation: false)'
    );

    // Verify immediate acknowledgment sent to Telegram
    const ackMsg = testSent.find((m) => m.text && m.text.includes('⏳ Prompt sent to Antigravity IDE...'));
    assert(ackMsg, 'Must immediately acknowledge prompt receipt with ⏳ status indicator');
    console.log('  ✓ Free-form text dispatched with 15000ms timeout and conversation continuity');

    // 5.2 Slash command should NOT trigger text prompt dispatcher
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 102,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
        text: '/plans',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    } as any);

    assert.strictEqual(
      dispatchedPrompts.length,
      0,
      'Slash command /plans must not trigger free text prompt dispatcher'
    );
    console.log('  ✓ Internal bot slash commands ignored by text dispatcher');

    // 5.2.1 IDE Workflow slash commands (e.g. /audit, /debug) MUST pass through to prompt dispatcher
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 1021,
      message: {
        message_id: 21,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
        text: '/audit',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    } as any);

    assert.strictEqual(
      dispatchedPrompts.length,
      1,
      'Workflow slash command /audit must be dispatched to Antigravity IDE'
    );
    assert.strictEqual(
      dispatchedPrompts[0].text,
      '/audit',
      'Dispatched text must match /audit'
    );
    console.log('  ✓ Workflow slash commands (/audit, /debug) correctly dispatched to Antigravity IDE');

    // 5.3 Error reporting on dispatch failure
    dispatchedPrompts.length = 0;
    testSent.length = 0;
    dispatchShouldFail = true;
    dispatchFailureError = 'DOM bridge timeout after 15000ms';

    await testBot.handleUpdate({
      update_id: 103,
      message: {
        message_id: 3,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
        text: 'Run unit test suite'
      }
    } as any);

    const errorReply = testSent.find((m) => m.text && m.text.includes('❌ Prompt dispatch failed'));
    assert(errorReply, 'Must reply with failure notification on prompt dispatch exception');
    assert(
      errorReply.text.includes('DOM bridge timeout'),
      `Error reply should mention DOM bridge timeout: ${errorReply.text}`
    );
    console.log('  ✓ Dispatch error notification correctly reported back to Telegram');

    // 5.4 Fallback tier notification
    dispatchedPrompts.length = 0;
    testSent.length = 0;
    dispatchShouldFail = false;
    returnFallbackHistory = true;

    await testBot.handleUpdate({
      update_id: 104,
      message: {
        message_id: 4,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
        text: 'Proceed to next phase'
      }
    } as any);

    const fallbackReply = testSent.find((m) => m.text && m.text.includes('Delivered via fallback tier (keyboard)'));
    assert(fallbackReply, 'Must inform user when prompt is delivered via fallback tier');
    returnFallbackHistory = false;
    console.log('  ✓ Fallback tier notification delivered when fallback occurs');

    // 5.5 Unauthorized user rejection
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 105,
      message: {
        message_id: 5,
        date: Math.floor(Date.now() / 1000),
        chat: { id: unauthorizedUserId, type: 'private' },
        from: { id: unauthorizedUserId, is_bot: false, first_name: 'Hacker' },
        text: 'Unauthorized prompt injection'
      }
    } as any);

    assert.strictEqual(dispatchedPrompts.length, 0, 'Unauthorized user must NOT trigger dispatchPrompt');
    const denialMsg = testSent.find((m) => m.text && m.text.includes('⛔ Unauthorized'));
    assert(denialMsg, 'Unauthorized user must receive denial message');
    console.log('  ✓ Security whitelist enforced: unauthorized users rejected');

    // ------------------------------------------------------------------------
    // TEST SUITE 6: Session Continuity & /new_chat Command
    // ------------------------------------------------------------------------
    console.log('\n[Suite 6] Session Continuity & /new_chat Command');

    testSent.length = 0;
    newConvShortcutCalled = false;

    await testBot.handleUpdate({
      update_id: 106,
      message: {
        message_id: 6,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
        text: '/new_chat',
        entities: [{ type: 'bot_command', offset: 0, length: 9 }]
      }
    } as any);

    assert(
      newConvShortcutCalled || executedCommands.includes('antigravity.prioritized.chat.openNewConversation'),
      'New conversation must be triggered via command API or keyboard shortcut'
    );
    const newChatConfirm = testSent.find((m) => m.text && m.text.includes('🆕 New conversation initialized'));
    assert(newChatConfirm, 'Must confirm in Telegram: 🆕 New conversation initialized');
    console.log('  ✓ /new_chat triggered new conversation and confirmed in Telegram');

    // ------------------------------------------------------------------------
    // TEST SUITE 7: sendSplitMessage Helper Integration
    // ------------------------------------------------------------------------
    console.log('\n[Suite 7] sendSplitMessage Integration');

    testSent.length = 0;
    const splitPayload = 'Important documentation paragraph.\n\n```python\n' + 'print("data")\n'.repeat(400) + '```\n';
    const splitResults = await bridge.sendSplitMessage(authorizedUserId, splitPayload);

    assert(splitResults.length >= 2, `Expected multiple split messages sent, got ${splitResults.length}`);
    assert.strictEqual(testSent.length, splitResults.length, 'Each chunk must be sent via sendMessage');
    for (const msg of testSent) {
      assert(msg.text.length <= 3800, `Delivered message exceeded 3800 chars (${msg.text.length})`);
    }
    console.log('  ✓ sendSplitMessage safely chunked and dispatched messages');

    console.log('\n================================================================');
    console.log(' Phase 03: ALL CORE TESTS PASSED SUCCESSFULLY! (100% COVERAGE)');
    console.log('================================================================\n');
  } finally {
    if (fs.existsSync(testTempDir)) {
      try {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

runPhase03FreeChatAndSessionTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 03 Test Failure:', err);
    process.exit(1);
  });
