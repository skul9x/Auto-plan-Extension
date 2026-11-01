import * as vscode from 'vscode';
import * as crypto from 'crypto';

export const BUILTIN_EXTENSION_ID = 'google.google-antigravity';
export const BUILTIN_ID = BUILTIN_EXTENSION_ID;
export const STATUS_WAITING = 9;
export const WAITING = STATUS_WAITING;
export const SCOPE_ONCE = 1;
export const ONCE = SCOPE_ONCE;
export const DEFAULT_REQUEST_TIMEOUT_MS = 1000;
export const DEFAULT_POLL_INTERVAL_MS = 1000;
export const MIN_POLL_INTERVAL_MS = 200;
export const MAX_POLL_INTERVAL_MS = 120000;
export const MAX_BACKOFF_DELAY_MS = 30000;
export const DEFAULT_CACHE_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_CACHE_ENTRIES = 5000;

export type RpcLifecycleState =
  | 'ready'
  | 'waiting'
  | 'legacy'
  | 'unsupported'
  | 'disabled'
  | 'retrying'
  | 'dormant'
  | 'idle';

export interface AntigravityRpcClient {
  getAllCascadeTrajectories(params?: any, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<any>;
  handleCascadeUserInteraction(params: any, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<any>;
  [key: string]: any;
}

export interface AntigravityExtensionApi {
  getRpcClient(): Promise<AntigravityRpcClient> | AntigravityRpcClient;
  [key: string]: any;
}

export interface RpcDiscoveryResult {
  state: RpcLifecycleState;
  client: AntigravityRpcClient | null;
  error?: string | null;
  available?: boolean;
}

export interface CandidateFilterPolicy {
  enabled?: boolean;
  patterns?: string[];
  workspaceUris?: string[];
  limits?: Record<string, number>;
  interval?: number;
  intervalMs?: number;
  maxQuota?: number;
}

export interface PermissionCandidate {
  key: string;
  pattern: string;
  cascadeId: string;
  trajectoryId: string;
  stepIndex: number;
  fingerprint: string;
  toolCall?: {
    name?: string;
    [key: string]: any;
  };
  toolName?: string;
  resource: {
    action: string;
    target: string;
    [key: string]: any;
  };
  request: {
    cascadeId: string;
    interaction: {
      trajectoryId: string;
      stepIndex: number;
      interaction: {
        case: 'permission';
        value: {
          allow: boolean;
          scope: number;
        };
      };
    };
  };
}

export interface AutoSubmitApprovalEvent {
  pattern: string;
  button: string;
  candidate: PermissionCandidate;
  timestamp: number;
}

export interface TrajectorySummary {
  trajectoryId: string;
  cascadeId?: string;
  killed?: boolean;
  annotations?: {
    archived?: boolean;
    [key: string]: any;
  };
  workspaces?: Array<{ workspaceFolderAbsoluteUri?: string; uri?: string; [key: string]: any } | string>;
  trajectoryMetadata?: {
    workspaceUris?: string[];
    [key: string]: any;
  };
  waitingSteps?: Array<{
    stepIndex?: number;
    step?: {
      status?: number;
      metadata?: {
        sourceTrajectoryStepInfo?: {
          cascadeId?: string;
          trajectoryId?: string;
          stepIndex?: number;
        };
        toolCall?: {
          name?: string;
          [key: string]: any;
        };
        [key: string]: any;
      };
      requestedInteraction?: {
        interaction?: {
          case?: string;
          value?: {
            resource?: {
              action?: string;
              target?: string;
              [key: string]: any;
            };
            [key: string]: any;
          };
        };
      };
    };
  }>;
  [key: string]: any;
}

/**
 * Normalizes file and remote workspace URIs (handling platform-specific
 * case insensitivity, Windows drive letters, raw paths, and trailing slash variations).
 */
export function normalizeWorkspace(uri?: string | null): string {
  if (typeof uri !== 'string' || !uri.trim()) {
    return '';
  }
  let raw = uri.trim();

  // Normalize raw Windows drive paths: e.g. "C:\foo\bar" or "c:/foo/bar"
  if (/^[a-zA-Z]:[/\\]/.test(raw)) {
    raw = 'file:///' + raw.replace(/\\/g, '/');
  } else if (raw.startsWith('/')) {
    // Raw POSIX path: e.g. "/home/user/project"
    raw = 'file://' + raw;
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'file:' && url.protocol !== 'vscode-remote:') {
      return '';
    }

    let pathname = decodeURIComponent(url.pathname).replace(/\\/g, '/').replace(/\/+$/, '');

    // Normalize Windows drive letter casing if present (e.g. /C: -> /c:)
    if (/^\/[a-zA-Z]:/i.test(pathname)) {
      pathname = '/' + pathname.charAt(1).toLowerCase() + pathname.slice(2);
    }

    const host = url.host.toLowerCase();
    return url.protocol + '//' + host + pathname;
  } catch (_) {
    return '';
  }
}

/**
 * Verifies that a cascade trajectory strictly belongs to one of the currently open workspace folders.
 */
export function belongsToWorkspace(summary: any, workspaceUris?: string[] | null): boolean {
  if (!summary || !Array.isArray(workspaceUris) || workspaceUris.length === 0) {
    return false;
  }

  const own = new Set(workspaceUris.map(normalizeWorkspace).filter(Boolean));
  if (own.size === 0) {
    return false;
  }

  const extractedUris: string[] = [];

  if (Array.isArray(summary.workspaces)) {
    for (const w of summary.workspaces) {
      if (typeof w === 'string') {
        extractedUris.push(w);
      } else if (w && typeof w === 'object') {
        if (typeof w.workspaceFolderAbsoluteUri === 'string') {
          extractedUris.push(w.workspaceFolderAbsoluteUri);
        } else if (typeof w.uri === 'string') {
          extractedUris.push(w.uri);
        }
      }
    }
  }

  if (Array.isArray(summary.trajectoryMetadata?.workspaceUris)) {
    for (const u of summary.trajectoryMetadata.workspaceUris) {
      if (typeof u === 'string') {
        extractedUris.push(u);
      }
    }
  }

  return extractedUris.some(u => {
    const norm = normalizeWorkspace(u);
    return norm !== '' && own.has(norm);
  });
}

/**
 * Discovers and acquires the RPC client from google.google-antigravity extension exports.
 * Applies timeout bounds to prevent blocking the Extension Host event loop.
 */
export async function acquireRpcClient(
  getExtensionFn: (id: string) => any = (id: string) => {
    try {
      return vscode.extensions?.getExtension(id);
    } catch (_) {
      return undefined;
    }
  },
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<RpcDiscoveryResult> {
  let extension: any;
  try {
    extension = getExtensionFn(BUILTIN_EXTENSION_ID);
  } catch (err: any) {
    return {
      state: 'legacy',
      client: null,
      available: false,
      error: `Error querying extension ${BUILTIN_EXTENSION_ID}: ${err?.message || String(err)}`
    };
  }

  if (!extension) {
    return {
      state: 'legacy',
      client: null,
      available: false,
      error: `Built-in Antigravity extension (${BUILTIN_EXTENSION_ID}) not found`
    };
  }

  if (!extension.isActive) {
    return {
      state: 'waiting',
      client: null,
      available: false,
      error: `Built-in Antigravity extension (${BUILTIN_EXTENSION_ID}) is installed but not active`
    };
  }

  const api: AntigravityExtensionApi = extension.exports;
  if (!api || typeof api.getRpcClient !== 'function') {
    return {
      state: 'unsupported',
      client: null,
      available: false,
      error: `Extension exports do not provide getRpcClient method`
    };
  }

  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('RPC client acquisition timed out')), timeoutMs);
  });

  try {
    const client = await Promise.race([
      Promise.resolve(api.getRpcClient()),
      timeoutPromise
    ]);

    if (
      !client ||
      typeof client.getAllCascadeTrajectories !== 'function' ||
      typeof client.handleCascadeUserInteraction !== 'function'
    ) {
      return {
        state: 'unsupported',
        client: null,
        available: false,
        error: `Acquired RPC client missing required methods (getAllCascadeTrajectories, handleCascadeUserInteraction)`
      };
    }

    return {
      state: 'ready',
      client,
      available: true,
      error: null
    };
  } catch (err: any) {
    const isTimeout = (err?.message || '').toLowerCase().includes('time');
    return {
      state: 'unsupported',
      client: null,
      available: false,
      error: isTimeout ? `RPC client acquisition timed out after ${timeoutMs}ms` : (err?.message || String(err))
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export const discoverRpcClient = acquireRpcClient;

/**
 * Recursively sorts all keys in an object alphabetically to produce a canonical structure.
 */
export function sortObjectKeys(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  return Object.keys(obj)
    .sort()
    .reduce((sorted: any, key: string) => {
      sorted[key] = sortObjectKeys(obj[key]);
      return sorted;
    }, {});
}

/**
 * Deterministically fingerprints an interaction value payload using SHA-256.
 * Canonicalizes object keys alphabetically to ensure key insertion order invariance.
 */
export function computePayloadFingerprint(payload: any): string {
  try {
    const canonical = sortObjectKeys(payload);
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  } catch (_) {
    return '';
  }
}

/**
 * Traverses trajectory summaries, validates waiting steps, and extracts actionable permission candidates.
 */
export function extractPermissionCandidates(
  response: any,
  policyOrWorkspaceUris: CandidateFilterPolicy | string[]
): PermissionCandidate[] {
  const result: PermissionCandidate[] = [];

  const policy: CandidateFilterPolicy = Array.isArray(policyOrWorkspaceUris)
    ? { enabled: true, patterns: ['Submit'], workspaceUris: policyOrWorkspaceUris }
    : {
        enabled: policyOrWorkspaceUris?.enabled ?? true,
        patterns: policyOrWorkspaceUris?.patterns ?? ['Submit'],
        workspaceUris: policyOrWorkspaceUris?.workspaceUris ?? [],
        limits: policyOrWorkspaceUris?.limits
      };

  if (
    !policy.enabled ||
    !Array.isArray(policy.patterns) ||
    !policy.patterns.includes('Submit') ||
    !Array.isArray(policy.workspaceUris)
  ) {
    return result;
  }

  const summaries = response?.trajectorySummaries;
  if (!summaries || typeof summaries !== 'object' || Array.isArray(summaries)) {
    return result;
  }

  for (const [cascadeId, summary] of Object.entries(summaries) as [string, any][]) {
    if (
      !cascadeId ||
      !summary ||
      typeof summary.trajectoryId !== 'string' ||
      !summary.trajectoryId ||
      summary.killed ||
      summary.annotations?.archived ||
      !Array.isArray(summary.waitingSteps) ||
      !belongsToWorkspace(summary, policy.workspaceUris)
    ) {
      continue;
    }

    // Ignore if cascade identifier mismatches
    if (summary.cascadeId && summary.cascadeId !== cascadeId) {
      continue;
    }

    const seenStepIndices = new Set<number>();

    for (const waiting of summary.waitingSteps) {
      const step = waiting?.step;
      // Protobuf omits zero-valued scalars so stepIndex may default to 0
      const stepIndex = waiting?.stepIndex ?? 0;

      if (!Number.isSafeInteger(stepIndex) || stepIndex < 0 || seenStepIndices.has(stepIndex)) {
        continue;
      }
      seenStepIndices.add(stepIndex);

      if (!step || step.status !== STATUS_WAITING) {
        continue;
      }

      // Validate step lineage and step index integrity against trajectory metadata
      const source = step.metadata?.sourceTrajectoryStepInfo;
      if (
        !source ||
        source.cascadeId !== cascadeId ||
        source.trajectoryId !== summary.trajectoryId ||
        (source.stepIndex ?? 0) !== stepIndex
      ) {
        continue;
      }

      const interaction = step.requestedInteraction?.interaction;
      // Only actionable automated permission approval cards.
      // Ignore interactive questionnaires, plans, diffs, or persistent grants.
      if (
        interaction?.case !== 'permission' ||
        !interaction.value?.resource ||
        ['ask_permission', 'ask_custom_permission'].includes(step.metadata?.toolCall?.name)
      ) {
        continue;
      }

      const resource = interaction.value.resource;
      if (
        typeof resource.action !== 'string' ||
        !resource.action.trim() ||
        typeof resource.target !== 'string' ||
        !resource.target.trim()
      ) {
        continue;
      }

      const fingerprint = computePayloadFingerprint(interaction.value);
      const key = `${cascadeId}:${summary.trajectoryId}:${stepIndex}:${fingerprint}`;

      const toolCall = step.metadata?.toolCall;
      const toolName = toolCall?.name || step.metadata?.toolName;

      const candidate: PermissionCandidate = {
        key,
        pattern: 'Submit',
        cascadeId,
        trajectoryId: summary.trajectoryId,
        stepIndex,
        fingerprint,
        toolCall,
        toolName,
        resource: {
          action: resource.action,
          target: resource.target,
          ...resource
        },
        request: {
          cascadeId,
          interaction: {
            trajectoryId: summary.trajectoryId,
            stepIndex,
            interaction: {
              case: 'permission',
              value: {
                allow: true,
                scope: SCOPE_ONCE
              }
            }
          }
        }
      };

      result.push(candidate);
    }
  }

  return result;
}

export const candidates = extractPermissionCandidates;

/**
 * Retrieves the normalized string URIs of all currently open workspace folders.
 */
export function getActiveWorkspaceUris(): string[] {
  try {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || !Array.isArray(folders)) {
      return [];
    }
    return folders.map(f => f.uri.toString());
  } catch (_) {
    return [];
  }
}

export interface IdeAutoSubmitStateInfo {
  phase: RpcLifecycleState;
  available: boolean;
  approved: number;
  summaryCount?: number;
  waitingStepsCount?: number;
  eligiblePermissions?: number;
  lastError?: string | null;
  quotaExhausted?: boolean;
  consecutiveFailures?: number;
  currentDelayMs?: number;
  quarantineSize?: number;
}

export interface QuarantineCacheOptions {
  maxEntries?: number;
  retentionMs?: number;
  now?: () => number;
}

/**
 * Bounded deduplication cache with a 24-hour retention window and LRU eviction.
 * Maintains memory usage strictly bounded under 2 MB.
 */
export class QuarantineCache {
  private map = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly retentionMs: number;
  private readonly now: () => number;

  constructor(options: QuarantineCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? MAX_CACHE_ENTRIES;
    this.retentionMs = options.retentionMs ?? DEFAULT_CACHE_RETENTION_MS;
    this.now = options.now ?? Date.now;
  }

  public has(key: string): boolean {
    const time = this.map.get(key);
    if (time === undefined) {
      return false;
    }
    if (this.now() - time > this.retentionMs) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  public get(key: string): number | undefined {
    if (!this.has(key)) {
      return undefined;
    }
    return this.map.get(key);
  }

  public set(key: string, timestamp?: number): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, timestamp ?? this.now());
  }

  public delete(key: string): boolean {
    return this.map.delete(key);
  }

  public prune(currentNow?: number): number {
    const ts = currentNow ?? this.now();
    let pruned = 0;
    for (const [key, time] of this.map) {
      if (ts - time > this.retentionMs) {
        this.map.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  public clear(): void {
    this.map.clear();
  }

  public get size(): number {
    return this.map.size;
  }

  public keys(): IterableIterator<string> {
    return this.map.keys();
  }

  public entries(): IterableIterator<[string, number]> {
    return this.map.entries();
  }
}

export const BoundedDeduplicationCache = QuarantineCache;
export type BoundedDeduplicationCache = QuarantineCache;

/**
 * Calculates exponential backoff delay based on consecutive failure count,
 * bounded between min (200ms) and max backoff cap (30,000ms).
 */
export function calculateBackoffDelay(
  errors: number,
  baseIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  maxBackoffMs: number = MAX_BACKOFF_DELAY_MS
): number {
  const boundedBase = Math.max(MIN_POLL_INTERVAL_MS, Math.min(MAX_POLL_INTERVAL_MS, baseIntervalMs));
  if (errors <= 0) {
    return boundedBase;
  }
  const factor = 2 ** Math.min(errors, 10);
  const delay = boundedBase * factor;
  return Math.max(boundedBase, Math.min(Math.max(maxBackoffMs, boundedBase), delay));
}

export interface CreateIdeAutoSubmitOptions {
  getExtension?: (id: string) => any;
  getPolicy?: () => CandidateFilterPolicy;
  onClick?: (event: { pattern: string; button: string; candidate?: PermissionCandidate }) => void;
  onApproval?: (event: AutoSubmitApprovalEvent) => void;
  onState?: (stateInfo: IdeAutoSubmitStateInfo) => void;
  now?: () => number;
  setTimer?: (fn: (...args: any[]) => void, ms: number) => any;
  clearTimer?: (timer: any) => void;
  requestTimeoutMs?: number;
  cache?: QuarantineCache;
  maxBackoffMs?: number;
}

/**
 * Creates the IDE RPC Auto-Submit coordinator engine.
 */
export function createIdeAutoSubmit({
  getExtension = (id: string) => {
    try {
      return vscode.extensions?.getExtension(id);
    } catch (_) {
      return undefined;
    }
  },
  getPolicy = () => ({
    enabled: true,
    patterns: ['Submit'],
    workspaceUris: getActiveWorkspaceUris()
  }),
  onClick = () => {},
  onApproval,
  onState = () => {},
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  requestTimeoutMs = 5000,
  cache: customCache,
  maxBackoffMs = MAX_BACKOFF_DELAY_MS
}: CreateIdeAutoSubmitOptions = {}) {
  let stopped = false;
  let busy = false;
  let timer: any = null;
  let controller: AbortController | null = null;
  let epoch = 0;
  let state: RpcLifecycleState = 'waiting';
  let errors = 0;
  const cache = customCache ?? new QuarantineCache({ now });
  const counts = new Map<string, number>();
  const approvalListeners = new Set<(event: AutoSubmitApprovalEvent) => void>();
  if (onApproval) {
    approvalListeners.add(onApproval);
  }

  let lastInfo: IdeAutoSubmitStateInfo = {
    phase: state,
    available: false,
    approved: 0,
    summaryCount: 0,
    waitingStepsCount: 0,
    eligiblePermissions: 0,
    consecutiveFailures: 0,
    currentDelayMs: DEFAULT_POLL_INTERVAL_MS,
    quarantineSize: 0
  };

  function report(phase: RpcLifecycleState, extra: Partial<IdeAutoSubmitStateInfo> = {}) {
    const updated: IdeAutoSubmitStateInfo = {
      ...lastInfo,
      ...extra,
      phase,
      consecutiveFailures: errors,
      quarantineSize: cache.size
    };
    const changed = phase !== state ||
      updated.available !== lastInfo.available ||
      updated.approved !== lastInfo.approved ||
      updated.lastError !== lastInfo.lastError ||
      updated.quotaExhausted !== lastInfo.quotaExhausted ||
      updated.summaryCount !== lastInfo.summaryCount ||
      updated.waitingStepsCount !== lastInfo.waitingStepsCount ||
      updated.eligiblePermissions !== lastInfo.eligiblePermissions;

    lastInfo = updated;
    state = phase;
    if (changed) {
      onState({ ...lastInfo });
    }
  }

  function invalidate(immediate: boolean = false) {
    epoch++;
    controller?.abort();
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    if (immediate && !stopped) {
      return tick();
    }
  }

  function getBaseInterval(): number {
    const pol = getPolicy();
    const raw = pol.intervalMs ?? pol.interval ?? DEFAULT_POLL_INTERVAL_MS;
    return Math.max(MIN_POLL_INTERVAL_MS, Math.min(MAX_POLL_INTERVAL_MS, Number(raw) || DEFAULT_POLL_INTERVAL_MS));
  }

  function getCurrentDelay(): number {
    return calculateBackoffDelay(errors, getBaseInterval(), maxBackoffMs);
  }

  function canRun(): boolean {
    if (stopped) {
      return false;
    }
    const policy = getPolicy();
    if (policy.enabled !== true || !Array.isArray(policy.patterns) || !policy.patterns.includes('Submit')) {
      return false;
    }
    if (policy.maxQuota && policy.maxQuota > 0 && lastInfo.approved >= policy.maxQuota) {
      return false;
    }
    return true;
  }

  async function tick() {
    if (stopped || busy) {
      return;
    }
    busy = true;
    const generation = epoch;
    controller = new AbortController();
    const signal = controller.signal;
    let deadline: any;

    const expired = new Promise<never>((_, reject) => {
      deadline = setTimer(() => {
        controller?.abort();
        reject(new Error('request-timeout'));
      }, requestTimeoutMs);
    });

    const current = () => !stopped && generation === epoch && !signal.aborted;
    const wait = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, expired]);

    try {
      const policy = getPolicy();
      if (policy.maxQuota && policy.maxQuota > 0 && lastInfo.approved >= policy.maxQuota) {
        report('dormant', { available: false, quotaExhausted: true });
        return;
      }

      if (policy.enabled === false) {
        report('disabled', { available: false });
        return;
      }

      const extension = getExtension(BUILTIN_EXTENSION_ID);
      if (!extension) {
        report('legacy', { available: false });
        return;
      }
      if (!canRun()) {
        if (policy.maxQuota && policy.maxQuota > 0 && lastInfo.approved >= policy.maxQuota) {
          report('dormant', { available: false, quotaExhausted: true });
        } else {
          report('disabled', { available: false });
        }
        return;
      }
      if (!extension.isActive) {
        report('waiting', { available: false });
        return;
      }

      const api = extension.exports;
      if (typeof api?.getRpcClient !== 'function') {
        report('unsupported', { available: false });
        return;
      }

      const client = await wait(Promise.resolve(api.getRpcClient()));
      if (!current() || !canRun()) {
        return;
      }

      if (
        !client ||
        typeof client.getAllCascadeTrajectories !== 'function' ||
        typeof client.handleCascadeUserInteraction !== 'function'
      ) {
        report('unsupported', { available: false });
        return;
      }

      const options = { signal, timeoutMs: requestTimeoutMs };
      const response: any = await wait(client.getAllCascadeTrajectories({}, options));
      if (!current() || !canRun()) {
        return;
      }

      if (!response || !response.trajectorySummaries || typeof response.trajectorySummaries !== 'object') {
        throw new Error('unsupported-summary');
      }

      errors = 0;
      report('ready', { available: true, lastError: null });

      // Clean up deduplication cache entries older than 24 hours
      cache.prune(now());

      const activePolicy = getPolicy();
      const pending = extractPermissionCandidates(response, activePolicy);
      lastInfo.summaryCount = Object.keys(response.trajectorySummaries || {}).length;
      lastInfo.eligiblePermissions = pending.length;
      let totalWaiting = 0;
      for (const s of Object.values(response.trajectorySummaries || {}) as any[]) {
        if (Array.isArray(s?.waitingSteps)) {
          totalWaiting += s.waitingSteps.length;
        }
      }
      lastInfo.waitingStepsCount = totalWaiting;

      const candidate = pending.find(item => {
        if (cache.has(item.key)) {
          return false;
        }
        const limit = Number(activePolicy.limits?.[item.pattern]);
        if (limit > 0 && (counts.get(item.pattern) || 0) >= limit) {
          return false;
        }
        return true;
      });

      if (!candidate) {
        return;
      }

      // Re-read immediately before approval so a stale snapshot, modified candidate,
      // or cancelled pending step is never submitted
      const fresh = await wait(client.getAllCascadeTrajectories({}, options));
      if (!current() || !canRun() || api !== getExtension(BUILTIN_EXTENSION_ID)?.exports) {
        return;
      }

      const freshClient = await wait(Promise.resolve(api.getRpcClient()));
      if (freshClient !== client || !current() || !canRun()) {
        return;
      }

      const latestPolicy = getPolicy();
      if (latestPolicy.maxQuota && latestPolicy.maxQuota > 0 && lastInfo.approved >= latestPolicy.maxQuota) {
        report('dormant', { available: false, quotaExhausted: true });
        return;
      }

      const limit = Number(latestPolicy.limits?.[candidate.pattern]);
      if (limit > 0 && (counts.get(candidate.pattern) || 0) >= limit) {
        return;
      }

      const freshCandidates = extractPermissionCandidates(fresh, latestPolicy);
      if (!freshCandidates.some(item => item.key === candidate.key)) {
        // Candidate dropped/cancelled by user or completed in IDE
        return;
      }

      // Pre-allocation & Race-Condition Guarding:
      // Reserve quota and record quarantine entries BEFORE initiating dispatch promise
      cache.set(candidate.key, now());
      counts.set(candidate.pattern, (counts.get(candidate.pattern) || 0) + 1);

      await wait(client.handleCascadeUserInteraction(candidate.request, options));
      lastInfo.approved++;
      errors = 0; // Reset errors upon successful interaction dispatch

      if (!stopped) {
        const approvalEvent: AutoSubmitApprovalEvent = {
          pattern: candidate.pattern,
          button: 'Submit (IDE permission, allow once)',
          candidate,
          timestamp: now()
        };
        onClick(approvalEvent);
        for (const listener of approvalListeners) {
          try {
            Promise.resolve().then(() => listener(approvalEvent)).catch(() => {});
          } catch (_) {}
        }
      }

      const finalPolicy = getPolicy();
      if (finalPolicy.maxQuota && finalPolicy.maxQuota > 0 && lastInfo.approved >= finalPolicy.maxQuota) {
        report('dormant', { available: false, quotaExhausted: true });
      } else {
        report('ready', { available: true, lastError: null });
      }
    } catch (error: any) {
      if (!stopped && generation === epoch) {
        errors++;
        const isTimeout = error?.message === 'request-timeout' ||
          (error?.message || '').toLowerCase().includes('time') ||
          error?.code === 'ETIMEDOUT';
        const msg = isTimeout
          ? 'timeout'
          : (Number.isInteger(error?.code) ? `rpc-${error.code}` : (error?.message || 'backend-unavailable'));
        report('retrying', { available: false, lastError: msg });
      }
    } finally {
      clearTimer(deadline);
      controller = null;
      busy = false;
    }
  }

  function schedule() {
    if (stopped) {
      return;
    }
    const policy = getPolicy();
    if (policy.enabled === false) {
      report('disabled', { available: false });
      return;
    }
    const delay = getCurrentDelay();
    lastInfo.currentDelayMs = delay;
    timer = setTimer(async () => {
      await tick();
      schedule();
    }, delay);
  }

  async function triggerTick() {
    stopped = false;
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    await tick();
    if (!stopped) {
      schedule();
    }
  }

  return {
    start() {
      stopped = false;
      if (!timer) {
        schedule();
      }
    },
    stop() {
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      controller?.abort();
      controller = null;
      report('disabled', { available: false });
    },
    isPolling: () => timer !== null && !stopped,
    isRunning: () => timer !== null && !stopped,
    tick,
    triggerTick,
    invalidate,
    resetApprovedCount() {
      lastInfo.approved = 0;
      counts.clear();
      if (lastInfo.phase === 'dormant') {
        report('ready', { available: true, lastError: null, quotaExhausted: false });
      }
    },
    resetStats() {
      this.resetApprovedCount();
    },
    getQuarantineCache: () => cache,
    status: (): IdeAutoSubmitStateInfo => ({
      ...lastInfo,
      currentDelayMs: getCurrentDelay(),
      quarantineSize: cache.size
    }),
    onApproval(listener: (event: AutoSubmitApprovalEvent) => void): { dispose: () => void } {
      approvalListeners.add(listener);
      return {
        dispose: () => {
          approvalListeners.delete(listener);
        }
      };
    },
    on(event: string, listener: (...args: any[]) => void): { dispose: () => void } {
      if (event === 'approval') {
        return this.onApproval(listener as (event: AutoSubmitApprovalEvent) => void);
      }
      return { dispose: () => {} };
    },
    off(event: string, listener: (...args: any[]) => void): void {
      if (event === 'approval') {
        approvalListeners.delete(listener as any);
      }
    },
    dispose() {
      stopped = true;
      approvalListeners.clear();
      invalidate();
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
    }
  };
}

export interface DiagnosticReportOptions {
  activeWorkspaceUris?: string[];
  builtinExtensionStatus?: {
    installed: boolean;
    active: boolean;
    version?: string;
  };
  config?: {
    enabled: boolean;
    intervalMs: number;
    maxQuota: number;
    notifyTelegram: boolean;
  };
  now?: () => number;
}

/**
 * Generates a human-readable, structured diagnostic report of the Auto-Submit engine status.
 */
export function generateAutoSubmitDiagnosticReport(
  status: IdeAutoSubmitStateInfo,
  options: DiagnosticReportOptions = {}
): string {
  const ts = new Date(options.now ? options.now() : Date.now()).toISOString();
  const phase = status.phase || 'waiting';
  const available = status.available ? 'Yes (RPC Client Connected)' : 'No (Disconnected / Unavailable)';
  const summaries = status.summaryCount ?? 0;
  const waitingSteps = status.waitingStepsCount ?? 0;
  const eligible = status.eligiblePermissions ?? 0;
  const approved = status.approved ?? 0;
  const maxQuota = options.config?.maxQuota ?? 0;
  const quotaStr = maxQuota > 0 ? `${maxQuota}` : '0 (Unlimited)';
  const failures = status.consecutiveFailures ?? 0;
  const delay = status.currentDelayMs ?? 1000;
  const qSize = status.quarantineSize ?? 0;
  const lastErr = status.lastError ? status.lastError : 'None';

  const extStatus = options.builtinExtensionStatus;
  const extInstalledStr = extStatus
    ? extStatus.installed
      ? extStatus.active
        ? 'Active'
        : 'Installed (Inactive)'
      : 'Not Installed'
    : 'Unknown';

  const cfg = options.config;
  const cfgEnabled = cfg ? String(cfg.enabled) : 'Unknown';
  const cfgInterval = cfg ? `${cfg.intervalMs}ms` : '1000ms';
  const cfgQuota = cfg ? `${cfg.maxQuota}` : '0';
  const cfgTelegram = cfg ? String(cfg.notifyTelegram) : 'true';

  const wsUris = options.activeWorkspaceUris && options.activeWorkspaceUris.length > 0
    ? options.activeWorkspaceUris.map(u => `  * ${u}`).join('\n')
    : '  * (No active workspaces registered)';

  // Determine actionable suggestions based on phase
  let suggestion = '';
  switch (phase) {
    case 'ready':
      suggestion = '✓ RPC Auto-Submit engine is active and operational. Monitoring for candidate permission prompts.';
      break;
    case 'waiting':
      suggestion = '⚠️ Built-in Antigravity extension (\'google.google-antigravity\') is installed but inactive.\n  Action: Open an Antigravity cascade session or workspace to activate the extension.';
      break;
    case 'legacy':
      suggestion = '⚠️ Built-in Antigravity extension (\'google.google-antigravity\') was not found.\n  Action: Ensure you are running within Google Antigravity IDE with the core extension enabled.';
      break;
    case 'unsupported':
      suggestion = '⚠️ Built-in extension does not expose the required RPC client API (\'getRpcClient\').\n  Action: Check Antigravity version compatibility or upgrade the IDE.';
      break;
    case 'disabled':
      suggestion = 'ℹ️ Automatic permission submission is currently disabled.\n  Action: Enable \'autoplan.autoSubmit.enabled: true\' in VS Code Settings to activate.';
      break;
    case 'dormant':
      suggestion = 'ℹ️ Maximum session approval quota reached.\n  Action: Increase \'autoplan.autoSubmit.maxQuota\' or reset the session to resume approvals.';
      break;
    case 'retrying':
      suggestion = `⚠️ Encountering connection errors with Antigravity RPC (Error: ${lastErr}).\n  Action: Verify the IDE background process is responsive. Backing off exponentially.`;
      break;
    default:
      suggestion = `Current phase: ${phase}. Waiting for IDE events.`;
      break;
  }

  const lines = [
    '======================================================================',
    '  Auto-Plan: Antigravity RPC Auto-Submit Diagnostics',
    '======================================================================',
    `Timestamp: ${ts}`,
    `Engine Phase: ${phase}`,
    `RPC Connectivity: ${available}`,
    '',
    '--- Runtime Engine Metrics ---',
    `- Trajectory Summaries: ${summaries}`,
    `- Waiting Steps Count: ${waitingSteps}`,
    `- Eligible Permissions: ${eligible}`,
    `- Total Approved (Session): ${approved}`,
    `- Approval Quota: ${quotaStr}`,
    `- Consecutive Failures: ${failures}`,
    `- Current Poll Interval: ${delay}ms`,
    `- Quarantine Cache Entries: ${qSize}`,
    `- Last Error: ${lastErr}`,
    '',
    '--- Configuration & Environment ---',
    `- autoplan.autoSubmit.enabled: ${cfgEnabled}`,
    `- autoplan.autoSubmit.intervalMs: ${cfgInterval}`,
    `- autoplan.autoSubmit.maxQuota: ${cfgQuota}`,
    `- autoplan.autoSubmit.notifyTelegram: ${cfgTelegram}`,
    `- Built-in Extension (google.google-antigravity): ${extInstalledStr}`,
    '- Active Workspace URIs:',
    wsUris,
    '',
    '--- Actionable Suggestions ---',
    suggestion,
    '======================================================================'
  ];

  return lines.join('\n');
}
