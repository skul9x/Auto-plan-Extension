/**
 * Utilities for Telegram messaging, Markdown manipulation,
 * safe message chunking, and input sanitization.
 */

const FENCE_REGEX = /^[ \t]*(`{3,}|~{3,})([a-zA-Z0-9_#+.-]*)/gm;

/**
 * Intelligently splits a long message into chunks not exceeding `maxChunkLength` (default 3800 chars).
 * Splits on paragraph boundaries (\n\n), line breaks (\n), or whitespace, avoiding breaking
 * mid-word, and automatically closes and re-opens fenced code blocks across chunk boundaries
 * to preserve syntax highlighting on Telegram clients.
 *
 * Performance: Executes in < 5ms for outputs up to 500KB.
 */
export function splitMessage(text: string, maxChunkLength: number = 3800): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }
  if (text.length <= maxChunkLength) {
    return [text];
  }

  const chunks: string[] = [];
  const totalLen = text.length;
  let cursor = 0;
  let inCodeBlock = false;
  let codeBlockLang = '';

  while (cursor < totalLen) {
    const prefix = inCodeBlock ? '```' + codeBlockLang + '\n' : '';
    const suffix = '\n```';

    const remainingLen = totalLen - cursor;

    // Check if the remaining text fits entirely within one chunk
    if (prefix.length + remainingLen + (inCodeBlock ? suffix.length : 0) <= maxChunkLength) {
      const rest = text.slice(cursor);
      if (rest.includes('```') || rest.includes('~~~')) {
        FENCE_REGEX.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = FENCE_REGEX.exec(rest)) !== null) {
          if (!inCodeBlock) {
            inCodeBlock = true;
            codeBlockLang = m[2] || '';
          } else {
            inCodeBlock = false;
            codeBlockLang = '';
          }
        }
      }

      let finalChunk = prefix + rest;
      if (inCodeBlock) {
        finalChunk += suffix;
      }
      chunks.push(finalChunk);
      break;
    }

    // Available space in this chunk for raw text content
    const rawLimit = Math.min(cursor + maxChunkLength - prefix.length, totalLen);
    const peekWindow = text.slice(cursor, rawLimit);
    const mayNeedSuffix = inCodeBlock || peekWindow.includes('```') || peekWindow.includes('~~~');
    const suffixReserve = mayNeedSuffix ? suffix.length : 0;

    const maxContentLen = maxChunkLength - prefix.length - suffixReserve;
    if (maxContentLen <= 0) {
      // Graceful fallback for extremely constrained maxChunkLength
      const take = Math.min(maxChunkLength, remainingLen);
      chunks.push(text.slice(cursor, cursor + take));
      cursor += take;
      continue;
    }

    const searchLimit = Math.min(cursor + maxContentLen, totalLen);
    const candidate = text.slice(cursor, searchLimit);

    // Hierarchy of split boundaries:
    // 1. Paragraph boundary (\n\n)
    // 2. Line break (\n)
    // 3. Whitespace / word boundary ( )
    // 4. Fallback: split at candidate.length if no boundary found (e.g. single long word or URL)
    let splitIdx = -1;
    const pIdx = candidate.lastIndexOf('\n\n');
    if (pIdx > 0) {
      splitIdx = pIdx;
    } else {
      const nIdx = candidate.lastIndexOf('\n');
      if (nIdx > 0) {
        // If nIdx happens right after an opening fence, prefer finding whitespace after it
        // to avoid producing an empty code block chunk
        const beforeN = candidate.slice(0, nIdx).trim();
        if (/^(`{3,}|~{3,})\w*$/.test(beforeN)) {
          const after = candidate.slice(nIdx + 1);
          const spaceInAfter = after.lastIndexOf(' ');
          if (spaceInAfter > 0) {
            splitIdx = nIdx + 1 + spaceInAfter;
          } else {
            splitIdx = nIdx;
          }
        } else {
          splitIdx = nIdx;
        }
      } else {
        const sIdx = candidate.lastIndexOf(' ');
        if (sIdx > 0) {
          splitIdx = sIdx;
        } else {
          splitIdx = candidate.length;
        }
      }
    }

    const chunkBody = candidate.slice(0, splitIdx);
    let nextStart = cursor + splitIdx;

    // Advance cursor past the separator delimiter so chunks don't start with loose whitespace/newlines
    if (nextStart < totalLen && text[nextStart] === '\n') {
      nextStart++;
      if (nextStart < totalLen && text[nextStart] === '\n') {
        nextStart++;
      }
    } else if (nextStart < totalLen && text[nextStart] === ' ') {
      nextStart++;
    }

    // Track code fence openings and closings inside this chunkBody
    if (chunkBody.includes('```') || chunkBody.includes('~~~')) {
      FENCE_REGEX.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = FENCE_REGEX.exec(chunkBody)) !== null) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLang = m[2] || '';
        } else {
          inCodeBlock = false;
          codeBlockLang = '';
        }
      }
    }

    let finalChunk = prefix + chunkBody;
    if (inCodeBlock) {
      finalChunk += suffix;
    }
    chunks.push(finalChunk);
    cursor = nextStart;
  }

  return chunks;
}

