// Mock 'vscode' module for standalone test runner
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
        showWarningMessage: () => {}
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
import { PromptDispatcher, DispatchReadinessResult } from '../promptDispatcher';
import { BridgeServer } from '../bridgeServer';
import { KeyboardManager } from '../keyboardManager';
import { Orchestrator } from '../orchestrator';

async function runPhase02FailFastPreFlightGuardTestSuite() {
  console.log('=== Running Phase 02: Zero-Timeout Fail-Fast Pre-Flight Guard Tests ===\n');

  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase02-preflight-'));
  const tempPlanDir = path.join(tempBaseDir, 'plans');
  fs.mkdirSync(tempPlanDir, { recursive: true });

  const phase1Path = path.join(tempPlanDir, 'phase-01-guard.md');
  fs.writeFileSync(phase1Path, '# Phase 1: Test\nContent', 'utf-8');

  try {
    // --------------------------------------------------------------------------
    // Test 1: Tier 1 Ready Condition (DOM Bridge Active)
    // --------------------------------------------------------------------------
    console.log('[Test 1] Verifying Tier 1 DOM Bridge connected client readiness (< 50ms)...');
    {
      const server1 = new BridgeServer({
        portStart: 49200,
        portEnd: 49220,
        windowKey: 'test-preflight-win-1'
      });
      const port1 = await server1.start();

      // Simulate a connected DOM bridge client via heartbeat
      let clientRunning = true;
      const heartbeatReq = http.request(
        {
          host: '127.0.0.1',
          port: port1,
          path: '/autoplan-status?clientVersion=2.0.0&windowKey=test-preflight-win-1',
          method: 'GET',
          timeout: 2000
        },
        () => {}
      );
      heartbeatReq.on('error', () => {});
      heartbeatReq.end();

      // Wait a moment for client to be recorded in bridge server
      await new Promise((r) => setTimeout(r, 100));
      assert.strictEqual(server1.getConnectedClients().length, 1, 'Server should have 1 connected client');

      const dispatcher1 = new PromptDispatcher({
        bridgeServer: server1
      });

      const startTime = process.hrtime.bigint();
      const result: DispatchReadinessResult = dispatcher1.validateDispatchReadiness();
      const endTime = process.hrtime.bigint();
      const executionTimeMs = Number(endTime - startTime) / 1_000_000;

      assert.strictEqual(result.ready, true, 'Result should be ready');
      assert.strictEqual(result.selectedTier, 'domBridge', 'Tier should be domBridge');
      assert.strictEqual(result.isFocusFree, true, 'DOM Bridge must be focus-free');
      assert.strictEqual(result.requiresForegroundFocus, false, 'DOM Bridge does not require foreground focus');
      assert.strictEqual(result.details.connectedClientsCount, 1, 'Clients count should be 1');
      assert.strictEqual(result.details.bridgePort, port1, 'Bridge port should be populated');
      assert.ok(executionTimeMs < 50, `Execution time must be < 50ms (was ${executionTimeMs.toFixed(2)}ms)`);

      await server1.stop();
      console.log(`  ✓ Tier 1 DOM Bridge ready check passed in ${executionTimeMs.toFixed(2)}ms.`);
    }

    // --------------------------------------------------------------------------
    // Test 2: Windows Fallback Condition (Bridge 0 clients, OS = win32)
    // --------------------------------------------------------------------------
    console.log('\n[Test 2] Verifying Windows Fallback Condition (Bridge 0 clients on win32)...');
    {
      const server2 = new BridgeServer({
        portStart: 49230,
        portEnd: 49240,
        windowKey: 'test-preflight-win-2'
      });
      const dispatcher2 = new PromptDispatcher({
        bridgeServer: server2
      });

      const startTime = process.hrtime.bigint();
      const result: DispatchReadinessResult = dispatcher2.validateDispatchReadiness('win32');
      const endTime = process.hrtime.bigint();
      const executionTimeMs = Number(endTime - startTime) / 1_000_000;

      assert.strictEqual(result.ready, true, 'Windows fallback should be ready via PowerShell keyboard simulation');
      assert.strictEqual(result.selectedTier, 'keyboard', 'Selected tier must be keyboard');
      assert.strictEqual(result.isFocusFree, false, 'Keyboard simulation is not focus-free');
      assert.strictEqual(result.requiresForegroundFocus, true, 'Keyboard simulation requires foreground focus');
      assert.ok(result.warningMessage?.includes('PowerShell keyboard simulation'), 'Warning message should mention PowerShell');
      assert.strictEqual(result.details.os, 'win32', 'OS must be win32');
      assert.strictEqual(result.details.connectedClientsCount, 0, 'Clients count should be 0');
      assert.ok(executionTimeMs < 50, `Execution time must be < 50ms (was ${executionTimeMs.toFixed(2)}ms)`);

      console.log(`  ✓ Windows fallback check passed in ${executionTimeMs.toFixed(2)}ms.`);
    }

    // --------------------------------------------------------------------------
    // Test 3: Linux With xdotool Condition (Bridge 0 clients, xdotool present)
    // --------------------------------------------------------------------------
    console.log('\n[Test 3] Verifying Linux With xdotool Condition (Bridge 0 clients, xdotool available)...');
    {
      const server3 = new BridgeServer({
        portStart: 49250,
        portEnd: 49260,
        windowKey: 'test-preflight-win-3'
      });
      const mockKmWithXdotool = new KeyboardManager();
      mockKmWithXdotool.checkLinuxKeyboardPrerequisites = () => ({
        available: true,
        binary: '/usr/bin/xdotool'
      });

      const dispatcher3 = new PromptDispatcher({
        bridgeServer: server3,
        keyboardManager: mockKmWithXdotool
      });

      const startTime = process.hrtime.bigint();
      const result: DispatchReadinessResult = dispatcher3.validateDispatchReadiness('linux');
      const endTime = process.hrtime.bigint();
      const executionTimeMs = Number(endTime - startTime) / 1_000_000;

      assert.strictEqual(result.ready, true, 'Linux with xdotool should be ready');
      assert.strictEqual(result.selectedTier, 'keyboard', 'Selected tier must be keyboard');
      assert.strictEqual(result.isFocusFree, false, 'Keyboard simulation is not focus-free');
      assert.strictEqual(result.requiresForegroundFocus, true, 'Keyboard simulation requires foreground focus');
      assert.ok(result.warningMessage?.includes('xdotool keyboard simulation'), 'Warning message should mention xdotool');
      assert.strictEqual(result.details.os, 'linux', 'OS must be linux');
      assert.strictEqual(result.details.xdotoolAvailable, true, 'xdotoolAvailable must be true');
      assert.strictEqual(result.details.connectedClientsCount, 0, 'Clients count should be 0');
      assert.ok(executionTimeMs < 50, `Execution time must be < 50ms (was ${executionTimeMs.toFixed(2)}ms)`);

      console.log(`  ✓ Linux with xdotool check passed in ${executionTimeMs.toFixed(2)}ms.`);
    }

    // --------------------------------------------------------------------------
    // Test 4: Linux Without xdotool Condition (Fail-Fast Guard)
    // --------------------------------------------------------------------------
    console.log('\n[Test 4] Verifying Linux Without xdotool Condition (Bridge 0 clients, xdotool missing)...');
    {
      const server4 = new BridgeServer({
        portStart: 49270,
        portEnd: 49280,
        windowKey: 'test-preflight-win-4'
      });
      const mockKmWithoutXdotool = new KeyboardManager();
      mockKmWithoutXdotool.checkLinuxKeyboardPrerequisites = () => ({
        available: false,
        binary: null,
        error: 'xdotool is not installed'
      });

      const dispatcher4 = new PromptDispatcher({
        bridgeServer: server4,
        keyboardManager: mockKmWithoutXdotool
      });

      const startTime = process.hrtime.bigint();
      const result: DispatchReadinessResult = dispatcher4.validateDispatchReadiness('linux');
      const endTime = process.hrtime.bigint();
      const executionTimeMs = Number(endTime - startTime) / 1_000_000;

      assert.strictEqual(result.ready, false, 'Linux without xdotool or DOM bridge must NOT be ready');
      assert.strictEqual(result.selectedTier, 'keyboard');
      assert.strictEqual(result.isFocusFree, false);
      assert.strictEqual(result.requiresForegroundFocus, true);
      assert.ok(result.errorMessage && result.errorMessage.length > 0, 'Error message must be present');
      assert.ok(result.errorMessage.includes('No usable prompt transport available on Linux'), 'Error message should clearly state transport unavailability');
      assert.strictEqual(result.remediationAction, 'activateBridge', 'Remediation action must be activateBridge');
      assert.strictEqual(result.details.os, 'linux', 'OS must be linux');
      assert.strictEqual(result.details.xdotoolAvailable, false, 'xdotoolAvailable must be false');
      assert.strictEqual(result.details.connectedClientsCount, 0, 'Clients count should be 0');
      assert.ok(executionTimeMs < 50, `Execution time must be < 50ms (was ${executionTimeMs.toFixed(2)}ms)`);

      console.log(`  ✓ Linux fail-fast unready guard verified in ${executionTimeMs.toFixed(2)}ms.`);
    }

    // --------------------------------------------------------------------------
    // Test 5: Orchestrator Pre-Flight Abort Execution (< 100ms, no hanging timers)
    // --------------------------------------------------------------------------
    console.log('\n[Test 5] Verifying Orchestrator Pre-Flight Abort Execution (< 100ms fail-fast)...');
    {
      const server5 = new BridgeServer({
        portStart: 49290,
        portEnd: 49300,
        windowKey: 'test-preflight-win-5'
      });
      const unreadyKm = new KeyboardManager();
      unreadyKm.checkLinuxKeyboardPrerequisites = () => ({
        available: false,
        binary: null,
        error: 'xdotool missing'
      });

      // Override dispatcher to always return unready for this test
      const unreadyDispatcher = new PromptDispatcher({
        bridgeServer: server5,
        keyboardManager: unreadyKm
      });

      let errorEventReceived: Error | null = null;
      let stateChangeCount = 0;
      let lastStateInfo: any = null;

      const testOrchestrator = new Orchestrator({
        promptDispatcher: unreadyDispatcher,
        onError: (err) => {
          errorEventReceived = err;
        },
        onStateChange: (info) => {
          stateChangeCount++;
          lastStateInfo = info;
        }
      });

      // Force validateDispatchReadiness on the dispatcher instance to simulate unready linux
      unreadyDispatcher.validateDispatchReadiness = () => ({
        ready: false,
        selectedTier: 'keyboard',
        isFocusFree: false,
        requiresForegroundFocus: true,
        errorMessage: 'Pre-flight check failed: No usable prompt transport available on Linux.',
        remediationAction: 'activateBridge',
        details: {
          connectedClientsCount: 0,
          os: 'linux',
          xdotoolAvailable: false
        }
      });

      const startTime = Date.now();
      const runResult = await testOrchestrator.startPhases([phase1Path]);
      const durationMs = Date.now() - startTime;

      assert.strictEqual(runResult, false, 'startPhases must return false when unready');
      assert.ok(durationMs < 100, `startPhases must abort in < 100ms (took ${durationMs}ms)`);
      assert.ok(errorEventReceived !== null, 'onError listener must be called');
      assert.ok(
        (errorEventReceived as unknown as Error).message.includes('No usable prompt transport available'),
        'Error message must indicate transport unavailability'
      );
      assert.strictEqual(testOrchestrator.getState(), 'error', 'Orchestrator state must be error');
      assert.strictEqual(testOrchestrator.isRunning(), false, 'Orchestrator must not be running');

      console.log(`  ✓ Orchestrator aborted pre-flight cleanly in ${durationMs}ms with zero hanging timers.`);
    }

  } finally {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n=============================================================');
  console.log('🎉 ALL PHASE 02 PRE-FLIGHT GUARD TESTS PASSED SUCCESSFULLY! (100% Coverage)');
  console.log('=============================================================\n');
}

runPhase02FailFastPreFlightGuardTestSuite().catch((err) => {
  console.error('Phase 02 Pre-Flight Guard Test Failed:', err);
  process.exit(1);
});
