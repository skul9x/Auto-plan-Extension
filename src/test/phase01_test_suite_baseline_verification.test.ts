// Standalone mock for 'vscode' module when executed directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (_section: string) => ({
          get: (key: string, defaultValue: any) =>
            mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            mockConfigStore[key] = val;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        workspaceFolders: []
      },
      commands: {
        executeCommand: async (_cmd: string, ..._args: any[]) => undefined,
        getCommands: async (_internal?: boolean) => [
          'antigravity.startNewConversation',
          'antigravity.addContext',
          'antigravity.triggerSend',
          'antigravity.prioritized.chat.stop',
          'workbench.action.chat.stop'
        ]
      },
      window: {
        showWarningMessage: (_msg: string) => undefined,
        showInformationMessage: async () => {},
        showErrorMessage: async () => {}
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PromptDispatcher, DispatchReadinessResult } from '../promptDispatcher';
import { BridgeServer } from '../bridgeServer';
import { KeyboardManager } from '../keyboardManager';
import { DebugLogger } from '../debugLogger';
import { runPhase04RegressionTests } from './phase04_telegram_rich_formatting_regression.test';

async function runPhase01BaselineVerification() {
  console.log('======================================================================');
  console.log('🧪 Phase 01: Test Suite Baseline Verification');
  console.log('======================================================================\n');

  const rootDir = path.resolve(__dirname, '..', '..');
  const pkgJsonPath = path.join(rootDir, 'package.json');
  const logger = new DebugLogger(50);

  let passedTests = 0;
  let totalTests = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    totalTests++;
    process.stdout.write(`  [Test ${totalTests}] ${name} ... `);
    try {
      await fn();
      console.log('✓ PASS');
      passedTests++;
    } catch (err: any) {
      console.log('✗ FAIL');
      console.error(err);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Target 1: Validate package.json version matches release version 1.7.4
  // -------------------------------------------------------------------------
  console.log('--- 1. Package Manifest Validation ---');

  await test('package.json exists and declares expected v1.7.4 release version', () => {
    assert.ok(fs.existsSync(pkgJsonPath), 'package.json must exist');
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    assert.strictEqual(pkg.name, 'antigravity-auto-plan', 'Package name must match extension identity');
    assert.strictEqual(pkg.version, '1.7.4', 'Package version must strictly be 1.7.4');
    assert.strictEqual(pkg.main, './out/extension.js', 'Main entry must point to ./out/extension.js');
    assert.ok(pkg.engines && pkg.engines.vscode, 'vscode engine requirement must be defined');
  });

  // -------------------------------------------------------------------------
  // Target 2: Validate PromptDispatcher readiness reporting
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Dispatcher Readiness Negative & Positive Invariants ---');

  await test('validateDispatchReadiness returns ready === false when native chat capability is unavailable', () => {
    const emptyBridgeServer = new BridgeServer({ portStart: 49350, portEnd: 49360, windowKey: 'verify-unready-win' });
    const mockKmNoXdotool = new KeyboardManager();
    mockKmNoXdotool.checkLinuxKeyboardPrerequisites = () => ({
      available: false,
      binary: null,
      error: 'xdotool missing'
    });

    const unreadyDispatcher = new PromptDispatcher({
      bridgeServer: emptyBridgeServer,
      keyboardManager: mockKmNoXdotool,
      commandExecutor: null as any,
      logger
    });

    const tStart = process.hrtime.bigint();
    const result: DispatchReadinessResult = unreadyDispatcher.validateDispatchReadiness('linux');
    const durationMs = Number(process.hrtime.bigint() - tStart) / 1_000_000;

    assert.strictEqual(result.ready, false, 'Pre-flight check must return ready === false when native dispatch is unavailable');
    assert.strictEqual(result.selectedTier, 'nativeCommand', 'selectedTier must remain nativeCommand');
    assert.strictEqual(result.engine, 'Native Antigravity Dispatch', 'Engine must report Native Antigravity Dispatch');
    assert.ok(result.errorMessage, 'Error message must be populated on negative readiness');
    assert.ok(durationMs < 100, `Readiness evaluation must complete within 100ms (took ${durationMs.toFixed(2)}ms)`);
  });

  await test('validateDispatchReadiness returns ready === true when native chat capability is available', () => {
    const readyDispatcher = new PromptDispatcher({
      commandExecutor: async () => undefined,
      logger
    });

    const result: DispatchReadinessResult = readyDispatcher.validateDispatchReadiness('linux');
    assert.strictEqual(result.ready, true, 'Readiness must return true when native executor is available');
    assert.strictEqual(result.selectedTier, 'nativeCommand', 'selectedTier must be nativeCommand');
    assert.strictEqual(result.engine, 'Native Antigravity Dispatch', 'Engine must identify as Native Antigravity Dispatch');
    assert.strictEqual(result.isFocusFree, true, 'Native dispatch must be focus-free');
    assert.strictEqual(result.requiresForegroundFocus, false, 'Native dispatch must not require foreground focus');
    assert.strictEqual(result.details.nativeCommandsAvailable, true, 'nativeCommandsAvailable detail must be true');
  });

  // -------------------------------------------------------------------------
  // Target 3: Full execution of phase04 formatting regression test suite
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Phase 04 Regression Test Suite Execution ---');

  await test('Phase 04 telegram rich formatting regression suite executes with 0 failures', async () => {
    await runPhase04RegressionTests();
  });

  console.log('\n======================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} PHASE 01 BASELINE VERIFICATION TESTS PASSED CLEANLY!`);
  console.log('======================================================================\n');
}

if (require.main === module) {
  runPhase01BaselineVerification()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ Phase 01 Baseline Verification Failed:', err);
      process.exit(1);
    });
}

export { runPhase01BaselineVerification };

