// Standalone test suite for Phase 02: BridgeServer Log Ingestion API & IPC Tracing
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockConfigStore: Record<string, any> = {};

// Intercept 'vscode' imports before importing test modules
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      window: {
        createOutputChannel: (name: string) => ({
          name,
          lines: [] as string[],
          appendLine(line: string) { this.lines.push(line); },
          append(text: string) { this.lines.push(text); },
          show() {},
          dispose() {}
        }),
        showWarningMessage: () => {}
      },
      workspace: {
        getConfiguration: () => ({
          get: (key: string, defaultValue: any) => {
            return mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue;
          },
          update: async (key: string, value: any) => {
            mockConfigStore[key] = value;
          }
        })
      },
      env: {
        appName: 'Antigravity IDE Test Host',
        appRoot: '/mock/antigravity/app/root'
      },
      version: '1.85.0-test'
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DebugLogger, LogEntry } from '../debugLogger';
import { BridgeServer } from '../bridgeServer';
import { PromptDispatcher } from '../promptDispatcher';

function makeRequest(
  options: http.RequestOptions,
  body?: any
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch {
          // Keep raw string if not JSON
        }
        resolve({ statusCode: res.statusCode || 0, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      const dataStr = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(dataStr);
    }
    req.end();
  });
}

