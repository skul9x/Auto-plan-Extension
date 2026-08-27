import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface BatchPromptOptions {
  /** Delay after Ctrl+Shift+L to wait for chat UI to open and focus (ms). Default: 800ms */
  focusDelayMs?: number;
  /** Delay after Ctrl+A (ms). Default: 100ms */
  selectDelayMs?: number;
  /** Delay after Ctrl+V (ms). Default: 150ms */
  pasteDelayMs?: number;
  /** Delay after Enter (ms). Default: 300ms */
  submitDelayMs?: number;
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
}

export class KeyboardManager {
  private options: Required<Omit<KeyboardManagerOptions, 'customKeySender' | 'customClipboardSetter' | 'customBatchSender'>> & {
    customKeySender?: (keys: string) => Promise<void>;
    customClipboardSetter?: (text: string) => Promise<void>;
    customBatchSender?: (batchScript: string, actions: BatchAction[]) => Promise<void>;
  };

  constructor(options?: KeyboardManagerOptions) {
    this.options = {
      focusDelayMs: options?.focusDelayMs ?? 800,
      selectDelayMs: options?.selectDelayMs ?? 100,
      pasteDelayMs: options?.pasteDelayMs ?? 150,
      submitDelayMs: options?.submitDelayMs ?? 300,
      customKeySender: options?.customKeySender,
      customClipboardSetter: options?.customClipboardSetter,
      customBatchSender: options?.customBatchSender
    };
  }

  /**
   * Helper delay utility
   */
  public async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Copies text to system clipboard.
   * Uses custom setter if provided, then vscode.env.clipboard if available, with PowerShell Set-Clipboard fallback.
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
      // Fallback to PowerShell below
    }

    // PowerShell fallback: Base64 decode to handle UTF-8, newlines, and quotes safely
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
      // Fallback to PowerShell below
    }

    const { stdout } = await execAsync(`powershell -NoProfile -NonInteractive -Command "Get-Clipboard"`);
    return stdout.trim();
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
   * Copies prompt text to clipboard, selects all, pastes, and presses enter.
   */
  public async pasteAndSubmit(promptText: string): Promise<void> {
    await this.copyToClipboard(promptText);
    await this.selectAll();
    await this.paste();
    await this.submit();
  }

  /**
   * Executes the prompt automation flow using a single-batch PowerShell execution.
   * Consolidates:
   * 1. Prime clipboard with promptText (in-process)
   * 2. Single PowerShell invocation combining Open Chat (^)+SelectAll (^a)+Paste (^v)+Enter ({ENTER})
   * 3. Built-in sleep delays inside the single OS process
   */
  public async executeBatchPromptFlow(promptText: string, options?: BatchPromptOptions): Promise<void> {
    // 1. Prime the clipboard with prompt text
    await this.copyToClipboard(promptText);

    // 2. Prepare batch script and actions
    const batchScript = this.buildBatchScript(options);
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

    // 5. Native OS Execution (Windows single PowerShell process)
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
    } else {
      console.warn(`KeyboardManager: executeBatchPromptFlow called on non-Windows platform: ${process.platform}`);
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
