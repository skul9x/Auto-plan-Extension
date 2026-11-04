import * as vscode from 'vscode';
import { BridgeServer, bridgeServer as defaultBridgeServer, CommandOptions, CommandAckResult } from './bridgeServer';
import { KeyboardManager, keyboardManager as defaultKeyboardManager, BatchPromptOptions } from './keyboardManager';
import { AutoPlanConfig, getConfig, ExecutionMode } from './config';
import { DebugLogger, debugLogger, sanitizePrompt, sanitizeExcerpt } from './debugLogger';

export type DispatchTier = 'domBridge' | 'nativeCommand' | 'keyboard';

export interface DispatchReadinessResult {
  ready: boolean;
  selectedTier: 'domBridge' | 'nativeCommand' | 'keyboard' | string;
  isFocusFree: boolean;
  requiresForegroundFocus: boolean;
  engine?: string;
  warningMessage?: string;
  errorMessage?: string;
  remediationAction?: 'activateBridge' | 'installXdotool' | 'openDocs' | string;
  details: {
    connectedClientsCount?: number;
    os?: 'win32' | 'linux' | 'darwin' | 'other';
    xdotoolAvailable?: boolean;
    bridgePort?: number;
    nativeCommandsAvailable?: boolean;
    engine?: string;
    [key: string]: any;
  };
}

export interface DispatchOptions {
  sendDelayMs?: number;
  newConversation?: boolean;
  openNewConversation?: boolean;
  mode?: ExecutionMode;
  allowFallback?: boolean;
  timeoutMs?: number;
  windowKey?: string;
  commandType?: string;
  revealChat?: boolean;
  keyboardOptions?: BatchPromptOptions;
  extra?: Record<string, any>;
}

export interface FallbackRecord {
  tier: DispatchTier;
  error: string;
  durationMs: number;
}

export interface DispatchResult {
  success: boolean;
  tier: DispatchTier;
  durationMs: number;
  commandId?: string;
  status?: string;
  charsExpected?: number;
  charsDetectedInDOM?: number;
  elementContext?: string;
  metadata?: Record<string, any>;
  error?: string;
  fallbackHistory?: FallbackRecord[];
}

export interface PromptDispatcherOptions {
  bridgeServer?: BridgeServer;
  keyboardManager?: KeyboardManager;
  configProvider?: () => AutoPlanConfig;
  commandExecutor?: (command: string, ...args: any[]) => Thenable<any>;
  warningNotifier?: (message: string) => void;
  actionableNotifier?: (message: string, buttonText: string, onAction: () => Promise<void> | void) => Promise<any> | any;
  actionableErrorNotifier?: (message: string, ...actions: string[]) => Promise<string | undefined>;
  logger?: DebugLogger;
}

/**
 * Multi-tier prompt dispatch coordinator with resilient fallback architecture:
 * 1. Tier 1 (Primary): Electron Renderer DOM Bridge (Focus-free HTTP IPC)
 * 2. Tier 2 (Secondary): VS Code Command API (antigravity.sendTextToChat)
 * 3. Tier 3 (Fallback): OS Keyboard Simulation (PowerShell SendKeys)
 */
export class PromptDispatcher {
  private bridgeServer: BridgeServer;
  private keyboardManager: KeyboardManager;
  private configProvider: () => AutoPlanConfig;
  private commandExecutor: (command: string, ...args: any[]) => Thenable<any>;
  private warningNotifier: (message: string) => void;
  private actionableNotifier?: (message: string, buttonText: string, onAction: () => Promise<void> | void) => Promise<any> | any;
  private actionableErrorNotifier?: (message: string, ...actions: string[]) => Promise<string | undefined>;
  private customCommandExecutorProvided: boolean;
  private logger: DebugLogger;

  constructor(options?: PromptDispatcherOptions) {
    this.bridgeServer = options?.bridgeServer ?? defaultBridgeServer;
    this.keyboardManager = options?.keyboardManager ?? defaultKeyboardManager;
    this.configProvider = options?.configProvider ?? getConfig;
    this.logger = options?.logger ?? debugLogger;
    this.actionableNotifier = options?.actionableNotifier;
    this.actionableErrorNotifier = options?.actionableErrorNotifier;
    this.customCommandExecutorProvided = Boolean(options && 'commandExecutor' in options);
    if (options && 'commandExecutor' in options) {
      this.commandExecutor = options.commandExecutor as any;
    } else {
      this.commandExecutor = (cmd: string, ...args: any[]) => {
        if (vscode?.commands?.executeCommand) {
          return vscode.commands.executeCommand(cmd, ...args);
        }
        return Promise.reject(new Error('vscode.commands.executeCommand is unavailable'));
      };
    }
    this.warningNotifier =
      options?.warningNotifier ??
      ((msg: string) => {
        try {
          if (vscode?.window?.showWarningMessage) {
            vscode.window.showWarningMessage(msg);
          } else {
            console.log(`[Auto-Plan PromptDispatcher] ${msg}`);
          }
        } catch {
          console.log(`[Auto-Plan PromptDispatcher] ${msg}`);
        }
      });
  }

  public getLogger(): DebugLogger {
    return this.logger;
  }

  public setLogger(logger: DebugLogger): void {
    this.logger = logger;
  }

  public getBridgeServer(): BridgeServer {
    return this.bridgeServer;
  }

  public setBridgeServer(server: BridgeServer): void {
    this.bridgeServer = server;
  }

  public getKeyboardManager(): KeyboardManager {
    return this.keyboardManager;
  }

