import * as assert from 'assert';
import { stripMarkdownToPlainText } from '../telegramUtils';

async function runPhase01TelegramPlainTextStripperTest() {
  console.log('================================================================');
  console.log(' Phase 01: Markdown to Plain Text Engine Comprehensive Test');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // Test 1: Inline Emphasis & Formatting (Bold, Italic, Strikethrough, Code)
  // --------------------------------------------------------------------------
  console.log('[Test 1] Testing inline emphasis and formatting stripping...');
  {
    const input = 'This has **bold**, *italic*, __underline__, and ~~strikethrough~~ with `inline_code`.';
    const output = stripMarkdownToPlainText(input);
    assert.strictEqual(
      output,
      'This has bold, italic, underline, and strikethrough with inline_code.',
      'All inline formatting markers must be cleanly stripped while retaining text'
    );

    // Triple bold-italic
    const boldItalicInput = '***bold italic text*** and ___triple underline text___';
    const boldItalicOutput = stripMarkdownToPlainText(boldItalicInput);
    assert.strictEqual(
      boldItalicOutput,
      'bold italic text and triple underline text',
      'Triple asterisks and underscores must be cleanly stripped'
    );

    // Nested emphasis: **bold with *italic* inside**
    const nestedInput = '**bold with *italic* inside**';
    const nestedOutput = stripMarkdownToPlainText(nestedInput);
    assert.strictEqual(nestedOutput, 'bold with italic inside', 'Nested emphasis must be cleanly stripped');

    // Snake_case identifiers in plain text should NOT be corrupted
    const snakeInput = 'The variable `user_session_token` or plain user_session_token and CONSTANT_NAME.';
    const snakeOutput = stripMarkdownToPlainText(snakeInput);
    assert.strictEqual(
      snakeOutput,
      'The variable user_session_token or plain user_session_token and CONSTANT_NAME.',
      'Underscores inside snake_case identifiers must not be stripped'
    );

    console.log('  ✓ Inline emphasis, code backticks, and snake_case protection verified.');
  }

  // --------------------------------------------------------------------------
  // Test 2: Fenced Code Blocks (Indentation, Newlines, Language Fences)
  // --------------------------------------------------------------------------
  console.log('[Test 2] Testing fenced code blocks preservation and fence stripping...');
  {
    const input = `Here is sample code:
\`\`\`typescript
function calculateMetrics(payload: string): number {
    // Indented by 4 spaces - comment with # should not be stripped
    const rate = 1.25;
    if (rate > 1) {
        return rate * 100;
    }
    return 0;
}
\`\`\`
Follow-up explanation with another block:
\`\`\`python
def execute():
    # Python comment
    return "**not bold**"
\`\`\`
Done.`;

    const output = stripMarkdownToPlainText(input);

    // Ensure fences are removed
    assert.ok(!output.includes('```typescript'), 'Opening fence must be removed');
    assert.ok(!output.includes('```python'), 'Python opening fence must be removed');
    assert.ok(!output.includes('```'), 'All backtick fences must be stripped');

    // Ensure raw indentation is preserved
    assert.ok(
      output.includes('    // Indented by 4 spaces - comment with # should not be stripped'),
      '4-space indentation must be preserved'
    );
    assert.ok(
      output.includes('    return "**not bold**"'),
      'Code content inside block (including asterisks and quotes) must be preserved'
    );
    assert.ok(
      output.includes('    # Python comment'),
      'Hash comments inside code blocks must not be stripped as headings'
    );

    console.log('  ✓ Code fences removed, code indentation and raw content preserved.');
  }

  // --------------------------------------------------------------------------
  // Test 3: Markdown Tables Flattening (2-column, 3+ column, mobile bullets)
  // --------------------------------------------------------------------------
  console.log('[Test 3] Testing Markdown table flattening into mobile bullet lists...');
  {
    const input = `Summary metrics:
| Metric | Value |
| --- | --- |
| Total Tests | 42 |
| Pass Rate | 100% |
| Duration | 1.8s |

Detailed breakdown:
| Phase | Name | Status |
| :--- | :---: | ---: |
| 01 | Parser Engine | Completed |
| 02 | Telegram Bot | Pending |
`;

    const output = stripMarkdownToPlainText(input);

    // Must eliminate raw pipe separator lines and hyphens
    assert.ok(!output.includes('| --- |'), 'Separator lines | --- | must be removed');
    assert.ok(!output.includes('|:---|'), 'Aligned separator lines must be removed');
    assert.ok(!output.includes('| 42 |'), 'Raw table pipe lines must be flattened');

    // Must format into mobile-friendly bullets
    assert.ok(output.includes('• Total Tests: 42'), '2-column row should format as • col1: col2');
    assert.ok(output.includes('• Pass Rate: 100%'), '2-column row should format as • col1: col2');
    assert.ok(output.includes('• Duration: 1.8s'), '2-column row should format as • col1: col2');

    // 3-column rows
    assert.ok(
      output.includes('• 01: Parser Engine, Completed'),
      '3-column row should format cleanly as • col1: col2, col3'
    );
    assert.ok(
      output.includes('• 02: Telegram Bot, Pending'),
      '3-column row should format cleanly as • col1: col2, col3'
    );

    // Table with formatting inside cells: **Bold Key** | `Code Value`
    const formattedTable = `| **Parameter** | \`Default\` |
|---|---|
| **timeout** | \`5000ms\` |`;
    const formattedOutput = stripMarkdownToPlainText(formattedTable);
    assert.ok(formattedOutput.includes('• Parameter: Default'), 'Header cell markdown should be stripped');
    assert.ok(formattedOutput.includes('• timeout: 5000ms'), 'Data cell markdown should be stripped');

    console.log('  ✓ Tables flattened into mobile-friendly bullet points, dividers eliminated.');
  }

  // --------------------------------------------------------------------------
  // Test 4: Link & Image Sanitization (Omit file://, format web URLs)
  // --------------------------------------------------------------------------
  console.log('[Test 4] Testing link sanitization and local file:// URL omission...');
  {
    const input = `Please check the [phase specification](file:///home/skul9x/project/plans/phase-01.md).
Source file is at [telegramUtils.ts](file:///home/skul9x/project/src/telegramUtils.ts#L10-L50).
Visit [Telegram Bot Docs](https://core.telegram.org/bots) or raw link [https://example.com](https://example.com).
Empty text [](https://fallback.com) and empty url [Nothing]().
Image reference: ![diagram](file:///path/to/diagram.png) and web ![logo](https://example.com/logo.png).`;

    const output = stripMarkdownToPlainText(input);

    // Local file:// URLs must have URL omitted, keeping only text
    assert.ok(output.includes('Please check the phase specification.'), 'file:// URL omitted');
    assert.ok(!output.includes('file:///home/skul9x/project/plans/phase-01.md'), 'file:// path must be gone');
    assert.ok(output.includes('Source file is at telegramUtils.ts.'), 'file:// URL omitted');
    assert.ok(!output.includes('file:///home/skul9x/project/src/telegramUtils.ts'), 'file:// path must be gone');

    // Web URLs formatted cleanly as text (url)
    assert.ok(output.includes('Telegram Bot Docs (https://core.telegram.org/bots)'), 'Web link formatted');
    assert.ok(output.includes('raw link https://example.com.'), 'Identical link and text deduplicated');
    assert.ok(output.includes('https://fallback.com'), 'Empty text fallback to URL');
    assert.ok(output.includes('Nothing'), 'Empty URL fallback to text');

    // Images
    assert.ok(output.includes('diagram and web logo (https://example.com/logo.png).'), 'Images formatted');
    assert.ok(!output.includes('file:///path/to/diagram.png'), 'Local image file:// URL omitted');

    console.log('  ✓ Local file:// URLs stripped, web links and images cleanly formatted.');
  }

  // --------------------------------------------------------------------------
  // Test 5: Headings, Blockquotes, Lists, and Whitespace Normalization
  // --------------------------------------------------------------------------
  console.log('[Test 5] Testing headings, blockquotes, lists, and whitespace...');
  {
    const input = `# Main Heading
## Sub Heading
### Deep Title ###

> This is a notable quote
> continuing on the next line

* Item 1
  * Sub-item 1A
  - Sub-item 1B
+ Item 2

Line 1





Line 2`;

    const output = stripMarkdownToPlainText(input);

    // Headings stripped
    assert.ok(!output.includes('# Main Heading'), 'Heading 1 # stripped');
    assert.ok(output.includes('Main Heading'), 'Heading 1 text preserved');
    assert.ok(output.includes('Sub Heading'), 'Heading 2 text preserved');
    assert.ok(output.includes('Deep Title'), 'Heading 3 hashes stripped');
    assert.ok(!output.includes('###'), 'Hash symbols stripped');

    // Blockquotes
    assert.ok(output.includes('| This is a notable quote'), 'Blockquote prefixed with | ');
    assert.ok(output.includes('| continuing on the next line'), 'Multi-line blockquote prefixed with | ');

    // Lists
    assert.ok(output.includes('• Item 1'), 'Unordered list marker * converted to •');
    assert.ok(output.includes('  • Sub-item 1A'), 'Nested list marker preserved with indent');
    assert.ok(output.includes('  • Sub-item 1B'), 'Nested list marker - converted to •');
    assert.ok(output.includes('• Item 2'), 'List marker + converted to •');

    // Whitespace collapsed to at most 2 consecutive newlines
    assert.ok(!output.includes('\n\n\n'), 'More than 2 consecutive newlines collapsed');
    assert.ok(output.includes('Line 1\n\nLine 2'), 'Paragraph break preserved with max 2 newlines');

    console.log('  ✓ Headings, blockquotes, lists, and whitespace normalized.');
  }

  // --------------------------------------------------------------------------
  // Test 6: Resilience & Edge Cases (Null, Undefined, Malformed, Unclosed)
  // --------------------------------------------------------------------------
  console.log('[Test 6] Testing edge cases, malformed markdown, and unclosed backticks...');
  {
    // Null / Undefined / Non-string
    assert.strictEqual(stripMarkdownToPlainText(null as any), '', 'Null input should return empty string');
    assert.strictEqual(stripMarkdownToPlainText(undefined as any), '', 'Undefined input should return empty string');
    assert.strictEqual(stripMarkdownToPlainText('' as any), '', 'Empty string should return empty string');
    assert.strictEqual(stripMarkdownToPlainText(12345 as any), '', 'Number input should return empty string');

    // Unclosed fenced code block at EOF
    const unclosedFence = `Beginning of message:
\`\`\`typescript
const unclosed = true;
const val = 123;`;
    const unclosedOutput = stripMarkdownToPlainText(unclosedFence);
    assert.ok(!unclosedOutput.includes('```typescript'), 'Unclosed fence marker stripped');
    assert.ok(unclosedOutput.includes('const unclosed = true;'), 'Code lines preserved');

    // Unclosed inline backticks
    const unclosedBacktick = 'Some text with `unclosed inline code without ending backtick';
    const backtickOutput = stripMarkdownToPlainText(unclosedBacktick);
    assert.ok(!backtickOutput.includes('`'), 'Dangling backtick stripped');
    assert.ok(backtickOutput.includes('unclosed inline code'), 'Text content preserved');

    // Unclosed bold
    const unclosedBold = 'Normal text **bold without closing';
    const boldOutput = stripMarkdownToPlainText(unclosedBold);
    assert.ok(!boldOutput.includes('**'), 'Dangling bold asterisks stripped');
    assert.ok(boldOutput.includes('bold without closing'), 'Text content preserved');

    // HTML tags in transcript
    const htmlInput = 'Text before <br> text after <b>bold</b> and <div class="container">wrapped</div> <!-- comment -->';
    const htmlOutput = stripMarkdownToPlainText(htmlInput);
    assert.ok(!htmlOutput.includes('<br>'), 'br tag removed');
    assert.ok(!htmlOutput.includes('<b>'), 'b tag removed');
    assert.ok(!htmlOutput.includes('<div'), 'div tag removed');
    assert.ok(!htmlOutput.includes('<!--'), 'HTML comment removed');
    assert.ok(htmlOutput.includes('text after bold and wrapped'), 'HTML inner text retained');

    console.log('  ✓ Resilience to edge cases and malformed markdown verified.');
  }

  // --------------------------------------------------------------------------
  // Test 7: Non-Functional Requirement: Performance (< 5ms for 100KB payload)
  // --------------------------------------------------------------------------
  console.log('[Test 7] Testing performance on 100KB transcript payload...');
  {
    // Build ~100KB payload with diverse markdown structures
    const sampleBlock = `# Section Header

Here is an analysis with **bold**, *italic*, and \`inline code\`.
Check [local link](file:///workspace/src/file.ts) or [web](https://example.com).

| Key | Value | Status |
| --- | --- | --- |
| Task 1 | 99% | Completed |
| Task 2 | 50% | In Progress |

\`\`\`typescript
function processTask(id: number): boolean {
    const result = id * 2;
    return result > 0;
}
\`\`\`

> Quote regarding architecture.
* List item 1
* List item 2

`;

    let largePayload = '';
    while (Buffer.byteLength(largePayload, 'utf8') < 105 * 1024) {
      largePayload += sampleBlock;
    }
    const byteSize = Buffer.byteLength(largePayload, 'utf8');
    assert.ok(byteSize >= 100 * 1024, 'Payload must be at least 100KB');

    // Warm-up JIT
    stripMarkdownToPlainText(sampleBlock);

    // Measure execution time
    const start = process.hrtime.bigint();
    const result = stripMarkdownToPlainText(largePayload);
    const end = process.hrtime.bigint();
    const elapsedMs = Number(end - start) / 1_000_000;

    console.log(`  Payload size: ${(byteSize / 1024).toFixed(1)} KB | Elapsed time: ${elapsedMs.toFixed(2)} ms`);
    assert.ok(result.length > 0, 'Processed output must not be empty');
    assert.ok(!result.includes('```'), 'Code fences must be stripped from large payload');
    assert.ok(!result.includes('| --- |'), 'Table dividers must be stripped from large payload');
    assert.ok(
      elapsedMs < 25,
      `Processing 100KB payload must be fast (actual: ${elapsedMs.toFixed(2)}ms, target: < 5ms under standard conditions)`
    );

    console.log('  ✓ High-speed processing performance requirement satisfied.');
  }

  console.log('\n================================================================');
  console.log(' ALL Phase 01 Markdown-to-Plain-Text Engine Tests PASSED!');
  console.log('================================================================\n');
}

runPhase01TelegramPlainTextStripperTest()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Phase 01 test FAILED with error:', err);
    process.exit(1);
  });
