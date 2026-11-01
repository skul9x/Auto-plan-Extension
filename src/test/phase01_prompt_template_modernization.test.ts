// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceConfig: Record<string, any> = {};

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

const postedMessages: any[] = [];

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import {
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_COMPLETION_KEYWORD,
  DEFAULT_CONFIG,
  getConfig,
  interpolatePromptTemplate
} from '../config';
import { renderPromptTemplate } from '../planScanner';
import { SettingsProvider } from '../settingsProvider';

async function runPhase01Tests() {
  console.log('=== Running Phase 01: Prompt Template Modernization & Schema Defaults Tests ===\n');

  const rootDir = path.resolve(__dirname, '../../');
  const newPromptPath = path.join(rootDir, 'newprompt.txt');
  const packageJsonPath = path.join(rootDir, 'package.json');
  const settingsHtmlPath = path.join(rootDir, 'media/settings/settings.html');
  const settingsJsPath = path.join(rootDir, 'media/settings/settings.js');

  // =========================================================================
  // Part 1: Core Configuration Synchronization with newprompt.txt
  // =========================================================================
  console.log('[Part 1] Validating DEFAULT_PROMPT_TEMPLATE against newprompt.txt...');

  assert.ok(fs.existsSync(newPromptPath), 'newprompt.txt must exist at workspace root');
  const newPromptExpected = fs.readFileSync(newPromptPath, 'utf8').trim();

  assert.ok(newPromptExpected.length > 500, 'newprompt.txt content must be substantial');
  assert.strictEqual(
    DEFAULT_PROMPT_TEMPLATE.trim(),
    newPromptExpected,
    'DEFAULT_PROMPT_TEMPLATE in src/config.ts must match newprompt.txt exactly'
  );

  // Validate DEFAULT_CONFIG references
  assert.strictEqual(
    DEFAULT_CONFIG.promptTemplate,
    DEFAULT_PROMPT_TEMPLATE,
    'DEFAULT_CONFIG.promptTemplate must reference DEFAULT_PROMPT_TEMPLATE'
  );
  assert.strictEqual(
    DEFAULT_CONFIG.defaultPromptTemplate,
    DEFAULT_PROMPT_TEMPLATE,
    'DEFAULT_CONFIG.defaultPromptTemplate must reference DEFAULT_PROMPT_TEMPLATE'
  );
  assert.strictEqual(
    DEFAULT_CONFIG.promptText,
    DEFAULT_PROMPT_TEMPLATE,
    'DEFAULT_CONFIG.promptText must reference DEFAULT_PROMPT_TEMPLATE'
  );

  // Validate completion keyword
  assert.strictEqual(
    DEFAULT_COMPLETION_KEYWORD,
    'Done skul9x.',
    'DEFAULT_COMPLETION_KEYWORD must remain "Done skul9x."'
  );
  assert.strictEqual(
    DEFAULT_CONFIG.completionKeyword,
    'Done skul9x.',
    'DEFAULT_CONFIG.completionKeyword must remain "Done skul9x."'
  );

  // Validate 5-step numbered structure and protocol phrases
  assert.ok(DEFAULT_PROMPT_TEMPLATE.includes('{xxx}'), 'Template must include {xxx} placeholder');
  assert.ok(DEFAULT_PROMPT_TEMPLATE.includes('1. First, read the provided phase file'), 'Must include Step 1');
  assert.ok(DEFAULT_PROMPT_TEMPLATE.includes('2. After at least 1 minute has elapsed, search online'), 'Must include Step 2');
  assert.ok(DEFAULT_PROMPT_TEMPLATE.includes('3. Use the research findings together with the existing codebase'), 'Must include Step 3');
  assert.ok(DEFAULT_PROMPT_TEMPLATE.includes('4. After implementation, run exactly ONE comprehensive file-based test'), 'Must include Step 4');
  assert.ok(DEFAULT_PROMPT_TEMPLATE.includes('5. Only after implementation is complete and the required test passes'), 'Must include Step 5');
  assert.ok(DEFAULT_PROMPT_TEMPLATE.includes('Done skul9x.'), 'Template must terminate with completion phrase "Done skul9x."');

  console.log('  ✓ Core configuration synchronization passed.');

  // =========================================================================
  // Part 2: VS Code Manifest Defaults (package.json)
  // =========================================================================
  console.log('[Part 2] Validating package.json schema configuration defaults...');

  assert.ok(fs.existsSync(packageJsonPath), 'package.json must exist');
  const pkgContent = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const configProperties = pkgContent.contributes.configuration.properties;

  assert.ok(configProperties['autoplan.defaultPromptTemplate'], 'autoplan.defaultPromptTemplate must be registered');
  assert.strictEqual(
    configProperties['autoplan.defaultPromptTemplate'].default,
    DEFAULT_PROMPT_TEMPLATE,
    'autoplan.defaultPromptTemplate default in package.json must match DEFAULT_PROMPT_TEMPLATE'
  );

  assert.ok(configProperties['autoplan.promptTemplate'], 'autoplan.promptTemplate must be registered');
  assert.strictEqual(
    configProperties['autoplan.promptTemplate'].default,
    DEFAULT_PROMPT_TEMPLATE,
    'autoplan.promptTemplate default in package.json must match DEFAULT_PROMPT_TEMPLATE'
  );

  assert.strictEqual(
    configProperties['autoplan.completionKeyword'].default,
    'Done skul9x.',
    'autoplan.completionKeyword default must match Done skul9x.'
  );

  console.log('  ✓ package.json schema defaults passed.');

  // =========================================================================
  // Part 3: Dynamic Template Interpolation (interpolatePromptTemplate)
  // =========================================================================
  console.log('[Part 3] Validating prompt interpolation with dynamic placeholders...');

  const samplePhase = 'plans/261022-0555-prompt-template-and-nudge-removal/phase-01-prompt-template-modernization.md';

  // 3A. Interpolation with default template and string path
  const interpolated = interpolatePromptTemplate(DEFAULT_PROMPT_TEMPLATE, samplePhase);
  assert.ok(!interpolated.includes('{xxx}'), 'Interpolated prompt must not retain {xxx}');
  assert.ok(interpolated.includes(samplePhase), 'Interpolated prompt must contain sample phase path');
  assert.ok(interpolated.startsWith('Implement the phase described in the provided phase file ' + samplePhase));
  assert.ok(interpolated.endsWith('Done skul9x.'));
  assert.strictEqual(
    interpolated.length,
    DEFAULT_PROMPT_TEMPLATE.length - '{xxx}'.length + samplePhase.length,
    'Interpolated string length must match expected arithmetic length exactly'
  );

  // 3B. Interpolation with alias renderPromptTemplate in planScanner.ts
  const aliasRendered = renderPromptTemplate(DEFAULT_PROMPT_TEMPLATE, samplePhase);
  assert.strictEqual(aliasRendered, interpolated, 'renderPromptTemplate and interpolatePromptTemplate must produce identical results');

  // 3C. Placeholder aliases ({path}, {file}, {phasepath}, {phasefile})
  const aliasTemplate = 'Path is {path}, File is {file}, PhasePath is {phasePath}, PhaseFile is {phaseFile}';
  const resolvedAliases = interpolatePromptTemplate(aliasTemplate, samplePhase);
  assert.strictEqual(
    resolvedAliases,
    `Path is ${samplePhase}, File is phase-01-prompt-template-modernization.md, PhasePath is ${samplePhase}, PhaseFile is phase-01-prompt-template-modernization.md`
  );

  // 3D. Windows backslash normalization in interpolation
  const windowsPath = 'plans\\windows\\phase-01.md';
  const windowsRendered = interpolatePromptTemplate('Run {xxx}', windowsPath);
  assert.strictEqual(windowsRendered, 'Run plans/windows/phase-01.md', 'Backslashes must be normalized to forward slashes');

  // 3E. Safe handling of special characters (e.g., $ signs in path or template)
  const specialCharsPath = 'plans/$special_dir/phase-$01.md';
  const specialRendered = interpolatePromptTemplate('Target: {xxx}', specialCharsPath);
  assert.strictEqual(specialRendered, 'Target: plans/$special_dir/phase-$01.md', '$ characters must not be misinterpreted as regex captures');

  // 3F. Custom template without placeholders auto-appends path
  const noTagTemplate = 'Custom instruction header';
  const noTagRendered = interpolatePromptTemplate(noTagTemplate, samplePhase);
  assert.strictEqual(noTagRendered, `Custom instruction header\n${samplePhase}`);

  // 3G. Object representation { normalizedPath, fileName }
  const objPhase = {
    normalizedPath: 'plans/test/phase-02.md',
    fileName: 'phase-02.md'
  };
  const objRendered = interpolatePromptTemplate('Run {file} at {path}', objPhase);
  assert.strictEqual(objRendered, 'Run phase-02.md at plans/test/phase-02.md');

  console.log('  ✓ Prompt interpolation logic passed.');

  // =========================================================================
  // Part 4: Settings Provider Fallback and IPC Payload
  // =========================================================================
  console.log('[Part 4] Validating SettingsProvider fallback and IPC message payload...');

  // Reset mock workspace config to empty to test unpopulated fallback
  mockWorkspaceConfig = {};
  const currentCfg = getConfig();
  assert.strictEqual(
    currentCfg.promptTemplate,
    DEFAULT_PROMPT_TEMPLATE,
    'getConfig() must fallback to DEFAULT_PROMPT_TEMPLATE when unpopulated'
  );
  assert.strictEqual(
    currentCfg.defaultPromptTemplate,
    DEFAULT_PROMPT_TEMPLATE,
    'getConfig() must fallback to defaultPromptTemplate default'
  );

  // Test SettingsProvider sendInitSettings
  postedMessages.length = 0;
  const mockWebviewPanel: any = {
    webview: {
      postMessage: (msg: any) => postedMessages.push(msg),
      asWebviewUri: (uri: any) => uri,
      onDidReceiveMessage: () => ({ dispose: () => {} })
    },
    onDidDispose: () => ({ dispose: () => {} }),
    reveal: () => {}
  };

  const provider = new (SettingsProvider as any)(
    mockWebviewPanel,
    { fsPath: rootDir } as any
  );

  provider.sendInitSettings();

  assert.strictEqual(postedMessages.length, 1, 'sendInitSettings must post exactly one message');
  const initMsg = postedMessages[0];
  assert.strictEqual(initMsg.command, 'initSettings');
  assert.strictEqual(
    initMsg.settings.promptTemplate,
    DEFAULT_PROMPT_TEMPLATE,
    'IPC payload settings.promptTemplate must fallback to modernized DEFAULT_PROMPT_TEMPLATE'
  );
  assert.strictEqual(
    initMsg.settings.defaultPromptTemplate,
    DEFAULT_PROMPT_TEMPLATE,
    'IPC payload settings.defaultPromptTemplate must match DEFAULT_PROMPT_TEMPLATE'
  );

  console.log('  ✓ SettingsProvider fallback and IPC payload verified.');

  // =========================================================================
  // Part 5: Settings HTML and JS Assets Verification
  // =========================================================================
  console.log('[Part 5] Validating Settings Webview HTML & JS bindings...');

  const htmlContent = fs.readFileSync(settingsHtmlPath, 'utf8');
  assert.ok(htmlContent.includes('id="txtPromptTemplate"'), 'settings.html must contain txtPromptTemplate');
  assert.ok(htmlContent.includes('id="btnInsertXxx"'), 'settings.html must contain btnInsertXxx');
  assert.ok(htmlContent.includes('id="btnInsertFile"'), 'settings.html must contain btnInsertFile');
  assert.ok(htmlContent.includes('id="btnInsertPath"'), 'settings.html must contain btnInsertPath');
  assert.ok(htmlContent.includes('id="txtCompletionKeyword"'), 'settings.html must contain txtCompletionKeyword');

  const jsContent = fs.readFileSync(settingsJsPath, 'utf8');
  assert.ok(
    jsContent.includes('config.defaultPromptTemplate'),
    'settings.js must check config.defaultPromptTemplate as a fallback for prompt template'
  );

  console.log('  ✓ Webview HTML & JS bindings verified.');

  console.log('\n=======================================================');
  console.log('✓ All Phase 01 Prompt Template Modernization tests PASSED!');
  console.log('=======================================================\n');
}

runPhase01Tests().catch((err) => {
  console.error('\n❌ Phase 01 Test Failed:', err);
  process.exit(1);
});
