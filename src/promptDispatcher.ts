import * as vscode from 'vscode';
import { BridgeServer, CommandOptions } from './bridgeServer';
import { KeyboardManager, keyboardManager as defaultKeyboardManager, BatchPromptOptions } from './keyboardManager';
import { AutoPlanConfig, getConfig, ExecutionMode } from './config';

export type DispatchTier = 'domBridge' | 'nativeCommand' | 'keyboard';

export interface DispatchReadinessResult {
  ready: boolean;
  selectedTier: 'domBridge' | 'nativeCommand' | 'keyboard';
  isFocusFree: boolean;
  requiresForegroundFocus: boolean;
  warningMessage?: string;
  errorMessage?: string;
  remediationAction?: 'activateBridge' | 'installXdotool' | 'openDocs';
  details: {
    connectedClientsCount: number;
    os: 'win32' | 'linux' | 'darwin' | 'other';
    xdotoolAvailable?: boolean;
    bridgePort?: number;
  };
}

export interface DispatchOptions {
  mode?: ExecutionMode;
  allowFallback?: boolean;
  timeoutMs?: number;
  windowKey?: string;
  commandType?: string;
  openNewConversation?: boolean;
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
  private customCommandExecutorProvided: boolean;

  constructor(options?: PromptDispatcherOptions) {
    this.bridgeServer = options?.bridgeServer ?? new BridgeServer();
    this.keyboardManager = options?.keyboardManager ?? defaultKeyboardManager;
    this.configProvider = options?.configProvider ?? getConfig;
    this.customCommandExecutorProvided = Boolean(options?.commandExecutor);
    this.commandExecutor =
      options?.commandExecutor ??
      ((cmd: string, ...args: any[]) => {
        if (vscode?.commands?.executeCommand) {
          return vscode.commands.executeCommand(cmd, ...args);
        }
        return Promise.reject(new Error('vscode.commands.executeCommand is unavailable'));
      });
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

  public getBridgeServer(): BridgeServer {
    return this.bridgeServer;
  }

  public getKeyboardManager(): KeyboardManager {
    return this.keyboardManager;
  }

  /**
   * Pre-flight health check to evaluate prompt transport readiness in < 100ms.
   */
  public validateDispatchReadiness(
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
    const timeoutMs = options?.timeoutMs ?? config.bridgeTimeoutMs ?? 5000;

    // In auto mode, if bridge server is not listening or has no connected clients, fail fast to Tier 2
    if (mode === 'auto') {
      if (!this.bridgeServer.isListening() || this.bridgeServer.getConnectedClients().length === 0) {
        throw new Error('DOM Bridge has no active connected clients');
      }
    } else {
      if (!this.bridgeServer.isListening()) {
        await this.bridgeServer.start();
      }
    }

    const commandOpts: CommandOptions = {
      timeoutMs,
      type: options?.commandType || 'sendPrompt',
      windowKey: options?.windowKey,
      extra: options?.extra
    };

    const ackResult = await this.bridgeServer.dispatchPromptCommand(promptText, commandOpts);
    const durationMs = Date.now() - startTime;

    if (!ackResult.success) {
      throw new Error(ackResult.error || `DOM Bridge rejected command ${ackResult.commandId}`);
    }

    return {
      success: true,
      tier: 'domBridge',
      durationMs,
      commandId: ackResult.commandId,
      status: ackResult.status,
      metadata: ackResult.metadata
    };
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
          await this.commandExecutor('workbench.action.chat.open');
        } catch {
          // Non-fatal if opening new conversation command does not exist
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
   * Dispatches a prompt across the configured or 3-tier fallback strategy.
   */
  public async dispatchPrompt(promptText: string, options?: DispatchOptions): Promise<DispatchResult> {
    const config = this.configProvider();
    const mode: ExecutionMode = options?.mode || config.executionMode || 'auto';
    const allowFallback = options?.allowFallback ?? config.allowTierFallback ?? true;
    const isStrict = allowFallback === false || (config.strictMode && mode !== 'auto');
    const fallbackHistory: FallbackRecord[] = [];

    // If fallback is disabled (allowFallback === false or strict mode): execute only the requested tier
    if (isStrict) {
      const targetTier: DispatchTier = mode === 'auto' ? 'domBridge' : mode;

      if (targetTier === 'domBridge') {
        try {
          return await this.dispatchTier1(promptText, options);
        } catch (err: any) {
          throw new Error(
            `[DOM Bridge Transport Failed] ${err.message || String(err)}. Remediation: Ensure DOM Bridge injection is active in workbench.html or restart the bridge server.`
          );
        }
      }

      if (targetTier === 'nativeCommand') {
        try {
          return await this.dispatchTier2(promptText, options);
        } catch (err: any) {
          throw new Error(
            `[Native Command Transport Failed] ${err.message || String(err)}. Remediation: Ensure VS Code Antigravity chat command is accessible.`
          );
        }
      }

      if (targetTier === 'keyboard') {
        try {
          return await this.dispatchTier3(promptText, options);
        } catch (err: any) {
          throw new Error(
            `[Keyboard Simulation Failed] ${err.message || String(err)}. Remediation: Ensure OS keyboard prerequisites (e.g. xdotool on Linux) are installed.`
          );
        }
      }
    }

    // If fallback is enabled: execute Tier 1 -> Tier 2 -> Tier 3 with fallback history tracking
    if (mode === 'auto' || mode === 'domBridge') {
      // 1. Try Tier 1: DOM Bridge
      const t1Start = Date.now();
      try {
        const res = await this.dispatchTier1(promptText, options);
        return res;
      } catch (err: any) {
        fallbackHistory.push({
          tier: 'domBridge',
          error: err.message || String(err),
          durationMs: Date.now() - t1Start
        });
      }

      // 2. Try Tier 2: VS Code Command API
      const t2Start = Date.now();
      try {
        const res = await this.dispatchTier2(promptText, options);
        return {
          ...res,
          fallbackHistory
        };
      } catch (err: any) {
        fallbackHistory.push({
          tier: 'nativeCommand',
          error: err.message || String(err),
          durationMs: Date.now() - t2Start
        });
      }

      // 3. Fallback Tier 3: OS Keyboard Simulation
      const t3Start = Date.now();
      const fallbackMsg = 'Auto-Plan: DOM Bridge & Native Commands unavailable. Falling back to OS Keyboard Simulation.';
      if (config.suppressFallbackWarnings !== false) {
        console.log(`[Auto-Plan PromptDispatcher] ${fallbackMsg}`);
      } else {
        this.warningNotifier(fallbackMsg);
      }

      try {
        const res = await this.dispatchTier3(promptText, options);
        return {
          ...res,
          fallbackHistory
        };
      } catch (err: any) {
        fallbackHistory.push({
          tier: 'keyboard',
          error: err.message || String(err),
          durationMs: Date.now() - t3Start
        });

        const summary = fallbackHistory.map((f) => `${f.tier}: ${f.error}`).join(' | ');
        throw new Error(`All prompt dispatch tiers failed. (${summary})`);
      }
    }

    if (mode === 'nativeCommand') {
      const t2Start = Date.now();
      try {
        const res = await this.dispatchTier2(promptText, options);
        return res;
      } catch (err: any) {
        fallbackHistory.push({
          tier: 'nativeCommand',
          error: err.message || String(err),
          durationMs: Date.now() - t2Start
        });
      }

      // Fallback to Tier 3
      const t3Start = Date.now();
      try {
        const res = await this.dispatchTier3(promptText, options);
        return {
          ...res,
          fallbackHistory
        };
      } catch (err: any) {
        fallbackHistory.push({
          tier: 'keyboard',
          error: err.message || String(err),
          durationMs: Date.now() - t3Start
        });
        const summary = fallbackHistory.map((f) => `${f.tier}: ${f.error}`).join(' | ');
        throw new Error(`Native Command and fallback tiers failed. (${summary})`);
      }
    }

    if (mode === 'keyboard') {
      try {
        return await this.dispatchTier3(promptText, options);
      } catch (err: any) {
        throw new Error(`[Keyboard Simulation Failed] ${err.message || String(err)}`);
      }
    }

    throw new Error(`Unsupported execution mode: ${mode}`);
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
}

export const promptDispatcher = new PromptDispatcher();
