import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getWorkbenchPath } from './workbenchInjector';

export type ExecutionMode = 'auto' | 'domBridge' | 'nativeCommand' | 'keyboard';
export type TelegramLiveProgressMode = 'final_only' | 'live_edit';

export interface AutoPlanConfig {
  promptText: string;
  promptTemplate?: string;
  defaultPromptTemplate?: string;
  repeatCount: number;
  completionKeyword: string;
  delayBetweenLoopsMs: number;
  timeoutPerLoopMinutes: number;
  sendDelayMs?: number;
  focusDelayMs?: number;
  defaultPlanFolder?: string;
  /** @deprecated Deprecated in Native Chat API transition. Provided for backward compatibility. */
  executionMode?: ExecutionMode;
  /** @deprecated Deprecated in Native Chat API transition. Provided for backward compatibility. */
  allowTierFallback?: boolean;
  /** @deprecated Deprecated in Native Chat API transition. Provided for backward compatibility. */
  strictMode?: boolean;
  /** @deprecated Deprecated in Native Chat API transition. Provided for backward compatibility. */
  bridgeTimeoutMs?: number;
  newConversationTimeoutMs?: number;
  staleClientMs?: number;
  /** @deprecated Deprecated in Native Chat API transition. DOM bridge injection is obsolete. */
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
  telegramLiveProgressMode?: TelegramLiveProgressMode;
  longPhaseNudgeEnabled?: boolean;
  longPhaseThresholdSeconds?: number;
  longPhaseNudgeMessage?: string;
  longPhaseNudgeRecurring?: boolean;
  longPhaseNotifyTelegram?: boolean;
  autoSubmitEnabled?: boolean;
  autoSubmitIntervalMs?: number;
  autoSubmitMaxQuota?: number;
  autoSubmitNotifyTelegram?: boolean;
  bridgeAuthToken?: string;
  authToken?: string;
}

