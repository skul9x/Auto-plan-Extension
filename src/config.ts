import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getWorkbenchPath } from './workbenchInjector';

export type ExecutionMode = 'auto' | 'domBridge' | 'nativeCommand' | 'keyboard';

export interface AutoPlanConfig {
  promptText: string;
  promptTemplate?: string;
  defaultPromptTemplate?: string;
  repeatCount: number;
  completionKeyword: string;
  delayBetweenLoopsMs: number;
  timeoutPerLoopMinutes: number;
  focusDelayMs?: number;
  defaultPlanFolder?: string;
  executionMode?: ExecutionMode;
  allowTierFallback?: boolean;
  strictMode?: boolean;
  bridgeTimeoutMs?: number;
  newConversationTimeoutMs?: number;
  staleClientMs?: number;
  autoInjectWorkbench?: boolean;
  suppressFallbackWarnings?: boolean;
  enableVerboseBridgeLogs?: boolean;
  enablePhaseAuditLogging?: boolean;
  maxLogEntries?: number;
  autoOpenBridgeLogOnError?: boolean;
  autoRetryOnTimeout?: boolean;
  retryDelaySeconds?: number;
  maxAutoRetries?: number;
  enableDomSnapshots?: boolean;
  domSnapshotFolder?: string;
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramAllowedUsers?: (number | string)[];
  telegramThrottleMs?: number;
  telegramAllowFreeChat?: boolean;
  telegramEnableChatMirror?: boolean;
  telegramMirrorIncludePcPrompts?: boolean;
  telegramChatMirrorPrefix?: string;
  longPhaseNudgeEnabled?: boolean;
  longPhaseThresholdSeconds?: number;
  longPhaseNudgeMessage?: string;
  longPhaseNudgeRecurring?: boolean;
  longPhaseNotifyTelegram?: boolean;
  bridgeAuthToken?: string;
  authToken?: string;
}

export const DEFAULT_PROMPT_TEMPLATE = `Implement the code closely following the file {xxx}. 
Note, follow the requirements exactly. Do only what is asked, with no extra work. Once done, you must thoroughly test what you have just implemented using exactly one file-based test for this phase. The test must verify the core functionality of the entire phase as comprehensively as reasonably possible. Do not create or run any additional tests, test cases, or test files. Search online to find the best practice to code. Note, do not open a browser and directly access the DOM. Use search_web / read_url_content when you need to look something up. After finishing, mark the phase plan file as completed. When done, say "Done skul9x." to save token.`;

export const DEFAULT_COMPLETION_KEYWORD = 'Done skul9x.';

export const DEFAULT_LONG_PHASE_NUDGE_MESSAGE = ' Search online to find the best practices. Note, do not open a browser and directly access the DOM. Use search_web / read_url_content when you need to look something up. ';

export const DEFAULT_CONFIG: AutoPlanConfig = {
  promptText: DEFAULT_PROMPT_TEMPLATE,
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  defaultPromptTemplate: DEFAULT_PROMPT_TEMPLATE,
  repeatCount: 5,
  completionKeyword: DEFAULT_COMPLETION_KEYWORD,
  delayBetweenLoopsMs: 2000,
  timeoutPerLoopMinutes: 0,
  focusDelayMs: 800,
  defaultPlanFolder: '',
  executionMode: 'auto',
  allowTierFallback: true,
  strictMode: false,
  bridgeTimeoutMs: 5000,
  newConversationTimeoutMs: 8000,
  staleClientMs: 120000,
  autoInjectWorkbench: true,
  suppressFallbackWarnings: true,
  enableVerboseBridgeLogs: false,
  enablePhaseAuditLogging: true,
  maxLogEntries: 500,
  autoOpenBridgeLogOnError: false,
  autoRetryOnTimeout: true,
  retryDelaySeconds: 3,
  maxAutoRetries: 5,
  enableDomSnapshots: true,
  domSnapshotFolder: '',
  telegramEnabled: true,
  telegramBotToken: '',
  telegramAllowedUsers: [],
  telegramThrottleMs: 2500,
  telegramAllowFreeChat: true,
  telegramEnableChatMirror: true,
  telegramMirrorIncludePcPrompts: true,
  telegramChatMirrorPrefix: '🤖 Antigravity:',
  longPhaseNudgeEnabled: true,
  longPhaseThresholdSeconds: 180,
  longPhaseNudgeMessage: DEFAULT_LONG_PHASE_NUDGE_MESSAGE,
  longPhaseNudgeRecurring: false,
  longPhaseNotifyTelegram: true,
  bridgeAuthToken: '',
  authToken: ''
};

