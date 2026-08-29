import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { scanPlanFolder, scanPlanFolderAsync, PhaseFile, sortPhaseFiles } from './planScanner';
import { discoverWorkspacePlanFolders, discoverWorkspacePlanFoldersAsync, executePhases, promptAndStartAutoPlan, showBridgeDiagnosticDialog, getCurrentPlanFolder, setCurrentPlanFolder } from './extension';
import { orchestrator } from './orchestrator';
import { bridgeServer } from './bridgeServer';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'autoplan.sidebarView';

  private _view?: vscode.WebviewView;
  private _activePlanPath?: string;
  private _phases: PhaseFile[] = [];
  private _selectedPhaseIndices: Set<number> = new Set();
  private _transcriptLogs: string[] = [];
  private _pendingLogQueue: string[] = [];
  private _logFlushTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context?: vscode.ExtensionContext
  ) {}

  public get view(): vscode.WebviewView | undefined {
    return this._view;
  }

  public getSelectedIndices(): Set<number> {
    return this._selectedPhaseIndices;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this.handleWebviewMessage(message);
    });

    this.refreshAndSendState();
    this.sendBridgeStatus();
  }

  public async refreshAndSendState() {
    if (!this._activePlanPath) {
      this._activePlanPath = getCurrentPlanFolder();
    }

    if (this._activePlanPath) {
      try {
        const stat = await fs.promises.stat(this._activePlanPath);
        if (stat.isDirectory()) {
          this._phases = await scanPlanFolderAsync(this._activePlanPath);
          if (this._selectedPhaseIndices.size === 0 && this._phases.length > 0) {
            this._phases.forEach((p, idx) => {
              if (!p.isCompleted) {
                this._selectedPhaseIndices.add(idx);
              }
            });
            if (this._selectedPhaseIndices.size === 0) {
              this._phases.forEach((_, idx) => this._selectedPhaseIndices.add(idx));
            }
          }
        }
      } catch {
        this._phases = [];
      }
    }

    let plans: { folderPath: string; relName: string; phaseCount: number }[] = [];
    try {
      plans = await discoverWorkspacePlanFoldersAsync();
    } catch {}

    const isRunning = orchestrator.isRunning();
    const isPaused = (orchestrator as any).isPaused ? (orchestrator as any).isPaused() : false;
    const currentPhase = orchestrator.getCurrentPhase();
    const currentIdx = currentPhase ? this._phases.findIndex(p => p.fileName === currentPhase.fileName) : 0;

    const state = {
      status: isRunning ? (isPaused ? 'paused' : 'running') : 'idle',
      activePlanPath: this._activePlanPath,
      phases: this._phases,
      selectedIndices: Array.from(this._selectedPhaseIndices),
      currentPhaseIndex: currentIdx >= 0 ? currentIdx : 0,
      progressPercentage: (orchestrator as any).getProgressPercentage ? (orchestrator as any).getProgressPercentage() : 0,
      plans
    };

    this.updateState(state);
  }

  public updateState(state?: any) {
    this.flushPendingLogs();
    if (!state) {
      void this.refreshAndSendState();
      return;
    }

    this._view?.webview.postMessage({
      type: 'stateUpdate',
      command: 'stateUpdate',
      ...state
    });
  }

  public sendBridgeStatus(statusString?: string) {
    let status = statusString;
    if (!status) {
      try {
        const clients = bridgeServer.getConnectedClients();
        if (clients && clients.length > 0) {
          status = 'connected';
        } else if (bridgeServer.isListening()) {
          status = 'keyboard';
        } else {
          status = 'disconnected';
        }
      } catch {
        status = 'disconnected';
      }
    }

    this._view?.webview.postMessage({
      type: 'bridgeStatus',
      command: 'bridgeStatus',
      status
    });
  }

  public appendTranscriptLog(log: string) {
    this._transcriptLogs.push(log);
    if (this._transcriptLogs.length > 100) {
      this._transcriptLogs.shift();
    }
    this._pendingLogQueue.push(log);
    if (!this._logFlushTimer) {
      this._logFlushTimer = setTimeout(() => {
        this.flushPendingLogs();
      }, 100);
    }
  }

  public flushPendingLogs(): void {
    if (this._logFlushTimer) {
      clearTimeout(this._logFlushTimer);
      this._logFlushTimer = null;
    }
    if (this._pendingLogQueue.length === 0) {
      return;
    }
    const logs = [...this._pendingLogQueue];
    this._pendingLogQueue = [];

    if (logs.length === 1) {
      this._view?.webview.postMessage({
        type: 'transcriptLog',
        command: 'transcriptLog',
        log: logs[0]
      });
    } else {
      this._view?.webview.postMessage({
        type: 'transcriptLogBatch',
        command: 'transcriptLogBatch',
        logs
      });
    }
  }

  public dispose(): void {
    this.flushPendingLogs();
  }

  public sendProgress(progress: { percentage: number; elapsedTime: string; currentPhaseIndex?: number; totalPhases?: number }) {
    this._view?.webview.postMessage({
      type: 'progress',
      command: 'progress',
      ...progress
    });
  }

  public async handleWebviewMessage(message: any) {
    if (!message) return;
    const cmd = message.command || message.type;

    switch (cmd) {
      case 'start':
        await this._handleStart();
        break;
      case 'pause':
        if ((orchestrator as any).pause) {
          (orchestrator as any).pause();
        }
        this.updateState();
        break;
      case 'resume':
        if ((orchestrator as any).resume) {
          (orchestrator as any).resume();
        }
        this.updateState();
        break;
      case 'skip':
        await vscode.commands.executeCommand('autoplan.skipPhase');
        break;
      case 'stop':
        await vscode.commands.executeCommand('autoplan.stop');
        break;
      case 'selectPlanFolder':
        if (message.folderPath) {
          this._activePlanPath = message.folderPath;
          setCurrentPlanFolder(message.folderPath);
          this._selectedPhaseIndices.clear();
          await this.refreshAndSendState();
        } else if (this._context) {
          await promptAndStartAutoPlan(this._context);
        }
        break;
      case 'refreshPlans':
        await this.refreshAndSendState();
        break;
      case 'togglePhase':
        if (typeof message.index === 'number') {
          if (message.selected) {
            this._selectedPhaseIndices.add(message.index);
          } else {
            this._selectedPhaseIndices.delete(message.index);
          }
          this.updateState();
        }
        break;
      case 'toggleAllPhases':
        if (message.selected) {
          this._phases.forEach((_, idx) => this._selectedPhaseIndices.add(idx));
        } else {
          this._selectedPhaseIndices.clear();
        }
        this.updateState();
        break;
      case 'activateBridge':
        await vscode.commands.executeCommand('autoplan.installBridge');
        this.sendBridgeStatus();
        break;
      case 'diagnostics':
        await showBridgeDiagnosticDialog();
        break;
      case 'settings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'autoplan');
        break;
    }
  }

  private async _handleStart() {
    if (!this._activePlanPath || !fs.existsSync(this._activePlanPath)) {
      if (this._context) {
        await promptAndStartAutoPlan(this._context);
      }
      return;
    }

    const phasesToRun: PhaseFile[] = [];
    this._phases.forEach((phase, idx) => {
      if (this._selectedPhaseIndices.has(idx)) {
        phasesToRun.push(phase);
      }
    });

    if (phasesToRun.length === 0) {
      vscode.window.showWarningMessage('Auto-Plan: Please select at least one phase to execute.');
      return;
    }

    if (this._context) {
      await executePhases(this._context, this._activePlanPath, sortPhaseFiles(phasesToRun));
    } else {
      await orchestrator.startPhases(sortPhaseFiles(phasesToRun));
    }
  }

  public _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'sidebar', 'sidebar.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'sidebar', 'sidebar.css')
    );
    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.svg')
    );

    const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'sidebar', 'sidebar.html');
    if (fs.existsSync(htmlPath)) {
      let rawHtml = fs.readFileSync(htmlPath, 'utf8');
      rawHtml = rawHtml.replace(/\${webview.cspSource}/g, webview.cspSource || "'none'");
      rawHtml = rawHtml.replace(/\${nonce}/g, nonce);
      rawHtml = rawHtml.replace(/\${styleUri}/g, styleUri.toString());
      rawHtml = rawHtml.replace(/\${scriptUri}/g, scriptUri.toString());
      rawHtml = rawHtml.replace(/\${iconUri}/g, iconUri.toString());
      return rawHtml;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
  <link href="${styleUri}" rel="stylesheet">
</head>
<body>
  <div class="container"><h2>Auto-Plan Control Center</h2></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export function getNonce(): string {
  try {
    return crypto.randomBytes(16).toString('hex');
  } catch {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
