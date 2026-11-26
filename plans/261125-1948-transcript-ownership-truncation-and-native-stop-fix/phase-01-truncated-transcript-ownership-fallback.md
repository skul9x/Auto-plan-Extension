# Phase 1: Truncated Transcript Ownership Fallback & Safe JSONL Inspection

**Status:** ✅ Completed

## 1. Objective
Eliminate false `"foreign conversation"` rejections in `TranscriptWatcher` when Antigravity IDE compacts long user prompts in `transcript.jsonl` (`"truncated_fields":["content"]`), ensuring `verifyConversationOwnershipAsync` reliably claims legitimate phase conversations while still strictly rejecting unrelated conversations.

---

## 2. Scope
- **Ownership Criteria & Verification Engine** (`src/transcriptWatcher.ts`: `ConversationOwnershipCriteria`, `verifyConversationOwnershipAsync`, ownership LRU cache keying)
- **Workspace Candidate Prioritization Compatibility** (`src/transcriptTailEngine.ts`: verify call-site compatibility with updated `verifyConversationOwnershipAsync`)

---

## 3. Requirements
1. **Detect Compact-Log Truncation (`"truncated_fields"`):**
   - Inspect parsed `step_index: 0` JSON line in `transcript.jsonl` for `truncated_fields` (specifically array containing `'content'`).
2. **Sibling `transcript_full.jsonl` Fallback:**
   - When `transcript.jsonl` has `"truncated_fields"` containing `'content'` OR when `expectedPromptSnippet` is missing from the initial `transcript.jsonl` read window, check for sibling `transcript_full.jsonl` in the exact same directory (`path.join(path.dirname(transcriptPath), 'transcript_full.jsonl')`).
   - Read up to `32,768` bytes (`32KB`) from `transcript_full.jsonl` (or full first line up to `64KB` safely bounded via `fs.promises.open` `FileHandle` + `try...finally` `close()`) to locate the untruncated `expectedPromptSnippet` and workspace metadata.
3. **Extended JSONL Line Scanning for Multi-Step Transcripts:**
   - When `truncated_fields` includes `'content'` and sibling `transcript_full.jsonl` is absent or incomplete (race window before IDE writes `transcript_full.jsonl`), allow bounded scanning up to `32,768` bytes of `transcript.jsonl` (beyond the `8,192`-byte initial slice) ONLY when truncation is flagged so later tool calls referencing the phase file (e.g. offset `13,971`) can still prove ownership.
4. **Prompt Head & Tail Fingerprint Support:**
   - Extend `ConversationOwnershipCriteria` with optional `expectedPromptHead?: string` and `expectedPromptTail?: string`.
   - When `expectedPromptSnippet` was stripped from truncated `transcript.jsonl` and `transcript_full.jsonl` is missing/empty, accept ownership ONLY if **ALL** of the following hold:
     - `step_index: 0` was explicitly flagged as truncated (`"truncated_fields"` contains `'content'`),
     - Workspace ownership (`workspacePath` / `workspaceName` / `workspaceFolders`) strictly matches, AND
     - Both non-empty `expectedPromptHead` and `expectedPromptTail` match the surviving untruncated outer slices of `step_index: 0`.
5. **Prevent Cache Poisoning During Truncation Races:**
   - Incorporate `transcript_full.jsonl` `mtimeMs:size` (when present) OR bypass caching negative (`isOwner = false`) results briefly when `truncated_fields` includes `'content'` and `transcript_full.jsonl` has `0` bytes / does not yet exist (`mtimeMs`-unchanged compact file could lag sibling write by a few milliseconds).

---

## 4. How to Implement
1. **Update `ConversationOwnershipCriteria` in `src/transcriptWatcher.ts`:**
   - Add optional fields:
     ```ts
     expectedPromptHead?: string;
     expectedPromptTail?: string;
     ```
   - Include `expectedPromptHead` and `expectedPromptTail` in `criteriaKey` inside `verifyConversationOwnershipAsync` so LRU cache keys never collide across different templates.
2. **Refactor Byte-Window Reader Helper (`readHeadSafelyAsync`):**
   - Extract a small single-purpose helper `readFileHeadUtf8Async(filePath: string, maxBytes: number): Promise<{ content: string; fileSize: number } | null>` using `fs.promises.open`, `handle.stat()`, bounded `Buffer.alloc(Math.min(maxBytes, stats.size))`, `handle.read(...)`, and `try...finally { await handle.close(); }`. Never call `fs.readFileSync`.
3. **Inspect Truncation Metadata & Step-0 JSON Parsing:**
   - Parse line 0 cleanly: extract `promptContent` AND `const isContentTruncated = Array.isArray(parsed?.truncated_fields) && parsed.truncated_fields.includes('content');` (plus regex fallback `/"truncated_fields"\s*:\s*\[[^\]]*"content"/` if line 0 exceeded `8192` bytes and was partial JSON).
