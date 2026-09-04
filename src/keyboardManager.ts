import * as vscode from 'vscode';
import { exec, execSync, execFile } from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ForeignWindowFocusError extends Error {
  public readonly detectedTitle: string;
  public readonly detectedProcess?: string;
  constructor(detectedTitle: string, detectedProcess?: string) {
    const procInfo = detectedProcess ? ` [process: ${detectedProcess}]` : '';
    super(`ForeignWindowFocusError: Active window is not VS Code (detected: "${detectedTitle}"${procInfo}). Keystroke injection aborted to prevent blind input corruption.`);
    this.name = 'ForeignWindowFocusError';
    this.detectedTitle = detectedTitle;
    this.detectedProcess = detectedProcess;
    Object.setPrototypeOf(this, ForeignWindowFocusError.prototype);
  }
}

export interface ActiveWindowInfo {
  isTarget: boolean;
  windowTitle: string;
  processName?: string;
  pid?: number;
}

export interface BatchPromptOptions {
  /** Delay after Ctrl+Shift+L to wait for chat UI to open and focus (ms). Default: 800ms */
  focusDelayMs?: number;
  /** Delay after Ctrl+A (ms). Default: 100ms */
  selectDelayMs?: number;
  /** Delay after Ctrl+V (ms). Default: 150ms */
  pasteDelayMs?: number;
  /** Delay after Enter (ms). Default: 300ms */
  submitDelayMs?: number;
  /** Custom active window validator for testing or simulation */
  activeWindowValidator?: () => Promise<ActiveWindowInfo>;
  /** Skip active window focus check (e.g. for headless CI environments) */
  skipFocusCheck?: boolean;
}

export interface BatchAction {
  type: 'sendKeys' | 'sleep';
  value: string | number;
}

export interface KeyboardManagerOptions {
  /** Delay after Ctrl+Shift+L to wait for chat UI to open and focus (ms). Default: 800ms */
  focusDelayMs?: number;
  /** Delay after Ctrl+A (ms). Default: 100ms */
  selectDelayMs?: number;
  /** Delay after Ctrl+V (ms). Default: 150ms */
  pasteDelayMs?: number;
  /** Delay after Enter (ms). Default: 300ms */
  submitDelayMs?: number;
  /** Custom sender hook for testing or environment simulation */
  customKeySender?: (keys: string) => Promise<void>;
  /** Custom clipboard setter for testing or environment simulation */
  customClipboardSetter?: (text: string) => Promise<void>;
  /** Custom batch sender hook for testing or environment simulation */
  customBatchSender?: (batchScript: string, actions: BatchAction[]) => Promise<void>;
  /** Custom active window validator for testing or simulation */
  activeWindowValidator?: () => Promise<ActiveWindowInfo>;
  /** Skip active window focus check (e.g. for headless CI environments) */
  skipFocusCheck?: boolean;
}

/**
 * Checks whether an active window title and/or process matches approved editor targets.
 */
export function isApprovedEditor(windowTitle: string, processName?: string, pid?: number): boolean {
  if (pid && (pid === process.pid || pid === process.ppid)) {
    return true;
  }

  const approvedProcesses = ['code', 'electron', 'visual studio code', 'antigravity', 'vscodium', 'cursor', 'windsurf'];
  const titlePatterns = [
    /visual studio code/i,
    /(?:^|\s|-|_|\/)code(?:\s|-|_|\/|$)/i,
    /antigravity/i,
    /vscodium/i,
    /cursor/i,
    /windsurf/i
  ];

  const cleanTitle = (windowTitle || '').trim();
  const cleanProcess = (processName || '').trim().toLowerCase();

  const titleMatches = titlePatterns.some(p => p.test(cleanTitle));

  if (cleanProcess) {
    const procMatches = approvedProcesses.some(p => {
      const lower = p.toLowerCase();
      return cleanProcess === lower ||
             cleanProcess.startsWith(lower + '.') ||
             cleanProcess.includes(lower);
    });
    return procMatches && titleMatches;
  }

  return titleMatches;
}

