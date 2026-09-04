import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { exec, execSync } from 'child_process';

/**
 * Unique HTML comment markers for bridge script injection
 */
export const TAG_START = '<!-- AUTO-PLAN-BRIDGE-START -->';
export const TAG_END = '<!-- AUTO-PLAN-BRIDGE-END -->';
export const BACKUP_SUFFIX = '.autoplan.bak';
export const DEFAULT_BRIDGE_SCRIPT_NAME = 'autoplan-dom-bridge.js';

export interface InjectorOptions {
  workbenchPath?: string;
  customAppRoot?: string;
  scriptFileName?: string;
  timestamp?: number | string;
  forceBackup?: boolean;
  forceReinject?: boolean;
  updateChecksums?: boolean;
  context?: any;
}

export interface InjectionStatus {
  isInstalled: boolean;
  tagPresent: boolean;
  scriptFileExists: boolean;
  workbenchPath: string | null;
  scriptPath: string | null;
  versionTimestamp?: string | number;
}

export interface InjectionResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface UninstallationResult {
  success: boolean;
  path?: string;
  error?: string;
}

/**
 * Escapes regex special characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recursively search for a file within a directory up to maxDepth levels
 */
export function findFileRecursive(dir: string, filename: string, maxDepth: number = 6): string | null {
  if (maxDepth < 0 || !fs.existsSync(dir)) {
    return null;
  }
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === filename) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, filename, maxDepth - 1);
        if (found) {
          return found;
        }
      }
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

/**
 * Discovers the absolute path to workbench.html across Antigravity IDE, VS Code, or Cursor.
 * Checks candidate directory structures first, falling back to bounded recursive search.
 */