export const CONFIG_SECTION = 'autoplan';

/**
 * Retrieves the current AutoPlan configuration with fallback to default values.
 */
export function getConfig(): AutoPlanConfig {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const defaultPromptTemplate = config.get<string>('defaultPromptTemplate', DEFAULT_CONFIG.defaultPromptTemplate || DEFAULT_PROMPT_TEMPLATE);
  const promptTemplate = config.get<string>('promptTemplate', defaultPromptTemplate);
  const promptText = config.get<string>('promptText', promptTemplate || DEFAULT_CONFIG.promptText);
  const executionMode = config.get<ExecutionMode>('executionMode', DEFAULT_CONFIG.executionMode ?? 'auto');
  const allowTierFallback = config.get<boolean>('allowTierFallback', DEFAULT_CONFIG.allowTierFallback ?? true);
  const explicitStrictMode = config.get<boolean | undefined>('strictMode', undefined);
  const strictMode = explicitStrictMode !== undefined
    ? explicitStrictMode
    : (executionMode !== 'auto' && !allowTierFallback);

  return {
    promptText,
    promptTemplate,
    defaultPromptTemplate,
    repeatCount: config.get<number>('repeatCount', DEFAULT_CONFIG.repeatCount),
    completionKeyword: config.get<string>('completionKeyword', DEFAULT_CONFIG.completionKeyword),
    delayBetweenLoopsMs: config.get<number>('delayBetweenLoopsMs', DEFAULT_CONFIG.delayBetweenLoopsMs),
    timeoutPerLoopMinutes: config.get<number>('timeoutPerLoopMinutes', DEFAULT_CONFIG.timeoutPerLoopMinutes),
    focusDelayMs: config.get<number>('focusDelayMs', DEFAULT_CONFIG.focusDelayMs ?? 800),
    defaultPlanFolder: config.get<string>('defaultPlanFolder', DEFAULT_CONFIG.defaultPlanFolder || ''),
    executionMode,
    allowTierFallback,
    strictMode,
    bridgeTimeoutMs: config.get<number>('bridgeTimeoutMs', DEFAULT_CONFIG.bridgeTimeoutMs ?? 5000),
    newConversationTimeoutMs: config.get<number>('newConversationTimeoutMs', DEFAULT_CONFIG.newConversationTimeoutMs ?? 8000),
    staleClientMs: config.get<number>('staleClientMs', DEFAULT_CONFIG.staleClientMs ?? 120000),
    autoInjectWorkbench: config.get<boolean>('autoInjectWorkbench', DEFAULT_CONFIG.autoInjectWorkbench ?? true),
    suppressFallbackWarnings: config.get<boolean>('suppressFallbackWarnings', DEFAULT_CONFIG.suppressFallbackWarnings ?? true),
    enableVerboseBridgeLogs: config.get<boolean>('enableVerboseBridgeLogs', DEFAULT_CONFIG.enableVerboseBridgeLogs ?? false),
    enablePhaseAuditLogging: config.get<boolean>('enablePhaseAuditLogging', DEFAULT_CONFIG.enablePhaseAuditLogging ?? true),
    maxLogEntries: config.get<number>('maxLogEntries', DEFAULT_CONFIG.maxLogEntries ?? 500),
    autoOpenBridgeLogOnError: config.get<boolean>('autoOpenBridgeLogOnError', DEFAULT_CONFIG.autoOpenBridgeLogOnError ?? false),
    autoRetryOnTimeout: config.get<boolean>('autoRetryOnTimeout', DEFAULT_CONFIG.autoRetryOnTimeout ?? true),
    retryDelaySeconds: config.get<number>('retryDelaySeconds', DEFAULT_CONFIG.retryDelaySeconds ?? 3),
    maxAutoRetries: config.get<number>('maxAutoRetries', DEFAULT_CONFIG.maxAutoRetries ?? 5),
    enableDomSnapshots: config.get<boolean>('enableDomSnapshots', DEFAULT_CONFIG.enableDomSnapshots ?? true),
    domSnapshotFolder: config.get<string>('domSnapshotFolder', DEFAULT_CONFIG.domSnapshotFolder ?? ''),
    telegramEnabled: config.get<boolean>('telegramEnabled', DEFAULT_CONFIG.telegramEnabled ?? true),
    telegramBotToken: config.get<string>('telegramBotToken', DEFAULT_CONFIG.telegramBotToken || ''),
    telegramAllowedUsers: config.get<(number | string)[]>('telegramAllowedUsers', DEFAULT_CONFIG.telegramAllowedUsers || []),
    telegramThrottleMs: config.get<number>('telegramThrottleMs', DEFAULT_CONFIG.telegramThrottleMs ?? 2500),
    telegramAllowFreeChat: config.get<boolean>('telegram.allowFreeChat', config.get<boolean>('telegramAllowFreeChat', DEFAULT_CONFIG.telegramAllowFreeChat ?? true)),
    telegramEnableChatMirror: config.get<boolean>('telegram.enableChatMirror', config.get<boolean>('telegramEnableChatMirror', DEFAULT_CONFIG.telegramEnableChatMirror ?? true)),
    telegramMirrorIncludePcPrompts: config.get<boolean>('telegram.mirrorIncludePcPrompts', config.get<boolean>('telegramMirrorIncludePcPrompts', DEFAULT_CONFIG.telegramMirrorIncludePcPrompts ?? true)),
    telegramChatMirrorPrefix: config.get<string>('telegram.chatMirrorPrefix', config.get<string>('telegramChatMirrorPrefix', DEFAULT_CONFIG.telegramChatMirrorPrefix || '🤖 Antigravity:')),
    longPhaseNudgeEnabled: config.get<boolean>('longPhaseNudgeEnabled', DEFAULT_CONFIG.longPhaseNudgeEnabled ?? true),
    longPhaseThresholdSeconds: config.get<number>('longPhaseThresholdSeconds', DEFAULT_CONFIG.longPhaseThresholdSeconds ?? 180),
    longPhaseNudgeMessage: config.get<string>('longPhaseNudgeMessage', DEFAULT_CONFIG.longPhaseNudgeMessage ?? DEFAULT_LONG_PHASE_NUDGE_MESSAGE),
    longPhaseNudgeRecurring: config.get<boolean>('longPhaseNudgeRecurring', DEFAULT_CONFIG.longPhaseNudgeRecurring ?? false),
    longPhaseNotifyTelegram: config.get<boolean>('longPhaseNotifyTelegram', DEFAULT_CONFIG.longPhaseNotifyTelegram ?? true),
    bridgeAuthToken: config.get<string>('bridgeAuthToken', ''),
    authToken: config.get<string>('authToken', '')
  };
}

