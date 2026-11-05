// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

const channelLines: string[] = [];
const mockConfigStore: Record<string, any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        getConfiguration: (section: string) => ({
          get: (key: string, defaultValue: any) =>
            mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue,
          update: async (key: string, val: any) => {
            mockConfigStore[key] = val;
          }
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
        workspaceFolders: []
      },
      commands: {
        executeCommand: async (_cmd: string, ..._args: any[]) => undefined
      },
      window: {
        createOutputChannel: (name: string) => ({
          name,
          appendLine: (line: string) => {
            channelLines.push(line);
          },
          show: () => {},
          dispose: () => {}
        }),
        showWarningMessage: (_msg: string) => undefined,
        showInformationMessage: async () => {},
        showErrorMessage: async () => {}
      },
      ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { Orchestrator, PhaseItem } from '../orchestrator';
import { DebugLogger } from '../debugLogger';
import {
  AutoPlanConfig,
  DEFAULT_CONFIG,
  DEFAULT_LONG_PHASE_NUDGE_MESSAGE,
  getConfig,
  getLongPhaseNudgeConfig
} from '../config';
import {
  DispatchResult,
  DispatchOptions,
  DispatchReadinessResult
} from '../promptDispatcher';
import {
  PromptOriginTracker
} from '../promptOriginTracker';

class MockPromptDispatcher extends EventEmitter {
  public stopActiveGenerationCalls: Array<{ options?: DispatchOptions }> = [];
  public dispatchPromptCalls: Array<{ prompt: string; options?: DispatchOptions }> = [];
  public shouldFailStop: boolean = false;
  public stopErrorMessage: string = 'Simulated stop failure';
  public shouldFailDispatch: boolean = false;
  public dispatchErrorMessage: string = 'Bridge offline';
  public throwOnDispatch: boolean = false;

  public readinessResult: DispatchReadinessResult = {
    ready: true,
    selectedTier: 'domBridge',
    isFocusFree: true,
    requiresForegroundFocus: false,
    details: {
      connectedClientsCount: 1,
      os: 'win32'
    }
  };

  public validateDispatchReadiness(): DispatchReadinessResult {
    return this.readinessResult;
  }

  public async ensureBridgeReadinessWithWakeup(): Promise<DispatchReadinessResult> {
    return this.readinessResult;
  }

  public async stopActiveGeneration(options?: DispatchOptions): Promise<boolean> {
    this.stopActiveGenerationCalls.push({ options });
    if (this.shouldFailStop) {
      throw new Error(this.stopErrorMessage);
    }
    return true;
  }

  public async dispatchPrompt(prompt: string, options?: DispatchOptions): Promise<DispatchResult> {
    this.dispatchPromptCalls.push({ prompt, options });
    if (this.throwOnDispatch) {
      throw new Error(this.dispatchErrorMessage);
    }
    if (this.shouldFailDispatch) {
      return {
        success: false,
        tier: 'domBridge',
        durationMs: 25,
        error: this.dispatchErrorMessage
      };
    }
    return {
      success: true,
      tier: 'domBridge',
      durationMs: 35,
      status: 'submitted'
    };
  }

  public reset(): void {
    this.stopActiveGenerationCalls = [];
    this.dispatchPromptCalls = [];
    this.shouldFailStop = false;
    this.shouldFailDispatch = false;
    this.throwOnDispatch = false;
  }
}

class MockTranscriptWatcher extends EventEmitter {
  public isWatching: boolean = false;
  public getOptions() {
    return {
      brainDir: os.tmpdir(),
      pollIntervalMs: 50,
      keyword: 'Done skul9x.'
    };
  }
  public setOptions(_opts: any): void {}
  public stop(): void {
    this.isWatching = false;
  }
}

function createDummyPhase(index: number = 0, name: string = 'phase-01-deactivation.md'): PhaseItem {
  return {
    index,
    phaseNumber: index + 1,
    fileName: name,
    filePath: path.join(os.tmpdir(), name),
    nativePath: path.join(os.tmpdir(), name),
    normalizedPath: path.join(os.tmpdir(), name).replace(/\\/g, '/'),
    status: 'Running',
    startTime: Date.now()
  };
}

async function runPhase01DeactivationTests() {
  console.log('================================================================');
  console.log(' Phase 01: Nudge Watchdog Deactivation Verification Test');
  console.log('================================================================\n');

  // Clear mock configuration store
  for (const k of Object.keys(mockConfigStore)) {
    delete mockConfigStore[k];
  }

  // -------------------------------------------------------------------------
  // Req 1: Verify default resolution of getConfig().longPhaseNudgeEnabled === false
  // -------------------------------------------------------------------------
  console.log('[Req 1] Verifying default configuration resolution...');
  {
    const resolvedConfig = getConfig();
    assert.strictEqual(
      resolvedConfig.longPhaseNudgeEnabled,
      false,
      'getConfig().longPhaseNudgeEnabled must default to false when unspecified'
    );
    assert.strictEqual(
      DEFAULT_CONFIG.longPhaseNudgeEnabled,
      false,
      'DEFAULT_CONFIG.longPhaseNudgeEnabled must be false'
    );

    const nudgeConfig = getLongPhaseNudgeConfig();
    assert.strictEqual(
      nudgeConfig.enabled,
      false,
      'getLongPhaseNudgeConfig().enabled must default to false'
    );
    assert.strictEqual(
      nudgeConfig.thresholdSeconds,
      180,
      'getLongPhaseNudgeConfig().thresholdSeconds must remain 180'
    );
    console.log('  ✓ getConfig() and getLongPhaseNudgeConfig() default longPhaseNudgeEnabled to false.');
  }

  // -------------------------------------------------------------------------
  // Req 2: Verify package.json declares autoplan.longPhaseNudgeEnabled default as false
  // -------------------------------------------------------------------------
  console.log('\n[Req 2] Verifying package.json manifest default...');
  {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkgContent = fs.readFileSync(pkgPath, 'utf8');
    const pkgJson = JSON.parse(pkgContent);
    const properties = pkgJson?.contributes?.configuration?.properties;
    assert.ok(properties, 'package.json contributes.configuration.properties must be defined');

    const nudgeProp = properties['autoplan.longPhaseNudgeEnabled'];
    assert.ok(nudgeProp, 'autoplan.longPhaseNudgeEnabled property must exist in package.json');
    assert.strictEqual(nudgeProp.type, 'boolean', 'Property type must be boolean');
    assert.strictEqual(nudgeProp.default, false, 'Property default must be false in package.json');
    console.log('  ✓ package.json contributes autoplan.longPhaseNudgeEnabled with default false.');
  }

  // Common test dependencies for orchestrator tests
  const logger = new DebugLogger(200);
  const mockDispatcher = new MockPromptDispatcher();
  const mockWatcher = new MockTranscriptWatcher();

  const createTestOrchestrator = (configOverrides?: Partial<AutoPlanConfig>) => {
    const baseConfig = getConfig();
    const currentConfig: AutoPlanConfig = {
      ...baseConfig,
      ...(configOverrides || {})
    };
    const orch = new Orchestrator({
      configProvider: () => currentConfig,
      promptDispatcher: mockDispatcher as any,
      transcriptWatcher: mockWatcher as any,
      debugLogger: logger
    });
    // Set dedicated PromptOriginTracker
    orch.setPromptOriginTracker(new PromptOriginTracker({ autoPrune: false }));
    return orch;
  };

  // -------------------------------------------------------------------------
  // Req 3: Verify startPhaseNudgeWatchdog with default config does not schedule a timer
  // -------------------------------------------------------------------------
  console.log('\n[Req 3] Verifying startPhaseNudgeWatchdog does not schedule timer with default config...');
  {
    mockDispatcher.reset();
    const orchestrator = createTestOrchestrator();
    const phase = createDummyPhase(0, 'phase-default.md');

    orchestrator.startPhaseNudgeWatchdog(phase, 0);

    assert.strictEqual(
      orchestrator.isPhaseNudgeTimerActive(),
      false,
      'isPhaseNudgeTimerActive() must be false when longPhaseNudgeEnabled is default (false)'
    );

    // Also verify with explicit thresholdMs argument
    orchestrator.startPhaseNudgeWatchdog(phase, 0, 50);
    assert.strictEqual(
      orchestrator.isPhaseNudgeTimerActive(),
      false,
      'isPhaseNudgeTimerActive() must remain false even if thresholdMs is passed'
    );
    console.log('  ✓ startPhaseNudgeWatchdog immediately returns without scheduling timer when disabled by default.');
  }

  // -------------------------------------------------------------------------
  // Req 4: Verify simulated phase running past threshold does not trigger nudge, emit event, or track prompt
  // -------------------------------------------------------------------------
  console.log('\n[Req 4] Verifying simulated phase running past threshold does not invoke nudge or emit events...');
  {
    mockDispatcher.reset();
    const orchestrator = createTestOrchestrator();
    const phase = createDummyPhase(0, 'phase-simulated.md');

    let nudgeEventEmitted = false;
    orchestrator.on('phaseNudged', () => {
      nudgeEventEmitted = true;
    });

    orchestrator.startPhaseNudgeWatchdog(phase, 0, 50);

    // Wait 250ms (simulated expiration beyond 50ms threshold)
    await new Promise((r) => setTimeout(r, 250));

    assert.strictEqual(
      orchestrator.isPhaseNudgeTimerActive(),
      false,
      'Watchdog timer must remain inactive'
    );
    assert.strictEqual(
      phase.hasNudged,
      undefined,
      'phase.hasNudged must not be set'
    );
    assert.strictEqual(
      nudgeEventEmitted,
      false,
      'phaseNudged event must NOT be emitted'
    );
    assert.strictEqual(
      mockDispatcher.stopActiveGenerationCalls.length,
      0,
      'PromptDispatcher.stopActiveGeneration must not be called'
    );
    assert.strictEqual(
      mockDispatcher.dispatchPromptCalls.length,
      0,
      'PromptDispatcher.dispatchPrompt must not be called'
    );

    const originResult = orchestrator
      .getPromptOriginTracker()
      .checkAndConsume(DEFAULT_LONG_PHASE_NUDGE_MESSAGE);
    assert.strictEqual(
      originResult.matched,
      false,
      'Nudge prompt must NOT be tracked in PromptOriginTracker'
    );
    console.log('  ✓ No nudge dispatched, no events emitted, and no nudge prompt recorded in tracker.');
  }

  // -------------------------------------------------------------------------
  // Req 5: Verify explicit longPhaseNudgeEnabled: true override correctly schedules and triggers the nudge
  // -------------------------------------------------------------------------
  console.log('\n[Req 5] Verifying explicit longPhaseNudgeEnabled: true override schedules and triggers nudge...');
  {
    mockDispatcher.reset();
    const customNudgeMessage = 'Custom opt-in mid-flight steer message';
    const orchestrator = createTestOrchestrator({
      longPhaseNudgeEnabled: true,
      longPhaseThresholdSeconds: 1,
      longPhaseNudgeMessage: customNudgeMessage
    });
    const phase = createDummyPhase(0, 'phase-explicit-opt-in.md');

    let receivedPayload: any = null;
    orchestrator.on('phaseNudged', (payload) => {
      receivedPayload = payload;
    });

    // Start with 50ms fast threshold
    orchestrator.startPhaseNudgeWatchdog(phase, 0, 50);

    assert.strictEqual(
      orchestrator.isPhaseNudgeTimerActive(),
      true,
      'Timer must be active when longPhaseNudgeEnabled is explicitly true'
    );

    // Wait 50ms timeout + 400ms stabilization delay + 150ms buffer = 600ms
    await new Promise((r) => setTimeout(r, 650));

    assert.strictEqual(
      orchestrator.isPhaseNudgeTimerActive(),
      false,
      'Timer should be inactive after firing'
    );
    assert.strictEqual(
      phase.hasNudged,
      true,
      'phase.hasNudged must be true after nudge fires'
    );
    assert.ok(
      typeof phase.nudgeTimestamp === 'number' && phase.nudgeTimestamp > 0,
      'phase.nudgeTimestamp must be populated'
    );
    assert.strictEqual(
      mockDispatcher.stopActiveGenerationCalls.length,
      1,
      'stopActiveGeneration must be called once'
    );
    assert.strictEqual(
      mockDispatcher.dispatchPromptCalls.length,
      1,
      'dispatchPrompt must be called once'
    );
    assert.strictEqual(
      mockDispatcher.dispatchPromptCalls[0].prompt,
      customNudgeMessage,
      'Dispatched prompt must match custom nudge message'
    );
    assert.deepStrictEqual(
      mockDispatcher.dispatchPromptCalls[0].options,
      { openNewConversation: false },
      'Dispatch options must specify openNewConversation: false'
    );

    assert.ok(receivedPayload, 'phaseNudged event must be emitted');
    assert.strictEqual(receivedPayload.phase, phase);
    assert.strictEqual(receivedPayload.phaseIndex, 0);
    assert.strictEqual(receivedPayload.message, customNudgeMessage);

    const originResult = orchestrator
      .getPromptOriginTracker()
      .checkAndConsume(customNudgeMessage);
    assert.strictEqual(
      originResult.matched,
      true,
      'Nudge prompt must be tracked in PromptOriginTracker'
    );
    assert.strictEqual(
      originResult.origin,
      'system_nudge',
      'Origin must be resolved as system_nudge'
    );

    console.log('  ✓ Explicit opt-in correctly activates timer, triggers nudge dispatch, emits event, and tracks origin.');
  }

  console.log('\n================================================================');
  console.log(' All Phase 01 Nudge Watchdog Deactivation assertions PASSED! ');
  console.log('================================================================\n');
}

runPhase01DeactivationTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
