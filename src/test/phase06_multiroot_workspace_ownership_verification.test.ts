// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockWorkspaceFolders = [
  {
    name: 'VaccineAnalyzer-Pro-main',
    uri: { fsPath: 'd:\\skul9x\\VaccineAnalyzer-Pro-main' }
  },
  {
    name: 'vaccineanalyzer-go-main',
    uri: { fsPath: 'd:\\skul9x\\vaccineanalyzer-go-main' }
  },
  {
    name: 'AllNew-VaccineAnalyzer',
    uri: { fsPath: 'd:\\skul9x\\AllNew-VaccineAnalyzer' }
  }
];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      Uri: {
        file: (p: string) => ({ fsPath: p })
      },
      env: {
        appRoot: undefined
      },
      workspace: {
        workspaceFolders: mockWorkspaceFolders,
        name: 'Untitled (Workspace)',
        getWorkspaceFolder: (uri: { fsPath: string }) => {
          const normUri = uri.fsPath.replace(/\\/g, '/').toLowerCase();
          return mockWorkspaceFolders.find(f => {
            const normFolder = f.uri.fsPath.replace(/\\/g, '/').toLowerCase();
            return normUri === normFolder || normUri.startsWith(normFolder + '/');
          });
        },
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue
        })
      },
      window: {
        showWarningMessage: () => undefined,
        showInformationMessage: () => undefined,
        showErrorMessage: () => undefined
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
  verifyConversationOwnershipAsync,
  ConversationOwnershipCriteria,
  clearConversationOwnershipCache
} from '../transcriptWatcher';
import { Orchestrator } from '../orchestrator';

