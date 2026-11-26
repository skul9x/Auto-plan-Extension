// Standalone mock for 'vscode' module without commands.getCommands
// so legacy unit-mock compatibility (Scenario 4) can be verified cleanly.
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue,
          update: async () => undefined
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        workspaceFolders: []
      },
      commands: {
        executeCommand: async () => undefined
      },
      window: {
        showWarningMessage: () => undefined,
        showInformationMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        createOutputChannel: () => ({
          appendLine: () => {},
          show: () => {},
          clear: () => {},
          dispose: () => {}
        })
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import { PromptDispatcher } from '../promptDispatcher';
import { DebugLogger } from '../debugLogger';

async function runPhase03Tests() {
  console.log('================================================================');
  console.log(' Phase 03: Native Chat Stop Command Discovery Test');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    total++;
    process.stdout.write(`  Test ${total}: ${name} ... `);
    try {
      await fn();
      console.log('✓ PASS');
      passed++;
    } catch (err) {
      console.log('✗ FAIL');
      console.error(err);
      throw err;
    }
  }

  // Scenario 1: Dynamic Candidate Selection When Primary Commands Missing
  await test('Dynamic candidate selection executes registered antigravity.agent.stop without failed calls', async () => {
    const logger = new DebugLogger(100);
    const executed: string[] = [];
    let providerCalls = 0;

    const dispatcher = new PromptDispatcher({
      logger,
      commandListProvider: async () => {
        providerCalls++;
        return ['antigravity.agent.stop', 'workbench.action.chat.cancel'];
      },
      commandExecutor: async (cmd: string) => {
        executed.push(cmd);
        return undefined;
      }
    });

    const result = await dispatcher.stopActiveGeneration();
    assert.strictEqual(result, true, 'stopActiveGeneration must return true');
    assert.deepStrictEqual(executed, ['antigravity.agent.stop'], 'Must execute antigravity.agent.stop immediately');
    assert.strictEqual(providerCalls, 1, 'commandListProvider should be called once');

    // Second call within TTL uses cache
    const resultCached = await dispatcher.stopActiveGeneration();
    assert.strictEqual(resultCached, true);
    assert.strictEqual(providerCalls, 1, 'commandListProvider must be cached within TTL');

    const warnLogs = logger.getEntries().filter(l => l.level === 'WARN');
    assert.strictEqual(warnLogs.length, 0, 'Must emit zero WARN logs');
  });

  // Scenario 2: Zero Registered Stop Commands Graceful No-Warn Handling
  await test('Zero registered stop commands returns false gracefully with zero WARN logs', async () => {
    const logger = new DebugLogger(100);
    const executed: string[] = [];

    const dispatcher = new PromptDispatcher({
      logger,
      commandListProvider: async () => ['workbench.action.files.save', 'editor.action.formatDocument'],
      commandExecutor: async (cmd: string) => {
        executed.push(cmd);
        return undefined;
      }
    });

    const result = await dispatcher.stopActiveGeneration();
    assert.strictEqual(result, false, 'stopActiveGeneration must return false when no stop commands exist');
    assert.strictEqual(executed.length, 0, 'commandExecutor must be called 0 times');

    const warnLogs = logger.getEntries().filter(l => l.level === 'WARN');
    assert.strictEqual(warnLogs.length, 0, 'Must emit zero WARN logs');

    const infoLogs = logger.getEntries().filter(
      l => l.level === 'INFO' && l.message.includes('No host chat stop command registered')
    );
    assert.strictEqual(infoLogs.length, 1, 'Must log clean INFO message');
  });

  // Scenario 3: Command Priority + Fallback on Registered Execution Failure + Cache Invalidation
  await test('Falls back to next registered stop command when primary registered command rejects', async () => {
    const logger = new DebugLogger(100);
    const executed: string[] = [];
    let providerCalls = 0;

    const dispatcher = new PromptDispatcher({
      logger,
      commandListProvider: async () => {
        providerCalls++;
        return ['antigravity.prioritized.chat.stop', 'workbench.action.chat.cancel'];
      },
      commandExecutor: async (cmd: string) => {
        executed.push(cmd);
        if (cmd === 'antigravity.prioritized.chat.stop') {
          throw new Error("command 'antigravity.prioritized.chat.stop' not found");
        }
        return undefined;
      }
    });

    const result = await dispatcher.stopActiveGeneration();
    assert.strictEqual(result, true, 'stopActiveGeneration must return true via fallback');
    assert.deepStrictEqual(
      executed,
      ['antigravity.prioritized.chat.stop', 'workbench.action.chat.cancel'],
      'Must try prioritized stop then fall back to workbench.action.chat.cancel'
    );

    // Since primary threw 'not found', cache must have been invalidated so next call re-queries provider
    await dispatcher.stopActiveGeneration();
    assert.strictEqual(providerCalls, 2, 'Cache must be invalidated when executeCommand throws not found');
  });

  // Scenario 4: Legacy Unit-Mock Compatibility (No commandListProvider, no vscode.commands.getCommands)
  await test('Legacy unit-mock compatibility invokes antigravity.prioritized.chat.stop directly', async () => {
    const logger = new DebugLogger(100);
    const executed: string[] = [];

    const dispatcher = new PromptDispatcher({
      logger,
      commandExecutor: async (cmd: string) => {
        executed.push(cmd);
        return undefined;
      }
    });

    const result = await dispatcher.stopActiveGeneration();
    assert.strictEqual(result, true, 'Legacy stopActiveGeneration must return true');
    assert.deepStrictEqual(
      executed,
      ['antigravity.prioritized.chat.stop'],
      'Must invoke antigravity.prioritized.chat.stop directly'
    );
  });

  console.log(`\nPassed ${passed}/${total} Phase 03 tests.`);
}

runPhase03Tests()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
