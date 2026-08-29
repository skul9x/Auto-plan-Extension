import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig, setPromptText, writeConfigJson } from './config';
import { orchestrator, OrchestratorProgressInfo } from './orchestrator';
import { scanPlanFolder, scanPlanFolderAsync, sortPhaseFiles, getPhasesFrom, normalizePath, PhaseFile } from './planScanner';
import { getDefaultBrainDir, getTranscriptPath, findLatestConversation, transcriptWatcher } from './transcriptWatcher';
import { bridgeServer, BRIDGE_PROTOCOL_VERSION } from './bridgeServer';
import { isBridgeInstalled, installBridgeScript, uninstallBridgeScript, getWorkbenchPath } from './workbenchInjector';
import { SidebarProvider } from './sidebarProvider';

let mainStatusBarItem: vscode.StatusBarItem;
let bridgeStatusBarItem: vscode.StatusBarItem;
export let sidebarProvider: SidebarProvider | undefined;
let currentPlanFolder: string | undefined;
let runStartTime: number = 0;
let elapsedTimer: NodeJS.Timeout | null = null;
let lastProgressInfo: OrchestratorProgressInfo | undefined = undefined;
let completionResetTimeout: NodeJS.Timeout | null = null;

export function getMainStatusBarItem(): vscode.StatusBarItem {
  return mainStatusBarItem;
}

export function getBridgeStatusBarItem(): vscode.StatusBarItem {
  return bridgeStatusBarItem;
}

export function getCurrentPlanFolder(): string | undefined {
  return currentPlanFolder;
}

export function setCurrentPlanFolder(folder: string | undefined): void {
  currentPlanFolder = folder;
}

export function getRunStartTime(): number {
  return runStartTime;
}

export function setRunStartTime(time: number): void {
  runStartTime = time;
}

export interface PlanFolderItem extends vscode.QuickPickItem {
  type: 'active' | 'workspace' | 'recent' | 'browse' | 'manual';
  folderPath?: string;
}

export interface PlanActionQuickPickItem extends vscode.QuickPickItem {
  action: 'runAll' | 'resumeUnfinished' | 'runFrom' | 'customSelect';
}

export interface PhaseQuickPickItem extends vscode.QuickPickItem {
  phase: PhaseFile;
}

/**
 * Formats millisecond duration as mm:ss.
 */
export function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Builds rich Markdown tooltip for the status bar during execution.
 */
export function buildRunningTooltip(
  folderName: string,
  currentPhaseIndex: number,
  totalPhases: number,
  phaseFileName: string,
  stateMessage: string,
  elapsedMs: number
): vscode.MarkdownString {
  const phaseX = currentPhaseIndex + 1;
  const totalY = Math.max(1, totalPhases);
  const percentage = Math.round((currentPhaseIndex / totalY) * 100);
  const elapsedStr = formatElapsedTime(elapsedMs);

  const md = new vscode.MarkdownString(
    `### 🚀 Auto-Plan Runner\n` +
    `- **Folder:** \`${folderName}\`\n` +
    `- **Progress:** Phase ${phaseX} of ${totalY} (${percentage}%)\n` +
    `- **Current Phase:** \`${phaseFileName}\`\n` +
    `- **Status:** ${stateMessage}\n` +
    `- **Elapsed Time:** ${elapsedStr}`
  );
  md.isTrusted = true;
  return md;
}

// Tooltip render cache
let lastTooltipKey: string = '';
let lastRenderedTooltip: vscode.MarkdownString | null = null;

export function clearTooltipCache(): void {
  lastTooltipKey = '';
  lastRenderedTooltip = null;
}

export function getCachedRunningTooltip(
  folderName: string,
  currentPhaseIndex: number,
  totalPhases: number,
  phaseFileName: string,
  stateMessage: string,
  elapsedMs: number
): vscode.MarkdownString {
  const elapsedMin = Math.max(0, Math.floor(elapsedMs / 60000));
  const key = `${folderName}|${currentPhaseIndex}|${totalPhases}|${phaseFileName}|${stateMessage}|${elapsedMin}`;
  if (key === lastTooltipKey && lastRenderedTooltip) {
    return lastRenderedTooltip;
  }
  lastTooltipKey = key;
  lastRenderedTooltip = buildRunningTooltip(
    folderName,
    currentPhaseIndex,
    totalPhases,
    phaseFileName,
    stateMessage,
    elapsedMs
  );
  return lastRenderedTooltip;
}

/**
 * Detects if active editor is currently viewing a markdown phase file within a plan directory.
 */
export function findActivePlanFolder(): string | null {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) return null;
  const activePath = activeEditor.document?.uri?.fsPath;
  if (!activePath || !activePath.toLowerCase().endsWith('.md')) return null;

  const parentDir = path.dirname(activePath);
  try {
    const phases = scanPlanFolder(parentDir);
    if (phases && phases.length > 0) {
      return parentDir;
    }
  } catch {
    // Parent folder is not a valid plan folder
  }
  return null;
}

export interface CachedPlanDiscovery {
  timestamp: number;
  results: { folderPath: string; relName: string; phaseCount: number }[];
}

export const PLAN_DISCOVERY_CACHE_TTL_MS = 5000;
let planDiscoveryCache: CachedPlanDiscovery | null = null;

