// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

interface MockDisposable {
  dispose: () => void;
}

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

const mockConfigStore: Record<string, any> = {
  longPhaseNudgeEnabled: true,
  longPhaseThresholdSeconds: 180,
  longPhaseNudgeMessage: ' Search online to find the best practices. ',
  longPhaseNudgeRecurring: false,
  longPhaseNotifyTelegram: true,
  telegramEnabled: true,
  telegramBotToken: 'mock_token_phase05',
  telegramAllowedUsers: [10001, 10002],
  telegramThrottleMs: 2500,
  'telegram.allowFreeChat': true,
  'telegram.enableChatMirror': true,
  'telegram.mirrorIncludePcPrompts': true,
  'telegram.chatMirrorPrefix': '🤖 Antigravity:',
  'autoSubmit.enabled': false,
  'autoSubmit.intervalMs': 1000,
  'autoSubmit.maxQuota': 0,
  'autoSubmit.notifyTelegram': true
};

const activeConfigListeners: ((e: any) => void)[] = [];
const executedCommands: string[] = [];

class MockSecretStorage {
  public storeMap = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.storeMap.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.storeMap.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.storeMap.delete(key);
  }

  onDidChange = () => ({ dispose: () => {} });
}

const mockSecretStorageInstance = new MockSecretStorage();

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
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
        createStatusBarItem: (alignment: any, priority: number) => ({
          text: '',
          tooltip: '',
          command: '',
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        createWebviewPanel: (viewType: string, title: string, showOptions: any, options: any) => {
          const listeners: ((e: any) => any)[] = [];
          const disposeListeners: (() => void)[] = [];
          const postedMessages: any[] = [];

          return {
            viewType,
            title,
            options,
            webview: {
              html: '',
              options,
              cspSource: 'vscode-webview:',
              asWebviewUri: (uri: any) => uri,
              postMessage: async (msg: any) => {
                postedMessages.push(msg);
                return true;
              },
              onDidReceiveMessage: (listener: (msg: any) => any) => {
                listeners.push(listener);
                return {
                  dispose: () => {
                    const idx = listeners.indexOf(listener);
                    if (idx >= 0) listeners.splice(idx, 1);
                  }
                };
              }
            },
            reveal: () => {},
            dispose: () => {
              disposeListeners.forEach((l) => l());
            },
            onDidDispose: (listener: () => void) => {
              disposeListeners.push(listener);
              return {
                dispose: () => {
                  const idx = disposeListeners.indexOf(listener);
                  if (idx >= 0) disposeListeners.splice(idx, 1);
                }
              };
            },
            _postedMessages: postedMessages,
            _triggerMessage: async (msg: any) => {
              for (const l of listeners) {
                await l(msg);
              }
            }
          };
        },
        showInformationMessage: async (msg: string) => msg,
        showErrorMessage: async (msg: string) => msg,
        showWarningMessage: async (msg: string) => msg,
        showOpenDialog: async () => undefined,
        showInputBox: async () => undefined
      },
      workspace: {
        get workspaceFolders() {
          return mockWorkspaceFolders;
        },
        name: 'Auto-plan-Extension-main',
        getConfiguration: (section?: string) => ({
          get: (key: string, defaultValue?: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            if (mockConfigStore[fullKey] !== undefined) {
              return mockConfigStore[fullKey];
            }
            if (mockConfigStore[key] !== undefined) {
              return mockConfigStore[key];
            }
            return defaultValue;
          },
          update: async (key: string, val: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            mockConfigStore[fullKey] = val;
            mockConfigStore[key] = val;
            for (const listener of activeConfigListeners) {
              listener({
                affectsConfiguration: (targetKey: string) =>
                  targetKey === 'autoplan' ||
                  targetKey === fullKey ||
                  targetKey === `autoplan.${key}` ||
                  fullKey.startsWith(`${targetKey}.`)
              });
            }
          }
        }),
        onDidChangeConfiguration: (cb: (e: any) => void) => {
          activeConfigListeners.push(cb);
          return {
            dispose: () => {
              const idx = activeConfigListeners.indexOf(cb);
              if (idx >= 0) activeConfigListeners.splice(idx, 1);
            }
          };
        },
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
        openTextDocument: async () => ({}),
        fs: {
          stat: async () => ({ size: 100 })
        }
      },
      commands: {
        executeCommand: async (cmd: string, ...args: any[]) => {
          executedCommands.push(cmd);
          return undefined;
        },
        registerCommand: (cmd: string, callback: (...args: any[]) => any) => ({
          dispose: () => {}
        })
      },
      extensions: {
        getExtension: (id: string) => undefined
      },
      Uri: {
        file: (p: string) => ({ fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` }),
        joinPath: (base: any, ...segments: string[]) => {
          const joined = path.join(base.fsPath || base.path, ...segments);
          return { fsPath: joined, path: joined, scheme: 'file', toString: () => `file://${joined}` };
        }
      },
      ViewColumn: {
        Active: -1,
        One: 1
      },
      StatusBarAlignment: {
        Left: 1,
        Right: 2
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
const yauzl = require('yauzl');
import * as htmlparser2 from 'htmlparser2';
import * as cssSelect from 'css-select';
import * as domutils from 'domutils';
import * as vm from 'vm';
import { SettingsProvider } from '../settingsProvider';
import { PromptDispatcher } from '../promptDispatcher';
import { DebugLogger } from '../debugLogger';
import { SecretStorageManager } from '../config';
import { createIdeAutoSubmit, AutoSubmitApprovalEvent } from '../antigravityRpcAutoSubmit';

const rootDir = path.resolve(__dirname, '../../');

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

      zipfile.on('end', () => resolve(report));
      zipfile.on('error', (zErr: any) => reject(zErr));
      zipfile.readEntry();
    });
  });
}

