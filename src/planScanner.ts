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
 * Completion signature regex matching varied emojis, markdown checkboxes, and casing.
 * e.g. Status: ✅ Completed, Status: 🟢 Completed, Status: ✔ Completed, Status: [x] Completed, Status: Completed, Status: Done
 */
const PHASE_COMPLETED_SIGNATURE = /^\s*status:\s*(?:\[[xX]\]|[^\w\s]+)?\s*(completed|done)\b/i;

/**
 * Detects completion status of a phase markdown file by inspecting its header section (first 30 lines).
 * Reads only up to an initial 4KB chunk to avoid loading large files into RAM.
 *
 * @param filePath Target markdown file path.
 * @returns 'Completed' if completion header is found; otherwise 'Pending'.
 */
export function detectPhaseStatus(filePath: string): 'Completed' | 'Pending' {
  let fd: number | null = null;
  try {
    if (!fs.existsSync(filePath)) {
      return 'Pending';
    }
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
    const content = buffer.toString('utf8', 0, bytesRead);
    const headerLines = content.split(/\r?\n/).slice(0, 30);

    for (const line of headerLines) {
      if (PHASE_COMPLETED_SIGNATURE.test(line)) {
        return 'Completed';
      }
    }
    return 'Pending';
  } catch {
    return 'Pending';
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

/**
 * Asynchronously detects completion status of a phase markdown file by inspecting its header section (first 30 lines).
 * Reads only up to an initial 4KB chunk using bounded async I/O.
 *
 * @param filePath Target markdown file path.
 * @returns Promise resolving to 'Completed' if completion header is found; otherwise 'Pending'.
 */
export async function detectPhaseStatusAsync(filePath: string): Promise<'Completed' | 'Pending'> {
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, 4096, 0);
    const content = buffer.toString('utf8', 0, bytesRead);
    const headerLines = content.split(/\r?\n/).slice(0, 30);

    for (const line of headerLines) {
      if (PHASE_COMPLETED_SIGNATURE.test(line)) {
        return 'Completed';
      }
    }
    return 'Pending';
  } catch {
    return 'Pending';
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {}
    }
  }
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
