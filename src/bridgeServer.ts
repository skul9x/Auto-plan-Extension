import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { getWorkbenchPath } from './workbenchInjector';
import { DebugLogger, debugLogger, LogLevel, LogComponent } from './debugLogger';

export const DEFAULT_PORT_START = 48860;
export const DEFAULT_PORT_END = 48900;
export const DEFAULT_COMMAND_TIMEOUT_MS = 6000;
export const DEFAULT_STALE_CLIENT_MS = 120000;
export const PORT_REGISTRY_FILENAME = 'ag-autoplan-ports.json';
export const BRIDGE_SERVICE_NAME = 'autoplan-bridge-server';
export const BRIDGE_PROTOCOL_VERSION = '2.0.0';

export type CommandType = 'sendPrompt' | 'openNewConversation' | 'clickApproval' | 'ping' | string;

export interface BridgeCommand {
  id: string;
  type: CommandType;
  text?: string;
  options?: Record<string, any>;
  windowKey?: string;
  createdAt: number;
  timeoutMs?: number;
}

export interface BridgeCommandAck {
  commandId: string;
  status: 'received' | 'promptInjected' | 'submitClicked' | 'completed' | 'error' | string;
  windowKey?: string;
  error?: string;
  timestamp?: number;
  metadata?: Record<string, any>;
}

export interface CommandAckResult {
  success: boolean;
  commandId: string;
  status: string;
  durationMs: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface CommandOptions {
  timeoutMs?: number;
  type?: CommandType;
  windowKey?: string;
  extra?: Record<string, any>;
}

export interface BridgeClientTelemetry {
  lastSeenAt: number;
  windowKey: string;
  clientVersion?: string;
  status?: string;
  userAgent?: string;
}

export interface BridgeServerStatus {
  service: string;
  protocolVersion: string;
  serverStartedAt: number;
  serverPort: number;
  activeWindowKey: string | null;
  serverWindowKey?: string;
  isCompatible?: boolean;
  status?: string;
  bindRejected?: boolean;
  rejectReason?: string;
  pendingCommandsCount: number;
  connectedClients: number;
  lastHeartbeatAt?: number;
  watchdogEnabled?: boolean;
  cancelledCommandIds?: string[];
  cancelledCommands?: string[];
}

export interface WatchdogStatus {
  enabled: boolean;
  intervalMs: number;
  staleThresholdMs: number;
  lastCheckAt: number;
  evictedCount: number;
  activeClientsCount: number;
  lastEvictedWindowKey?: string;
  logs: string[];
}

export interface PortRegistryEntry {
  port: number;
  pid: number;
  windowKey: string;
  startedAt: number;
  updatedAt: number;
}

export interface PortRegistryData {
  version: number;
  ports: Record<string, PortRegistryEntry>;
}

export interface BridgeServerOptions {
  portStart?: number;
  portEnd?: number;
  host?: string;
  workbenchDir?: string;
  portsRegistryPath?: string;
  windowKey?: string;
  defaultTimeoutMs?: number;
  staleClientMs?: number;
  watchdogIntervalMs?: number;
  logger?: DebugLogger;
}

interface PendingDeferredCommand {
  command: BridgeCommand;
  startTime: number;
  resolve: (result: CommandAckResult) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  fetched?: boolean;
  fetchedAt?: number;
}

/**
 * Local HTTP/IPC Bridge Server for coordinating automation between
 * VS Code Extension Host and Electron Renderer DOM Bridge.
 */
export class BridgeServer {
  private server: http.Server | null = null;
  private port: number | null = null;
  private portStart: number;
  private portEnd: number;
  private host: string;
  private windowKey: string;
  private activeWindowKey: string | null = null;
  private defaultTimeoutMs: number;
  private staleClientMs: number;
  private serverStartedAt: number = 0;
  private lastHeartbeatAt: number = 0;
  private customWorkbenchDir?: string;
  private customPortsRegistryPath?: string;
  private logger: DebugLogger;

  private watchdogIntervalMs: number;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastWatchdogCheckAt: number = 0;
  private totalEvictedClients: number = 0;
  private lastEvictedWindowKey: string | undefined = undefined;
  private watchdogLogs: string[] = [];