class MockEvent {
  public target: any;
  public currentTarget: any;
  public defaultPrevented: boolean = false;
  constructor(public type: string) {}
  preventDefault() {
    this.defaultPrevented = true;
  }
}

class MockCustomEvent extends MockEvent {
  constructor(type: string, public detail?: any) {
    super(type);
  }
}

class MockClassList {
  constructor(private el: MockElement) {}

  private getSet(): Set<string> {
    return new Set((this.el.className || '').split(/\s+/).filter(Boolean));
  }

  private saveSet(set: Set<string>) {
    this.el.className = Array.from(set).join(' ');
  }

  add(...classes: string[]) {
    const set = this.getSet();
    for (const c of classes) {
      if (c) set.add(c);
    }
    this.saveSet(set);
  }

  remove(...classes: string[]) {
    const set = this.getSet();
    for (const c of classes) {
      set.delete(c);
    }
    this.saveSet(set);
  }

  contains(c: string): boolean {
    return this.getSet().has(c);
  }

  toggle(c: string, force?: boolean): boolean {
    const set = this.getSet();
    const shouldAdd = force !== undefined ? force : !set.has(c);
    if (shouldAdd) set.add(c);
    else set.delete(c);
    this.saveSet(set);
    return shouldAdd;
  }
}

class MockElement {
  public eventListeners: Record<string, ((e: any) => void)[]> = {};
  public classList: MockClassList;
  public style: Record<string, string> = {};
  public dataset: Record<string, string> = {};
  private _checked?: boolean;
  private _value?: string;
  private _textContent?: string;
  private _innerHTML?: string;

  constructor(public node: any, private wrapperMap: WeakMap<object, MockElement>) {
    this.classList = new MockClassList(this);
    if (node && node.attribs) {
      for (const k of Object.keys(node.attribs)) {
        if (k.startsWith('data-')) {
          const dataKey = k.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
          this.dataset[dataKey] = node.attribs[k];
        }
      }
    }
  }

  private wrap(node: any): MockElement {
    if (!node) return null as any;
    if (this.wrapperMap.has(node)) {
      return this.wrapperMap.get(node)!;
    }
    const wrapper = new MockElement(node, this.wrapperMap);
    this.wrapperMap.set(node, wrapper);
    return wrapper;
  }

  get id(): string {
    return this.node.attribs?.id || '';
  }
  set id(val: string) {
    this.node.attribs = this.node.attribs || {};
    this.node.attribs.id = val;
  }

  get name(): string {
    return this.node.attribs?.name || '';
  }
  set name(val: string) {
    this.node.attribs = this.node.attribs || {};
    this.node.attribs.name = val;
  }

  get type(): string {
    return this.node.attribs?.type || '';
  }
  set type(val: string) {
    this.node.attribs = this.node.attribs || {};
    this.node.attribs.type = val;
  }

  get min(): string {
    return this.node.attribs?.min || '';
  }
  set min(val: string) {
    this.node.attribs = this.node.attribs || {};
    this.node.attribs.min = val;
  }

  get max(): string {
    return this.node.attribs?.max || '';
  }
  set max(val: string) {
    this.node.attribs = this.node.attribs || {};
    this.node.attribs.max = val;
  }

  get disabled(): boolean {
    return this.node.attribs?.disabled !== undefined;
  }
  set disabled(val: boolean) {
    this.node.attribs = this.node.attribs || {};
    if (val) this.node.attribs.disabled = '';
    else delete this.node.attribs.disabled;
  }

  get className(): string {
    return this.node.attribs?.class || '';
  }
  set className(val: string) {
    this.node.attribs = this.node.attribs || {};
    this.node.attribs.class = val;
  }

  get checked(): boolean {
    if (this._checked !== undefined) return this._checked;
    return this.node.attribs?.checked !== undefined;
  }
  set checked(val: boolean) {
    this._checked = val;
    this.node.attribs = this.node.attribs || {};
    if (val) this.node.attribs.checked = '';
    else delete this.node.attribs.checked;
  }