async function runTests() {
  console.log('======================================================================');
  console.log('🧪 Running Phase 06: Multi-Root Workspace Ownership Verification Tests');
  console.log('======================================================================\n');

  clearConversationOwnershipCache();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-multiroot-test-'));

  try {
    // -------------------------------------------------------------------------
    // Test Case 1: Exact Reproduction of User Issue (Multi-Root Workspace)
    // Three folders: VaccineAnalyzer-Pro-main (idx 0), vaccineanalyzer-go-main (idx 1), AllNew-VaccineAnalyzer (idx 2)
    // Plan is executed for AllNew-VaccineAnalyzer
    // -------------------------------------------------------------------------
    console.log('--- 1. Testing Multi-Root Workspace Ownership Verification (User Case) ---');
    const userTranscriptFile = path.join(tmpDir, 'transcript_user_case.jsonl');
    const promptLine = JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      content: 'Implement the work described in d:/skul9x/AllNew-VaccineAnalyzer/plans/261108-1930-wpf-ui-overhaul-pyside-parity/phase-04-inapp-modal-overlays-and-dialog-parity.md. Treat this file as the source of truth for WHAT to accomplish...'
    }) + '\n';
    fs.writeFileSync(userTranscriptFile, promptLine, 'utf8');

    // Case 1a: When workspacePath was erroneously set to folder [0] (VaccineAnalyzer-Pro-main)
    const criteriaWithFolder0: ConversationOwnershipCriteria = {
      expectedPromptSnippet: 'phase-04-inapp-modal-overlays-and-dialog-parity.md',
      workspacePath: 'd:\\skul9x\\VaccineAnalyzer-Pro-main',
      workspaceName: 'VaccineAnalyzer-Pro-main',
      workspaceFolders: [
        'VaccineAnalyzer-Pro-main',
        'vaccineanalyzer-go-main',
        'AllNew-VaccineAnalyzer'
      ],
      workspaceTitle: 'Untitled (Workspace)'
    };

    const isOwnerFolder0 = await verifyConversationOwnershipAsync(userTranscriptFile, criteriaWithFolder0);
    assert.strictEqual(
      isOwnerFolder0,
      true,
      'verifyConversationOwnershipAsync must accept conversation via multi-root workspaceFolders fallback even if workspacePath was folder 0'
    );
    console.log('✔ Multi-root workspaceFolders fallback correctly verified for folder 0 mismatch');

    // Case 1b: When workspacePath was correctly resolved to AllNew-VaccineAnalyzer
    const criteriaWithCorrectFolder: ConversationOwnershipCriteria = {
      expectedPromptSnippet: 'phase-04-inapp-modal-overlays-and-dialog-parity.md',
      workspacePath: 'd:\\skul9x\\AllNew-VaccineAnalyzer',
      workspaceName: 'AllNew-VaccineAnalyzer',
      workspaceFolders: [
        'VaccineAnalyzer-Pro-main',
        'vaccineanalyzer-go-main',
        'AllNew-VaccineAnalyzer'
      ],
      workspaceTitle: 'Untitled (Workspace)'
    };

    const isOwnerCorrect = await verifyConversationOwnershipAsync(userTranscriptFile, criteriaWithCorrectFolder);
    assert.strictEqual(
      isOwnerCorrect,
      true,
      'verifyConversationOwnershipAsync must accept conversation when workspacePath matches target folder directly'
    );
    console.log('✔ Direct workspacePath match correctly verified for target folder');

    // -------------------------------------------------------------------------
    // Test Case 2: Alien / Foreign Conversation Rejection
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Testing Alien / Foreign Conversation Rejection ---');
    const foreignTranscriptFile = path.join(tmpDir, 'transcript_foreign.jsonl');
    const foreignPromptLine = JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      content: 'Implement the work described in c:/some-other-project/plans/phase-01-core.md'
    }) + '\n';
    fs.writeFileSync(foreignTranscriptFile, foreignPromptLine, 'utf8');

    const isForeignOwner = await verifyConversationOwnershipAsync(foreignTranscriptFile, criteriaWithFolder0);
    assert.strictEqual(
      isForeignOwner,
      false,
      'verifyConversationOwnershipAsync must reject transcript with alien workspace and snippet'
    );
    console.log('✔ Alien transcript rejected successfully without false positives');

    // -------------------------------------------------------------------------
    // Test Case 3: Case-Insensitivity on Windows Paths
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Testing Case-Insensitive Drive Letter & Path Normalization ---');
    const caseTranscriptFile = path.join(tmpDir, 'transcript_case.jsonl');
    const casePromptLine = JSON.stringify({
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      content: 'Implement the work in D:\\SKUL9X\\ALLNEW-VACCINEANALYZER\\PLANS\\PHASE-04.MD'
    }) + '\n';
    fs.writeFileSync(caseTranscriptFile, casePromptLine, 'utf8');

    const caseCriteria: ConversationOwnershipCriteria = {
      expectedPromptSnippet: 'phase-04.md',
      workspacePath: 'd:\\skul9x\\allnew-vaccineanalyzer',
      workspaceName: 'allnew-vaccineanalyzer',
      workspaceFolders: ['allnew-vaccineanalyzer']
    };

    const isCaseOwner = await verifyConversationOwnershipAsync(caseTranscriptFile, caseCriteria);
    assert.strictEqual(
      isCaseOwner,
      true,
      'verifyConversationOwnershipAsync must match paths case-insensitively'
    );
    console.log('✔ Case-insensitive drive letter & path normalization verified');

    // -------------------------------------------------------------------------
    // Test Case 4: Orchestrator Target Workspace Folder Resolution
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing Orchestrator resolveTargetWorkspaceFolder ---');
    const orchestrator = new Orchestrator();

    const matchedWs = orchestrator.resolveTargetWorkspaceFolder(
      'd:/skul9x/AllNew-VaccineAnalyzer/plans/261108-1930-wpf-ui-overhaul-pyside-parity/phase-04.md'
    );
    assert.ok(matchedWs, 'Should find matching WorkspaceFolder');
    assert.strictEqual(matchedWs.name, 'AllNew-VaccineAnalyzer');
    assert.strictEqual(matchedWs.uri.fsPath, 'd:\\skul9x\\AllNew-VaccineAnalyzer');
    console.log(`✔ Correctly matched folder 2 ("${matchedWs.name}") instead of folder 0`);

    const fallbackWs = orchestrator.resolveTargetWorkspaceFolder(undefined);
    assert.strictEqual(fallbackWs, undefined, 'Undefined target should return undefined');
    console.log('✔ Undefined target safely returns undefined');

    console.log('\n======================================================================');
    console.log('🎉 ALL PHASE 06 MULTI-ROOT WORKSPACE TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================================\n');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { }
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
