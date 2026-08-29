(function () {
  const vscode = acquireVsCodeApi();

  // DOM Elements
  const bridgeStatusBadge = document.getElementById('bridgeStatusBadge');
  const bridgeStatusText = document.getElementById('bridgeStatusText');
  const planFolderSelect = document.getElementById('planFolderSelect');
  const btnRefreshPlans = document.getElementById('btnRefreshPlans');
  const btnSelectFolder = document.getElementById('btnSelectFolder');
  
  const elapsedTime = document.getElementById('elapsedTime');
  const progressCounter = document.getElementById('progressCounter');
  const progressBarFill = document.getElementById('progressBarFill');

  const toggleAllPhases = document.getElementById('toggleAllPhases');
  const selectedCountBadge = document.getElementById('selectedCountBadge');
  const phaseList = document.getElementById('phaseList');

  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnSkip = document.getElementById('btnSkip');
  const btnStop = document.getElementById('btnStop');

  const btnClearLog = document.getElementById('btnClearLog');
  const transcriptLog = document.getElementById('transcriptLog');
  const transcriptViewport = document.getElementById('transcriptViewport');

  const btnActivateBridge = document.getElementById('btnActivateBridge');
  const btnDiagnostics = document.getElementById('btnDiagnostics');
  const btnCopyBridgeLog = document.getElementById('btnCopyBridgeLog');
  const btnSettings = document.getElementById('btnSettings');

  let currentPhases = [];
  let selectedIndices = new Set();
  let currentState = 'idle';

  // Event Listeners for User Actions
  btnStart.addEventListener('click', () => {
    vscode.postMessage({ command: 'start' });
  });

  btnPause.addEventListener('click', () => {
    if (currentState === 'paused') {
      vscode.postMessage({ command: 'resume' });
    } else {
      vscode.postMessage({ command: 'pause' });
    }
  });

  btnSkip.addEventListener('click', () => {
    vscode.postMessage({ command: 'skip' });
  });

  btnStop.addEventListener('click', () => {
    vscode.postMessage({ command: 'stop' });
  });

  planFolderSelect.addEventListener('change', (e) => {
    const folderPath = e.target.value;
    if (folderPath) {
      vscode.postMessage({ command: 'selectPlanFolder', folderPath });
    }
  });

  btnSelectFolder.addEventListener('click', () => {
    vscode.postMessage({ command: 'selectPlanFolder' });
  });

  btnRefreshPlans.addEventListener('click', () => {
    vscode.postMessage({ command: 'refreshPlans' });
  });

  toggleAllPhases.addEventListener('change', (e) => {
    const selected = e.target.checked;
    vscode.postMessage({ command: 'toggleAllPhases', selected });
  });

  btnClearLog.addEventListener('click', () => {
    transcriptLog.textContent = 'Feed cleared.';
  });

  btnActivateBridge.addEventListener('click', () => {
    vscode.postMessage({ command: 'activateBridge' });
  });

  btnDiagnostics.addEventListener('click', () => {
    vscode.postMessage({ command: 'diagnostics' });
  });

  if (btnCopyBridgeLog) {
    btnCopyBridgeLog.addEventListener('click', () => {
      vscode.postMessage({ command: 'copyBridgeLog' });
    });
  }

  btnSettings.addEventListener('click', () => {
    vscode.postMessage({ command: 'settings' });
  });

  // Handle messages from Extension Host
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;

    const command = message.command || message.type;

    switch (command) {
      case 'stateUpdate':
        renderStateUpdate(message);
        break;
      case 'bridgeStatus':
        renderBridgeStatus(message);
        break;
      case 'transcriptLog':
        renderTranscriptLog(message);
        break;
      case 'transcriptLogBatch':
        renderTranscriptLogBatch(message);
        break;
      case 'progress':
        renderProgress(message);
        break;
    }
  });

  function renderStateUpdate(data) {
    currentState = data.status || 'idle';
    currentPhases = data.phases || [];
    selectedIndices = new Set(data.selectedIndices || []);

    // Update Action Button states
    if (currentState === 'running') {
      btnStart.textContent = '🔄 Running...';
      btnStart.disabled = true;
      btnPause.textContent = '⏸️ Pause';
      btnPause.disabled = false;
    } else if (currentState === 'paused') {
      btnStart.textContent = '▶️ Resume Execution';
      btnStart.disabled = false;
      btnPause.textContent = '▶️ Resume';
      btnPause.disabled = false;
    } else {
      btnStart.textContent = '▶️ Run Selected Phases';
      btnStart.disabled = false;
      btnPause.textContent = '⏸️ Pause';
      btnPause.disabled = true;
    }

    // Update Plan Select Options if plans provided
    if (data.plans && Array.isArray(data.plans)) {
      planFolderSelect.innerHTML = '<option value="">-- Select or Browse Plan --</option>';
      data.plans.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.folderPath;
        opt.textContent = `${p.relName} (${p.phaseCount} phases)`;
        if (data.activePlanPath && p.folderPath === data.activePlanPath) {
          opt.selected = true;
        }
        planFolderSelect.appendChild(opt);
      });
    }

    // Update Phase Checklist
    renderPhaseList(currentPhases, selectedIndices, data.currentPhaseIndex);

    // Update Progress
    if (data.progressPercentage !== undefined) {
      renderProgress({
        percentage: data.progressPercentage,
        elapsedTime: data.elapsedTime || '00:00',
        currentPhaseIndex: data.currentPhaseIndex,
        totalPhases: currentPhases.length
      });
    }
  }

  function renderPhaseList(phases, selectedSet, currentIdx) {
    if (!phases || phases.length === 0) {
      phaseList.innerHTML = '<div class="empty-state">No plan loaded. Select a plan folder above.</div>';
      selectedCountBadge.textContent = '0 selected';
      toggleAllPhases.checked = false;
      return;
    }

    phaseList.innerHTML = '';
    let selectedCount = 0;

    phases.forEach((phase, index) => {
      const isSelected = selectedSet.has(index);
      if (isSelected) selectedCount++;

      const isCurrent = index === currentIdx && currentState === 'running';

      const item = document.createElement('div');
      item.className = `phase-item ${isCurrent ? 'running' : ''} ${phase.isCompleted ? 'completed' : ''}`;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = isSelected;
      checkbox.addEventListener('change', () => {
        vscode.postMessage({ command: 'togglePhase', index, selected: checkbox.checked });
      });

      const nameSpan = document.createElement('span');
      nameSpan.className = 'phase-name';
      nameSpan.textContent = phase.fileName;
      nameSpan.title = phase.filePath || phase.fileName;

      const tagSpan = document.createElement('span');
      tagSpan.className = 'status-tag ';

      if (isCurrent) {
        tagSpan.className += 'tag-running';
        tagSpan.textContent = 'RUNNING';
      } else if (phase.isCompleted) {
        tagSpan.className += 'tag-done';
        tagSpan.textContent = 'DONE';
      } else if (phase.status === 'failed') {
        tagSpan.className += 'tag-failed';
        tagSpan.textContent = 'FAILED';
      } else {
        tagSpan.className += 'tag-pending';
        tagSpan.textContent = 'PENDING';
      }

      item.appendChild(checkbox);
      item.appendChild(nameSpan);
      item.appendChild(tagSpan);

      phaseList.appendChild(item);
    });

    selectedCountBadge.textContent = `${selectedCount} / ${phases.length} selected`;
    toggleAllPhases.checked = phases.length > 0 && selectedCount === phases.length;
  }

  function renderBridgeStatus(data) {
    const status = (data.status || data).toString().toLowerCase();
    bridgeStatusBadge.className = 'status-pill ';

    if (status.includes('connected') || status === 'focus-free') {
      bridgeStatusBadge.classList.add('status-connected');
      bridgeStatusText.textContent = '🟢 Focus-Free';
      bridgeStatusBadge.title = 'Background Bridge: Active (Keep-Alive)';
    } else if (status.includes('keyboard') || status.includes('fallback')) {
      bridgeStatusBadge.classList.add('status-keyboard');
      bridgeStatusText.textContent = '🟡 Keyboard Fallback';
      bridgeStatusBadge.title = 'Keyboard Fallback Mode';
    } else {
      bridgeStatusBadge.classList.add('status-inactive');
      bridgeStatusText.textContent = '🔴 Disconnected';
      bridgeStatusBadge.title = 'DOM Automation Bridge Disconnected';
    }
  }

  function renderProgress(data) {
    const pct = Math.min(100, Math.max(0, data.percentage || 0));
    progressBarFill.style.width = `${pct}%`;

    if (data.elapsedTime) {
      elapsedTime.textContent = data.elapsedTime;
    }

    if (data.currentPhaseIndex !== undefined && data.totalPhases) {
      const idxStr = Math.min(data.currentPhaseIndex + 1, data.totalPhases);
      progressCounter.textContent = `Phase ${idxStr} of ${data.totalPhases} (${Math.round(pct)}%)`;
    } else {
      progressCounter.textContent = `${Math.round(pct)}% Completed`;
    }
  }

  function renderTranscriptLog(data) {
    const text = typeof data === 'string' ? data : (data.log || '');
    if (!text) return;
    appendAndPruneLogLines([text]);
  }

  function renderTranscriptLogBatch(data) {
    const logs = Array.isArray(data) ? data : (data.logs || []);
    if (!logs || logs.length === 0) return;
    appendAndPruneLogLines(logs);
  }

  function appendAndPruneLogLines(newLogLines) {
    if (!newLogLines || newLogLines.length === 0) return;

    let currentText = transcriptLog ? (transcriptLog.textContent || '') : '';
    if (currentText === 'Waiting for activity...' || currentText === 'Feed cleared.') {
      currentText = '';
    }

    let existingLines = currentText ? currentText.split('\n') : [];

    for (const item of newLogLines) {
      if (typeof item === 'string') {
        const splitItems = item.split('\n');
        existingLines.push(...splitItems);
      }
    }

    if (existingLines.length > 200) {
      existingLines = existingLines.slice(-200);
    }

    if (transcriptLog) {
      transcriptLog.textContent = existingLines.join('\n');
    }
    if (transcriptViewport) {
      transcriptViewport.scrollTop = transcriptViewport.scrollHeight;
    }
  }
})();
