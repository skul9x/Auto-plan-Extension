# Phase 01: Tail Engine Event-Driven Discovery & Fast Prompt Extraction (PERF-01 & PERF-04)

Status: ✅ Completed
Test: `src/test/phase01_tail_engine_perf_throttle.test.ts`

## Goals
1. **Remediate PERF-01 (Unbounded Sequential Disk I/O Polling)**:
   - In `src/transcriptTailEngine.ts`, decouple the periodic 300ms transcript byte-offset reading (`checkAndRead`) from the global directory scan (`findLatestConversation`).
   - Implement an event-driven discovery mechanism: trigger `findLatestConversation()` when `brainDirWatcher` emits a change event.
   - Enforce a minimum discovery throttle interval (default: `5000ms`) during periodic polling, ensuring directory traversal does not run on every 300ms tick when the active conversation is stable.
   - Optimize `findLatestConversation()` to prune candidate folders, avoiding sequential stats over hundreds of historical sessions.
2. **Remediate PERF-04 (Intermediate String Allocation Churn)**:
   - In `extractUserPrompt(rawContent)`, add an immediate fast-path: if `rawContent` contains no XML tag delimiters (`<`), return `rawContent.trim()` without invoking regex engines.
   - If `<USER_REQUEST>` is present, locate the final matching block, isolate the inner substring, and strip internal tags in a targeted pass without repeatedly cloning the outer system message.
3. **Verification**:
   - Provide exactly one comprehensive test file: `src/test/phase01_tail_engine_perf_throttle.test.ts`.
   - Verify that disk stat operations during steady-state tailing decrease by >90%.
   - Verify that conversation transitions remain fully responsive when new sessions are spawned.
   - Verify that prompt extraction accurately extracts user requests across plain text, tagged text, and heavy system wrappers.

## Implementation Details

### 1. `TranscriptTailEngine` Throttling & Decoupling
- In `src/transcriptTailEngine.ts`:
  - Add configuration options: `discoveryThrottleMs?: number` (default: `5000ms`).
  - Introduce `private lastDiscoveryTimestamp: number = 0;`.
  - In `pollTick()`:
    ```typescript
    const now = Date.now();
    const shouldCheckDiscovery = !this.explicitTranscriptPath &&
      fs.existsSync(this.brainDir) &&
      (!this.activeConvId || now - this.lastDiscoveryTimestamp >= this.discoveryThrottleMs);

    if (shouldCheckDiscovery) {
      this.lastDiscoveryTimestamp = now;
      const latestConv = await this.findLatestConversation();
      if (latestConv && latestConv !== this.activeConvId) {
        this.switchConversation(latestConv);
        return;
      }
    }

    // Always inspect active transcript for appended bytes (1 stat call only)
    await this.checkAndRead();
    ```
  - In `setupBrainDirWatcher()`:
    - On directory change events, reset `lastDiscoveryTimestamp = 0` and invoke `pollTick()` so new conversation creations are picked up immediately without waiting for the 5000ms timer.

### 2. Fast-Path & Targeted `extractUserPrompt`
- In `src/transcriptTailEngine.ts`:
  - Fast check: `if (!rawContent.includes('<')) return rawContent.trim();`.
  - Locate last `<USER_REQUEST>` block using `rawContent.lastIndexOf('<USER_REQUEST>')` and extract inner body substring directly.
  - Apply clean-up passes solely on the isolated snippet.

## Verification
- Run: `node out/test/phase01_tail_engine_perf_throttle.test.js`.
- Ensure all assertions pass without regression.
