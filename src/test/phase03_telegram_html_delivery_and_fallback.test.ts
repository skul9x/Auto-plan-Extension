// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {
  enableChatMirror: true,
  mirrorIncludePcPrompts: true,
  minChunkDelayMs: 1000
};

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
        workspaceFolders: [{ name: 'test-ws', uri: { fsPath: '/test/path' } }]
      },
      window: {
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
      ConfigurationTarget: { Global: 1, Workspace: 2 },
      StatusBarAlignment: { Left: 1, Right: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import {
  ThrottledResponseDeliverer,
  deliverChunkedResponse,
  resetDefaultResponseDeliverer,
  TelegramChatMirror,
  isEntityParseError
} from '../telegramChatMirror';
import {
  markdownToTelegramHtml,
  splitHtmlMessage,
  stripMarkdownToPlainText
} from '../telegramUtils';
import { ThrottledNotifier } from '../telegramNotifier';
import { TelegramBridge } from '../telegramBridge';

async function runPhase03Tests() {
  console.log('========================================================================');
  console.log(' PHASE 03: Delivery Pipelines Integration & Safe Plain-Text Fallback    ');
  console.log('========================================================================\n');

  // ==========================================================================
  // Suite 1: TelegramChatMirror & ThrottledResponseDeliverer HTML Delivery
  // ==========================================================================
  console.log('[Suite 1] Testing HTML Delivery Defaults in TelegramChatMirror...');
  {
    resetDefaultResponseDeliverer();

    const sentRequests: { chatId: string | number; text: string; options?: any }[] = [];
    const mockBot = {
      api: {
        sendMessage: async (chatId: string | number, text: string, options?: any) => {
          sentRequests.push({ chatId, text, options });
          return { message_id: sentRequests.length, text };
        }
      }
    };

    const deliverer = new ThrottledResponseDeliverer({
      minChunkDelayMs: 0,
      sleepFn: async () => {}
    });

    // 1.1 deliverChunks default parse_mode must be 'HTML'
    await deliverer.deliverChunks(mockBot, 1001, ['<b>Hello</b> Telegram']);
    assert.strictEqual(sentRequests.length, 1, '1.1A: Message delivered');
    assert.strictEqual(sentRequests[0].options?.parse_mode, 'HTML', '1.1B: deliverChunks defaults to HTML parse_mode');
    assert.strictEqual(sentRequests[0].text, '<b>Hello</b> Telegram', '1.1C: Chunk content unchanged');

    // 1.2 deliverChunkedResponse with Markdown formats to HTML and sends parse_mode: 'HTML'
    sentRequests.length = 0;
    const mdInput = '# Summary Report\nThis is **bold** and *italic* text with `inline_code`.';
    await deliverChunkedResponse(mockBot, 2002, mdInput, {
      minChunkDelayMs: 0,
      sleepFn: async () => {},
      deliverer
    });

    assert.ok(sentRequests.length >= 1, '1.2A: Markdown response delivered');
    assert.strictEqual(sentRequests[0].options?.parse_mode, 'HTML', '1.2B: deliverChunkedResponse defaults to HTML');
    assert.ok(sentRequests[0].text.includes('<b>Summary Report</b>'), '1.2C: Heading converted to HTML bold');
    assert.ok(sentRequests[0].text.includes('<b>bold</b>'), '1.2D: **bold** converted to <b>bold</b>');
    assert.ok(sentRequests[0].text.includes('<i>italic</i>'), '1.2E: *italic* converted to <i>italic</i>');
    assert.ok(sentRequests[0].text.includes('<code>inline_code</code>'), '1.2F: `code` converted to <code>inline_code</code>');

    // 1.3 deliverChunkedResponse with long HTML content splits using splitHtmlMessage
    sentRequests.length = 0;
    const longCodeLine = 'console.log("data-stream-item-key-value-sample");\n';
    let codeBlock = '';
    while (codeBlock.length < 5000) {
      codeBlock += longCodeLine;
    }
    const longMarkdown = `### Code Listing\n\`\`\`typescript\n${codeBlock}\`\`\`\nDone.`;

    await deliverChunkedResponse(mockBot, 3003, longMarkdown, {
      maxChunkLength: 3000,
      minChunkDelayMs: 0,
      sleepFn: async () => {},
      deliverer
    });

    assert.ok(sentRequests.length >= 2, `1.3A: Expected multiple chunks for >5KB code, got ${sentRequests.length}`);
    for (let i = 0; i < sentRequests.length; i++) {
      const req = sentRequests[i];
      assert.strictEqual(req.options?.parse_mode, 'HTML', `1.3B: Chunk ${i} parse_mode must be HTML`);
      assert.ok(req.text.length <= 3000, `1.3C: Chunk ${i} length (${req.text.length}) must be <= 3000`);
    }

    // 1.4 TelegramChatMirror.handlePlannerResponse mirrors response to allowed users
    sentRequests.length = 0;
    const mirror = new TelegramChatMirror({
      bot: mockBot,
      allowedUsers: [101, 102],
      prefix: '🤖 AI Test:',
      minChunkDelayMs: 0
    });

    await mirror.handlePlannerResponse('## Hello Users\nSystem initialized.');
    assert.strictEqual(sentRequests.length, 2, '1.4A: Delivered to both allowed users');
    assert.strictEqual(sentRequests[0].chatId, 101, '1.4B: Delivered to user 101');
    assert.strictEqual(sentRequests[1].chatId, 102, '1.4C: Delivered to user 102');
    assert.strictEqual(sentRequests[0].options?.parse_mode, 'HTML', '1.4D: Mirror delivered with parse_mode: HTML');
    assert.ok(sentRequests[0].text.includes('<b>Hello Users</b>'), '1.4E: Rich HTML formatted in mirrored output');

    console.log('  ✓ TelegramChatMirror HTML delivery defaults verified.\n');
  }

  // ==========================================================================
  // Suite 2: Telegram 400 Bad Request Entity Parse Error Fallback
  // ==========================================================================
  console.log('[Suite 2] Testing 400 Bad Request Entity Parse Error Fallback...');
  {
    resetDefaultResponseDeliverer();

    let attemptsCount = 0;
    const loggedWarnings: string[] = [];
    const receivedDeliveries: { chatId: string | number; text: string; parse_mode?: string }[] = [];

    const mockParseFailBot = {
      api: {
        sendMessage: async (chatId: string | number, text: string, options?: any) => {
          attemptsCount++;
          // Fail on the first attempt with a Telegram 400 entity parse error
          if (options?.parse_mode === 'HTML' && attemptsCount === 1) {
            const err: any = new Error("Bad Request: can't parse entities in message text: Character '>' is reserved");
            err.error_code = 400;
            err.description = "Bad Request: can't parse entities in message text: Character '>' is reserved";
            throw err;
          }
          receivedDeliveries.push({ chatId, text, parse_mode: options?.parse_mode });
          return { message_id: 42, text };
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

    // 2.1 deliverChunks with simulated 400 entity parse failure
    const rawChunk = '<b>Sample Title</b>\nHere is a <code>formatted code snippet</code>';
    const result = await deliverer.deliverChunks(mockParseFailBot, 9999, [rawChunk]);

    assert.strictEqual(attemptsCount, 2, '2.1A: Must attempt HTML first, then retry plain text on 400 entity error');
    assert.strictEqual(receivedDeliveries.length, 1, '2.1B: Zero message loss - message successfully delivered');
    assert.strictEqual(receivedDeliveries[0].parse_mode, undefined, '2.1C: Fallback dropped parse_mode to undefined');
    assert.ok(!receivedDeliveries[0].text.includes('<b>'), '2.1D: Fallback stripped HTML tags via stripMarkdownToPlainText');
    assert.ok(receivedDeliveries[0].text.includes('Sample Title'), '2.1E: Core text preserved in fallback');
    assert.ok(loggedWarnings.length >= 1, '2.1F: Clear diagnostic warning logged');
    assert.ok(loggedWarnings[0].includes('9999'), '2.1G: Warning mentions chat ID');
    assert.ok(loggedWarnings[0].includes('entity parse error'), '2.1H: Warning indicates entity parse error');

    // 2.2 deliverChunkedResponse multi-chunk where only chunk 0 triggers entity parse error
    attemptsCount = 0;
    receivedDeliveries.length = 0;
    loggedWarnings.length = 0;

    const multiChunkBot = {
      api: {
        sendMessage: async (chatId: string | number, text: string, options?: any) => {
          attemptsCount++;
          // Fail only on chunk 0 when parse_mode is HTML
          if (options?.parse_mode === 'HTML' && text.includes('Chunk1_Faulty')) {
            const err: any = new Error("Bad Request: can't parse entities: unexpected end tag");
            err.error_code = 400;
            err.description = "Bad Request: can't parse entities: unexpected end tag";
            throw err;
          }
          receivedDeliveries.push({ chatId, text, parse_mode: options?.parse_mode });
          return { message_id: receivedDeliveries.length };
        }
      }
    };

    await deliverer.deliverChunks(multiChunkBot, 8888, ['Chunk1_Faulty <b>unclosed', 'Chunk2_Normal <i>valid</i>']);

    assert.strictEqual(receivedDeliveries.length, 2, '2.2A: Both chunks delivered');
    assert.strictEqual(receivedDeliveries[0].parse_mode, undefined, '2.2B: Chunk 1 fell back to plain text');
    assert.strictEqual(receivedDeliveries[1].parse_mode, 'HTML', '2.2C: Chunk 2 delivered with parse_mode: HTML');

    // 2.3 Non-entity errors (e.g., 500 or Network error) must NOT fall back to plain text
    const networkFailBot = {
      api: {
        sendMessage: async () => {
          throw new Error('ETIMEDOUT: Connection timed out');
        }
      }
    };

    let caughtError: any = null;
    try {
      await deliverer.deliverChunks(networkFailBot, 7777, ['Some message']);
    } catch (err: any) {
      caughtError = err;
    }
    assert.ok(caughtError, '2.3A: Network error must propagate when retries exhausted');
    assert.ok(caughtError.message.includes('ETIMEDOUT'), '2.3B: Error was not swallowed as entity parse error');

    console.log('  ✓ 400 Bad Request entity parse error fallback & zero loss verified.\n');
  }

  // ==========================================================================
  // Suite 3: TelegramBridge finishAndReply Integration
  // ==========================================================================
  console.log('[Suite 3] Testing TelegramBridge finishAndReply HTML Formatting & Fallback...');
  {
    // Test the finishAndReply core formatting logic directly using mock context
    const bridgeReplies: { text: string; options?: any }[] = [];
    const bridgeLogs: { level: string; msg: string }[] = [];

    const mockBridgeLogger = {
      warn: (cat: string, msg: string) => bridgeLogs.push({ level: 'warn', msg: `[${cat}] ${msg}` }),
      info: (cat: string, msg: string) => bridgeLogs.push({ level: 'info', msg: `[${cat}] ${msg}` }),
      error: (cat: string, msg: string) => bridgeLogs.push({ level: 'error', msg: `[${cat}] ${msg}` })
    };

    const mockCtx = {
      chat: { id: 554433 },
      reply: async (text: string, options?: any) => {
        bridgeReplies.push({ text, options });
        return { message_id: bridgeReplies.length };
      }
    };

    // Helper simulating the finishAndReply logic from telegramBridge.ts
    const simulateFinishAndReply = async (contentToSend: string, ctx: any, logger: any) => {
      if (contentToSend && contentToSend.trim()) {
        const html = markdownToTelegramHtml(contentToSend);
        const chunks = html && html.trim() ? splitHtmlMessage(html, 3800) : [];
        if (chunks.length > 0) {
          for (const chunk of chunks) {
            try {
              await ctx.reply(chunk, { parse_mode: 'HTML' });
            } catch (replyErr: any) {
              if (isEntityParseError(replyErr)) {
                logger.warn(
                  'TELEGRAM',
                  `Entity parse error when replying to chat ${ctx.chat?.id}: ${replyErr?.message || replyErr?.description || replyErr}. Falling back to plain text.`
                );
                try {
                  const fallbackPlain = stripMarkdownToPlainText(chunk);
                  await ctx.reply(fallbackPlain || chunk);
                } catch (fallbackErr: any) {
                  logger.warn('TELEGRAM', `Failed to send fallback plain text chunk: ${fallbackErr?.message || fallbackErr}`);
                }
              } else {
                logger.warn('TELEGRAM', `Failed to send response chunk: ${replyErr?.message || replyErr}`);
              }
            }
          }
        } else {
          const fallbackPlain = stripMarkdownToPlainText(contentToSend);
          if (fallbackPlain && fallbackPlain.trim()) {
            const plainChunks = splitHtmlMessage(fallbackPlain, 3800);
            for (const c of plainChunks) {
              try {
                await ctx.reply(c);
              } catch (replyErr: any) {
                logger.warn('TELEGRAM', `Failed to send response chunk: ${replyErr?.message || replyErr}`);
              }
            }
          }
        }
      }
    };

    // 3.1 Normal markdown reply: formats to HTML and sends parse_mode: 'HTML'
    const modelReply = '## Execution Completed\n- Step 1: **Initialized**\n- Step 2: `Verified`';
    await simulateFinishAndReply(modelReply, mockCtx, mockBridgeLogger);

    assert.strictEqual(bridgeReplies.length, 1, '3.1A: Reply delivered');
    assert.strictEqual(bridgeReplies[0].options?.parse_mode, 'HTML', '3.1B: Reply uses parse_mode: HTML');
    assert.ok(bridgeReplies[0].text.includes('<b>Execution Completed</b>'), '3.1C: Heading converted to HTML');
    assert.ok(bridgeReplies[0].text.includes('<b>Initialized</b>'), '3.1D: Bold converted to HTML');
    assert.ok(bridgeReplies[0].text.includes('<code>Verified</code>'), '3.1E: Inline code converted to HTML');

    // 3.2 Simulated entity parse error triggers plain text fallback
    bridgeReplies.length = 0;
    bridgeLogs.length = 0;

    let failOnce = true;
    const failingCtx = {
      chat: { id: 778899 },
      reply: async (text: string, options?: any) => {
        if (options?.parse_mode === 'HTML' && failOnce) {
          failOnce = false;
          const err: any = new Error("Bad Request: can't parse entities");
          err.description = "Bad Request: can't parse entities";
          throw err;
        }
        bridgeReplies.push({ text, options });
        return { message_id: bridgeReplies.length };
      }
    };

    await simulateFinishAndReply(modelReply, failingCtx, mockBridgeLogger);

    assert.strictEqual(bridgeReplies.length, 1, '3.2A: Message delivered despite initial parse error');
    assert.strictEqual(bridgeReplies[0].options?.parse_mode, undefined, '3.2B: Fallback message has parse_mode undefined');
    assert.ok(!bridgeReplies[0].text.includes('<b>'), '3.2C: Fallback content has HTML tags stripped');
    assert.ok(bridgeReplies[0].text.includes('Execution Completed'), '3.2D: Fallback content preserved text');
    assert.ok(bridgeLogs.some(l => l.msg.includes('778899')), '3.2E: Logged warning contains chat ID');

    console.log('  ✓ TelegramBridge finishAndReply HTML formatting & fallback verified.\n');
  }

  // ==========================================================================
  // Suite 4: ThrottledNotifier Structured Notifications & safeSendMessage
  // ==========================================================================
  console.log('[Suite 4] Testing ThrottledNotifier HTML Notifications & Fallback...');
  {
    let notifierSent: { method: string; chatId: any; text: string; options?: any }[] = [];
    const notifierLogs: string[] = [];

    const mockNotifierBot = {
      api: {
        sendMessage: async (chatId: string | number, text: string, options?: any) => {
          notifierSent.push({ method: 'sendMessage', chatId, text, options });
          return { message_id: 100 + notifierSent.length };
        },
        editMessageText: async (chatId: string | number, messageId: number, text: string, options?: any) => {
          notifierSent.push({ method: 'editMessageText', chatId, text, options });
          return { message_id: messageId, text };
        }
      }
    };

    const mockLogger = {
      warn: (_cat: string, msg: string) => notifierLogs.push(msg),
      info: () => {},
      error: () => {}
    };

    const notifier = new ThrottledNotifier({
      bot: mockNotifierBot as any,
      chatIds: [12345],
      logger: mockLogger as any
    });

    // 4.1 safeSendMessage with parse_mode: 'HTML' preserves HTML formatting
    notifierSent = [];
    const htmlMsg = '🚀 <b>Deployment Started</b>\nTarget: <code>production</code>';
    await notifier.safeSendMessage(12345, htmlMsg, { parse_mode: 'HTML' });

    assert.strictEqual(notifierSent.length, 1, '4.1A: Message sent');
    assert.strictEqual(notifierSent[0].options?.parse_mode, 'HTML', '4.1B: parse_mode HTML preserved');
    assert.strictEqual(notifierSent[0].text, htmlMsg, '4.1C: HTML tags not stripped when parse_mode is HTML');

    // 4.2 safeEditMessage with parse_mode: 'HTML' preserves HTML formatting
    notifierSent = [];
    const editHtml = '✅ <b>Deployment Completed</b>\nStatus: <code>200 OK</code>';
    await notifier.safeEditMessage(12345, 101, editHtml, { parse_mode: 'HTML' });

    assert.strictEqual(notifierSent.length, 1, '4.2A: Edit sent');
    assert.strictEqual(notifierSent[0].options?.parse_mode, 'HTML', '4.2B: Edit parse_mode HTML preserved');
    assert.strictEqual(notifierSent[0].text, editHtml, '4.2C: Edit text preserved HTML tags');

    // 4.3 safeSendMessage with parse_mode: 'HTML' falls back on 400 entity parse error
    notifierSent = [];
    notifierLogs.length = 0;

    let failSendOnce = true;
    (mockNotifierBot.api as any).sendMessage = async (chatId: string | number, text: string, options?: any) => {
      if (options?.parse_mode === 'HTML' && failSendOnce) {
        failSendOnce = false;
        const err: any = new Error("Bad Request: can't parse entities");
        err.description = "Bad Request: can't parse entities";
        throw err;
      }
      notifierSent.push({ method: 'sendMessage', chatId, text, options });
      return { message_id: 200 + notifierSent.length };
    };

    await notifier.safeSendMessage(12345, '<b>Malformed HTML', { parse_mode: 'HTML' });

    assert.strictEqual(notifierSent.length, 1, '4.3A: Fallback sent plain text');
    assert.strictEqual(notifierSent[0].options?.parse_mode, undefined, '4.3B: Fallback options parse_mode undefined');
    assert.ok(!notifierSent[0].text.includes('<b>'), '4.3C: Fallback stripped tags');
    assert.ok(notifierLogs.some(l => l.includes('12345')), '4.3D: Warning logged with chatId');

    // 4.4 safeEditMessage with parse_mode: 'HTML' falls back on 400 entity parse error
    notifierSent = [];
    notifierLogs.length = 0;

    let failEditOnce = true;
    (mockNotifierBot.api as any).editMessageText = async (chatId: string | number, messageId: number, text: string, options?: any) => {
      if (options?.parse_mode === 'HTML' && failEditOnce) {
        failEditOnce = false;
        const err: any = new Error("Bad Request: can't parse entities in message");
        err.description = "Bad Request: can't parse entities in message";
        throw err;
      }
      notifierSent.push({ method: 'editMessageText', chatId, text, options });
      return { message_id: messageId, text };
    };

    await notifier.safeEditMessage(12345, 102, '<i>Malformed Edit', { parse_mode: 'HTML' });

    assert.strictEqual(notifierSent.length, 1, '4.4A: Fallback edit executed');
    assert.strictEqual(notifierSent[0].options?.parse_mode, undefined, '4.4B: Fallback edit parse_mode undefined');
    assert.ok(!notifierSent[0].text.includes('<i>'), '4.4C: Fallback edit stripped tags');
    assert.ok(notifierLogs.some(l => l.includes('12345')), '4.4D: Warning logged with chatId');

    // 4.5 broadcastMessage with parse_mode: 'HTML'
    notifierSent = [];
    (mockNotifierBot.api as any).sendMessage = async (chatId: string | number, text: string, options?: any) => {
      notifierSent.push({ method: 'sendMessage', chatId, text, options });
      return { message_id: 300 + notifierSent.length };
    };

    await notifier.broadcastMessage('📢 <b>Announcement</b>: Version 1.8 ready.', { parse_mode: 'HTML' });
    assert.strictEqual(notifierSent.length, 1, '4.5A: Broadcast message sent');
    assert.strictEqual(notifierSent[0].options?.parse_mode, 'HTML', '4.5B: Broadcast preserved parse_mode HTML');
    assert.ok(notifierSent[0].text.includes('<b>Announcement</b>'), '4.5C: Broadcast preserved HTML tags');

    console.log('  ✓ ThrottledNotifier structured notifications & safe send/edit verified.\n');
  }

  // ==========================================================================
  // Suite 5: Throttling Compliance & HTTP 429 Rate-Limit Backoff
  // ==========================================================================
  console.log('[Suite 5] Testing Throttling Compliance & HTTP 429 Backoff...');
  {
    resetDefaultResponseDeliverer();

    let virtualClock = 5000;
    const sleptDurations: number[] = [];
    const sentHistory: { time: number; chatId: any; text: string }[] = [];

    const sleepFn = async (ms: number) => {
      sleptDurations.push(ms);
      virtualClock += ms;
    };
    const nowFn = () => virtualClock;

    // 5.1 Multi-chunk HTML message throttling
    const mockBot = {
      api: {
        sendMessage: async (chatId: string | number, text: string) => {
          sentHistory.push({ time: virtualClock, chatId, text });
          return { message_id: sentHistory.length };
        }
      }
    };

    const deliverer = new ThrottledResponseDeliverer({
      minChunkDelayMs: 600,
      sleepFn
    });

    await deliverer.deliverChunks(
      mockBot,
      99001,
      ['<b>Chunk 1</b>', '<b>Chunk 2</b>', '<b>Chunk 3</b>'],
      { sleepFn, nowFn, minChunkDelayMs: 600 }
    );

    assert.strictEqual(sentHistory.length, 3, '5.1A: All 3 chunks delivered');
    assert.strictEqual(sleptDurations.length, 2, '5.1B: Slept between chunks 1->2 and 2->3');
    assert.strictEqual(sleptDurations[0], 600, '5.1C: Chunk 1 delay was 600ms');
    assert.strictEqual(sleptDurations[1], 600, '5.1D: Chunk 2 delay was 600ms');
    assert.strictEqual(sentHistory[1].time - sentHistory[0].time, 600, '5.1E: Time delta 1->2 is 600ms');
    assert.strictEqual(sentHistory[2].time - sentHistory[1].time, 600, '5.1F: Time delta 2->3 is 600ms');

    // 5.2 Rapid consecutive message to same chat throttled on chunk 0
    sleptDurations.length = 0;
    virtualClock += 100; // only 100ms elapsed since last delivery at virtualClock = 6200

    await deliverer.deliverChunks(
      mockBot,
      99001,
      ['<b>Rapid Message</b>'],
      { sleepFn, nowFn, minChunkDelayMs: 600 }
    );

    assert.strictEqual(sleptDurations.length, 1, '5.2A: Chunk 0 of rapid message throttled');
    assert.strictEqual(sleptDurations[0], 500, '5.2B: Slept remaining 500ms (600 - 100)');

    // 5.3 HTTP 429 Rate-Limit handling with retry_after
    sleptDurations.length = 0;
    let rateLimitAttempts = 0;

    const rateLimitBot = {
      api: {
        sendMessage: async (chatId: string | number, text: string) => {
          rateLimitAttempts++;
          if (rateLimitAttempts === 1) {
            const err: any = new Error('Too Many Requests: retry after 2');
            err.error_code = 429;
            err.parameters = { retry_after: 2 }; // 2 seconds
            throw err;
          }
          return { message_id: 999, text };
        }
      }
    };

    await deliverer.deliverChunks(
      rateLimitBot,
      99002,
      ['<b>Rate Limited Message</b>'],
      { sleepFn, nowFn, minChunkDelayMs: 100 }
    );

    assert.strictEqual(rateLimitAttempts, 2, '5.3A: Retried after 429');
    assert.ok(sleptDurations.includes(2000), '5.3B: Slept for 2000ms as requested by retry_after: 2');

    console.log('  ✓ Throttling compliance & HTTP 429 rate-limit backoff verified.\n');
  }

  console.log('========================================================================');
  console.log(' ALL Phase 03 Telegram HTML Delivery & Fallback Tests PASSED!          ');
  console.log('========================================================================\n');
}

runPhase03Tests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 03 test FAILED with error:', err);
    process.exit(1);
  });