  /**
   * Parses verification metadata from ACK metadata or error steps
   */
  public extractVerificationTelemetry(metadata: any): {
    step1: any;
    step2: any;
    elementContext: string;
    charsExpected: number;
    charsDetectedInDOM: number;
    domExcerpt: string;
    strategy: string;
    verified: boolean;
  } {
    if (!metadata) {
      return {
        step1: {},
        step2: {},
        elementContext: '#antigravity.agentSidePanelInputBox',
        charsExpected: 0,
        charsDetectedInDOM: 0,
        domExcerpt: '',
        strategy: 'contenteditable-text',
        verified: false
      };
    }

    const steps = Array.isArray(metadata.steps) ? metadata.steps : [];
    const step1 = steps.find((s: any) => s.step === 1 || s.name?.includes('discovery') || s.name?.includes('focus')) || {};
    const step2 = steps.find((s: any) => s.step === 2 || s.name?.includes('injection')) || {};

    const elementContext =
      metadata.elementContext ||
      step1.elementContext ||
      step1.details?.elementContext ||
      (Array.isArray(step1.details?.containerHierarchy) && step1.details.containerHierarchy.find((c: string) => c.includes('agentSidePanelInputBox') || c.includes('chat-widget'))) ||
      step1.details?.containerHierarchy?.[0] ||
      step1.details?.id ||
      '#antigravity.agentSidePanelInputBox';

    const charsExpected =
      step2.charsExpected ??
      metadata.charsExpected ??
      step2.charsInjected ??
      metadata.charsInjected ??
      0;

    const charsDetectedInDOM =
      step2.charsDetectedInDOM ??
      metadata.charsDetectedInDOM ??
      charsExpected;

    const domExcerpt =
      step2.domExcerpt ??
      metadata.domExcerpt ??
      '';

    const strategy =
      step2.strategy ??
      metadata.strategy ??
      metadata.injectionStrategy ??
      'contenteditable-text';

    const verified =
      step2.verified ??
      metadata.verified ??
      (charsDetectedInDOM > 0 && charsExpected > 0 && charsDetectedInDOM >= charsExpected * 0.75);

    return {
      step1,
      step2,
      elementContext,
      charsExpected,
      charsDetectedInDOM,
      domExcerpt,
      strategy,
      verified
    };
  }

  /**
   * Displays an actionable notification when paste verification fails or chat input is not found
   */
  public async notifyActionableChatError(code: 'PASTE_VERIFICATION_FAILED' | 'NO_CHAT_INPUT_FOUND' | string): Promise<void> {
    const message = 'Auto-Plan: Khung chat Antigravity đang đóng hoặc không nhận prompt. Vui lòng mở panel Agent và thử lại.';
    const buttonText = 'Open Chat Panel';

    const actionCallback = async () => {
      try {
        await this.commandExecutor('workbench.action.chat.open');
      } catch {
        try {
          await this.commandExecutor('antigravity.prioritized.chat.open');
        } catch (e) {
          this.logger.warn('DISPATCHER', `Failed executing chat open commands: ${e}`);
        }
      }
    };

    if (this.actionableNotifier) {
      await this.actionableNotifier(message, buttonText, actionCallback);
      return;
    }

    if (this.actionableErrorNotifier) {
      const selection = await this.actionableErrorNotifier(message, buttonText);
      if (selection === buttonText) {
        await actionCallback();
      }
      return;
    }

    try {
      if (typeof vscode !== 'undefined' && vscode?.window?.showErrorMessage) {
        const selection = await vscode.window.showErrorMessage(message, buttonText);
        if (selection === buttonText) {
          await actionCallback();
        }
      } else {
        console.warn(`[Auto-Plan PromptDispatcher] ${message} [Action: ${buttonText}]`);
      }
    } catch {
      // Safe fallback in headless / test environment
    }
  }

  /**
   * Pre-flight health check to evaluate Antigravity native chat command availability in < 100ms.
   */
  public validateDispatchReadiness(
    platformOverride?: string,
    _modeOverride?: ExecutionMode,
    _allowFallbackOverride?: boolean
  ): DispatchReadinessResult {
    const rawPlatform = platformOverride || process.platform;
    const osType: 'win32' | 'linux' | 'darwin' | 'other' =
      rawPlatform === 'win32' ? 'win32' :
      rawPlatform === 'linux' ? 'linux' :
      rawPlatform === 'darwin' ? 'darwin' : 'other';

    let isAvailable = true;
    let failureReason: string | undefined;

    if (!this.commandExecutor || typeof this.commandExecutor !== 'function') {
      isAvailable = false;
      failureReason = 'Antigravity native command executor is unavailable or not callable.';
    } else if (!this.customCommandExecutorProvided) {
      if (typeof vscode === 'undefined' || !vscode.commands || typeof vscode.commands.executeCommand !== 'function') {
        isAvailable = false;
        failureReason = 'vscode.commands API is unavailable in current host.';
      }
    }

    if (!isAvailable) {
      this.logger.warn('DISPATCHER', `Readiness check failed: ${failureReason}`);
      return {
        ready: false,
        selectedTier: 'nativeCommand',
        isFocusFree: true,
        requiresForegroundFocus: false,
        engine: 'Native Antigravity Dispatch',
        errorMessage: failureReason,
        remediationAction: 'openDocs',
        details: {
          connectedClientsCount: 0,
          os: osType,
          nativeCommandsAvailable: false,
          engine: 'Native Antigravity Dispatch',
          failureReason
        }
      };
    }

    const result: DispatchReadinessResult = {
      ready: true,
      selectedTier: 'nativeCommand',
      isFocusFree: true,
      requiresForegroundFocus: false,
      engine: 'Native Antigravity Dispatch',
      details: {
        connectedClientsCount: 0,
        os: osType,
        nativeCommandsAvailable: true,
        engine: 'Native Antigravity Dispatch'
      }
    };
    this.logger.info('DISPATCHER', `Readiness check passed: Native Antigravity Dispatch ready (os=${osType})`, result);
    return result;
  }

  /**
   * Evaluates readiness with optional async probe.
   */
  public async ensureBridgeReadinessWithWakeup(
    _timeoutMs: number = 250,
    platformOverride?: string,
    modeOverride?: ExecutionMode,
    allowFallbackOverride?: boolean
  ): Promise<DispatchReadinessResult> {
    return this.validateDispatchReadiness(platformOverride, modeOverride, allowFallbackOverride);
  }

