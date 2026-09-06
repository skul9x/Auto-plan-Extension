// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section: string) => ({
          get: (key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        })
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
import { DEFAULT_CONFIG, CONFIG_SECTION, getConfig, DEFAULT_PROMPT_TEMPLATE } from '../config';

function runPhase01Tests() {
  console.log('=== Running Phase 01 Scaffold & Configuration Tests ===');

  const rootDir = path.resolve(__dirname, '..', '..');

  // 1. Validate package.json
  const pkgPath = path.join(rootDir, 'package.json');
  assert.ok(fs.existsSync(pkgPath), 'package.json must exist');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  assert.strictEqual(pkg.name, 'antigravity-auto-plan', 'Package name must be antigravity-auto-plan');
  assert.strictEqual(pkg.displayName, 'Antigravity Auto-Plan Runner', 'Display name must match');
  assert.strictEqual(pkg.main, './out/extension.js', 'Main entry point must be ./out/extension.js');

  // Commands
  const commands = pkg.contributes?.commands;
  assert.ok(Array.isArray(commands), 'Commands must be an array');
  const commandIds = commands.map((c: { command: string }) => c.command);
  assert.ok(commandIds.includes('autoplan.start'), 'autoplan.start command must exist');
  assert.ok(commandIds.includes('autoplan.stop'), 'autoplan.stop command must exist');
  assert.ok(commandIds.includes('autoplan.setPrompt'), 'autoplan.setPrompt command must exist');

  // Configurations
  const properties = pkg.contributes?.configuration?.properties;
  assert.ok(properties, 'Configuration properties must exist');
  assert.strictEqual(properties['autoplan.promptText']?.type, 'string');
  assert.strictEqual(
    properties['autoplan.promptText']?.default,
    'Hãy trả lời tôi với câu trả lời là "Done skul9x.", ngoài ra không nói gì thêm'
  );
  assert.strictEqual(properties['autoplan.repeatCount']?.type, 'number');
  assert.strictEqual(properties['autoplan.repeatCount']?.default, 5);
  assert.strictEqual(properties['autoplan.completionKeyword']?.type, 'string');
  assert.strictEqual(properties['autoplan.completionKeyword']?.default, 'Done skul9x.');
  assert.strictEqual(properties['autoplan.delayBetweenLoopsMs']?.type, 'number');
  assert.strictEqual(properties['autoplan.delayBetweenLoopsMs']?.default, 2000);
  assert.strictEqual(properties['autoplan.timeoutPerLoopMinutes']?.type, 'number');
  assert.strictEqual(properties['autoplan.timeoutPerLoopMinutes']?.default, 15);

  // Scripts
  assert.ok(pkg.scripts?.compile, 'compile script must exist');
  assert.ok(pkg.scripts?.watch, 'watch script must exist');
  assert.ok(pkg.scripts?.package, 'package script must exist');

  console.log('✓ package.json metadata and contributions verified');

  // 2. Validate tsconfig.json
  const tsconfigPath = path.join(rootDir, 'tsconfig.json');
  assert.ok(fs.existsSync(tsconfigPath), 'tsconfig.json must exist');
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
  assert.strictEqual(tsconfig.compilerOptions?.outDir, 'out');
  assert.strictEqual(tsconfig.compilerOptions?.module, 'commonjs');
  assert.strictEqual(tsconfig.compilerOptions?.strict, true);

  console.log('✓ tsconfig.json configuration verified');

  // 3. Validate .vscodeignore
  const vscodeIgnorePath = path.join(rootDir, '.vscodeignore');
  assert.ok(fs.existsSync(vscodeIgnorePath), '.vscodeignore must exist');
  const vscodeIgnore = fs.readFileSync(vscodeIgnorePath, 'utf8');
  assert.ok(vscodeIgnore.includes('src/**'), '.vscodeignore should exclude src/**');
  assert.ok(vscodeIgnore.includes('tsconfig.json'), '.vscodeignore should exclude tsconfig.json');

  console.log('✓ .vscodeignore rules verified');

  // 4. Validate src/config.ts defaults and getConfig helper
  assert.strictEqual(CONFIG_SECTION, 'autoplan');
  assert.strictEqual(
    DEFAULT_CONFIG.promptText,
    DEFAULT_PROMPT_TEMPLATE
  );
  assert.strictEqual(DEFAULT_CONFIG.repeatCount, 5);
  assert.strictEqual(DEFAULT_CONFIG.completionKeyword, 'Done skul9x.');
  assert.strictEqual(DEFAULT_CONFIG.delayBetweenLoopsMs, 2000);
  assert.strictEqual(DEFAULT_CONFIG.timeoutPerLoopMinutes, 15);

  const cfg = getConfig();
  assert.strictEqual(cfg.promptText, DEFAULT_CONFIG.promptText);
  assert.strictEqual(cfg.repeatCount, DEFAULT_CONFIG.repeatCount);
  assert.strictEqual(cfg.completionKeyword, DEFAULT_CONFIG.completionKeyword);
  assert.strictEqual(cfg.delayBetweenLoopsMs, DEFAULT_CONFIG.delayBetweenLoopsMs);
  assert.strictEqual(cfg.timeoutPerLoopMinutes, DEFAULT_CONFIG.timeoutPerLoopMinutes);

  console.log('✓ src/config.ts default configuration values and getConfig verified');

  // 5. Validate compiled output files exist
  const compiledExtension = path.join(rootDir, 'out', 'extension.js');
  const compiledConfig = path.join(rootDir, 'out', 'config.js');
  assert.ok(fs.existsSync(compiledExtension), 'out/extension.js must exist after build');
  assert.ok(fs.existsSync(compiledConfig), 'out/config.js must exist after build');

  console.log('✓ Build output verified');
  console.log('\n=== All Phase 01 Tests Passed Successfully! ===');
}

runPhase01Tests();
