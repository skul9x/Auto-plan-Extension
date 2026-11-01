// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceConfig: Record<string, any> = {
  enableChatMirror: true,
  mirrorIncludePcPrompts: true,
  minChunkDelayMs: 1000,
  defaultPlanFolder: ''
};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          { name: 'test-workspace', uri: { fsPath: '/mock/workspace' } }
        ],
        getConfiguration: (_section?: string) => ({
          get: (key: string, defaultValue: any) => {
            if (mockWorkspaceConfig[key] !== undefined) {
              return mockWorkspaceConfig[key];
            }
            return defaultValue;
          },
          update: async (key: string, value: any) => {
            mockWorkspaceConfig[key] = value;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} })
      },
      window: {
        createOutputChannel: () => ({
          appendLine: () => {},
          show: () => {},
          dispose: () => {}
        }),
        showWarningMessage: async () => {},
        showErrorMessage: async () => {},
        showInformationMessage: async () => {}
      },
      commands: {
        executeCommand: async () => {}
      },
      Uri: {
        file: (p: string) => ({ fsPath: p, scheme: 'file' }),
        joinPath: (base: any, ...segments: string[]) => ({
          fsPath: [base.fsPath, ...segments].join('/'),
          scheme: 'file'
        })
      },
      ViewColumn: { Active: 1 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  scanPlanFolderAsync,
  scanMultiplePlanFoldersAsync,
  auditPlanPhasesAsync,
  auditPlanPhases,
  mapConcurrent,
  DEFAULT_FILE_CONCURRENCY_LIMIT,
  PhaseFile
} from '../planScanner';
import { TelegramChatMirror } from '../telegramChatMirror';
import { DebugLogger } from '../debugLogger';
import { SettingsProvider } from '../settingsProvider';
import { isBridgeInstalledAsync, TAG_START, TAG_END } from '../workbenchInjector';