export interface LongPhaseNudgeConfig {
  enabled: boolean;
  thresholdSeconds: number;
  nudgeMessage: string;
  recurring: boolean;
  notifyTelegram: boolean;
}

/**
 * Retrieves Long-Running Phase Nudge Watchdog configuration.
 */
export function getLongPhaseNudgeConfig(): LongPhaseNudgeConfig {
  const config = getConfig();
  return {
    enabled: config.longPhaseNudgeEnabled ?? true,
    thresholdSeconds: config.longPhaseThresholdSeconds ?? 180,
    nudgeMessage: config.longPhaseNudgeMessage || DEFAULT_LONG_PHASE_NUDGE_MESSAGE,
    recurring: config.longPhaseNudgeRecurring ?? false,
    notifyTelegram: config.longPhaseNotifyTelegram ?? true
  };
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  allowedUsers: (number | string)[];
  throttleMs: number;
  allowFreeChat: boolean;
  enableChatMirror: boolean;
  mirrorIncludePcPrompts: boolean;
  chatMirrorPrefix: string;
}

/**
 * Retrieves Telegram bot bridge configuration options.
 */
export function getTelegramConfig(): TelegramConfig {
  const config = getConfig();
  let allowFreeChat = config.telegramAllowFreeChat ?? true;
  let enableChatMirror = config.telegramEnableChatMirror ?? true;
  let mirrorIncludePcPrompts = config.telegramMirrorIncludePcPrompts ?? true;
  let chatMirrorPrefix = config.telegramChatMirrorPrefix || '🤖 Antigravity:';

  try {
    const wsConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
    if (wsConfig && typeof wsConfig.get === 'function') {
      const explicitFreeChat = wsConfig.get<boolean>('telegram.allowFreeChat');
      if (explicitFreeChat !== undefined) allowFreeChat = explicitFreeChat;
      const explicitMirror = wsConfig.get<boolean>('telegram.enableChatMirror');
      if (explicitMirror !== undefined) enableChatMirror = explicitMirror;
      const explicitPc = wsConfig.get<boolean>('telegram.mirrorIncludePcPrompts');
      if (explicitPc !== undefined) mirrorIncludePcPrompts = explicitPc;
      const explicitPrefix = wsConfig.get<string>('telegram.chatMirrorPrefix');
      if (explicitPrefix !== undefined) chatMirrorPrefix = explicitPrefix;
    }
  } catch {}

  return {
    enabled: config.telegramEnabled ?? true,
    botToken: config.telegramBotToken || '',
    allowedUsers: config.telegramAllowedUsers || [],
    throttleMs: config.telegramThrottleMs ?? 2500,
    allowFreeChat,
    enableChatMirror,
    mirrorIncludePcPrompts,
    chatMirrorPrefix
  };
}

