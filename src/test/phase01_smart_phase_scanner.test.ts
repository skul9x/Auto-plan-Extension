// Mock 'vscode' module for standalone test runner
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_k: string, defaultValue: any) => defaultValue,
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
  detectPhaseStatus,
  sortPhaseFiles,
  getPhasesFrom,
  scanPlanFolder,
  PhaseFile
} from '../planScanner';

function runPhase01Tests() {
  console.log('=== Running Phase 01: Smart Phase Scanner & Status Detection Tests ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase01-smart-scanner-'));

  try {
    // ----------------------------------------------------------------------
    // Test 1: Status Detection (Completed variations)
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying completion status detection variations...');
    const completedVariations = [
      { name: 'phase-01-emoji-check.md', content: '# Phase 01\n\nStatus: ✅ Completed\n\nSome body text' },
      { name: 'phase-02-emoji-green.md', content: '# Phase 02\n\nStatus: 🟢 Completed\n\nBody' },
      { name: 'phase-03-check-mark.md', content: '# Phase 03\n\nStatus: ✔ Completed\n\nBody' },
      { name: 'phase-04-bracket-x.md', content: '# Phase 04\n\nStatus: [x] Completed\n\nBody' },
      { name: 'phase-05-bracket-cap-x.md', content: '# Phase 05\n\nStatus: [X] Completed\n\nBody' },
      { name: 'phase-06-plain-completed.md', content: '# Phase 06\n\nStatus: Completed\n\nBody' },
      { name: 'phase-07-plain-done.md', content: '# Phase 07\n\nStatus: Done\n\nBody' },
      { name: 'phase-08-lowercase.md', content: 'status: completed\n\nBody' }
    ];

    for (const item of completedVariations) {
      const filePath = path.join(tempDir, item.name);
      fs.writeFileSync(filePath, item.content, 'utf8');
      const detected = detectPhaseStatus(filePath);
      assert.strictEqual(detected, 'Completed', `Expected Completed for ${item.name}`);
    }
    console.log('  -> Passed: All completion signatures correctly identified as "Completed".');

    // ----------------------------------------------------------------------
    // Test 2: Status Detection (Pending variations & edge cases)
    // ----------------------------------------------------------------------
    console.log('[Test 2] Verifying pending status detection & edge cases...');
    const pendingVariations = [
      { name: 'phase-09-emoji-pending.md', content: '# Phase 09\n\nStatus: ⬜ Pending\n\nBody' },
      { name: 'phase-10-emoji-progress.md', content: '# Phase 10\n\nStatus: 🟡 In Progress\n\nBody' },
      { name: 'phase-11-no-status.md', content: '# Phase 11\n\nJust markdown content without status line.' },
      { name: 'phase-12-failed.md', content: '# Phase 12\n\nStatus: ❌ Failed\n\nBody' }
    ];

    for (const item of pendingVariations) {
      const filePath = path.join(tempDir, item.name);
      fs.writeFileSync(filePath, item.content, 'utf8');
      const detected = detectPhaseStatus(filePath);
      assert.strictEqual(detected, 'Pending', `Expected Pending for ${item.name}`);
    }
    assert.strictEqual(detectPhaseStatus(path.join(tempDir, 'non-existent.md')), 'Pending');
    console.log('  -> Passed: All pending/unmarked files correctly default to "Pending".');

    // ----------------------------------------------------------------------
    // Test 3: Header Limit / No False-Positive in Body or Code Block
    // ----------------------------------------------------------------------
    console.log('[Test 3] Verifying scan scope limits to first 30 lines (no body false positives)...');
    const lines: string[] = [];
    for (let i = 1; i <= 35; i++) {
      if (i === 32) {
        lines.push('Status: ✅ Completed');
      } else {
        lines.push(`Line ${i}: normal documentation text`);
      }
    }
    const deepBodyFile = path.join(tempDir, 'phase-13-deep-body.md');
    fs.writeFileSync(deepBodyFile, lines.join('\n'), 'utf8');
    const deepStatus = detectPhaseStatus(deepBodyFile);
    assert.strictEqual(deepStatus, 'Pending', 'Status after line 30 must not trigger Completed status');
    console.log('  -> Passed: Scoped strictly to header region without false-positives.');

    // ----------------------------------------------------------------------
    // Test 4: scanPlanFolder Integration & Status Metadata Enrichment
    // ----------------------------------------------------------------------
    console.log('[Test 4] Verifying scanPlanFolder() status enrichment...');
    const scanned = scanPlanFolder(tempDir);
    assert.ok(scanned.length >= 12, `Expected at least 12 scanned phases, got ${scanned.length}`);
    const phase01 = scanned.find(p => p.fileName === 'phase-01-emoji-check.md');
    assert.ok(phase01, 'phase-01 should exist');
    assert.strictEqual(phase01!.status, 'Completed');
    assert.strictEqual(phase01!.isCompleted, true);

    const phase09 = scanned.find(p => p.fileName === 'phase-09-emoji-pending.md');
    assert.ok(phase09, 'phase-09 should exist');
    assert.strictEqual(phase09!.status, 'Pending');
    assert.strictEqual(phase09!.isCompleted, false);
    console.log('  -> Passed: scanPlanFolder successfully populates status and isCompleted.');

    // ----------------------------------------------------------------------
    // Test 5: Natural Numeric Collation (sortPhaseFiles)
    // ----------------------------------------------------------------------
    console.log('[Test 5] Verifying natural numeric sorting order (sortPhaseFiles)...');
    const mockPhases: PhaseFile[] = [
      { fileName: 'phase-10-deploy.md', nativePath: '', normalizedPath: '', filePath: '', relativePath: '', index: 10, status: 'Pending', isCompleted: false },
      { fileName: 'phase-02-api.md', nativePath: '', normalizedPath: '', filePath: '', relativePath: '', index: 2, status: 'Completed', isCompleted: true },
      { fileName: 'phase-01-scaffold.md', nativePath: '', normalizedPath: '', filePath: '', relativePath: '', index: 1, status: 'Completed', isCompleted: true },
      { fileName: 'phase-03-ui.md', nativePath: '', normalizedPath: '', filePath: '', relativePath: '', index: 3, status: 'Pending', isCompleted: false }
    ];

    const sorted = sortPhaseFiles(mockPhases);
    assert.deepStrictEqual(
      sorted.map(p => p.fileName),
      ['phase-01-scaffold.md', 'phase-02-api.md', 'phase-03-ui.md', 'phase-10-deploy.md']
    );
    console.log('  -> Passed: Natural alphanumeric collation correctly orders arbitrarily sequenced phases.');

    // ----------------------------------------------------------------------
    // Test 6: Slicing Sequence (getPhasesFrom)
    // ----------------------------------------------------------------------
    console.log('[Test 6] Verifying getPhasesFrom sequence slicing and error handling...');
    const testPhases: PhaseFile[] = [
      { fileName: 'phase-01-scaffold.md', nativePath: 'C:\\plans\\phase-01-scaffold.md', normalizedPath: 'C:/plans/phase-01-scaffold.md', filePath: 'C:/plans/phase-01-scaffold.md', relativePath: 'phase-01-scaffold.md', index: 1, status: 'Completed', isCompleted: true },
      { fileName: 'phase-02-backend.md', nativePath: 'C:\\plans\\phase-02-backend.md', normalizedPath: 'C:/plans/phase-02-backend.md', filePath: 'C:/plans/phase-02-backend.md', relativePath: 'phase-02-backend.md', index: 2, status: 'Pending', isCompleted: false },
      { fileName: 'phase-03-frontend.md', nativePath: 'C:\\plans\\phase-03-frontend.md', normalizedPath: 'C:/plans/phase-03-frontend.md', filePath: 'C:/plans/phase-03-frontend.md', relativePath: 'phase-03-frontend.md', index: 3, status: 'Pending', isCompleted: false }
    ];

    // By 1-based number index
    const fromIndex2 = getPhasesFrom(testPhases, 2);
    assert.strictEqual(fromIndex2.length, 2);
    assert.strictEqual(fromIndex2[0].fileName, 'phase-02-backend.md');

    // By exact fileName
    const fromFile = getPhasesFrom(testPhases, 'phase-03-frontend.md');
    assert.strictEqual(fromFile.length, 1);
    assert.strictEqual(fromFile[0].fileName, 'phase-03-frontend.md');

    // By prefix
    const fromPrefix = getPhasesFrom(testPhases, 'phase-02');
    assert.strictEqual(fromPrefix.length, 2);
    assert.strictEqual(fromPrefix[0].fileName, 'phase-02-backend.md');

    // By normalized path
    const fromPath = getPhasesFrom(testPhases, 'C:/plans/phase-01-scaffold.md');
    assert.strictEqual(fromPath.length, 3);

    // By numeric string
    const fromNumString = getPhasesFrom(testPhases, '2');
    assert.strictEqual(fromNumString.length, 2);
    assert.strictEqual(fromNumString[0].fileName, 'phase-02-backend.md');

    // Missing identifier throws
    assert.throws(
      () => getPhasesFrom(testPhases, 'phase-99-unknown.md'),
      /not found in phase collection/
    );
    assert.throws(
      () => getPhasesFrom(testPhases, 99),
      /not found in phase collection/
    );
    console.log('  -> Passed: getPhasesFrom supports index, fileName, prefix, path and throws on missing.');

    // ----------------------------------------------------------------------
    // Test 7: Non-functional performance benchmark (50 files < 50ms)
    // ----------------------------------------------------------------------
    console.log('[Test 7] Verifying scan performance on 50 phase markdown files...');
    const perfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase01-perf-'));
    for (let i = 1; i <= 50; i++) {
      const pad = String(i).padStart(2, '0');
      const isDone = i % 2 === 0;
      const statusLine = isDone ? 'Status: ✅ Completed' : 'Status: ⬜ Pending';
      fs.writeFileSync(
        path.join(perfDir, `phase-${pad}-task.md`),
        `# Phase ${pad}\n\n${statusLine}\n\nTask details for phase ${pad}.`,
        'utf8'
      );
    }

    const tStart = process.hrtime.bigint();
    const perfScanned = scanPlanFolder(perfDir);
    const tEnd = process.hrtime.bigint();
    const elapsedMs = Number(tEnd - tStart) / 1_000_000;

    assert.strictEqual(perfScanned.length, 50);
    const completedCount = perfScanned.filter(p => p.isCompleted).length;
    assert.strictEqual(completedCount, 25);
    console.log(`  -> 50 files scanned & status-detected in ${elapsedMs.toFixed(2)}ms (Limit: < 50ms).`);
    assert.ok(elapsedMs < 50, `Scanning 50 files took ${elapsedMs.toFixed(2)}ms, exceeding 50ms threshold.`);
    console.log('  -> Passed: Scanning performance requirements satisfied.');

    // Cleanup
    fs.rmSync(perfDir, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log('\n=== ALL PHASE 01 TESTS PASSED SUCCESSFULLY ===\n');
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }
}

runPhase01Tests();
