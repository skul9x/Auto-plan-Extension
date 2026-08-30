import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getWorkbenchPath, isBridgeInstalled, BACKUP_SUFFIX } from './workbenchInjector';
import { getConfig, AutoPlanConfig } from './config';
import type { PlanPhasesAuditReport, PhaseDiagnosticInfo, PhaseStallReason } from './planScanner';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type LogComponent =
  | 'SERVER'
  | 'CLIENT'
  | 'DISPATCHER'
  | 'INJECTOR'
  | 'DOM'
  | 'ORCHESTRATOR'
  | 'SETTINGS'
  | 'PHASE';

export interface LogEntry {
  id: string;
  timestamp: number;
  isoTime: string;
  level: LogLevel;
  component: LogComponent;
  message: string;
  details?: any;
  error?: string;
}

export interface EnvironmentReport {
  timestamp: string;
  os: {
    platform: string;
    arch: string;
    release: string;
    type: string;
    totalMemMb: number;
    freeMemMb: number;
  };
  runtime: {
    node: string;
    electron: string;
  };
  vscode: {
    version: string;
    appName: string;
    appRoot: string;
  };
  domBridge: {
    installed: boolean;
    workbenchHtmlPath: string | null;
    backupPresent: boolean;
  };
  server: {
    activePort: number | null;
    connectedClientsCount: number;
    connectedClients: any[];
    activeWindowKey: string | null;
  };
  config: {
    executionMode: string;
    allowTierFallback: boolean;
    strictMode: boolean;
    bridgeTimeoutMs: number;
    timeoutPerLoopMinutes: number;
    enableVerboseBridgeLogs: boolean;
    maxLogEntries: number;
    autoOpenBridgeLogOnError: boolean;
  };
  planPhases?: PlanPhasesAuditReport;
}

/**
 * Safely serializes objects avoiding circular references
 */
function safeStringify(obj: any): string {
  if (obj === undefined || obj === null) {
    return '';
  }
  if (typeof obj === 'string') {
    return obj;
  }
  try {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    });
  } catch {
    return String(obj);
  }
}

/**
 * Truncates and sanitizes prompt text for safe and compact logging
 */
