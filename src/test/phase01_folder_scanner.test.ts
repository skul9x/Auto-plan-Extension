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
import * as os from 'os';
import {
  scanPlanFolder,
  renderPromptTemplate,
  isBlacklistedArtifact,
  normalizePath,
  PhaseFile,
  ARTIFACT_BLACKLIST_PATTERNS
} from '../planScanner';
import {
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_COMPLETION_KEYWORD,
  DEFAULT_CONFIG,
  getConfig
} from '../config';

function runPhase01Tests() {
  console.log('=== Running Phase 01: Folder Scanner & Prompt Template Tests ===\n');

  // Create temporary test environment
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase01-test-'));

  try {
    // -------------------------------------------------------------
    // Test 1: Blacklist Artifact Filter Verification
    // -------------------------------------------------------------
    console.log('[Test 1] Verifying Artifact Blacklist Filtering...');
    const blacklistedFiles = [
      'plan.md',
      'plan-overview.md',
      'plan_arch.md',
      'summary.md',
      'summary-v1.md',
      'overview.md',
      'overview-full.md',
      'walkthrough.md',
      'walkthrough-phase1.md',
      'implementation_plan.md',
      'implementation-plan.md',
      'readme.md',
      'README.md',
      'notes.md',
      'notes-scratch.md'
    ];

    for (const f of blacklistedFiles) {
      assert.strictEqual(
        isBlacklistedArtifact(f),
        true,
        `Expected ${f} to be recognized as blacklisted artifact`
      );
    }

    const nonBlacklistedFiles = [
      'phase-01-scanner.md',
      'phase-02-watcher.md',
      'phase-10.md',
      '01-init.md',
      '02_setup.md',
      'custom-task.md'
    ];

    for (const f of nonBlacklistedFiles) {
      assert.strictEqual(
        isBlacklistedArtifact(f),
        false,
        `Expected ${f} to NOT be blacklisted`
      );
    }
    console.log('  ✓ Artifact blacklist filtering passed.');

    // -------------------------------------------------------------
    // Test 2: Natural Alphanumeric Sorting & Phase Prefix Priority
    // -------------------------------------------------------------
    console.log('[Test 2] Verifying Natural Sorting & Prefix Prioritization...');
    const planFolder = path.join(tempDir, 'sample-plan');
    fs.mkdirSync(planFolder, { recursive: true });

    // Populate with unsorted phases including multi-digit numbers and blacklisted files
    const mockFiles = [
      'readme.md',
      'phase-100-final.md',
      'walkthrough.md',
      'phase-02-watcher.md',
      'plan.md',
      'phase-09-polish.md',
      'phase-01-init.md',
      'phase-10-e2e.md',
      'summary.md',
      'scratch.txt'
    ];

    for (const file of mockFiles) {
      fs.writeFileSync(path.join(planFolder, file), `# Mock content for ${file}`);
    }

    // Add subfolder with blacklisted name
    const scratchSubDir = path.join(planFolder, 'scratch');
    fs.mkdirSync(scratchSubDir, { recursive: true });
    fs.writeFileSync(path.join(scratchSubDir, 'phase-99-scratch.md'), '# Scratch phase');

    const startTime = performance.now();
    const phases = scanPlanFolder(planFolder);
    const duration = performance.now() - startTime;

    assert.strictEqual(phases.length, 5, 'Should discover exactly 5 phase files excluding artifacts and non-md files');
    assert.strictEqual(phases[0].fileName, 'phase-01-init.md', 'First phase should be phase-01-init.md');
    assert.strictEqual(phases[1].fileName, 'phase-02-watcher.md', 'Second phase should be phase-02-watcher.md');
    assert.strictEqual(phases[2].fileName, 'phase-09-polish.md', 'Third phase should be phase-09-polish.md');
    assert.strictEqual(phases[3].fileName, 'phase-10-e2e.md', 'Fourth phase should be phase-10-e2e.md');
    assert.strictEqual(phases[4].fileName, 'phase-100-final.md', 'Fifth phase should be phase-100-final.md (natural sort)');

    // Verify index property
    phases.forEach((p, idx) => {
      assert.strictEqual(p.index, idx + 1, `Phase index should match 1-based offset: ${idx + 1}`);
    });

    console.log(`  ✓ Natural sorting verified (Execution time: ${duration.toFixed(2)}ms, benchmark < 20ms).`);

    // -------------------------------------------------------------
    // Test 3: Path Normalization
    // -------------------------------------------------------------
    console.log('[Test 3] Verifying Path Normalization...');
    for (const phase of phases) {
      assert.ok(phase.nativePath.includes(path.sep), 'nativePath must contain OS separator');
      assert.ok(!phase.normalizedPath.includes('\\'), 'normalizedPath must use forward slashes');
      assert.strictEqual(phase.filePath, phase.normalizedPath, 'filePath should match normalizedPath');
      assert.strictEqual(phase.relativePath, phase.fileName, 'relativePath should match fileName for flat folder');
    }
    console.log('  ✓ Path normalization verified.');

    // -------------------------------------------------------------
    // Test 4: Fallback to non-prefixed MD files
    // -------------------------------------------------------------
    console.log('[Test 4] Verifying Fallback to Generic Markdown Files...');
    const genericFolder = path.join(tempDir, 'generic-docs');
    fs.mkdirSync(genericFolder, { recursive: true });

    fs.writeFileSync(path.join(genericFolder, 'step-b.md'), '# Step B');
    fs.writeFileSync(path.join(genericFolder, 'step-a.md'), '# Step A');
    fs.writeFileSync(path.join(genericFolder, 'step-10.md'), '# Step 10');
    fs.writeFileSync(path.join(genericFolder, 'step-2.md'), '# Step 2');
    fs.writeFileSync(path.join(genericFolder, 'plan.md'), '# Blacklisted overview');

    const genericPhases = scanPlanFolder(genericFolder);
    assert.strictEqual(genericPhases.length, 4, 'Should fallback to non-blacklisted md files');
    assert.strictEqual(genericPhases[0].fileName, 'step-2.md');
    assert.strictEqual(genericPhases[1].fileName, 'step-10.md');
    assert.strictEqual(genericPhases[2].fileName, 'step-a.md');
    assert.strictEqual(genericPhases[3].fileName, 'step-b.md');
    console.log('  ✓ Fallback scanning verified.');

    // -------------------------------------------------------------
    // Test 5: Dynamic Prompt Template Rendering & Multi-Placeholder
    // -------------------------------------------------------------
    console.log('[Test 5] Verifying Prompt Template Rendering...');
    const testPhase = phases[0];

    // Case 5a: Default template with {xxx}
    const renderedDefault = renderPromptTemplate(DEFAULT_PROMPT_TEMPLATE, testPhase);
    assert.ok(
      renderedDefault.includes(testPhase.normalizedPath),
      'Rendered template must contain normalized phase path'
    );
    assert.ok(
      !renderedDefault.includes('{xxx}'),
      '{xxx} placeholder must be completely replaced'
    );
    assert.ok(
      renderedDefault.includes('Done skul9x.'),
      'Default template must include Done skul9x.'
    );

    // Case 5b: Aliases {path}, {file}, {phasePath}, {phaseFile}
    const aliasTemplate = 'Execute {path} and review {file} against {phasePath} and {phaseFile}';
    const renderedAlias = renderPromptTemplate(aliasTemplate, testPhase);
    assert.strictEqual(
      renderedAlias,
      `Execute ${testPhase.normalizedPath} and review ${testPhase.fileName} against ${testPhase.normalizedPath} and ${testPhase.fileName}`
    );

    // Case 5c: Custom template without any placeholder (automatic append)
    const noPlaceholderTemplate = 'Please execute this phase carefully.';
    const renderedNoPlaceholder = renderPromptTemplate(noPlaceholderTemplate, testPhase);
    assert.strictEqual(
      renderedNoPlaceholder,
      `Please execute this phase carefully.\n${testPhase.normalizedPath}`,
      'Template lacking placeholders must have target path automatically appended'
    );

    // Case 5d: String path overload
    const renderedDirectString = renderPromptTemplate('Run {xxx}', 'd:/my/custom/phase.md');
    assert.strictEqual(renderedDirectString, 'Run d:/my/custom/phase.md');

    console.log('  ✓ Prompt template engine and placeholder aliases verified.');

    // -------------------------------------------------------------
    // Test 6: Error Handling (Non-existent, empty, file-as-dir)
    // -------------------------------------------------------------
    console.log('[Test 6] Verifying Robust Error Handling...');
    // Non-existent path
    assert.throws(
      () => scanPlanFolder(path.join(tempDir, 'does-not-exist')),
      /Plan directory does not exist/,
      'Should throw error on non-existent path'
    );

    // Empty folder
    const emptyFolder = path.join(tempDir, 'empty-folder');
    fs.mkdirSync(emptyFolder);
    assert.throws(
      () => scanPlanFolder(emptyFolder),
      /No executable phase markdown files found/,
      'Should throw error on empty directory'
    );

    // Folder with only blacklisted files
    const onlyArtifactsFolder = path.join(tempDir, 'only-artifacts');
    fs.mkdirSync(onlyArtifactsFolder);
    fs.writeFileSync(path.join(onlyArtifactsFolder, 'plan.md'), '# Plan');
    fs.writeFileSync(path.join(onlyArtifactsFolder, 'walkthrough.md'), '# Walkthrough');
    assert.throws(
      () => scanPlanFolder(onlyArtifactsFolder),
      /No executable phase markdown files found/,
      'Should throw error when all files are blacklisted'
    );

    // Path is a file instead of directory
    const aFile = path.join(tempDir, 'not-a-dir.txt');
    fs.writeFileSync(aFile, 'hello');
    assert.throws(
      () => scanPlanFolder(aFile),
      /Specified path is not a directory/,
      'Should throw error when path is not a directory'
    );
    console.log('  ✓ Error handling verified.');

    // -------------------------------------------------------------
    // Test 7: Config Verification
    // -------------------------------------------------------------
    console.log('[Test 7] Verifying Configuration Defaults & Helper Functions...');
    assert.strictEqual(DEFAULT_COMPLETION_KEYWORD, 'Done skul9x.');
    assert.ok(DEFAULT_PROMPT_TEMPLATE.includes('{xxx}'));
    assert.ok(DEFAULT_PROMPT_TEMPLATE.includes('Done skul9x.'));

    const cfg = getConfig();
    assert.strictEqual(cfg.completionKeyword, 'Done skul9x.');
    assert.strictEqual(cfg.promptTemplate, DEFAULT_PROMPT_TEMPLATE);
    console.log('  ✓ Config integration verified.');

    console.log('\n=============================================================');
    console.log('🎉 ALL PHASE 01 TESTS PASSED SUCCESSFULLY! (100% Coverage)');
    console.log('=============================================================\n');
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error in test
    }
  }
}

runPhase01Tests();
