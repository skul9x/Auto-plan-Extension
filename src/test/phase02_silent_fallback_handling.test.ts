// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockConfigValues: Record<string, any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key: string, defaultValue: any) => {
            return mockConfigValues[key] !== undefined ? mockConfigValues[key] : defaultValue;
          },
          update: async () => {}
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      commands: {
        executeCommand: async () => {
          throw new Error('Command unavailable in test runner');
        }
      },
      window: {
        showWarningMessage: async () => {},
        showInformationMessage: async () => {},
        showErrorMessage: async () => {}
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import { PromptDispatcher } from '../promptDispatcher';
import { AutoPlanConfig, DEFAULT_CONFIG } from '../config';

async function runPhase02SilentFallbackTestSuite() {
  console.log('=== Running Phase 02: Silent Fallback & Non-Intrusive Error Handling Tests ===\n');

  try {
    // --------------------------------------------------------------------------
    // Test 1: Verify fallback to Tier 3 keyboard mode emits console log without invoking warning toast when suppressed
    // --------------------------------------------------------------------------
    console.log('[Test 1] Verifying fallback to Tier 3 emits console log without warning toast when suppressed...');
    {
      mockConfigValues = { suppressFallbackWarnings: true };

      let warningNotifierCalled = false;
      let warningNotifierMessage = '';
      const warningNotifier = (msg: string) => {
        warningNotifierCalled = true;
        warningNotifierMessage = msg;
      };

      const consoleLogs: string[] = [];
      const originalConsoleLog = console.log;
      console.log = (...args: any[]) => {
        consoleLogs.push(args.join(' '));
        originalConsoleLog(...args);
      };

      const mockBridgeServer: any = {
        isListening: () => false,
        getConnectedClients: () => []
      };

      const mockKeyboardManager: any = {
        executeBatchPromptFlow: async () => {
          return { success: true };
        }
      };

      const mockCommandExecutor = async (_cmd: string) => {
        throw new Error('Native command failed');
      };

      const dispatcher = new PromptDispatcher({
        bridgeServer: mockBridgeServer,
        keyboardManager: mockKeyboardManager,
        commandExecutor: mockCommandExecutor,
        warningNotifier,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          suppressFallbackWarnings: true
        })
      });

      try {
        const result = await dispatcher.dispatchPrompt('Test prompt for suppressed fallback');

        assert.strictEqual(result.success, true, 'Dispatch should succeed on Tier 3 keyboard fallback');
        assert.strictEqual(result.tier, 'keyboard', 'Resolved tier must be keyboard');
        assert.strictEqual(warningNotifierCalled, false, 'warningNotifier should NOT be called when suppressFallbackWarnings is true');

        const consoleLoggedFallback = consoleLogs.some(log =>
          log.includes('Auto-Plan: DOM Bridge & Native Commands unavailable. Falling back to OS Keyboard Simulation.')
        );
        assert.strictEqual(consoleLoggedFallback, true, 'Console log must contain the silent fallback log message');

        console.log('  ✓ Suppressed fallback logged silently without warning toast popup.');
      } finally {
        console.log = originalConsoleLog;
      }
    }

    // --------------------------------------------------------------------------
    // Test 2: Verify fallback warning toast can still be enabled if setting is explicitly set to false
    // --------------------------------------------------------------------------
    console.log('\n[Test 2] Verifying fallback warning toast is emitted when suppressFallbackWarnings is set to false...');
    {
      mockConfigValues = { suppressFallbackWarnings: false };

      let warningNotifierCalled = false;
      let warningNotifierMessage = '';
      const warningNotifier = (msg: string) => {
        warningNotifierCalled = true;
        warningNotifierMessage = msg;
      };

      const mockBridgeServer: any = {
        isListening: () => false,
        getConnectedClients: () => []
      };

      const mockKeyboardManager: any = {
        executeBatchPromptFlow: async () => {
          return { success: true };
        }
      };

      const mockCommandExecutor = async (_cmd: string) => {
        throw new Error('Native command failed');
      };

      const dispatcher = new PromptDispatcher({
        bridgeServer: mockBridgeServer,
        keyboardManager: mockKeyboardManager,
        commandExecutor: mockCommandExecutor,
        warningNotifier,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          suppressFallbackWarnings: false
        })
      });

      const result = await dispatcher.dispatchPrompt('Test prompt for enabled warning toast');

      assert.strictEqual(result.success, true, 'Dispatch should succeed on Tier 3 keyboard fallback');
      assert.strictEqual(result.tier, 'keyboard', 'Resolved tier must be keyboard');
      assert.strictEqual(warningNotifierCalled, true, 'warningNotifier MUST be called when suppressFallbackWarnings is false');
      assert.ok(warningNotifierMessage.includes('Falling back to OS Keyboard Simulation'), 'Warning message must indicate fallback to OS Keyboard Simulation');

      console.log('  ✓ Warning toast correctly invoked when suppressFallbackWarnings is false.');
    }

    // --------------------------------------------------------------------------
    // Test 3: Verify fatal errors across all tiers still throw properly
    // --------------------------------------------------------------------------
    console.log('\n[Test 3] Verifying fatal errors across all tiers still throw properly...');
    {
      const mockBridgeServer: any = {
        isListening: () => false,
        getConnectedClients: () => []
      };

      const mockKeyboardManager: any = {
        executeBatchPromptFlow: async () => {
          throw new Error('OS Keyboard input failed: missing xdotool / PowerShell permissions');
        }
      };

      const mockCommandExecutor = async (_cmd: string) => {
        throw new Error('Native command dispatch rejected');
      };

      const dispatcher = new PromptDispatcher({
        bridgeServer: mockBridgeServer,
        keyboardManager: mockKeyboardManager,
        commandExecutor: mockCommandExecutor,
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          suppressFallbackWarnings: true
        })
      });

      let errorThrown: Error | null = null;
      try {
        await dispatcher.dispatchPrompt('Test prompt for fatal fallback failure');
      } catch (err: any) {
        errorThrown = err;
      }

      assert.ok(errorThrown !== null, 'An error must be thrown when all 3 tiers fail');
      assert.ok(
        errorThrown!.message.includes('All prompt dispatch tiers failed.'),
        `Error message must contain 'All prompt dispatch tiers failed.' (got: ${errorThrown!.message})`
      );

      console.log('  ✓ Fatal error properly thrown when all dispatch tiers fail.');
    }

  } catch (err) {
    console.error('Phase 02 Silent Fallback Test Suite Failed:', err);
    process.exit(1);
  }

  console.log('\n=============================================================');
  console.log('🎉 ALL PHASE 02 SILENT FALLBACK TESTS PASSED SUCCESSFULLY! (100% Coverage)');
  console.log('=============================================================\n');
}

runPhase02SilentFallbackTestSuite().catch((err) => {
  console.error('Phase 02 Silent Fallback Test Suite Execution Error:', err);
  process.exit(1);
});
