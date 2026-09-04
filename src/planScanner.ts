import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_PROMPT_TEMPLATE } from './config';

export interface PhaseFile {
  /** Base file name (e.g., 'phase-01-scaffold.md') */
  fileName: string;
  /** Absolute file path in native OS format */
  nativePath: string;
  /** Absolute file path with normalized forward slashes (e.g., 'd:/path/to/phase.md') */
  normalizedPath: string;
  /** Primary absolute path */
  filePath: string;
  /** Relative path from scanned root directory */
  relativePath: string;
  /** 1-based execution index */
  index: number;
  /** Phase status parsed from header */
  status: 'Completed' | 'Pending';
  /** Whether the phase is marked as completed */
  isCompleted: boolean;
}

export interface ScanOptions {
  /** Whether to scan subdirectories recursively (default: false) */
  recursive?: boolean;
}

/**
 * Directories that should always be ignored during plan scanning.
 */
export const BLACKLISTED_DIRS = new Set([
  'scratch',
  '.system_generated',
  'assets',
  'images',
  'node_modules',
  '.git',
  '.vscode',
  '.gemini',
  '.agents'
]);

/**
 * File basename regex patterns representing documentation/summary artifacts
 * that must be excluded from execution.
 */
export const ARTIFACT_BLACKLIST_PATTERNS = [
  /^plan(\..*|-.*|_.*)?$/i,
  /^summary(\..*|-.*|_.*)?$/i,
  /^overview(\..*|-.*|_.*)?$/i,
  /^walkthrough(\..*|-.*|_.*)?$/i,
  /^implementation[-_]?plan(\..*|-.*|_.*)?$/i,
  /^readme(\..*|-.*|_.*)?$/i,
  /^notes(\..*|-.*|_.*)?$/i
];

/**
 * Phase naming convention regex: e.g., 'phase-01', 'phase_1', 'phase01', '01-step'
 */
export const PHASE_NAME_PATTERN = /^(phase[-_]?\d+|\d+[-_])/i;

/**
 * Supported template placeholders.
 */
export const TEMPLATE_PLACEHOLDERS = [
  '{xxx}',
  '{path}',
  '{file}',
  '{phasePath}',
  '{phaseFile}'
];

/**
 * Checks if a given file name corresponds to a blacklisted non-phase artifact.
 */
export function isBlacklistedArtifact(fileName: string): boolean {
  const baseNameWithoutExt = path.parse(fileName).name;
  return ARTIFACT_BLACKLIST_PATTERNS.some(pattern => pattern.test(baseNameWithoutExt));
}

/**
 * Normalizes a file path to forward slashes.
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Diagnostic Stall Codes representing reasons why a phase is pending, blocked, or not executing.
 */
export type PhaseStallCode =
  | 'WAITING_FOR_PREVIOUS_PHASE'
  | 'BLOCKED_BY_PREVIOUS_FAILURE'
  | 'PREFLIGHT_TRANSPORT_FAILURE'
  | 'ORCHESTRATOR_NOT_RUNNING'
  | 'AI_RESPONSE_TIMEOUT'
  | 'HEADER_STATUS_PENDING'
  | 'UNRECOGNIZED_HEADER_SYNTAX'
  | 'DESELECTED_BY_USER'
  | 'READY_FOR_EXECUTION'
  | 'COMPLETED';

/**
 * Detailed diagnostic reason explaining why a phase is currently stalled or waiting.
 */
export interface PhaseStallReason {
  code: PhaseStallCode;
  description: string;
  blockedByPhaseIndex?: number;
  blockedByPhaseName?: string;
  remediationAction?: string;
}

/**
 * Enriched diagnostic metadata for an individual plan phase.
 */
export interface PhaseDiagnosticInfo {
  index: number;
  phaseNumber: number;
  fileName: string;
  filePath: string;
  status: 'Completed' | 'Running' | 'Pending' | 'Failed' | 'Skipped' | 'Stopped';
  isCompleted: boolean;
  isSelected: boolean;
  stallReason?: PhaseStallReason;
  executionTimeMs?: number;
  conversationId?: string;
  error?: string;
}

/**
 * Comprehensive audit report of all phases in a target plan folder.
 */
export interface PlanPhasesAuditReport {
  folderPath: string;
  totalPhases: number;
  completedCount: number;
  pendingCount: number;
  failedCount: number;
  skippedCount: number;
  runningPhase?: PhaseDiagnosticInfo;
  phases: PhaseDiagnosticInfo[];
  hasBlockers: boolean;
  primaryBlockerReason?: string;
}

/**
 * Execution context provided to phase stall analyzer during runtime or static audits.
 */
export interface PhaseExecutionContext {
  orchestratorState?: string;
  currentPhaseIndex?: number;
  selectedIndices?: Set<number> | number[];
  preflightReady?: boolean;
  preflightError?: string;
  activePhases?: Array<{
    index: number;
    phaseNumber?: number;
    fileName?: string;
    filePath?: string;
    status: 'Completed' | 'Running' | 'Pending' | 'Failed' | 'Skipped' | 'Stopped';
    error?: string;
    conversationId?: string;
    startTime?: number;
    endTime?: number;
    executionTimeMs?: number;
  }>;
}

