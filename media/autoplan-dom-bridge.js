/**
 * Antigravity Auto-Plan DOM Bridge Client
 * Runs in the Electron Renderer DOM context (workbench.html).
 * Provides focus-free prompt injection, double-tap submission, new conversation triggering,
 * background permission auto-approval, and HTTP bridge coordination.
 */

(function (global) {
  'use strict';

  const DEFAULT_PORT_START = 48860;
  const DEFAULT_PORT_END = 48900;
  const DEFAULT_POLL_INTERVAL_MS = 500;
  const DEFAULT_APPROVAL_PATTERNS = [
    'Allow',
    'Always Allow',
    'Allow in Workspace',
    'Run',
    'Submit',
    'Keep Waiting',
    'Accept all',
    'Continue'
  ];

  const CONTAINER_SELECTORS = [
    '.interactive-session',
    'div.chat-input',
    '.chat-input-container',
    '.monaco-dialog-box',
    '.dialog-shadow',
    '.notifications-toasts',
    '.monaco-alert-dialog'
  ];

  /**
   * Recursively search within root, shadow roots, and child iframes
   */
  function queryDeep(selector, root) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc) return [];

    let results = [];
    const isTopLevel = (typeof document !== 'undefined' && (doc === document || doc === document.body)) ||
      (doc && (doc.documentElement || doc.body) && !doc.parentElement);

    try {
      if (typeof doc.querySelectorAll === 'function') {
        let searchedScopedContainers = false;

        if (isTopLevel) {
          const containers = doc.querySelectorAll(CONTAINER_SELECTORS.join(', '));
          if (containers && containers.length > 0) {
            searchedScopedContainers = true;
            for (let cIdx = 0; cIdx < containers.length; cIdx++) {
              const container = containers[cIdx];
              if (typeof container.matches === 'function' && container.matches(selector)) {
                results.push(container);
              }
              if (typeof container.querySelectorAll === 'function') {
                const found = container.querySelectorAll(selector);
                results = results.concat(Array.from(found));
              }
              if (container.shadowRoot) {
                results = results.concat(queryDeep(selector, container.shadowRoot));
              }
              if (typeof container.querySelectorAll === 'function') {
                const innerNodes = container.querySelectorAll('*');
                for (let i = 0; i < innerNodes.length; i++) {
                  const el = innerNodes[i];
                  if (el.shadowRoot) {
                    results = results.concat(queryDeep(selector, el.shadowRoot));
                  }
                }
              }
            }
          }
        }

        if (!searchedScopedContainers) {
          const found = doc.querySelectorAll(selector);
          results = results.concat(Array.from(found));

          const allNodes = doc.querySelectorAll('*');
          for (let i = 0; i < allNodes.length; i++) {
            const el = allNodes[i];
            if (el.shadowRoot) {
              results = results.concat(queryDeep(selector, el.shadowRoot));
            }
          }
        }
      }
    } catch (_) {}

    return Array.from(new Set(results));
  }

  /**
   * Discovers the chat prompt input element using prioritized selector cascades
   */
  function findChatInput(doc) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root) return null;

    const selectors = [
      '.interactive-session .monaco-editor textarea.inputarea',
      'textarea.interactive-input-editor',
      'div.interactive-input-editor textarea',
      '.interactive-input textarea',
      '.chat-input-container textarea',
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="Prompt"]',
      'textarea[placeholder*="Chat"]',
      'div.monaco-editor[contenteditable="true"]',
      'div.ProseMirror',
      'div[contenteditable="true"]',
      'textarea.inputarea',
      'div.chat-input textarea',
      '[data-testid*="chat-input"]',
      'textarea'
    ];

    for (let i = 0; i < selectors.length; i++) {
      const candidates = queryDeep(selectors[i], root);
      for (let j = 0; j < candidates.length; j++) {
        const el = candidates[j];
        if (el && isElementVisible(el)) {
          return el;
        }
      }
    }

    return null;
  }

  /**
   * Helper to check if an element is visible in the DOM
   */
  function isElementVisible(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (typeof el.getBoundingClientRect === 'function') {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0 && !el.offsetParent && el.style?.display === 'none') {
        return false;
      }
    }
    if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) {
      return false;
    }
    return true;
  }

  /**
   * Locates the chat submit / send button
   */
  function findSendButton(contextOrDoc) {
    const root = (contextOrDoc && (contextOrDoc.ownerDocument || contextOrDoc)) || (typeof document !== 'undefined' ? document : null);
    if (!root) return null;

    const selectors = [
      'button[aria-label*="Send"]',
      'button[title*="Send"]',
      'button[aria-label*="Submit"]',
      'button[title*="Submit"]',
      '.interactive-item-submit-button',
      '.chat-submit-button',
      'button[type="submit"]',
      '[data-testid*="send-button"]',
      '.codicon-send',
      'button.codicon-send'
    ];

    for (let i = 0; i < selectors.length; i++) {
      const candidates = queryDeep(selectors[i], root);
      for (let j = 0; j < candidates.length; j++) {
        const el = candidates[j];
        if (el) {
          // If the element itself is a codicon icon, get its parent button if possible
          if (el.classList && el.classList.contains('codicon-send') && el.tagName !== 'BUTTON') {
            const parentBtn = el.closest ? el.closest('button, [role="button"]') : el.parentElement;
            if (parentBtn && isElementVisible(parentBtn)) {
              return parentBtn;
            }
          }
          if (isElementVisible(el)) {
            return el;
          }
        }
      }
    }

    return null;
  }

  /**
   * Locates the "New Conversation" / "New Chat" button
   */
  function findNewConversationButton(doc) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root) return null;

    const selectors = [
      'button[aria-label*="New Chat"]',
      'button[aria-label*="New Conversation"]',
      'button[title*="New Chat"]',
      'button[title*="New Conversation"]',
      'button[aria-label*="Clear Chat"]',
      '[data-testid*="new-chat-button"]',
      '.codicon-plus',
      '.codicon-add',
      'button.codicon-plus',
      'button.codicon-add'
    ];

    for (let i = 0; i < selectors.length; i++) {
      const candidates = queryDeep(selectors[i], root);
      for (let j = 0; j < candidates.length; j++) {
        const el = candidates[j];
        if (el) {
          if (el.classList && (el.classList.contains('codicon-plus') || el.classList.contains('codicon-add')) && el.tagName !== 'BUTTON') {
            const parentBtn = el.closest ? el.closest('button, [role="button"]') : el.parentElement;
            if (parentBtn && isElementVisible(parentBtn)) {
              return parentBtn;
            }
          }
          if (isElementVisible(el)) {
            return el;
          }
        }
      }
    }

    return null;
  }

  /**
   * Injects prompt text into the active chat input and triggers submit
   */
  async function injectPromptAndSubmit(promptText, options = {}) {
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    if (!doc) {
      throw new Error('DOM document not available for prompt injection');
    }

    const inputElem = options.targetElement || findChatInput(doc);
    if (!inputElem) {
      throw new Error('No valid chat input element found in DOM');
    }

    // 1. Focus element in DOM
    if (typeof inputElem.focus === 'function') {
      inputElem.focus();
    }

    let injectionStrategy = 'direct';

    // 2. Multi-Strategy Injection
    const isInputOrTextarea = inputElem.tagName === 'TEXTAREA' || inputElem.tagName === 'INPUT';
    const isContentEditable = inputElem.getAttribute?.('contenteditable') === 'true' ||
      inputElem.contentEditable === 'true' ||
      inputElem.classList?.contains('ProseMirror') ||
      inputElem.classList?.contains('monaco-editor');

    // Strategy 1: execCommand (for rich text/contenteditable/ProseMirror/Monaco)
    if (isContentEditable && doc.execCommand) {
      try {
        doc.execCommand('selectAll', false, null);
        const success = doc.execCommand('insertText', false, promptText);
        if (success) {
          injectionStrategy = 'execCommand';
        }
      } catch (_) {}
    }

    // Strategy 2: Direct property assignment & synthetic events
    if (isInputOrTextarea) {
      // Trigger beforeinput
      try {
        if (win && typeof win.InputEvent === 'function') {
          inputElem.dispatchEvent(new win.InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: promptText
          }));
        }
      } catch (_) {}

      // Value setter
      let valueSet = false;
      if (win && win.HTMLTextAreaElement && win.HTMLTextAreaElement.prototype) {
        const desc = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value');
        if (desc && desc.set) {
          desc.set.call(inputElem, promptText);
          valueSet = true;
        }
      }
      if (!valueSet) {
        inputElem.value = promptText;
      }
      injectionStrategy = 'textarea-value';
    } else if (injectionStrategy !== 'execCommand') {
      // ContentEditable direct fallback
      if (typeof inputElem.innerText !== 'undefined') {
        inputElem.innerText = promptText;
      } else {
        inputElem.textContent = promptText;
      }
      injectionStrategy = 'contenteditable-text';
    }

    // 3. Dispatch Bubbling Input & Change Events
    try {
      if (win && typeof win.InputEvent === 'function') {
        inputElem.dispatchEvent(new win.InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: promptText
        }));
      } else if (win && typeof win.Event === 'function') {
        inputElem.dispatchEvent(new win.Event('input', { bubbles: true, cancelable: true }));
      }
    } catch (_) {}

    try {
      if (win && typeof win.Event === 'function') {
        inputElem.dispatchEvent(new win.Event('change', { bubbles: true, cancelable: true }));
      }
    } catch (_) {}

    // 4. Double-Tap Submit: Keyboard Enter + Send Button Click
    // Tap 1: Enter Key Events
    try {
      if (win && typeof win.KeyboardEvent === 'function') {
        inputElem.dispatchEvent(new win.KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        }));
        inputElem.dispatchEvent(new win.KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true
        }));
      }
    } catch (_) {}

    // Tap 2: Find & Click Submit / Send Button
    const sendBtn = options.sendButton || findSendButton(doc || inputElem?.ownerDocument || inputElem);
    let sendButtonClicked = false;
    if (sendBtn && typeof sendBtn.click === 'function') {
      sendBtn.click();
      sendButtonClicked = true;
    }

    return {
      success: true,
      injectionStrategy,
      sendButtonClicked,
      buttonSelector: sendBtn?.className || sendBtn?.tagName || null,
      charsInjected: promptText.length
    };
  }

  /**
   * Triggers a New Conversation / New Chat in the Antigravity chat panel
   */
  async function triggerNewConversation(options = {}) {
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const newBtn = options.button || findNewConversationButton(doc);
    if (newBtn && typeof newBtn.click === 'function') {
      newBtn.click();
      return true;
    }
    return false;
  }

  /**
   * Background Permission Auto-Approver
   * Continuously scans for modal/inline permission buttons and clicks them immediately.
   */
  function startAutoApprovalObserver(patterns, options = {}) {
    const targetPatterns = patterns || DEFAULT_APPROVAL_PATTERNS;
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const intervalMs = options.intervalMs || 1000;
    const onApproved = options.onApproved || null;
    const throttleMs = options.throttleMs || 300;
    const maxWaitMs = options.maxWaitMs || 500;

    if (!doc) {
      return { stop: () => {} };
    }

    let isStopped = false;

    function scanAndApprove() {
      if (isStopped) return 0;
      let approvedCount = 0;

      const candidates = queryDeep('button, [role="button"], .monaco-button, .dialog-button, a.monaco-button', doc);
      for (let i = 0; i < candidates.length; i++) {
        const btn = candidates[i];
        if (!btn || !isElementVisible(btn)) continue;

        const text = (btn.textContent || btn.innerText || btn.getAttribute('aria-label') || '').trim();
        if (!text) continue;

        for (let p = 0; p < targetPatterns.length; p++) {
          const pat = targetPatterns[p];
          if (text === pat || text.toLowerCase() === pat.toLowerCase() || (text.length < 50 && text.includes(pat))) {
            try {
              if (typeof btn.click === 'function') {
                btn.click();
                approvedCount++;
                if (typeof onApproved === 'function') {
                  onApproved(pat, btn);
                }
              }
            } catch (_) {}
            break;
          }
        }
      }

      return approvedCount;
    }

    // 1. Initial immediate scan
    scanAndApprove();

    // Throttled scan helper with 300ms debounce quiet period and 500ms maxWait
    let throttleTimer = null;
    let maxWaitTimer = null;
    let firstCallTime = 0;

    function executeScan() {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      if (maxWaitTimer) {
        clearTimeout(maxWaitTimer);
        maxWaitTimer = null;
      }
      firstCallTime = 0;
      scanAndApprove();
    }

    function throttledScan() {
      if (isStopped) return;
      const now = Date.now();
      if (!firstCallTime) {
        firstCallTime = now;
      }

      if (now - firstCallTime >= maxWaitMs) {
        executeScan();
        return;
      }

      if (throttleTimer) {
        clearTimeout(throttleTimer);
      }

      const remainingWait = Math.min(throttleMs, maxWaitMs - (now - firstCallTime));
      throttleTimer = setTimeout(() => {
        executeScan();
      }, remainingWait);

      if (!maxWaitTimer) {
        maxWaitTimer = setTimeout(() => {
          executeScan();
        }, maxWaitMs - (now - firstCallTime));
      }
    }

    // 2. MutationObserver
    let observer = null;
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const MutationObserverClass = options.MutationObserver || (win && win.MutationObserver) || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);

    if (MutationObserverClass) {
      try {
        observer = new MutationObserverClass(() => {
          throttledScan();
        });
        const targetNode = doc.body || doc.documentElement || doc;
        if (targetNode && typeof observer.observe === 'function') {
          observer.observe(targetNode, {
            childList: true,
            subtree: true,
            attributes: false
          });
        }
      } catch (_) {}
    }

    // 3. Fallback interval
    const intervalId = setInterval(() => {
      scanAndApprove();
    }, intervalMs);

    return {
      scanNow: () => scanAndApprove(),
      stop: () => {
        isStopped = true;
        if (throttleTimer) {
          clearTimeout(throttleTimer);
          throttleTimer = null;
        }
        if (maxWaitTimer) {
          clearTimeout(maxWaitTimer);
          maxWaitTimer = null;
        }
        if (observer && typeof observer.disconnect === 'function') {
          observer.disconnect();
        }
        clearInterval(intervalId);
      }
    };
  }

  /**
   * DOM Bridge Client Coordinator
   * Connects to local Bridge Server, polls for commands, executes actions, and returns ACKs.
   */
  class DomBridgeClient {
    constructor(options = {}) {
      this.portStart = options.portStart || DEFAULT_PORT_START;
      this.portEnd = options.portEnd || DEFAULT_PORT_END;
      this.serverPort = options.serverPort || null;
      this.windowKey = options.windowKey || (typeof window !== 'undefined' && window.__AUTOPLAN_WINDOW_KEY__) || `dom_win_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      this.pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
      this.fetchFn = options.fetch || (typeof fetch !== 'undefined' ? fetch.bind(global) : null);
      this.approvalObserver = null;
      this.pollTimer = null;
      this.isRunning = false;
      this.autoApprovalEnabled = options.autoApproval !== false;
      this.customDocument = options.document;
      this.customWindow = options.window;
    }

    /**
     * Auto-discovers the running bridge server port
     */
    async discoverPort() {
      if (this.serverPort) {
        return this.serverPort;
      }

      // Check window injection global if available
      if (typeof window !== 'undefined' && window.__AUTOPLAN_PORT__) {
        this.serverPort = window.__AUTOPLAN_PORT__;
        return this.serverPort;
      }

      if (!this.fetchFn) {
        throw new Error('fetch implementation is required for port discovery');
      }

      // Probe port range
      for (let port = this.portStart; port <= this.portEnd; port++) {
        try {
          const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
          const timeoutId = controller ? setTimeout(() => controller.abort(), 200) : null;
          const url = `http://127.0.0.1:${port}/autoplan-status?probe=1&windowKey=${encodeURIComponent(this.windowKey)}`;
          
          const res = await this.fetchFn(url, {
            method: 'GET',
            signal: controller ? controller.signal : undefined
          });

          if (timeoutId) clearTimeout(timeoutId);

          if (res && res.status === 200) {
            const data = await res.json();
            if (data && data.service === 'autoplan-bridge-server') {
              this.serverPort = port;
              return port;
            }
          }
        } catch (_) {
          // Port not listening or connection refused, continue probe
        }
      }

      return null;
    }

    /**
     * Sends an acknowledgment back to the Bridge Server
     */
    async sendAck(commandId, status, errorMsg, metadata) {
      if (!this.serverPort || !this.fetchFn) return false;
      try {
        const payload = {
          commandId,
          status,
          windowKey: this.windowKey,
          error: errorMsg || undefined,
          timestamp: Date.now(),
          metadata: metadata || undefined
        };

        const res = await this.fetchFn(`http://127.0.0.1:${this.serverPort}/autoplan-ack`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Window-Key': this.windowKey },
          body: JSON.stringify(payload)
        });

        return res && (res.status === 200 || res.ok);
      } catch (err) {
        return false;
      }
    }

    /**
     * Single polling tick to query pending commands and process them
     */
    async pollTick() {
      if (!this.isRunning) return;

      try {
        if (!this.serverPort) {
          const port = await this.discoverPort();
          if (!port) return;
        }

        const url = `http://127.0.0.1:${this.serverPort}/autoplan-status?windowKey=${encodeURIComponent(this.windowKey)}&clientVersion=2.0.0`;
        const res = await this.fetchFn(url, {
          method: 'GET',
          headers: { 'X-Window-Key': this.windowKey }
        });

        if (!res || res.status !== 200) {
          if (res && res.status === 404) {
            this.serverPort = null; // Server might have restarted on another port
          }
          return;
        }

        const data = await res.json();
        if (data && Array.isArray(data.pendingCommands)) {
          for (let i = 0; i < data.pendingCommands.length; i++) {
            await this.handleCommand(data.pendingCommands[i]);
          }
        }
      } catch (_) {
        // Network failure or connection dropped, reset serverPort to re-probe
        this.serverPort = null;
      }
    }

    /**
     * Executes a received command
     */
    async handleCommand(cmd) {
      if (!cmd || !cmd.id) return;

      try {
        if (cmd.type === 'sendPrompt') {
          const result = await injectPromptAndSubmit(cmd.text || '', {
            document: this.customDocument,
            window: this.customWindow,
            ...cmd.options
          });

          await this.sendAck(cmd.id, 'submitClicked', null, result);
        } else if (cmd.type === 'openNewConversation') {
          const success = await triggerNewConversation({
            document: this.customDocument,
            ...cmd.options
          });

          await this.sendAck(cmd.id, success ? 'completed' : 'error', success ? null : 'Failed to find new conversation button');
        } else if (cmd.type === 'clickApproval') {
          const count = this.approvalObserver ? this.approvalObserver.scanNow() : 0;
          await this.sendAck(cmd.id, 'completed', null, { clickedCount: count });
        } else if (cmd.type === 'ping') {
          await this.sendAck(cmd.id, 'completed', null, { pong: true });
        } else {
          await this.sendAck(cmd.id, 'error', `Unknown command type: ${cmd.type}`);
        }
      } catch (err) {
        await this.sendAck(cmd.id, 'error', err?.message || String(err));
      }
    }

    /**
     * Starts the client polling loop and background auto-approver
     */
    start() {
      if (this.isRunning) return;
      this.isRunning = true;

      // Start auto-approver
      if (this.autoApprovalEnabled) {
        this.approvalObserver = startAutoApprovalObserver(DEFAULT_APPROVAL_PATTERNS, {
          document: this.customDocument,
          window: this.customWindow
        });
      }

      // Start polling loop
      const runLoop = async () => {
        if (!this.isRunning) return;
        await this.pollTick();
        if (this.isRunning) {
          this.pollTimer = setTimeout(runLoop, this.pollIntervalMs);
        }
      };

      runLoop();
    }

    /**
     * Stops the client polling and observers
     */
    stop() {
      this.isRunning = false;
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
      if (this.approvalObserver) {
        this.approvalObserver.stop();
        this.approvalObserver = null;
      }
    }
  }

  // Export module / global object
  const exportsObj = {
    DEFAULT_PORT_START,
    DEFAULT_PORT_END,
    DEFAULT_APPROVAL_PATTERNS,
    CONTAINER_SELECTORS,
    queryDeep,
    findChatInput,
    findSendButton,
    findNewConversationButton,
    injectPromptAndSubmit,
    triggerNewConversation,
    startAutoApprovalObserver,
    DomBridgeClient
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportsObj;
  }

  if (typeof window !== 'undefined') {
    window.__AUTOPLAN_BRIDGE__ = exportsObj;
    // Automatically auto-start client when injected into workbench DOM if not explicitly disabled
    if (!window.__AUTOPLAN_DISABLE_AUTOSTART__) {
      const client = new DomBridgeClient();
      window.__AUTOPLAN_BRIDGE_CLIENT__ = client;
      client.start();
    }
  }

  return exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : this);