export const DEFAULT_PROMPT_TEMPLATE = `{
  "role": "Senior Software Engineer responsible for implementing a specific development phase with production-quality engineering standards.",
  "objective": {
    "primary": "Implement all work described in the specified phase file.",
    "authoritative_specification": "{xxx}",
    "specification_rule": "Treat the phase file as the single source of truth for WHAT must be accomplished.",
    "implementation_rule": "Determine HOW to accomplish the objectives by inspecting the existing codebase, understanding its architecture, and applying current engineering best practices.",
    "completion_requirement": "Do not consider the phase complete until implementation is finished, the single required test file passes, and the corresponding phase status is updated in the phase plan."
  },
  "execution_rules": {
    "strict_sequential_execution": true,
    "no_skipping_steps": true,
    "no_premature_completion": true,
    "no_assumed_success": true,
    "no_fabricated_research": true,
    "no_unnecessary_scope_expansion": true,
    "instruction": "Execute the workflow in the exact order defined below. Each step must satisfy its completion criteria before proceeding to the next step. Never skip, merge, reorder, or prematurely declare a step complete."
  },
  "workflow": [
    {
      "step": 1,
      "name": "INITIAL INSPECTION AND TECHNICAL ANALYSIS",
      "objective": "Understand the phase requirements and the existing project before making implementation decisions.",
      "actions": [
        "Read the entire {xxx} file carefully.",
        "Extract all objectives, requirements, constraints, dependencies, acceptance criteria, and expected outcomes.",
        "Inspect relevant source files, directory structures, architecture, dependencies, configuration files, and existing implementation patterns.",
        "Identify the specific components and files likely to require modification or creation.",
        "Understand existing interfaces, data flows, error-handling mechanisms, and compatibility requirements.",
        "Identify technical challenges, potential risks, and unresolved implementation details.",
        "Determine which existing project conventions and architectural patterns must be preserved."
      ],
      "time_requirement": {
        "minimum_duration_seconds": 60,
        "starting_point": "Immediately after receiving this prompt.",
        "purpose": "Ensure sufficient initial codebase inspection before conducting online research.",
        "restriction": "Do not begin online research or implementation before the initial inspection period has elapsed."
      },
      "completion_criteria": [
        "The entire phase specification has been understood.",
        "Relevant existing code and architecture have been inspected.",
        "Technical challenges have been identified.",
        "Implementation constraints and project conventions are understood.",
        "At least 60 seconds have elapsed since receiving this prompt."
      ],
      "next_step_condition": "Proceed to Step 2 only after every completion criterion is satisfied."
    },
    {
      "step": 2,
      "name": "ONLINE RESEARCH AND BEST PRACTICE VALIDATION",
      "objective": "Identify and verify current best practices for the technical challenges discovered during Step 1.",
      "prerequisite": "Step 1 must be fully completed.",
      "actions": [
        "Search online for current documentation, engineering recommendations, and best practices relevant to the identified technical challenges.",
        "Prioritize official documentation, authoritative technical references, and actively maintained project documentation.",
        "Compare alternative approaches when multiple reasonable solutions exist.",
        "Evaluate alternatives based on correctness, security, performance, maintainability, compatibility, and implementation complexity.",
        "Verify that proposed solutions are compatible with the project's actual language versions, frameworks, libraries, and runtime environment.",
        "Apply relevant research findings to the implementation strategy."
      ],
      "research_integrity": [
        "Never claim to have searched, read, or verified a source that was not actually accessed.",
        "Never fabricate documentation, URLs, technical recommendations, benchmarks, or research findings.",
        "Do not rely on outdated information when authoritative current documentation is available.",
        "Do not blindly apply generic recommendations without evaluating their relevance to the existing codebase.",
        "If online research is unavailable, explicitly report the limitation rather than pretending research was completed."
      ],
      "completion_criteria": [
        "Relevant online research has been performed.",
        "Important technical decisions are supported by verified sources or clearly identified engineering judgment.",
        "The implementation approach is compatible with the existing project.",
        "Research findings have been incorporated into the implementation strategy."
      ],
      "next_step_condition": "Do not begin coding until Step 2 is fully completed."
    },
    {
      "step": 3,
      "name": "IMPLEMENTATION",
      "objective": "Implement the complete phase according to its specification and the validated implementation strategy.",
      "implementation_principles": [
        "Follow the existing project architecture and established coding conventions.",
        "Prioritize correctness, security, performance, reliability, and maintainability.",
        "Write production-quality code rather than temporary or demonstration implementations.",
        "Resolve unspecified technical details using sound engineering judgment.",
        "Preserve backward compatibility unless the phase explicitly requires breaking changes.",
        "Use appropriate error handling, input validation, resource management, and defensive programming.",
        "Avoid unnecessary abstractions, dependencies, complexity, and premature optimization.",
        "Ensure that all implementation changes are directly related to the phase objectives."
      ],
      "scope_control": {
        "allowed": [
          "Modify existing files necessary to achieve the phase objectives.",
          "Create new source files when required.",
          "Update dependencies and configuration when justified by the implementation.",
          "Make necessary integration changes to preserve system consistency."
        ],
        "prohibited": [
          "Implement unrelated features.",
          "Perform unrelated refactoring.",
          "Modify files outside the required scope without a clear technical justification.",
          "Introduce unnecessary dependencies.",
          "Rewrite working components without a phase-related reason.",
          "Change established interfaces or behaviors unnecessarily."
        ]
      },
      "implementation_requirements": [
        "Fulfill every applicable requirement in the phase specification.",
        "Ensure that new functionality integrates correctly with existing components.",
        "Maintain consistency with existing architecture and coding conventions.",
        "Address relevant failure conditions and edge cases.",
        "Do not leave placeholder implementations, incomplete functionality, or silently ignored errors.",
        "Review the final changes against the phase specification before proceeding."
      ],
      "completion_criteria": [
        "All required implementation work has been completed.",
        "All relevant source changes have been reviewed.",
        "No known implementation requirement has been intentionally omitted.",
        "The implementation is ready for verification."
      ],
      "next_step_condition": "Proceed to Step 4 only after implementation is complete."
    },
    {
      "step": 4,
      "name": "SINGLE TEST FILE CREATION AND VERIFICATION",
      "objective": "Verify the core functionality of the entire phase through exactly ONE comprehensive test file.",
      "strict_test_policy": {
        "maximum_test_files": 1,
        "required_test_files": 1,
        "test_file_scope": "The single test file must cover the phase's core functionality as comprehensively as reasonably possible.",
        "prohibited_additional_test_artifacts": [
          "Additional test files.",
          "Additional test scripts.",
          "Temporary test files.",
          "Standalone validation programs.",
          "Ad hoc test suites.",
          "Alternative test implementations.",
          "Additional files created solely to execute or validate tests."
        ],
        "existing_test_files": "Do not create or execute additional test files. The one required test file must be the only test file created and executed specifically for this phase.",
        "clarification": "Normal production source files, required fixtures, and legitimate runtime assets are not prohibited merely because the application uses them. However, do not create additional artifacts whose purpose is to act as separate tests or validation programs."
      },
      "actions": [
        "Determine the most appropriate location and testing framework based on the existing project.",
        "Create exactly ONE test file.",
        "Design the test to cover the phase's core functionality and important integration points.",
        "Include important successful execution paths.",
        "Include relevant failure conditions and error handling.",
        "Include meaningful edge cases and boundary conditions where applicable.",
        "Run only the newly created test file.",
        "Analyze failures and identify their root causes.",
        "Fix implementation defects when necessary.",
        "Rerun only the same test file after making corrections."
      ],
      "test_execution_rules": [
        "Never create a second test file.",
        "Never execute additional test files or test suites.",
        "Never use alternative scripts or standalone programs to bypass the single-test-file restriction.",
        "Do not claim that tests passed without actually executing the test file.",
        "Do not weaken, remove, or bypass meaningful assertions merely to obtain a passing result.",
        "Do not modify tests to conceal implementation defects.",
        "Preserve the same test file throughout the correction and verification cycle."
      ],
      "failure_handling": {
        "action": "Fix the underlying implementation or legitimate test defects and rerun the same test file.",
        "retry_policy": "Repeat until the test passes or a genuine blocking issue remains.",
        "blocking_issue": "If successful verification is impossible because of an environmental limitation, unavailable dependency, infrastructure failure, or another genuine blocker, stop and report the exact reason.",
        "completion_rule": "A failed, skipped, partially executed, or unexecuted test must never be reported as a successful verification."
      },
      "completion_criteria": [
        "Exactly one test file has been created for this phase.",
        "The required test file has actually been executed.",
        "The test file passes successfully.",
        "No additional test files or test suites have been created or executed.",
        "No known unresolved test failure remains."
      ],
      "next_step_condition": "Proceed to Step 5 only after all verification criteria are satisfied."
    },
    {
      "step": 5,
      "name": "PHASE PLAN STATUS UPDATE",
      "objective": "Mark the phase as completed only after successful implementation and verification.",
      "prerequisites": [
        "Step 3 implementation is complete.",
        "Step 4 single test file has passed successfully."
      ],
      "actions": [
        "Locate the phase plan file associated with {xxx}, following the project's existing plan structure.",
        "Identify the corresponding phase entry.",
        "Update only the relevant phase completion status using the existing plan format and conventions.",
        "Preserve all unrelated phase entries, requirements, descriptions, and plan content.",
        "Review the updated plan to ensure the change is accurate and consistent."
      ],
      "strict_rules": [
        "Never mark the phase as completed before the required test passes.",
        "Never mark the phase as completed if implementation remains incomplete.",
        "Never mark the phase as completed when verification is blocked or unsuccessful.",
        "Never modify unrelated phase statuses.",
        "Never fabricate test results or completion evidence."
      ],
      "completion_criteria": [
        "The correct phase entry has been updated.",
        "The completion status accurately reflects the verified implementation.",
        "No unrelated plan content has been modified."
      ],
      "next_step_condition": "Proceed to final response only after the plan update has been successfully completed."
    }
  ],
  "global_constraints": {
    "instruction_priority": [
      "The phase specification determines WHAT must be implemented.",
      "The existing codebase determines architectural compatibility and project conventions.",
      "Verified current best practices guide HOW the implementation should be performed.",
      "The strict execution workflow determines WHEN each activity is allowed."
    ],
    "scope": "Implement only what is necessary to satisfy the specified phase.",
    "honesty": "Report actual implementation, research, and verification results without exaggeration.",
    "persistence": "Maintain awareness of completed steps, outstanding requirements, and workflow restrictions throughout execution.",
    "no_premature_plan_update": true,
    "no_multiple_test_files": true,
    "no_unverified_completion": true
  },
  "final_response": {
    "success_condition": "All five workflow steps have been completed successfully.",
    "exact_output": "Done skul9x.",
    "failure_condition": "If a genuine blocker prevents successful completion, do not output the success message. Instead, provide a concise and factual explanation of the blocker, the affected step, and the remaining work."
  }
}`;

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
  sendDelayMs: 500,
  focusDelayMs: 800,
  defaultPlanFolder: '',
  executionMode: 'auto',
  allowTierFallback: true,
  strictMode: false,
  bridgeTimeoutMs: 5000,
  newConversationTimeoutMs: 8000,
  staleClientMs: 120000,
  autoInjectWorkbench: false,
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
  telegramLiveProgressMode: 'final_only',
  longPhaseNudgeEnabled: false,
  longPhaseThresholdSeconds: 180,
  longPhaseNudgeMessage: DEFAULT_LONG_PHASE_NUDGE_MESSAGE,
  longPhaseNudgeRecurring: false,
  longPhaseNotifyTelegram: true,
  autoSubmitEnabled: false,
  autoSubmitIntervalMs: 1000,
  autoSubmitMaxQuota: 0,
  autoSubmitNotifyTelegram: true,
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
  const rawSendDelay = config.get<number>('sendDelayMs');
  const sendDelayMs = typeof rawSendDelay === 'number' && !isNaN(rawSendDelay)
    ? Math.max(0, rawSendDelay)
    : (DEFAULT_CONFIG.sendDelayMs ?? 500);

  return {
    promptText,
    promptTemplate,
    defaultPromptTemplate,
    repeatCount: config.get<number>('repeatCount', DEFAULT_CONFIG.repeatCount),
    completionKeyword: config.get<string>('completionKeyword', DEFAULT_CONFIG.completionKeyword),
    delayBetweenLoopsMs: config.get<number>('delayBetweenLoopsMs', DEFAULT_CONFIG.delayBetweenLoopsMs),
    timeoutPerLoopMinutes: config.get<number>('timeoutPerLoopMinutes', DEFAULT_CONFIG.timeoutPerLoopMinutes),
    sendDelayMs,
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
    telegramLiveProgressMode: config.get<TelegramLiveProgressMode>('telegram.liveProgressMode', config.get<TelegramLiveProgressMode>('telegramLiveProgressMode', DEFAULT_CONFIG.telegramLiveProgressMode ?? 'final_only')),
    longPhaseNudgeEnabled: config.get<boolean>('longPhaseNudgeEnabled', DEFAULT_CONFIG.longPhaseNudgeEnabled ?? false),
    longPhaseThresholdSeconds: config.get<number>('longPhaseThresholdSeconds', DEFAULT_CONFIG.longPhaseThresholdSeconds ?? 180),
    longPhaseNudgeMessage: config.get<string>('longPhaseNudgeMessage', DEFAULT_CONFIG.longPhaseNudgeMessage ?? DEFAULT_LONG_PHASE_NUDGE_MESSAGE),
    longPhaseNudgeRecurring: config.get<boolean>('longPhaseNudgeRecurring', DEFAULT_CONFIG.longPhaseNudgeRecurring ?? false),
    longPhaseNotifyTelegram: config.get<boolean>('longPhaseNotifyTelegram', DEFAULT_CONFIG.longPhaseNotifyTelegram ?? true),
    autoSubmitEnabled: config.get<boolean>('autoSubmit.enabled', config.get<boolean>('autoSubmitEnabled', DEFAULT_CONFIG.autoSubmitEnabled ?? false)),
    autoSubmitIntervalMs: config.get<number>('autoSubmit.intervalMs', config.get<number>('autoSubmitIntervalMs', DEFAULT_CONFIG.autoSubmitIntervalMs ?? 1000)),
    autoSubmitMaxQuota: config.get<number>('autoSubmit.maxQuota', config.get<number>('autoSubmitMaxQuota', DEFAULT_CONFIG.autoSubmitMaxQuota ?? 0)),
    autoSubmitNotifyTelegram: config.get<boolean>('autoSubmit.notifyTelegram', config.get<boolean>('autoSubmitNotifyTelegram', DEFAULT_CONFIG.autoSubmitNotifyTelegram ?? true)),
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
    enabled: config.longPhaseNudgeEnabled ?? false,
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
  liveProgressMode: TelegramLiveProgressMode;
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
  let liveProgressMode: TelegramLiveProgressMode = config.telegramLiveProgressMode || 'final_only';

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
      const explicitMode = wsConfig.get<TelegramLiveProgressMode>('telegram.liveProgressMode');
      if (explicitMode !== undefined) liveProgressMode = explicitMode;
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
    chatMirrorPrefix,
    liveProgressMode
  };
}

