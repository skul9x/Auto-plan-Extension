// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceConfig: Record<string, any> = {
  enableVerboseBridgeLogs: false,
  maxLogEntries: 500
};

const outputChannelLines: string[] = [];

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
        createOutputChannel: (_name: string, _options?: any) => ({
          appendLine: (line: string) => {
            outputChannelLines.push(line);
          },
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
  DebugLogger,
  safeStringify,
  boundLogPayload,
  MAX_LOG_STRING_LENGTH,
  MAX_TOTAL_SERIALIZED_LENGTH
} from '../debugLogger';
import {
  PromptDispatcher,
  summarizeDomSnapshot,
  sanitizeDiagnosticDetails
} from '../promptDispatcher';
import { BridgeServer } from '../bridgeServer';

async function runPhase01Tests() {
  console.log('================================================================');
  console.log(' PHASE 01: Event Loop, Memory Protection & Serialization Tests  ');
  console.log('================================================================\n');

  // Generate 5 MB synthetic DOM snapshot HTML
  const synthetic5MbSnapshot = '<div class="monaco-workbench-container" id="workbench-root">' +
    '<span>Element line item content</span>'.repeat(140000) +
    '</div>';
  assert.ok(synthetic5MbSnapshot.length >= 5 * 1024 * 1024, `Synthetic DOM must be at least 5 MB (got ${(synthetic5MbSnapshot.length / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`[Setup] Generated 5 MB synthetic DOM snapshot (${(synthetic5MbSnapshot.length / (1024 * 1024)).toFixed(2)} MB).`);

  // --------------------------------------------------------------------------
  // Test 1: DOM Snapshot Sanitization in Dispatcher & Error Integrity
  // --------------------------------------------------------------------------
  console.log('\n[Test 1] Verifying DOM Snapshot Sanitization in PromptDispatcher...');
  {
    const logger = new DebugLogger(50);
    logger.clear();

    const mockBridgeServer = {
      isListening: () => true,
      getConnectedClients: () => [{ id: 'client-1', alive: true }],
      getWorkspaceName: () => 'test-ws',
      getActiveWindowKey: () => 'win-1',
      getWindowKey: () => 'win-1',
      dispatchNewConversationCommand: async () => ({ success: true, status: 'ready' }),
      dispatchPromptCommand: async () => {
        return {
          success: false,
          commandId: 'cmd-err-1',
          status: 'error',
          error: 'Simulated DOM Bridge element not found',
          metadata: {
            code: 'ELEMENT_NOT_FOUND',
            rejectionReason: 'missing_chat_input',
            domSnapshot: synthetic5MbSnapshot,
            steps: ['find_chat', 'verify_input']
          }
        };
      }
    } as unknown as BridgeServer;

    const dispatcher = new PromptDispatcher({
      bridgeServer: mockBridgeServer,
      logger,
      configProvider: () => ({
        promptText: 'test',
        repeatCount: 1,
        completionKeyword: 'Done',
        delayBetweenLoopsMs: 100,
        timeoutPerLoopMinutes: 1,
        executionMode: 'domBridge',
        allowTierFallback: false,
        strictMode: true,
        bridgeTimeoutMs: 2000
      })
    });

    let caughtError: any = null;
    try {
      await dispatcher.dispatchTier1('Hello world prompt', { openNewConversation: false });
    } catch (err: any) {
      caughtError = err;
    }

    assert.ok(caughtError, 'dispatchTier1 must reject when bridge reports failure');
    // Verify genuine error handler has access to raw DOM snapshot
    assert.strictEqual(
      caughtError.domSnapshot,
      synthetic5MbSnapshot,
      'Original full error details (domSnapshot) must remain accessible to error handlers'
    );
    assert.strictEqual(
      caughtError.metadata?.domSnapshot,
      synthetic5MbSnapshot,
      'Original metadata.domSnapshot must remain accessible to error handlers'
    );

    // Verify logged details are sanitized
    const entries = logger.getEntries();
    assert.ok(entries.length > 0, 'Logger must have recorded the error');
    const errorEntry = entries.find((e) => e.level === 'ERROR' && e.component === 'DISPATCHER');
    assert.ok(errorEntry, 'Error entry must exist in logger');
    assert.ok(errorEntry.details, 'Error entry must include details');

    // Check that domSnapshot was replaced with compact diagnostic descriptor
    const loggedDomSnapshot = errorEntry.details.domSnapshot;
    assert.ok(
      typeof loggedDomSnapshot === 'string',
      'Logged domSnapshot must be a string descriptor'
    );
    assert.ok(
      loggedDomSnapshot.startsWith('[DOM Snapshot:'),
      `Logged domSnapshot should be formatted descriptor, got: ${loggedDomSnapshot.slice(0, 50)}`
    );
    assert.ok(
      loggedDomSnapshot.includes(`${synthetic5MbSnapshot.length} chars`),
      'Logged descriptor should mention total char length'
    );
    assert.ok(
      loggedDomSnapshot.length < 500,
      `Sanitized snapshot descriptor must be compact (< 500 chars), got ${loggedDomSnapshot.length} chars`
    );

    // Also check metadata.domSnapshot inside details
    if (errorEntry.details.metadata?.domSnapshot) {
      assert.ok(
        errorEntry.details.metadata.domSnapshot.startsWith('[DOM Snapshot:'),
        'details.metadata.domSnapshot must also be sanitized'
      );
      assert.ok(errorEntry.details.metadata.domSnapshot.length < 500);
    }

    // 1b: Verify timeout warning also sanitizes domSnapshot
    logger.clear();
    const timeoutBridgeServer = {
      isListening: () => true,
      getConnectedClients: () => [{ id: 'client-1', alive: true }],
      getWorkspaceName: () => 'test-ws',
      getActiveWindowKey: () => 'win-1',
      getWindowKey: () => 'win-1',
      dispatchPromptCommand: async () => {
        const timeoutErr: any = new Error('Command timed out after 5000ms');
        timeoutErr.domSnapshot = synthetic5MbSnapshot;
        timeoutErr.isTimeout = true;
        throw timeoutErr;
      }
    } as unknown as BridgeServer;

    const timeoutDispatcher = new PromptDispatcher({
      bridgeServer: timeoutBridgeServer,
      logger,
      configProvider: () => ({
        promptText: 'test',
        repeatCount: 1,
        completionKeyword: 'Done',
        delayBetweenLoopsMs: 100,
        timeoutPerLoopMinutes: 1,
        executionMode: 'domBridge',
        allowTierFallback: false,
        strictMode: true,
        bridgeTimeoutMs: 1000
      })
    });

    try {
      await timeoutDispatcher.dispatchTier1('test prompt', { openNewConversation: false });
    } catch (timeoutCaught: any) {
      assert.strictEqual(timeoutCaught.domSnapshot, synthetic5MbSnapshot, 'Thrown timeout error must retain full domSnapshot');
    }

    const timeoutWarnEntry = logger.getEntries().find((e) => e.level === 'WARN' && e.component === 'DISPATCHER');
    assert.ok(timeoutWarnEntry, 'Timeout must record a WARN entry');
    assert.ok(
      typeof timeoutWarnEntry.details?.domSnapshot === 'string',
      'Timeout warn details must have sanitized string domSnapshot'
    );
    assert.ok(
      timeoutWarnEntry.details.domSnapshot.startsWith('[DOM Snapshot:'),
      'Timeout warn details domSnapshot must be summarized'
    );
    assert.ok(timeoutWarnEntry.details.domSnapshot.length < 500);

    // 1c: Verify fallback chain sanitizes domSnapshot across tiers
    logger.clear();
    let tier2Executed = false;
    const fallbackDispatcher = new PromptDispatcher({
      bridgeServer: timeoutBridgeServer,
      commandExecutor: async (cmd: string) => {
        if (cmd === 'antigravity.sendTextToChat') {
          tier2Executed = true;
          return true;
        }
      },
      logger,
      configProvider: () => ({
        promptText: 'test',
        repeatCount: 1,
        completionKeyword: 'Done',
        delayBetweenLoopsMs: 100,
        timeoutPerLoopMinutes: 1,
        executionMode: 'auto',
        allowTierFallback: true,
        strictMode: false,
        bridgeTimeoutMs: 1000
      })
    });

    const fallbackResult = await fallbackDispatcher.dispatchPrompt('Test fallback prompt', { openNewConversation: false });
    assert.ok(fallbackResult.success, 'Fallback to tier 2 must succeed');
    assert.strictEqual(fallbackResult.tier, 'nativeCommand');
    assert.ok(tier2Executed, 'Tier 2 command executor must have been invoked');

    const fallbackWarn = logger.getEntries().find((e) => e.level === 'WARN' && e.component === 'DISPATCHER' && e.message.includes('Falling back to Tier 2'));
    assert.ok(fallbackWarn, 'Fallback warning must be logged');
    assert.ok(
      fallbackWarn.details?.domSnapshot?.startsWith('[DOM Snapshot:'),
      'Fallback warning must contain sanitized domSnapshot'
    );

    console.log('  ✔ DOM snapshot sanitized across direct errors, timeouts, and fallback chains.');
  }

  // --------------------------------------------------------------------------
  // Test 2: Benchmarking Execution Time of safeStringify and formatEntry (< 15ms)
  // --------------------------------------------------------------------------
  console.log('\n[Test 2] Benchmarking safeStringify and formatEntry with 5 MB synthetic DOM string...');
  {
    const logger = new DebugLogger(100);

    // 1. safeStringify benchmark with massive string directly in payload
    const payloadWithBigString = {
      component: 'TEST',
      html: synthetic5MbSnapshot,
      nested: {
        innerHtml: synthetic5MbSnapshot
      }
    };

    const iterations = 5;
    const stringifyTimes: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const tStart = process.hrtime.bigint();
      const stringified = safeStringify(payloadWithBigString);
      const tEnd = process.hrtime.bigint();
      const durationMs = Number(tEnd - tStart) / 1_000_000;
      stringifyTimes.push(durationMs);

      assert.ok(
        stringified.length <= MAX_TOTAL_SERIALIZED_LENGTH + 200,
        `safeStringify output length (${stringified.length}) must be bounded by MAX_TOTAL_SERIALIZED_LENGTH`
      );
      assert.ok(
        stringified.includes('truncated'),
        'safeStringify output must indicate omission/truncation'
      );
    }

    const maxStringifyTime = Math.max(...stringifyTimes);
    console.log(`  - safeStringify max duration across ${iterations} runs: ${maxStringifyTime.toFixed(3)}ms`);
    assert.ok(
      maxStringifyTime < 15.0,
      `safeStringify on 5 MB string must not block event loop for > 15ms (took ${maxStringifyTime.toFixed(3)}ms)`
    );

    // 2. formatEntry benchmark on un-sanitized log entry with oversized strings
    const rawEntry = {
      id: 'test_entry_1',
      timestamp: Date.now(),
      isoTime: new Date().toISOString(),
      level: 'ERROR' as const,
      component: 'DISPATCHER' as const,
      message: 'Dispatch failed due to oversized payload',
      details: {
        domSnapshot: synthetic5MbSnapshot,
        metadata: {
          hugeText: 'Z'.repeat(1000000)
        }
      },
      error: 'Synthetic error with oversized message: ' + 'E'.repeat(10000)
    };

    const formatTimes: number[] = [];
    let formattedResult = '';
    for (let i = 0; i < iterations; i++) {
      const tStart = process.hrtime.bigint();
      formattedResult = logger.formatEntry(rawEntry);
      const tEnd = process.hrtime.bigint();
      const durationMs = Number(tEnd - tStart) / 1_000_000;
      formatTimes.push(durationMs);
    }

    const maxFormatTime = Math.max(...formatTimes);
    console.log(`  - formatEntry max duration across ${iterations} runs: ${maxFormatTime.toFixed(3)}ms`);
    assert.ok(
      maxFormatTime < 15.0,
      `formatEntry on 5 MB payload must complete in < 15ms (took ${maxFormatTime.toFixed(3)}ms)`
    );

    // Verify formatEntry truncates properties cleanly with indication of omission
    assert.ok(
      formattedResult.includes('truncated'),
      'formatEntry must cleanly truncate oversized properties with indication of omission'
    );
    assert.ok(
      formattedResult.length < 50000,
      `Formatted line length (${formattedResult.length}) must be bounded and not multi-megabytes`
    );

    console.log('  ✔ Non-blocking performance confirmed: all stringification/formatting ran in < 15ms.');
  }

  // --------------------------------------------------------------------------
  // Test 3: Configuration-Gated Debug Log Streaming (OutputChannel bypass)
  // --------------------------------------------------------------------------
  console.log('\n[Test 3] Verifying Configuration-Gated Debug Log Streaming...');
  {
    const logger = new DebugLogger(50);
    const mockChannel = {
      lines: [] as string[],
      appendLine(line: string) {
        this.lines.push(line);
      },
      show() {},
      dispose() {}
    };
    logger.setOutputChannel(mockChannel as any);

    // Case A: enableVerboseBridgeLogs is FALSE
    logger.setVerboseLogsEnabled(false);
    mockChannel.lines = [];

    logger.debug('SERVER', 'Debug message 1 (should NOT be streamed)', { port: 8080 });
    logger.debug('DISPATCHER', 'Debug message 2 (should NOT be streamed)', { attempt: 1 });

    assert.strictEqual(
      mockChannel.lines.length,
      0,
      'OutputChannel.appendLine must NOT be called for DEBUG level when enableVerboseBridgeLogs is false'
    );

    // Ring-buffer should still retain the entries
    const entries = logger.getEntries();
    assert.strictEqual(entries.length, 2, 'Ring-buffer must still retain entries even when OutputChannel is bypassed');

    // INFO / WARN / ERROR must still be streamed to OutputChannel
    logger.info('SERVER', 'Info message (SHOULD be streamed)', { status: 'listening' });
    assert.strictEqual(mockChannel.lines.length, 1, 'INFO log must still stream to OutputChannel');
    assert.ok(mockChannel.lines[0].includes('Info message'), 'OutputChannel must contain INFO line');

    logger.warn('CLIENT', 'Warning message (SHOULD be streamed)');
    assert.strictEqual(mockChannel.lines.length, 2, 'WARN log must stream to OutputChannel');

    logger.error('DISPATCHER', 'Error message (SHOULD be streamed)');
    assert.strictEqual(mockChannel.lines.length, 3, 'ERROR log must stream to OutputChannel');

    // Case B: enableVerboseBridgeLogs is TRUE
    logger.setVerboseLogsEnabled(true);
    mockChannel.lines = [];

    logger.debug('DISPATCHER', 'Debug message with verbose enabled (SHOULD be streamed)', { ok: true });
    assert.strictEqual(
      mockChannel.lines.length,
      1,
      'OutputChannel.appendLine MUST be called for DEBUG level when enableVerboseBridgeLogs is true'
    );
    assert.ok(
      mockChannel.lines[0].includes('Debug message with verbose enabled'),
      'OutputChannel should receive formatted DEBUG entry'
    );

    console.log('  ✔ Debug logs cleanly gated: OutputChannel bypassed when disabled, active when enabled.');
  }

  // --------------------------------------------------------------------------
  // Test 4: Ring Buffer Memory Stability & Heap Protection (500 entries)
  // --------------------------------------------------------------------------
  console.log('\n[Test 4] Verifying Ring Buffer Memory Stability under 500 consecutive failures...');
  {
    const logger = new DebugLogger(500);
    logger.clear();
    logger.setVerboseLogsEnabled(false); // keep test fast

    const initialHeap = process.memoryUsage().heapUsed;

    // Simulate 500 consecutive failed dispatch entries with 5 MB synthetic DOM snapshots
    for (let i = 0; i < 500; i++) {
      const sanitizedPayload = sanitizeDiagnosticDetails({
        failureIndex: i,
        commandId: `cmd_${i}`,
        domSnapshot: synthetic5MbSnapshot,
        metadata: {
          code: 'DISPATCH_TIMEOUT',
          domSnapshot: synthetic5MbSnapshot,
          steps: ['step_1', 'step_2']
        }
      });

      logger.error(
        'DISPATCHER',
        `Simulated dispatch timeout iteration ${i}`,
        sanitizedPayload,
        new Error(`Failure iteration ${i}`)
      );
    }

    const entries = logger.getEntries();
    assert.strictEqual(entries.length, 500, 'Ring buffer must contain exactly 500 entries');

    // Calculate total serialized memory footprint of log details
    let totalDetailsBytes = 0;
    for (const entry of entries) {
      const serialized = JSON.stringify(entry.details || {});
      totalDetailsBytes += serialized.length;
    }

    const averageEntryBytes = totalDetailsBytes / entries.length;
    const totalDetailsMb = totalDetailsBytes / (1024 * 1024);

    console.log(`  - Total serialized details across 500 entries: ${totalDetailsMb.toFixed(2)} MB`);
    console.log(`  - Average entry details footprint: ${averageEntryBytes.toFixed(1)} bytes`);

    assert.ok(
      averageEntryBytes < 4096,
      `Average entry details footprint must be < 4 KB (got ${averageEntryBytes.toFixed(1)} bytes)`
    );

    assert.ok(
      totalDetailsMb < 10.0,
      `Total details memory retained must be < 10 MB (got ${totalDetailsMb.toFixed(2)} MB)`
    );

    const finalHeap = process.memoryUsage().heapUsed;
    const heapGrowthMb = (finalHeap - initialHeap) / (1024 * 1024);
    console.log(`  - Heap delta after 500 5MB snapshot failures: ${heapGrowthMb.toFixed(2)} MB`);

    // Verify heap did not balloon by hundreds of megabytes (500 * 5 MB = 2.5 GB without protection!)
    assert.ok(
      heapGrowthMb < 50.0,
      `Heap growth must not balloon after 500 entries (got ${heapGrowthMb.toFixed(2)} MB)`
    );

    console.log('  ✔ Ring buffer memory stability verified: details kept strictly bounded under 10 MB.');
  }

  // --------------------------------------------------------------------------
  // Test 5: Defensive helper units (summarizeDomSnapshot, boundLogPayload)
  // --------------------------------------------------------------------------
  console.log('\n[Test 5] Verifying edge cases in defensive sanitizers...');
  {
    // summarizeDomSnapshot edge cases
    assert.strictEqual(summarizeDomSnapshot(undefined), undefined);
    assert.strictEqual(summarizeDomSnapshot(null), undefined);
    assert.strictEqual(summarizeDomSnapshot(12345), undefined);
    const shortHtml = '<html><body>Test</body></html>';
    const summary = summarizeDomSnapshot(shortHtml);
    assert.ok(summary?.includes('30 chars'));

    // boundLogPayload circular reference protection
    const circularObj: any = { name: 'circular-test' };
    circularObj.self = circularObj;
    const bounded = boundLogPayload(circularObj);
    assert.strictEqual(bounded.self, '[Circular]', 'Circular reference must be safely identified');

    // Deeply nested object protection
    let deepObj: any = { val: 'leaf' };
    for (let i = 0; i < 15; i++) {
      deepObj = { nested: deepObj };
    }
    const boundedDeep = boundLogPayload(deepObj);
    assert.ok(JSON.stringify(boundedDeep).includes('[MaxDepthExceeded]'));

    console.log('  ✔ Defensive edge cases verified.');
  }

  console.log('\n================================================================');
  console.log(' ALL PHASE 01 TESTS PASSED SUCCESSFULLY!                        ');
  console.log('================================================================');
}

runPhase01Tests().catch((err) => {
  console.error('\n❌ PHASE 01 TEST FAILED:', err);
  process.exit(1);
});