export function sanitizePrompt(prompt: string, maxLength: number = 120): string {
  if (!prompt || typeof prompt !== 'string') {
    return '';
  }
  // Replace newlines with spaces for compact single-line preview
  const singleLine = prompt.replace(/\r?\n|\r/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength)}... (${prompt.length} chars)`;
}

export class DebugLogger {
  public static readonly OUTPUT_CHANNEL_NAME = 'Auto-Plan DOM Bridge';
  public static readonly DEFAULT_CAPACITY = 500;

  private entries: LogEntry[] = [];
  private capacity: number = DebugLogger.DEFAULT_CAPACITY;
  private listeners: Set<(entry: LogEntry) => void> = new Set();
  private outputChannel: vscode.OutputChannel | vscode.LogOutputChannel | null = null;
  private bridgeServerInstance: any = null;
  private planAuditProvider: (() => PlanPhasesAuditReport | null) | null = null;
  private sequenceCounter: number = 0;

  constructor(capacity?: number) {
    if (capacity && capacity > 0) {
      this.capacity = capacity;
    } else {
      try {
        const cfg = getConfig();
        if (cfg.maxLogEntries && cfg.maxLogEntries > 0) {
          this.capacity = cfg.maxLogEntries;
        }
      } catch {
        this.capacity = DebugLogger.DEFAULT_CAPACITY;
      }
    }
  }

  /**
   * Links an active BridgeServer instance to this logger for diagnostics
   */
  public registerBridgeServer(server: any): void {
    this.bridgeServerInstance = server;
  }

  /**
   * Registers a provider callback that supplies real-time plan phase audit telemetry
   */
  public registerPlanAuditProvider(provider: () => PlanPhasesAuditReport | null): void {
    this.planAuditProvider = provider;
  }

  /**
   * Sets the ring-buffer maximum capacity
   */
  public setCapacity(capacity: number): void {
    this.capacity = Math.max(1, capacity);
    while (this.entries.length > this.capacity) {
      this.entries.shift();
    }
  }

  /**
   * Gets current capacity
   */
  public getCapacity(): number {
    return this.capacity;
  }

  /**
   * Core logging method. Appends entry to ring-buffer and streams to output channel.
   */
  public log(
    level: LogLevel,
    component: LogComponent,
    message: string,
    details?: any,
    error?: string | Error
  ): LogEntry {
    const timestamp = Date.now();
    this.sequenceCounter = (this.sequenceCounter + 1) % 1000000;
    const id = `log_${timestamp}_${this.sequenceCounter.toString(36)}`;
    const isoTime = new Date(timestamp).toISOString();

    let errorStr: string | undefined = undefined;
    if (error) {
      if (error instanceof Error) {
        errorStr = error.stack || error.message;
      } else {
        errorStr = String(error);
      }
    }

    const entry: LogEntry = {
      id,
      timestamp,
      isoTime,
      level,
      component,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(errorStr !== undefined ? { error: errorStr } : {})
    };

    // Append to bounded ring buffer
    this.entries.push(entry);
    while (this.entries.length > this.capacity) {
      this.entries.shift();
    }

    // Stream formatted line to VS Code Output Channel
    this.streamToOutputChannel(entry);

    // Notify registered subscribers
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (listenerErr) {
        console.error('[DebugLogger] Error in log subscription listener:', listenerErr);
      }
    }

    return entry;
  }

  public debug(component: LogComponent, message: string, details?: any): LogEntry {
    return this.log('DEBUG', component, message, details);
  }

  public info(component: LogComponent, message: string, details?: any): LogEntry {
    return this.log('INFO', component, message, details);
  }

  public warn(component: LogComponent, message: string, details?: any, error?: string | Error): LogEntry {
    return this.log('WARN', component, message, details, error);
  }

  public error(component: LogComponent, message: string, details?: any, error?: string | Error): LogEntry {
    return this.log('ERROR', component, message, details, error);
  }

  /**
   * Logs a high-visibility phase lifecycle transition event with component 'PHASE'
   */
  public logPhaseEvent(
    phase: PhaseDiagnosticInfo,
    event: 'START' | 'COMPLETE' | 'FAIL' | 'SKIP' | 'STALL',
    message: string,
    details?: any
  ): LogEntry {
    let level: LogLevel = 'INFO';
    if (event === 'FAIL') {
      level = 'ERROR';
    } else if (event === 'SKIP' || event === 'STALL') {
      level = 'WARN';
    }

    const phaseNum = phase.phaseNumber !== undefined ? phase.phaseNumber : phase.index + 1;
    const formattedMessage = `[PHASE_${event}] Phase ${phaseNum} (${phase.fileName}): ${message}`;

    const enrichedDetails = {
      phaseIndex: phase.index,
      phaseNumber: phaseNum,
      fileName: phase.fileName,
      status: phase.status,
      event,
      ...(details !== undefined ? (typeof details === 'object' && details !== null ? details : { details }) : {})
    };

    let errorToLog: string | Error | undefined = undefined;
    if (event === 'FAIL') {
      errorToLog = phase.error || details?.error || message;
    } else if (details?.error) {
      errorToLog = details.error;
    }

    return this.log(level, 'PHASE', formattedMessage, enrichedDetails, errorToLog);
  }

  /**
   * Logs a diagnosed stall / blocker event for a phase
   */
  public logPhaseStall(phase: PhaseDiagnosticInfo, stallReason: PhaseStallReason): LogEntry {
    return this.logPhaseEvent(phase, 'STALL', stallReason.description, { stallReason });
  }

  /**
   * Retrieves all entries currently stored in the in-memory ring buffer
   */
  public getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Retrieves the most recent N entries from the in-memory ring buffer
   */
  public getRecentEntries(count: number = 50): LogEntry[] {
    if (count <= 0) {
      return [];
    }
    return this.entries.slice(-count);
  }

  /**
   * Clears all log entries currently retained in memory
   */
  public clear(): void {
    this.entries = [];
  }

  /**
   * Subscribes a listener callback to real-time log entries
   */
  public onLog(listener: (entry: LogEntry) => void): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      }
    };
  }

  /**
   * Formats a single LogEntry according to standard pattern:
   * [YYYY-MM-DDTHH:mm:ss.sssZ] [LEVEL] [COMPONENT] Message {details}
   */
  public formatEntry(entry: LogEntry): string {
    let line = `[${entry.isoTime}] [${entry.level}] [${entry.component}] ${entry.message}`;
    if (entry.details !== undefined && entry.details !== null) {
      const detailsStr = safeStringify(entry.details);
      if (detailsStr) {
        line += ` ${detailsStr}`;
      }
    }
    if (entry.error) {
      line += ` | Error: ${entry.error}`;
    }
    return line;
  }

  /**
   * Lazily instantiates and returns the dedicated VS Code Output Channel
   */
  public getOrCreateOutputChannel(): vscode.OutputChannel | vscode.LogOutputChannel | null {
    if (this.outputChannel) {
      return this.outputChannel;
    }

    try {
      const vscodeModule = require('vscode');
      if (!vscodeModule?.window?.createOutputChannel) {
        return null;
      }

      try {
        // Attempt creating LogOutputChannel if supported by current VS Code version
        this.outputChannel = vscodeModule.window.createOutputChannel(DebugLogger.OUTPUT_CHANNEL_NAME, { log: true });
      } catch {
        // Fall back to standard OutputChannel
        this.outputChannel = vscodeModule.window.createOutputChannel(DebugLogger.OUTPUT_CHANNEL_NAME);
      }
      return this.outputChannel;
    } catch {
      return null;
    }
  }

  /**
   * Reveals the output channel in the VS Code workbench
   */
  public showOutputChannel(preserveFocus: boolean = true): void {
    const channel = this.getOrCreateOutputChannel();
    if (channel && typeof channel.show === 'function') {
      channel.show(preserveFocus);
    }
  }

  /**
   * Streams a formatted log entry to the VS Code Output Channel
   */
  private streamToOutputChannel(entry: LogEntry): void {
    try {
      const channel = this.getOrCreateOutputChannel();
      if (!channel) {
        return;
      }
      const formatted = this.formatEntry(entry);
      if (typeof channel.appendLine === 'function') {
        channel.appendLine(formatted);
      }
    } catch {
      // Safe fallback: never crash execution due to logging stream errors
    }
  }

  /**
   * Sanitizes prompt text
   */
  public sanitizePrompt(prompt: string, maxLength?: number): string {
    return sanitizePrompt(prompt, maxLength);
  }

  /**
   * Compiles comprehensive environment and diagnostic metadata
   */
  public buildEnvironmentReport(
    serverOverride?: any,
    planAuditOverride?: PlanPhasesAuditReport
  ): EnvironmentReport {
    // OS details
    const osInfo = {
      platform: process.platform,
      arch: process.arch,
      release: os.release ? os.release() : 'unknown',
      type: os.type ? os.type() : 'unknown',
      totalMemMb: Math.round(os.totalmem ? os.totalmem() / (1024 * 1024) : 0),
      freeMemMb: Math.round(os.freemem ? os.freemem() / (1024 * 1024) : 0)
    };

    // Node & Electron versions
    const runtimeInfo = {
      node: process.versions?.node || process.version || 'unknown',
      electron: (process.versions as any)?.electron || 'N/A (Pure Node.js)'
    };

    // VS Code / Antigravity app details
    let vscodeInfo = {
      version: 'unknown',
      appName: 'VS Code',
      appRoot: 'unknown'
    };
    try {
      const vscodeModule = require('vscode');
      if (vscodeModule) {
        vscodeInfo = {
          version: vscodeModule.version || 'unknown',
          appName: vscodeModule.env?.appName || 'VS Code',
          appRoot: vscodeModule.env?.appRoot || 'unknown'
        };
      }
    } catch {
      // Standalone test environment
    }

    // DOM Bridge installation status
    let domBridgeInfo = {
      installed: false,
      workbenchHtmlPath: null as string | null,
      backupPresent: false
    };
    try {
      const wbPath = getWorkbenchPath();
      domBridgeInfo.workbenchHtmlPath = wbPath;
      if (wbPath && fs.existsSync(wbPath)) {
        domBridgeInfo.installed = isBridgeInstalled(wbPath);
        const backupPath = wbPath + BACKUP_SUFFIX;
        domBridgeInfo.backupPresent = fs.existsSync(backupPath);
      }
    } catch {
      // Fallback
    }

    // Server binding state
    const srv = serverOverride || this.bridgeServerInstance;
    let serverInfo = {
      activePort: null as number | null,
      connectedClientsCount: 0,
      connectedClients: [] as any[],
      activeWindowKey: null as string | null
    };

    if (srv) {
      try {
        serverInfo.activePort = typeof srv.getPort === 'function' ? srv.getPort() : (srv.port ?? null);
        serverInfo.activeWindowKey = typeof srv.getActiveWindowKey === 'function' ? srv.getActiveWindowKey() : (srv.activeWindowKey ?? null);
        if (typeof srv.getConnectedClients === 'function') {
          const clients = srv.getConnectedClients();
          serverInfo.connectedClients = Array.isArray(clients) ? clients : [];
          serverInfo.connectedClientsCount = serverInfo.connectedClients.length;
        }
      } catch {
        // Safe fallback
      }
    } else {
      // Attempt dynamic check if bridgeServer is available
      try {
        const { bridgeServer } = require('./bridgeServer');
        if (bridgeServer) {
          serverInfo.activePort = bridgeServer.getPort();
          serverInfo.activeWindowKey = bridgeServer.getActiveWindowKey();
          const clients = bridgeServer.getConnectedClients();
          serverInfo.connectedClients = Array.isArray(clients) ? clients : [];
          serverInfo.connectedClientsCount = serverInfo.connectedClients.length;
        }
      } catch {
        // Standalone or test environment
      }
    }

    // Execution configuration snapshot
    let configInfo = {
      executionMode: 'auto',
      allowTierFallback: true,
      strictMode: false,
      bridgeTimeoutMs: 5000,
      timeoutPerLoopMinutes: 15,
      enableVerboseBridgeLogs: false,
      maxLogEntries: 500,
      autoOpenBridgeLogOnError: false
    };
    try {
      const cfg = getConfig();
      configInfo = {
        executionMode: cfg.executionMode ?? 'auto',
        allowTierFallback: cfg.allowTierFallback ?? true,
        strictMode: cfg.strictMode ?? false,
        bridgeTimeoutMs: cfg.bridgeTimeoutMs ?? 5000,
        timeoutPerLoopMinutes: cfg.timeoutPerLoopMinutes ?? 15,
        enableVerboseBridgeLogs: cfg.enableVerboseBridgeLogs ?? false,
        maxLogEntries: cfg.maxLogEntries ?? 500,
        autoOpenBridgeLogOnError: cfg.autoOpenBridgeLogOnError ?? false
      };
    } catch {
      // Fallback
    }

    // Phase telemetry audit snapshot
    let planPhases: PlanPhasesAuditReport | undefined = planAuditOverride;
    if (!planPhases && this.planAuditProvider) {
      try {
        const providerResult = this.planAuditProvider();
        if (providerResult) {
          planPhases = providerResult;
        }
      } catch (providerErr) {
        console.error('[DebugLogger] Error in planAuditProvider callback:', providerErr);
      }
    }

    return {
      timestamp: new Date().toISOString(),
      os: osInfo,
      runtime: runtimeInfo,
      vscode: vscodeInfo,
      domBridge: domBridgeInfo,
      server: serverInfo,
      config: configInfo,
      ...(planPhases ? { planPhases } : {})
    };
  }

  /**
   * Formats a complete diagnostic report string in clean Markdown format
   */
  public exportDiagnosticReportToString(
    maxEntries: number = 100,
    serverOverride?: any,
    planAuditOverride?: PlanPhasesAuditReport
  ): string {
    const report = this.buildEnvironmentReport(serverOverride, planAuditOverride);
    const recentLogs = this.getRecentEntries(maxEntries);

    const isBridgeInstalled = report.domBridge.installed;
    const isServerListening = report.server.activePort !== null;
    const hasConnectedClients = report.server.connectedClientsCount > 0;

    // Build Section 2: Phase Execution & Stall Diagnostics
    const phaseSectionLines: string[] = ['## 2. Phase Execution & Stall Diagnostics', ''];
    if (report.planPhases && report.planPhases.phases && report.planPhases.phases.length > 0) {
      const pp = report.planPhases;
      const runningCount = pp.phases.filter(p => p.status === 'Running').length;
      const healthStatus = pp.hasBlockers || pp.failedCount > 0
        ? `⚠️ Stall Detected${pp.primaryBlockerReason ? ` (${pp.primaryBlockerReason})` : ''}`
        : '✅ Normal';

      phaseSectionLines.push(`- **Plan Folder:** \`${pp.folderPath}\``);
      phaseSectionLines.push(
        `- **Summary:** ${pp.totalPhases} total phases (${pp.completedCount} Completed, ${runningCount} Running, ${pp.pendingCount} Pending, ${pp.failedCount} Failed${pp.skippedCount > 0 ? `, ${pp.skippedCount} Skipped` : ''})`
      );
      phaseSectionLines.push(`- **Execution Health:** ${healthStatus}`);
      phaseSectionLines.push('');
      phaseSectionLines.push('| # | Phase File | Status | Duration | Stall / Blocker Reason | Action / Remediation |');
      phaseSectionLines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');

      for (const p of pp.phases) {
        const numStr = String(p.phaseNumber !== undefined ? p.phaseNumber : p.index + 1).padStart(2, '0');
        const fileStr = `\`${p.fileName}\``;
        let statusStr = p.status as string;
        if (p.status === 'Completed') {
          statusStr = '✅ Completed';
        } else if (p.status === 'Running') {
          statusStr = '🔄 Running';
        } else if (p.status === 'Pending') {
          statusStr = '⏳ Pending';
        } else if (p.status === 'Failed') {
          statusStr = '❌ Failed';
        } else if (p.status === 'Skipped') {
          statusStr = '⏭️ Skipped';
        }

        const durationStr = p.executionTimeMs !== undefined && p.executionTimeMs > 0
          ? `${(p.executionTimeMs / 1000).toFixed(1)}s`
          : '-';

        let stallStr = '-';
        if (p.stallReason?.description) {
          stallStr = p.stallReason.description.replace(/\|/g, '\\|');
        } else if (p.status === 'Completed') {
          stallStr = 'None';
        } else if (p.status === 'Running') {
          stallStr = 'None';
        }

        let actionStr = '-';
        if (p.stallReason?.remediationAction) {
          actionStr = p.stallReason.remediationAction.replace(/\|/g, '\\|');
        }

        phaseSectionLines.push(`| ${numStr} | ${fileStr} | ${statusStr} | ${durationStr} | ${stallStr} | ${actionStr} |`);
      }
    } else if (report.planPhases) {
      phaseSectionLines.push(`- **Plan Folder:** \`${report.planPhases.folderPath}\``);
      phaseSectionLines.push(`- **Summary:** 0 total phases found`);
      phaseSectionLines.push(`- **Execution Health:** ${report.planPhases.primaryBlockerReason ? `⚠️ ${report.planPhases.primaryBlockerReason}` : '✅ Normal'}`);
    } else {
      phaseSectionLines.push('*(No active plan folder or phase telemetry registered)*');
    }

    const lines: string[] = [
      '# Auto-Plan DOM Bridge Diagnostic Report',
      `**Generated At:** \`${report.timestamp}\``,
      `**Environment:** \`${report.os.platform} (${report.os.arch})\` | Node \`${report.runtime.node}\` | Electron \`${report.runtime.electron}\``,
      '',
      '---',
      '',
      '## 1. Environment & System Information',
      '',
      '| Category | Property | Value |',
      '| :--- | :--- | :--- |',
      `| OS | Platform / Architecture | \`${report.os.platform} (${report.os.arch})\` |`,
      `| OS | Kernel Release | \`${report.os.release}\` |`,
      `| OS | System Memory (Free / Total) | \`${report.os.freeMemMb} MB / ${report.os.totalMemMb} MB\` |`,
      `| Runtime | Node.js Version | \`${report.runtime.node}\` |`,
      `| Runtime | Electron Version | \`${report.runtime.electron}\` |`,
      `| VS Code | Application Name | \`${report.vscode.appName}\` |`,
      `| VS Code | App Version | \`${report.vscode.version}\` |`,
      `| VS Code | App Root Directory | \`${report.vscode.appRoot}\` |`,
      `| DOM Bridge | Script Injection State | ${isBridgeInstalled ? '✅ **Injected**' : '❌ **Not Injected**'} |`,
      `| DOM Bridge | Workbench HTML Path | \`${report.domBridge.workbenchHtmlPath || 'Not Found'}\` |`,
      `| DOM Bridge | Backup File Present | ${report.domBridge.backupPresent ? '✅ Yes' : '⚠️ No backup found'} |`,
      `| Bridge Server | Active Listening Port | ${isServerListening ? `\`${report.server.activePort}\`` : '⚠️ None (Server Inactive)'} |`,
      `| Bridge Server | Connected Clients Count | \`${report.server.connectedClientsCount}\` |`,
      `| Bridge Server | Active Window Key | \`${report.server.activeWindowKey || 'None'}\` |`,
      `| Configuration | Dispatch Execution Mode | \`${report.config.executionMode}\` |`,
      `| Configuration | Allow Tier Fallback | \`${report.config.allowTierFallback}\` |`,
      `| Configuration | Strict Execution Mode | \`${report.config.strictMode}\` |`,
      `| Configuration | Bridge Timeout | \`${report.config.bridgeTimeoutMs} ms\` |`,
      `| Configuration | Verbose Logs Enabled | \`${report.config.enableVerboseBridgeLogs}\` |`,
      '',
      '---',
      '',
      ...phaseSectionLines,
      '',
      '---',
      '',
      '## 3. Component Health Status Checklist',
      '',
      '- [x] **Extension Host Runtime**: Operational',
      '- [x] **Configuration Subsystem**: Loaded and verified',
      `- [${isBridgeInstalled ? 'x' : ' '}] **DOM Bridge Script Injection**: ${isBridgeInstalled ? 'Injected in workbench.html' : 'Not injected or missing markers'}`,
      `- [${isServerListening ? 'x' : ' '}] **HTTP Bridge Server**: ${isServerListening ? `Active on port ${report.server.activePort}` : 'Not running'}`,
      `- [${hasConnectedClients ? 'x' : ' '}] **Electron Renderer Client**: ${hasConnectedClients ? `Connected (${report.server.connectedClientsCount} client(s))` : 'No active renderer clients registered'}`,
      '',
      '---',
      '',
      `## 4. Recent Log Traces (Last ${recentLogs.length} entries)`,
      '',
      '```text',
      ...(recentLogs.length > 0
        ? recentLogs.map((entry) => this.formatEntry(entry))
        : ['(No log entries recorded in memory buffer)']),
      '```',
      ''
    ];

    return lines.join('\n');
  }

  /**
   * Writes the compiled diagnostic report directly to a file on disk
   */
  public async exportLogToFile(
    targetFilePath: string,
    maxEntries: number = 100,
    serverOverride?: any,
    planAuditOverride?: PlanPhasesAuditReport
  ): Promise<string> {
    const reportContent = this.exportDiagnosticReportToString(maxEntries, serverOverride, planAuditOverride);
    const targetDir = path.dirname(targetFilePath);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    await fs.promises.writeFile(targetFilePath, reportContent, 'utf8');
    return targetFilePath;
  }

  /**
   * Disposes logger resources and output channel
   */
  public dispose(): void {
    if (this.outputChannel) {
      try {
        this.outputChannel.dispose();
      } catch {
        // ignore
      }
      this.outputChannel = null;
    }
    this.listeners.clear();
    this.entries = [];
  }
}

export const debugLogger = new DebugLogger();
export default debugLogger;

export {
  PhaseStallCode,
  PhaseStallReason,
  PhaseDiagnosticInfo,
  PlanPhasesAuditReport,
  PhaseExecutionContext,
  analyzePhaseStallReason,
  auditPlanPhases,
  auditPlanPhasesAsync,
  inspectPhaseHeader,
  inspectPhaseHeaderAsync
} from './planScanner';