export function clearPlanDiscoveryCache(): void {
  planDiscoveryCache = null;
}

export function getPlanDiscoveryCache(): CachedPlanDiscovery | null {
  return planDiscoveryCache;
}

/**
 * Scans active workspace folders to discover any candidate plan folders under `plans/`.
 * Results are cached in-memory with a short TTL (5s) to avoid redundant disk I/O.
 */
export function discoverWorkspacePlanFolders(forceRefresh: boolean = false): { folderPath: string; relName: string; phaseCount: number }[] {
  const now = Date.now();
  if (!forceRefresh && planDiscoveryCache && now - planDiscoveryCache.timestamp < PLAN_DISCOVERY_CACHE_TTL_MS) {
    return planDiscoveryCache.results;
  }

  const results: { folderPath: string; relName: string; phaseCount: number }[] = [];
  const workspaceFolders = vscode.workspace.workspaceFolders || [];

  for (const wf of workspaceFolders) {
    const rootPath = wf.uri.fsPath;
    const plansDir = path.join(rootPath, 'plans');

    if (fs.existsSync(plansDir)) {
      try {
        const stat = fs.statSync(plansDir);
        if (stat.isDirectory()) {
          // Check plans directory itself
          try {
            const rootPhases = scanPlanFolder(plansDir);
            if (rootPhases && rootPhases.length > 0) {
              results.push({ folderPath: plansDir, relName: 'plans', phaseCount: rootPhases.length });
            }
          } catch {}

          // Check direct subdirectories of plans/
          const entries = fs.readdirSync(plansDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              const subDir = path.join(plansDir, entry.name);
              try {
                const subPhases = scanPlanFolder(subDir);
                if (subPhases && subPhases.length > 0) {
                  results.push({
                    folderPath: subDir,
                    relName: `plans/${entry.name}`,
                    phaseCount: subPhases.length
                  });
                }
              } catch {}
            }
          }
        }
      } catch {}
    }
  }

  planDiscoveryCache = {
    timestamp: now,
    results
  };

  return results;
}

/**
 * Asynchronously scans active workspace folders to discover any candidate plan folders under `plans/`.
 * Results are cached in-memory with a short TTL (5s) to avoid redundant disk I/O and event loop freezes.
 */
