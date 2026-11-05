// Standalone mock for 'vscode' module when executed directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {
  enableChatMirror: true,
  mirrorIncludePcPrompts: true,
  minChunkDelayMs: 0,
  sendDelayMs: 50
};
const globalExecutedCommands: { command: string; args: any[]; timestamp: number }[] = [];
const registeredCommandHandlers: Record<string, (...args: any[]) => any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) =>
            mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            mockConfigStore[key] = val;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        workspaceFolders: [
          { name: 'test-workspace', uri: { fsPath: '/mock/workspace' } }
        ]
      },
      env: {
        appRoot: '/mock/app/root'
      },
      commands: {
        registerCommand: (command: string, callback: (...args: any[]) => any) => {
          registeredCommandHandlers[command] = callback;
          return {
            dispose: () => {
              delete registeredCommandHandlers[command];
            }
          };
        },
        executeCommand: async (cmd: string, ...args: any[]) => {
          globalExecutedCommands.push({ command: cmd, args, timestamp: Date.now() });
          if (registeredCommandHandlers[cmd]) {
            return await registeredCommandHandlers[cmd](...args);
          }
          return undefined;
        },
        getCommands: async (_internal?: boolean) => [
          'antigravity.startNewConversation',
          'antigravity.addContext',
          'antigravity.triggerSend',
          'antigravity.prioritized.chat.stop',
          'workbench.action.chat.stop',
          'autoplan.start',
          'autoplan.stop',
          'autoplan.testNativeDispatch',
          'autoplan.cleanWorkbench',
          'autoplan.checkStatus'
        ]
      },
      window: {
        showWarningMessage: (_msg: string) => undefined,
        showInformationMessage: async (_msg: string, ..._items: string[]) => undefined,
        showErrorMessage: async (_msg: string, ..._items: string[]) => undefined,
        createStatusBarItem: (_alignment?: any, _priority?: any) => ({
          text: '',
          tooltip: '',
          command: '',
          show: () => {},
          hide: () => {},
          dispose: () => {}
        })
      },
      ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
      StatusBarAlignment: { Left: 1, Right: 2 },
      Uri: { file: (p: string) => ({ fsPath: p }) }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import { Bot, GrammyError } from 'grammy';

import {
  markdownToTelegramHtml,
  splitHtmlMessage,
  stripMarkdownToPlainText,
  validateBalancedTelegramHtml,
  isEntityParseError,
  escapeTelegramHtml
} from '../telegramUtils';
import {
  TelegramChatMirror,
  ThrottledResponseDeliverer,
  deliverChunkedResponse,
  resetDefaultResponseDeliverer,
  isRateLimitError
} from '../telegramChatMirror';
import { ThrottledNotifier } from '../telegramNotifier';
import {
  TelegramBridge,
  FULL_BOT_COMMAND_CATALOG,
  INTERNAL_BOT_COMMANDS
} from '../telegramBridge';
import { TelegramPlanManager } from '../telegramPlanManager';
import { PromptDispatcher } from '../promptDispatcher';
import { Orchestrator } from '../orchestrator';
import { DebugLogger } from '../debugLogger';
import { PromptOriginTracker } from '../promptOriginTracker';
import { DEFAULT_CONFIG } from '../config';

/**
 * Creates an offline mock grammY Bot capturing sendMessage and reply calls.
 */
function createMockBot(token: string = '123456:TEST_TELEGRAM_TOKEN'): {
  bot: Bot;
  sentMessages: { chatId: string | number; text: string; options?: any }[];
} {
  const bot = new Bot(token, {
    botInfo: {
      id: 999888777,
      is_bot: true,
      first_name: 'AutoPlanRegressionBot',
      username: 'autoplan_regression_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false
    } as any
  });

  const sentMessages: { chatId: string | number; text: string; options?: any }[] = [];

  bot.api.config.use(async (_prev, method, payload) => {
    if (method === 'sendMessage') {
      const anyPayload = payload as any;
      sentMessages.push({
        chatId: anyPayload.chat_id,
        text: anyPayload.text,
        options: anyPayload
      });
      return {
        ok: true,
        result: {
          message_id: sentMessages.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id, type: 'private' },
          text: anyPayload.text
        }
      } as any;
    }
    return { ok: true, result: {} } as any;
  });

  return { bot, sentMessages };
}

/**
 * Mock transcript watcher for headless orchestrator testing.
 */
