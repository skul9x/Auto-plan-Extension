/**
 * Antigravity Auto-Plan DOM Bridge Client
 * Runs in the Electron Renderer DOM context (workbench.html).
 * Provides focus-free prompt injection, double-tap submission, new conversation triggering,
 * DOM diagnostics snapshot engine, and HTTP bridge coordination.
 */

(function (global) {
  'use strict';

  const DEFAULT_PORT_START = 48860;
  const DEFAULT_PORT_END = 48900;
  const ACTIVE_POLL_INTERVAL_MS = 400;
  const IDLE_POLL_INTERVAL_MS = 2000;
  const IDLE_THRESHOLD_MS = 30000;
  const DEFAULT_POLL_INTERVAL_MS = ACTIVE_POLL_INTERVAL_MS;
  const DEFAULT_HEARTBEAT_INTERVAL_MS = 10000;

  const CONTAINER_SELECTORS = [
    '#antigravity\\.agentSidePanelInputBox',
    'div[id*="agentSidePanelInputBox"]',
    '#antigravity\\.agentViewContainerId',
    'div[id*="agentViewContainerId"]',
    '.surface-composer-card',
    '.agy-composer-footer',
    'iframe.webview',
    '.webview',
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

                if (container.tagName === 'IFRAME' || container.tagName === 'FRAME') {
                  try {
                    const frameDoc = container.contentDocument || (container.contentWindow && container.contentWindow.document);
                    if (frameDoc && !visited.has(frameDoc)) {
                      results = results.concat(queryDeep(selector, frameDoc, visited));
                    }
                  } catch (frameErr) {
                    logBridge('DEBUG', `Iframe contentDocument access restricted on container iframe: ${frameErr?.message || frameErr}`, {
                      iframeId: container.id,
                      iframeSrc: container.src
                    }, frameErr);
                  }
                }

                if (typeof container.querySelectorAll === 'function') {
                  const frames = container.querySelectorAll('iframe, frame');
                  for (let i = 0; i < frames.length; i++) {
                    const el = frames[i];
                    try {
                      const src = el.src || el.getAttribute?.('src') || '';
                      if (!src.startsWith('http:') && !src.startsWith('https:')) {
                        const frameDoc = el.contentDocument || (el.contentWindow && el.contentWindow.document);
                        if (frameDoc && !visited.has(frameDoc)) {
                          results = results.concat(queryDeep(selector, frameDoc, visited));
                        }
                      }
                    } catch (frameErr) {
                      logBridge('DEBUG', `Cross-origin iframe access restricted in container query: ${frameErr?.message || frameErr}`, {
                        iframeId: el.id,
                        iframeSrc: el.src
                      }, frameErr);
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

          if (doc.shadowRoot && !visited.has(doc.shadowRoot)) {
            results = results.concat(queryDeep(selector, doc.shadowRoot, visited));
          }

          try {
            const frames = (typeof doc.querySelectorAll === 'function') ? doc.querySelectorAll('iframe, frame') : [];
            for (let i = 0; i < frames.length; i++) {
              const el = frames[i];
              try {
                const src = el.src || el.getAttribute?.('src') || '';
                if (!src.startsWith('http:') && !src.startsWith('https:')) {
                  const frameDoc = el.contentDocument || (el.contentWindow && el.contentWindow.document);
                  if (frameDoc && !visited.has(frameDoc)) {
                    results = results.concat(queryDeep(selector, frameDoc, visited));
                  }
                }
              } catch (_) {
                // Silently ignore cross-origin restrictions on iframes
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
        const compWin = (curr.ownerDocument && curr.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
        if (compWin && compWin.getComputedStyle) {
          try {
            const cs = compWin.getComputedStyle(curr);
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

    let activeElement = { tagName: '', className: '', id: '', isContentEditable: false, isInChatPanel: false, ariaLabel: '', boundingBox: { width: 0, height: 0, top: 0, left: 0 }, isCodeEditor: false };
    try {
      const activeEl = root.activeElement || (typeof document !== 'undefined' ? document.activeElement : null);
      if (activeEl) {
        let bBox = { width: 0, height: 0, top: 0, left: 0 };
        try {
          if (typeof activeEl.getBoundingClientRect === 'function') {
            const r = activeEl.getBoundingClientRect();
            bBox = {
              width: typeof r.width === 'number' ? r.width : 0,
              height: typeof r.height === 'number' ? r.height : 0,
              top: typeof r.top === 'number' ? r.top : 0,
              left: typeof r.left === 'number' ? r.left : 0
            };
          }
        } catch (_) {}

        activeElement = {
          tagName: activeEl.tagName || '',
          className: activeEl.className || '',
          id: activeEl.id || '',
          isContentEditable: Boolean(activeEl.getAttribute?.('contenteditable') === 'true' || activeEl.contentEditable === 'true' || activeEl.contentEditable === true),
          isInChatPanel: isInsideChatContainer(activeEl),
          ariaLabel: activeEl.getAttribute?.('aria-label') || activeEl.getAttribute?.('aria-roledescription') || '',
          boundingBox: bBox,
          isCodeEditor: isCodeEditorElement(activeEl)
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
        let rect = { width: 0, height: 0, top: 0, left: 0 };
        try {
          if (typeof ta.getBoundingClientRect === 'function') {
            const r = ta.getBoundingClientRect();
            rect = {
              width: typeof r.width === 'number' ? r.width : 0,
              height: typeof r.height === 'number' ? r.height : 0,
              top: typeof r.top === 'number' ? r.top : 0,
              left: typeof r.left === 'number' ? r.left : 0
            };
          }
        } catch (_) {}

        textareas.push({
          className: ta.className || '',
          placeholder: ta.getAttribute?.('placeholder') || ta.placeholder || '',
          ariaLabel: ta.getAttribute?.('aria-label') || ta.getAttribute?.('aria-roledescription') || '',
          visible: isElementVisible(ta),
          disabled: Boolean(ta.disabled),
          isInChatPanel: isInsideChatContainer(ta),
          boundingBox: { ...rect },
          rect,
          isCodeEditor: isCodeEditorElement(ta)
        });
      }
    } catch (taErr) {
      logBridge('WARN', `Failed inspecting textareas: ${taErr?.message || taErr}`, {}, taErr);
    }

    // ContentEditables & Editor Contexts
    const contentEditables = [];
    try {
      const ceList = queryDeep('[contenteditable="true"], div.monaco-editor, div.ProseMirror, div[data-lexical-editor="true"], .native-edit-context', root);
      for (let i = 0; i < ceList.length; i++) {
        const ce = ceList[i];
        let rect = { width: 0, height: 0, top: 0, left: 0 };
        try {
          if (typeof ce.getBoundingClientRect === 'function') {
            const r = ce.getBoundingClientRect();
            rect = {
              width: typeof r.width === 'number' ? r.width : 0,
              height: typeof r.height === 'number' ? r.height : 0,
              top: typeof r.top === 'number' ? r.top : 0,
              left: typeof r.left === 'number' ? r.left : 0
            };
          }
        } catch (_) {}

        contentEditables.push({
          tagName: ce.tagName || '',
          className: ce.className || '',
          role: ce.getAttribute?.('role') || ce.role || '',
          ariaLabel: ce.getAttribute?.('aria-label') || ce.getAttribute?.('aria-roledescription') || '',
          placeholder: ce.getAttribute?.('placeholder') || ce.getAttribute?.('data-placeholder') || '',
          visible: isElementVisible(ce),
          isInChatPanel: isInsideChatContainer(ce),
          boundingBox: { ...rect },
          rect,
          isCodeEditor: isCodeEditorElement(ce)
        });
      }
    } catch (ceErr) {
      logBridge('WARN', `Failed inspecting contentEditables: ${ceErr?.message || ceErr}`, {}, ceErr);
    }

    // Nearby input elements summary and visibility aggregation
    const nearbyInputs = [];
    try {
      for (let i = 0; i < textareas.length; i++) {
        const ta = textareas[i];
        nearbyInputs.push({
          type: 'textarea',
          selector: ta.className ? `textarea.${ta.className.trim().split(/\s+/).slice(0, 2).join('.')}` : 'textarea',
          visible: Boolean(ta.visible),
          isInChatPanel: Boolean(ta.isInChatPanel),
          isCodeEditor: Boolean(ta.isCodeEditor),
          ariaLabel: ta.ariaLabel || undefined
        });
      }
      for (let i = 0; i < contentEditables.length; i++) {
        const ce = contentEditables[i];
        const tag = (ce.tagName || 'div').toLowerCase();
        nearbyInputs.push({
          type: tag,
          selector: ce.className ? `${tag}.${ce.className.trim().split(/\s+/).slice(0, 2).join('.')}` : tag,
          visible: Boolean(ce.visible),
          isInChatPanel: Boolean(ce.isInChatPanel),
          isCodeEditor: Boolean(ce.isCodeEditor),
          ariaLabel: ce.ariaLabel || undefined
        });
      }
    } catch (_) {}

    const nearbyInputsSummary = {
      totalFound: nearbyInputs.length,
      visibleCount: nearbyInputs.filter(inp => inp.visible).length,
      inChatPanelCount: nearbyInputs.filter(inp => inp.isInChatPanel).length,
      codeEditorCount: nearbyInputs.filter(inp => inp.isCodeEditor).length,
      elements: nearbyInputs.slice(0, 10)
    };

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
      evaluatedSelectors,
      nearbyInputs,
      nearbyInputsSummary
    };
  }

  /**
   * Helper to check whether an element has a given class name.
   */
  function hasClass(elem, clsName) {
    if (!elem) return false;
    if (elem.classList && typeof elem.classList.contains === 'function') {
      return elem.classList.contains(clsName);
    }
    const cls = typeof elem.className === 'string' ? elem.className : (elem.getAttribute ? elem.getAttribute('class') || '' : '');
    return new RegExp(`(^|\\s)${clsName}(\\s|$)`).test(cls);
  }

  /**
   * Checks whether an element has explicit chat identifiers (e.g. Message input, lexical editor, chat testids).
   */
  function hasChatIdentifiers(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute && (el.hasAttribute('data-lexical-editor') || el.getAttribute('data-lexical-editor') === 'true')) {
      return true;
    }
    const aria = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('aria-roledescription'))) || '';
    if (/message\s*input|chat|composer|prompt/i.test(aria)) {
      return true;
    }
    const testid = (el.getAttribute && el.getAttribute('data-testid')) || '';
    if (/chat|composer|prompt/i.test(testid)) {
      return true;
    }
    const placeholder = (el.placeholder || (el.getAttribute && (el.getAttribute('placeholder') || el.getAttribute('data-placeholder')))) || '';
    if (/ask|chat|message|prompt/i.test(placeholder)) {
      return true;
    }
    return false;
  }

  /**
   * Helper to determine if an element is inside an Antigravity Agent chat panel or widget.
   */
  function isInsideChatContainer(el) {
    if (!el || el.nodeType !== 1) return false;

    if (hasChatIdentifiers(el)) {
      return true;
    }

    try {
      if (typeof el.closest === 'function') {
        const match = el.closest('#antigravity\\.agentSidePanelInputBox, [id*="agentSidePanelInputBox"], #antigravity\\.agentViewContainerId, [id*="agentViewContainerId"], .surface-composer-card, .agy-composer-footer, .webview, .chat-widget, .interactive-session, .interactive-input, .chat-input-container, .chat-input-part, div.chat-input, .composer-container, .composer-bar, .chat-editor-widget, [data-testid*="chat"], [data-testid*="composer"]');
        if (match) return true;
      }
    } catch (_) {}

    let curr = el;
    while (curr && curr.nodeType === 1) {
      const id = curr.id || (typeof curr.getAttribute === 'function' ? curr.getAttribute('id') : '');
      if (id && (id.includes('agentSidePanelInputBox') || id.includes('agentViewContainerId'))) return true;
      const cls = typeof curr.className === 'string' ? curr.className : (curr.getAttribute ? curr.getAttribute('class') || '' : '');
      if (/\b(chat-widget|interactive-session|interactive-input|chat-input|chat-input-container|chat-input-part|composer-container|composer-bar|chat-editor-widget|surface-composer-card|agy-composer-footer|webview)\b/.test(cls)) {
        return true;
      }
      if (hasChatIdentifiers(curr)) {
        return true;
      }
      curr = curr.parentElement || (curr.parentNode && curr.parentNode.nodeType === 1 ? curr.parentNode : null);
    }
    return false;
  }

  /**
   * Active Exclusion Guard: Rejects any element rooted inside the main Monaco Code Editor workbench (.monaco-workbench .part.editor),
   * un-scoped native-edit-context or overflow-guard elements, or editor role elements without chat identifiers.
   */
  function isCodeEditorElement(el) {
    if (!el || el.nodeType !== 1) return false;

    const inChat = isInsideChatContainer(el);

    // 1. Returns true if element has or is descendant of .monaco-editor inside .part.editor (main editor tab container)
    try {
      let inEditorPart = false;
      if (typeof el.closest === 'function') {
        inEditorPart = Boolean(el.closest('.part.editor, [id*="workbench.parts.editor"], .editor-group-container, .monaco-workbench .part.editor'));
      }
      if (!inEditorPart) {
        let p = el;
        while (p && p.nodeType === 1) {
          const id = p.id || (typeof p.getAttribute === 'function' ? p.getAttribute('id') : '');
          if (id && id.includes('workbench.parts.editor')) {
            inEditorPart = true;
            break;
          }
          const cls = typeof p.className === 'string' ? p.className : (p.getAttribute ? p.getAttribute('class') || '' : '');
          if (/\bpart\s+editor\b/.test(cls) || (cls.includes('part') && cls.includes('editor')) || cls.includes('editor-group-container')) {
            inEditorPart = true;
            break;
          }
          p = p.parentElement || (p.parentNode && p.parentNode.nodeType === 1 ? p.parentNode : null);
        }
      }

      if (inEditorPart && !inChat) {
        const isMonaco = (el.classList && el.classList.contains('monaco-editor')) ||
          (typeof el.closest === 'function' && el.closest('.monaco-editor')) ||
          (typeof el.querySelector === 'function' && el.querySelector('.monaco-editor'));
        if (isMonaco || hasClass(el, 'native-edit-context') || hasClass(el, 'overflow-guard') || el.tagName === 'TEXTAREA') {
          return true;
        }
        return true;
      }
    } catch (_) {}

    // 2. Returns true if class name matches native-edit-context or overflow-guard outside chat containers
    try {
      if (!inChat) {
        if (hasClass(el, 'native-edit-context') || hasClass(el, 'overflow-guard')) {
          return true;
        }
        if (typeof el.closest === 'function') {
          if (el.closest('.native-edit-context, .overflow-guard')) {
            return true;
          }
        } else {
          let curr = el.parentElement;
          while (curr && curr.nodeType === 1) {
            if (hasClass(curr, 'native-edit-context') || hasClass(curr, 'overflow-guard')) {
              return true;
            }
            curr = curr.parentElement;
          }
        }
      }
    } catch (_) {}

    // 3. Returns true if element has attribute aria-roledescription="editor" without chat identifiers
    try {
      const getRoleDesc = (elem) => (elem && typeof elem.getAttribute === 'function') ? elem.getAttribute('aria-roledescription') : null;
      if (getRoleDesc(el) === 'editor') {
        if (!inChat && !hasChatIdentifiers(el)) {
          return true;
        }
      }
      if (typeof el.closest === 'function') {
        const editorDesc = el.closest('[aria-roledescription="editor"]');
        if (editorDesc && !inChat && !hasChatIdentifiers(editorDesc)) {
          return true;
        }
      } else {
        let curr = el.parentElement;
        while (curr && curr.nodeType === 1) {
          if (getRoleDesc(curr) === 'editor' && !inChat && !hasChatIdentifiers(curr)) {
            return true;
          }
          curr = curr.parentElement;
        }
      }
    } catch (_) {}

    return false;
  }

  /**
   * Discovers the chat prompt input element using prioritized selector cascades.
   * If not found, captures a structured DomDiagnosticSnapshot.
   */
  function findChatInput(doc, outOptions = {}) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root) return null;

    const selectors = [
      '#antigravity\\.agentSidePanelInputBox [contenteditable="true"]',
      '#antigravity\\.agentSidePanelInputBox [data-lexical-editor="true"]',
      '#antigravity\\.agentSidePanelInputBox textarea',
      '.surface-composer-card [data-lexical-editor="true"]',
      '.surface-composer-card [contenteditable="true"]',
      '.surface-composer-card div[role="combobox"]',
      'div[data-lexical-editor="true"][aria-label="Message input"]',
      'div[data-lexical-editor="true"]',
      'div[aria-label="Message input"][contenteditable="true"]',
      'textarea[aria-label="Message input"]',
      '.chat-widget [contenteditable="true"]',
      '.interactive-session .interactive-input [contenteditable="true"], .interactive-input-editor textarea',
      'div[aria-label="Message input"]',
      'div[contenteditable="true"][role="combobox"]',
      '.chat-widget .monaco-editor textarea.inputarea',
      '.interactive-session .monaco-editor textarea.inputarea',
      '.interactive-input .monaco-editor textarea.inputarea',
      'div.interactive-input-editor textarea',
      'textarea.interactive-input-editor',
      'div.ProseMirror[contenteditable="true"]',
      'div.ProseMirror',
      '[data-testid*="composer-input"]',
      '[data-testid*="chat-input"]',
      '[data-testid*="prompt-input"]',
      'textarea[placeholder*="Ask"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="Prompt"]',
      'textarea[placeholder*="Chat"]',
      'textarea[placeholder*="Type"]'
    ];

    const evaluatedSelectors = [];

    for (let i = 0; i < selectors.length; i++) {
      const sel = selectors[i];
      const candidates = queryDeep(sel, root);
      evaluatedSelectors.push({ selector: sel, matches: candidates.length });

      for (let j = 0; j < candidates.length; j++) {
        const el = candidates[j];
        if (!el) continue;
        if (isCodeEditorElement(el)) {
          logBridge('DEBUG', 'Candidate rejected by isCodeEditorElement guard', {
            tagName: el.tagName,
            className: el.className,
            selector: sel
          });
          continue;
        }
        if (isElementVisible(el)) {
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
      'button.agy-send-button',
      '.agy-send-button',
      '.surface-composer-card button[data-testid="send-button"]',
      '.surface-composer-card button[aria-label="Send message"]',
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
   * Helper to identify context / attachment buttons that must not be confused with New Conversation
   */
  function isContextOrAttachmentElement(el) {
    if (!el) return false;
    try {
      if (typeof el.closest === 'function') {
        if (el.closest('.surface-composer-card, .agy-composer-footer, .chat-input-toolbar, .chat-input-actions')) {
          return true;
        }
      }
      const ariaLabel = (el.getAttribute && el.getAttribute('aria-label')) || '';
      if (/add context|attach|mention/i.test(ariaLabel)) {
        return true;
      }
      const tooltipId = (el.getAttribute && el.getAttribute('data-tooltip-id')) || '';
      if (/add-context|context/i.test(tooltipId)) {
        return true;
      }
    } catch (_) {}
    return false;
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
      'button[data-tooltip-id="new-conversation-tooltip"]',
      'button[data-tooltip-id*="new-conversation"]',
      '[data-tooltip-id="new-conversation-tooltip"]',
      '[data-tooltip-id*="new-conversation"]',
      '[data-tooltip-id*="new-chat"]',
      '[data-testid="new-conversation-button"]',
      '[data-testid="new-chat-button"]',
      '[data-testid*="new-conversation"]',
      '[data-testid*="new-chat"]',
      'button[aria-label*="New Chat"]',
      'button[aria-label*="New Conversation"]',
      'button[aria-label*="New chat"]',
      'button[aria-label*="New conversation"]',
      'button[title*="New Chat"]',
      'button[title*="New Conversation"]',
      'button[title*="New chat"]',
      'button[title*="New conversation"]',
      'a[aria-label*="New Chat"]',
      'a[aria-label*="New Conversation"]',
      'a[aria-label*="New chat"]',
      'a[aria-label*="New conversation"]',
      'a[title*="New Chat"]',
      'a[title*="New Conversation"]',
      'a[title*="New chat"]',
      'a[title*="New conversation"]',
      'button[aria-label*="Clear Chat"]',
      'button[aria-label*="Clear chat"]',
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
          if (isContextOrAttachmentElement(el)) {
            continue;
          }
          if (el.classList && (el.classList.contains('codicon-plus') || el.classList.contains('codicon-add')) && el.tagName !== 'BUTTON' && el.tagName !== 'A') {
            const parentBtn = el.closest ? el.closest('a, button, [role="button"]') : el.parentElement;
            if (parentBtn && !isContextOrAttachmentElement(parentBtn) && isElementVisible(parentBtn, { allowDisabled: true })) {
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
          if (anchorOrBtn && !isContextOrAttachmentElement(anchorOrBtn) && isElementVisible(anchorOrBtn, { allowDisabled: true })) {
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
    if (activeClientInstance && typeof activeClientInstance.recordActivity === 'function') {
      try {
        activeClientInstance.recordActivity();
      } catch (_) {}
    }
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
   * Evaluates whether an input element's buffer has been cleared or submitted (LOGIC-008 & Phase 03 Hardening).
   * Enforces State Transition Verification: Proof 1 (Input Clearance) can ONLY be declared
   * if options.hasConfirmedContentBeforeSubmit is true (or charsDetectedInDOM >= 1 prior to submit).
   * An initially empty input element must NOT return true under any circumstances.
   */
  function isInputClearedOrSubmitted(inputElem, promptText, options = {}) {
    if (!inputElem) return false;

    // Phase 03: Proof 1 State Transition Hardening
    // Clearance can ONLY be declared if content presence was verified prior to submission.
    // If hasConfirmedContentBeforeSubmit is false, undefined, or unverified (0 chars), return false immediately.
    const hasConfirmedContentBeforeSubmit = Boolean(
      options && (
        options.hasConfirmedContentBeforeSubmit === true ||
        (options.hasConfirmedContentBeforeSubmit !== false && (
          (typeof options.charsDetectedInDOM === 'number' && options.charsDetectedInDOM > 0) ||
          (typeof options.priorCharsDetected === 'number' && options.priorCharsDetected > 0)
        ))
      )
    );

    if (!hasConfirmedContentBeforeSubmit) {
      return false;
    }

    const trimmedPrompt = (typeof promptText === 'string' ? promptText : '').trim();

    // 1. Textarea / Input
    if (inputElem.tagName === 'TEXTAREA' || inputElem.tagName === 'INPUT') {
      const val = (inputElem.value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      if (!val || val.length === 0) {
        return true;
      }
      // Non-printable or whitespace residue <= 2 chars
      if (val.length <= 2 && !trimmedPrompt.includes(val)) {
        return true;
      }
      if (trimmedPrompt && (val === trimmedPrompt || val.includes(trimmedPrompt) || trimmedPrompt.includes(val))) {
        return false;
      }
      return false;
    }

    // 2. Monaco Editor Model API (if element or window has monaco model)
    try {
      if (typeof inputElem.getModel === 'function') {
        const model = inputElem.getModel();
        if (model && typeof model.getValue === 'function') {
          const mVal = model.getValue().replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
          if (!mVal || mVal.length === 0) return true;
          if (mVal.length <= 2 && !trimmedPrompt.includes(mVal)) return true;
          if (trimmedPrompt && (mVal === trimmedPrompt || mVal.includes(trimmedPrompt) || trimmedPrompt.includes(mVal))) return false;
          return false;
        }
      }
    } catch (_) {}

    // 3. Contenteditable / Rich Text / Lexical / ProseMirror
    const textProp = (inputElem.innerText !== undefined && inputElem.innerText !== null && inputElem.innerText !== '')
      ? inputElem.innerText
      : ((inputElem.textContent !== undefined && inputElem.textContent !== null) ? inputElem.textContent : '');
    const rawText = String(textProp).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    const html = (inputElem.innerHTML || '').trim();

    // Check if the prompt is still present in the buffer
    if (rawText.length > 0 && trimmedPrompt) {
      if (rawText === trimmedPrompt || rawText.includes(trimmedPrompt) || (rawText.length > 2 && trimmedPrompt.includes(rawText))) {
        return false;
      }
    }

    // If buffer is empty or <= 2 non-printable characters or whitespace
    if (rawText.length === 0 || (rawText.length <= 2 && !trimmedPrompt.includes(rawText))) {
      // Empty structural tags in Lexical / ProseMirror (e.g. <p><br></p>, <div><br/></div>, <br>, or empty tags)
      if (!html ||
          /^<(p|div|span)[^>]*>\s*(<br\s*\/?>)?\s*<\/\1>$/i.test(html) ||
          /^<br\s*\/?>$/i.test(html) ||
          html.replace(/<[^>]*>/g, '').replace(/[\u200B-\u200D\uFEFF\s]/g, '').length === 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Helper targeting active Cancel/Stop button replacing send button (Phase 03 Proof 2).
   * Targets button[aria-label*="Cancel"][data-tooltip-id*="input-send-button-cancel-tooltip"]
   * and button[aria-label*="Cancel"][data-tooltip-id*="cancel"] containing .bg-red-500.
   * Excludes modal dialog cancel buttons and unmounted/disconnected elements.
   */
  function findCancelButton(doc) {
    if (!doc) return null;
    try {
      const selector = 'button[aria-label*="Cancel"][data-tooltip-id*="input-send-button-cancel-tooltip"], button[aria-label*="Cancel"][data-tooltip-id*="cancel"], button[aria-label*="Cancel"]';
      const btns = (typeof queryDeep === 'function')
        ? queryDeep(selector, doc)
        : (doc.querySelectorAll ? Array.from(doc.querySelectorAll(selector)) : []);

      for (const btn of btns) {
        if (!btn) continue;
        if (btn.isConnected === false) continue;

        // Exclude dialog / modal cancel buttons (e.g. "Do you want to discard changes? [Cancel]")
        if (typeof btn.closest === 'function') {
          if (btn.closest('.monaco-dialog-box, .dialog-buttons, .notifications-toasts, .monaco-dialog-modal-block')) {
            continue;
          }
        }

        const ariaLabel = (btn.getAttribute ? btn.getAttribute('aria-label') : '') || '';
        const tooltipId = (btn.getAttribute ? btn.getAttribute('data-tooltip-id') : '') || '';
        const hasRedSquare = btn.querySelector && Boolean(btn.querySelector('.bg-red-500, [class*="bg-red-500"]'));

        if (tooltipId.includes('input-send-button-cancel-tooltip')) {
          return btn;
        }
        if (tooltipId.toLowerCase().includes('cancel') && (hasRedSquare || !tooltipId.includes('dialog'))) {
          return btn;
        }
        if (ariaLabel.toLowerCase().includes('cancel') && hasRedSquare) {
          return btn;
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Helper counting user messages in the chat history (Phase 03 Proof 3).
   * Targets div[role="article"][aria-label="User message"], div[data-testid="user-input-step"]
   * Excludes detached/unmounted elements to prevent race conditions during conversation switches.
   */
  function countUserMessages(doc) {
    if (!doc) return 0;
    try {
      const selector = 'div[role="article"][aria-label="User message"], div[data-testid="user-input-step"]';
      const elements = (typeof queryDeep === 'function')
        ? queryDeep(selector, doc)
        : (doc.querySelectorAll ? Array.from(doc.querySelectorAll(selector)) : []);

      if (!elements || elements.length === 0) return 0;

      const uniqueMessages = new Set();
      for (const el of elements) {
        if (!el || el.isConnected === false) continue;
        let root = el;
        if (typeof el.closest === 'function') {
          const parentArticle = el.closest('div[role="article"][aria-label="User message"]');
          if (parentArticle) {
            root = parentArticle;
          }
        }
        uniqueMessages.add(root);
      }
      return uniqueMessages.size;
    } catch (_) {
      return 0;
    }
  }

  /**
   * Helper checking Proof 2 criteria: Active agent Cancel button or live announcer "Working..."
   */
  function isCancelButtonOrWorkingActive(doc) {
    if (!doc) return false;
    if (findCancelButton(doc)) return true;
    try {
      const announcer = (typeof queryDeep === 'function')
        ? (queryDeep('#a11y-live-announcer', doc)[0] || null)
        : (doc.querySelector ? doc.querySelector('#a11y-live-announcer') : null);
      if (announcer && announcer.isConnected !== false) {
        const text = announcer.textContent || announcer.innerText || '';
        if (text.includes('Working...')) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  const CLEARANCE_MIN_POLL_INTERVAL_MS = 80;

  /**
   * Enforces bounded relaxed polling interval for DOM submission clearance checks (PERF-009).
   * Prevents renderer thread saturation by clamping polling interval to at least 80ms.
   */
  function getEffectiveClearancePollInterval(options = {}) {
    if (options && options.pollIntervalMs !== undefined) {
      return Math.max(CLEARANCE_MIN_POLL_INTERVAL_MS, Number(options.pollIntervalMs) || CLEARANCE_MIN_POLL_INTERVAL_MS);
    }
    return CLEARANCE_MIN_POLL_INTERVAL_MS;
  }

  /**
   * Asynchronously verifies that an input submission actually cleared the buffer
   * or triggered an active agent response / new user message (Phase 03: 3-Point Proof Verification Standard).
   *
   * A submission is confirmed as verified if and only if at least ONE of the following 3 hard criteria evaluates to true:
   * - Proof 1 (Input Clearance): isInputClearedOrSubmitted(inputElem, promptText, options) returns true
   *   (Requires confirmed pre-submit content presence; empty inputs NEVER verify clearance)
   * - Proof 2 (Active Agent Cancel Button): findCancelButton(doc) !== null or #a11y-live-announcer contains "Working..."
   * - Proof 3 (Message Count Increment): countUserMessages(doc) > initialMessageCount
   *
   * Generic body mutations (tooltips, clock updates, etc.) do NOT verify submission.
   */
  async function verifyInputSubmission(inputElem, promptText, options = {}) {
    const startTime = Date.now();
    const doc = options.document || (typeof document !== 'undefined' ? document : (inputElem?.ownerDocument || null));
    const win = options.window || (typeof window !== 'undefined' ? window : null);

    // Observation window (default 1000ms per Phase 03 Requirement 2.3)
    const observationTimeoutMs = options.observationTimeoutMs !== undefined
      ? options.observationTimeoutMs
      : (options.clearanceObservationMs !== undefined
        ? options.clearanceObservationMs
        : (options.verificationDelayMs !== undefined ? options.verificationDelayMs : 1000));
    const pollIntervalMs = getEffectiveClearancePollInterval(options);

    // Snapshot pre-submission message count
    const initialMessageCount = options.initialMessageCount !== undefined
      ? options.initialMessageCount
      : countUserMessages(doc);

    // Phase 03: Content transition pre-condition flag
    // Proof 1 is only eligible if the element previously verified containing >= 1 characters of the prompt.
    // If charsDetectedInDOM prior to submit was 0 or unverified, hasConfirmedContentBeforeSubmit is false.
    let hasConfirmedContentBeforeSubmit = false;
    if (options.hasConfirmedContentBeforeSubmit === true) {
      hasConfirmedContentBeforeSubmit = true;
    } else if (options.hasConfirmedContentBeforeSubmit === false) {
      hasConfirmedContentBeforeSubmit = false;
    } else if (typeof options.charsDetectedInDOM === 'number') {
      hasConfirmedContentBeforeSubmit = options.charsDetectedInDOM > 0;
    } else if (typeof options.priorCharsDetected === 'number') {
      hasConfirmedContentBeforeSubmit = options.priorCharsDetected > 0;
    }

    const verificationOptions = {
      ...options,
      hasConfirmedContentBeforeSubmit
    };

    // Three-Point Proof verification checks
    const checkProof1 = () => isInputClearedOrSubmitted(inputElem, promptText, verificationOptions);
    const checkProof2 = () => isCancelButtonOrWorkingActive(doc);
    const checkProof3 = () => countUserMessages(doc) > initialMessageCount;

    // 1. Immediate proof evaluation (at t = 0)
    // Constraint: Never report verified: true with durationMs: 0 unless Proof 2 (Active Cancel Button)
    // or Proof 3 (Message Count increment) is genuinely active in the DOM.
    if (checkProof2()) {
      return {
        verified: true,
        reason: 'cancel_button_active',
        proof: 'proof2_active_cancel_button',
        durationMs: Date.now() - startTime,
        pollIntervalMs
      };
    }
    if (checkProof3()) {
      return {
        verified: true,
        reason: 'message_count_incremented',
        proof: 'proof3_message_count_increment',
        durationMs: Date.now() - startTime,
        pollIntervalMs
      };
    }
    if (hasConfirmedContentBeforeSubmit && checkProof1()) {
      return {
        verified: true,
        reason: 'input_cleared',
        proof: 'proof1_input_clearance',
        durationMs: Math.max(1, Date.now() - startTime),
        pollIntervalMs
      };
    }

    // 2. Polling loop: generic body mutations are completely ignored.
    // Only the 3 hard proof criteria can verify submission.
    while (Date.now() - startTime < observationTimeoutMs) {
      if (checkProof1()) {
        return {
          verified: true,
          reason: 'input_cleared',
          proof: 'proof1_input_clearance',
          durationMs: Math.max(1, Date.now() - startTime),
          pollIntervalMs
        };
      }
      if (checkProof2()) {
        return {
          verified: true,
          reason: 'cancel_button_active',
          proof: 'proof2_active_cancel_button',
          durationMs: Date.now() - startTime,
          pollIntervalMs
        };
      }
      if (checkProof3()) {
        return {
          verified: true,
          reason: 'message_count_incremented',
          proof: 'proof3_message_count_increment',
          durationMs: Date.now() - startTime,
          pollIntervalMs
        };
      }

      const remaining = observationTimeoutMs - (Date.now() - startTime);
      if (remaining <= 0) break;
      await new Promise(r => setTimeout(r, Math.min(pollIntervalMs, remaining)));
    }

    // 3. Final evaluation at timeout deadline
    if (checkProof1()) {
      return {
        verified: true,
        reason: 'input_cleared',
        proof: 'proof1_input_clearance',
        durationMs: Math.max(1, Date.now() - startTime),
        pollIntervalMs
      };
    }
    if (checkProof2()) {
      return {
        verified: true,
        reason: 'cancel_button_active',
        proof: 'proof2_active_cancel_button',
        durationMs: Date.now() - startTime,
        pollIntervalMs
      };
    }
    if (checkProof3()) {
      return {
        verified: true,
        reason: 'message_count_incremented',
        proof: 'proof3_message_count_increment',
        durationMs: Date.now() - startTime,
        pollIntervalMs
      };
    }

    return {
      verified: false,
      reason: 'unverified_input_remains',
      rejectionReason: 'unverified_input_remains',
      error: 'Submission was not verified: input retains prompt and neither Cancel button nor user message increment was detected',
      durationMs: Date.now() - startTime,
      pollIntervalMs,
      currentValue: (inputElem && (inputElem.tagName === 'TEXTAREA' || inputElem.tagName === 'INPUT'))
        ? (inputElem.value || '')
        : (inputElem ? (inputElem.textContent || inputElem.innerText || '') : '')
    };
  }

  /**
   * Extracts raw and cleaned DOM text buffer from an input/editor element using multi-pathway extraction.
   * Handles Textarea/Input (.value), Monaco Editor (getModel().getValue()), Lexical/ProseMirror (innerText/textContent).
   * Normalizes zero-width spaces (\u200B-\u200D, \uFEFF) and \r\n to \n.
   */
  function extractDomBufferText(inputElem, options = {}) {
    if (!inputElem) {
      return {
        rawText: '',
        cleanText: '',
        charsDetectedInDOM: 0,
        domExcerpt: '',
        pathway: 'none'
      };
    }

    const win = options.window || (typeof window !== 'undefined' ? window : null);
    let rawText = '';
    let pathway = 'unknown';

    // 1. Monaco Editor Model API
    try {
      if (typeof inputElem.getModel === 'function') {
        const model = inputElem.getModel();
        if (model && typeof model.getValue === 'function') {
          rawText = model.getValue();
          pathway = 'monaco-model';
        }
      } else if (win && win.monaco && win.monaco.editor && typeof win.monaco.editor.getEditors === 'function') {
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
              const model = typeof ed.getModel === 'function' ? ed.getModel() : null;
              if (model && typeof model.getValue === 'function') {
                rawText = model.getValue();
                pathway = 'monaco-model';
                break;
              }
            }
          }
        }
      }
    } catch (_) {}

    // 2. Standard Textarea / Input
    if (!pathway.startsWith('monaco') && (inputElem.tagName === 'TEXTAREA' || inputElem.tagName === 'INPUT')) {
      rawText = typeof inputElem.value === 'string' ? inputElem.value : '';
      pathway = 'input-value';
    }

    // 3. Lexical / ContentEditable / Rich Text / ProseMirror
    if (!pathway.startsWith('monaco') && pathway !== 'input-value') {
      const hasInnerText = typeof inputElem.innerText === 'string';
      const hasTextContent = typeof inputElem.textContent === 'string';

      if (hasInnerText && inputElem.innerText.length > 0) {
        rawText = inputElem.innerText;
        pathway = 'inner-text';
      } else if (hasTextContent && inputElem.textContent.length > 0) {
        rawText = inputElem.textContent;
        pathway = 'text-content';
      } else if (hasInnerText) {
        rawText = inputElem.innerText;
        pathway = 'inner-text';
      } else if (hasTextContent) {
        rawText = inputElem.textContent;
        pathway = 'text-content';
      } else if (typeof inputElem.value === 'string') {
        rawText = inputElem.value;
        pathway = 'element-value';
      }
    }

    // Clean non-printable zero-width spaces (\u200B-\u200D, \uFEFF) and normalize newlines
    const cleanText = String(rawText || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\r\n/g, '\n');

    return {
      rawText: rawText || '',
      cleanText,
      charsDetectedInDOM: cleanText.length,
      domExcerpt: cleanText.slice(0, 60),
      pathway
    };
  }

  /**
   * Verifies that the target DOM input buffer physically contains the expected prompt text.
   * Performs multi-pathway content extraction, length ratio check (>= min(expected * 0.75, 50)),
   * non-whitespace initial 30-char prefix containment check, and suffix containment check.
   * Returns boolean (true/false) and populates options.diagnostics.
   */
  function verifyBufferHasText(inputElem, expectedText, options = {}) {
    if (!inputElem) {
      const emptyDiag = {
        verified: false,
        rejectionReason: 'no_target_element',
        charsExpected: expectedText ? String(expectedText).length : 0,
        charsDetectedInDOM: 0,
        domExcerpt: '',
        pathway: 'none'
      };
      if (options && typeof options === 'object') {
        if (options.diagnostics && typeof options.diagnostics === 'object') Object.assign(options.diagnostics, emptyDiag);
        if (options.details && typeof options.details === 'object') Object.assign(options.details, emptyDiag);
      }
      verifyBufferHasText.lastResult = emptyDiag;
      return options && options.detailed ? emptyDiag : false;
    }

    const extracted = extractDomBufferText(inputElem, options);
    const cleanDomText = extracted.cleanText;
    const charsDetectedInDOM = extracted.charsDetectedInDOM;
    const domExcerpt = extracted.domExcerpt;

    const rawExpected = typeof expectedText === 'string' ? expectedText : (expectedText != null ? String(expectedText) : '');
    const cleanExpected = rawExpected
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\r\n/g, '\n');
    const charsExpected = cleanExpected.length;

    const minRatio = typeof options.minCharsRatio === 'number' ? options.minCharsRatio : 0.75;
    const prefixTargetLen = typeof options.prefixLength === 'number' ? options.prefixLength : 30;

    const expectedNonWs = cleanExpected.replace(/\s+/g, '');
    const domNonWs = cleanDomText.replace(/\s+/g, '');

    let verified = true;
    let rejectionReason = null;

    // 1. Empty buffer check
    if (charsExpected > 0 && charsDetectedInDOM === 0) {
      verified = false;
      rejectionReason = 'dom_buffer_empty';
    }

    // 2. Length check: For prompts > 50 chars, charsDetectedInDOM >= expected * 0.75
    // For prompts <= 50 chars, verify >= min(expected * 0.75, 50)
    if (verified && charsExpected > 0) {
      const minRequiredChars = charsExpected > 50
        ? (charsExpected * minRatio)
        : Math.min(charsExpected * minRatio, 50);

      if (charsDetectedInDOM < minRequiredChars) {
        verified = false;
        rejectionReason = 'insufficient_characters_detected';
      }
    }

    // 3. Prefix containment check: at least initial 30 non-whitespace characters of promptText
    if (verified && expectedNonWs.length > 0) {
      const prefixNonWs = expectedNonWs.slice(0, Math.min(prefixTargetLen, expectedNonWs.length));
      const prefixContained = domNonWs.includes(prefixNonWs) ||
        cleanDomText.includes(cleanExpected.trim().slice(0, Math.min(prefixTargetLen, cleanExpected.trim().length)));

      if (!prefixContained) {
        verified = false;
        rejectionReason = 'prefix_not_found_in_dom';
      }
    }

    // 4. Suffix containment check (for prompts > 50 chars or when checkSuffix is explicitly requested)
    const shouldCheckSuffix = options.checkSuffix !== undefined ? Boolean(options.checkSuffix) : (charsExpected > 50);
    if (verified && shouldCheckSuffix && expectedNonWs.length >= 20) {
      const suffixNonWs = expectedNonWs.slice(-Math.min(20, expectedNonWs.length));
      const suffixContained = domNonWs.includes(suffixNonWs) ||
        cleanDomText.includes(cleanExpected.trim().slice(-Math.min(20, cleanExpected.trim().length)));

      if (!suffixContained) {
        verified = false;
        rejectionReason = 'suffix_not_found_in_dom';
      }
    }

    const result = {
      verified,
      rejectionReason: verified ? null : rejectionReason,
      charsExpected,
      charsDetectedInDOM,
      domExcerpt,
      pathway: extracted.pathway
    };

    if (options && typeof options === 'object') {
      if (options.diagnostics && typeof options.diagnostics === 'object') {
        Object.assign(options.diagnostics, result);
      }
      if (options.details && typeof options.details === 'object') {
        Object.assign(options.details, result);
      }
    }

    verifyBufferHasText.lastResult = result;

    if (options && options.detailed) {
      return result;
    }
    return verified;
  }

  /**
   * Injects prompt text into active chat input and triggers submit with step-by-step diagnostics
   */
  async function injectPromptAndSubmit(promptText, options = {}) {
    if (activeClientInstance && typeof activeClientInstance.recordActivity === 'function') {
      try {
        activeClientInstance.recordActivity();
      } catch (_) {}
    }
    if (options.client && typeof options.client.recordActivity === 'function') {
      try {
        options.client.recordActivity();
      } catch (_) {}
    }
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
      err.code = 'NO_CHAT_INPUT_FOUND';
      const snapshot = inputDiag.snapshot || findChatInput.lastSnapshot || captureDomDiagnosticSnapshot(doc);
      err.domSnapshot = snapshot;
      steps.push({
        step: 1,
        name: 'Input discovery & focus',
        status: 'failed',
        error: err.message,
        code: 'NO_CHAT_INPUT_FOUND',
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

    // Semantic target fingerprinting
    let isInChatPanel = false;
    try {
      if (typeof inputElem.closest === 'function') {
        isInChatPanel = Boolean(inputElem.closest('#antigravity\\.agentSidePanelInputBox, [id*="agentSidePanelInputBox"], .chat-widget'));
      }
      if (!isInChatPanel) {
        let curr = inputElem;
        while (curr && curr.nodeType === 1) {
          const id = curr.id || (typeof curr.getAttribute === 'function' ? curr.getAttribute('id') : '');
          if (id && id.includes('agentSidePanelInputBox')) {
            isInChatPanel = true;
            break;
          }
          const cls = typeof curr.className === 'string' ? curr.className : (curr.getAttribute ? curr.getAttribute('class') || '' : '');
          if (cls.includes('chat-widget')) {
            isInChatPanel = true;
            break;
          }
          curr = curr.parentElement || (curr.parentNode && curr.parentNode.nodeType === 1 ? curr.parentNode : null);
        }
      }
    } catch (_) {
      isInChatPanel = false;
    }

    const ariaLabel = (typeof inputElem.getAttribute === 'function'
      ? (inputElem.getAttribute('aria-label') || inputElem.getAttribute('aria-roledescription'))
      : '') || '';

    const placeholder = (inputElem.placeholder ||
      (typeof inputElem.getAttribute === 'function'
        ? (inputElem.getAttribute('placeholder') || inputElem.getAttribute('data-placeholder'))
        : '')) || '';

    let boundingBox = { width: 0, height: 0, top: 0, left: 0 };
    try {
      if (typeof inputElem.getBoundingClientRect === 'function') {
        const rect = inputElem.getBoundingClientRect();
        if (rect) {
          boundingBox = {
            width: typeof rect.width === 'number' ? rect.width : 0,
            height: typeof rect.height === 'number' ? rect.height : 0,
            top: typeof rect.top === 'number' ? rect.top : 0,
            left: typeof rect.left === 'number' ? rect.left : 0
          };
        }
      }
    } catch (_) {}

    const visible = isElementVisible(inputElem);

    const containerHierarchy = [];
    try {
      let p = inputElem.parentElement;
      while (p && p.nodeType === 1 && containerHierarchy.length < 10) {
        const tag = (p.tagName || '').toLowerCase();
        const id = p.id ? `#${p.id}` : '';
        const cls = (typeof p.className === 'string' && p.className)
          ? `.${p.className.trim().split(/\s+/).slice(0, 3).join('.')}`
          : '';
        containerHierarchy.push(`${tag}${id}${cls}`);
        p = p.parentElement;
      }
    } catch (_) {}

    const chatContainer = containerHierarchy.find(c => c.includes('agentSidePanelInputBox') || c.includes('chat-widget'));
    const targetElementContext = chatContainer
      ? chatContainer
      : (inputElem.id ? `#${inputElem.id}` : (containerHierarchy[0] || (inputElem.tagName ? inputElem.tagName.toLowerCase() : 'element')));

    steps.push({
      step: 1,
      name: 'Input discovery & focus',
      status: 'success',
      elementContext: targetElementContext,
      details: {
        tagName: inputElem.tagName,
        className: inputElem.className,
        focused,
        isInChatPanel,
        ariaLabel,
        placeholder,
        boundingBox,
        visible,
        containerHierarchy,
        elementContext: targetElementContext
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
        let execSuccess = false;
        if (promptText.includes('\n')) {
          const lines = promptText.split(/\r?\n/);
          execSuccess = true;
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) {
              try {
                doc.execCommand('insertLineBreak', false, null);
              } catch (_) {}
            }
            if (lines[i].length > 0) {
              const ok = doc.execCommand('insertText', false, lines[i]);
              if (!ok && i === 0) {
                execSuccess = false;
                break;
              }
            }
          }
        } else {
          execSuccess = doc.execCommand('insertText', false, promptText);
        }
        if (execSuccess) {
          valueSet = true;
          injectionStrategy = (inputElem.hasAttribute?.('data-lexical-editor') || (inputElem.closest && inputElem.closest('[data-lexical-editor]')))
            ? 'lexical-execCommand'
            : 'execCommand';
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
      try {
        if (typeof inputElem.innerText !== 'undefined') {
          inputElem.innerText = promptText;
        } else {
          inputElem.textContent = promptText;
        }
        valueSet = true;
        injectionStrategy = 'contenteditable-text';
      } catch (err) {
        logBridge('WARN', `Direct text assignment failed: ${err?.message || err}`, {}, err);
      }
    }

    // Post-Paste Buffer Verification (Phase 02)
    const verificationDiag = {};
    const isBufferVerified = verifyBufferHasText(inputElem, promptText, {
      window: win,
      document: doc,
      diagnostics: verificationDiag
    });

    if (!isBufferVerified) {
      const err = new Error(`PASTE_VERIFICATION_FAILED: Prompt text failed to materialize in target DOM buffer (expected ${promptText.length} chars, detected ${verificationDiag.charsDetectedInDOM || 0} in DOM)`);
      err.name = 'PASTE_VERIFICATION_FAILED';
      err.code = 'PASTE_VERIFICATION_FAILED';
      err.charsExpected = promptText.length;
      err.charsDetectedInDOM = verificationDiag.charsDetectedInDOM || 0;
      err.domExcerpt = verificationDiag.domExcerpt || '';
      err.rejectionReason = verificationDiag.rejectionReason || 'dom_buffer_empty';

      steps.push({
        step: 2,
        name: 'Content injection',
        status: 'failed',
        strategy: injectionStrategy,
        charsExpected: promptText.length,
        charsDetectedInDOM: err.charsDetectedInDOM,
        domExcerpt: err.domExcerpt,
        verified: false,
        rejectionReason: err.rejectionReason,
        error: err.message,
        code: 'PASTE_VERIFICATION_FAILED'
      });

      err.steps = steps;
      logBridge('ERROR', err.message, {
        charsExpected: err.charsExpected,
        charsDetectedInDOM: err.charsDetectedInDOM,
        domExcerpt: err.domExcerpt,
        rejectionReason: err.rejectionReason,
        steps
      });

      throw err;
    }

    steps.push({
      step: 2,
      name: 'Content injection',
      status: 'success',
      strategy: injectionStrategy,
      charsInjected: promptText.length,
      charsExpected: promptText.length,
      charsDetectedInDOM: verificationDiag.charsDetectedInDOM,
      domExcerpt: verificationDiag.domExcerpt,
      verified: true
    });

    // Step 3: Event dispatching
    const dispatchedEvents = [];
    try {
      if (win && typeof win.InputEvent === 'function') {
        const inputEventInit = isInputOrTextarea
          ? { bubbles: true, cancelable: true, inputType: 'insertText', data: promptText }
          : { bubbles: true, cancelable: true };
        inputElem.dispatchEvent(new win.InputEvent('input', inputEventInit));
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
    // Pre-Submit Lease & Cancellation Check (LOGIC-001 Remediation)
    const cmdId = options.commandId || options.cmd?.id || options.id;
    const cmdTimeoutMs = typeof options.commandTimeoutMs === 'number' ? options.commandTimeoutMs : (typeof options.timeoutMs === 'number' ? options.timeoutMs : null);
    const cmdDeadline = options.commandDeadline || options.deadline;
    const cmdStartTime = options.commandStartTime || options.startTime;

    const checkCommandAbort = () => {
      const isCancelled = Boolean(
        (typeof options.isCancelled === 'function' && options.isCancelled()) ||
        (cmdId && options.cancelledCommands && options.cancelledCommands.has && options.cancelledCommands.has(cmdId)) ||
        (cmdId && activeClientInstance && activeClientInstance.cancelledCommands && activeClientInstance.cancelledCommands.has(cmdId))
      );
      if (isCancelled) {
        return { aborted: true, reason: 'Command cancelled by server coordinator', code: 'COMMAND_ABORTED_BY_TIMEOUT' };
      }
      const isExpired = Boolean(
        (cmdDeadline && Date.now() > cmdDeadline) ||
        (cmdStartTime && cmdTimeoutMs && (Date.now() - cmdStartTime > cmdTimeoutMs))
      );
      if (isExpired) {
        return { aborted: true, reason: `Command lease expired (> ${cmdTimeoutMs}ms)`, code: 'COMMAND_ABORTED_BY_TIMEOUT' };
      }
      return { aborted: false };
    };

    const initialAbort = checkCommandAbort();
    if (initialAbort.aborted) {
      const abortErr = new Error(`Command aborted before submit: ${initialAbort.reason}`);
      abortErr.code = initialAbort.code;
      abortErr.aborted = true;
      abortErr.commandId = cmdId;
      steps.push({
        step: 4,
        name: 'Submit triggering',
        status: 'aborted',
        reason: initialAbort.reason,
        code: initialAbort.code
      });
      abortErr.steps = steps;
      logBridge('WARN', `Pre-submit abort check triggered: ${initialAbort.reason}`, { commandId: cmdId, code: initialAbort.code });
      throw abortErr;
    }

    let submitStrategy = 'enterKey';
    let enterDispatched = false;
    let sendButtonClicked = false;
    let doubleTapExecuted = false;
    let formSubmitted = false;
    let submissionVerified = true;
    let verificationResult = null;
    let rejectionReason = null;
    let verificationError = null;

    // Helper to evaluate if button is disabled or aria-disabled (aligned with empirical DOM snapshot body4.txt)
    const isButtonDisabled = (btn) => {
      if (!btn) return true;
      if (btn.disabled) return true;
      if (btn.getAttribute) {
        if (btn.getAttribute('aria-disabled') === 'true' || btn.getAttribute('disabled') !== null) {
          return true;
        }
      }
      if (btn.classList) {
        if (
          btn.classList.contains('disabled') ||
          btn.classList.contains('monaco-button-disabled') ||
          btn.classList.contains('cursor-not-allowed')
        ) {
          return true;
        }
        // Strict readiness criteria aligned with body4.txt:
        // Ready when disabled attribute is removed, cursor-not-allowed is absent,
        // and either cursor-pointer or bg-primary is present.
        const hasClassTokens = (typeof btn.classList.length === 'number' ? btn.classList.length > 0 : false) ||
          Boolean(btn.className && String(btn.className).trim().length > 0) ||
          Boolean(btn.classList.classes && btn.classList.classes.size > 0);
        if (hasClassTokens) {
          const hasPointerOrPrimary = btn.classList.contains('cursor-pointer') || btn.classList.contains('bg-primary');
          if (!hasPointerOrPrimary) {
            return true;
          }
        }
      }
      return false;
    };

    const sendBtnDiag = {};
    let sendBtn = options.sendButton || findSendButton(inputElem || doc, sendBtnDiag);

    // Extended Button Enablement Polling (default 2500ms, 50ms interval)
    let maxPollMs = 2500;
    if (options.pollTimeoutMs !== undefined) {
      if (options.allowShortTimeout || options.pollTimeoutMs === 0) {
        maxPollMs = options.pollTimeoutMs;
      } else if (typeof options.pollTimeoutMs === 'number' && options.pollTimeoutMs >= 2000) {
        maxPollMs = options.pollTimeoutMs;
      } else {
        // Enforce 2500ms default if unprovided or less than 2000ms
        maxPollMs = 2500;
      }
    }
    const pollIntervalMs = options.pollIntervalMs !== undefined ? options.pollIntervalMs : 50;
    const pollStart = Date.now();
    let buttonWaitDurationMs = 0;
    let initialDisabled = sendBtn ? isButtonDisabled(sendBtn) : true;

    if ((!sendBtn || initialDisabled) && maxPollMs > 0) {
      while (Date.now() - pollStart < maxPollMs) {
        const loopAbort = checkCommandAbort();
        if (loopAbort.aborted) {
          const abortErr = new Error(`Command aborted during button wait: ${loopAbort.reason}`);
          abortErr.code = loopAbort.code;
          abortErr.aborted = true;
          abortErr.commandId = cmdId;
          steps.push({
            step: 4,
            name: 'Submit triggering',
            status: 'aborted',
            reason: loopAbort.reason,
            code: loopAbort.code
          });
          abortErr.steps = steps;
          logBridge('WARN', `Button wait abort check triggered: ${loopAbort.reason}`, { commandId: cmdId });
          throw abortErr;
        }
        await new Promise(r => setTimeout(r, pollIntervalMs));
        // Re-evaluate findSendButton on every poll interval to capture newly rendered buttons
        const refreshedBtn = options.sendButton || findSendButton(inputElem || doc, sendBtnDiag);
        if (refreshedBtn) {
          sendBtn = refreshedBtn;
        }
        if (sendBtn && !isButtonDisabled(sendBtn)) {
          break;
        }
      }
      buttonWaitDurationMs = Date.now() - pollStart;
    }

    // Pre-dispatch final abort guard
    const preDispatchAbort = checkCommandAbort();
    if (preDispatchAbort.aborted) {
      const abortErr = new Error(`Command aborted before submit dispatch: ${preDispatchAbort.reason}`);
      abortErr.code = preDispatchAbort.code;
      abortErr.aborted = true;
      abortErr.commandId = cmdId;
      steps.push({
        step: 4,
        name: 'Submit triggering',
        status: 'aborted',
        reason: preDispatchAbort.reason,
        code: preDispatchAbort.code
      });
      abortErr.steps = steps;
      logBridge('WARN', `Pre-dispatch abort check triggered: ${preDispatchAbort.reason}`, { commandId: cmdId });
      throw abortErr;
    }

    // Snapshot initial pre-submission message count for Proof 3
    const initialMessageCount = countUserMessages(doc);

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

      // If button state remains disabled after click & double-tap, benefit from submission verification (Section 3.3)
      if (isButtonDisabled(sendBtn)) {
        const verifyRes = await verifyInputSubmission(inputElem, promptText, {
          window: win,
          document: doc,
          initialMessageCount,
          observationTimeoutMs: options.observationTimeoutMs !== undefined ? options.observationTimeoutMs : (options.clearanceObservationMs !== undefined ? options.clearanceObservationMs : (options.verificationDelayMs !== undefined ? options.verificationDelayMs : 1000)),
          pollIntervalMs: getEffectiveClearancePollInterval(options),
          ...options,
          hasConfirmedContentBeforeSubmit: options.hasConfirmedContentBeforeSubmit !== undefined ? options.hasConfirmedContentBeforeSubmit : isBufferVerified,
          charsDetectedInDOM: options.charsDetectedInDOM !== undefined ? options.charsDetectedInDOM : verificationDiag.charsDetectedInDOM
        });
        verificationResult = verifyRes;
        if (!verifyRes || !verifyRes.verified) {
          submissionVerified = false;
          sendButtonClicked = false;
          rejectionReason = 'button_disabled_unsubmitted';
          verificationError = 'Send button remained disabled and input buffer was not cleared';
        }
      }
    } else if (sendBtn && isButtonDisabled(sendBtn)) {
      // Send button exists in DOM but remained disabled after maxPollMs (2500ms).
      // STRICT REQUIREMENT: Absolute Prohibition of Synthetic Enter when Send Button Exists.
      // NEVER dispatch KeyboardEvent('Enter'). Mark as failed rather than attempting a fake Enter.
      sendButtonClicked = false;
      enterDispatched = false;
      submissionVerified = false;
      submitStrategy = 'buttonClick';
      rejectionReason = 'button_disabled_timeout';
      verificationError = `Send button remained disabled after ${buttonWaitDurationMs}ms polling timeout; synthetic Enter fallback forbidden when send button is present`;
      logBridge('WARN', `Send button remained disabled after ${buttonWaitDurationMs}ms (max ${maxPollMs}ms). Enter fallback prohibited because button exists in DOM.`, {
        buttonSelector: sendBtn?.className || sendBtn?.tagName || null,
        maxPollMs,
        buttonWaitDurationMs
      });

      steps.push({
        step: 4,
        name: 'Submit triggering',
        status: 'failed',
        submitStrategy: 'buttonClick',
        enterDispatched: false,
        sendButtonClicked: false,
        doubleTapExecuted: false,
        formSubmitted: false,
        submissionVerified: false,
        rejectionReason: 'button_disabled_timeout',
        error: verificationError,
        buttonSelector: sendBtn?.className || sendBtn?.tagName || null,
        buttonWaitDurationMs,
        initialDisabled,
        sendButtonDiagnostics: sendBtnDiag.diagnostics
      });

      const disabledTimeoutErr = new Error(verificationError);
      disabledTimeoutErr.code = 'BUTTON_DISABLED_TIMEOUT';
      disabledTimeoutErr.status = 'failed';
      disabledTimeoutErr.rejectionReason = 'button_disabled_timeout';
      disabledTimeoutErr.buttonSelector = sendBtn?.className || sendBtn?.tagName || null;
      disabledTimeoutErr.buttonWaitDurationMs = buttonWaitDurationMs;
      disabledTimeoutErr.initialDisabled = initialDisabled;
      disabledTimeoutErr.steps = steps;
      disabledTimeoutErr.diagnostics = {
        buttonClass: sendBtn?.className || '',
        buttonTagName: sendBtn?.tagName || '',
        disabledDuration: buttonWaitDurationMs,
        disabledDurationMs: buttonWaitDurationMs,
        initialDisabled,
        initialState: { initialDisabled },
        maxPollMs
      };
      disabledTimeoutErr.sendButtonClicked = false;
      disabledTimeoutErr.enterDispatched = false;
      disabledTimeoutErr.submitStrategy = 'buttonClick';
      disabledTimeoutErr.submissionVerified = false;
      disabledTimeoutErr.success = false;

      if (options.rejectOnDisabledTimeout !== false && options.throwOnError !== false) {
        throw disabledTimeoutErr;
      }
    } else {
      // 2. Fallback Strategy (enterKey): ONLY permitted if no send button element can be discovered anywhere in the DOM
      let enterAttempted = false;
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

          enterAttempted = true;
          enterDispatched = true;
          submitStrategy = 'enterKey';
        }
      } catch (kbErr) {
        logBridge('WARN', `KeyboardEvent dispatch failed: ${kbErr?.message || kbErr}`, {}, kbErr);
      }

      // Verification check for enterKey fallback (LOGIC-008 remediation)
      if (enterDispatched) {
        const verifyRes = await verifyInputSubmission(inputElem, promptText, {
          window: win,
          document: doc,
          initialMessageCount,
          observationTimeoutMs: options.observationTimeoutMs !== undefined ? options.observationTimeoutMs : (options.clearanceObservationMs !== undefined ? options.clearanceObservationMs : (options.verificationDelayMs !== undefined ? options.verificationDelayMs : 1000)),
          pollIntervalMs: getEffectiveClearancePollInterval(options),
          ...options,
          hasConfirmedContentBeforeSubmit: options.hasConfirmedContentBeforeSubmit !== undefined ? options.hasConfirmedContentBeforeSubmit : isBufferVerified,
          charsDetectedInDOM: options.charsDetectedInDOM !== undefined ? options.charsDetectedInDOM : verificationDiag.charsDetectedInDOM
        });
        verificationResult = verifyRes;
        if (!verifyRes || !verifyRes.verified) {
          submissionVerified = false;
          enterDispatched = false;
          rejectionReason = 'untrusted_enter_rejected';
          verificationError = 'Synthetic Enter event was not accepted by the editor (input was not cleared)';
          logBridge('WARN', `Synthetic Enter event was rejected by editor: input buffer was not cleared`, {
            inputElemTag: inputElem?.tagName,
            rejectionReason,
            verificationResult
          });
        }
      }

      // 3. Form Fallback Strategy (formSubmit): If neither buttonClick nor enterKey succeeded
      if (!sendButtonClicked && !enterAttempted) {
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
              const verifyRes = await verifyInputSubmission(inputElem, promptText, {
                window: win,
                document: doc,
                initialMessageCount,
                observationTimeoutMs: options.observationTimeoutMs !== undefined ? options.observationTimeoutMs : (options.clearanceObservationMs !== undefined ? options.clearanceObservationMs : (options.verificationDelayMs !== undefined ? options.verificationDelayMs : 1000)),
                pollIntervalMs: getEffectiveClearancePollInterval(options),
                ...options,
                hasConfirmedContentBeforeSubmit: options.hasConfirmedContentBeforeSubmit !== undefined ? options.hasConfirmedContentBeforeSubmit : isBufferVerified,
                charsDetectedInDOM: options.charsDetectedInDOM !== undefined ? options.charsDetectedInDOM : verificationDiag.charsDetectedInDOM
              });
              verificationResult = verifyRes;
              if (!verifyRes || !verifyRes.verified) {
                submissionVerified = false;
                formSubmitted = false;
                rejectionReason = 'form_submit_unsubmitted';
                verificationError = 'Form submission fallback did not clear input buffer';
              }
            }
          } catch (formErr) {
            logBridge('WARN', `Form submission fallback failed: ${formErr?.message || formErr}`, {}, formErr);
          }
        }
      }
    }

    const isDocHidden = Boolean(doc?.hidden || (typeof document !== 'undefined' && document.hidden));
    const isBackgroundSubmission = Boolean(options.isBackground || isDocHidden);
    const isSuccess = Boolean((sendButtonClicked || formSubmitted || enterDispatched) && submissionVerified);

    steps.push({
      step: 4,
      name: 'Submit triggering',
      status: isSuccess ? 'success' : 'failed',
      submitStrategy,
      enterDispatched,
      sendButtonClicked,
      doubleTapExecuted,
      formSubmitted,
      submissionVerified,
      rejectionReason: !isSuccess ? rejectionReason : undefined,
      error: !isSuccess ? verificationError : undefined,
      verificationResult: verificationResult || undefined,
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
      submissionVerified,
      rejectionReason: !isSuccess ? rejectionReason : undefined,
      error: !isSuccess ? verificationError : undefined,
      verificationResult: verificationResult || undefined,
      buttonSelector: sendBtn?.className || sendBtn?.tagName || null,
      buttonWaitDurationMs,
      initialDisabled,
      charsInjected: promptText.length,
      charsExpected: promptText.length,
      charsDetectedInDOM: verificationDiag.charsDetectedInDOM,
      domExcerpt: verificationDiag.domExcerpt,
      elementContext: targetElementContext,
      steps,
      diagnostics: {
        timestamp: Date.now(),
        isBackground: isBackgroundSubmission,
        documentHidden: isDocHidden,
        submitStrategy,
        submissionVerified,
        rejectionReason: !isSuccess ? rejectionReason : undefined,
        error: !isSuccess ? verificationError : undefined,
        verificationResult: verificationResult || undefined,
        doubleTapExecuted,
        buttonWaitDurationMs,
        initialDisabled,
        charsExpected: promptText.length,
        charsDetectedInDOM: verificationDiag.charsDetectedInDOM,
        domExcerpt: verificationDiag.domExcerpt,
        elementContext: targetElementContext,
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
   * State-aware handshake:
   * 1. Pre-checks if newBtn has 'cursor-not-allowed' (already on a new conversation).
   * 2. If 'cursor-pointer', clicks and polls for all 3 readiness conditions:
   *    a) newBtn acquires 'cursor-not-allowed'
   *    b) Message input editor is empty
   *    c) Send button is present and disabled
   */
  async function triggerNewConversation(options = {}) {
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 3000;
    const intervalMs = typeof options.intervalMs === 'number' ? options.intervalMs : 50;
    const probeTimeoutMs = typeof options.probeTimeoutMs === 'number' ? options.probeTimeoutMs : 1000;
    const startTime = Date.now();

    const newBtn = options.button || findNewConversationButton(doc);
    if (!newBtn) {
      logBridge('WARN', 'triggerNewConversation: No New Conversation button found to click');
      return { success: false, error: 'No New Conversation button found to click' };
    }

    // 1. Pre-check for Existing Empty Conversation
    const isAlreadyDisabled = Boolean(
      (newBtn.classList && newBtn.classList.contains('cursor-not-allowed')) ||
      (newBtn.hasAttribute && newBtn.hasAttribute('disabled')) ||
      newBtn.disabled === true
    );

    if (isAlreadyDisabled) {
      logBridge('INFO', 'New Conversation pre-check: Chat panel is already on a blank/new conversation (cursor-not-allowed)');
      return { success: true, alreadyNew: true, durationMs: 0 };
    }

    // 2. Deterministic Click (unless readyCheckOnly)
    if (!options.readyCheckOnly) {
      try {
        dispatchButtonClickCascade(newBtn, win);
        if (typeof newBtn.click === 'function') {
          newBtn.click();
        }
        logBridge('INFO', 'New Conversation button click cascade dispatched');
      } catch (err) {
        logBridge('ERROR', `Error clicking New Conversation button: ${err?.message || err}`, {}, err);
        throw err;
      }
    }

    // Handshake Polling loop with post-open readiness probe
    while (Date.now() - startTime < timeoutMs) {
      await new Promise(r => setTimeout(r, intervalMs));

      // Condition a: newBtn acquires cursor-not-allowed
      const currentBtn = findNewConversationButton(doc) || newBtn;
      const isBtnDisabled = Boolean(
        (currentBtn.classList && currentBtn.classList.contains('cursor-not-allowed')) ||
        (currentBtn.hasAttribute && currentBtn.hasAttribute('disabled')) ||
        currentBtn.disabled === true
      );

      // Condition b: old chat message containers unmounted / cleared
      const userMessageCount = countUserMessages(doc);
      const isOldChatUnmounted = (userMessageCount === 0);

      // Condition c: new editor container mounted, visible, and empty
      const inputEditor = (doc && typeof doc.querySelector === 'function' && doc.querySelector('div[data-lexical-editor="true"]')) || findChatInput(doc);
      let isEditorReadyAndEmpty = false;
      if (inputEditor && isElementVisible(inputEditor)) {
        const textContent = (inputEditor.value !== undefined ? inputEditor.value : (inputEditor.innerText || inputEditor.textContent || '')).trim();
        const htmlClean = (inputEditor.innerHTML || '')
          .replace(/<br\s*\/?>/gi, '')
          .replace(/<p[^>]*>/gi, '')
          .replace(/<\/p>/gi, '')
          .replace(/<[^>]*>/g, '')
          .replace(/&nbsp;/g, ' ')
          .trim();
        isEditorReadyAndEmpty = (textContent === '' || htmlClean === '');
      }

      // Condition d: send button is present and disabled (disabled="" or cursor-not-allowed)
      const sendBtn = (doc && typeof doc.querySelector === 'function' && doc.querySelector('button[data-testid="send-button"]')) || findSendButton(doc);
      const isSendBtnDisabled = Boolean(
        sendBtn && (
          sendBtn.hasAttribute('disabled') ||
          sendBtn.disabled === true ||
          (sendBtn.classList && sendBtn.classList.contains('cursor-not-allowed')) ||
          sendBtn.getAttribute('aria-disabled') === 'true'
        )
      );

      if (isBtnDisabled && isOldChatUnmounted && isEditorReadyAndEmpty && isSendBtnDisabled) {
        const durationMs = Date.now() - startTime;
        logBridge('INFO', `New conversation transition handshake confirmed in ${durationMs}ms`);
        return { success: true, durationMs, alreadyNew: false, editorReady: true };
      }
    }

    const durationMs = Date.now() - startTime;
    const timeoutErr = new Error(`New conversation handshake timed out after ${durationMs}ms: DOM failed to reach empty/ready state`);
    logBridge('ERROR', timeoutErr.message);
    throw timeoutErr;
  }

  /**
   * High-level handler for opening a new conversation with readiness probe
   */
  async function handleOpenNewConversation(options = {}) {
    return triggerNewConversation(options);
  }

  /**
   * Helper function to cancel active AI generation if a Cancel button is present.
   * Leverages findCancelButton(doc) and dispatchButtonClickCascade.
   */
  async function stopActiveGeneration(options = {}) {
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 500;
    const intervalMs = typeof options.intervalMs === 'number' ? options.intervalMs : 50;

    const cancelBtn = options.button || findCancelButton(doc);
    if (!cancelBtn) {
      logBridge('INFO', 'stopActiveGeneration: No active Cancel button detected; agent is idle');
      return { success: true, status: 'idle', stopped: false };
    }

    try {
      dispatchButtonClickCascade(cancelBtn, win);
      if (typeof cancelBtn.click === 'function') {
        cancelBtn.click();
      }
      logBridge('INFO', 'stopActiveGeneration: Dispatched click cascade to Cancel button');
    } catch (err) {
      logBridge('ERROR', `stopActiveGeneration: Error clicking Cancel button: ${err?.message || err}`, {}, err);
      return { success: false, status: 'error', error: err?.message || String(err), stopped: false };
    }

    // Wait up to 500ms for input clearance / send button readiness
    const startWait = Date.now();
    while (Date.now() - startWait < timeoutMs) {
      await new Promise(r => setTimeout(r, intervalMs));
      const remainingCancel = findCancelButton(doc);
      const sendBtn = findSendButton(doc);
      if (!remainingCancel && sendBtn && !sendBtn.disabled) {
        break;
      }
    }

    return { success: true, status: 'stopped', stopped: true };
  }

  const DIALOG_CONTAINER_SELECTORS = [
    '.notifications-toasts',
    '.monaco-dialog-box',
    '.action-widget',
    '.monaco-dialog-modal-block',
    '.dialog-buttons',
    '.notification-toast-container',
    '.monaco-notification-toast'
  ];
  const DIALOG_SELECTORS_STRING = DIALOG_CONTAINER_SELECTORS.join(', ');
  const BUTTON_SELECTORS_STRING = 'button, [role="button"], .monaco-button, .dialog-button, a.monaco-button';

  function isNodeMatchingOrContainingDialog(node) {
    if (!node || node.nodeType !== 1) return false;
    try {
      if (typeof node.matches === 'function') {
        if (node.matches(DIALOG_SELECTORS_STRING) || node.matches(BUTTON_SELECTORS_STRING)) {
          return true;
        }
      }
      if (typeof node.querySelector === 'function') {
        if (node.querySelector(DIALOG_SELECTORS_STRING) || node.querySelector(BUTTON_SELECTORS_STRING)) {
          return true;
        }
      }
      if (typeof node.closest === 'function') {
        if (node.closest(DIALOG_SELECTORS_STRING)) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  function isRelevantDialogMutation(mutationList) {
    if (!mutationList || (!Array.isArray(mutationList) && !mutationList.length)) return false;
    for (let m = 0; m < mutationList.length; m++) {
      const mutation = mutationList[m];
      if (!mutation) continue;

      // 1. Check mutation target
      const target = mutation.target;
      if (target && target.nodeType === 1) {
        try {
          if (typeof target.closest === 'function' && target.closest(DIALOG_SELECTORS_STRING)) {
            return true;
          }
          if (typeof target.matches === 'function' && target.matches(DIALOG_SELECTORS_STRING)) {
            return true;
          }
        } catch (_) {}
      }

      // 2. Check addedNodes
      const added = mutation.addedNodes;
      if (added && added.length > 0) {
        for (let i = 0; i < added.length; i++) {
          if (isNodeMatchingOrContainingDialog(added[i])) {
            return true;
          }
        }
      }
    }
    return false;
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
   * Helper to check if a string represents an application name or environment suffix
   */
  function isAppName(part) {
    if (!part || typeof part !== 'string') return false;
    const lower = part.toLowerCase().replace(/[\[\]]/g, '').trim();
    const appNames = [
      'visual studio code',
      'cursor',
      'vscodium',
      'antigravity ide',
      'antigravity',
      'code',
      'extension development host'
    ];
    return appNames.some(app => lower === app || lower.includes('visual studio code') || lower.includes('antigravity'));
  }

  /**
   * Cleans workspace string by removing bracketed wrappers and (Workspace) suffixes
   */
  function cleanWorkspaceString(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/\[.*?\]/g, '')
      .replace(/\s*\((Workspace|Workspace File)\)$/i, '')
      .trim();
  }

  /**
   * Parses workspace folder name from title string (document.title or .window-title text)
   */
  function parseWorkspaceFromTitleString(str) {
    if (!str || typeof str !== 'string') return '';
    const cleanStr = str.replace(/^●\s*/, '').trim();
    if (!cleanStr) return '';

    // Split on common dashes
    const parts = cleanStr.split(/\s+[-—–]\s+/).map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return cleanWorkspaceString(parts[0]);

    // Find the app name in parts (e.g. "Antigravity IDE", "Visual Studio Code")
    const appIdx = parts.findIndex(isAppName);

    if (appIdx !== -1) {
      // In Antigravity IDE: [Workspace, AppName, File] -> appIdx = 1, parts[appIdx - 1] = Workspace
      // In VS Code: [File, Workspace, AppName] -> appIdx = 2, parts[appIdx - 1] = Workspace
      // In no-file window: [Workspace, AppName] -> appIdx = 1, parts[appIdx - 1] = Workspace
      if (appIdx > 0) {
        const candidate = cleanWorkspaceString(parts[appIdx - 1]);
        if (candidate) return candidate;
      }
      // If AppName was the first part (e.g. [AppName, Workspace] or [AppName, File])
      if (parts.length > 1 && appIdx === 0) {
        const candidate = cleanWorkspaceString(parts[1]);
        if (candidate) return candidate;
      }
    }

    // Fallback: filter out common app names or non-workspace tab names
    const nonWorkspaceTabs = ['auto-plan settings', 'settings', 'welcome', 'untitled', 'untitled (workspace)'];
    for (let i = 0; i < parts.length; i++) {
      const lower = cleanWorkspaceString(parts[i]).toLowerCase();
      if (!isAppName(parts[i]) && !nonWorkspaceTabs.includes(lower)) {
        return cleanWorkspaceString(parts[i]);
      }
    }

    return cleanWorkspaceString(parts[0]);
  }

  /**
   * Extracts the root folder name directly from Explorer DOM tree
   * Essential for Multi-Root Workspaces or Untitled Workspaces where .window-title shows "Untitled (Workspace)"
   */
  function extractRootFolderFromDom(doc) {
    if (!doc || typeof doc.querySelector !== 'function') return '';
    try {
      const rootFolderEl = doc.querySelector(
        '.explorer-folders-view [class*="rootfolder-icon"] [class*="label-name"], ' +
        '.monaco-list-row [class*="rootfolder-icon"] [class*="label-name"], ' +
        '[class*="rootfolder-icon"] [class*="label-name"], ' +
        '.explorer-folders-view [class*="rootfolder-icon"] .monaco-highlighted-label, ' +
        '[class*="rootfolder-icon"] .monaco-highlighted-label'
      );
      if (rootFolderEl && rootFolderEl.textContent && rootFolderEl.textContent.trim()) {
        return cleanWorkspaceString(rootFolderEl.textContent.trim());
      }

      const rootFolderItem = doc.querySelector(
        '.explorer-folders-view [class*="rootfolder-icon"][aria-label], ' +
        '.monaco-list-row [class*="rootfolder-icon"][aria-label], ' +
        '[class*="rootfolder-icon"][aria-label]'
      );
      if (rootFolderItem) {
        const aria = rootFolderItem.getAttribute('aria-label') || '';
        const baseName = aria.split(/[/\\]/).pop();
        if (baseName && baseName.trim()) {
          return cleanWorkspaceString(baseName.trim());
        }
      }
    } catch (_) {}
    return '';
  }

  /**
   * Detects workspace folder name from doc.title, DOM element .window-title, or Explorer DOM tree
   */
  function detectWorkspaceName(doc) {
    if (!doc) {
      if (typeof document !== 'undefined') {
        doc = document;
      } else {
        return '';
      }
    }

    const nonWorkspaceTabs = ['auto-plan settings', 'settings', 'welcome', 'untitled', 'untitled (workspace)'];

    // 1. Try DOM element .window-title or [class*="window-title"]
    try {
      if (typeof doc.querySelector === 'function') {
        const titleEl = doc.querySelector('.window-title') || doc.querySelector('[class*="window-title"]');
        if (titleEl && titleEl.textContent) {
          const raw = titleEl.textContent.trim();
          if (raw) {
            const parsed = parseWorkspaceFromTitleString(raw);
            if (parsed && !nonWorkspaceTabs.includes(parsed.toLowerCase())) {
              return parsed;
            }
          }
        }
      }
    } catch (_) {}

    // 2. Try doc.title
    try {
      const title = doc.title;
      if (typeof title === 'string' && title.trim()) {
        const parsed = parseWorkspaceFromTitleString(title.trim());
        if (parsed && !nonWorkspaceTabs.includes(parsed.toLowerCase())) {
          return parsed;
        }
      }
    } catch (_) {}

    // 3. Fallback: Try Root Folder extraction directly from Explorer tree (Crucial for Untitled / Multi-Root Workspaces)
    try {
      const rootFolder = extractRootFolderFromDom(doc);
      if (rootFolder && !nonWorkspaceTabs.includes(rootFolder.toLowerCase())) {
        return rootFolder;
      }
    } catch (_) {}

    // 4. Fallback: Try Explorer Section Header or Agent Side Panel Header in DOM
    try {
      if (typeof doc.querySelector === 'function') {
        // e.g. <h3 class="title" aria-label="Explorer Section: xxx">
        const sectionHeader = doc.querySelector('[aria-label^="Explorer Section: "]');
        if (sectionHeader) {
          const label = sectionHeader.getAttribute('aria-label');
          const match = label.match(/Explorer Section:\s*(.+)$/i);
          if (match && match[1] && match[1].trim()) {
            const cleaned = cleanWorkspaceString(match[1].trim());
            if (cleaned && !nonWorkspaceTabs.includes(cleaned.toLowerCase())) {
              return cleaned;
            }
          }
        }
        // e.g. <div class="icon codicon codicon-explorer-view-icon" aria-label="Auto-plan-Extension-main">
        const explorerIcon = doc.querySelector('.icon.codicon-explorer-view-icon[aria-label]');
        if (explorerIcon) {
          const label = explorerIcon.getAttribute('aria-label');
          if (label && label.trim() && !label.toLowerCase().includes('explorer')) {
            const cleaned = cleanWorkspaceString(label.trim());
            if (cleaned && !nonWorkspaceTabs.includes(cleaned.toLowerCase())) {
              return cleaned;
            }
          }
        }
        // e.g. <div class="text-lg font-medium">EV-Plus-main</div> in Agent Sidepanel
        const agentWsEl = doc.querySelector('#conversation .text-lg.font-medium');
        if (agentWsEl && agentWsEl.textContent && agentWsEl.textContent.trim()) {
          const cleaned = cleanWorkspaceString(agentWsEl.textContent.trim());
          if (cleaned && !nonWorkspaceTabs.includes(cleaned.toLowerCase())) {
            return cleaned;
          }
        }
      }
    } catch (_) {}

    return '';
  }

  function getWorkspaceIdentifier(doc) {
    return detectWorkspaceName(doc);
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
      this.workspaceName = options.workspaceName || null;
      this.activePollIntervalMs = options.activePollIntervalMs || options.pollIntervalMs || ACTIVE_POLL_INTERVAL_MS;
      this.idlePollIntervalMs = options.idlePollIntervalMs || IDLE_POLL_INTERVAL_MS;
      this.idleThresholdMs = options.idleThresholdMs || options.idleTimeoutMs || IDLE_THRESHOLD_MS;
      this.lastActivityTime = Date.now();
      this.currentPollInterval = this.activePollIntervalMs;
      this.pollIntervalMs = this.currentPollInterval;
      this.heartbeatIntervalMs = options.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS;
      this.fetchFn = options.fetch || options.fetchFn || (typeof fetch !== 'undefined' ? fetch.bind(global) : null);
      this.pollTimer = null;
      this.workerTimer = null;
      this.heartbeatTimer = null;
      this._isPolling = false;
      this._activityHandler = null;
      this.customWorker = options.Worker;
      this.customBlob = options.Blob;
      this.customURL = options.URL;
      this.isRunning = false;
      this.isSubmitting = false;
      this.lastSubmissionTime = 0;
      this.customDocument = options.document;
      this.customWindow = options.window;
      this.clientVersion = '2.0.0';
      this.logQueue = [];
      this.maxLogQueueCapacity = 50;
      this.activeCommandId = null;
      this.activeCommandDeadline = 0;
      this.cancelledCommands = new Set();
      this.authToken = options.authToken || options.bridgeAuthToken ||
        (typeof window !== 'undefined' && (window.__AUTOPLAN_AUTH_TOKEN__ || window.__AUTOPLAN_BRIDGE_AUTH_TOKEN__ || (window.__AUTOPLAN_CONFIG__ && (window.__AUTOPLAN_CONFIG__.authToken || window.__AUTOPLAN_CONFIG__.bridgeAuthToken)))) ||
        null;
      this.sidecarPath = options.sidecarPath || options.sidecarConfigPath || null;

      activeClientInstance = this;

      // Drain any logs produced before client instantiation
      while (earlyLogBuffer.length > 0) {
        const item = earlyLogBuffer.shift();
        item.details = { ...(item.details || {}), windowKey: this.windowKey };
        this.logQueue.push(item);
      }
    }

    recordActivity() {
      this.lastActivityTime = Date.now();
      if (this.currentPollInterval !== this.activePollIntervalMs) {
        this.currentPollInterval = this.activePollIntervalMs;
        this.pollIntervalMs = this.currentPollInterval;
        this.reschedulePolling(this.currentPollInterval);
        if (this.isRunning && !this._isPolling) {
          this.pollTick().catch(() => {});
        }
      }
    }

    computeNextPollInterval(hasCommand, serverIsActive) {
      if (hasCommand || serverIsActive) {
        this.recordActivity();
        return this.activePollIntervalMs;
      }
      const idleElapsed = Date.now() - this.lastActivityTime;
      return (idleElapsed >= this.idleThresholdMs) ? this.idlePollIntervalMs : this.activePollIntervalMs;
    }

    reschedulePolling(intervalMs) {
      if (!this.isRunning) return;
      this.currentPollInterval = intervalMs;
      this.pollIntervalMs = intervalMs;
      if (this.workerTimer) {
        this.workerTimer.stop();
        this.workerTimer = null;
      }
      this.workerTimer = createWorkerTimer(
        () => {
          if (this.isRunning) {
            this.pollTick();
          }
        },
        this.currentPollInterval,
        {
          Worker: this.customWorker || (typeof Worker !== 'undefined' ? Worker : null),
          Blob: this.customBlob || (typeof Blob !== 'undefined' ? Blob : null),
          URL: this.customURL || (typeof URL !== 'undefined' ? URL : null)
        }
      );
    }

    detectWorkspaceName(doc) {
      if (this.workspaceName) {
        return this.workspaceName;
      }
      const targetDoc = doc || this.customDocument || (typeof document !== 'undefined' ? document : null);
      return detectWorkspaceName(targetDoc);
    }

    getAuthToken() {
      return this.authToken;
    }

    setAuthToken(token) {
      this.authToken = token;
    }

    getBridgeHeaders(customHeaders = {}) {
      const headers = {
        'X-Window-Key': this.windowKey,
        ...customHeaders
      };
      if (this.authToken) {
        headers['X-Bridge-Auth'] = this.authToken;
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }
      return headers;
    }

    async loadSidecarConfig() {
      if (this.authToken) {
        return this.authToken;
      }

      // 1. Try reading from filesystem if Node.js fs is available
      try {
        const fs = (typeof require === 'function') ? require('fs') : null;
        const path = (typeof require === 'function') ? require('path') : null;
        if (fs) {
          const candidates = [];
          if (this.sidecarPath) {
            candidates.push(this.sidecarPath);
          }
          if (path && typeof __dirname !== 'undefined') {
            candidates.push(path.join(__dirname, 'ag-autoplan-config.json'));
            candidates.push(path.join(__dirname, 'autoplan-config.json'));
          }
          if (path && typeof process !== 'undefined' && process.cwd) {
            candidates.push(path.join(process.cwd(), 'ag-autoplan-config.json'));
            candidates.push(path.join(process.cwd(), 'autoplan-config.json'));
          }
          if (path && typeof process !== 'undefined' && process.env) {
            const home = process.env.HOME || process.env.USERPROFILE;
            if (home) {
              candidates.push(path.join(home, '.gemini', 'antigravity-ide', 'ag-autoplan-config.json'));
              candidates.push(path.join(home, '.gemini', 'antigravity-ide', 'autoplan-config.json'));
            }
          }

          for (const p of candidates) {
            try {
              if (fs.existsSync(p)) {
                const raw = fs.readFileSync(p, 'utf8');
                const parsed = JSON.parse(raw);
                const found = parsed.authToken || parsed.bridgeAuthToken;
                if (found) {
                  this.authToken = found;
                  return found;
                }
              }
            } catch (_) {}
          }
        }
      } catch (_) {}

      // 2. Try fetching relative sidecar config file in DOM / browser environment
      if (this.fetchFn) {
        const fetchCandidates = ['./ag-autoplan-config.json', './autoplan-config.json', 'ag-autoplan-config.json', 'autoplan-config.json'];
        for (const url of fetchCandidates) {
          try {
            const res = await this.fetchFn(url);
            if (res && (res.ok || res.status === 200 || res.status === 0)) {
              const cfg = await res.json();
              const found = cfg?.authToken || cfg?.bridgeAuthToken;
              if (found) {
                this.authToken = found;
                return found;
              }
            }
          } catch (_) {}
        }
      }

      // 3. Try reading via XMLHttpRequest in DOM environment
      if (typeof XMLHttpRequest !== 'undefined') {
        const xhrCandidates = ['./ag-autoplan-config.json', './autoplan-config.json', 'ag-autoplan-config.json', 'autoplan-config.json'];
        for (let i = 0; i < xhrCandidates.length; i++) {
          try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', xhrCandidates[i], false);
            xhr.send(null);
            if ((xhr.status === 200 || xhr.status === 0) && xhr.responseText) {
              const cfg = JSON.parse(xhr.responseText);
              const found = cfg?.authToken || cfg?.bridgeAuthToken;
              if (found) {
                this.authToken = found;
                return found;
              }
            }
          } catch (_) {}
        }
      }

      return this.authToken;
    }

    getWorkspaceIdentifier(doc) {
      return this.detectWorkspaceName(doc);
    }

    /**
     * Checks if a command ID has been marked as cancelled by the server
     */
    isCommandCancelled(commandId) {
      return Boolean(commandId && this.cancelledCommands && this.cancelledCommands.has(commandId));
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

      if (this.serverPort && this.fetchFn && this.authToken) {
        try {
          const logsToSend = this.logQueue.length > 0
            ? [...this.logQueue.splice(0, this.logQueue.length), logEntry]
            : [logEntry];

          await this.fetchFn(`http://127.0.0.1:${this.serverPort}/autoplan-log`, {
            method: 'POST',
            headers: this.getBridgeHeaders({ 'Content-Type': 'application/json' }),
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
      if (!this.serverPort || !this.fetchFn || this.logQueue.length === 0 || !this.authToken) {
        return 0;
      }
      try {
        const queuedLogs = this.logQueue.splice(0, this.logQueue.length);
        await this.fetchFn(`http://127.0.0.1:${this.serverPort}/autoplan-log`, {
          method: 'POST',
          headers: this.getBridgeHeaders({ 'Content-Type': 'application/json' }),
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
          headers: this.getBridgeHeaders()
        });
        if (res && res.status === 200) {
          return true;
        } else if (res && (res.status === 401 || res.status === 404 || res.status === 409 || res.status === 423)) {
          this.serverPort = null;
          this.authToken = null;
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
      if (this._discoveryPromise) {
        return this._discoveryPromise;
      }
      this._discoveryPromise = this._doDiscoverPort();
      try {
        return await this._discoveryPromise;
      } finally {
        this._discoveryPromise = null;
      }
    }

    async _doDiscoverPort() {
      await this.loadSidecarConfig();
      const win = this.customWindow || (typeof window !== 'undefined' ? window : null);
      const doc = this.customDocument || (typeof document !== 'undefined' ? document : null);
      const windowUrl = (win && win.location && win.location.href) ? win.location.href : (typeof location !== 'undefined' ? location.href : 'electron://workbench.html');
      const docTitle = doc?.title || (typeof document !== 'undefined' ? document.title : 'Antigravity Workbench');
      const detectedWs = this.detectWorkspaceName(doc);

      await this.sendClientLog('INFO', `Initializing DOM Bridge Client v${this.clientVersion}`, {
        clientVersion: this.clientVersion,
        windowKey: this.windowKey,
        url: windowUrl,
        documentTitle: docTitle,
        workspaceName: detectedWs || undefined
      });

      if (this.serverPort) {
        await this.flushStartupLogQueue();
        return this.serverPort;
      }

      if (typeof window !== 'undefined' && window.__AUTOPLAN_PORT__ && (!window.__AUTOPLAN_WINDOW_KEY__ || window.__AUTOPLAN_WINDOW_KEY__ === this.windowKey)) {
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
          let url = `http://127.0.0.1:${port}/autoplan-status?probe=1&windowKey=${encodeURIComponent(this.windowKey)}`;
          if (detectedWs) {
            url += `&workspaceName=${encodeURIComponent(detectedWs)}&forceRebind=1`;
          }

          const res = await this.fetchFn(url, {
            method: 'GET',
            headers: this.getBridgeHeaders(),
            signal: controller ? controller.signal : undefined
          });

          if (timeoutId) clearTimeout(timeoutId);

          if (res && (res.status === 200 || res.status === 409 || res.status === 423)) {
            let data = null;
            try {
              data = await res.json();
            } catch (_) {}

            if (data && data.service === 'autoplan-bridge-server') {
              if (res.status === 409 && data.rejectReason === 'workspace-mismatch') {
                await this.sendClientLog('INFO', `Skipping port ${port}: workspace mismatch (server: "${data.workspaceName}", client: "${detectedWs}")`, {
                  port,
                  serverWorkspace: data.workspaceName,
                  clientWorkspace: detectedWs
                });
                continue;
              }

              const isOccupiedByOther = Boolean(
                data.status === 'occupied' ||
                data.isCompatible === false ||
                data.bindRejected === true ||
                (data.activeWindowKey && data.activeWindowKey !== this.windowKey)
              );

              if (isOccupiedByOther) {
                await this.sendClientLog('INFO', `Skipping port ${port}: actively bound to window "${data.activeWindowKey || data.serverWindowKey}" (client windowKey: "${this.windowKey}")`, {
                  port,
                  activeWindowKey: data.activeWindowKey,
                  serverWindowKey: data.serverWindowKey,
                  windowKey: this.windowKey
                });
                continue;
              }

              // Validate that data.workspaceName matches the client's detected workspace name before confirming port ownership
              if (detectedWs && data.workspaceName && data.workspaceName !== detectedWs) {
                await this.sendClientLog('INFO', `Skipping port ${port}: server workspace "${data.workspaceName}" does not match detected workspace "${detectedWs}"`, {
                  port,
                  serverWorkspace: data.workspaceName,
                  clientWorkspace: detectedWs
                });
                continue;
              }

              // Server confirms ownership: no active window key, or active window key matches this.windowKey
              const confirmsOwnership = Boolean(
                !data.activeWindowKey ||
                data.activeWindowKey === this.windowKey ||
                data.serverWindowKey === this.windowKey
              );

              if (res.status === 200 && confirmsOwnership) {
                this.serverPort = port;
                if (!this.authToken && (data.authToken || data.bridgeAuthToken)) {
                  this.authToken = data.authToken || data.bridgeAuthToken;
                }
                await this.sendClientLog('INFO', `Connected to BridgeServer on port ${this.serverPort}`, {
                  port: this.serverPort,
                  windowKey: this.windowKey,
                  activeWindowKey: data.activeWindowKey,
                  serverWindowKey: data.serverWindowKey,
                  workspaceName: data.workspaceName
                });
                await this.flushStartupLogQueue();
                await this.sendHeartbeatPing();
                return port;
              }
            }
          }
        } catch (probeErr) {
          // Port not listening or connection refused, continue probe
        }
      }

      if (this.serverPort) {
        return this.serverPort;
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
          headers: this.getBridgeHeaders({ 'Content-Type': 'application/json' }),
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
      if (!this.isRunning || this._isPolling) return;
      this._isPolling = true;

      try {
        if (!this.serverPort || !this.authToken) {
          const port = await this.discoverPort();
          if (!port || !this.authToken) return;
        }

        const url = `http://127.0.0.1:${this.serverPort}/autoplan-status?windowKey=${encodeURIComponent(this.windowKey)}&clientVersion=${this.clientVersion}`;
        const res = await this.fetchFn(url, {
          method: 'GET',
          headers: this.getBridgeHeaders()
        });

        if (!res || res.status !== 200) {
          if (res && (res.status === 401 || res.status === 404 || res.status === 409 || res.status === 423)) {
            logBridge('WARN', `BridgeServer on port ${this.serverPort} returned ${res.status}, resetting serverPort & authToken`, { port: this.serverPort, status: res.status });
            this.serverPort = null;
            this.authToken = null;
            // Immediate re-discovery probe
            await this.discoverPort();
          }
          return;
        }

        const data = await res.json();
        if (data && (data.bindRejected || data.isCompatible === false || (data.activeWindowKey && data.activeWindowKey !== this.windowKey))) {
          logBridge('WARN', `BridgeServer on port ${this.serverPort} rejected binding for window "${this.windowKey}" (owner is "${data.activeWindowKey}"), resetting serverPort`, { port: this.serverPort });
          this.serverPort = null;
          // Immediate re-discovery probe
          await this.discoverPort();
          return;
        }

        const hasCommands = Boolean(data && Array.isArray(data.pendingCommands) && data.pendingCommands.length > 0);
        const serverIsActive = Boolean(data && (data.isExecuting || data.activeTask || (typeof data.pendingCommandsCount === 'number' && data.pendingCommandsCount > 0)));

        const nextInterval = this.computeNextPollInterval(hasCommands, serverIsActive);
        if (nextInterval !== this.currentPollInterval) {
          this.reschedulePolling(nextInterval);
        }

        if (data) {
          const cancelledList = data.cancelledCommandIds || data.cancelledCommands;
          if (Array.isArray(cancelledList)) {
            for (let c = 0; c < cancelledList.length; c++) {
              this.cancelledCommands.add(cancelledList[c]);
            }
          }
        }
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
      } finally {
        this._isPolling = false;
      }
    }

    /**
     * Injects prompt text and triggers submission guarded by in-memory concurrency mutex and 500ms debounce
     */
    async injectPrompt(promptText, options = {}) {
      this.recordActivity();
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

      const cmdId = options.commandId || options.cmdId || options.id;
      if (cmdId && this.isCommandCancelled(cmdId)) {
        const err = new Error(`Command ${cmdId} cancelled by coordinator before injection`);
        err.code = 'COMMAND_ABORTED_BY_TIMEOUT';
        err.aborted = true;
        err.commandId = cmdId;
        throw err;
      }

      this.isSubmitting = true;
      try {
        const result = await injectPromptAndSubmit(promptText, {
          document: this.customDocument,
          window: this.customWindow,
          client: this,
          cancelledCommands: this.cancelledCommands,
          isCancelled: cmdId ? () => this.isCommandCancelled(cmdId) : undefined,
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
    async executeCommand(cmd) {
      return this.handleCommand(cmd);
    }

    async handleCommand(cmd) {
      if (!cmd || !cmd.id) return;
      this.recordActivity();

      if (this.cancelledCommands.has(cmd.id)) {
        logBridge('WARN', `Command ${cmd.id} is already marked as cancelled by coordinator. Aborting.`);
        await this.sendAck(cmd.id, 'aborted', 'COMMAND_ABORTED_BY_TIMEOUT', { commandId: cmd.id });
        return;
      }

      this.activeCommandId = cmd.id;
      const timeoutMs = typeof cmd.timeoutMs === 'number' ? cmd.timeoutMs : 5000;
      this.activeCommandDeadline = Date.now() + timeoutMs;

      try {
        if (cmd.type === 'sendPrompt') {
          const result = await this.injectPrompt(cmd.text || '', {
            ...(cmd.options || {}),
            commandId: cmd.id,
            commandTimeoutMs: timeoutMs,
            commandStartTime: cmd.createdAt || Date.now(),
            commandDeadline: this.activeCommandDeadline,
            cancelledCommands: this.cancelledCommands,
            isCancelled: () => this.isCommandCancelled(cmd.id)
          });

          if (result && result.success === false) {
            const status = (result.status === 'failed' || result.code === 'BUTTON_DISABLED_TIMEOUT' || result.rejectionReason === 'button_disabled_timeout') ? 'failed' : 'error';
            await this.sendAck(cmd.id, status, result.error || result.rejectionReason || 'Synthetic Enter event was not accepted by the editor (input was not cleared)', {
              ...result,
              status,
              isBackgroundSubmission: Boolean(
                result?.isBackgroundSubmission ||
                (this.customDocument ? this.customDocument.hidden : (typeof document !== 'undefined' && document.hidden))
              )
            });
          } else {
            await this.sendAck(cmd.id, 'submitClicked', null, {
              ...result,
              isBackgroundSubmission: Boolean(
                result?.isBackgroundSubmission ||
                (this.customDocument ? this.customDocument.hidden : (typeof document !== 'undefined' && document.hidden))
              )
            });
          }
        } else if (cmd.type === 'openNewConversation') {
          const result = await handleOpenNewConversation({
            document: this.customDocument,
            window: this.customWindow,
            ...(cmd.options || {}),
            timeoutMs: typeof cmd.timeoutMs === 'number' ? cmd.timeoutMs : undefined
          });

          const isSuccess = Boolean(result && (typeof result === 'object' ? result.success !== false : result));
          await this.sendAck(
            cmd.id,
            isSuccess ? 'completed' : 'error',
            isSuccess ? null : (result?.error || 'Failed to find new conversation button'),
            typeof result === 'object' ? result : { success: isSuccess }
          );
        } else if (cmd.type === 'captureWorkbenchDom') {
          try {
            const doc = this.customDocument || (typeof document !== 'undefined' ? document : null);
            if (!doc || !doc.documentElement || typeof doc.documentElement.outerHTML !== 'string') {
              logBridge('WARN', 'captureWorkbenchDom: document.documentElement is inaccessible');
              await this.sendAck(cmd.id, 'error', 'DOM documentElement is inaccessible');
              return;
            }
            const html = doc.documentElement.outerHTML;
            const win = this.customWindow || (typeof window !== 'undefined' ? window : null);
            const currentUrl = (win && win.location) ? (typeof win.location === 'string' ? win.location : win.location.href || '') : (doc && doc.location ? (typeof doc.location === 'string' ? doc.location : doc.location.href || '') : '');
            let byteLength = 0;
            if (typeof Buffer !== 'undefined' && Buffer.byteLength) {
              byteLength = Buffer.byteLength(html, 'utf8');
            } else if (typeof TextEncoder !== 'undefined') {
              byteLength = new TextEncoder().encode(html).length;
            } else {
              byteLength = html.length;
            }
            const timestamp = Date.now();

            await this.sendAck(cmd.id, 'completed', null, {
              html,
              byteLength,
              url: currentUrl,
              timestamp
            });
          } catch (captureErr) {
            logBridge('WARN', `captureWorkbenchDom error: ${captureErr?.message || captureErr}`, {}, captureErr);
            await this.sendAck(cmd.id, 'error', captureErr?.message || String(captureErr));
          }
        } else if (cmd.type === 'clickApproval') {
          await this.sendAck(cmd.id, 'completed', null, { clickedCount: 0 });
        } else if (cmd.type === 'stopGeneration') {
          const doc = this.customDocument || (typeof document !== 'undefined' ? document : null);
          const win = this.customWindow || (typeof window !== 'undefined' ? window : null);
          const result = await stopActiveGeneration({
            document: doc,
            window: win,
            ...(cmd.options || {})
          });

          await this.sendAck(
            cmd.id,
            result.status || (result.stopped ? 'stopped' : 'idle'),
            result.error || null,
            result
          );
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
        if (err?.code) {
          metadata.code = err.code;
        }
        if (err?.charsExpected !== undefined) {
          metadata.charsExpected = err.charsExpected;
        }
        if (err?.charsDetectedInDOM !== undefined) {
          metadata.charsDetectedInDOM = err.charsDetectedInDOM;
        }
        if (err?.domExcerpt !== undefined) {
          metadata.domExcerpt = err.domExcerpt;
        }
        if (err?.rejectionReason) {
          metadata.rejectionReason = err.rejectionReason;
        }
        if (err?.elementContext !== undefined) {
          metadata.elementContext = err.elementContext;
        }

        const isAborted = err?.code === 'COMMAND_ABORTED_BY_TIMEOUT' || err?.aborted === true;
        const isButtonDisabledTimeout = err?.code === 'BUTTON_DISABLED_TIMEOUT' || err?.rejectionReason === 'button_disabled_timeout';
        const isFailed = isButtonDisabledTimeout || err?.status === 'failed';
        const status = isAborted ? 'aborted' : (isFailed ? 'failed' : 'error');

        if (isButtonDisabledTimeout) {
          metadata.code = 'BUTTON_DISABLED_TIMEOUT';
          metadata.status = 'failed';
          metadata.rejectionReason = 'button_disabled_timeout';
          metadata.buttonClass = err.diagnostics?.buttonClass || err.buttonSelector || '';
          metadata.disabledDuration = err.buttonWaitDurationMs !== undefined ? err.buttonWaitDurationMs : (err.diagnostics?.disabledDurationMs || 0);
          metadata.initialState = {
            initialDisabled: err.initialDisabled !== undefined ? err.initialDisabled : true
          };
          metadata.diagnostics = {
            buttonClass: metadata.buttonClass,
            disabledDuration: metadata.disabledDuration,
            initialDisabled: metadata.initialState.initialDisabled,
            ...(err.diagnostics || {})
          };
          metadata.sendButtonClicked = false;
          metadata.enterDispatched = false;
          metadata.isSuccess = false;
        }

        await this.sendClientLog(isAborted ? 'WARN' : (isFailed ? 'WARN' : 'ERROR'), `Command ${cmd.id} (${cmd.type}) execution ${isAborted ? 'aborted' : (isFailed ? 'rejected' : 'failed')}: ${err?.message || err}`, {
          commandId: cmd.id,
          error: err?.message || String(err),
          metadata
        });

        await this.sendAck(cmd.id, status, err?.message || String(err), metadata);
      } finally {
        if (this.activeCommandId === cmd.id) {
          this.activeCommandId = null;
          this.activeCommandDeadline = 0;
        }
      }
    }

    /**
     * Starts the client polling loop
     */
    start() {
      if (this.isRunning) return;
      this.isRunning = true;
      this.lastActivityTime = Date.now();
      this.currentPollInterval = this.activePollIntervalMs;
      this.pollIntervalMs = this.currentPollInterval;

      const win = this.customWindow || (typeof window !== 'undefined' ? window : null);
      if (win && typeof win.addEventListener === 'function') {
        this._activityHandler = () => {
          this.recordActivity();
        };
        try {
          win.addEventListener('focus', this._activityHandler);
          win.addEventListener('pointerdown', this._activityHandler);
          win.addEventListener('keydown', this._activityHandler);
        } catch (_) {}
      }

      this.loadSidecarConfig().catch(() => {});

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
        this.currentPollInterval,
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
      if (this._activityHandler) {
        const win = this.customWindow || (typeof window !== 'undefined' ? window : null);
        if (win && typeof win.removeEventListener === 'function') {
          try {
            win.removeEventListener('focus', this._activityHandler);
            win.removeEventListener('pointerdown', this._activityHandler);
            win.removeEventListener('keydown', this._activityHandler);
          } catch (_) {}
        }
        this._activityHandler = null;
      }
    }
  }

  // Export module / global object
  const exportsObj = {
    DEFAULT_PORT_START,
    DEFAULT_PORT_END,
    DEFAULT_POLL_INTERVAL_MS,
    ACTIVE_POLL_INTERVAL_MS,
    IDLE_POLL_INTERVAL_MS,
    IDLE_THRESHOLD_MS,
    IDLE_TIMEOUT_MS: IDLE_THRESHOLD_MS,
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    CONTAINER_SELECTORS,
    queryDeep,
    isElementVisible,
    isCodeEditorElement,
    isInsideChatContainer,
    hasChatIdentifiers,
    captureDomDiagnosticSnapshot,
    findChatInput,
    findSendButton,
    findCancelButton,
    countUserMessages,
    findNewConversationButton,
    dispatchButtonClickCascade,
    isInputClearedOrSubmitted,
    verifyInputSubmission,
    CLEARANCE_MIN_POLL_INTERVAL_MS,
    getEffectiveClearancePollInterval,
    extractDomBufferText,
    verifyBufferHasText,
    injectPromptAndSubmit,
    triggerNewConversation,
    handleOpenNewConversation,
    stopActiveGeneration,
    isRelevantDialogMutation,
    DIALOG_CONTAINER_SELECTORS,
    createWorkerTimer,
    detectWorkspaceName,
    parseWorkspaceFromTitleString,
    getWorkspaceIdentifier,
    DomBridgeClient,
    DOMAutomationBridgeClient: DomBridgeClient,
    BridgeClient: DomBridgeClient
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