async function runTests() {
  console.log('========================================================================');
  console.log('  Phase 03: Disk I/O Deduplication & Concurrency Bounding Tests');
  console.log('========================================================================\n');

  const testBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase03-test-'));

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Single-Pass Phase File Inspection & Syscall Tracking
    // -------------------------------------------------------------------------
    console.log('[Test 1] Verifying Single-Pass I/O in auditPlanPhasesAsync...');
    const fixture1Dir = path.join(testBaseDir, 'fixture-single-pass');
    fs.mkdirSync(fixture1Dir, { recursive: true });

    // Create 6 phase files with different headers
    const phaseDefs = [
      { name: 'phase-01-scaffold.md', content: '# Phase 01: Scaffold\n\nStatus: ✅ Completed\n\nContent here...' },
      { name: 'phase-02-auth.md', content: '# Phase 02: Auth\n\nStatus: ⬜ Pending\n\nContent here...' },
      { name: 'phase-03-api.md', content: '# Phase 03: API\n\nStatus: ✅ Completed\n\nContent here...' },
      { name: 'phase-04-ui.md', content: '# Phase 04: UI\n\nStatus: ⬜ Pending\n\nContent here...' },
      { name: 'phase-05-deploy.md', content: '# Phase 05: Deploy\n\nStatus: [X] Done\n\nContent here...' },
      { name: 'phase-06-invalid.md', content: '# Phase 06: Invalid\n\nStatus: ❓ UnknownStatus\n\nContent here...' }
    ];

    for (const p of phaseDefs) {
      fs.writeFileSync(path.join(fixture1Dir, p.name), p.content, 'utf8');
    }

    // Instrument fs.promises.open and fs.readFileSync to count file opens
    let asyncOpenCount = 0;
    let syncReadCount = 0;
    const realFsOpen = fs.promises.open;
    const realFsReadFileSync = fs.readFileSync;

    (fs.promises as any).open = async function (...args: any[]) {
      const filePath = String(args[0]);
      if (filePath.includes('fixture-single-pass')) {
        asyncOpenCount++;
      }
      return realFsOpen.apply(this, args as any);
    };

    (fs as any).readFileSync = function (...args: any[]) {
      const filePath = String(args[0]);
      if (filePath.includes('fixture-single-pass')) {
        syncReadCount++;
      }
      return realFsReadFileSync.apply(this, args as any);
    };

    let auditReport: any;
    try {
      auditReport = await auditPlanPhasesAsync(fixture1Dir);
    } finally {
      (fs.promises as any).open = realFsOpen;
      (fs as any).readFileSync = realFsReadFileSync;
    }

    assert.strictEqual(auditReport.totalPhases, 6, 'Should detect exactly 6 phases');
    assert.strictEqual(auditReport.completedCount, 3, 'Should count 3 completed phases (phase-01, phase-03, phase-05)');
    assert.strictEqual(auditReport.pendingCount, 3, 'Should count 3 pending/unrecognized phases');
    assert.strictEqual(auditReport.hasBlockers, true, 'Phase 06 has invalid header syntax, should flag blocker');

    // Requirement: Exactly N file read operations instead of 2N (6 opens, NOT 12)
    console.log(`  -> File opens for 6 phase files: ${asyncOpenCount} (expected: exactly 6)`);
    console.log(`  -> Synchronous file reads: ${syncReadCount} (expected: 0)`);
    assert.strictEqual(
      asyncOpenCount,
      6,
      `Expected exactly 6 async file opens for 6 files (single-pass), got ${asyncOpenCount}`
    );
    assert.strictEqual(
      syncReadCount,
      0,
      `Expected 0 synchronous file reads on Extension Host main thread during audit, got ${syncReadCount}`
    );
    console.log('  ✓ Single-pass I/O verified: exact N file operations with zero second-pass re-reads.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Asynchronous Cached Workspace Registration in TelegramChatMirror
    // -------------------------------------------------------------------------
    console.log('[Test 2] Verifying Asynchronous Cached Workspace Registration in TelegramChatMirror...');
    const registryDir = path.join(testBaseDir, 'registry');
    fs.mkdirSync(registryDir, { recursive: true });
    const registryPath = path.join(registryDir, 'antigravity-bridge-ports.json');

    // Multi-root registry: 2 active ports
    const initialRegistryData = {
      ports: {
        '47352': { pid: 1001, workspaceName: 'ProjectAlpha' },
        '47353': { pid: 1002, workspaceName: 'ProjectBeta' }
      }
    };
    fs.writeFileSync(registryPath, JSON.stringify(initialRegistryData, null, 2), 'utf8');

    const mirror = new TelegramChatMirror({
      registryPath,
      workspaceName: 'ProjectAlpha',
      registryTtlMs: 5000
    });

    // Await async initial refresh
    await mirror.refreshWorkspaceRegistryAsync();

    // Verify initial state
    assert.strictEqual(mirror.isMultiWorkspaceRegistered(), true, 'Should detect multi-workspace from registry');
    assert.strictEqual(mirror.getWorkspaceTag(), '[📁 ProjectAlpha]', 'Workspace tag should match');

    // Track synchronous reads on registry file during rapid simulation
    let syncReadsOnRegistry = 0;
    const trackedReadFileSync = fs.readFileSync;
    (fs as any).readFileSync = function (...args: any[]) {
      const p = String(args[0]);
      if (p.includes('antigravity-bridge-ports.json')) {
        syncReadsOnRegistry++;
      }
      return trackedReadFileSync.apply(this, args as any);
    };

    try {
      // Simulate 100 rapid mirrored message tags
      for (let i = 0; i < 100; i++) {
        const isMulti = mirror.isMultiWorkspaceRegistered();
        const tag = mirror.getWorkspaceTag();
        assert.strictEqual(isMulti, true);
        assert.strictEqual(tag, '[📁 ProjectAlpha]');
      }
    } finally {
      (fs as any).readFileSync = trackedReadFileSync;
    }

    console.log(`  -> Synchronous disk reads during 100 rapid calls: ${syncReadsOnRegistry}`);
    assert.strictEqual(
      syncReadsOnRegistry,
      0,
      'isMultiWorkspaceRegistered() and getWorkspaceTag() must execute with 0 synchronous disk syscalls'
    );

    // Test dynamic TTL cache update when registry content changes
    const singleWorkspaceRegistry = {
      ports: {
        '47352': { pid: 1001, workspaceName: 'ProjectAlpha' }
      }
    };
    fs.writeFileSync(registryPath, JSON.stringify(singleWorkspaceRegistry, null, 2), 'utf8');

    // Force refresh or TTL expiry
    await mirror.refreshWorkspaceRegistryAsync();
    assert.strictEqual(mirror.isMultiWorkspaceRegistered(), false, 'Should update to false after refresh');
    assert.strictEqual(mirror.getWorkspaceTag(), '', 'Workspace tag should be empty for single workspace');

    mirror.dispose();
    console.log('  ✓ Cached workspace registration verified: O(1) in-memory resolution with zero disk syscalls.\n');

    // -------------------------------------------------------------------------
    // TEST 3: Concurrency Bounding on Large Plan Fixture (50+ Files)
    // -------------------------------------------------------------------------
    console.log('[Test 3] Verifying Concurrency Bounded Worker Pool (60 phase files)...');
    const largePlanDir = path.join(testBaseDir, 'fixture-large-plan');
    fs.mkdirSync(largePlanDir, { recursive: true });

    const TOTAL_FILES = 60;
    for (let i = 1; i <= TOTAL_FILES; i++) {
      const numStr = String(i).padStart(2, '0');
      const statusStr = i % 2 === 0 ? '✅ Completed' : '⬜ Pending';
      fs.writeFileSync(
        path.join(largePlanDir, `phase-${numStr}-task.md`),
        `# Phase ${numStr}\n\nStatus: ${statusStr}\n\nDetailed content for phase ${i}...`,
        'utf8'
      );
    }

    // Instrument fs.promises.open to track peak concurrent open file handles
    let currentActiveHandles = 0;
    let peakConcurrentHandles = 0;
    const realOpen = fs.promises.open;

    (fs.promises as any).open = async function (...args: any[]) {
      const filePath = String(args[0]);
      if (filePath.includes('fixture-large-plan')) {
        currentActiveHandles++;
        if (currentActiveHandles > peakConcurrentHandles) {
          peakConcurrentHandles = currentActiveHandles;
        }
      }
      const handle = await realOpen.apply(this, args as any);
      const realClose = handle.close.bind(handle);
      handle.close = async function () {
        if (filePath.includes('fixture-large-plan')) {
          currentActiveHandles--;
        }
        return realClose();
      };
      return handle;
    };

    let scannedPhases: PhaseFile[];
    try {
      scannedPhases = await scanPlanFolderAsync(largePlanDir);
    } finally {
      (fs.promises as any).open = realOpen;
    }

    console.log(`  -> Peak concurrent open file handles during scan of ${TOTAL_FILES} files: ${peakConcurrentHandles}`);
    assert.strictEqual(scannedPhases.length, TOTAL_FILES, `Should discover all ${TOTAL_FILES} phase files`);
    assert(
      peakConcurrentHandles <= DEFAULT_FILE_CONCURRENCY_LIMIT,
      `Peak concurrent file handles (${peakConcurrentHandles}) must not exceed limit (${DEFAULT_FILE_CONCURRENCY_LIMIT})`
    );
    assert(
      peakConcurrentHandles > 1,
      `Worker pool must execute concurrently (peak was ${peakConcurrentHandles}, expected > 1)`
    );

    // Test mapConcurrent directly with custom limits and error propagation
    const numbers = Array.from({ length: 30 }, (_, i) => i + 1);
    let directActive = 0;
    let directPeak = 0;
    const mapped = await mapConcurrent(numbers, 8, async (n) => {
      directActive++;
      if (directActive > directPeak) directPeak = directActive;
      await new Promise((r) => setTimeout(r, 5));
      directActive--;
      return n * 2;
    });

    assert.strictEqual(mapped.length, 30);
    assert.strictEqual(mapped[0], 2);
    assert.strictEqual(mapped[29], 60);
    assert(directPeak <= 8, `Direct mapConcurrent peak (${directPeak}) must not exceed limit 8`);

    // Test scanMultiplePlanFoldersAsync with concurrency bounding
    const multiDirBase = path.join(testBaseDir, 'multi-dirs');
    const dirList: string[] = [];
    for (let d = 1; d <= 20; d++) {
      const sub = path.join(multiDirBase, `plan-dir-${d}`);
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, 'phase-01.md'), '# Phase 01\nStatus: ⬜ Pending\n');
      dirList.push(sub);
    }

    const multiMap = await scanMultiplePlanFoldersAsync(dirList, {}, 16);
    assert.strictEqual(multiMap.size, 20, 'Should scan all 20 plan directories concurrently');
    console.log('  ✓ Concurrency bounding verified: active file descriptors bounded to max 16.\n');

    // -------------------------------------------------------------------------
    // TEST 4: Non-Blocking Telemetry & Environment Reporting
    // -------------------------------------------------------------------------
    console.log('[Test 4] Verifying Non-Blocking Telemetry & Environment Reporting...');
    const mockWbDir = path.join(testBaseDir, 'workbench-mock');
    fs.mkdirSync(mockWbDir, { recursive: true });
    const mockWbHtml = path.join(mockWbDir, 'workbench.html');
    fs.writeFileSync(
      mockWbHtml,
      `<html><body>${TAG_START}<script src="bridge.js?v=123"></script>${TAG_END}</body></html>`,
      'utf8'
    );

    // Verify isBridgeInstalledAsync
    const installedAsync = await isBridgeInstalledAsync(mockWbHtml);
    assert.strictEqual(installedAsync, true, 'isBridgeInstalledAsync must detect installed bridge tags');

    const cleanWbHtml = path.join(mockWbDir, 'clean-workbench.html');
    fs.writeFileSync(cleanWbHtml, '<html><body>Clean Content</body></html>', 'utf8');
    const cleanInstalled = await isBridgeInstalledAsync(cleanWbHtml);
    assert.strictEqual(cleanInstalled, false, 'isBridgeInstalledAsync must detect missing tags');

    // Verify DebugLogger without synchronous reads of workbench.html
    const logger = new DebugLogger(50);
    logger.setCachedDomBridgeInfo({
      installed: true,
      workbenchHtmlPath: mockWbHtml,
      backupPresent: false
    });

    // Register async plan audit provider
    logger.registerPlanAuditProvider(async () => {
      return await auditPlanPhasesAsync(fixture1Dir);
    });

    let syncReadsDuringReport = 0;
    const realReadFileSync2 = fs.readFileSync;
    (fs as any).readFileSync = function (...args: any[]) {
      const p = String(args[0]);
      if (p.includes('workbench.html')) {
        syncReadsDuringReport++;
      }
      return realReadFileSync2.apply(this, args as any);
    };

    let report: any;
    try {
      report = logger.buildEnvironmentReport();
    } finally {
      (fs as any).readFileSync = realReadFileSync2;
    }

    assert.strictEqual(syncReadsDuringReport, 0, 'buildEnvironmentReport must not read workbench.html synchronously');
    assert.strictEqual(report.domBridge.installed, true, 'Cached domBridge state should be reflected');

    // Verify async environment report assembly
    const asyncReport = await logger.buildEnvironmentReportAsync();
    assert.strictEqual(asyncReport.domBridge.installed, true);
    assert(asyncReport.planPhases !== undefined, 'Phase telemetry should be populated');
    assert.strictEqual(asyncReport.planPhases?.totalPhases, 6);

    const reportMarkdown = await logger.exportDiagnosticReportToStringAsync(10);
    assert(reportMarkdown.includes('DOM Bridge Diagnostic Report'), 'Report markdown should contain header');
    assert(reportMarkdown.includes('Phase Execution & Stall Diagnostics'), 'Report markdown should include phase section');

    // Test exportLogToFile without blocking
    const exportedLogPath = path.join(testBaseDir, 'exported-diag.txt');
    await logger.exportLogToFile(exportedLogPath, 10);
    assert(fs.existsSync(exportedLogPath), 'Diagnostic log file should be exported');

    // Test SettingsProvider cached phase diagnostics
    const settingsProviderInstance = Object.create(SettingsProvider.prototype);
    settingsProviderInstance._cachedPhaseDiagnostics = auditReport;
    settingsProviderInstance._phaseAuditExpiresAt = Date.now() + 10000;
    settingsProviderInstance._lastPhaseAuditFolder = fixture1Dir;

    const diagSync = settingsProviderInstance.getPhaseDiagnostics();
    assert.strictEqual(diagSync?.totalPhases, 6, 'SettingsProvider must return cached phase diagnostics');

    logger.dispose();
    console.log('  ✓ Non-blocking environment reporting & phase telemetry verified.\n');

    console.log('========================================================================');
    console.log('  ALL PHASE 03 TESTS PASSED SUCCESSFULLY! (Single-pass I/O, Bounded Concurrency, Non-blocking Telemetry)');
    console.log('========================================================================\n');
  } finally {
    // Cleanup temporary test directory
    try {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    } catch {}
  }
}

runTests().catch((err) => {
  console.error('\n❌ Phase 03 Test Failed with error:', err);
  process.exit(1);
});