/**
 * Completion signature regex matching varied emojis, markdown checkboxes, and casing.
 * e.g. Status: ✅ Completed, Status: 🟢 Completed, Status: ✔ Completed, Status: [x] Completed, Status: Completed, Status: Done
 */
const PHASE_COMPLETED_SIGNATURE = /^\s*status:\s*(?:\[[xX]\]|[^\w\s]+)?\s*(completed|done)\b/i;

/**
 * Pending / In Progress signature regex matching pending indicators.
 * e.g. Status: ⬜ Pending, Status: [ ] Pending, Status: Pending, Status: 🟡 In Progress, Status: Todo, Status: Queued
 */
const PHASE_PENDING_SIGNATURE = /^\s*status:\s*(?:\[\s*\]|[^\w\s]+)?\s*(pending|todo|in\s*progress|queued|waiting|running)\b/i;

/**
 * Generic status line signature for detecting status header declaration in markdown.
 */
const PHASE_HEADER_STATUS_LINE = /^\s*status:\s*(.+)$/i;

export interface PhaseHeaderInspection {
  status: 'Completed' | 'Pending' | 'Unrecognized';
  code: 'COMPLETED' | 'HEADER_STATUS_PENDING' | 'UNRECOGNIZED_HEADER_SYNTAX';
  rawStatus?: string;
  hasStatusHeader: boolean;
  headerSyntaxValid: boolean;
}

/**
 * Inspects the header section (first 30 lines) of a markdown file to diagnose status and syntax validity.
 */
export function inspectPhaseHeader(filePath: string): PhaseHeaderInspection {
  let fd: number | null = null;
  try {
    if (!fs.existsSync(filePath)) {
      return {
        status: 'Pending',
        code: 'HEADER_STATUS_PENDING',
        hasStatusHeader: false,
        headerSyntaxValid: false
      };
    }
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
    const content = buffer.toString('utf8', 0, bytesRead);
    const headerLines = content.split(/\r?\n/).slice(0, 30);

    for (const line of headerLines) {
      if (PHASE_COMPLETED_SIGNATURE.test(line)) {
        const match = line.match(PHASE_HEADER_STATUS_LINE);
        return {
          status: 'Completed',
          code: 'COMPLETED',
          rawStatus: match ? match[1].trim() : 'Completed',
          hasStatusHeader: true,
          headerSyntaxValid: true
        };
      }
      if (PHASE_PENDING_SIGNATURE.test(line)) {
        const match = line.match(PHASE_HEADER_STATUS_LINE);
        return {
          status: 'Pending',
          code: 'HEADER_STATUS_PENDING',
          rawStatus: match ? match[1].trim() : 'Pending',
          hasStatusHeader: true,
          headerSyntaxValid: true
        };
      }
      const genericMatch = line.match(PHASE_HEADER_STATUS_LINE);
      if (genericMatch) {
        return {
          status: 'Unrecognized',
          code: 'UNRECOGNIZED_HEADER_SYNTAX',
          rawStatus: genericMatch[1].trim(),
          hasStatusHeader: true,
          headerSyntaxValid: false
        };
      }
    }
    return {
      status: 'Pending',
      code: 'HEADER_STATUS_PENDING',
      hasStatusHeader: false,
      headerSyntaxValid: true
    };
  } catch {
    return {
      status: 'Pending',
      code: 'HEADER_STATUS_PENDING',
      hasStatusHeader: false,
      headerSyntaxValid: false
    };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

/**
 * Asynchronously inspects the header section (first 30 lines) of a markdown file.
 */
export async function inspectPhaseHeaderAsync(filePath: string): Promise<PhaseHeaderInspection> {
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, 4096, 0);
    const content = buffer.toString('utf8', 0, bytesRead);
    const headerLines = content.split(/\r?\n/).slice(0, 30);

    for (const line of headerLines) {
      if (PHASE_COMPLETED_SIGNATURE.test(line)) {
        const match = line.match(PHASE_HEADER_STATUS_LINE);
        return {
          status: 'Completed',
          code: 'COMPLETED',
          rawStatus: match ? match[1].trim() : 'Completed',
          hasStatusHeader: true,
          headerSyntaxValid: true
        };
      }
      if (PHASE_PENDING_SIGNATURE.test(line)) {
        const match = line.match(PHASE_HEADER_STATUS_LINE);
        return {
          status: 'Pending',
          code: 'HEADER_STATUS_PENDING',
          rawStatus: match ? match[1].trim() : 'Pending',
          hasStatusHeader: true,
          headerSyntaxValid: true
        };
      }
      const genericMatch = line.match(PHASE_HEADER_STATUS_LINE);
      if (genericMatch) {
        return {
          status: 'Unrecognized',
          code: 'UNRECOGNIZED_HEADER_SYNTAX',
          rawStatus: genericMatch[1].trim(),
          hasStatusHeader: true,
          headerSyntaxValid: false
        };
      }
    }
    return {
      status: 'Pending',
      code: 'HEADER_STATUS_PENDING',
      hasStatusHeader: false,
      headerSyntaxValid: true
    };
  } catch {
    return {
      status: 'Pending',
      code: 'HEADER_STATUS_PENDING',
      hasStatusHeader: false,
      headerSyntaxValid: false
    };
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {}
    }
  }
}

