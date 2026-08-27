# Phase 01: Multi-Byte Stream Decoding & Buffer Guard
Status: ✅ Completed
Dependencies: None

## Objective
Enhance `TranscriptWatcher` with Node.js standard `StringDecoder` to safely handle multi-byte UTF-8 characters (e.g. Vietnamese diacritics, emoji icons, international unicode symbols) split across 64KB chunk boundaries. Add an upper safety cap to `lineBuffer` to guard against memory exhaustion from malformed log streams, and implement directory cache pruning.

## Requirements
### Functional
- [x] Import and integrate `StringDecoder` from `string_decoder` into `TranscriptWatcher`.
- [x] Maintain an active `StringDecoder('utf8')` instance during stream reading, ensuring split multi-byte UTF-8 sequences are buffered and reconstructed without producing replacement characters (`\uFFFD`).
- [x] Flush the decoder cleanly via `decoder.end()` when stopping or resetting the watcher.
- [x] Introduce `MAX_LINE_BUFFER_BYTES = 10 * 1024 * 1024` (10MB). If `lineBuffer` exceeds this limit without encountering a newline, truncate or discard the stale prefix and log a warning to prevent out-of-memory errors.
- [x] Introduce `MAX_CACHED_CONVERSATIONS = 100` in `brainDirCacheMap` to retain only the top 100 most recent conversation directory stats and prune stale entries from `dirMap`.

### Non-Functional
- [x] Performance: Zero perceptible CPU or memory overhead during normal chunk decoding.
- [x] Reliability: 100% character integrity for multi-byte Unicode text split across chunk boundaries.

## Files to Create/Modify
- `src/transcriptWatcher.ts` - Add `StringDecoder`, `MAX_LINE_BUFFER_BYTES`, and `MAX_CACHED_CONVERSATIONS` bounding.
- `src/test/phase01_stream_decoder_buffer_guard.test.ts` - Single comprehensive test for Phase 01.

## Test Criteria
- Exactly one file-based test: `src/test/phase01_stream_decoder_buffer_guard.test.ts`.
- [x] Verifies that multi-byte UTF-8 sequences (Vietnamese text + Emojis) intentionally split across consecutive chunk boundaries are decoded without corruption or replacement characters (`\uFFFD`).
- [x] Verifies that valid completion keywords containing Unicode characters or diacritics are detected across chunk boundaries.
- [x] Verifies that `lineBuffer` cap triggers when receiving excessive non-newline stream data, preventing unbounded memory growth.
- [x] Verifies that `brainDirCacheMap` prunes entries beyond 100 items while maintaining correct mtime ordering.

---
Next Phase: phase-02-test-suite-modernization.md