/**
 * Updates a specific key in the AutoPlan configuration.
 */
export async function updateConfig<K extends keyof AutoPlanConfig>(
  key: K,
  value: AutoPlanConfig[K],
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update(key, value, target);
}

/**
 * Convenience helper to update prompt text.
 */
export async function setPromptText(
  prompt: string,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
): Promise<void> {
  await updateConfig('promptText', prompt, target);
}

/**
 * Convenience helper to update prompt template.
 */
export async function setPromptTemplate(
  template: string,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
): Promise<void> {
  await updateConfig('promptTemplate', template, target);
  await updateConfig('defaultPromptTemplate', template, target);
}

export const SIDECAR_CONFIG_FILENAME = 'ag-autoplan-config.json';

/**
 * Resolves the user-writable configuration storage directory.
 */
export function getUserConfigStorageDir(context?: any): string {
  if (context?.globalStorageUri?.fsPath) {
    return context.globalStorageUri.fsPath;
  }
  return path.join(os.homedir(), '.gemini', 'antigravity-ide');
}

export const TELEGRAM_TOKEN_SECRET_KEY = 'autoplan.telegramBotToken';

/**
 * SecretStorageManager wraps vscode.SecretStorage (context.secrets)
 * to securely store and retrieve credentials in OS keychains.
 */
export class SecretStorageManager {
  private secrets: vscode.SecretStorage | null = null;

  constructor(secrets?: vscode.SecretStorage) {
    if (secrets) {
      this.secrets = secrets;
    }
  }

  public init(secrets: vscode.SecretStorage): void {
    this.secrets = secrets;
  }

  public getSecretStorage(): vscode.SecretStorage | null {
    return this.secrets;
  }

  /**
   * Retrieves the Telegram bot token following the resolution hierarchy:
   * 1. OS Keychain via SecretStorage (highest precedence)
   * 2. Workspace / Global settings (autoplan.telegramBotToken fallback)
   */
  public async getTelegramToken(): Promise<string | undefined> {
    if (this.secrets) {
      try {
        const storedSecret = await this.secrets.get(TELEGRAM_TOKEN_SECRET_KEY);
        if (storedSecret && storedSecret.trim()) {
          return storedSecret.trim();
        }
      } catch {
        // Fall back gracefully to configuration on secret store error
      }
    }

    const configToken = getConfig().telegramBotToken;
    if (configToken && configToken.trim()) {
      return configToken.trim();
    }

    return undefined;
  }

  public async setTelegramToken(token: string): Promise<void> {
    if (!this.secrets) {
      throw new Error('SecretStorage is not initialized');
    }
    await this.secrets.store(TELEGRAM_TOKEN_SECRET_KEY, token.trim());
  }

  public async deleteTelegramToken(): Promise<void> {
    if (!this.secrets) {
      throw new Error('SecretStorage is not initialized');
    }
    await this.secrets.delete(TELEGRAM_TOKEN_SECRET_KEY);
  }
}

export const secretStorageManager = new SecretStorageManager();

/**
 * Writes the AutoPlan configuration JSON file safely without root elevation.
 * If targetDir is writable, writes there. Otherwise, catches permission errors (e.g. EACCES, EPERM)
 * and falls back cleanly to the user-writable storage directory.
 * Explicitly strips telegramBotToken and enforces mode 0o600 file permissions.
 */
