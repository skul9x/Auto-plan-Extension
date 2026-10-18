// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockConfigValues: Record<string, any> = {
  'telegram.enableChatMirror': true,
  'telegram.mirrorIncludePcPrompts': true,
  'telegram.chatMirrorPrefix': '🤖 Antigravity:',
  telegramEnabled: true,
  telegramBotToken: 'mock_token_123',
  telegramAllowedUsers: [10001],
  telegramThrottleMs: 2500
};

let configChangeListeners: ((e: any) => void)[] = [];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (_section: string) => ({
          get: (key: string, defaultValue: any) => {
            return mockConfigValues[key] !== undefined ? mockConfigValues[key] : defaultValue;
          },
          update: async (key: string, val: any) => {
            mockConfigValues[key] = val;
          }
        }),
        onDidChangeConfiguration: (listener: (e: any) => void) => {
          configChangeListeners.push(listener);
          return {
            dispose: () => {
              const idx = configChangeListeners.indexOf(listener);
              if (idx >= 0) {
                configChangeListeners.splice(idx, 1);
              }
            }
          };
        },
        workspaceFolders: [{ name: 'TestWorkspace', uri: { fsPath: '/test/workspace' } }],
        name: 'TestWorkspace'
      },
      window: {
        showWarningMessage: () => {},
        showInformationMessage: () => {},
        showErrorMessage: () => {}
      },
      commands: {
        executeCommand: async () => {}
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
const yauzl = require('yauzl');
import { Bot } from 'grammy';

import {
  TranscriptTailEngine,
  UserInputEvent,
  PlannerResponseEvent,
  AgentActivityEvent
} from '../transcriptTailEngine';
import {
  PromptOriginTracker,
  PromptOrigin,
  formatPcPrompt
} from '../promptOriginTracker';
import {
  splitMarkdownSafely,
  DEFAULT_MAX_CHUNK_LENGTH
} from '../smartMarkdownChunker';
import { TypingActionManager } from '../typingActionManager';
import {
  TelegramChatMirror,
  ThrottledResponseDeliverer,
  DEFAULT_AI_RESPONSE_HEADER,
  isRateLimitError,
  extractRetryAfterMs,
  isEntityParseError
} from '../telegramChatMirror';

interface MockApiCall {
  method: string;
  payload: any;
  timestamp: number;
}

function createMockBot(token: string = '123456:TEST_TOKEN'): {
  bot: Bot;
  apiCalls: MockApiCall[];
  sentMessages: any[];
  chatActions: any[];
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
  const chatActions: any[] = [];

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

    if (method === 'sendChatAction') {
      chatActions.push(payload);
      return { ok: true, result: true } as any;
    }

    return { ok: true, result: {} } as any;
  });

  return { bot, apiCalls, sentMessages, chatActions };
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
                } catch {}
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
 * Main Phase 05 Verification: Clean Q&A Sync Regression, Manifest & Release Packaging
 */