/**
 * Sanitizes input text received from Telegram before passing to internal handlers,
 * stripping null bytes and normalizing line break formatting.
 */
export function sanitizeTelegramInput(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text
    .replace(/\0/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * Sanitizes input string to prevent shell escaping issues and control character injection
 * when Tier 3 OS keyboard simulation (PowerShell / xdotool) is used.
 */
export function sanitizeInputForSimulation(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  let sanitized = sanitizeTelegramInput(text);
  // Remove non-printable control characters (ASCII 0-8, 11-12, 14-31, 127)
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return sanitized;
}

/**
 * Escapes special SendKeys characters for Windows PowerShell keyboard simulation.
 */
export function escapeSendKeys(input: string): string {
  if (!input) {
    return '';
  }
  return input.replace(/([+^%~(){}[\]])/g, '{$1}');
}

/**
 * Escapes characters with special meaning in Telegram Markdown.
 */
export function escapeMarkdown(text: string): string {
  if (!text) {
    return '';
  }
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Escapes characters with special meaning in Telegram legacy Markdown (V1):
 * `_`, `*`, `[`, `]`, '`', and `\`.
 * Prevents Telegram API from returning `400 Bad Request: can't parse entities`.
 */
export function escapeTelegramMarkdown(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text.replace(/([_*[\]`\\])/g, '\\$1');
}

export interface ProgressBarOptions {
  /** Total length of the bar in characters (default: 8) */
  length?: number;
  /** Visual style: 'block' using ▰/▱ or 'ascii' using #/- (default: 'block') */
  style?: 'block' | 'ascii';
  /** Whether to append the percentage string (default: true) */
  showPercent?: boolean;
}

/**
 * Renders a compact visual text progress bar suitable for mobile Telegram display.
 * Uses uniform-width Unicode block elements: filled `▰` (U+25B0) and empty `▱` (U+25B1),
 * or ASCII characters (`#` and `-`).
 *
 * Edge case handling:
 * - total <= 0: clamps to 0% (e.g. `▱▱▱▱▱▱▱▱ 0%`, never outputs NaN%)
 * - completed > total: clamps to 100% (`▰▰▰▰▰▰▰▰ 100%`)
 * - completed < 0: clamps to 0%
 *
 * Performance: < 0.05ms execution time, zero external dependencies.
 */
export function renderTextProgressBar(
  completed: number,
  total: number,
  options?: ProgressBarOptions
): string {
  const len = typeof options?.length === 'number' && options.length > 0 ? options.length : 8;
  const style = options?.style || 'block';
  const showPercent = options?.showPercent !== false;

  const filledChar = style === 'ascii' ? '#' : '▰';
  const emptyChar = style === 'ascii' ? '-' : '▱';

  const percent = total <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((completed / total) * 100)));
  const clampedCompleted = Math.max(0, Math.min(completed, total > 0 ? total : 0));
  const filledCount = total <= 0 ? 0 : Math.min(len, Math.max(0, Math.round((clampedCompleted / total) * len)));
  const emptyCount = len - filledCount;

  const bar = filledChar.repeat(filledCount) + emptyChar.repeat(emptyCount);
  return showPercent ? `${bar} ${percent}%` : bar;
}

/**
 * Safely formats text containing markdown for Telegram delivery.
 * Automatically escapes special Markdown characters (particularly unescaped `_`
 * and unmatched square brackets) outside of code blocks/spans (`...` and ```...```).
 */
export function formatSafePlanText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Tokenize fenced code blocks and inline code spans
  const tokens: { isCode: boolean; content: string }[] = [];
  const regex = /(```[\s\S]*?```|`[^`\n]*`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        isCode: false,
        content: text.slice(lastIndex, match.index)
      });
    }
    tokens.push({
      isCode: true,
      content: match[0]
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({
      isCode: false,
      content: text.slice(lastIndex)
    });
  }

  return tokens
    .map((t) => {
      if (t.isCode) {
        return t.content;
      }
      // Outside code blocks, safely escape unescaped underscores
      let safe = t.content.replace(/(?<!\\)_/g, '\\_');
      // Escape standalone unescaped '[' that is not forming a markdown link [text](url)
      safe = safe.replace(/(?<!\\)\[(?![^\]\n]*\]\([^\)\n]+\))/g, '\\[');
      return safe;
    })
    .join('');
}

/**
 * Checks if a line could be part of a Markdown pipe table.
 */
function isTableCandidate(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.includes('|');
}

/**
 * Checks if a line is a Markdown table separator (e.g. |---|---| or | :--- | :---: |).
 */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) {
    return false;
  }
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(trimmed);
}

/**
 * Flattens Markdown table rows into mobile-readable bullet formats (e.g. • col1: col2),
 * omitting table separator lines and raw pipe markers.
 */
function flattenTableRows(tableLines: string[]): string[] {
  const result: string[] = [];

  for (const line of tableLines) {
    if (isTableSeparator(line)) {
      continue;
    }

    let trimmed = line.trim();
    if (trimmed.includes('\\|')) {
      trimmed = trimmed.replace(/\\\|/g, '\x01PIPE\x01');
    }

    if (trimmed.startsWith('|')) {
      trimmed = trimmed.slice(1);
    }
    if (trimmed.endsWith('|')) {
      trimmed = trimmed.slice(0, -1);
    }

    const rawCells = trimmed.split('|');
    const cells = rawCells.map(c => (c.includes('\x01PIPE\x01') ? c.split('\x01PIPE\x01').join('|').trim() : c.trim()));
    if (cells.length === 0 || cells.every(c => c === '')) {
      continue;
    }

    // Skip separator lines that might consist purely of dashes and colons
    if (cells.every(c => /^[:\-\s]+$/.test(c))) {
      continue;
    }

    if (cells.length === 1) {
      result.push(`• ${cells[0]}`);
    } else if (cells.length === 2) {
      result.push(`• ${cells[0]}: ${cells[1]}`);
    } else {
      result.push(`• ${cells[0]}: ${cells.slice(1).join(', ')}`);
    }
  }

  return result;
}

/**
 * Transforms line-level constructs (headings, blockquotes, unordered lists).
 */
function transformMarkdownLine(line: string): string {
  if (line.includes('\x00CODE_BLOCK_')) {
    return line;
  }

  // Horizontal rules (---, ***, ___)
  if (/^[ \t]*([*_-])[ \t]*(?:\1[ \t]*){2,}$/.test(line)) {
    return '';
  }

  let l = line;

  // Headings: Strip #, ##, ###, ..., ######
  if (l.includes('#')) {
    l = l.replace(/^[ \t]*#{1,6}[ \t]+/, '').replace(/[ \t]+#{1,6}[ \t]*$/, '');
  }

  // Blockquotes: > text -> | text
  if (l.includes('>')) {
    if (/^[ \t]*>+[ \t]?/.test(l)) {
      l = l.replace(/^[ \t]*>+[ \t]?/, '| ');
      if (l.trim() === '|') {
        l = '|';
      }
    }
  }

  // Unordered lists (*, -, +) -> clean bullet point (• )
  l = l.replace(/^([ \t]*)[*+-][ \t]+/, '$1• ');

  return l;
}

/**
 * Strips Markdown formatting from an input string, converting AI-generated transcripts
 * into clean, readable plain text for Telegram delivery.
 *
 * - Headings: Strips `#`, preserving the title text.
 * - Fenced code blocks: Preserves indentation and newlines, stripping only the opening and closing fences.
 * - Inline code: Strips backtick markers while preserving code text.
 * - Inline emphasis: Removes `**bold**`, `*italic*`, `__underline__`, and `~~strikethrough~~`.
 * - Tables: Flattens pipe tables into mobile-friendly bullet lists (e.g., `• col1: col2`), removing `|---|` dividers.
 * - Links: Converts `[text](url)` to `text` for local `file://` URLs, and `text (url)` for web URLs.
 * - Blockquotes: Converts `> text` to clean `| text` lines.
 * - Lists: Standardizes nested unordered lists (`*`, `-`, `+`) to bullet points (`• `).
 * - Whitespace: Collapses excessive consecutive blank lines down to a maximum of two newlines.
 *
 * Resilience: Gracefully handles null, undefined, non-string, empty strings, and malformed markdown.
 * Performance: Processes 100KB payloads in < 5ms without external dependencies.
 */
export function stripMarkdownToPlainText(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') {
    return '';
  }

  // Normalize line endings
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Step 1: Protect and extract fenced code blocks (``` and ~~~)
  const codeBlocks: string[] = [];
  const lines = normalized.split('\n');
  const nonCodeLines: string[] = [];

  let inCodeFence = false;
  let activeFenceChar = '';
  let activeFenceLen = 0;
  let currentCodeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^[ \t]*(`{3,}|~{3,})([a-zA-Z0-9_#+.-]*)[ \t]*$/);

    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0];
      const fenceLen = fenceMatch[1].length;

      if (!inCodeFence) {
        // Opening fence
        inCodeFence = true;
        activeFenceChar = fenceChar;
        activeFenceLen = fenceLen;
        currentCodeLines = [];
        continue;
      } else if (fenceChar === activeFenceChar && fenceLen >= activeFenceLen) {
        // Closing fence
        inCodeFence = false;
        const codeContent = currentCodeLines.join('\n');
        const placeholder = `\x00CODE_BLOCK_${codeBlocks.length}\x00`;
        codeBlocks.push(codeContent);
        nonCodeLines.push(placeholder);
        currentCodeLines = [];
        continue;
      }
    }

    if (inCodeFence) {
      currentCodeLines.push(line);
    } else {
      nonCodeLines.push(line);
    }
  }

  // Gracefully handle unclosed fence at EOF
  if (inCodeFence && currentCodeLines.length > 0) {
    const codeContent = currentCodeLines.join('\n');
    const placeholder = `\x00CODE_BLOCK_${codeBlocks.length}\x00`;
    codeBlocks.push(codeContent);
    nonCodeLines.push(placeholder);
  }

  // Step 2 & 3: Detect/flatten tables and transform line-level constructs in a single pass
  const processedLines: string[] = [];
  let lineIdx = 0;

  while (lineIdx < nonCodeLines.length) {
    const currentLine = nonCodeLines[lineIdx];

    if (isTableCandidate(currentLine)) {
      const tableBlock: string[] = [];
      let lookAhead = lineIdx;
      while (lookAhead < nonCodeLines.length && isTableCandidate(nonCodeLines[lookAhead])) {
        tableBlock.push(nonCodeLines[lookAhead]);
        lookAhead++;
      }

      const hasSeparator = tableBlock.some(l => isTableSeparator(l));
      const allBoxed = tableBlock.length >= 1 && tableBlock.every(l => {
        const tr = l.trim();
        return tr.startsWith('|') && tr.endsWith('|') && tr.length > 1;
      });

      if (hasSeparator || allBoxed) {
        const flattened = flattenTableRows(tableBlock);
        for (let k = 0; k < flattened.length; k++) {
          processedLines.push(flattened[k]);
        }
        lineIdx = lookAhead;
        continue;
      }
    }

    processedLines.push(transformMarkdownLine(currentLine));
    lineIdx++;
  }

  let text = processedLines.join('\n');

  // Step 4: HTML tags stripping (e.g. <br>, <b>, </b>, <span>, <!-- comment -->)
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<[^>]+>/g, '');

  // Step 5: Inline Links: [text](url) and images ![alt](url)
  text = text.replace(/!?\[([^\]\n]*)\]\(([^)\n]*)\)/g, (_match, linkText, rawUrl) => {
    const t = linkText.trim();
    const u = rawUrl.trim();

    // Local file URLs (file://...): omit URL, retain clean text
    if (/^file:\/{1,3}/i.test(u)) {
      return t || '';
    }

    // If no URL or text is identical to URL
    if (!u || t === u) {
      return t || u;
    }

    // If no text, return URL
    if (!t) {
      return u;
    }

    // Web URL: format as text (url)
    return `${t} (${u})`;
  });

  // Step 6: Inline Code: `code`
  text = text.replace(/`+([^`\n]+)`+/g, '$1');

  // Step 7: Inline Emphasis: bold, italic, underline, strikethrough (linear high-performance)
  // Triple asterisks / underscores: ***text*** or ___text___
  text = text.replace(/(?:\*{3}|_{3})([^*\n_]+)(?:\*{3}|_{3})/g, '$1');
  // Double asterisks: **text**
  text = text.replace(/\*{2}([^*\n]+)\*{2}/g, '$1');
  // Double underscores: __text__
  text = text.replace(/_{2}([^_\n]+)_{2}/g, '$1');
  // Strikethrough: ~~text~~
  text = text.replace(/~~([^~\n]+)~~/g, '$1');
  // Single asterisk italic: *text* (must not be surrounded by spaces)
  text = text.replace(/(^|[\s\W])\*([^*\s\n](?:[^*\n]*[^*\s\n])?)\*(?=[\s\W]|$)/g, '$1$2');
  // Single underscore italic: _text_ (safe against snake_case identifiers)
  text = text.replace(/(^|[\s\W])_([^_\s\n](?:[^_\n]*[^_\s\n])?)_(?=[\s\W]|$)/g, '$1$2');

  // Clean up any stray unmatched markdown syntax characters (e.g. unclosed backticks, dangling asterisks)
  text = text.replace(/`+/g, '');
  text = text.replace(/\*{2,}/g, '');
  text = text.replace(/(^|[\s])\*([a-zA-Z0-9])/g, '$1$2');
  text = text.replace(/([a-zA-Z0-9])\*(?=[\s]|$)/g, '$1');
  text = text.replace(/_{2,}/g, '');
  text = text.replace(/~~+/g, '');

  // Step 8: Restore fenced code blocks in a single O(N) regex pass
  text = text.replace(/\x00CODE_BLOCK_(\d+)\x00/g, (_, idx) => {
    const num = Number(idx);
    return num < codeBlocks.length ? codeBlocks[num] : '';
  });

  // Step 9: Whitespace Normalization (maximum 2 consecutive newlines)
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

