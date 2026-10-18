# Phase 02: Deduplication Ring Buffer & Prompt Origin Tracker
Status: 🟢 Completed
Dependencies: `phase-01-transcript-tail-engine.md`

## Objective
Implement `PromptOriginTracker` with an in-memory deduplication ring buffer to distinguish between prompts originated from Telegram versus prompts typed directly into the PC IDE. When a user sends a prompt via Telegram, the prompt is already visible in their Telegram chat; suppressing redundant mirroring avoids annoying message duplication while ensuring PC-typed prompts are forwarded with clear provenance.

## Requirements

### Functional
- Intercept prompts dispatched through `telegramBridge` / `promptDispatcher` and register their canonical fingerprint (SHA-256 hash of normalized text) with a 60-second TTL.
- Normalize prompts by trimming leading/trailing whitespace, normalizing newlines, and removing casing discrepancies before hashing.
- When `userInput` event is emitted by `TranscriptTailEngine`:
  - Query `PromptOriginTracker.checkAndConsume(promptText)`.
  - If a match is found: Mark origin as `'telegram'`, consume the entry, and suppress sending the prompt to Telegram.
  - If no match is found: Mark origin as `'pc_ide'`, format as `💻 You (on PC):\n<promptText>`, and proceed with forwarding.
- Prune expired entries periodically to prevent memory leaks during long-running sessions.

### Non-Functional
- Bounded memory: Ring buffer size capped at 100 entries.
- High-precision matching: Robust to minor whitespace differences introduced during DOM or prompt dispatching.

## Implementation Steps
1. Create `src/promptOriginTracker.ts`.
2. Implement normalization helper `normalizePromptText(text: string): string` and hash generator `hashPrompt(text: string): string`.
3. Implement `registerTelegramPrompt(prompt: string): void` that saves `{ hash, prompt, timestamp: Date.now() }`.
4. Implement `checkAndConsume(prompt: string): { origin: 'telegram' | 'pc_ide', matched: boolean }`.
5. Integrate prompt registration into `telegramBridge.ts` where messages from users are received and forwarded to `promptDispatcher`.
6. Integrate origin verification into the chat mirror pipeline.

## Files to Create/Modify
- `src/promptOriginTracker.ts` - Deduplication ring buffer and origin tracking implementation.
- `src/telegramBridge.ts` - Hook into message receive flow to register outbound prompts.
- `src/test/phase02_clean_qa_dedup_origin_tracker.test.ts` - Dedicated test verifying deduplication and origin resolution.

## Test Criteria
- Verify that registered Telegram prompts return `'telegram'` and subsequent calls return `'pc_ide'` after consumption.
- Verify that whitespace variations (trailing spaces, CRLF vs LF) still match the registered prompt.
- Verify that expired entries (> TTL) are automatically pruned and treated as `'pc_ide'`.
- Verify ring buffer capacity limits and FIFO eviction.

## Notes
- Ensure thread/concurrency safety: if multiple identical prompts are sent in quick succession, use counter tracking per hash.

---
Next Phase: `phase-03-typing-and-smart-chunker.md`
