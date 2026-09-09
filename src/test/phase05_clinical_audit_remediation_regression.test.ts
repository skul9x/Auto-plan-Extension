// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceFolders: any[] = [
  {
    name: 'Auto-plan-Extension-main',
    uri: { fsPath: '/home/skul9x/Desktop/Code/Auto-plan-Extension-main' }
  }
];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      Uri: {
        file: (f: string) => ({ fsPath: f }),
        joinPath: (...args: any[]) => ({ fsPath: args.join('/') })
      },
      WebviewViewProvider: class {},
      window: {
        showWarningMessage: () => {},
        showInformationMessage: () => {},
        showErrorMessage: () => {}
      },
      commands: {
        executeCommand: async () => {}
      },
      workspace: {
        get workspaceFolders() {
          return mockWorkspaceFolders;
        },
        name: 'Auto-plan-Extension-main',
        getConfiguration: () => ({
          get: (_key: string, defaultValue: any) => defaultValue,
          update: async () => {}
        })
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      env: {
        appRoot: undefined
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { performance } from 'perf_hooks';

import { SidebarProvider, MAX_PENDING_LOGS } from '../sidebarProvider';
import {
  TranscriptWatcher,
  asyncPool,
  clearConversationOwnershipCache,
  getConversationOwnershipCacheStats,
  getCandidateConversationsAsync,
  clearBrainDirCache,
  ConversationOwnershipCriteria
} from '../transcriptWatcher';
import { Orchestrator } from '../orchestrator';
import { DEFAULT_CONFIG } from '../config';

class MockWebview {
  public postedMessages: any[] = [];
  public options = {};
  public html = '';
  public cspSource = "'none'";

  public asWebviewUri(uri: any) {
    return uri;
  }

  public async postMessage(message: any): Promise<boolean> {
    this.postedMessages.push(message);
    return true;
  }

  public onDidReceiveMessage(_listener: any) {}
}

class MockWebviewView {
  public webview: MockWebview;
  constructor() {
    this.webview = new MockWebview();
  }
}

function createTempDir(prefix: string): string {
  const tempDir = path.join(
    os.tmpdir(),
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function cleanupDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {}
}

function writeTranscriptJsonl(convDir: string, lines: any[]): string {
  const logDir = path.join(convDir, '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const tPath = path.join(logDir, 'transcript.jsonl');
  const content = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
  fs.writeFileSync(tPath, content, 'utf8');
  return tPath;
}

async function runAllClinicalRemediationTests(): Promise<void> {
  console.log('================================================================================');
  console.log(' Phase 05: Clinical Audit Remediation Full E2E & Regression Suite');
  console.log('================================================================================\n');

  // ============================================================================
  // Scenario 1: MEM-03 Stress Validation (Sidebar Log Queue Memory Leak Prevention)
  // ============================================================================
  console.log('--------------------------------------------------------------------------------');
  console.log(' [Scenario 1] MEM-03 Stress Validation: Bounded Queue & Batched Flush');
  console.log('--------------------------------------------------------------------------------');
  {
    const extensionUri = { fsPath: '/mock/extension' } as any;
    const provider = new SidebarProvider(extensionUri);

    assert.strictEqual(provider.isWebviewReady(), false, 'Webview must start in unready state');
    assert.strictEqual(MAX_PENDING_LOGS, 150, 'MAX_PENDING_LOGS constant must be exactly 150');

    console.log('  -> Pushing 3,000 rapid log events to unready SidebarProvider...');
    for (let i = 1; i <= 3000; i++) {
      provider.appendTranscriptLog(`Stress log payload #${i}`);
    }

    const pendingCount = provider.getPendingLogsCount();
    console.log(`  -> Pending log count: ${pendingCount}`);
    assert.ok(pendingCount <= 150, `Pending queue strictly remains clamped to <= 150 (got ${pendingCount})`);
    assert.strictEqual(pendingCount, 150, 'Pending queue should have exactly 150 items due to FIFO sliding window');

    console.log('  -> Transitioning webview to ready state and inspecting IPC payload...');
    const mockView = new MockWebviewView();
    provider.resolveWebviewView(mockView as any, {} as any, {} as any);
    mockView.webview.postedMessages = [];

    await provider.handleWebviewMessage({ command: 'ready' });
    assert.strictEqual(provider.isWebviewReady(), true, 'Webview should be marked ready');

    const batches = mockView.webview.postedMessages.filter(m => m.type === 'transcriptLogBatch');
    assert.strictEqual(batches.length, 1, 'Webview readiness must trigger exactly ONE batched IPC delivery');
    assert.strictEqual(batches[0].logs.length, 150, 'Batched IPC message must contain exactly 150 items');
    assert.strictEqual(batches[0].logs[0], 'Stress log payload #2851', 'First log in batch must be #2851 (sliding window)');
    assert.strictEqual(batches[0].logs[149], 'Stress log payload #3000', 'Last log in batch must be #3000');

    console.log('  -> Calling dispose() and validating pending queue reset...');
    provider.dispose();
    assert.strictEqual(provider.getPendingLogsCount(), 0, 'Calling dispose() must reset pending queue to 0');
    console.log('  ✓ MEM-03 Stress Validation: Passed cleanly.\n');
  }

  // ============================================================================
  // Scenario 2: PERF-02 I/O Storm Elimination (Transcript Ownership Stat & Content Cache)
  // ============================================================================
  console.log('--------------------------------------------------------------------------------');
  console.log(' [Scenario 2] PERF-02 I/O Storm Elimination: Disk Read Capping & Invalidation');
  console.log('--------------------------------------------------------------------------------');
  {
    clearConversationOwnershipCache();
    const brainDir = createTempDir('perf02_brain');

    try {
      const candidatePaths: string[] = [];
      for (let i = 0; i < 10; i++) {
        const convDir = path.join(brainDir, `conv_${i}`);
        fs.mkdirSync(convDir, { recursive: true });
        const snippetText = i === 0
          ? 'special-target-snippet-active'
          : `other-conversation-snippet-${i}`;
        const tPath = writeTranscriptJsonl(convDir, [
          {
            type: 'USER_INPUT',
            content: `Execution for candidate ${i}: ${snippetText} in /home/skul9x/Desktop/Code/Auto-plan-Extension-main`
          }
        ]);
        candidatePaths.push(tPath);
      }

      const criteria: ConversationOwnershipCriteria = {
        expectedPromptSnippet: 'special-target-snippet-active',
        workspacePath: '/home/skul9x/Desktop/Code/Auto-plan-Extension-main'
      };

      let diskOpenCount = 0;
      const originalOpen = fs.promises.open;
      (fs.promises as any).open = async function (...args: any[]) {
        diskOpenCount++;
        return (originalOpen as any).apply(this, args);
      };

      try {
        console.log('  -> Polling 10 candidate conversation transcripts over 50 polling ticks (500 invocations)...');
        for (let tick = 0; tick < 50; tick++) {
          const candidates = await getCandidateConversationsAsync(brainDir, 0, undefined, criteria);
          assert.strictEqual(candidates.length, 1, `Tick ${tick} must identify exactly candidate 0`);
          assert.strictEqual(candidates[0].convId, 'conv_0');
        }

        const cacheStats = getConversationOwnershipCacheStats();
        console.log(`  -> Total disk open calls across 500 invocations: ${diskOpenCount}`);
        console.log(`  -> Cache stats: size=${cacheStats.size}, hits=${cacheStats.hits}, misses=${cacheStats.misses}`);

        assert.strictEqual(diskOpenCount, 10, `Total disk reads must be strictly capped at 10 (got ${diskOpenCount})`);
        assert.strictEqual(cacheStats.misses, 10, `Expected exactly 10 misses on tick 1 (got ${cacheStats.misses})`);
        assert.strictEqual(cacheStats.hits, 490, `Expected 490 cache hits across 50 ticks (got ${cacheStats.hits})`);
        const hitRate = (cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100;
        console.log(`  -> Hit rate: ${hitRate.toFixed(2)}%`);
        assert.ok(hitRate > 97, `Cache hit rate must exceed 97% (got ${hitRate.toFixed(2)}%)`);

        // Modify 1 transcript file
        console.log('  -> Modifying 1 transcript file (candidate 1) to match criteria...');
        let postModOpenCount = 0;
        const conv1File = candidatePaths[1];
        const updatedContent = JSON.stringify({
          type: 'USER_INPUT',
          content: 'Execution for candidate 1: special-target-snippet-active in /home/skul9x/Desktop/Code/Auto-plan-Extension-main'
        }) + '\n';
        fs.writeFileSync(conv1File, updatedContent, 'utf8');

        // Touch mtime forward by 2 seconds to ensure modified timestamp is registered
        const newTime = (Date.now() + 2000) / 1000;
        fs.utimesSync(conv1File, newTime, newTime);

        // Reset open counter for the modification tick
        diskOpenCount = 0;
        const candidatesAfterMod = await getCandidateConversationsAsync(brainDir, 0, undefined, criteria);
        assert.strictEqual(candidatesAfterMod.length, 2, 'Expected 2 matching candidates after file update');
        assert.strictEqual(diskOpenCount, 1, `Next tick must incur exactly 1 re-read for only the modified file (got ${diskOpenCount})`);
        console.log('  ✓ PERF-02 I/O Storm Elimination: Passed cleanly.\n');
      } finally {
        (fs.promises as any).open = originalOpen;
      }
    } finally {
      cleanupDir(brainDir);
    }
  }

  // ============================================================================
  // Scenario 3: PERF-04 Event Loop Non-Blocking (Asynchronous DOM Snapshot Disk Writing)
  // ============================================================================
  console.log('--------------------------------------------------------------------------------');
  console.log(' [Scenario 3] PERF-04 Event Loop Non-Blocking: 10MB Async Snapshot');
  console.log('--------------------------------------------------------------------------------');
  {
    const tempSnapshotDir = createTempDir('perf04_snapshots');
    const testLogger: any = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      registerPlanAuditProvider: () => {}
    };

    try {
      const payloadSize = 10 * 1024 * 1024; // 10MB
      const baseChunk = '<section class="vscode-token-test-node">DOM Snapshot Chunk 0123456789</section>\n';
      const repeatCount = Math.ceil(payloadSize / baseChunk.length);
      const mockDomHtml = '<!DOCTYPE html><html><head><title>10MB Benchmark</title></head><body>' +
        baseChunk.repeat(repeatCount).slice(0, payloadSize) +
        '</body></html>';

      const mockBridgeServer: any = {
        captureDomSnapshot: async () => ({
          success: true,
          html: mockDomHtml
        })
      };

      const orchestrator = new Orchestrator({
        configProvider: () => ({
          ...DEFAULT_CONFIG,
          enableDomSnapshots: true,
          domSnapshotFolder: tempSnapshotDir
        }),
        bridgeServer: mockBridgeServer,
        debugLogger: testLogger
      });

      // High-frequency event loop latency tracker (2ms intervals)
      let maxTickLatency = 0;
      let tickCount = 0;
      let lastTickTime = performance.now();

      const timer = setInterval(() => {
        const now = performance.now();
        const delta = now - lastTickTime;
        if (delta > maxTickLatency) {
          maxTickLatency = delta;
        }
        lastTickTime = now;
        tickCount++;
      }, 2);

      console.log('  -> Calling saveWorkbenchSnapshot() with a 10MB mock DOM snapshot...');
      const savedPath = await orchestrator.saveWorkbenchSnapshot({
        phaseIndex: 0,
        phaseName: 'phase-01',
        attempt: 1,
        triggerType: 'initial'
      });

      clearInterval(timer);

      assert.ok(savedPath, 'saveWorkbenchSnapshot must return a non-empty saved path');
      assert.ok(fs.existsSync(savedPath), `Persisted snapshot must exist at ${savedPath}`);

      console.log(`  -> Recorded ${tickCount} event loop ticks, maximum tick latency: ${maxTickLatency.toFixed(2)}ms`);
      assert.ok(
        maxTickLatency <= 30,
        `Event loop jitter monitored by 2ms timer must not exceed 30ms (got ${maxTickLatency.toFixed(2)}ms)`
      );

      console.log('  -> Verifying persisted snapshot file on disk matches byte-for-byte...');
      const diskContent = await fs.promises.readFile(savedPath, 'utf8');
      assert.strictEqual(diskContent.length, mockDomHtml.length, 'Persisted length must match original');
      assert.strictEqual(diskContent, mockDomHtml, 'Persisted content must match byte-for-byte');
      console.log('  ✓ PERF-04 Event Loop Non-Blocking: Passed cleanly.\n');
    } finally {
      cleanupDir(tempSnapshotDir);
    }
  }

  // ============================================================================
  // Scenario 4: PERF-05 Concurrent Stat Scanning (asyncPool Bounded Traversal)
  // ============================================================================
  console.log('--------------------------------------------------------------------------------');
  console.log(' [Scenario 4] PERF-05 Concurrent Stat Scanning: asyncPool(16, ...) & Baseline');
  console.log('--------------------------------------------------------------------------------');
  {
    // Part A: Validate asyncPool(16, ...) concurrency boundedness and error handling
    const poolItems = Array.from({ length: 48 }, (_, i) => i);
    let activeWorkers = 0;
    let maxObservedConcurrency = 0;

    const poolResults = await asyncPool(16, poolItems, async (item) => {
      activeWorkers++;
      if (activeWorkers > maxObservedConcurrency) {
        maxObservedConcurrency = activeWorkers;
      }
      await new Promise(r => setTimeout(r, 4));
      activeWorkers--;
      return item * 3;
    });

    assert.strictEqual(poolResults.length, 48, 'asyncPool must process all items');
    assert.strictEqual(maxObservedConcurrency, 16, 'Maximum concurrency must reach pool size 16');
    assert.ok(maxObservedConcurrency <= 16, 'Maximum concurrency must strictly remain <= 16');

    // Part B: Scan 60 simulated conversation directories with asyncPool(16, ...)
    const brainDir = createTempDir('perf05_brain');
    clearBrainDirCache(brainDir);

    try {
      console.log('  -> Setting up 60 simulated conversation directories...');
      const expectedSizes = new Map<string, number>();
      for (let i = 0; i < 60; i++) {
        const convDir = path.join(brainDir, `conv_${String(i).padStart(3, '0')}`);
        fs.mkdirSync(convDir, { recursive: true });
        const transcriptPath = writeTranscriptJsonl(convDir, [
          {
            type: 'USER_INPUT',
            content: `Prompt for conv #${i}: ` + 'X'.repeat(50 + (i % 10) * 10)
          }
        ]);
        const s = fs.statSync(transcriptPath);
        expectedSizes.set(transcriptPath, s.size);
      }

      console.log('  -> Executing concurrent stat scanning on cold cache...');
      const watcher = new TranscriptWatcher({
        brainDir,
        sinceTimestamp: 0
      });

      const startTime = performance.now();
      await watcher._initializeCandidateBaseline();
      const elapsedMs = performance.now() - startTime;

      console.log(`  -> Baseline scan of 60 directories completed in ${elapsedMs.toFixed(2)}ms (target: < 50ms)`);
      assert.ok(
        elapsedMs < 50,
        `Concurrent stat scanning took ${elapsedMs.toFixed(2)}ms, must complete in < 50ms`
      );

      const baselineSizes = watcher.getCandidateBaselineSizes();
      assert.strictEqual(baselineSizes.size, 60, `Expected exactly 60 entries in baselineSizes (got ${baselineSizes.size})`);

      for (const [tPath, expectedSize] of expectedSizes.entries()) {
        assert.ok(baselineSizes.has(tPath), `Baseline sizes must include ${tPath}`);
        assert.strictEqual(
          baselineSizes.get(tPath),
          expectedSize,
          `File size mismatch for ${tPath}: expected ${expectedSize}, got ${baselineSizes.get(tPath)}`
        );
      }
      console.log('  ✓ PERF-05 Concurrent Stat Scanning: Passed cleanly.\n');
    } finally {
      cleanupDir(brainDir);
    }
  }

  console.log('================================================================================');
  console.log(' ✅ ALL 4 CLINICAL AUDIT INTEGRATION SCENARIOS PASSED WITH CODE 0!');
  console.log('================================================================================');
}

runAllClinicalRemediationTests().catch(err => {
  console.error('\n❌ Clinical Audit Integration Test Failed:');
  console.error(err);
  process.exit(1);
});
