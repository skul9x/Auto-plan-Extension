/**
 * Smart Markdown Chunker for Telegram Live Q&A Mirror.
 *
 * Safely splits AI responses into chunks under Telegram's 4096-character limit
 * (default 3800 chars) along paragraph and newline boundaries without breaking words.
 * Accurately tracks Markdown fenced code blocks (```) and re-opens fences with the
 * proper language identifier across chunk boundaries to prevent Telegram entity
 * parse errors (HTTP 400 Bad Request).
 */

export const DEFAULT_MAX_CHUNK_LENGTH = 3800;

export interface CodeFenceState {
  inCodeBlock: boolean;
  codeBlockLang: string;
  fenceMarker: string;
}

/**
 * Checks if a line matches a fenced code block boundary (``` or ~~~).
 */
export function parseFenceLine(line: string): { isFence: boolean; marker: string; lang: string } {
  const match = line.match(/^([ \t]*)(`{3,}|~{3,})\s*([a-zA-Z0-9_#+.-]*)[ \t]*$/);
  if (!match) {
    return { isFence: false, marker: '', lang: '' };
  }
  return {
    isFence: true,
    marker: match[2],
    lang: match[3] || ''
  };
}

/**
 * Counts code fences and checks balance.
 */
export function analyzeCodeFences(text: string): { openingCount: number; closingCount: number; isBalanced: boolean } {
  const lines = text.split(/\r?\n/);
  let opening = 0;
  let closing = 0;
  let inBlock = false;
  let currentMarker = '';

  for (const line of lines) {
    const { isFence, marker } = parseFenceLine(line);
    if (isFence) {
      if (!inBlock) {
        opening++;
        inBlock = true;
        currentMarker = marker;
      } else if (marker[0] === currentMarker[0]) {
        closing++;
        inBlock = false;
        currentMarker = '';
      }
    }
  }

  return {
    openingCount: opening,
    closingCount: closing,
    isBalanced: opening === closing && !inBlock
  };
}

/**
 * Safely splits markdown text into chunks not exceeding `maxLen` (default 3800 chars).
 * Splits on line and paragraph boundaries, maintaining matching fenced code blocks
 * across all chunk boundaries.
 *
 * @param text The markdown text to split.
 * @param maxLen The maximum safe character length per chunk (default 3800).
 * @returns Array of safe markdown chunks.
 */
export function splitMarkdownSafely(text: string, maxLen: number = DEFAULT_MAX_CHUNK_LENGTH): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  if (text.length <= maxLen) {
    return [text];
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chunks: string[] = [];

  let currentChunkLines: string[] = [];
  let currentLinesLength = 0;

  let inCodeBlock = false;
  let codeBlockLang = '';
  let fenceMarker = '```';

  let chunkPrefix = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Determine state transition for this line
    const { isFence, marker, lang } = parseFenceLine(line);
    let nextInCodeBlock: boolean = inCodeBlock;
    let nextCodeBlockLang: string = codeBlockLang;
    let nextFenceMarker: string = fenceMarker;

    if (isFence) {
      if (!inCodeBlock) {
        // Entering code block
        nextInCodeBlock = true;
        nextCodeBlockLang = lang;
        nextFenceMarker = marker.startsWith('~') ? '~~~' : '```';
      } else if (marker[0] === fenceMarker[0]) {
        // Exiting code block
        nextInCodeBlock = false;
        nextCodeBlockLang = '';
        nextFenceMarker = '```';
      }
    }

    // Determine closing suffix if the chunk were to end right after this line
    const tentativeSuffix = nextInCodeBlock ? `\n${nextFenceMarker}` : '';

    // Calculate tentative chunk length if line is added
    const addedLen = currentChunkLines.length > 0 ? 1 + line.length : line.length;
    const tentativeTotalLen = chunkPrefix.length + currentLinesLength + addedLen + tentativeSuffix.length;

    if (tentativeTotalLen <= maxLen) {
      // Line fits in the current chunk
      currentChunkLines.push(line);
      currentLinesLength += addedLen;
      inCodeBlock = nextInCodeBlock;
      codeBlockLang = nextCodeBlockLang;
      fenceMarker = nextFenceMarker;
    } else {
      // Line does not fit in the current chunk
      if (currentChunkLines.length > 0) {
        // Finalize current chunk
        const chunkSuffix = inCodeBlock ? `\n${fenceMarker}` : '';
        const chunkText = chunkPrefix + currentChunkLines.join('\n') + chunkSuffix;
        chunks.push(chunkText);

        // Reset for next chunk
        currentChunkLines = [];
        currentLinesLength = 0;
        chunkPrefix = inCodeBlock ? `${fenceMarker}${codeBlockLang}\n` : '';

        // Re-process the same line in the next chunk
        i--;
        continue;
      } else {
        // A single line alone exceeds maxLen (e.g. huge minified string or inline text)
        const safeLimit = Math.max(100, maxLen - chunkPrefix.length - (nextInCodeBlock ? 5 : 0));

        // Attempt word boundary cut
        let cutPoint = line.lastIndexOf(' ', safeLimit);
        if (cutPoint <= 0 || cutPoint < safeLimit * 0.4) {
          cutPoint = safeLimit;
        }

        const head = line.slice(0, cutPoint);
        const tail = line.slice(cutPoint).replace(/^[ \t]/, '');

        currentChunkLines.push(head);
        currentLinesLength = head.length;
        inCodeBlock = nextInCodeBlock;
        codeBlockLang = nextCodeBlockLang;
        fenceMarker = nextFenceMarker;

        const chunkSuffix = inCodeBlock ? `\n${fenceMarker}` : '';
        const chunkText = chunkPrefix + currentChunkLines.join('\n') + chunkSuffix;
        chunks.push(chunkText);

        currentChunkLines = [];
        currentLinesLength = 0;
        chunkPrefix = inCodeBlock ? `${fenceMarker}${codeBlockLang}\n` : '';

        // Replace current line with remainder tail and retry if tail remains
        if (tail.length > 0) {
          lines[i] = tail;
          i--;
        }
        continue;
      }
    }
  }

  // Push remaining lines if any
  if (currentChunkLines.length > 0) {
    const chunkSuffix = inCodeBlock ? `\n${fenceMarker}` : '';
    const chunkText = chunkPrefix + currentChunkLines.join('\n') + chunkSuffix;
    chunks.push(chunkText);
  }

  return chunks;
}

/**
 * Object-oriented wrapper and helper for SmartMarkdownChunker.
 */
export class SmartMarkdownChunker {
  public static readonly DEFAULT_MAX_LENGTH = DEFAULT_MAX_CHUNK_LENGTH;

  public static split(text: string, maxLen: number = DEFAULT_MAX_CHUNK_LENGTH): string[] {
    return splitMarkdownSafely(text, maxLen);
  }

  public static splitSafely(text: string, maxLen: number = DEFAULT_MAX_CHUNK_LENGTH): string[] {
    return splitMarkdownSafely(text, maxLen);
  }

  public split(text: string, maxLen?: number): string[] {
    return splitMarkdownSafely(text, maxLen ?? SmartMarkdownChunker.DEFAULT_MAX_LENGTH);
  }

  public splitSafely(text: string, maxLen?: number): string[] {
    return splitMarkdownSafely(text, maxLen ?? SmartMarkdownChunker.DEFAULT_MAX_LENGTH);
  }
}

export const smartMarkdownChunker = new SmartMarkdownChunker();
