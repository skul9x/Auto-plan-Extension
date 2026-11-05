# Phase 01: Markdown to Telegram HTML Converter Engine

Status: ✅ Completed  
Test: `src/test/phase01_markdown_to_telegram_html.test.ts`

## Objective
Design and implement a robust, lightweight Markdown-to-Telegram HTML conversion engine (`markdownToTelegramHtml`) with zero external runtime dependencies, providing complete support for headings, bold, italic, strikethrough, blockquotes, code blocks with syntax highlighting classes, and safe HTML character escaping.

## Scope
- Utility functions in `src/telegramUtils.ts`.
- Conversion logic translating standard Markdown formatting to Telegram's supported HTML tags:
  - Headings (`#`, `##`, `###`, etc.) converted to bold paragraphs (`<b>...</b>\n\n`).
  - Horizontal rules (`---`, `***`, `___`) stripped or converted to clean separators.
  - Bold (`**text**`, `__text__`) converted to `<b>text</b>`.
  - Italic (`*text*`, `_text_`) converted to `<i>text</i>` safely without corrupting snake_case identifiers.
  - Strikethrough (`~~text~~`) converted to `<s>text</s>`.
  - Inline code (`` `code` ``) converted to `<code>code</code>`.
  - Fenced code blocks (```` ```lang ... ``` ````) converted to `<pre><code class="language-lang">...</code></pre>` or `<pre><code>...</code></pre>`.
  - Blockquotes (`> text`) converted to `<blockquote>text</blockquote>`.
  - Links (`[text](url)`) converted to `<a href="url">text</a>`.
- Complete HTML entity escaping for text and code bodies (`&` -> `&amp;`, `<` -> `&lt;`, `>` -> `&gt;`).

## Requirements
### Functional
- Function `markdownToTelegramHtml(markdown: string): string`:
  1. Handles null, undefined, and empty inputs gracefully by returning an empty string.
  2. Protects fenced code blocks during inline transformation so that Markdown syntax characters inside code blocks are preserved verbatim while HTML characters are safely escaped.
  3. Replaces Markdown headings (`# Title`, `## Title`, `### Title`) with bold text (`<b>Title</b>\n\n`) to eliminate raw `#` symbols.
  4. Escapes raw `<` and `>` characters outside tags to prevent Telegram HTML parse errors (`400 Bad Request: can't parse entities`).
  5. Preserves language identifiers in code blocks using `<pre><code class="language-{lang}">...</code></pre>`.
  6. Properly handles lists (ordered `1.` and unordered `-`, `*`) into structured, clean readable lines with bullet characters (e.g., `• `).
  7. Cleans redundant horizontal rules (`---`) into clean newline separations.

### Non-Functional
- **High Performance:** Fast parsing (< 5ms for 50KB strings) with minimal memory allocations.
- **Zero Runtime Dependencies:** Native TypeScript/JavaScript string processing and regular expressions without introducing heavy external npm packages.

## Constraints
- Do not remove `stripMarkdownToPlainText` from `src/telegramUtils.ts`; keep it available for plain-text fallbacks and legacy compatibility.
- Ensure only tags officially permitted by Telegram Bot API (`<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<s>`, `<strike>`, `<del>`, `<span>`, `<tg-spoiler>`, `<a>`, `<code>`, `<pre>`, `<blockquote>`) are generated.

## Dependencies
- Files to modify:
  - `src/telegramUtils.ts`

## Acceptance Criteria
- `markdownToTelegramHtml` correctly transforms Markdown headings, bold, italic, code blocks, lists, and links into valid Telegram HTML tags.
- Code blocks preserve verbatim code characters and escape `<` and `>` into `&lt;` and `&gt;`.
- Raw Markdown symbols like `###` and `---` are completely absent in the converted output.
- Malformed inputs (unclosed tags, stray backticks) do not throw runtime exceptions.

## Comprehensive File-Based Test
- **File**: `src/test/phase01_markdown_to_telegram_html.test.ts`
- **Scope**:
  - Validates conversion of all Markdown syntax types (headings, bold, italic, code blocks, inline code, links, blockquotes, lists).
  - Tests nested and edge-case syntax (snake_case words like `var_name_test`, unclosed fences, multiple code blocks).
  - Verifies that `<script>`, `<style>`, and raw HTML tags in Markdown input are escaped properly.
  - Benchmarks execution time on a 50KB realistic model markdown response.