/**
 * Detects completion status of a phase markdown file by inspecting its header section (first 30 lines).
 * Reads only up to an initial 4KB chunk to avoid loading large files into RAM.
 *
 * @param filePath Target markdown file path.
 * @returns 'Completed' if completion header is found; otherwise 'Pending'.
 */
export function detectPhaseStatus(filePath: string): 'Completed' | 'Pending' {
  const inspection = inspectPhaseHeader(filePath);
  return inspection.status === 'Completed' ? 'Completed' : 'Pending';
}

/**
 * Asynchronously detects completion status of a phase markdown file by inspecting its header section (first 30 lines).
 * Reads only up to an initial 4KB chunk using bounded async I/O.
 *
 * @param filePath Target markdown file path.
 * @returns Promise resolving to 'Completed' if completion header is found; otherwise 'Pending'.
 */
export async function detectPhaseStatusAsync(filePath: string): Promise<'Completed' | 'Pending'> {
  const inspection = await inspectPhaseHeaderAsync(filePath);
  return inspection.status === 'Completed' ? 'Completed' : 'Pending';
}
/**
 * Reliably sorts phase files using natural numeric collation based on filename and numeric index.
 *
 * @param phases Array of PhaseFile objects to sort.
 * @returns A new sorted array of PhaseFile objects.
 */
export function sortPhaseFiles(phases: PhaseFile[]): PhaseFile[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...phases].sort((a, b) => {
    const nameCmp = collator.compare(a.fileName, b.fileName);
    if (nameCmp !== 0) {
      return nameCmp;
    }
    return (a.index || 0) - (b.index || 0);
  });
}

/**
 * Slices and returns all phases starting from a selected phase through to the end of the sequence.
 *
 * @param phases Collection of phase files.
 * @param targetPhaseIdentifier 1-based index, filename, normalized/native path, or phase prefix identifier.
 * @returns Array slice of PhaseFile objects from the target phase onwards.
 * @throws Error if targetPhaseIdentifier cannot be found in the phase collection.
 */
export function getPhasesFrom(
  phases: PhaseFile[],
  targetPhaseIdentifier: string | number
): PhaseFile[] {
  if (phases.length === 0) {
    throw new Error('Phase collection is empty.');
  }

  let foundIndex = -1;

  if (typeof targetPhaseIdentifier === 'number') {
    // Check 1-based index
    foundIndex = phases.findIndex(p => p.index === targetPhaseIdentifier);
    if (foundIndex === -1 && targetPhaseIdentifier >= 1 && targetPhaseIdentifier <= phases.length) {
      foundIndex = targetPhaseIdentifier - 1;
    }
  } else if (typeof targetPhaseIdentifier === 'string') {
    const rawTarget = targetPhaseIdentifier.trim();
    if (!rawTarget) {
      throw new Error('Target phase identifier cannot be empty.');
    }

    const lowerTarget = rawTarget.toLowerCase();
    const normTarget = normalizePath(rawTarget).toLowerCase();

    // 1. Exact matches (fileName, baseName, normalizedPath, nativePath, filePath)
    foundIndex = phases.findIndex(p => {
      const pFileName = p.fileName.toLowerCase();
      const pBaseName = path.parse(p.fileName).name.toLowerCase();
      const pNormPath = p.normalizedPath.toLowerCase();
      const pNativePath = normalizePath(p.nativePath).toLowerCase();
      const pFilePath = normalizePath(p.filePath).toLowerCase();

      return (
        pFileName === lowerTarget ||
        pBaseName === lowerTarget ||
        pNormPath === normTarget ||
        pNativePath === normTarget ||
        pFilePath === normTarget
      );
    });

    // 2. Prefix / start matches
    if (foundIndex === -1) {
      foundIndex = phases.findIndex(p => {
        const pFileName = p.fileName.toLowerCase();
        const pBaseName = path.parse(p.fileName).name.toLowerCase();
        return pFileName.startsWith(lowerTarget) || pBaseName.startsWith(lowerTarget);
      });
    }

    // 3. Numeric string match (e.g., '1', '02')
    if (foundIndex === -1 && /^\d+$/.test(rawTarget)) {
      const num = parseInt(rawTarget, 10);
      foundIndex = phases.findIndex(p => p.index === num);
      if (foundIndex === -1 && num >= 1 && num <= phases.length) {
        foundIndex = num - 1;
      }
    }
  }

  if (foundIndex === -1) {
    throw new Error(
      `Target phase identifier "${targetPhaseIdentifier}" not found in phase collection.`
    );
  }

  return phases.slice(foundIndex);
}

/**
 * Scans a target folder and returns an ordered list of executable phase markdown files.
 *
 * @deprecated Use `scanPlanFolderAsync` instead to prevent synchronous event loop blocking.
 * @param folderPath Target directory containing phase markdown files.
 * @param options Scanning options.
 * @returns Sorted list of PhaseFile objects with status metadata.
 * @throws Error if folder does not exist or if no valid phase files are found.
 */
