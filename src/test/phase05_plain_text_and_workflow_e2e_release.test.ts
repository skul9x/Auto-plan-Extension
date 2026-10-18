// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {};
const executedCommands: string[] = [];

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
        executeCommand: async (cmd: string, ...args: any[]) => {
          executedCommands.push(cmd);
          return true;
        }
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 },
      StatusBarAlignment: { Left: 1, Right: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
const yauzl = require('yauzl');
import { Bot, Context } from 'grammy';

import {
  stripMarkdownToPlainText,
  splitMessage,
  sanitizeTelegramInput
} from '../telegramUtils';
import { ThrottledNotifier } from '../telegramNotifier';
import {
  TelegramBridge,
  normalizeTelegramWorkflowCommand,
  toTelegramWorkflowCommand,
  isWorkflowCommand,
  parseWorkflowCommand,
  ParsedWorkflowCommand,
  syncBotCommands,
  FULL_BOT_COMMAND_CATALOG,
  INTERNAL_BOT_COMMANDS,
  WORKFLOW_COMMAND_NAMES,
  TelegramBotCommandItem
} from '../telegramBridge';
import { PromptDispatcher, DispatchResult } from '../promptDispatcher';
import { DebugLogger } from '../debugLogger';

interface MockApiCall {
  method: string;
  payload: any;
  timestamp: number;
}

/**
 * Creates a mock GrammY bot initialized with offline botInfo and message/API capturing.
 */
function createMockBot(token: string = '123456:TEST_TOKEN'): {
  bot: Bot;
  apiCalls: MockApiCall[];
  sentMessages: any[];
  setMyCommandsCalls: any[];
} {
  const bot = new Bot(token, {
    botInfo: {
      id: 8930752011,
      is_bot: true,
      first_name: 'AutoPlanTestBot',
      username: 'autoplan_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false
    } as any
  });

  const apiCalls: MockApiCall[] = [];
  const sentMessages: any[] = [];
  const setMyCommandsCalls: any[] = [];

  bot.api.config.use(async (_prev, method, payload) => {
    const record: MockApiCall = {
      method,
      payload,
      timestamp: Date.now()
    };
    apiCalls.push(record);

    if (method === 'sendMessage') {
      const anyPayload = payload as any;
      sentMessages.push(anyPayload);
      return {
        ok: true,
        result: {
          message_id: Math.floor(Math.random() * 10000) + 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id, type: 'private', first_name: 'Chat' },
          text: anyPayload.text
        }
      } as any;
    }

    if (method === 'editMessageText') {
      const anyPayload = payload as any;
      return {
        ok: true,
        result: {
          message_id: anyPayload.message_id || 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id, type: 'private', first_name: 'Chat' },
          text: anyPayload.text
        }
      } as any;
    }

    if (method === 'setMyCommands') {
      setMyCommandsCalls.push(payload);
      return { ok: true, result: true } as any;
    }

    return { ok: true, result: {} } as any;
  });

  return { bot, apiCalls, sentMessages, setMyCommandsCalls };
}

/**
 * Audits the contents and manifests of a .vsix zip archive.
 */