export function writeSidecarConfig(
  config?: AutoPlanConfig,
  targetDir?: string,
  context?: any,
  bridgeAuthToken?: string
): string | null {
  const baseConfig = config ? { ...DEFAULT_CONFIG, ...config } : getConfig();
  const executionMode = baseConfig.executionMode ?? 'auto';
  const allowTierFallback = baseConfig.allowTierFallback ?? true;
  const strictMode = config?.strictMode !== undefined
    ? config.strictMode
    : (executionMode !== 'auto' && !allowTierFallback);

  const currentConfig: AutoPlanConfig = {
    ...baseConfig,
    executionMode,
    allowTierFallback,
    strictMode
  };

  // Explicitly strip telegramBotToken from serialized payload written to disk
  const { telegramBotToken, ...safeConfig } = currentConfig;

  // Persist bridge session authentication token if provided or preserve existing from target file
  let tokenToPersist = bridgeAuthToken || currentConfig.bridgeAuthToken || currentConfig.authToken;
  if (!tokenToPersist || !tokenToPersist.trim()) {
    try {
      const candidates: string[] = [];
      if (targetDir) {
        const isJson = path.extname(targetDir).toLowerCase() === '.json';
        candidates.push(isJson ? targetDir : path.join(targetDir, SIDECAR_CONFIG_FILENAME));
        if (!isJson) {
          candidates.push(path.join(targetDir, 'autoplan-config.json'));
        }
      }
      const wbPath = getWorkbenchPath();
      if (wbPath) {
        const wbDir = path.dirname(wbPath);
        candidates.push(path.join(wbDir, SIDECAR_CONFIG_FILENAME));
        candidates.push(path.join(wbDir, 'autoplan-config.json'));
      }
      const userDir = getUserConfigStorageDir(context);
      candidates.push(path.join(userDir, SIDECAR_CONFIG_FILENAME));
      candidates.push(path.join(userDir, 'autoplan-config.json'));

      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          const parsed = JSON.parse(fs.readFileSync(cand, 'utf8'));
          if (parsed && (parsed.bridgeAuthToken || parsed.authToken)) {
            tokenToPersist = parsed.bridgeAuthToken || parsed.authToken;
            break;
          }
        }
      }
    } catch {}
  }
  if (tokenToPersist && tokenToPersist.trim()) {
    (safeConfig as any).bridgeAuthToken = tokenToPersist.trim();
    (safeConfig as any).authToken = tokenToPersist.trim();
  }

  const content = JSON.stringify(safeConfig, null, 2);

  // 1. If targetDir is provided (e.g. in unit tests or specific paths), attempt direct write
  if (targetDir) {
    try {
      const isJsonFile = path.extname(targetDir).toLowerCase() === '.json';
      const dirToEnsure = isJsonFile ? path.dirname(targetDir) : targetDir;
      if (!fs.existsSync(dirToEnsure)) {
        fs.mkdirSync(dirToEnsure, { recursive: true });
      }
      const configPath = isJsonFile
        ? targetDir
        : path.join(targetDir, SIDECAR_CONFIG_FILENAME);
      fs.writeFileSync(configPath, content, { encoding: 'utf8', mode: 0o600 });
      try {
        fs.chmodSync(configPath, 0o600);
      } catch {}

      if (!isJsonFile) {
        const altPath = path.join(targetDir, 'autoplan-config.json');
        try {
          fs.writeFileSync(altPath, content, { encoding: 'utf8', mode: 0o600 });
          try {
            fs.chmodSync(altPath, 0o600);
          } catch {}
        } catch {}
      }

      return configPath;
    } catch {
      // EACCES / EPERM or any failure: never elevate, fall back cleanly to user storage
    }
  } else {
    // 2. If targetDir is not provided: attempt writing to workbench directory ONLY if non-elevated permissions exist
    const wbPath = getWorkbenchPath();
    if (wbPath) {
      const wbDir = path.dirname(wbPath);
      if (fs.existsSync(wbDir)) {
        const configPath = path.join(wbDir, SIDECAR_CONFIG_FILENAME);
        try {
          fs.writeFileSync(configPath, content, { encoding: 'utf8', mode: 0o600 });
          try {
            fs.chmodSync(configPath, 0o600);
          } catch {}
          const altPath = path.join(wbDir, 'autoplan-config.json');
          try {
            fs.writeFileSync(altPath, content, { encoding: 'utf8', mode: 0o600 });
            try {
              fs.chmodSync(altPath, 0o600);
            } catch {}
          } catch {}
          return configPath;
        } catch {
          // System directory requires root elevation; never call writeFileElevated, fall through to user storage
        }
      }
    }
  }

  // 3. Fallback to user-writable storage directory
  try {
    const userDir = getUserConfigStorageDir(context);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    const userConfigPath = path.join(userDir, SIDECAR_CONFIG_FILENAME);
    fs.writeFileSync(userConfigPath, content, { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(userConfigPath, 0o600);
    } catch {}
    const altPath = path.join(userDir, 'autoplan-config.json');
    try {
      fs.writeFileSync(altPath, content, { encoding: 'utf8', mode: 0o600 });
      try {
        fs.chmodSync(altPath, 0o600);
      } catch {}
    } catch {}
    return userConfigPath;
  } catch {
    return null;
  }
}

export const writeConfigJson = writeSidecarConfig;

