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
 * Scans a target folder and returns an ordered list of executable phase markdown files.
 *
 * @param folderPath Target directory containing phase markdown files.
 * @param options Scanning options.
 * @returns Sorted list of PhaseFile objects.
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
    return {
      fileName: item.fileName,
      nativePath: nativeP,
      normalizedPath: normP,
      filePath: normP,
      relativePath: normalizePath(item.relativePath),
      index: index + 1
    };
  });
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