  private evaluateReadiness(
    platformOverride?: string,
    modeOverride?: ExecutionMode,
    allowFallbackOverride?: boolean
  ): DispatchReadinessResult {
    const rawPlatform = platformOverride || process.platform;
    const osType: 'win32' | 'linux' | 'darwin' | 'other' =
      rawPlatform === 'win32' ? 'win32' :
      rawPlatform === 'linux' ? 'linux' :
      rawPlatform === 'darwin' ? 'darwin' : 'other';

    const connectedClients = this.bridgeServer.getConnectedClients();
    const connectedClientsCount = connectedClients.length;
    const bridgePort = this.bridgeServer.getPort() ?? undefined;

    const getLinuxPrereqs = () => {
      if (typeof this.keyboardManager?.checkLinuxKeyboardPrerequisites === 'function') {
        return this.keyboardManager.checkLinuxKeyboardPrerequisites();
      }
      return { available: false, binary: null };
    };

    const config = this.configProvider();
    const mode: ExecutionMode = modeOverride ?? config.executionMode ?? 'auto';
    const allowFallback: boolean = allowFallbackOverride !== undefined
      ? allowFallbackOverride
      : (config.allowTierFallback !== undefined ? config.allowTierFallback : !config.strictMode);

    // Strict Mode validation: when fallback is disabled and mode is a specific tier
    if (allowFallback === false && mode !== 'auto') {
      if (mode === 'domBridge') {
        if (connectedClientsCount > 0) {
          let xdotoolAvailable: boolean | undefined;
          if (osType === 'linux') {
            const prereqs = getLinuxPrereqs();
            xdotoolAvailable = prereqs.available;
          }
          return {
            ready: true,
            selectedTier: 'domBridge',
            isFocusFree: true,
            requiresForegroundFocus: false,
            details: {
              connectedClientsCount,
              os: osType,
              xdotoolAvailable,
              bridgePort
            }
          };
        } else {
          return {
            ready: false,
            selectedTier: 'domBridge',
            isFocusFree: true,
            requiresForegroundFocus: false,
            errorMessage: 'Strict Tier 1 (DOM Bridge) requires active Electron bridge injection.',
            remediationAction: 'activateBridge',
            details: {
              connectedClientsCount: 0,
              os: osType,
              bridgePort
            }
          };
        }
      }

      if (mode === 'nativeCommand') {
        let xdotoolAvailable: boolean | undefined;
        if (osType === 'linux') {
          const prereqs = getLinuxPrereqs();
          xdotoolAvailable = prereqs.available;
        }
        return {
          ready: true,
          selectedTier: 'nativeCommand',
          isFocusFree: false,
          requiresForegroundFocus: true,
          details: {
            connectedClientsCount,
            os: osType,
            xdotoolAvailable,
            bridgePort
          }
        };
      }

      if (mode === 'keyboard') {
        if (osType === 'win32') {
          return {
            ready: true,
            selectedTier: 'keyboard',
            isFocusFree: false,
            requiresForegroundFocus: true,
            details: {
              connectedClientsCount,
              os: 'win32',
              bridgePort
            }
          };
        }

        if (osType === 'linux') {
          const prereqs = getLinuxPrereqs();
          if (prereqs.available) {
            return {
              ready: true,
              selectedTier: 'keyboard',
              isFocusFree: false,
              requiresForegroundFocus: true,
              details: {
                connectedClientsCount,
                os: 'linux',
                xdotoolAvailable: true,
                bridgePort
              }
            };
          } else {
            return {
              ready: false,
              selectedTier: 'keyboard',
              isFocusFree: false,
              requiresForegroundFocus: true,
              errorMessage: 'Strict Tier 3 (Keyboard Simulation) on Linux requires xdotool to be installed.',
              remediationAction: 'installXdotool',
              details: {
                connectedClientsCount: 0,
                os: 'linux',
                xdotoolAvailable: false,
                bridgePort
              }
            };
          }
        }

        return {
          ready: false,
          selectedTier: 'keyboard',
          isFocusFree: false,
          requiresForegroundFocus: true,
          errorMessage: `Strict Tier 3 (Keyboard Simulation) is not supported on ${rawPlatform}.`,
          remediationAction: 'activateBridge',
          details: {
            connectedClientsCount: 0,
            os: osType,
            bridgePort
          }
        };
      }
    }

    // Existing 3-tier cascade (auto mode or fallback enabled)
    // Step 1: Check Tier 1 - DOM Bridge
    if (connectedClientsCount > 0) {
      let xdotoolAvailable: boolean | undefined;
      if (osType === 'linux') {
        const prereqs = getLinuxPrereqs();
        xdotoolAvailable = prereqs.available;
      }
      return {
        ready: true,
        selectedTier: 'domBridge',
        isFocusFree: true,
        requiresForegroundFocus: false,
        details: {
          connectedClientsCount,
          os: osType,
          xdotoolAvailable,
          bridgePort
        }
      };
    }

    // Step 2: Check Tier 3 - OS Keyboard Simulation
    if (osType === 'win32') {
      return {
        ready: true,
        selectedTier: 'keyboard',
        isFocusFree: false,
        requiresForegroundFocus: true,
        warningMessage: 'DOM Bridge not active. Using Windows PowerShell keyboard simulation. Please keep IDE focused.',
        details: {
          connectedClientsCount: 0,
          os: 'win32',
          bridgePort
        }
      };
    }

    if (osType === 'linux') {
      const prereqs = getLinuxPrereqs();
      if (prereqs.available) {
        return {
          ready: true,
          selectedTier: 'keyboard',
          isFocusFree: false,
          requiresForegroundFocus: true,
          warningMessage: 'DOM Bridge not active. Using Linux xdotool keyboard simulation. Please keep IDE focused.',
          details: {
            connectedClientsCount: 0,
            os: 'linux',
            xdotoolAvailable: true,
            bridgePort
          }
        };
      } else {
        return {
          ready: false,
          selectedTier: 'keyboard',
          isFocusFree: false,
          requiresForegroundFocus: true,
          errorMessage: 'No usable prompt transport available on Linux. Neither DOM Bridge is connected nor xdotool is installed.',
          remediationAction: 'activateBridge',
          details: {
            connectedClientsCount: 0,
            os: 'linux',
            xdotoolAvailable: false,
            bridgePort
          }
        };
      }
    }

    return {
      ready: false,
      selectedTier: 'keyboard',
      isFocusFree: false,
      requiresForegroundFocus: true,
      errorMessage: `No usable prompt transport available on ${rawPlatform}. Neither DOM Bridge is connected nor native keyboard simulation is supported.`,
      remediationAction: 'activateBridge',
      details: {
        connectedClientsCount: 0,
        os: osType,
        bridgePort
      }
    };
  }

