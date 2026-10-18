# Phase 01: Continuous Transcript Tail Engine & Event Emitter
Status: 🟢 Completed
Dependencies: None

## Objective
Build a lightweight, persistent background file tailing engine (`TranscriptTailEngine`) that continuously monitors the active conversation's `transcript.jsonl` file in Antigravity IDE without terminating upon completion keywords. The engine uses byte-offset streaming via Node.js `fs.createReadStream` and `readline` to guarantee O(1) memory usage, emitting typed events whenever user input or assistant planner responses occur.

## Requirements

### Functional
- Continuously tail the active conversation's `transcript.jsonl` located in `~/.gemini/antigravity-ide/brain/<conv-id>/.system_generated/logs/transcript.jsonl`.
- Maintain a persistent `readOffset` pointer; read only new appended bytes on each update.
- Extract user queries from `"type": "USER_INPUT"` steps by unwrapping `<USER_REQUEST>...</USER_REQUEST>` tags and stripping metadata/XML wrapping.
- Extract assistant final responses from `"type": "PLANNER_RESPONSE"` steps where `"source": "MODEL"`.
- Emit intermediate tool/thinking events (`agentActivity`) when tool calls or reasoning steps occur.
- Detect conversation transitions: when a new conversation directory is created in the brain directory, seamlessly rebind the tailing stream to the new conversation's transcript.

### Non-Functional
- Memory efficiency: Never buffer the entire transcript file into memory; stream line-by-line.
- Resilient polling & file watching: Use `fs.watch` with a 300ms polling fallback to handle rapid append bursts and cross-platform file locking.

## Implementation Steps
1. Create `src/transcriptTailEngine.ts` extending `EventEmitter`.
2. Implement `extractUserPrompt(rawContent: string): string` to extract clean user text from `<USER_REQUEST>` tags while stripping system prompts and conversation history wrappers.
3. Implement `readAppendedLines(filePath: string)` with `fs.createReadStream({ start: this.readOffset })` piped through `readline`.
4. Parse each incoming JSON line and fire typed events:
   - `userInput`: `{ convId: string, prompt: string, stepIndex: number, timestamp: number }`
   - `plannerResponse`: `{ convId: string, response: string, stepIndex: number, timestamp: number }`
   - `agentActivity`: `{ convId: string, activity: string, stepIndex: number }`
   - `conversationChanged`: `{ oldConvId: string, newConvId: string }`
5. Implement graceful `start()` and `stop()` lifecycle methods with timer and file watcher cleanup.

## Files to Create/Modify
- `src/transcriptTailEngine.ts` - Core continuous transcript tailing engine and parser.
- `src/test/phase01_clean_qa_transcript_tail_engine.test.ts` - Dedicated comprehensive test suite.

## Test Criteria
- Verify that `extractUserPrompt` cleanly extracts prompt content from complex `<USER_REQUEST>` payloads with trailing metadata.
- Verify that appending new `USER_INPUT` and `PLANNER_RESPONSE` JSON lines to a test transcript triggers the correct events with accurate payloads.
- Verify byte-offset progression (subsequent reads only inspect new data).
- Verify conversation switching when pointing the engine to a new conversation directory.

## Notes
- Do not stop watching when completion strings like `Done skul9x.` appear; this engine must run continuously for the duration of the IDE session.

---
Next Phase: `phase-02-dedup-origin-tracker.md`
