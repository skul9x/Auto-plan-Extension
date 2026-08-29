(function () {
  // Acquire VS Code API with safe fallback
  const vscode = typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : (typeof window !== 'undefined' && window.__mockVsCode ? window.__mockVsCode : { postMessage: function () {} });

  // DOM Elements - Selection & Tiers
  const optTierAuto = document.getElementById('optTierAuto');
  const optTier1 = document.getElementById('optTier1');
  const optTier2 = document.getElementById('optTier2');
  const optTier3 = document.getElementById('optTier3');
  const tierCards = document.querySelectorAll('.tier-card');
  const chkAllowFallback = document.getElementById('chkAllowFallback');

  // DOM Elements - Timing Controls
  const txtDelayMs = document.getElementById('txtDelayMs');
  const txtTimeoutMinutes = document.getElementById('txtTimeoutMinutes');
  const txtRepeatCount = document.getElementById('txtRepeatCount');
  const txtFocusDelayMs = document.getElementById('txtFocusDelayMs');
  const txtBridgeTimeoutMs = document.getElementById('txtBridgeTimeoutMs');

  // DOM Elements - Plan & Automation
  const txtDefaultPlanFolder = document.getElementById('txtDefaultPlanFolder');
  const btnBrowseFolder = document.getElementById('btnBrowseFolder');
  const chkAutoApprovePermissions = document.getElementById('chkAutoApprovePermissions');
  const chkAutoInjectWorkbench = document.getElementById('chkAutoInjectWorkbench');
  const chkSuppressFallbackWarnings = document.getElementById('chkSuppressFallbackWarnings');

  // DOM Elements - Template & Keyword
  const txtPromptTemplate = document.getElementById('txtPromptTemplate');
  const txtCompletionKeyword = document.getElementById('txtCompletionKeyword');
  const btnPresetKeyword = document.getElementById('btnPresetKeyword');
  const tagButtons = document.querySelectorAll('.tag-btn');

  // DOM Elements - Diagnostics & Bridge
  const btnTestTier = document.getElementById('btnTestTier');
  const testTierSpinner = document.getElementById('testTierSpinner');
  const testTierBadge = document.getElementById('testTierBadge');
  const btnSetupBridge = document.getElementById('btnSetupBridge');
  const btnUninstallBridge = document.getElementById('btnUninstallBridge');

  // DOM Elements - Health Indicators
  const overallHealthBadge = document.getElementById('overallHealthBadge');
  const overallHealthText = document.getElementById('overallHealthText');
  const healthPort = document.getElementById('healthPort');
  const healthInjected = document.getElementById('healthInjected');
  const healthClients = document.getElementById('healthClients');
  const healthToolchain = document.getElementById('healthToolchain');
  const tier1StatusIndicator = document.getElementById('tier1StatusIndicator');
  const tier1ClientsIndicator = document.getElementById('tier1ClientsIndicator');
  const tier2StatusIndicator = document.getElementById('tier2StatusIndicator');
  const tier3StatusIndicator = document.getElementById('tier3StatusIndicator');

  // DOM Elements - Actions & Status
  const btnSave = document.getElementById('btnSave');
  const btnReset = document.getElementById('btnReset');
  const saveStatusText = document.getElementById('saveStatusText');
  const toastNotification = document.getElementById('toastNotification');

  let savedBaseline = '';
  let toastTimer = null;

  /**
   * Serializes current form values into a configuration object.
   */
  function getFormSettings() {
    let executionMode = 'auto';
    const checkedRadio = document.querySelector('input[name="executionMode"]:checked');
    if (checkedRadio) {
      executionMode = checkedRadio.value;
    }

    return {
      executionMode: executionMode,
      allowTierFallback: chkAllowFallback ? chkAllowFallback.checked : true,
      delayBetweenLoopsMs: txtDelayMs ? (parseInt(txtDelayMs.value, 10) || 2000) : 2000,
      timeoutPerLoopMinutes: txtTimeoutMinutes ? (parseInt(txtTimeoutMinutes.value, 10) || 15) : 15,
      repeatCount: txtRepeatCount ? (parseInt(txtRepeatCount.value, 10) || 5) : 5,
      focusDelayMs: txtFocusDelayMs ? (parseInt(txtFocusDelayMs.value, 10) || 800) : 800,
      bridgeTimeoutMs: txtBridgeTimeoutMs ? (parseInt(txtBridgeTimeoutMs.value, 10) || 5000) : 5000,
      defaultPlanFolder: txtDefaultPlanFolder ? txtDefaultPlanFolder.value.trim() : '',
      promptTemplate: txtPromptTemplate ? txtPromptTemplate.value : '',
      promptText: txtPromptTemplate ? txtPromptTemplate.value : '',
      completionKeyword: txtCompletionKeyword ? txtCompletionKeyword.value.trim() : 'Done skul9x.',
      autoApprovePermissions: chkAutoApprovePermissions ? chkAutoApprovePermissions.checked : true,
      autoInjectWorkbench: chkAutoInjectWorkbench ? chkAutoInjectWorkbench.checked : true,
      suppressFallbackWarnings: chkSuppressFallbackWarnings ? chkSuppressFallbackWarnings.checked : true
    };
  }

  /**
   * Updates UI controls with values from a configuration object.
   */
  function applySettingsToForm(config) {
    if (!config) return;

    const mode = config.executionMode || 'auto';
    const radios = document.querySelectorAll('input[name="executionMode"]');
    radios.forEach((r) => {
      r.checked = (r.value === mode);
    });
    updateActiveTierCards();

    if (chkAllowFallback) {
      chkAllowFallback.checked = config.allowTierFallback !== false;
    }
    if (txtDelayMs) {
      txtDelayMs.value = config.delayBetweenLoopsMs !== undefined ? config.delayBetweenLoopsMs : 2000;
    }
    if (txtTimeoutMinutes) {
      txtTimeoutMinutes.value = config.timeoutPerLoopMinutes !== undefined ? config.timeoutPerLoopMinutes : 15;
    }
    if (txtRepeatCount) {
      txtRepeatCount.value = config.repeatCount !== undefined ? config.repeatCount : 5;
    }
    if (txtFocusDelayMs) {
      txtFocusDelayMs.value = config.focusDelayMs !== undefined ? config.focusDelayMs : 800;
    }
    if (txtBridgeTimeoutMs) {
      txtBridgeTimeoutMs.value = config.bridgeTimeoutMs !== undefined ? config.bridgeTimeoutMs : 5000;
    }
    if (txtDefaultPlanFolder) {
      txtDefaultPlanFolder.value = config.defaultPlanFolder || '';
    }
    if (txtPromptTemplate) {
      txtPromptTemplate.value = config.promptTemplate || config.promptText || '';
    }
    if (txtCompletionKeyword) {
      txtCompletionKeyword.value = config.completionKeyword || 'Done skul9x.';
    }
    if (chkAutoApprovePermissions) {
      chkAutoApprovePermissions.checked = config.autoApprovePermissions !== false;
    }
    if (chkAutoInjectWorkbench) {
      chkAutoInjectWorkbench.checked = config.autoInjectWorkbench !== false;
    }
    if (chkSuppressFallbackWarnings) {
      chkSuppressFallbackWarnings.checked = config.suppressFallbackWarnings !== false;
    }

    savedBaseline = JSON.stringify(getFormSettings());
    checkDirty();
  }

  /**
   * Updates CSS active classes on tier cards to reflect selected radio.
   */
  function updateActiveTierCards() {
    tierCards.forEach((card) => {
      const radio = card.querySelector('input[type="radio"]');
      if (radio && radio.checked) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });
  }

  /**
   * Checks if current form values differ from the saved baseline.
   */
  function checkDirty() {
    const current = JSON.stringify(getFormSettings());
    const isDirty = current !== savedBaseline;

    if (btnSave) {
      btnSave.disabled = !isDirty;
    }
    if (saveStatusText) {
      if (isDirty) {
        saveStatusText.textContent = 'Unsaved changes';
        saveStatusText.classList.add('unsaved');
      } else {
        saveStatusText.textContent = 'All changes saved';
        saveStatusText.classList.remove('unsaved');
      }
    }
    return isDirty;
  }

  /**
   * Inserts text tag at cursor position in a textarea.
   */
  function insertTagAtCursor(textarea, tag) {
    if (!textarea) return;
    const start = textarea.selectionStart !== undefined ? textarea.selectionStart : textarea.value.length;
    const end = textarea.selectionEnd !== undefined ? textarea.selectionEnd : textarea.value.length;
    const val = textarea.value;

    textarea.value = val.substring(0, start) + tag + val.substring(end);
    textarea.focus();
    if (textarea.setSelectionRange) {
      const newPos = start + tag.length;
      textarea.setSelectionRange(newPos, newPos);
    }
    checkDirty();
  }

  /**
   * Displays an interactive toast alert.
   */
  function showToast(message, type, duration) {
    if (!toastNotification) return;
    if (toastTimer) {
      clearTimeout(toastTimer);
    }

    toastNotification.textContent = message;
    toastNotification.className = 'toast';
    if (type === 'success') {
      toastNotification.classList.add('toast-success');
    } else if (type === 'danger') {
      toastNotification.classList.add('toast-danger');
    }
    toastNotification.classList.remove('hidden');

    toastTimer = setTimeout(() => {
      toastNotification.classList.add('hidden');
    }, duration || 3500);
  }

  // ==========================================================================
  // Event Binding
  // ==========================================================================

  // Tier Card selection clicks
  tierCards.forEach((card) => {
    card.addEventListener('click', (e) => {
      const radio = card.querySelector('input[type="radio"]');
      if (radio && !radio.checked) {
        document.querySelectorAll('input[name="executionMode"]').forEach((r) => {
          r.checked = false;
        });
        radio.checked = true;
        updateActiveTierCards();
        checkDirty();
      }
    });
  });

  // Track inputs dirty state
  const formInputs = [
    optTierAuto, optTier1, optTier2, optTier3, chkAllowFallback,
    txtDelayMs, txtTimeoutMinutes, txtRepeatCount, txtFocusDelayMs, txtBridgeTimeoutMs,
    txtDefaultPlanFolder, chkAutoApprovePermissions, chkAutoInjectWorkbench, chkSuppressFallbackWarnings,
    txtPromptTemplate, txtCompletionKeyword
  ];

  formInputs.forEach((input) => {
    if (input) {
      input.addEventListener('input', checkDirty);
      input.addEventListener('change', checkDirty);
    }
  });

  // Tag helper buttons
  tagButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tag = btn.getAttribute('data-tag');
      if (tag && txtPromptTemplate) {
        insertTagAtCursor(txtPromptTemplate, tag);
      }
    });
  });

  // Preset keyword button
  if (btnPresetKeyword && txtCompletionKeyword) {
    btnPresetKeyword.addEventListener('click', (e) => {
      e.preventDefault();
      txtCompletionKeyword.value = 'Done skul9x.';
      checkDirty();
    });
  }

  // Folder browse button
  if (btnBrowseFolder) {
    btnBrowseFolder.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ command: 'openFolderPicker' });
    });
  }

  // Save button
  if (btnSave) {
    btnSave.addEventListener('click', (e) => {
      e.preventDefault();
      const settings = getFormSettings();
      vscode.postMessage({
        command: 'saveSettings',
        settings: settings
      });
    });
  }

  // Reset button
  if (btnReset) {
    btnReset.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ command: 'resetSettings' });
    });
  }

  // Test Tier button
  if (btnTestTier) {
    btnTestTier.addEventListener('click', (e) => {
      e.preventDefault();
      const currentTier = getFormSettings().executionMode;

      if (testTierSpinner) {
        testTierSpinner.classList.remove('hidden');
      }
      if (testTierBadge) {
        testTierBadge.className = 'test-result-badge badge-testing';
        testTierBadge.textContent = 'Testing tier dispatch...';
      }

      vscode.postMessage({
        command: 'testTier',
        tier: currentTier
      });
    });
  }

  // Bridge management buttons
  if (btnSetupBridge) {
    btnSetupBridge.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ command: 'setupBridge' });
    });
  }

  if (btnUninstallBridge) {
    btnUninstallBridge.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ command: 'uninstallBridge' });
    });
  }

  // ==========================================================================
  // IPC Message Listener from Extension Host
  // ==========================================================================
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;

    const command = message.command || message.type;

    switch (command) {
      case 'initSettings': {
        const config = message.settings || message.config || {};
        applySettingsToForm(config);
        break;
      }

      case 'saveConfirmed': {
        savedBaseline = JSON.stringify(getFormSettings());
        checkDirty();
        showToast('Settings successfully saved.', 'success');
        break;
      }

      case 'healthUpdate': {
        if (message.port !== undefined && healthPort) {
          healthPort.textContent = String(message.port);
        }
        if (message.injected !== undefined && healthInjected) {
          healthInjected.textContent = message.injected ? 'Ready' : 'Not Injected';
        }
        if (message.clients !== undefined && healthClients) {
          healthClients.textContent = `${message.clients} client${message.clients === 1 ? '' : 's'}`;
        }
        if (message.toolchain !== undefined && healthToolchain) {
          healthToolchain.textContent = message.toolchain;
        }

        // Sub-indicators in tier cards
        if (tier1StatusIndicator && message.port) {
          tier1StatusIndicator.textContent = `Port: ${message.port}`;
        }
        if (tier1ClientsIndicator && message.clients !== undefined) {
          tier1ClientsIndicator.textContent = `Clients: ${message.clients}`;
        }
        if (tier2StatusIndicator && message.nativeCommandStatus) {
          tier2StatusIndicator.textContent = message.nativeCommandStatus;
        }
        if (tier3StatusIndicator && message.toolchain) {
          tier3StatusIndicator.textContent = `Toolchain: ${message.toolchain}`;
        }
        if (overallHealthBadge && overallHealthText) {
          const isHealthy = message.isHealthy !== false;
          overallHealthBadge.className = isHealthy ? 'health-badge status-healthy' : 'health-badge';
          overallHealthText.textContent = isHealthy ? 'Engine Ready' : 'Degraded';
        }
        break;
      }

      case 'testResult': {
        if (testTierSpinner) {
          testTierSpinner.classList.add('hidden');
        }
        if (testTierBadge) {
          if (message.success) {
            const latency = message.latencyMs ? ` (${message.latencyMs}ms)` : '';
            testTierBadge.className = 'test-result-badge badge-success';
            testTierBadge.textContent = `✓ Passed${latency}`;
          } else {
            testTierBadge.className = 'test-result-badge badge-danger';
            testTierBadge.textContent = `✗ Failed: ${message.error || 'Check status'}`;
          }
        }
        break;
      }

      case 'folderSelected': {
        if (message.folderPath && txtDefaultPlanFolder) {
          txtDefaultPlanFolder.value = message.folderPath;
          checkDirty();
        }
        break;
      }

      case 'error': {
        showToast(message.error || message.message || 'An unexpected error occurred.', 'danger');
        break;
      }
    }
  });

  // Export functions if in Node.js test environment
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getFormSettings,
      applySettingsToForm,
      checkDirty,
      insertTagAtCursor,
      updateActiveTierCards,
      showToast
    };
  }

  // Signal ready to Extension Host
  vscode.postMessage({ command: 'ready' });
})();