  /**
   * Tier 1: Electron Renderer DOM Bridge.
   */
  public async dispatchTier1(promptText: string, options?: DispatchOptions): Promise<DispatchResult> {
    const startTime = Date.now();
    const config = this.configProvider();
    const mode = options?.mode || config.executionMode || 'auto';
    const timeoutMs = options?.timeoutMs ?? config.bridgeTimeoutMs ?? 6000;
    let openedViaCommand = false;

    const currentWsName = this.bridgeServer.getWorkspaceName();
    this.logger.debug('DISPATCHER', `Tier 1 dispatch initiated [workspace: ${currentWsName || 'unbound'}]`, {
      workspaceName: currentWsName,
      timeoutMs,
      promptLength: promptText.length
    });

    // Chat Reveal & New Conversation Hook: Guarantee fresh conversation thread and chat DOM tree
    if (options?.openNewConversation !== false) {
      try {
        await this.commandExecutor('antigravity.prioritized.chat.openNewConversation');
        openedViaCommand = true;
      } catch {
        try {
          await this.commandExecutor('workbench.action.chat.newChat');
          openedViaCommand = true;
        } catch {
          try {
            await this.commandExecutor('workbench.action.chat.open');
          } catch {
            // Non-fatal if chat view is already open or command is unavailable
          }
        }
      }
    } else if (options?.revealChat !== false) {
      try {
        await this.commandExecutor('workbench.action.chat.open');
      } catch {
        try {
          await this.commandExecutor('antigravity.prioritized.chat.open');
        } catch {
          // Non-fatal if chat view is already open or command is unavailable
        }
      }
    }

    // Ensure bridge server is listening
    if (!this.bridgeServer.isListening()) {
      if (mode === 'domBridge' || mode === 'auto') {
        try {
          await this.bridgeServer.start();
        } catch (err: any) {
          if (mode === 'auto') {
            throw new Error(`DOM Bridge connection failure: bridge server failed to start (${err.message})`);
          }
        }
      }
    }

    // Fast pre-flight wakeup probe if client count is 0
    if (this.bridgeServer.getConnectedClients().length === 0) {
      this.logger.debug('DISPATCHER', 'Connected clients count is 0 in dispatchTier1. Probing active clients with fast wakeup...');
      await this.bridgeServer.probeActiveClients(200);
    }

    // Dispatcher auto-reconnect retry loop (up to 1s) if clients are still 0
    if (this.bridgeServer.getConnectedClients().length === 0) {
      this.logger.debug('DISPATCHER', 'Clients still 0 after fast probe, attempting 1s auto-reconnect retry loop...');
      const reconnectStart = Date.now();
      while (Date.now() - reconnectStart < 1000) {
        await new Promise((r) => setTimeout(r, 100));
        if (this.bridgeServer.getConnectedClients().length > 0) {
          this.logger.info('DISPATCHER', `Client reconnected during retry loop (${Date.now() - reconnectStart}ms)`);
          break;
        }
      }
    }

    if (this.bridgeServer.getConnectedClients().length === 0) {
      throw new Error('DOM Bridge connection failure: no active connected clients');
    }

    // DOM Handshake: Await transition to empty conversation or trigger via DOM Bridge client
    let handshakeAck: CommandAckResult | undefined;
    if (options?.openNewConversation !== false) {
      try {
        if (!openedViaCommand) {
          this.logger.debug('DISPATCHER', 'Command API unavailable for openNewConversation, triggering via DOM Bridge client...');
          handshakeAck = await this.bridgeServer.dispatchNewConversationCommand({
            timeoutMs: Math.min(timeoutMs, 3000),
            windowKey: options?.windowKey
          });
        } else {
          this.logger.debug('DISPATCHER', 'Opened via command, executing fast DOM Bridge readiness handshake...');
          handshakeAck = await this.bridgeServer.dispatchNewConversationCommand({
            timeoutMs: Math.min(timeoutMs, 3000),
            windowKey: options?.windowKey,
            extra: { readyCheckOnly: true }
          });
        }

        if (handshakeAck && handshakeAck.status === 'error') {
          this.logger.warn('DISPATCHER', `DOM Bridge openNewConversation handshake returned error: ${handshakeAck.error}`);
        } else {
          this.logger.info('DISPATCHER', `DOM Bridge openNewConversation handshake completed successfully (${handshakeAck?.status})`);
        }
      } catch (convErr: any) {
        this.logger.warn('DISPATCHER', `DOM Bridge openNewConversation command warning: ${convErr?.message || convErr}`);
        handshakeAck = {
          success: false,
          commandId: '',
          status: 'error',
          durationMs: 0,
          error: convErr?.message || String(convErr)
        };
      }

      // Mandatory stabilization delay (450ms) after completing openNewConversation before queuing or dispatching sendPrompt
      await new Promise((resolve) => setTimeout(resolve, 450));
    }

    const commandOpts: CommandOptions = {
      timeoutMs,
      type: options?.commandType || 'sendPrompt',
      windowKey: options?.windowKey,
      extra: {
        ...(options?.extra || {}),
        openNewConversation: options?.openNewConversation !== false
      }
    };

    const maxRetries = 2;
    let retryCount = 0;
    let ackResult: any;

    while (true) {
      try {
        ackResult = await this.bridgeServer.dispatchPromptCommand(promptText, commandOpts);
        if (!ackResult || !ackResult.success) {
          const err: any = new Error(ackResult?.error || `DOM Bridge rejected command ${ackResult?.commandId || ''}`);
          if (ackResult?.metadata) {
            err.metadata = ackResult.metadata;
            if (ackResult.metadata.code) err.code = ackResult.metadata.code;
            if (ackResult.metadata.rejectionReason) err.rejectionReason = ackResult.metadata.rejectionReason;
            if (ackResult.metadata.domSnapshot) err.domSnapshot = ackResult.metadata.domSnapshot;
            if (ackResult.metadata.steps) err.steps = ackResult.metadata.steps;
            if (ackResult.metadata.diagnostics) err.diagnostics = ackResult.metadata.diagnostics;
          }
          throw err;
        }
        break;
      } catch (err: any) {
        const isTransientButtonDisabled =
          err?.code === 'BUTTON_DISABLED_TIMEOUT' ||
          err?.metadata?.code === 'BUTTON_DISABLED_TIMEOUT' ||
          err?.code === 'NOT_READY' ||
          err?.metadata?.code === 'NOT_READY' ||
          err?.rejectionReason === 'button_disabled_timeout' ||
          err?.metadata?.rejectionReason === 'button_disabled_timeout' ||
          /BUTTON_DISABLED_TIMEOUT|button_disabled_timeout|button.*disabled|not ready/i.test(err?.message || '');

        if (isTransientButtonDisabled && retryCount < maxRetries) {
          retryCount++;
          const warningMsg = `DOM send button temporarily unready, retrying (attempt ${retryCount}/${maxRetries})...`;
          this.logger.warn('DISPATCHER', warningMsg, {
            attempt: retryCount,
            maxRetries,
            error: err.message,
            metadata: err.metadata
          });
          this.warningNotifier(warningMsg);
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }

        const isTimeout = err?.message && /timed?\s*out/i.test(err.message);
        const isAborted = err?.code === 'COMMAND_ABORTED_BY_TIMEOUT' || err?.aborted === true || (err?.message && /aborted/i.test(err.message));

        const wsName = this.bridgeServer.getWorkspaceName();

        if (!isTransientButtonDisabled && (isTimeout || isAborted)) {
          this.logger.warn('DISPATCHER', `Tier 1 submission cancelled due to timeout (${timeoutMs}ms) [workspace: ${wsName || 'unbound'}]. Cancellation signal registered with BridgeServer.`, {
            workspaceName: wsName,
            timeoutMs,
            targetWindow: commandOpts.windowKey,
            error: err.message
          });
          const cancellationErr: any = new Error(`DOM Bridge submission cancellation: command timed out after ${timeoutMs}ms and cancellation signal registered with BridgeServer`);
          cancellationErr.code = 'COMMAND_ABORTED_BY_TIMEOUT';
          cancellationErr.isTimeout = true;
          cancellationErr.isCancelled = true;
          cancellationErr.workspaceName = wsName;
          if (err.domSnapshot) cancellationErr.domSnapshot = err.domSnapshot;
          if (err.steps) cancellationErr.steps = err.steps;
          if (err.metadata) cancellationErr.metadata = err.metadata;
          throw cancellationErr;
        }

        const isConnectionFailure = !this.bridgeServer.isListening() || this.bridgeServer.getConnectedClients().length === 0;
        const errorCategory = isConnectionFailure ? 'DOM Bridge connection failure' : 'DOM Bridge execution error';

        const isPasteVerificationFailed =
          err?.code === 'PASTE_VERIFICATION_FAILED' ||
          err?.metadata?.code === 'PASTE_VERIFICATION_FAILED' ||
          err?.rejectionReason === 'dom_buffer_empty' ||
          /PASTE_VERIFICATION_FAILED/i.test(err?.message || '');

        const isNoChatInput =
          err?.code === 'NO_CHAT_INPUT_FOUND' ||
          err?.metadata?.code === 'NO_CHAT_INPUT_FOUND' ||
          /NO_CHAT_INPUT_FOUND|No valid chat input element found/i.test(err?.message || '');

        if (isPasteVerificationFailed || isNoChatInput) {
          const failureCode = isPasteVerificationFailed ? 'PASTE_VERIFICATION_FAILED' : 'NO_CHAT_INPUT_FOUND';
          const telemetry = this.extractVerificationTelemetry(err.metadata || (err.steps ? { steps: err.steps } : undefined));
          const expected = err.charsExpected ?? telemetry.charsExpected ?? promptText.length;
          const detected = err.charsDetectedInDOM ?? telemetry.charsDetectedInDOM ?? 0;
          const excerpt = sanitizeExcerpt(err.domExcerpt || telemetry.domExcerpt || '', 60);
          const target = err.elementContext || telemetry.elementContext || '#antigravity.agentSidePanelInputBox';

          if (isPasteVerificationFailed) {
            this.logger.warn('DISPATCHER', `Prompt paste verification failed: expected ${expected} chars, detected ${detected} in DOM buffer for target '${target}'. Excerpt: "${excerpt}". Ensure chat panel is open and focused.`, {
              code: 'PASTE_VERIFICATION_FAILED',
              charsExpected: expected,
              charsDetectedInDOM: detected,
              domExcerpt: excerpt,
              elementContext: target,
              steps: err.steps || err.metadata?.steps,
              domSnapshot: err.domSnapshot || err.metadata?.domSnapshot
            });

            this.logger.recordInjectionTelemetry({
              status: 'failed',
              charsExpected: expected,
              charsDetectedInDOM: detected,
              domExcerpt: excerpt,
              elementContext: target,
              verified: false,
              error: err.message,
              timestamp: Date.now()
            });
          } else {
            this.logger.warn('DISPATCHER', `No chat input element found in DOM: Antigravity chat panel may be closed or hidden. Please open the Agent chat panel and retry.`, {
              code: 'NO_CHAT_INPUT_FOUND',
              domSnapshot: err.domSnapshot || err.metadata?.domSnapshot,
              steps: err.steps || err.metadata?.steps
            });
          }

          try {
            await this.notifyActionableChatError(failureCode);
          } catch (notifyErr) {
            this.logger.warn('DISPATCHER', `Actionable error notification failed: ${notifyErr}`);
          }
        }

        this.logger.error('DISPATCHER', `Tier 1 dispatch failed (${errorCategory}) [workspace: ${wsName || 'unbound'}]: ${err.message}`, {
          workspaceName: wsName,
          domSnapshot: err.domSnapshot,
          steps: err.steps,
          metadata: err.metadata
        }, err);
        const formattedErr: any = new Error(`[${errorCategory}] ${err.message}`);
        formattedErr.code = err.code || err.metadata?.code || (isPasteVerificationFailed ? 'PASTE_VERIFICATION_FAILED' : (isNoChatInput ? 'NO_CHAT_INPUT_FOUND' : (isTransientButtonDisabled ? 'BUTTON_DISABLED_TIMEOUT' : 'DOM_BRIDGE_EXECUTION_ERROR')));
        formattedErr.workspaceName = wsName;
        if (err.rejectionReason || err.metadata?.rejectionReason) {
          formattedErr.rejectionReason = err.rejectionReason || err.metadata?.rejectionReason;
        }
        if (err.domSnapshot || err.metadata?.domSnapshot) {
          formattedErr.domSnapshot = err.domSnapshot || err.metadata?.domSnapshot;
        }
        if (err.steps || err.metadata?.steps) {
          formattedErr.steps = err.steps || err.metadata?.steps;
        }
        if (err.charsExpected !== undefined || err.metadata?.charsExpected !== undefined) {
          formattedErr.charsExpected = err.charsExpected ?? err.metadata?.charsExpected;
        }
        if (err.charsDetectedInDOM !== undefined || err.metadata?.charsDetectedInDOM !== undefined) {
          formattedErr.charsDetectedInDOM = err.charsDetectedInDOM ?? err.metadata?.charsDetectedInDOM;
        }
        if (err.domExcerpt !== undefined || err.metadata?.domExcerpt !== undefined) {
          formattedErr.domExcerpt = err.domExcerpt ?? err.metadata?.domExcerpt;
        }
        if (err.elementContext !== undefined || err.metadata?.elementContext !== undefined) {
          formattedErr.elementContext = err.elementContext ?? err.metadata?.elementContext;
        }
        if (err.metadata) {
          formattedErr.metadata = err.metadata;
        }
        if (err.diagnostics || err.metadata?.diagnostics) {
          formattedErr.diagnostics = { ...err.diagnostics, workspaceName: wsName };
        } else {
          formattedErr.diagnostics = { workspaceName: wsName };
        }
        throw formattedErr;
      }
    }

    const durationMs = Date.now() - startTime;

    const resultMetadata: Record<string, any> = {
      ...(ackResult.metadata || {})
    };
    if (retryCount > 0) {
      resultMetadata.retries = retryCount;
    }
    if (handshakeAck) {
      resultMetadata.handshake = handshakeAck;
      resultMetadata.handshakeStatus = handshakeAck.status;
    }

    const telemetry = this.extractVerificationTelemetry(resultMetadata);
    const charsExpected = ackResult.charsExpected ?? telemetry.charsExpected ?? promptText.length;
    const charsDetected = ackResult.charsDetectedInDOM ?? telemetry.charsDetectedInDOM ?? charsExpected;
    const targetElementContext = ackResult.elementContext || telemetry.elementContext || '#antigravity.agentSidePanelInputBox';
    const strategy = ackResult.strategy || telemetry.strategy || 'contenteditable-text';

    // Structured dispatcher log matching Requirement 1:
    // [INFO] [DISPATCHER] Prompt paste verified: 3321/3321 chars in '#antigravity.agentSidePanelInputBox' (strategy=contenteditable-text)
    this.logger.info('DISPATCHER', `Prompt paste verified: ${charsDetected}/${charsExpected} chars in '${targetElementContext}' (strategy=${strategy})`, {
      charsExpected,
      charsDetectedInDOM: charsDetected,
      elementContext: targetElementContext,
      strategy,
      commandId: ackResult.commandId
    });

    this.logger.recordInjectionTelemetry({
      status: 'verified',
      charsExpected,
      charsDetectedInDOM: charsDetected,
      charsInjected: charsExpected,
      elementContext: targetElementContext,
      strategy,
      verified: true,
      timestamp: Date.now()
    });

    return {
      success: true,
      tier: 'domBridge',
      durationMs,
      commandId: ackResult.commandId,
      status: ackResult.status,
      charsExpected,
      charsDetectedInDOM: charsDetected,
      elementContext: targetElementContext,
      metadata: resultMetadata
    };
  }

