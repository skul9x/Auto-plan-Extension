// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockWorkspaceFolders: any[] = [
  {
    name: 'TramsacEV',
    uri: { fsPath: '/home/skul9x/Desktop/Code/TramsacEV' }
  }
];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: mockWorkspaceFolders,
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} })
      },
      commands: {
        executeCommand: (cmd: string) => Promise.resolve()
      },
      window: {
        showInformationMessage: () => Promise.resolve(),
        showWarningMessage: () => Promise.resolve(),
        showErrorMessage: () => Promise.resolve(),
        createStatusBarItem: () => ({ show: () => {}, hide: () => {}, dispose: () => {} }),
        registerWebviewViewProvider: () => ({ dispose: () => {} })
      },
      StatusBarAlignment: { Right: 2 },
      Uri: {
        file: (f: string) => ({ fsPath: f, scheme: 'file' })
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import { BridgeServer } from '../bridgeServer';
import { Orchestrator } from '../orchestrator';
import { PromptDispatcher } from '../promptDispatcher';
import { TranscriptWatcher, ConversationOwnershipCriteria } from '../transcriptWatcher';
import { scanPlanFolder, PhaseFile } from '../planScanner';
import { DEFAULT_CONFIG } from '../config';

function loadDomBridge() {
  const candidatePaths = [
    path.resolve(__dirname, '../../media/autoplan-dom-bridge.js'),
    path.resolve(__dirname, '../media/autoplan-dom-bridge.js'),
    path.resolve(process.cwd(), 'media/autoplan-dom-bridge.js')
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return require(p);
    }
  }
  throw new Error('Could not find media/autoplan-dom-bridge.js');
}

