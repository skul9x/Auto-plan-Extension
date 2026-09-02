/**
 * Antigravity Auto-Plan DOM Bridge Client
 * Runs in the Electron Renderer DOM context (workbench.html).
 * Provides focus-free prompt injection, double-tap submission, new conversation triggering,
 * background permission auto-approval, DOM diagnostics snapshot engine, and HTTP bridge coordination.
 */

(function (global) {
  'use strict';

  const DEFAULT_PORT_START = 48860;
  const DEFAULT_PORT_END = 48900;
  const DEFAULT_POLL_INTERVAL_MS = 500;
  const DEFAULT_HEARTBEAT_INTERVAL_MS = 10000;
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
    '#antigravity\\.agentSidePanelInputBox',
    'div[id*="agentSidePanelInputBox"]',
    '.chat-widget',
    '.interactive-session',
    'div.chat-input',
    '.chat-input-container',
    '.chat-input-part',
    '.interactive-input',
    '.chat-editor-widget',
    '.composer-container',
    '.composer-bar',
    '.monaco-dialog-box',
    '.notifications-toasts'
  ];

  let activeClientInstance = null;
  const earlyLogBuffer = [];
  const MAX_EARLY_BUFFER_CAPACITY = 50;

  /**
   * Internal structured logger emitting prefixed console output and routing to active client
   */
  function logBridge(level, message, details = {}, err = null) {
    const lvl = (level || 'INFO').toUpperCase();
    const prefix = `[Auto-Plan DOM Bridge] [${lvl}]`;
    const detailsObj = { ...(details || {}) };
    if (err) {
      detailsObj.error = err?.message || String(err);
      if (err?.stack) {
        detailsObj.stack = err.stack;
      }
    }

    try {
      if (lvl === 'ERROR') {
        console.error(`${prefix} ${message}`, detailsObj, err || '');
      } else if (lvl === 'WARN') {
        console.warn(`${prefix} ${message}`, detailsObj, err || '');
      } else if (lvl === 'DEBUG') {
        console.debug(`${prefix} ${message}`, detailsObj);
      } else {
        console.log(`${prefix} ${message}`, detailsObj);
      }
    } catch (_) {
      // Console access safety guard
    }

    if (activeClientInstance && typeof activeClientInstance.sendClientLog === 'function') {
      try {
        activeClientInstance.sendClientLog(lvl, message, detailsObj);
      } catch (_) {
        // Prevent cyclic logger errors
      }
    } else {
      if (earlyLogBuffer.length >= MAX_EARLY_BUFFER_CAPACITY) {
        earlyLogBuffer.shift();
      }
      earlyLogBuffer.push({
        level: lvl,
        component: 'CLIENT',
        message: message || '',
        details: detailsObj,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Safely splits compound CSS selectors on descendant whitespace combinators,
   * preserving spaces inside quotes and bracketed attribute selectors.
   */
  function splitSelectorCombinators(selector) {
    if (!selector || typeof selector !== 'string') return [];
    const parts = [];
    let current = '';
    let inBracket = false;
    let inQuote = null;

    for (let i = 0; i < selector.length; i++) {
      const ch = selector[i];
      if (inQuote) {
        current += ch;
        if (ch === inQuote && selector[i - 1] !== '\\') {
          inQuote = null;
        }
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
        current += ch;
      } else if (ch === '[') {
        inBracket = true;
        current += ch;
      } else if (ch === ']') {
        inBracket = false;
        current += ch;
      } else if (/\s/.test(ch)) {
        if (inBracket) {
          current += ch;
        } else if (current.trim()) {
          parts.push(current.trim());
          current = '';
        }
      } else {
        current += ch;
      }
    }
    if (current.trim()) {
      parts.push(current.trim());
    }
    return parts;
  }

  /**
   * Recursively search within root, shadow roots, and child iframes safely.
   * If scoped container search yields 0 matches, ALWAYS falls back to searching full document tree.
   */
  function queryDeep(selector, root, visited = new Set()) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc || visited.has(doc)) return [];
    visited.add(doc);

    let results = [];
    const isTopLevel = (typeof document !== 'undefined' && (doc === document || doc === document.body)) ||
      (doc && (doc.documentElement || doc.body) && !doc.parentElement);

    const selectorParts = splitSelectorCombinators(selector);

    try {
      if (typeof doc.querySelectorAll === 'function') {
        let searchedScoped = false;

        if (isTopLevel) {
          try {
            const containers = doc.querySelectorAll(CONTAINER_SELECTORS.join(', '));
            if (containers && containers.length > 0) {
              searchedScoped = true;
              for (let cIdx = 0; cIdx < containers.length; cIdx++) {
                const container = containers[cIdx];
                if (typeof container.matches === 'function' && container.matches(selector)) {
                  results.push(container);
                }
                if (typeof container.querySelectorAll === 'function') {
                  try {
                    const found = container.querySelectorAll(selector);
                    results = results.concat(Array.from(found));
                  } catch (_) {}
                }

                // Handle compound selectors when container matches prefix
                if (selectorParts.length > 1) {
                  for (let p = 1; p < selectorParts.length; p++) {
                    const prefix = selectorParts.slice(0, p).join(' ');
                    const suffix = selectorParts.slice(p).join(' ');
                    try {
                      if (typeof container.matches === 'function' && container.matches(prefix)) {
                        const subFound = container.querySelectorAll(suffix);
                        results = results.concat(Array.from(subFound));
                      }
                    } catch (_) {}
                  }
                }

                if (container.shadowRoot && !visited.has(container.shadowRoot)) {
                  results = results.concat(queryDeep(selector, container.shadowRoot, visited));
                  if (selectorParts.length > 1) {
                    for (let p = 1; p < selectorParts.length; p++) {
                      const prefix = selectorParts.slice(0, p).join(' ');
                      const suffix = selectorParts.slice(p).join(' ');
                      try {
                        if (typeof container.matches === 'function' && container.matches(prefix)) {
                          results = results.concat(queryDeep(suffix, container.shadowRoot, visited));
                        }
                      } catch (_) {}
                    }
                  }
                }

                if (typeof container.querySelectorAll === 'function') {
                  const innerNodes = container.querySelectorAll('*');
                  for (let i = 0; i < innerNodes.length; i++) {
                    const el = innerNodes[i];
                    if (el.shadowRoot && !visited.has(el.shadowRoot)) {
                      results = results.concat(queryDeep(selector, el.shadowRoot, visited));
                    }
                    if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
                      try {
                        const frameDoc = el.contentDocument || (el.contentWindow && el.contentWindow.document);
                        if (frameDoc && !visited.has(frameDoc)) {
                          results = results.concat(queryDeep(selector, frameDoc, visited));
                        }
                      } catch (frameErr) {
                        logBridge('WARN', `Cross-origin iframe access restricted in container query: ${frameErr?.message || frameErr}`, {
                          iframeId: el.id,
                          iframeSrc: el.src
                        }, frameErr);
                      }
                    }
                  }
                }
              }
            }
          } catch (scopeErr) {
            logBridge('WARN', `Scoped container search encountered error: ${scopeErr?.message || scopeErr}`, { selector }, scopeErr);
          }
        }

        // Always fall back to searching full document tree if scoped searching produced 0 matches
        if (!searchedScoped || results.length === 0) {
          if (searchedScoped && results.length === 0) {
            logBridge('DEBUG', `Scoped container query yielded 0 matches for "${selector}", falling back to full document search`, { selector });
          }

          try {
            const found = doc.querySelectorAll(selector);
            results = results.concat(Array.from(found));
          } catch (selErr) {
            logBridge('WARN', `querySelectorAll failed for selector "${selector}": ${selErr?.message || selErr}`, { selector }, selErr);
          }

          // If doc is a ShadowRoot and selector is compound, also search suffixes
          if (selectorParts.length > 1 && !isTopLevel) {
            for (let p = 1; p < selectorParts.length; p++) {
              const suffix = selectorParts.slice(p).join(' ');
              try {
                const subFound = doc.querySelectorAll(suffix);
                results = results.concat(Array.from(subFound));
              } catch (_) {}
            }
          }

          try {
            const allNodes = doc.querySelectorAll('*');
            for (let i = 0; i < allNodes.length; i++) {
              const el = allNodes[i];
              if (el.shadowRoot && !visited.has(el.shadowRoot)) {
                results = results.concat(queryDeep(selector, el.shadowRoot, visited));
              }
              if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
                try {
                  const src = el.src || el.getAttribute?.('src') || '';
                  if (!src.startsWith('vscode-webview:') && !src.startsWith('http:') && !src.startsWith('https:')) {
                    const frameDoc = el.contentDocument || (el.contentWindow && el.contentWindow.document);
                    if (frameDoc && !visited.has(frameDoc)) {
                      results = results.concat(queryDeep(selector, frameDoc, visited));
                    }
                  }
                } catch (_) {
                  // Silently ignore cross-origin restrictions on iframes
                }
              }
            }
          } catch (traverseErr) {
            logBridge('WARN', `DOM tree traversal error during queryDeep: ${traverseErr?.message || traverseErr}`, { selector }, traverseErr);
          }
        }
      }
    } catch (err) {
      logBridge('ERROR', `Unexpected error in queryDeep: ${err?.message || err}`, { selector }, err);
    }

    return Array.from(new Set(results));
  }

  /**
   * Helper to check if an element is visible in the DOM.
   * When allowDisabled is true, elements with el.disabled === true are not rejected.
   */
  function isElementVisible(el, options = {}) {
    if (!el) return false;
    const allowDisabled = typeof options === 'boolean' ? options : Boolean(options && options.allowDisabled);
    if (el.disabled && !allowDisabled) return false;
    try {
      let curr = el;
      while (curr && curr.nodeType === 1) {
        if (curr.hasAttribute && curr.hasAttribute('hidden')) {
          return false;
        }
        if (curr.getAttribute && curr.getAttribute('aria-hidden') === 'true') {
          return false;
        }
        if (curr.style) {
          if (curr.style.display === 'none' || curr.style.visibility === 'hidden') {
            return false;
          }
        }
        if (typeof window !== 'undefined' && window.getComputedStyle) {
          try {
            const cs = window.getComputedStyle(curr);
            if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) {
              return false;
            }
          } catch (_) {}
        }
        curr = curr.parentElement || (curr.parentNode && curr.parentNode.nodeType === 1 ? curr.parentNode : null);
      }

      if (typeof el.getBoundingClientRect === 'function') {
        const rect = el.getBoundingClientRect();
        const isMonacoInputArea = (el.classList && el.classList.contains('inputarea')) ||
          (el.tagName === 'TEXTAREA' && typeof el.className === 'string' && el.className.includes('inputarea'));
        if (!isMonacoInputArea) {
          if (rect.width === 0 && rect.height === 0 && !el.offsetParent && el.style?.display === 'none') {
            return false;
          }
        }
      }
    } catch (visErr) {
      logBridge('WARN', `Error checking element visibility: ${visErr?.message || visErr}`, {}, visErr);
    }
    return true;
  }

  /**
   * Captures deep DOM state diagnostic snapshot when input resolution fails
   */
  function captureDomDiagnosticSnapshot(doc, evaluatedSelectors = []) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root) {
      return {
        timestamp: Date.now(),
        activeElement: { tagName: '', className: '', id: '', isContentEditable: false },
        textareas: [],
        contentEditables: [],
        shadowRootsCount: 0,
        iframes: [],
        evaluatedSelectors
      };
    }

    let activeElement = { tagName: '', className: '', id: '', isContentEditable: false };
    try {
      const activeEl = root.activeElement || (typeof document !== 'undefined' ? document.activeElement : null);
      if (activeEl) {
        activeElement = {
          tagName: activeEl.tagName || '',
          className: activeEl.className || '',
          id: activeEl.id || '',
          isContentEditable: Boolean(activeEl.getAttribute?.('contenteditable') === 'true' || activeEl.contentEditable === 'true' || activeEl.contentEditable === true)
        };
      }
    } catch (actErr) {
      logBridge('WARN', `Failed inspecting activeElement: ${actErr?.message || actErr}`, {}, actErr);
    }

    // Textareas
    const textareas = [];
    try {
      const taList = queryDeep('textarea', root);
      for (let i = 0; i < taList.length; i++) {
        const ta = taList[i];
        let rect = { width: 0, height: 0 };
        try {
          if (typeof ta.getBoundingClientRect === 'function') {
            const r = ta.getBoundingClientRect();
            rect = { width: r.width || 0, height: r.height || 0 };
          }
        } catch (_) {}

        textareas.push({
          className: ta.className || '',
          placeholder: ta.getAttribute?.('placeholder') || ta.placeholder || '',
          visible: isElementVisible(ta),
          disabled: Boolean(ta.disabled),
          rect
        });
      }
    } catch (taErr) {
      logBridge('WARN', `Failed inspecting textareas: ${taErr?.message || taErr}`, {}, taErr);
    }

    // ContentEditables
    const contentEditables = [];
    try {
      const ceList = queryDeep('[contenteditable="true"], div.monaco-editor, div.ProseMirror, div[data-lexical-editor="true"]', root);
      for (let i = 0; i < ceList.length; i++) {
        const ce = ceList[i];
        let rect = { width: 0, height: 0 };
        try {
          if (typeof ce.getBoundingClientRect === 'function') {
            const r = ce.getBoundingClientRect();
            rect = { width: r.width || 0, height: r.height || 0 };
          }
        } catch (_) {}

        contentEditables.push({
          tagName: ce.tagName || '',
          className: ce.className || '',
          role: ce.getAttribute?.('role') || ce.role || '',
          rect
        });
      }
    } catch (ceErr) {
      logBridge('WARN', `Failed inspecting contentEditables: ${ceErr?.message || ceErr}`, {}, ceErr);
    }

    // Count shadow roots
    let shadowRootsCount = 0;
    try {
      if (typeof root.querySelectorAll === 'function') {
        const allNodes = root.querySelectorAll('*');
        for (let i = 0; i < allNodes.length; i++) {
          if (allNodes[i].shadowRoot) {
            shadowRootsCount++;
          }
        }
      }
    } catch (srErr) {
      logBridge('WARN', `Failed counting shadow roots: ${srErr?.message || srErr}`, {}, srErr);
    }

    // Inspect iframes
    const iframes = [];
    try {
      const iframeList = queryDeep('iframe, frame', root);
      for (let i = 0; i < iframeList.length; i++) {
        const iframe = iframeList[i];
        let isAccessible = false;
        try {
          const frameDoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
          isAccessible = Boolean(frameDoc);
        } catch (_) {
          isAccessible = false;
        }

        iframes.push({
          id: iframe.id || '',
          src: iframe.src || iframe.getAttribute?.('src') || '',
          className: iframe.className || '',
          isAccessible
        });
      }
    } catch (ifErr) {
      logBridge('WARN', `Failed inspecting iframes: ${ifErr?.message || ifErr}`, {}, ifErr);
    }

    return {
      timestamp: Date.now(),
      activeElement,
      textareas,
      contentEditables,
      shadowRootsCount,
      iframes,
      evaluatedSelectors
    };
  }

  /**
   * Discovers the chat prompt input element using prioritized selector cascades.
   * If not found, captures a structured DomDiagnosticSnapshot.
   */
  function findChatInput(doc, outOptions = {}) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root) return null;

    const selectors = [
      'div[data-lexical-editor="true"]',
      'div[aria-label="Message input"]',
      '#antigravity\\.agentSidePanelInputBox [contenteditable="true"]',
      'div[contenteditable="true"][role="combobox"]',
      '.chat-widget .monaco-editor textarea.inputarea',
      '.interactive-session .monaco-editor textarea.inputarea',
      '.interactive-input .monaco-editor textarea.inputarea',
      'div.interactive-input-editor textarea',
      'textarea.interactive-input-editor',
      'div.monaco-editor textarea.inputarea',
      'div.monaco-editor[role="textbox"]',
      'div.ProseMirror[contenteditable="true"]',
      'div.ProseMirror',
      'div[contenteditable="true"][role="textbox"]',
      '[data-testid*="composer-input"]',
      '[data-testid*="chat-input"]',
      '[data-testid*="prompt-input"]',
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Prompt"]',
      'textarea[placeholder*="Chat"]',
      'textarea[placeholder*="Type"]',
      'textarea.inputarea',
      '[role="textbox"]'
    ];

    const evaluatedSelectors = [];

    for (let i = 0; i < selectors.length; i++) {
      const sel = selectors[i];
      const candidates = queryDeep(sel, root);
      evaluatedSelectors.push({ selector: sel, matches: candidates.length });

      for (let j = 0; j < candidates.length; j++) {
        const el = candidates[j];
        if (el && isElementVisible(el)) {
          return el;
        }
      }
    }

    // Capture diagnostic snapshot on failure
    const snapshot = captureDomDiagnosticSnapshot(root, evaluatedSelectors);
    findChatInput.lastSnapshot = snapshot;
    if (outOptions && typeof outOptions === 'object') {
      outOptions.snapshot = snapshot;
      outOptions.evaluatedSelectors = evaluatedSelectors;
    }

    logBridge('WARN', 'findChatInput failed to locate an active input element', {
      evaluatedCount: evaluatedSelectors.length,
      snapshot
    });

    return null;
  }

  /**
   * Locates the chat submit / send button.
   * Prioritizes scoped container searches and Antigravity-specific button attributes.
   * Generic icon selectors are strictly scoped to chat containers to prevent false positive clicks on workbench elements.
   * On failure, captures evaluated selectors and nearby button elements.
   */
  function findSendButton(contextOrDoc, outOptions = {}) {
    const root = (contextOrDoc && (contextOrDoc.ownerDocument || (contextOrDoc.nodeType === 9 ? contextOrDoc : null))) ||
      (typeof document !== 'undefined' ? document : null);
    if (!root && !contextOrDoc) return null;

    const evaluatedSelectors = [];

    // Specific Antigravity & chat submit button selectors
    const HIGH_PRIORITY_BUTTON_SELECTORS = [
      'button[data-testid="send-button"]',
      '[data-testid="send-button"]',
      'button[aria-label="Send message"]',
      'button[aria-label*="Send message"]',
      'button[title*="Send message"]',
      'button[data-tooltip-id*="send-tooltip"]',
      'button[data-tooltip-id*="send-button"]',
      '[data-tooltip-id*="send-tooltip"]',
      '[data-tooltip-id*="send-button"]',
      'button[aria-label*="Send"]',
      'button[title*="Send"]',
      'button[aria-label*="Submit"]',
      'button[title*="Submit"]',
      'button[aria-label*="Generate"]',
      'button[title*="Generate"]',
      'button[aria-label*="Accept"]',
      'button[title*="Accept"]',
      'button[type="submit"]',
      '[data-testid*="send-button"]',
      '[data-testid*="submit-button"]',
      'div.chat-input-toolbar button',
      'div.chat-input-actions button',
      '.chat-input-toolbar button',
      '.chat-input-actions button'
    ];

    // Generic codicon icon selectors (ONLY searched within scoped chat containers)
    const SCOPED_CODICON_SELECTORS = [
      'button.codicon-arrow-up',
      '.codicon-arrow-up',
      'button.codicon-send',
      '.codicon-send',
      'button.codicon-arrow-right',
      '.codicon-arrow-right'
    ];

    // Identify candidate containers (prioritizing contextOrDoc container if provided)
    const containers = [];
    const visitedContainers = new Set();

    if (contextOrDoc && contextOrDoc.nodeType === 1) {
      try {
        const closestContainer = (typeof contextOrDoc.closest === 'function')
          ? contextOrDoc.closest(CONTAINER_SELECTORS.join(', '))
          : null;
        if (closestContainer && !visitedContainers.has(closestContainer)) {
          visitedContainers.add(closestContainer);
          containers.push(closestContainer);
        }

        const isSelfContainer = CONTAINER_SELECTORS.some(sel => {
          try {
            return typeof contextOrDoc.matches === 'function' && contextOrDoc.matches(sel);
          } catch (_) {
            return false;
          }
        });
        if (isSelfContainer && !visitedContainers.has(contextOrDoc)) {
          visitedContainers.add(contextOrDoc);
          containers.push(contextOrDoc);
        }
      } catch (_) {}
    }

    // Query all chat containers from document
    if (root) {
      try {
        const docContainers = queryDeep(CONTAINER_SELECTORS.join(', '), root);
        for (let i = 0; i < docContainers.length; i++) {
          const c = docContainers[i];
          if (c && !visitedContainers.has(c)) {
            visitedContainers.add(c);
            containers.push(c);
          }
        }
      } catch (_) {}
    }

    // Helper to evaluate candidates for a selector
    function checkCandidates(candidates) {
      for (let j = 0; j < candidates.length; j++) {
        const el = candidates[j];
        if (!el) continue;

        const isIcon = el.classList && (
          el.classList.contains('codicon-send') ||
          el.classList.contains('codicon-arrow-up') ||
          el.classList.contains('codicon-arrow-right')
        );

        if (isIcon && el.tagName !== 'BUTTON') {
          const parentBtn = el.closest ? el.closest('button, [role="button"]') : el.parentElement;
          if (parentBtn && isElementVisible(parentBtn, { allowDisabled: true })) {
            return parentBtn;
          }
        }

        if (isElementVisible(el, { allowDisabled: true })) {
          return el;
        }
      }
      return null;
    }

    // 1. Scoped search inside chat containers: Tier 1 (High priority selectors)
    for (let c = 0; c < containers.length; c++) {
      const container = containers[c];
      for (let i = 0; i < HIGH_PRIORITY_BUTTON_SELECTORS.length; i++) {
        const sel = HIGH_PRIORITY_BUTTON_SELECTORS[i];
        let candidates = [];
        try {
          candidates = queryDeep(sel, container);
        } catch (_) {}
        evaluatedSelectors.push({ selector: `(scoped) ${sel}`, matches: candidates.length });
        const matched = checkCandidates(candidates);
        if (matched) {
          return matched;
        }
      }
    }

    // 2. Scoped search inside chat containers: Tier 2 (Generic codicons inside containers)
    for (let c = 0; c < containers.length; c++) {
      const container = containers[c];
      for (let i = 0; i < SCOPED_CODICON_SELECTORS.length; i++) {
        const sel = SCOPED_CODICON_SELECTORS[i];
        let candidates = [];
        try {
          candidates = queryDeep(sel, container);
        } catch (_) {}
        evaluatedSelectors.push({ selector: `(scoped-codicon) ${sel}`, matches: candidates.length });
        const matched = checkCandidates(candidates);
        if (matched) {
          return matched;
        }
      }
    }

    // 3. Fallback: Global document-level query (EXCLUDES generic codicon-arrow-right & action-label)
    if (root) {
      for (let i = 0; i < HIGH_PRIORITY_BUTTON_SELECTORS.length; i++) {
        const sel = HIGH_PRIORITY_BUTTON_SELECTORS[i];
        let candidates = [];
        try {
          candidates = queryDeep(sel, root);
        } catch (_) {}
        evaluatedSelectors.push({ selector: `(global) ${sel}`, matches: candidates.length });
        const matched = checkCandidates(candidates);
        if (matched) {
          return matched;
        }
      }
    }

    // If submit button not found, capture nearby button elements
    const nearbyButtons = [];
    try {
      const candidates = root ? queryDeep('button, [role="button"], .codicon-send, .codicon-arrow-up, .monaco-button, a.monaco-button', root) : [];
      for (let i = 0; i < candidates.length; i++) {
        const btn = candidates[i];
        if (!btn) continue;
        nearbyButtons.push({
          tagName: btn.tagName || '',
          className: btn.className || '',
          ariaLabel: btn.getAttribute?.('aria-label') || '',
          title: btn.getAttribute?.('title') || btn.title || '',
          codicon: Boolean(btn.classList && (btn.classList.contains('codicon-send') || btn.classList.contains('codicon-arrow-up') || btn.classList.contains('codicon-arrow-right') || (typeof btn.className === 'string' && btn.className.includes('codicon')))),
          visible: isElementVisible(btn, { allowDisabled: true }),
          disabled: Boolean(btn.disabled)
        });
      }
    } catch (btnErr) {
      logBridge('WARN', `Failed gathering nearby buttons: ${btnErr?.message || btnErr}`, {}, btnErr);
    }

    const failureDiag = {
      timestamp: Date.now(),
      evaluatedSelectors,
      nearbyButtons
    };

    findSendButton.lastDiagnostics = failureDiag;
    if (outOptions && typeof outOptions === 'object') {
      outOptions.diagnostics = failureDiag;
      outOptions.evaluatedSelectors = evaluatedSelectors;
      outOptions.nearbyButtons = nearbyButtons;
    }

    logBridge('WARN', 'findSendButton failed to locate submit button', {
      evaluatedCount: evaluatedSelectors.length,
      nearbyButtonCount: nearbyButtons.length
    });

    return null;
  }

  /**
   * Locates the "New Conversation" / "New Chat" button
   */
  function findNewConversationButton(doc) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root) return null;

    const selectors = [
      'a[data-tooltip-id="new-conversation-tooltip"]',
      'a[data-tooltip-id*="new-conversation"]',
      '[data-tooltip-id="new-conversation-tooltip"]',
      '[data-tooltip-id*="new-conversation"]',
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
          if (el.classList && (el.classList.contains('codicon-plus') || el.classList.contains('codicon-add')) && el.tagName !== 'BUTTON' && el.tagName !== 'A') {
            const parentBtn = el.closest ? el.closest('a, button, [role="button"]') : el.parentElement;
            if (parentBtn && isElementVisible(parentBtn, { allowDisabled: true })) {
              return parentBtn;
            }
          }
          if (isElementVisible(el, { allowDisabled: true })) {
            return el;
          }
        }
      }
    }

    // Fallback: Scan SVG paths for the plus icon in titlebar/toolbar
    try {
      const svgs = queryDeep('svg path', root);
      for (let k = 0; k < svgs.length; k++) {
        const p = svgs[k];
        const d = p?.getAttribute?.('d') || '';
        if (d.includes('M450-450H220') || d.includes('M450-450') || d.includes('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z')) {
          const anchorOrBtn = p.closest ? p.closest('a, button, [role="button"]') : p.parentElement;
          if (anchorOrBtn && isElementVisible(anchorOrBtn, { allowDisabled: true })) {
            return anchorOrBtn;
          }
        }
      }
    } catch (_) {}

    return null;
  }

  /**
   * Dispatches the full native pointer and mouse event cascade on a target button element
   */
  function dispatchButtonClickCascade(button, win) {
    if (!button) return false;
    const targetWin = win || (typeof window !== 'undefined' ? window : null);
    let anyDispatched = false;

    // 1. Pointerdown
    try {
      if (targetWin && typeof targetWin.PointerEvent === 'function') {
        button.dispatchEvent(new targetWin.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, composed: true }));
        anyDispatched = true;
      } else if (typeof PointerEvent !== 'undefined') {
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, composed: true }));
        anyDispatched = true;
      }
    } catch (_) {}

    // 2. Mousedown
    try {
      if (targetWin && typeof targetWin.MouseEvent === 'function') {
        button.dispatchEvent(new targetWin.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, composed: true }));
        anyDispatched = true;
      } else if (typeof MouseEvent !== 'undefined') {
        button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, composed: true }));
        anyDispatched = true;
      }
    } catch (_) {}

    // 3. Pointerup
    try {
      if (targetWin && typeof targetWin.PointerEvent === 'function') {
        button.dispatchEvent(new targetWin.PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, composed: true }));
        anyDispatched = true;
      } else if (typeof PointerEvent !== 'undefined') {
        button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, composed: true }));
        anyDispatched = true;
      }
    } catch (_) {}

    // 4. Mouseup
    try {
      if (targetWin && typeof targetWin.MouseEvent === 'function') {
        button.dispatchEvent(new targetWin.MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, composed: true }));
        anyDispatched = true;
      } else if (typeof MouseEvent !== 'undefined') {
        button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, composed: true }));
        anyDispatched = true;
      }
    } catch (_) {}

    // 5. Single Click Execution (Native button.click() OR synthetic MouseEvent click fallback)
    let clickExecuted = false;
    try {
      if (typeof button.click === 'function') {
        button.click();
        clickExecuted = true;
        anyDispatched = true;
      }
    } catch (clickErr) {
      logBridge('WARN', `button.click() failed: ${clickErr?.message || clickErr}`, {}, clickErr);
    }

    if (!clickExecuted) {
      try {
        if (targetWin && typeof targetWin.MouseEvent === 'function') {
          button.dispatchEvent(new targetWin.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, composed: true }));
          anyDispatched = true;
        } else if (typeof MouseEvent !== 'undefined') {
          button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, composed: true }));
          anyDispatched = true;
        }
      } catch (_) {}
    }

    return anyDispatched;
  }

  /**
   * Injects prompt text into active chat input and triggers submit with step-by-step diagnostics
   */
  async function injectPromptAndSubmit(promptText, options = {}) {
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    if (!doc) {
      const err = new Error('DOM document not available for prompt injection');
      logBridge('ERROR', err.message);
      throw err;
    }

    const steps = [];

    // Step 1: Input discovery & focus
    const inputDiag = {};
    const inputElem = options.targetElement || findChatInput(doc, inputDiag);
    if (!inputElem) {
      const err = new Error('No valid chat input element found in DOM');
      const snapshot = inputDiag.snapshot || findChatInput.lastSnapshot || captureDomDiagnosticSnapshot(doc);
      err.domSnapshot = snapshot;
      steps.push({
        step: 1,
        name: 'Input discovery & focus',
        status: 'failed',
        error: err.message,
        domSnapshot: snapshot
      });
      err.steps = steps;
      logBridge('ERROR', err.message, { snapshot });
      throw err;
    }

    let focused = false;
    try {
      if (typeof inputElem.focus === 'function') {
        inputElem.focus({ preventScroll: true });
        focused = true;
      }
    } catch (focusErr) {
      logBridge('WARN', `inputElem.focus() failed: ${focusErr?.message || focusErr}`, {}, focusErr);
    }

    // Pre-Injection Focus Guard: if element is not active element, attempt focus on parent container editor
    if (doc.activeElement && doc.activeElement !== inputElem) {
      try {
        const parentEditor = (inputElem.closest && inputElem.closest('.monaco-editor, .chat-widget, .interactive-session, #antigravity\\.agentSidePanelInputBox, div[id*="agentSidePanelInputBox"], .composer-container, .interactive-input')) || inputElem.parentElement;
        if (parentEditor && typeof parentEditor.focus === 'function') {
          parentEditor.focus({ preventScroll: true });
        }
      } catch (parentFocusErr) {
        logBridge('DEBUG', `parentEditor.focus() failed: ${parentFocusErr?.message || parentFocusErr}`, {}, parentFocusErr);
      }
    }

    steps.push({
      step: 1,
      name: 'Input discovery & focus',
      status: 'success',
      details: {
        tagName: inputElem.tagName,
        className: inputElem.className,
        focused
      }
    });

    // Step 2: Content injection
    let injectionStrategy = 'direct';
    const isInputOrTextarea = inputElem.tagName === 'TEXTAREA' || inputElem.tagName === 'INPUT';
    const isContentEditable = inputElem.getAttribute?.('contenteditable') === 'true' ||
      inputElem.contentEditable === 'true' ||
      inputElem.contentEditable === true ||
      inputElem.classList?.contains('ProseMirror') ||
      inputElem.classList?.contains('monaco-editor') ||
      inputElem.hasAttribute?.('data-lexical-editor') ||
      inputElem.getAttribute?.('role') === 'textbox' ||
      inputElem.getAttribute?.('role') === 'combobox';

    let valueSet = false;

    // Strategy 1: Monaco Editor Model API
    try {
      if (win && win.monaco && win.monaco.editor) {
        let editorInstance = null;
        if (typeof win.monaco.editor.getEditors === 'function') {
          const editors = win.monaco.editor.getEditors();
          if (Array.isArray(editors)) {
            for (let i = 0; i < editors.length; i++) {
              const ed = editors[i];
              if (!ed) continue;
              const domNode = typeof ed.getDomNode === 'function' ? ed.getDomNode() : null;
              if (domNode && (
                domNode === inputElem ||
                (typeof domNode.contains === 'function' && domNode.contains(inputElem)) ||
                (typeof inputElem.contains === 'function' && inputElem.contains(domNode)) ||
                (inputElem.closest && inputElem.closest('.monaco-editor') === domNode)
              )) {
                editorInstance = ed;
                break;
              }
            }
          }
        }
        if (editorInstance) {
          const model = typeof editorInstance.getModel === 'function' ? editorInstance.getModel() : null;
          if (model) {
            if (typeof model.getFullModelRange === 'function' && typeof editorInstance.executeEdits === 'function') {
              editorInstance.executeEdits('autoplan', [{
                range: model.getFullModelRange(),
                text: promptText,
                forceMoveMarkers: true
              }]);
              if (typeof editorInstance.setPosition === 'function' && typeof model.getPositionAt === 'function') {
                editorInstance.setPosition(model.getPositionAt(promptText.length));
              }
              valueSet = true;
              injectionStrategy = 'monaco-model';
            } else if (typeof model.setValue === 'function') {
              model.setValue(promptText);
              valueSet = true;
              injectionStrategy = 'monaco-model';
            }
          }
        }
      }
    } catch (monacoErr) {
      logBridge('WARN', `Monaco editor model injection error: ${monacoErr?.message || monacoErr}`, {}, monacoErr);
    }

    // Strategy 2: document.execCommand('insertText') (Antigravity Lexical & ContentEditable)
    if (!valueSet && !isInputOrTextarea && doc && typeof doc.execCommand === 'function') {
      try {
        if (typeof inputElem.focus === 'function') {
          inputElem.focus({ preventScroll: true });
        }
        // Force selection to cover all child node contents inside Lexical / ContentEditable container
        try {
          const sel = (win && typeof win.getSelection === 'function') ? win.getSelection() : (doc.defaultView?.getSelection() || null);
          if (sel && typeof doc.createRange === 'function') {
            const range = doc.createRange();
            range.selectNodeContents(inputElem);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch (_) {}
        doc.execCommand('selectAll', false, null);
        const execSuccess = doc.execCommand('insertText', false, promptText);
        if (execSuccess) {
          valueSet = true;
          injectionStrategy = 'execCommand';
        }
      } catch (cmdErr) {
        logBridge('WARN', `doc.execCommand failed: ${cmdErr?.message || cmdErr}`, {}, cmdErr);
      }
    }

    // Strategy 3: ProseMirror / Lexical Direct View & Transaction Dispatch
    if (!valueSet) {
      try {
        const pmContainer = (inputElem.closest && inputElem.closest('.ProseMirror')) || inputElem;
        const pmView = inputElem.pmViewDesc?.view ||
          inputElem._pmView ||
          pmContainer?.pmViewDesc?.view ||
          pmContainer?._pmView;

        if (pmView) {
          if (typeof pmView.pasteText === 'function') {
            pmView.pasteText(promptText);
            valueSet = true;
            injectionStrategy = 'prosemirror-view';
          } else if (pmView.state && typeof pmView.dispatch === 'function' && pmView.state.schema) {
            const schema = pmView.state.schema;
            const tr = pmView.state.tr;
            if (schema.text && tr && typeof tr.replaceWith === 'function') {
              const docSize = pmView.state.doc?.content?.size || (pmView.state.doc?.nodeSize ? pmView.state.doc.nodeSize - 2 : 0) || 0;
              tr.replaceWith(0, docSize, schema.text(promptText));
              pmView.dispatch(tr);
              valueSet = true;
              injectionStrategy = 'prosemirror-transaction';
            }
          }
        }
      } catch (pmErr) {
        logBridge('WARN', `ProseMirror view/transaction dispatch error: ${pmErr?.message || pmErr}`, {}, pmErr);
      }
    }

    // Strategy 4: Direct property assignment & synthetic events (Textarea / Input)
    if (!valueSet && isInputOrTextarea) {
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
      } catch (biErr) {
        logBridge('WARN', `beforeinput dispatch failed: ${biErr?.message || biErr}`, {}, biErr);
      }

      // Value setter with descriptor fallback (bypassing React / framework state proxy setters)
      let descSet = false;
      const proto = inputElem.tagName === 'TEXTAREA'
        ? (win?.HTMLTextAreaElement?.prototype || (typeof HTMLTextAreaElement !== 'undefined' ? HTMLTextAreaElement.prototype : null))
        : (win?.HTMLInputElement?.prototype || (typeof HTMLInputElement !== 'undefined' ? HTMLInputElement.prototype : null));

      if (proto) {
        try {
          const desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && desc.set) {
            desc.set.call(inputElem, promptText);
            descSet = true;
          }
        } catch (vErr) {
          logBridge('WARN', `Prototype value descriptor set failed: ${vErr?.message || vErr}`, {}, vErr);
        }
      }
      if (!descSet) {
        inputElem.value = promptText;
      }
      valueSet = true;
      injectionStrategy = 'textarea-value';
    } else if (!valueSet) {
      // Strategy 5: ContentEditable / Text Direct Fallback
      if (typeof inputElem.innerText !== 'undefined') {
        inputElem.innerText = promptText;
      } else {
        inputElem.textContent = promptText;
      }
      valueSet = true;
      injectionStrategy = 'contenteditable-text';
    }

    steps.push({
      step: 2,
      name: 'Content injection',
      status: 'success',
      strategy: injectionStrategy,
      charsInjected: promptText.length
    });

    // Step 3: Event dispatching
    const dispatchedEvents = [];
    try {
      if (win && typeof win.InputEvent === 'function') {
        inputElem.dispatchEvent(new win.InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: promptText
        }));
        dispatchedEvents.push('input');
      } else if (win && typeof win.Event === 'function') {
        inputElem.dispatchEvent(new win.Event('input', { bubbles: true, cancelable: true }));
        dispatchedEvents.push('input');
      }
    } catch (inErr) {
      logBridge('WARN', `input event dispatch failed: ${inErr?.message || inErr}`, {}, inErr);
    }

    try {
      if (win && typeof win.Event === 'function') {
        inputElem.dispatchEvent(new win.Event('change', { bubbles: true, cancelable: true }));
        dispatchedEvents.push('change');
      }
    } catch (chErr) {
      logBridge('WARN', `change event dispatch failed: ${chErr?.message || chErr}`, {}, chErr);
    }

    steps.push({
      step: 3,
      name: 'Event dispatching',
      status: 'success',
      events: dispatchedEvents
    });

    // Step 3.5: State sync micro-tick (25-50ms) to allow Lexical AST and React batch updates
    const syncDelayMs = options.syncDelayMs !== undefined ? options.syncDelayMs : 30;
    if (syncDelayMs > 0) {
      await new Promise(r => setTimeout(r, syncDelayMs));
    }

    // Step 4: Submit triggering (Enter keydown/keypress/keyup + pointer/mouse button cascade + button polling + double-tap retry + form fallback)
    let submitStrategy = 'enterKey';
    let enterDispatched = false;
    let sendButtonClicked = false;
    let doubleTapExecuted = false;
    let formSubmitted = false;

    // Helper to evaluate if button is disabled or aria-disabled
    const isButtonDisabled = (btn) => {
      if (!btn) return true;
      if (btn.disabled) return true;
      if (btn.getAttribute) {
        if (btn.getAttribute('aria-disabled') === 'true' || btn.getAttribute('disabled') !== null) {
          return true;
        }
      }
      if (btn.classList && (btn.classList.contains('disabled') || btn.classList.contains('monaco-button-disabled'))) {
        return true;
      }
      return false;
    };

    const sendBtnDiag = {};
    let sendBtn = options.sendButton || findSendButton(inputElem || doc, sendBtnDiag);

    // Button Enablement Polling (up to 250ms/300ms)
    const maxPollMs = options.pollTimeoutMs !== undefined ? options.pollTimeoutMs : 250;
    const pollIntervalMs = options.pollIntervalMs !== undefined ? options.pollIntervalMs : 25;
    const pollStart = Date.now();
    let buttonWaitDurationMs = 0;
    let initialDisabled = sendBtn ? isButtonDisabled(sendBtn) : true;

    if (sendBtn && initialDisabled && maxPollMs > 0) {
      while (Date.now() - pollStart < maxPollMs) {
        await new Promise(r => setTimeout(r, pollIntervalMs));
        if (!isButtonDisabled(sendBtn)) {
          break;
        }
        const refreshedBtn = options.sendButton || findSendButton(inputElem || doc);
        if (refreshedBtn) {
          sendBtn = refreshedBtn;
          if (!isButtonDisabled(sendBtn)) {
            break;
          }
        }
      }
      buttonWaitDurationMs = Date.now() - pollStart;
    } else if (!sendBtn && maxPollMs > 0) {
      while (Date.now() - pollStart < maxPollMs) {
        await new Promise(r => setTimeout(r, pollIntervalMs));
        sendBtn = options.sendButton || findSendButton(inputElem || doc, sendBtnDiag);
        if (sendBtn) {
          if (!isButtonDisabled(sendBtn)) {
            break;
          }
        }
      }
      buttonWaitDurationMs = Date.now() - pollStart;
    }

    // Mutually Exclusive Triggering Strategy:
    // 1. Primary Strategy (buttonClick): If sendBtn is found and is not disabled, dispatch button click cascade only.
    if (sendBtn && !isButtonDisabled(sendBtn)) {
      dispatchButtonClickCascade(sendBtn, win);
      sendButtonClicked = true;
      submitStrategy = 'buttonClick';
      enterDispatched = false;

      // Double-Tap Submission Guard (asynchronous retry only if explicitly requested or transitionally disabled)
      const isStillDisabled = isButtonDisabled(sendBtn);
      const shouldDoubleTap = Boolean(
        options.doubleTap === true ||
        options.doubleTapRetry === true ||
        (initialDisabled && isStillDisabled)
      );

      if (shouldDoubleTap) {
        const retryDelay = options.doubleTapDelayMs !== undefined ? options.doubleTapDelayMs : 50;
        if (retryDelay > 0) {
          await new Promise(r => setTimeout(r, retryDelay));
        }
        const recheckedBtn = options.sendButton || findSendButton(inputElem || doc) || sendBtn;
        if (recheckedBtn && !isButtonDisabled(recheckedBtn)) {
          dispatchButtonClickCascade(recheckedBtn, win);
          doubleTapExecuted = true;
          sendBtn = recheckedBtn;
        }
      }
    } else {
      // 2. Fallback Strategy (enterKey): Only if sendBtn is NOT present or disabled
      try {
        const KbEventClass = (win && win.KeyboardEvent) || (typeof KeyboardEvent !== 'undefined' ? KeyboardEvent : null);
        if (KbEventClass) {
          const kbEventInit = {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            charCode: 13,
            bubbles: true,
            cancelable: true,
            composed: true
          };

          // 1. keydown
          try {
            const kd = new KbEventClass('keydown', kbEventInit);
            inputElem.dispatchEvent(kd);
          } catch (_) {}

          // 2. keypress (critical for Lexical & ProseMirror input handlers)
          try {
            const kp = new KbEventClass('keypress', kbEventInit);
            inputElem.dispatchEvent(kp);
          } catch (_) {}

          // 3. keyup
          try {
            const ku = new KbEventClass('keyup', kbEventInit);
            inputElem.dispatchEvent(ku);
          } catch (_) {}

          enterDispatched = true;
          submitStrategy = 'enterKey';
        }
      } catch (kbErr) {
        logBridge('WARN', `KeyboardEvent dispatch failed: ${kbErr?.message || kbErr}`, {}, kbErr);
      }

      // 3. Form Fallback Strategy (formSubmit): If neither buttonClick nor enterKey succeeded
      if (!sendButtonClicked && !enterDispatched) {
        const form = (sendBtn && (sendBtn.form || (typeof sendBtn.closest === 'function' && sendBtn.closest('form')))) ||
          (inputElem && (inputElem.form || (typeof inputElem.closest === 'function' && inputElem.closest('form'))));

        if (form) {
          try {
            if (typeof form.requestSubmit === 'function') {
              if (sendBtn && (sendBtn.form === form || (typeof sendBtn.closest === 'function' && sendBtn.closest('form') === form))) {
                form.requestSubmit(sendBtn);
              } else {
                form.requestSubmit();
              }
              formSubmitted = true;
            } else {
              const EventClass = (win && win.Event) || (typeof Event !== 'undefined' ? Event : null);
              if (EventClass) {
                form.dispatchEvent(new EventClass('submit', { bubbles: true, cancelable: true }));
                formSubmitted = true;
              }
            }
            if (formSubmitted) {
              submitStrategy = 'formSubmit';
            }
          } catch (formErr) {
            logBridge('WARN', `Form submission fallback failed: ${formErr?.message || formErr}`, {}, formErr);
          }
        }
      }
    }

    const isDocHidden = Boolean(doc?.hidden || (typeof document !== 'undefined' && document.hidden));
    const isBackgroundSubmission = Boolean(options.isBackground || isDocHidden);
    const isSuccess = Boolean(sendButtonClicked || formSubmitted || enterDispatched);

    steps.push({
      step: 4,
      name: 'Submit triggering',
      status: isSuccess ? 'success' : 'failed',
      submitStrategy,
      enterDispatched,
      sendButtonClicked,
      doubleTapExecuted,
      formSubmitted,
      buttonSelector: sendBtn?.className || sendBtn?.tagName || null,
      buttonWaitDurationMs,
      initialDisabled,
      sendButtonDiagnostics: !sendButtonClicked ? sendBtnDiag.diagnostics : undefined
    });

    const report = {
      success: isSuccess,
      isBackgroundSubmission,
      submitStrategy,
      injectionStrategy,
      sendButtonClicked,
      enterDispatched,
      doubleTapExecuted,
      formSubmitted,
      buttonSelector: sendBtn?.className || sendBtn?.tagName || null,
      buttonWaitDurationMs,
      initialDisabled,
      charsInjected: promptText.length,
      steps,
      diagnostics: {
        timestamp: Date.now(),
        isBackground: isBackgroundSubmission,
        documentHidden: isDocHidden,
        submitStrategy,
        doubleTapExecuted,
        buttonWaitDurationMs,
        initialDisabled,
        steps
      }
    };

    logBridge('INFO', `Prompt injected and submitted (${promptText.length} chars, strategy=${injectionStrategy}, submitStrategy=${submitStrategy}, sendClicked=${sendButtonClicked}, doubleTap=${doubleTapExecuted}, background=${isBackgroundSubmission})`, {
      injectionStrategy,
      submitStrategy,
      sendButtonClicked,
      enterDispatched,
      doubleTapExecuted,
      formSubmitted,
      isBackgroundSubmission,
      steps
    });

    return report;
  }

  /**
   * Triggers a New Conversation / New Chat in the Antigravity chat panel
   */
  async function triggerNewConversation(options = {}) {
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const newBtn = options.button || findNewConversationButton(doc);
    if (newBtn) {
      try {
        dispatchButtonClickCascade(newBtn, win);
        if (typeof newBtn.click === 'function') {
          newBtn.click();
        }
        logBridge('INFO', 'New Conversation button triggered successfully');
        return true;
      } catch (err) {
        logBridge('ERROR', `Error clicking New Conversation button: ${err?.message || err}`, {}, err);
        return false;
      }
    }
    logBridge('WARN', 'triggerNewConversation: No New Conversation button found to click');
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
      return { stop: () => {}, scanNow: () => 0 };
    }

    let isStopped = false;

    function scanAndApprove() {
      if (isStopped) return 0;
      let approvedCount = 0;

      const candidates = queryDeep('button, [role="button"], .monaco-button, .dialog-button, a.monaco-button', doc);
      for (let i = 0; i < candidates.length; i++) {
        const btn = candidates[i];
        if (!btn || !isElementVisible(btn)) continue;

        const text = (btn.textContent || btn.innerText || btn.getAttribute?.('aria-label') || '').trim();
        if (!text) continue;

        for (let p = 0; p < targetPatterns.length; p++) {
          const pat = targetPatterns[p];
          if (text === pat || text.toLowerCase() === pat.toLowerCase() || (text.length < 50 && text.includes(pat))) {
            try {
              if (typeof btn.click === 'function') {
                btn.click();
                approvedCount++;
                logBridge('INFO', `Auto-approved permission dialog button: "${pat}"`, { pattern: pat });
                if (typeof onApproved === 'function') {
                  onApproved(pat, btn);
                }
              }
            } catch (clickErr) {
              logBridge('WARN', `Auto-approver button click failed: ${clickErr?.message || clickErr}`, { pattern: pat }, clickErr);
            }
            break;
          }
        }
      }

      return approvedCount;
    }

    // 1. Initial immediate scan
    scanAndApprove();

    // Throttled scan helper
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
      } catch (obsErr) {
        logBridge('WARN', `MutationObserver initialization failed: ${obsErr?.message || obsErr}`, {}, obsErr);
      }
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
   * Unthrottled Web Worker-based timer for background execution.
   * Falls back to standard setInterval if Worker or Blob URL is unavailable.
   */
  function createWorkerTimer(callback, intervalMs = DEFAULT_POLL_INTERVAL_MS, options = {}) {
    const customWorker = options.Worker || (typeof Worker !== 'undefined' ? Worker : null);
    const customBlob = options.Blob || (typeof Blob !== 'undefined' ? Blob : null);
    const customURL = options.URL || (typeof URL !== 'undefined' ? URL : null);

    if (customWorker && customBlob && customURL && typeof customURL.createObjectURL === 'function') {
      try {
        const workerCode = `
          let timer = null;
          self.onmessage = function(e) {
            if (e.data === 'start') {
              if (timer) clearInterval(timer);
              timer = setInterval(function() {
                self.postMessage('tick');
              }, ${Math.max(10, intervalMs || 500)});
            } else if (e.data === 'stop') {
              if (timer) clearInterval(timer);
              timer = null;
            }
          };
        `;
        const blob = new customBlob([workerCode], { type: 'application/javascript' });
        const blobUrl = customURL.createObjectURL(blob);
        const worker = new customWorker(blobUrl);

        worker.onmessage = function(e) {
          if (e.data === 'tick' && typeof callback === 'function') {
            try {
              callback();
            } catch (cbErr) {
              logBridge('WARN', `Error in worker timer callback: ${cbErr?.message || cbErr}`, {}, cbErr);
            }
          }
        };

        worker.postMessage('start');

        return {
          type: 'worker',
          worker,
          blobUrl,
          stop: function() {
            try {
              worker.postMessage('stop');
              if (typeof worker.terminate === 'function') {
                worker.terminate();
              }
              if (typeof customURL.revokeObjectURL === 'function') {
                customURL.revokeObjectURL(blobUrl);
              }
            } catch (_) {}
          }
        };
      } catch (err) {
        logBridge('WARN', `Web Worker timer initialization failed, falling back to setInterval: ${err?.message || err}`, {}, err);
      }
    }

    // Fallback to standard setInterval
    const intervalId = setInterval(() => {
      if (typeof callback === 'function') {
        try {
          callback();
        } catch (cbErr) {
          logBridge('WARN', `Error in interval timer callback: ${cbErr?.message || cbErr}`, {}, cbErr);
        }
      }
    }, intervalMs);

    return {
      type: 'interval',
      timerId: intervalId,
      stop: function() {
        clearInterval(intervalId);
      }
    };
  }

  /**
   * DOM Bridge Client Coordinator
   * Connects to local Bridge Server, polls for commands, executes actions, streams telemetry, and returns ACKs.
   */
  class DomBridgeClient {
    constructor(options = {}) {
      this.portStart = options.portStart || DEFAULT_PORT_START;
      this.portEnd = options.portEnd || DEFAULT_PORT_END;
      this.serverPort = options.serverPort || null;
      this.windowKey = options.windowKey || (typeof window !== 'undefined' && window.__AUTOPLAN_WINDOW_KEY__) || `dom_win_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      this.pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
      this.heartbeatIntervalMs = options.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS;
      this.fetchFn = options.fetch || (typeof fetch !== 'undefined' ? fetch.bind(global) : null);
      this.approvalObserver = null;
      this.pollTimer = null;
      this.workerTimer = null;
      this.heartbeatTimer = null;
      this.customWorker = options.Worker;
      this.customBlob = options.Blob;
      this.customURL = options.URL;
      this.isRunning = false;
      this.isSubmitting = false;
      this.lastSubmissionTime = 0;
      this.autoApprovalEnabled = options.autoApproval !== false;
      this.customDocument = options.document;
      this.customWindow = options.window;
      this.clientVersion = '2.0.0';
      this.logQueue = [];
      this.maxLogQueueCapacity = 50;

      activeClientInstance = this;

      // Drain any logs produced before client instantiation
      while (earlyLogBuffer.length > 0) {
        const item = earlyLogBuffer.shift();
        item.details = { ...(item.details || {}), windowKey: this.windowKey };
        this.logQueue.push(item);
      }
    }

    /**
     * Sends structured client telemetry to BridgeServer POST /autoplan-log
     * Buffers logs in memory (capacity 50) before port discovery completes.
     */
    async sendClientLog(level, message, details = {}) {
      const lvl = (level || 'INFO').toUpperCase();
      const logEntry = {
        level: lvl,
        component: 'CLIENT',
        message: message || '',
        details: {
          ...details,
          windowKey: this.windowKey
        },
        timestamp: Date.now()
      };

      const prefix = `[Auto-Plan DOM Bridge] [${lvl}]`;
      try {
        if (lvl === 'ERROR') {
          console.error(`${prefix} ${message}`, details);
        } else if (lvl === 'WARN') {
          console.warn(`${prefix} ${message}`, details);
        } else if (lvl === 'DEBUG') {
          console.debug(`${prefix} ${message}`, details);
        } else {
          console.log(`${prefix} ${message}`, details);
        }
      } catch (_) {}

      if (this.serverPort && this.fetchFn) {
        try {
          const logsToSend = this.logQueue.length > 0
            ? [...this.logQueue.splice(0, this.logQueue.length), logEntry]
            : [logEntry];

          await this.fetchFn(`http://127.0.0.1:${this.serverPort}/autoplan-log`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Window-Key': this.windowKey
            },
            body: JSON.stringify({
              windowKey: this.windowKey,
              logs: logsToSend
            })
          });
          return true;
        } catch (postErr) {
          logBridge('WARN', `Failed posting client log to BridgeServer: ${postErr?.message || postErr}`, { port: this.serverPort }, postErr);
          if (this.logQueue.length < this.maxLogQueueCapacity) {
            this.logQueue.push(logEntry);
          }
          return false;
        }
      } else {
        if (this.logQueue.length >= this.maxLogQueueCapacity) {
          this.logQueue.shift();
        }
        this.logQueue.push(logEntry);
        return false;
      }
    }

    /**
     * Flushes queued startup logs to BridgeServer
     */
    async flushStartupLogQueue() {
      if (!this.serverPort || !this.fetchFn || this.logQueue.length === 0) {
        return 0;
      }
      try {
        const queuedLogs = this.logQueue.splice(0, this.logQueue.length);
        await this.fetchFn(`http://127.0.0.1:${this.serverPort}/autoplan-log`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Window-Key': this.windowKey
          },
          body: JSON.stringify({
            windowKey: this.windowKey,
            logs: queuedLogs
          })
        });
        return queuedLogs.length;
      } catch (err) {
        logBridge('WARN', `Failed to flush log queue: ${err?.message || err}`, {}, err);
        return 0;
      }
    }

    /**
     * Dedicated background heartbeat ping to keep client registration alive in BridgeServer
     */
    async sendHeartbeatPing() {
      if (!this.serverPort) {
        try {
          await this.discoverPort();
        } catch (_) {}
        if (!this.serverPort) return false;
      }

      if (!this.fetchFn) return false;

      try {
        const url = `http://127.0.0.1:${this.serverPort}/autoplan-heartbeat?windowKey=${encodeURIComponent(this.windowKey)}`;
        const res = await this.fetchFn(url, {
          method: 'GET',
          headers: { 'X-Window-Key': this.windowKey }
        });
        if (res && res.status === 200) {
          return true;
        } else if (res && res.status === 404) {
          this.serverPort = null;
        }
      } catch (err) {
        logBridge('DEBUG', `Heartbeat ping error: ${err?.message || err}`, { port: this.serverPort });
        this.serverPort = null;
      }
      return false;
    }

    /**
     * Auto-discovers the running bridge server port and records startup telemetry
     */
    async discoverPort() {
      const win = this.customWindow || (typeof window !== 'undefined' ? window : null);
      const doc = this.customDocument || (typeof document !== 'undefined' ? document : null);
      const windowUrl = (win && win.location && win.location.href) ? win.location.href : (typeof location !== 'undefined' ? location.href : 'electron://workbench.html');
      const docTitle = doc?.title || (typeof document !== 'undefined' ? document.title : 'Antigravity Workbench');

      await this.sendClientLog('INFO', `Initializing DOM Bridge Client v${this.clientVersion}`, {
        clientVersion: this.clientVersion,
        windowKey: this.windowKey,
        url: windowUrl,
        documentTitle: docTitle
      });

      if (this.serverPort) {
        await this.flushStartupLogQueue();
        return this.serverPort;
      }

      if (typeof window !== 'undefined' && window.__AUTOPLAN_PORT__) {
        this.serverPort = window.__AUTOPLAN_PORT__;
        await this.sendClientLog('INFO', `Discovered BridgeServer via window global on port ${this.serverPort}`, {
          port: this.serverPort
        });
        await this.flushStartupLogQueue();
        return this.serverPort;
      }

      if (!this.fetchFn) {
        const err = new Error('fetch implementation is required for port discovery');
        await this.sendClientLog('ERROR', err.message);
        throw err;
      }

      await this.sendClientLog('DEBUG', `Probing BridgeServer port range ${this.portStart}-${this.portEnd}...`, {
        portStart: this.portStart,
        portEnd: this.portEnd
      });

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
              await this.sendClientLog('INFO', `Connected to BridgeServer on port ${this.serverPort}`, {
                port: this.serverPort,
                windowKey: this.windowKey
              });
              await this.flushStartupLogQueue();
              return port;
            }
          }
        } catch (probeErr) {
          // Port not listening or connection refused, continue probe
        }
      }

      await this.sendClientLog('WARN', `Port discovery completed: No active BridgeServer found in range ${this.portStart}-${this.portEnd}`, {
        portStart: this.portStart,
        portEnd: this.portEnd
      });

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
        logBridge('WARN', `Failed to send ACK to BridgeServer on port ${this.serverPort}: ${err?.message || err}`, { commandId, status }, err);
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

        const url = `http://127.0.0.1:${this.serverPort}/autoplan-status?windowKey=${encodeURIComponent(this.windowKey)}&clientVersion=${this.clientVersion}`;
        const res = await this.fetchFn(url, {
          method: 'GET',
          headers: { 'X-Window-Key': this.windowKey }
        });

        if (!res || res.status !== 200) {
          if (res && res.status === 404) {
            logBridge('WARN', `BridgeServer on port ${this.serverPort} returned 404, resetting serverPort`, { port: this.serverPort });
            this.serverPort = null;
            // Immediate re-discovery probe
            await this.discoverPort();
          }
          return;
        }

        const data = await res.json();
        if (data && Array.isArray(data.pendingCommands)) {
          for (let i = 0; i < data.pendingCommands.length; i++) {
            await this.handleCommand(data.pendingCommands[i]);
          }
        }
      } catch (pollErr) {
        logBridge('WARN', `DOM Bridge polling tick error: ${pollErr?.message || pollErr}`, { port: this.serverPort }, pollErr);
        this.serverPort = null;
        // Immediate discovery probe without halting worker loop
        try {
          await this.discoverPort();
        } catch (_) {}
      }
    }

    /**
     * Injects prompt text and triggers submission guarded by in-memory concurrency mutex and 500ms debounce
     */
    async injectPrompt(promptText, options = {}) {
      const bypassLock = Boolean(options.force === true || options.bypassLock === true);
      const minInterval = options.debounceMs !== undefined ? options.debounceMs : 500;
      const now = Date.now();

      if (!bypassLock) {
        if (this.isSubmitting) {
          const err = new Error('Submission blocked: concurrent submission in progress');
          err.code = 'CONCURRENT_SUBMISSION_BLOCKED';
          throw err;
        }
        if (now - this.lastSubmissionTime < minInterval) {
          const err = new Error(`Submission debounced: throttled within ${minInterval}ms window`);
          err.code = 'SUBMISSION_DEBOUNCED';
          throw err;
        }
      }

      this.isSubmitting = true;
      try {
        const result = await injectPromptAndSubmit(promptText, {
          document: this.customDocument,
          window: this.customWindow,
          ...options
        });
        this.lastSubmissionTime = Date.now();
        return result;
      } finally {
        this.isSubmitting = false;
      }
    }

    /**
     * Executes a received command
     */
    async handleCommand(cmd) {
      if (!cmd || !cmd.id) return;

      try {
        if (cmd.type === 'sendPrompt') {
          const result = await this.injectPrompt(cmd.text || '', cmd.options || {});

          await this.sendAck(cmd.id, 'submitClicked', null, {
            ...result,
            isBackgroundSubmission: Boolean(
              result?.isBackgroundSubmission ||
              (this.customDocument ? this.customDocument.hidden : (typeof document !== 'undefined' && document.hidden))
            )
          });
        } else if (cmd.type === 'openNewConversation') {
          const success = await triggerNewConversation({
            document: this.customDocument,
            window: this.customWindow,
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
        const metadata = {};
        if (err?.domSnapshot) {
          metadata.domSnapshot = err.domSnapshot;
        }
        if (err?.steps) {
          metadata.steps = err.steps;
        }

        await this.sendClientLog('ERROR', `Command ${cmd.id} (${cmd.type}) execution failed: ${err?.message || err}`, {
          commandId: cmd.id,
          error: err?.message || String(err),
          metadata
        });

        await this.sendAck(cmd.id, 'error', err?.message || String(err), metadata);
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

      // Initial immediate discovery, tick, and heartbeat
      this.pollTick();
      this.sendHeartbeatPing();

      // Start unthrottled worker timer for polling loop
      this.workerTimer = createWorkerTimer(
        () => {
          if (this.isRunning) {
            this.pollTick();
          }
        },
        this.pollIntervalMs,
        {
          Worker: this.customWorker || (typeof Worker !== 'undefined' ? Worker : null),
          Blob: this.customBlob || (typeof Blob !== 'undefined' ? Blob : null),
          URL: this.customURL || (typeof URL !== 'undefined' ? URL : null)
        }
      );

      // Start background heartbeat loop
      this.heartbeatTimer = createWorkerTimer(
        () => {
          if (this.isRunning) {
            this.sendHeartbeatPing();
          }
        },
        this.heartbeatIntervalMs,
        {
          Worker: this.customWorker || (typeof Worker !== 'undefined' ? Worker : null),
          Blob: this.customBlob || (typeof Blob !== 'undefined' ? Blob : null),
          URL: this.customURL || (typeof URL !== 'undefined' ? URL : null)
        }
      );
    }

    /**
     * Stops the client polling and observers
     */
    stop() {
      this.isRunning = false;
      if (this.workerTimer) {
        this.workerTimer.stop();
        this.workerTimer = null;
      }
      if (this.heartbeatTimer) {
        this.heartbeatTimer.stop();
        this.heartbeatTimer = null;
      }
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
    DEFAULT_POLL_INTERVAL_MS,
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    DEFAULT_APPROVAL_PATTERNS,
    CONTAINER_SELECTORS,
    queryDeep,
    isElementVisible,
    captureDomDiagnosticSnapshot,
    findChatInput,
    findSendButton,
    findNewConversationButton,
    dispatchButtonClickCascade,
    injectPromptAndSubmit,
    triggerNewConversation,
    startAutoApprovalObserver,
    createWorkerTimer,
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