export function scanPlanFolder(folderPath: string, options: ScanOptions = {}): PhaseFile[] {
  const resolvedFolder = path.resolve(folderPath);

  if (!fs.existsSync(resolvedFolder)) {
    throw new Error(`Plan directory does not exist: "${resolvedFolder}"`);
  }

  const stat = fs.statSync(resolvedFolder);
  if (!stat.isDirectory()) {
    throw new Error(`Specified path is not a directory: "${resolvedFolder}"`);
  }

  const candidateFiles: { fileName: string; fullPath: string; relativePath: string }[] = [];

  function walk(currentDir: string, relPrefix: string = '') {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryRelPath = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
      const entryFullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        const dirNameLower = entry.name.toLowerCase();
        if (BLACKLISTED_DIRS.has(dirNameLower) || dirNameLower.startsWith('.')) {
          continue;
        }
        if (options.recursive) {
          walk(entryFullPath, entryRelPath);
        }
      } else if (entry.isFile()) {
        if (!entry.name.toLowerCase().endsWith('.md')) {
          continue;
        }
        if (isBlacklistedArtifact(entry.name)) {
          continue;
        }
        candidateFiles.push({
          fileName: entry.name,
          fullPath: entryFullPath,
          relativePath: entryRelPath
        });
      }
    }
  }

  walk(resolvedFolder);

  if (candidateFiles.length === 0) {
    throw new Error(`No executable phase markdown files found in: "${resolvedFolder}"`);
  }

  // Filter for phase-specific naming conventions if present
  const phasePrefixed = candidateFiles.filter(item => PHASE_NAME_PATTERN.test(item.fileName));
  const finalCandidates = phasePrefixed.length > 0 ? phasePrefixed : candidateFiles;

  // Natural alphanumeric sorting
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  finalCandidates.sort((a, b) => collator.compare(a.fileName, b.fileName));

  return finalCandidates.map((item, index) => {
    const nativeP = path.normalize(item.fullPath);
    const normP = normalizePath(nativeP);
    const status = detectPhaseStatus(item.fullPath);
    return {
      fileName: item.fileName,
      nativePath: nativeP,
      normalizedPath: normP,
      filePath: normP,
      relativePath: normalizePath(item.relativePath),
      index: index + 1,
      status,
      isCompleted: status === 'Completed'
    };
  });
}

/**
 * Asynchronously scans a target folder and returns an ordered list of executable phase markdown files.
 *
 * @param folderPath Target directory containing phase markdown files.
 * @param options Scanning options.
 * @returns Promise resolving to a sorted list of PhaseFile objects with status metadata.
 * @throws Error if folder does not exist or if no valid phase files are found.
 */
export async function scanPlanFolderAsync(
  folderPath: string,
  options: ScanOptions = {}
): Promise<PhaseFile[]> {
  const resolvedFolder = path.resolve(folderPath);

  try {
    const stat = await fs.promises.stat(resolvedFolder);
    if (!stat.isDirectory()) {
      throw new Error(`Specified path is not a directory: "${resolvedFolder}"`);
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`Plan directory does not exist: "${resolvedFolder}"`);
    }
    throw err;
  }

  const candidateFiles: { fileName: string; fullPath: string; relativePath: string }[] = [];

  async function walk(currentDir: string, relPrefix: string = '') {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryRelPath = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
      const entryFullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        const dirNameLower = entry.name.toLowerCase();
        if (BLACKLISTED_DIRS.has(dirNameLower) || dirNameLower.startsWith('.')) {
          continue;
        }
        if (options.recursive) {
          await walk(entryFullPath, entryRelPath);
        }
      } else if (entry.isFile()) {
        if (!entry.name.toLowerCase().endsWith('.md')) {
          continue;
        }
        if (isBlacklistedArtifact(entry.name)) {
          continue;
        }
        candidateFiles.push({
          fileName: entry.name,
          fullPath: entryFullPath,
          relativePath: entryRelPath
        });
      }
    }
  }

  await walk(resolvedFolder);

  if (candidateFiles.length === 0) {
    throw new Error(`No executable phase markdown files found in: "${resolvedFolder}"`);
  }

  // Filter for phase-specific naming conventions if present
  const phasePrefixed = candidateFiles.filter(item => PHASE_NAME_PATTERN.test(item.fileName));
  const finalCandidates = phasePrefixed.length > 0 ? phasePrefixed : candidateFiles;

  // Natural alphanumeric sorting
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  finalCandidates.sort((a, b) => collator.compare(a.fileName, b.fileName));

  const results = await Promise.all(
    finalCandidates.map(async (item, index) => {
      const nativeP = path.normalize(item.fullPath);
      const normP = normalizePath(nativeP);
      const status = await detectPhaseStatusAsync(item.fullPath);
      return {
        fileName: item.fileName,
        nativePath: nativeP,
        normalizedPath: normP,
        filePath: normP,
        relativePath: normalizePath(item.relativePath),
        index: index + 1,
        status,
        isCompleted: status === 'Completed'
      };
    })
  );

  return results;
}