async function auditVsixArchive(vsixFilePath: string): Promise<{
  totalFiles: number;
  files: string[];
  packageJson: any;
  leakedSecretFindings: Array<{ file: string; match: string }>;
}> {
  return new Promise((resolve, reject) => {
    yauzl.open(vsixFilePath, { lazyEntries: true }, (err: any, zipfile: any) => {
      if (err) return reject(err);

      const report = {
        totalFiles: 0,
        files: [] as string[],
        packageJson: null as any,
        leakedSecretFindings: [] as Array<{ file: string; match: string }>
      };

      const auditRegex = /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g;
      const forbiddenStrings = [
        '8930752011:AAG6HyFKC5h405nOw06EHz71np73vYuzFMc',
        '8376918512:'
      ];

      zipfile.readEntry();
      zipfile.on('entry', (entry: any) => {
        report.totalFiles++;
        report.files.push(entry.fileName);

        const isTextCandidate = /\.(js|json|md|html|txt|ts|yml|yaml)$/i.test(entry.fileName);

        if (isTextCandidate) {
          zipfile.openReadStream(entry, (streamErr: any, readStream: any) => {
            if (streamErr) return reject(streamErr);
            const chunks: Buffer[] = [];
            readStream.on('data', (c: Buffer) => chunks.push(c));
            readStream.on('end', () => {
              const content = Buffer.concat(chunks).toString('utf8');

              if (entry.fileName === 'extension/package.json') {
                try {
                  report.packageJson = JSON.parse(content);
                } catch (pe) {
                  // ignore JSON parse error in report
                }
              }

              for (const forbidden of forbiddenStrings) {
                if (content.includes(forbidden)) {
                  report.leakedSecretFindings.push({
                    file: entry.fileName,
                    match: forbidden
                  });
                }
              }

              const matches = content.match(auditRegex);
              if (matches) {
                for (const m of matches) {
                  report.leakedSecretFindings.push({
                    file: entry.fileName,
                    match: m
                  });
                }
              }

              zipfile.readEntry();
            });
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => {
        resolve(report);
      });
      zipfile.on('error', (zipErr: any) => {
        reject(zipErr);
      });
    });
  });
}

/**
 * Main Phase 05 E2E regression and release verification test suite.
 */
export async function runPhase05ReleaseE2ETest(): Promise<void> {
  console.log('================================================================');
  console.log(' Starting Phase 05 E2E Integration & Release Packaging Test');
  console.log('================================================================\n');

  const rootDir = path.resolve(__dirname, '..', '..');
  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-p05-release-test-'));
  const testLogger = new DebugLogger();

  let bridge: TelegramBridge | null = null;

  try {
    // -------------------------------------------------------------------------
    // Suite 1: Clean TypeScript Compilation, Version Bump (1.6.3), Manifests & Documentation
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Verifying Version Bump (1.6.3), Manifests, and Documentation...');

    // 1.1 Verify package.json
    const packageJsonPath = path.join(rootDir, 'package.json');
    assert.ok(fs.existsSync(packageJsonPath), 'package.json must exist at project root');
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    assert.ok(pkg.version === '1.6.3' || pkg.version === '1.6.4', `package.json version must be at least 1.6.3 (got ${pkg.version})`);
    assert.strictEqual(pkg.name, 'antigravity-auto-plan', 'package.json name must be antigravity-auto-plan');
    assert.strictEqual(pkg.main, './out/extension.js', 'package.json main must point to ./out/extension.js');
    console.log('  ✓ package.json version valid with valid entrypoint.');

    // 1.2 Verify CHANGELOG.md
    const changelogPath = path.join(rootDir, 'CHANGELOG.md');
    assert.ok(fs.existsSync(changelogPath), 'CHANGELOG.md must exist at project root');
    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    assert.ok(changelogContent.includes('## [1.6.3]'), 'CHANGELOG.md must document release 1.6.3');
    assert.ok(
      changelogContent.includes('stripMarkdownToPlainText') || changelogContent.includes('Plain Text'),
      'CHANGELOG.md must detail Plain Text engine'
    );
    assert.ok(
      changelogContent.includes('setMyCommands') || changelogContent.includes('Workflow Slash Autocomplete'),
      'CHANGELOG.md must detail Workflow Slash Autocomplete and setMyCommands'
    );
    console.log('  ✓ CHANGELOG.md contains comprehensive release notes for v1.6.3.');

    // 1.3 Verify README.md
    const readmePath = path.join(rootDir, 'README.md');
    assert.ok(fs.existsSync(readmePath), 'README.md must exist at project root');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    assert.ok(
      readmeContent.includes('version-1.6.3') || readmeContent.includes('version-1.6.4'),
      'README.md version badge must reflect version 1.6.3 or newer'
    );
    assert.ok(
      readmeContent.includes('antigravity-auto-plan-1.6.3.vsix') || readmeContent.includes('antigravity-auto-plan-1.6.4.vsix'),
      'README.md installation commands must reference 1.6.3 or 1.6.4 VSIX artifact'
    );
    assert.ok(
      readmeContent.includes('Plain Text') && readmeContent.includes('Workflow'),
      'README.md features must describe Plain Text output and Workflow features'
    );
    console.log('  ✓ README.md documentation badges and install commands updated to 1.6.3.\n');

    // -------------------------------------------------------------------------
    // Suite 2: Markdown to Clean Plain Text Stripping Engine (`stripMarkdownToPlainText`)
    // -------------------------------------------------------------------------
    console.log('[Suite 2] Verifying Markdown to Clean Plain Text Transformation Engine...');

    const complexMarkdownInput = [
      '# Executive Architecture & Workflow Summary',
      '',
      'Welcome to the **Antigravity Auto-Plan** system! This test verifies *all* markdown elements.',
      'Check out ***bold and italic***, ~~strikethrough~~, and `inlineCode(true)`.',
      '',
      '## Key Features & Highlights',
      '',
      '> Important note: Background DOM injection is non-blocking and resilient.',
      '> Second line of blockquote.',
      '',
      '### Implementation Checklist',
      '- [x] Implement Markdown stripper AST/Regex engine',
      '- [ ] Connect Telegram outbound message pipeline',
      '* Bullet item alpha',
      '+ Bullet item beta with nested list:',
      '  - Sub-bullet 1',
      '  - Sub-bullet 2',
      '1. First numbered step',
      '2. Second numbered step',
      '',
      '### Benchmark Performance Table',
      '| Module | Status | Latency | Accuracy |',
      '| :--- | :---: | ---: | :--- |',
      '| Stripper Engine | PASS | 0.8ms | 100% |',
      '| Command Registry | ACTIVE | 1.2ms | 100% |',
      '| Telegram Gateway | ONLINE | 2.5ms | 99.9% |',
      '',
      '```typescript',
      'export function executePlan(phase: string): boolean {',
      '    console.log(`Executing ${phase}`);',
      '    return true;',
      '}',
      '```',
      '',
      'For more details, see [Auto-Plan Spec](https://example.com/spec) and local link [Phase 05](file:///workspace/phase-05.md).',
      '<div class="status-badge">Operational</div> <!-- End of test payload -->'
    ].join('\n');

    const strippedResult = stripMarkdownToPlainText(complexMarkdownInput);

    // Verify Markdown headers stripped
    assert.ok(!strippedResult.includes('# Executive Architecture'), 'Heading # must be stripped');
    assert.ok(!strippedResult.includes('## Key Features'), 'Heading ## must be stripped');
    assert.ok(!strippedResult.includes('### Implementation'), 'Heading ### must be stripped');
    assert.ok(strippedResult.includes('Executive Architecture & Workflow Summary'), 'Heading text retained');

    // Verify formatting stripped
    assert.ok(!strippedResult.includes('**Antigravity Auto-Plan**'), 'Bold ** must be stripped');
    assert.ok(!strippedResult.includes('***bold and italic***'), 'Bold/italic *** must be stripped');
    assert.ok(!strippedResult.includes('~~strikethrough~~'), 'Strikethrough ~~ must be stripped');
    assert.ok(!strippedResult.includes('`inlineCode(true)`'), 'Inline backticks ` must be stripped');
    assert.ok(strippedResult.includes('Antigravity Auto-Plan'), 'Plain text retained');
    assert.ok(strippedResult.includes('inlineCode(true)'), 'Code text retained');

    // Verify blockquotes stripped
    assert.ok(!strippedResult.includes('> Important note:'), 'Blockquote > must be stripped');
    assert.ok(strippedResult.includes('Important note: Background DOM injection is non-blocking'), 'Quote text retained');

    // Verify lists and task checkboxes
    assert.ok(!strippedResult.includes('- [x]'), 'Task checklist markdown - [x] must be stripped');
    assert.ok(strippedResult.includes('[x] Implement Markdown stripper') || strippedResult.includes('Implement Markdown stripper'), 'Task item retained');
    assert.ok(strippedResult.includes('Bullet item alpha'), 'Bullet item retained');
    assert.ok(strippedResult.includes('First numbered step'), 'Numbered item retained');

    // Verify table flattening
    assert.ok(!strippedResult.includes('| :--- |'), 'Table delimiter row must be removed');
    assert.ok(!strippedResult.includes('| Module | Status |'), 'Raw table pipe separators stripped');
    assert.ok(strippedResult.includes('Stripper Engine'), 'Table row content preserved');
    assert.ok(strippedResult.includes('Command Registry'), 'Table row content preserved');

    // Verify code fence stripping
    assert.ok(!strippedResult.includes('```typescript'), 'Opening code fence must be stripped');
    assert.ok(!strippedResult.includes('```'), 'Closing code fence must be stripped');
    assert.ok(strippedResult.includes('export function executePlan(phase: string): boolean {'), 'Code content preserved');

    // Verify links and HTML tags
    assert.ok(!strippedResult.includes('file:///workspace'), 'file:// local URL stripped');
    assert.ok(strippedResult.includes('Auto-Plan Spec (https://example.com/spec)'), 'Web link formatted cleanly');
    assert.ok(!strippedResult.includes('<div class="status-badge">'), 'HTML opening tag stripped');
    assert.ok(!strippedResult.includes('</div>'), 'HTML closing tag stripped');
    assert.ok(!strippedResult.includes('<!--'), 'HTML comment stripped');
    assert.ok(strippedResult.includes('Operational'), 'HTML text node content retained');

    // Edge cases
    assert.strictEqual(stripMarkdownToPlainText(null as any), '', 'Null input returns empty string');
    assert.strictEqual(stripMarkdownToPlainText(undefined as any), '', 'Undefined input returns empty string');
    assert.strictEqual(stripMarkdownToPlainText('' as any), '', 'Empty string returns empty string');
    assert.strictEqual(stripMarkdownToPlainText(12345 as any), '', 'Numeric input returns empty string');
    console.log('  ✓ Markdown to Plain Text engine handles complex syntax, tables, and edge cases cleanly.\n');

    // -------------------------------------------------------------------------
    // Suite 3: Telegram Outbound Delivery Plain Text & `parse_mode: undefined` Guard
    // -------------------------------------------------------------------------
    console.log('[Suite 3] Verifying Telegram Delivery with parse_mode: undefined Invariant...');

    const { bot: mockDeliveryBot, sentMessages: outboundDeliveryMessages } = createMockBot('123456:TEST_TOKEN');
    const authorizedChatId = 987654321;

    const notifier = new ThrottledNotifier({
      bot: mockDeliveryBot,
      chatId: authorizedChatId,
      throttleMs: 0,
      logger: testLogger
    });

    // 3.1 Verify handlePhaseStart
    await notifier.handlePhaseStart('phase-05-e2e-integration.md', 5, 5);
    const startMsg = outboundDeliveryMessages[outboundDeliveryMessages.length - 1];
    assert.ok(startMsg, 'handlePhaseStart must send an outbound message');
    assert.strictEqual(
      startMsg.parse_mode,
      undefined,
      'handlePhaseStart must use parse_mode: undefined'
    );
    assert.ok(startMsg.text.includes('phase-05-e2e-integration.md'), 'Start notification contains phase name');

    // 3.2 Verify handlePhaseComplete with markdown in result
    await notifier.handlePhaseComplete(
      'phase-05-e2e-integration.md',
      { summary: 'Completed with **100% success** and `zero` errors.' },
      5,
      5
    );
    const compMsg = outboundDeliveryMessages[outboundDeliveryMessages.length - 1];
    assert.ok(compMsg, 'handlePhaseComplete must send an outbound message');
    assert.strictEqual(compMsg.parse_mode, undefined, 'handlePhaseComplete must use parse_mode: undefined');
    assert.ok(!compMsg.text.includes('**100% success**'), 'Bold markdown must be stripped');
    assert.ok(compMsg.text.includes('100% success'), 'Text retained');

    // 3.3 Verify handleError
    await notifier.handleError(new Error('*Compilation failed*'));
    const errMsg = outboundDeliveryMessages[outboundDeliveryMessages.length - 1];
    assert.strictEqual(errMsg.parse_mode, undefined, 'handleError must use parse_mode: undefined');
    assert.ok(!errMsg.text.includes('*Compilation failed*'), 'Italic markdown must be stripped');

    // 3.4 Verify handleCompletionDetected
    await notifier.handleCompletionDetected({ matchedContent: '### Done skul9x. All phases verified.' });
    const doneMsg = outboundDeliveryMessages[outboundDeliveryMessages.length - 1];
    assert.strictEqual(doneMsg.parse_mode, undefined, 'handleCompletionDetected must use parse_mode: undefined');
    assert.ok(!doneMsg.text.includes('###'), 'Header marks must be stripped');

    // 3.5 Verify broadcastMessage
    await notifier.broadcastMessage('Current Phase: `phase-05` (In Progress)');
    const statusMsg = outboundDeliveryMessages[outboundDeliveryMessages.length - 1];
    assert.strictEqual(statusMsg.parse_mode, undefined, 'broadcastMessage must use parse_mode: undefined');
    assert.ok(!statusMsg.text.includes('`phase-05`'), 'Backticks stripped');

    // 3.6 Verify safeSendMessage overrides any attempted parse_mode: 'Markdown'
    await (notifier as any).safeSendMessage(authorizedChatId, 'Testing forced parse_mode override', {
      parse_mode: 'Markdown'
    });
    const forcedMsg = outboundDeliveryMessages[outboundDeliveryMessages.length - 1];
    assert.strictEqual(
      forcedMsg.parse_mode,
      undefined,
      'Forced parse_mode: Markdown must be safely overridden to undefined'
    );
    console.log('  ✓ All ThrottledNotifier delivery methods enforce parse_mode: undefined and plain text.\n');

    // -------------------------------------------------------------------------
    // Suite 4: Workflow Command Catalog & `setMyCommands` Registration
    // -------------------------------------------------------------------------
    console.log('[Suite 4] Verifying Workflow Command Catalog & setMyCommands Registration...');

    // 4.1 Verify catalog content
    assert.ok(
      FULL_BOT_COMMAND_CATALOG.length >= 25,
      `Expected >= 25 registered slash commands, got ${FULL_BOT_COMMAND_CATALOG.length}`
    );

    // Verify critical workflow commands exist in catalog
    const registeredCommandNames = FULL_BOT_COMMAND_CATALOG.map((c: TelegramBotCommandItem) => c.command);
    const expectedWorkflows = [
      'init',
      'brainstorm',
      'plan',
      'design',
      'visualize',
      'code',
      'run',
      'debug',
      'test',
      'audit',
      'deploy',
      'next',
      'recap',
      'help',
      'customize',
      'refactor',
      'review',
      'save_brain',
      'rollback',
      'awf_update',
      'cloudflare_tunnel'
    ];

    for (const expected of expectedWorkflows) {
      assert.ok(
        registeredCommandNames.includes(expected),
        `Workflow command '${expected}' must be present in FULL_BOT_COMMAND_CATALOG`
      );
    }

    // Verify Telegram command format constraints: [a-z0-9_]{1,32} and descriptions <= 256
    const telegramCmdRegex = /^[a-z0-9_]{1,32}$/;
    for (const entry of FULL_BOT_COMMAND_CATALOG) {
      assert.ok(
        telegramCmdRegex.test(entry.command),
        `Command '${entry.command}' violates Telegram API format constraints (must match /^[a-z0-9_]{1,32}$/)`
      );
      assert.ok(
        entry.description && entry.description.trim().length > 0,
        `Command '${entry.command}' must have a non-empty description`
      );
      assert.ok(
        entry.description.length <= 256,
        `Command '${entry.command}' description length (${entry.description.length}) exceeds 256 chars`
      );
    }

    // 4.2 Verify syncBotCommands invokes bot.api.setMyCommands
    const { bot: mockSyncBot, setMyCommandsCalls } = createMockBot('123456:TEST_TOKEN');
    await syncBotCommands(mockSyncBot, FULL_BOT_COMMAND_CATALOG, testLogger);

    assert.strictEqual(setMyCommandsCalls.length, 1, 'syncBotCommands must call setMyCommands exactly once');
    const syncedCommands = setMyCommandsCalls[0]?.commands || setMyCommandsCalls[0];
    assert.ok(Array.isArray(syncedCommands), 'Payload commands must be an array of bot commands');
    assert.strictEqual(
      syncedCommands.length,
      FULL_BOT_COMMAND_CATALOG.length,
      'All catalog commands must be passed to setMyCommands'
    );

    // 4.3 Verify bidirectional mapping and normalization helpers
    assert.strictEqual(
      toTelegramWorkflowCommand('save-brain'),
      'save_brain',
      'toTelegramWorkflowCommand should convert hyphen to underscore'
    );
    assert.strictEqual(
      toTelegramWorkflowCommand('awf-update'),
      'awf_update',
      'toTelegramWorkflowCommand should convert awf-update to awf_update'
    );
    assert.strictEqual(
      normalizeTelegramWorkflowCommand('save_brain'),
      'save-brain',
      'normalizeTelegramWorkflowCommand should convert save_brain to save-brain'
    );
    assert.strictEqual(
      normalizeTelegramWorkflowCommand('save-brain'),
      'save-brain',
      'normalizeTelegramWorkflowCommand should preserve save-brain'
    );
    assert.strictEqual(
      normalizeTelegramWorkflowCommand('code'),
      'code',
      'normalizeTelegramWorkflowCommand should preserve code'
    );

    assert.strictEqual(isWorkflowCommand('save_brain'), true);
    assert.strictEqual(isWorkflowCommand('save-brain'), true);
    assert.strictEqual(isWorkflowCommand('code'), true);
    assert.strictEqual(isWorkflowCommand('screen'), false, 'screen is an internal command, not workflow');
    assert.strictEqual(isWorkflowCommand('plans'), false, 'plans is an internal command, not workflow');
    console.log('  ✓ Catalog format, syncBotCommands, and bidirectional mappings verified.\n');

    // -------------------------------------------------------------------------
    // Suite 5: End-to-End Workflow Command Forwarding, Normalization & Free-Form Prompt Dispatch
    // -------------------------------------------------------------------------
    console.log('[Suite 5] Verifying Workflow Command Normalization, Forwarding & E2E Dispatch...');

    // 5.1 Verify parseWorkflowCommand logic
    const parseTest1 = parseWorkflowCommand('/save_brain sprint 5 release retrospective');
    assert.ok(parseTest1, 'Must parse valid workflow command');
    assert.strictEqual(parseTest1!.command, 'save-brain', 'Command must be normalized to save-brain');
    assert.strictEqual(parseTest1!.rawCommand, 'save_brain');
    assert.strictEqual(parseTest1!.args, 'sprint 5 release retrospective');
    assert.strictEqual(parseTest1!.normalizedPrompt, '/save-brain sprint 5 release retrospective');

    const parseTest2 = parseWorkflowCommand('/brainstorm   build modern dashboard UI   ');
    assert.ok(parseTest2);
    assert.strictEqual(parseTest2!.command, 'brainstorm');
    assert.strictEqual(parseTest2!.args, 'build modern dashboard UI');
    assert.strictEqual(parseTest2!.normalizedPrompt, '/brainstorm build modern dashboard UI');

    const parseTest3 = parseWorkflowCommand('/recap');
    assert.ok(parseTest3);
    assert.strictEqual(parseTest3!.command, 'recap');
    assert.strictEqual(parseTest3!.args, '');
    assert.strictEqual(parseTest3!.normalizedPrompt, '/recap');

    const parseTest4 = parseWorkflowCommand('/screen full');
    assert.strictEqual(parseTest4, null, 'Internal /screen command must not be parsed as workflow');

    const parseTest5 = parseWorkflowCommand('/save_brain@autoplan_test_bot meeting summary');
    assert.ok(parseTest5);
    assert.strictEqual(parseTest5!.command, 'save-brain');
    assert.strictEqual(parseTest5!.args, 'meeting summary');
    assert.strictEqual(parseTest5!.normalizedPrompt, '/save-brain meeting summary');

    // 5.2 End-to-end integration with mock TelegramBridge and mock PromptDispatcher
    const dispatchedPrompts: Array<{ text: string; options?: any }> = [];
    const mockPromptDispatcher: PromptDispatcher = {
      dispatchPrompt: async (text: string, options?: any): Promise<DispatchResult> => {
        dispatchedPrompts.push({ text, options });
        return {
          success: true,
          tier: 'domBridge',
          durationMs: 10
        };
      }
    } as any;

    const { bot: testBot, sentMessages: testSent } = createMockBot('123456:TEST_TOKEN');
    const authorizedUserId = 55667788;
    const testRegistryPath = path.join(testTempDir, 'ports.json');

    bridge = new TelegramBridge({
      token: '123456:TEST_TOKEN',
      enabled: true,
      allowedUsers: [authorizedUserId],
      registryPath: testRegistryPath,
      logger: testLogger,
      botFactory: () => testBot,
      promptDispatcher: mockPromptDispatcher
    });

    bridge.initBot();
    await testBot.init();

    // Test 1: User sends `/save_brain my architectural thoughts`
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 1001,
      message: {
        message_id: 101,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'Dev' },
        text: '/save_brain my architectural thoughts',
        entities: [{ type: 'bot_command', offset: 0, length: 11 }]
      }
    } as any);

    assert.strictEqual(dispatchedPrompts.length, 1, 'Expected prompt to be dispatched');
    assert.strictEqual(
      dispatchedPrompts[0].text,
      '/save-brain my architectural thoughts',
      'Command must be normalized from /save_brain to /save-brain with args intact'
    );
    assert.strictEqual(
      dispatchedPrompts[0].options?.openNewConversation,
      false,
      'Must preserve conversation continuity'
    );
    console.log('  ✓ /save_brain <arg> successfully normalized and forwarded as /save-brain <arg>');

    // Test 2: User sends standalone `/code`
    dispatchedPrompts.length = 0;
    testSent.length = 0;

    await testBot.handleUpdate({
      update_id: 1002,
      message: {
        message_id: 102,
        date: Math.floor(Date.now() / 1000),
        chat: { id: authorizedUserId, type: 'private' },
        from: { id: authorizedUserId, is_bot: false, first_name: 'Dev' },
        text: '/code',
        entities: [{ type: 'bot_command', offset: 0, length: 5 }]
      }
    } as any);

    assert.strictEqual(dispatchedPrompts.length, 1);
    assert.strictEqual(dispatchedPrompts[0].text, '/code', 'Standalone command forwarded cleanly');
    console.log('  ✓ Standalone /code command forwarded cleanly without trailing spaces');

    // Test 3: Model response delivery via awaitAndReplyModelResponse
    const mockTranscriptFile = path.join(testTempDir, 'transcript.jsonl');
    const markdownModelReply = [
      '# Phase 05 Verification Report',
      '',
      'All integration suites have passed with **100% accuracy**.',
      '',
      '| Metric | Result |',
      '| --- | --- |',
      '| Compilation | 0 Errors |',
      '| Package | VSIX 1.6.3 |',
      '',
      '```bash',
      'code --install-extension antigravity-auto-plan-1.6.3.vsix',
      '```',
      '',
      'Done skul9x.'
    ].join('\n');

    const transcriptLine =
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: markdownModelReply
      }) + '\n';

    fs.writeFileSync(mockTranscriptFile, transcriptLine, 'utf8');

    const repliedChunks: Array<{ text: string; options?: any }> = [];
    const mockCtx: any = {
      from: { id: authorizedUserId, username: 'tester' },
      chat: { id: authorizedUserId },
      reply: async (text: string, options?: any) => {
        repliedChunks.push({ text, options });
        return { message_id: 2002 };
      }
    };

    await bridge.awaitAndReplyModelResponse(mockCtx, mockTranscriptFile, 0, 2000);

    assert.ok(repliedChunks.length >= 1, 'Expected model reply to be sent to Telegram');
    for (const chunk of repliedChunks) {
      assert.strictEqual(chunk.options, undefined, 'ctx.reply must omit parse_mode options');
    }

    const fullReply = repliedChunks.map((c) => c.text).join('\n');
    assert.ok(!fullReply.includes('# Phase 05 Verification Report'), 'Header marks # stripped');
    assert.ok(!fullReply.includes('**100% accuracy**'), 'Bold asterisks ** stripped');
    assert.ok(!fullReply.includes('| --- |'), 'Table delimiter stripped');
    assert.ok(!fullReply.includes('```bash'), 'Code fences stripped');
    assert.ok(fullReply.includes('Phase 05 Verification Report'), 'Text content preserved');
    assert.ok(fullReply.includes('100% accuracy'), 'Text content preserved');
    assert.ok(fullReply.includes('Done skul9x.'), 'Keyword content preserved');
    console.log('  ✓ Model response streamed and converted to plain text with parse_mode: undefined.\n');

    // -------------------------------------------------------------------------
    // Suite 6: Production Release VSIX Package (`antigravity-auto-plan-1.6.3.vsix`) Integrity & Audit
    // -------------------------------------------------------------------------
    console.log('[Suite 6] Verifying Packaged VSIX Archive Integrity and Security Audit...');

    const vsixPath = path.join(rootDir, 'antigravity-auto-plan-1.6.3.vsix');
    assert.ok(fs.existsSync(vsixPath), `VSIX release artifact must exist at: ${vsixPath}`);

    const vsixStats = fs.statSync(vsixPath);
    console.log(`  -> Release VSIX size: ${(vsixStats.size / 1024).toFixed(2)} KB`);
    assert.ok(
      vsixStats.size > 500 * 1024,
      `VSIX release bundle must be substantial (> 500 KB), actual: ${vsixStats.size} bytes`
    );

    // Verify valid PK zip header
    const fd = fs.openSync(vsixPath, 'r');
    const magicBuf = Buffer.alloc(4);
    fs.readSync(fd, magicBuf, 0, 4, 0);
    fs.closeSync(fd);
    assert.strictEqual(
      magicBuf.toString('hex'),
      '504b0304',
      'VSIX file must possess valid zip magic header (PK\x03\x04)'
    );

    // Deep-audit entries inside the VSIX package
    const vsixAudit = await auditVsixArchive(vsixPath);
    console.log(`  -> Total files packaged in VSIX: ${vsixAudit.totalFiles}`);
    assert.ok(vsixAudit.totalFiles > 100, `Expected > 100 packaged files, found ${vsixAudit.totalFiles}`);

    // Verify package.json inside VSIX has 1.6.3 version
    assert.ok(vsixAudit.packageJson, 'Packaged extension/package.json must be readable');
    assert.strictEqual(
      vsixAudit.packageJson.version,
      '1.6.3',
      `Packaged extension version must be 1.6.3 (got ${vsixAudit.packageJson.version})`
    );
    assert.strictEqual(
      vsixAudit.packageJson.name,
      'antigravity-auto-plan',
      'Packaged extension name must match antigravity-auto-plan'
    );

    // Verify critical files are present in the package
    const criticalPackageFiles = [
      'extension/package.json',
      'extension/CHANGELOG.md',
      'extension/README.md',
      'extension/out/extension.js',
      'extension/out/telegramBridge.js',
      'extension/out/telegramUtils.js',
      'extension/out/telegramNotifier.js'
    ];

    for (const critFile of criticalPackageFiles) {
      assert.ok(
        vsixAudit.files.includes(critFile),
        `Critical file '${critFile}' must be packaged inside VSIX`
      );
    }

    // Verify zero leaked secrets/tokens
    if (vsixAudit.leakedSecretFindings.length > 0) {
      console.error('Leaked secret findings detected in VSIX:', vsixAudit.leakedSecretFindings);
      assert.fail(`Detected ${vsixAudit.leakedSecretFindings.length} leaked credential findings in VSIX`);
    }
    console.log('  ✓ VSIX package verified: version 1.6.3, valid zip manifest, zero leaked credentials.\n');

    console.log('================================================================');
    console.log(' ALL Phase 05 E2E & Release Packaging Verification Tests PASSED!');
    console.log('================================================================\n');
  } finally {
    try {
      if (bridge) {
        await bridge.stop();
      }
    } catch {}
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

// Direct CLI execution
if (require.main === module) {
  runPhase05ReleaseE2ETest()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('Phase 05 E2E Release Test Failed:', err);
      process.exit(1);
    });
}
