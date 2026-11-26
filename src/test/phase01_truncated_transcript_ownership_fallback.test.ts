// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          {
            uri: { fsPath: '/home/skul9x/Desktop/Code/VietDuc-HIS' },
            name: 'VietDuc-HIS'
          }
        ],
        name: 'VietDuc-HIS'
      },
      env: {
        appRoot: undefined
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  ConversationOwnershipCriteria,
  verifyConversationOwnershipAsync,
  clearConversationOwnershipCache
} from '../transcriptWatcher';

function createTempBrainDir(): string {
  const tempDir = path.join(
    os.tmpdir(),
    `agy_brain_trunc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function cleanupDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

function createConvLogDir(brainDir: string, convId: string): string {
  const logDir = path.join(brainDir, convId, '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  return logDir;
}

function buildCompactStep0(promptHead: string, promptTail: string, paddingLen = 3600): Record<string, any> {
  const middleFiller = 'x'.repeat(paddingLen);
  const content =
    `<USER_REQUEST>\n${promptHead}\n... [truncated ${middleFiller}] ...\n${promptTail}\n</USER_REQUEST>\n` +
    `<ADDITIONAL_METADATA>\nActive Document: /home/skul9x/Desktop/Code/VietDuc-HIS/plans/261125-1920-cleartext-network-guard/phase-02-okhttp-cleartext-network-guard-interceptor.md\n</ADDITIONAL_METADATA>\n` +
    `<user_information>\nActive Workspaces:\n- /home/skul9x/Desktop/Code/VietDuc-HIS\n</user_information>`;
  return {
    step_index: 0,
    source: 'USER_EXPLICIT',
    type: 'USER_INPUT',
    status: 'DONE',
    truncated_fields: ['content'],
    content
  };
}

function buildFullStep0(promptHead: string, phaseFilePath: string, promptTail: string): Record<string, any> {
  const middleBody = 'detailed_instruction_block '.repeat(210); // ~5.6KB+
  const content =
    `<USER_REQUEST>\n${promptHead}\n${middleBody}\n"phase_file": "${phaseFilePath}",\n${promptTail}\n</USER_REQUEST>\n` +
    `<ADDITIONAL_METADATA>\nActive Document: /home/skul9x/Desktop/Code/VietDuc-HIS/plans/261125-1920-cleartext-network-guard/phase-02-okhttp-cleartext-network-guard-interceptor.md\n</ADDITIONAL_METADATA>\n` +
    `<user_information>\nActive Workspaces:\n- /home/skul9x/Desktop/Code/VietDuc-HIS\n</user_information>`;
  return {
    step_index: 0,
    source: 'USER_EXPLICIT',
    type: 'USER_INPUT',
    status: 'DONE',
    content
  };
}

async function runTests(): Promise<void> {
  console.log('=== Running Phase 01: Truncated Transcript Ownership Fallback Tests ===\n');

  const promptHead = '{\n  "steps": [\n    {\n      "id": 0,\n      "name": "Project Recap"';
  const promptTail = '"completion_response": "Done skul9x."\n}';
  const targetPhaseName = 'phase-03-webview-pacs-url-guard-and-diagnostics.md';
  const targetPhasePath = `/home/skul9x/Desktop/Code/VietDuc-HIS/plans/261125-1920-cleartext-network-guard/${targetPhaseName}`;

  const baseCriteria: ConversationOwnershipCriteria = {
    expectedPromptSnippet: targetPhaseName,
    workspacePath: '/home/skul9x/Desktop/Code/VietDuc-HIS',
    workspaceName: 'VietDuc-HIS',
    workspaceFolders: ['VietDuc-HIS'],
    workspaceTitle: 'VietDuc-HIS'
  };

  // ==========================================================================
  // Scenario 1: Real-World Compact Log + Sibling transcript_full.jsonl Rescue
  // ==========================================================================
  console.log('[Test 1] Compact log (~4.4KB truncated step 0) rescued by sibling transcript_full.jsonl...');
  clearConversationOwnershipCache();
  const brainDir1 = createTempBrainDir();
  try {
    const logDir = createConvLogDir(brainDir1, '83fd8d56-4b8a-4984-9eca-9e8cf58401c9');
    const transcriptPath = path.join(logDir, 'transcript.jsonl');
    const fullTranscriptPath = path.join(logDir, 'transcript_full.jsonl');

    const compactLine = JSON.stringify(buildCompactStep0(promptHead, promptTail, 3600)) + '\n';
    assert.ok(Buffer.byteLength(compactLine, 'utf8') > 4000, 'Compact line should be ~4KB+');
    fs.writeFileSync(transcriptPath, compactLine, 'utf8');

    const fullLine = JSON.stringify(buildFullStep0(promptHead, targetPhasePath, promptTail)) + '\n';
    assert.ok(Buffer.byteLength(fullLine, 'utf8') > 6000, 'Full line should be >6KB');
    fs.writeFileSync(fullTranscriptPath, fullLine, 'utf8');

    const isOwner = await verifyConversationOwnershipAsync(transcriptPath, baseCriteria);
    assert.strictEqual(isOwner, true, 'Must claim ownership via sibling transcript_full.jsonl');
    console.log('✓ Test 1 passed.');
  } finally {
    cleanupDir(brainDir1);
  }

  // ==========================================================================
  // Scenario 2: Truncated Delayed-Flush Cache Resilience
  // ==========================================================================
  console.log('\n[Test 2] Delayed transcript_full.jsonl flush without poisoning LRU cache...');
  clearConversationOwnershipCache();
  const brainDir2 = createTempBrainDir();
  try {
    const logDir = createConvLogDir(brainDir2, '8169fba6-b395-4db2-a6ab-3b69b0ccfb1f');
    const transcriptPath = path.join(logDir, 'transcript.jsonl');
    const fullTranscriptPath = path.join(logDir, 'transcript_full.jsonl');

    const compactLine = JSON.stringify(buildCompactStep0(promptHead, promptTail, 3600)) + '\n';
    fs.writeFileSync(transcriptPath, compactLine, 'utf8');
    const statBefore = fs.statSync(transcriptPath);

    // 1. Before transcript_full.jsonl exists -> must return false, AND NOT poison cache
    const firstCheck = await verifyConversationOwnershipAsync(transcriptPath, baseCriteria, {
      mtimeMs: statBefore.mtimeMs,
      size: statBefore.size
    });
    assert.strictEqual(firstCheck, false, 'Should return false before transcript_full.jsonl exists');

    // 2. Write transcript_full.jsonl WITHOUT changing transcript.jsonl mtime or size
    const fullLine = JSON.stringify(buildFullStep0(promptHead, targetPhasePath, promptTail)) + '\n';
    fs.writeFileSync(fullTranscriptPath, fullLine, 'utf8');

    const secondCheck = await verifyConversationOwnershipAsync(transcriptPath, baseCriteria, {
      mtimeMs: statBefore.mtimeMs,
      size: statBefore.size
    });
    assert.strictEqual(
      secondCheck,
      true,
      'Subsequent check with same transcript.jsonl mtime/size must immediately return true once transcript_full.jsonl exists'
    );
    console.log('✓ Test 2 passed.');
  } finally {
    cleanupDir(brainDir2);
  }

  // ==========================================================================
  // Scenario 3: Extended 32KB Scan Fallback Without transcript_full.jsonl
  // ==========================================================================
  console.log('\n[Test 3] Extended 32KB scan finds phase snippet at ~14KB offset without transcript_full.jsonl...');
  clearConversationOwnershipCache();
  const brainDir3 = createTempBrainDir();
  try {
    const logDir = createConvLogDir(brainDir3, '32961cc0-9163-4814-b956-763596b56d99');
    const transcriptPath = path.join(logDir, 'transcript.jsonl');

    const compactLine = JSON.stringify(buildCompactStep0(promptHead, promptTail, 3600)) + '\n';
    const fillerSteps: string[] = [];
    let currentSize = Buffer.byteLength(compactLine, 'utf8');
    let stepIdx = 1;
    while (currentSize < 13500) {
      const stepLine =
        JSON.stringify({
          step_index: stepIdx++,
          type: 'THOUGHT',
          content: 'Analyzing project structure and dependencies... ' + 'a'.repeat(1800)
        }) + '\n';
      fillerSteps.push(stepLine);
      currentSize += Buffer.byteLength(stepLine, 'utf8');
    }

    const toolStep =
      JSON.stringify({
        step_index: stepIdx,
        type: 'TOOL_CALL',
        content: `Reading ${targetPhasePath}`
      }) + '\n';

    fs.writeFileSync(transcriptPath, compactLine + fillerSteps.join('') + toolStep, 'utf8');

    const isOwner = await verifyConversationOwnershipAsync(transcriptPath, baseCriteria);
    assert.strictEqual(isOwner, true, 'Extended 32KB scan must find snippet at ~14KB offset');
    console.log('✓ Test 3 passed.');
  } finally {
    cleanupDir(brainDir3);
  }

  // ==========================================================================
  // Scenario 4: Structural Head + Tail Fallback
  // ==========================================================================
  console.log('\n[Test 4] Structural expectedPromptHead + expectedPromptTail fallback...');
  clearConversationOwnershipCache();
  const brainDir4 = createTempBrainDir();
  try {
    const logDir = createConvLogDir(brainDir4, 'conv_head_tail_004');
    const transcriptPath = path.join(logDir, 'transcript.jsonl');
    const compactLine = JSON.stringify(buildCompactStep0(promptHead, promptTail, 3600)) + '\n';
    fs.writeFileSync(transcriptPath, compactLine, 'utf8');

    const headTailCriteria: ConversationOwnershipCriteria = {
      ...baseCriteria,
      expectedPromptHead: promptHead,
      expectedPromptTail: promptTail
    };

    // 4a. Matching head + tail + workspace -> true
    const matched = await verifyConversationOwnershipAsync(transcriptPath, headTailCriteria);
    assert.strictEqual(matched, true, 'Must accept when truncated step-0 matches head, tail, and workspace');

    // 4b. Mismatched tail -> false
    const badTailCriteria: ConversationOwnershipCriteria = {
      ...headTailCriteria,
      expectedPromptTail: '"completion_response": "DIFFERENT_TAIL_1234567890"'
    };
    const tailMismatch = await verifyConversationOwnershipAsync(transcriptPath, badTailCriteria);
    assert.strictEqual(tailMismatch, false, 'Must reject when expectedPromptTail mismatches');

    // 4c. Mismatched workspace -> false
    const badWorkspaceCriteria: ConversationOwnershipCriteria = {
      ...headTailCriteria,
      workspacePath: '/home/skul9x/Desktop/Code/OtherProject',
      workspaceName: 'OtherProject',
      workspaceFolders: ['OtherProject']
    };
    const wsMismatch = await verifyConversationOwnershipAsync(transcriptPath, badWorkspaceCriteria);
    assert.strictEqual(wsMismatch, false, 'Must reject when workspace mismatches even if head+tail match');

    console.log('✓ Test 4 passed.');
  } finally {
    cleanupDir(brainDir4);
  }

  // ==========================================================================
  // Scenario 5: Strict Alien Prompt Rejection Preserved
  // ==========================================================================
  console.log('\n[Test 5] Untruncated alien prompts and foreign workspaces remain strictly rejected...');
  clearConversationOwnershipCache();
  const brainDir5 = createTempBrainDir();
  try {
    const logDir = createConvLogDir(brainDir5, 'conv_alien_005');
    const transcriptPath = path.join(logDir, 'transcript.jsonl');

    const alienLine =
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        content: '<USER_REQUEST>\nHelp me debug Auto-Plan Extension settings UI.\n</USER_REQUEST>'
      }) + '\n';
    fs.writeFileSync(transcriptPath, alienLine, 'utf8');

    const isOwner = await verifyConversationOwnershipAsync(transcriptPath, {
      ...baseCriteria,
      expectedPromptHead: promptHead,
      expectedPromptTail: promptTail
    });
    assert.strictEqual(isOwner, false, 'Untruncated alien prompt must strictly return false');
    console.log('✓ Test 5 passed.');
  } finally {
    cleanupDir(brainDir5);
  }

  console.log('\n======================================================================');
  console.log('🎉 All Phase 01 Truncated Transcript Ownership Fallback Tests PASSED!');
  console.log('======================================================================');
}

runTests().catch((err) => {
  console.error('❌ Phase 01 Test Failed:', err);
  process.exit(1);
});
