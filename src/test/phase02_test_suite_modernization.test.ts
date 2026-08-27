import * as assert from 'assert';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runTestSuiteModernizationTests() {
  console.log('======================================================================');
  console.log('🧪 Phase 02: Legacy Test Modernization & Suite Verification Test');
  console.log('======================================================================\n');

  const outTestDir = path.resolve(__dirname);

  const targetSuites = [
    {
      name: 'Phase 01 Scaffold & Configuration Defaults',
      file: 'phase01.test.js',
      expectedSubstrings: [
        'package.json metadata and contributions verified',
        'src/config.ts default configuration values and getConfig verified',
        'All Phase 01 Tests Passed Successfully!'
      ]
    },
    {
      name: 'Phase 02 Keyboard Simulation & Single-Batch Priming',
      file: 'phase02.test.js',
      expectedSubstrings: [
        'Test 1: Default KeyboardManager instance and timings verified',
        'Test 5: pasteAndSubmit compound sequence verified',
        'Test 6: Full executePromptFlow end-to-end sequence verified',
        'All Phase 02 Tests Passed Successfully!'
      ]
    },
    {
      name: 'Phase 03 Orchestrator Sequential Runner & Batch Handoff',
      file: 'phase03_orchestrator_loop.test.ts'.replace('.ts', '.js'),
      expectedSubstrings: [
        'Test 1 Passed: 3-phase sequential execution successfully completed',
        'Test 2 Passed: Conversation isolation verified across phase transitions',
        'Test 3 Passed: skipCurrentPhase() properly skipped active phase and resumed flow',
        'Test 4 Passed: stop() cleanly halted execution',
        'Test 5 Passed: resume execution from arbitrary phase index verified',
        'ALL PHASE 03 ORCHESTRATOR TESTS PASSED SUCCESSFULLY'
      ]
    },
    {
      name: 'Phase 01 Folder Scanner & Placeholder Basename/Path Engine',
      file: 'phase01_folder_scanner.test.ts'.replace('.ts', '.js'),
      expectedSubstrings: [
        'Artifact blacklist filtering passed',
        'Natural sorting verified',
        'Path normalization verified',
        'Prompt template engine and placeholder aliases verified',
        'ALL PHASE 01 TESTS PASSED SUCCESSFULLY'
      ]
    }
  ];

  let passedCount = 0;

  for (const suite of targetSuites) {
    console.log(`[Suite ${passedCount + 1}/${targetSuites.length}] Running ${suite.name} (${suite.file})...`);
    const filePath = path.join(outTestDir, suite.file);

    const startTime = Date.now();
    const { stdout, stderr } = await execAsync(`node "${filePath}"`, {
      timeout: 25000,
      env: { ...process.env, NODE_ENV: 'test' }
    });
    const duration = Date.now() - startTime;

    // 1. Verify exit output
    for (const expected of suite.expectedSubstrings) {
      assert.ok(
        stdout.includes(expected),
        `Suite [${suite.name}] stdout missing expected text: "${expected}"\nActual output:\n${stdout}`
      );
    }

    // 2. Ensure no uncaught errors reported in stderr
    assert.strictEqual(
      stderr.trim(),
      '',
      `Suite [${suite.name}] produced unexpected stderr: ${stderr}`
    );

    console.log(`  ✓ Passed in ${duration}ms\n`);
    passedCount++;
  }

  assert.strictEqual(passedCount, targetSuites.length, `All ${targetSuites.length} modernized suites must pass`);

  console.log('======================================================================');
  console.log('🎉 ALL MODERNIZED TEST SUITES EXECUTED AND PASSED WITH 100% SUCCESS!');
  console.log('======================================================================\n');
}

runTestSuiteModernizationTests().catch((err) => {
  console.error('❌ Test Modernization Suite Failed:', err);
  process.exit(1);
});
