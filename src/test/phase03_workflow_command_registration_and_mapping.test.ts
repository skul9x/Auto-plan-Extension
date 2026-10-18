// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section: string) => ({
          get: (key: string, defaultValue: any) =>
            mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            mockConfigStore[key] = val;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        workspaceFolders: []
      },
      window: {
        activeTextEditor: undefined,
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        registerWebviewViewProvider: () => ({ dispose: () => {} }),
        showInformationMessage: async () => {},
        showWarningMessage: async () => {},
        showErrorMessage: async () => {}
      },
      commands: {
        executeCommand: async () => true
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 },
      StatusBarAlignment: { Left: 1, Right: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Bot } from 'grammy';
import {
  TelegramBridge,
  syncBotCommands,
  normalizeTelegramWorkflowCommand,
  toTelegramWorkflowCommand,
  isWorkflowCommand,
  WORKFLOW_COMMAND_CATALOG,
  MANAGEMENT_COMMAND_CATALOG,
  FULL_BOT_COMMAND_CATALOG,
  WORKFLOW_COMMAND_MAP,
  WORKFLOW_COMMAND_REVERSE_MAP,
  TelegramBotCommandItem
} from '../telegramBridge';
import { debugLogger } from '../debugLogger';

interface MockApiCall {
  method: string;
  payload: any;
  timestamp: number;
}

/**
 * Creates a mock grammY bot that records all outgoing API calls.
 */
function createMockBot(token: string = '1234567890:ABCdefGHIjklMNOpqrsTUV_testing') {
  const bot = new Bot(token, {
    botInfo: {
      id: 1234567890,
      is_bot: true,
      first_name: 'AutoPlanMockBot',
      username: 'autoplan_mock_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false
    } as any
  });

  const apiCalls: MockApiCall[] = [];
  let setMyCommandsHandler: ((payload: any) => Promise<any> | any) | null = null;

  bot.api.config.use(async (_prev, method, payload) => {
    const record: MockApiCall = {
      method,
      payload: JSON.parse(JSON.stringify(payload || {})),
      timestamp: Date.now()
    };
    apiCalls.push(record);

    if (method === 'setMyCommands') {
      if (setMyCommandsHandler) {
        return await setMyCommandsHandler(payload);
      }
      return { ok: true, result: true } as any;
    }

    return { ok: true, result: {} } as any;
  });

  return {
    bot,
    apiCalls,
    setSetMyCommandsHandler: (handler: (payload: any) => Promise<any> | any) => {
      setMyCommandsHandler = handler;
    }
  };
}

