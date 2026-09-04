// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          {
            uri: { fsPath: '/home/skul9x/Desktop/Code/TramsacEV' },
            name: 'TramsacEV'
          }
        ],
        name: 'TramsacEV'
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
  TranscriptWatcher,
  ConversationOwnershipCriteria,
  verifyConversationOwnershipAsync,
  getCandidateConversationsAsync,
  findLatestConversationAsync
} from '../transcriptWatcher';
import { Orchestrator } from '../orchestrator';
import { DebugLogger } from '../debugLogger';

function createTempBrainDir(): string {
  const tempDir = path.join(
    os.tmpdir(),
    `agy_brain_ownership_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function cleanupDir(dirPath: string) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeTranscriptFile(convDir: string, lines: any[]) {
  const logDir = path.join(convDir, '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const tPath = path.join(logDir, 'transcript.jsonl');
  const content = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
  fs.writeFileSync(tPath, content, 'utf8');
  return tPath;
}

async function runPhase02ConversationOwnershipTests() {
  console.log('=== Running Phase 02: Transcript Prompt Fingerprint & Workspace Ownership Verification Tests ===\n');

  // ==========================================================================
  // Test 1: Foreign Prompt Rejection
  // Candidate with foreign user prompt (e.g. from Auto-Plan chat) is rejected
  // when searching for TramsacEV phase.
  // ==========================================================================
  console.log('[Test 1] Verifying candidate with foreign user prompt is rejected...');
  const brainDir1 = createTempBrainDir();
  try {
    const baseTime = Date.now() - 2000;
    const foreignConvId = 'conv_foreign_chat_001';
    const foreignDir = path.join(brainDir1, foreignConvId);
    fs.mkdirSync(foreignDir, { recursive: true });

    const foreignTranscriptPath = writeTranscriptFile(foreignDir, [
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        content: '<USER_REQUEST>\nHow do I configure settings in Auto-Plan Extension?\n</USER_REQUEST>'
      }
    ]);

    const criteria: ConversationOwnershipCriteria = {
      expectedPromptSnippet: 'phase-02-favorites-sync-metric-preservation.md',
      workspacePath: '/home/skul9x/Desktop/Code/TramsacEV'
    };

    // 1. Direct verify check
    const isOwner = await verifyConversationOwnershipAsync(foreignTranscriptPath, criteria);
    assert.strictEqual(isOwner, false, 'verifyConversationOwnershipAsync must reject foreign prompt');

    // 2. getCandidateConversationsAsync check
    let skippedCount = 0;
    const candidates = await getCandidateConversationsAsync(
      brainDir1,
      baseTime,
      undefined,
      criteria,
      (convId, crit) => {
        if (convId === foreignConvId) {
          skippedCount++;
        }
      }
    );
    assert.strictEqual(candidates.length, 0, 'getCandidateConversationsAsync must filter out foreign candidate');
    assert.strictEqual(skippedCount, 1, 'onCandidateSkipped callback must be invoked for foreign candidate');

    // 3. waitForNewConversation timeout with candidateSkipped event check
    const watcher = new TranscriptWatcher({
      brainDir: brainDir1,
      pollIntervalMs: 50,
      ownershipCriteria: criteria
    });

    let eventSkippedConvId = '';
    watcher.on('candidateSkipped', (data) => {
      eventSkippedConvId = data.convId;
    });

    let caughtError: any = null;
    try {
      await watcher.waitForNewConversation(baseTime, undefined, 200, 50);
    } catch (err: any) {
      caughtError = err;
    }
    watcher.stop();

    assert.ok(caughtError, 'waitForNewConversation should time out because foreign candidate was rejected');
    assert.strictEqual(eventSkippedConvId, foreignConvId, 'watcher must emit candidateSkipped for foreign candidate');
    console.log('✓ Test 1: Foreign conversation rejection verified cleanly.');
  } finally {
    cleanupDir(brainDir1);
  }

  // ==========================================================================
  // Test 2: Matching Candidate Acceptance
  // Candidate with matching phase snippet is accepted immediately.
  // ==========================================================================
  console.log('\n[Test 2] Verifying candidate with matching phase snippet is accepted immediately...');
  const brainDir2 = createTempBrainDir();
  try {
    const baseTime = Date.now() - 2000;
    const matchingConvId = 'conv_tramsac_phase02';
    const matchingDir = path.join(brainDir2, matchingConvId);
    fs.mkdirSync(matchingDir, { recursive: true });

    const matchingTranscriptPath = writeTranscriptFile(matchingDir, [
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        content:
          '<USER_REQUEST>\nImplement the code closely following the file /home/skul9x/Desktop/Code/TramsacEV/plans/260904-1015-fix-high-issues/phase-02-favorites-sync-metric-preservation.md\n</USER_REQUEST>'
      }
    ]);

    const criteria: ConversationOwnershipCriteria = {
      expectedPromptSnippet: 'phase-02-favorites-sync-metric-preservation.md',
      workspacePath: '/home/skul9x/Desktop/Code/TramsacEV'
    };

    // 1. Direct verify check
    const isOwner = await verifyConversationOwnershipAsync(matchingTranscriptPath, criteria);
    assert.strictEqual(isOwner, true, 'verifyConversationOwnershipAsync must accept matching prompt');

    // 2. getCandidateConversationsAsync check
    const candidates = await getCandidateConversationsAsync(brainDir2, baseTime, undefined, criteria);
    assert.strictEqual(candidates.length, 1, 'getCandidateConversationsAsync must return matching candidate');
    assert.strictEqual(candidates[0].convId, matchingConvId);

    // 3. waitForNewConversation acceptance check
    const watcher = new TranscriptWatcher({
      brainDir: brainDir2,
      pollIntervalMs: 50,
      ownershipCriteria: criteria
    });

    const detectedConv = await watcher.waitForNewConversation(baseTime, undefined, 2000, 50);
    watcher.stop();
    assert.strictEqual(detectedConv, matchingConvId, 'waitForNewConversation must return matching conversation');
    console.log('✓ Test 2: Matching candidate prompt fingerprint accepted immediately.');
  } finally {
    cleanupDir(brainDir2);
  }

  // ==========================================================================
  // Test 3: Polling Loop Waits Through Temporary 0-byte Transcript
  // Polling loop waits through temporary 0-byte transcript until step 0 is written.
  // ==========================================================================
  console.log('\n[Test 3] Verifying polling loop waits through temporary 0-byte transcript until written...');
  const brainDir3 = createTempBrainDir();
  try {
    const baseTime = Date.now() - 500;
    const delayedConvId = 'conv_delayed_flush_003';
    const delayedDir = path.join(brainDir3, delayedConvId);
    const logDir = path.join(delayedDir, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const transcriptPath = path.join(logDir, 'transcript.jsonl');

    // Initially create empty (0-byte) transcript file
    fs.writeFileSync(transcriptPath, '', 'utf8');

    const criteria: ConversationOwnershipCriteria = {
      expectedPromptSnippet: 'phase-02-favorites-sync-metric-preservation.md'
    };

    // 0-byte file should verify as false initially
    const verifyInitial = await verifyConversationOwnershipAsync(transcriptPath, criteria);
    assert.strictEqual(verifyInitial, false, 'verifyConversationOwnershipAsync must return false for 0-byte file');

    const watcher = new TranscriptWatcher({
      brainDir: brainDir3,
      pollIntervalMs: 40,
      ownershipCriteria: criteria
    });

    const waitPromise = watcher.waitForNewConversation(baseTime, undefined, 4000, 40);

    // Simulate backend delayed flush after 200ms
    setTimeout(() => {
      const step0 = JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        content: '<USER_REQUEST>\nExecute phase-02-favorites-sync-metric-preservation.md\n</USER_REQUEST>'
      }) + '\n';
      fs.writeFileSync(transcriptPath, step0, 'utf8');
    }, 200);

    const resolvedConv = await waitPromise;
    watcher.stop();

    assert.strictEqual(resolvedConv, delayedConvId, 'waitForNewConversation must wait and resolve after 0-byte file is written');
    console.log('✓ Test 3: Polling loop handled temporary 0-byte transcript and resolved after flush.');
  } finally {
    cleanupDir(brainDir3);
  }

  // ==========================================================================
  // Test 4: Regression Check - Legacy Behavior Without Criteria
  // When no criteria is provided, legacy behavior (time-only matching) remains functional.
  // ==========================================================================
  console.log('\n[Test 4] Verifying regression check: Legacy behavior when no criteria is provided...');
  const brainDir4 = createTempBrainDir();
  try {
    const baseTime = Date.now() - 2000;
    const legacyConvId = 'conv_legacy_unfiltered_004';
    const legacyDir = path.join(brainDir4, legacyConvId);
    fs.mkdirSync(legacyDir, { recursive: true });

    writeTranscriptFile(legacyDir, [
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        content: 'Arbitrary message without any phase keywords'
      }
    ]);

    // 1. Without criteria, getCandidateConversationsAsync should include it
    const candidates = await getCandidateConversationsAsync(brainDir4, baseTime);
    assert.strictEqual(candidates.length, 1, 'Legacy getCandidateConversationsAsync must return candidate');
    assert.strictEqual(candidates[0].convId, legacyConvId);

    // 2. findLatestConversationAsync should also find it
    const latest = await findLatestConversationAsync(brainDir4, baseTime);
    assert.strictEqual(latest, legacyConvId);

    // 3. waitForNewConversation without criteria should return it
    const watcher = new TranscriptWatcher({
      brainDir: brainDir4,
      pollIntervalMs: 50
    });
    const detected = await watcher.waitForNewConversation(baseTime, undefined, 2000, 50);
    watcher.stop();
    assert.strictEqual(detected, legacyConvId, 'Legacy waitForNewConversation must return candidate without criteria');
    console.log('✓ Test 4: Legacy behavior verified with backwards compatibility.');
  } finally {
    cleanupDir(brainDir4);
  }

  // ==========================================================================
  // Test 5: Orchestrator Integration & Diagnostic Log Verification
  // Verify Orchestrator diagnostic logging when foreign conversation is skipped.
  // ==========================================================================
  console.log('\n[Test 5] Verifying Orchestrator diagnostic logging for foreign skipped conversations...');
  const brainDir5 = createTempBrainDir();
  try {
    const baseTime = Date.now() - 2000;
    const foreignConvId = 'conv_foreign_005';
    const foreignDir = path.join(brainDir5, foreignConvId);
    fs.mkdirSync(foreignDir, { recursive: true });

    writeTranscriptFile(foreignDir, [
      {
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        content: 'Different prompt not matching phase snippet'
      }
    ]);

    const logger = new DebugLogger();
    const loggedWarns: string[] = [];
    logger.warn = ((component: any, msg: string, details?: any) => {
      loggedWarns.push(msg);
    }) as any;

    const watcher = new TranscriptWatcher({
      brainDir: brainDir5,
      pollIntervalMs: 50
    });

    const orchestrator = new Orchestrator({
      transcriptWatcher: watcher,
      debugLogger: logger
    });

    const criteria: ConversationOwnershipCriteria = {
      expectedPromptSnippet: 'phase-02-favorites-sync-metric-preservation.md'
    };

    let caughtErr: any = null;
    try {
      await orchestrator.waitForNewConversation(
        baseTime,
        undefined,
        250,
        50,
        true,
        { phaseIndex: 1, fileName: 'phase-02-favorites-sync-metric-preservation.md' },
        criteria
      );
    } catch (err: any) {
      caughtErr = err;
    }
    watcher.stop();

    assert.ok(caughtErr, 'Orchestrator waitForNewConversation must timeout when foreign candidate skipped');
    const expectedLogSnippet = `Skipping foreign conversation ${foreignConvId} (failed ownership verification for phase-02-favorites-sync-metric-preservation.md)`;
    const logFound = loggedWarns.some((msg) => msg.includes(expectedLogSnippet));
    assert.strictEqual(
      logFound,
      true,
      `Orchestrator must log exact expected warning: "${expectedLogSnippet}". Logs were: ${JSON.stringify(loggedWarns)}`
    );
    console.log('✓ Test 5: Orchestrator diagnostic logging on ownership mismatch verified.');
  } finally {
    cleanupDir(brainDir5);
  }

  console.log('\n======================================================================');
  console.log('🎉 All Phase 02 Conversation Ownership Verification Tests PASSED cleanly!');
  console.log('======================================================================\n');
}

runPhase02ConversationOwnershipTests().catch((err) => {
  console.error('❌ Phase 02 Test Failed:', err);
  process.exit(1);
});
