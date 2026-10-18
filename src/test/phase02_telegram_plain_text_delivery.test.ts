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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { Bot, Context } from 'grammy';
import { TelegramBridge } from '../telegramBridge';
import { ThrottledNotifier } from '../telegramNotifier';
import { splitMessage, stripMarkdownToPlainText } from '../telegramUtils';
import { debugLogger } from '../debugLogger';

interface MockApiCall {
  method: string;
  payload: any;
  timestamp: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a mock grammY bot with simulated Telegram Bot API and strict entity validation.
 */
function createMockBot(token: string = '9876543210:ABCdefGHIjklMNOpqrsTUVwxyz_123456') {
  const bot = new Bot(token, {
    botInfo: {
      id: 9876543210,
      is_bot: true,
      first_name: 'AutoPlanPlainTestBot',
      username: 'autoplan_plain_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false
    } as any
  });

  const apiCalls: MockApiCall[] = [];
  const sentMessages: any[] = [];
  const editedMessages: any[] = [];
  let nextMessageId = 1000;

  bot.api.config.use(async (_prev, method, payload) => {
    const record: MockApiCall = {
      method,
      payload: JSON.parse(JSON.stringify(payload || {})),
      timestamp: Date.now()
    };
    apiCalls.push(record);

    // Strict Telegram API entity parser simulation:
    // If parse_mode is set to 'Markdown' and text contains unescaped special characters
    // (such as raw underscores, unclosed bold, or stray brackets), real Telegram throws a 400 Bad Request error.
    if (record.payload.parse_mode === 'Markdown') {
      const text: string = record.payload.text || '';
      // Check for unclosed emphasis or raw underscores inside words (classic Telegram Markdown error)
      const unclosedBold = (text.match(/\*/g) || []).length % 2 !== 0;
      const unescapedUnderscores = /(?<!\\)_[a-zA-Z0-9]+(?<!\\)_/.test(text) === false && (text.match(/(?<!\\)_/g) || []).length % 2 !== 0;
      if (unclosedBold || unescapedUnderscores) {
        const parseErr: any = new Error("Bad Request: can't parse entities: can't find end of entity");
        parseErr.error_code = 400;
        parseErr.description = "Bad Request: can't parse entities: can't find end of entity";
        throw parseErr;
      }
    }

    if (method === 'sendMessage') {
      const msgId = ++nextMessageId;
      sentMessages.push({ ...record.payload, message_id: msgId });
      return {
        ok: true,
        result: {
          message_id: msgId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: record.payload.chat_id, type: 'private', first_name: 'Tester' },
          text: record.payload.text
        }
      } as any;
    }

    if (method === 'editMessageText') {
      editedMessages.push(record.payload);
      return {
        ok: true,
        result: {
          message_id: record.payload.message_id,
          date: Math.floor(Date.now() / 1000),
          chat: { id: record.payload.chat_id, type: 'private', first_name: 'Tester' },
          text: record.payload.text
        }
      } as any;
    }

    if (method === 'unpinChatMessage') {
      return { ok: true, result: true } as any;
    }

    return { ok: true, result: true } as any;
  });

  return { bot, apiCalls, sentMessages, editedMessages };
}

