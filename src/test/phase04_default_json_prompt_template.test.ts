// Standalone mock for 'vscode' module so config.ts and planScanner.ts
// can be tested without an Extension Host.
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockConfigOverrides: Record<string, any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key: string, defaultValue: any) =>
            Object.prototype.hasOwnProperty.call(mockConfigOverrides, key)
              ? mockConfigOverrides[key]
              : defaultValue,
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
import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_CONFIG,
  DEFAULT_COMPLETION_KEYWORD,
  getConfig,
  interpolatePromptTemplate
} from '../config';
import { renderPromptTemplate } from '../planScanner';

async function runPhase04Tests() {
  console.log('================================================================');
  console.log(' Phase 04: Default Structured JSON Prompt Template Test');
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

  // Scenario 1: JSON Validity & Structure Check
  await test('DEFAULT_PROMPT_TEMPLATE parses as valid JSON with expected 7-step structure', () => {
    const parsed = JSON.parse(DEFAULT_PROMPT_TEMPLATE);

    assert.ok(Array.isArray(parsed.steps), 'steps must be an array');
    assert.strictEqual(parsed.steps.length, 7, 'steps must contain 7 items (id 0..6)');

    for (let i = 0; i <= 6; i++) {
      assert.strictEqual(parsed.steps[i].id, i, `step[${i}].id must equal ${i}`);
      assert.ok(
        typeof parsed.steps[i].name === 'string' && parsed.steps[i].name.length > 0,
        `step[${i}].name must be a non-empty string`
      );
      assert.ok(
        typeof parsed.steps[i].instructions === 'string' && parsed.steps[i].instructions.length > 0,
        `step[${i}].instructions must be a non-empty string`
      );
    }

    assert.strictEqual(parsed.steps[0].workflow, '/recap', 'step 0 must reference /recap workflow');
    assert.strictEqual(parsed.steps[6].workflow, '/save_brain', 'step 6 must reference /save_brain workflow');
    assert.ok(
      parsed.steps[2].instructions.includes('\n\n'),
      'step 2 instructions must preserve paragraph break after JSON.parse'
    );

    assert.strictEqual(parsed.phase_file, '{xxx}', 'phase_file must be {xxx}');
    assert.strictEqual(
      parsed.final_response_policy?.required_output,
      'Done skul9x.',
      'final_response_policy.required_output must be Done skul9x.'
    );
    assert.strictEqual(parsed.final_response_policy?.exact_match, true);
    assert.strictEqual(parsed.completion_response, 'Done skul9x.', 'completion_response must be Done skul9x.');
    assert.strictEqual(DEFAULT_COMPLETION_KEYWORD, 'Done skul9x.', 'DEFAULT_COMPLETION_KEYWORD must remain unchanged');
  });

  // Scenario 2: Config & Manifest Synchronization
  await test('DEFAULT_CONFIG and package.json manifest defaults match DEFAULT_PROMPT_TEMPLATE identically', () => {
    assert.strictEqual(
      DEFAULT_CONFIG.promptTemplate,
      DEFAULT_PROMPT_TEMPLATE,
      'DEFAULT_CONFIG.promptTemplate must match DEFAULT_PROMPT_TEMPLATE'
    );
    assert.strictEqual(
      DEFAULT_CONFIG.defaultPromptTemplate,
      DEFAULT_PROMPT_TEMPLATE,
      'DEFAULT_CONFIG.defaultPromptTemplate must match DEFAULT_PROMPT_TEMPLATE'
    );
    assert.strictEqual(
      DEFAULT_CONFIG.promptText,
      DEFAULT_PROMPT_TEMPLATE,
      'DEFAULT_CONFIG.promptText must match DEFAULT_PROMPT_TEMPLATE'
    );

    const pkgPath = path.resolve(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const props = pkg.contributes?.configuration?.properties;
    assert.ok(props, 'package.json contributes.configuration.properties must exist');

    assert.strictEqual(
      props['autoplan.defaultPromptTemplate']?.default,
      DEFAULT_PROMPT_TEMPLATE,
      'package.json autoplan.defaultPromptTemplate.default must match DEFAULT_PROMPT_TEMPLATE character-for-character'
    );
    assert.strictEqual(
      props['autoplan.promptTemplate']?.default,
      DEFAULT_PROMPT_TEMPLATE,
      'package.json autoplan.promptTemplate.default must match DEFAULT_PROMPT_TEMPLATE character-for-character'
    );
    assert.strictEqual(
      pkg.scripts?.['test:phase04-default-prompt'],
      'node out/test/phase04_default_json_prompt_template.test.js',
      'package.json must register test:phase04-default-prompt script'
    );
  });

  // Scenario 3: Placeholder Interpolation & getConfig() Fallback
  await test('interpolatePromptTemplate / renderPromptTemplate produces valid JSON and getConfig() falls back cleanly', () => {
    const posixPhasePath = '/home/skul9x/Desktop/Code/plans/phase-01.md';
    const renderedPosix = interpolatePromptTemplate(DEFAULT_PROMPT_TEMPLATE, posixPhasePath);
    assert.ok(!renderedPosix.includes('{xxx}'), 'Rendered prompt must not contain {xxx}');
    const parsedPosix = JSON.parse(renderedPosix);
    assert.strictEqual(parsedPosix.phase_file, posixPhasePath);

    const winPhasePath = 'C:\\Users\\skul9x\\plans\\phase-02.md';
    const renderedWin = renderPromptTemplate(DEFAULT_PROMPT_TEMPLATE, winPhasePath);
    assert.ok(!renderedWin.includes('{xxx}'), 'Rendered Windows prompt must not contain {xxx}');
    const parsedWin = JSON.parse(renderedWin);
    assert.strictEqual(parsedWin.phase_file, 'C:/Users/skul9x/plans/phase-02.md');

    // Verify getConfig() fallback when no user override is set
    mockConfigOverrides = {};
    const defaultCfg = getConfig();
    assert.strictEqual(defaultCfg.defaultPromptTemplate, DEFAULT_PROMPT_TEMPLATE);
    assert.strictEqual(defaultCfg.promptTemplate, DEFAULT_PROMPT_TEMPLATE);
    assert.strictEqual(defaultCfg.promptText, DEFAULT_PROMPT_TEMPLATE);

    // Verify getConfig() respects explicit user override
    mockConfigOverrides = { promptTemplate: 'Custom {xxx}' };
    const overrideCfg = getConfig();
    assert.strictEqual(overrideCfg.promptTemplate, 'Custom {xxx}');
    assert.strictEqual(overrideCfg.defaultPromptTemplate, DEFAULT_PROMPT_TEMPLATE);
    mockConfigOverrides = {};
  });

  console.log(`\nSummary: ${passed}/${total} tests passed.`);
}

runPhase04Tests().catch((err) => {
  console.error('Phase 04 test suite failed:', err);
  process.exit(1);
});
