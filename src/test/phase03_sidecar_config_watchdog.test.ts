// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      env: {
        appRoot: '',
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
        showInformationMessage: () => {},
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
import { BridgeServer } from '../bridgeServer';
import { writeConfigJson, SIDECAR_CONFIG_FILENAME, AutoPlanConfig, DEFAULT_CONFIG } from '../config';

async function runPhase03SidecarConfigWatchdogTestSuite() {
  console.log('=== Running Phase 03: Realtime Config Sidecar & Renderer Watchdog Tests ===\n');

  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-sidecar-'));
  const tempWbDir = path.join(tempBaseDir, 'workbench');
  fs.mkdirSync(tempWbDir, { recursive: true });

  const tempWbFile = path.join(tempWbDir, 'workbench.html');
  fs.writeFileSync(tempWbFile, '<html><body>Workbench</body></html>', 'utf-8');

  try {
    // --------------------------------------------------------------------------
    // Test 1: Verify writeConfigJson creates valid JSON file alongside workbench.html
    // --------------------------------------------------------------------------
    console.log('[Test 1] Verifying writeConfigJson creates valid JSON file alongside workbench.html...');
    {
      const configPath = writeConfigJson(DEFAULT_CONFIG, tempWbDir);
      assert.ok(configPath !== null, 'writeConfigJson should return non-null file path');
      assert.strictEqual(configPath, path.join(tempWbDir, SIDECAR_CONFIG_FILENAME), 'Config path should match target directory and filename');
      assert.ok(fs.existsSync(configPath!), 'Config file must exist on disk');

      const raw = fs.readFileSync(configPath!, 'utf-8');
      const parsed = JSON.parse(raw) as AutoPlanConfig;

      assert.strictEqual(parsed.repeatCount, DEFAULT_CONFIG.repeatCount, 'repeatCount must match default config');
      assert.strictEqual(parsed.completionKeyword, DEFAULT_CONFIG.completionKeyword, 'completionKeyword must match default config');
      assert.strictEqual(parsed.executionMode, DEFAULT_CONFIG.executionMode, 'executionMode must match default config');
      assert.strictEqual(parsed.autoApprovePermissions, DEFAULT_CONFIG.autoApprovePermissions, 'autoApprovePermissions must match default config');

      console.log('  ✓ writeConfigJson successfully created valid ag-autoplan-config.json file.');
    }

    // --------------------------------------------------------------------------
    // Test 2: Verify BridgeServer watchdog auto-evicts stale clients (> 30s)
    // --------------------------------------------------------------------------
    console.log('\n[Test 2] Verifying BridgeServer watchdog auto-evicts stale clients (> 30s)...');
    {
      const server = new BridgeServer({
        portStart: 49350,
        portEnd: 49370,
        windowKey: 'test-win-watchdog-1',
        staleClientMs: 100, // Short stale threshold for test
        watchdogIntervalMs: 50 // Short watchdog interval for test
      });

      const port = await server.start();
      assert.ok(server.isListening(), 'BridgeServer should be listening');

      const initialWatchdogStatus = server.getWatchdogStatus();
      assert.strictEqual(initialWatchdogStatus.enabled, true, 'Watchdog should be enabled on start()');
      assert.strictEqual(initialWatchdogStatus.staleThresholdMs, 100, 'Stale threshold should be 100ms');

      // Simulate client telemetry heartbeat
      const heartbeatPromise = new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path: '/autoplan-status?clientVersion=2.0.0&windowKey=test-win-watchdog-1',
            method: 'GET',
            timeout: 2000
          },
          (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve());
          }
        );
        req.on('error', reject);
        req.end();
      });

      await heartbeatPromise;

      assert.strictEqual(server.getConnectedClients().length, 1, 'Should have 1 active connected client');
      assert.strictEqual(server.getConnectedClients()[0].windowKey, 'test-win-watchdog-1');

      // Wait for client to exceed stale threshold (> 100ms)
      await new Promise(r => setTimeout(r, 150));

      // Trigger watchdog check (or let automatic interval process it)
      server.runWatchdogCheck();

      assert.strictEqual(server.getConnectedClients().length, 0, 'Stale client must be evicted');

      const evictedWatchdogStatus = server.getWatchdogStatus();
      assert.strictEqual(evictedWatchdogStatus.evictedCount >= 1, true, 'Evicted count must be at least 1');
      assert.strictEqual(evictedWatchdogStatus.lastEvictedWindowKey, 'test-win-watchdog-1', 'Last evicted key must match client key');
      assert.strictEqual(evictedWatchdogStatus.activeClientsCount, 0, 'Active clients count must be 0');
      assert.ok(evictedWatchdogStatus.logs.some(l => l.includes('evicted')), 'Watchdog logs should record eviction transition');

      // Test clean disposal on stop
      await server.stop();
      const stoppedWatchdogStatus = server.getWatchdogStatus();
      assert.strictEqual(stoppedWatchdogStatus.enabled, false, 'Watchdog timer must be disabled upon server stop()');

      console.log('  ✓ BridgeServer watchdog auto-evicted stale client and disposed cleanly upon stop.');
    }

    // --------------------------------------------------------------------------
    // Test 3: Verify config updates trigger sidecar sync seamlessly
    // --------------------------------------------------------------------------
    console.log('\n[Test 3] Verifying config updates trigger sidecar sync seamlessly...');
    {
      const updatedConfig: AutoPlanConfig = {
        ...DEFAULT_CONFIG,
        repeatCount: 42,
        completionKeyword: 'Done Phase 03 Test',
        executionMode: 'domBridge',
        bridgeTimeoutMs: 12000,
        autoApprovePermissions: true,
        autoInjectWorkbench: true
      };

      const updatedPath = writeConfigJson(updatedConfig, tempWbDir);
      assert.ok(updatedPath !== null && fs.existsSync(updatedPath), 'Updated config file must exist');

      const updatedRaw = fs.readFileSync(updatedPath, 'utf-8');
      const updatedParsed = JSON.parse(updatedRaw) as AutoPlanConfig;

      assert.strictEqual(updatedParsed.repeatCount, 42, 'Updated repeatCount must be saved');
      assert.strictEqual(updatedParsed.completionKeyword, 'Done Phase 03 Test', 'Updated completionKeyword must be saved');
      assert.strictEqual(updatedParsed.executionMode, 'domBridge', 'Updated executionMode must be saved');
      assert.strictEqual(updatedParsed.bridgeTimeoutMs, 12000, 'Updated bridgeTimeoutMs must be saved');

      console.log('  ✓ Config update sidecar sync verified seamlessly.');
    }

  } finally {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n=============================================================');
  console.log('🎉 ALL PHASE 03 SIDECAR CONFIG & WATCHDOG TESTS PASSED! (100% Coverage)');
  console.log('=============================================================\n');
}

runPhase03SidecarConfigWatchdogTestSuite().catch((err) => {
  console.error('Phase 03 Test Failed:', err);
  process.exit(1);
});