async function runPhase02TelegramPlainTextDeliveryTest() {
  console.log('================================================================');
  console.log(' Phase 02: Telegram Bot Response & Notification Plain Text Test');
  console.log('================================================================\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-phase02-'));
  const testLogger = debugLogger;

  try {
    // ------------------------------------------------------------------------
    // SUITE 1: Plain Text Chunking via splitMessage (> 4000 characters)
    // ------------------------------------------------------------------------
    console.log('[Suite 1] Plain text chunking via splitMessage (> 4000 chars)...');
    {
      // Build a 5500-character plain text message composed of numbered lines
      const lines: string[] = [];
      for (let i = 1; i <= 60; i++) {
        lines.push(`Line ${String(i).padStart(3, '0')}: Plain text status and system update report information without markdown.`);
      }
      const rawText = lines.join('\n');
      assert.ok(rawText.length > 4000, `Raw text must exceed 4000 characters (actual: ${rawText.length})`);

      const chunks = splitMessage(rawText, 3800);
      assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        assert.ok(chunk.length <= 3800, `Chunk ${i} length ${chunk.length} must not exceed 3800`);
        assert.ok(!chunk.includes('```'), `Chunk ${i} must not contain synthetic markdown fences`);
        assert.ok(!chunk.startsWith('\n'), `Chunk ${i} must not start with empty newline`);
        assert.ok(!chunk.endsWith('\n\n\n'), `Chunk ${i} must not end with excessive newlines`);

        // Ensure clean line boundaries: chunk must not start or end with a broken mid-word token
        const firstLine = chunk.split('\n')[0];
        assert.ok(
          firstLine.startsWith('Line ') || firstLine.startsWith('text status'),
          `Chunk should start with clean word boundary: "${firstLine.slice(0, 30)}"`
        );
      }

      // Ensure all lines from original text are present across chunks without truncation
      let reconstructed = '';
      for (const chunk of chunks) {
        reconstructed += (reconstructed ? '\n' : '') + chunk;
      }
      for (let i = 1; i <= 60; i++) {
        assert.ok(
          reconstructed.includes(`Line ${String(i).padStart(3, '0')}:`),
          `Reconstructed text must contain Line ${i}`
        );
      }

      console.log(`  ✓ Successfully split ${rawText.length} chars into ${chunks.length} clean line-bounded chunks <= 3800.`);
    }

    // ------------------------------------------------------------------------
    // SUITE 2: awaitAndReplyModelResponse Plain Text Sanitization & Delivery
    // ------------------------------------------------------------------------
    console.log('\n[Suite 2] awaitAndReplyModelResponse plain text transformation and reply...');
    {
      const transcriptFile = path.join(tempDir, 'transcript.jsonl');

      // AI Model response with rich Markdown: headers, bold, table, code fence, local link, HTML
      const markdownModelResponse = [
        '# Executive Plan Summary',
        '',
        'The automated execution completed with **100% success** and *zero failures*.',
        'Refer to local document [phase-02-spec.md](file:///workspace/plans/phase-02.md#L10-L20) for details.',
        'External documentation: [Telegram Bot Docs](https://core.telegram.org/bots).',
        '',
        '| Component | Status | Latency |',
        '| --- | --- | --- |',
        '| Dispatcher | Completed | 12ms |',
        '| Stripper | Completed | 4ms |',
        '',
        '```typescript',
        'function verifySystem(status: string): boolean {',
        '    const isActive = status === "ok";',
        '    return isActive;',
        '}',
        '```',
        '',
        '<div>Notification delivered safely.</div> <!-- hidden comment -->'
      ].join('\n');

      // Create transcript log JSONL entry
      const logEntry = JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: [],
        content: markdownModelResponse
      }) + '\n';

      fs.writeFileSync(transcriptFile, logEntry, 'utf8');

      const repliedChunks: Array<{ text: string; options?: any }> = [];
      const mockCtx: any = {
        from: { id: 12345, username: 'tester' },
        chat: { id: 12345 },
        reply: async (text: string, options?: any) => {
          repliedChunks.push({ text, options });
          return { message_id: 2001 };
        }
      };

      const bridge = new TelegramBridge({
        token: 'mock_token',
        allowedUsers: [12345],
        logger: testLogger
      });

      // Execute awaitAndReplyModelResponse
      await bridge.awaitAndReplyModelResponse(mockCtx, transcriptFile, 0, 3000);

      assert.ok(repliedChunks.length >= 1, `Expected at least 1 replied chunk, got ${repliedChunks.length}`);

      const fullReply = repliedChunks.map((c) => c.text).join('\n');

      // Verify parse_mode was NOT passed to ctx.reply
      for (let i = 0; i < repliedChunks.length; i++) {
        assert.strictEqual(
          repliedChunks[i].options,
          undefined,
          `ctx.reply chunk ${i} must be called without parse_mode options`
        );
      }

      // Verify zero raw markdown delimiters remain
      assert.ok(!fullReply.includes('# Executive Plan Summary'), 'Heading # must be stripped');
      assert.ok(fullReply.includes('Executive Plan Summary'), 'Heading title text must be preserved');
      assert.ok(!fullReply.includes('**100% success**'), 'Bold asterisks ** must be stripped');
      assert.ok(fullReply.includes('100% success'), 'Bold text must be retained');
      assert.ok(!fullReply.includes('```typescript'), 'Opening code fence must be stripped');
      assert.ok(!fullReply.includes('```'), 'All backtick fences must be stripped');
      assert.ok(fullReply.includes('function verifySystem(status: string): boolean {'), 'Code content preserved');
      assert.ok(!fullReply.includes('| --- |'), 'Table divider |---| must be stripped');
      assert.ok(fullReply.includes('• Component: Status, Latency'), 'Table header flattened into bullet');
      assert.ok(fullReply.includes('• Dispatcher: Completed, 12ms'), 'Table row flattened into bullet');
      assert.ok(!fullReply.includes('file:///workspace'), 'file:// local URL must be stripped');
      assert.ok(fullReply.includes('phase-02-spec.md'), 'Local link text retained');
      assert.ok(fullReply.includes('Telegram Bot Docs (https://core.telegram.org/bots)'), 'Web link formatted cleanly');
      assert.ok(!fullReply.includes('<div>'), 'HTML <div> tag must be stripped');
      assert.ok(!fullReply.includes('<!--'), 'HTML comment must be stripped');
      assert.ok(fullReply.includes('Notification delivered safely.'), 'HTML inner text retained');

      console.log('  ✓ awaitAndReplyModelResponse sanitized transcript content and replied as clean plain text.');
    }

    // ------------------------------------------------------------------------
    // SUITE 3: ThrottledNotifier Outbound Messages Omit parse_mode: 'Markdown'
    // ------------------------------------------------------------------------
    console.log('\n[Suite 3] ThrottledNotifier notification dispatch plain text verification...');
    {
      const { bot, apiCalls, sentMessages, editedMessages } = createMockBot();
      const mockChatId = 77777;

      const notifier = new ThrottledNotifier({
        bot,
        chatId: mockChatId,
        throttleMs: 100,
        logger: testLogger
      });

      // 3.1 Phase Start Notification
      console.log('  Testing handlePhaseStart...');
      await notifier.handlePhaseStart({
        fileName: '**phase_02_telegram_delivery.md**',
        phaseNumber: 2,
        total: 5
      });

      const startCall = apiCalls.find(
        (c) => c.method === 'sendMessage' && c.payload.text.includes('Phase Started')
      );
      assert.ok(startCall, 'Phase start message must be dispatched');
      assert.strictEqual(
        startCall.payload.parse_mode,
        undefined,
        'Phase start message must omit parse_mode (must be undefined)'
      );
      assert.ok(
        !startCall.payload.text.includes('**'),
        'Phase start text must not contain bold asterisks **'
      );
      assert.ok(
        startCall.payload.text.includes('Phase Started: phase_02_telegram_delivery.md (2/5)'),
        'Phase start text must display clean plain text phase name'
      );

      // 3.2 Phase Complete Notification
      console.log('  Testing handlePhaseComplete...');
      await notifier.handlePhaseComplete(
        { fileName: 'phase_02.md' },
        '**Result:** `100% passed` in *2.4s*',
        2,
        5
      );

      const completeCall = apiCalls.find(
        (c) => c.method === 'sendMessage' && c.payload.text.includes('Phase Completed')
      );
      assert.ok(completeCall, 'Phase complete message must be dispatched');
      assert.strictEqual(
        completeCall.payload.parse_mode,
        undefined,
        'Phase complete message must omit parse_mode'
      );
      assert.ok(
        !completeCall.payload.text.includes('**') && !completeCall.payload.text.includes('`'),
        'Phase complete message must not contain raw asterisks or backticks'
      );
      assert.ok(
        completeCall.payload.text.includes('Result: 100% passed in 2.4s'),
        'Completion summary must be converted to plain text'
      );

      // 3.3 Error Notification
      console.log('  Testing handleError...');
      await notifier.handleError(new Error('<b>Connection Timeout</b> to `api.service.internal`'));

      const errorCall = apiCalls.find(
        (c) => c.method === 'sendMessage' && c.payload.text.includes('Error:')
      );
      assert.ok(errorCall, 'Error message must be dispatched');
      assert.strictEqual(errorCall.payload.parse_mode, undefined, 'Error message must omit parse_mode');
      assert.ok(!errorCall.payload.text.includes('<b>'), 'HTML tags must be removed from error');
      assert.ok(!errorCall.payload.text.includes('`'), 'Backticks must be removed from error');
      assert.ok(
        errorCall.payload.text.includes('Connection Timeout to api.service.internal'),
        'Error content must be intact'
      );

      // 3.4 Completion Detected
      console.log('  Testing handleCompletionDetected...');
      await notifier.handleCompletionDetected({
        matchedContent: 'Done skul9x.\n\n### Deliverables\n- `telegramBridge.ts` updated\n- `telegramNotifier.ts` updated'
      });

      const compCall = apiCalls.find(
        (c) => c.method === 'sendMessage' && c.payload.text.includes('Completion Detected')
      );
      assert.ok(compCall, 'Completion detected message must be dispatched');
      assert.strictEqual(compCall.payload.parse_mode, undefined, 'Completion detected message must omit parse_mode');
      assert.ok(!compCall.payload.text.includes('*Completion Detected*'), 'Header must not contain asterisks');
      assert.ok(!compCall.payload.text.includes('`Done skul9x.`'), 'Header must not contain backticks');
      assert.ok(!compCall.payload.text.includes('### Deliverables'), 'Heading tokens ### must be stripped');
      assert.ok(compCall.payload.text.includes('• telegramBridge.ts updated'), 'List formatted as clean bullet point');

      // 3.5 Live Progress Edit
      console.log('  Testing live progress edit formatting...');
      notifier.handleLogUpdate(JSON.stringify({
        tool_calls: [{ toolAction: 'Reading `src/telegramBridge.ts`' }]
      }));
      await notifier.flushThrottleBuffer();

      const editCall = apiCalls.find((c) => c.method === 'editMessageText' || c.method === 'sendMessage');
      assert.ok(editCall, 'Live status call must exist');
      assert.strictEqual(editCall.payload.parse_mode, undefined, 'Live status call must omit parse_mode');
      assert.ok(!editCall.payload.text.includes('*Live Progress'), 'Live progress must not contain bold asterisks');

      notifier.dispose();
      console.log('  ✓ All ThrottledNotifier notifications dispatched with parse_mode: undefined and clean plain text.');
    }

    // ------------------------------------------------------------------------
    // SUITE 4: Simulated Telegram API Strict Entity Parsing Acceptance
    // ------------------------------------------------------------------------
    console.log('\n[Suite 4] Simulated Telegram API entity parsing validation (zero 400 errors)...');
    {
      const { bot, apiCalls } = createMockBot();
      const notifier = new ThrottledNotifier({
        bot,
        chatId: 88888,
        throttleMs: 50,
        logger: testLogger
      });

      // Send payload with complex identifiers, snake_case filenames, and markdown-like syntax
      // In old markdown mode, unescaped `session_token_key` and single `*` caused 400 parse errors.
      const trickyPayload = [
        'Running diagnostic on session_token_manager.ts...',
        'Checking parameter *max_retries and user_id_lookup.',
        'Result: variable_one = 10 * 5;'
      ].join('\n');

      const broadcastResult = await notifier.broadcastMessage(trickyPayload);
      assert.ok(broadcastResult.length > 0, 'Broadcast must succeed on first transmission');

      const dispatched = apiCalls.filter((c) => c.method === 'sendMessage');
      assert.ok(dispatched.length > 0, 'sendMessage must be called');

      for (const call of dispatched) {
        assert.strictEqual(
          call.payload.parse_mode,
          undefined,
          'Must use parse_mode: undefined to prevent Telegram entity parsing errors'
        );
      }

      notifier.dispose();
      console.log('  ✓ 100% of outbound messages accepted on first transmission without parse rejections.');
    }

    // ------------------------------------------------------------------------
    // SUITE 5: Custom Options Preservation with Safe Plain Text Delivery
    // ------------------------------------------------------------------------
    console.log('\n[Suite 5] Preservation of custom options (disable_notification, reply_markup)...');
    {
      const { bot, apiCalls } = createMockBot();
      const notifier = new ThrottledNotifier({
        bot,
        chatId: 99999,
        logger: testLogger
      });

      // Pass custom options alongside message, including an attempt to pass parse_mode: 'Markdown'
      await notifier.broadcastMessage('Status report with buttons', {
        disable_notification: true,
        reply_markup: { inline_keyboard: [[{ text: 'Refresh', callback_data: 'refresh' }]] },
        parse_mode: 'Markdown' // Should be overridden to undefined by safeSendMessage
      });

      const sendCall = apiCalls.find((c) => c.method === 'sendMessage');
      assert.ok(sendCall, 'sendMessage must have been recorded');
      assert.strictEqual(sendCall.payload.disable_notification, true, 'Custom options must be preserved');
      assert.ok(sendCall.payload.reply_markup, 'reply_markup must be preserved');
      assert.strictEqual(sendCall.payload.parse_mode, undefined, 'Forced parse_mode: Markdown must be overridden to undefined');

      notifier.dispose();
      console.log('  ✓ Custom Telegram options preserved while guaranteeing parse_mode: undefined.');
    }

    console.log('\n================================================================');
    console.log(' ALL Phase 02 Telegram Plain Text Delivery Tests PASSED!');
    console.log('================================================================\n');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase02TelegramPlainTextDeliveryTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 02 test FAILED with error:', err);
    process.exit(1);
  });
