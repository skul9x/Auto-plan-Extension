import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Bot, InputFile } from 'grammy';
import { debugLogger, DebugLogger } from './debugLogger';

export type ScreenCommandRunner = (command: string, args: string[], targetPath: string) => Promise<void>;

export interface ScreenCaptureOptions {
  /** Optional custom directory to store the temporary screenshot */
  tempDir?: string;
  /** Optional explicit output file path */
  outputFilePath?: string;
  /** Optional custom command runner (for dependency injection or testing) */
  commandRunner?: ScreenCommandRunner;
  /** Timeout in milliseconds for child process execution (default: 3000ms) */
  timeoutMs?: number;
  /** Custom logger instance */
  logger?: DebugLogger;
}

/**
 * Resolves list of candidate screenshot commands and arguments for the current OS.
 */
export function getScreenCaptureCommands(
  targetPath: string,
  platform: NodeJS.Platform = process.platform
): Array<{ command: string; args: string[] }> {
  if (platform === 'linux') {
    const gnomeBinary = fs.existsSync('/usr/bin/gnome-screenshot')
      ? '/usr/bin/gnome-screenshot'
      : 'gnome-screenshot';
    return [
      { command: gnomeBinary, args: ['-f', targetPath] },
      { command: 'scrot', args: [targetPath] },
      { command: 'import', args: ['-window', 'root', targetPath] }
    ];
  } else if (platform === 'darwin') {
    return [
      { command: 'screencapture', args: ['-x', targetPath] }
    ];
  } else if (platform === 'win32') {
    const escaped = targetPath.replace(/'/g, "''");
    const psScript = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen((New-Object System.Drawing.Point(0,0)), (New-Object System.Drawing.Point(0,0)), $b.Size); $b.Save('${escaped}', [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose()`;
    return [
      { command: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', psScript] }
    ];
  }
  return [];
}

/**
 * Default child process executor with execution timeout guard.
 */
function defaultExec(command: string, args: string[], timeoutMs: number = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    child_process.execFile(command, args, { timeout: timeoutMs }, (error) => {
      if (error) {
        return reject(error);
      }
      resolve();
    });
  });
}

/**
 * Executes native desktop screen capture, safely storing output in a private temporary
 * directory with secure 0600 file permissions.
 */
export async function captureScreen(options?: ScreenCaptureOptions): Promise<string> {
  const timeoutMs = options?.timeoutMs || 3000;
  const logger = options?.logger || debugLogger;
  let targetPath = options?.outputFilePath;
  let createdTempDir: string | null = null;

  if (!targetPath) {
    if (options?.tempDir) {
      if (!fs.existsSync(options.tempDir)) {
        fs.mkdirSync(options.tempDir, { recursive: true });
        try {
          fs.chmodSync(options.tempDir, 0o700);
        } catch {}
      }
      targetPath = path.join(options.tempDir, `antigravity_screen_${Date.now()}.png`);
    } else {
      createdTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag_screen_'));
      try {
        fs.chmodSync(createdTempDir, 0o700);
      } catch {}
      targetPath = path.join(createdTempDir, `antigravity_screen_${Date.now()}.png`);
    }
  }

  const commands = getScreenCaptureCommands(targetPath);
  if (commands.length === 0) {
    throw new Error(`Unsupported platform for native screen capture: ${process.platform}`);
  }

  let success = false;
  let lastError: Error | null = null;
  const attempted: string[] = [];

  for (const item of commands) {
    attempted.push(item.command);
    try {
      if (options?.commandRunner) {
        await options.commandRunner(item.command, item.args, targetPath);
      } else {
        await defaultExec(item.command, item.args, timeoutMs);
      }

      if (fs.existsSync(targetPath)) {
        const stats = fs.statSync(targetPath);
        if (stats.size > 0) {
          try {
            fs.chmodSync(targetPath, 0o600);
          } catch {}
          success = true;
          break;
        }
      }
    } catch (err: any) {
      lastError = err;
      logger.warn('TELEGRAM', `Screen capture tool '${item.command}' failed: ${err?.message || err}`);
    }
  }

  if (!success) {
    cleanupScreenshot(targetPath);
    throw new Error(
      `Screen capture failed. Attempted: [${attempted.join(', ')}]. Last error: ${lastError?.message || 'Empty or missing image file'}`
    );
  }

  return targetPath;
}

/**
 * Removes temporary screenshot file and cleans up any parent private temp directories.
 */
export function cleanupScreenshot(filePath: string): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}

  try {
    const parent = path.dirname(filePath);
    if (path.basename(parent).startsWith('ag_screen_') && fs.existsSync(parent)) {
      fs.rmdirSync(parent);
    }
  } catch {}
}

/**
 * Captures the current desktop screen and sends it directly to Telegram using InputFile,
 * ensuring immediate cleanup of temporary files in all scenarios.
 */
export async function sendScreenCapture(
  bot: Bot,
  chatId: number | string,
  options?: ScreenCaptureOptions
): Promise<any> {
  const filePath = await captureScreen(options);
  try {
    const result = await bot.api.sendPhoto(
      chatId,
      new InputFile(filePath),
      { caption: '📸 Antigravity IDE Desktop Screen' }
    );
    return result;
  } finally {
    cleanupScreenshot(filePath);
  }
}

/**
 * Screen capture manager coordinating screenshot capture and Telegram dispatch.
 */
export class TelegramScreenManager {
  private options?: ScreenCaptureOptions;
  private logger: DebugLogger;

  constructor(options?: ScreenCaptureOptions) {
    this.options = options;
    this.logger = options?.logger || debugLogger;
  }

  public setOptions(options: ScreenCaptureOptions): void {
    this.options = options;
  }

  public getOptions(): ScreenCaptureOptions | undefined {
    return this.options;
  }

  public async capture(options?: ScreenCaptureOptions): Promise<string> {
    return captureScreen({ ...this.options, ...options });
  }

  public async send(bot: Bot, chatId: number | string, options?: ScreenCaptureOptions): Promise<any> {
    return sendScreenCapture(bot, chatId, { ...this.options, ...options });
  }
}

export const telegramScreenManager = new TelegramScreenManager();

/**
 * Formats a text progress bar: `[████████░░] 80% (4/5 phases)`.
 */
export function renderProgressBar(current: number, total: number, width: number = 10): string {
  if (total <= 0) {
    return `[${'░'.repeat(width)}] 0% (0/0 phases)`;
  }
  const clampedCurrent = Math.max(0, Math.min(current, total));
  const percentage = Math.round((clampedCurrent / total) * 100);
  const filledCount = Math.min(width, Math.max(0, Math.round((clampedCurrent / total) * width)));
  const emptyCount = width - filledCount;
  const bar = '█'.repeat(filledCount) + '░'.repeat(emptyCount);
  return `[${bar}] ${percentage}% (${clampedCurrent}/${total} phases)`;
}

/**
 * Normalizes orchestrator state into one of: 'IDLE' | 'RUNNING' | 'PAUSED' | 'ERROR'.
 */
export function mapOrchestratorState(
  state?: string,
  isRunning?: boolean
): 'IDLE' | 'RUNNING' | 'PAUSED' | 'ERROR' {
  if (!state) {
    return isRunning ? 'RUNNING' : 'IDLE';
  }
  const s = state.trim().toLowerCase();
  if (s === 'error') {
    return 'ERROR';
  }
  if (s === 'stopped' || s === 'paused') {
    return 'PAUSED';
  }
  if (
    isRunning ||
    s === 'running' ||
    s === 'sending' ||
    s === 'waiting' ||
    s === 'scanning' ||
    s === 'delaying'
  ) {
    return 'RUNNING';
  }
  return 'IDLE';
}

export interface PlanStatusInfo {
  state: 'IDLE' | 'RUNNING' | 'PAUSED' | 'ERROR';
  currentPhaseName: string;
  currentIteration: number;
  totalIterations: number;
  completedPhases: number;
  totalPhases: number;
  hasNudged?: boolean;
}

/**
 * Formats the complete status dashboard text for `/plan_status`.
 */
export function formatPlanStatus(info: PlanStatusInfo): string {
  const progressBar = renderProgressBar(info.completedPhases, info.totalPhases);
  const iterStr =
    info.totalIterations > 0
      ? `${info.currentIteration}/${info.totalIterations}`
      : `${info.currentIteration}`;

  const phaseDisplay = info.hasNudged
    ? `${info.currentPhaseName} ⚠️ Nudged (guidance sent)`
    : info.currentPhaseName;

  return [
    `📊 Auto-Plan Status:`,
    `• State: ${info.state}`,
    `• Phase: ${phaseDisplay}`,
    `• Iteration: ${iterStr}`,
    `• Progress: ${progressBar}`
  ].join('\n');
}
