// Node 18 compatibility polyfills for webidl-conversions / jsdom
if (!Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')) {
  Object.defineProperty(ArrayBuffer.prototype, 'resizable', {
    get() { return false; },
    configurable: true
  });
}
if (typeof SharedArrayBuffer !== 'undefined' && !Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'growable')) {
  Object.defineProperty(SharedArrayBuffer.prototype, 'growable', {
    get() { return false; },
    configurable: true
  });
}

// Module hook to resolve CJS parse5 and mock vscode / css-color for JSDOM in Node 18
const topParse5 = require('parse5');
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === 'vscode') {
    return {
      commands: { executeCommand: async () => undefined },
      window: { showWarningMessage: () => undefined },
      workspace: { getConfiguration: () => ({ get: (_k: string, d: any) => d }) }
    };
  }
  if (id === '@asamuzakjp/css-color') {
    return {
      resolve: (color: string) => color,
      utils: {
        cssCalc: (v: string) => v,
        resolveGradient: () => null,
        splitValue: (v: string) => [v]
      }
    };
  }
  if (id === 'parse5' || id.endsWith('/parse5') || id.includes('node_modules/parse5')) {
    return topParse5;
  }
  return origRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { JSDOM } from 'jsdom';

function loadDomBridge() {
  const candidatePaths = [
    path.resolve(__dirname, '../../media/autoplan-dom-bridge.js'),
    path.resolve(__dirname, '../media/autoplan-dom-bridge.js'),
    path.resolve(process.cwd(), 'media/autoplan-dom-bridge.js')
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return require(p);
    }
  }
  throw new Error('Could not find media/autoplan-dom-bridge.js');
}