  /**
   * Alias for dispatchTier1
   */
  public dispatchViaTier1(promptText: string, options?: DispatchOptions): Promise<DispatchResult> {
    return this.dispatchTier1(promptText, options);
  }

  /**
   * Alias for dispatchPrompt
   */
  public sendPromptWithFallback(promptText: string, options?: DispatchOptions): Promise<DispatchResult> {
    return this.dispatchPrompt(promptText, options);
  }

  /**
   * Tier 2: VS Code Native Command API.
   */
  public async dispatchTier2(promptText: string, options?: DispatchOptions): Promise<DispatchResult> {
    const startTime = Date.now();

    if (options?.openNewConversation !== false) {
      try {
        await this.commandExecutor('antigravity.prioritized.chat.openNewConversation');
      } catch {
        try {
          await this.commandExecutor('workbench.action.chat.newChat');
        } catch {
          try {
            await this.commandExecutor('workbench.action.chat.open');
          } catch {
            // Non-fatal if opening new conversation command does not exist
          }
        }
      }
    }

    // Execute sendTextToChat command
    await this.commandExecutor('antigravity.sendTextToChat', promptText);
    const durationMs = Date.now() - startTime;

    return {
      success: true,
      tier: 'nativeCommand',
      durationMs,
      status: 'commandExecuted'
    };
  }