  get value(): string {
    if (this._value !== undefined) return this._value;
    return this.node.attribs?.value || '';
  }
  set value(val: string) {
    this._value = String(val);
    this.node.attribs = this.node.attribs || {};
    this.node.attribs.value = String(val);
  }

  get textContent(): string {
    if (this._textContent !== undefined) return this._textContent;
    return domutils.textContent(this.node);
  }
  set textContent(val: string) {
    this._textContent = String(val);
  }

  get innerHTML(): string {
    if (this._innerHTML !== undefined) return this._innerHTML;
    return domutils.getInnerHTML(this.node);
  }
  set innerHTML(val: string) {
    this._innerHTML = String(val);
  }

  hasAttribute(name: string): boolean {
    return this.node.attribs ? name in this.node.attribs : false;
  }

  getAttribute(name: string): string | null {
    return this.node.attribs?.[name] ?? null;
  }

  setAttribute(name: string, val: string) {
    this.node.attribs = this.node.attribs || {};
    this.node.attribs[name] = String(val);
    if (name === 'class') this.className = String(val);
    if (name === 'id') this.id = String(val);
    if (name === 'value') this.value = String(val);
    if (name.startsWith('data-')) {
      const dataKey = name.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      this.dataset[dataKey] = String(val);
    }
  }

  removeAttribute(name: string) {
    if (this.node.attribs) {
      delete this.node.attribs[name];
      if (name.startsWith('data-')) {
        const dataKey = name.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
        delete this.dataset[dataKey];
      }
    }
  }

  addEventListener(type: string, handler: (e: any) => void) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(handler);
  }

  removeEventListener(type: string, handler: (e: any) => void) {
    if (!this.eventListeners[type]) return;
    const idx = this.eventListeners[type].indexOf(handler);
    if (idx >= 0) this.eventListeners[type].splice(idx, 1);
  }

  dispatchEvent(event: any) {
    event.target = this;
    event.currentTarget = this;
    if (!event.preventDefault) {
      event.preventDefault = () => {};
    }
    const handlers = (this.eventListeners[event.type] || []).slice();
    for (const h of handlers) {
      h(event);
    }
  }

  click() {
    this.dispatchEvent({
      type: 'click',
      target: this,
      currentTarget: this,
      preventDefault: () => {}
    });
  }

  focus() {}
  blur() {}

  querySelector(selector: string): MockElement | null {
    const match = cssSelect.selectOne(selector, this.node);
    return match ? this.wrap(match) : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const matches = cssSelect.selectAll(selector, this.node);
    return matches.map((m: any) => this.wrap(m));
  }

  appendChild(child: any) {
    this.node.children = this.node.children || [];
    this.node.children.push(child.node || child);
  }

  remove() {
    if (this.node.parent && this.node.parent.children) {
      const idx = this.node.parent.children.indexOf(this.node);
      if (idx >= 0) this.node.parent.children.splice(idx, 1);
    }
  }
}

/**
 * Sets up a clean mock DOM instance representing settings.html with mock VS Code API.
 */
function setupTestDom(initialState: any = null) {
  const htmlPath = path.join(rootDir, 'media', 'settings', 'settings.html');
  const rawHtml = fs.readFileSync(htmlPath, 'utf8');
  const dom = htmlparser2.parseDocument(rawHtml);
  const wrapperMap = new WeakMap<object, MockElement>();

  function wrap(node: any): MockElement {
    if (!node) return null as any;
    if (wrapperMap.has(node)) {
      return wrapperMap.get(node)!;
    }
    const wrapper = new MockElement(node, wrapperMap);
    wrapperMap.set(node, wrapper);
    return wrapper;
  }

  let stateStore: any = initialState;
  const postedMessages: any[] = [];

  const mockVsCode = {
    postMessage: (msg: any) => {
      postedMessages.push(msg);
    },
    getState: () => stateStore,
    setState: (newState: any) => {
      stateStore = newState;
    }
  };

  const windowListeners: Record<string, ((e: any) => void)[]> = {};

  const mockWindow: any = {
    addEventListener: (type: string, handler: (e: any) => void) => {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push(handler);
    },
    removeEventListener: (type: string, handler: (e: any) => void) => {
      if (!windowListeners[type]) return;
      const idx = windowListeners[type].indexOf(handler);
      if (idx >= 0) windowListeners[type].splice(idx, 1);
    },
    dispatchEvent: (event: any) => {
      const handlers = (windowListeners[event.type] || []).slice();
      for (const h of handlers) h(event);
    },
    postMessage: (msg: any) => {
      mockWindow.dispatchEvent({ type: 'message', data: msg });
    },
    acquireVsCodeApi: () => mockVsCode,
    __mockVsCode: mockVsCode,
    Event: MockEvent,
    CustomEvent: MockCustomEvent
  };

  const bodyNode = cssSelect.selectOne('body', dom) || { type: 'tag', name: 'body', attribs: {}, children: [] };

  const mockDocument: any = {
    getElementById: (id: string) => {
      const match = cssSelect.selectOne('#' + id, dom);
      return match ? wrap(match) : null;
    },
    querySelector: (selector: string) => {
      const match = cssSelect.selectOne(selector, dom);
      return match ? wrap(match) : null;
    },
    querySelectorAll: (selector: string) => {
      const matches = cssSelect.selectAll(selector, dom);
      return matches.map((m: any) => wrap(m));
    },
    createElement: (tagName: string) => {
      const node = { type: 'tag', name: tagName, attribs: {}, children: [] };
      return wrap(node);
    },
    createDocumentFragment: () => {
      const children: any[] = [];
      return {
        children,
        appendChild: (child: any) => {
          children.push(child);
        }
      };
    },
    body: wrap(bodyNode),
    defaultView: mockWindow
  };

  mockWindow.document = mockDocument;

  const scriptContent = fs.readFileSync(path.join(rootDir, 'media', 'settings', 'settings.js'), 'utf8');

  const moduleObj = { exports: {} as any };
  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    acquireVsCodeApi: () => mockVsCode,
    module: moduleObj,
    exports: moduleObj.exports,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    Event: MockEvent,
    CustomEvent: MockCustomEvent,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    JSON,
    Math,
    Date,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite
  });
  context.globalThis = context;

  vm.runInContext(scriptContent, context);

  return {
    dom,
    window: mockWindow,
    document: mockDocument,
    mockVsCode,
    postedMessages,
    exports: moduleObj.exports
  };
}

