// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      env: {
        clipboard: {
          writeText: async () => {},
          readText: async () => ''
        }
      },
      commands: {
        executeCommand: async () => {}
      },
      window: {
        showWarningMessage: () => {},
        showErrorMessage: () => {}
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { PromptDispatcher, promptDispatcher, DispatchReadinessResult } from '../promptDispatcher';
import { BridgeServer, bridgeServer, PORT_REGISTRY_FILENAME, BridgeCommandAck } from '../bridgeServer';
import { Orchestrator } from '../orchestrator';
import { DebugLogger } from '../debugLogger';

function httpRequest(
  options: http.RequestOptions,
  postData?: string | object
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const dataString = typeof postData === 'object' ? JSON.stringify(postData) : postData;
    const req = http.request(options, (res) => {
      let rawBody = '';
      res.on('data', (chunk) => {
        rawBody += chunk;
      });
      res.on('end', () => {
        let body = rawBody;
        try {
          body = JSON.parse(rawBody);
        } catch {
          // Keep raw
        }
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (dataString) {
      req.write(dataString);
    }
    req.end();
  });
}

async function runPhase02FastReconnectDispatcherTests() {
  console.log('=== Running Phase 02: Shared Server Singleton & Fast Auto-Wakeup Dispatcher Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase02-fast-wakeup-'));
  const portsRegistryPath = path.join(tempDir, PORT_REGISTRY_FILENAME);

  try {
    // ----------------------------------------------------------------------
    // Test 1: Shared Server Singleton Default
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying PromptDispatcher default uses shared BridgeServer singleton...');

    assert.strictEqual(
      promptDispatcher.getBridgeServer(),
      bridgeServer,
      'Exported promptDispatcher must use the shared bridgeServer singleton instance'
    );

    const defaultInstantiatedDispatcher = new PromptDispatcher();
    assert.strictEqual(
      defaultInstantiatedDispatcher.getBridgeServer(),
      bridgeServer,
      'new PromptDispatcher() without options must default to shared bridgeServer singleton'
    );

    const orchestratorDefault = new Orchestrator();
    assert.strictEqual(
      orchestratorDefault.getPromptDispatcher().getBridgeServer(),
      bridgeServer,
      'Orchestrator must default to using the shared bridgeServer singleton via promptDispatcher'
    );

    console.log('  -> Passed: Shared server singleton instance wired across all default dispatchers.');

    // ----------------------------------------------------------------------
    // Test 2: Fast Pre-Flight Wakeup Probe (ensureBridgeReadinessWithWakeup)
    // ----------------------------------------------------------------------
    console.log('\n[Test 2] Verifying fast wakeup probe discovers background client (< 250ms)...');

    const testServer = new BridgeServer({
      portStart: 49500,
      portEnd: 49520,
      portsRegistryPath,
      windowKey: 'win_fast_probe_test'
    });
    const port = await testServer.start();

    const customLogger = new DebugLogger(50);
    const dispatcher = new PromptDispatcher({
      bridgeServer: testServer,
      logger: customLogger
    });

    // Verify initially 0 connected clients
    assert.strictEqual(testServer.getConnectedClients().length, 0, 'Server should have 0 connected clients initially');
    const initialSyncReadiness = dispatcher.validateDispatchReadiness(
      undefined,
      'domBridge',
      false // strict mode
    );
    assert.strictEqual(initialSyncReadiness.ready, false, 'Sync check without client should be unready');

    // Launch a background client ping after 60ms delay (simulating unthrottled background client wakeup)
    setTimeout(() => {
      httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/autoplan-status?windowKey=win_fast_probe_test&probe=1&clientVersion=2.0.0',
        method: 'GET'
      }).catch(() => {});
    }, 60);

    const probeStartTime = Date.now();
    const wakeupResult = await dispatcher.ensureBridgeReadinessWithWakeup(
      250,
      undefined,
      'domBridge',
      false
    );
    const probeDuration = Date.now() - probeStartTime;

    assert.strictEqual(wakeupResult.ready, true, 'Wakeup probe must resolve to ready=true after client responds');
    assert.strictEqual(wakeupResult.selectedTier, 'domBridge', 'Selected tier must be domBridge');
    assert.strictEqual(wakeupResult.isFocusFree, true, 'Must be focus-free');
    assert.strictEqual(wakeupResult.details.connectedClientsCount, 1, 'Client count must be 1');
    assert.strictEqual(wakeupResult.details.bridgePort, port, 'Bridge port must match');
    assert.ok(probeDuration >= 50 && probeDuration < 250, `Probe should complete within 250ms (took ${probeDuration}ms)`);

    // Verify DISPATCHER logging was synchronized
    const dispatcherLogs = customLogger.getEntries().filter((l) => l.component === 'DISPATCHER');
    assert.ok(dispatcherLogs.length > 0, 'Dispatcher should have logged readiness events');
    const logHasPortAndWindow = dispatcherLogs.some((l) =>
      l.message.includes('Wakeup readiness evaluated') || l.message.includes('Readiness check passed')
    );
    assert.strictEqual(logHasPortAndWindow, true, 'Dispatcher log should record evaluated readiness');

    console.log(`  -> Passed: Fast wakeup probe discovered client and validated readiness in ${probeDuration}ms.`);

    // ----------------------------------------------------------------------
    // Test 3: Auto-Reconnect Retry in dispatchTier1
    // ----------------------------------------------------------------------
    console.log('\n[Test 3] Verifying dispatchTier1 auto-reconnect retry loop when client connects just-in-time...');

    // Evict the client to simulate transient disconnect right before dispatch
    (testServer as any).clients.clear();
    assert.strictEqual(testServer.getConnectedClients().length, 0, 'Clients map cleared');

    const promptText = 'Implement focus-free background runner test';

    // Simulate background client polling periodically (e.g. every 50ms) starting 100ms after dispatchTier1 is initiated
    let clientPollTimer: NodeJS.Timeout | null = null;
    setTimeout(() => {
      clientPollTimer = setInterval(async () => {
        try {
          const pollRes = await httpRequest({
            hostname: '127.0.0.1',
            port,
            path: '/autoplan-status?windowKey=win_fast_probe_test',
            method: 'GET'
          });

          if (pollRes.body && Array.isArray(pollRes.body.pendingCommands) && pollRes.body.pendingCommands.length > 0) {
            for (const cmd of pollRes.body.pendingCommands) {
              await httpRequest(
                {
                  hostname: '127.0.0.1',
                  port,
                  path: '/autoplan-ack',
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' }
                },
                {
                  commandId: cmd.id,
                  status: 'submitClicked',
                  windowKey: 'win_fast_probe_test',
                  metadata: { backgroundFocusFree: true }
                }
              );
            }
          }
        } catch {}
      }, 50);
    }, 100);

    const dispatchStart = Date.now();
    const result = await dispatcher.dispatchTier1(promptText, {
      windowKey: 'win_fast_probe_test',
      timeoutMs: 3000
    });
    const dispatchDuration = Date.now() - dispatchStart;
    if (clientPollTimer) clearInterval(clientPollTimer);

    assert.strictEqual(result.success, true, 'dispatchTier1 must succeed via auto-reconnect');
    assert.strictEqual(result.tier, 'domBridge', 'Tier must be domBridge');
    assert.strictEqual(result.status, 'submitClicked', 'Status must be submitClicked');
    assert.strictEqual(result.metadata?.backgroundFocusFree, true, 'Metadata should be passed through');
    assert.ok(dispatchDuration < 2000, `Dispatch should succeed via reconnect loop (took ${dispatchDuration}ms)`);

    console.log(`  -> Passed: dispatchTier1 auto-reconnected and completed focus-free in ${dispatchDuration}ms.`);

    // ----------------------------------------------------------------------
    // Test 4: Dispatcher Auto-Reconnect Failure Handling (0 clients permanent)
    // ----------------------------------------------------------------------
    console.log('\n[Test 4] Verifying dispatchTier1 failure handling when 0 clients connect...');

    (testServer as any).clients.clear();
    let dispatchFailed = false;
    try {
      await dispatcher.dispatchTier1('Should fail with 0 clients', {
        mode: 'domBridge',
        timeoutMs: 500
      });
    } catch (err: any) {
      dispatchFailed = true;
      assert.ok(
        err.message.includes('DOM Bridge has no active connected clients'),
        `Error message must indicate no active clients: ${err.message}`
      );
    }
    assert.strictEqual(dispatchFailed, true, 'dispatchTier1 should reject when no clients are available');

    console.log('  -> Passed: Permanent absence of clients correctly rejected after auto-reconnect retry.');

    // ----------------------------------------------------------------------
    // Test 5: Orchestrator Pre-flight Auto-Wakeup Integration
    // ----------------------------------------------------------------------
    console.log('\n[Test 5] Verifying Orchestrator startPhases uses fast wakeup probe on preflight...');

    const tempPlanFile = path.join(tempDir, 'phase-01-fast-wakeup.md');
    fs.writeFileSync(tempPlanFile, '# Phase 1: Fast Wakeup Test\nContent', 'utf8');

    const orchDispatcher = new PromptDispatcher({
      bridgeServer: testServer
    });

    const orchestrator = new Orchestrator({
      promptDispatcher: orchDispatcher,
      configProvider: () => ({
        executionMode: 'domBridge',
        allowTierFallback: false,
        repeatCount: 1,
        completionKeyword: 'Done skul9x.',
        delayBetweenLoopsMs: 10,
        timeoutPerLoopMinutes: 1,
        focusDelayMs: 100,
        bridgeTimeoutMs: 2000,
        staleClientMs: 120000,
        autoApprovePermissions: true,
        autoInjectWorkbench: true,
        suppressFallbackWarnings: true,
        defaultPromptTemplate: '',
        promptTemplate: '',
        promptText: 'Test prompt',
        defaultPlanFolder: ''
      })
    });

    // Background client wakes up 50ms into startPhases
    setTimeout(() => {
      httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/autoplan-status?windowKey=win_fast_probe_test&probe=1',
        method: 'GET'
      }).catch(() => {});
    }, 50);

    // Set up transcript watcher mock response for orchestrator
    (orchestrator as any).transcriptWatcher = {
      waitForNewConversation: async () => 'conv_test_123',
      watchFile: async () => ({ success: true, conversationId: 'conv_test_123' }),
      watchLatest: async () => ({ success: true, conversationId: 'conv_test_123' }),
      getOptions: () => ({ brainDir: tempDir, pollIntervalMs: 50 }),
      stop: () => {}
    };

    // Client responds to command during phase execution
    const intervalPoll = setInterval(async () => {
      try {
        const poll = await httpRequest({
          hostname: '127.0.0.1',
          port,
          path: '/autoplan-status?windowKey=win_fast_probe_test',
          method: 'GET'
        });
        if (poll.body && Array.isArray(poll.body.pendingCommands) && poll.body.pendingCommands.length > 0) {
          for (const c of poll.body.pendingCommands) {
            await httpRequest(
              {
                hostname: '127.0.0.1',
                port,
                path: '/autoplan-ack',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              },
              { commandId: c.id, status: 'completed', windowKey: 'win_fast_probe_test' }
            );
          }
        }
      } catch {}
    }, 50);

    const orchRunResult = await orchestrator.startPhases([tempPlanFile]);
    clearInterval(intervalPoll);

    assert.strictEqual(orchRunResult, true, 'Orchestrator startPhases should succeed with fast wakeup');
    assert.strictEqual(orchestrator.getState(), 'completed', 'Orchestrator state should be completed');

    console.log('  -> Passed: Orchestrator seamlessly woke up background client and executed phases.');

    await testServer.stop();

    console.log('\n==================================================================================');
    console.log('✅ ALL PHASE 02 SHARED SERVER SINGLETON & FAST AUTO-WAKEUP TESTS PASSED!');
    console.log('==================================================================================\n');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase02FastReconnectDispatcherTests().catch((err) => {
  console.error('Phase 02 Test Suite Failed:', err);
  process.exit(1);
});
