# Phase 02: HTML Tag-Aware Chunk Splitter

Status: ✅ Completed  
Test: `src/test/phase02_html_tag_aware_chunk_splitter.test.ts`

## Objective
Enhance the message chunking mechanism in `src/telegramUtils.ts` to support splitting HTML-formatted text safely across Telegram's 4096-character limit (using a 3800 safety buffer), ensuring that open HTML tags (such as `<pre><code>`, `<b>`, `<i>`, `<blockquote>`) are automatically closed at chunk boundaries and reopened in the subsequent chunk to avoid malformed entity errors.

## Scope
- Chunking utilities in `src/telegramUtils.ts` (`splitHtmlMessage` or enhanced `splitMessage` supporting HTML mode).
- Tag-tracking state machine for Telegram-compatible HTML tags (`<pre>`, `<code>`, `<b>`, `<i>`, `<u>`, `<s>`, `<blockquote>`).
- Boundary selection avoiding mid-tag splits (e.g. never splitting inside `<a href="...">` or `<pre>`).

## Requirements
### Functional
- Function `splitHtmlMessage(html: string, maxChunkLength?: number): string[]`:
  1. Default `maxChunkLength` to 3800 characters.
  2. If the HTML text is within `maxChunkLength`, return it as a single element array.
  3. When splitting long HTML text, prioritize natural split points in descending order: paragraph breaks (`\n\n`), line breaks (`\n`), whitespace, and tag boundaries.
  4. Never split within an HTML tag (e.g., `<a href="https://example.com">` must not be cut in half).
  5. Keep track of open tags at chunk boundaries. If a chunk ends with unclosed tags (e.g. `<pre><code class="language-typescript">` or `<b>`), close them properly at the end of the chunk (`</code></pre>`, `</b>`), and re-open them with identical attributes at the start of the next chunk.
  6. Ensure consecutive whitespace and newline characters at chunk boundaries are trimmed without breaking indentation inside `<pre><code>`.

### Non-Functional
- **Strict Entity Integrity:** Every generated chunk must be individually valid and balanced HTML parseable by Telegram Bot API.
- **Performance:** Execution within 5ms for 100KB HTML content.

## Constraints
- Maintain existing `splitMessage` behavior for plain-text splitting so legacy callers are unaffected.
- Keep the module completely independent of heavy DOM libraries like `jsdom` or `cheerio` in production code.

## Dependencies
- Reference implementation: `splitMessage` in `src/telegramUtils.ts`.
- Files to modify:
  - `src/telegramUtils.ts`

## Acceptance Criteria
- Long HTML texts exceeding 3800 characters are split into multiple valid chunks.
- Chunks split inside `<pre><code class="language-ts">` end with `</code></pre>` and the next chunk resumes with `<pre><code class="language-ts">`.
- Chunks split inside `<b>` or `<i>` properly close and re-open the respective tags.
- No chunk ends with an incomplete tag opening or closing delimiter (`<` or `</`).

## Comprehensive File-Based Test
- **File**: `src/test/phase02_html_tag_aware_chunk_splitter.test.ts`
- **Scope**:
  - Tests splitting large code blocks across 2 and 3 chunks, asserting balanced `<pre><code>` tags in every chunk.
  - Tests splitting across multiple nested tags (`<b><i>...</i></b>`).
  - Tests edge case with a long tag attribute or long URL inside `<a href="...">`.
  - Verifies that all generated chunks pass strict balanced-tag validation.