  private pendingCommands: Map<string, PendingDeferredCommand> = new Map();
  private queuedCommands: BridgeCommand[] = [];
  private clients: Map<string, BridgeClientTelemetry> = new Map();
  private cancelledCommandIds: Map<string, number> = new Map();

  private pruneCancelledCommands(): void {
    const now = Date.now();
    const ttlMs = 60000;
    for (const [id, timestamp] of this.cancelledCommandIds.entries()) {
      if (now - timestamp > ttlMs) {
        this.cancelledCommandIds.delete(id);
      }
    }
  }

  public isCommandCancelled(commandId: string): boolean {
    this.pruneCancelledCommands();
    return this.cancelledCommandIds.has(commandId);
  }

  public markCommandCancelled(commandId: string): void {
    this.cancelledCommandIds.set(commandId, Date.now());
    this.pruneCancelledCommands();
  }

  public getCancelledCommandIds(): string[] {
    this.pruneCancelledCommands();
    return Array.from(this.cancelledCommandIds.keys());
  }

  constructor(options: BridgeServerOptions = {}) {
    this.portStart = options.portStart || DEFAULT_PORT_START;
    this.portEnd = options.portEnd || DEFAULT_PORT_END;
    this.host = options.host || '127.0.0.1';
    this.windowKey = options.windowKey || `win_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.activeWindowKey = options.windowKey || null;
    this.defaultTimeoutMs = options.defaultTimeoutMs || DEFAULT_COMMAND_TIMEOUT_MS;
    this.staleClientMs = options.staleClientMs || DEFAULT_STALE_CLIENT_MS;
    this.watchdogIntervalMs = options.watchdogIntervalMs || 5000;
    this.customWorkbenchDir = options.workbenchDir;
    this.customPortsRegistryPath = options.portsRegistryPath;
    this.logger = options.logger || debugLogger;
    try {
      this.logger.registerBridgeServer(this);
    } catch {
      // Non-fatal
    }
  }

  public getLogger(): DebugLogger {
    return this.logger;
  }

  public setLogger(logger: DebugLogger): void {
    this.logger = logger;
    try {
      this.logger.registerBridgeServer(this);
    } catch {
      // Non-fatal
    }
  }

  /**
   * Starts the HTTP bridge server, binding to an available port in the configured range.
   */
  public async start(): Promise<number> {
    if (this.server && this.port) {
      return this.port;
    }

    this.logger.info('SERVER', `Starting BridgeServer in port range ${this.portStart}-${this.portEnd}...`, {
      portStart: this.portStart,
      portEnd: this.portEnd,
      host: this.host,
      windowKey: this.windowKey
    });

    for (let currentPort = this.portStart; currentPort <= this.portEnd; currentPort++) {
      try {
        const port = await this.tryListen(currentPort);
        this.port = port;
        this.serverStartedAt = Date.now();
        this.registerPortInRegistry();
        this.startWatchdog();
        this.logger.info('SERVER', `Bound to port ${this.port} (PID: ${process.pid})`, {
          port: this.port,
          pid: process.pid,
          windowKey: this.windowKey
        });
        return port;
      } catch (err: any) {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          this.logger.debug('SERVER', `Port ${currentPort} in use or inaccessible (${err.code}), retrying next port...`);
          continue;
        }
        this.logger.error('SERVER', `Failed binding to port ${currentPort}: ${err.message}`, undefined, err);
        throw err;
      }
    }

    const err = new Error(`No available port found in range ${this.portStart}-${this.portEnd}`);
    this.logger.error('SERVER', err.message);
    throw err;
  }

  private tryListen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this.handleHttpRequest(req, res));

      srv.once('error', (err: any) => {
        srv.close();
        reject(err);
      });

      srv.listen(port, this.host, () => {
        srv.removeAllListeners('error');
        srv.on('error', (err: any) => {
          this.logger.error('SERVER', `Server socket error on port ${port}: ${err.message}`, undefined, err);
        });
        this.server = srv;
        resolve(port);
      });
    });
  }

  /**
   * Stops the server and clears all pending command promises and registry records.
   */
  public async stop(): Promise<void> {
    const stoppingPort = this.port;
    if (stoppingPort) {
      this.logger.info('SERVER', `BridgeServer stopping on port ${stoppingPort}...`);
    }

    // Stop watchdog timer
    this.stopWatchdog();

    // Clear all pending commands
    for (const [cmdId, deferred] of this.pendingCommands.entries()) {
      clearTimeout(deferred.timer);
      deferred.reject(new Error(`BridgeServer stopped while command ${cmdId} was in flight.`));
    }
    this.pendingCommands.clear();
    this.queuedCommands = [];
    this.cancelledCommandIds.clear();

    // Remove from registry
    this.removePortFromRegistry();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          this.server = null;
          this.port = null;
          resolve();
        });
      });
    }

    this.logger.info('SERVER', `BridgeServer stopped cleanly`);
  }

  public startWatchdog(intervalMs?: number): void {
    if (intervalMs) {
      this.watchdogIntervalMs = intervalMs;
    }
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      this.runWatchdogCheck();
    }, this.watchdogIntervalMs);
    if (this.watchdogTimer.unref) {
      this.watchdogTimer.unref();
    }
  }

  public stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  public runWatchdogCheck(): number {
    const now = Date.now();
    this.lastWatchdogCheckAt = now;
    let evictedThisCycle = 0;

    for (const [key, client] of this.clients.entries()) {
      if (now - client.lastSeenAt > this.staleClientMs) {
        this.clients.delete(key);
        evictedThisCycle++;
        this.totalEvictedClients++;
        this.lastEvictedWindowKey = key;
        const transitionMsg = `Evicted client ${key} after ${now - client.lastSeenAt}ms inactivity (> ${this.staleClientMs}ms)`;
        this.logger.warn('SERVER', transitionMsg, {
          windowKey: key,
          inactiveMs: now - client.lastSeenAt,
          staleThresholdMs: this.staleClientMs
        });
        this.watchdogLogs.push(`[Auto-Plan Watchdog] ${transitionMsg}`);
        if (this.watchdogLogs.length > 50) {
          this.watchdogLogs.shift();
        }

        if (this.activeWindowKey === key) {
          this.activeWindowKey = null;
          this.logger.info('SERVER', `Active window key reset due to client eviction.`);
        }
      }
    }

    return evictedThisCycle;
  }

  public getWatchdogStatus(): WatchdogStatus {
    return {
      enabled: this.watchdogTimer !== null,
      intervalMs: this.watchdogIntervalMs,
      staleThresholdMs: this.staleClientMs,
      lastCheckAt: this.lastWatchdogCheckAt,
      evictedCount: this.totalEvictedClients,
      activeClientsCount: this.clients.size,
      lastEvictedWindowKey: this.lastEvictedWindowKey,
      logs: [...this.watchdogLogs]
    };
  }

  public isListening(): boolean {
    return this.server !== null && this.port !== null;
  }

  public getPort(): number | null {
    return this.port;
  }

  public getWindowKey(): string {
    return this.windowKey;
  }

  public setWindowKey(key: string): void {
    this.windowKey = key;
    this.activeWindowKey = key;
    this.registerPortInRegistry();
  }

  public getActiveWindowKey(): string | null {
    return this.activeWindowKey;
  }

  public getStatus(): BridgeServerStatus {
    this.pruneCancelledCommands();
    const cancelledList = Array.from(this.cancelledCommandIds.keys());
    return {
      service: BRIDGE_SERVICE_NAME,
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      serverStartedAt: this.serverStartedAt,
      serverPort: this.port || 0,
      activeWindowKey: this.activeWindowKey || null,
      serverWindowKey: this.windowKey,
      pendingCommandsCount: this.queuedCommands.length + this.pendingCommands.size,
      connectedClients: this.getActiveClients().length,
      lastHeartbeatAt: this.lastHeartbeatAt || undefined,
      watchdogEnabled: this.watchdogTimer !== null,
      cancelledCommandIds: cancelledList,
      cancelledCommands: cancelledList
    };
  }

  public getConnectedClients(): BridgeClientTelemetry[] {
    return this.getActiveClients();
  }

  /**
   * Fast discovery probe: waits up to timeoutMs for any active client to register or respond.
   */
  public async probeActiveClients(timeoutMs: number = 200): Promise<BridgeClientTelemetry[]> {
    const existing = this.getActiveClients();
    if (existing.length > 0) {
      return existing;
    }

    const start = Date.now();
    const pollInterval = 25;

    while (Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      const active = this.getActiveClients();
      if (active.length > 0) {
        this.logger.info('SERVER', `Active client discovered during probe (${Date.now() - start}ms)`, {
          clientsCount: active.length,
          clients: active
        });
        return active;
      }
    }

    return this.getActiveClients();
  }

  private getActiveClients(): BridgeClientTelemetry[] {
    const now = Date.now();
    const active: BridgeClientTelemetry[] = [];
    for (const [key, client] of this.clients.entries()) {
      if (now - client.lastSeenAt <= this.staleClientMs) {
        active.push(client);
      } else {
        this.clients.delete(key);
      }
    }
    return active;
  }

  /**
   * Dispatches a prompt or action command to the DOM client and awaits acknowledgment.
   */
  public dispatchPromptCommand(text: string, options: CommandOptions = {}): Promise<CommandAckResult> {
    const commandId = `cmd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;
    const targetWindowKey = options.windowKey || this.activeWindowKey || this.windowKey;

    const command: BridgeCommand = {
      id: commandId,
      type: options.type || 'sendPrompt',
      text,
      options: options.extra || {},
      windowKey: targetWindowKey,
      createdAt: Date.now(),
      timeoutMs
    };

    this.logger.info('SERVER', `Queued command ${commandId} (type: ${command.type}, chars: ${text.length}, targetWindow: ${targetWindowKey}, timeout: ${timeoutMs}ms)`, {
      commandId,
      type: command.type,
      charCount: text.length,
      targetWindow: targetWindowKey,
      timeoutMs
    });

    return new Promise<CommandAckResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const deferred = this.pendingCommands.get(commandId);
        const clientFetched = Boolean(deferred?.fetched);
        this.pendingCommands.delete(commandId);
        // Also remove from queuedCommands if not yet fetched
        this.queuedCommands = this.queuedCommands.filter(c => c.id !== commandId);

        // Mark command as cancelled for coordination with DOM bridge client
        this.cancelledCommandIds.set(commandId, Date.now());
        this.pruneCancelledCommands();

        this.logger.error('SERVER', `Command dispatch timed out after ${timeoutMs}ms (commandId: ${commandId}, clientFetched: ${clientFetched})`, {
          commandId,
          timeoutMs,
          clientFetched,
          targetWindow: targetWindowKey
        });

        reject(new Error(`Command dispatch timed out after ${timeoutMs}ms (commandId: ${commandId})`));
      }, timeoutMs);

