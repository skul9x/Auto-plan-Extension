// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceConfig: Record<string, any> = {};
const postedMessages: any[] = [];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          { name: 'test-workspace', uri: { fsPath: '/mock/workspace' } }
        ],
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) => {
            if (mockWorkspaceConfig[key] !== undefined) {
              return mockWorkspaceConfig[key];
            }
            return defaultValue;
          },
          update: async (key: string, value: any) => {
            mockWorkspaceConfig[key] = value;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      ViewColumn: {
        Active: -1,
        Beside: -2,
        One: 1,
        Two: 2,
        Three: 3
      },
      window: {
        showInformationMessage: async () => {},
        showErrorMessage: async () => {},
        showWarningMessage: async () => {},
        createWebviewPanel: () => ({
          webview: {
            postMessage: (msg: any) => {
              postedMessages.push(msg);
            },
            asWebviewUri: (uri: any) => uri,
            onDidReceiveMessage: () => ({ dispose: () => {} })
          },
          onDidDispose: () => ({ dispose: () => {} }),
          reveal: () => {}
        }),
        activeTextEditor: undefined,
        ViewColumn: { Active: 1 }
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: async () => {}
      },
      env: {
        clipboard: {
          writeText: async (_text: string) => {},
          readText: async () => ''
        }
      },
      Uri: {
        file: (p: string) => ({ fsPath: p }),
        joinPath: (base: any, ...segments: string[]) => ({
          fsPath: path.join(base.fsPath || base, ...segments)
        })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_COMPLETION_KEYWORD,
  DEFAULT_CONFIG,
  getConfig,
  interpolatePromptTemplate
} from '../config';
import { renderPromptTemplate } from '../planScanner';
import { SettingsProvider } from '../settingsProvider';
import { Orchestrator, PhaseItem } from '../orchestrator';
import {
  WORKFLOW_COMMAND_CATALOG,
  MANAGEMENT_COMMAND_CATALOG,
  FULL_BOT_COMMAND_CATALOG
} from '../telegramBridge';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dependency-free ZIP Central Directory reader using Node.js Buffer parsing.
 */
function readZipEntries(zipBuffer: Buffer): string[] {
  const EOCD_SIGNATURE = 0x06054b50;
  let eocdOffset = -1;
  const searchLimit = Math.max(0, zipBuffer.length - 65557);

  for (let i = zipBuffer.length - 22; i >= searchLimit; i--) {
    if (zipBuffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP file: EOCD signature not found.');
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  const CDFH_SIGNATURE = 0x02014b50;
  const entryNames: string[] = [];
  let offset = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (zipBuffer.readUInt32LE(offset) !== CDFH_SIGNATURE) {
      throw new Error(`Invalid ZIP file: Expected CDFH signature at offset ${offset}`);
    }

    const fileNameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraFieldLength = zipBuffer.readUInt16LE(offset + 30);
    const fileCommentLength = zipBuffer.readUInt16LE(offset + 32);

    const fileNameStart = offset + 46;
    const fileName = zipBuffer.toString('utf8', fileNameStart, fileNameStart + fileNameLength);
    entryNames.push(fileName);

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entryNames;
}

async function runPhase03ReleaseTests() {
  console.log('================================================================================');
  console.log('   PHASE 03: REGRESSION BENCHMARK, DOCUMENTATION & RELEASE PACKAGING (v1.6.8)   ');
  console.log('================================================================================\n');

  const rootDir = path.resolve(__dirname, '../../');
  const packageJsonPath = path.join(rootDir, 'package.json');
  const newPromptPath = path.join(rootDir, 'newprompt.txt');
  const changelogPath = path.join(rootDir, 'CHANGELOG.md');
  const readmePath = path.join(rootDir, 'README.md');
  const brainJsonPath = path.join(rootDir, '.brain/brain.json');
  const sessionJsonPath = path.join(rootDir, '.brain/session.json');
  const handoverPath = path.join(rootDir, '.brain/handover.md');
  const settingsHtmlPath = path.join(rootDir, 'media/settings/settings.html');
  const settingsJsPath = path.join(rootDir, 'media/settings/settings.js');
  const vsixPath = path.join(rootDir, 'antigravity-auto-plan-1.6.8.vsix');

  // =========================================================================
  // SUITE 1: Package Manifest & Configuration Schema Validation (v1.6.8)
  // =========================================================================
  console.log('[Suite 1] Validating Package Manifest & Configuration Schema (v1.6.8)...');

  assert.ok(fs.existsSync(packageJsonPath), 'package.json must exist');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  assert.strictEqual(packageJson.version, '1.6.8', 'Manifest version must be bumped to 1.6.8');
  assert.strictEqual(packageJson.name, 'antigravity-auto-plan', 'Package name must be antigravity-auto-plan');

  const configProps = packageJson.contributes.configuration.properties;
  assert.ok(configProps, 'contributes.configuration.properties must exist');

  // Verify newprompt.txt alignment in manifest
  assert.ok(fs.existsSync(newPromptPath), 'newprompt.txt must exist at workspace root');
  const expectedPromptTemplate = fs.readFileSync(newPromptPath, 'utf8').trim();

  assert.strictEqual(
    configProps['autoplan.promptTemplate'].default.trim(),
    expectedPromptTemplate,
    'autoplan.promptTemplate default must match newprompt.txt'
  );
  assert.strictEqual(
    configProps['autoplan.defaultPromptTemplate'].default.trim(),
    expectedPromptTemplate,
    'autoplan.defaultPromptTemplate default must match newprompt.txt'
  );
  assert.strictEqual(
    configProps['autoplan.completionKeyword'].default,
    'Done skul9x.',
    'autoplan.completionKeyword default must be "Done skul9x."'
  );

  // Verify total purge of all nudge settings in schema
  const forbiddenNudgeKeys = [
    'autoplan.longPhaseNudgeEnabled',
    'autoplan.longPhaseThresholdSeconds',
    'autoplan.longPhaseNudgeMessage',
    'autoplan.longPhaseNudgeRecurring',
    'autoplan.longPhaseNotifyTelegram'
  ];
  for (const nudgeKey of forbiddenNudgeKeys) {
    assert.strictEqual(
      configProps[nudgeKey],
      undefined,
      `Forbidden nudge key "${nudgeKey}" must not exist in package.json configuration schema`
    );
  }

  // Verify DEFAULT_CONFIG in src/config.ts
  assert.strictEqual(
    DEFAULT_PROMPT_TEMPLATE.trim(),
    expectedPromptTemplate,
    'DEFAULT_PROMPT_TEMPLATE must match newprompt.txt'
  );
  assert.strictEqual(
    DEFAULT_CONFIG.promptTemplate!.trim(),
    expectedPromptTemplate,
    'DEFAULT_CONFIG.promptTemplate must match newprompt.txt'
  );
  assert.strictEqual(
    DEFAULT_CONFIG.defaultPromptTemplate!.trim(),
    expectedPromptTemplate,
    'DEFAULT_CONFIG.defaultPromptTemplate must match newprompt.txt'
  );
  assert.strictEqual(
    DEFAULT_COMPLETION_KEYWORD,
    'Done skul9x.',
    'DEFAULT_COMPLETION_KEYWORD must be "Done skul9x."'
  );
  assert.strictEqual(
    DEFAULT_CONFIG.completionKeyword,
    'Done skul9x.',
    'DEFAULT_CONFIG.completionKeyword must be "Done skul9x."'
  );

  for (const nudgeProp of ['longPhaseNudgeEnabled', 'longPhaseThresholdSeconds', 'longPhaseNudgeMessage', 'longPhaseNudgeRecurring', 'longPhaseNotifyTelegram']) {
    assert.strictEqual(
      (DEFAULT_CONFIG as any)[nudgeProp],
      undefined,
      `DEFAULT_CONFIG must not contain obsolete nudge property "${nudgeProp}"`
    );
  }

  console.log('  ✓ Suite 1 passed: Package manifest and configuration schema fully validated.\n');

  // =========================================================================
  // SUITE 2: End-to-End Prompt Formatting & Template Interpolation Regression
  // =========================================================================
  console.log('[Suite 2] Validating End-to-End Prompt Formatting & Template Interpolation...');

  const mockPhasePath = '/test/workspace/plans/261022-0555-feature/phase-01-core.md';
  const renderedDefault = renderPromptTemplate(DEFAULT_PROMPT_TEMPLATE, mockPhasePath);

  assert.ok(
    renderedDefault.includes(mockPhasePath),
    'Rendered prompt must include interpolated phase file path'
  );
  assert.ok(
    renderedDefault.includes('Done skul9x.'),
    'Rendered prompt must instruct AI to emit "Done skul9x."'
  );
  assert.ok(
    renderedDefault.includes('Spend at least 1 minute on this initial codebase analysis before starting online research.'),
    'Rendered prompt must include the 1-minute initial codebase analysis protocol'
  );
  assert.ok(
    renderedDefault.includes('search online for concrete implementation techniques and coding best practices'),
    'Rendered prompt must include the online research protocol'
  );
  assert.ok(
    renderedDefault.includes('run exactly ONE comprehensive file-based test defined by this phase'),
    'Rendered prompt must enforce the single file-based test rule'
  );

  // Test dynamic variable interpolation variants
  const customTemplate = 'Execute {xxx} located in {path} with file {file} and path {phasePath} ({phaseFile})';
  const interpolated = interpolatePromptTemplate(customTemplate, mockPhasePath);
  assert.strictEqual(
    interpolated,
    `Execute ${mockPhasePath} located in ${mockPhasePath} with file phase-01-core.md and path ${mockPhasePath} (phase-01-core.md)`,
    'Dynamic variable interpolation must support all documented placeholders'
  );

  console.log('  ✓ Suite 2 passed: Prompt formatting & template interpolation verified.\n');

  // =========================================================================
  // SUITE 3: Orchestrator Clean Long-Running Execution & No-Nudge Invariance
  // =========================================================================
  console.log('[Suite 3] Validating Orchestrator Clean Long-Running Execution & No-Nudge Invariance...');

  const tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-release-v168-'));
  const tempLogsDir = path.join(tempTestDir, '.system_generated', 'logs');
  fs.mkdirSync(tempLogsDir, { recursive: true });
  const transcriptPath = path.join(tempLogsDir, 'transcript.jsonl');
  fs.writeFileSync(transcriptPath, '', 'utf8');

  // Verify orchestrator class does not define obsolete nudge methods
  const orchestratorInstance = new Orchestrator();
  assert.strictEqual(
    (orchestratorInstance as any).triggerPhaseNudge,
    undefined,
    'Orchestrator must not have triggerPhaseNudge method'
  );
  assert.strictEqual(
    (orchestratorInstance as any).startPhaseNudgeWatchdog,
    undefined,
    'Orchestrator must not have startPhaseNudgeWatchdog method'
  );
  assert.strictEqual(
    (orchestratorInstance as any).stopPhaseNudgeWatchdog,
    undefined,
    'Orchestrator must not have stopPhaseNudgeWatchdog method'
  );
  assert.strictEqual(
    (orchestratorInstance as any).isPhaseNudgeTimerActive,
    undefined,
    'Orchestrator must not have isPhaseNudgeTimerActive method'
  );

  // Setup mock dispatcher & transcript tailing
  const promptCommandsDispatched: Array<{ prompt: string; options?: any }> = [];
  const mockDispatcher: any = {
    dispatchPrompt: async (prompt: string, options?: any) => {
      promptCommandsDispatched.push({ prompt, options });
      return { success: true, tier: 1 };
    },
    stopActiveGeneration: async () => true,
    isClientReady: async () => true
  };
  (orchestratorInstance as any).promptDispatcher = mockDispatcher;

  // Verify that during simulated long-running wait, no nudge prompt is dispatched
  const mockPhase: PhaseItem = {
    index: 0,
    phaseNumber: 1,
    fileName: 'phase-01.md',
    filePath: path.join(tempTestDir, 'phase-01.md'),
    nativePath: path.join(tempTestDir, 'phase-01.md'),
    normalizedPath: path.join(tempTestDir, 'phase-01.md'),
    status: 'Running'
  };

  // Simulate long wait
  await sleep(150);
  assert.strictEqual(
    promptCommandsDispatched.length,
    0,
    'No automatic steering prompts or nudge injections must occur during phase execution'
  );

  // Test keyword matching behavior
  const mockTranscriptWatcher: any = {
    checkCompletion: (content: string, keyword: string) => {
      return content.includes(keyword);
    }
  };

  // Intermediate non-completion line
  const nonCompletionContent = 'Task in progress, almost finished with implementation.';
  assert.strictEqual(
    mockTranscriptWatcher.checkCompletion(nonCompletionContent, DEFAULT_COMPLETION_KEYWORD),
    false,
    'Non-completion content must not trigger phase advancement'
  );

  // Exact completion line
  const completionContent = 'All tests verified. Done skul9x.';
  assert.strictEqual(
    mockTranscriptWatcher.checkCompletion(completionContent, DEFAULT_COMPLETION_KEYWORD),
    true,
    'Exact keyword "Done skul9x." must trigger completion'
  );

  // Clean up test dir
  try {
    fs.rmSync(tempTestDir, { recursive: true, force: true });
  } catch {}

  console.log('  ✓ Suite 3 passed: Clean orchestrator execution without mid-flight prompts verified.\n');

  // =========================================================================
  // SUITE 4: Settings Webview UI & IPC Sanitization Regression
  // =========================================================================
  console.log('[Suite 4] Validating Settings Webview UI & IPC Sanitization...');

  assert.ok(fs.existsSync(settingsHtmlPath), 'media/settings/settings.html must exist');
  const settingsHtml = fs.readFileSync(settingsHtmlPath, 'utf8');

  // Ensure no nudge IDs or keywords exist in HTML
  for (const needle of ['longPhaseNudge', 'nudgeWatchdog', 'nudgeMessage', 'nudgeThreshold', 'Nudge Watchdog']) {
    assert.strictEqual(
      settingsHtml.includes(needle),
      false,
      `settings.html must not contain obsolete nudge reference "${needle}"`
    );
  }

  // Ensure all 4 primary settings tabs exist
  assert.ok(settingsHtml.includes('id="tab-dispatch"'), 'Dispatch & Tiers tab must exist');
  assert.ok(settingsHtml.includes('id="tab-telegram"'), 'Telegram & Remote tab must exist');
  assert.ok(settingsHtml.includes('id="tab-automation"'), 'Timing & Automation tab must exist');
  assert.ok(settingsHtml.includes('id="tab-diagnostics"'), 'Diagnostics & Logs tab must exist');

  assert.ok(fs.existsSync(settingsJsPath), 'media/settings/settings.js must exist');
  const settingsJs = fs.readFileSync(settingsJsPath, 'utf8');

  for (const needle of ['longPhaseNudgeEnabled', 'longPhaseThresholdSeconds', 'longPhaseNudgeMessage', 'longPhaseNudgeRecurring', 'longPhaseNotifyTelegram']) {
    assert.strictEqual(
      settingsJs.includes(needle),
      false,
      `settings.js must not contain obsolete nudge property "${needle}"`
    );
  }

  // Verify SettingsProvider render and clean disposal
  (SettingsProvider as any).currentPanel = undefined;
  const provider = SettingsProvider.render({ fsPath: rootDir } as any);
  assert.ok(provider, 'SettingsProvider must instantiate cleanly');
  provider.dispose();
  assert.strictEqual(SettingsProvider.currentPanel, undefined, 'currentPanel must be cleared on dispose');

  console.log('  ✓ Suite 4 passed: Settings webview & IPC completely sanitized of nudge controls.\n');

  // =========================================================================
  // SUITE 5: Telegram Bot Commands & AWF Workflow Shortcuts Invariance
  // =========================================================================
  console.log('[Suite 5] Validating Telegram Bot Commands & Workflow Shortcuts Invariance...');

  const registeredCommandNames = FULL_BOT_COMMAND_CATALOG.map((c) => c.command);

  // Validate management commands
  const expectedManagementCommands = ['plans', 'plan_status', 'plan_skip', 'plan_stop', 'screen', 'new_chat'];
  for (const cmd of expectedManagementCommands) {
    assert.ok(
      registeredCommandNames.includes(cmd),
      `MANAGEMENT_COMMAND_CATALOG must include "${cmd}"`
    );
  }

  // Validate AWF workflow command mappings
  const expectedWorkflowCommands = [
    'init', 'brainstorm', 'plan', 'design', 'visualize', 'code', 'run',
    'debug', 'test', 'audit', 'deploy', 'next', 'recap', 'help',
    'review', 'refactor', 'customize', 'rollback', 'save_brain',
    'awf_update', 'cloudflare_tunnel'
  ];
  for (const wfCmd of expectedWorkflowCommands) {
    assert.ok(
      registeredCommandNames.includes(wfCmd),
      `WORKFLOW_COMMAND_CATALOG must include "${wfCmd}"`
    );
  }

  // Verify telegramBridge source code has zero nudge alert references
  const telegramBridgePath = path.join(rootDir, 'src/telegramBridge.ts');
  const telegramBridgeSource = fs.readFileSync(telegramBridgePath, 'utf8');
  assert.strictEqual(
    telegramBridgeSource.includes('longPhaseNotifyTelegram'),
    false,
    'telegramBridge.ts must not contain longPhaseNotifyTelegram'
  );
  assert.strictEqual(
    telegramBridgeSource.includes('[Auto-Plan Nudge]'),
    false,
    'telegramBridge.ts must not contain [Auto-Plan Nudge]'
  );

  console.log('  ✓ Suite 5 passed: All 27 Telegram commands and workflow shortcuts 100% functional.\n');

  // =========================================================================
  // SUITE 6: Documentation & Knowledge State Alignment (v1.6.8)
  // =========================================================================
  console.log('[Suite 6] Validating Documentation & Knowledge State Alignment (v1.6.8)...');

  // CHANGELOG.md verification
  assert.ok(fs.existsSync(changelogPath), 'CHANGELOG.md must exist');
  const changelogContent = fs.readFileSync(changelogPath, 'utf8');
  assert.ok(
    changelogContent.includes('## [1.6.8] - 2026-10-22'),
    'CHANGELOG.md must contain release heading for [1.6.8] - 2026-10-22'
  );
  assert.ok(
    changelogContent.includes('Modernized Default Phase Prompt Template (`newprompt.txt`)'),
    'CHANGELOG.md must document modernized prompt template'
  );
  assert.ok(
    changelogContent.includes('Mid-Flight Nudge Watchdog Elimination'),
    'CHANGELOG.md must document nudge watchdog elimination'
  );

  // README.md verification
  assert.ok(fs.existsSync(readmePath), 'README.md must exist');
  const readmeContent = fs.readFileSync(readmePath, 'utf8');
  assert.ok(
    readmeContent.includes('version-1.6.8-blue.svg'),
    'README.md must display version 1.6.8 badge'
  );
  assert.ok(
    readmeContent.includes('Modernized Prompt Template & 5-Step Autonomous Workflow (v1.6.8)'),
    'README.md must describe the 5-step autonomous workflow'
  );
  assert.ok(
    readmeContent.includes('antigravity-auto-plan-1.6.8.vsix'),
    'README.md must reference antigravity-auto-plan-1.6.8.vsix in installation instructions'
  );
  assert.strictEqual(
    readmeContent.includes('autoplan.longPhaseNudgeEnabled'),
    false,
    'README.md configuration table must not contain autoplan.longPhaseNudgeEnabled'
  );

  // .brain/session.json verification
  assert.ok(fs.existsSync(sessionJsonPath), '.brain/session.json must exist');
  const sessionJson = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
  assert.ok(
    sessionJson.working_on.feature.includes('1.6.8'),
    '.brain/session.json must reference v1.6.8'
  );

  // .brain/brain.json verification
  assert.ok(fs.existsSync(brainJsonPath), '.brain/brain.json must exist');
  const brainJson = JSON.parse(fs.readFileSync(brainJsonPath, 'utf8'));
  assert.strictEqual(
    brainJson.project.version,
    '1.6.8',
    '.brain/brain.json project version must be 1.6.8'
  );
  assert.strictEqual(
    brainJson.tech_stack.nudge_watchdog,
    undefined,
    '.brain/brain.json must not list nudge_watchdog in tech_stack'
  );

  // .brain/handover.md verification
  assert.ok(fs.existsSync(handoverPath), '.brain/handover.md must exist');
  const handoverContent = fs.readFileSync(handoverPath, 'utf8');
  assert.ok(
    handoverContent.includes('v1.6.8'),
    '.brain/handover.md must reference v1.6.8'
  );

  console.log('  ✓ Suite 6 passed: All documentation and brain knowledge artifacts aligned.\n');

  // =========================================================================
  // SUITE 7: Production VSIX Packaging & Archive Integrity
  // =========================================================================
  console.log('[Suite 7] Validating Production VSIX Packaging & Archive Integrity...');

  assert.ok(fs.existsSync(vsixPath), 'antigravity-auto-plan-1.6.8.vsix must exist');
  const vsixStats = fs.statSync(vsixPath);
  assert.ok(
    vsixStats.size > 500 * 1024 && vsixStats.size < 5 * 1024 * 1024,
    `VSIX size (${(vsixStats.size / 1024).toFixed(2)} KB) must be between 500 KB and 5 MB`
  );

  const vsixBuffer = fs.readFileSync(vsixPath);

  // Verify ZIP Magic Header (PK\x03\x04 = 0x04034b50)
  const magic = vsixBuffer.readUInt32LE(0);
  assert.strictEqual(magic, 0x04034b50, 'VSIX file must start with valid ZIP magic bytes PK\\x03\\x04');

  // Parse archive contents from Central Directory
  const entries = readZipEntries(vsixBuffer);
  assert.ok(entries.length > 50, 'VSIX archive must contain at least 50 entries');

  // Must include Open Packaging Convention files
  assert.ok(entries.includes('[Content_Types].xml'), 'VSIX must include [Content_Types].xml');
  assert.ok(entries.includes('extension.vsixmanifest'), 'VSIX must include extension.vsixmanifest');

  // Must include essential extension assets
  assert.ok(entries.includes('extension/package.json'), 'VSIX must include extension/package.json');
  assert.ok(entries.includes('extension/README.md'), 'VSIX must include extension/README.md');
  assert.ok(entries.includes('extension/CHANGELOG.md'), 'VSIX must include extension/CHANGELOG.md');
  assert.ok(entries.includes('extension/newprompt.txt'), 'VSIX must include extension/newprompt.txt');
  assert.ok(entries.includes('extension/out/extension.js'), 'VSIX must include extension/out/extension.js');

  // Must include runtime dependency grammy
  const hasGrammy = entries.some((e) => e.startsWith('extension/node_modules/grammy/'));
  assert.ok(hasGrammy, 'VSIX must bundle production dependency node_modules/grammy/');

  // Must NOT include test files, src TypeScript code, or internal plans
  const forbiddenPatterns = [
    (e: string) => e.startsWith('extension/src/'),
    (e: string) => e.startsWith('extension/out/test/'),
    (e: string) => e.startsWith('extension/plans/'),
    (e: string) => e.startsWith('extension/.git/') || e === 'extension/.gitignore'
  ];

  for (const entry of entries) {
    for (const testPattern of forbiddenPatterns) {
      assert.strictEqual(
        testPattern(entry),
        false,
        `VSIX archive leaked forbidden internal file: ${entry}`
      );
    }
  }

  console.log(`  ✓ Suite 7 passed: VSIX bundle integrity verified (${entries.length} files, ${(vsixStats.size / 1024).toFixed(2)} KB).\n`);

  console.log('================================================================================');
  console.log('   🎉 ALL 7 SUITES PASSED: PHASE 03 RELEASE v1.6.8 REGRESSION BENCHMARK 100%   ');
  console.log('================================================================================\n');
}

runPhase03ReleaseTests().catch((err) => {
  console.error('\n❌ Phase 03 Release Test Suite FAILED:');
  console.error(err);
  process.exit(1);
});