/**
 * Queries the OS foreground window and verifies if it belongs to an approved editor instance.
 */
export async function inspectActiveWindow(): Promise<ActiveWindowInfo> {
  const platform = process.platform;
  try {
    if (platform === 'linux') {
      return await inspectLinuxActiveWindow();
    } else if (platform === 'win32') {
      return await inspectWindowsActiveWindow();
    } else if (platform === 'darwin') {
      return await inspectMacActiveWindow();
    }
  } catch {
    // Return safe fallback without crashing
  }
  return {
    isTarget: false,
    windowTitle: 'Unknown / Headless Window',
    processName: undefined,
    pid: undefined
  };
}

async function inspectLinuxActiveWindow(): Promise<ActiveWindowInfo> {
  try {
    // Try xdotool first
    try {
      const winId = execSync('xdotool getactivewindow', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 }).trim();
      if (winId) {
        let windowTitle = '';
        let pid: number | undefined;
        try {
          windowTitle = execSync(`xdotool getwindowname ${winId}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 }).trim();
        } catch {}
        try {
          const pidStr = execSync(`xdotool getwindowpid ${winId}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 }).trim();
          if (pidStr && !isNaN(parseInt(pidStr, 10))) {
            pid = parseInt(pidStr, 10);
          }
        } catch {}

        let processName: string | undefined;
        if (pid) {
          try {
            processName = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 }).trim();
          } catch {}
        }

        const isTarget = isApprovedEditor(windowTitle, processName, pid);
        return { isTarget, windowTitle, processName, pid };
      }
    } catch {
      // Fallback to xprop below
    }

    // Fallback: xprop
    try {
      const rootOut = execSync('xprop -root _NET_ACTIVE_WINDOW', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 }).trim();
      const match = rootOut.match(/window id #\s*(0x[0-9a-fA-F]+|\d+)/);
      if (match) {
        const winId = match[1];
        let windowTitle = '';
        try {
          const titleOut = execSync(`xprop -id ${winId} _NET_WM_NAME WM_NAME`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 });
          const titleMatch = titleOut.match(/(?:_NET_WM_NAME|WM_NAME)\([^)]*\)\s*=\s*"([^"]*)"/);
          if (titleMatch) {
            windowTitle = titleMatch[1];
          }
        } catch {}

        let pid: number | undefined;
        let processName: string | undefined;
        try {
          const pidOut = execSync(`xprop -id ${winId} _NET_WM_PID`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 });
          const pidMatch = pidOut.match(/_NET_WM_PID\([^)]*\)\s*=\s*(\d+)/);
          if (pidMatch) {
            pid = parseInt(pidMatch[1], 10);
            processName = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 }).trim();
          }
        } catch {}

        const isTarget = isApprovedEditor(windowTitle, processName, pid);
        return { isTarget, windowTitle, processName, pid };
      }
    } catch {
      // xprop failed or headless
    }
  } catch {}

  return {
    isTarget: false,
    windowTitle: 'Unknown / Headless Window',
    processName: undefined,
    pid: undefined
  };
}