export interface AutoSubmitConfig {
  enabled: boolean;
  intervalMs: number;
  maxQuota: number;
  notifyTelegram: boolean;
}

/**
 * Retrieves RPC Native Auto-Submit configuration options with bounds clamping and fallback.
 */
export function getAutoSubmitConfig(): AutoSubmitConfig {
  const config = getConfig();
  let enabled = config.autoSubmitEnabled ?? false;
  let intervalMs = config.autoSubmitIntervalMs ?? 1000;
  let maxQuota = config.autoSubmitMaxQuota ?? 0;
  let notifyTelegram = config.autoSubmitNotifyTelegram ?? true;

  try {
    const wsConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
    if (wsConfig && typeof wsConfig.get === 'function') {
      const explicitEnabled = wsConfig.get<boolean>('autoSubmit.enabled');
      if (explicitEnabled !== undefined) enabled = explicitEnabled;
      const explicitInterval = wsConfig.get<number>('autoSubmit.intervalMs');
      if (explicitInterval !== undefined) intervalMs = explicitInterval;
      const explicitQuota = wsConfig.get<number>('autoSubmit.maxQuota');
      if (explicitQuota !== undefined) maxQuota = explicitQuota;
      const explicitNotify = wsConfig.get<boolean>('autoSubmit.notifyTelegram');
      if (explicitNotify !== undefined) notifyTelegram = explicitNotify;
    }
  } catch {}

  const clampedInterval = Math.max(200, Math.min(60000, Number(intervalMs) || 1000));
  const sanitizedQuota = Math.max(0, Number(maxQuota) || 0);

  return {
    enabled: Boolean(enabled),
    intervalMs: clampedInterval,
    maxQuota: sanitizedQuota,
    notifyTelegram: Boolean(notifyTelegram)
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
  const modernDir = path.join(os.homedir(), '.gemini', 'antigravity');
  if (fs.existsSync(modernDir)) {
    return modernDir;
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
    sendDelayMs: baseConfig.sendDelayMs ?? 500,
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

/**
 * Backward compatibility alias for renderPromptTemplate.
 */
export function interpolatePromptTemplate(template: string, phase: any): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { renderPromptTemplate } = require('./planScanner');
  return renderPromptTemplate(template, phase);
}