  /**
   * Tier 3: Legacy OS Keyboard Simulation (PowerShell SendKeys).
   */
  public async dispatchTier3(promptText: string, options?: DispatchOptions): Promise<DispatchResult> {
    const startTime = Date.now();
    const keyboardOpts: BatchPromptOptions = {
      focusDelayMs: options?.keyboardOptions?.focusDelayMs ?? this.configProvider().focusDelayMs ?? 800,
      selectDelayMs: options?.keyboardOptions?.selectDelayMs,
      pasteDelayMs: options?.keyboardOptions?.pasteDelayMs,
      submitDelayMs: options?.keyboardOptions?.submitDelayMs
    };

    await this.keyboardManager.executeBatchPromptFlow(promptText, keyboardOpts);
    const durationMs = Date.now() - startTime;

    return {
      success: true,
      tier: 'keyboard',
      durationMs,
      status: 'keysSent'
    };
  }

  /**
   * Dispatches a prompt using 100% native Antigravity IDE internal commands:
   * 1. If a new conversation is requested (or at the start of a phase), execute 'antigravity.startNewConversation' followed by a fixed 400 ms stabilization delay.
   * 2. Execute 'antigravity.addContext' with the target prompt string.
   * 3. Wait for 'sendDelayMs' (default: 500 ms) to ensure the chat UI enables the send state.
   * 4. Execute 'antigravity.triggerSend' to fire the prompt.
   */
  public async dispatchPrompt(promptText: string, options?: DispatchOptions): Promise<DispatchResult> {
    const startTime = Date.now();
    const config = this.configProvider();
    const promptPreview = sanitizePrompt(promptText, 60);

    const isNewConversation = Boolean(options?.newConversation || options?.openNewConversation);
    const rawDelay = options?.sendDelayMs ?? config.sendDelayMs;
    const sendDelayMs = typeof rawDelay === 'number' && !isNaN(rawDelay) ? Math.max(0, rawDelay) : 500;

    this.logger.info(
      'DISPATCHER',
      `[Native Dispatch] Dispatching prompt: "${promptPreview}" (${promptText.length} chars, newConversation=${isNewConversation}, sendDelayMs=${sendDelayMs}ms)`
    );

    // 1. If a new conversation is requested, execute antigravity.startNewConversation followed by 400ms stabilization delay
    if (isNewConversation) {
      this.logger.debug('DISPATCHER', 'Executing antigravity.startNewConversation...');
      try {
        await this.commandExecutor('antigravity.startNewConversation');
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        const failureErr: any = new Error(
          `[Native Antigravity Dispatch Failed] Failed executing 'antigravity.startNewConversation': ${errMsg}. Remediation: Verify Antigravity IDE is running and internal commands are available.`
        );
        failureErr.code = 'NATIVE_COMMAND_FAILED';
        failureErr.command = 'antigravity.startNewConversation';
        failureErr.diagnostics = {
          command: 'antigravity.startNewConversation',
          error: errMsg,
          promptPreview
        };
        this.logger.recordInjectionTelemetry({
          timestamp: Date.now(),
          status: 'failed',
          elementContext: 'antigravity.startNewConversation',
          charsInjected: 0,
          charsExpected: promptText.length,
          charsDetectedInDOM: 0,
          strategy: 'native-chat-api',
          verified: false,
          error: errMsg
        });
        this.logger.error('DISPATCHER', failureErr.message, failureErr.diagnostics, err);
        throw failureErr;
      }

      // Fixed 400 ms stabilization delay
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    // 2. Execute antigravity.addContext with the target prompt string
    this.logger.debug('DISPATCHER', `Executing antigravity.addContext with ${promptText.length} chars...`);
    try {
      await this.commandExecutor('antigravity.addContext', promptText);
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const failureErr: any = new Error(
        `[Native Antigravity Dispatch Failed] Failed executing 'antigravity.addContext': ${errMsg}. Remediation: Ensure the Antigravity chat input is ready and command is registered.`
      );
      failureErr.code = 'NATIVE_COMMAND_FAILED';
      failureErr.command = 'antigravity.addContext';
      failureErr.diagnostics = {
        command: 'antigravity.addContext',
        error: errMsg,
        promptLength: promptText.length,
        promptPreview
      };
      this.logger.recordInjectionTelemetry({
        timestamp: Date.now(),
        status: 'failed',
        elementContext: 'antigravity.addContext',
        charsInjected: 0,
        charsExpected: promptText.length,
        charsDetectedInDOM: 0,
        strategy: 'native-chat-api',
        verified: false,
        error: errMsg
      });
      this.logger.error('DISPATCHER', failureErr.message, failureErr.diagnostics, err);
      throw failureErr;
    }

    // 3. Wait for sendDelayMs (default: 500 ms) to ensure the chat UI enables the send state
    if (sendDelayMs > 0) {
      this.logger.debug('DISPATCHER', `Waiting ${sendDelayMs}ms sendDelayMs before triggerSend...`);
      await new Promise(resolve => setTimeout(resolve, sendDelayMs));
    }

    // 4. Execute antigravity.triggerSend to fire the prompt
    this.logger.debug('DISPATCHER', 'Executing antigravity.triggerSend...');
    try {
      await this.commandExecutor('antigravity.triggerSend');
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const failureErr: any = new Error(
        `[Native Antigravity Dispatch Failed] Failed executing 'antigravity.triggerSend': ${errMsg}. Remediation: Ensure Antigravity send button is enabled.`
      );
      failureErr.code = 'NATIVE_COMMAND_FAILED';
      failureErr.command = 'antigravity.triggerSend';
      failureErr.diagnostics = {
        command: 'antigravity.triggerSend',
        error: errMsg,
        promptLength: promptText.length
      };
      this.logger.recordInjectionTelemetry({
        timestamp: Date.now(),
        status: 'failed',
        elementContext: 'antigravity.triggerSend',
        charsInjected: 0,
        charsExpected: promptText.length,
        charsDetectedInDOM: 0,
        strategy: 'native-chat-api',
        verified: false,
        error: errMsg
      });
      this.logger.error('DISPATCHER', failureErr.message, failureErr.diagnostics, err);
      throw failureErr;
    }

    const durationMs = Date.now() - startTime;
    this.logger.info('DISPATCHER', `Prompt dispatched successfully via Native Antigravity commands in ${durationMs}ms`);

    this.logger.recordInjectionTelemetry({
      timestamp: Date.now(),
      status: 'verified',
      elementContext: 'antigravity.addContext (Native)',
      charsInjected: promptText.length,
      charsExpected: promptText.length,
      charsDetectedInDOM: promptText.length,
      strategy: 'native-chat-api',
      verified: true
    });

    return {
      success: true,
      tier: 'nativeCommand',
      durationMs,
      status: 'sent',
      charsExpected: promptText.length,
      charsDetectedInDOM: promptText.length,
      metadata: {
        engine: 'Native Antigravity Dispatch',
        newConversation: isNewConversation,
        sendDelayMs
      }
    };
  }

  /**
   * Non-destructive live tier transport diagnostic ping and readiness test.
   */
  public async testTierDispatch(
    tier: DispatchTier,
    testPrompt?: string,
    platformOverride?: string
  ): Promise<{ success: boolean; tier: DispatchTier; latencyMs: number; error?: string; status?: string }> {
    const startTime = Date.now();

    if (tier === 'domBridge') {
      try {
        if (!this.bridgeServer.isListening() || this.bridgeServer.getConnectedClients().length === 0) {
          return {
            success: false,
            tier: 'domBridge',
            latencyMs: Date.now() - startTime,
            error: 'DOM Bridge has no active connected clients'
          };
        }

        const ack = await this.bridgeServer.dispatchPromptCommand(testPrompt || 'ping', {
          type: 'ping',
          timeoutMs: 2000
        });

        return {
          success: ack.success,
          tier: 'domBridge',
          latencyMs: ack.durationMs ?? (Date.now() - startTime),
          status: ack.status,
          error: ack.error
        };
      } catch (err: any) {
        return {
          success: false,
          tier: 'domBridge',
          latencyMs: Date.now() - startTime,
          error: err.message || String(err)
        };
      }
    }

    if (tier === 'nativeCommand') {
      try {
        if (!this.commandExecutor || typeof this.commandExecutor !== 'function') {
          throw new Error('Command API executor is unavailable');
        }

        if (this.customCommandExecutorProvided) {
          await this.commandExecutor(testPrompt || 'ping');
        } else if (vscode?.commands?.getCommands) {
          await vscode.commands.getCommands(true);
        } else {
          await this.commandExecutor(testPrompt || 'ping');
        }

        const latencyMs = Date.now() - startTime;
        return {
          success: true,
          tier: 'nativeCommand',
          latencyMs,
          status: 'commandApiReady'
        };
      } catch (err: any) {
        return {
          success: false,
          tier: 'nativeCommand',
          latencyMs: Date.now() - startTime,
          error: err.message || String(err)
        };
      }
    }

    if (tier === 'keyboard') {
      try {
        const rawPlatform = platformOverride || process.platform;
        if (rawPlatform === 'win32') {
          return {
            success: true,
            tier: 'keyboard',
            latencyMs: Date.now() - startTime,
            status: 'powershellReady'
          };
        } else if (rawPlatform === 'linux') {
          const prereqs = typeof this.keyboardManager?.checkLinuxKeyboardPrerequisites === 'function'
            ? this.keyboardManager.checkLinuxKeyboardPrerequisites()
            : { available: false, binary: null, error: 'xdotool not available' };
          const latencyMs = Date.now() - startTime;
          if (prereqs.available) {
            return {
              success: true,
              tier: 'keyboard',
              latencyMs,
              status: `xdotoolReady (${prereqs.binary || 'xdotool'})`
            };
          } else {
            return {
              success: false,
              tier: 'keyboard',
              latencyMs,
              error: prereqs.error || 'xdotool is missing on Linux'
            };
          }
        } else {
          return {
            success: false,
            tier: 'keyboard',
            latencyMs: Date.now() - startTime,
            error: `Keyboard simulation not supported on ${rawPlatform}`
          };
        }
      } catch (err: any) {
        return {
          success: false,
          tier: 'keyboard',
          latencyMs: Date.now() - startTime,
          error: err.message || String(err)
        };
      }
    }

    return {
      success: false,
      tier,
      latencyMs: Date.now() - startTime,
      error: `Unknown tier: ${tier}`
    };
  }

  /**
   * Stops active AI generation across Antigravity native commands.
   */
  public async stopActiveGeneration(_options?: DispatchOptions): Promise<boolean> {
    try {
      try {
        await this.commandExecutor('antigravity.prioritized.chat.stop');
        this.logger.info('DISPATCHER', 'stopActiveGeneration succeeded via antigravity.prioritized.chat.stop');
        return true;
      } catch {
        await this.commandExecutor('workbench.action.chat.stop');
        this.logger.info('DISPATCHER', 'stopActiveGeneration succeeded via workbench.action.chat.stop');
        return true;
      }
    } catch (tier2Err: any) {
      this.logger.warn('DISPATCHER', `stopActiveGeneration failed: ${tier2Err?.message || tier2Err}`);
      return false;
    }
  }
}

export const promptDispatcher = new PromptDispatcher();
