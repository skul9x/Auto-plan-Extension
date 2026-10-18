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
  TranscriptTailEngine,
  extractUserPrompt,
  UserInputEvent,
  ConversationChangedEvent
} from '../transcriptTailEngine';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase01PerfThrottleTests() {
  console.log('=== Running Phase 01: Tail Engine Discovery Throttle & Fast Prompt Tests ===\n');

  const testBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-p01-perf-'));

  try {
    // =========================================================================
    // Part 1: Fast-Path & Targeted extractUserPrompt (PERF-04)
    // =========================================================================
    console.log('[Part 1] Testing Fast-Path & Targeted extractUserPrompt...');

    // 1A. Plain text fast-path (no '<' delimiters)
    const plainText = 'How do I optimize database queries?';
    assert.strictEqual(
      extractUserPrompt(plainText),
      plainText,
      'Plain text must return trimmed string without invoking regex'
    );
    assert.strictEqual(
      extractUserPrompt('   Whitespace around plain text   \n'),
      'Whitespace around plain text',
      'Plain text with whitespace should be trimmed cleanly'
    );

    // 1B. Single <USER_REQUEST> block with large outer system wrapper
    const hugeOuterWrapper = '# System Identity\n' + 'System prompt instruction.\n'.repeat(500) +
      '<USER_REQUEST>\nImplement a LRU Cache in TypeScript\n</USER_REQUEST>\n' +
      '<ADDITIONAL_METADATA>\ntime: 2026-10-12T06:00:00Z\n</ADDITIONAL_METADATA>';

    const prompt1B = extractUserPrompt(hugeOuterWrapper);
    assert.strictEqual(
      prompt1B,
      'Implement a LRU Cache in TypeScript',
      'Prompt must isolate inner substring directly from massive system wrapper'
    );

    // 1C. Multiple <USER_REQUEST> blocks (must extract the last active block)
    const multiTurnPayload = '# History\n' +
      '<USER_REQUEST>First prompt in history</USER_REQUEST>\n' +
      'Assistant answer.\n' +
      '<USER_REQUEST>\nLatest active prompt to execute\n</USER_REQUEST>\n' +
      '<ADDITIONAL_METADATA>context</ADDITIONAL_METADATA>';

    const prompt1C = extractUserPrompt(multiTurnPayload);
    assert.strictEqual(
      prompt1C,
      'Latest active prompt to execute',
      'Must select the final <USER_REQUEST> block'
    );

    // 1D. Nested tags inside the user request snippet
    const nestedTagsPayload = '<USER_REQUEST>\nRun test suite\n<ADDITIONAL_METADATA>metadata inside</ADDITIONAL_METADATA>\n</USER_REQUEST>';
    const prompt1D = extractUserPrompt(nestedTagsPayload);
    assert.strictEqual(
      prompt1D,
      'Run test suite',
      'Should strip nested metadata tags from within isolated snippet'
    );

    // 1E. System wrappers without <USER_REQUEST>
    const systemWrappedWithoutUserRequest = '<system>System message</system>\n<conversation_summaries>Summary</conversation_summaries>\nBuild a REST API in Node.js';
    const prompt1E = extractUserPrompt(systemWrappedWithoutUserRequest);
    assert.strictEqual(
      prompt1E,
      'Build a REST API in Node.js',
      'Should strip outer tags when <USER_REQUEST> is absent'
    );

    // 1F. Empty / falsy inputs
    assert.strictEqual(extractUserPrompt(''), '');
    assert.strictEqual(extractUserPrompt(null as any), '');
    assert.strictEqual(extractUserPrompt(undefined as any), '');

    console.log('  ✓ Fast-path & targeted prompt extraction passed all assertions.\n');

    // =========================================================================
    // Part 2: Candidate Folder Pruning in findLatestConversation (PERF-01)
    // =========================================================================
    console.log('[Part 2] Testing Candidate Folder Pruning in findLatestConversation...');

    const pruningBrainDir = path.join(testBaseDir, 'brain-pruning');
    fs.mkdirSync(pruningBrainDir, { recursive: true });

    const totalSessions = 40;
    const baseTime = Date.now() + 100000;

    for (let i = 0; i < totalSessions; i++) {
      const convId = `session-${String(i).padStart(3, '0')}`;
      const convDir = path.join(pruningBrainDir, convId);
      fs.mkdirSync(convDir, { recursive: true });
      const folderTime = (baseTime + i * 1000) / 1000;

      // Create transcript for odd sessions
      if (i % 2 === 1) {
        const transcriptPath = path.join(convDir, 'transcript.jsonl');
        fs.writeFileSync(transcriptPath, `{"step_index":1,"type":"USER_INPUT","content":"session ${i}"}\n`);
        fs.utimesSync(transcriptPath, folderTime, folderTime);
      }
      fs.utimesSync(convDir, folderTime, folderTime);
    }

    const pruningEngine = new TranscriptTailEngine({
      brainDir: pruningBrainDir,
      maxDiscoveryCandidates: 10
    });

    const discoveredLatest = await pruningEngine.findLatestConversation();
    assert.strictEqual(
      discoveredLatest,
      'session-039',
      'findLatestConversation must identify the newest session among 40 folders with candidate pruning'
    );
    console.log('  ✓ Candidate folder pruning identified latest session correctly.\n');

    // =========================================================================
    // Part 3: Steady-State Polling Throttling & Decoupled Byte-Offset Read (PERF-01)
    // =========================================================================
    console.log('[Part 3] Verifying >90% reduction in disk stat operations during steady-state tailing...');

    const steadyBrainDir = path.join(testBaseDir, 'brain-steady');
    const conv1Dir = path.join(steadyBrainDir, 'conv-active');
    const logsDir = path.join(conv1Dir, '.system_generated', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const transcript1Path = path.join(logsDir, 'transcript.jsonl');
    fs.writeFileSync(transcript1Path, '{"step_index":1,"type":"USER_INPUT","content":"Initial prompt"}\n');

    // Instrument findLatestConversation to monitor invocation count
    let discoveryCallCount = 0;
    const throttledEngine = new TranscriptTailEngine({
      brainDir: steadyBrainDir,
      activeConvId: 'conv-active',
      pollIntervalMs: 40,
      discoveryThrottleMs: 2000 // 2 second throttle
    });

    const originalFindLatest = throttledEngine.findLatestConversation.bind(throttledEngine);
    throttledEngine.findLatestConversation = async () => {
      discoveryCallCount++;
      return originalFindLatest();
    };

    const userInputEvents: UserInputEvent[] = [];
    throttledEngine.on('userInput', (e) => {
      userInputEvents.push(e);
    });

    await throttledEngine.start();

    // Verify initial read on active conversation
    assert.strictEqual(userInputEvents.length, 1, 'Initial user input must be read at start');
    assert.strictEqual(userInputEvents[0].prompt, 'Initial prompt');

    // Let steady-state tailing run for ~400ms (10 poll intervals)
    await sleep(400);

    // Total poll ticks in 400ms at 40ms interval is ~10 ticks.
    // Unthrottled implementation would invoke findLatestConversation 10 times.
    // Throttled implementation should invoke findLatestConversation 0 times during steady-state (or at most 1).
    assert.ok(
      discoveryCallCount <= 1,
      `Steady-state discovery calls (${discoveryCallCount}) must be <= 1 during 400ms throttle interval (expected 0)`
    );
    console.log(`  ✓ Discovery directory scan count: ${discoveryCallCount} across 10 polling ticks (>90% reduction).`);

    // Verify byte-offset reading still functions seamlessly during steady-state
    fs.appendFileSync(transcript1Path, '{"step_index":2,"type":"USER_INPUT","content":"Appended second prompt"}\n');
    await sleep(150);

    assert.strictEqual(userInputEvents.length, 2, 'New appended lines must be detected via fast byte-offset reading');
    assert.strictEqual(userInputEvents[1].prompt, 'Appended second prompt');
    console.log('  ✓ Incremental byte-offset streaming verified during steady-state polling.\n');

    // =========================================================================
    // Part 4: Responsive Event-Driven Discovery on New Conversation Spawn (PERF-01)
    // =========================================================================
    console.log('[Part 4] Verifying event-driven discovery responsiveness when new session is spawned...');

    let conversationChangedFired = false;
    let newConvIdReported = '';
    throttledEngine.on('conversationChanged', (e: ConversationChangedEvent) => {
      conversationChangedFired = true;
      newConvIdReported = e.newConvId;
    });

    // Spawn a brand new conversation directory in steadyBrainDir
    const newConvId = 'conv-spawned-next';
    const newConvDir = path.join(steadyBrainDir, newConvId);
    const newLogsDir = path.join(newConvDir, '.system_generated', 'logs');
    fs.mkdirSync(newLogsDir, { recursive: true });

    // Set future mtime on new folder so it is newer than conv-active
    const futureTime = (Date.now() + 5000) / 1000;
    fs.utimesSync(newConvDir, futureTime, futureTime);

    const newTranscriptPath = path.join(newLogsDir, 'transcript.jsonl');
    fs.writeFileSync(
      newTranscriptPath,
      '{"step_index":1,"type":"USER_INPUT","content":"Hello from spawned session"}\n'
    );
    fs.utimesSync(newTranscriptPath, futureTime, futureTime);

    // Even though discoveryThrottleMs is 2000ms, the brainDir watcher must immediately
    // trigger discovery (within ~300ms) without waiting for the 2000ms timer!
    await sleep(400);

    assert.strictEqual(conversationChangedFired, true, 'conversationChanged event must be emitted promptly on new session');
    assert.strictEqual(newConvIdReported, newConvId, 'Engine must switch to newly spawned conversation ID');
    assert.strictEqual(throttledEngine.getActiveConvId(), newConvId, 'Active conversation ID on engine must be updated');

    // Verify prompt extraction from the newly transitioned conversation
    const spawnedInputs = userInputEvents.filter((e) => e.convId === newConvId);
    assert.strictEqual(spawnedInputs.length, 1, 'Spawned session prompt must be parsed and emitted');
    assert.strictEqual(spawnedInputs[0].prompt, 'Hello from spawned session');
    console.log('  ✓ Event-driven watcher triggered immediate switch to spawned session.\n');

    throttledEngine.stop();

    console.log('=== All Phase 01 Performance & Discovery Tests Passed Successfully! ===');
  } finally {
    // Cleanup temporary test directory
    try {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase01PerfThrottleTests().catch((err) => {
  console.error('Phase 01 Test Failed:', err);
  process.exit(1);
});
