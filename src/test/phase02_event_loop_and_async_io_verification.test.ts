// Standalone mock for 'vscode' module when executed directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockActiveTextEditor: any = null;
let mockWindowStateFocused = false;
const mockConfigStore: Record<string, any> = {
  'telegram.enabled': true,
  'telegram.botToken': '123456:TEST_TOKEN',
  'telegram.allowedUsers': [12345],
  'telegram.throttleMs': 2000,
  'telegram.allowFreeChat': true,
  'telegram.enableChatMirror': true,
  'telegram.mirrorIncludePcPrompts': true,
  'telegram.chatMirrorPrefix': '🤖 [Antigravity AI]',
  'telegram.liveProgressMode': 'final_only'
};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (_section: string) => ({
          get: (key: string, defaultValue: any) =>
            mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            mockConfigStore[key] = val;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
        workspaceFolders: [{ name: 'TestWorkspace', uri: { fsPath: 'c:\\test\\ws' } }]
      },
      commands: {
        executeCommand: async (_cmd: string, ..._args: any[]) => undefined,
        getCommands: async () => ['autoplan.start']
      },
      window: {
        get activeTextEditor() {
          return mockActiveTextEditor;
        },
        state: {
          get focused() {
            return mockWindowStateFocused;
          }
        },
        showWarningMessage: async () => undefined,
        showInformationMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        onDidChangeActiveTextEditor: () => ({ dispose: () => {} })
      },
      env: {
        clipboard: {
          _text: '',
          writeText: async (text: string) => {
            (Module.prototype.require as any)._lastClipboard = text;
          },
          readText: async () => {
            return (Module.prototype.require as any)._lastClipboard || '';
          }
        }
      },
      StatusBarAlignment: { Right: 1 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import { TelegramBridge } from '../telegramBridge';
import { TelegramChatMirror } from '../telegramChatMirror';
import { findActivePlanFolder, findActivePlanFolderAsync } from '../extension';
import {
  inspectWindowsActiveWindow,
  clearWindowsActiveWindowCache,
  KeyboardManager
} from '../keyboardManager';
import { DebugLogger } from '../debugLogger';

async function runPhase02Verification() {
  console.log('======================================================================');
  console.log('🧪 Phase 02: Event Loop Unblocking & Non-Blocking I/O Verification');
  console.log('======================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase02-test-'));
  const logger = new DebugLogger(100);

  let passedTests = 0;
  let totalTests = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    totalTests++;
    process.stdout.write(`  [Test ${totalTests}] ${name} ... `);
    try {
      await fn();
      console.log('✓ PASS');
      passedTests++;
    } catch (err: any) {
      console.log('✗ FAIL');
      console.error(`     Error: ${err?.message || err}`);
      if (err?.stack) {
        console.error(`     ${err.stack.split('\n').slice(1, 4).join('\n     ')}`);
      }
      throw err;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // Target 1: Non-Blocking Multi-Window Registry Read/Write & Heartbeats
    // -------------------------------------------------------------------------
    console.log('[Target 1] Verifying Multi-Window Registry Non-Blocking I/O & Heartbeat Latency...');

    const registryPath = path.join(testTempDir, 'ag-autoplan-ports.json');
    const bridge = new TelegramBridge({
      token: '123456:TEST_TOKEN',
      registryPath,
      windowKey: 'window-alpha',
      logger
    });

    await test('writeRegistryAsync and readRegistryAsync complete asynchronously with microtask latency < 10ms', async () => {
      // Measure event loop / microtask dispatch latency during asynchronous I/O
      let maxMicrotaskLatencyMs = 0;
      let measuring = true;

      const measureTurnaround = async () => {
        while (measuring) {
          const start = performance.now();
          await new Promise((res) => setImmediate(res));
          const latency = performance.now() - start;
          if (latency > maxMicrotaskLatencyMs) {
            maxMicrotaskLatencyMs = latency;
          }
        }
      };

      const monitorPromise = measureTurnaround();

      const iterations = 15;
      for (let i = 0; i < iterations; i++) {
        const data = {
          version: 1,
          ports: {
            [`400${i}`]: {
              port: 4000 + i,
              pid: process.pid,
              startedAt: Date.now(),
              windowKey: `window-${i}`,
              workspaceName: `WS-${i}`,
              workspacePath: `/tmp/ws-${i}`,
              updatedAt: Date.now()
            }
          },
          telegramLeader: {
            pid: process.pid,
            windowKey: 'window-alpha',
            acquiredAt: Date.now(),
            updatedAt: Date.now()
          }
        };
        await bridge.writeRegistryAsync(registryPath, data);
        const readBack = await bridge.readRegistryAsync(registryPath);
        assert.strictEqual(readBack.ports[`400${i}`]?.port, 4000 + i);
      }

      measuring = false;
      await monitorPromise;

      console.log(`(max microtask latency: ${maxMicrotaskLatencyMs.toFixed(2)}ms)`);
      assert.ok(
        maxMicrotaskLatencyMs < 10,
        `Event loop microtask latency must remain < 10ms under registry I/O, observed: ${maxMicrotaskLatencyMs.toFixed(2)}ms`
      );
    });

    await test('Background triggerHeartbeatAsync executes with 0 fs.readFileSync or fs.writeFileSync calls', async () => {
      // Setup leader state
      await bridge.tryAcquireLeadershipAsync();

      let syncReadCount = 0;
      let syncWriteCount = 0;
      const origReadFileSync = fs.readFileSync;
      const origWriteFileSync = fs.writeFileSync;

      (fs as any).readFileSync = function (...args: any[]) {
        syncReadCount++;
        return origReadFileSync.apply(this, args as any);
      };
      (fs as any).writeFileSync = function (...args: any[]) {
        syncWriteCount++;
        return origWriteFileSync.apply(this, args as any);
      };

      try {
        // Trigger asynchronous heartbeat pulse
        await bridge.triggerHeartbeatAsync();

        assert.strictEqual(syncReadCount, 0, 'No fs.readFileSync calls allowed during heartbeat');
        assert.strictEqual(syncWriteCount, 0, 'No fs.writeFileSync calls allowed during heartbeat');
      } finally {
        (fs as any).readFileSync = origReadFileSync;
        (fs as any).writeFileSync = origWriteFileSync;
      }
    });

    // -------------------------------------------------------------------------
    // Target 2: Atomic Write Resilience to Simulated Transient Windows Locks
    // -------------------------------------------------------------------------
    console.log('\n[Target 2] Verifying Atomic Write Resilience to Windows EPERM Locks...');

    await test('writeRegistryAsync retries on transient EPERM/EBUSY and successfully completes', async () => {
      let renameAttempts = 0;
      const origRename = fs.promises.rename;

      (fs.promises as any).rename = async function (oldPath: string, newPath: string) {
        renameAttempts++;
        if (renameAttempts <= 2) {
          const err: any = new Error('EPERM: operation not permitted, rename');
          err.code = 'EPERM';
          throw err;
        }
        return origRename.call(this, oldPath, newPath);
      };

      try {
        const payload = {
          version: 1,
          ports: {
            '5001': {
              port: 5001,
              pid: process.pid,
              startedAt: Date.now(),
              windowKey: 'window-resilient',
              workspaceName: 'ResilientWS',
              workspacePath: '/tmp/resilient',
              updatedAt: Date.now()
            }
          }
        };

        await bridge.writeRegistryAsync(registryPath, payload);
        assert.strictEqual(renameAttempts, 3, 'Must have retried twice and succeeded on 3rd attempt');

        const readData = await bridge.readRegistryAsync(registryPath);
        assert.strictEqual(readData.ports['5001']?.workspaceName, 'ResilientWS');
      } finally {
        (fs.promises as any).rename = origRename;
      }
    });

    await test('readRegistryAsync recovers from transient empty or locked read', async () => {
      let readAttempts = 0;
      const origReadFile = fs.promises.readFile;

      (fs.promises as any).readFile = async function (p: any, opts: any) {
        readAttempts++;
        if (readAttempts === 1) {
          // Simulate transient 0-byte collision during file swap
          return '';
        }
        return origReadFile.call(this, p, opts);
      };

      try {
        const readData = await bridge.readRegistryAsync(registryPath);
        assert.strictEqual(readAttempts, 2, 'Must have retried after initial empty read');
        assert.strictEqual(readData.ports['5001']?.workspaceName, 'ResilientWS');
      } finally {
        (fs.promises as any).readFile = origReadFile;
      }
    });

    // -------------------------------------------------------------------------
    // Target 3: TelegramChatMirror In-Memory Cached Multi-Workspace Registration
    // -------------------------------------------------------------------------
    console.log('\n[Target 3] Verifying TelegramChatMirror In-Memory Cached Multi-Workspace...');

    const mirrorRegistryPath = path.join(testTempDir, 'mirror-ports.json');
    const multiRegistryData = {
      version: 1,
      ports: {
        '4001': { pid: process.pid, workspaceName: 'ProjectAlpha' },
        '4002': { pid: process.pid, workspaceName: 'ProjectBeta' }
      }
    };
    fs.writeFileSync(mirrorRegistryPath, JSON.stringify(multiRegistryData, null, 2), 'utf8');

    const mirror = new TelegramChatMirror({
      registryPath: mirrorRegistryPath,
      workspaceName: 'ProjectAlpha',
      registryTtlMs: 5000,
      logger
    });

    await test('TelegramChatMirror.isMultiWorkspaceRegistered() uses cache with 0 sync disk reads', async () => {
      await mirror.refreshWorkspaceRegistryAsync();
      assert.strictEqual(mirror.isMultiWorkspaceRegistered(), true);
      assert.strictEqual(mirror.getWorkspaceTag(), '[📁 ProjectAlpha]');

      let syncReadCount = 0;
      const origReadFileSync = fs.readFileSync;
      (fs as any).readFileSync = function (...args: any[]) {
        const target = String(args[0]);
        if (target.includes('mirror-ports.json')) {
          syncReadCount++;
        }
        return origReadFileSync.apply(this, args as any);
      };

      try {
        for (let i = 0; i < 100; i++) {
          const isMulti = mirror.isMultiWorkspaceRegistered();
          const tag = mirror.getWorkspaceTag();
          assert.strictEqual(isMulti, true);
          assert.strictEqual(tag, '[📁 ProjectAlpha]');
        }
        assert.strictEqual(syncReadCount, 0, '100 rapid calls must make exactly 0 synchronous disk reads');
      } finally {
        (fs as any).readFileSync = origReadFileSync;
      }
    });

    await test('TelegramChatMirror updates cache when refreshWorkspaceRegistryAsync is called', async () => {
      // Overwrite registry with single workspace
      const singleRegistryData = {
        version: 1,
        ports: {
          '4001': { pid: process.pid, workspaceName: 'ProjectAlpha' }
        }
      };
      fs.writeFileSync(mirrorRegistryPath, JSON.stringify(singleRegistryData, null, 2), 'utf8');

      // Before refresh: still cached as true
      assert.strictEqual(mirror.isMultiWorkspaceRegistered(), true);

      // After async refresh: updates to false
      await mirror.refreshWorkspaceRegistryAsync();
      assert.strictEqual(mirror.isMultiWorkspaceRegistered(), false);
      assert.strictEqual(mirror.getWorkspaceTag(), '');

      mirror.dispose();
    });

    // -------------------------------------------------------------------------
    // Target 4: Asynchronous Plan Folder Detection (findActivePlanFolderAsync)
    // -------------------------------------------------------------------------
    console.log('\n[Target 4] Verifying Asynchronous Plan Folder Scanning (PERF-004)...');

    const validPlanDir = path.join(testTempDir, 'fixture-plan-dir');
    fs.mkdirSync(validPlanDir, { recursive: true });
    const phase1Path = path.join(validPlanDir, 'phase-01-core.md');
    const phase2Path = path.join(validPlanDir, 'phase-02-extra.md');
    fs.writeFileSync(phase1Path, '# Phase 01: Core\nStatus: Pending\n', 'utf8');
    fs.writeFileSync(phase2Path, '# Phase 02: Extra\nStatus: Completed\n', 'utf8');

    await test('findActivePlanFolderAsync correctly detects plan directory when viewing markdown phase', async () => {
      mockActiveTextEditor = {
        document: {
          uri: { fsPath: phase1Path }
        }
      };

      const detected = await findActivePlanFolderAsync();
      assert.strictEqual(detected, validPlanDir, 'Must asynchronously return parent plan folder');
    });

    await test('findActivePlanFolderAsync returns null for non-markdown files or missing editor', async () => {
      // Non-markdown file
      mockActiveTextEditor = {
        document: {
          uri: { fsPath: path.join(validPlanDir, 'notes.txt') }
        }
      };
      assert.strictEqual(await findActivePlanFolderAsync(), null);

      // No active editor
      mockActiveTextEditor = null;
      assert.strictEqual(await findActivePlanFolderAsync(), null);
    });

    await test('Legacy findActivePlanFolder is deprecated but returns correct parent folder', () => {
      mockActiveTextEditor = {
        document: {
          uri: { fsPath: phase2Path }
        }
      };
      const detected = findActivePlanFolder();
      assert.strictEqual(detected, validPlanDir);
      mockActiveTextEditor = null;
    });

    // -------------------------------------------------------------------------
    // Target 5: Clipboard Helper & Active Window Detection Without execSync or Add-Type
    // -------------------------------------------------------------------------
    console.log('\n[Target 5] Verifying Non-Blocking Clipboard & Non-Compiling Active Window...');

    const km = new KeyboardManager();

    await test('copyToClipboard and readClipboard execute without invoking child_process.execSync', async () => {
      let execSyncCalled = false;
      const origExecSync = child_process.execSync;

      (child_process as any).execSync = function (...args: any[]) {
        execSyncCalled = true;
        throw new Error(`execSync was forbidden but called with: ${args[0]}`);
      };

      try {
        await km.copyToClipboard('test non-blocking copy');
        const readBack = await km.readClipboard();
        assert.strictEqual(readBack, 'test non-blocking copy');
        assert.strictEqual(execSyncCalled, false, 'child_process.execSync must not be called');
      } finally {
        (child_process as any).execSync = origExecSync;
      }
    });

    await test('inspectWindowsActiveWindow executes without dynamic C# Add-Type compilation', async () => {
      clearWindowsActiveWindowCache();
      mockWindowStateFocused = false;

      let capturedCommand = '';
      const mockRunner = async (cmd: string) => {
        capturedCommand = cmd;
        return {
          stdout: JSON.stringify({
            Title: 'Auto-Plan - Antigravity',
            Process: 'Antigravity',
            Pid: 1234
          }),
          stderr: ''
        };
      };

      const info = await inspectWindowsActiveWindow(true, mockRunner);
      assert.strictEqual(info.isTarget, true);
      assert.strictEqual(info.windowTitle, 'Auto-Plan - Antigravity');

      // Crucial: assert no dynamic Roslyn C# compilation
      assert.ok(
        !capturedCommand.includes('Add-Type @\''),
        'PowerShell command must NOT compile C# types with dynamic Add-Type @\' ...'
      );
      assert.ok(
        capturedCommand.includes('UIAutomationClient'),
        'PowerShell command must use pre-compiled .NET UIAutomationClient assembly'
      );
    });

    await test('inspectWindowsActiveWindow utilizes VS Code window focus property when available', async () => {
      clearWindowsActiveWindowCache();
      mockWindowStateFocused = true;

      // When VS Code window is focused and no custom runner override is given:
      const info = await inspectWindowsActiveWindow(true);
      assert.strictEqual(info.isTarget, true);
      assert.strictEqual(info.processName, 'Antigravity');
      mockWindowStateFocused = false;
    });

    console.log('\n======================================================================');
    console.log(`✅ All ${totalTests} Phase 02 Verification Tests Passed Successfully! (${passedTests}/${totalTests})`);
    console.log('======================================================================\n');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase02Verification().catch((err) => {
  console.error('\n❌ Phase 02 Verification Failed:', err);
  process.exit(1);
});