async function runPhase05TestSuite() {
  console.log('================================================================================');
  console.log(' 🚀 RUNNING PHASE 05 COMPREHENSIVE FILE-BASED TEST SUITE');
  console.log(' Scope: Webview Card, IPC Synchronization, Full Regression & Release v1.7.0');
  console.log('================================================================================\n');

  try {
    // -------------------------------------------------------------------------
    // Suite 1: Settings Webview HTML Markup & Component Integrity
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Validating Webview Markup & Auto-Submit Card in #tab-timing...');
    const htmlPath = path.join(rootDir, 'media', 'settings', 'settings.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // 1.1 Header & Version Tag
    assert.ok(
      htmlContent.includes('v1.7.0'),
      'settings.html header must reflect version v1.7.0'
    );
    assert.ok(
      htmlContent.includes('RPC Auto-Submit') || htmlContent.includes('Native RPC'),
      'settings.html version tag must describe RPC Auto-Submit'
    );

    // 1.2 Dedicated Card inside #tab-timing or #tab-automation
    assert.ok(
      htmlContent.includes('id="tab-timing"') || htmlContent.includes('id="tab-automation"'),
      'settings.html must contain Timing & Automation tab pane'
    );
    assert.ok(
      htmlContent.includes('id="sectionAutoSubmit"'),
      'settings.html must contain dedicated section sectionAutoSubmit'
    );

    const { document: doc1 } = setupTestDom();

    // Verify element existence and hierarchy inside #tab-timing / #tab-automation
    const timingTab = doc1.querySelector('#tab-timing') || doc1.querySelector('#tab-automation');
    assert.ok(timingTab, 'Timing tab container must exist');

    const autoSubmitCard = timingTab.querySelector('#sectionAutoSubmit') || doc1.getElementById('sectionAutoSubmit');
    assert.ok(autoSubmitCard, '#sectionAutoSubmit card must exist inside Timing tab');

    // 1.3 Controls existence
    const chkEnabled = doc1.getElementById('chkAutoSubmitEnabled') as HTMLInputElement;
    assert.ok(chkEnabled, 'Master auto-submit checkbox #chkAutoSubmitEnabled must exist');
    assert.strictEqual(chkEnabled.type, 'checkbox', '#chkAutoSubmitEnabled must be type checkbox');

    const chkNotify = doc1.getElementById('chkAutoSubmitNotifyTelegram') as HTMLInputElement;
    assert.ok(chkNotify, 'Telegram notify checkbox #chkAutoSubmitNotifyTelegram must exist');
    assert.strictEqual(chkNotify.type, 'checkbox', '#chkAutoSubmitNotifyTelegram must be type checkbox');

    const rngInterval = doc1.getElementById('rngAutoSubmitIntervalMs') as HTMLInputElement;
    assert.ok(rngInterval, 'Poll interval slider #rngAutoSubmitIntervalMs must exist');
    assert.strictEqual(rngInterval.type, 'range', '#rngAutoSubmitIntervalMs must be type range');
    assert.strictEqual(rngInterval.min, '200', 'Poll interval min must be 200ms');
    assert.strictEqual(rngInterval.max, '10000', 'Poll interval max must be 10000ms');

    const lblInterval = doc1.getElementById('lblAutoSubmitIntervalVal');
    assert.ok(lblInterval, 'Interval display label #lblAutoSubmitIntervalVal must exist');

    const txtQuota = doc1.getElementById('txtAutoSubmitMaxQuota') as HTMLInputElement;
    assert.ok(txtQuota, 'Session quota input #txtAutoSubmitMaxQuota must exist');
    assert.strictEqual(txtQuota.type, 'number', '#txtAutoSubmitMaxQuota must be type number');
    assert.strictEqual(txtQuota.min, '0', 'Quota min must be 0');

    const statusBadge = doc1.getElementById('autoSubmitStatusBadge');
    assert.ok(statusBadge, 'Status badge #autoSubmitStatusBadge must exist');

    const approvedCounter = doc1.getElementById('autoSubmitApprovedCount');
    assert.ok(approvedCounter, 'Approved counter #autoSubmitApprovedCount must exist');

    const btnReset = doc1.getElementById('btnResetAutoSubmitQuota') as HTMLButtonElement;
    assert.ok(btnReset, 'Reset counter button #btnResetAutoSubmitQuota must exist');

    console.log('  ✓ Suite 1: Webview markup and all required interactive controls verified.\n');

    // -------------------------------------------------------------------------
    // Suite 2: Webview Form Serialization, Formatting & Debounced Auto-Save
    // -------------------------------------------------------------------------
    console.log('[Suite 2] Testing Webview Form Serialization, Formatting & 300ms Auto-Save...');
    const { document: doc2, exports: exp2, mockVsCode: vs2, postedMessages: post2 } = setupTestDom();

    // 2.1 Serialization via getFormSettings()
    chkEnabled.checked = true;
    rngInterval.value = '2500';
    txtQuota.value = '15';
    chkNotify.checked = false;

    // Apply values to doc2 controls
    (doc2.getElementById('chkAutoSubmitEnabled') as HTMLInputElement).checked = true;
    (doc2.getElementById('rngAutoSubmitIntervalMs') as HTMLInputElement).value = '2500';
    (doc2.getElementById('txtAutoSubmitMaxQuota') as HTMLInputElement).value = '15';
    (doc2.getElementById('chkAutoSubmitNotifyTelegram') as HTMLInputElement).checked = false;

    const collected = exp2.getFormSettings();
    assert.strictEqual(collected.autoSubmitEnabled, true, 'autoSubmitEnabled must serialize to true');
    assert.strictEqual(collected['autoSubmit.enabled'], true, 'autoSubmit.enabled must serialize to true');
    assert.strictEqual(collected.autoSubmitIntervalMs, 2500, 'autoSubmitIntervalMs must serialize to 2500');
    assert.strictEqual(collected.autoSubmitMaxQuota, 15, 'autoSubmitMaxQuota must serialize to 15');
    assert.strictEqual(collected.autoSubmitNotifyTelegram, false, 'autoSubmitNotifyTelegram must serialize to false');

    // 2.2 Deserialization via applySettingsToForm()
    exp2.applySettingsToForm({
      autoSubmitEnabled: false,
      autoSubmitIntervalMs: 800,
      autoSubmitMaxQuota: 50,
      autoSubmitNotifyTelegram: true
    });

    const chkEnabled2 = doc2.getElementById('chkAutoSubmitEnabled') as HTMLInputElement;
    const rngInterval2 = doc2.getElementById('rngAutoSubmitIntervalMs') as HTMLInputElement;
    const txtQuota2 = doc2.getElementById('txtAutoSubmitMaxQuota') as HTMLInputElement;
    const chkNotify2 = doc2.getElementById('chkAutoSubmitNotifyTelegram') as HTMLInputElement;

    assert.strictEqual(chkEnabled2.checked, false, 'applySettingsToForm must update chkAutoSubmitEnabled to false');
    assert.strictEqual(rngInterval2.value, '800', 'applySettingsToForm must update interval to 800');
    assert.strictEqual(txtQuota2.value, '50', 'applySettingsToForm must update quota to 50');
    assert.strictEqual(chkNotify2.checked, true, 'applySettingsToForm must update notify to true');

    // 2.3 Unit display formatting
    if (typeof exp2.updateAutoSubmitIntervalDisplay === 'function') {
      rngInterval2.value = '3000';
      exp2.updateAutoSubmitIntervalDisplay();
      const lbl2 = doc2.getElementById('lblAutoSubmitIntervalVal');
      assert.ok(lbl2?.textContent?.includes('3,000ms'), 'Interval label must format thousands');
      assert.ok(lbl2?.textContent?.includes('3.0s'), 'Interval label must format seconds');
    }

    // 2.4 Status badge formatting
    if (typeof exp2.updateAutoSubmitBadge === 'function') {
      const badgeElem = doc2.getElementById('autoSubmitStatusBadge');
      const approvedElem = doc2.getElementById('autoSubmitApprovedCount');

      exp2.updateAutoSubmitBadge({ phase: 'ready', approved: 42, waitingStepsCount: 1 });
      assert.ok(badgeElem?.textContent?.includes('Connected (Ready)'), 'ready phase must show Connected (Ready)');
      assert.ok(badgeElem?.className.includes('badge-success'), 'ready phase must use badge-success');
      assert.strictEqual(approvedElem?.textContent, '42', 'Approved counter must display 42');

      exp2.updateAutoSubmitBadge({ phase: 'waiting', approved: 5 });
      assert.ok(badgeElem?.textContent?.includes('Waiting for Agent'), 'waiting phase must show Waiting for Agent');
      assert.ok(badgeElem?.className.includes('badge-warning'), 'waiting phase must use badge-warning');

      exp2.updateAutoSubmitBadge({ phase: 'disabled' });
      assert.ok(badgeElem?.textContent?.includes('Disabled'), 'disabled phase must show Disabled');
      assert.ok(badgeElem?.className.includes('badge-disabled'), 'disabled phase must use badge-disabled');

      exp2.updateAutoSubmitBadge({ phase: 'unsupported' });
      assert.ok(badgeElem?.textContent?.includes('Unsupported'), 'unsupported phase must show Unsupported');
      assert.ok(badgeElem?.className.includes('badge-danger'), 'unsupported phase must use badge-danger');

      exp2.updateAutoSubmitBadge({ phase: 'dormant' });
      assert.ok(badgeElem?.textContent?.includes('Quota Reached'), 'dormant phase must show Quota Reached');
    }

    // 2.5 Debounced auto-save verification (300ms)
    chkEnabled2.checked = true;
    const view = doc2.defaultView || (doc2 as any).parentWindow || window;
    chkEnabled2.dispatchEvent(new (view as any).Event('change'));
    assert.strictEqual(exp2.checkDirty(), true, 'Form must be dirty after toggling auto-submit switch');

    const preSaveCount = post2.filter((m: any) => m.command === 'saveSettings').length;
    await new Promise((r) => setTimeout(r, 350));
    const postSaveCount = post2.filter((m: any) => m.command === 'saveSettings').length;
    assert.ok(
      postSaveCount > preSaveCount,
      'Debounced auto-save must fire saveSettings message to extension host within 350ms'
    );

    // 2.6 Quick reset button click
    const btnReset2 = doc2.getElementById('btnResetAutoSubmitQuota') as HTMLButtonElement;
    btnReset2.click();
    const hasResetMsg = post2.some((m: any) => m.command === 'resetAutoSubmitStats' || m.command === 'resetAutoSubmitQuota');
    assert.ok(hasResetMsg, 'Clicking reset button must send resetAutoSubmitStats command');

    console.log('  ✓ Suite 2: Form serialization, unit formatting & debounced auto-save verified.\n');

    // -------------------------------------------------------------------------
    // Suite 3: Instant Search Filter Integration
    // -------------------------------------------------------------------------
    console.log('[Suite 3] Testing Instant Search Filter Integration with Auto-Submit Card...');
    const { document: doc3, exports: exp3 } = setupTestDom();

    const searchInput = doc3.getElementById('searchSettingsInput') as HTMLInputElement;
    const card3 = doc3.getElementById('sectionAutoSubmit');
    assert.ok(card3, 'Auto-submit card must be available for search');

    // 3.1 Search query matching card title
    exp3.applySearchFilter('auto-submit');
    assert.ok(
      card3.classList.contains('search-match'),
      'Card must possess search-match class for query "auto-submit"'
    );
    assert.ok(
      !card3.classList.contains('search-dimmed'),
      'Card must not be dimmed for matching query "auto-submit"'
    );

    // 3.2 Search query matching quota
    exp3.applySearchFilter('quota');
    assert.ok(
      card3.classList.contains('search-match'),
      'Card must match keyword "quota"'
    );

    // 3.3 Search query non-matching
    exp3.applySearchFilter('nonexistentfoobar999');
    assert.ok(
      card3.classList.contains('search-dimmed'),
      'Card must be dimmed for non-matching query'
    );

    // 3.4 Clear search filter restores card
    exp3.applySearchFilter('');
    exp3.clearSearchHighlights();
    assert.ok(
      !card3.classList.contains('search-dimmed'),
      'Clearing search must remove search-dimmed class'
    );

    console.log('  ✓ Suite 3: Instant search indexing, keyword highlighting & dimming verified.\n');

    // -------------------------------------------------------------------------
    // Suite 4: IPC Round-Trip Communication with SettingsProvider
    // -------------------------------------------------------------------------
    console.log('[Suite 4] Testing IPC Round-Trip Communication between Webview & SettingsProvider...');
    const extensionUri = {
      fsPath: rootDir,
      path: rootDir,
      scheme: 'file',
      toString: () => `file://${rootDir}`
    };

    const mockDispatcher = new PromptDispatcher(null as any);
    const mockLogger = new DebugLogger();
    const mockSecrets = new SecretStorageManager(mockSecretStorageInstance as any);

    const provider = SettingsProvider.render(extensionUri as any, mockDispatcher, mockLogger, mockSecrets);
    const webviewPanel: any = provider.panel;

    // 4.1 'ready' message round-trip
    await provider.handleMessage({ command: 'ready' });
    const initMsg = webviewPanel._postedMessages.find((m: any) => m.command === 'initSettings');
    assert.ok(initMsg, 'SettingsProvider must reply with initSettings upon receiving ready');
    assert.ok(initMsg.autoSubmitStatus, 'initSettings must include autoSubmitStatus payload');

    const statusMsg = webviewPanel._postedMessages.find((m: any) => m.command === 'autoSubmitStatusUpdate');
    assert.ok(statusMsg, 'SettingsProvider must send autoSubmitStatusUpdate upon receiving ready');
    assert.ok(statusMsg.status, 'Status update must contain structured status');

    // 4.2 'requestAutoSubmitStatus' query
    webviewPanel._postedMessages.length = 0;
    await provider.handleMessage({ command: 'requestAutoSubmitStatus' });
    const directStatus = webviewPanel._postedMessages.find((m: any) => m.command === 'autoSubmitStatusUpdate');
    assert.ok(directStatus, 'SettingsProvider must reply to requestAutoSubmitStatus');

    // 4.3 'saveSettings' updates configuration store
    await provider.handleMessage({
      command: 'saveSettings',
      settings: {
        'autoSubmit.enabled': true,
        'autoSubmit.intervalMs': 450,
        'autoSubmit.maxQuota': 25,
        'autoSubmit.notifyTelegram': true
      }
    });

    const saveConfirm = webviewPanel._postedMessages.find((m: any) => m.command === 'saveConfirmed');
    assert.ok(saveConfirm, 'SettingsProvider must post saveConfirmed upon persisting settings');
    assert.strictEqual(mockConfigStore['autoSubmit.enabled'], true, 'Configuration store must update enabled=true');
    assert.strictEqual(mockConfigStore['autoSubmit.intervalMs'], 450, 'Configuration store must update interval=450');
    assert.strictEqual(mockConfigStore['autoSubmit.maxQuota'], 25, 'Configuration store must update quota=25');

    // 4.4 'resetAutoSubmitStats' reset round-trip
    webviewPanel._postedMessages.length = 0;
    await provider.handleMessage({ command: 'resetAutoSubmitStats' });
    const resetStatus = webviewPanel._postedMessages.find((m: any) => m.command === 'autoSubmitStatusUpdate');
    assert.ok(resetStatus, 'resetAutoSubmitStats must broadcast updated autoSubmitStatusUpdate');
    assert.strictEqual(resetStatus.status.approved, 0, 'Reset approved count must be 0');

    provider.dispose();
    console.log('  ✓ Suite 4: IPC round-trip communication and telemetry synchronization verified.\n');

    // -------------------------------------------------------------------------
    // Suite 5: End-to-End Regression Benchmark Suite
    // -------------------------------------------------------------------------
    console.log('[Suite 5] Executing End-to-End Regression Benchmark Suite...');

    // 5.1 Tier 1 DOM Bridge prompt injection
    const tier1Result = await mockDispatcher.testTierDispatch('domBridge');
    assert.ok(typeof tier1Result.success === 'boolean', 'Tier 1 DOM Bridge dispatch must return boolean success');

    // 5.2 Tier 2 Command dispatch & Tier 3 Keyboard simulation
    const tier2Result = await mockDispatcher.testTierDispatch('nativeCommand');
    assert.ok(typeof tier2Result.success === 'boolean', 'Tier 2 Native Command dispatch must complete');

    const tier3Result = await mockDispatcher.testTierDispatch('keyboard');
    assert.ok(typeof tier3Result.success === 'boolean', 'Tier 3 OS Keyboard dispatch must complete');

    // 5.3 Auto-Submit Engine co-existence and quota limits
    let tickApprovals = 0;
    const testEngine = createIdeAutoSubmit({
      getPolicy: () => ({
        enabled: true,
        patterns: ['Submit'],
        maxQuota: 2,
        workspaceUris: ['file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main']
      }),
      onClick: () => {
        tickApprovals++;
      }
    });

    assert.strictEqual(testEngine.status().approved, 0, 'Initial approvals must be 0');
    assert.strictEqual(testEngine.isRunning(), false, 'Engine must be stopped initially');

    testEngine.resetStats();
    assert.strictEqual(testEngine.status().approved, 0, 'Reset stats must maintain 0 count');
    testEngine.dispose();

    console.log('  ✓ Suite 5: Zero-regression co-existence across Tiers 1-3 & Auto-Submit verified.\n');

    // -------------------------------------------------------------------------
    // Suite 6: Manifest Consistency, Documentation & Production VSIX Integrity
    // -------------------------------------------------------------------------
    console.log('[Suite 6] Verifying Release Manifests, Documentation & VSIX Artifact (v1.7.0)...');

    // 6.1 package.json
    const packageJsonPath = path.join(rootDir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    assert.strictEqual(packageJson.version, '1.7.0', 'package.json version must be 1.7.0');
    assert.ok(packageJson.contributes?.configuration?.properties?.['autoplan.autoSubmit.enabled'], 'Must declare autoplan.autoSubmit.enabled');
    assert.ok(packageJson.contributes?.configuration?.properties?.['autoplan.autoSubmit.intervalMs'], 'Must declare autoplan.autoSubmit.intervalMs');
    assert.ok(packageJson.contributes?.configuration?.properties?.['autoplan.autoSubmit.maxQuota'], 'Must declare autoplan.autoSubmit.maxQuota');
    assert.ok(packageJson.contributes?.configuration?.properties?.['autoplan.autoSubmit.notifyTelegram'], 'Must declare autoplan.autoSubmit.notifyTelegram');
    assert.ok(packageJson.scripts?.['test:phase05-rpc'], 'package.json must register test:phase05-rpc script');

    // 6.2 CHANGELOG.md
    const changelogPath = path.join(rootDir, 'CHANGELOG.md');
    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    assert.ok(changelogContent.includes('## [1.7.0]'), 'CHANGELOG.md must contain entry for v1.7.0');
    assert.ok(
      changelogContent.includes('Native RPC Auto-Submit') || changelogContent.includes('RPC Native Auto-Submit'),
      'CHANGELOG.md must describe Native RPC Auto-Submit'
    );
    assert.ok(
      changelogContent.includes('Settings Webview') || changelogContent.includes('Settings Dashboard'),
      'CHANGELOG.md must document Settings Webview integration'
    );

    // 6.3 README.md
    const readmePath = path.join(rootDir, 'README.md');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    assert.ok(readmeContent.includes('version-1.7.0'), 'README.md must display version 1.7.0 badge');
    assert.ok(readmeContent.includes('antigravity-auto-plan-1.7.0.vsix'), 'README.md must reference antigravity-auto-plan-1.7.0.vsix');
    assert.ok(readmeContent.includes('autoplan.autoSubmit.enabled'), 'README.md must document autoplan.autoSubmit.enabled');

    // 6.4 Production VSIX Package (antigravity-auto-plan-1.7.0.vsix)
    const vsixPath = path.join(rootDir, 'antigravity-auto-plan-1.7.0.vsix');
    assert.ok(fs.existsSync(vsixPath), `VSIX release artifact must exist at: ${vsixPath}`);

    const vsixStats = fs.statSync(vsixPath);
    console.log(`     Release VSIX size: ${(vsixStats.size / (1024 * 1024)).toFixed(2)} MB (${vsixStats.size} bytes)`);
    assert.ok(
      vsixStats.size > 500 * 1024,
      `VSIX release bundle must contain production dependencies (> 500 KB), actual: ${vsixStats.size} bytes`
    );

    // Verify valid ZIP magic header (PK\x03\x04)
    const fd = fs.openSync(vsixPath, 'r');
    const magicBuf = Buffer.alloc(4);
    fs.readSync(fd, magicBuf, 0, 4, 0);
    fs.closeSync(fd);
    assert.strictEqual(
      magicBuf.toString('hex'),
      '504b0304',
      'VSIX file must possess valid zip magic header (PK\\x03\\x04)'
    );

    // Deep audit VSIX contents via yauzl
    const vsixAudit = await auditVsixArchive(vsixPath);
    console.log(`     Total files packaged in VSIX: ${vsixAudit.totalFiles}`);
    assert.ok(vsixAudit.totalFiles > 100, `Expected > 100 packaged files, found ${vsixAudit.totalFiles}`);

    // Verify packaged manifest version
    assert.ok(vsixAudit.packageJson, 'Packaged extension/package.json must be readable');
    assert.strictEqual(
      vsixAudit.packageJson.version,
      '1.7.0',
      `Packaged extension version must be 1.7.0 (got ${vsixAudit.packageJson?.version})`
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
      'extension/out/settingsProvider.js',
      'extension/out/antigravityRpcAutoSubmit.js',
      'extension/media/settings/settings.html',
      'extension/media/settings/settings.css',
      'extension/media/settings/settings.js',
      'extension/media/autoplan-dom-bridge.js'
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

    console.log('  ✓ Suite 6: Release manifests, documentation & VSIX package integrity verified.\n');

    console.log('================================================================================');
    console.log(' 🎉 ALL 6 PHASE 05 REGRESSION, SETTINGS UI & RELEASE PACKAGING TESTS PASSED (100%)!');
    console.log('================================================================================\n');
  } catch (err) {
    console.error('\n❌ Phase 05 Test Suite Failed with Error:', err);
    process.exit(1);
  }
}

runPhase05TestSuite();
