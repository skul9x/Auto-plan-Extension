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
      window: {
        showWarningMessage: () => {},
        showInformationMessage: () => {},
        showErrorMessage: () => {}
      },
      commands: {
        executeCommand: async () => {}
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
  PromptOriginTracker,
  normalizePromptText,
  hashPrompt,
  formatPcPrompt,
  promptOriginTracker,
  registerTelegramPrompt,
  checkAndConsume
} from '../promptOriginTracker';
import { TelegramBridge } from '../telegramBridge';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase02DedupOriginTrackerTests() {
  console.log('=== Running Phase 02: Deduplication Ring Buffer & Prompt Origin Tracker Tests ===\n');

  try {
    // =========================================================================
    // Test 1: Normalization and Canonical SHA-256 Hashing
    // =========================================================================
    console.log('[Test 1] Verifying text normalization and canonical hashing...');

    const raw1 = '   Hello World!  \r\n  How are you today?   ';
    const raw2 = 'hello world!\nhow are you today?';
    const raw3 = 'HELLO WORLD!\r\nHOW ARE YOU TODAY?  ';

    const norm1 = normalizePromptText(raw1);
    const norm2 = normalizePromptText(raw2);
    const norm3 = normalizePromptText(raw3);

    assert.strictEqual(norm1, 'hello world!\nhow are you today?', '1A: Whitespace and CRLF normalized');
    assert.strictEqual(norm2, 'hello world!\nhow are you today?', '1B: Lowercase preserved');
    assert.strictEqual(norm3, 'hello world!\nhow are you today?', '1C: Casing differences eliminated');

    const hash1 = hashPrompt(raw1);
    const hash2 = hashPrompt(raw2);
    const hash3 = hashPrompt(raw3);

    assert.strictEqual(hash1, hash2, '1D: Hashes must match across CRLF/LF and trimming');
    assert.strictEqual(hash2, hash3, '1E: Hashes must match across uppercase/lowercase');
    assert.strictEqual(hash1.length, 64, '1F: Hash must be a valid 64-character SHA-256 hex string');

    // PC prompt formatting check
    const formatted = formatPcPrompt('Implement binary search');
    assert.strictEqual(
      formatted,
      '💻 You (on PC):\nImplement binary search',
      '1G: formatPcPrompt must match expected layout'
    );

    console.log('✓ [Test 1] Normalization and canonical hashing verified.\n');

    // =========================================================================
    // Test 2: Basic Registration, Consumption & Origin Resolution
    // =========================================================================
    console.log('[Test 2] Verifying registration, consumption, and origin resolution...');

    const tracker = new PromptOriginTracker({ autoPrune: false });
    const promptA = 'Refactor database connection pool';

    // Before registration: should resolve to pc_ide
    const preCheck = tracker.checkAndConsume(promptA);
    assert.strictEqual(preCheck.origin, 'pc_ide', '2A: Unregistered prompt must be pc_ide');
    assert.strictEqual(preCheck.matched, false, '2B: Unregistered prompt must have matched: false');
    assert.strictEqual(
      preCheck.formattedText,
      '💻 You (on PC):\nRefactor database connection pool',
      '2C: Unregistered prompt must provide formattedText'
    );

    // Register prompt from Telegram
    const registeredHash = tracker.registerTelegramPrompt(promptA);
    assert.strictEqual(registeredHash, hashPrompt(promptA), '2D: Registration must return canonical hash');
    assert.strictEqual(tracker.size(), 1, '2E: Buffer size must be 1 after registration');

    // Peek without consuming
    const peekResult = tracker.peek(promptA);
    assert.strictEqual(peekResult.origin, 'telegram', '2F: Peek must report telegram');
    assert.strictEqual(peekResult.matched, true, '2G: Peek must report matched: true');
    assert.strictEqual(tracker.size(), 1, '2H: Peek must not consume the entry');

    // First checkAndConsume: must match and consume
    const firstConsume = tracker.checkAndConsume(promptA);
    assert.strictEqual(firstConsume.origin, 'telegram', '2I: First consume must return telegram');
    assert.strictEqual(firstConsume.matched, true, '2J: First consume matched: true');
    assert.strictEqual(tracker.size(), 0, '2K: Buffer size must be 0 after consumption');

    // Subsequent checkAndConsume: entry consumed, must resolve to pc_ide
    const secondConsume = tracker.checkAndConsume(promptA);
    assert.strictEqual(secondConsume.origin, 'pc_ide', '2L: Subsequent call must return pc_ide');
    assert.strictEqual(secondConsume.matched, false, '2M: Subsequent call matched: false');

    tracker.dispose();
    console.log('✓ [Test 2] Registration and single-consumption verified.\n');

    // =========================================================================
    // Test 3: Whitespace & Casing Variations Matching
    // =========================================================================
    console.log('[Test 3] Verifying tolerance to whitespace variations and linebreaks...');

    const tracker3 = new PromptOriginTracker({ autoPrune: false });
    // Telegram user sends:
    const telegramInput = '   Please run tests for Phase 2!  \r\n\r\n   With verbose output   ';
    tracker3.registerTelegramPrompt(telegramInput);

    // IDE transcript extracts slightly different whitespace (e.g. LF, trimmed, different casing):
    const ideExtracted = 'please run tests for phase 2!\n\nwith verbose output';

    const matchCheck = tracker3.checkAndConsume(ideExtracted);
    assert.strictEqual(matchCheck.origin, 'telegram', '3A: Whitespace variations must resolve to telegram');
    assert.strictEqual(matchCheck.matched, true, '3B: Matched flag must be true');

    // Subsequent check is consumed
    assert.strictEqual(tracker3.checkAndConsume(ideExtracted).origin, 'pc_ide', '3C: Consumed entry reverts to pc_ide');

    tracker3.dispose();
    console.log('✓ [Test 3] Whitespace variations matching verified.\n');

    // =========================================================================
    // Test 4: Concurrency & Counter Tracking for Rapid Identical Prompts
    // =========================================================================
    console.log('[Test 4] Verifying counter tracking for identical prompts sent in succession...');

    const tracker4 = new PromptOriginTracker({ autoPrune: false });
    const repeatedPrompt = 'Retry deployment';
    const tBase4 = Date.now();

    // Register 3 identical prompts in quick succession
    tracker4.registerTelegramPrompt(repeatedPrompt, tBase4);
    tracker4.registerTelegramPrompt(repeatedPrompt, tBase4 + 1);
    tracker4.registerTelegramPrompt(repeatedPrompt, tBase4 + 2);

    assert.strictEqual(tracker4.size(), 3, '4A: Size must be 3');
    assert.strictEqual(tracker4.getPendingCount(repeatedPrompt, tBase4 + 3), 3, '4B: Pending count must be 3');

    // Consume 1
    const res1 = tracker4.checkAndConsume(repeatedPrompt, tBase4 + 4);
    assert.strictEqual(res1.origin, 'telegram', '4C: Turn 1 must be telegram');
    assert.strictEqual(tracker4.getPendingCount(repeatedPrompt, tBase4 + 4), 2, '4D: Pending count must be 2');

    // Consume 2
    const res2 = tracker4.checkAndConsume(repeatedPrompt, tBase4 + 5);
    assert.strictEqual(res2.origin, 'telegram', '4E: Turn 2 must be telegram');
    assert.strictEqual(tracker4.getPendingCount(repeatedPrompt, tBase4 + 5), 1, '4F: Pending count must be 1');

    // Consume 3
    const res3 = tracker4.checkAndConsume(repeatedPrompt, tBase4 + 6);
    assert.strictEqual(res3.origin, 'telegram', '4G: Turn 3 must be telegram');
    assert.strictEqual(tracker4.getPendingCount(repeatedPrompt, tBase4 + 6), 0, '4H: Pending count must be 0');

    // Consume 4: All consumed, should now be pc_ide
    const res4 = tracker4.checkAndConsume(repeatedPrompt, tBase4 + 7);
    assert.strictEqual(res4.origin, 'pc_ide', '4I: Turn 4 must revert to pc_ide');
    assert.strictEqual(res4.matched, false, '4J: Turn 4 matched: false');

    tracker4.dispose();
    console.log('✓ [Test 4] Counter tracking per hash verified.\n');

    // =========================================================================
    // Test 5: TTL Expiration and Periodic Pruning
    // =========================================================================
    console.log('[Test 5] Verifying TTL expiration and pruning...');

    // 5A: Deterministic timestamp TTL expiration
    const tracker5 = new PromptOriginTracker({ ttlMs: 60000, autoPrune: false });
    const promptExpire = 'Temporary prompt message';

    const t0 = Date.now();
    tracker5.registerTelegramPrompt(promptExpire, t0);

    // Check at t0 + 30s: Still active (< TTL 60s)
    assert.strictEqual(tracker5.peek(promptExpire, t0 + 30000).origin, 'telegram', '5A: Active within TTL');

    // Check at t0 + 60001ms: Expired (> TTL 60s)
    const expiredCheck = tracker5.checkAndConsume(promptExpire, t0 + 60001);
    assert.strictEqual(expiredCheck.origin, 'pc_ide', '5B: Expired entry must return pc_ide');
    assert.strictEqual(expiredCheck.matched, false, '5C: Expired entry matched: false');
    assert.strictEqual(tracker5.size(), 0, '5D: Expired entry must be pruned from buffer');

    // 5B: Real-time active autoPrune interval timer
    const autoPruneTracker = new PromptOriginTracker({
      ttlMs: 80,
      pruneIntervalMs: 40,
      autoPrune: true
    });

    autoPruneTracker.registerTelegramPrompt('Live expiring prompt');
    assert.strictEqual(autoPruneTracker.size(), 1, '5E: Added 1 live entry');

    // Wait past TTL + pruneInterval
    await sleep(150);

    assert.strictEqual(autoPruneTracker.size(), 0, '5F: Entry must be automatically pruned by background timer');
    const liveExpiredResult = autoPruneTracker.checkAndConsume('Live expiring prompt');
    assert.strictEqual(liveExpiredResult.origin, 'pc_ide', '5G: Live expired entry resolves to pc_ide');

    autoPruneTracker.dispose();
    tracker5.dispose();
    console.log('✓ [Test 5] TTL expiration and automatic pruning verified.\n');

    // =========================================================================
    // Test 6: Ring Buffer Bounded Capacity & FIFO Eviction
    // =========================================================================
    console.log('[Test 6] Verifying ring buffer capacity limit and FIFO eviction...');

    const capacityTracker = new PromptOriginTracker({ capacity: 5, autoPrune: false });
    assert.strictEqual(capacityTracker.getCapacity(), 5, '6A: Capacity must be 5');

    // Insert 5 entries (fill to capacity)
    for (let i = 1; i <= 5; i++) {
      capacityTracker.registerTelegramPrompt(`Prompt number ${i}`);
    }
    assert.strictEqual(capacityTracker.size(), 5, '6B: Buffer size must be 5');

    // Insert 6th entry: oldest (Prompt number 1) must be evicted
    capacityTracker.registerTelegramPrompt('Prompt number 6');
    assert.strictEqual(capacityTracker.size(), 5, '6C: Buffer size must not exceed capacity');

    // Prompt 1 should be gone (evicted)
    const p1Check = capacityTracker.checkAndConsume('Prompt number 1');
    assert.strictEqual(p1Check.origin, 'pc_ide', '6D: Evicted oldest entry must return pc_ide');
    assert.strictEqual(p1Check.matched, false, '6E: Evicted oldest entry matched: false');

    // Prompts 2..6 must still be present and match 'telegram'
    for (let i = 2; i <= 6; i++) {
      const pCheck = capacityTracker.checkAndConsume(`Prompt number ${i}`);
      assert.strictEqual(pCheck.origin, 'telegram', `6F: Entry ${i} must match telegram`);
      assert.strictEqual(pCheck.matched, true, `6G: Entry ${i} matched: true`);
    }

    assert.strictEqual(capacityTracker.size(), 0, '6H: All entries consumed');

    // Verify default capacity is 100
    const defaultTracker = new PromptOriginTracker({ autoPrune: false });
    assert.strictEqual(defaultTracker.getCapacity(), 100, '6I: Default capacity must be 100');
    assert.strictEqual(defaultTracker.getTtlMs(), 60000, '6J: Default TTL must be 60000ms');

    capacityTracker.dispose();
    defaultTracker.dispose();
    console.log('✓ [Test 6] Ring buffer bounded capacity and FIFO eviction verified.\n');

    // =========================================================================
    // Test 7: Global Singleton & Convenience Helpers
    // =========================================================================
    console.log('[Test 7] Verifying global singleton helpers...');

    promptOriginTracker.clear();
    registerTelegramPrompt('Singleton prompt test');

    const globalCheck1 = checkAndConsume('Singleton prompt test');
    assert.strictEqual(globalCheck1.origin, 'telegram', '7A: Global helper returns telegram');
    assert.strictEqual(globalCheck1.matched, true, '7B: Global helper matched: true');

    const globalCheck2 = checkAndConsume('Singleton prompt test');
    assert.strictEqual(globalCheck2.origin, 'pc_ide', '7C: Second call returns pc_ide');
    assert.strictEqual(globalCheck2.matched, false, '7D: Second call matched: false');

    promptOriginTracker.clear();
    console.log('✓ [Test 7] Global singleton and convenience helpers verified.\n');

    // =========================================================================
    // Test 8: TelegramBridge Integration & Transcript Event Pipeline
    // =========================================================================
    console.log('[Test 8] Verifying TelegramBridge integration and transcript pipeline...');

    const customTracker = new PromptOriginTracker({ autoPrune: false });
    const bridge = new TelegramBridge({
      promptOriginTracker: customTracker,
      enabled: true
    });

    assert.strictEqual(bridge.getPromptOriginTracker(), customTracker, '8A: Custom tracker getter');

    // Simulate Telegram message receipt: user sends message in Telegram
    const telePrompt = 'Create unit test for authentication service';
    customTracker.registerTelegramPrompt(telePrompt);

    // Simulate TranscriptTailEngine firing userInput event for Telegram prompt:
    const handleResult1 = bridge.handleTranscriptUserInput({
      prompt: telePrompt,
      stepIndex: 1,
      convId: 'c-test'
    });

    assert.strictEqual(handleResult1.origin, 'telegram', '8B: Bridge resolves origin to telegram');
    assert.strictEqual(handleResult1.matched, true, '8C: Bridge matched flag is true');
    assert.strictEqual(handleResult1.shouldMirrorToTelegram, false, '8D: Mirroring suppressed for Telegram prompt');

    // Simulate TranscriptTailEngine firing userInput event for PC IDE prompt:
    const pcPrompt = 'Fix CSS margin glitch on dashboard';
    const handleResult2 = bridge.handleTranscriptUserInput({
      prompt: pcPrompt,
      stepIndex: 2,
      convId: 'c-test'
    });

    assert.strictEqual(handleResult2.origin, 'pc_ide', '8E: Bridge resolves origin to pc_ide');
    assert.strictEqual(handleResult2.matched, false, '8F: Bridge matched flag is false');
    assert.strictEqual(handleResult2.shouldMirrorToTelegram, true, '8G: Mirroring enabled for PC prompt');
    assert.strictEqual(
      handleResult2.formattedText,
      '💻 You (on PC):\nFix CSS margin glitch on dashboard',
      '8H: Formatted text includes PC header'
    );

    // Verify setter
    const replacementTracker = new PromptOriginTracker({ autoPrune: false });
    bridge.setPromptOriginTracker(replacementTracker);
    assert.strictEqual(bridge.getPromptOriginTracker(), replacementTracker, '8I: Tracker setter works');

    customTracker.dispose();
    replacementTracker.dispose();
    console.log('✓ [Test 8] TelegramBridge integration and origin verification verified.\n');

    // =========================================================================
    // Test 9: Robustness to Invalid Inputs & Edge Cases
    // =========================================================================
    console.log('[Test 9] Verifying edge cases and input validation...');

    const edgeTracker = new PromptOriginTracker({ autoPrune: false });

    // Empty or non-string inputs
    assert.strictEqual(edgeTracker.registerTelegramPrompt(''), '', '9A: Empty string returns empty hash');
    assert.strictEqual(edgeTracker.registerTelegramPrompt('   '), '', '9B: Whitespace-only string returns empty hash');
    assert.strictEqual(edgeTracker.registerTelegramPrompt(null as any), '', '9C: Null returns empty hash');
    assert.strictEqual(edgeTracker.size(), 0, '9D: Size remains 0 after invalid registrations');

    const emptyCheck = edgeTracker.checkAndConsume('');
    assert.strictEqual(emptyCheck.origin, 'pc_ide', '9E: Empty prompt resolves to pc_ide');
    assert.strictEqual(emptyCheck.matched, false, '9F: Empty prompt matched is false');

    const nullCheck = edgeTracker.checkAndConsume(null as any);
    assert.strictEqual(nullCheck.origin, 'pc_ide', '9G: Null prompt resolves to pc_ide');
    assert.strictEqual(nullCheck.matched, false, '9H: Null prompt matched is false');

    // Clear operation
    edgeTracker.registerTelegramPrompt('Prompt to be cleared');
    assert.strictEqual(edgeTracker.size(), 1, '9I: Size is 1');
    edgeTracker.clear();
    assert.strictEqual(edgeTracker.size(), 0, '9J: Clear empties the buffer');
    assert.strictEqual(edgeTracker.getPendingCount('Prompt to be cleared'), 0, '9K: Pending count is 0 after clear');

    edgeTracker.dispose();
    console.log('✓ [Test 9] Edge cases and validation verified.\n');

    console.log('=================================================================');
    console.log('ALL PHASE 02 TESTS PASSED SUCCESSFULLY!');
    console.log('=================================================================');
  } catch (err) {
    console.error('\n❌ PHASE 02 TEST FAILURE:', err);
    process.exit(1);
  }
}

// Execute tests
runPhase02DedupOriginTrackerTests().catch((err) => {
  console.error('\n❌ UNHANDLED EXCEPTION IN PHASE 02 TESTS:', err);
  process.exit(1);
});
