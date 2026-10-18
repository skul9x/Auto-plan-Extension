// Mock 'vscode' module for standalone test runner
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
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import {
  splitMarkdownSafely,
  SmartMarkdownChunker,
  parseFenceLine,
  analyzeCodeFences
} from '../smartMarkdownChunker';
import {
  TypingActionManager,
  typingActionManager
} from '../typingActionManager';
import {
  ThrottledResponseDeliverer,
  deliverChunkedResponse,
  TelegramChatMirror,
  isRateLimitError,
  extractRetryAfterMs,
  isEntityParseError,
  DEFAULT_AI_RESPONSE_HEADER
} from '../telegramChatMirror';
import { PromptOriginTracker } from '../promptOriginTracker';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase03TypingAndSmartChunkerTests() {
  console.log('=== Running Phase 03: Typing Action & Smart Assistant Response Chunker Tests ===\n');

  try {
    // =========================================================================
    // Test 1: Short responses (< 3800 chars) return a single chunk unchanged
    // =========================================================================
    console.log('[Test 1] Verifying short responses return a single chunk unchanged...');

    const shortPlain = 'This is a short answer from the AI assistant explaining quicksort.';
    const chunks1 = splitMarkdownSafely(shortPlain, 3800);
    assert.strictEqual(chunks1.length, 1, '1A: Short response must produce exactly 1 chunk');
    assert.strictEqual(chunks1[0], shortPlain, '1B: Content of short response must be unchanged');

    const shortWithCode = `Here is a function:

\`\`\`typescript
function add(a: number, b: number): number {
  return a + b;
}
\`\`\`

Have fun!`;
    const chunks2 = splitMarkdownSafely(shortWithCode, 3800);
    assert.strictEqual(chunks2.length, 1, '1C: Short response with code block must produce exactly 1 chunk');
    assert.strictEqual(chunks2[0], shortWithCode, '1D: Short response with code must remain intact');

    // Empty and null inputs
    assert.deepStrictEqual(splitMarkdownSafely(''), [], '1E: Empty string returns empty array');
    assert.deepStrictEqual(splitMarkdownSafely(null as any), [], '1F: Null input returns empty array');

    // OOP helper check
    const oopChunks = SmartMarkdownChunker.split(shortPlain, 3800);
    assert.deepStrictEqual(oopChunks, [shortPlain], '1G: SmartMarkdownChunker.split matches function');

    console.log('✓ [Test 1] Short responses verified.\n');

    // =========================================================================
    // Test 2: Long response (> 5000 chars) with massive code block & balanced fences
    // =========================================================================
    console.log('[Test 2] Verifying massive code block splitting and fence preservation...');

    // Generate massive typescript code block (~6500 chars)
    const codeLines: string[] = [];
    codeLines.push('```typescript');
    for (let i = 1; i <= 150; i++) {
      codeLines.push(`  const variable_${i.toString().padStart(3, '0')} = { index: ${i}, label: "Processing line ${i}" };`);
    }
    codeLines.push('```');
    const massiveResponse = codeLines.join('\n');
    assert.ok(massiveResponse.length > 5000, `2A: Generated text should be > 5000 chars (actual: ${massiveResponse.length})`);

    const chunks = splitMarkdownSafely(massiveResponse, 3800);
    assert.ok(chunks.length >= 2, `2B: Text must be split into at least 2 chunks (got: ${chunks.length})`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      assert.ok(
        chunk.length <= 3800,
        `2C: Chunk ${i + 1} length (${chunk.length}) must be <= safe limit 3800`
      );

      // Verify matching code fences
      const analysis = analyzeCodeFences(chunk);
      assert.strictEqual(
        analysis.isBalanced,
        true,
        `2D: Chunk ${i + 1} must have balanced code fences (open: ${analysis.openingCount}, close: ${analysis.closingCount})`
      );
      assert.strictEqual(
        analysis.openingCount,
        1,
        `2E: Chunk ${i + 1} must have exactly 1 opening fence`
      );
      assert.strictEqual(
        analysis.closingCount,
        1,
        `2F: Chunk ${i + 1} must have exactly 1 closing fence`
      );
    }

    // Verify language identifier preservation across chunk boundaries
    // Chunk 1 starts with ```typescript
    assert.ok(chunks[0].startsWith('```typescript\n'), '2G: Chunk 1 must start with ```typescript');
    assert.ok(chunks[0].endsWith('\n```'), '2H: Chunk 1 must safely close with ```');

    // Chunk 2 must reopen with ```typescript
    assert.ok(
      chunks[1].startsWith('```typescript\n'),
      '2I: Chunk 2 must reopen with ```typescript preserving language identifier'
    );
    assert.ok(chunks[1].endsWith('\n```'), '2J: Chunk 2 must safely close with ```');

    console.log('✓ [Test 2] Massive code block splitting and fence preservation verified.\n');

    // =========================================================================
    // Test 3: Multiple distinct code blocks and mixed markdown paragraphs
    // =========================================================================
    console.log('[Test 3] Verifying multiple distinct code blocks and paragraph boundaries...');

    const mixedSections: string[] = [];
    mixedSections.push('# Solution Overview\n\nHere is the first solution in Python:\n');
    mixedSections.push('```python');
    for (let i = 1; i <= 70; i++) {
      mixedSections.push(`def py_step_${i}():\n    return "python step ${i}"`);
    }
    mixedSections.push('```\n');
    mixedSections.push('Next, here is the JSON configuration payload:\n');
    mixedSections.push('```json');
    for (let i = 1; i <= 70; i++) {
      mixedSections.push(`  "config_item_${i}": { "active": true, "step": ${i} },`);
    }
    mixedSections.push('```\n');
    mixedSections.push('### Summary\nAll operations finished successfully without errors.');

    const mixedText = mixedSections.join('\n');
    const mixedChunks = splitMarkdownSafely(mixedText, 3000);

    assert.ok(mixedChunks.length >= 2, '3A: Mixed text should split into multiple chunks');

    for (let i = 0; i < mixedChunks.length; i++) {
      const ch = mixedChunks[i];
      assert.ok(ch.length <= 3000, `3B: Mixed chunk ${i + 1} must not exceed 3000 chars`);
      const analysis = analyzeCodeFences(ch);
      assert.strictEqual(
        analysis.isBalanced,
        true,
        `3C: Mixed chunk ${i + 1} must be fence-balanced`
      );
    }

    // Verify python chunk preserved python tag, json chunk preserved json tag
    const pythonChunks = mixedChunks.filter((c) => c.includes('```python'));
    assert.ok(pythonChunks.length > 0, '3D: Found chunks preserving python identifier');

    const jsonChunks = mixedChunks.filter((c) => c.includes('```json'));
    assert.ok(jsonChunks.length > 0, '3E: Found chunks preserving json identifier');

    console.log('✓ [Test 3] Mixed code blocks and paragraph boundaries verified.\n');

    // =========================================================================
    // Test 4: Formatting safety for abruptly unclosed code blocks
    // =========================================================================
    console.log('[Test 4] Verifying formatting safety on unclosed code blocks...');

    // Simulate an AI response that was truncated mid-generation (missing closing ```)
    const unclosedStreamText = `Here is partial output:
\`\`\`bash
npm install
npm test
npm run build
# stream stopped here`;

    const unclosedChunks = splitMarkdownSafely(unclosedStreamText, 3800);
    assert.strictEqual(unclosedChunks.length, 1, '4A: Returns single chunk');
    // Notice: if text was <= 3800, splitMarkdownSafely returns [text].
    // What if unclosed text is large (> 4000)?
    const largeUnclosedLines = ['```typescript'];
    for (let i = 0; i < 120; i++) {
      largeUnclosedLines.push(`const unclosedLine_${i} = ${i};`);
    }
    // No closing fence!
    const largeUnclosed = largeUnclosedLines.join('\n');
    const largeChunks = splitMarkdownSafely(largeUnclosed, 2000);

    for (let i = 0; i < largeChunks.length; i++) {
      const ch = largeChunks[i];
      const analysis = analyzeCodeFences(ch);
      assert.strictEqual(
        analysis.isBalanced,
        true,
        `4B: Chunk ${i + 1} of unclosed code stream must still be closed safely with fence`
      );
      assert.ok(ch.endsWith('\n```') || ch.endsWith('```'), `4C: Chunk ${i + 1} must end with closing fence`);
    }

    console.log('✓ [Test 4] Formatting safety on unclosed code blocks verified.\n');

    // =========================================================================
    // Test 5: TypingActionManager lifecycle & periodic intervals
    // =========================================================================
    console.log('[Test 5] Verifying TypingActionManager lifecycle and periodic intervals...');

    const actionsSent: { chatId: string | number; action: string; time: number }[] = [];
    const mockBot = {
      api: {
        sendChatAction: async (chatId: string | number, action: string) => {
          actionsSent.push({ chatId, action, time: Date.now() });
        }
      }
    };

    const typingManager = new TypingActionManager({
      bot: mockBot,
      intervalMs: 100 // 100ms for fast testing
    });

    const testChatId = 123456789;

    assert.strictEqual(typingManager.isTyping(testChatId), false, '5A: Not typing initially');

    // 1. Start typing
    typingManager.startTyping(testChatId);
    assert.strictEqual(typingManager.isTyping(testChatId), true, '5B: Typing active after start');
    assert.strictEqual(actionsSent.length, 1, '5C: First typing action sent immediately');
    assert.strictEqual(actionsSent[0].chatId, testChatId, '5D: Action sent to correct chatId');
    assert.strictEqual(actionsSent[0].action, 'typing', '5E: Action type is typing');

    // 2. Calling startTyping again should be idempotent
    typingManager.startTyping(testChatId);
    assert.strictEqual(actionsSent.length, 1, '5F: Duplicate startTyping does not duplicate action');

    // 3. Wait 250ms -> should have triggered ~2 more periodic pulses
    await sleep(250);
    assert.ok(
      actionsSent.length >= 2,
      `5G: Periodic pulses must be received (got ${actionsSent.length})`
    );

    // 4. Stop typing
    typingManager.stopTyping(testChatId);
    assert.strictEqual(typingManager.isTyping(testChatId), false, '5H: Typing stopped after stopTyping');
    const countAfterStop = actionsSent.length;

    await sleep(150);
    assert.strictEqual(
      actionsSent.length,
      countAfterStop,
      '5I: No additional typing actions sent after stop'
    );

    console.log('✓ [Test 5] TypingActionManager lifecycle verified.\n');

    // =========================================================================
    // Test 6: TypingActionManager events (onPlannerResponse, onError, multi-chat)
    // =========================================================================
    console.log('[Test 6] Verifying TypingActionManager onPlannerResponse and onError...');

    const typingManager2 = new TypingActionManager({
      bot: mockBot,
      intervalMs: 100
    });

    const chatA = 11111;
    const chatB = 22222;

    typingManager2.startTyping(chatA);
    typingManager2.startTyping(chatB);
    assert.strictEqual(typingManager2.getActiveCount(), 2, '6A: Both chats typing');

    // onPlannerResponse for chatA only
    typingManager2.onPlannerResponse(chatA);
    assert.strictEqual(typingManager2.isTyping(chatA), false, '6B: chatA stopped on planner response');
    assert.strictEqual(typingManager2.isTyping(chatB), true, '6C: chatB still typing');

    // onError without chatId should stop all
    typingManager2.onError();
    assert.strictEqual(typingManager2.isTyping(chatB), false, '6D: All chats stopped on global error');
    assert.strictEqual(typingManager2.getActiveCount(), 0, '6E: Active count is 0');

    // Fatal error handling resilience
    let errorLogged = false;
    const failingBot = {
      api: {
        sendChatAction: async () => {
          throw new Error('403 Forbidden: bot was blocked by the user');
        }
      }
    };
    const typingManagerFatal = new TypingActionManager({
      bot: failingBot,
      intervalMs: 100,
      onSendError: () => {
        errorLogged = true;
      }
    });

    typingManagerFatal.startTyping(999);
    // Send is async; wait a tick
    await sleep(20);
    assert.strictEqual(errorLogged, true, '6F: Error callback invoked');
    assert.strictEqual(
      typingManagerFatal.isTyping(999),
      false,
      '6G: Chat auto-removed on permanent failure'
    );

    console.log('✓ [Test 6] TypingActionManager event hooks verified.\n');

    // =========================================================================
    // Test 7: ThrottledResponseDeliverer & rate limiting (429 retry_after)
    // =========================================================================
    console.log('[Test 7] Verifying ThrottledResponseDeliverer with rate limit retries...');

    const deliveredMessages: { text: string; time: number; parseMode?: string }[] = [];
    let simulate429Count = 1;
    let sleptDurations: number[] = [];

    const mockThrottledBot = {
      api: {
        sendMessage: async (chatId: string | number, text: string, options?: any) => {
          if (simulate429Count > 0) {
            simulate429Count--;
            const err: any = new Error('Too Many Requests: retry after 2');
            err.error_code = 429;
            err.parameters = { retry_after: 2 };
            throw err;
          }
          deliveredMessages.push({
            text,
            time: Date.now(),
            parseMode: options?.parse_mode
          });
          return { message_id: deliveredMessages.length, text };
        }
      }
    };

    const deliverer = new ThrottledResponseDeliverer({
      minChunkDelayMs: 50,
      sleepFn: async (ms: number) => {
        sleptDurations.push(ms);
      }
    });

    const testChunks = ['Chunk 1 content', 'Chunk 2 content'];
    await deliverer.deliverChunks(mockThrottledBot, 99999, testChunks);

    assert.strictEqual(deliveredMessages.length, 2, '7A: Both chunks delivered after retry');
    assert.strictEqual(deliveredMessages[0].text, 'Chunk 1 content', '7B: Chunk 1 received');
    assert.strictEqual(deliveredMessages[1].text, 'Chunk 2 content', '7C: Chunk 2 received');

    // Verify 429 retry_after was handled
    assert.ok(
      sleptDurations.some((d) => d === 2000),
      `7D: Deliverer must sleep for retry_after 2000ms (slept: ${sleptDurations.join(', ')})`
    );

    // Verify delay between consecutive chunks was invoked
    assert.ok(
      sleptDurations.some((d) => d >= 40 && d <= 60),
      `7E: Min chunk delay ~50ms must be requested between chunks`
    );

    console.log('✓ [Test 7] ThrottledResponseDeliverer & rate limit retries verified.\n');

    // =========================================================================
    // Test 8: Telegram entity parse error fallback
    // =========================================================================
    console.log('[Test 8] Verifying entity parse error fallback to plain text...');

    let attempts = 0;
    const recordedParseModes: (string | undefined)[] = [];

    const mockParseFailBot = {
      api: {
        sendMessage: async (chatId: string | number, text: string, options?: any) => {
          attempts++;
          recordedParseModes.push(options?.parse_mode);
          if (options?.parse_mode === 'Markdown') {
            const parseErr: any = new Error("Bad Request: can't parse entities: Character '_' is reserved");
            parseErr.description = "Bad Request: can't parse entities";
            throw parseErr;
          }
          return { message_id: 1, text };
        }
      }
    };

    const deliverer2 = new ThrottledResponseDeliverer({
      minChunkDelayMs: 10,
      sleepFn: async () => {}
    });

    await deliverer2.deliverChunks(mockParseFailBot, 8888, ['Unescaped_text_chunk']);

    assert.strictEqual(attempts, 2, '8A: Must attempt Markdown first, then retry plain text');
    assert.strictEqual(recordedParseModes[0], 'Markdown', '8B: First attempt used Markdown');
    assert.strictEqual(recordedParseModes[1], undefined, '8C: Second attempt dropped parse_mode for safe plain text');

    console.log('✓ [Test 8] Entity parse error fallback verified.\n');

    // =========================================================================
    // Test 9: deliverChunkedResponse formatting & header integration
    // =========================================================================
    console.log('[Test 9] Verifying deliverChunkedResponse with default and custom header...');

    const botSent: { text: string }[] = [];
    const collectorBot = {
      api: {
        sendMessage: async (_chatId: string | number, text: string) => {
          botSent.push({ text });
          return { message_id: botSent.length };
        }
      }
    };

    // Case 9A: Default header prepended
    await deliverChunkedResponse(
      collectorBot,
      777,
      'This is the assistant reply.',
      {
        sleepFn: async () => {}
      }
    );
    assert.strictEqual(botSent.length, 1, '9A: 1 chunk sent');
    assert.ok(
      botSent[0].text.startsWith('🤖 Antigravity:\n\nThis is the assistant reply.'),
      '9B: Default header prepended cleanly'
    );

    // Case 9B: Text that already contains the header should not duplicate it
    await deliverChunkedResponse(
      collectorBot,
      777,
      '🤖 Antigravity:\n\nAlready prefixed content.',
      {
        sleepFn: async () => {}
      }
    );
    assert.strictEqual(
      botSent[1].text,
      '🤖 Antigravity:\n\nAlready prefixed content.',
      '9C: Existing header is not duplicated'
    );

    // Case 9C: Custom prefix
    await deliverChunkedResponse(
      collectorBot,
      777,
      'Custom styled answer.',
      {
        prefix: '⚡ [AI Output]:',
        sleepFn: async () => {}
      }
    );
    assert.ok(
      botSent[2].text.startsWith('⚡ [AI Output]:\n\nCustom styled answer.'),
      '9D: Custom prefix applied cleanly'
    );

    console.log('✓ [Test 9] deliverChunkedResponse formatting verified.\n');

    // =========================================================================
    // Test 10: TelegramChatMirror coordinator lifecycle
    // =========================================================================
    console.log('[Test 10] Verifying TelegramChatMirror coordinator lifecycle...');

    const mirrorLogs: { action?: string; text?: string }[] = [];
    const mirrorBot = {
      api: {
        sendChatAction: async (_chatId: string | number, action: string) => {
          mirrorLogs.push({ action });
        },
        sendMessage: async (_chatId: string | number, text: string) => {
          mirrorLogs.push({ text });
          return { message_id: mirrorLogs.length };
        }
      }
    };

    const tracker = new PromptOriginTracker({ autoPrune: false });
    const mirror = new TelegramChatMirror({
      bot: mirrorBot,
      allowedUsers: [55555],
      promptOriginTracker: tracker
    });

    // 10A: PC Input prompt -> should be forwarded as 💻 You (on PC)
    const pcInputRes = await mirror.handleUserInput('Write unit tests for authentication', 55555);
    assert.strictEqual(pcInputRes.origin, 'pc_ide', '10A: Unregistered prompt is pc_ide');
    assert.strictEqual(pcInputRes.forwarded, true, '10B: PC prompt is forwarded');
    assert.ok(
      mirrorLogs.some((l) => l.text && l.text.includes('💻 You (on PC):')),
      '10C: PC formatted header included in message'
    );

    // 10B: Telegram Input prompt -> registered first, then detected -> should NOT be forwarded
    tracker.registerTelegramPrompt('Help me fix the login button');
    const teleInputRes = await mirror.handleUserInput('Help me fix the login button', 55555);
    assert.strictEqual(teleInputRes.origin, 'telegram', '10D: Recognized as telegram prompt');
    assert.strictEqual(teleInputRes.forwarded, false, '10E: Telegram prompt suppressed from duplicate send');

    // 10C: Agent activity -> triggers typing action
    mirror.handleAgentActivity(55555);
    assert.ok(
      mirror.getTypingManager().isTyping(55555),
      '10F: Typing active after agent activity'
    );

    // 10D: Planner response -> cancels typing and delivers response
    await mirror.handlePlannerResponse('Here is the plan for today.', 55555, {
      sleepFn: async () => {}
    });
    assert.strictEqual(
      mirror.getTypingManager().isTyping(55555),
      false,
      '10G: Typing cancelled immediately on planner response'
    );
    assert.ok(
      mirrorLogs.some((l) => l.text && l.text.includes('🤖 Antigravity:')),
      '10H: Assistant response delivered'
    );

    mirror.dispose();

    console.log('✓ [Test 10] TelegramChatMirror coordinator lifecycle verified.\n');

    console.log('=================================================================');
    console.log('ALL PHASE 03 TESTS PASSED SUCCESSFULLY!');
    console.log('=================================================================');
  } catch (err) {
    console.error('Phase 03 Test Failure:', err);
    process.exit(1);
  }
}

runPhase03TypingAndSmartChunkerTests();
