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
  staleClientMs?: number;
  autoApprovePermissions?: boolean;
  autoInjectWorkbench?: boolean;
  suppressFallbackWarnings?: boolean;
  enableVerboseBridgeLogs?: boolean;
  enablePhaseAuditLogging?: boolean;
  maxLogEntries?: number;
  autoOpenBridgeLogOnError?: boolean;
}

export const DEFAULT_PROMPT_TEMPLATE = `Implement the code closely following the file {xxx}
Note, follow the requirements exactly. Do only what is asked, with no extra work. Once done, you must thoroughly test what you have just implemented using exactly one file-based test for this phase. The test must verify the core functionality of the entire phase as comprehensively as reasonably possible. Do not create or run any additional tests, test cases, or test files. After finishing, mark the phase plan file as completed. When done, say "Done skul9x." to save token.`;

export const DEFAULT_COMPLETION_KEYWORD = 'Done skul9x.';

export const DEFAULT_CONFIG: AutoPlanConfig = {
  promptText: DEFAULT_PROMPT_TEMPLATE,
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  defaultPromptTemplate: DEFAULT_PROMPT_TEMPLATE,
  repeatCount: 5,
  completionKeyword: DEFAULT_COMPLETION_KEYWORD,
  delayBetweenLoopsMs: 2000,
  timeoutPerLoopMinutes: 15,
  focusDelayMs: 800,
  defaultPlanFolder: '',
  executionMode: 'auto',
  allowTierFallback: true,
  strictMode: false,
  bridgeTimeoutMs: 5000,
  staleClientMs: 120000,
  autoApprovePermissions: true,
  autoInjectWorkbench: true,
  suppressFallbackWarnings: true,
  enableVerboseBridgeLogs: false,
  enablePhaseAuditLogging: true,
  maxLogEntries: 500,
  autoOpenBridgeLogOnError: false
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
    staleClientMs: config.get<number>('staleClientMs', DEFAULT_CONFIG.staleClientMs ?? 120000),
    autoApprovePermissions: config.get<boolean>('autoApprovePermissions', DEFAULT_CONFIG.autoApprovePermissions ?? true),
    autoInjectWorkbench: config.get<boolean>('autoInjectWorkbench', DEFAULT_CONFIG.autoInjectWorkbench ?? true),
    suppressFallbackWarnings: config.get<boolean>('suppressFallbackWarnings', DEFAULT_CONFIG.suppressFallbackWarnings ?? true),
    enableVerboseBridgeLogs: config.get<boolean>('enableVerboseBridgeLogs', DEFAULT_CONFIG.enableVerboseBridgeLogs ?? false),
    enablePhaseAuditLogging: config.get<boolean>('enablePhaseAuditLogging', DEFAULT_CONFIG.enablePhaseAuditLogging ?? true),
    maxLogEntries: config.get<number>('maxLogEntries', DEFAULT_CONFIG.maxLogEntries ?? 500),
    autoOpenBridgeLogOnError: config.get<boolean>('autoOpenBridgeLogOnError', DEFAULT_CONFIG.autoOpenBridgeLogOnError ?? false)
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

/**
 * Writes the AutoPlan configuration JSON file safely without root elevation.
 * If targetDir is writable, writes there. Otherwise, catches permission errors (e.g. EACCES, EPERM)
 * and falls back cleanly to the user-writable storage directory.
 */
export function writeConfigJson(config?: AutoPlanConfig, targetDir?: string, context?: any): string | null {
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
  const content = JSON.stringify(currentConfig, null, 2);

  // 1. If targetDir is provided (e.g. in unit tests or specific paths), attempt direct write
  if (targetDir) {
    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const configPath = path.join(targetDir, SIDECAR_CONFIG_FILENAME);
      fs.writeFileSync(configPath, content, 'utf8');
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
          fs.writeFileSync(configPath, content, 'utf8');
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
    fs.writeFileSync(userConfigPath, content, 'utf8');
    return userConfigPath;
  } catch {
    return null;
  }
}