function httpRequest(
  options: http.RequestOptions,
  postData?: string | object
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any; rawBody: string }> {
  return new Promise((resolve, reject) => {
    const dataString = typeof postData === 'object' ? JSON.stringify(postData) : postData;
    const req = http.request(options, (res) => {
      let rawBody = '';
      res.on('data', (chunk) => {
        rawBody += chunk;
      });
      res.on('end', () => {
        let body = rawBody;
        try {
          body = JSON.parse(rawBody);
        } catch {
          // keep as string
        }
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body,
          rawBody
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (dataString) {
      req.write(dataString);
    }
    req.end();
  });
}

class MockClassList {
  private classes: Set<string> = new Set();
  constructor(className: string = '') {
    if (className) {
      className.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
    }
  }
  add(...tokens: string[]) { tokens.forEach((t) => this.classes.add(t)); }
  remove(...tokens: string[]) { tokens.forEach((t) => this.classes.delete(t)); }
  contains(token: string): boolean { return this.classes.has(token); }
  toString() { return Array.from(this.classes).join(' '); }
}

class MockEvent {
  public type: string;
  public bubbles: boolean;
  public cancelable: boolean;
  public composed: boolean;
  public target: any = null;
  constructor(type: string, options: any = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    this.composed = Boolean(options.composed);
  }
}

class MockElement {
  public tagName: string;
  public className: string;
  public classList: MockClassList;
  public attributes: Map<string, string> = new Map();
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public nodeType: number = 1;
  public textContent: string = '';
  public ownerDocument: MockDocument | null = null;

  constructor(tagName: string, className: string = '') {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.classList = new MockClassList(className);
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument || (this as any);
    this.children.push(child);
    return child;
  }

  querySelector(selector: string): MockElement | null {
    if (selector.includes('window-title') && this.classList.contains('window-title')) {
      return this;
    }
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const res: MockElement[] = [];
    if (selector.includes('window-title') && this.classList.contains('window-title')) {
      res.push(this);
    }
    for (const child of this.children) {
      res.push(...child.querySelectorAll(selector));
    }
    return res;
  }
}

class MockDocument extends MockElement {
  public title: string = '';
  public body: MockElement;

  constructor(title: string = '') {
    super('#document');
    this.nodeType = 9;
    this.ownerDocument = this;
    this.title = title;
    this.body = new MockElement('BODY');
    this.body.ownerDocument = this;
    this.appendChild(this.body);
  }

  createElement(tag: string): MockElement {
    const el = new MockElement(tag);
    el.ownerDocument = this;
    return el;
  }
}

async function runMultiWindowE2EResilienceTest() {
  console.log('=== Phase 03: Multi-Window Resilient E2E Integration Test ===\n');

  const domBridge = loadDomBridge();
  assert.ok(domBridge.DomBridgeClient, 'DomBridgeClient should be exported');

  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-p03-e2e-'));
  const portRegistryPath = path.join(tempBaseDir, 'ag-autoplan-ports.json');
  const brainDir = path.join(tempBaseDir, 'brain');
  fs.mkdirSync(brainDir, { recursive: true });

  const ws1Path = path.join(tempBaseDir, 'TramsacEV');
  const ws1PlanDir = path.join(ws1Path, 'plans', '260904-1015-fix-high-issues');
  fs.mkdirSync(ws1PlanDir, { recursive: true });
  const phase2FilePath = path.join(ws1PlanDir, 'phase-02-favorites-sync-metric-preservation.md');
  fs.writeFileSync(
    phase2FilePath,
    '# Phase 02: Favorites Sync Metric Preservation\n\nStatus: ⬜ Pending\n\nDependencies: None\n'
  );

  const ws2Path = path.join(tempBaseDir, 'Auto-plan-Extension');
  fs.mkdirSync(ws2Path, { recursive: true });

  let server1: BridgeServer | null = null;
  let server2: BridgeServer | null = null;
  let client1PollTimer: NodeJS.Timeout | null = null;

  try {
    // ------------------------------------------------------------------------
    // Step 1: Initialize Two Bridge Servers for Distinct Workspaces
    // ------------------------------------------------------------------------
    console.log('[Step 1] Initializing BridgeServer 1 (TramsacEV) and BridgeServer 2 (Auto-plan-Extension)...');
    server1 = new BridgeServer({
      portStart: 49600,
      portEnd: 49620,
      workspaceName: 'TramsacEV',
      workspacePath: ws1Path,
      portsRegistryPath: portRegistryPath,
      staleClientMs: 5000
    });
    const port1 = await server1.start();
    console.log(`✓ Server 1 started on Port ${port1} bound to workspace "TramsacEV"`);

    server2 = new BridgeServer({
      portStart: port1 + 1,
      portEnd: 49640,
      workspaceName: 'Auto-plan-Extension',
      workspacePath: ws2Path,
      portsRegistryPath: portRegistryPath,
      staleClientMs: 5000
    });
    const port2 = await server2.start();
    console.log(`✓ Server 2 started on Port ${port2} bound to workspace "Auto-plan-Extension"`);

    assert.strictEqual(port2, port1 + 1, 'Server 2 must bind to next consecutive available port');
    assert.strictEqual(server1.getWorkspaceName(), 'TramsacEV');
    assert.strictEqual(server2.getWorkspaceName(), 'Auto-plan-Extension');

    const clientFetch = async (url: string, opts: any = {}) => {
      const parsedUrl = new URL(url);
      const res = await httpRequest(
        {
          hostname: parsedUrl.hostname,
          port: Number(parsedUrl.port),
          path: parsedUrl.pathname + parsedUrl.search,
          method: opts.method || 'GET',
          headers: opts.headers
        },
        opts.body
      );

      return {
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        json: async () => res.body
      };
    };

    // ------------------------------------------------------------------------
    // Step 2: Verify Workspace-Bound DOM Bridge Port Discovery
    // ------------------------------------------------------------------------
    console.log('\n[Step 2] Testing DOM Bridge client discovery for Window 1 and Window 2...');

    // Client 1 for TramsacEV
    const mockDoc1 = new MockDocument('TramsacEV - Visual Studio Code');
    const client1 = new domBridge.DomBridgeClient({
      portStart: port1,
      portEnd: port2,
      windowKey: 'win1-client-initial',
      document: mockDoc1,
      window: { KeyboardEvent: MockEvent, Event: MockEvent },
      fetch: clientFetch
    });

    const discoveredPort1 = await client1.discoverPort();
    assert.strictEqual(discoveredPort1, port1, 'Window 1 client must discover and bind to Port 1 (TramsacEV)');
    const ping1Ok = await client1.sendHeartbeatPing();
    assert.strictEqual(ping1Ok, true, 'Window 1 client heartbeat ping must succeed on Port 1');
    console.log(`✓ Window 1 client successfully bound to Port ${port1} (TramsacEV)`);

    // Client 2 for Auto-plan-Extension
    const mockDoc2 = new MockDocument('Auto-plan-Extension - Visual Studio Code');
    const client2 = new domBridge.DomBridgeClient({
      portStart: port1,
      portEnd: port2,
      windowKey: 'win2-client-initial',
      document: mockDoc2,
      window: { KeyboardEvent: MockEvent, Event: MockEvent },
      fetch: clientFetch
    });

    // Verify probing Port 1 from Window 2 returns 409 workspace-mismatch
    const probePort1FromWin2 = await httpRequest({
      hostname: '127.0.0.1',
      port: port1,
      path: '/autoplan-status?probe=1&windowKey=win2-client-initial&workspaceName=Auto-plan-Extension',
      method: 'GET'
    });
    assert.strictEqual(probePort1FromWin2.statusCode, 409, 'Probing Port 1 from Window 2 must return 409 Conflict');
    assert.strictEqual(probePort1FromWin2.body.rejectReason, 'workspace-mismatch', 'Rejection reason must be workspace-mismatch');

    // Discover port for Client 2 (should skip Port 1 and bind to Port 2)
    const discoveredPort2 = await client2.discoverPort();
    assert.strictEqual(discoveredPort2, port2, 'Window 2 client must discover and bind to Port 2 (Auto-plan-Extension)');
    const ping2Ok = await client2.sendHeartbeatPing();
    assert.strictEqual(ping2Ok, true, 'Window 2 client heartbeat ping must succeed on Port 2');
    console.log(`✓ Window 2 client bypassed Port ${port1} and bound to Port ${port2} (Auto-plan-Extension)`);

    // ------------------------------------------------------------------------
    // Step 3: Simulated Window Reload & Instant Rebind Takeover
    // ------------------------------------------------------------------------
    console.log('\n[Step 3] Simulating Window 1 reload with new windowKey and testing instant takeover...');
    const reloadedWinKey = 'win1-client-reloaded-key';
    const client1Reloaded = new domBridge.DomBridgeClient({
      portStart: port1,
      portEnd: port2,
      windowKey: reloadedWinKey,
      document: mockDoc1,
      window: { KeyboardEvent: MockEvent, Event: MockEvent },
      fetch: clientFetch
    });

    const reloadedDiscoveredPort = await client1Reloaded.discoverPort();
    assert.strictEqual(reloadedDiscoveredPort, port1, 'Reloaded Window 1 must re-bind to Port 1');
    const reloadedPingOk = await client1Reloaded.sendHeartbeatPing();
    assert.strictEqual(reloadedPingOk, true, 'Reloaded client heartbeat must succeed on Port 1');

    const statusAfterReload = server1.getStatus();
    assert.strictEqual(statusAfterReload.activeWindowKey, reloadedWinKey, 'Server 1 activeWindowKey must be updated to reloaded window key');
    console.log(`✓ Window 1 successfully reloaded and reclaimed Port ${port1} without 409 lockout (activeWindowKey: "${statusAfterReload.activeWindowKey}")`);

    // ------------------------------------------------------------------------
    // Step 4: Setup Window 1 Dispatcher, Watcher, and Orchestrator
    // ------------------------------------------------------------------------
    console.log('\n[Step 4] Setting up Orchestrator and Dispatcher for Window 1...');

    const promptDispatcher1 = new PromptDispatcher({
      bridgeServer: server1,
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        executionMode: 'domBridge',
        promptText: 'Implement the code closely following the file {path}',
        bridgeTimeoutMs: 6000
      })
    });

    // Start simulated background client handling on Window 1
    client1Reloaded.isRunning = true;
    client1Reloaded.handleCommand = async (cmd: any) => {
      if (cmd.type === 'openNewConversation') {
        await client1Reloaded.sendAck(cmd.id, 'completed', undefined, { ok: true });
      } else {
        await client1Reloaded.sendAck(cmd.id, 'submitClicked', undefined, { promptText: cmd.text });
      }
    };

    client1PollTimer = setInterval(async () => {
      try {
        await client1Reloaded.pollTick();
      } catch {}
    }, 40);

    const transcriptWatcher1 = new TranscriptWatcher({
      brainDir,
      pollIntervalMs: 40
    });

    const orchestrator1 = new Orchestrator({
      promptDispatcher: promptDispatcher1,
      transcriptWatcher: transcriptWatcher1,
      workspaceName: 'TramsacEV',
      workspacePath: ws1Path,
      configProvider: () => ({
        ...DEFAULT_CONFIG,
        executionMode: 'domBridge',
        promptText: 'Implement the code closely following the file {path}',
        newConversationTimeoutMs: 12000,
        completionKeyword: 'Done skul9x.'
      })
    });

    const skippedCandidates: string[] = [];
    transcriptWatcher1.on('candidateSkipped', (data) => {
      skippedCandidates.push(data.convId);
      console.log(`  -> Foreign conversation skipped: ${data.convId}`);
    });

    let phase1Completed = false;
    orchestrator1.on('phaseComplete', (phase, result) => {
      if (phase.fileName.includes('phase-02-favorites-sync-metric-preservation.md')) {
        phase1Completed = true;
        console.log(`✓ Phase 2 marked Completed by Orchestrator 1 (matched keyword: "${result?.matchedContent}")`);
      }
    });

    // ------------------------------------------------------------------------
    // Step 5: Dispatch Phase 02 and Simulate Window 2 Alien Prompt Cross-Talk
    // ------------------------------------------------------------------------
    console.log('\n[Step 5] Starting phase execution for Window 1 and injecting alien Window 2 conversation...');

    const scannedPhases = scanPlanFolder(ws1PlanDir);
    assert.strictEqual(scannedPhases.length, 1, 'Scanned plan folder must contain 1 phase');
    const phase2Item = scannedPhases[0];

    // Trigger phase execution in background
    const orchestratorPromise = orchestrator1.startPhases([phase2Item]);

    // Give dispatcher time to complete prompt submission and enter waitForNewConversation
    await new Promise((r) => setTimeout(r, 600));

    // While Window 1 is waiting, simulate Window 2 receiving an unrelated prompt and writing transcript
    console.log('-> Simulating Window 2 receiving an unrelated prompt and creating conversation folder...');
    const alienConvId = 'conv_win2_autoplan_unrelated';
    const alienConvDir = path.join(brainDir, alienConvId);
    fs.mkdirSync(alienConvDir, { recursive: true });
    fs.writeFileSync(
      path.join(alienConvDir, 'transcript.jsonl'),
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        content: '<USER_REQUEST>\nRefactor Auto-plan-Extension sidebar view components\n</USER_REQUEST>'
      }) + '\n'
    );

    // Allow watcher loop to inspect and reject the alien candidate
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(
      skippedCandidates.includes(alienConvId),
      'Window 1 TranscriptWatcher must explicitly reject alien Window 2 conversation'
    );
    console.log(`✓ Verified: Window 1 rejected alien conversation "${alienConvId}" due to prompt fingerprint & workspace mismatch`);

    // ------------------------------------------------------------------------
    // Step 6: Write Window 1's Matching Transcript with Completion Keyword
    // ------------------------------------------------------------------------
    console.log('\n[Step 6] Writing Window 1 matching transcript and completing conversation...');
    const validConvId = 'conv_win1_tramsac_phase02';
    const validConvDir = path.join(brainDir, validConvId);
    fs.mkdirSync(validConvDir, { recursive: true });
    const validTranscriptFile = path.join(validConvDir, 'transcript.jsonl');

    // Step 0: User request matching phase-02-favorites-sync-metric-preservation.md
    fs.writeFileSync(
      validTranscriptFile,
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        content: `<USER_REQUEST>\nImplement the code closely following the file ${phase2FilePath}\n</USER_REQUEST>`
      }) + '\n'
    );

    // Allow watcher to bind to valid conversation
    await new Promise((r) => setTimeout(r, 300));

    // Step 1: Model response with Done skul9x. keyword
    fs.appendFileSync(
      validTranscriptFile,
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        content: 'I have finished implementing all requested changes according to spec.\n\nDone skul9x.'
      }) + '\n'
    );

    // Wait for orchestrator sequence to finish cleanly
    await orchestratorPromise;

    assert.strictEqual(phase1Completed, true, 'Phase 02 must be marked Completed');
    const orchestratorPhases = orchestrator1.getPhases();
    assert.strictEqual(orchestratorPhases[0].status, 'Completed', 'Orchestrator phase status must be Completed');
    console.log('✓ End-to-end multi-window isolation and completion verified successfully!');

    console.log('\n=== All Phase 03 Tests Passed Cleanly! ===');
  } finally {
    if (client1PollTimer) {
      clearInterval(client1PollTimer);
    }
    if (server1) {
      await server1.stop();
    }
    if (server2) {
      await server2.stop();
    }

    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  }
}

runMultiWindowE2EResilienceTest().catch((err) => {
  console.error('Phase 03 Test Failed:', err);
  process.exit(1);
});
