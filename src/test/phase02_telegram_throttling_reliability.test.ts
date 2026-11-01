// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceConfig: Record<string, any> = {
  enableChatMirror: true,
  mirrorIncludePcPrompts: true,
  minChunkDelayMs: 1000
};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          { name: 'test-workspace', uri: { fsPath: '/mock/workspace' } }
        ],
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) => {
            if (mockWorkspaceConfig[key] !== undefined) {
              return mockWorkspaceConfig[key];
            }
            return defaultValue;
          },
          update: async (key: string, value: any) => {
            mockWorkspaceConfig[key] = value;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} })
      },
      window: {
        createOutputChannel: () => ({
          appendLine: () => {},
          show: () => {},
          dispose: () => {}
        }),
        showWarningMessage: async () => {},
        showErrorMessage: async () => {},
        showInformationMessage: async () => {}
      },
      commands: {
        executeCommand: async () => {}
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import {
  ThrottledResponseDeliverer,
  deliverChunkedResponse,
  defaultResponseDeliverer,
  resetDefaultResponseDeliverer,
  TelegramChatMirror,
  isEntityParseError
} from '../telegramChatMirror';
import {
  TypingActionManager,
  isRateLimitError,
  extractRetryAfterMs
} from '../typingActionManager';

async function runPhase02Tests() {
  console.log('========================================================================');
  console.log(' PHASE 02: Telegram Throttling, Rate Limiting & Network Reliability     ');
  console.log('========================================================================\n');

  // --------------------------------------------------------------------------
  // Test 1: Inter-Message Rate Limiting & Chunk 0 Throttling
  // --------------------------------------------------------------------------
  console.log('[Test 1] Verifying inter-message rate limiting and chunk 0 throttling...');
  {
    resetDefaultResponseDeliverer();

    let virtualClock = 1000;
    const sleptDurations: number[] = [];
    const sentHistory: { chatId: string | number; text: string; time: number; parseMode?: string }[] = [];

    const mockBot = {
      api: {
        sendMessage: async (chatId: string | number, text: string, options?: any) => {
          sentHistory.push({
            chatId,
            text,
            time: virtualClock,
            parseMode: options?.parse_mode
          });
          return { message_id: sentHistory.length, text };
        }
      }
    };

    const sleepFn = async (ms: number) => {
      sleptDurations.push(ms);
      virtualClock += ms;
    };
    const nowFn = () => virtualClock;

    // First message to chat 1001 (1 chunk)
    await deliverChunkedResponse(mockBot, 1001, 'Hello first message', {
      minChunkDelayMs: 1000,
      sleepFn,
      nowFn
    });

    assert.strictEqual(sentHistory.length, 1, '1A: First message delivered');
    assert.strictEqual(sentHistory[0].time, 1000, '1B: First message sent immediately without wait');
    assert.strictEqual(sleptDurations.length, 0, '1C: No sleep before first message');

    // Advance clock by only 100ms (rapid consecutive message within 100ms)
    virtualClock += 100; // now virtualClock = 1100

    // Second message to the same chat 1001 (1 chunk)
    await deliverChunkedResponse(mockBot, 1001, 'Hello second rapid message', {
      minChunkDelayMs: 1000,
      sleepFn,
      nowFn
    });

    assert.strictEqual(sentHistory.length, 2, '1D: Second message delivered');
    assert.strictEqual(sleptDurations.length, 1, '1E: Throttling sleep occurred before chunk 0 of second message');
    assert.strictEqual(sleptDurations[0], 900, '1F: Chunk 0 slept for remaining 900ms (1000ms delay - 100ms elapsed)');
    assert.strictEqual(sentHistory[1].time, 2000, '1G: Second message sent exactly at T=2000 (1000ms after first)');

    // Third message to a DIFFERENT chat 2002 at T=2050
    virtualClock += 50; // virtualClock = 2050
    const sleepCountBefore = sleptDurations.length;

    await deliverChunkedResponse(mockBot, 2002, 'Message to chat 2', {
      minChunkDelayMs: 1000,
      sleepFn,
      nowFn
    });

    assert.strictEqual(sentHistory.length, 3, '1H: Message to new chat delivered');
    assert.strictEqual(sleptDurations.length, sleepCountBefore, '1I: Different chat is not delayed by chat 1001 history');
    assert.strictEqual(sentHistory[2].time, 2050, '1J: Different chat sent immediately at T=2050');

    // Multi-chunk message to chat 1001 reusing defaultResponseDeliverer at T=2050 (lastSent was 2000)
    virtualClock = 2050;
    const multiChunkSleeps: number[] = [];
    const multiSleepFn = async (ms: number) => {
      multiChunkSleeps.push(ms);
      virtualClock += ms;
    };

    await defaultResponseDeliverer.deliverChunks(
      mockBot,
      1001,
      ['Chunk A', 'Chunk B', 'Chunk C'],
      { sleepFn: multiSleepFn, nowFn, minChunkDelayMs: 500 }
    );

    // Initial wait on chunk 0: T=2050, lastSent was 2000 -> elapsed=50ms -> wait 450ms -> sent at 2500
    // Chunk 1 wait: 500ms -> sent at 3000
    // Chunk 2 wait: 500ms -> sent at 3500
    assert.strictEqual(multiChunkSleeps.length, 3, '1K: All 3 chunks respected throttling');
    assert.strictEqual(multiChunkSleeps[0], 450, '1L: Chunk 0 throttled by 450ms');
    assert.strictEqual(multiChunkSleeps[1], 500, '1M: Chunk 1 throttled by 500ms');
    assert.strictEqual(multiChunkSleeps[2], 500, '1N: Chunk 2 throttled by 500ms');

    console.log('✓ [Test 1] Inter-message rate limiting and chunk 0 throttling passed.\n');
  }

  // --------------------------------------------------------------------------
  // Test 2: Safe Default Parse Mode & Network Round-Trip Reduction
  // --------------------------------------------------------------------------
  console.log('[Test 2] Verifying safe default parse mode (plain text) and 400 elimination...');
  {
    resetDefaultResponseDeliverer();

    let attempts = 0;
    const recordedParseModes: (string | undefined)[] = [];

    const mockParseBot = {
      api: {
        sendMessage: async (_chatId: string | number, text: string, options?: any) => {
          attempts++;
          recordedParseModes.push(options?.parse_mode);
          // If parse_mode is legacy 'Markdown', simulate Telegram 400 Bad Request
          if (options?.parse_mode === 'Markdown') {
            const err: any = new Error("Bad Request: can't parse entities: Character '_' is reserved");
            err.error_code = 400;
            err.description = "Bad Request: can't parse entities";
            throw err;
          }
          return { message_id: attempts, text };
        }
      }
    };

    // 2A: Technical text with unescaped syntax sent without specifying parse_mode
    const technicalText = 'Check path `/src/test_config*alpha` and [unclosed bracket with_var_1.';
    await deliverChunkedResponse(mockParseBot, 3001, technicalText);

    assert.strictEqual(attempts, 1, '2A: Technical text succeeded on the first HTTP call without 400 error retry');
    assert.strictEqual(recordedParseModes[0], undefined, '2B: Default parse_mode is undefined (safe plain text)');

    // 2B: Explicit parse_mode: 'Markdown' still falls back to plain text on entity parse error
    attempts = 0;
    recordedParseModes.length = 0;
    await deliverChunkedResponse(mockParseBot, 3001, technicalText, {
      parse_mode: 'Markdown'
    });

    assert.strictEqual(attempts, 2, '2C: Explicit Markdown failed first and retried once as plain text');
    assert.strictEqual(recordedParseModes[0], 'Markdown', '2D: First attempt was explicit Markdown');
    assert.strictEqual(recordedParseModes[1], undefined, '2E: Fallback dropped parse_mode to undefined');

    console.log('✓ [Test 2] Safe default parse mode verified.\n');
  }

  // --------------------------------------------------------------------------
  // Test 3: Single-Pass Markdown Splitting & Multi-User Dispatch
  // --------------------------------------------------------------------------
  console.log('[Test 3] Verifying single-pass splitting and independent multi-user dispatch...');
  {
    let virtualClock = 5000;
    const sleepFn = async (ms: number) => {
      virtualClock += ms;
    };
    const nowFn = () => virtualClock;

    const deliveredChats: { chatId: string | number; chunk: string }[] = [];
    const mockMultiBot = {
      api: {
        sendMessage: async (chatId: string | number, text: string) => {
          deliveredChats.push({ chatId, chunk: text });
          return { message_id: deliveredChats.length, text };
        }
      }
    };

    const mirror = new TelegramChatMirror({
      bot: mockMultiBot,
      allowedUsers: [4001, 4002, 4003],
      minChunkDelayMs: 100
    });

    const longResponse = 'Section 1 paragraph content.\n\nSection 2 paragraph content.\n\nSection 3 code block:\n```ts\nconst x = 1;\n```';

    // Dispatch planner response
    await mirror.handlePlannerResponse(longResponse, undefined, {
      sleepFn,
      nowFn,
      maxChunkLength: 80
    });

    // Check all 3 allowed users received the response
    const usersServed = new Set(deliveredChats.map((d) => d.chatId));
    assert.strictEqual(usersServed.size, 3, '3A: All 3 allowed users received response');
    assert.ok(usersServed.has(4001), '3B: User 4001 received');
    assert.ok(usersServed.has(4002), '3C: User 4002 received');
    assert.ok(usersServed.has(4003), '3D: User 4003 received');

    // Verify persistent deliverer was updated for all chats
    const deliverer = mirror.getDeliverer();
    assert.ok(deliverer.getLastDelivery(4001)! > 0, '3E: Deliverer retained timestamp for user 4001');
    assert.ok(deliverer.getLastDelivery(4002)! > 0, '3F: Deliverer retained timestamp for user 4002');
    assert.ok(deliverer.getLastDelivery(4003)! > 0, '3G: Deliverer retained timestamp for user 4003');

    // Verify user prompt mirroring also updates lastDelivery
    deliveredChats.length = 0;
    await mirror.handleUserInput('Hello from PC IDE', 4001);
    assert.ok(deliverer.getLastDelivery(4001)! >= virtualClock, '3H: User input delivery updated chat timestamp');

    mirror.dispose();
    console.log('✓ [Test 3] Single-pass splitting & multi-user dispatch verified.\n');
  }

  // --------------------------------------------------------------------------
  // Test 4: TypingActionManager HTTP 429 Backoff & Resumption
  // --------------------------------------------------------------------------
  console.log('[Test 4] Verifying TypingActionManager HTTP 429 backoff & pause lifecycle...');
  {
    let sendCalls = 0;
    let rateLimitTriggers = 0;
    let simulatedErrorCode = 429;

    const mockBot = {
      api: {
        sendChatAction: async (chatId: string | number, action: string) => {
          sendCalls++;
          if (simulatedErrorCode === 429) {
            const err: any = new Error('Too Many Requests: retry after 1');
            err.error_code = 429;
            err.parameters = { retry_after: 1 }; // 1 second
            throw err;
          }
          return true;
        }
      }
    };

    const typingManager = new TypingActionManager({
      bot: mockBot,
      intervalMs: 50,
      backoffMarginMs: 100, // 100ms margin for fast unit test
      onRateLimit: (_chatId: any, retryAfterMs: number, pauseDurationMs: number) => {
        rateLimitTriggers++;
        assert.strictEqual(retryAfterMs, 1000, '4A: Extracted retry_after 1000ms');
        assert.strictEqual(pauseDurationMs, 1100, '4B: Total pause 1100ms (1000 + 100 margin)');
      }
    });

    typingManager.startTyping(5001);
    // Wait for the async sendAction promise to execute and trigger rate limit backoff
    await new Promise((resolve) => setTimeout(resolve, 15));

    // Initial pulse threw 429
    assert.strictEqual(sendCalls, 1, '4C: Initial typing attempt made');
    assert.strictEqual(rateLimitTriggers, 1, '4D: Rate limit backoff triggered');
    assert.strictEqual(typingManager.isTyping(5001), true, '4E: Session is still marked active during backoff');
    assert.strictEqual(typingManager.isPaused(5001), true, '4F: Chat is paused during backoff');

    // Wait 150ms: interval should be paused and not spamming Telegram
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.strictEqual(sendCalls, 1, '4G: No further requests fired during active pause');

    // Allow success and fast-forward pause by calling pauseFor with 20ms
    simulatedErrorCode = 200;
    typingManager.pauseFor(5001, 25);

    // Wait for the short pause to elapse
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(sendCalls > 1, `4H: Typing resumed automatically after backoff (calls: ${sendCalls})`);
    assert.strictEqual(typingManager.isPaused(5001), false, '4I: Chat is no longer paused');

    // Verify stopTyping cleans up all timers and backoff
    typingManager.stopTyping(5001);
    assert.strictEqual(typingManager.isTyping(5001), false, '4J: Chat typing stopped');
    assert.strictEqual(typingManager.isPaused(5001), false, '4K: Chat pause status cleared');

    typingManager.dispose();
    console.log('✓ [Test 4] TypingActionManager HTTP 429 backoff verified.\n');
  }

  // --------------------------------------------------------------------------
  // Test 5: TypingActionManager In-Flight Request Deduplication
  // --------------------------------------------------------------------------
  console.log('[Test 5] Verifying TypingActionManager in-flight request deduplication...');
  {
    let inFlightMax = 0;
    let currentInFlight = 0;
    let completedCalls = 0;

    const mockSlowBot = {
      api: {
        sendChatAction: async () => {
          currentInFlight++;
          if (currentInFlight > inFlightMax) {
            inFlightMax = currentInFlight;
          }
          // Simulate network latency of 60ms
          await new Promise((r) => setTimeout(r, 60));
          currentInFlight--;
          completedCalls++;
          return true;
        }
      }
    };

    // Fast interval (15ms) vs slow network (60ms)
    const typingManager = new TypingActionManager({
      bot: mockSlowBot,
      intervalMs: 15
    });

    typingManager.startTyping(6001);

    // Let the timer fire several pulses while the first request is still in-flight
    await new Promise((resolve) => setTimeout(resolve, 120));

    // Stop typing
    typingManager.stopTyping(6001);

    assert.strictEqual(inFlightMax, 1, '5A: Max concurrent in-flight requests never exceeded 1');
    assert.ok(completedCalls >= 1, `5B: At least 1 call completed cleanly (completed: ${completedCalls})`);
    assert.strictEqual(typingManager.isInFlight(6001), false, '5C: In-flight flag cleared after completion');

    typingManager.dispose();
    console.log('✓ [Test 5] In-flight request deduplication verified.\n');
  }

  // --------------------------------------------------------------------------
  // Test 6: Rate Limit & Entity Parse Helper Utilities
  // --------------------------------------------------------------------------
  console.log('[Test 6] Verifying rate limit and entity parse error detection utilities...');
  {
    // isRateLimitError
    assert.strictEqual(isRateLimitError({ error_code: 429 }), true, '6A: error_code 429');
    assert.strictEqual(isRateLimitError({ parameters: { retry_after: 5 } }), true, '6B: parameters.retry_after');
    assert.strictEqual(isRateLimitError(new Error('Too Many Requests: retry after 10')), true, '6C: string match 429');
    assert.strictEqual(isRateLimitError({ error_code: 400 }), false, '6D: 400 is not rate limit');
    assert.strictEqual(isRateLimitError(null), false, '6E: null is false');

    // extractRetryAfterMs
    assert.strictEqual(extractRetryAfterMs({ parameters: { retry_after: 7 } }), 7000, '6F: extracts 7000ms');
    assert.strictEqual(extractRetryAfterMs({ retry_after: 3 }), 3000, '6G: extracts 3000ms');
    assert.strictEqual(extractRetryAfterMs(new Error('Retry after 15 seconds')), 15000, '6H: regex extracts 15000ms');
    assert.strictEqual(extractRetryAfterMs(new Error('Unknown error')), 1000, '6I: fallback to 1000ms');

    // isEntityParseError
    assert.strictEqual(isEntityParseError({ description: "Bad Request: can't parse entities" }), true, '6J: entity parse error');
    assert.strictEqual(isEntityParseError(new Error("can't parse entities in message")), true, '6K: error message match');
    assert.strictEqual(isEntityParseError({ description: 'Not found' }), false, '6L: not an entity error');

    console.log('✓ [Test 6] Helper utilities verified.\n');
  }

  console.log('========================================================================');
  console.log(' ALL PHASE 02 TESTS PASSED SUCCESSFULLY!                             ');
  console.log('========================================================================');
}

runPhase02Tests().catch((err) => {
  console.error('\n❌ Phase 02 Tests FAILED:', err);
  process.exit(1);
});