/**
 * Renders a prompt template by interpolating the phase file path into placeholders.
 *
 * @param template Prompt template containing placeholders such as `{xxx}`, `{path}`, etc.
 * @param phase Target PhaseFile object or absolute file path string.
 * @returns Formatted prompt string ready to send to the AI agent.
 */
export function renderPromptTemplate(
  template: string = DEFAULT_PROMPT_TEMPLATE,
  phase: PhaseFile | string
): string {
  const targetPath = typeof phase === 'string' ? normalizePath(phase) : phase.normalizedPath;
  const fileName = typeof phase === 'string' ? path.basename(phase) : phase.fileName;

  let hasPlaceholder = false;
  const rendered = template.replace(/\{(xxx|path|file|phasepath|phasefile)\}/gi, (match, tag) => {
    hasPlaceholder = true;
    const lower = tag.toLowerCase();
    if (lower === 'file' || lower === 'phasefile') {
      return fileName;
    }
    return targetPath;
  });

  if (hasPlaceholder) {
    return rendered;
  }

  // If no placeholders exist in the custom template, append the path
  return `${template.trim()}\n${targetPath}`;
}

/**
 * Diagnoses why an individual phase is pending, stalled, or blocked from executing.
 *
 * @param phase Diagnostic info or PhaseFile representation of target phase.
 * @param allPhases Complete sequence of all phases in the plan.
 * @param index Current phase index in sequence (0-based or matching array index).
 * @param context Optional runtime execution context (orchestrator state, preflight status, selections).
 * @returns PhaseStallReason if stalled / waiting / blocked; undefined if actively completed or running.
 */
export function analyzePhaseStallReason(
  phase: PhaseDiagnosticInfo | PhaseFile | { status: string; fileName: string; isCompleted?: boolean; error?: string; isSelected?: boolean; headerSyntaxValid?: boolean },
  allPhases: Array<any>,
  index: number,
  context?: PhaseExecutionContext
): PhaseStallReason | undefined {
  const currentStatus = phase.status;

  // 1. If phase is completed, no stall reason
  if (currentStatus === 'Completed' || ('isCompleted' in phase && phase.isCompleted && currentStatus !== 'Failed')) {
    return undefined;
  }

  // 2. If phase is currently running, no stall
  if (currentStatus === 'Running') {
    return undefined;
  }

  // 3. If phase itself is Failed
  if (currentStatus === 'Failed') {
    const errorMsg = (phase as any).error || 'Phase execution failed with error';
    if (/timeout|timed\s*out/i.test(errorMsg)) {
      return {
        code: 'AI_RESPONSE_TIMEOUT',
        description: errorMsg,
        remediationAction: 'Check AI output transcript or increase timeoutPerLoopMinutes setting'
      };
    }
    if (/preflight|pre-flight|transport/i.test(errorMsg)) {
      return {
        code: 'PREFLIGHT_TRANSPORT_FAILURE',
        description: errorMsg,
        remediationAction: 'Run 1-Click DOM Bridge Setup or verify transport configuration'
      };
    }
    return {
      code: 'BLOCKED_BY_PREVIOUS_FAILURE',
      description: errorMsg,
      remediationAction: 'Inspect error trace in debug log and retry phase execution'
    };
  }

  // 4. If phase was Skipped
  if (currentStatus === 'Skipped') {
    return {
      code: 'DESELECTED_BY_USER',
      description: 'Phase was skipped during execution',
      remediationAction: 'Select or resume phase to execute'
    };
  }

  // 5. For Pending phase: check preceding phases for failures or unfinished states
  const precedingPhases = allPhases.slice(0, index);

  // Check if any preceding phase failed
  const precedingFailedIndex = precedingPhases.findIndex(p => p.status === 'Failed');
  if (precedingFailedIndex !== -1) {
    const failedPhase = precedingPhases[precedingFailedIndex];
    const failedPhaseNum = ('phaseNumber' in failedPhase ? failedPhase.phaseNumber : failedPhase.index) || (precedingFailedIndex + 1);
    const failedName = failedPhase.fileName || `Phase ${failedPhaseNum}`;
    const errMsg = failedPhase.error ? `: ${failedPhase.error}` : '';
    return {
      code: 'BLOCKED_BY_PREVIOUS_FAILURE',
      description: `Blocked by failure in previous Phase ${failedPhaseNum} (${failedName})${errMsg}`,
      blockedByPhaseIndex: precedingFailedIndex,
      blockedByPhaseName: failedName,
      remediationAction: `Fix error in Phase ${failedPhaseNum} (${failedName}) or restart automation`
    };
  }

  // Check if any preceding phase is still Running or Pending
  const precedingUnfinishedIndex = precedingPhases.findIndex(p => p.status === 'Running' || p.status === 'Pending');
  if (precedingUnfinishedIndex !== -1) {
    const unfinishedPhase = precedingPhases[precedingUnfinishedIndex];
    const unfinishedNum = ('phaseNumber' in unfinishedPhase ? unfinishedPhase.phaseNumber : unfinishedPhase.index) || (precedingUnfinishedIndex + 1);
    const unfinishedName = unfinishedPhase.fileName || `Phase ${unfinishedNum}`;
    return {
      code: 'WAITING_FOR_PREVIOUS_PHASE',
      description: `Waiting for preceding Phase ${unfinishedNum} (${unfinishedName}) to complete execution`,
      blockedByPhaseIndex: precedingUnfinishedIndex,
      blockedByPhaseName: unfinishedName,
      remediationAction: 'Execution will proceed automatically when prior phases complete'
    };
  }

  // 6. All preceding phases are Completed - this phase is next in line!

  // Check user deselection
  if (context?.selectedIndices) {
    const isSelected =
      context.selectedIndices instanceof Set
        ? context.selectedIndices.has(index)
        : context.selectedIndices.includes(index);
    if (!isSelected || (phase as any).isSelected === false) {
      return {
        code: 'DESELECTED_BY_USER',
        description: 'Phase was unchecked by user in the execution checklist',
        remediationAction: 'Check the box next to this phase in the sidebar to include in execution'
      };
    }
  } else if ((phase as any).isSelected === false) {
    return {
      code: 'DESELECTED_BY_USER',
      description: 'Phase was unchecked by user in the execution checklist',
      remediationAction: 'Check the box next to this phase in the sidebar to include in execution'
    };
  }

  // Check preflight transport failure
  if (context?.preflightReady === false || context?.preflightError) {
    return {
      code: 'PREFLIGHT_TRANSPORT_FAILURE',
      description: context?.preflightError || 'Selected transport mode failed pre-flight readiness check',
      remediationAction: 'Run 1-Click DOM Bridge Setup or check transport settings'
    };
  }

  // Check header syntax validity
  if ((phase as any).headerSyntaxValid === false) {
    return {
      code: 'UNRECOGNIZED_HEADER_SYNTAX',
      description: 'Markdown header status signature is missing or malformed',
      remediationAction: 'Add valid "Status: ⬜ Pending" or "Status: ✅ Completed" header to markdown file'
    };
  }

  // Check orchestrator state
  const state = context?.orchestratorState;
  if (state === 'idle' || state === 'stopped') {
    return {
      code: 'ORCHESTRATOR_NOT_RUNNING',
      description: 'Orchestrator is currently idle or stopped',
      remediationAction: 'Click Start Automation'
    };
  }

  if (state === 'error') {
    return {
      code: 'ORCHESTRATOR_NOT_RUNNING',
      description: 'Orchestrator is in an error state',
      remediationAction: 'Resolve error and click Start Automation'
    };
  }

  if (state === 'scanning' || state === 'sending' || state === 'waiting' || state === 'delaying') {
    return {
      code: 'READY_FOR_EXECUTION',
      description: 'Phase is next in queue and ready for execution',
      remediationAction: 'Ready'
    };
  }

  // If no orchestrator state was provided (static audit)
  return {
    code: 'HEADER_STATUS_PENDING',
    description: 'Phase markdown header is marked as Pending and awaiting execution',
    remediationAction: 'Click Start Automation to begin execution'
  };
}