export async function discoverWorkspacePlanFoldersAsync(forceRefresh: boolean = false): Promise<{ folderPath: string; relName: string; phaseCount: number }[]> {
  const now = Date.now();
  if (!forceRefresh && planDiscoveryCache && now - planDiscoveryCache.timestamp < PLAN_DISCOVERY_CACHE_TTL_MS) {
    return planDiscoveryCache.results;
  }

  const results: { folderPath: string; relName: string; phaseCount: number }[] = [];
  const workspaceFolders = vscode.workspace.workspaceFolders || [];

  for (const wf of workspaceFolders) {
    const rootPath = wf.uri.fsPath;
    const plansDir = path.join(rootPath, 'plans');

    try {
      const stat = await fs.promises.stat(plansDir);
      if (stat.isDirectory()) {
        // Check plans directory itself
        try {
          const rootPhases = await scanPlanFolderAsync(plansDir);
          if (rootPhases && rootPhases.length > 0) {
            results.push({ folderPath: plansDir, relName: 'plans', phaseCount: rootPhases.length });
          }
        } catch {}

        // Check direct subdirectories of plans/
        const entries = await fs.promises.readdir(plansDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const subDir = path.join(plansDir, entry.name);
            try {
              const subPhases = await scanPlanFolderAsync(subDir);
              if (subPhases && subPhases.length > 0) {
                results.push({
                  folderPath: subDir,
                  relName: `plans/${entry.name}`,
                  phaseCount: subPhases.length
                });
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  planDiscoveryCache = {
    timestamp: now,
    results
  };

  return results;
}

/**
 * Returns recent plan folders from global and workspace state.
 */
export function getRecentPlanFolders(context: vscode.ExtensionContext): string[] {
  const globalRecents = context.globalState.get<string[]>('recentPlanFolders', []);
  const lastWorkspace = context.workspaceState.get<string>('lastPlanFolder');

  const combined = lastWorkspace ? [lastWorkspace, ...globalRecents] : globalRecents;
  const unique = Array.from(new Set(combined.map(p => path.normalize(p))));

  return unique.filter(p => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Builds the 2-Tier QuickPick item list for plan selection.
 */
export function buildFolderQuickPickItems(context: vscode.ExtensionContext): PlanFolderItem[] {
  const items: PlanFolderItem[] = [];
  const seenPaths = new Set<string>();

  // 1. Active Editor Detection
  const activePlanDir = findActivePlanFolder();
  if (activePlanDir) {
    const norm = path.normalize(activePlanDir);
    seenPaths.add(norm);
    try {
      const phases = scanPlanFolder(activePlanDir);
      items.push({
        label: `$(star) Active Plan: ${path.basename(activePlanDir)} (${phases.length} phases)`,
        description: activePlanDir,
        detail: 'Currently open in editor',
        type: 'active',
        folderPath: activePlanDir
      });
    } catch {}
  }

  // 2. Workspace Discovery
  const wsFolders = discoverWorkspacePlanFolders();
  for (const wf of wsFolders) {
    const norm = path.normalize(wf.folderPath);
    if (!seenPaths.has(norm)) {
      seenPaths.add(norm);
      items.push({
        label: `$(folder) ${wf.relName} (${wf.phaseCount} phases)`,
        description: wf.folderPath,
        type: 'workspace',
        folderPath: wf.folderPath
      });
    }
  }

  // 3. Recent History
  const recents = getRecentPlanFolders(context);
  for (const rPath of recents) {
    const norm = path.normalize(rPath);
    if (!seenPaths.has(norm)) {
      seenPaths.add(norm);
      try {
        const phases = scanPlanFolder(rPath);
        items.push({
          label: `$(history) ${path.basename(rPath)} (${phases.length} phases)`,
          description: rPath,
          type: 'recent',
          folderPath: rPath
        });
      } catch {
        items.push({
          label: `$(history) ${path.basename(rPath)}`,
          description: rPath,
          type: 'recent',
          folderPath: rPath
        });
      }
    }
  }

  // 4. Native File Browser
  items.push({
    label: '$(folder-opened) Browse Folder from Disk...',
    detail: 'Select a plan folder using native file dialog',
    type: 'browse'
  });

  // 5. Manual Entry Fallback
  items.push({
    label: '$(edit) Enter Path Manually...',
    detail: 'Type or paste a custom folder path',
    type: 'manual'
  });

  return items;
}

export function setMainStatusBarItem(item: vscode.StatusBarItem): void {
  mainStatusBarItem = item;
}

export function updateTooltipFromInfo(info: OrchestratorProgressInfo): void {
  const currentIdx =
    info.currentPhaseIndex !== undefined
      ? info.currentPhaseIndex
      : info.currentIteration
      ? info.currentIteration - 1
      : 0;
  const total = info.totalPhases || info.totalIterations || 1;
  const displayPhase = info.currentPhase?.fileName || '';
  const folderName = currentPlanFolder ? path.basename(currentPlanFolder) : 'Active Plan';
  const elapsedMs = runStartTime > 0 ? Date.now() - runStartTime : 0;
  const statusMsg = info.message || 'Waiting for Agent completion...';

  if (mainStatusBarItem) {
    mainStatusBarItem.tooltip = getCachedRunningTooltip(
      folderName,
      currentIdx,
      total,
      displayPhase || 'Initializing...',
      statusMsg,
      elapsedMs
    );
  }
}

function startElapsedTimer(info: OrchestratorProgressInfo) {
  lastProgressInfo = info;
  if (!elapsedTimer) {
    elapsedTimer = setInterval(() => {
      if (orchestrator.isRunning() && lastProgressInfo) {
        updateTooltipFromInfo(lastProgressInfo);
      }
    }, 60000);
  }
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

export function updateStatusBar(info?: OrchestratorProgressInfo): void {
  if (completionResetTimeout) {
    clearTimeout(completionResetTimeout);
    completionResetTimeout = null;
  }

  if (!info || info.state === 'idle' || info.state === 'stopped' || info.state === 'completed' || info.state === 'error') {
    stopElapsedTimer();
    clearTooltipCache();
    if (mainStatusBarItem) {
      mainStatusBarItem.text = '$(rocket) Auto-Plan';
      mainStatusBarItem.tooltip = 'Auto-Plan: Click to select plan folder and run';
      mainStatusBarItem.command = 'autoplan.start';
      mainStatusBarItem.show();
    }
    return;
  }

  // Running state
  const currentIdx =
    info.currentPhaseIndex !== undefined
      ? info.currentPhaseIndex
      : info.currentIteration
      ? info.currentIteration - 1
      : 0;
  const total = info.totalPhases || info.totalIterations || 1;
  const displayPhase = info.currentPhase?.fileName || '';

  if (mainStatusBarItem) {
    mainStatusBarItem.text = displayPhase
      ? `$(sync~spin) Auto-Plan: [${currentIdx + 1}/${total}] ${displayPhase}`
      : `$(sync~spin) Auto-Plan: [${currentIdx + 1}/${total}]`;
    mainStatusBarItem.command = 'autoplan.actionMenu';
  }

  updateTooltipFromInfo(info);
  if (mainStatusBarItem) {
    mainStatusBarItem.show();
  }

  startElapsedTimer(info);
}

/**
 * Prompts user to select a folder via QuickPick and begins execution upon confirmation.
 */
export async function promptAndStartAutoPlan(context: vscode.ExtensionContext): Promise<void> {
  if (orchestrator.isRunning()) {
    vscode.window.showWarningMessage('Auto-Plan is already running.');
    return;
  }

  const items = buildFolderQuickPickItems(context);
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a Plan Folder to execute',
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!selected) {
    return;
  }

  let folderPath: string | undefined;

  if (selected.type === 'browse') {
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Select Plan Folder'
    });
    if (!uris || uris.length === 0) return;
    folderPath = uris[0].fsPath;
  } else if (selected.type === 'manual') {
    const lastUsed = context.workspaceState.get<string>('lastPlanFolder') || getConfig().defaultPlanFolder || '';
    const input = await vscode.window.showInputBox({
      prompt: 'Enter absolute path to plan folder',
      value: lastUsed,
      ignoreFocusOut: true
    });
    if (!input || input.trim() === '') return;
    folderPath = input.trim();
  } else {
    folderPath = selected.folderPath;
  }

  if (!folderPath) {
    return;
  }

  // Pre-flight scan
  let phases: PhaseFile[];
  try {
    phases = scanPlanFolder(folderPath);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Auto-Plan: ${err.message || 'No executable phase files found.'}`);
    return;
  }

  if (!phases || phases.length === 0) {
    vscode.window.showErrorMessage(`Auto-Plan: No executable phase markdown files found in "${folderPath}"`);
    return;
  }

  showPlanActionMenu(context, folderPath, phases);
}

/**
 * Dispatches a list of phases to the orchestrator for execution and updates recents.
 */
export async function executePhases(
  context: vscode.ExtensionContext,
  folderPath: string,
  phases: PhaseFile[]
): Promise<void> {
  // Persist selected folder path
  await context.workspaceState.update('lastPlanFolder', folderPath);
  const existingRecents = context.globalState.get<string[]>('recentPlanFolders', []);
  const updatedRecents = [
    folderPath,
    ...existingRecents.filter(p => path.normalize(p) !== path.normalize(folderPath))
  ].slice(0, 10);
  await context.globalState.update('recentPlanFolders', updatedRecents);

  currentPlanFolder = folderPath;
  runStartTime = Date.now();

  const folderName = path.basename(folderPath);
  vscode.window.showInformationMessage(`Auto-Plan: Starting execution of ${phases.length} phases in "${folderName}"...`);
  await orchestrator.startPhases(phases);
}

/**
 * Step 1 Action Menu: Displays high-level execution modes for the selected plan folder.
 */
export function showPlanActionMenu(
  context: vscode.ExtensionContext,
  folderPath: string,
  phases: PhaseFile[]
): vscode.QuickPick<PlanActionQuickPickItem> {
  const folderName = path.basename(folderPath);
  const totalCount = phases.length;
  const pendingCount = phases.filter(p => !p.isCompleted).length;

  const quickPick = vscode.window.createQuickPick<PlanActionQuickPickItem>();
  quickPick.title = `Auto-Plan: ${folderName}`;
  quickPick.placeholder = 'Select execution action';
  quickPick.step = 1;
  quickPick.totalSteps = 2;

  const items: PlanActionQuickPickItem[] = [
    {
      label: `▶️ Run All (${totalCount} phases)`,
      description: 'Execute all phases sequentially',
      action: 'runAll'
    },
    {
      label: `⏩ Resume Unfinished (${pendingCount} phases)`,
      description: 'Execute pending phases only',
      detail: pendingCount === 0 ? `(All ${totalCount} phases completed)` : undefined,
      action: 'resumeUnfinished'
    },
    {
      label: `🎯 Run from Phase... to End`,
      description: 'Choose starting phase and execute through end',
      action: 'runFrom'
    },
    {
      label: `☑️ Custom Select Phases...`,
      description: 'Select specific phases to run',
      action: 'customSelect'
    }
  ];

  quickPick.items = items;

  const disposables: vscode.Disposable[] = [];

  disposables.push(
    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      if (!selected) return;

      quickPick.hide();

      if (selected.action === 'runAll') {
        await executePhases(context, folderPath, phases);
      } else if (selected.action === 'resumeUnfinished') {
        if (pendingCount === 0) {
          vscode.window.showInformationMessage('Auto-Plan: All phases in this plan are already completed.');
          return;
        }
        const pendingPhases = phases.filter(p => !p.isCompleted);
        await executePhases(context, folderPath, pendingPhases);
      } else if (selected.action === 'runFrom') {
        showRunFromPhaseMenu(context, folderPath, phases);
      } else if (selected.action === 'customSelect') {
        showCustomSelectPhasesMenu(context, folderPath, phases);
      }
    })
  );

  disposables.push(
    quickPick.onDidHide(() => {
      disposables.forEach(d => d.dispose());
      quickPick.dispose();
    })
  );

  quickPick.show();
  return quickPick;
}

/**
 * Single-selection QuickPick menu allowing user to pick a starting phase to run through to the end.
 */
export function showRunFromPhaseMenu(
  context: vscode.ExtensionContext,
  folderPath: string,
  phases: PhaseFile[]
): vscode.QuickPick<PhaseQuickPickItem> {
  const quickPick = vscode.window.createQuickPick<PhaseQuickPickItem>();
  quickPick.title = 'Auto-Plan: Run from Phase... to End';
  quickPick.placeholder = 'Select starting phase to run through to end';
  quickPick.step = 2;
  quickPick.totalSteps = 2;
  quickPick.canSelectMany = false;
  quickPick.buttons = [vscode.QuickInputButtons.Back];

  quickPick.items = phases.map(phase => ({
    label: phase.isCompleted ? `$(check) ${phase.fileName}` : `$(circle-outline) ${phase.fileName}`,
    detail: phase.isCompleted ? '[Completed]' : '[Pending]',
    phase
  }));

  const disposables: vscode.Disposable[] = [];

  disposables.push(
    quickPick.onDidTriggerButton(async (button) => {
      if (button === vscode.QuickInputButtons.Back) {
        quickPick.hide();
        showPlanActionMenu(context, folderPath, phases);
      }
    })
  );

  disposables.push(
    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      if (!selected) return;

      quickPick.hide();
      const sliced = getPhasesFrom(phases, selected.phase.fileName);
      await executePhases(context, folderPath, sliced);
    })
  );

  disposables.push(
    quickPick.onDidHide(() => {
      disposables.forEach(d => d.dispose());
      quickPick.dispose();
    })
  );

  quickPick.show();
  return quickPick;
}

/**
 * Step 2 Multi-Select QuickPick: Interactive phase picker with Select All/Deselect All/Back buttons.
 */
export function showCustomSelectPhasesMenu(
  context: vscode.ExtensionContext,
  folderPath: string,
  phases: PhaseFile[]
): vscode.QuickPick<PhaseQuickPickItem> {
  const quickPick = vscode.window.createQuickPick<PhaseQuickPickItem>();
  quickPick.title = 'Auto-Plan: Select Phases';
  quickPick.placeholder = 'Select one or more phases to execute';
  quickPick.step = 2;
  quickPick.totalSteps = 2;
  quickPick.canSelectMany = true;

  const selectAllButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('check-all'),
    tooltip: 'Select All'
  };

  const deselectAllButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('clear-all'),
    tooltip: 'Deselect All'
  };

  const runBelowButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('run-below'),
    tooltip: 'Run from this phase to end'
  };

  quickPick.buttons = [
    vscode.QuickInputButtons.Back,
    selectAllButton,
    deselectAllButton
  ];

  quickPick.items = phases.map(phase => ({
    label: phase.isCompleted ? `$(check) ${phase.fileName}` : `$(circle-outline) ${phase.fileName}`,
    detail: phase.isCompleted ? '[Completed]' : '[Pending]',
    buttons: [runBelowButton],
    phase
  }));

  // Smart Pre-selection: vscode.window.createQuickPick ignores picked: true,
  // so set selectedItems programmatically after assigning items.
  quickPick.selectedItems = quickPick.items.filter(item => !item.phase.isCompleted);

  const disposables: vscode.Disposable[] = [];

  disposables.push(
    quickPick.onDidTriggerButton((button) => {
      if (button === vscode.QuickInputButtons.Back) {
        quickPick.hide();
        showPlanActionMenu(context, folderPath, phases);
      } else if (
        button.tooltip === 'Select All' ||
        (button.iconPath && (button.iconPath as any).id === 'check-all')
      ) {
        quickPick.selectedItems = [...quickPick.items];
      } else if (
        button.tooltip === 'Deselect All' ||
        (button.iconPath && (button.iconPath as any).id === 'clear-all')
      ) {
        quickPick.selectedItems = [];
      }
    })
  );

  disposables.push(
    quickPick.onDidTriggerItemButton(async (e) => {
      if (
        e.button.tooltip === 'Run from this phase to end' ||
        (e.button.iconPath && (e.button.iconPath as any).id === 'run-below')
      ) {
        quickPick.hide();
        const sliced = getPhasesFrom(phases, e.item.phase.fileName);
        await executePhases(context, folderPath, sliced);
      }
    })
  );

  disposables.push(
    quickPick.onDidAccept(async () => {
      if (quickPick.selectedItems.length === 0) {
        vscode.window.showWarningMessage('Auto-Plan: Please select at least one phase to execute.');
        return;
      }

      const selectedPhases = quickPick.selectedItems.map(item => item.phase);
      const sortedPhases = sortPhaseFiles(selectedPhases);
      quickPick.hide();
      await executePhases(context, folderPath, sortedPhases);
    })
  );

  disposables.push(
    quickPick.onDidHide(() => {
      disposables.forEach(d => d.dispose());
      quickPick.dispose();
    })
  );

  quickPick.show();
  return quickPick;
}

/**
 * Opens active transcript log in the editor.
 */
export async function openActiveTranscript(): Promise<void> {
  const brainDir = getDefaultBrainDir();
  const lastConvId = orchestrator.getLastConversationId() || orchestrator.getCurrentPhase()?.conversationId;

  let targetTranscript: string | null = null;

  if (lastConvId) {
    const convDir = path.join(brainDir, lastConvId);
    targetTranscript = getTranscriptPath(convDir);
  }

  if (!targetTranscript || !fs.existsSync(targetTranscript)) {
    const latestConv = findLatestConversation(brainDir);
    if (latestConv) {
      targetTranscript = getTranscriptPath(path.join(brainDir, latestConv));
    }
  }

  if (targetTranscript && fs.existsSync(targetTranscript)) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(targetTranscript));
    await vscode.window.showTextDocument(doc);
  } else {
    vscode.window.showWarningMessage('Auto-Plan: No active transcript log found to open.');
  }
}

/**
 * Running Action QuickPick menu triggered from Status Bar.
 */
export async function showRunningActionMenu(): Promise<void> {
  if (!orchestrator.isRunning()) {
    vscode.window.showInformationMessage('Auto-Plan is not currently running.');
    return;
  }

  const items = [
    {
      label: '$(stop) Stop Auto-Plan',
      description: 'Abort execution immediately',
      action: 'stop'
    },
    {
      label: '$(debug-step-over) Skip Current Phase',
      description: 'Advance to next phase immediately',
      action: 'skip'
    },
    {
      label: '$(output) Open Active Transcript Log',
      description: 'Open the active transcript.jsonl in editor',
      action: 'openTranscript'
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Auto-Plan Running Actions'
  });

  if (!selected) return;

  if (selected.action === 'stop') {
    orchestrator.stop();
  } else if (selected.action === 'skip') {
    orchestrator.skipCurrentPhase();
  } else if (selected.action === 'openTranscript') {
    await openActiveTranscript();
  }
}

export interface BridgeDiagnosticReport {
  isInstalled: boolean;
  workbenchPath: string | null;
  serverListening: boolean;
  serverPort: number | null;
  activeWindowKey: string | null;
  connectedClientsCount: number;
  connectedClients: any[];
  executionMode: string;
  autoInjectWorkbench: boolean;
  autoApprovePermissions: boolean;
  bridgeTimeoutMs: number;
  protocolVersion: string;
}

/**
 * Updates the Bridge status bar item with current connectivity and installation state.
 */
export function updateBridgeStatusBar(): void {
  if (!bridgeStatusBarItem) return;

  const installed = isBridgeInstalled();
  const listening = bridgeServer.isListening();
  const port = bridgeServer.getPort();
  const clients = bridgeServer.getConnectedClients();

  if (installed && listening) {
    if (clients.length > 0) {
      bridgeStatusBarItem.text = '$(plug) Bridge: Connected';
      bridgeStatusBarItem.tooltip = `Auto-Plan DOM Bridge: Active & Connected (Port: ${port}, Clients: ${clients.length})\nClick to check diagnostic status`;
    } else {
      bridgeStatusBarItem.text = '$(plug) Bridge: Active';
      bridgeStatusBarItem.tooltip = `Auto-Plan DOM Bridge: Listening on port ${port} (Waiting for DOM client)\nClick to check diagnostic status`;
    }
    bridgeStatusBarItem.command = 'autoplan.checkBridgeStatus';
  } else if (!installed) {
    bridgeStatusBarItem.text = '$(alert) Bridge: Disconnected';
    bridgeStatusBarItem.tooltip = 'Auto-Plan DOM Bridge: Not Installed in workbench.html\nClick to Install DOM Bridge';
    bridgeStatusBarItem.command = 'autoplan.installBridge';
  } else {
    bridgeStatusBarItem.text = '$(alert) Bridge: Inactive';
    bridgeStatusBarItem.tooltip = 'Auto-Plan DOM Bridge: Server not running\nClick to check diagnostic status';
    bridgeStatusBarItem.command = 'autoplan.checkBridgeStatus';
  }

  bridgeStatusBarItem.show();
}

/**
 * Installs the DOM Automation Bridge into workbench.html.
 */
export async function installBridge(): Promise<boolean> {
  const result = installBridgeScript();
  if (result.success) {
    updateBridgeStatusBar();
    const selection = await vscode.window.showInformationMessage(
      'DOM Bridge injected successfully. Reload IDE to apply.',
      '🔄 Reload Window',
      'Later'
    );
    if (selection === '🔄 Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
    return true;
  } else {
    vscode.window.showErrorMessage(`Auto-Plan: Failed to install DOM Bridge: ${result.error}`);
    return false;
  }
}

/**
 * Shows actionable warning notification when DOM Bridge is missing.
 */
export async function showBridgeMissingNotification(): Promise<string | undefined> {
  const selection = await vscode.window.showWarningMessage(
    'Auto-Plan DOM Bridge is not active (Focus-Free mode unavailable).',
    '⚡ 1-Click Setup',
    '🛠️ Open Diagnostics',
    'Dismiss'
  );
  if (selection === '⚡ 1-Click Setup') {
    await vscode.commands.executeCommand('autoplan.oneClickSetup');
  } else if (selection === '🛠️ Open Diagnostics') {
    await vscode.commands.executeCommand('autoplan.checkStatus');
  }
  return selection;
}

/**
 * Shows actionable error notification when Linux Pre-Flight fails.
 */
export async function showLinuxPreflightErrorNotification(): Promise<string | undefined> {
  const selection = await vscode.window.showErrorMessage(
    'Linux Pre-Flight Failed: Missing DOM Bridge and xdotool.',
    '⚡ Activate Bridge (Recommended)',
    '📦 Install xdotool Guide'
  );
  if (selection === '⚡ Activate Bridge (Recommended)') {
    await vscode.commands.executeCommand('autoplan.oneClickSetup');
  } else if (selection === '📦 Install xdotool Guide') {
    await vscode.window.showInformationMessage(
      'To enable background automation on Linux without DOM Bridge, install xdotool via: sudo apt-get install xdotool'
    );
  }
  return selection;
}

/**
 * Uninstalls the DOM Automation Bridge from workbench.html.
 */
export async function uninstallBridge(): Promise<boolean> {
  const result = uninstallBridgeScript();
  if (result.success) {
    updateBridgeStatusBar();
    const selection = await vscode.window.showInformationMessage(
      'Auto-Plan: DOM Automation Bridge uninstalled successfully. Please reload the window for changes to take effect.',
      'Reload Window',
      'Later'
    );
    if (selection === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
    return true;
  } else {
    vscode.window.showErrorMessage(`Auto-Plan: Failed to uninstall DOM Bridge: ${result.error}`);
    return false;
  }
}

/**
 * Runs bridge diagnostics and returns status report.
 */
export function runBridgeDiagnostic(): BridgeDiagnosticReport {
  const installed = isBridgeInstalled();
  const wbPath = getWorkbenchPath();
  const status = bridgeServer.getStatus();
  const config = getConfig();

  return {
    isInstalled: installed,
    workbenchPath: wbPath,
    serverListening: bridgeServer.isListening(),
    serverPort: bridgeServer.getPort(),
    activeWindowKey: bridgeServer.getActiveWindowKey(),
    connectedClientsCount: status.connectedClients,
    connectedClients: bridgeServer.getConnectedClients(),
    executionMode: config.executionMode || 'auto',
    autoInjectWorkbench: config.autoInjectWorkbench ?? true,
    autoApprovePermissions: config.autoApprovePermissions ?? true,
    bridgeTimeoutMs: config.bridgeTimeoutMs ?? 5000,
    protocolVersion: status.protocolVersion || BRIDGE_PROTOCOL_VERSION
  };
}

/**
 * Shows interactive diagnostic modal/dialog to the user.
 */
export async function showBridgeDiagnosticDialog(): Promise<BridgeDiagnosticReport> {
  const report = runBridgeDiagnostic();
  const statusLines = [
    `• DOM Bridge Script: ${report.isInstalled ? '✅ Installed' : '❌ Not Installed'}`,
    `• Workbench File: ${report.workbenchPath || 'Not Detected'}`,
    `• Bridge Server: ${report.serverListening ? `✅ Running (Port: ${report.serverPort})` : '❌ Stopped'}`,
    `• Active Window Key: ${report.activeWindowKey || 'None'}`,
    `• Connected DOM Clients: ${report.connectedClientsCount}`,
    `• Transport Mode: ${report.executionMode}`,
    `• Auto-Inject On Startup: ${report.autoInjectWorkbench ? 'Enabled' : 'Disabled'}`
  ];

  const actions = report.isInstalled
    ? ['Reinstall Bridge', 'Uninstall Bridge', 'OK']
    : ['Install Bridge', 'OK'];

  const choice = await vscode.window.showInformationMessage(
    `Auto-Plan DOM Bridge Diagnostics:\n${statusLines.join('\n')}`,
    ...actions
  );

  if (choice === 'Install Bridge' || choice === 'Reinstall Bridge') {
    await installBridge();
  } else if (choice === 'Uninstall Bridge') {
    await uninstallBridge();
  }

  return report;
}

export function activate(context: vscode.ExtensionContext) {
  // Create Bottom-Right Interactive Status Bar Item (Priority 100)
  try {
    mainStatusBarItem = (vscode.window.createStatusBarItem as any)(
      'autoplan.statusBar',
      vscode.StatusBarAlignment.Right,
      100
    );
  } catch {
    mainStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  }

  // Create Bridge Status Bar Item (Priority 99, adjacent to runner item)
  try {
    bridgeStatusBarItem = (vscode.window.createStatusBarItem as any)(
      'autoplan.bridgeStatusBar',
      vscode.StatusBarAlignment.Right,
      99
    );
  } catch {
    bridgeStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  }

  // Instantiate and register Sidebar WebviewViewProvider
  sidebarProvider = new SidebarProvider(context.extensionUri, context);
  const sidebarRegistration = vscode.window.registerWebviewViewProvider(
    SidebarProvider.viewType,
    sidebarProvider
  );

  // Setup Orchestrator event listeners
  orchestrator.on('stateChange', (info: OrchestratorProgressInfo) => {
    updateStatusBar(info);
    sidebarProvider?.refreshAndSendState();
  });

  orchestrator.on('phaseStart', (phase: any, index: number, total: number) => {
    const elapsedMs = runStartTime > 0 ? Date.now() - runStartTime : 0;
    sidebarProvider?.sendProgress({
      percentage: total > 0 ? Math.round((index / total) * 100) : 0,
      elapsedTime: formatElapsedTime(elapsedMs),
      currentPhaseIndex: index,
      totalPhases: total
    });
    sidebarProvider?.refreshAndSendState();
  });

  orchestrator.on('phaseComplete', (phase: any, result: any, index?: number, total?: number) => {
    const elapsedMs = runStartTime > 0 ? Date.now() - runStartTime : 0;
    const totalCount = total || orchestrator.getPhases().length || 1;
    const currentIdx = (index !== undefined ? index : phase.index) + 1;
    sidebarProvider?.sendProgress({
      percentage: Math.round((currentIdx / totalCount) * 100),
      elapsedTime: formatElapsedTime(elapsedMs),
      currentPhaseIndex: currentIdx,
      totalPhases: totalCount
    });
    sidebarProvider?.refreshAndSendState();
  });

  orchestrator.on('allComplete', (total: number) => {
    stopElapsedTimer();
    mainStatusBarItem.text = '$(check) Auto-Plan (Done)';
    mainStatusBarItem.tooltip = `Auto-Plan: Successfully completed all ${total} phases!`;
    mainStatusBarItem.command = 'autoplan.start';
    mainStatusBarItem.show();

    sidebarProvider?.refreshAndSendState();
    vscode.window.showInformationMessage(`🎉 Auto-Plan: Successfully completed all ${total} phases!`);

    completionResetTimeout = setTimeout(() => {
      if (!orchestrator.isRunning()) {
        updateStatusBar();
        sidebarProvider?.refreshAndSendState();
      }
    }, 4000);
  });

  orchestrator.on('error', (err: Error) => {
    stopElapsedTimer();
    updateStatusBar();
    sidebarProvider?.refreshAndSendState();

    const preflight = orchestrator.getLastPreflightResult();
    if (preflight && !preflight.ready && preflight.details?.os === 'linux' && !preflight.details?.xdotoolAvailable) {
      showLinuxPreflightErrorNotification();
    } else {
      vscode.window.showErrorMessage(`Auto-Plan Error: ${err.message}`);
    }
  });

  orchestrator.on('stopped', () => {
    stopElapsedTimer();
    updateStatusBar();
    sidebarProvider?.refreshAndSendState();
    vscode.window.showInformationMessage('Auto-Plan: Stopped by user.');
  });

  // Setup TranscriptWatcher event listener
  transcriptWatcher.on('logUpdate', (log: string) => {
    sidebarProvider?.appendTranscriptLog(log);
  });

  // Start BridgeServer during extension activation
  bridgeServer.start().catch((err: any) => {
    console.warn('[Auto-Plan] BridgeServer failed to start on activation:', err);
  }).finally(() => {
    updateBridgeStatusBar();
    sidebarProvider?.sendBridgeStatus();
  });

  // Background zero-click auto-detection & silent injection/repair of DOM Bridge script
  if (!isBridgeInstalled()) {
    installBridgeScript({ updateChecksums: true });
    updateBridgeStatusBar();
  }

  // Register commands
  const startCmd = vscode.commands.registerCommand('autoplan.start', () => {
    return promptAndStartAutoPlan(context);
  });

  const stopCmd = vscode.commands.registerCommand('autoplan.stop', () => {
    if (!orchestrator.isRunning()) {
      vscode.window.showInformationMessage('Auto-Plan is not currently running.');
      return;
    }
    orchestrator.stop();
  });

  const skipCmd = vscode.commands.registerCommand('autoplan.skipPhase', () => {
    if (!orchestrator.isRunning()) {
      vscode.window.showInformationMessage('Auto-Plan is not currently running.');
      return;
    }
    orchestrator.skipCurrentPhase();
  });

  const actionMenuCmd = vscode.commands.registerCommand('autoplan.actionMenu', () => {
    return showRunningActionMenu();
  });

  const openTranscriptCmd = vscode.commands.registerCommand('autoplan.openTranscript', () => {
    return openActiveTranscript();
  });

  const setPromptCmd = vscode.commands.registerCommand('autoplan.setPrompt', async () => {
    const currentConfig = getConfig();
    const input = await vscode.window.showInputBox({
      prompt: 'Enter prompt for Antigravity Auto-Plan',
      value: currentConfig.promptText
    });
    if (input !== undefined && input.trim() !== '') {
      await setPromptText(input.trim());
      updateStatusBar();
      vscode.window.showInformationMessage('Auto-Plan: Prompt updated successfully');
    }
  });

  const installBridgeCmd = vscode.commands.registerCommand('autoplan.installBridge', () => {
    return installBridge();
  });

  const uninstallBridgeCmd = vscode.commands.registerCommand('autoplan.uninstallBridge', () => {
    return uninstallBridge();
  });

  const checkBridgeStatusCmd = vscode.commands.registerCommand('autoplan.checkBridgeStatus', () => {
    return showBridgeDiagnosticDialog();
  });

  const openSidebarCmd = vscode.commands.registerCommand('autoplan.openSidebar', async () => {
    return vscode.commands.executeCommand('autoplan.sidebarView.focus');
  });

  const oneClickSetupCmd = vscode.commands.registerCommand('autoplan.oneClickSetup', () => {
    return installBridge();
  });

  const checkStatusCmd = vscode.commands.registerCommand('autoplan.checkStatus', () => {
    return showBridgeDiagnosticDialog();
  });

  // Watch for configuration changes
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('autoplan')) {
      try {
        writeConfigJson();
      } catch {}
      if (!orchestrator.isRunning()) {
        updateStatusBar();
      }
      updateBridgeStatusBar();
      sidebarProvider?.sendBridgeStatus();
    }
  });

  context.subscriptions.push(
    mainStatusBarItem,
    bridgeStatusBarItem,
    sidebarRegistration,
    transcriptWatcher,
    orchestrator,
    startCmd,
    stopCmd,
    skipCmd,
    actionMenuCmd,
    openTranscriptCmd,
    setPromptCmd,
    installBridgeCmd,
    uninstallBridgeCmd,
    checkBridgeStatusCmd,
    openSidebarCmd,
    oneClickSetupCmd,
    checkStatusCmd,
    configWatcher
  );

  // Initialize status bar and sidecar config states
  try {
    writeConfigJson();
  } catch {}
  updateStatusBar();
  updateBridgeStatusBar();
}

export async function deactivate() {
  stopElapsedTimer();
  clearTooltipCache();
  clearPlanDiscoveryCache();
  if (completionResetTimeout) {
    clearTimeout(completionResetTimeout);
    completionResetTimeout = null;
  }
  if (orchestrator.isRunning()) {
    orchestrator.stop();
  }
  orchestrator.dispose();
  transcriptWatcher.dispose();
  try {
    await bridgeServer.stop();
  } catch {}
}

