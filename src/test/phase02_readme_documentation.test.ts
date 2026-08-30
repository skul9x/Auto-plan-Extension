import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

async function runPhase02ReadmeDocumentationTestSuite() {
  console.log('=== Running Phase 02: Extension Documentation & Configuration Validation Test ===\n');

  const projectRoot = path.resolve(__dirname, '../../');
  const readmePath = path.join(projectRoot, 'README.md');
  const packageJsonPath = path.join(projectRoot, 'package.json');

  // --------------------------------------------------------------------------
  // Test 1: Verify README.md exists and size > 5000 bytes
  // --------------------------------------------------------------------------
  console.log('[Test 1] Verifying README.md file existence and minimum size (> 5000 bytes)...');
  assert.ok(fs.existsSync(readmePath), `README.md must exist at path: ${readmePath}`);
  const stats = fs.statSync(readmePath);
  assert.ok(
    stats.size > 5000,
    `README.md file size should be > 5000 bytes (actual: ${stats.size} bytes)`
  );
  console.log(`  ✓ README.md verified (${stats.size} bytes).`);

  const readmeContent = fs.readFileSync(readmePath, 'utf-8');

  // --------------------------------------------------------------------------
  // Test 2: Parse package.json configuration section & verify all keys in README.md
  // --------------------------------------------------------------------------
  console.log('\n[Test 2] Verifying package.json configuration keys match README.md documentation...');
  assert.ok(fs.existsSync(packageJsonPath), `package.json must exist at path: ${packageJsonPath}`);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  
  const configProperties = packageJson?.contributes?.configuration?.properties;
  assert.ok(configProperties, 'package.json contributes.configuration.properties must exist');

  const configKeys = Object.keys(configProperties);
  assert.ok(configKeys.length > 0, 'package.json should contain configuration keys');

  console.log(`  Found ${configKeys.length} configuration keys in package.json.`);
  for (const key of configKeys) {
    assert.ok(
      readmeContent.includes(key),
      `README.md must document configuration key '${key}'`
    );
    console.log(`    ✓ Setting '${key}' found in README.md.`);
  }

  // --------------------------------------------------------------------------
  // Test 3: Verify all commands in package.json are documented in README.md
  // --------------------------------------------------------------------------
  console.log('\n[Test 3] Verifying package.json commands are documented in README.md...');
  const commands = packageJson?.contributes?.commands;
  assert.ok(Array.isArray(commands) && commands.length > 0, 'package.json contributes.commands must exist');

  console.log(`  Found ${commands.length} commands in package.json.`);
  for (const cmd of commands) {
    assert.ok(
      readmeContent.includes(cmd.command),
      `README.md must document command '${cmd.command}'`
    );
    console.log(`    ✓ Command '${cmd.command}' found in README.md.`);
  }

  // --------------------------------------------------------------------------
  // Test 4: Verify required section headers
  // --------------------------------------------------------------------------
  console.log('\n[Test 4] Verifying required structural Markdown headings...');
  const requiredHeadings = [
    '# Antigravity Auto-Plan Extension',
    '## Features',
    '## Installation & Setup',
    '## Configuration Reference',
    '## Commands Reference',
    '## Architecture Overview',
    '## Troubleshooting',
    '## Development & Testing'
  ];

  for (const heading of requiredHeadings) {
    assert.ok(
      readmeContent.includes(heading),
      `README.md must contain required heading '${heading}'`
    );
    console.log(`    ✓ Heading '${heading}' verified.`);
  }

  // --------------------------------------------------------------------------
  // Test 5: Verify core feature highlights & troubleshooting details
  // --------------------------------------------------------------------------
  console.log('\n[Test 5] Verifying core technical concepts & troubleshooting documentation...');
  const requiredKeywords = [
    'Settings Panel',
    'Sidebar Control Center',
    'Focus-Free DOM Bridge',
    '3-Tier Resilient Transport',
    'Zero-Timeout Pre-Flight Guard',
    'Anti-Pollution Transcript Watcher',
    'pkexec',
    'xdotool',
    'autoplan.openSettings',
    'autoplan.oneClickSetup',
    '🚀 Auto-Plan',
    'Linux Pre-Flight Failed',
    'Reload Window',
    'CSP'
  ];

  for (const keyword of requiredKeywords) {
    assert.ok(
      readmeContent.includes(keyword),
      `README.md must contain key concept/troubleshooting topic '${keyword}'`
    );
    console.log(`    ✓ Concept/Topic '${keyword}' verified.`);
  }

  console.log('\n=============================================================');
  console.log('🎉 ALL PHASE 02 README DOCUMENTATION TESTS PASSED! (100% Coverage)');
  console.log('=============================================================\n');
}

runPhase02ReadmeDocumentationTestSuite().catch((err) => {
  console.error('Phase 02 Documentation Test Failed:', err);
  process.exit(1);
});
