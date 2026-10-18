# Phase 01: Markdown to Clean Plain Text Transformation Engine

Status: ✅ Completed
Dependencies: None

## Objective
Design and implement a robust, zero-dependency Markdown-to-Plain-Text transformation engine (`stripMarkdownToPlainText`) in `src/telegramUtils.ts` to convert AI-generated Markdown transcripts into clean, readable plain text. The engine must strip all Markdown syntactic markers, flatten multi-column tables into legible mobile-friendly bullet lists, and preserve code block contents and indentation without backtick fences.

## Requirements
### Functional
- [x] Implement `stripMarkdownToPlainText(markdown: string): string` in `src/telegramUtils.ts`:
  - **Headings**: Strip `#`, `##`, `###`, etc., preserving or emphasizing the title text without markdown symbols.
  - **Inline Emphasis**: Remove `**bold**`, `*italic*`, `__underline__`, and `~~strikethrough~~` wrappers while retaining inner text.
  - **Inline Code**: Strip backticks from `` `variable` `` while preserving code text.
  - **Fenced Code Blocks**: Strip ````lang ... ```` fences while preserving raw multi-line code indentation and line breaks.
  - **Markdown Tables**: Detect pipe tables (`| col1 | col2 |`) and flatten rows into mobile-readable bullet formats (e.g. `• col1: col2`), eliminating raw pipe lines and hyphens.
  - **Links**: Convert `[text](url)`:
    - Omit local `file:///...` URLs and retain clean `text`.
    - Format web URLs cleanly as `text (url)` or `text` if identical.
  - **Blockquotes**: Convert `> text` into clean readable blockquote lines with uniform prefix (e.g., `| text`).
  - **List Markers**: Standardize nested unordered lists (`*`, `-`, `+`) into clean bullet points (`• `).
  - **Whitespace Normalization**: Collapse excessive consecutive blank lines down to a maximum of two newlines.

### Non-Functional
- [x] Performance: Process a 100KB transcript payload in < 5ms without external heavy parsing dependencies.
- [x] Resilience: Gracefully handle null, undefined, empty strings, and malformed markdown syntax without throwing exceptions.

## Implementation Steps
1. Create `stripMarkdownToPlainText` helper in `src/telegramUtils.ts`.
2. Implement specialized table flattening regex parser to transform markdown tables into clean key-value bullet lists.
3. Add link sanitization removing `file://` local paths.
4. Export the function and update TypeScript types.
5. Create and run standalone test `src/test/phase01_telegram_plain_text_stripper.test.ts`.

## Files to Create/Modify
- `src/telegramUtils.ts` - Add `stripMarkdownToPlainText` and supporting parser regexes.
- `src/test/phase01_telegram_plain_text_stripper.test.ts` - Comprehensive single-file test for Phase 01.

## Test Criteria
- Exactly one file-based test: `src/test/phase01_telegram_plain_text_stripper.test.ts`.
- [x] Verifies clean stripping of bold, italic, strikethrough, and inline code markers.
- [x] Verifies clean formatting of fenced code blocks with indentation preserved and fences removed.
- [x] Verifies markdown table conversion into readable mobile bullet points without raw `|---|` lines.
- [x] Verifies stripping of local `file://` URLs and clean web link representation.
- [x] Verifies handling of edge cases (empty text, giant strings, malformed markdown, unclosed backticks).

---
Next Phase: phase-02-telegram-plain-text-delivery.md