/**
 * Synchronously audits all phase files in a target directory and returns an aggregated diagnostic report.
 *
 * @deprecated Use `auditPlanPhasesAsync` instead to prevent synchronous event loop blocking.
 * @param folderPath Target directory containing phase markdown files.
 * @param executionContext Optional execution and runtime state context.
 * @returns PlanPhasesAuditReport containing phase diagnostic details and aggregate health.
 */
export function auditPlanPhases(
  folderPath: string,
  executionContext?: PhaseExecutionContext
): PlanPhasesAuditReport {
  const normFolderPath = normalizePath(path.resolve(folderPath));
  let phaseFiles: PhaseFile[] = [];

  try {
    phaseFiles = scanPlanFolder(normFolderPath);
  } catch (err: any) {
    return {
      folderPath: normFolderPath,
      totalPhases: 0,
      completedCount: 0,
      pendingCount: 0,
      failedCount: 0,
      skippedCount: 0,
      phases: [],
      hasBlockers: false,
      primaryBlockerReason: err?.message || String(err)
    };
  }

  const activePhaseMap = new Map<string, any>();
  if (executionContext?.activePhases) {
    for (const ap of executionContext.activePhases) {
      if (ap.fileName) {
        activePhaseMap.set(ap.fileName.toLowerCase(), ap);
        activePhaseMap.set(path.basename(ap.fileName).toLowerCase(), ap);
      }
      if (ap.filePath) {
        activePhaseMap.set(path.normalize(ap.filePath).toLowerCase(), ap);
      }
    }
  }

  const diagnosticPhases: PhaseDiagnosticInfo[] = phaseFiles.map((pf, idx) => {
    const headerInfo = inspectPhaseHeader(pf.nativePath || pf.filePath);
    const fileKey = (pf.fileName || '').toLowerCase();
    const baseKey = path.basename(pf.filePath || pf.nativePath || '').toLowerCase();
    const pathKey = (pf.filePath || pf.nativePath ? path.normalize(pf.filePath || pf.nativePath).toLowerCase() : '');

    const active = activePhaseMap.get(fileKey) || activePhaseMap.get(baseKey) || (pathKey ? activePhaseMap.get(pathKey) : undefined);

    let isSelected = true;
    if (executionContext?.selectedIndices) {
      isSelected =
        executionContext.selectedIndices instanceof Set
          ? executionContext.selectedIndices.has(idx)
          : executionContext.selectedIndices.includes(idx);
    }

    let status: 'Completed' | 'Running' | 'Pending' | 'Failed' | 'Skipped' =
      headerInfo.status === 'Completed' ? 'Completed' : 'Pending';

    let error: string | undefined = undefined;
    let conversationId: string | undefined = undefined;
    let executionTimeMs: number | undefined = undefined;

    if (active) {
      if (active.status) {
        status = active.status;
      }
      error = active.error;
      conversationId = active.conversationId;
      if (active.executionTimeMs !== undefined) {
        executionTimeMs = active.executionTimeMs;
      } else if (active.startTime && active.endTime) {
        executionTimeMs = active.endTime - active.startTime;
      }
    } else if (
      executionContext?.currentPhaseIndex === idx &&
      (executionContext.orchestratorState === 'sending' ||
        executionContext.orchestratorState === 'waiting' ||
        executionContext.orchestratorState === 'scanning' ||
        executionContext.orchestratorState === 'delaying')
    ) {
      status = 'Running';
    }

    if (!isSelected && status === 'Pending') {
      status = 'Skipped';
    }

    const diag: PhaseDiagnosticInfo & { headerSyntaxValid?: boolean } = {
      index: idx,
      phaseNumber: pf.index,
      fileName: pf.fileName,
      filePath: pf.filePath,
      status,
      isCompleted: status === 'Completed',
      isSelected,
      executionTimeMs,
      conversationId,
      error,
      headerSyntaxValid: headerInfo.headerSyntaxValid
    };

    return diag;
  });

  // Calculate stall reasons
  for (let i = 0; i < diagnosticPhases.length; i++) {
    const diag = diagnosticPhases[i];
    diag.stallReason = analyzePhaseStallReason(diag, diagnosticPhases, i, executionContext);
  }

  const totalPhases = diagnosticPhases.length;
  const completedCount = diagnosticPhases.filter(p => p.status === 'Completed').length;
  const pendingCount = diagnosticPhases.filter(p => p.status === 'Pending').length;
  const failedCount = diagnosticPhases.filter(p => p.status === 'Failed').length;
  const skippedCount = diagnosticPhases.filter(p => p.status === 'Skipped').length;
  const runningPhase = diagnosticPhases.find(p => p.status === 'Running');

  const hasBlockers =
    failedCount > 0 ||
    executionContext?.preflightReady === false ||
    diagnosticPhases.some(
      p =>
        p.stallReason?.code === 'BLOCKED_BY_PREVIOUS_FAILURE' ||
        p.stallReason?.code === 'PREFLIGHT_TRANSPORT_FAILURE' ||
        p.stallReason?.code === 'UNRECOGNIZED_HEADER_SYNTAX'
    );

  let primaryBlockerReason: string | undefined = undefined;
  if (executionContext?.preflightReady === false || executionContext?.preflightError) {
    primaryBlockerReason = executionContext.preflightError || 'Pre-flight transport readiness check failed';
  } else if (failedCount > 0) {
    const failed = diagnosticPhases.find(p => p.status === 'Failed');
    primaryBlockerReason = failed?.error || `Phase ${failed?.phaseNumber || ''} failed`;
  } else {
    const blockerPhase = diagnosticPhases.find(
      p =>
        p.stallReason?.code === 'BLOCKED_BY_PREVIOUS_FAILURE' ||
        p.stallReason?.code === 'PREFLIGHT_TRANSPORT_FAILURE' ||
        p.stallReason?.code === 'UNRECOGNIZED_HEADER_SYNTAX'
    );
    if (blockerPhase) {
      primaryBlockerReason = blockerPhase.stallReason?.description;
    }
  }

  return {
    folderPath: normFolderPath,
    totalPhases,
    completedCount,
    pendingCount,
    failedCount,
    skippedCount,
    runningPhase,
    phases: diagnosticPhases,
    hasBlockers,
    primaryBlockerReason
  };
}

