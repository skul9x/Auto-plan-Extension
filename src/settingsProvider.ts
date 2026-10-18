import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {
  getConfig,
  DEFAULT_CONFIG,
  writeConfigJson,
  AutoPlanConfig,
  getTelegramConfig,
  SecretStorageManager,
  secretStorageManager as defaultSecretStorageManager
} from './config';
import { PromptDispatcher, promptDispatcher as defaultPromptDispatcher, DispatchTier } from './promptDispatcher';
import { bridgeServer } from './bridgeServer';
import { isBridgeInstalled } from './workbenchInjector';
import { keyboardManager } from './keyboardManager';
import { debugLogger, DebugLogger, LogEntry } from './debugLogger';
import { orchestrator } from './orchestrator';
import { auditPlanPhases, PlanPhasesAuditReport } from './planScanner';
import { getCurrentPlanFolder } from './extension';
import { telegramBridge } from './telegramBridge';

/**
 * Generates a cryptographically secure random nonce for Content Security Policy.
 */
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

/**
 * Singleton WebviewPanel provider for Auto-Plan Settings & Tier Management.
 */
export class SettingsProvider {
  public static currentPanel: SettingsProvider | undefined;
  public static readonly viewType = 'autoplan.settingsPanel';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _promptDispatcher: PromptDispatcher;
  private readonly _logger: DebugLogger;
  private _secretManager: SecretStorageManager;
  private _disposables: vscode.Disposable[] = [];
  private _isDisposing: boolean = false;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    promptDispatcher?: PromptDispatcher,
    logger?: DebugLogger,
    secretManager?: SecretStorageManager
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._promptDispatcher = promptDispatcher || defaultPromptDispatcher;
    this._logger = logger || debugLogger;
    this._secretManager = secretManager || defaultSecretStorageManager;

    // Subscribe to live log entries from debugLogger
    const logSub = this._logger.onLog((entry: LogEntry) => {
      this.sendLogEntry(entry);
    });
    this._disposables.push(logSub);

    // Set panel icon
    try {
      this._panel.iconPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.svg');
    } catch {}

