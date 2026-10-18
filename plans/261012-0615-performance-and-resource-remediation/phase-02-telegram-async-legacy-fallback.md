# Phase 02: Telegram Async Legacy Fallback & Event Loop Protection (PERF-02)

Status: ✅ Completed
Test: `src/test/phase02_telegram_async_legacy_fallback.test.ts`

## Goals
1. **Remediate PERF-02 (Synchronous Event Loop Blocking in Telegram Fallback)**:
   - In `src/telegramBridge.ts`, convert the synchronous `findLatestConversation` calls in `awaitAndReplyModelResponse` and prompt dispatch initialization into asynchronous, non-blocking calls (`findLatestConversationAsync`).
   - Implement throttled path resolution in `resolvePath`: when the transcript path is unresolved, throttle directory scanning to run at most once every `1500ms` rather than on every `250ms` polling tick.
   - Replace synchronous `fs.statSync` and `fs.existsSync` in path resolution with `await fs.promises.stat()`.
   - Ensure `awaitAndReplyModelResponse` cleans up stream resources, timeouts, and active waiters gracefully upon resolution, error, or cancellation.
2. **Verification**:
   - Provide exactly one comprehensive test file: `src/test/phase02_telegram_async_legacy_fallback.test.ts`.
   - Verify that `awaitAndReplyModelResponse` functions without issuing any synchronous `readdirSync` or `statSync` operations.
   - Verify that conversation discovery retry is throttled to >= 1500ms when waiting for an AI response file.
   - Verify that response streaming, chunking, and final delivery to Telegram remain accurate and reliable.

## Implementation Details

### 1. Asynchronous & Throttled Path Resolution
- In `src/telegramBridge.ts`:
  - Update `resolvePath` in `awaitAndReplyModelResponse` to an asynchronous function:
    ```typescript
    let lastPathResolutionAttempt = 0;
    const RESOLVE_PATH_THROTTLE_MS = 1500;

    const resolvePathAsync = async (): Promise<string | null> => {
      if (currentPath) {
        try {
          await fs.promises.stat(currentPath);
          return currentPath;
        } catch {
          currentPath = null;
        }
      }

      const now = Date.now();
      if (now - lastPathResolutionAttempt < RESOLVE_PATH_THROTTLE_MS) {
        return null;
      }
      lastPathResolutionAttempt = now;

      try {
        const latestConv = await findLatestConversationAsync(brainDir, startTime - 5000);
        if (latestConv) {
          const found = getTranscriptPath(path.join(brainDir, latestConv));
          if (found) {
            await fs.promises.stat(found);
            currentPath = found;
            readOffset = 0;
            return found;
          }
        }
      } catch {}

      return null;
    };
    ```

### 2. Prompt Dispatch Initialization Non-Blocking Conversion
- In the command handler for text prompts (`bot.on('message:text')`), replace the synchronous `findLatestConversation` and `fs.statSync` with asynchronous helpers before dispatching prompts.

## Verification
- Run: `node out/test/phase02_telegram_async_legacy_fallback.test.js`.
- Ensure zero synchronous I/O calls occur on the Extension Host main thread during the fallback response wait loop.