async function inspectWindowsActiveWindow(): Promise<ActiveWindowInfo> {
  try {
    const psCmd = `powershell -NoProfile -NonInteractive -Command "Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32 {
  [DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow();
  [DllImport(\\"user32.dll\\")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport(\\"user32.dll\\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@;
$hwnd = [Win32]::GetForegroundWindow();
$pidVal = 0;
[Win32]::GetWindowThreadProcessId($hwnd, [ref]$pidVal);
$sb = New-Object System.Text.StringBuilder 256;
[Win32]::GetWindowText($hwnd, $sb, 256) | Out-Null;
$title = $sb.ToString();
$proc = if ($pidVal -gt 0) { (Get-Process -Id $pidVal -ErrorAction SilentlyContinue).ProcessName } else { '' };
[PSCustomObject]@{ Title = $title; Process = $proc; Pid = $pidVal } | ConvertTo-Json -Compress"`;

    const { stdout } = await execAsync(psCmd, { timeout: 2500 });
    const parsed = JSON.parse(stdout.trim());
    const windowTitle = parsed.Title || '';
    const processName = parsed.Process || undefined;
    const pid = typeof parsed.Pid === 'number' && parsed.Pid > 0 ? parsed.Pid : undefined;
    const isTarget = isApprovedEditor(windowTitle, processName, pid);
    return { isTarget, windowTitle, processName, pid };
  } catch {
    return {
      isTarget: false,
      windowTitle: 'Unknown / Headless Window',
      processName: undefined,
      pid: undefined
    };
  }
}

async function inspectMacActiveWindow(): Promise<ActiveWindowInfo> {
  try {
    const appleScript = `osascript -e 'tell application "System Events"
  set p to ""
  set w to ""
  try
    set p to name of first application process whose frontmost is true
  end try
  try
    set w to name of front window of (first application process whose frontmost is true)
  end try
  return p & "|||" & w
end tell'`;

    const { stdout } = await execAsync(appleScript, { timeout: 2500 });
    const parts = stdout.trim().split('|||');
    const processName = parts[0]?.trim() || undefined;
    const windowTitle = parts[1]?.trim() || processName || '';
    const isTarget = isApprovedEditor(windowTitle, processName);
    return { isTarget, windowTitle, processName };
  } catch {
    return {
      isTarget: false,
      windowTitle: 'Unknown / Headless Window',
      processName: undefined,
      pid: undefined
    };
  }
}

/**
 * Checks whether xdotool is available on the system PATH
 */
