# Phase 02: Transcript Non-blocking Stream & Line Counter
Status: ✅ Completed
Dependencies: Phase 01

## Objective
Eliminate Extension Host thread freezing caused by reading entire multi-megabyte transcript files into RAM via synchronous `fs.readFileSync` and `split('\n')` in `src/transcriptWatcher.ts` during both initial watcher setup and dynamic conversation switching.

## Requirements
### Functional
- [x] Implement `countTranscriptLinesAsync(filePath: string, maxOffset?: number): Promise<number>` in `src/transcriptWatcher.ts`:
  - Uses chunked stream decoding (`fs.createReadStream` with 64KB chunks) scanning for newline bytes (`\n` / `0x0A`) and non-whitespace characters.
  - Exactly preserves the existing counting semantics of `.filter(l => l.trim().length > 0)` without creating large in-memory string arrays.
  - Supports bounded `maxOffset` to accurately count lines only up to `preExistingOffset` or `readOffset`.
- [x] Refactor `TranscriptWatcher.watchFile`:
  - Replace synchronous `fs.readFileSync` and `split('\n')` (lines 927–936) with `await countTranscriptLinesAsync(filePath, this.readOffset)`.
  - Replace synchronous `fs.statSync(filePath)` (line 948) with non-blocking `await fs.promises.stat(filePath)`.
- [x] Refactor `TranscriptWatcher.switchActiveConversation`:
  - Replace synchronous `fs.readFileSync` and `split('\n')` (lines 1225–1235) with `await countTranscriptLinesAsync(newFilePath, preExistingOffset)`.
  - Replace synchronous `fs.statSync(newFilePath)` (line 1215) with non-blocking `await fs.promises.stat(newFilePath)`.

### Non-Functional
- [x] Extension Host Event Loop remains 100% responsive and never triggers *"Extension host is unresponsive"* warnings even with 50MB–100MB+ transcripts.
- [x] RAM consumption during line counting is strictly bounded to the 64KB stream buffer chunk size.
- [x] Line counting throughput exceeds 100MB/second without GC pauses.

## Implementation Steps
1. In `src/transcriptWatcher.ts`:
   - Export and implement `countTranscriptLinesAsync(filePath: string, maxOffset?: number): Promise<number>`.
   - Update `watchFile()` to asynchronously compute `initialTranscriptLength` via `countTranscriptLinesAsync`.
   - Update `switchActiveConversation()` to asynchronously count lines via `countTranscriptLinesAsync`.
   - Ensure all stat checks during initialization and rebinding use `fs.promises.stat`.
2. Create verification test `src/test/phase02_transcript_stream_line_counter.test.ts`.

## Files to Create/Modify
- `src/transcriptWatcher.ts` - Stream-based non-blocking line counter and async file watcher/rebind initialization
- `src/test/phase02_transcript_stream_line_counter.test.ts` - Single comprehensive verification test

## Test Criteria
- [x] Verification test accurately counts lines on synthetic JSONL files of various sizes (small, medium, and 10MB+).
- [x] Verification test verifies that bounded `maxOffset` calculates exact line counts matching sliced contents.
- [x] Verification test confirms both `watchFile` and `switchActiveConversation` initialize without blocking the main event loop.

---
Next Phase: [Phase 03: Brain Directory Cache & Bounded Polling I/O](file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main/plans/260908-0936-audit-performance-remediation/phase-03-brain-dir-cache-and-bounded-polling.md)