async function runPhase02TestSuite() {
  console.log('=== Running Phase 02: BridgeServer Log Ingestion API & IPC Tracing Verification Test ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase02-test-'));
  const testLogger = new DebugLogger(500);

  const server = new BridgeServer({
    portStart: 49200,
    portEnd: 49299,
    host: '127.0.0.1',
    workbenchDir: tempDir,
    staleClientMs: 500,
    logger: testLogger
  });

  try {
    // --------------------------------------------------------------------------
    // Test 1: BridgeServer Startup & Port Binding Tracing
    // --------------------------------------------------------------------------
    console.log('[Test 1] Verifying BridgeServer Startup & Port Binding Resolution Tracing...');
    const boundPort = await server.start();
    assert.ok(boundPort >= 49200 && boundPort <= 49299, `Port must be in configured range: ${boundPort}`);

    const startupEntries = testLogger.getEntries().filter((e) => e.component === 'SERVER');
    const boundEntry = startupEntries.find((e) => e.message.includes('Bound to port'));
    assert.ok(boundEntry, 'Must log "Bound to port" on server startup');
    assert.strictEqual(boundEntry!.level, 'INFO');
    assert.strictEqual(boundEntry!.details.port, boundPort);
    assert.strictEqual(boundEntry!.details.pid, process.pid);
    console.log(`  ✔ Server startup logged: ${boundEntry!.message}`);

    // --------------------------------------------------------------------------
    // Test 2: HTTP Ingestion Endpoint (POST /autoplan-log)
    // --------------------------------------------------------------------------
    console.log('\n[Test 2] Verifying HTTP Ingestion Endpoint (POST /autoplan-log)...');

    // 2.1 Shorthand single entry payload
    {
      const singlePayload = {
        windowKey: 'win_test_single',
        level: 'WARN',
        component: 'CLIENT',
        message: 'Renderer warning test message',
        details: { userAgent: 'Electron-Mock', screen: '1920x1080' }
      };

      const res = await makeRequest(
        {
          hostname: '127.0.0.1',
          port: boundPort,
          path: '/autoplan-log',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        },
        singlePayload
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.accepted, 1);

      const found = testLogger
        .getEntries()
        .find((e) => e.level === 'WARN' && e.message === 'Renderer warning test message');
      assert.ok(found, 'Single log entry must be ingested into DebugLogger');
      assert.strictEqual(found!.component, 'CLIENT');
      assert.strictEqual(found!.details.windowKey, 'win_test_single');
      assert.strictEqual(found!.details.userAgent, 'Electron-Mock');
      console.log('  ✔ Shorthand single log entry ingested with windowKey tagging.');
    }

    // 2.2 Batch log payload
    {
      const batchPayload = {
        windowKey: 'win_test_batch',
        logs: [
          {
            level: 'INFO',
            component: 'CLIENT',
            message: 'Connected to BridgeServer on port 48860',
            details: { url: 'workbench.html' }
          },
          {
            level: 'ERROR',
            component: 'DOM',
            message: 'Prompt textarea not found in DOM',
            error: 'Selector .chat-input timed out'
          }
        ]
      };

      const res = await makeRequest(
        {
          hostname: '127.0.0.1',
          port: boundPort,
          path: '/autoplan-log',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        },
        batchPayload
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.accepted, 2);

      const infoEntry = testLogger
        .getEntries()
        .find((e) => e.message === 'Connected to BridgeServer on port 48860');
      assert.ok(infoEntry, 'Batch entry 1 must be present');
      assert.strictEqual(infoEntry!.component, 'CLIENT');
      assert.strictEqual(infoEntry!.details.windowKey, 'win_test_batch');

      const errorEntry = testLogger
        .getEntries()
        .find((e) => e.message === 'Prompt textarea not found in DOM');
      assert.ok(errorEntry, 'Batch entry 2 must be present');
      assert.strictEqual(errorEntry!.component, 'DOM');
      assert.strictEqual(errorEntry!.error, 'Selector .chat-input timed out');
      console.log('  ✔ Batch log entries ingested with component and error preservation.');
    }

    // 2.3 Direct array payload
    {
      const arrayPayload = [
        { level: 'DEBUG', component: 'CLIENT', message: 'Direct array item 1' },
        { level: 'INFO', component: 'CLIENT', message: 'Direct array item 2' }
      ];

      const res = await makeRequest(
        {
          hostname: '127.0.0.1',
          port: boundPort,
          path: '/autoplan-log',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Window-Key': 'win_header_tagged'
          }
        },
        arrayPayload
      );

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.accepted, 2);

      const arrayItem = testLogger.getEntries().find((e) => e.message === 'Direct array item 1');
      assert.ok(arrayItem);
      assert.strictEqual(arrayItem!.details.windowKey, 'win_header_tagged');
      console.log('  ✔ Direct array payload ingested and tagged via X-Window-Key header.');
    }

    // 2.4 Malformed payload validation
    {
      const res = await makeRequest(
        {
          hostname: '127.0.0.1',
          port: boundPort,
          path: '/autoplan-log',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        },
        'invalid non-json string'
      );

      assert.strictEqual(res.statusCode, 400);
      console.log('  ✔ Malformed payload gracefully rejected with 400 Bad Request.');
    }

    // --------------------------------------------------------------------------
    // Test 3: Discovery Probes, Heartbeats, and Watchdog Tracing
    // --------------------------------------------------------------------------
    console.log('\n[Test 3] Verifying Discovery Probes, Heartbeats & Watchdog Tracing...');

    // 3.1 Client discovery probe
    {
      const probeRes = await makeRequest({
        hostname: '127.0.0.1',
        port: boundPort,
        path: '/autoplan-status?probe=1&windowKey=win_probe_99',
        method: 'GET'
      });
      assert.strictEqual(probeRes.statusCode, 200);

      const probeEntry = testLogger
        .getEntries()
        .find((e) => e.message.includes('Client discovery probe received from window: win_probe_99'));
      assert.ok(probeEntry, 'Probe request must be recorded in DebugLogger');
      assert.strictEqual(probeEntry!.level, 'DEBUG');
      console.log('  ✔ Client discovery probe logged at DEBUG level.');
    }

    // 3.2 Heartbeat ping
    {
      const heartbeatRes = await makeRequest({
        hostname: '127.0.0.1',
        port: boundPort,
        path: '/autoplan-heartbeat?windowKey=win_active_main',
        method: 'GET'
      });
      assert.strictEqual(heartbeatRes.statusCode, 200);

      const heartbeatEntry = testLogger
        .getEntries()
        .find((e) => e.message.includes('Heartbeat ping received from window: win_active_main'));
      assert.ok(heartbeatEntry, 'Heartbeat must be logged in DebugLogger');
      console.log('  ✔ Heartbeat ping logged.');
    }

    // 3.3 Active window key switch
    {
      await makeRequest({
        hostname: '127.0.0.1',
        port: boundPort,
        path: '/autoplan-status?windowKey=win_primary_user',
        method: 'GET'
      });

      const winEntry = testLogger
        .getEntries()
        .find((e) => e.message.includes('Active window key set to "win_primary_user"'));
      assert.ok(winEntry, 'Active window key transition must be logged');
      console.log('  ✔ Active window key registration logged.');
    }

    // 3.4 Watchdog eviction event
    {
      // Register a mock stale client directly
      server['clients'].set('win_stale_ghost', {
        windowKey: 'win_stale_ghost',
        lastSeenAt: Date.now() - 5000
      });

      const evicted = server.runWatchdogCheck();
      assert.ok(evicted >= 1, 'Watchdog must evict stale client');

      const evictionEntry = testLogger
        .getEntries()
        .find((e) => e.message.includes('Evicted client win_stale_ghost'));
      assert.ok(evictionEntry, 'Watchdog eviction must be logged in DebugLogger');
      assert.strictEqual(evictionEntry!.level, 'WARN');
      console.log(`  ✔ Watchdog eviction event logged: ${evictionEntry!.message}`);
    }

    // --------------------------------------------------------------------------
    // Test 4: Complete Prompt Command Lifecycle Tracing (Queue -> Poll -> ACK)
    // --------------------------------------------------------------------------
    console.log('\n[Test 4] Verifying Full Prompt Command Lifecycle Tracing (Queue -> Poll -> ACK)...');
    {
      const promptText = 'Test full lifecycle automation prompt';
      const dispatchPromise = server.dispatchPromptCommand(promptText, {
        timeoutMs: 4000,
        windowKey: 'win_primary_user'
      });

      // 4.1 Verify Queued Command log
      const queuedEntry = testLogger
        .getEntries()
        .find((e) => e.message.includes('Queued command') && e.details?.charCount === promptText.length);
      assert.ok(queuedEntry, 'Command queuing must be logged');
      const cmdId = queuedEntry!.details.commandId;
      console.log(`  ✔ Command queued trace logged for ${cmdId}`);

      // 4.2 Client polls status and retrieves command
      const pollRes = await makeRequest({
        hostname: '127.0.0.1',
        port: boundPort,
        path: '/autoplan-status?windowKey=win_primary_user',
        method: 'GET'
      });
      assert.strictEqual(pollRes.statusCode, 200);
      assert.ok(Array.isArray(pollRes.body.pendingCommands));
      const fetchedCmd = pollRes.body.pendingCommands.find((c: any) => c.id === cmdId);
      assert.ok(fetchedCmd, 'Client must retrieve queued command');

      // Verify retrieval log
      const retrievedEntry = testLogger
        .getEntries()
        .find((e) => e.message.includes(`Command ${cmdId} (sendPrompt) retrieved by client win_primary_user`));
      assert.ok(retrievedEntry, 'Command retrieval must be logged');
      console.log(`  ✔ Command retrieval trace logged.`);

      // 4.3 Client sends ACK
      await new Promise((r) => setTimeout(r, 20)); // Small delay for latency measurement
      const ackRes = await makeRequest(
        {
          hostname: '127.0.0.1',
          port: boundPort,
          path: '/autoplan-ack',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        },
        {
          commandId: cmdId,
          status: 'completed',
          windowKey: 'win_primary_user',
          metadata: { executionTimeMs: 18 }
        }
      );

      assert.strictEqual(ackRes.statusCode, 200);
      const ackResult = await dispatchPromise;
      assert.strictEqual(ackResult.success, true);
      assert.strictEqual(ackResult.status, 'completed');
      assert.ok(ackResult.durationMs >= 15, `Duration should be measured: ${ackResult.durationMs}ms`);

      // Verify ACK processing log
      const ackEntry = testLogger
        .getEntries()
        .find((e) => e.message.includes(`Command ${cmdId} ACK received: status=completed`));
      assert.ok(ackEntry, 'ACK processing must be logged');
      assert.strictEqual(ackEntry!.level, 'INFO');
      assert.strictEqual(ackEntry!.details.metadata.executionTimeMs, 18);
      console.log(`  ✔ Command ACK trace logged: ${ackEntry!.message}`);
    }

    // --------------------------------------------------------------------------
    // Test 5: Command Timeout Escalation Tracing (with client fetch state)
    // --------------------------------------------------------------------------
    console.log('\n[Test 5] Verifying Command Timeout Escalation Tracing...');

    // 5.1 Timeout when client NEVER fetched command
    {
      const unfetchedPromise = server.dispatchPromptCommand('Unfetched command', {
        timeoutMs: 80,
        windowKey: 'win_unfetched_target'
      });

      let rejected = false;
      try {
        await unfetchedPromise;
      } catch (err: any) {
        rejected = true;
        assert.ok(err.message.includes('timed out'));
      }
      assert.strictEqual(rejected, true);

      const timeoutEntry = testLogger
        .getEntries()
        .find((e) => e.message.includes('Command dispatch timed out') && e.details?.clientFetched === false);
      assert.ok(timeoutEntry, 'Unfetched timeout must record clientFetched: false');
      assert.strictEqual(timeoutEntry!.level, 'ERROR');
      console.log('  ✔ Unfetched command timeout captured with clientFetched: false');
    }

    // 5.2 Timeout when client DID fetch command but failed to ACK
    {
      const fetchedPromise = server.dispatchPromptCommand('Fetched command that will time out', {
        timeoutMs: 150,
        windowKey: 'win_primary_user'
      });

      // Fetch command via status polling
      await makeRequest({
        hostname: '127.0.0.1',
        port: boundPort,
        path: '/autoplan-status?windowKey=win_primary_user',
        method: 'GET'
      });

      let rejected = false;
      try {
        await fetchedPromise;
      } catch (err: any) {
        rejected = true;
      }
      assert.strictEqual(rejected, true);

      const timeoutFetchedEntry = testLogger
        .getEntries()
        .find((e) => e.message.includes('Command dispatch timed out') && e.details?.clientFetched === true);
      assert.ok(timeoutFetchedEntry, 'Fetched timeout must record clientFetched: true');
      console.log('  ✔ Fetched command timeout captured with clientFetched: true');
    }

    // --------------------------------------------------------------------------
    // Test 6: PromptDispatcher Pre-Flight & Tier Fallback Tracing
    // --------------------------------------------------------------------------
    console.log('\n[Test 6] Verifying PromptDispatcher Pre-Flight & Tier Fallback Tracing...');
    {
      const dispatcherLogger = new DebugLogger(200);

      // Create dispatcher with custom executor and keyboardManager
      let keyboardExecuted = false;
      const mockKeyboardManager = {
        executeBatchPromptFlow: async () => {
          keyboardExecuted = true;
        },
        checkLinuxKeyboardPrerequisites: () => ({ available: true, binary: 'xdotool' })
      } as any;

      let nativeCommandsExecuted: string[] = [];
      const mockCommandExecutor = (cmd: string) => {
        nativeCommandsExecuted.push(cmd);
        return Promise.reject(new Error(`Command ${cmd} rejected by mock host`));
      };

      const dispatcher = new PromptDispatcher({
        bridgeServer: server,
        keyboardManager: mockKeyboardManager,
        commandExecutor: mockCommandExecutor,
        configProvider: () =>
          ({
            executionMode: 'auto',
            allowTierFallback: true,
            strictMode: false,
            bridgeTimeoutMs: 500,
            suppressFallbackWarnings: true
          } as any),
        logger: dispatcherLogger
      });

      // 6.1 Pre-flight check logging
      const readiness = dispatcher.validateDispatchReadiness();
      const preflightEntry = dispatcherLogger
        .getEntries()
        .find((e) => e.message.includes('Readiness check'));
      assert.ok(preflightEntry, 'Pre-flight check must be logged in DebugLogger');
      assert.strictEqual(preflightEntry!.component, 'DISPATCHER');
      console.log(`  ✔ Pre-flight readiness logged: ${preflightEntry!.message}`);

      // 6.2 Fallback dispatch execution: Tier 1 fails -> Tier 2 fails -> Tier 3 succeeds
      // Intentionally cause Tier 1 to fail by requesting an inactive window key
      const promptToDispatch = 'Refactor PromptDispatcher logging subsystem to provide rich diagnostics';
      const dispatchRes = await dispatcher.dispatchPrompt(promptToDispatch, {
        allowFallback: true,
        timeoutMs: 60,
        windowKey: 'win_nonexistent_destination'
      });

      assert.strictEqual(dispatchRes.success, true);
      assert.strictEqual(dispatchRes.tier, 'keyboard');
      assert.strictEqual(keyboardExecuted, true);
      assert.strictEqual(dispatchRes.fallbackHistory?.length, 2);

      // Verify Dispatch start log with preview
      const dispatchStartEntry = dispatcherLogger
        .getEntries()
        .find((e) => e.message.includes('Dispatching prompt: "Refactor PromptDispatcher'));
      assert.ok(dispatchStartEntry, 'Dispatch start log with preview must be emitted');
      assert.ok(dispatchStartEntry!.message.includes(`Total ${promptToDispatch.length} chars`));

      // Verify Tier 1 transition cause log
      const tier1FailLog = dispatcherLogger
        .getEntries()
        .find((e) => e.message.includes('Tier 1 (domBridge) failed') && e.message.includes('Falling back to Tier 2'));
      assert.ok(tier1FailLog, 'Tier 1 fallback transition cause must be logged with duration');
      assert.strictEqual(tier1FailLog!.level, 'WARN');

      // Verify Tier 2 transition cause log
      const tier2FailLog = dispatcherLogger
        .getEntries()
        .find((e) => e.message.includes('Tier 2 (nativeCommand) failed') && e.message.includes('Falling back to Tier 3'));
      assert.ok(tier2FailLog, 'Tier 2 fallback transition cause must be logged with duration');
      assert.strictEqual(tier2FailLog!.level, 'WARN');

      // Verify Tier 3 success log
      const tier3SuccessLog = dispatcherLogger
        .getEntries()
        .find((e) => e.message.includes('Tier 3 (keyboard) succeeded'));
      assert.ok(tier3SuccessLog, 'Tier 3 success must be logged');

      console.log('  ✔ Complete fallback chain (Tier 1 -> Tier 2 -> Tier 3) successfully traced with exact causes.');

      // 6.3 Complete failure test (all tiers fail)
      mockKeyboardManager.executeBatchPromptFlow = async () => {
        throw new Error('PowerShell SendKeys subprocess crashed');
      };

      let allTiersFailed = false;
      try {
        await dispatcher.dispatchPrompt('Another test prompt', {
          allowFallback: true,
          timeoutMs: 60,
          windowKey: 'win_nonexistent_destination'
        });
      } catch (err: any) {
        allTiersFailed = true;
        assert.ok(err.message.includes('All prompt dispatch tiers failed'));
      }
      assert.strictEqual(allTiersFailed, true);

      const allFailedLog = dispatcherLogger
        .getEntries()
        .find((e) => e.message.includes('All prompt dispatch tiers failed after fallback chain'));
      assert.ok(allFailedLog, 'All-tiers-failed error event must be logged');
      assert.strictEqual(allFailedLog!.level, 'ERROR');
      console.log('  ✔ All prompt dispatch tiers failure trace logged with error level.');
    }
  } finally {
    await server.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 02 BRIDGESERVER LOGGING & TRACING TESTS PASSED! 🎉');
  console.log('================================================================\n');
}

runPhase02TestSuite().catch((err) => {
  console.error('\n❌ PHASE 02 TEST SUITE FAILED:', err);
  process.exit(1);
});
