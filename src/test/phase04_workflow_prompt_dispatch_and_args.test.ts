// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {};

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
        workspaceFolders: []
      },
      window: {
        activeTextEditor: undefined,
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
        executeCommand: async () => true
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
import { Bot } from 'grammy';
import {
  TelegramBridge,
  normalizeTelegramWorkflowCommand,
  toTelegramWorkflowCommand,
  isWorkflowCommand,
  parseWorkflowCommand,
  ParsedWorkflowCommand,
  INTERNAL_BOT_COMMANDS,
  WORKFLOW_COMMAND_NAMES
} from '../telegramBridge';
import { PromptDispatcher, DispatchResult } from '../promptDispatcher';
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

  bot.api.config.use(async (_prev, method, payload) => {
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

async function runPhase04WorkflowPromptDispatchAndArgsTest() {
  console.log('================================================================');
  console.log(' Phase 04: Command Argument Forwarding & Workflow Prompt Dispatch Test');
  console.log('================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-tg-phase04-'));
  const testRegistryPath = path.join(testTempDir, 'ag-autoplan-ports.json');
  const testLogger = new DebugLogger(100);
  let bridge: TelegramBridge | null = null;

  try {
    // ------------------------------------------------------------------------
    // TEST SUITE 1: Command Parsing, Argument Extraction & Normalization
    // ------------------------------------------------------------------------
    console.log('[Suite 1] Workflow Command Parsing & Normalization Engine...');

    // 1.1 Verifies /brainstorm build a note app is normalized and dispatched as /brainstorm build a note app
    const brainstormParsed = parseWorkflowCommand('/brainstorm build a note app');
    assert.ok(brainstormParsed, 'parseWorkflowCommand must parse /brainstorm build a note app');
    assert.strictEqual(brainstormParsed?.isWorkflow, true);
    assert.strictEqual(brainstormParsed?.command, 'brainstorm');
    assert.strictEqual(brainstormParsed?.args, 'build a note app');
    assert.strictEqual(
      brainstormParsed?.normalizedPrompt,
      '/brainstorm build a note app',
      'Normalized prompt must be /brainstorm build a note app'
    );
    console.log('  ✓ /brainstorm build a note app parsed with arguments intact');

    // 1.2 Verifies /save_brain custom note is normalized and dispatched as /save-brain custom note
    const saveBrainParsed = parseWorkflowCommand('/save_brain custom note');
    assert.ok(saveBrainParsed, 'parseWorkflowCommand must parse /save_brain custom note');
    assert.strictEqual(saveBrainParsed?.isWorkflow, true);
    assert.strictEqual(saveBrainParsed?.command, 'save-brain');
    assert.strictEqual(saveBrainParsed?.rawCommand, 'save_brain');
    assert.strictEqual(saveBrainParsed?.args, 'custom note');
    assert.strictEqual(
      saveBrainParsed?.normalizedPrompt,
      '/save-brain custom note',
      'Normalized prompt must be /save-brain custom note'
    );
    console.log('  ✓ /save_brain custom note normalized to /save-brain custom note');

    // 1.3 Verifies other underscore workflows with arguments
    const awfUpdateParsed = parseWorkflowCommand('/awf_update --check');
    assert.ok(awfUpdateParsed, 'parseWorkflowCommand must parse /awf_update');
    assert.strictEqual(awfUpdateParsed?.normalizedPrompt, '/awf-update --check');

    const tunnelParsed = parseWorkflowCommand('/cloudflare_tunnel status');
    assert.ok(tunnelParsed, 'parseWorkflowCommand must parse /cloudflare_tunnel');
    assert.strictEqual(tunnelParsed?.normalizedPrompt, '/cloudflare-tunnel status');
    console.log('  ✓ /awf_update and /cloudflare_tunnel normalized with arguments');

    // 1.4 Verifies standalone /recap without arguments is forwarded cleanly as /recap
    const recapParsed = parseWorkflowCommand('/recap');
    assert.ok(recapParsed, 'parseWorkflowCommand must parse standalone /recap');
    assert.strictEqual(recapParsed?.isWorkflow, true);
    assert.strictEqual(recapParsed?.command, 'recap');
    assert.strictEqual(recapParsed?.args, '', 'Standalone command must have empty args');
    assert.strictEqual(recapParsed?.normalizedPrompt, '/recap', 'Normalized prompt must be /recap');

    const auditParsed = parseWorkflowCommand('/audit');
    assert.ok(auditParsed, 'parseWorkflowCommand must parse standalone /audit');
    assert.strictEqual(auditParsed?.normalizedPrompt, '/audit');

    const saveBrainStandalone = parseWorkflowCommand('/save_brain');
    assert.ok(saveBrainStandalone, 'parseWorkflowCommand must parse standalone /save_brain');
    assert.strictEqual(saveBrainStandalone?.normalizedPrompt, '/save-brain');
    console.log('  ✓ Standalone workflow commands (/recap, /audit, /save_brain) normalized cleanly');

    // 1.5 Already-hyphenated IDE workflow commands preserved
    const alreadyHyphenated = parseWorkflowCommand('/save-brain my note');
    assert.ok(alreadyHyphenated);
    assert.strictEqual(alreadyHyphenated?.command, 'save-brain');
    assert.strictEqual(alreadyHyphenated?.normalizedPrompt, '/save-brain my note');

    // 1.6 Telegram bot username suffix stripped (@botname)
    const withBotMention = parseWorkflowCommand('/save_brain@autoplan_test_bot custom note');
    assert.ok(withBotMention);
    assert.strictEqual(withBotMention?.command, 'save-brain');
    assert.strictEqual(withBotMention?.args, 'custom note');
    assert.strictEqual(withBotMention?.normalizedPrompt, '/save-brain custom note');

    const standaloneWithMention = parseWorkflowCommand('/recap@autoplan_test_bot');
    assert.ok(standaloneWithMention);
    assert.strictEqual(standaloneWithMention?.normalizedPrompt, '/recap');
    console.log('  ✓ Telegram bot username mentions (@botname) stripped without corrupting prompt');

    // 1.7 Internal administration commands return null (not workflow commands)
    const internalCommands = ['/plans', '/plans list', '/screen', '/new_chat', '/help', '/start', '/plan_status', '/plan_skip', '/plan_stop'];
    for (const internalCmd of internalCommands) {
      const res = parseWorkflowCommand(internalCmd);
      assert.strictEqual(
        res,
        null,
        `Internal command ${internalCmd} must not be parsed as a workflow command`
      );
    }
    console.log('  ✓ Internal bot administration commands (/plans, /screen, etc.) rejected by workflow parser');

    // 1.8 Non-slash messages and invalid inputs return null
    assert.strictEqual(parseWorkflowCommand('hello world'), null);
    assert.strictEqual(parseWorkflowCommand('/unknown_custom_cmd'), null);
    assert.strictEqual(parseWorkflowCommand(''), null);
    assert.strictEqual(parseWorkflowCommand(null as any), null);
    console.log('  ✓ Non-workflow messages and invalid inputs safely handled\n');

    // ------------------------------------------------------------------------
    // TEST SUITE 2: Tricky Argument Robustness (Non-ASCII, Multiline, Quotes)
    // ------------------------------------------------------------------------
    console.log('[Suite 2] Robustness with Complex & Tricky Argument Patterns...');

    // 2.1 Multiline inputs preserved intact
    const multilineText = '/code implement login controller\nwith JWT\nand bcrypt verification';
    const multilineParsed = parseWorkflowCommand(multilineText);
    assert.ok(multilineParsed);
    assert.strictEqual(multilineParsed?.command, 'code');
    assert.strictEqual(
      multilineParsed?.args,
      'implement login controller\nwith JWT\nand bcrypt verification'
    );
    assert.strictEqual(
      multilineParsed?.normalizedPrompt,
      '/code implement login controller\nwith JWT\nand bcrypt verification'
    );
    console.log('  ✓ Multiline arguments preserved intact with original line breaks');

    // 2.2 Multiple consecutive spaces preserved in arguments
    const spacedText = '/brainstorm    explore   spaced   options  ';
    const spacedParsed = parseWorkflowCommand(spacedText);
    assert.ok(spacedParsed);
    assert.strictEqual(spacedParsed?.command, 'brainstorm');
    assert.strictEqual(spacedParsed?.args, 'explore   spaced   options');
    assert.strictEqual(spacedParsed?.normalizedPrompt, '/brainstorm explore   spaced   options');
    console.log('  ✓ Multiple consecutive spaces preserved within argument body');

    // 2.3 Non-ASCII and Vietnamese Unicode characters
    const unicodeText = '/brainstorm tạo ứng dụng quản lý chi tiêu cá nhân 🧠📊';
    const unicodeParsed = parseWorkflowCommand(unicodeText);
    assert.ok(unicodeParsed);
    assert.strictEqual(unicodeParsed?.command, 'brainstorm');
    assert.strictEqual(unicodeParsed?.args, 'tạo ứng dụng quản lý chi tiêu cá nhân 🧠📊');
    assert.strictEqual(
      unicodeParsed?.normalizedPrompt,
      '/brainstorm tạo ứng dụng quản lý chi tiêu cá nhân 🧠📊'
    );
    console.log('  ✓ Non-ASCII and Vietnamese Unicode text parsed with full fidelity');

    // 2.4 Quotes, braces, and punctuation
    const codeSnippet = `/code const config = { "mode": 'production', debug: false };`;
    const codeParsed = parseWorkflowCommand(codeSnippet);
    assert.ok(codeParsed);
    assert.strictEqual(codeParsed?.command, 'code');
    assert.strictEqual(codeParsed?.args, `const config = { "mode": 'production', debug: false };`);
    assert.strictEqual(
      codeParsed?.normalizedPrompt,
      `/code const config = { "mode": 'production', debug: false };`
    );
    console.log('  ✓ Code syntax, braces, and quotes preserved without corruption\n');

    // ------------------------------------------------------------------------
    // TEST SUITE 3: Performance & Latency Requirement (< 2ms)
    // ------------------------------------------------------------------------
    console.log('[Suite 3] Latency Benchmark (< 2ms overhead)...');

    const samplePrompt = '/save_brain comprehensive analysis of microservice architecture with Docker and Kubernetes';
    // Warm up JIT
    for (let i = 0; i < 200; i++) {
      parseWorkflowCommand(samplePrompt);
      normalizeTelegramWorkflowCommand(samplePrompt);
    }

    const iterations = 5000;
    const startHr = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      parseWorkflowCommand(samplePrompt);
    }
    const endHr = process.hrtime.bigint();
    const totalMs = Number(endHr - startHr) / 1e6;
    const avgLatencyMs = totalMs / iterations;

    console.log(`  ⚡ Executed ${iterations} parses in ${totalMs.toFixed(3)}ms (avg: ${avgLatencyMs.toFixed(5)}ms / op)`);
    assert(
      avgLatencyMs < 2.0,
      `Latency overhead of ${avgLatencyMs.toFixed(5)}ms exceeded the 2ms limit`
    );
    console.log('  ✓ Non-functional requirement satisfied: Latency overhead is < 2ms (measured < 0.01ms)\n');

    // ------------------------------------------------------------------------
    // TEST SUITE 4: TelegramBridge Text Dispatcher Pipeline Integration
    // ------------------------------------------------------------------------
    console.log('[Suite 4] TelegramBridge Pipeline Dispatch Integration...');

    const dispatchedPrompts: Array<{ text: string; options: any }> = [];
    let dispatchResultStatus: string = 'success';

    const mockPromptDispatcher: any = {
      dispatchPrompt: async (text: string, options?: any): Promise<DispatchResult> => {
        dispatchedPrompts.push({ text, options });
        if (dispatchResultStatus === 'error') {
          return {
            success: false,
            tier: 'domBridge',
            durationMs: 15000,
            error: 'Simulated prompt dispatch failure'
          };
        }
        return {
          success: true,
          tier: 'domBridge',
          durationMs: 120,
          status: 'success'
        };
      }
    };

    const { bot: testBot, sentMessages: testSent } = createMockBot();
    const authorizedUserId = 998877;

    bridge = new TelegramBridge({
      token: '123456:TEST_TOKEN',
      enabled: true,
      allowedUsers: [authorizedUserId],
      registryPath: testRegistryPath,
      logger: testLogger,
      botFactory: () => testBot,
      promptDispatcher: mockPromptDispatcher
    });

    bridge.initBot();
    await testBot.init();

    // 4.1 Verifies /brainstorm build a note app is normalized and dispatched to IDE as /brainstorm build a note app
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 201,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
        text: '/brainstorm build a note app',
        entities: [{ type: 'bot_command', offset: 0, length: 11 }]
      }
    } as any);

    assert.strictEqual(dispatchedPrompts.length, 1, 'Expected prompt to be dispatched');
    assert.strictEqual(
      dispatchedPrompts[0].text,
      '/brainstorm build a note app',
      'Dispatched prompt must match /brainstorm build a note app'
    );
    assert.strictEqual(
      dispatchedPrompts[0].options?.openNewConversation,
      false,
      'Must preserve conversation continuity (openNewConversation: false)'
    );
    assert.strictEqual(
      dispatchedPrompts[0].options?.timeoutMs,
      15000,
      'Timeout must be 15000ms'
    );
    const ackBrainstorm = testSent.find((m) => m.text && m.text.includes('⏳ Prompt sent to Antigravity IDE...'));
    assert(ackBrainstorm, 'Must immediately acknowledge receipt with status message');
    console.log('  ✓ /brainstorm build a note app successfully dispatched with continuity to Antigravity IDE');

    // 4.2 Verifies /save_brain custom note is normalized and dispatched as /save-brain custom note
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 202,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
        text: '/save_brain custom note',
        entities: [{ type: 'bot_command', offset: 0, length: 11 }]
      }
    } as any);

    assert.strictEqual(dispatchedPrompts.length, 1, 'Expected prompt to be dispatched');
    assert.strictEqual(
      dispatchedPrompts[0].text,
      '/save-brain custom note',
      'Dispatched prompt must be normalized to /save-brain custom note'
    );
    assert.strictEqual(
      dispatchedPrompts[0].options?.openNewConversation,
      false,
      'Must preserve conversation continuity'
    );
    console.log('  ✓ /save_brain custom note normalized and dispatched as /save-brain custom note');

    // 4.3 Verifies standalone /recap without arguments is forwarded cleanly as /recap
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 203,
      message: {
        message_id: 3,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
        text: '/recap',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    } as any);

    assert.strictEqual(dispatchedPrompts.length, 1, 'Expected standalone prompt to be dispatched');
    assert.strictEqual(
      dispatchedPrompts[0].text,
      '/recap',
      'Standalone command must be dispatched as /recap without trailing spaces'
    );
    assert.strictEqual(
      dispatchedPrompts[0].options?.openNewConversation,
      false,
      'Must preserve conversation continuity'
    );
    console.log('  ✓ Standalone /recap forwarded cleanly as /recap');

    // 4.4 Verifies standalone /audit without arguments is forwarded cleanly as /audit
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 204,
      message: {
        message_id: 4,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
        text: '/audit',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    } as any);

    assert.strictEqual(dispatchedPrompts.length, 1);
    assert.strictEqual(dispatchedPrompts[0].text, '/audit');
    console.log('  ✓ Standalone /audit forwarded cleanly as /audit');

    // 4.5 Verifies standalone /save_brain without arguments is forwarded cleanly as /save-brain
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 205,
      message: {
        message_id: 5,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
        text: '/save_brain',
        entities: [{ type: 'bot_command', offset: 0, length: 11 }]
      }
    } as any);

    assert.strictEqual(dispatchedPrompts.length, 1);
    assert.strictEqual(dispatchedPrompts[0].text, '/save-brain');
    console.log('  ✓ Standalone /save_brain forwarded cleanly as /save-brain');

    // 4.6 Verifies internal commands (/plans, /screen) continue to trigger their internal handlers and are not dispatched as raw prompts
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 206,
      message: {
        message_id: 6,
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
      'Internal command /plans must NEVER be dispatched to promptDispatcher'
    );
    const ackPlans = testSent.find((m) => m.text && m.text.includes('⏳ Prompt sent to Antigravity IDE...'));
    assert.strictEqual(ackPlans, undefined, '/plans must not send prompt receipt acknowledgment');
    console.log('  ✓ Internal command /plans handled internally and not dispatched as raw prompt');

    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 207,
      message: {
        message_id: 7,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
        text: '/screen',
        entities: [{ type: 'bot_command', offset: 0, length: 7 }]
      }
    } as any);

    assert.strictEqual(
      dispatchedPrompts.length,
      0,
      'Internal command /screen must NEVER be dispatched to promptDispatcher'
    );
    const ackScreen = testSent.find((m) => m.text && m.text.includes('⏳ Prompt sent to Antigravity IDE...'));
    assert.strictEqual(ackScreen, undefined, '/screen must not send prompt receipt acknowledgment');
    console.log('  ✓ Internal command /screen handled internally and not dispatched as raw prompt');

    // 4.7 Other internal commands (/new_chat, /help, /plan_status)
    const otherInternalCommands = ['/new_chat', '/help', '/plan_status', '/plan_skip', '/plan_stop'];
    for (let idx = 0; idx < otherInternalCommands.length; idx++) {
      dispatchedPrompts.length = 0;
      testSent.length = 0;
      const cmd = otherInternalCommands[idx];

      await testBot.handleUpdate({
        update_id: 208 + idx,
        message: {
          message_id: 8 + idx,
          date: Math.floor(Date.now() / 1000),
          chat: { id: authorizedUserId, type: 'private' },
          from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
          text: cmd,
          entities: [{ type: 'bot_command', offset: 0, length: cmd.length }]
        }
      } as any);

      assert.strictEqual(
        dispatchedPrompts.length,
        0,
        `Internal command ${cmd} must NOT be dispatched to promptDispatcher`
      );
    }
    console.log('  ✓ Additional internal commands (/new_chat, /help, /plan_status, etc.) verified');

    // 4.8 Free-form regular text messages pass through directly
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 250,
      message: {
        message_id: 50,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'AuthUser' },
        text: 'How do I optimize database query performance?'
      }
    } as any);

    assert.strictEqual(dispatchedPrompts.length, 1);
    assert.strictEqual(
      dispatchedPrompts[0].text,
      'How do I optimize database query performance?'
    );
    console.log('  ✓ Regular free-form text messages dispatched directly');

    // ------------------------------------------------------------------------
    // TEST SUITE 5: Plain Text Model Response Delivery
    // ------------------------------------------------------------------------
    console.log('\n[Suite 5] Plain Text Model Response Delivery Verification...');

    // Mock Context for awaitAndReplyModelResponse
    const replies: string[] = [];
    const mockCtx: any = {
      reply: async (msg: string) => {
        replies.push(msg);
      }
    };

    // Create a mock conversation transcript file
    const mockConvDir = path.join(testTempDir, 'mock_conv');
    fs.mkdirSync(mockConvDir, { recursive: true });
    const mockTranscriptFile = path.join(mockConvDir, 'transcript.jsonl');

    // Write a mock PLANNER_RESPONSE with markdown formatting to verify stripping
    const markdownModelReply = `## Architecture Recommendation\n\nTo build an **efficient** application:\n1. Use *Node.js* with **TypeScript**\n2. \`npm install grammy\` for bot APIs\n\n> Note: Always handle rate limits!`;

    const transcriptLine = JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      content: markdownModelReply
    }) + '\n';

    fs.writeFileSync(mockTranscriptFile, transcriptLine, 'utf8');

    await bridge.awaitAndReplyModelResponse(mockCtx, mockTranscriptFile, 0, 2000);

    assert.ok(replies.length >= 1, 'Expected model reply to be sent to Telegram');
    const fullReply = replies.join('\n');
    assert.strictEqual(
      fullReply.includes('## Architecture Recommendation'),
      false,
      'Markdown headers must be stripped to plain text'
    );
    assert.strictEqual(
      fullReply.includes('**efficient**'),
      false,
      'Markdown bold must be stripped to plain text'
    );
    assert.ok(
      fullReply.includes('Architecture Recommendation'),
      'Plain text title must be preserved'
    );
    assert.ok(
      fullReply.includes('efficient'),
      'Text content must be preserved'
    );
    console.log('  ✓ AI model responses stripped of markdown and delivered as clean plain text');

    console.log('\n================================================================');
    console.log(' ALL Phase 04 Workflow Prompt Dispatch & Args Tests PASSED!');
    console.log('================================================================\n');
  } finally {
    try {
      if (bridge) {
        await bridge.stop();
      }
    } catch {}
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase04WorkflowPromptDispatchAndArgsTest()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Phase 04 Test Suite Failed:', err);
    process.exit(1);
  });
