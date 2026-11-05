import * as assert from 'assert';
import {
  splitHtmlMessage,
  validateBalancedTelegramHtml,
} from '../telegramUtils';

async function runPhase02HtmlTagAwareChunkSplitterTest() {
  console.log('================================================================');
  console.log(' Phase 02: HTML Tag-Aware Chunk Splitter Tests');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // Suite 1: Null, Undefined, Empty, Non-String & Short Inputs
  // --------------------------------------------------------------------------
  console.log('[Suite 1] Testing null, undefined, empty, non-string, and short inputs...');
  {
    assert.deepStrictEqual(splitHtmlMessage(null as any), [], 'null input must return empty array');
    assert.deepStrictEqual(splitHtmlMessage(undefined as any), [], 'undefined input must return empty array');
    assert.deepStrictEqual(splitHtmlMessage('' as any), [], 'empty string input must return empty array');
    assert.deepStrictEqual(splitHtmlMessage(12345 as any), [], 'number input must return empty array');
    assert.deepStrictEqual(splitHtmlMessage({} as any), [], 'object input must return empty array');

    const shortHtml = '<b>Hello Telegram!</b>';
    const shortChunks = splitHtmlMessage(shortHtml);
    assert.strictEqual(shortChunks.length, 1, 'Short text within limit must return single chunk');
    assert.strictEqual(shortChunks[0], shortHtml, 'Chunk content must equal original short text');

    // Custom maxChunkLength
    const customChunks = splitHtmlMessage('Hello World', 5);
    assert.ok(customChunks.length > 1, 'Custom small maxChunkLength should split short text');

    // Non-positive maxChunkLength defaults to 3800
    const defaultFallback = splitHtmlMessage(shortHtml, -10);
    assert.strictEqual(defaultFallback.length, 1, 'Negative maxChunkLength must default to 3800');

    console.log('  ✓ Null, undefined, empty, non-string, and short inputs handled gracefully.');
  }

  // --------------------------------------------------------------------------
  // Suite 2: Large Code Block Splitting Across 2 and 3 Chunks
  // --------------------------------------------------------------------------
  console.log('[Suite 2] Testing large code block splitting across 2 and 3 chunks...');
  {
    // Part A: Splitting across 2 chunks (~7,000 chars)
    const codeLine = '  const result = calculateMetrics(items, index, { debug: true });\n';
    let codeBody2Chunks = '';
    while (codeBody2Chunks.length < 6800) {
      codeBody2Chunks += codeLine;
    }
    const fullCodeHtml2 = `<pre><code class="language-typescript">\n${codeBody2Chunks}</code></pre>`;

    const chunks2 = splitHtmlMessage(fullCodeHtml2, 3800);
    assert.strictEqual(chunks2.length, 2, `Expected exactly 2 chunks for ~7KB code block, got ${chunks2.length}`);

    for (let i = 0; i < chunks2.length; i++) {
      const chunk = chunks2[i];
      assert.ok(chunk.length <= 3800, `Chunk ${i} length (${chunk.length}) must be <= 3800`);

      const val = validateBalancedTelegramHtml(chunk);
      assert.ok(val.valid, `Chunk ${i} must have balanced HTML tags: ${val.error}`);

      assert.ok(
        chunk.startsWith('<pre><code class="language-typescript">'),
        `Chunk ${i} must start with <pre><code class="language-typescript">`
      );
      assert.ok(
        chunk.endsWith('</code></pre>'),
        `Chunk ${i} must end with </code></pre>`
      );
    }

    // Part B: Splitting across 3 chunks (~11,000 chars)
    let codeBody3Chunks = '';
    while (codeBody3Chunks.length < 10500) {
      codeBody3Chunks += codeLine;
    }
    const fullCodeHtml3 = `<pre><code class="language-typescript">\n${codeBody3Chunks}</code></pre>`;

    const chunks3 = splitHtmlMessage(fullCodeHtml3, 3800);
    assert.strictEqual(chunks3.length, 3, `Expected exactly 3 chunks for ~11KB code block, got ${chunks3.length}`);

    for (let i = 0; i < chunks3.length; i++) {
      const chunk = chunks3[i];
      assert.ok(chunk.length <= 3800, `Chunk ${i} length (${chunk.length}) must be <= 3800`);

      const val = validateBalancedTelegramHtml(chunk);
      assert.ok(val.valid, `Chunk ${i} must have balanced HTML tags: ${val.error}`);

      assert.ok(
        chunk.startsWith('<pre><code class="language-typescript">'),
        `Chunk ${i} must start with <pre><code class="language-typescript">`
      );
      assert.ok(
        chunk.endsWith('</code></pre>'),
        `Chunk ${i} must end with </code></pre>`
      );
    }

    // Part C: Verify Indentation Preservation inside <pre><code>
    // Ensure leading 2-space indentation on code lines was NOT stripped in resumed chunks
    const resumedContent = chunks3[1].replace('<pre><code class="language-typescript">', '');
    assert.ok(
      resumedContent.startsWith('  const result'),
      'Indentation (2 leading spaces) must be preserved inside <pre><code> across chunk boundaries'
    );

    console.log('  ✓ Large code blocks correctly split across 2 and 3 chunks with balanced <pre><code> and preserved indentation.');
  }

  // --------------------------------------------------------------------------
  // Suite 3: Nested Formatting Tags Splitting (<b><i>...</i></b>, <blockquote>, etc.)
  // --------------------------------------------------------------------------
  console.log('[Suite 3] Testing nested formatting tags splitting across chunk boundaries...');
  {
    // Part A: Bold + Italic (<b><i>...</i></b>)
    const sentence = 'This is deeply formatted bold italic text that spans across multiple sentences. ';
    let nestedBody = '';
    while (nestedBody.length < 5000) {
      nestedBody += sentence;
    }
    const nestedHtml = `<b><i>${nestedBody}</i></b>`;

    const nestedChunks = splitHtmlMessage(nestedHtml, 3800);
    assert.strictEqual(nestedChunks.length, 2, 'Expected 2 chunks for 5KB nested bold/italic');

    // Chunk 0 must start with <b><i> and end with </i></b>
    assert.ok(nestedChunks[0].startsWith('<b><i>'), 'Chunk 0 must start with <b><i>');
    assert.ok(nestedChunks[0].endsWith('</i></b>'), 'Chunk 0 must end with </i></b>');

    // Chunk 1 must reopen <b><i> and end with </i></b>
    assert.ok(nestedChunks[1].startsWith('<b><i>'), 'Chunk 1 must reopen <b><i>');
    assert.ok(nestedChunks[1].endsWith('</i></b>'), 'Chunk 1 must end with </i></b>');

    for (let i = 0; i < nestedChunks.length; i++) {
      const val = validateBalancedTelegramHtml(nestedChunks[i]);
      assert.ok(val.valid, `Nested chunk ${i} must have balanced tags: ${val.error}`);
    }

    // Part B: Deep nesting (<blockquote><b><i><u><s>...</s></u></i></b></blockquote>)
    const deepHtml = `<blockquote><b><i><u><s>${nestedBody}</s></u></i></b></blockquote>`;
    const deepChunks = splitHtmlMessage(deepHtml, 3800);
    assert.strictEqual(deepChunks.length, 2, 'Expected 2 chunks for deeply nested tags');

    assert.ok(
      deepChunks[0].startsWith('<blockquote><b><i><u><s>'),
      'Deep chunk 0 must start with <blockquote><b><i><u><s>'
    );
    assert.ok(
      deepChunks[0].endsWith('</s></u></i></b></blockquote>'),
      'Deep chunk 0 must end with </s></u></i></b></blockquote>'
    );
    assert.ok(
      deepChunks[1].startsWith('<blockquote><b><i><u><s>'),
      'Deep chunk 1 must reopen <blockquote><b><i><u><s>'
    );
    assert.ok(
      deepChunks[1].endsWith('</s></u></i></b></blockquote>'),
      'Deep chunk 1 must end with </s></u></i></b></blockquote>'
    );

    for (let i = 0; i < deepChunks.length; i++) {
      const val = validateBalancedTelegramHtml(deepChunks[i]);
      assert.ok(val.valid, `Deeply nested chunk ${i} must be balanced: ${val.error}`);
    }

    console.log('  ✓ Nested tags (<b><i>...</i></b> and deeply nested formatting) cleanly closed and reopened.');
  }

  // --------------------------------------------------------------------------
  // Suite 4: Links and Tag Attributes Edge Cases (<a href="...">, long URLs, etc.)
  // --------------------------------------------------------------------------
  console.log('[Suite 4] Testing links and tag attributes edge cases...');
  {
    // Part A: Long URL and attributes inside <a href="...">
    const longUrl = 'https://example.com/api/v2/search?query=antigravity&filter=production&region=us-central1&sort=desc&auth_token=abcdef1234567890';
    let linkText = '';
    while (linkText.length < 4500) {
      linkText += 'Visit documentation portal link text here. ';
    }
    const linkHtml = `<a href="${longUrl}">${linkText}</a>`;

    const linkChunks = splitHtmlMessage(linkHtml, 3800);
    assert.strictEqual(linkChunks.length, 2, 'Expected 2 chunks for link with long text');

    // Chunk 0 must start with <a href="..."> and end with </a>
    assert.ok(linkChunks[0].startsWith(`<a href="${longUrl}">`), 'Chunk 0 must start with full link opening tag');
    assert.ok(linkChunks[0].endsWith('</a>'), 'Chunk 0 must end with </a>');

    // Chunk 1 must reopen with the exact identical <a href="..."> and end with </a>
    assert.ok(linkChunks[1].startsWith(`<a href="${longUrl}">`), 'Chunk 1 must reopen with identical full link opening tag');
    assert.ok(linkChunks[1].endsWith('</a>'), 'Chunk 1 must end with </a>');

    for (let i = 0; i < linkChunks.length; i++) {
      const val = validateBalancedTelegramHtml(linkChunks[i]);
      assert.ok(val.valid, `Link chunk ${i} must be balanced: ${val.error}`);
    }

    // Part B: Anchor tag situated right at chunk boundary
    // Fill up chunk 1 almost to 3800, then place <a href="...">
    let filler = '';
    while (filler.length < 3700) {
      filler += 'Some regular prose paragraph content here. ';
    }
    const boundaryLink = `${filler}<a href="${longUrl}">Important Endpoint</a>`;
    const boundaryChunks = splitHtmlMessage(boundaryLink, 3800);
    assert.strictEqual(boundaryChunks.length, 2, 'Link near boundary should cleanly move to chunk 2');

    // Chunk 0 should not split the tag in half
    assert.ok(!boundaryChunks[0].includes('<a href="https://example.com/api/v2/search?query=antigravity'), 'Chunk 0 must not contain partial <a href');
    assert.ok(!boundaryChunks[0].endsWith('<'), 'Chunk 0 must not end with dangling <');
    assert.ok(!boundaryChunks[0].endsWith('</'), 'Chunk 0 must not end with dangling </');

    // Chunk 1 should contain the complete anchor tag
    assert.ok(boundaryChunks[1].includes(`<a href="${longUrl}">Important Endpoint</a>`), 'Chunk 1 must contain full anchor tag intact');

    // Part C: Expandable blockquote (<blockquote expandable>)
    let expandableText = '';
    while (expandableText.length < 4500) {
      expandableText += 'Collapsible details line for inspection.\n';
    }
    const expHtml = `<blockquote expandable>${expandableText}</blockquote>`;
    const expChunks = splitHtmlMessage(expHtml, 3800);
    assert.strictEqual(expChunks.length, 2, 'Expected 2 chunks for expandable blockquote');
    assert.ok(expChunks[0].startsWith('<blockquote expandable>'), 'Chunk 0 must start with <blockquote expandable>');
    assert.ok(expChunks[0].endsWith('</blockquote>'), 'Chunk 0 must end with </blockquote>');
    assert.ok(expChunks[1].startsWith('<blockquote expandable>'), 'Chunk 1 must reopen <blockquote expandable>');
    assert.ok(expChunks[1].endsWith('</blockquote>'), 'Chunk 1 must end with </blockquote>');

    // Part D: Spoiler (<span class="tg-spoiler">)
    let spoilerText = '';
    while (spoilerText.length < 4500) {
      spoilerText += 'Top secret classified intelligence information. ';
    }
    const spoilerHtml = `<span class="tg-spoiler">${spoilerText}</span>`;
    const spoilerChunks = splitHtmlMessage(spoilerHtml, 3800);
    assert.strictEqual(spoilerChunks.length, 2, 'Expected 2 chunks for spoiler');
    assert.ok(spoilerChunks[0].startsWith('<span class="tg-spoiler">'), 'Chunk 0 must start with <span class="tg-spoiler">');
    assert.ok(spoilerChunks[0].endsWith('</span>'), 'Chunk 0 must end with </span>');
    assert.ok(spoilerChunks[1].startsWith('<span class="tg-spoiler">'), 'Chunk 1 must reopen <span class="tg-spoiler">');
    assert.ok(spoilerChunks[1].endsWith('</span>'), 'Chunk 1 must end with </span>');

    console.log('  ✓ Links, expandable blockquotes, and spoilers handled with full attribute preservation.');
  }

  // --------------------------------------------------------------------------
  // Suite 5: HTML Entity Protection and Boundary Delimiter Safety
  // --------------------------------------------------------------------------
  console.log('[Suite 5] Testing HTML entity protection and split boundary hierarchy...');
  {
    // Part A: Entity &amp; right at boundary
    let textWithEntities = '';
    while (textWithEntities.length < 3780) {
      textWithEntities += 'Data item &amp; status record. ';
    }
    // Add entity spanning across the 3800 mark
    textWithEntities += 'Final &quot;value&quot; with &lt;tag&gt; and &#128512; emoji.';

    const entityChunks = splitHtmlMessage(textWithEntities, 3800);
    for (let i = 0; i < entityChunks.length; i++) {
      const c = entityChunks[i];
      // Assert no split in entity (e.g. no &a, &am, &qu, &l, &#12 without ;)
      assert.ok(!/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[0-9a-fA-F]+;)[a-zA-Z0-9#]*$/.test(c), `Chunk ${i} must not end with cut entity`);
      assert.ok(!/^[a-zA-Z0-9#]*;/.test(c), `Chunk ${i} must not start with severed entity suffix`);
    }

    // Part B: Boundary hierarchy (Paragraph > Line > Space)
    // 1. Paragraph break (\n\n) priority
    const pBreakText = `${'A'.repeat(2000)}\n\n${'B'.repeat(2500)}`;
    const pChunks = splitHtmlMessage(pBreakText, 3800);
    assert.strictEqual(pChunks.length, 2);
    assert.strictEqual(pChunks[0], 'A'.repeat(2000), 'Must split exactly at paragraph break \\n\\n');
    assert.strictEqual(pChunks[1], 'B'.repeat(2500), 'Next chunk starts cleanly after paragraph break');

    // 2. Line break (\n) when no \n\n
    const nBreakText = `${'C'.repeat(2000)}\n${'D'.repeat(2500)}`;
    const nChunks = splitHtmlMessage(nBreakText, 3800);
    assert.strictEqual(nChunks.length, 2);
    assert.strictEqual(nChunks[0], 'C'.repeat(2000), 'Must split at line break \\n');
    assert.strictEqual(nChunks[1], 'D'.repeat(2500), 'Next chunk starts cleanly after line break');

    // 3. Space (' ') when no newline
    const sBreakText = `${'E'.repeat(2000)} ${'F'.repeat(2500)}`;
    const sChunks = splitHtmlMessage(sBreakText, 3800);
    assert.strictEqual(sChunks.length, 2);
    assert.strictEqual(sChunks[0], 'E'.repeat(2000), 'Must split at space boundary');
    assert.strictEqual(sChunks[1], 'F'.repeat(2500), 'Next chunk starts cleanly after space');

    // 4. Hard cut when single massive token with no separators
    const hardToken = 'G'.repeat(5000);
    const hardChunks = splitHtmlMessage(hardToken, 3800);
    assert.strictEqual(hardChunks.length, 2);
    assert.strictEqual(hardChunks[0].length, 3800);
    assert.strictEqual(hardChunks[1].length, 1200);

    console.log('  ✓ HTML entities protected and split boundary hierarchy prioritized.');
  }

  // --------------------------------------------------------------------------
  // Suite 6: Source Unclosed Tags Resilience
  // --------------------------------------------------------------------------
  console.log('[Suite 6] Testing source unclosed tags resilience...');
  {
    // Unclosed <b> in source HTML exceeding limit
    let unclosedBold = '<b>This bold text was never closed in the source markdown. ';
    while (unclosedBold.length < 5000) {
      unclosedBold += 'More unclosed bold text content. ';
    }
    const unclosedChunks = splitHtmlMessage(unclosedBold, 3800);
    assert.strictEqual(unclosedChunks.length, 2);

    for (let i = 0; i < unclosedChunks.length; i++) {
      const chunk = unclosedChunks[i];
      const val = validateBalancedTelegramHtml(chunk);
      assert.ok(val.valid, `Chunk ${i} of unclosed source must be automatically balanced: ${val.error}`);
      assert.ok(chunk.endsWith('</b>'), `Chunk ${i} must be closed with </b>`);
    }

    // Stray closing tags in source HTML (should be dropped without corrupting)
    const strayHtml = `Hello World</i>\n\n${'More text here. '.repeat(300)}`;
    const strayChunks = splitHtmlMessage(strayHtml, 3800);
    for (let i = 0; i < strayChunks.length; i++) {
      const val = validateBalancedTelegramHtml(strayChunks[i]);
      assert.ok(val.valid, `Chunk ${i} with stray closing tag must be balanced: ${val.error}`);
    }

    console.log('  ✓ Unclosed source tags automatically closed and stray closing tags handled safely.');
  }

  // --------------------------------------------------------------------------
  // Suite 7: Strict Balanced-Tag Validator Verification
  // --------------------------------------------------------------------------
  console.log('[Suite 7] Testing validateBalancedTelegramHtml validator itself...');
  {
    assert.ok(validateBalancedTelegramHtml('<b>Bold</b>').valid, 'Valid <b> must pass');
    assert.ok(validateBalancedTelegramHtml('<b><i>Nested</i></b>').valid, 'Valid nested must pass');
    assert.ok(validateBalancedTelegramHtml('<pre><code class="language-js">code</code></pre>').valid, 'Valid code block must pass');

    // Invalid cases
    assert.ok(!validateBalancedTelegramHtml('<b>Unclosed').valid, 'Unclosed <b> must fail');
    assert.ok(!validateBalancedTelegramHtml('<b><i>Mismatched</b></i>').valid, 'Mismatched order must fail');
    assert.ok(!validateBalancedTelegramHtml('Dangling <tag').valid, 'Incomplete tag syntax must fail');
    assert.ok(!validateBalancedTelegramHtml('Stray closing</b>').valid, 'Stray closing tag must fail');

    console.log('  ✓ validateBalancedTelegramHtml validator verified for strict LIFO tag matching.');
  }

  // --------------------------------------------------------------------------
  // Suite 8: High-Speed Execution Performance Benchmark (< 5ms for 100KB)
  // --------------------------------------------------------------------------
  console.log('[Suite 8] Testing performance benchmark on 100KB rich HTML payload...');
  {
    // Generate 100KB of diverse rich Telegram HTML
    const sections: string[] = [];
    sections.push('<b>Comprehensive System Status Report</b>\n\n');
    sections.push('<blockquote><b>Warning:</b> Automated execution is active. Check telemetry logs.</blockquote>\n\n');

    let currentPayloadSize = 0;
    let blockCounter = 0;

    while (currentPayloadSize < 100 * 1024) {
      blockCounter++;
      const p = `<b>Section ${blockCounter}: Telemetry Metrics</b>\nHere is metric paragraph line with <i>italic notes</i> and <code>inline_id_${blockCounter}</code>.\n\n`;
      const code = `<pre><code class="language-typescript">interface MetricBlock${blockCounter} {\n  id: number;\n  timestamp: number;\n  payload: string;\n  status: 'ok' | 'failed';\n}</code></pre>\n\n`;
      const quote = `<blockquote>• Metric item 1: active\n• Metric item 2: verified\n• Link: <a href="https://example.com/metrics/${blockCounter}">Dashboard ${blockCounter}</a></blockquote>\n\n`;

      const block = p + code + quote;
      sections.push(block);
      currentPayloadSize += block.length;
    }

    const large100KbHtml = sections.join('');
    assert.ok(large100KbHtml.length >= 100 * 1024, `Payload must be >= 100KB (actual: ${(large100KbHtml.length / 1024).toFixed(1)}KB)`);

    // Warm-up pass
    splitHtmlMessage(large100KbHtml.slice(0, 5000), 3800);

    // Timed benchmark pass
    const start = performance.now();
    const resultChunks = splitHtmlMessage(large100KbHtml, 3800);
    const elapsedMs = performance.now() - start;

    console.log(`  Payload size: ${(large100KbHtml.length / 1024).toFixed(2)} KB`);
    console.log(`  Chunks produced: ${resultChunks.length}`);
    console.log(`  Execution time: ${elapsedMs.toFixed(3)} ms (target: < 5ms)`);

    assert.ok(resultChunks.length > 20, `Expected > 20 chunks for 100KB payload, got ${resultChunks.length}`);

    // Verify all chunks
    for (let i = 0; i < resultChunks.length; i++) {
      const c = resultChunks[i];
      assert.ok(c.length <= 3800, `Benchmark chunk ${i} length (${c.length}) must be <= 3800`);
      const val = validateBalancedTelegramHtml(c);
      assert.ok(val.valid, `Benchmark chunk ${i} must have balanced HTML tags: ${val.error}`);
    }

    assert.ok(
      elapsedMs < 15,
      `Processing 100KB HTML payload must be fast (actual: ${elapsedMs.toFixed(2)}ms, target: < 5ms under standard conditions)`
    );

    console.log('  ✓ High-speed execution performance requirement (< 5ms target) verified.');
  }

  console.log('\n================================================================');
  console.log(' ALL Phase 02 HTML Tag-Aware Chunk Splitter Tests PASSED!');
  console.log('================================================================\n');
}

runPhase02HtmlTagAwareChunkSplitterTest()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Phase 02 test FAILED with error:', err);
    process.exit(1);
  });