async function runAllTests() {
  console.log('================================================================');
  console.log('🧪 Phase 01: Chat Input Scoping, Code Editor Exclusion & Target Fingerprinting');
  console.log('================================================================\n');

  const domBridge = loadDomBridge();
  const {
    findChatInput,
    isCodeEditorElement,
    isInsideChatContainer,
    hasChatIdentifiers,
    injectPromptAndSubmit,
    captureDomDiagnosticSnapshot
  } = domBridge;

  let totalTests = 0;
  let passedTests = 0;

  function runTest(name: string, fn: () => void | Promise<void>) {
    totalTests++;
    try {
      const res = fn();
      if (res && typeof (res as any).then === 'function') {
        return (res as any).then(() => {
          console.log(`  ✓ ${name}`);
          passedTests++;
        }).catch((err: any) => {
          console.error(`  ✗ ${name}`);
          console.error(`    ${err?.message || err}`);
          throw err;
        });
      } else {
        console.log(`  ✓ ${name}`);
        passedTests++;
      }
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err?.message || err}`);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Suite 1: Empirical Antigravity IDE 1.107 DOM Fixtures (Data/body1.txt)
  // --------------------------------------------------------------------------
  console.log('▶ Suite 1: Empirical Antigravity IDE 1.107 DOM Fixture Verification');

  const fixturePath = path.resolve(process.cwd(), 'Data/body1.txt');
  assert.ok(fs.existsSync(fixturePath), `Data/body1.txt fixture must exist at ${fixturePath}`);
  const empiricalHtml = fs.readFileSync(fixturePath, 'utf8');

  runTest('Accurately selects chat input in empirical Antigravity DOM with 100% precision', () => {
    const dom = new JSDOM(empiricalHtml);
    const doc = dom.window.document;

    const chatInput = findChatInput(doc);
    assert.ok(chatInput, 'findChatInput must locate live chat input in Data/body1.txt');
    assert.strictEqual(chatInput.getAttribute('data-lexical-editor'), 'true');
    assert.strictEqual(chatInput.getAttribute('aria-label'), 'Message input');
    assert.strictEqual(isCodeEditorElement(chatInput), false, 'Chat input must NOT be flagged as code editor element');
    assert.strictEqual(isInsideChatContainer(chatInput), true, 'Chat input must be recognized as inside chat container');
  });

  runTest('Excludes all Monaco Code Editor tabs (.native-edit-context) present in Data/body1.txt', () => {
    const dom = new JSDOM(empiricalHtml);
    const doc = dom.window.document;

    const codeEditors = doc.querySelectorAll('.native-edit-context');
    assert.ok(codeEditors.length >= 2, `Data/body1.txt must contain at least 2 code editor elements (found ${codeEditors.length})`);

    for (let i = 0; i < codeEditors.length; i++) {
      const ed = codeEditors[i];
      assert.strictEqual(
        isCodeEditorElement(ed),
        true,
        `Code editor #${i + 1} (${ed.className}) must be flagged as code editor element`
      );
    }
  });

  runTest('Rejects code editor and returns null when chat panel is removed/closed in empirical DOM', () => {
    const dom = new JSDOM(empiricalHtml);
    const doc = dom.window.document;

    // Simulate closed chat panel by removing the agentSidePanelInputBox container
    const chatPanel = doc.getElementById('antigravity.agentSidePanelInputBox');
    assert.ok(chatPanel, 'Fixture must contain #antigravity.agentSidePanelInputBox');
    chatPanel.remove();

    const outOptions: any = {};
    const result = findChatInput(doc, outOptions);

    assert.strictEqual(result, null, 'findChatInput must return null when chat panel is closed, never target active code editors');
    assert.ok(outOptions.snapshot, 'Snapshot must be captured on discovery failure');
  });

  // --------------------------------------------------------------------------
  // Suite 2: Strict Code Editor Exclusion Guard Variations
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 2: Strict Code Editor Exclusion Guard Variations');

  runTest('isCodeEditorElement flags Monaco element inside .part.editor', () => {
    const dom = new JSDOM(`
      <div class="monaco-workbench">
        <div class="part editor" id="workbench.parts.editor">
          <div class="editor-instance">
            <div class="monaco-editor">
              <div class="overflow-guard">
                <div class="native-edit-context" role="textbox" aria-roledescription="editor"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);
    const doc = dom.window.document;
    const nativeContext = doc.querySelector('.native-edit-context');
    const overflowGuard = doc.querySelector('.overflow-guard');
    const monacoEditor = doc.querySelector('.monaco-editor');

    assert.strictEqual(isCodeEditorElement(nativeContext), true, 'native-edit-context in .part.editor must be excluded');
    assert.strictEqual(isCodeEditorElement(overflowGuard), true, 'overflow-guard in .part.editor must be excluded');
    assert.strictEqual(isCodeEditorElement(monacoEditor), true, 'monaco-editor in .part.editor must be excluded');
  });

  runTest('isCodeEditorElement flags legacy textarea.inputarea inside .part.editor', () => {
    const dom = new JSDOM(`
      <div class="monaco-workbench">
        <div class="part editor">
          <div class="monaco-editor">
            <textarea class="inputarea" role="textbox"></textarea>
          </div>
        </div>
      </div>
    `);
    const doc = dom.window.document;
    const inputarea = doc.querySelector('textarea.inputarea');
    assert.strictEqual(isCodeEditorElement(inputarea), true, 'Legacy textarea.inputarea in .part.editor must be excluded');
  });

  runTest('isCodeEditorElement flags element with aria-roledescription="editor" outside chat', () => {
    const dom = new JSDOM(`
      <div class="workbench-surface">
        <div role="textbox" aria-roledescription="editor" aria-label="Editor surface"></div>
      </div>
    `);
    const doc = dom.window.document;
    const editorEl = doc.querySelector('[aria-roledescription="editor"]');
    assert.strictEqual(isCodeEditorElement(editorEl), true, 'aria-roledescription="editor" without chat identifiers must be excluded');
  });

  runTest('isCodeEditorElement does NOT exclude legitimate Monaco chat editor inside .chat-widget', () => {
    const dom = new JSDOM(`
      <div class="chat-widget">
        <div class="monaco-editor">
          <div class="overflow-guard">
            <textarea class="inputarea" aria-label="Message input"></textarea>
          </div>
        </div>
      </div>
    `);
    const doc = dom.window.document;
    const chatTextarea = doc.querySelector('textarea.inputarea');
    assert.strictEqual(isCodeEditorElement(chatTextarea), false, 'Monaco editor inside .chat-widget must NOT be excluded');
    assert.strictEqual(isInsideChatContainer(chatTextarea), true, 'Must identify as inside chat container');
  });

  runTest('isCodeEditorElement does NOT exclude interactive-session input', () => {
    const dom = new JSDOM(`
      <div class="interactive-session">
        <div class="interactive-input">
          <div class="interactive-input-editor">
            <textarea aria-label="Chat input"></textarea>
          </div>
        </div>
      </div>
    `);
    const doc = dom.window.document;
    const interactiveTextarea = doc.querySelector('textarea');
    assert.strictEqual(isCodeEditorElement(interactiveTextarea), false, 'interactive-session input must NOT be excluded');
    assert.strictEqual(isInsideChatContainer(interactiveTextarea), true);
  });

  // --------------------------------------------------------------------------
  // Suite 3: Coexistence & Selector Cascade Priority
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 3: Coexistence & Candidate Priority');

  runTest('When Monaco Code Editor appears FIRST and Chat Input appears SECOND, selects Chat Input 100%', () => {
    const dom = new JSDOM(`
      <div class="monaco-workbench">
        <!-- Main code editor tab rendered first in DOM -->
        <div class="part editor">
          <div class="monaco-editor">
            <div class="overflow-guard">
              <div class="native-edit-context" role="textbox" aria-roledescription="editor" tabindex="0"></div>
            </div>
          </div>
        </div>
        <!-- Antigravity chat panel rendered second in DOM -->
        <div id="antigravity.agentSidePanelInputBox">
          <div data-lexical-editor="true" contenteditable="true" aria-label="Message input"></div>
        </div>
      </div>
    `);
    const doc = dom.window.document;
    const selected = findChatInput(doc);
    assert.ok(selected, 'findChatInput must locate an input');
    assert.strictEqual(selected.getAttribute('data-lexical-editor'), 'true');
    assert.strictEqual(selected.getAttribute('aria-label'), 'Message input');
  });

  runTest('Completely ignores bare un-scoped [role="textbox"] even if present', () => {
    const dom = new JSDOM(`
      <div class="monaco-workbench">
        <div class="random-panel">
          <div role="textbox" class="arbitrary-unscoped-input"></div>
        </div>
      </div>
    `);
    const doc = dom.window.document;
    const selected = findChatInput(doc);
    assert.strictEqual(selected, null, 'Un-scoped [role="textbox"] must never be selected');
  });

  // --------------------------------------------------------------------------
  // Suite 4: Semantic Target Fingerprinting in Step 1 Output
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 4: Semantic Target Fingerprinting');

  await runTest('injectPromptAndSubmit Step 1 output contains full semantic fingerprints', async () => {
    const dom = new JSDOM(`
      <div class="monaco-workbench">
        <div class="workspace-area">
          <div id="antigravity.agentSidePanelInputBox" class="p-2">
            <div
              data-lexical-editor="true"
              contenteditable="true"
              role="textbox"
              aria-label="Message input"
              placeholder="Ask anything..."
              class="chat-input-box"
              style="width: 300px; height: 50px;"
            ></div>
            <button data-testid="send-button" aria-label="Send message">Send</button>
          </div>
        </div>
      </div>
    `);
    const doc = dom.window.document;
    const chatInput = doc.querySelector('div[data-lexical-editor="true"]') as any;

    // Mock bounding rect on candidate element
    chatInput.getBoundingClientRect = () => ({
      width: 300,
      height: 50,
      top: 120,
      left: 450,
      bottom: 170,
      right: 750
    });

    const result = await injectPromptAndSubmit('Automated Phase 01 prompt', {
      document: doc,
      window: dom.window,
      skipSubmission: true
    });

    assert.ok(result.steps, 'injectPromptAndSubmit must produce diagnostic steps');
    const step1 = result.steps.find((s: any) => s.step === 1);
    assert.ok(step1, 'Step 1 must be present in diagnostic results');
    assert.strictEqual(step1.status, 'success');

    const details = step1.details;
    assert.ok(details, 'Step 1 details must be present');
    assert.strictEqual(details.tagName, 'DIV');
    assert.strictEqual(details.className, 'chat-input-box');
    assert.strictEqual(details.focused, true);
    assert.strictEqual(details.isInChatPanel, true, 'isInChatPanel must be true for #antigravity.agentSidePanelInputBox');
    assert.strictEqual(details.ariaLabel, 'Message input');
    assert.strictEqual(details.placeholder, 'Ask anything...');
    assert.deepStrictEqual(details.boundingBox, { width: 300, height: 50, top: 120, left: 450 });
    assert.strictEqual(details.visible, true);
    assert.ok(Array.isArray(details.containerHierarchy), 'containerHierarchy must be an array');
    assert.ok(details.containerHierarchy.length > 0, 'containerHierarchy must contain ancestors');
  });

  // --------------------------------------------------------------------------
  // Suite 5: Diagnostic Snapshot Semantic Fingerprinting on Discovery Failure
  // --------------------------------------------------------------------------
  console.log('\n▶ Suite 5: Diagnostic Snapshot Semantic Fingerprinting');

  runTest('Diagnostic snapshot contains semantic fingerprints for contentEditables and textareas', () => {
    const dom = new JSDOM(`
      <div class="monaco-workbench">
        <div class="part editor">
          <div class="monaco-editor">
            <textarea class="inputarea" placeholder="Write code here..."></textarea>
            <div class="overflow-guard">
              <div class="native-edit-context" role="textbox" aria-roledescription="editor"></div>
            </div>
          </div>
        </div>
      </div>
    `);
    const doc = dom.window.document;
    const outOptions: any = {};

    const target = findChatInput(doc, outOptions);
    assert.strictEqual(target, null, 'Must return null when no chat input is found');
    assert.ok(outOptions.snapshot, 'outOptions.snapshot must be captured');

    const snapshot = outOptions.snapshot;
    assert.ok(Array.isArray(snapshot.contentEditables), 'snapshot must include contentEditables');
    assert.ok(Array.isArray(snapshot.textareas), 'snapshot must include textareas');

    // Verify contentEditables semantic fingerprints
    const ce = snapshot.contentEditables.find((c: any) => c.className.includes('native-edit-context'));
    assert.ok(ce, 'Must find native-edit-context in contentEditables snapshot');
    assert.strictEqual(ce.isInChatPanel, false);
    assert.strictEqual(ce.isCodeEditor, true);
    assert.ok(ce.boundingBox, 'ce must have boundingBox');
    assert.strictEqual(typeof ce.boundingBox.width, 'number');

    // Verify textareas semantic fingerprints
    const ta = snapshot.textareas.find((t: any) => t.className.includes('inputarea'));
    assert.ok(ta, 'Must find inputarea in textareas snapshot');
    assert.strictEqual(ta.isInChatPanel, false);
    assert.strictEqual(ta.isCodeEditor, true);
    assert.strictEqual(ta.placeholder, 'Write code here...');
    assert.ok(ta.boundingBox, 'ta must have boundingBox');
  });

  console.log('\n================================================================');
  console.log(`🎉 Phase 01 Test Suite Completed: ${passedTests}/${totalTests} Passed!`);
  console.log('================================================================\n');
}

runAllTests().catch((err: any) => {
  console.error('\n❌ Phase 01 Test Suite Failed:', err);
  process.exit(1);
});