export function getWorkbenchPath(customAppRoot?: string): string | null {
  let appRoot = customAppRoot;

  if (!appRoot) {
    try {
      // Try to read vscode.env.appRoot dynamically if available
      const vscode = require('vscode');
      if (vscode?.env?.appRoot) {
        appRoot = vscode.env.appRoot;
      }
    } catch {
      // vscode module might not be available in standalone test runner
    }
  }

  if (!appRoot) {
    // Fallback: check if resourcesPath or current execution dir hints at appRoot
    if ((process as any).resourcesPath) {
      const candidateApp = path.join((process as any).resourcesPath, 'app');
      if (fs.existsSync(candidateApp)) {
        appRoot = candidateApp;
      }
    }
  }

  if (!appRoot || !fs.existsSync(appRoot)) {
    return null;
  }

  // Candidate paths across various VS Code and Electron layouts
  const candidates = [
    path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
    path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
    path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.html'),
    path.join(appRoot, 'out', 'vs', 'code', 'browser', 'workbench', 'workbench.html'),
    path.join(appRoot, 'out', 'vs', 'code', 'electron-main', 'workbench', 'workbench.html'),
    path.join(appRoot, 'out', 'workbench.html'),
    path.join(appRoot, 'workbench.html')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback: Search recursively inside appRoot/out or appRoot with maxDepth 6
  const outDir = path.join(appRoot, 'out');
  if (fs.existsSync(outDir)) {
    const foundInOut = findFileRecursive(outDir, 'workbench.html', 6);
    if (foundInOut) {
      return foundInOut;
    }
  }

  return findFileRecursive(appRoot, 'workbench.html', 6);
}

/**
 * Builds the Linux Polkit elevation command string using pkexec
 */
export function buildLinuxElevationCommand(tmpPath: string, targetPath: string): string {
  const safeTmp = tmpPath.replace(/'/g, "'\\''");
  const safeTarget = targetPath.replace(/'/g, "'\\''");
  return `pkexec bash -c "cp '${safeTmp}' '${safeTarget}' && chmod 644 '${safeTarget}'"`;
}

/**
 * Builds the Windows UAC elevation command string using PowerShell Start-Process -Verb runAs
 */
export function buildWindowsElevationCommand(tmpPath: string, targetPath: string): string {
  const safeTmp = tmpPath.replace(/"/g, '`"');
  const safeTarget = targetPath.replace(/"/g, '`"');
  return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb runAs -ArgumentList '-NoProfile -NonInteractive -Command Copy-Item -LiteralPath \\\"${safeTmp}\\\" -Destination \\\"${safeTarget}\\\" -Force' -Wait"`;
}

/**
 * Computes SHA256 checksum in base64 encoding with trailing '=' stripped
 */
export function computeSha256Base64(data: Buffer | string): string {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  return crypto.createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
}

export class ElevationLockedError extends Error {
  constructor(message: string = 'An elevation prompt is already active. Please respond to the existing modal dialog.') {
    super(message);
    this.name = 'ElevationLockedError';
  }
}

let isElevationInProgress = false;

export function getIsElevationInProgress(): boolean {
  return isElevationInProgress;
}

export function setIsElevationInProgress(value: boolean): void {
  isElevationInProgress = value;
}

/**
 * Checks whether the current process has write permissions to workbench.html and its parent directory
 * without requiring elevated privileges.
 */
export function canWriteWorkbenchPath(customPath?: string): boolean {
  const wbPath = customPath || getWorkbenchPath();
  if (!wbPath) {
    return false;
  }
  try {
    if (fs.existsSync(wbPath)) {
      fs.accessSync(wbPath, fs.constants.W_OK);
      const dir = path.dirname(wbPath);
      fs.accessSync(dir, fs.constants.W_OK);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Writes content to a file, handling permissions and elevating privileges if needed
 * via native OS authentication dialogs on Linux (pkexec), Windows (runAs), and macOS (osascript).
 */
export function writeFileElevated(filePath: string, content: string): void {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (err: any) {
    if (err.code !== 'EACCES' && err.code !== 'EPERM') {
      throw err;
    }

    if (isElevationInProgress) {
      throw new ElevationLockedError('An elevation prompt is already active. Please respond to the existing modal dialog.');
    }

    isElevationInProgress = true;
    const tmpPath = path.join(os.tmpdir(), `autoplan-elevated-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);

    try {
      fs.writeFileSync(tmpPath, content, 'utf8');

      if (process.platform === 'linux') {
        const cmd = buildLinuxElevationCommand(tmpPath, filePath);
        execSync(cmd, { timeout: 30000 });
      } else if (process.platform === 'darwin') {
        const safeTmp = tmpPath.replace(/'/g, "'\\''");
        const safeTarget = filePath.replace(/'/g, "'\\''");
        const cmd = `cp '${safeTmp}' '${safeTarget}' && chmod 644 '${safeTarget}'`;
        execSync(`osascript -e 'do shell script "${cmd.replace(/"/g, '\\"')}" with administrator privileges'`, { timeout: 30000 });
      } else if (process.platform === 'win32') {
        const cmd = buildWindowsElevationCommand(tmpPath, filePath);
        execSync(cmd, { timeout: 30000 });
      } else {
        throw err;
      }
    } catch (elevErr: any) {
      if (elevErr instanceof ElevationLockedError) {
        throw elevErr;
      }
      throw new Error(`Elevated write failed: ${elevErr.message || elevErr}`);
    } finally {
      isElevationInProgress = false;
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {
        // Ignore unlink error
      }
    }
  }
}

/**
 * Asynchronously writes content to a file, elevating privileges if needed
 * via native OS authentication dialogs without blocking the Node.js event loop.
 * Implements an elevation mutex (single-flight lock) to prevent modal dialog flooding.
 */
export async function writeFileElevatedAsync(filePath: string, content: string): Promise<void> {
  try {
    await fs.promises.writeFile(filePath, content, 'utf8');
    return;
  } catch (err: any) {
    if (err.code !== 'EACCES' && err.code !== 'EPERM') {
      throw err;
    }

    if (isElevationInProgress) {
      throw new ElevationLockedError('An elevation prompt is already active. Please respond to the existing modal dialog.');
    }

    isElevationInProgress = true;
    const tmpPath = path.join(os.tmpdir(), `autoplan-elevated-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);

    try {
      await fs.promises.writeFile(tmpPath, content, 'utf8');

      let cmd: string;
      if (process.platform === 'linux') {
        cmd = buildLinuxElevationCommand(tmpPath, filePath);
      } else if (process.platform === 'darwin') {
        const safeTmp = tmpPath.replace(/'/g, "'\\''");
        const safeTarget = filePath.replace(/'/g, "'\\''");
        const inner = `cp '${safeTmp}' '${safeTarget}' && chmod 644 '${safeTarget}'`;
        cmd = `osascript -e 'do shell script "${inner.replace(/"/g, '\\"')}" with administrator privileges'`;
      } else if (process.platform === 'win32') {
        cmd = buildWindowsElevationCommand(tmpPath, filePath);
      } else {
        throw err;
      }

      await new Promise<void>((resolve, reject) => {
        exec(cmd, { timeout: 30000 }, (execErr, _stdout, _stderr) => {
          if (execErr) {
            reject(new Error(`Elevated write failed: ${execErr.message || execErr}`));
          } else {
            resolve();
          }
        });
      });
    } catch (elevErr: any) {
      if (elevErr instanceof ElevationLockedError) {
        throw elevErr;
      }
      throw new Error(`Elevated write failed: ${elevErr.message || elevErr}`);
    } finally {
      isElevationInProgress = false;
      try {
        if (fs.existsSync(tmpPath)) {
          await fs.promises.unlink(tmpPath);
        }
      } catch {
        // Ignore unlink error
      }
    }
  }
}

/**
 * Checks whether the DOM bridge script is currently injected in workbench HTML or given content
 */
export function isBridgeInstalled(htmlContentOrFilePath?: string): boolean {
  if (!htmlContentOrFilePath) {
    const wbPath = getWorkbenchPath();
    if (!wbPath) {
      return false;
    }
    try {
      if (!fs.existsSync(wbPath)) {
        return false;
      }
      const content = fs.readFileSync(wbPath, 'utf8');
      return content.includes(TAG_START) && content.includes(TAG_END);
    } catch {
      return false;
    }
  }

  if (htmlContentOrFilePath.includes(TAG_START) && htmlContentOrFilePath.includes(TAG_END)) {
    return true;
  }

  try {
    if (fs.existsSync(htmlContentOrFilePath)) {
      const content = fs.readFileSync(htmlContentOrFilePath, 'utf8');
      return content.includes(TAG_START) && content.includes(TAG_END);
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Builds the HTML script tag block with timestamp query parameter
 */
export function buildBridgeScriptTag(timestamp?: number | string, scriptFileName: string = DEFAULT_BRIDGE_SCRIPT_NAME): string {
  const ts = timestamp !== undefined ? timestamp : Date.now();
  return `${TAG_START}\n\t<script src="${scriptFileName}?v=${ts}"></script>\n\t${TAG_END}`;
}

/**
 * Suppress corruption banner script to inject or execute in DOM
 */
export function suppressCorruptBannerScript(): string {
  return `(function suppressCorruptionBanner() {
  function dismissBanner() {
    try {
      const toasts = document.querySelectorAll('.notification-toast, .notifications-toasts .monaco-list-row');
      toasts.forEach(toast => {
        const text = toast.textContent || '';
        if (text.includes('corrupt') || text.includes('installation') || text.includes('tampered')) {
          const closeBtn = toast.querySelector('.codicon-close, .clear-notification-action, [aria-label*="Close"], [title*="Close"]');
          if (closeBtn && typeof (closeBtn as HTMLElement).click === 'function') {
            (closeBtn as HTMLElement).click();
          } else {
            (toast as HTMLElement).style.display = 'none';
          }
        }
      });
    } catch (_) {}
  }

  dismissBanner();
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => dismissBanner());
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
})();`;
}

/**
 * Updates product.json checksums to suppress "Your installation appears to be corrupt" warnings
 */
export function updateProductChecksums(workbenchPath?: string): boolean {
  try {
    let productJsonPath: string | null = null;

    if ((process as any).resourcesPath) {
      const candidate = path.join((process as any).resourcesPath, 'app', 'product.json');
      if (fs.existsSync(candidate)) {
        productJsonPath = candidate;
      }
    }

    if (!productJsonPath) {
      const wb = workbenchPath || getWorkbenchPath();
      if (wb) {
        let currentDir = path.dirname(wb);
        for (let i = 0; i < 8; i++) {
          const candidate = path.join(currentDir, 'product.json');
          if (fs.existsSync(candidate)) {
            productJsonPath = candidate;
            break;
          }
          const parent = path.dirname(currentDir);
          if (parent === currentDir) break;
          currentDir = parent;
        }
      }
    }

    if (!productJsonPath || !fs.existsSync(productJsonPath)) {
      return false;
    }

    const productContent = fs.readFileSync(productJsonPath, 'utf8');
    const productJson = JSON.parse(productContent);

    if (!productJson.checksums || typeof productJson.checksums !== 'object') {
      return false;
    }

    const appRoot = path.dirname(productJsonPath);
    const outDir = path.join(appRoot, 'out');
    let updated = false;

    for (const relativePath of Object.keys(productJson.checksums)) {
      const nativeRelative = relativePath.split('/').join(path.sep);
      let targetFile = path.join(outDir, nativeRelative);
      if (!fs.existsSync(targetFile)) {
        targetFile = path.join(appRoot, nativeRelative);
      }

      if (fs.existsSync(targetFile)) {
        const fileData = fs.readFileSync(targetFile);
        const hash = computeSha256Base64(fileData);
        if (productJson.checksums[relativePath] !== hash) {
          productJson.checksums[relativePath] = hash;
          updated = true;
        }
      }
    }

    const wb = workbenchPath || getWorkbenchPath();
    if (wb && fs.existsSync(wb)) {
      const fileData = fs.readFileSync(wb);
      const hash = computeSha256Base64(fileData);

      const relToOut = path.relative(outDir, wb).replace(/\\/g, '/');
      const relToApp = path.relative(appRoot, wb).replace(/\\/g, '/');
      const standardKey = 'vs/code/electron-sandbox/workbench/workbench.html';

      if (productJson.checksums[relToOut] !== undefined && productJson.checksums[relToOut] !== hash) {
        productJson.checksums[relToOut] = hash;
        updated = true;
      } else if (productJson.checksums[relToApp] !== undefined && productJson.checksums[relToApp] !== hash) {
        productJson.checksums[relToApp] = hash;
        updated = true;
      } else if (productJson.checksums[standardKey] !== undefined && productJson.checksums[standardKey] !== hash) {
        productJson.checksums[standardKey] = hash;
        updated = true;
      }
    }

    if (updated) {
      writeFileElevated(productJsonPath, JSON.stringify(productJson, null, '\t'));
      return true;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Asynchronously updates product.json checksums using non-blocking writeFileElevatedAsync
 */
export async function updateProductChecksumsAsync(workbenchPath?: string): Promise<boolean> {
  try {
    let productJsonPath: string | null = null;

    if ((process as any).resourcesPath) {
      const candidate = path.join((process as any).resourcesPath, 'app', 'product.json');
      if (fs.existsSync(candidate)) {
        productJsonPath = candidate;
      }
    }

    if (!productJsonPath) {
      const wb = workbenchPath || getWorkbenchPath();
      if (wb) {
        let currentDir = path.dirname(wb);
        for (let i = 0; i < 8; i++) {
          const candidate = path.join(currentDir, 'product.json');
          if (fs.existsSync(candidate)) {
            productJsonPath = candidate;
            break;
          }
          const parent = path.dirname(currentDir);
          if (parent === currentDir) break;
          currentDir = parent;
        }
      }
    }

    if (!productJsonPath || !fs.existsSync(productJsonPath)) {
      return false;
    }

    const productContent = await fs.promises.readFile(productJsonPath, 'utf8');
    const productJson = JSON.parse(productContent);

    if (!productJson.checksums || typeof productJson.checksums !== 'object') {
      return false;
    }

    const appRoot = path.dirname(productJsonPath);
    const outDir = path.join(appRoot, 'out');
    let updated = false;

    for (const relativePath of Object.keys(productJson.checksums)) {
      const nativeRelative = relativePath.split('/').join(path.sep);
      let targetFile = path.join(outDir, nativeRelative);
      if (!fs.existsSync(targetFile)) {
        targetFile = path.join(appRoot, nativeRelative);
      }

      if (fs.existsSync(targetFile)) {
        const fileData = await fs.promises.readFile(targetFile);
        const hash = computeSha256Base64(fileData);
        if (productJson.checksums[relativePath] !== hash) {
          productJson.checksums[relativePath] = hash;
          updated = true;
        }
      }
    }

    const wb = workbenchPath || getWorkbenchPath();
    if (wb && fs.existsSync(wb)) {
      const fileData = await fs.promises.readFile(wb);
      const hash = computeSha256Base64(fileData);

      const relToOut = path.relative(outDir, wb).replace(/\\/g, '/');
      const relToApp = path.relative(appRoot, wb).replace(/\\/g, '/');
      const standardKey = 'vs/code/electron-sandbox/workbench/workbench.html';

      if (productJson.checksums[relToOut] !== undefined && productJson.checksums[relToOut] !== hash) {
        productJson.checksums[relToOut] = hash;
        updated = true;
      } else if (productJson.checksums[relToApp] !== undefined && productJson.checksums[relToApp] !== hash) {
        productJson.checksums[relToApp] = hash;
        updated = true;
      } else if (productJson.checksums[standardKey] !== undefined && productJson.checksums[standardKey] !== hash) {
        productJson.checksums[standardKey] = hash;
        updated = true;
      }
    }

    if (updated) {
      await writeFileElevatedAsync(productJsonPath, JSON.stringify(productJson, null, '\t'));
      return true;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Strips any injected bridge script tags from HTML content
 */
export function removeBridgeTagsFromHtml(html: string): string {
  const tagRegex = new RegExp(`\\s*${escapeRegex(TAG_START)}[\\s\\S]*?${escapeRegex(TAG_END)}\\s*`, 'g');
  return html.replace(tagRegex, '\n');
}

/**
 * Builds bridge script content boilerplate or loads from media file if available
 */
export function buildBridgeScriptContent(_context?: any): string {
  const candidatePaths: string[] = [];
  if (_context?.extensionPath) {
    candidatePaths.push(path.join(_context.extensionPath, 'media', 'autoplan-dom-bridge.js'));
  }
  candidatePaths.push(
    path.resolve(__dirname, '../media/autoplan-dom-bridge.js'),
    path.resolve(__dirname, '../../media/autoplan-dom-bridge.js'),
    path.resolve(process.cwd(), 'media/autoplan-dom-bridge.js')
  );
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        return fs.readFileSync(p, 'utf8');
      } catch {}
    }
  }
  return `/* Auto-Plan DOM Bridge Initial Script */
(function() {
  console.log('[Auto-Plan] DOM Bridge script loaded.');
})();
`;
}

/**
 * Installs the DOM bridge script tag into workbench.html.
 * Idempotent: replaces previous version tag without duplicate entries.
 * Automatically manages backup (workbench.html.autoplan.bak).
 */
export function installBridgeScript(options: InjectorOptions = {}): InjectionResult {
  const wbPath = options.workbenchPath || getWorkbenchPath(options.customAppRoot);
  if (!wbPath || !fs.existsSync(wbPath)) {
    return {
      success: false,
      error: `workbench.html not found. AppRoot: ${options.customAppRoot || 'auto-detect failed'}`
    };
  }

  try {
    const rawContent = fs.readFileSync(wbPath, 'utf8');
    const wbDir = path.dirname(wbPath);
    const scriptFileName = options.scriptFileName || DEFAULT_BRIDGE_SCRIPT_NAME;
    const scriptFilePath = path.join(wbDir, scriptFileName);

    const scriptContent = buildBridgeScriptContent(options.context);
    let scriptNeedsUpdate = true;
    if (fs.existsSync(scriptFilePath)) {
      try {
        const existingScript = fs.readFileSync(scriptFilePath, 'utf8');
        scriptNeedsUpdate = existingScript !== scriptContent;
      } catch {
        scriptNeedsUpdate = true;
      }
    }

    // Idempotency check: avoid redundant file writes when bridge is already injected, timestamp matches, and script is up to date
    const timestampSpecified = options.timestamp !== undefined;
    const tagMatchesCurrentTimestamp = timestampSpecified ? rawContent.includes(`?v=${options.timestamp}`) : true;

    if (!options.forceReinject && isBridgeInstalled(rawContent) && !scriptNeedsUpdate && tagMatchesCurrentTimestamp && !options.forceBackup) {
      return {
        success: true,
        path: wbPath
      };
    }

    const cleanOriginalContent = removeBridgeTagsFromHtml(rawContent);
    const backupPath = `${wbPath}${BACKUP_SUFFIX}`;

    // Manage clean backup: only create if does not exist or forceBackup is set,
    // and ensure stale backup is refreshed if current active workbench is newer/different
    let shouldWriteBackup = !fs.existsSync(backupPath) || options.forceBackup;
    if (!shouldWriteBackup && fs.existsSync(backupPath)) {
      try {
        const existingBackup = fs.readFileSync(backupPath, 'utf8');
        if (removeBridgeTagsFromHtml(existingBackup).trim() !== cleanOriginalContent.trim()) {
          shouldWriteBackup = true;
        }
      } catch {
        shouldWriteBackup = true;
      }
    }

    if (shouldWriteBackup) {
      writeFileElevated(backupPath, cleanOriginalContent);
    }

    // Strip any existing tag to guarantee idempotency
    const cleanContent = cleanOriginalContent;
    const tagBlock = buildBridgeScriptTag(options.timestamp, scriptFileName);

    let newContent: string;
    if (cleanContent.includes('</body>')) {
      newContent = cleanContent.replace('</body>', `\t${tagBlock}\n</body>`);
    } else if (cleanContent.includes('</html>')) {
      newContent = cleanContent.replace('</html>', `\t${tagBlock}\n</html>`);
    } else {
      newContent = `${cleanContent}\n${tagBlock}\n`;
    }

    writeFileElevated(wbPath, newContent);

    // Also write/copy the updated DOM bridge script into workbench directory
    writeFileElevated(scriptFilePath, scriptContent);

    if (options.updateChecksums !== false) {
      updateProductChecksums(wbPath);
    }

    return {
      success: true,
      path: wbPath
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}

/**
 * Injects DOM bridge script into workbench.html (alias for installBridgeScript with cache-busting support).
 */
export function injectWorkbenchHtml(options: InjectorOptions = {}): InjectionResult {
  return installBridgeScript(options);
}

/**
 * Asynchronously installs the DOM bridge script tag into workbench.html.
 * Idempotent, non-blocking elevation, and manages clean backup.
 */
export async function installBridgeScriptAsync(options: InjectorOptions = {}): Promise<InjectionResult> {
  const wbPath = options.workbenchPath || getWorkbenchPath(options.customAppRoot);
  if (!wbPath || !fs.existsSync(wbPath)) {
    return {
      success: false,
      error: `workbench.html not found. AppRoot: ${options.customAppRoot || 'auto-detect failed'}`
    };
  }

  try {
    const rawContent = await fs.promises.readFile(wbPath, 'utf8');
    const wbDir = path.dirname(wbPath);
    const scriptFileName = options.scriptFileName || DEFAULT_BRIDGE_SCRIPT_NAME;
    const scriptFilePath = path.join(wbDir, scriptFileName);

    const scriptContent = buildBridgeScriptContent(options.context);
    let scriptNeedsUpdate = true;
    if (fs.existsSync(scriptFilePath)) {
      try {
        const existingScript = await fs.promises.readFile(scriptFilePath, 'utf8');
        scriptNeedsUpdate = existingScript !== scriptContent;
      } catch {
        scriptNeedsUpdate = true;
      }
    }

    // Idempotency check: avoid redundant file writes when bridge is already injected, timestamp matches, and script is up to date
    const timestampSpecified = options.timestamp !== undefined;
    const tagMatchesCurrentTimestamp = timestampSpecified ? rawContent.includes(`?v=${options.timestamp}`) : true;

    if (!options.forceReinject && isBridgeInstalled(rawContent) && !scriptNeedsUpdate && tagMatchesCurrentTimestamp && !options.forceBackup) {
      return {
        success: true,
        path: wbPath
      };
    }

    const cleanOriginalContent = removeBridgeTagsFromHtml(rawContent);
    const backupPath = `${wbPath}${BACKUP_SUFFIX}`;

    // Manage clean backup: only create if does not exist or forceBackup is set,
    // and ensure stale backup is refreshed if current active workbench is newer/different
    let shouldWriteBackup = !fs.existsSync(backupPath) || options.forceBackup;
    if (!shouldWriteBackup && fs.existsSync(backupPath)) {
      try {
        const existingBackup = await fs.promises.readFile(backupPath, 'utf8');
        if (removeBridgeTagsFromHtml(existingBackup).trim() !== cleanOriginalContent.trim()) {
          shouldWriteBackup = true;
        }
      } catch {
        shouldWriteBackup = true;
      }
    }

    if (shouldWriteBackup) {
      await writeFileElevatedAsync(backupPath, cleanOriginalContent);
    }

    // Strip any existing tag to guarantee idempotency
    const cleanContent = cleanOriginalContent;
    const tagBlock = buildBridgeScriptTag(options.timestamp, scriptFileName);

    let newContent: string;
    if (cleanContent.includes('</body>')) {
      newContent = cleanContent.replace('</body>', `\t${tagBlock}\n</body>`);
    } else if (cleanContent.includes('</html>')) {
      newContent = cleanContent.replace('</html>', `\t${tagBlock}\n</html>`);
    } else {
      newContent = `${cleanContent}\n${tagBlock}\n`;
    }

    await writeFileElevatedAsync(wbPath, newContent);

    // Also write/copy the updated DOM bridge script into workbench directory
    await writeFileElevatedAsync(scriptFilePath, scriptContent);

    if (options.updateChecksums !== false) {
      await updateProductChecksumsAsync(wbPath);
    }

    return {
      success: true,
      path: wbPath
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}

/**
 * Asynchronously injects DOM bridge script into workbench.html (alias for installBridgeScriptAsync).
 */
export const injectWorkbenchHtmlAsync = installBridgeScriptAsync;

/**
 * Diagnostic check for DOM Bridge injection status.
 * Verifies both the HTML script tag and physical script existence in the workbench directory.
 */
export function getInjectionStatus(options: InjectorOptions = {}): InjectionStatus {
  const wbPath = options.workbenchPath || getWorkbenchPath(options.customAppRoot);
  if (!wbPath || !fs.existsSync(wbPath)) {
    return {
      isInstalled: false,
      tagPresent: false,
      scriptFileExists: false,
      workbenchPath: wbPath || null,
      scriptPath: null
    };
  }

  let tagPresent = false;
  let versionTimestamp: string | number | undefined = undefined;
  try {
    const content = fs.readFileSync(wbPath, 'utf8');
    tagPresent = content.includes(TAG_START) && content.includes(TAG_END);
    if (tagPresent) {
      const match = content.match(/autoplan-dom-bridge\.js\?v=([^\s"']+)/);
      if (match) {
        versionTimestamp = match[1];
      }
    }
  } catch {
    tagPresent = false;
  }

  const wbDir = path.dirname(wbPath);
  const scriptFileName = options.scriptFileName || DEFAULT_BRIDGE_SCRIPT_NAME;
  const scriptPath = path.join(wbDir, scriptFileName);
  const scriptFileExists = fs.existsSync(scriptPath);

  return {
    isInstalled: tagPresent && scriptFileExists,
    tagPresent,
    scriptFileExists,
    workbenchPath: wbPath,
    scriptPath: scriptPath,
    versionTimestamp
  };
}

/**
 * Uninstalls the DOM bridge script tag from workbench.html.
 * Restores original content and cleans up tag markers, backup file, and sidecar script file if present.
 */
export function uninstallBridgeScript(options: InjectorOptions = {}): UninstallationResult {
  const wbPath = options.workbenchPath || getWorkbenchPath(options.customAppRoot);
  if (!wbPath || !fs.existsSync(wbPath)) {
    return {
      success: false,
      error: `workbench.html not found. AppRoot: ${options.customAppRoot || 'auto-detect failed'}`
    };
  }

  try {
    const currentRaw = fs.readFileSync(wbPath, 'utf8');
    const restoredContent = removeBridgeTagsFromHtml(currentRaw);
    writeFileElevated(wbPath, restoredContent);

    const backupPath = `${wbPath}${BACKUP_SUFFIX}`;
    if (fs.existsSync(backupPath)) {
      try {
        fs.unlinkSync(backupPath);
      } catch {
        // Ignore unlink error
      }
    }

    // Also remove the sidecar script file if present
    const wbDir = path.dirname(wbPath);
    const scriptFile = path.join(wbDir, options.scriptFileName || DEFAULT_BRIDGE_SCRIPT_NAME);
    if (fs.existsSync(scriptFile)) {
      try {
        fs.unlinkSync(scriptFile);
      } catch {
        // Ignore unlink error
      }
    }

    if (options.updateChecksums !== false) {
      updateProductChecksums(wbPath);
    }

    return {
      success: true,
      path: wbPath
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}

/**
 * Asynchronously uninstalls the DOM bridge script tag from workbench.html.
 * Restores original content, unlinks temporary and sidecar files, and updates checksums asynchronously.
 */
export async function uninstallBridgeScriptAsync(options: InjectorOptions = {}): Promise<UninstallationResult> {
  const wbPath = options.workbenchPath || getWorkbenchPath(options.customAppRoot);
  if (!wbPath || !fs.existsSync(wbPath)) {
    return {
      success: false,
      error: `workbench.html not found. AppRoot: ${options.customAppRoot || 'auto-detect failed'}`
    };
  }

  try {
    const currentRaw = await fs.promises.readFile(wbPath, 'utf8');
    const restoredContent = removeBridgeTagsFromHtml(currentRaw);
    await writeFileElevatedAsync(wbPath, restoredContent);

    const backupPath = `${wbPath}${BACKUP_SUFFIX}`;
    if (fs.existsSync(backupPath)) {
      try {
        await fs.promises.unlink(backupPath);
      } catch {
        // Ignore unlink error
      }
    }

    // Also remove the sidecar script file if present
    const wbDir = path.dirname(wbPath);
    const scriptFile = path.join(wbDir, options.scriptFileName || DEFAULT_BRIDGE_SCRIPT_NAME);
    if (fs.existsSync(scriptFile)) {
      try {
        await fs.promises.unlink(scriptFile);
      } catch {
        // Ignore unlink error
      }
    }

    if (options.updateChecksums !== false) {
      await updateProductChecksumsAsync(wbPath);
    }

    return {
      success: true,
      path: wbPath
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || String(err)
    };
  }
}
