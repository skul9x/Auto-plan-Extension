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
  PlannerResponseEvent,
  AgentActivityEvent,
  ConversationChangedEvent
} from '../transcriptTailEngine';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase01TranscriptTailEngineTests() {
  console.log('=== Running Phase 01: Continuous Transcript Tail Engine & Event Emitter Tests ===\n');

  const tempBrainDir = fs.mkdtempSync(path.join(os.homedir(), '.gemini-test-brain-p01-'));

  try {
    // =========================================================================
    // Test 1: extractUserPrompt extraction & XML/metadata sanitization
    // =========================================================================
    console.log('[Test 1] Verifying extractUserPrompt across complex prompt payloads...');

    // Case 1A: Realistic complex payload with history, XML wrappers, and trailing metadata
    const complexPayload = `# Conversation History
Here are the conversation IDs, titles, and summaries of your most recent 2 conversations:
<conversation_summaries>
## Conversation c1: Test
- Summary: Test
</conversation_summaries><USER_REQUEST>
Implement the binary search algorithm in TypeScript.
</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-10-11T20:30:00+07:00.
Active Document: /workspace/index.ts
</ADDITIONAL_METADATA>
<USER_SETTINGS_CHANGE>
Model Selection: Gemini 3.8 Flash
</USER_SETTINGS_CHANGE>`;

    const prompt1A = extractUserPrompt(complexPayload);
    assert.strictEqual(
      prompt1A,
      'Implement the binary search algorithm in TypeScript.',
      '1A: Prompt should cleanly extract inner <USER_REQUEST> content without history or metadata'
    );

    // Case 1B: Multiple <USER_REQUEST> tags from prior conversation history
    const multiTagPayload = `# History
User said: <USER_REQUEST>Previous question</USER_REQUEST>
Agent responded.
Now current turn:
<USER_REQUEST>
What is the time complexity of quicksort?
</USER_REQUEST>
<ADDITIONAL_METADATA>some metadata</ADDITIONAL_METADATA>`;

    const prompt1B = extractUserPrompt(multiTagPayload);
    assert.strictEqual(
      prompt1B,
      'What is the time complexity of quicksort?',
      '1B: Multi-tag payload must select the active (last) <USER_REQUEST> block'
    );

    // Case 1C: Simple <USER_REQUEST> with whitespace padding
    const simpleTagPayload = `   <USER_REQUEST>   Explain closures in JavaScript   </USER_REQUEST>   `;
    const prompt1C = extractUserPrompt(simpleTagPayload);
    assert.strictEqual(prompt1C, 'Explain closures in JavaScript', '1C: Simple tags should be trimmed');

    // Case 1D: Raw plain text without tags
    const rawPayload = 'How do I use Docker compose?';
    const prompt1D = extractUserPrompt(rawPayload);
    assert.strictEqual(prompt1D, 'How do I use Docker compose?', '1D: Raw text should pass through cleanly');

    // Case 1E: XML/system wrappers without <USER_REQUEST>
    const systemWrappedPayload = `<system>You are a coding assistant</system>
<conversation_summaries>Summary</conversation_summaries>
Explain event loop in Node.js
<ADDITIONAL_METADATA>Active: app.ts</ADDITIONAL_METADATA>`;
    const prompt1E = extractUserPrompt(systemWrappedPayload);
    assert.strictEqual(prompt1E, 'Explain event loop in Node.js', '1E: Should strip system and metadata wrappers');

    console.log('✓ [Test 1] extractUserPrompt verified successfully.\n');

    // =========================================================================
    // Test 2: Byte-Offset Progression & Incremental Appending
    // =========================================================================
    console.log('[Test 2] Verifying Byte-Offset Progression & Incremental Stream Reading...');

    const convId1 = 'conv-tail-01';
    const convDir1 = path.join(tempBrainDir, convId1);
    const logsDir1 = path.join(convDir1, '.system_generated', 'logs');
    fs.mkdirSync(logsDir1, { recursive: true });
    const transcriptFile1 = path.join(logsDir1, 'transcript.jsonl');

    // Initial lines: 1 USER_INPUT and 1 PLANNER_RESPONSE
    const line1 = JSON.stringify({
      step_index: 0,
      source: 'USER',
      type: 'USER_INPUT',
      content: '<USER_REQUEST>First question</USER_REQUEST>',
      timestamp: 1700000001000
    }) + '\n';

    const line2 = JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      content: 'First answer',
      timestamp: 1700000002000
    }) + '\n';

    fs.writeFileSync(transcriptFile1, line1 + line2, 'utf8');

    const engine = new TranscriptTailEngine({
      brainDir: tempBrainDir,
      activeConvId: convId1,
      pollIntervalMs: 50
    });

    const userInputs: UserInputEvent[] = [];
    const plannerResponses: PlannerResponseEvent[] = [];
    const agentActivities: AgentActivityEvent[] = [];
    const conversationChanges: ConversationChangedEvent[] = [];

    engine.on('userInput', (e) => userInputs.push(e));
    engine.on('plannerResponse', (e) => plannerResponses.push(e));
    engine.on('agentActivity', (e) => agentActivities.push(e));
    engine.on('conversationChanged', (e) => conversationChanges.push(e));

    await engine.start();

    // Verify initial read
    assert.strictEqual(userInputs.length, 1, 'Should have received 1 initial userInput');
    assert.strictEqual(userInputs[0].prompt, 'First question');
    assert.strictEqual(userInputs[0].stepIndex, 0);
    assert.strictEqual(plannerResponses.length, 1, 'Should have received 1 initial plannerResponse');
    assert.strictEqual(plannerResponses[0].response, 'First answer');
    assert.strictEqual(plannerResponses[0].stepIndex, 1);

    const initialOffset = engine.getReadOffset();
    const expectedOffset = Buffer.byteLength(line1 + line2, 'utf8');
    assert.strictEqual(initialOffset, expectedOffset, 'readOffset should equal total bytes of lines 1 and 2');

    // Append Line 3
    const line3 = JSON.stringify({
      step_index: 2,
      source: 'USER',
      type: 'USER_INPUT',
      content: '<USER_REQUEST>Second question</USER_REQUEST>',
      timestamp: 1700000003000
    }) + '\n';

    fs.appendFileSync(transcriptFile1, line3, 'utf8');

    // Wait for file watch or poll tick
    await sleep(150);

    assert.strictEqual(userInputs.length, 2, 'Should now have 2 userInputs');
    assert.strictEqual(userInputs[1].prompt, 'Second question');
    assert.strictEqual(userInputs[1].stepIndex, 2);
    // Ensure line 1 was NOT re-processed (no duplicates)
    assert.strictEqual(plannerResponses.length, 1, 'plannerResponses should still be 1 (no duplicate reads)');

    const updatedOffset = engine.getReadOffset();
    assert.strictEqual(
      updatedOffset,
      expectedOffset + Buffer.byteLength(line3, 'utf8'),
      'readOffset should advance strictly by line 3 bytes'
    );

    console.log('✓ [Test 2] Byte-offset progression verified successfully.\n');

    // =========================================================================
    // Test 3: Agent Activity & Tool Calls Event Emission
    // =========================================================================
    console.log('[Test 3] Verifying agentActivity event emission for tool calls and thinking...');

    // Append a PLANNER_RESPONSE with tool calls
    const toolCallLine = JSON.stringify({
      step_index: 3,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      tool_calls: [
        { name: 'search_web', toolAction: 'Searching web', toolSummary: 'Web search' },
        { name: 'view_file', toolAction: 'Viewing file', toolSummary: 'View file' }
      ]
    }) + '\n';

    // Append a standalone THINKING step
    const thinkingLine = JSON.stringify({
      step_index: 4,
      type: 'THINKING',
      activity: 'Reasoning about search results'
    }) + '\n';

    fs.appendFileSync(transcriptFile1, toolCallLine + thinkingLine, 'utf8');
    await sleep(150);

    assert.strictEqual(agentActivities.length, 2, 'Should emit 2 agentActivity events');
    assert.strictEqual(agentActivities[0].stepIndex, 3);
    assert.strictEqual(agentActivities[0].activity, 'Searching web, Viewing file');
    assert.strictEqual(agentActivities[1].stepIndex, 4);
    assert.strictEqual(agentActivities[1].activity, 'Reasoning about search results');

    console.log('✓ [Test 3] Tool calls and agentActivity events verified.\n');

    // =========================================================================
    // Test 4: Partial/Incomplete Line Resumption Resilience
    // =========================================================================
    console.log('[Test 4] Verifying partial line append handling (no split JSON corruptions)...');

    const offsetBeforePartial = engine.getReadOffset();

    // Append incomplete JSON without trailing newline
    const partialHalf1 = '{"step_index":5,"source":"MODEL","type":"PLANNER_RESPONSE","content":"Part';
    fs.appendFileSync(transcriptFile1, partialHalf1, 'utf8');

    // Read pass should NOT commit partial line
    await engine.readAppendedLines(transcriptFile1);

    // Read offset should remain at offsetBeforePartial
    assert.strictEqual(
      engine.getReadOffset(),
      offsetBeforePartial,
      'readOffset must NOT advance past incomplete line without newline'
    );
    assert.strictEqual(plannerResponses.length, 1, 'Incomplete line must not emit plannerResponse');

    // Complete the line with remaining payload and newline
    const partialHalf2 = 'ial response now finished"}\n';
    fs.appendFileSync(transcriptFile1, partialHalf2, 'utf8');

    await engine.readAppendedLines(transcriptFile1);

    assert.strictEqual(plannerResponses.length, 2, 'Completed line should emit plannerResponse');
    assert.strictEqual(plannerResponses[1].response, 'Partial response now finished');
    assert.strictEqual(plannerResponses[1].stepIndex, 5);

    console.log('✓ [Test 4] Partial line resumption resilience verified.\n');

    // =========================================================================
    // Test 5: Continuous Watching Despite Completion Keywords
    // =========================================================================
    console.log('[Test 5] Verifying continuous tailing does NOT stop on completion keywords...');

    const completionLine = JSON.stringify({
      step_index: 6,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      content: 'I have finished the implementation. Done skul9x.'
    }) + '\n';

    fs.appendFileSync(transcriptFile1, completionLine, 'utf8');
    await sleep(150);

    assert.strictEqual(plannerResponses.length, 3, 'Should have received 3rd response');
    assert.strictEqual(plannerResponses[2].response, 'I have finished the implementation. Done skul9x.');
    assert.strictEqual(engine.isActive(), true, 'Engine must remain active and continuous');

    // Subsequent message after "Done skul9x." must still be tailed
    const postCompletionLine = JSON.stringify({
      step_index: 7,
      source: 'USER',
      type: 'USER_INPUT',
      content: '<USER_REQUEST>Next prompt after completion</USER_REQUEST>'
    }) + '\n';

    fs.appendFileSync(transcriptFile1, postCompletionLine, 'utf8');
    await sleep(150);

    assert.strictEqual(userInputs.length, 3, 'Engine must continue to tail post-completion lines');
    assert.strictEqual(userInputs[2].prompt, 'Next prompt after completion');

    console.log('✓ [Test 5] Continuous execution verified.\n');

    // =========================================================================
    // Test 6: Seamless Conversation Transition & Watcher Rebinding
    // =========================================================================
    console.log('[Test 6] Verifying seamless conversation transition in brainDir...');

    const convId2 = 'conv-tail-02';
    const convDir2 = path.join(tempBrainDir, convId2);
    const logsDir2 = path.join(convDir2, '.system_generated', 'logs');
    fs.mkdirSync(logsDir2, { recursive: true });
    const transcriptFile2 = path.join(logsDir2, 'transcript.jsonl');

    const conv2Line = JSON.stringify({
      step_index: 0,
      source: 'USER',
      type: 'USER_INPUT',
      content: '<USER_REQUEST>Hello in new conversation</USER_REQUEST>'
    }) + '\n';

    fs.writeFileSync(transcriptFile2, conv2Line, 'utf8');

    // Explicitly switch conversation or allow poll detection
    engine.switchConversation(convId2);

    assert.strictEqual(conversationChanges.length, 1, 'Should emit conversationChanged');
    assert.strictEqual(conversationChanges[0].oldConvId, convId1);
    assert.strictEqual(conversationChanges[0].newConvId, convId2);
    assert.strictEqual(engine.getActiveConvId(), convId2);

    await sleep(150);

    // Verify lines from new conversation are read from offset 0
    assert.strictEqual(userInputs.length, 4, 'Should read from newly switched conversation');
    assert.strictEqual(userInputs[3].convId, convId2);
    assert.strictEqual(userInputs[3].prompt, 'Hello in new conversation');

    console.log('✓ [Test 6] Conversation transition verified.\n');

    // =========================================================================
    // Test 7: Graceful Stop & Resource Cleanup
    // =========================================================================
    console.log('[Test 7] Verifying graceful stop() and cleanup...');

    engine.stop();
    assert.strictEqual(engine.isActive(), false, 'Engine isActive() must be false after stop()');

    // Writing further data after stop should NOT trigger events
    const ignoredLine = JSON.stringify({
      step_index: 10,
      source: 'USER',
      type: 'USER_INPUT',
      content: '<USER_REQUEST>Should be ignored after stop</USER_REQUEST>'
    }) + '\n';
    fs.appendFileSync(transcriptFile2, ignoredLine, 'utf8');
    await sleep(150);

    assert.strictEqual(userInputs.length, 4, 'No events should fire after engine is stopped');

    console.log('✓ [Test 7] Lifecycle stop() verified successfully.\n');

    console.log('=================================================================');
    console.log('ALL PHASE 01 TESTS PASSED SUCCESSFULLY!');
    console.log('=================================================================');
  } finally {
    // Cleanup temporary brain directory
    try {
      fs.rmSync(tempBrainDir, { recursive: true, force: true });
    } catch {}
  }
}

// Execute tests
runPhase01TranscriptTailEngineTests().catch((err) => {
  console.error('\n❌ PHASE 01 TEST FAILURE:', err);
  process.exit(1);
});