export function checkLinuxKeyboardPrerequisites(): { available: boolean; binary: string | null; error?: string } {
  try {
    const stdout = execSync('which xdotool', { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    if (stdout) {
      return { available: true, binary: stdout };
    }
  } catch {
    // which returned non-zero
  }
  return {
    available: false,
    binary: null,
    error: 'xdotool is not installed or not found in system PATH. Install it via `sudo apt-get install xdotool` (Debian/Ubuntu) or `sudo pacman -S xdotool` (Arch).'
  };
}

/**
 * Constructs the single Linux xdotool chained atomic command string
 */
export function buildLinuxBatchScript(options?: BatchPromptOptions, defaults?: BatchPromptOptions): string {
  const focusDelayMs = options?.focusDelayMs ?? defaults?.focusDelayMs ?? 800;
  const selectDelayMs = options?.selectDelayMs ?? defaults?.selectDelayMs ?? 100;
  const pasteDelayMs = options?.pasteDelayMs ?? defaults?.pasteDelayMs ?? 150;

  const focusSec = (focusDelayMs / 1000).toFixed(3);
  const selectSec = (selectDelayMs / 1000).toFixed(3);
  const pasteSec = (pasteDelayMs / 1000).toFixed(3);

  return `xdotool key --clearmodifiers ctrl+shift+l sleep ${focusSec} key --clearmodifiers ctrl+a sleep ${selectSec} key --clearmodifiers ctrl+v sleep ${pasteSec} key --clearmodifiers Return`;
}

/**
 * Checks whether osascript is available and executable on macOS
 */
export function checkDarwinKeyboardPrerequisites(binaryPath: string = '/usr/bin/osascript'): { available: boolean; binary: string | null; error?: string } {
  try {
    if (fs.existsSync(binaryPath)) {
      fs.accessSync(binaryPath, fs.constants.X_OK);
      return { available: true, binary: binaryPath };
    }
  } catch {}

  try {
    const stdout = execSync('which osascript', { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    if (stdout) {
      return { available: true, binary: stdout };
    }
  } catch {}

  return {
    available: false,
    binary: null,
    error: 'osascript is not available or not executable. macOS requires /usr/bin/osascript for Tier 3 keyboard automation.'
  };
}

/**
 * Constructs the single macOS AppleScript batch script string
 */
export function buildDarwinBatchScript(options?: BatchPromptOptions, defaults?: BatchPromptOptions): string {
  const focusDelayMs = options?.focusDelayMs ?? defaults?.focusDelayMs ?? 800;
  const selectDelayMs = options?.selectDelayMs ?? defaults?.selectDelayMs ?? 100;
  const pasteDelayMs = options?.pasteDelayMs ?? defaults?.pasteDelayMs ?? 150;

  const focusSec = +(focusDelayMs / 1000).toFixed(3);
  const selectSec = +(selectDelayMs / 1000).toFixed(3);
  const pasteSec = +(pasteDelayMs / 1000).toFixed(3);

  return [
    'tell application "System Events"',
    '  keystroke "l" using {command down, shift down}',
    `  delay ${focusSec}`,
    '  keystroke "a" using {command down}',
    `  delay ${selectSec}`,
    '  keystroke "v" using {command down}',
    `  delay ${pasteSec}`,
    '  key code 36',
    'end tell'
  ].join('\n');
}

/**
 * Executes an AppleScript via osascript using execFile to prevent shell injection,
 * and translates permission errors (-1743) to actionable instructions.
 */
export async function runAppleScript(
  script: string,
  binaryPath: string = '/usr/bin/osascript',
  customExecFile?: typeof execFile
): Promise<void> {
  const runner = customExecFile || execFile;
  return new Promise<void>((resolve, reject) => {
    runner(binaryPath, ['-e', script], (error, stdout, stderr) => {
      if (error) {
        const errMsg = `${error.message || ''} ${stderr || ''}`;
        if (errMsg.includes('-1743') || /not authorized to send apple events/i.test(errMsg)) {
          return reject(new Error('macOS Accessibility permission denied: Antigravity/VS Code requires Accessibility permission to simulate keystrokes. Please enable it in: System Settings > Privacy & Security > Accessibility.'));
        }
        return reject(new Error(`AppleScript execution failed: ${stderr || error.message}`));
      }
      resolve();
    });
  });
}

export class KeyboardManager {
  private options: Required<Omit<KeyboardManagerOptions, 'customKeySender' | 'customClipboardSetter' | 'customBatchSender' | 'activeWindowValidator'>> & {
    customKeySender?: (keys: string) => Promise<void>;
    customClipboardSetter?: (text: string) => Promise<void>;
    customBatchSender?: (batchScript: string, actions: BatchAction[]) => Promise<void>;
    activeWindowValidator?: () => Promise<ActiveWindowInfo>;
    skipFocusCheck: boolean;
  };

  constructor(options?: KeyboardManagerOptions) {
    this.options = {
      focusDelayMs: options?.focusDelayMs ?? 800,
      selectDelayMs: options?.selectDelayMs ?? 100,
      pasteDelayMs: options?.pasteDelayMs ?? 150,
      submitDelayMs: options?.submitDelayMs ?? 300,
      customKeySender: options?.customKeySender,
      customClipboardSetter: options?.customClipboardSetter,
      customBatchSender: options?.customBatchSender,
      activeWindowValidator: options?.activeWindowValidator,
      skipFocusCheck: options?.skipFocusCheck ?? false
    };
  }

  /**
   * Helper delay utility
   */
  public async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Checks whether Linux keyboard prerequisites (xdotool) are available
   */
  public checkLinuxKeyboardPrerequisites(): { available: boolean; binary: string | null; error?: string } {
    return checkLinuxKeyboardPrerequisites();
  }

  /**
   * Checks whether macOS keyboard prerequisites (osascript) are available
   */
  public checkDarwinKeyboardPrerequisites(binaryPath?: string): { available: boolean; binary: string | null; error?: string } {
    return checkDarwinKeyboardPrerequisites(binaryPath);
  }

  /**
   * Constructs the single macOS AppleScript batch script string.
   */
  public buildDarwinBatchScript(options?: BatchPromptOptions): string {
    return buildDarwinBatchScript(options, this.options);
  }

  /**
   * Executes AppleScript safely via osascript.
   */
  public async runAppleScript(script: string, binaryPath?: string, customExecFile?: typeof execFile): Promise<void> {
    return runAppleScript(script, binaryPath, customExecFile);
  }

  /**
   * Copies text to system clipboard.
   * Uses custom setter if provided, then vscode.env.clipboard if available, with OS fallback.
   */
  public async copyToClipboard(text: string): Promise<void> {
    if (this.options.customClipboardSetter) {
      await this.options.customClipboardSetter(text);
      return;
    }

    try {
      if (vscode?.env?.clipboard?.writeText) {
        await vscode.env.clipboard.writeText(text);
        return;
      }
    } catch {
      // Fallback below
    }

    if (process.platform === 'linux') {
      try {
        try {
          execSync('xclip -selection clipboard', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
          return;
        } catch {
          execSync('xsel --clipboard --input', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
          return;
        }
      } catch (clipErr: any) {
        throw new Error(`Failed to copy to Linux clipboard: ${clipErr.message || clipErr}`);
      }
    }

    if (process.platform === 'darwin') {
      try {
        execSync('pbcopy', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
        return;
      } catch (clipErr: any) {
        throw new Error(`Failed to copy to macOS clipboard: ${clipErr.message || clipErr}`);
      }
    }

    // Windows fallback: Base64 decode to handle UTF-8, newlines, and quotes safely
    try {
      const base64 = Buffer.from(text, 'utf-8').toString('base64');
      const psCommand = `powershell -NoProfile -NonInteractive -Command "[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64}')) | Set-Clipboard"`;
      await execAsync(psCommand);
    } catch {
      // Simple Set-Clipboard fallback
      const escapedText = text.replace(/'/g, "''");
      await execAsync(`powershell -NoProfile -NonInteractive -Command "Set-Clipboard -Value '${escapedText}'"`);
    }
  }

  /**
   * Reads text from system clipboard (for verification/testing).
   */
  public async readClipboard(): Promise<string> {
    try {
      if (vscode?.env?.clipboard?.readText) {
        return await vscode.env.clipboard.readText();
      }
    } catch {
      // Fallback below
    }

    if (process.platform === 'linux') {
      try {
        try {
          const stdout = execSync('xclip -selection clipboard -o', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
          return stdout.trim();
        } catch {
          const stdout = execSync('xsel --clipboard --output', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
          return stdout.trim();
        }
      } catch {
        return '';
      }
    }

    if (process.platform === 'darwin') {
      try {
        const stdout = execSync('pbpaste', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
        return stdout.trim();
      } catch {
        return '';
      }
    }

    const { stdout } = await execAsync(`powershell -NoProfile -NonInteractive -Command "Get-Clipboard"`);
    return stdout.trim();
  }

  /**
   * Constructs the single Linux xdotool chained atomic command string.
   */
  public buildLinuxBatchScript(options?: BatchPromptOptions): string {
    return buildLinuxBatchScript(options, this.options);
  }

  /**
   * Constructs the single PowerShell batch script string using WScript.Shell and built-in Start-Sleep.
   */
  public buildBatchScript(options?: BatchPromptOptions): string {
    const focusDelay = options?.focusDelayMs ?? this.options.focusDelayMs;
    const selectDelay = options?.selectDelayMs ?? this.options.selectDelayMs;
    const pasteDelay = options?.pasteDelayMs ?? this.options.pasteDelayMs;

    return [
      `$ws = New-Object -ComObject WScript.Shell;`,
      `$ws.SendKeys('^+l');`,
      `Start-Sleep -Milliseconds ${focusDelay};`,
      `$ws.SendKeys('^a');`,
      `Start-Sleep -Milliseconds ${selectDelay};`,
      `$ws.SendKeys('^v');`,
      `Start-Sleep -Milliseconds ${pasteDelay};`,
      `$ws.SendKeys('{ENTER}');`
    ].join(' ');
  }

  /**
   * Constructs the fallback batch script using System.Windows.Forms.SendKeys.
   */
  public buildFormsBatchScript(options?: BatchPromptOptions): string {
    const focusDelay = options?.focusDelayMs ?? this.options.focusDelayMs;
    const selectDelay = options?.selectDelayMs ?? this.options.selectDelayMs;
    const pasteDelay = options?.pasteDelayMs ?? this.options.pasteDelayMs;

    return [
      `Add-Type -AssemblyName System.Windows.Forms;`,
      `[System.Windows.Forms.SendKeys]::SendWait('^+l');`,
      `Start-Sleep -Milliseconds ${focusDelay};`,
      `[System.Windows.Forms.SendKeys]::SendWait('^a');`,
      `Start-Sleep -Milliseconds ${selectDelay};`,
      `[System.Windows.Forms.SendKeys]::SendWait('^v');`,
      `Start-Sleep -Milliseconds ${pasteDelay};`,
      `[System.Windows.Forms.SendKeys]::SendWait('{ENTER}');`
    ].join(' ');
  }

  /**
   * Constructs the list of granular batch actions.
   */
  public buildBatchActions(options?: BatchPromptOptions): BatchAction[] {
    const focusDelay = options?.focusDelayMs ?? this.options.focusDelayMs;
    const selectDelay = options?.selectDelayMs ?? this.options.selectDelayMs;
    const pasteDelay = options?.pasteDelayMs ?? this.options.pasteDelayMs;

    return [
      { type: 'sendKeys', value: '^+l' },
      { type: 'sleep', value: focusDelay },
      { type: 'sendKeys', value: '^a' },
      { type: 'sleep', value: selectDelay },
      { type: 'sendKeys', value: '^v' },
      { type: 'sleep', value: pasteDelay },
      { type: 'sendKeys', value: '{ENTER}' }
    ];
  }

  /**
   * Sends raw SendKeys keystroke string via PowerShell or custom sender.
   * Special SendKeys symbols:
   * ^ : Ctrl
   * + : Shift
   * % : Alt
   * {ENTER} : Enter
   */
  public async sendKeys(keys: string): Promise<void> {
    if (this.options.customKeySender) {
      await this.options.customKeySender(keys);
      return;
    }

    if (process.platform === 'win32') {
      try {
        // Preferred: WScript.Shell SendKeys via COM (works in both UI and headless/background node child processes)
        const psCommand = `powershell -NoProfile -NonInteractive -Command "(New-Object -ComObject wscript.shell).SendKeys('${keys}')"`;
        await execAsync(psCommand);
      } catch {
        // Fallback: System.Windows.Forms.SendKeys
        const formsCommand = `powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys}')"`;
        await execAsync(formsCommand);
      }
    } else {
      console.warn(`KeyboardManager: sendKeys('${keys}') called on non-Windows platform: ${process.platform}`);
    }
  }

  /**
   * Sends Ctrl + Shift + L to open a new conversation in Antigravity IDE.
   */
  public async openNewConversation(delayMs?: number): Promise<void> {
    await this.sendKeys('^+l');
    await this.delay(delayMs ?? this.options.focusDelayMs);
  }

  /**
   * Selects all existing text (Ctrl + A)
   */
  public async selectAll(delayMs?: number): Promise<void> {
    await this.sendKeys('^a');
    await this.delay(delayMs ?? this.options.selectDelayMs);
  }

  /**
   * Pastes content from clipboard (Ctrl + V)
   */
  public async paste(delayMs?: number): Promise<void> {
    await this.sendKeys('^v');
    await this.delay(delayMs ?? this.options.pasteDelayMs);
  }

  /**
   * Submits prompt by sending Enter key ({ENTER})
   */
  public async submit(delayMs?: number): Promise<void> {
    await this.sendKeys('{ENTER}');
    await this.delay(delayMs ?? this.options.submitDelayMs);
  }

  /**
   * Verifies that the active OS foreground window belongs to an approved editor.
   * Throws ForeignWindowFocusError if focus is lost or belongs to another application.
   */
  public async verifyActiveWindow(options?: BatchPromptOptions): Promise<ActiveWindowInfo> {
    const skip = options?.skipFocusCheck ?? this.options.skipFocusCheck ?? false;
    if (skip) {
      return { isTarget: true, windowTitle: 'Skipped Focus Check' };
    }

    const validator = options?.activeWindowValidator ?? this.options.activeWindowValidator ?? inspectActiveWindow;
    const info = await validator();
    if (!info.isTarget) {
      throw new ForeignWindowFocusError(info.windowTitle, info.processName);
    }
    return info;
  }

  /**
   * Copies prompt text to clipboard, selects all, pastes, and presses enter.
   */
  public async pasteAndSubmit(promptText: string, options?: BatchPromptOptions): Promise<void> {
    await this.verifyActiveWindow(options);
    await this.copyToClipboard(promptText);
    await this.selectAll();
    await this.paste();
    await this.submit();
  }

  /**
   * Executes Linux batch prompt using xdotool single atomic chain.
   */
  public async executeLinuxBatchPrompt(promptText: string, options?: BatchPromptOptions): Promise<void> {
    const prereqs = this.checkLinuxKeyboardPrerequisites();
    if (!prereqs.available) {
      throw new Error(prereqs.error || 'xdotool is not available on this Linux system');
    }

    // 0. Active window verification MUST be executed BEFORE any clipboard modification
    await this.verifyActiveWindow(options);

    // 1. Prime clipboard
    await this.copyToClipboard(promptText);

    // 2. Build Linux atomic xdotool script
    const script = this.buildLinuxBatchScript(options);

    // 3. Execute atomic command sequence
    await execAsync(script);

    // 4. Delay after submit
    const submitDelay = options?.submitDelayMs ?? this.options.submitDelayMs;
    if (submitDelay > 0) {
      await this.delay(submitDelay);
    }
  }

  /**
   * Executes macOS batch prompt using AppleScript via osascript.
   */
  public async executeDarwinBatchPrompt(promptText: string, options?: BatchPromptOptions): Promise<void> {
    const prereqs = this.checkDarwinKeyboardPrerequisites();
    if (!prereqs.available) {
      throw new Error(prereqs.error || 'osascript is not available on this macOS system');
    }

    // 0. Active window verification MUST be executed BEFORE any clipboard modification
    await this.verifyActiveWindow(options);

    // 1. Prime clipboard
    await this.copyToClipboard(promptText);

    // 2. Build AppleScript batch script
    const script = this.buildDarwinBatchScript(options);

    // 3. Execute AppleScript safely
    await this.runAppleScript(script, prereqs.binary || '/usr/bin/osascript');

    // 4. Delay after submit
    const submitDelay = options?.submitDelayMs ?? this.options.submitDelayMs;
    if (submitDelay > 0) {
      await this.delay(submitDelay);
    }
  }

  /**
   * Executes the prompt automation flow using a single-batch execution routed by OS platform.
   * Consolidates:
   * 1. Active window verification BEFORE clipboard or keystrokes
   * 2. Prime clipboard with promptText (in-process)
   * 3. Single invocation combining Open Chat (^)+SelectAll (^a)+Paste (^v)+Enter ({ENTER})
   * 4. Built-in sleep delays inside the single OS process
   */
  public async executeBatchPromptFlow(promptText: string, options?: BatchPromptOptions): Promise<void> {
    // 0. Active window verification MUST be executed BEFORE any clipboard modification and BEFORE dispatching keystrokes
    await this.verifyActiveWindow(options);

    // 1. Prime the clipboard with prompt text
    await this.copyToClipboard(promptText);

    // 2. Prepare batch script and actions
    let batchScript: string;
    if (process.platform === 'linux') {
      batchScript = this.buildLinuxBatchScript(options);
    } else if (process.platform === 'darwin') {
      batchScript = this.buildDarwinBatchScript(options);
    } else {
      batchScript = this.buildBatchScript(options);
    }
    const actions = this.buildBatchActions(options);

    // 3. Custom Batch Sender Hook (for tests & custom execution)
    if (this.options.customBatchSender) {
      await this.options.customBatchSender(batchScript, actions);
      const submitDelay = options?.submitDelayMs ?? this.options.submitDelayMs;
      if (submitDelay > 0) {
        await this.delay(submitDelay);
      }
      return;
    }

    // 4. Custom Key Sender Fallback (if only customKeySender is provided)
    if (this.options.customKeySender) {
      for (const action of actions) {
        if (action.type === 'sendKeys') {
          await this.options.customKeySender(action.value as string);
        } else if (action.type === 'sleep') {
          await this.delay(action.value as number);
        }
      }
      const submitDelay = options?.submitDelayMs ?? this.options.submitDelayMs;
      if (submitDelay > 0) {
        await this.delay(submitDelay);
      }
      return;
    }

    // 5. Native OS Execution
    if (process.platform === 'win32') {
      try {
        const psCommand = `powershell -NoProfile -NonInteractive -Command "${batchScript}"`;
        await execAsync(psCommand);
      } catch {
        // Fallback to System.Windows.Forms.SendKeys single batch
        const formsScript = this.buildFormsBatchScript(options);
        const formsCommand = `powershell -NoProfile -NonInteractive -Command "${formsScript}"`;
        await execAsync(formsCommand);
      }
    } else if (process.platform === 'linux') {
      const prereqs = this.checkLinuxKeyboardPrerequisites();
      if (!prereqs.available) {
        throw new Error(prereqs.error || 'xdotool is not available on this Linux system');
      }
      await execAsync(batchScript);
    } else if (process.platform === 'darwin') {
      const prereqs = this.checkDarwinKeyboardPrerequisites();
      if (!prereqs.available) {
        throw new Error(prereqs.error || 'osascript is not available on this macOS system');
      }
      await this.runAppleScript(batchScript, prereqs.binary || '/usr/bin/osascript');
    } else {
      throw new Error(`Unsupported platform for keyboard automation: ${process.platform}`);
    }

    const submitDelay = options?.submitDelayMs ?? this.options.submitDelayMs;
    if (submitDelay > 0) {
      await this.delay(submitDelay);
    }
  }

  /**
   * Executes the full keyboard automation sequence:
   * 1. Ctrl + Shift + L (Open Conversation)
   * 2. Wait for chat focus
   * 3. Copy prompt to clipboard
   * 4. Ctrl + A (Select All)
   * 5. Ctrl + V (Paste)
   * 6. Enter (Submit)
   *
   * Routes through executeBatchPromptFlow for single-process efficiency.
   */
  public async executePromptFlow(promptText: string, options?: BatchPromptOptions): Promise<void> {
    await this.executeBatchPromptFlow(promptText, options);
  }

  /**
   * Returns the current timing options.
   */
  public getOptions(): KeyboardManagerOptions {
    return { ...this.options };
  }
}

export const keyboardManager = new KeyboardManager();

export async function executeDarwinBatchPrompt(promptText: string, options?: BatchPromptOptions): Promise<void> {
  return keyboardManager.executeDarwinBatchPrompt(promptText, options);
}