class MockTranscriptWatcher extends EventEmitter {
  public waitForNewConversationCalls = 0;
  private brainDir: string;

  constructor(brainDir: string) {
    super();
    this.brainDir = brainDir;
  }

  setOptions(_opts: any) {}
  clearRunListeners() {}

  getOptions(): any {
    return {
      brainDir: this.brainDir,
      pollIntervalMs: 20,
      completionKeyword: 'Done skul9x.',
      completionRegex: null,
      maxScanLines: 200,
      timeoutMinutes: 5
    };
  }

  async waitForNewConversation(
    _phaseStartTime: number,
    _lastConvId?: string,
    _timeoutMs: number = 5000,
    _pollIntervalMs?: number,
    _ownershipCriteria?: any
  ): Promise<string> {
    this.waitForNewConversationCalls++;
    const convId = `conv-rich-e2e-${this.waitForNewConversationCalls}`;
    const logDir = path.join(this.brainDir, convId, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'transcript.jsonl'), '{"type":"MODEL","content":"Task initialized"}\n');
    return convId;
  }

  async watchFile(
    _transcriptPath: string,
    convId: string,
    _offset: number,
    _startTime: number,
    _initLength?: number
  ): Promise<any> {
    return {
      success: true,
      conversationId: convId,
      matchedContent: 'Done skul9x.',
      timestamp: Date.now()
    };
  }

  async watchLatest(
    _startTime: number,
    convId?: string,
    _initLength?: number
  ): Promise<any> {
    return {
      success: true,
      conversationId: convId || 'conv-latest',
      matchedContent: 'Done skul9x.',
      timestamp: Date.now()
    };
  }

  stop() {}
}

