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
    '.interactive-session',
    'div.chat-input',
    '.chat-input-container',
    '.monaco-dialog-box',
    '.dialog-shadow',
    '.notifications-toasts',
    '.monaco-alert-dialog'
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
                  const found = container.querySelectorAll(selector);
                  results = results.concat(Array.from(found));
                }
                if (container.shadowRoot && !visited.has(container.shadowRoot)) {
                  results = results.concat(queryDeep(selector, container.shadowRoot, visited));
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

          try {
            const allNodes = doc.querySelectorAll('*');
            for (let i = 0; i < allNodes.length; i++) {
              const el = allNodes[i];
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
                  logBridge('WARN', `Cross-origin iframe access restricted during full DOM search: ${frameErr?.message || frameErr}`, {
                    iframeId: el.id,
                    iframeSrc: el.src
                  }, frameErr);
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
   * Helper to check if an element is visible in the DOM
   */
  function isElementVisible(el) {
    if (!el) return false;
    if (el.disabled) return false;
    try {
      if (typeof el.getBoundingClientRect === 'function') {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0 && !el.offsetParent && el.style?.display === 'none') {
          return false;
        }
      }
      if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) {
        return false;
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
      const ceList = queryDeep('[contenteditable="true"], div.monaco-editor, div.ProseMirror', root);
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
      '.interactive-session .monaco-editor textarea.inputarea',
      'div.monaco-editor textarea.inputarea',
      '.monaco-editor textarea.inputarea',
      '.monaco-editor textarea',
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
      'textarea',
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
   * On failure, captures evaluated selectors and nearby button elements.
   */
  function findSendButton(contextOrDoc, outOptions = {}) {
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
      'button.codicon-send',
      '[aria-label*="Chat Submit"]',
      '[aria-label*="Submit Prompt"]'
    ];

    const evaluatedSelectors = [];

    for (let i = 0; i < selectors.length; i++) {
      const sel = selectors[i];
      const candidates = queryDeep(sel, root);
      evaluatedSelectors.push({ selector: sel, matches: candidates.length });

      for (let j = 0; j < candidates.length; j++) {
        const el = candidates[j];
        if (el) {
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

    // If submit button not found, capture nearby button elements
    const nearbyButtons = [];
    try {
      const candidates = queryDeep('button, [role="button"], .codicon-send, .monaco-button, a.monaco-button', root);
      for (let i = 0; i < candidates.length; i++) {
        const btn = candidates[i];
        if (!btn) continue;
        nearbyButtons.push({
          tagName: btn.tagName || '',
          className: btn.className || '',
          ariaLabel: btn.getAttribute?.('aria-label') || '',
          title: btn.getAttribute?.('title') || btn.title || '',
          codicon: Boolean(btn.classList && (btn.classList.contains('codicon-send') || (typeof btn.className === 'string' && btn.className.includes('codicon')))),
          visible: isElementVisible(btn)
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
      inputElem.classList?.contains('monaco-editor');

    let valueSet = false;

    // Strategy 1: Monaco Editor Model setValue
    try {
      if (win && win.monaco && win.monaco.editor) {
        let editorInstance = null;
        if (typeof win.monaco.editor.getEditors === 'function') {
          const editors = win.monaco.editor.getEditors();
          for (let i = 0; i < editors.length; i++) {
            const ed = editors[i];
            const domNode = typeof ed.getDomNode === 'function' ? ed.getDomNode() : null;
            if (domNode && (domNode === inputElem || (typeof domNode.contains === 'function' && domNode.contains(inputElem)) || (typeof inputElem.contains === 'function' && inputElem.contains(domNode)))) {
              editorInstance = ed;
              break;
            }
          }
        }
        if (editorInstance) {
          const model = typeof editorInstance.getModel === 'function' ? editorInstance.getModel() : null;
          if (model && typeof model.setValue === 'function') {
            model.setValue(promptText);
            valueSet = true;
            injectionStrategy = 'monaco-model';
          }
        }
      }
    } catch (monacoErr) {
      logBridge('WARN', `Monaco editor model injection error: ${monacoErr?.message || monacoErr}`, {}, monacoErr);
    }

    // Strategy 2: ProseMirror Transaction Dispatch
    if (!valueSet && isContentEditable) {
      try {
        const pmView = inputElem.pmViewDesc?.view || inputElem._pmView;
        if (pmView && pmView.state && typeof pmView.dispatch === 'function' && pmView.state.schema) {
          const schema = pmView.state.schema;
          const tr = pmView.state.tr;
          if (schema.text && tr && typeof tr.replaceWith === 'function') {
            tr.replaceWith(0, pmView.state.doc?.content?.size || 0, schema.text(promptText));
            pmView.dispatch(tr);
            valueSet = true;
            injectionStrategy = 'prosemirror-transaction';
          }
        }
      } catch (pmErr) {
        logBridge('WARN', `ProseMirror transaction dispatch error: ${pmErr?.message || pmErr}`, {}, pmErr);
      }
    }

    // Strategy 3: execCommand (for rich text/contenteditable/ProseMirror/Monaco)
    if (!valueSet && isContentEditable && doc.execCommand) {
      try {
        doc.execCommand('selectAll', false, null);
        const success = doc.execCommand('insertText', false, promptText);
        if (success) {
          valueSet = true;
          injectionStrategy = 'execCommand';
        }
      } catch (cmdErr) {
        logBridge('WARN', `doc.execCommand failed: ${cmdErr?.message || cmdErr}`, {}, cmdErr);
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

      // Value setter with descriptor fallback
      let descSet = false;
      if (win && win.HTMLTextAreaElement && win.HTMLTextAreaElement.prototype) {
        try {
          const desc = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value');
          if (desc && desc.set) {
            desc.set.call(inputElem, promptText);
            descSet = true;
          }
        } catch (vErr) {
          logBridge('WARN', `HTMLTextAreaElement value descriptor set failed: ${vErr?.message || vErr}`, {}, vErr);
        }
      }
      if (!descSet) {
        inputElem.value = promptText;
      }
      valueSet = true;
      injectionStrategy = 'textarea-value';
    } else if (!valueSet) {
      // ContentEditable direct fallback
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

    // Step 4: Submit triggering (Enter keydown/keyup events + submit button click)
    let enterDispatched = false;
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
        enterDispatched = true;
      }
    } catch (kbErr) {
      logBridge('WARN', `KeyboardEvent dispatch failed: ${kbErr?.message || kbErr}`, {}, kbErr);
    }

    const sendBtnDiag = {};
    const sendBtn = options.sendButton || findSendButton(doc || inputElem?.ownerDocument || inputElem, sendBtnDiag);
    let sendButtonClicked = false;
    if (sendBtn) {
      if (typeof sendBtn.click === 'function') {
        try {
          sendBtn.click();
          sendButtonClicked = true;
        } catch (clickErr) {
          logBridge('WARN', `sendBtn.click() failed: ${clickErr?.message || clickErr}`, {}, clickErr);
        }
      }
      try {
        if (win && typeof win.MouseEvent === 'function') {
          sendBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
          sendButtonClicked = true;
        }
      } catch (_) {}
    }

    const isDocHidden = Boolean(doc?.hidden || (typeof document !== 'undefined' && document.hidden));
    const isBackgroundSubmission = Boolean(options.isBackground || isDocHidden);

    steps.push({
      step: 4,
      name: 'Submit triggering',
      status: (sendButtonClicked || enterDispatched) ? 'success' : 'failed',
      enterDispatched,
      sendButtonClicked,
      buttonSelector: sendBtn?.className || sendBtn?.tagName || null,
      sendButtonDiagnostics: !sendButtonClicked ? sendBtnDiag.diagnostics : undefined
    });

    const report = {
      success: true,
      isBackgroundSubmission,
      injectionStrategy,
      sendButtonClicked,
      enterDispatched,
      buttonSelector: sendBtn?.className || sendBtn?.tagName || null,
      charsInjected: promptText.length,
      steps,
      diagnostics: {
        timestamp: Date.now(),
        isBackground: isBackgroundSubmission,
        documentHidden: isDocHidden,
        steps
      }
    };

    logBridge('INFO', `Prompt injected and submitted (${promptText.length} chars, strategy=${injectionStrategy}, sendClicked=${sendButtonClicked}, background=${isBackgroundSubmission})`, {
      injectionStrategy,
      sendButtonClicked,
      enterDispatched,
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
    const newBtn = options.button || findNewConversationButton(doc);
    if (newBtn && typeof newBtn.click === 'function') {
      try {
        newBtn.click();
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
    captureDomDiagnosticSnapshot,
    findChatInput,
    findSendButton,
    findNewConversationButton,
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