    // Generate dynamic HTML with CSP and assets
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    // Listen for messages from webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      null,
      this._disposables
    );

    // Clean up resources on dispose
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Config watchdog: push updated settings when VS Code config changes externally
    if (vscode.workspace && vscode.workspace.onDidChangeConfiguration) {
      const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('autoplan')) {
          this.sendInitSettings();
          this.sendTelegramStatus();
        }
      });
      this._disposables.push(configWatcher);
    }
  }

  /**
   * Reveal existing singleton panel or create a new full-screen panel.
   */
  public static render(
    extensionUri: vscode.Uri,
    promptDispatcher?: PromptDispatcher,
    logger?: DebugLogger,
    secretManager?: SecretStorageManager
  ): SettingsProvider {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.Active;

    if (SettingsProvider.currentPanel) {
      if (secretManager) {
        SettingsProvider.currentPanel.setSecretManager(secretManager);
      }
      SettingsProvider.currentPanel._panel.reveal(column);
      return SettingsProvider.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      SettingsProvider.viewType,
      'Auto-Plan Settings',
      column || vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        retainContextWhenHidden: true
      }
    );

    SettingsProvider.currentPanel = new SettingsProvider(panel, extensionUri, promptDispatcher, logger, secretManager);
    return SettingsProvider.currentPanel;
  }

  public get panel(): vscode.WebviewPanel {
    return this._panel;
  }

  public get promptDispatcher(): PromptDispatcher {
    return this._promptDispatcher;
  }

  public get logger(): DebugLogger {
    return this._logger;
  }

  public get secretManager(): SecretStorageManager {
    return this._secretManager;
  }

  public setSecretManager(manager: SecretStorageManager): void {
    this._secretManager = manager;
  }

  public getExtensionUri(): vscode.Uri {
    return this._extensionUri;
  }

  /**
   * Closes the panel and cleans up event subscriptions.
   */
  public dispose(): void {
    if (this._isDisposing) {
      return;
    }
    this._isDisposing = true;
    SettingsProvider.currentPanel = undefined;

    try {
      this._panel.dispose();
    } catch {}

    while (this._disposables.length) {
      const item = this._disposables.pop();
      if (item) {
        item.dispose();
      }
    }
  }

  /**
   * Collects current bridge, toolchain, and port health diagnostics.
   */
  public getHealthDiagnostics(): {
    port: number;
    injected: boolean;
    clients: number;
    toolchain: string;
    nativeCommandStatus: string;
    isHealthy: boolean;
    workerKeepAlive: string;
    latencyMs: string;
  } {
    let port = 47352;
    let clients = 0;
    let serverListening = false;
    try {
      const server = this._promptDispatcher ? this._promptDispatcher.getBridgeServer() : bridgeServer;
      if (server) {
        port = server.getPort() || 47352;
        clients = server.getConnectedClients() ? server.getConnectedClients().length : 0;
        serverListening = server.isListening();
      }
    } catch {}

    let injected = false;
    try {
      injected = isBridgeInstalled();
    } catch {}

    let toolchain = 'OS Native';
    try {
      if (process.platform === 'win32') {
        toolchain = 'PowerShell (Ready)';
      } else if (process.platform === 'darwin') {
        toolchain = 'osascript (Ready)';
      } else {
        const prereq = keyboardManager.checkLinuxKeyboardPrerequisites();
        toolchain = prereq?.available ? 'xdotool (Ready)' : 'xdotool (Missing)';
      }
    } catch {
      toolchain = 'Keyboard fallback';
    }

    const nativeCommandStatus = 'Command API Ready';
    const isHealthy = injected && (clients > 0 || serverListening);
    const workerKeepAlive = clients > 0 ? 'Active' : (serverListening ? 'Listening' : 'Inactive');
    const latencyMs = clients > 0 ? '< 10ms' : 'N/A';

    return {
      port,
      injected,
      clients,
      toolchain,
      nativeCommandStatus,
      isHealthy,
      workerKeepAlive,
      latencyMs
    };
  }

  /**
   * Collects current plan and phase execution diagnostic audit.
   */
  public getPhaseDiagnostics(): PlanPhasesAuditReport | null {
    try {
      if (orchestrator.isRunning()) {
        return orchestrator.getPhaseAuditReport();
      }
      const activeFolder = getCurrentPlanFolder();
      if (activeFolder && fs.existsSync(activeFolder)) {
        return auditPlanPhases(activeFolder);
      }
      const config = getConfig();
      if (config.defaultPlanFolder && fs.existsSync(config.defaultPlanFolder)) {
        return auditPlanPhases(config.defaultPlanFolder);
      }
    } catch {}
    return null;
  }

  /**
   * Broadcasts live health and diagnostic status to the webview.
   */
  public sendHealthUpdate(): void {
    try {
      const health = this.getHealthDiagnostics();
      const planPhases = this.getPhaseDiagnostics();
      this._panel.webview.postMessage({
        command: 'healthUpdate',
        type: 'healthUpdate',
        ...health,
        planPhases
      });
    } catch {}
  }

  /**
   * Broadcasts current configuration and phase telemetry to the webview.
   */
  public sendInitSettings(): void {
    try {
      const currentConfig = getConfig();
      const planPhases = this.getPhaseDiagnostics();
      this._panel.webview.postMessage({
        command: 'initSettings',
        type: 'initSettings',
        settings: currentConfig,
        config: currentConfig,
        planPhases
      });
    } catch {}
  }

  /**
   * Broadcasts dedicated phase diagnostics update to webview.
   */
  public sendPhaseDiagnostics(): void {
    try {
      const planPhases = this.getPhaseDiagnostics();
      this._panel.webview.postMessage({
        command: 'phaseDiagnostics',
        type: 'phaseDiagnostics',
        planPhases
      });
    } catch {}
  }

  /**
   * Broadcasts the in-memory log buffer to the webview.
   */
  public sendLogBuffer(): void {
    try {
      const entries = this._logger.getEntries();
      this._panel.webview.postMessage({
        command: 'logBuffer',
        type: 'logBuffer',
        entries
      });
    } catch {}
  }

  /**
   * Pushes a single log entry update to the webview.
   */
  public sendLogEntry(entry: LogEntry): void {
    try {
      this._panel.webview.postMessage({
        command: 'logEntry',
        type: 'logEntry',
        entry
      });
    } catch {}
  }

  /**
   * Introspects Telegram integration status securely without exposing raw secrets.
   */
  public async getTelegramStatus(): Promise<{
    enabled: boolean;
    allowFreeChat: boolean;
    enableChatMirror: boolean;
    hasToken: boolean;
    allowedUsers: (number | string)[];
    throttleMs: number;
  }> {
    const cfg = getTelegramConfig();
    let hasToken = false;
    try {
      const sec = await this._secretManager.getTelegramToken();
      hasToken = !!(sec && sec.trim().length > 0) || !!(cfg.botToken && cfg.botToken.trim().length > 0);
    } catch {
      hasToken = !!(cfg.botToken && cfg.botToken.trim().length > 0);
    }
    return {
      enabled: cfg.enabled,
      allowFreeChat: cfg.allowFreeChat ?? true,
      enableChatMirror: cfg.enableChatMirror ?? true,
      hasToken,
      allowedUsers: cfg.allowedUsers || [],
      throttleMs: cfg.throttleMs ?? 2500
    };
  }

  /**
   * Broadcasts Telegram integration status to the webview.
   */
  public async sendTelegramStatus(): Promise<void> {
    try {
      const status = await this.getTelegramStatus();
      this._panel.webview.postMessage({
        command: 'telegramStatusUpdate',
        type: 'telegramStatusUpdate',
        status
      });
    } catch {}
  }

  /**
   * Central IPC message router handling actions initiated by the webview.
   */
  public async handleMessage(message: any): Promise<void> {
    if (!message) return;
    const cmd = message.command || message.type;

    switch (cmd) {
      case 'ready': {
        this.sendInitSettings();
        this.sendHealthUpdate();
        this.sendPhaseDiagnostics();
        this.sendLogBuffer();
        await this.sendTelegramStatus();
        break;
      }

      case 'requestPhaseDiagnostics': {
        this.sendPhaseDiagnostics();
        break;
      }

      case 'saveSettings': {
        try {
          const settings = message.settings || {};
          const configSection = vscode.workspace.getConfiguration('autoplan');
          for (const key of Object.keys(settings)) {
            await configSection.update(key, settings[key], vscode.ConfigurationTarget.Global);
          }
          try {
            writeConfigJson(settings);
          } catch {}

          this._panel.webview.postMessage({
            command: 'saveConfirmed',
            type: 'saveConfirmed'
          });
          vscode.window.showInformationMessage('Auto-Plan: Settings saved successfully.');
        } catch (err: any) {
          this._panel.webview.postMessage({
            command: 'error',
            type: 'error',
            error: err?.message || String(err)
          });
          vscode.window.showErrorMessage(`Auto-Plan: Failed to save settings: ${err?.message || err}`);
        }
        break;
      }

      case 'resetSettings': {
        try {
          const configSection = vscode.workspace.getConfiguration('autoplan');
          for (const key of Object.keys(DEFAULT_CONFIG)) {
            await configSection.update(key, (DEFAULT_CONFIG as any)[key], vscode.ConfigurationTarget.Global);
          }
          try {
            writeConfigJson(DEFAULT_CONFIG);
          } catch {}

          this._panel.webview.postMessage({
            command: 'initSettings',
            type: 'initSettings',
            settings: DEFAULT_CONFIG,
            config: DEFAULT_CONFIG
          });
          this._panel.webview.postMessage({
            command: 'saveConfirmed',
            type: 'saveConfirmed'
          });
          vscode.window.showInformationMessage('Auto-Plan: Settings reset to defaults.');
        } catch (err: any) {
          this._panel.webview.postMessage({
            command: 'error',
            type: 'error',
            error: err?.message || String(err)
          });
          vscode.window.showErrorMessage(`Auto-Plan: Failed to reset settings: ${err?.message || err}`);
        }
        break;
      }

      case 'testTier': {
        try {
          const tier = message.tier;
          const targetTier: DispatchTier = (!tier || tier === 'auto') ? 'domBridge' : tier;
          const result = await this._promptDispatcher.testTierDispatch(targetTier);
          this._panel.webview.postMessage({
            command: 'testResult',
            type: 'testResult',
            success: result.success,
            latencyMs: result.latencyMs,
            status: result.status,
            error: result.error
          });
        } catch (err: any) {
          this._panel.webview.postMessage({
            command: 'testResult',
            type: 'testResult',
            success: false,
            latencyMs: 0,
            error: err?.message || String(err)
          });
        }
        break;
      }

      case 'setupBridge': {
        try {
          await vscode.commands.executeCommand('autoplan.oneClickSetup');
        } catch {
          try {
            await vscode.commands.executeCommand('autoplan.installBridge');
          } catch {}
        }
        this.sendHealthUpdate();
        break;
      }

      case 'uninstallBridge': {
        try {
          await vscode.commands.executeCommand('autoplan.uninstallBridge');
        } catch {}
        this.sendHealthUpdate();
        break;
      }

      case 'openFolderPicker': {
        try {
          const uris = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Default Plan Folder'
          });
          if (uris && uris.length > 0) {
            const folderPath = uris[0].fsPath;
            this._panel.webview.postMessage({
              command: 'folderSelected',
              type: 'folderSelected',
              folderPath
            });
          }
        } catch (err: any) {
          this._panel.webview.postMessage({
            command: 'error',
            type: 'error',
            error: err?.message || String(err)
          });
        }
        break;
      }

      case 'copyDebugLog': {
        try {
          await vscode.commands.executeCommand('autoplan.copyDebugLog');
        } catch (err: any) {
          vscode.window.showErrorMessage(`Auto-Plan: Failed to copy debug log: ${err?.message || err}`);
        }
        break;
      }

      case 'exportDebugLog': {
        try {
          await vscode.commands.executeCommand('autoplan.exportDebugLog');
        } catch (err: any) {
          vscode.window.showErrorMessage(`Auto-Plan: Failed to export debug log: ${err?.message || err}`);
        }
        break;
      }

      case 'clearDebugLog': {
        this._logger.clear();
        this.sendLogBuffer();
        try {
          await vscode.commands.executeCommand('autoplan.clearDebugLog');
        } catch {}
        break;
      }

      case 'showOutputChannel': {
        try {
          await vscode.commands.executeCommand('autoplan.showOutputChannel');
        } catch {
          this._logger.showOutputChannel(false);
        }
        break;
      }

      case 'requestLogBuffer': {
        this.sendLogBuffer();
        break;
      }

      case 'requestTelegramStatus': {
        await this.sendTelegramStatus();
        break;
      }

      case 'requestSetTelegramToken': {
        const token = await vscode.window.showInputBox({
          password: true,
          prompt: 'Enter Telegram Bot API Token from @BotFather',
          placeHolder: '1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ',
          ignoreFocusOut: true
        });
        if (token && token.trim()) {
          await this._secretManager.setTelegramToken(token.trim());
          await vscode.workspace.getConfiguration('autoplan').update('telegramEnabled', true, vscode.ConfigurationTarget.Global);
          try {
            await telegramBridge.reloadConfig();
          } catch {}
          const status = await this.getTelegramStatus();
          this._panel.webview.postMessage({
            command: 'telegramTokenUpdated',
            type: 'telegramTokenUpdated',
            hasToken: true,
            enabled: true,
            status
          });
          this._panel.webview.postMessage({
            command: 'telegramStatusUpdate',
            type: 'telegramStatusUpdate',
            status
          });
        } else {
          // User pressed Esc or Cancel -> Signal optimistic rollback to webview
          this._panel.webview.postMessage({
            command: 'tokenPromptCancelled',
            type: 'tokenPromptCancelled',
            rollback: true,
            enabled: false
          });
        }
        break;
      }

      case 'requestClearTelegramToken': {
        try {
          await this._secretManager.deleteTelegramToken();
        } catch {}
        try {
          await vscode.workspace.getConfiguration('autoplan').update('telegramBotToken', '', vscode.ConfigurationTarget.Global);
        } catch {}
        try {
          await telegramBridge.reloadConfig();
        } catch {}
        const status = await this.getTelegramStatus();
        this._panel.webview.postMessage({
          command: 'telegramTokenCleared',
          type: 'telegramTokenCleared',
          hasToken: false,
          status
        });
        this._panel.webview.postMessage({
          command: 'telegramStatusUpdate',
          type: 'telegramStatusUpdate',
          status
        });
        break;
      }
    }
  }

  /**
   * Assembles dynamic HTML replacing asset placeholders with webview URIs and CSP nonce.
   */
  public _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'settings', 'settings.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'settings', 'settings.css')
    );
    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.svg')
    );

    const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'settings', 'settings.html');
    if (fs.existsSync(htmlPath)) {
      let rawHtml = fs.readFileSync(htmlPath, 'utf8');
      rawHtml = rawHtml.replace(/\${webview\.cspSource}/g, webview.cspSource || "'none'");
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>Auto-Plan Settings</title>
</head>
<body>
  <div class="container"><h1>Auto-Plan Settings</h1></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