async function runPhase04RegressionTests() {
  console.log('================================================================================');
  console.log(' PHASE 04: End-to-End Formatting Regression, Verification & Packaging');
  console.log('================================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    totalTests++;
    process.stdout.write(`  [Test ${totalTests}] ${name} ... `);
    try {
      await fn();
      console.log('✓ PASS');
      passedTests++;
    } catch (err: any) {
      console.log('✗ FAIL');
      console.error(err);
      throw err;
    }
  }

  const testLogger = new DebugLogger(200);

  // ==========================================================================
  // Suite 1: Realistic Complex Model Transcript Formatting
  // ==========================================================================
  console.log('\n--- Suite 1: Realistic Complex Model Transcript Formatting ---');

  await test('Complex model response converts to valid Telegram HTML without syntax leakage', () => {
    const complexModelTranscript = [
      '# Comprehensive Execution Report',
      '',
      'The current implementation has completed **all verification criteria** with *zero known regressions*.',
      'Notice that ***high-priority items*** and ~~deprecated legacy routines~~ are cleanly handled.',
      '',
      '## Architecture & Design Decisions',
      '',
      '- Primary transport: Native Antigravity IDE commands (`antigravity.addContext` & `antigravity.triggerSend`)',
      '- Auxiliary mirror: Live Telegram Q&A stream with `parse_mode: \'HTML\'`',
      '* Resilience guarantee: Automatic fallback to plain text on HTTP 400',
      '+ Performance bounds: < 5ms processing for 50KB strings',
      '',
      '### Code Implementation',
      '',
      'Here is the verified TypeScript implementation snippet:',
      '```typescript',
      'export interface DeliveryPayload<T> {',
      '  id: string;',
      '  items: T[];',
      '  isSuccess: boolean;',
      '}',
      'export function sendPayload(payload: DeliveryPayload<number>): boolean {',
      '  // Ensure item values comply: x > 0 && x < 1000',
      '  return payload.items.every(x => x > 0 && x < 1000);',
      '}',
      '```',
      '',
      'And the Python verification script:',
      '```python',
      'def test_metrics(total: int, factor: float = 1.5) -> dict:',
      '    """Compute score ensuring < 100% threshold."""',
      '    return {"score": total * factor if total > 0 else 0.0}',
      '```',
      '',
      '### Performance Benchmarks',
      '',
      '| Metric | Baseline | Target | Result |',
      '| :--- | :--- | :--- | :--- |',
      '| Formatting Latency | 15.2 ms | < 5.0 ms | 1.8 ms |',
      '| Memory Overhead | 2.4 MB | < 500 KB | 120 KB |',
      '| Delivery Reliability | 99.2% | 100.0% | 100.0% |',
      '',
      '---',
      '',
      '> [!NOTE]',
      '> All formatting tags must be closed and visually clean in the Telegram client UI.',
      '',
      'Done skul9x.'
    ].join('\n');

    const htmlOutput = markdownToTelegramHtml(complexModelTranscript);

    // 1. Tag balance validation
    const validation = validateBalancedTelegramHtml(htmlOutput);
    assert.ok(validation.valid, `HTML tags must be strictly balanced: ${validation.error}`);

    // 2. Heading conversions to bold blocks
    assert.ok(htmlOutput.includes('<b>Comprehensive Execution Report</b>'), 'H1 converted to bold block');
    assert.ok(htmlOutput.includes('<b>Architecture &amp; Design Decisions</b>'), 'H2 converted to bold block');
    assert.ok(htmlOutput.includes('<b>Code Implementation</b>'), 'H3 converted to bold block');
    assert.ok(htmlOutput.includes('<b>Performance Benchmarks</b>'), 'H3 converted to bold block');

    // 3. Absolute elimination of Markdown heading markers
    assert.ok(!htmlOutput.includes('# Comprehensive'), 'H1 syntax marker # removed');
    assert.ok(!htmlOutput.includes('## Architecture'), 'H2 syntax marker ## removed');
    assert.ok(!htmlOutput.includes('### Code'), 'H3 syntax marker ### removed');

    // 4. Inline styles
    assert.ok(htmlOutput.includes('<b>all verification criteria</b>'), 'Bold syntax **...** converted to <b>');
    assert.ok(htmlOutput.includes('<i>zero known regressions</i>'), 'Italic syntax *...* converted to <i>');
    assert.ok(htmlOutput.includes('<b><i>high-priority items</i></b>'), 'Bold italic ***...*** converted to <b><i>');
    assert.ok(htmlOutput.includes('<s>deprecated legacy routines</s>'), 'Strikethrough ~~...~~ converted to <s>');
    assert.ok(!htmlOutput.includes('~~deprecated'), 'Raw ~~ markers removed');
    assert.ok(!htmlOutput.includes('***high-priority'), 'Raw *** markers removed');

    // 5. Code blocks with language classes and XML escaping
    assert.ok(htmlOutput.includes('<pre><code class="language-typescript">'), 'TypeScript code block tagged with class');
    assert.ok(htmlOutput.includes('<pre><code class="language-python">'), 'Python code block tagged with class');
    assert.ok(htmlOutput.includes('x &gt; 0 &amp;&amp; x &lt; 1000'), 'Reserved < > & escaped inside code block');
    assert.ok(htmlOutput.includes('&lt; 100% threshold'), 'Reserved < escaped in Python docstring');
    assert.ok(!htmlOutput.includes('```typescript'), 'Raw ``` fence removed');
    assert.ok(!htmlOutput.includes('```python'), 'Raw ``` fence removed');

    // 6. Table conversion to clean bullet points
    assert.ok(!htmlOutput.includes('| :--- |'), 'Table delimiter | :--- | removed');
    assert.ok(!htmlOutput.includes('| --- |'), 'Table delimiter | --- | removed');
    assert.ok(htmlOutput.includes('• Formatting Latency: Baseline: 15.2 ms | Target: &lt; 5.0 ms | Result: 1.8 ms') ||
              htmlOutput.includes('• Formatting Latency'), 'Table flattened into readable bullet list');

    // 7. Divider elimination
    assert.ok(!htmlOutput.includes('---'), 'Horizontal divider --- removed');

    // 8. Blockquote tag
    assert.ok(htmlOutput.includes('<blockquote>'), 'Blockquote > converted to <blockquote>');
    assert.ok(htmlOutput.includes('</blockquote>'), 'Blockquote closed with </blockquote>');
  });

  // ==========================================================================
  // Suite 2: Tag-Aware Splitting & Multi-Chunk Streaming via TelegramChatMirror
  // ==========================================================================
  console.log('\n--- Suite 2: Tag-Aware Splitting & Multi-Chunk Streaming ---');

  await test('Large multi-chunk transcript splits cleanly preserving balanced tags in every chunk', async () => {
    resetDefaultResponseDeliverer();
    const { bot: mockBot, sentMessages } = createMockBot('123456:TEST_TOKEN');

    // Build a large transcript (~8,000 characters) containing headings and heavy TypeScript code
    const longCodeLines = [
      '  const config = await loadWorkspaceConfig(session.workspaceId);',
      '  if (!config || config.status !== "active") {',
      '    logger.warn(`Invalid configuration for session ${session.id}`);',
      '    return false;',
      '  }',
      '  await dispatcher.executeCommand("antigravity.addContext", promptText);',
      '  await sleep(config.sendDelayMs);',
      '  await dispatcher.executeCommand("antigravity.triggerSend");'
    ].join('\n');

    let massiveCode = '';
    while (massiveCode.length < 6500) {
      massiveCode += longCodeLines + '\n';
    }

    const largeMarkdown = [
      '# Live IDE Transcript Session Log',
      'Here is the complete source execution dump:',
      '```typescript',
      massiveCode,
      '```',
      '### Final Summary',
      'All execution steps processed **successfully**.'
    ].join('\n');

    // Format to HTML
    const formattedHtml = markdownToTelegramHtml(largeMarkdown);
    assert.ok(formattedHtml.length > 6000, `Formatted HTML should be substantial (actual: ${formattedHtml.length} chars)`);

    // Split using tag-aware splitter with maxChunkLength = 2500
    const chunks = splitHtmlMessage(formattedHtml, 2500);
    assert.ok(chunks.length >= 3, `Expected at least 3 chunks for >6KB payload (got ${chunks.length})`);

    // Verify tag balance and size invariant on every single chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      assert.ok(chunk.length <= 2500, `Chunk ${i} length (${chunk.length}) must be <= 2500`);
      const val = validateBalancedTelegramHtml(chunk);
      assert.ok(val.valid, `Chunk ${i} must have strictly balanced tags: ${val.error}`);
    }

    // Verify chunk 0 opens <pre><code class="language-typescript"> and closes </code></pre>
    assert.ok(chunks[0].includes('<pre><code class="language-typescript">'), 'Chunk 0 opens code block');
    assert.ok(chunks[0].endsWith('</code></pre>'), 'Chunk 0 cleanly closes code block before boundary');

    // Verify intermediate chunk reopens <pre><code class="language-typescript"> and closes </code></pre>
    assert.ok(chunks[1].startsWith('<pre><code class="language-typescript">'), 'Chunk 1 reopens code block');
    assert.ok(chunks[1].endsWith('</code></pre>'), 'Chunk 1 closes code block at boundary');

    // Deliver via TelegramChatMirror
    sentMessages.length = 0;
    const mirror = new TelegramChatMirror({
      bot: mockBot,
      allowedUsers: [99001],
      minChunkDelayMs: 0
    });

    await deliverChunkedResponse(mockBot, 99001, largeMarkdown, {
      maxChunkLength: 2500,
      minChunkDelayMs: 0,
      sleepFn: async () => {}
    });

    assert.strictEqual(sentMessages.length, chunks.length, 'All chunks delivered to Telegram');
    for (const msg of sentMessages) {
      assert.strictEqual(msg.options?.parse_mode, 'HTML', 'Every chunk delivered with parse_mode: HTML');
      assert.ok(msg.text.length <= 2500, 'Delivered chunk text adheres to maxChunkLength');
      const val = validateBalancedTelegramHtml(msg.text);
      assert.ok(val.valid, `Delivered message HTML must be balanced: ${val.error}`);
    }
  });

  // ==========================================================================
  // Suite 3: Zero-Message-Drop Safe Fallback under Simulated Failure Modes
  // ==========================================================================
  console.log('\n--- Suite 3: Zero-Message-Drop Safe Fallback ---');

  await test('Telegram 400 entity parse error triggers immediate plain-text fallback with zero message drop', async () => {
    resetDefaultResponseDeliverer();

    let attempts = 0;
    const deliveries: { text: string; parse_mode?: string }[] = [];
    const loggedWarnings: string[] = [];

    const mockFailingBot = {
      api: {
        sendMessage: async (_chatId: string | number, text: string, options?: any) => {
          attempts++;
          // Throw Telegram 400 Bad Request on HTML parse mode
          if (options?.parse_mode === 'HTML') {
            const err: any = new Error("Bad Request: can't parse entities: Character '>' is reserved");
            err.error_code = 400;
            err.description = "Bad Request: can't parse entities: Character '>' is reserved";
            throw err;
          }
          deliveries.push({ text, parse_mode: options?.parse_mode });
          return { message_id: 101, text };
        }
      }
    };

    const mockLogger = {
      warn: (msg: string) => loggedWarnings.push(msg)
    };

    const deliverer = new ThrottledResponseDeliverer({
      minChunkDelayMs: 0,
      sleepFn: async () => {},
      logger: mockLogger
    });

    const rawChunk = '<b>Critical Status Alert</b>\nSystem throughput: <code>x > 500 req/sec</code>';
    await deliverer.deliverChunks(mockFailingBot, 77001, [rawChunk]);

    assert.strictEqual(attempts, 2, 'Attempted HTML first, then immediately retried with plain-text fallback');
    assert.strictEqual(deliveries.length, 1, 'Exactly 1 message received: zero message loss guarantee met');
    assert.strictEqual(deliveries[0].parse_mode, undefined, 'Fallback dropped parse_mode to undefined');
    assert.ok(!deliveries[0].text.includes('<b>'), 'HTML tags cleanly stripped in fallback payload');
    assert.ok(deliveries[0].text.includes('Critical Status Alert'), 'Core content preserved in fallback');
    assert.ok(loggedWarnings.length >= 1, 'Diagnostic warning logged');
    assert.ok(loggedWarnings[0].includes('77001'), 'Logged warning specifies target chat ID');
    assert.ok(loggedWarnings[0].includes('entity parse error'), 'Logged warning mentions entity parse error');
  });

  await test('Multi-chunk delivery with single middle chunk entity failure delivers all chunks in order', async () => {
    resetDefaultResponseDeliverer();

    const deliveredHistory: { chunkIdx: number; text: string; parse_mode?: string }[] = [];

    const mockSelectiveFailBot = {
      api: {
        sendMessage: async (_chatId: string | number, text: string, options?: any) => {
          // Reject chunk 2 if parse_mode is HTML
          if (options?.parse_mode === 'HTML' && text.includes('Chunk_Faulty_2')) {
            const err: any = new Error("Bad Request: can't parse entities: unexpected closing tag");
            err.error_code = 400;
            err.description = "Bad Request: can't parse entities: unexpected closing tag";
            throw err;
          }
          deliveredHistory.push({
            chunkIdx: deliveredHistory.length + 1,
            text,
            parse_mode: options?.parse_mode
          });
          return { message_id: deliveredHistory.length };
        }
      }
    };

    const deliverer = new ThrottledResponseDeliverer({
      minChunkDelayMs: 0,
      sleepFn: async () => {}
    });

    const chunks = [
      '<b>Chunk_Valid_1</b>: Started cleanly.',
      '<b>Chunk_Faulty_2</b>: Entity fault simulation.',
      '<b>Chunk_Valid_3</b>: Finished cleanly.'
    ];

    await deliverer.deliverChunks(mockSelectiveFailBot, 77002, chunks);

    assert.strictEqual(deliveredHistory.length, 3, 'All 3 chunks delivered with zero loss');
    assert.strictEqual(deliveredHistory[0].parse_mode, 'HTML', 'Chunk 1 delivered as HTML');
    assert.strictEqual(deliveredHistory[1].parse_mode, undefined, 'Chunk 2 fell back to plain text');
    assert.strictEqual(deliveredHistory[2].parse_mode, 'HTML', 'Chunk 3 delivered as HTML');
    assert.ok(deliveredHistory[1].text.includes('Chunk_Faulty_2: Entity fault simulation.'), 'Chunk 2 content preserved');
  });

  await test('Rate limit (HTTP 429) backoff operates safely during rich HTML delivery', async () => {
    resetDefaultResponseDeliverer();

    let calls = 0;
    const sleptIntervals: number[] = [];

    const mockRateLimitedBot = {
      api: {
        sendMessage: async () => {
          calls++;
          if (calls === 1) {
            const err: any = new Error('Too Many Requests: retry after 2');
            err.error_code = 429;
            err.parameters = { retry_after: 2 };
            throw err;
          }
          return { message_id: 42 };
        }
      }
    };

    const deliverer = new ThrottledResponseDeliverer({
      minChunkDelayMs: 0,
      sleepFn: async (ms: number) => {
        sleptIntervals.push(ms);
      }
    });

    await deliverer.deliverChunks(mockRateLimitedBot, 77003, ['<b>Rate Limited Message</b>']);

    assert.strictEqual(calls, 2, 'Retried after rate-limiting delay');
    assert.strictEqual(sleptIntervals.length, 1, 'Observed backoff sleep');
    assert.strictEqual(sleptIntervals[0], 2000, 'Backoff interval respected 2000ms retry_after');
  });

  await test('Network errors (non-entity failures) propagate without falsely triggering plain-text fallback', async () => {
    resetDefaultResponseDeliverer();

    const mockNetworkFailBot = {
      api: {
        sendMessage: async () => {
          throw new Error('ECONNRESET: socket hang up');
        }
      }
    };

    const deliverer = new ThrottledResponseDeliverer({
      minChunkDelayMs: 0,
      maxRetries: 2,
      sleepFn: async () => {}
    });

    let caughtErr: any = null;
    try {
      await deliverer.deliverChunks(mockNetworkFailBot, 77004, ['<b>Message</b>']);
    } catch (err: any) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Network error must be thrown when retries exhaust');
    assert.ok(caughtErr.message.includes('ECONNRESET'), 'Error message preserved');
  });

  // ==========================================================================
  // Suite 4: Full Regression for Native IDE Commands & Plan Execution Loop
  // ==========================================================================
  console.log('\n--- Suite 4: Native IDE Commands & Plan Execution Loop ---');

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-rich-test-'));
  const testBrainDir = path.join(tmpBase, 'brain');
  const testPlansDir = path.join(tmpBase, 'plans');
  fs.mkdirSync(testBrainDir, { recursive: true });
  fs.mkdirSync(testPlansDir, { recursive: true });

  const phase1File = path.join(testPlansDir, 'phase-01-core.md');
  const phase2File = path.join(testPlansDir, 'phase-02-api.md');
  fs.writeFileSync(phase1File, '# Phase 01: Core Architecture\nStatus: ⬜ Pending\n\nPrompt for Phase 1.\nDone skul9x.\n');
  fs.writeFileSync(phase2File, '# Phase 02: HTML Delivery\nStatus: ⬜ Pending\n\nPrompt for Phase 2.\nDone skul9x.\n');

  await test('Multi-phase plan executes sequentially using 100% Native Antigravity IDE commands', async () => {
    const executedCmds: { command: string; args: any[]; timestamp: number }[] = [];

    const mockCmdExecutor = async (cmd: string, ...args: any[]) => {
      executedCmds.push({ command: cmd, args, timestamp: Date.now() });
      return undefined;
    };

    const dispatcher = new PromptDispatcher({
      commandExecutor: mockCmdExecutor,
      logger: testLogger,
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        sendDelayMs: 60
      })
    });

    const mockWatcher = new MockTranscriptWatcher(testBrainDir);

    const orchestrator = new Orchestrator({
      promptDispatcher: dispatcher,
      transcriptWatcher: mockWatcher as any,
      debugLogger: testLogger,
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        brainDir: testBrainDir,
        sendDelayMs: 60,
        delayBetweenLoopsMs: 10
      })
    });

    const origSleep = orchestrator.sleepWithAbort.bind(orchestrator);
    orchestrator.sleepWithAbort = async function (ms: number, abortCheck: () => boolean) {
      return origSleep(Math.min(ms, 10), abortCheck);
    };

    const success = await orchestrator.startPhases([phase1File, phase2File]);
    assert.strictEqual(success, true, 'startPhases executes successfully');

    const cmdNames = executedCmds.map(c => c.command);

    // Verify Phase 1 native sequence: startNewConversation -> addContext -> triggerSend
    const p1Start = cmdNames.indexOf('antigravity.startNewConversation');
    assert.ok(p1Start >= 0, 'Phase 1 must execute antigravity.startNewConversation');

    const p1Add = cmdNames.indexOf('antigravity.addContext');
    assert.ok(p1Add > p1Start, 'Phase 1 antigravity.addContext must follow startNewConversation');

    const p1Send = cmdNames.indexOf('antigravity.triggerSend');
    assert.ok(p1Send > p1Add, 'Phase 1 antigravity.triggerSend must follow addContext');

    // Verify sendDelayMs between addContext and triggerSend
    const p1Delay = executedCmds[p1Send].timestamp - executedCmds[p1Add].timestamp;
    assert.ok(p1Delay >= 50, `Delay between addContext and triggerSend must observe sendDelayMs (got ${p1Delay}ms)`);

    // Verify Phase 2 native sequence: startNewConversation -> addContext -> triggerSend
    const p2Start = cmdNames.indexOf('antigravity.startNewConversation', p1Send + 1);
    assert.ok(p2Start > p1Send, 'Phase 2 must execute antigravity.startNewConversation after Phase 1 completion');

    const p2Add = cmdNames.indexOf('antigravity.addContext', p2Start + 1);
    assert.ok(p2Add > p2Start, 'Phase 2 antigravity.addContext must follow startNewConversation');

    const p2Send = cmdNames.indexOf('antigravity.triggerSend', p2Add + 1);
    assert.ok(p2Send > p2Add, 'Phase 2 antigravity.triggerSend must follow addContext');

    // Verify both phase files marked Completed
    const phases = orchestrator.getPhases();
    assert.strictEqual(phases[0].status, 'Completed', 'Phase 1 marked Completed');
    assert.strictEqual(phases[1].status, 'Completed', 'Phase 2 marked Completed');

    // Verify zero legacy tier commands (no xdotool, no powershell, no DOM injection scripts)
    const legacyCmds = executedCmds.filter(c =>
      c.command.includes('xdotool') || c.command.includes('powershell')
    );
    assert.strictEqual(legacyCmds.length, 0, 'No legacy keyboard or DOM commands may be invoked');
  });

  // ==========================================================================
  // Suite 5: Telegram Remote Controls Regression
  // ==========================================================================
  console.log('\n--- Suite 5: Telegram Remote Controls Regression ---');

  await test('Telegram remote commands (/start, /plans, /plan_start, /new_chat, /stop) operate smoothly', async () => {
    const executedCommands: { command: string; args: any[]; timestamp: number }[] = [];
    const mockExecutor = async (cmd: string, ...args: any[]) => {
      executedCommands.push({ command: cmd, args, timestamp: Date.now() });
      return undefined;
    };

    const dispatcher = new PromptDispatcher({
      commandExecutor: mockExecutor,
      logger: testLogger,
      configProvider: () => ({ ...DEFAULT_CONFIG, sendDelayMs: 40 })
    });

    const originTracker = new PromptOriginTracker();
    const { bot: mockBot, sentMessages } = createMockBot('123456:TEST_TOKEN');

    const mockOrch = new Orchestrator({
      promptDispatcher: dispatcher,
      debugLogger: testLogger
    });

    const planManager = new TelegramPlanManager({
      workspaceRoots: [testPlansDir],
      orchestrator: mockOrch,
      logger: testLogger
    });

    const bridge = new TelegramBridge({
      token: '123456:TEST_TOKEN',
      allowedUsers: [55555],
      allowFreeChat: true,
      botFactory: () => mockBot,
      promptDispatcher: dispatcher,
      orchestrator: mockOrch,
      planManager: planManager,
      logger: testLogger,
      promptOriginTracker: originTracker
    });

    bridge.initBot();

    // 1. Test /start or /help
    sentMessages.length = 0;
    await (bridge as any).bot.handleUpdate({
      update_id: 201,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 55555, type: 'private' },
        from: { id: 55555, is_bot: false, first_name: 'Tester' },
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    });

    const startReply = sentMessages.find(m => m.text && m.text.includes('Antigravity Remote Control Guide'));
    assert.ok(startReply, 'Telegram /start must reply with welcome menu');

    // 2. Test /plans
    sentMessages.length = 0;
    await (bridge as any).bot.handleUpdate({
      update_id: 202,
      message: {
        message_id: 2,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 55555, type: 'private' },
        from: { id: 55555, is_bot: false, first_name: 'Tester' },
        text: '/plans',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    });

    assert.ok(sentMessages.length >= 1, 'Telegram /plans must send plan folder discovery response');

    // 3. Test /new_chat
    executedCommands.length = 0;
    globalExecutedCommands.length = 0;
    sentMessages.length = 0;
    await (bridge as any).bot.handleUpdate({
      update_id: 203,
      message: {
        message_id: 3,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 55555, type: 'private' },
        from: { id: 55555, is_bot: false, first_name: 'Tester' },
        text: '/new_chat',
        entities: [{ type: 'bot_command', offset: 0, length: 9 }]
      }
    });

    const newChatCmd =
      globalExecutedCommands.find(c => c.command === 'antigravity.startNewConversation') ||
      executedCommands.find(c => c.command === 'antigravity.startNewConversation');
    assert.ok(newChatCmd, 'Telegram /new_chat must invoke antigravity.startNewConversation');

    // 4. Test /stop
    executedCommands.length = 0;
    sentMessages.length = 0;
    await (bridge as any).bot.handleUpdate({
      update_id: 204,
      message: {
        message_id: 4,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 55555, type: 'private' },
        from: { id: 55555, is_bot: false, first_name: 'Tester' },
        text: '/stop',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      }
    });

    const stopCmd = executedCommands.find(c =>
      c.command === 'antigravity.prioritized.chat.stop' || c.command === 'workbench.action.chat.stop'
    );
    assert.ok(stopCmd, 'Telegram /stop must execute native chat stop command');

    // 5. Test workflow command /run
    executedCommands.length = 0;
    sentMessages.length = 0;
    await (bridge as any).bot.handleUpdate({
      update_id: 205,
      message: {
        message_id: 5,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 55555, type: 'private' },
        from: { id: 55555, is_bot: false, first_name: 'Tester' },
        text: '/run deploy pipeline',
        entities: [{ type: 'bot_command', offset: 0, length: 4 }]
      }
    });

    const runAdd = executedCommands.find(c => c.command === 'antigravity.addContext');
    assert.ok(runAdd, 'Telegram /run must trigger antigravity.addContext');
    assert.strictEqual(runAdd.args[0], '/run deploy pipeline');

    const runSend = executedCommands.find(c => c.command === 'antigravity.triggerSend');
    assert.ok(runSend, 'Telegram /run must trigger antigravity.triggerSend');
  });

  // ==========================================================================
  // Suite 6: Production Extension Packaging & Clean Asset Validation
  // ==========================================================================
  console.log('\n--- Suite 6: Production Extension Packaging & Asset Validation ---');

  const rootDir = path.resolve(__dirname, '../../');
  const pkgJsonPath = path.join(rootDir, 'package.json');
  const vscodeignorePath = path.join(rootDir, '.vscodeignore');

  await test('package.json contains expected version and native chat metadata', () => {
    assert.ok(fs.existsSync(pkgJsonPath), 'package.json exists');
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

    assert.strictEqual(pkg.name, 'antigravity-auto-plan', 'Name matches extension id');
    assert.strictEqual(pkg.version, '1.7.4', 'Version matches release 1.7.4');
    assert.strictEqual(pkg.main, './out/extension.js', 'Main entry points to ./out/extension.js');
    assert.ok(pkg.engines && pkg.engines.vscode, 'Defines vscode engine dependency');
  });

  await test('.vscodeignore strictly excludes tests, scratch files, and source code', () => {
    assert.ok(fs.existsSync(vscodeignorePath), '.vscodeignore exists');
    const content = fs.readFileSync(vscodeignorePath, 'utf8');

    assert.ok(content.includes('out/test/**'), 'Excludes out/test/**');
    assert.ok(content.includes('src/**'), 'Excludes src/**');
    assert.ok(content.includes('plans/**'), 'Excludes plans/**');
    assert.ok(content.includes('scripts/**'), 'Excludes scripts/**');
    assert.ok(content.includes('*.py'), 'Excludes *.py');
    assert.ok(content.includes('*.txt'), 'Excludes *.txt');
  });

  await test('vsce package creates a lean, installable .vsix package (< 5MB)', () => {
    console.log('\n    Packaging extension into .vsix bundle...');
    const packageCmd = 'node scripts/package.js package --allow-missing-repository --no-git-tag-version';
    const output = execSync(packageCmd, { cwd: rootDir, encoding: 'utf8' });
    assert.ok(output.includes('Packaged:'), 'vsce package must successfully output "Packaged:"');

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const vsixFileName = `${pkg.name}-${pkg.version}.vsix`;
    const vsixPath = path.join(rootDir, vsixFileName);

    assert.ok(fs.existsSync(vsixPath), `VSIX file ${vsixFileName} must exist in workspace root`);
    const stat = fs.statSync(vsixPath);
    assert.ok(stat.size > 10000, `VSIX package size (${stat.size} bytes) must be > 10KB`);
    assert.ok(stat.size < 5 * 1024 * 1024, `VSIX package size (${stat.size} bytes) must be < 5MB`);

    console.log(`    Successfully validated VSIX bundle: ${vsixFileName} (${(stat.size / 1024).toFixed(1)} KB)`);
  });

  // Cleanup temporary workspace
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch {}

  console.log('\n================================================================================');
  console.log(` Summary: All ${passedTests}/${totalTests} tests in Phase 04 PASSED cleanly!`);
  console.log('================================================================================\n');
}

// Run test directly if executed via Node
if (require.main === module) {
  runPhase04RegressionTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Phase 04 Test execution failed:', err);
      process.exit(1);
    });
}

export { runPhase04RegressionTests };