async function runPhase03Tests() {
  console.log('================================================================');
  console.log(' Phase 03: Workflow Slash Command Registration & Mapping Test');
  console.log('================================================================\n');

  const TELEGRAM_REGEX = /^[a-z0-9_]{1,32}$/;

  // ---------------------------------------------------------------------------
  // [Suite 1] Telegram API Regex & Naming Compliance
  // ---------------------------------------------------------------------------
  console.log('[Suite 1] Verifying Telegram API naming constraints & catalog specifications...');

  // 1.1 Total command count check
  assert.strictEqual(FULL_BOT_COMMAND_CATALOG.length, 27, 'Total bot commands must be exactly 27');
  assert.ok(FULL_BOT_COMMAND_CATALOG.length <= 100, 'Total commands must be <= 100 per Telegram API limitation');
  assert.strictEqual(WORKFLOW_COMMAND_CATALOG.length, 21, 'Workflow commands catalog must contain 21 items');
  assert.strictEqual(MANAGEMENT_COMMAND_CATALOG.length, 6, 'Management commands catalog must contain 6 items');

  // 1.2 Regex compliance for every single command
  for (const item of FULL_BOT_COMMAND_CATALOG) {
    assert.ok(
      TELEGRAM_REGEX.test(item.command),
      `Command '${item.command}' must strictly match ^[a-z0-9_]{1,32}$`
    );
    assert.strictEqual(
      item.command,
      item.command.toLowerCase(),
      `Command '${item.command}' must be strictly lowercase`
    );
    assert.strictEqual(
      item.command.includes('-'),
      false,
      `Command '${item.command}' must not contain hyphens (must use underscore)`
    );
    assert.ok(
      item.command.length >= 1 && item.command.length <= 32,
      `Command '${item.command}' length must be between 1 and 32 characters`
    );
    assert.ok(
      item.description && item.description.trim().length > 0,
      `Command '${item.command}' description must not be empty`
    );
    assert.ok(
      item.description.length <= 256,
      `Command '${item.command}' description must be <= 256 characters`
    );
  }

  // 1.3 Core Workflows verification
  const expectedCoreWorkflows = [
    'init', 'brainstorm', 'plan', 'design', 'visualize', 'code',
    'run', 'debug', 'test', 'audit', 'deploy', 'next', 'recap',
    'help', 'review', 'refactor', 'customize', 'rollback'
  ];
  const registeredCommandNames = new Set(FULL_BOT_COMMAND_CATALOG.map((c) => c.command));
  for (const wf of expectedCoreWorkflows) {
    assert.ok(registeredCommandNames.has(wf), `Core workflow '/${wf}' must be present in catalog`);
  }

  // 1.4 Hyphen-to-underscore workflows verification
  const expectedUnderscoreWorkflows = ['save_brain', 'awf_update', 'cloudflare_tunnel'];
  for (const wf of expectedUnderscoreWorkflows) {
    assert.ok(registeredCommandNames.has(wf), `Underscore workflow '/${wf}' must be present in catalog`);
  }

  // 1.5 Management commands verification
  const expectedManagement = ['plans', 'plan_status', 'plan_skip', 'plan_stop', 'screen', 'new_chat'];
  for (const mg of expectedManagement) {
    assert.ok(registeredCommandNames.has(mg), `Management command '/${mg}' must be present in catalog`);
  }

  // 1.6 Vietnamese localized descriptions & icons check
  const initCmd = FULL_BOT_COMMAND_CATALOG.find((c) => c.command === 'init');
  assert.ok(initCmd?.description.includes('✨'), 'init command should include sparkles icon');
  assert.ok(initCmd?.description.includes('Khởi tạo'), 'init command should include Vietnamese description');

  const saveBrainCmd = FULL_BOT_COMMAND_CATALOG.find((c) => c.command === 'save_brain');
  assert.ok(saveBrainCmd?.description.includes('🧠'), 'save_brain command should include brain icon');
  assert.ok(saveBrainCmd?.description.includes('save-brain'), 'save_brain command description should mention /save-brain mapping');

  console.log('  ✓ All 27 commands strictly comply with ^[a-z0-9_]{1,32}$ and contain localized descriptions.\n');

  // ---------------------------------------------------------------------------
  // [Suite 2] Bidirectional Normalization & Mapping
  // ---------------------------------------------------------------------------
  console.log('[Suite 2] Verifying bidirectional command normalization & mapping...');

  // 2.1 Telegram underscore to IDE hyphen normalization
  assert.strictEqual(
    normalizeTelegramWorkflowCommand('/save_brain'),
    '/save-brain',
    '/save_brain must normalize to /save-brain'
  );
  assert.strictEqual(
    normalizeTelegramWorkflowCommand('save_brain'),
    'save-brain',
    'save_brain (no slash) must normalize to save-brain'
  );
  assert.strictEqual(
    normalizeTelegramWorkflowCommand('/awf_update'),
    '/awf-update',
    '/awf_update must normalize to /awf-update'
  );
  assert.strictEqual(
    normalizeTelegramWorkflowCommand('awf_update'),
    'awf-update',
    'awf_update must normalize to awf-update'
  );
  assert.strictEqual(
    normalizeTelegramWorkflowCommand('/cloudflare_tunnel'),
    '/cloudflare-tunnel',
    '/cloudflare_tunnel must normalize to /cloudflare-tunnel'
  );
  assert.strictEqual(
    normalizeTelegramWorkflowCommand('cloudflare_tunnel'),
    'cloudflare-tunnel',
    'cloudflare_tunnel must normalize to cloudflare-tunnel'
  );

  // 2.2 Preserving trailing arguments
  assert.strictEqual(
    normalizeTelegramWorkflowCommand('/save_brain custom note about auth setup'),
    '/save-brain custom note about auth setup',
    'normalizeTelegramWorkflowCommand must preserve trailing prompt arguments'
  );
  assert.strictEqual(
    normalizeTelegramWorkflowCommand('/awf_update --check'),
    '/awf-update --check',
    'normalizeTelegramWorkflowCommand must preserve trailing arguments for awf_update'
  );
  assert.strictEqual(
    normalizeTelegramWorkflowCommand('/cloudflare_tunnel status'),
    '/cloudflare-tunnel status',
    'normalizeTelegramWorkflowCommand must preserve trailing arguments for cloudflare_tunnel'
  );

  // 2.3 Commands without hyphens remain untouched
  assert.strictEqual(normalizeTelegramWorkflowCommand('/code fix parser bug'), '/code fix parser bug');
  assert.strictEqual(normalizeTelegramWorkflowCommand('/brainstorm next feature'), '/brainstorm next feature');
  assert.strictEqual(normalizeTelegramWorkflowCommand('/plan 01'), '/plan 01');

  // 2.4 Inverse mapping (IDE hyphen to Telegram underscore)
  assert.strictEqual(toTelegramWorkflowCommand('/save-brain'), '/save_brain');
  assert.strictEqual(toTelegramWorkflowCommand('save-brain'), 'save_brain');
  assert.strictEqual(toTelegramWorkflowCommand('/awf-update'), '/awf_update');
  assert.strictEqual(toTelegramWorkflowCommand('awf-update'), 'awf_update');
  assert.strictEqual(toTelegramWorkflowCommand('/cloudflare-tunnel'), '/cloudflare_tunnel');
  assert.strictEqual(toTelegramWorkflowCommand('cloudflare-tunnel'), 'cloudflare_tunnel');
  assert.strictEqual(toTelegramWorkflowCommand('/save-brain extra args'), '/save_brain extra args');

  // 2.5 Round-trip consistency
  const testAliases = ['/save_brain', '/awf_update', '/cloudflare_tunnel'];
  for (const alias of testAliases) {
    const normalized = normalizeTelegramWorkflowCommand(alias);
    const roundTripped = toTelegramWorkflowCommand(normalized);
    assert.strictEqual(roundTripped, alias, `Round-trip mapping failed for ${alias}`);
  }

  // Edge cases
  assert.strictEqual(normalizeTelegramWorkflowCommand(''), '');
  assert.strictEqual(normalizeTelegramWorkflowCommand(null as any), '');

  console.log('  ✓ Bidirectional normalization between Telegram underscores and IDE hyphens verified.\n');

  // ---------------------------------------------------------------------------
  // [Suite 3] isWorkflowCommand Discrimination Helper
  // ---------------------------------------------------------------------------
  console.log('[Suite 3] Verifying isWorkflowCommand helper discrimination...');

  // 3.1 All workflow commands should return true
  for (const wf of expectedCoreWorkflows) {
    assert.strictEqual(isWorkflowCommand(`/${wf}`), true, `/${wf} must be recognized as workflow`);
    assert.strictEqual(isWorkflowCommand(wf), true, `${wf} must be recognized as workflow`);
    assert.strictEqual(isWorkflowCommand(`/${wf} trailing details`), true, `/${wf} with args must be recognized as workflow`);
  }

  for (const wf of expectedUnderscoreWorkflows) {
    assert.strictEqual(isWorkflowCommand(`/${wf}`), true, `/${wf} must be recognized as workflow`);
    assert.strictEqual(isWorkflowCommand(wf), true, `${wf} must be recognized as workflow`);
    assert.strictEqual(isWorkflowCommand(`/${wf} note`), true, `/${wf} with args must be recognized as workflow`);
  }

  // Also hyphenated versions in IDE form
  assert.strictEqual(isWorkflowCommand('/save-brain'), true);
  assert.strictEqual(isWorkflowCommand('save-brain'), true);
  assert.strictEqual(isWorkflowCommand('/awf-update'), true);
  assert.strictEqual(isWorkflowCommand('/cloudflare-tunnel'), true);

  // Case insensitivity
  assert.strictEqual(isWorkflowCommand('/SAVE_BRAIN'), true);
  assert.strictEqual(isWorkflowCommand('/Code'), true);

  // 3.2 Management commands must return false
  for (const mg of expectedManagement) {
    assert.strictEqual(isWorkflowCommand(`/${mg}`), false, `Management command /${mg} must NOT be a workflow command`);
    assert.strictEqual(isWorkflowCommand(mg), false, `Management command ${mg} must NOT be a workflow command`);
  }
  assert.strictEqual(isWorkflowCommand('/start'), false, '/start must NOT be a workflow command');

  // 3.3 Unknown and malformed inputs
  assert.strictEqual(isWorkflowCommand('/unregistered_command'), false);
  assert.strictEqual(isWorkflowCommand(''), false);
  assert.strictEqual(isWorkflowCommand(undefined as any), false);

  console.log('  ✓ isWorkflowCommand accurately discriminates workflows from bot administration commands.\n');

  // ---------------------------------------------------------------------------
  // [Suite 4] syncBotCommands Invocation & API Call Verification
  // ---------------------------------------------------------------------------
  console.log('[Suite 4] Verifying syncBotCommands invocation with bot.api.setMyCommands...');

  const { bot: mockBot, apiCalls } = createMockBot();
  const syncResult = await syncBotCommands(mockBot);

  assert.strictEqual(syncResult, true, 'syncBotCommands should return true on success');
  assert.strictEqual(apiCalls.length, 1, 'Exactly 1 Telegram API call should have been recorded');
  assert.strictEqual(apiCalls[0].method, 'setMyCommands', 'API call must be setMyCommands');

  const registeredCommands: TelegramBotCommandItem[] = apiCalls[0].payload.commands;
  assert.strictEqual(registeredCommands.length, 27, 'Registered commands payload must contain 27 entries');

  // Verify that entries match the catalog exactly
  for (let i = 0; i < FULL_BOT_COMMAND_CATALOG.length; i++) {
    const expected = FULL_BOT_COMMAND_CATALOG[i];
    const actual = registeredCommands[i];
    assert.strictEqual(actual.command, expected.command);
    assert.strictEqual(actual.description, expected.description);
  }

  // 4.2 Filtering and truncation guard
  const { bot: mockFilterBot, apiCalls: filterCalls } = createMockBot();
  const oversizedCatalog: TelegramBotCommandItem[] = [
    { command: 'INVALID-NAME', description: 'Has hyphen' },
    { command: 'UPPERCASE', description: 'Uppercase' },
    { command: 'valid_one', description: 'Valid 1' }
  ];
  // Add 120 dummy commands to test 100 limit capping
  for (let i = 0; i < 110; i++) {
    oversizedCatalog.push({ command: `cmd_${i}`, description: `Desc ${i}` });
  }

  const filterResult = await syncBotCommands(mockFilterBot, oversizedCatalog);
  assert.strictEqual(filterResult, true);
  const filteredCommands: TelegramBotCommandItem[] = filterCalls[0].payload.commands;
  assert.strictEqual(filteredCommands.length, 100, 'Commands must be capped at 100');
  assert.ok(!filteredCommands.some((c) => c.command === 'INVALID-NAME'), 'Invalid hyphenated command was filtered');
  assert.ok(!filteredCommands.some((c) => c.command === 'UPPERCASE'), 'Uppercase command was filtered');
  assert.strictEqual(filteredCommands[0].command, 'valid_one');

  console.log('  ✓ syncBotCommands properly invokes bot.api.setMyCommands with sanitized payload.\n');

  // ---------------------------------------------------------------------------
  // [Suite 5] Graceful Error Recovery & Network Timeout Handling
  // ---------------------------------------------------------------------------
  console.log('[Suite 5] Verifying graceful error recovery & network timeout retry logic...');

  // 5.1 Transient network failure with successful retry
  let attemptCounter = 0;
  const { bot: retryBot, setSetMyCommandsHandler: setRetryHandler } = createMockBot();
  setRetryHandler((payload) => {
    attemptCounter++;
    if (attemptCounter < 3) {
      throw new Error('ETIMEDOUT: Connection to api.telegram.org timed out');
    }
    return { ok: true, result: true };
  });

  const retrySuccess = await syncBotCommands(retryBot);
  assert.strictEqual(retrySuccess, true, 'syncBotCommands should recover after transient retry failures');
  assert.strictEqual(attemptCounter, 3, 'Expected 3 attempts before succeeding');

  // 5.2 Permanent network failure (all retries exhausted)
  let permanentAttemptCounter = 0;
  const { bot: failureBot, setSetMyCommandsHandler: setFailureHandler } = createMockBot();
  setFailureHandler(() => {
    permanentAttemptCounter++;
    throw new Error('502 Bad Gateway: Telegram API unreachable');
  });

  const failureResult = await syncBotCommands(failureBot);
  assert.strictEqual(failureResult, false, 'syncBotCommands should return false without throwing on permanent failure');
  assert.strictEqual(permanentAttemptCounter, 3, 'Expected 3 attempts before giving up');

  // 5.3 Missing bot or missing api method
  const nullBotResult = await syncBotCommands(null as any);
  assert.strictEqual(nullBotResult, false, 'syncBotCommands should return false if bot is null');

  const emptyBotResult = await syncBotCommands({} as any);
  assert.strictEqual(emptyBotResult, false, 'syncBotCommands should return false if bot.api is missing');

  console.log('  ✓ Network timeouts and API failures handled gracefully with automatic retries and non-fatal logging.\n');

  // ---------------------------------------------------------------------------
  // [Suite 6] TelegramBridge Lifecycle & Leader Election Integration
  // ---------------------------------------------------------------------------
  console.log('[Suite 6] Verifying TelegramBridge startup and leader command sync...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-p03-test-'));
  const testRegistryPath = path.join(tempDir, 'ag-autoplan-ports.json');

  try {
    const { bot: bridgeMockBot, apiCalls: bridgeApiCalls } = createMockBot();

    const bridge = new TelegramBridge({
      token: '1234567890:ABCdefGHIjklMNOpqrsTUV_testing',
      registryPath: testRegistryPath,
      botFactory: () => bridgeMockBot
    });

    // 6.1 Calling syncBotCommands directly on the bridge instance
    const bridgeMethodResult = await bridge.syncBotCommands(bridgeMockBot);
    assert.strictEqual(bridgeMethodResult, true, 'bridge.syncBotCommands should return true');

    // 6.2 Bridge initialization triggers command synchronization
    bridge.initBot();
    // Allow microtasks to resolve for async syncBotCommands
    await new Promise((resolve) => setTimeout(resolve, 50));

    const setCommandsCalls = bridgeApiCalls.filter((c) => c.method === 'setMyCommands');
    assert.ok(setCommandsCalls.length >= 2, 'Expected setMyCommands to be called during bot initialization');

    // 6.3 Start lifecycle leader election trigger
    await bridge.start();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const postStartCalls = bridgeApiCalls.filter((c) => c.method === 'setMyCommands');
    assert.ok(postStartCalls.length >= 3, 'Expected setMyCommands to be invoked upon leader election');

    await bridge.stop();
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('  ✓ TelegramBridge seamlessly synchronizes commands during bot initialization and leader election.\n');

  console.log('================================================================');
  console.log(' ALL Phase 03 Workflow Command Registration & Mapping Tests PASSED!');
  console.log('================================================================\n');
}

runPhase03Tests().catch((err) => {
  console.error('Phase 03 Test Suite Failed:', err);
  process.exit(1);
});
