import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

async function runPhase03GitignoreStandardsTestSuite() {
  console.log('=== Running Phase 03: Gitignore Standards & Hygiene Test Suite ===\n');

  const projectRoot = path.resolve(__dirname, '../../');
  const gitignorePath = path.join(projectRoot, '.gitignore');

  // 1. Verify existence
  console.log('[Test 1] Verifying .gitignore file existence...');
  assert.ok(fs.existsSync(gitignorePath), `.gitignore must exist at path: ${gitignorePath}`);
  const content = fs.readFileSync(gitignorePath, 'utf-8');
  assert.ok(content.length > 50, '.gitignore must not be empty');
  console.log('  ✓ .gitignore exists and is populated.');

  // 2. Parse lines / patterns
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));

  // 3. Verify required categories and rules
  console.log('\n[Test 2] Verifying mandatory ignore rules across categories...');

  const requiredPatterns = [
    // Build & Distribution
    'out/',
    'dist/',
    'build/',
    '*.tsbuildinfo',
    '*.vsix',
    // Dependencies
    'node_modules/',
    '.pnpm-store/',
    'jspm_packages/',
    // Logs
    '*.log',
    'npm-debug.log*',
    'yarn-debug.log*',
    'yarn-error.log*',
    'pnpm-debug.log*',
    // Runtime / Temporary
    '.brain/',
    'tmp/',
    'temp/',
    '*.tmp',
    'pids',
    '*.pid',
    // VS Code test & cache
    '.vscode-test/',
    '.vscode-test-web/',
    '.vscode/',
    // OS & Editor metadata
    '.DS_Store',
    '.AppleDouble',
    '._*',
    'Thumbs.db',
    'Desktop.ini',
    'ehthumbs.db',
    '*~',
    '*.swp',
    '*.swo',
    // Secrets
    '.env',
    '.env.local',
    '.env.*.local',
    '*.pem',
    '*.key',
    // Coverage
    'coverage/',
    '.nyc_output/'
  ];

  for (const pattern of requiredPatterns) {
    assert.ok(
      lines.includes(pattern) || content.includes(pattern),
      `Missing required .gitignore pattern: "${pattern}"`
    );
    console.log(`  ✓ Pattern "${pattern}" verified.`);
  }

  // 4. Ensure essential project sources and plan files are NOT ignored
  console.log('\n[Test 3] Verifying essential source/plan files are not accidentally ignored...');
  const essentialFiles = [
    'src/extension.ts',
    'src/orchestrator.ts',
    'src/promptDispatcher.ts',
    'src/planScanner.ts',
    'package.json',
    'tsconfig.json',
    'README.md',
    'structure.md'
  ];

  for (const file of essentialFiles) {
    assert.ok(fs.existsSync(path.join(projectRoot, file)), `Essential file ${file} should exist`);
    // Ensure no exact negative or mistaken ignore pattern matches whole project file
    assert.ok(!lines.includes(file), `Essential file ${file} should NOT be in .gitignore`);
  }
  console.log('  ✓ Essential project source and configuration files are safe.');

  console.log('\n=============================================================');
  console.log('🎉 ALL PHASE 03 GITIGNORE STANDARDS TESTS PASSED SUCCESSFULLY!');
  console.log('=============================================================\n');
}

runPhase03GitignoreStandardsTestSuite().catch((err) => {
  console.error('Phase 03 Gitignore Standards Test Failed:', err);
  process.exit(1);
});