4. **Multi-Stage Evaluation inside `verifyConversationOwnershipAsync`:**
   - **Stage A (Fast Path — Initial `8192` bytes of `transcript.jsonl`):** Perform existing exact `expectedPromptSnippet` + workspace checks. If `matches === true`, cache and return `true` cleanly (`0` extra disk I/O for normal prompts!).
   - **Stage B (Sibling `transcript_full.jsonl` Check):** If `matches === false` AND (`isContentTruncated` OR line 0 exceeds `8192` bytes without closing `}`), check sibling `transcript_full.jsonl` using `readFileHeadUtf8Async(fullTranscriptPath, 65536)` and re-run exact `expectedPromptSnippet` + workspace checks against `transcript_full.jsonl`'s step 0 content.
   - **Stage C (Bounded Extended Scan + Structural Head/Tail Fallback):**
     - If `isContentTruncated` and `transcript_full.jsonl` was unavailable or didn't match yet, scan up to `32,768` bytes of `transcript.jsonl` if `size > 8192`.
     - If still unmatched ONLY on `expectedPromptSnippet` while `isContentTruncated === true` AND workspace check passed AND `expectedPromptHead` + `expectedPromptTail` are both provided (`>= 24` chars trimmed), check whether `promptContent` (or `chunkStr`) matches BOTH `expectedPromptHead` and `expectedPromptTail`.
   - **Negative Cache Guard:** When returning `false` for a candidate whose line 0 indicates `isContentTruncated === true` and `transcript_full.jsonl` does not yet exist on disk, do NOT write `isOwner: false` into `conversationOwnershipCache` (so the next 300ms poll immediately re-evaluates once `transcript_full.jsonl` flushes or step 1+ appends). Also include sibling `fullStat` metadata in cache freshness verification when `transcript_full.jsonl` exists.

---

## 5. Files to Create/Modify
- **Modify:**
  - `src/transcriptWatcher.ts`
- **Verify Compatibility (Read/No Breaking Signature Change):**
  - `src/transcriptTailEngine.ts`
- **Create (Test only):**
  - `src/test/phase01_truncated_transcript_ownership_fallback.test.ts`

---

## 6. Dependencies
- None (Foundation phase).

---

## 7. Constraints
- Untruncated foreign transcripts in `transcript.jsonl` (without `"truncated_fields": ["content"]`) MUST STILL be strictly rejected as `false` (`phase02_transcript_conversation_ownership.test.ts` compliance).
- Always close every `fs.promises.FileHandle` inside `try...finally`.
- Keep Fast Path (`Stage A`) at `<= 8192` bytes when untruncated so polling performance on normal conversations remains unaffected.
- Follow existing standalone Node `assert` test harness conventions (`out/test/*.test.js` compiled via `tsc`).

---

## 8. Acceptance Criteria
1. Given a 6,356+ char JSON prompt whose `step_index: 0` in `transcript.jsonl` is truncated (`"truncated_fields": ["content"]`) so `phase-03-...md` is stripped from line 0, `verifyConversationOwnershipAsync` returns `true` when sibling `transcript_full.jsonl` contains the snippet and workspace matches.
2. Given the same truncated `transcript.jsonl` WITHOUT `transcript_full.jsonl` yet on disk, if workspace matches and later lines within `32KB` (e.g. offset `13,971`) OR `expectedPromptHead` + `expectedPromptTail` match, `verifyConversationOwnershipAsync` returns `true` and does not poison the LRU cache with a stale `false`.
3. Given an untruncated foreign conversation mentioning a different project (`Auto-Plan Extension`) and wrong prompt, `verifyConversationOwnershipAsync` strictly returns `false`.
4. Existing `src/test/phase02_transcript_conversation_ownership.test.ts` and `src/test/phase02_transcript_ownership_cache.test.ts` continue to pass unchanged.

---

## 9. Comprehensive File-Based Test
- **Test File:** `src/test/phase01_truncated_transcript_ownership_fallback.test.ts`
- **Framework:** Standalone Node TypeScript (`assert` + temp brain directory cleanup via `os.tmpdir()`) compiled via `npm run compile` and executed via `node out/test/phase01_truncated_transcript_ownership_fallback.test.js`
- **Test Scenarios Covered in One File:**
  1. **Real-World Compact Log + Sibling `transcript_full.jsonl` Rescue:** Recreates the exact `log.txt` scenario (~4,400-byte line 0 in `transcript.jsonl` with `"truncated_fields": ["content"]` stripping `phase-03-webview-pacs-url-guard-and-diagnostics.md` while active editor tab points to `phase-02-...md`), paired with sibling `transcript_full.jsonl` containing the untruncated 6.3KB prompt; verifies `verifyConversationOwnershipAsync` returns `true`.
  2. **Truncated Delayed-Flush Cache Resilience:** Runs `verifyConversationOwnershipAsync` on a freshly created truncated `transcript.jsonl` BEFORE `transcript_full.jsonl` exists (returns `false` initially without poisoning LRU cache), then writes `transcript_full.jsonl` without altering `transcript.jsonl` `mtime/size` and asserts subsequent call immediately returns `true`.
  3. **Extended `32KB` Scan Fallback Without `transcript_full.jsonl`:** Appends step lines containing `phase-03-webview-pacs-url-guard-and-diagnostics.md` at byte offset `~14,000` to a truncated `transcript.jsonl` (no `transcript_full.jsonl`) and verifies ownership evaluates `true`.
  4. **Structural Head + Tail Fallback:** Provides `expectedPromptHead` and `expectedPromptTail` matching the surviving outer bounds of a truncated step-0 line plus matching workspace, asserting ownership returns `true` when `transcript_full.jsonl` is absent and `false` when either workspace or tail mismatches.
  5. **Strict Alien Prompt Rejection Preserved:** Verifies untruncated foreign prompts and alien workspaces still strictly return `false`.
