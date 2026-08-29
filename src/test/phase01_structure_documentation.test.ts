// Mock 'vscode' module if imported or required transitively
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

async function runPhase01StructureDocumentationTestSuite() {
  console.log('=== Running Phase 01: Project Architecture & Directory Structure Documentation Tests ===\n');

  const rootDir = path.resolve(__dirname, '../../');
  const structurePath = path.join(rootDir, 'structure.md');

  // 1. Verify structure.md existence and size (> 1000 bytes)
  console.log('[Test 1] Verifying structure.md existence and file size (> 1000 bytes)...');
  assert.strictEqual(fs.existsSync(structurePath), true, 'structure.md file must exist in project root');
  
  const stats = fs.statSync(structurePath);
  assert.ok(stats.size > 1000, `structure.md size should be > 1000 bytes (actual: ${stats.size} bytes)`);
  console.log(`  ✓ structure.md exists and size is ${stats.size} bytes (> 1000 bytes requirement).`);

  // 2. Read content and verify required structural headings
  console.log('\n[Test 2] Verifying key structural section headings in structure.md...');
  const content = fs.readFileSync(structurePath, 'utf-8');

  const requiredHeadings = [
    '# Project Structure',
    '## Core Modules',
    '## Data Flow Diagram',
    '## IPC Protocols'
  ];

  for (const heading of requiredHeadings) {
    assert.ok(
      content.includes(heading),
      `structure.md must contain heading "${heading}"`
    );
    console.log(`  ✓ Found required heading: "${heading}"`);
  }

  // 3. Verify all referenced source files exist on disk
  console.log('\n[Test 3] Verifying physical existence of all referenced source components...');
  const requiredFiles = [
    'src/extension.ts',
    'src/orchestrator.ts',
    'src/promptDispatcher.ts',
    'src/bridgeServer.ts',
    'src/transcriptWatcher.ts',
    'src/workbenchInjector.ts',
    'src/planScanner.ts',
    'src/sidebarProvider.ts',
    'media/autoplan-dom-bridge.js'
  ];

  for (const relPath of requiredFiles) {
    assert.ok(
      content.includes(relPath),
      `structure.md must reference relative path "${relPath}"`
    );
    
    const absPath = path.join(rootDir, relPath);
    assert.strictEqual(
      fs.existsSync(absPath),
      true,
      `Referenced file "${relPath}" must physically exist on disk at "${absPath}"`
    );
    console.log(`  ✓ Referenced file "${relPath}" exists on disk and is documented.`);
  }

  console.log('\n=============================================================');
  console.log('🎉 ALL PHASE 01 STRUCTURE DOCUMENTATION TESTS PASSED SUCCESSFULLY!');
  console.log('=============================================================\n');
}

runPhase01StructureDocumentationTestSuite().catch((err) => {
  console.error('Phase 01 Structure Documentation Test Failed:', err);
  process.exit(1);
});