      this.pendingCommands.set(commandId, {
        command,
        startTime: Date.now(),
        resolve,
        reject,
        timer,
        fetched: false
      });

      this.queuedCommands.push(command);
    });
  }

  /**
   * Dispatches a new conversation command to the DOM client and awaits acknowledgment.
   */
  public dispatchNewConversationCommand(options: CommandOptions = {}): Promise<CommandAckResult> {
    return this.dispatchPromptCommand('', {
      ...options,
      type: 'openNewConversation'
    });
  }

  /**
   * Handles incoming HTTP requests with CORS, authentication, and endpoint routing.
   */
  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // 1. IP validation (Localhost only)
    const remoteAddr = req.socket.remoteAddress || '';
    const isLocal = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
    if (!isLocal) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied: Loopback connections only' }));
      return;
    }

    // 2. Standard CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Window-Key');
    res.setHeader('Content-Type', 'application/json');

    // 3. Preflight OPTIONS request
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '', 'http://127.0.0.1');
    const pathname = parsedUrl.pathname || '';
    const headerKey = req.headers['x-window-key'];
    const queryKey = parsedUrl.searchParams.get('windowKey');
    const reqWindowKey = (typeof queryKey === 'string' ? queryKey : (typeof headerKey === 'string' ? headerKey : '')).trim();

    // 4. Routing
    if (req.method === 'GET' && pathname === '/autoplan-status') {
      const queryParams: Record<string, string> = Object.fromEntries(parsedUrl.searchParams.entries());
      this.handleGetStatus(reqWindowKey, queryParams, res);
    } else if (req.method === 'POST' && pathname === '/autoplan-log') {
      this.handlePostLog(req, res, reqWindowKey);
    } else if (req.method === 'POST' && (pathname === '/autoplan-ack' || pathname === '/ack')) {
      this.handlePostAck(req, res);
    } else if (req.method === 'POST' && pathname === '/autoplan-command') {
      this.handlePostCommand(req, res);
    } else if (req.method === 'GET' && pathname === '/autoplan-heartbeat') {
      this.handleGetHeartbeat(reqWindowKey, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', pathname }));
    }
  }

  public handleStatus(reqWindowKey: string, query: Record<string, any>, res: http.ServerResponse): void {
    return this.handleGetStatus(reqWindowKey, query, res);
  }

  private handleGetStatus(reqWindowKey: string, query: Record<string, any>, res: http.ServerResponse): void {
    const isProbe = query.probe === '1' || query.probe === 'true';

    if (isProbe) {
      this.logger.debug('SERVER', `Client discovery probe received from window: ${reqWindowKey || 'unknown'}`, {
        windowKey: reqWindowKey,
        query
      });

      // Probe request: if reqWindowKey conflicts with an already active, non-stale window, return 409
      if (reqWindowKey && this.activeWindowKey && reqWindowKey !== this.activeWindowKey && reqWindowKey !== this.windowKey) {
        const activeClient = this.clients.get(this.activeWindowKey);
        const isStale = activeClient
          ? (Date.now() - activeClient.lastSeenAt > this.staleClientMs)
          : (Date.now() - this.serverStartedAt > this.staleClientMs);

        if (!isStale) {
          this.logger.warn('SERVER', `Probe rejected: Port is occupied by active window "${this.activeWindowKey}", prober is "${reqWindowKey}"`);
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            service: BRIDGE_SERVICE_NAME,
            status: 'occupied',
            serverWindowKey: this.windowKey,
            activeWindowKey: this.activeWindowKey,
            isCompatible: false,
            bindRejected: true,
            rejectReason: 'owner-mismatch'
          }));
          return;
        }
      }
    }

    if (reqWindowKey) {
      this.clients.set(reqWindowKey, {
        windowKey: reqWindowKey,
        lastSeenAt: Date.now(),
        clientVersion: typeof query.clientVersion === 'string' ? query.clientVersion : undefined,
        status: 'active'
      });

      if (!isProbe) {
        if (!this.activeWindowKey) {
          this.activeWindowKey = reqWindowKey;
          this.logger.info('SERVER', `Active window key set to "${reqWindowKey}"`);
        } else if (this.activeWindowKey !== reqWindowKey) {
          const activeClient = this.clients.get(this.activeWindowKey);
          const isStale = !activeClient || (Date.now() - activeClient.lastSeenAt > this.staleClientMs);
          if (isStale) {
            const prev = this.activeWindowKey;
            this.activeWindowKey = reqWindowKey;
            this.logger.info('SERVER', `Active window key switched from stale "${prev}" to "${reqWindowKey}"`);
          }
        }
      }
    }

    const isCompatible = !this.activeWindowKey || this.activeWindowKey === reqWindowKey || this.windowKey === reqWindowKey;
    const windowMismatch = reqWindowKey && this.activeWindowKey && reqWindowKey !== this.activeWindowKey;
    if (windowMismatch) {
      this.logger.warn('SERVER', `Window mismatch rejected for window "${reqWindowKey}": active owner is "${this.activeWindowKey}"`);
    }

    // Filter pending commands for this window
    let commandsForClient: BridgeCommand[] = [];
    if (!windowMismatch) {
      if (reqWindowKey) {
        commandsForClient = this.queuedCommands.filter(c => !c.windowKey || c.windowKey === reqWindowKey);
        this.queuedCommands = this.queuedCommands.filter(c => c.windowKey && c.windowKey !== reqWindowKey);
      } else {
        commandsForClient = [...this.queuedCommands];
        this.queuedCommands = [];
      }
    }

    for (const cmd of commandsForClient) {
      const pending = this.pendingCommands.get(cmd.id);
      if (pending) {
        pending.fetched = true;
        pending.fetchedAt = Date.now();
      }
      this.logger.debug('SERVER', `Command ${cmd.id} (${cmd.type}) retrieved by client ${reqWindowKey || 'unknown'}`);
    }

    this.pruneCancelledCommands();
    const cancelledList = Array.from(this.cancelledCommandIds.keys());

    const responseData = {
      ...this.getStatus(),
      serverWindowKey: this.windowKey,
      activeWindowKey: this.activeWindowKey || null,
      isCompatible: Boolean(isCompatible),
      bindRejected: Boolean(windowMismatch),
      rejectReason: windowMismatch ? 'owner-mismatch' : undefined,
      pendingCommands: commandsForClient,
      cancelledCommandIds: cancelledList,
      cancelledCommands: cancelledList
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responseData));
  }

  private handlePostLog(req: http.IncomingMessage, res: http.ServerResponse, reqWindowKey?: string): void {
    this.readJsonBody<any>(req, (err, payload) => {
      if (err || !payload || typeof payload !== 'object') {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
        return;
      }

      const topWindowKey = (typeof payload.windowKey === 'string' ? payload.windowKey : reqWindowKey)?.trim() || undefined;
      let acceptedCount = 0;

      if (Array.isArray(payload.logs)) {
        for (const raw of payload.logs) {
          if (this.ingestSingleLogRecord(raw, topWindowKey)) {
            acceptedCount++;
          }
        }
      } else if (Array.isArray(payload)) {
        for (const raw of payload) {
          if (this.ingestSingleLogRecord(raw, topWindowKey)) {
            acceptedCount++;
          }
        }
      } else if (payload.message !== undefined || payload.level !== undefined || payload.error !== undefined) {
        if (this.ingestSingleLogRecord(payload, topWindowKey)) {
          acceptedCount++;
        }
      } else {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Malformed log payload structure' }));
        return;
      }

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, accepted: acceptedCount }));
    });
  }

  private ingestSingleLogRecord(raw: any, defaultWindowKey?: string): boolean {
    if (!raw || typeof raw !== 'object') {
      return false;
    }
    const rawLevel = typeof raw.level === 'string' ? raw.level.toUpperCase() : 'INFO';
    const level: LogLevel = (['DEBUG', 'INFO', 'WARN', 'ERROR'].includes(rawLevel) ? rawLevel : 'INFO') as LogLevel;

    const rawComponent = typeof raw.component === 'string' ? raw.component.toUpperCase() : 'CLIENT';
    const validComponents = ['SERVER', 'CLIENT', 'DISPATCHER', 'INJECTOR', 'DOM', 'ORCHESTRATOR', 'SETTINGS'];
    const component: LogComponent = (validComponents.includes(rawComponent) ? rawComponent : 'CLIENT') as LogComponent;

    const message = raw.message !== undefined && raw.message !== null ? String(raw.message) : '';
    if (!message && !raw.details && !raw.error) {
      return false;
    }

    const windowKey = raw.windowKey || defaultWindowKey;
    let details = raw.details;
    if (windowKey) {
      if (typeof details === 'object' && details !== null) {
        details = { ...details, windowKey };
      } else if (details !== undefined) {
        details = { value: details, windowKey };
      } else {
        details = { windowKey };
      }
    }

    this.logger.log(level, component, message || `[Client Event]`, details, raw.error);
    return true;
  }

  private handlePostAck(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.readJsonBody<BridgeCommandAck>(req, (err, ack) => {
      if (err || !ack || !ack.commandId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid acknowledgment payload' }));
        return;
      }

      if (ack.windowKey) {
        this.clients.set(ack.windowKey, {
          windowKey: ack.windowKey,
          lastSeenAt: Date.now(),
          status: ack.status
        });
      }

      if (this.isCommandCancelled(ack.commandId)) {
        this.logger.warn('SERVER', `ACK received for cancelled/timed-out command ${ack.commandId} (status=${ack.status}); discarding without error`, {
          commandId: ack.commandId,
          status: ack.status,
          error: ack.error
        });
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, commandId: ack.commandId, ignored: true, reason: 'command-cancelled' }));
        return;
      }

      const deferred = this.pendingCommands.get(ack.commandId);
      if (deferred) {
        const durationMs = Date.now() - deferred.startTime;

        if (ack.status === 'aborted' || ack.status === 'cancelled') {
          this.logger.warn('SERVER', `Command ${ack.commandId} execution aborted by client: ${ack.error || 'aborted'}`, {
            commandId: ack.commandId,
            status: ack.status,
            durationMs,
            metadata: ack.metadata
          });
          clearTimeout(deferred.timer);
          this.pendingCommands.delete(ack.commandId);
          this.cancelledCommandIds.set(ack.commandId, Date.now());
          const abortErr: any = new Error(ack.error || `Command ${ack.commandId} aborted by client`);
          abortErr.code = 'COMMAND_ABORTED_BY_TIMEOUT';
          abortErr.aborted = true;
          if (ack.metadata) abortErr.metadata = ack.metadata;
          deferred.reject(abortErr);
        } else if (ack.status === 'error' || ack.status === 'failed') {
          this.logger.error('SERVER', `Command ${ack.commandId} execution failed in DOM client: ${ack.error || 'unknown error'}`, {
            commandId: ack.commandId,
            status: ack.status,
            durationMs,
            metadata: ack.metadata
          }, ack.error);
          clearTimeout(deferred.timer);
          this.pendingCommands.delete(ack.commandId);
          const errObj: any = new Error(ack.error || 'DOM Bridge reported command error');
          errObj.status = ack.status;
          if (ack.metadata) {
            errObj.metadata = ack.metadata;
            if (ack.metadata.code) {
              errObj.code = ack.metadata.code;
            }
            if (ack.metadata.rejectionReason) {
              errObj.rejectionReason = ack.metadata.rejectionReason;
            }
            if (ack.metadata.domSnapshot) {
              errObj.domSnapshot = ack.metadata.domSnapshot;
            }
            if (ack.metadata.steps) {
              errObj.steps = ack.metadata.steps;
            }
            if (ack.metadata.diagnostics) {
              errObj.diagnostics = ack.metadata.diagnostics;
            }
          }
          deferred.reject(errObj);
        } else if (ack.status === 'submitClicked' || ack.status === 'completed' || ack.status === 'promptInjected') {
          this.logger.info('SERVER', `Command ${ack.commandId} ACK received: status=${ack.status} (${durationMs}ms)`, {
            commandId: ack.commandId,
            status: ack.status,
            durationMs,
            metadata: ack.metadata
          });
          clearTimeout(deferred.timer);
          this.pendingCommands.delete(ack.commandId);
          deferred.resolve({
            success: true,
            commandId: ack.commandId,
            status: ack.status,
            durationMs,
            metadata: ack.metadata
          });
        }
      }

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, commandId: ack.commandId }));
    });
  }

  private handlePostCommand(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.readJsonBody<{ type?: string; text?: string; windowKey?: string; options?: any; timeoutMs?: number }>(req, (err, body) => {
      if (err || !body || !body.text) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Command payload missing required "text" field' }));
        return;
      }

      this.dispatchPromptCommand(body.text, {
        type: body.type,
        windowKey: body.windowKey,
        extra: body.options,
        timeoutMs: body.timeoutMs
      }).then((ackResult) => {
        if (!res.writableEnded) {
          res.writeHead(200);
          res.end(JSON.stringify(ackResult));
        }
      }).catch((dispatchErr: any) => {
        if (!res.writableEnded) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: dispatchErr.message || String(dispatchErr) }));
        }
      });
    });
  }

  private handleGetHeartbeat(reqWindowKey: string, res: http.ServerResponse): void {
    this.lastHeartbeatAt = Date.now();
    this.logger.debug('SERVER', `Heartbeat ping received from window: ${reqWindowKey || 'unknown'}`);

    if (reqWindowKey && this.activeWindowKey && reqWindowKey !== this.activeWindowKey && reqWindowKey !== this.windowKey) {
      const activeClient = this.clients.get(this.activeWindowKey);
      const isStale = activeClient
        ? (Date.now() - activeClient.lastSeenAt > this.staleClientMs)
        : (Date.now() - this.serverStartedAt > this.staleClientMs);

      if (!isStale) {
        this.logger.warn('SERVER', `Heartbeat rejected: Port is occupied by active window "${this.activeWindowKey}", prober is "${reqWindowKey}"`);
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Window mismatch: server belongs to another active window',
          serverWindowKey: this.windowKey,
          activeWindowKey: this.activeWindowKey,
          isCompatible: false
        }));
        return;
      }
    }

    if (reqWindowKey) {
      this.clients.set(reqWindowKey, {
        windowKey: reqWindowKey,
        lastSeenAt: this.lastHeartbeatAt,
        status: 'alive'
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: BRIDGE_SERVICE_NAME,
      serverPort: this.port || 0,
      serverWindowKey: this.windowKey,
      activeWindowKey: this.activeWindowKey || null,
      uptimeMs: this.serverStartedAt > 0 ? Date.now() - this.serverStartedAt : 0,
      timestamp: this.lastHeartbeatAt
    }));
  }

  private readJsonBody<T>(req: http.IncomingMessage, callback: (err: Error | null, data?: T) => void): void {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        // Prevent payload flood
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        callback(null, parsed as T);
      } catch (err: any) {
        callback(err);
      }
    });
    req.on('error', (err) => {
      callback(err);
    });
  }

  /**
   * Resolves the target path for `ag-autoplan-ports.json`.
   */
  public getPortRegistryPath(): string {
    if (this.customPortsRegistryPath) {
      return this.customPortsRegistryPath;
    }

    if (this.customWorkbenchDir && fs.existsSync(this.customWorkbenchDir)) {
      return path.join(this.customWorkbenchDir, PORT_REGISTRY_FILENAME);
    }

    const wbPath = getWorkbenchPath();
    if (wbPath && fs.existsSync(wbPath)) {
      return path.join(path.dirname(wbPath), PORT_REGISTRY_FILENAME);
    }

    return path.join(os.tmpdir(), PORT_REGISTRY_FILENAME);
  }

  /**
   * Registers or updates this server instance in `ag-autoplan-ports.json`.
   */
  private registerPortInRegistry(): void {
    if (!this.port) return;
    const registryPath = this.getPortRegistryPath();

    try {
      let data: PortRegistryData = { version: 1, ports: {} };
      if (fs.existsSync(registryPath)) {
        try {
          const raw = fs.readFileSync(registryPath, 'utf8');
          data = JSON.parse(raw);
          if (!data.ports || typeof data.ports !== 'object') {
            data = { version: 1, ports: {} };
          }
        } catch {
          data = { version: 1, ports: {} };
        }
      }

      // Evict dead PIDs or stale records
      const now = Date.now();
      for (const [key, entry] of Object.entries(data.ports)) {
        if (now - entry.updatedAt > 3600000) {
          delete data.ports[key];
        }
      }

      const entry: PortRegistryEntry = {
        port: this.port,
        pid: process.pid,
        windowKey: this.windowKey,
        startedAt: this.serverStartedAt || Date.now(),
        updatedAt: Date.now()
      };

      data.ports[String(this.port)] = entry;

      const dir = path.dirname(registryPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(registryPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      // Non-fatal logging
      console.warn('[Auto-Plan BridgeServer] Failed to write port registry:', err);
    }
  }

  /**
   * Removes this server instance from `ag-autoplan-ports.json`.
   */
  private removePortFromRegistry(): void {
    if (!this.port) return;
    const registryPath = this.getPortRegistryPath();
    try {
      if (fs.existsSync(registryPath)) {
        const raw = fs.readFileSync(registryPath, 'utf8');
        const data: PortRegistryData = JSON.parse(raw);
        if (data.ports && data.ports[String(this.port)]) {
          delete data.ports[String(this.port)];
          fs.writeFileSync(registryPath, JSON.stringify(data, null, 2), 'utf8');
        }
      }
    } catch {
      // Ignore cleanup error
    }
  }

  /**
   * Reads and parses `ag-autoplan-ports.json` from a file path.
   */
  public static readPortRegistry(registryPath?: string): PortRegistryData | null {
    const targetPath = registryPath || path.join(os.tmpdir(), PORT_REGISTRY_FILENAME);
    if (!fs.existsSync(targetPath)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(targetPath, 'utf8');
      return JSON.parse(raw) as PortRegistryData;
    } catch {
      return null;
    }
  }
}

export const bridgeServer = new BridgeServer();