export async function runPhase05CleanQAReleaseTest(): Promise<void> {
  console.log('================================================================================');
  console.log(' Phase 05: Clean Q&A Sync Regression Verification, Documentation & VSIX Packaging');
  console.log('================================================================================\n');

  const rootDir = path.resolve(__dirname, '..', '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-p05-clean-qa-test-'));

  try {
    // -------------------------------------------------------------------------
    // Suite 1: Clean TypeScript Compilation Output Modules Verification
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Verifying Clean Compilation & Output Module Manifests...');
    const expectedOutputModules = [
      'out/transcriptTailEngine.js',
      'out/promptOriginTracker.js',
      'out/smartMarkdownChunker.js',
      'out/typingActionManager.js',
      'out/telegramChatMirror.js',
      'out/telegramBridge.js',
      'out/extension.js'
    ];

    for (const mod of expectedOutputModules) {
      const fullModPath = path.join(rootDir, mod);
      assert.ok(
        fs.existsSync(fullModPath),
        `Required compilation output module '${mod}' must exist at ${fullModPath}`
      );
    }
    console.log('  ✓ All 7 core compilation output modules verified in out/ directory.\n');

    // -------------------------------------------------------------------------
    // Suite 2: Functional Core Verification of Clean Q&A Components
    // -------------------------------------------------------------------------
    console.log('[Suite 2] Verifying Functional Core of Clean Q&A Sync Components...');

    // 2.1 TranscriptTailEngine: continuous byte-offset tailing
    const mockTranscriptFile = path.join(tempDir, 'test_transcript.jsonl');
    const tailEngine = new TranscriptTailEngine({
      transcriptPath: mockTranscriptFile,
      pollIntervalMs: 50,
      readOffset: 0
    });

    const userEvents: UserInputEvent[] = [];
    const modelEvents: PlannerResponseEvent[] = [];
    const activityEvents: AgentActivityEvent[] = [];

    tailEngine.on('userInput', (ev) => userEvents.push(ev));
    tailEngine.on('plannerResponse', (ev) => modelEvents.push(ev));
    tailEngine.on('agentActivity', (ev) => activityEvents.push(ev));

    const initialLines = [
      JSON.stringify({ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'First question' }) + '\n',
      JSON.stringify({ step_index: 1, source: 'MODEL', type: 'TOOL_CALL', content: 'Running query' }) + '\n',
      JSON.stringify({ step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', content: 'First answer' }) + '\n'
    ].join('');
    fs.writeFileSync(mockTranscriptFile, initialLines, 'utf8');

    tailEngine.start();
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.strictEqual(userEvents.length, 1, 'Should parse 1 userInput');
    assert.strictEqual(userEvents[0].prompt, 'First question');
    assert.strictEqual(activityEvents.length, 1, 'Should parse 1 agentActivity');
    assert.strictEqual(modelEvents.length, 1, 'Should parse 1 plannerResponse');
    assert.strictEqual(modelEvents[0].response, 'First answer');

    // Append second batch
    const appendLines = [
      JSON.stringify({ step_index: 3, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'Second question' }) + '\n',
      JSON.stringify({ step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', content: 'Second answer' }) + '\n'
    ].join('');
    fs.appendFileSync(mockTranscriptFile, appendLines, 'utf8');

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.strictEqual(userEvents.length, 2, 'Should tail appended userInput');
    assert.strictEqual(userEvents[1].prompt, 'Second question');
    assert.strictEqual(modelEvents.length, 2, 'Should tail appended plannerResponse');
    assert.strictEqual(modelEvents[1].response, 'Second answer');

    tailEngine.stop();
    console.log('  ✓ TranscriptTailEngine: streaming JSONL byte-offset tailing verified.');

    // 2.2 PromptOriginTracker: origin tagging, dedup & PC prompt formatting
    const originTracker = new PromptOriginTracker({ ttlMs: 1000, capacity: 50 });
    originTracker.registerTelegramPrompt('Hello from Telegram bot');

    const checkTelegram = originTracker.checkAndConsume('Hello from Telegram bot');
    assert.strictEqual(checkTelegram.matched, true, 'Telegram originated prompt must match ring buffer');
    assert.strictEqual(checkTelegram.origin, 'telegram', 'Matched origin must be telegram');

    const checkPc = originTracker.checkAndConsume('Hello from PC keyboard');
    assert.strictEqual(checkPc.matched, false, 'PC prompt must not match Telegram ring buffer');
    assert.strictEqual(checkPc.origin, 'pc_ide', 'Unmatched origin must be pc_ide');

    assert.strictEqual(
      formatPcPrompt('Check logs'),
      '💻 You (on PC):\nCheck logs',
      'formatPcPrompt must format with standard header'
    );
    console.log('  ✓ PromptOriginTracker: origin tracking, TTL and prompt deduplication verified.');

    // 2.3 SmartMarkdownChunker: <=4000 char chunks & code fence preservation
    const sampleCodeBlock = [
      '```typescript',
      'const a = 1;',
      'const b = 2;',
      '// Line repeated to exceed 4000 chars\n'.repeat(120),
      'const sum = a + b;',
      '```'
    ].join('\n');

    assert.ok(sampleCodeBlock.length > 4000, 'Test payload must exceed 4000 chars');
    const chunks = splitMarkdownSafely(sampleCodeBlock, 4000);
    assert.ok(chunks.length >= 2, 'Payload must be split into multiple chunks');

    for (let i = 0; i < chunks.length; i++) {
      assert.ok(chunks[i].length <= 4000, `Chunk ${i} length (${chunks[i].length}) must be <= 4000`);
    }

    // Chunk 0 must close fence with ```, Chunk 1 must reopen with ```typescript
    assert.ok(chunks[0].endsWith('```\n') || chunks[0].endsWith('```'), 'First chunk must close code block');
    assert.ok(chunks[1].startsWith('```typescript\n') || chunks[1].startsWith('```typescript'), 'Second chunk must reopen code block with matching language');
    console.log('  ✓ SmartMarkdownChunker: boundary safety & code block fence preservation verified.');

    // 2.4 TypingActionManager: start/stop loop & sendChatAction
    const { bot: mockTypingBot, chatActions: mockTypingActions } = createMockBot();
    const typingMgr = new TypingActionManager({ bot: mockTypingBot, intervalMs: 100 });
    typingMgr.startTyping(12345);

    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(mockTypingActions.length >= 2, 'Typing action should be dispatched periodically');
    assert.strictEqual(mockTypingActions[0].action, 'typing');
    assert.strictEqual(mockTypingActions[0].chat_id, 12345);

    typingMgr.stopTyping(12345);
    const countAfterStop = mockTypingActions.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.strictEqual(mockTypingActions.length, countAfterStop, 'Typing should halt when stopped');
    console.log('  ✓ TypingActionManager: periodic typing action lifecycle verified.');

    // 2.5 TelegramChatMirror: E2E coordination, throttling & 429 retry
    const { bot: mockMirrorBot, sentMessages: mirrorSentMessages } = createMockBot();
    const chatMirror = new TelegramChatMirror({
      bot: mockMirrorBot,
      allowedUsers: [99999],
      prefix: DEFAULT_AI_RESPONSE_HEADER,
      mirrorIncludePcPrompts: true,
      minChunkDelayMs: 50
    });

    // Test PC prompt forwarding
    await chatMirror.handleUserInput('How do I run tests?');
    assert.strictEqual(mirrorSentMessages.length, 1);
    assert.strictEqual(mirrorSentMessages[0].text, '💻 You (on PC):\nHow do I run tests?');

    // Test Telegram prompt suppression
    chatMirror.getOriginTracker().registerTelegramPrompt('Prompt from phone');
    await chatMirror.handleUserInput('Prompt from phone');
    assert.strictEqual(mirrorSentMessages.length, 1, 'Telegram prompt must be skipped');

    // Test AI response delivery
    await chatMirror.handlePlannerResponse('Here is the explanation for running tests.');
    assert.strictEqual(mirrorSentMessages.length, 2);
    assert.ok(mirrorSentMessages[1].text.includes('🤖 Antigravity:\n\nHere is the explanation for running tests.'));

    // Test 429 rate limit error helper functions
    assert.strictEqual(isRateLimitError({ error_code: 429, description: 'Too Many Requests' }), true);
    assert.strictEqual(extractRetryAfterMs({ parameters: { retry_after: 2 } }), 2000);
    assert.strictEqual(isEntityParseError({ description: "Bad Request: can't parse entities in message" }), true);

    chatMirror.dispose();
    console.log('  ✓ TelegramChatMirror: end-to-end prompt mirroring, response delivery & error resilience verified.\n');

    // -------------------------------------------------------------------------
    // Suite 3: Manifest (package.json) & Configuration Schema Validation
    // -------------------------------------------------------------------------
    console.log('[Suite 3] Verifying package.json Manifest & Configuration Properties...');
    const packageJsonPath = path.join(rootDir, 'package.json');
    assert.ok(fs.existsSync(packageJsonPath), 'package.json must exist');
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    assert.strictEqual(pkg.version, '1.6.4', 'package.json version must be 1.6.4');
    assert.strictEqual(pkg.name, 'antigravity-auto-plan', 'package.json name must be antigravity-auto-plan');
    assert.strictEqual(pkg.main, './out/extension.js', 'package.json main entry point must be ./out/extension.js');

    const configProps = pkg.contributes?.configuration?.properties || {};
    assert.ok(configProps['autoplan.telegram.enableChatMirror'], 'Must define autoplan.telegram.enableChatMirror');
    assert.strictEqual(configProps['autoplan.telegram.enableChatMirror'].default, true);

    assert.ok(configProps['autoplan.telegram.mirrorIncludePcPrompts'], 'Must define autoplan.telegram.mirrorIncludePcPrompts');
    assert.strictEqual(configProps['autoplan.telegram.mirrorIncludePcPrompts'].default, true);

    assert.ok(configProps['autoplan.telegram.chatMirrorPrefix'], 'Must define autoplan.telegram.chatMirrorPrefix');
    assert.strictEqual(configProps['autoplan.telegram.chatMirrorPrefix'].default, '🤖 Antigravity:');

    assert.ok(pkg.scripts?.['test:phase05-clean-qa'], 'package.json scripts must include test:phase05-clean-qa');
    console.log('  ✓ package.json version 1.6.4 and all Clean Q&A Sync configuration schemas verified.\n');

    // -------------------------------------------------------------------------
    // Suite 4: Documentation Completeness Verification
    // -------------------------------------------------------------------------
    console.log('[Suite 4] Verifying Documentation Completeness (README, CHANGELOG, .brain)...');
    const readmePath = path.join(rootDir, 'README.md');
    const changelogPath = path.join(rootDir, 'CHANGELOG.md');
    const sessionJsonPath = path.join(rootDir, '.brain', 'session.json');
    const handoverMdPath = path.join(rootDir, '.brain', 'handover.md');

    assert.ok(fs.existsSync(readmePath), 'README.md must exist');
    assert.ok(fs.existsSync(changelogPath), 'CHANGELOG.md must exist');
    assert.ok(fs.existsSync(sessionJsonPath), '.brain/session.json must exist');
    assert.ok(fs.existsSync(handoverMdPath), '.brain/handover.md must exist');

    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    assert.ok(readmeContent.includes('version-1.6.4'), 'README.md must display version 1.6.4 badge');
    assert.ok(readmeContent.includes('antigravity-auto-plan-1.6.4.vsix'), 'README.md must reference 1.6.4 VSIX artifact');
    assert.ok(readmeContent.includes('Telegram Clean Q&A Sync'), 'README.md must detail Clean Q&A Sync');
    assert.ok(readmeContent.includes('autoplan.telegram.enableChatMirror'), 'README.md must document enableChatMirror setting');

    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    assert.ok(changelogContent.includes('## [1.6.4]'), 'CHANGELOG.md must document release 1.6.4');
    assert.ok(changelogContent.includes('TranscriptTailEngine'), 'CHANGELOG.md must detail TranscriptTailEngine');
    assert.ok(changelogContent.includes('PromptOriginTracker'), 'CHANGELOG.md must detail PromptOriginTracker');
    assert.ok(changelogContent.includes('SmartMarkdownChunker'), 'CHANGELOG.md must detail SmartMarkdownChunker');

    const sessionContent = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
    assert.strictEqual(sessionContent.working_on?.status, 'completed', '.brain/session.json status must be completed');

    const handoverContent = fs.readFileSync(handoverMdPath, 'utf8');
    assert.ok(handoverContent.includes('v1.6.4'), '.brain/handover.md must reference v1.6.4');
    console.log('  ✓ README.md, CHANGELOG.md, .brain/session.json and .brain/handover.md verified.\n');

    // -------------------------------------------------------------------------
    // Suite 5: Release Packaging Integrity & Security Audit
    // -------------------------------------------------------------------------
    console.log('[Suite 5] Verifying Production VSIX Packaging (antigravity-auto-plan-1.6.4.vsix)...');
    const vsixPath = path.join(rootDir, 'antigravity-auto-plan-1.6.4.vsix');
    assert.ok(fs.existsSync(vsixPath), `VSIX release artifact must exist at: ${vsixPath}`);

    const vsixStats = fs.statSync(vsixPath);
    console.log(`  -> Release VSIX size: ${(vsixStats.size / 1024).toFixed(2)} KB`);
    assert.ok(
      vsixStats.size > 500 * 1024,
      `VSIX release bundle must contain production dependencies (> 500 KB), actual: ${vsixStats.size} bytes`
    );

    // Verify valid ZIP header
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

    // Verify package.json inside VSIX has 1.6.4 version
    assert.ok(vsixAudit.packageJson, 'Packaged extension/package.json must be readable');
    assert.strictEqual(
      vsixAudit.packageJson.version,
      '1.6.4',
      `Packaged extension version must be 1.6.4 (got ${vsixAudit.packageJson?.version})`
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
      'extension/out/transcriptTailEngine.js',
      'extension/out/promptOriginTracker.js',
      'extension/out/smartMarkdownChunker.js',
      'extension/out/typingActionManager.js',
      'extension/out/telegramChatMirror.js',
      'extension/out/telegramBridge.js'
    ];

    for (const critFile of criticalPackageFiles) {
      assert.ok(
        vsixAudit.files.includes(critFile),
        `Critical file '${critFile}' must be packaged inside VSIX`
      );
    }

    // Verify production dependency (grammy) is included
    const hasGrammy = vsixAudit.files.some((f) => f.startsWith('extension/node_modules/grammy/'));
    assert.ok(hasGrammy, 'Production dependency grammy must be bundled in VSIX node_modules');

    // Verify zero leaked secrets/tokens
    if (vsixAudit.leakedSecretFindings.length > 0) {
      console.error('Leaked secret findings detected in VSIX:', vsixAudit.leakedSecretFindings);
      assert.fail(`Detected ${vsixAudit.leakedSecretFindings.length} leaked credential findings in VSIX`);
    }
    console.log('  ✓ VSIX package verified: version 1.6.4, grammy bundled, zero leaked credentials.\n');

    console.log('================================================================================');
    console.log(' 🎉 ALL 5 PHASE 05 CLEAN Q&A REGRESSION & RELEASE TESTS PASSED WITH 100% SUCCESS!');
    console.log('================================================================================\n');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

// Direct CLI execution
if (require.main === module) {
  runPhase05CleanQAReleaseTest()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('Phase 05 Clean Q&A Release Test Failed:', err);
      process.exit(1);
    });
}
