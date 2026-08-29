// Standalone Mock Setup for 'vscode' before importing application modules
const Module = require('module');
const originalRequire = Module.prototype.require;

interface MockDisposable {
  dispose: () => void;
}

const mockConfigStore: Record<string, any> = {};
let activeErrorMessages: { message: string; actions: string[] }[] = [];
let activeInfoMessages: string[] = [];
let executedCommands: { command: string; args: any[] }[] = [];

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section?: string) => ({
          get: (key: string, defaultValue: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            if (mockConfigStore[fullKey] !== undefined) return mockConfigStore[fullKey];
            if (mockConfigStore[key] !== undefined) return mockConfigStore[key];
            return defaultValue;
          },
          update: async (key: string, value: any, _target?: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            mockConfigStore[fullKey] = value;
            mockConfigStore[key] = value;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        workspaceFolders: []
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      commands: {
        executeCommand: async (cmd: string, ...args: any[]) => {
          executedCommands.push({ command: cmd, args });
          return true;
        }
      },
      window: {
        showErrorMessage: async (msg: string, ...actions: string[]) => {
          activeErrorMessages.push({ message: msg, actions });
          return actions[0];
        },
        showInformationMessage: async (msg: string) => {
          activeInfoMessages.push(msg);
        },
        showWarningMessage: async () => {}
      },
      env: {
        clipboard: {
          writeText: async () => {},
          readText: async () => ''
        }
      }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { Orchestrator, PhaseItem } from '../orchestrator';
import { BridgeServer } from '../bridgeServer';
import { KeyboardManager } from '../keyboardManager';
import { PromptDispatcher, DispatchReadinessResult } from '../promptDispatcher';
import { TranscriptWatcher } from '../transcriptWatcher';
import { getConfig, updateConfig, AutoPlanConfig, DEFAULT_COMPLETION_KEYWORD } from '../config';

function writeTranscriptLog(convDir: string, content: string, delayMs: number = 0) {
  const logsDir = path.join(convDir, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const transcriptPath = path.join(logsDir, 'transcript.jsonl');

  if (delayMs > 0) {
    setTimeout(() => {
      fs.appendFileSync(transcriptPath, content + '\n', 'utf-8');
    }, delayMs);
  } else {
    fs.appendFileSync(transcriptPath, content + '\n', 'utf-8');
  }
}

async function runPhase04E2ETests() {
  console.log('================================================================');
  console.log('  Phase 04 Test Suite: E2E Tier Execution & Settings Integration');
  console.log('================================================================\n');

  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-phase04-e2e-'));
  const tempPlanDir = path.join(tempBaseDir, 'plans');
  const tempBrainDir = path.join(tempBaseDir, 'brain');

  fs.mkdirSync(tempPlanDir, { recursive: true });
  fs.mkdirSync(tempBrainDir, { recursive: true });

  const phase1Path = path.join(tempPlanDir, 'phase-01-tier-test.md');
  fs.writeFileSync(phase1Path, '# Phase 1: Tier Execution Test\nContent', 'utf-8');

  try {
    // --------------------------------------------------------------------------
    // Test 1: Orchestrator Execution under Strict Tier 1 vs Auto Fallback
    // --------------------------------------------------------------------------
    console.log('[Test 1] Testing Orchestrator under Strict Tier 1 vs Auto Fallback...');
    {
      // 1.1 DOM Bridge Connected: Strict Tier 1 succeeds
      const server1 = new BridgeServer({
        portStart: 49260,
        portEnd: 49275,
        windowKey: 'test-strict-t1-win'
      });
      const port1 = await server1.start();

      // Register heartbeat client
      const heartbeatReq = http.request({
        host: '127.0.0.1',
        port: port1,
        path: '/autoplan-status?clientVersion=2.0.0&windowKey=test-strict-t1-win',
        method: 'GET',
        timeout: 2000
      });
      heartbeatReq.on('error', () => {});
      heartbeatReq.end();
      await new Promise((r) => setTimeout(r, 100));

      assert.strictEqual(server1.getConnectedClients().length, 1, 'Bridge server should have 1 connected client');

      let convCounter = 1;
      const watcher1 = new TranscriptWatcher({
        brainDir: tempBrainDir,
        keyword: DEFAULT_COMPLETION_KEYWORD,
        pollIntervalMs: 50
      });

      const dispatcher1 = new PromptDispatcher({
        bridgeServer: server1,
        commandExecutor: async (cmd: string) => {
          return { success: true, command: cmd };
        }
      });

      // Override bridgeServer.dispatchPromptCommand to mock successful DOM bridge delivery and trigger conversation
      server1.dispatchPromptCommand = async () => {
        const convId = `conv-strict-t1-${convCounter++}`;
        const convDir = path.join(tempBrainDir, convId);
        fs.mkdirSync(convDir, { recursive: true });
        const doneJson = JSON.stringify({
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          content: `Finished strict tier 1 test! ${DEFAULT_COMPLETION_KEYWORD}`
        });
        writeTranscriptLog(convDir, doneJson, 30);
        return {
          success: true,
          commandId: 'cmd-test-strict-t1',
          status: 'completed',
          clientCount: 1,
          durationMs: 10
        };
      };

      const orchestrator1 = new Orchestrator({
        promptDispatcher: dispatcher1,
        transcriptWatcher: watcher1,
        configProvider: () => ({
          promptText: 'Test prompt',
          promptTemplate: 'Prompt for {file}',
          repeatCount: 1,
          completionKeyword: DEFAULT_COMPLETION_KEYWORD,
          delayBetweenLoopsMs: 10,
          timeoutPerLoopMinutes: 1,
          executionMode: 'domBridge',
          allowTierFallback: false,
          strictMode: true
        })
      });

      const startResult = await orchestrator1.startPhases([phase1Path]);
      assert.strictEqual(startResult, true, 'Orchestrator must execute successfully when DOM bridge is connected');
      assert.strictEqual(orchestrator1.getState(), 'completed', 'Orchestrator state must be completed');
      await server1.stop();
      console.log('  ✓ Orchestrator successfully executed phase under connected Strict Tier 1');

      // 1.2 DOM Bridge Disconnected: Strict Tier 1 halts with pre-flight error
      const serverDisconnected = new BridgeServer({
        portStart: 49280,
        portEnd: 49295,
        windowKey: 'test-strict-t1-disconnected'
      });

      const dispatcherDisconnected = new PromptDispatcher({
        bridgeServer: serverDisconnected
      });

      let notifiedError = '';
      let notifiedActions: string[] = [];
      const orchestratorStrictFail = new Orchestrator({
        promptDispatcher: dispatcherDisconnected,
        transcriptWatcher: watcher1,
        actionableErrorNotifier: async (err: string, ...items: string[]) => {
          notifiedError = err;
          notifiedActions = items;
          return items[0];
        },
        configProvider: () => ({
          promptText: 'Test prompt',
          repeatCount: 1,
          completionKeyword: DEFAULT_COMPLETION_KEYWORD,
          delayBetweenLoopsMs: 10,
          timeoutPerLoopMinutes: 1,
          executionMode: 'domBridge',
          allowTierFallback: false,
          strictMode: true
        })
      });

      let errorEventFired = false;
      let errorEventMessage = '';
      orchestratorStrictFail.on('error', (err: Error) => {
        errorEventFired = true;
        errorEventMessage = err.message;
      });

      const strictFailResult = await orchestratorStrictFail.startPhases([phase1Path]);
      assert.strictEqual(strictFailResult, false, 'Orchestrator must immediately halt when strict Tier 1 has 0 clients');
      assert.strictEqual(orchestratorStrictFail.getState(), 'error', 'Orchestrator state must be error');
      assert.strictEqual(errorEventFired, true, 'Error event must be emitted');
      assert.ok(
        errorEventMessage.includes("Pre-flight check failed for selected mode 'domBridge'"),
        `Error message must mention mode and pre-flight failure: ${errorEventMessage}`
      );
      assert.ok(
        notifiedActions.includes('⚙️ Open Settings Panel'),
        'Actionable notification must offer ⚙️ Open Settings Panel'
      );
      assert.ok(
        notifiedActions.includes('⚡ 1-Click DOM Bridge Setup'),
        'Actionable notification must offer ⚡ 1-Click DOM Bridge Setup'
      );
      console.log('  ✓ Orchestrator immediately halted with actionable pre-flight error when Strict Tier 1 was disconnected');
    }

    // --------------------------------------------------------------------------
    // Test 2: Orchestrator Execution under Strict Tier 3 on Linux
    // --------------------------------------------------------------------------
    console.log('\n[Test 2] Testing Orchestrator Execution under Strict Tier 3 on Linux...');
    {
      const mockKeyboardNoXdotool = new KeyboardManager();
      // Mock Linux missing xdotool
      mockKeyboardNoXdotool.checkLinuxKeyboardPrerequisites = () => ({
        available: false,
        binary: null
      });

      const emptyBridge = new BridgeServer({
        portStart: 49300,
        portEnd: 49310,
        windowKey: 'test-linux-no-xdotool'
      });

      const dispatcherLinux = new PromptDispatcher({
        bridgeServer: emptyBridge,
        keyboardManager: mockKeyboardNoXdotool
      });

      // Override platform check in validateDispatchReadiness for Linux simulation
      const origValidate = dispatcherLinux.validateDispatchReadiness.bind(dispatcherLinux);
      dispatcherLinux.validateDispatchReadiness = (platform, mode, allowFallback) => {
        return origValidate(platform || 'linux', mode, allowFallback);
      };

      let actionCalled = false;
      let errorReported = '';
      let offeredActions: string[] = [];

      const orchestratorLinuxStrict = new Orchestrator({
        promptDispatcher: dispatcherLinux,
        actionableErrorNotifier: async (msg: string, ...actions: string[]) => {
          actionCalled = true;
          errorReported = msg;
          offeredActions = actions;
          return '⚙️ Open Settings Panel';
        },
        configProvider: () => ({
          promptText: 'Test prompt',
          repeatCount: 1,
          completionKeyword: DEFAULT_COMPLETION_KEYWORD,
          delayBetweenLoopsMs: 10,
          timeoutPerLoopMinutes: 1,
          executionMode: 'keyboard',
          allowTierFallback: false,
          strictMode: true
        })
      });

      let errorReceived = false;
      orchestratorLinuxStrict.on('error', (err: Error) => {
        errorReceived = true;
      });

      const linuxResult = await orchestratorLinuxStrict.startPhases([phase1Path]);
      assert.strictEqual(linuxResult, false, 'Orchestrator must halt on Linux when Strict Tier 3 is selected without xdotool');
      assert.strictEqual(orchestratorLinuxStrict.getState(), 'error', 'State must be error');
      assert.strictEqual(errorReceived, true, 'Error event must have been emitted');
      assert.strictEqual(actionCalled, true, 'Actionable error notifier must be invoked');
      assert.ok(
        errorReported.includes("Pre-flight check failed for selected mode 'keyboard'"),
        `Error must mention keyboard mode failure: ${errorReported}`
      );
      assert.ok(
        offeredActions.includes('⚙️ Open Settings Panel') &&
        offeredActions.includes('⚡ 1-Click DOM Bridge Setup') &&
        offeredActions.includes('Install Guide'),
        'Offered actions must contain Settings Panel, DOM Bridge Setup, and Install Guide'
      );
      console.log('  ✓ Orchestrator properly halted and escalated actionable error for Strict Tier 3 on Linux without xdotool');
    }

    // --------------------------------------------------------------------------
    // Test 3: Settings Persistence & Dynamic Integration
    // --------------------------------------------------------------------------
    console.log('\n[Test 3] Testing Settings Persistence & Dynamic Integration...');
    {
      // Verify initial config reading
      let currentConfig = getConfig();
      assert.strictEqual(typeof currentConfig.executionMode, 'string', 'executionMode should be defined');

      // Update configuration dynamically via updateConfig
      await updateConfig('executionMode', 'domBridge');
      await updateConfig('allowTierFallback', false);

      currentConfig = getConfig();
      assert.strictEqual(currentConfig.executionMode, 'domBridge', 'executionMode must be updated to domBridge');
      assert.strictEqual(currentConfig.allowTierFallback, false, 'allowTierFallback must be updated to false');

      // Verify orchestrator dynamically reads updated config and alters preflight behavior
      const emptyBridge = new BridgeServer({
        portStart: 49320,
        portEnd: 49330,
        windowKey: 'test-dynamic-settings'
      });
      const dynamicDispatcher = new PromptDispatcher({
        bridgeServer: emptyBridge
      });

      const dynamicOrchestrator = new Orchestrator({
        promptDispatcher: dynamicDispatcher,
        configProvider: getConfig
      });
      let dynamicErrorFired = false;
      dynamicOrchestrator.on('error', () => {
        dynamicErrorFired = true;
      });

      const preflightUnready = await dynamicOrchestrator.startPhases([phase1Path]);
      assert.strictEqual(preflightUnready, false, 'Orchestrator pre-flight must fail immediately with new strict config');
      assert.strictEqual(dynamicErrorFired, true, 'Dynamic orchestrator must fire error event on strict pre-flight failure');

      // Now toggle fallback back to true
      await updateConfig('executionMode', 'auto');
      await updateConfig('allowTierFallback', true);

      const updatedConfig = getConfig();
      assert.strictEqual(updatedConfig.executionMode, 'auto', 'executionMode restored to auto');
      assert.strictEqual(updatedConfig.allowTierFallback, true, 'allowTierFallback restored to true');

      // Test phase dispatch failure metadata recording
      const failDispatcher = new PromptDispatcher({
        bridgeServer: emptyBridge
      });
      failDispatcher.dispatchPrompt = async () => {
        throw new Error('Forced strict dispatch failure simulation');
      };

      const phaseFailOrchestrator = new Orchestrator({
        promptDispatcher: failDispatcher,
        configProvider: () => ({
          promptText: 'Test prompt',
          repeatCount: 1,
          completionKeyword: DEFAULT_COMPLETION_KEYWORD,
          delayBetweenLoopsMs: 10,
          timeoutPerLoopMinutes: 1,
          executionMode: 'auto',
          allowTierFallback: true
        })
      });
      phaseFailOrchestrator.on('error', () => {});

      // Bypass pre-flight check in this mock dispatcher to test run-time dispatch failure in phase
      failDispatcher.validateDispatchReadiness = () => ({
        ready: true,
        selectedTier: 'domBridge',
        isFocusFree: true,
        requiresForegroundFocus: false,
        details: { connectedClientsCount: 1, os: 'linux' }
      });

      const failRunResult = await phaseFailOrchestrator.startPhases([phase1Path]);
      assert.strictEqual(failRunResult, false, 'Phase run must return false on dispatch error');
      const phases = phaseFailOrchestrator.getPhases();
      assert.strictEqual(phases.length, 1, 'Should have 1 phase');
      assert.strictEqual(phases[0].status, 'Failed', 'Phase status must be marked Failed immediately');
      assert.ok(phases[0].endTime !== undefined, 'Phase endTime must be recorded');
      assert.ok(phases[0].error?.includes('Forced strict dispatch failure simulation'), 'Phase error must be recorded');
      assert.strictEqual(phases[0].dispatchResult?.success, false, 'dispatchResult.success must be false');
      console.log('  ✓ Dynamic settings configuration persistence and phase dispatch failure tracking verified');
    }

    // --------------------------------------------------------------------------
    // Test 4: Documentation Completeness Verification
    // --------------------------------------------------------------------------
    console.log('\n[Test 4] Testing Documentation Completeness (README.md & CHANGELOG.md)...');
    {
      const workspaceRoot = path.resolve(__dirname, '..', '..');
      const readmePath = path.join(workspaceRoot, 'README.md');
      const changelogPath = path.join(workspaceRoot, 'CHANGELOG.md');

      assert.strictEqual(fs.existsSync(readmePath), true, 'README.md must exist');
      assert.strictEqual(fs.existsSync(changelogPath), true, 'CHANGELOG.md must exist');

      const readmeContent = fs.readFileSync(readmePath, 'utf-8');
      const changelogContent = fs.readFileSync(changelogPath, 'utf-8');

      // Verify README mentions
      assert.ok(
        readmeContent.includes('🖼️ Bảng Điều Khiển Cấu Hình Toàn Màn Hình (Settings Panel)'),
        'README.md must contain Settings Panel section title'
      );
      assert.ok(
        readmeContent.includes('autoplan.openSettings'),
        'README.md must document autoplan.openSettings command'
      );
      assert.ok(
        readmeContent.includes('Tier 1 (Focus-Free DOM Bridge)') &&
        readmeContent.includes('Tier 2 (VS Code Native Commands)') &&
        readmeContent.includes('Tier 3 (OS Keyboard Simulation)'),
        'README.md must document all 3 tiers'
      );
      assert.ok(
        readmeContent.includes('allowTierFallback'),
        'README.md must document allowTierFallback setting'
      );
      assert.ok(
        readmeContent.includes('⚙️ Open Settings Panel') &&
        readmeContent.includes('⚡ 1-Click DOM Bridge Setup'),
        'README.md must document actionable pre-flight notification options'
      );

      // Verify CHANGELOG mentions
      assert.ok(
        changelogContent.includes('## [1.2.0]'),
        'CHANGELOG.md must contain [1.2.0] release entry'
      );
      assert.ok(
        changelogContent.includes('Full-Screen Settings Panel') &&
        changelogContent.includes('Strict Tier Execution') &&
        changelogContent.includes('Resilient Fallback Policy Controls'),
        'CHANGELOG.md must describe Settings Panel and Strict Tier features'
      );

      console.log('  ✓ Documentation completeness verified in README.md and CHANGELOG.md');
    }

    console.log('\n================================================================');
    console.log('  ✓ ALL 4 TEST SUITES PASSED FOR PHASE 04 E2E TIER EXECUTION!   ');
    console.log('================================================================\n');
  } finally {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  }
}

runPhase04E2ETests().catch((err) => {
  console.error('\n❌ Phase 04 Test Failure:', err);
  process.exit(1);
});
