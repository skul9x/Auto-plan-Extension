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

let mockActiveTextEditor: any = undefined;
let mockWorkspaceFolders: any[] = [
  {
    uri: {
      fsPath: '/home/skul9x/Desktop/Code/Auto-plan-Extension-main',
      toString: () => 'file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main'
    },
    name: 'Auto-plan-Extension-main',
    index: 0
  }
];

let mockExecuteCommandCalls: Array<{ command: string; args: any[] }> = [];
let mockShowErrorMessageHandler: any = null;

Module.prototype.require = function (id: string) {
  if (id === 'vscode') {
    return {
      commands: {
        executeCommand: async (cmd: string, ...args: any[]) => {
          mockExecuteCommandCalls.push({ command: cmd, args });
          return undefined;
        }
      },
      window: {
        get activeTextEditor() {
          return mockActiveTextEditor;
        },
        createOutputChannel: (name: string) => ({
          name,
          append: () => {},
          appendLine: () => {},
          clear: () => {},
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        createStatusBarItem: () => ({
          text: '',
          tooltip: '',
          command: '',
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        showInformationMessage: async (msg: string) => msg,
        showWarningMessage: async (msg: string) => msg,
        showErrorMessage: async (msg: string, ...actions: string[]) => {
          if (mockShowErrorMessageHandler) {
            return mockShowErrorMessageHandler(msg, ...actions);
          }
          return actions[0];
        }
      },
      workspace: {
        get workspaceFolders() {
          return mockWorkspaceFolders;
        },
        getConfiguration: () => ({
          get: (_k: string, d: any) => d,
          update: async () => {}
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} })
      },
      Uri: {
        file: (p: string) => ({ fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` }),
        joinPath: (base: any, ...segments: string[]) => ({
          fsPath: [base.fsPath || base.path, ...segments].join('/'),
          toString: () => `file://${[base.fsPath || base.path, ...segments].join('/')}`
        })
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 },
      StatusBarAlignment: { Left: 1, Right: 2 }
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
const yauzl = require('yauzl');
import { PromptDispatcher } from '../promptDispatcher';
import { BridgeServer } from '../bridgeServer';
import { DebugLogger } from '../debugLogger';
import { AutoPlanConfig } from '../config';

const rootDir = path.resolve(__dirname, '../../');

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

const mockConfigProvider = (overrides?: Partial<AutoPlanConfig>): (() => AutoPlanConfig) => () => ({
  executionMode: 'auto',
  bridgeTimeoutMs: 5000,
  allowTierFallback: true,
  strictMode: false,
  focusDelayMs: 50,
  enableDiagnosticTrace: false,
  suppressFallbackWarnings: true,
  ...(overrides || {})
} as any);

/**
 * Deep-audit entries and manifest inside a .vsix zip archive.
 */
async function auditVsixArchive(vsixFilePath: string): Promise<{
  totalFiles: number;
  files: string[];
  packageJson: any;
  leakedSecretFindings: Array<{ file: string; match: string }>;
}> {
  return new Promise((resolve, reject) => {
    yauzl.open(vsixFilePath, { lazyEntries: true }, (err: any, zipfile: any) => {
      if (err) return reject(err);

      const report = {
        totalFiles: 0,
        files: [] as string[],
        packageJson: null as any,
        leakedSecretFindings: [] as Array<{ file: string; match: string }>
      };

      const auditRegex = /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g;

      zipfile.on('entry', (entry: any) => {
        report.totalFiles++;
        report.files.push(entry.fileName);

        if (entry.fileName === 'extension/package.json') {
          zipfile.openReadStream(entry, (sErr: any, stream: any) => {
            if (sErr) return reject(sErr);
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => {
              try {
                report.packageJson = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              } catch (parseErr) {
                return reject(parseErr);
              }
              zipfile.readEntry();
            });
          });
        } else if (
          entry.fileName.endsWith('.js') ||
          entry.fileName.endsWith('.json') ||
          entry.fileName.endsWith('.md')
        ) {
          zipfile.openReadStream(entry, (sErr: any, stream: any) => {
            if (sErr) return reject(sErr);
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              const matches = text.match(auditRegex);
              if (matches) {
                matches.forEach((m) => {
                  report.leakedSecretFindings.push({ file: entry.fileName, match: m });
                });
              }
              zipfile.readEntry();
            });
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => {
        resolve(report);
      });

      zipfile.on('error', (zErr: any) => {
        reject(zErr);
      });

      zipfile.readEntry();
    });
  });
}

async function runPhase05FullRegressionTestSuite() {
  console.log('================================================================================');
  console.log(' 🧪 PHASE 05: FULL DOM BRIDGE REGRESSION, PACKAGING & RELEASE VERIFICATION (v1.7.1)');
  console.log('================================================================================\n');

  let totalTests = 0;
  let passedTests = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passedTests++;
    } catch (err: any) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err?.message || err}`);
      throw err;
    }
  }

  const domBridge = loadDomBridge();
  const {
    findChatInput,
    isCodeEditorElement,
    extractDomBufferText,
    verifyBufferHasText,
    isInputClearedOrSubmitted,
    verifyInputSubmission,
    findCancelButton,
    injectPromptAndSubmit
  } = domBridge;

  try {
    // --------------------------------------------------------------------------
    // SUITE 1: Version Alignment & Documentation
    // --------------------------------------------------------------------------
    console.log('▶ Suite 1: Manifest, Documentation & Package Version Integrity (v1.7.1)');

    await test('package.json version is bumped to 1.7.1 with correct metadata and scripts', () => {
      const packageJsonPath = path.join(rootDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      assert.strictEqual(pkg.version, '1.7.1', 'package.json version must be 1.7.1');
      assert.strictEqual(pkg.name, 'antigravity-auto-plan', 'Extension name must be antigravity-auto-plan');
      assert.ok(pkg.scripts?.['test:phase05-dom-bridge'], 'Must register test:phase05-dom-bridge in scripts');
    });

    await test('README.md contains v1.7.1 badge, release archive reference and feature highlights', () => {
      const readmePath = path.join(rootDir, 'README.md');
      const readme = fs.readFileSync(readmePath, 'utf8');

      assert.ok(readme.includes('version-1.7.1'), 'README.md must display version 1.7.1 badge');
      assert.ok(readme.includes('antigravity-auto-plan-1.7.1.vsix'), 'README.md must reference antigravity-auto-plan-1.7.1.vsix');
      assert.ok(readme.includes('Hardened chat input discovery with Code Editor tab exclusion') ||
                readme.includes('Container-Scoped Chat Input Discovery'), 'Must document chat input discovery hardening');
      assert.ok(readme.includes('Two-Phase Buffer Verification'), 'Must document Two-Phase Buffer Verification');
      assert.ok(readme.includes('Elimination of False Positive Proof 1') ||
                readme.includes('Proof-1 State Transition Hardening'), 'Must document Proof 1 false-positive elimination');
      assert.ok(readme.includes('Enhanced semantic telemetry') ||
                readme.includes('Enhanced Semantic Telemetry & Diagnostics'), 'Must document enhanced telemetry');
    });

    await test('CHANGELOG.md contains comprehensive entry for ## [1.7.1]', () => {
      const changelogPath = path.join(rootDir, 'CHANGELOG.md');
      const changelog = fs.readFileSync(changelogPath, 'utf8');

      assert.ok(changelog.includes('## [1.7.1]'), 'CHANGELOG.md must contain entry for ## [1.7.1]');
      assert.ok(changelog.includes('Hardened DOM Bridge') || changelog.includes('Two-Phase Verification'), 'Must document DOM bridge hardening');
      assert.ok(changelog.includes('isCodeEditorElement') || changelog.includes('Monaco Code Editor'), 'Must document code editor exclusion');
      assert.ok(changelog.includes('PASTE_VERIFICATION_FAILED') || changelog.includes('verifyBufferHasText'), 'Must document post-paste buffer verification');
      assert.ok(changelog.includes('hasConfirmedContentBeforeSubmit') || changelog.includes('Proof 1'), 'Must document proof 1 transition hardening');
    });

    console.log('  ✓ Suite 1 verified.\n');

    // --------------------------------------------------------------------------
    // SUITE 2: Hardened Chat Input Discovery & Monaco Exclusion (Phase 01)
    // --------------------------------------------------------------------------
    console.log('▶ Suite 2: Hardened Chat Input Discovery & Monaco Code Editor Exclusion');

    await test('Prioritizes Antigravity Agent chat input over Monaco Code Editor active tabs', () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <!-- Main Workbench Code Editor Tab (Must be ignored) -->
            <div class="monaco-workbench">
              <div class="part editor">
                <div class="monaco-editor">
                  <div class="overflow-guard">
                    <div class="native-edit-context" role="textbox" contenteditable="true">
                      const activeCodeFile = true;
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Antigravity Chat Panel (Target) -->
            <div id="antigravity.agentSidePanelInputBox">
              <div data-lexical-editor="true" contenteditable="true" role="textbox" aria-label="Message input">
                <p><br></p>
              </div>
            </div>
          </body>
        </html>
      `);

      const target = findChatInput(dom.window.document);
      assert.ok(target, 'Must locate chat input element');
      assert.strictEqual(target.getAttribute('data-lexical-editor'), 'true', 'Must match chat input');
      assert.strictEqual(target.classList.contains('native-edit-context'), false, 'Must never target code editor');
    });

    await test('Returns null and rejects Monaco Code Editor when chat panel is absent or closed', () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <!-- Main Workbench Code Editor Tab only -->
            <div class="monaco-workbench">
              <div class="part editor">
                <div class="monaco-editor">
                  <div class="native-edit-context" role="textbox" contenteditable="true">
                    const activeCodeFile = true;
                  </div>
                </div>
              </div>
            </div>
          </body>
        </html>
      `);

      const target = findChatInput(dom.window.document);
      assert.strictEqual(target, null, 'Must return null and reject code editor element');
    });

    await test('isCodeEditorElement correctly detects editor elements and ignores chat elements', () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div class="monaco-workbench">
              <div class="part editor">
                <div id="code-el" class="native-edit-context"></div>
              </div>
            </div>
            <div id="antigravity.agentSidePanelInputBox">
              <div id="chat-el" data-lexical-editor="true" contenteditable="true"></div>
            </div>
          </body>
        </html>
      `);

      const doc = dom.window.document;
      const codeEl = doc.getElementById('code-el');
      const chatEl = doc.getElementById('chat-el');

      assert.strictEqual(isCodeEditorElement(codeEl), true, 'code-el must be identified as code editor element');
      assert.strictEqual(isCodeEditorElement(chatEl), false, 'chat-el must NOT be identified as code editor element');
    });

    console.log('  ✓ Suite 2 verified.\n');

    // --------------------------------------------------------------------------
    // SUITE 3: Two-Phase Buffer Verification & Fail-Fast Rejection Engine (Phase 02)
    // --------------------------------------------------------------------------
    console.log('▶ Suite 3: Two-Phase Buffer Verification & Fail-Fast Rejection Engine');

    await test('extractDomBufferText extracts clean content across textarea, contenteditable, and lexical elements', () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <textarea id="ta">Hello\r\nWorld</textarea>
            <div id="ce" contenteditable="true">Hello \u200BWorld</div>
            <div id="lex" data-lexical-editor="true"><p>Paragraph 1</p><p>Paragraph 2</p></div>
          </body>
        </html>
      `);

      const doc = dom.window.document;
      const ta = doc.getElementById('ta');
      const ce = doc.getElementById('ce');
      const lex = doc.getElementById('lex');

      const taRes = extractDomBufferText(ta, { window: dom.window, document: doc });
      assert.strictEqual(taRes.cleanText, 'Hello\nWorld');
      assert.strictEqual(taRes.pathway, 'input-value');

      const ceRes = extractDomBufferText(ce, { window: dom.window, document: doc });
      assert.strictEqual(ceRes.cleanText, 'Hello World');

      const lexRes = extractDomBufferText(lex, { window: dom.window, document: doc });
      assert.ok(lexRes.cleanText.includes('Paragraph 1') && lexRes.cleanText.includes('Paragraph 2'));
      assert.ok(lexRes.charsDetectedInDOM > 0);
    });

    await test('verifyBufferHasText accurately validates buffer matching and rejects empty/insufficient content', () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div id="populated" contenteditable="true">Run all regression test suites across the extension.</div>
            <div id="empty" contenteditable="true">\u200B</div>
          </body>
        </html>
      `);

      const doc = dom.window.document;
      const populated = doc.getElementById('populated');
      const empty = doc.getElementById('empty');

      const promptText = 'Run all regression test suites across the extension.';
      const diagPopulated: any = {};
      const resPopulated = verifyBufferHasText(populated, promptText, { diagnostics: diagPopulated });
      assert.strictEqual(resPopulated, true);
      assert.strictEqual(diagPopulated.verified, true);
      assert.strictEqual(diagPopulated.charsDetectedInDOM, promptText.length);

      const diagEmpty: any = {};
      const resEmpty = verifyBufferHasText(empty, promptText, { diagnostics: diagEmpty });
      assert.strictEqual(resEmpty, false);
      assert.strictEqual(diagEmpty.verified, false);
      assert.strictEqual(diagEmpty.charsDetectedInDOM, 0);
      assert.strictEqual(diagEmpty.rejectionReason, 'dom_buffer_empty');
    });

    await test('injectPromptAndSubmit rejects immediately with PASTE_VERIFICATION_FAILED when injection fails', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div id="antigravity.agentSidePanelInputBox">
              <div id="chat-input" data-lexical-editor="true" contenteditable="true" aria-label="Message input"></div>
              <button data-testid="send-button" aria-label="Send message">Send</button>
            </div>
          </body>
        </html>
      `);

      const doc = dom.window.document;
      const win = dom.window as any;
      const chatInput = doc.getElementById('chat-input');
      assert.ok(chatInput);

      let submitAttempted = false;
      chatInput.addEventListener('keydown', (e: any) => {
        if (e.key === 'Enter') submitAttempted = true;
      });

      // Make element non-responsive
      Object.defineProperty(chatInput, 'innerText', {
        get() { return ''; },
        set(_v) {},
        configurable: true
      });
      Object.defineProperty(chatInput, 'textContent', {
        get() { return ''; },
        set(_v) {},
        configurable: true
      });

      let caughtErr: any = null;
      try {
        await injectPromptAndSubmit('Please implement regression test', {
          document: doc,
          window: win,
          targetElement: chatInput
        });
      } catch (err: any) {
        caughtErr = err;
      }

      assert.ok(caughtErr, 'Must throw error when buffer fails verification');
      assert.strictEqual(caughtErr.code, 'PASTE_VERIFICATION_FAILED');
      assert.strictEqual(caughtErr.charsDetectedInDOM, 0);
      assert.strictEqual(submitAttempted, false, 'Submit must never be attempted when paste verification fails');
    });

    console.log('  ✓ Suite 3 verified.\n');

    // --------------------------------------------------------------------------
    // SUITE 4: Submission Proof Transition Hardening & Proof-1 Elimination (Phase 03)
    // --------------------------------------------------------------------------
    console.log('▶ Suite 4: Submission Proof Transition Hardening & False-Positive Proof 1 Elimination');

    await test('isInputClearedOrSubmitted rejects empty input when hasConfirmedContentBeforeSubmit is false', () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div id="input" contenteditable="true"></div>
          </body>
        </html>
      `);

      const input = dom.window.document.getElementById('input');
      const prompt = 'Test Prompt Content';

      // Proof 1 should be FALSE because it was never confirmed populated prior to submission
      const cleared = isInputClearedOrSubmitted(input, prompt, { hasConfirmedContentBeforeSubmit: false });
      assert.strictEqual(cleared, false, 'Initially empty input without prior confirmed content must NOT return cleared');
    });

    await test('isInputClearedOrSubmitted declares clearance only after transitioning from populated to cleared', () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <div id="input" contenteditable="true"></div>
          </body>
        </html>
      `);

      const input = dom.window.document.getElementById('input');
      const prompt = 'Test Prompt Content';

      // When confirmed prior content was present, now empty input correctly signals clearance
      const cleared = isInputClearedOrSubmitted(input, prompt, { hasConfirmedContentBeforeSubmit: true });
      assert.strictEqual(cleared, true, 'Confirmed populated input that transitioned to empty must return true');
    });

    await test('verifyInputSubmission confirms Proof 1 clearance duration and eliminates instant 0ms proof', async () => {
      const dom = new JSDOM(`
        <!DOCTYPE html>
        <html>
          <body>
            <textarea id="input">Existing prompt in buffer</textarea>
          </body>
        </html>
      `);

      const input = dom.window.document.getElementById('input') as HTMLTextAreaElement;
      const prompt = 'Existing prompt in buffer';

      // Simulate input that was verified populated (e.g. prompt.length chars) and cleared upon submit
      input.value = '';
      const verification = await verifyInputSubmission(input, prompt, {
        document: dom.window.document,
        window: dom.window,
        hasConfirmedContentBeforeSubmit: true,
        charsDetectedInDOM: prompt.length,
        observationTimeoutMs: 100,
        pollIntervalMs: 15
      });

      assert.strictEqual(verification.verified, true);
      assert.strictEqual(verification.proof, 'proof1_input_clearance');
      assert.ok(verification.durationMs >= 1, `Proof 1 durationMs (${verification.durationMs}ms) must be >= 1, NEVER 0ms`);
    });

    console.log('  ✓ Suite 4 verified.\n');

    // --------------------------------------------------------------------------
    // SUITE 5: Dispatcher Telemetry & Diagnostic Report Integration (Phase 04)
    // --------------------------------------------------------------------------
    console.log('▶ Suite 5: Dispatcher Telemetry & Diagnostic Report Integration');

    await test('PromptDispatcher parses client ACK with Step 1 and Step 2 telemetry and records metrics', async () => {
      const logger = new DebugLogger();
      let capturedDispatcherLog = '';
      logger.onLog((entry: any) => {
        if (entry.component === 'DISPATCHER') {
          capturedDispatcherLog += entry.message + '\n';
        }
      });

      const mockBridgeServer = {
        isListening: () => true,
        getConnectedClients: () => [{ windowKey: 'win_1', lastSeenAt: Date.now() }],
        getActiveWindowKey: () => 'win_1',
        getWindowKey: () => 'win_1',
        getWorkspaceName: () => 'test-workspace',
        dispatchPromptCommand: async () => ({
          success: true,
          commandId: 'cmd_phase05',
          status: 'submitClicked',
          durationMs: 35,
          metadata: {
            steps: [
              {
                step: 1,
                name: 'Input discovery & focus',
                status: 'success',
                elementContext: '#antigravity.agentSidePanelInputBox',
                details: {
                  tagName: 'DIV',
                  isInChatPanel: true,
                  containerHierarchy: ['#antigravity.agentSidePanelInputBox']
                }
              },
              {
                step: 2,
                name: 'Content injection',
                status: 'success',
                charsExpected: 2500,
                charsDetectedInDOM: 2500,
                strategy: 'contenteditable-text',
                verified: true
              }
            ]
          }
        })
      } as any;

      const dispatcher = new PromptDispatcher({
        bridgeServer: mockBridgeServer,
        logger,
        configProvider: mockConfigProvider()
      });

      const promptText = 'B'.repeat(2500);
      const result = await dispatcher.dispatchTier1(promptText);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tier, 'domBridge');
      assert.strictEqual(result.charsExpected, 2500);
      assert.strictEqual(result.charsDetectedInDOM, 2500);
      assert.ok(capturedDispatcherLog.includes('Prompt paste verified: 2500/2500 chars'));
    });

    await test('DebugLogger surfaces DOM bridge injection health in diagnostic reports', () => {
      const logger = new DebugLogger();

      logger.recordInjectionTelemetry({
        status: 'verified',
        charsExpected: 1800,
        charsDetectedInDOM: 1800,
        charsInjected: 1800,
        elementContext: '#antigravity.agentSidePanelInputBox',
        strategy: 'contenteditable-text',
        verified: true
      });

      const report = logger.generateDiagnosticReport();
      assert.ok(report.includes('DOM Bridge Injection Health'), 'Report must include injection health section');
      assert.ok(report.includes('1800 chars injected') || report.includes('1800'), 'Report must display character counts');
      assert.ok(report.includes('#antigravity.agentSidePanelInputBox'), 'Report must display target container');
    });

    await test('Actionable notification triggers on PASTE_VERIFICATION_FAILED offering Open Chat Panel', async () => {
      let notifiedMessage = '';
      let offeredButton = '';
      let actionExecuted = false;

      mockExecuteCommandCalls = [];

      const logger = new DebugLogger();
      const mockBridgeServer = {
        isListening: () => true,
        getConnectedClients: () => [{ windowKey: 'win_1', lastSeenAt: Date.now() }],
        getActiveWindowKey: () => 'win_1',
        getWindowKey: () => 'win_1',
        getWorkspaceName: () => 'test-workspace',
        dispatchPromptCommand: async () => {
          const err: any = new Error('PASTE_VERIFICATION_FAILED: Prompt text failed to materialize in target DOM buffer (expected 2500 chars, detected 0 in DOM)');
          err.code = 'PASTE_VERIFICATION_FAILED';
          err.charsExpected = 2500;
          err.charsDetectedInDOM = 0;
          err.elementContext = '#antigravity.agentSidePanelInputBox';
          err.steps = [
            { step: 1, name: 'Input discovery & focus', status: 'success', elementContext: '#antigravity.agentSidePanelInputBox' },
            { step: 2, name: 'Content injection', status: 'failed', code: 'PASTE_VERIFICATION_FAILED', charsExpected: 2500, charsDetectedInDOM: 0 }
          ];
          throw err;
        }
      } as any;

      const dispatcher = new PromptDispatcher({
        bridgeServer: mockBridgeServer,
        logger,
        configProvider: mockConfigProvider({ allowTierFallback: false }),
        actionableNotifier: async (msg, btn, onAction) => {
          notifiedMessage = msg;
          offeredButton = btn;
          await onAction();
          actionExecuted = true;
        }
      });

      let caughtErr: any;
      try {
        await dispatcher.dispatchTier1('Test prompt content');
      } catch (err) {
        caughtErr = err;
      }

      assert.ok(caughtErr, 'Must throw error on failed injection');
      assert.strictEqual(caughtErr.code, 'PASTE_VERIFICATION_FAILED');
      assert.ok(notifiedMessage.includes('Khung chat Antigravity đang đóng hoặc không nhận prompt') ||
                notifiedMessage.includes('không nhận prompt'), 'Notification message must describe chat issue');
      assert.strictEqual(offeredButton, 'Open Chat Panel', 'Must offer actionable "Open Chat Panel" button');
      assert.strictEqual(actionExecuted, true, 'Clicking action button must execute action callback');
      assert.ok(
        mockExecuteCommandCalls.some(c => c.command === 'workbench.action.chat.open' || c.command === 'antigravity.prioritized.chat.open'),
        'Action must trigger workbench.action.chat.open command'
      );
    });

    console.log('  ✓ Suite 5 verified.\n');

    // --------------------------------------------------------------------------
    // SUITE 6: Production Packaging & Release Artifact Integrity
    // --------------------------------------------------------------------------
    console.log('▶ Suite 6: Production Packaging & VSIX Release Archive Integrity (v1.7.1)');

    const vsixPath = path.join(rootDir, 'antigravity-auto-plan-1.7.1.vsix');
    assert.ok(fs.existsSync(vsixPath), `VSIX release artifact must exist at: ${vsixPath}`);

    const vsixStats = fs.statSync(vsixPath);
    console.log(`     Release VSIX size: ${(vsixStats.size / (1024 * 1024)).toFixed(2)} MB (${vsixStats.size} bytes)`);

    await test('VSIX package size is within release limits (> 500 KB and < 25 MB)', () => {
      assert.ok(vsixStats.size > 500 * 1024, `VSIX size must be > 500 KB (actual: ${vsixStats.size} bytes)`);
      assert.ok(vsixStats.size < 25 * 1024 * 1024, `VSIX size must be < 25 MB (actual: ${vsixStats.size} bytes)`);
    });

    await test('VSIX file possesses valid zip magic header (PK\\x03\\x04)', () => {
      const fd = fs.openSync(vsixPath, 'r');
      const magicBuf = Buffer.alloc(4);
      fs.readSync(fd, magicBuf, 0, 4, 0);
      fs.closeSync(fd);
      assert.strictEqual(
        magicBuf.toString('hex'),
        '504b0304',
        'VSIX file must possess valid zip magic header (PK\\x03\\x04)'
      );
    });

    await test('VSIX zip archive deep audit passes with version 1.7.1 and all critical files bundled', async () => {
      const vsixAudit = await auditVsixArchive(vsixPath);
      console.log(`     Total files packaged in VSIX: ${vsixAudit.totalFiles}`);
      assert.ok(vsixAudit.totalFiles > 100, `Expected > 100 packaged files, found ${vsixAudit.totalFiles}`);

      // Verify packaged manifest version
      assert.ok(vsixAudit.packageJson, 'Packaged extension/package.json must be readable');
      assert.strictEqual(
        vsixAudit.packageJson.version,
        '1.7.1',
        `Packaged extension version must be 1.7.1 (got ${vsixAudit.packageJson?.version})`
      );
      assert.strictEqual(
        vsixAudit.packageJson.name,
        'antigravity-auto-plan',
        'Packaged extension name must match antigravity-auto-plan'
      );

      // Verify critical runtime files are bundled
      const criticalPackageFiles = [
        'extension/package.json',
        'extension/CHANGELOG.md',
        'extension/README.md',
        'extension/out/extension.js',
        'extension/out/promptDispatcher.js',
        'extension/out/bridgeServer.js',
        'extension/out/debugLogger.js',
        'extension/out/settingsProvider.js',
        'extension/out/antigravityRpcAutoSubmit.js',
        'extension/media/autoplan-dom-bridge.js',
        'extension/media/settings/settings.html',
        'extension/media/settings/settings.css',
        'extension/media/settings/settings.js'
      ];

      for (const critFile of criticalPackageFiles) {
        assert.ok(
          vsixAudit.files.includes(critFile),
          `Critical file '${critFile}' must be packaged inside VSIX`
        );
      }

      // Verify production dependency (grammy) is bundled
      const hasGrammy = vsixAudit.files.some((f) => f.startsWith('extension/node_modules/grammy/'));
      assert.ok(hasGrammy, 'Production dependency grammy must be bundled in VSIX node_modules');

      // Verify zero leaked credentials/tokens
      if (vsixAudit.leakedSecretFindings.length > 0) {
        console.error('Leaked secret findings detected in VSIX:', vsixAudit.leakedSecretFindings);
        assert.fail(`Detected ${vsixAudit.leakedSecretFindings.length} leaked credential findings in VSIX`);
      }
    });

    console.log('  ✓ Suite 6 verified.\n');

    console.log('================================================================================');
    console.log(` 🎉 ALL ${totalTests} REGRESSION, PACKAGING & RELEASE TESTS PASSED (100%)!`);
    console.log('================================================================================\n');
  } catch (err) {
    console.error('\n❌ Phase 05 Full Regression Test Suite Failed with Error:', err);
    process.exit(1);
  }
}

runPhase05FullRegressionTestSuite();