/**
 * Asynchronously audits all phase files in a target directory.
 */
export async function auditPlanPhasesAsync(
  folderPath: string,
  executionContext?: PhaseExecutionContext
): Promise<PlanPhasesAuditReport> {
  const normFolderPath = normalizePath(path.resolve(folderPath));
  let phaseFiles: PhaseFile[] = [];

  try {
    phaseFiles = await scanPlanFolderAsync(normFolderPath);
  } catch (err: any) {
    return {
      folderPath: normFolderPath,
      totalPhases: 0,
      completedCount: 0,
      pendingCount: 0,
      failedCount: 0,
      skippedCount: 0,
      phases: [],
      hasBlockers: false,
      primaryBlockerReason: err?.message || String(err)
    };
  }

  const activePhaseMap = new Map<string, any>();
  if (executionContext?.activePhases) {
    for (const ap of executionContext.activePhases) {
      if (ap.fileName) {
        activePhaseMap.set(ap.fileName.toLowerCase(), ap);
        activePhaseMap.set(path.basename(ap.fileName).toLowerCase(), ap);
      }
      if (ap.filePath) {
        activePhaseMap.set(path.normalize(ap.filePath).toLowerCase(), ap);
      }
    }
  }

  const headerInspections = await Promise.all(
    phaseFiles.map(pf => inspectPhaseHeaderAsync(pf.nativePath || pf.filePath))
  );

  const diagnosticPhases: PhaseDiagnosticInfo[] = phaseFiles.map((pf, idx) => {
    const headerInfo = headerInspections[idx];
    const fileKey = (pf.fileName || '').toLowerCase();
    const baseKey = path.basename(pf.filePath || pf.nativePath || '').toLowerCase();
    const pathKey = (pf.filePath || pf.nativePath ? path.normalize(pf.filePath || pf.nativePath).toLowerCase() : '');

    const active = activePhaseMap.get(fileKey) || activePhaseMap.get(baseKey) || (pathKey ? activePhaseMap.get(pathKey) : undefined);

    let isSelected = true;
    if (executionContext?.selectedIndices) {
      isSelected =
        executionContext.selectedIndices instanceof Set
          ? executionContext.selectedIndices.has(idx)
          : executionContext.selectedIndices.includes(idx);
    }

    let status: 'Completed' | 'Running' | 'Pending' | 'Failed' | 'Skipped' =
      headerInfo.status === 'Completed' ? 'Completed' : 'Pending';

    let error: string | undefined = undefined;
    let conversationId: string | undefined = undefined;
    let executionTimeMs: number | undefined = undefined;

    if (active) {
      if (active.status) {
        status = active.status;
      }
      error = active.error;
      conversationId = active.conversationId;
      if (active.executionTimeMs !== undefined) {
        executionTimeMs = active.executionTimeMs;
      } else if (active.startTime && active.endTime) {
        executionTimeMs = active.endTime - active.startTime;
      }
    } else if (
      executionContext?.currentPhaseIndex === idx &&
      (executionContext.orchestratorState === 'sending' ||
        executionContext.orchestratorState === 'waiting' ||
        executionContext.orchestratorState === 'scanning' ||
        executionContext.orchestratorState === 'delaying')
    ) {
      status = 'Running';
    }

    if (!isSelected && status === 'Pending') {
      status = 'Skipped';
    }

    const diag: PhaseDiagnosticInfo & { headerSyntaxValid?: boolean } = {
      index: idx,
      phaseNumber: pf.index,
      fileName: pf.fileName,
      filePath: pf.filePath,
      status,
      isCompleted: status === 'Completed',
      isSelected,
      executionTimeMs,
      conversationId,
      error,
      headerSyntaxValid: headerInfo.headerSyntaxValid
    };

    return diag;
  });

  // Calculate stall reasons
  for (let i = 0; i < diagnosticPhases.length; i++) {
    const diag = diagnosticPhases[i];
    diag.stallReason = analyzePhaseStallReason(diag, diagnosticPhases, i, executionContext);
  }

  const totalPhases = diagnosticPhases.length;
  const completedCount = diagnosticPhases.filter(p => p.status === 'Completed').length;
  const pendingCount = diagnosticPhases.filter(p => p.status === 'Pending').length;
  const failedCount = diagnosticPhases.filter(p => p.status === 'Failed').length;
  const skippedCount = diagnosticPhases.filter(p => p.status === 'Skipped').length;
  const runningPhase = diagnosticPhases.find(p => p.status === 'Running');

  const hasBlockers =
    failedCount > 0 ||
    executionContext?.preflightReady === false ||
    diagnosticPhases.some(
      p =>
        p.stallReason?.code === 'BLOCKED_BY_PREVIOUS_FAILURE' ||
        p.stallReason?.code === 'PREFLIGHT_TRANSPORT_FAILURE' ||
        p.stallReason?.code === 'UNRECOGNIZED_HEADER_SYNTAX'
    );

  let primaryBlockerReason: string | undefined = undefined;
  if (executionContext?.preflightReady === false || executionContext?.preflightError) {
    primaryBlockerReason = executionContext.preflightError || 'Pre-flight transport readiness check failed';
  } else if (failedCount > 0) {
    const failed = diagnosticPhases.find(p => p.status === 'Failed');
    primaryBlockerReason = failed?.error || `Phase ${failed?.phaseNumber || ''} failed`;
  } else {
    const blockerPhase = diagnosticPhases.find(
      p =>
        p.stallReason?.code === 'BLOCKED_BY_PREVIOUS_FAILURE' ||
        p.stallReason?.code === 'PREFLIGHT_TRANSPORT_FAILURE' ||
        p.stallReason?.code === 'UNRECOGNIZED_HEADER_SYNTAX'
    );
    if (blockerPhase) {
      primaryBlockerReason = blockerPhase.stallReason?.description;
    }
  }

  return {
    folderPath: normFolderPath,
    totalPhases,
    completedCount,
    pendingCount,
    failedCount,
    skippedCount,
    runningPhase,
    phases: diagnosticPhases,
    hasBlockers,
    primaryBlockerReason
  };
}

