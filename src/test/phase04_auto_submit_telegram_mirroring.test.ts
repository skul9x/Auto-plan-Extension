// Standalone test runner for Phase 04: Telegram Event Mirroring & Realtime Alerting
const Module = require('module');
const originalRequire = Module.prototype.require;

// Global mock state for VS Code
let mockWorkspaceFolders: any[] = [
  {
    uri: {
      fsPath: '/home/skul9x/Desktop/Code/Auto-plan-Extension-main',
      toString: () => 'file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main'
    },
    name: 'Auto-plan-Extension-main',
    index: 0
  }
];

const mockConfigStore: Record<string, any> = {};
const activeConfigListeners: ((e: any) => void)[] = [];
let mockExtensions: Record<string, any> = {};

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        get workspaceFolders() {
          return mockWorkspaceFolders;
        },
        name: 'Auto-plan-Extension-main',
        getConfiguration: (section?: string) => ({
          get: (key: string, defaultValue?: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            if (mockConfigStore[fullKey] !== undefined) {
              return mockConfigStore[fullKey];
            }
            if (mockConfigStore[key] !== undefined) {
              return mockConfigStore[key];
            }
            return defaultValue;
          },
          update: async (key: string, val: any) => {
            const fullKey = section ? `${section}.${key}` : key;
            mockConfigStore[fullKey] = val;
            mockConfigStore[key] = val;
            for (const listener of activeConfigListeners) {
              listener({
                affectsConfiguration: (targetKey: string) =>
                  targetKey === 'autoplan' ||
                  targetKey === fullKey ||
                  targetKey === `autoplan.${key}` ||
                  fullKey.startsWith(`${targetKey}.`)
              });
            }
          }
        }),
        onDidChangeConfiguration: (cb: (e: any) => void) => {
          activeConfigListeners.push(cb);
          return {
            dispose: () => {
              const idx = activeConfigListeners.indexOf(cb);
              if (idx >= 0) activeConfigListeners.splice(idx, 1);
            }
          };
        }
      },
      extensions: {
        getExtension: (id: string) => mockExtensions[id]
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: async () => undefined
      },
      window: {
        createStatusBarItem: () => ({
          text: '',
          tooltip: '',
          command: '',
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        createOutputChannel: () => ({
          appendLine: () => {},
          show: () => {},
          dispose: () => {}
        })
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 },
      StatusBarAlignment: { Left: 1, Right: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import { Bot } from 'grammy';
import {
  STATUS_WAITING,
  SCOPE_ONCE,
  createIdeAutoSubmit,
  PermissionCandidate,
  AutoSubmitApprovalEvent,
  BUILTIN_EXTENSION_ID
} from '../antigravityRpcAutoSubmit';
import {
  ThrottledNotifier,
  TelegramNotifier,
  formatApprovalMessage,
  sanitizeApprovalCommand,
  maskSensitiveTokens,
  truncateCommand
} from '../telegramNotifier';
import { TelegramBridge } from '../telegramBridge';
import { DebugLogger } from '../debugLogger';

interface MockApiCall {
  method: string;
  payload: any;
  timestamp: number;
}

function createMockBot(token: string = '123456:TEST_TOKEN'): {
  bot: Bot;
  apiCalls: MockApiCall[];
  sentMessages: any[];
  setSimulate429Once: (retryAfterSec: number) => void;
  setSimulateNetworkErrorOnce: () => void;
} {
  const bot = new Bot(token, {
    botInfo: {
      id: 999888777,
      is_bot: true,
      first_name: 'AutoPlanTestBot',
      username: 'autoplan_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false
    } as any
  });

  const apiCalls: MockApiCall[] = [];
  const sentMessages: any[] = [];
  let simulate429Sec: number | null = null;
  let simulateNetworkError: boolean = false;
  let nextMsgId = 1000;

  bot.api.config.use(async (prev, method, payload, signal) => {
    const record: MockApiCall = {
      method,
      payload: JSON.parse(JSON.stringify(payload || {})),
      timestamp: Date.now()
    };
    apiCalls.push(record);

    if (simulateNetworkError) {
      simulateNetworkError = false;
      throw new Error('Telegram API network connection timeout (ETIMEDOUT)');
    }

    if (simulate429Sec !== null) {
      const wait = simulate429Sec;
      simulate429Sec = null;
      const err: any = new Error(`Too Many Requests: retry after ${wait}`);
      err.error_code = 429;
      err.description = `Too Many Requests: retry after ${wait}`;
      err.parameters = { retry_after: wait };
      throw err;
    }

    if (method === 'sendMessage') {
      const msgId = ++nextMsgId;
      sentMessages.push({ ...record.payload, message_id: msgId });
      return {
        ok: true,
        result: {
          message_id: msgId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: record.payload.chat_id, type: 'private' },
          text: record.payload.text
        }
      } as any;
    }

    return { ok: true, result: {} } as any;
  });

  return {
    bot,
    apiCalls,
    sentMessages,
    setSimulate429Once: (sec: number) => {
      simulate429Sec = sec;
    },
    setSimulateNetworkErrorOnce: () => {
      simulateNetworkError = true;
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function resetConfigStore() {
  for (const k of Object.keys(mockConfigStore)) {
    delete mockConfigStore[k];
  }
  mockConfigStore['autoplan.autoSubmit.enabled'] = true;
  mockConfigStore['autoplan.autoSubmit.notifyTelegram'] = true;
  mockConfigStore['autoplan.autoSubmit.intervalMs'] = 1000;
  mockConfigStore['autoplan.autoSubmit.maxQuota'] = 0;
  mockConfigStore['autoplan.telegramEnabled'] = true;
  mockConfigStore['autoplan.telegramAllowedUsers'] = [12345678];
}

async function runTests() {
  console.log('=== [TEST SUITE] Phase 04: Telegram Event Mirroring & Realtime Alerting ===\n');

  // =========================================================================
  // Group 1: Approval Event Hook Connectivity & Asynchronous Non-Blocking Dispatch
  // =========================================================================
  console.log('--- Group 1: Approval Event Hook Connectivity & Non-Blocking Dispatch ---');

  // Test 1.1: Verification of onApproval hook registration on createIdeAutoSubmit
  {
    resetConfigStore();
    let approvalReceived: AutoSubmitApprovalEvent | null = null;

    const mockClient = {
      getAllCascadeTrajectories: async () => ({
        trajectorySummaries: {
          'casc-1': {
            trajectoryId: 'traj-1',
            workspaces: ['file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main'],
            waitingSteps: [
              {
                stepIndex: 0,
                step: {
                  status: STATUS_WAITING,
                  metadata: {
                    sourceTrajectoryStepInfo: { cascadeId: 'casc-1', trajectoryId: 'traj-1', stepIndex: 0 }
                  },
                  requestedInteraction: {
                    interaction: {
                      case: 'permission',
                      value: {
                        resource: { action: 'Terminal Command execution', target: 'npm run test' }
                      }
                    }
                  }
                }
              }
            ]
          }
        }
      }),
      handleCascadeUserInteraction: async () => ({ success: true })
    };

    const mockExtension = { isActive: true, exports: { getRpcClient: async () => mockClient } };
    const engine = createIdeAutoSubmit({
      getExtension: () => mockExtension,
      onApproval: (event) => {
        approvalReceived = event;
      }
    });

    assert.strictEqual(typeof engine.onApproval, 'function', '1.1A: engine must expose onApproval method');
    assert.strictEqual(typeof engine.on, 'function', '1.1B: engine must expose on method');
    assert.strictEqual(typeof engine.off, 'function', '1.1C: engine must expose off method');

    await engine.tick();
    // Allow microtask resolution for unawaited listener
    await sleep(20);

    assert.ok(approvalReceived, '1.1D: onApproval callback must receive the approval event');
    assert.strictEqual((approvalReceived as any).pattern, 'Submit', '1.1E: pattern must be Submit');
    assert.strictEqual((approvalReceived as any).candidate.resource.target, 'npm run test', '1.1F: resource target matched');
    assert.ok(typeof (approvalReceived as any).timestamp === 'number', '1.1G: timestamp must be present');

    engine.dispose();
    console.log('  ✓ 1.1 Successfully registers and fires onApproval hook with AutoSubmitApprovalEvent');
  }

  // Test 1.2: Dynamic on('approval') listener registration and disposal
  {
    resetConfigStore();
    const mockClient = {
      getAllCascadeTrajectories: async () => ({
        trajectorySummaries: {
          'casc-2': {
            trajectoryId: 'traj-2',
            workspaces: ['file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main'],
            waitingSteps: [
              {
                stepIndex: 1,
                step: {
                  status: STATUS_WAITING,
                  metadata: {
                    sourceTrajectoryStepInfo: { cascadeId: 'casc-2', trajectoryId: 'traj-2', stepIndex: 1 }
                  },
                  requestedInteraction: {
                    interaction: {
                      case: 'permission',
                      value: {
                        resource: { action: 'File Modification', target: 'src/index.ts' }
                      }
                    }
                  }
                }
              }
            ]
          }
        }
      }),
      handleCascadeUserInteraction: async () => ({ success: true })
    };

    const mockExtension = { isActive: true, exports: { getRpcClient: async () => mockClient } };
    const engine = createIdeAutoSubmit({
      getExtension: () => mockExtension
    });

    let eventFiredCount = 0;
    const sub = engine.on('approval', () => {
      eventFiredCount++;
    });

    await engine.tick();
    await sleep(20);
    assert.strictEqual(eventFiredCount, 1, '1.2A: on("approval") listener must be triggered once');

    // Unsubscribe listener
    sub.dispose();

    // Trigger tick again - listener should not be called again
    await engine.tick();
    await sleep(20);
    assert.strictEqual(eventFiredCount, 1, '1.2B: disposed listener must not be called after unsubscribe');

    engine.dispose();
    console.log('  ✓ 1.2 on("approval") and subscription dispose cleanly unregisters listeners');
  }

  // Test 1.3: Non-blocking asynchronous dispatch: Slow listener never blocks the RPC tick
  {
    resetConfigStore();
    const mockClient = {
      getAllCascadeTrajectories: async () => ({
        trajectorySummaries: {
          'casc-3': {
            trajectoryId: 'traj-3',
            workspaces: ['file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main'],
            waitingSteps: [
              {
                stepIndex: 0,
                step: {
                  status: STATUS_WAITING,
                  metadata: {
                    sourceTrajectoryStepInfo: { cascadeId: 'casc-3', trajectoryId: 'traj-3', stepIndex: 0 }
                  },
                  requestedInteraction: {
                    interaction: {
                      case: 'permission',
                      value: {
                        resource: { action: 'Terminal Command', target: 'cargo build' }
                      }
                    }
                  }
                }
              }
            ]
          }
        }
      }),
      handleCascadeUserInteraction: async () => ({ success: true })
    };

    const mockExtension = { isActive: true, exports: { getRpcClient: async () => mockClient } };
    const engine = createIdeAutoSubmit({
      getExtension: () => mockExtension,
      onApproval: async () => {
        // Intentionally throw or sleep in listener to simulate slow network/error
        await sleep(200);
        throw new Error('Listener synthetic failure');
      }
    });

    const startTime = Date.now();
    await engine.tick();
    const elapsed = Date.now() - startTime;

    // tick() should finish promptly without waiting for the 200ms listener or being thrown by the error
    assert.ok(elapsed < 100, `1.3A: tick() must complete immediately (${elapsed}ms < 100ms) without blocking on listener`);

    engine.dispose();
    console.log('  ✓ 1.3 Non-blocking unawaited dispatch ensures listener latency or errors never stall RPC loop');
  }

  // =========================================================================
  // Group 2: Human-Readable Notification Formatting & Secret Sanitization
  // =========================================================================
  console.log('\n--- Group 2: Human-Readable Formatting & Secret Sanitization ---');

  // Test 2.1: Formatting of Terminal Command approvals with single-use permission indicator
  {
    const candidate: PermissionCandidate = {
      key: 'casc-1:traj-1:0:hash1',
      pattern: 'Submit',
      cascadeId: 'casc-1',
      trajectoryId: 'traj-1',
      stepIndex: 0,
      fingerprint: 'hash1',
      resource: {
        action: 'Terminal Command execution',
        target: 'npm test -- --grep "auth"'
      },
      request: {} as any
    };

    const fixedTime = 1761912000000; // 2025-10-31T12:00:00.000Z
    const msg = formatApprovalMessage(candidate, () => fixedTime);

    assert.ok(msg.includes('⚡ [Auto-Submit] Approved: Terminal Command execution'), '2.1A: action header included');
    assert.ok(msg.includes('• Target: npm test -- --grep "auth"'), '2.1B: target command included');
    assert.ok(msg.includes('• Scope: Allow Once (Single-use)'), '2.1C: single-use indicator included');
    assert.ok(msg.includes('• Timestamp: 2025-10-31T12:00:00.000Z'), '2.1D: ISO timestamp included');

    console.log('  ✓ 2.1 Terminal command approval formatted with command summary, scope, and timestamp');
  }

  // Test 2.2: Secret Token and Credential Masking in Command Arguments
  {
    const secretCommands = [
      {
        raw: 'git clone https://username:ghp_1234567890abcdef1234567890abcdef@github.com/repo.git',
        check: (s: string) => !s.includes('ghp_1234567890abcdef1234567890abcdef') && s.includes('[REDACTED')
      },
      {
        raw: 'curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c" https://api.com',
        check: (s: string) => !s.includes('eyJhbGci') && s.includes('Bearer [REDACTED]')
      },
      {
        raw: 'npm test --token=secretToken12345 --password="mySuperPassword!" --api-key=AIzaSyA1234567890abcdef1234567890abc',
        check: (s: string) => !s.includes('secretToken12345') && !s.includes('mySuperPassword!') && !s.includes('AIzaSyA')
      },
      {
        raw: 'export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE SECRET_KEY=superSecretEnvVal',
        check: (s: string) => !s.includes('superSecretEnvVal') && !s.includes('AKIAIOSFODNN7EXAMPLE')
      }
    ];

    for (const [idx, item] of secretCommands.entries()) {
      const sanitized = maskSensitiveTokens(item.raw);
      assert.ok(item.check(sanitized), `2.2-${idx + 1}: Sensitive secret must be redacted: "${sanitized}"`);
    }

    // Verify formatApprovalMessage also sanitizes command target
    const candidateWithSecret: PermissionCandidate = {
      key: 'key-s',
      pattern: 'Submit',
      cascadeId: 'c',
      trajectoryId: 't',
      stepIndex: 0,
      fingerprint: 'f',
      resource: {
        action: 'Terminal Command execution',
        target: 'docker login --username admin --password superSecretAdminPassword'
      },
      request: {} as any
    };

    const formatted = formatApprovalMessage(candidateWithSecret);
    assert.ok(!formatted.includes('superSecretAdminPassword'), '2.2E: password must not leak into formatted message');
    assert.ok(formatted.includes('[REDACTED]'), '2.2F: [REDACTED] placeholder present');

    console.log('  ✓ 2.2 Successfully sanitizes and redacts tokens, bearer headers, passwords, and API keys');
  }

  // Test 2.3: Overly Long Shell Command Truncation
  {
    const longArg = 'a'.repeat(400);
    const longCmd = `pytest tests/e2e/test_long.py --params="${longArg}" --verbose`;
    const truncated = truncateCommand(longCmd, 200);

    assert.ok(truncated.length <= 200, `2.3A: truncated command length must be <= 200 (actual: ${truncated.length})`);
    assert.ok(truncated.includes('... [truncated]'), '2.3B: truncated suffix appended');
    assert.ok(truncated.startsWith('pytest tests/e2e/test_long.py'), '2.3C: core command context preserved at head');

    // Test inside formatApprovalMessage
    const candidateLong: PermissionCandidate = {
      key: 'key-l',
      pattern: 'Submit',
      cascadeId: 'c',
      trajectoryId: 't',
      stepIndex: 0,
      fingerprint: 'f',
      resource: {
        action: 'Terminal Command execution',
        target: longCmd
      },
      request: {} as any
    };
    const formattedLong = formatApprovalMessage(candidateLong);
    assert.ok(formattedLong.includes('... [truncated]'), '2.3D: formatApprovalMessage truncates long commands');

    console.log('  ✓ 2.3 Safely truncates overly lengthy command strings while preserving core context');
  }

  // Test 2.4: Formatting of File Modification and Custom Tool permissions
  {
    // File modification
    const fileCandidate: PermissionCandidate = {
      key: 'key-file',
      pattern: 'Submit',
      cascadeId: 'c',
      trajectoryId: 't',
      stepIndex: 0,
      fingerprint: 'f',
      resource: {
        action: 'File Modification',
        target: '/home/skul9x/Desktop/Code/Auto-plan-Extension-main/src/auth.ts'
      },
      request: {} as any
    };
    const fileMsg = formatApprovalMessage(fileCandidate);
    assert.ok(fileMsg.includes('⚡ [Auto-Submit] Approved: File Modification'), '2.4A: file action name');
    assert.ok(fileMsg.includes('• Target: /home/skul9x/Desktop/Code/Auto-plan-Extension-main/src/auth.ts'), '2.4B: file path');
    assert.ok(fileMsg.includes('• Scope: Allow Once (Single-use)'), '2.4C: single-use indicator');

    // Custom Tool permission
    const customToolCandidate: PermissionCandidate = {
      key: 'key-tool',
      pattern: 'Submit',
      cascadeId: 'c',
      trajectoryId: 't',
      stepIndex: 0,
      fingerprint: 'f',
      toolName: 'mcp_adb_shell',
      resource: {
        action: 'Custom Tool Permission',
        target: 'getprop ro.build.version.release'
      },
      request: {} as any
    };
    const toolMsg = formatApprovalMessage(customToolCandidate);
    assert.ok(toolMsg.includes('• Target: getprop ro.build.version.release'), '2.4D: custom tool target');
    assert.ok(toolMsg.includes('• Scope: Allow Once (Single-use)'), '2.4E: custom tool single-use indicator');

    console.log('  ✓ 2.4 Formats diverse permission resource types (File Modification, Custom Tool)');
  }

  // Test 2.5: Plain-text Formatting & parse_mode: undefined verification
  {
    const candidateWithMarkdown: PermissionCandidate = {
      key: 'key-md',
      pattern: 'Submit',
      cascadeId: 'c',
      trajectoryId: 't',
      stepIndex: 0,
      fingerprint: 'f',
      resource: {
        action: '*Bold_Action* & [Link]',
        target: 'echo `hello world` *bold*'
      },
      request: {} as any
    };
    const msg = formatApprovalMessage(candidateWithMarkdown);

    // Strips markdown artifacts that could break Telegram markdown parsing
    assert.ok(!msg.includes('`hello world`'), '2.5A: markdown backticks stripped');
    assert.ok(!msg.includes('*Bold_Action*'), '2.5B: markdown bold markers stripped');

    // Verify safeSendMessage sends with parse_mode: undefined
    const { bot, sentMessages } = createMockBot();
    const notifier = new ThrottledNotifier({ bot, chatId: 12345 });
    await notifier.broadcastMessage(msg);

    assert.strictEqual(sentMessages.length, 1, '2.5C: message sent');
    assert.strictEqual(sentMessages[0].parse_mode, undefined, '2.5D: parse_mode must be undefined to avoid 400 Bad Request');

    notifier.dispose();
    console.log('  ✓ 2.5 Enforces plain-text formatting adhering to parse_mode: undefined rules');
  }

  // =========================================================================
  // Group 3: Burst Throttling & Rate-Limiting Queue Compliance
  // =========================================================================
  console.log('\n--- Group 3: Burst Throttling & Rate-Limiting Queue Compliance ---');

  // Test 3.1: Burst of 5 consecutive approvals smoothly dispatched via rate-limiting queue
  {
    resetConfigStore();
    const { bot, sentMessages } = createMockBot();
    let virtualTime = 1000;
    const nowFn = () => virtualTime;

    // Use a fast 50ms pacing interval in test for rapid execution
    const rateLimitMs = 50;
    const notifier = new ThrottledNotifier({
      bot,
      chatId: 12345,
      approvalRateLimitMs: rateLimitMs,
      nowFn: () => Date.now()
    });

    // Enqueue a burst of 5 distinct approvals within milliseconds
    const candidates = [1, 2, 3, 4, 5].map((i) => ({
      key: `burst-${i}`,
      pattern: 'Submit',
      resource: {
        action: 'File Modification',
        target: `src/module_${i}.ts`
      }
    }));

    for (const c of candidates) {
      notifier.queueApprovalNotification(c);
    }

    // Immediately after burst, first item sent, remaining 4 queued
    assert.strictEqual(sentMessages.length, 1, '3.1A: First item must dispatch immediately');
    assert.strictEqual(notifier.getApprovalQueueLength(), 4, '3.1B: 4 items remain queued');

    // Wait for the queue to drain through the rate-limiting pacing
    // 4 items * 50ms = ~200ms
    await sleep(280);

    assert.strictEqual(sentMessages.length, 5, '3.1C: All 5 approvals must be successfully delivered');
    assert.strictEqual(notifier.getApprovalQueueLength(), 0, '3.1D: Queue must be fully drained');

    // Verify ordering
    for (let i = 0; i < 5; i++) {
      assert.ok(
        sentMessages[i].text.includes(`src/module_${i + 1}.ts`),
        `3.1E: message ${i + 1} matches queued candidate`
      );
    }

    notifier.dispose();
    console.log('  ✓ 3.1 Handles rapid burst of 5 consecutive approvals smoothly without dropping events');
  }

  // Test 3.2: 429 Too Many Requests Flood Wait Backoff Resilience
  {
    resetConfigStore();
    const { bot, sentMessages, setSimulate429Once } = createMockBot();

    const notifier = new ThrottledNotifier({
      bot,
      chatId: 12345,
      approvalRateLimitMs: 40
    });

    // Enqueue first candidate
    notifier.queueApprovalNotification({
      pattern: 'Submit',
      resource: { action: 'Terminal Command', target: 'cmd 1' }
    });
    assert.strictEqual(sentMessages.length, 1, '3.2A: item 1 sent');

    // Simulate Telegram 429 error on next request with retry_after = 1 second
    setSimulate429Once(1);

    // Enqueue second and third candidates
    await sleep(45);
    notifier.queueApprovalNotification({
      pattern: 'Submit',
      resource: { action: 'Terminal Command', target: 'cmd 2' }
    });
    notifier.queueApprovalNotification({
      pattern: 'Submit',
      resource: { action: 'Terminal Command', target: 'cmd 3' }
    });

    // Wait a brief moment: item 2 encounters 429 and pauses notifier
    await sleep(60);
    assert.ok(notifier.isPaused(), '3.2B: Notifier must enter paused state on 429');

    // Wait for the 1000ms 429 backoff pause to elapse
    await sleep(1050);

    // After backoff elapses, queue automatically resumes and drains
    await sleep(150);
    assert.strictEqual(sentMessages.length, 3, '3.2C: All messages delivered after 429 backoff expires');
    assert.strictEqual(notifier.isPaused(), false, '3.2D: Paused state cleared');

    notifier.dispose();
    console.log('  ✓ 3.2 Responds to Telegram 429 rate limit backoff and resumes draining cleanly');
  }

  // =========================================================================
  // Group 4: Consecutive & Rolling Short Window Deduplication
  // =========================================================================
  console.log('\n--- Group 4: Consecutive & Rolling Short Window Deduplication ---');

  // Test 4.1: Deduplication of consecutive identical approval requests
  {
    resetConfigStore();
    const { bot, sentMessages } = createMockBot();

    let fakeNow = 10000;
    const notifier = new ThrottledNotifier({
      bot,
      chatId: 12345,
      approvalRateLimitMs: 50,
      approvalDedupWindowMs: 5000,
      nowFn: () => fakeNow
    });

    const candidateSame = {
      pattern: 'Submit',
      resource: {
        action: 'File Modification',
        target: 'src/utils.ts'
      }
    };

    // First send
    const enqueued1 = notifier.queueApprovalNotification(candidateSame);
    assert.strictEqual(enqueued1, true, '4.1A: First message enqueued');

    // Immediate second send of identical approval
    fakeNow += 100; // 100ms later (well within 5000ms dedup window)
    const enqueued2 = notifier.queueApprovalNotification(candidateSame);
    assert.strictEqual(enqueued2, false, '4.1B: Duplicate consecutive message suppressed');

    // Immediate third send of identical approval
    fakeNow += 200;
    const enqueued3 = notifier.queueApprovalNotification(candidateSame);
    assert.strictEqual(enqueued3, false, '4.1C: Third identical message suppressed');

    assert.strictEqual(sentMessages.length, 1, '4.1D: Exactly 1 message sent');
    assert.strictEqual(notifier.getApprovalQueueLength(), 0, '4.1E: Queue empty (duplicates not enqueued)');

    notifier.dispose();
    console.log('  ✓ 4.1 Suppresses consecutive identical messages within rolling short window');
  }

  // Test 4.2: Distinct consecutive approvals are not suppressed
  {
    resetConfigStore();
    const { bot, sentMessages } = createMockBot();

    let fakeNow = 10000;
    const notifier = new ThrottledNotifier({
      bot,
      chatId: 12345,
      approvalRateLimitMs: 50,
      approvalDedupWindowMs: 5000,
      nowFn: () => fakeNow
    });

    const candidateA = { pattern: 'Submit', resource: { action: 'File Modification', target: 'src/fileA.ts' } };
    const candidateB = { pattern: 'Submit', resource: { action: 'File Modification', target: 'src/fileB.ts' } };

    const enqueuedA = notifier.queueApprovalNotification(candidateA);
    fakeNow += 50;
    const enqueuedB = notifier.queueApprovalNotification(candidateB);

    assert.strictEqual(enqueuedA, true, '4.2A: Candidate A enqueued');
    assert.strictEqual(enqueuedB, true, '4.2B: Candidate B enqueued');
    assert.strictEqual(sentMessages.length + notifier.getApprovalQueueLength(), 2, '4.2C: Both distinct candidates processed');

    notifier.dispose();
    console.log('  ✓ 4.2 Permits distinct consecutive approvals without false-positive deduplication');
  }

  // Test 4.3: Identical approval allowed after deduplication window expires
  {
    resetConfigStore();
    const { bot } = createMockBot();

    let fakeNow = 10000;
    const notifier = new ThrottledNotifier({
      bot,
      chatId: 12345,
      approvalRateLimitMs: 50,
      approvalDedupWindowMs: 5000,
      nowFn: () => fakeNow
    });

    const candidate = { pattern: 'Submit', resource: { action: 'Terminal Command', target: 'npm test' } };

    const enqueued1 = notifier.queueApprovalNotification(candidate);
    assert.strictEqual(enqueued1, true, '4.3A: First approval enqueued');

    // Advance virtual time beyond 5000ms window
    fakeNow += 6000;

    const enqueued2 = notifier.queueApprovalNotification(candidate);
    assert.strictEqual(enqueued2, true, '4.3B: Identical approval re-allowed after window expires');

    notifier.dispose();
    console.log('  ✓ 4.3 Re-allows identical approval event once rolling deduplication window has elapsed');
  }

  // =========================================================================
  // Group 5: Configuration Gating, Silent Mode & Failure Resilience
  // =========================================================================
  console.log('\n--- Group 5: Configuration Gating, Silent Mode & Failure Resilience ---');

  // Test 5.1: Suppresses notifications when autoplan.autoSubmit.notifyTelegram is false
  {
    resetConfigStore();
    mockConfigStore['autoplan.autoSubmit.notifyTelegram'] = false;

    const { bot, sentMessages } = createMockBot();
    const notifier = new ThrottledNotifier({ bot, chatId: 12345 });

    const candidate = {
      pattern: 'Submit',
      resource: { action: 'Terminal Command', target: 'npm test' }
    };

    const res = notifier.queueApprovalNotification(candidate);
    assert.strictEqual(res, false, '5.1A: queueApprovalNotification returns false when notifyTelegram=false');
    assert.strictEqual(sentMessages.length, 0, '5.1B: zero Telegram messages sent');

    const promiseRes = await notifier.sendApprovalNotification(candidate);
    assert.strictEqual(promiseRes, false, '5.1C: sendApprovalNotification returns false when notifyTelegram=false');
    assert.strictEqual(sentMessages.length, 0, '5.1D: zero Telegram messages sent');

    notifier.dispose();
    console.log('  ✓ 5.1 Disables Telegram notification cleanly when autoplan.autoSubmit.notifyTelegram=false');
  }

  // Test 5.2: Suppresses notifications when autoplan.telegramEnabled is false
  {
    resetConfigStore();
    mockConfigStore['autoplan.autoSubmit.notifyTelegram'] = true;
    mockConfigStore['autoplan.telegramEnabled'] = false;

    const { bot, sentMessages } = createMockBot();
    const notifier = new ThrottledNotifier({ bot, chatId: 12345 });

    const candidate = {
      pattern: 'Submit',
      resource: { action: 'Terminal Command', target: 'npm test' }
    };

    const res = notifier.queueApprovalNotification(candidate);
    assert.strictEqual(res, false, '5.2A: queueApprovalNotification returns false when telegramEnabled=false');
    assert.strictEqual(sentMessages.length, 0, '5.2B: zero messages sent in silent mode');

    notifier.dispose();
    console.log('  ✓ 5.2 Disables Telegram notification cleanly when autoplan.telegramEnabled=false');
  }

  // Test 5.3: Network outage & API delivery failure resilience
  {
    resetConfigStore();
    const { bot, setSimulateNetworkErrorOnce } = createMockBot();
    setSimulateNetworkErrorOnce();

    const notifier = new ThrottledNotifier({
      bot,
      chatId: 12345,
      approvalRateLimitMs: 20
    });

    const candidate = {
      pattern: 'Submit',
      resource: { action: 'Terminal Command', target: 'npm test' }
    };

    // sendApprovalNotification should reject or log cleanly without crashing the process
    try {
      await notifier.sendApprovalNotification(candidate);
    } catch (err: any) {
      assert.ok(err.message.includes('ETIMEDOUT'), '5.3A: Network error caught cleanly');
    }

    notifier.dispose();
    console.log('  ✓ 5.3 Gracefully handles Telegram API network errors without unhandled exceptions');
  }

  // =========================================================================
  // Group 6: Full End-to-End Bridge Integration
  // =========================================================================
  console.log('\n--- Group 6: Full End-to-End Bridge Integration ---');

  // Test 6.1: Full end-to-end event chain from RPC client approval -> TelegramNotifier
  {
    resetConfigStore();
    const { bot, sentMessages } = createMockBot();

    const notifier = new TelegramNotifier({
      bot,
      chatId: 12345,
      approvalRateLimitMs: 30
    });

    const bridge = new TelegramBridge({
      windowKey: 'test-win-e2e',
      allowedUsers: [12345]
    });
    bridge.setNotifier(notifier);

    const mockRpcClient = {
      getAllCascadeTrajectories: async () => ({
        trajectorySummaries: {
          'casc-e2e': {
            trajectoryId: 'traj-e2e',
            workspaces: ['file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main'],
            waitingSteps: [
              {
                stepIndex: 0,
                step: {
                  status: STATUS_WAITING,
                  metadata: {
                    sourceTrajectoryStepInfo: { cascadeId: 'casc-e2e', trajectoryId: 'traj-e2e', stepIndex: 0 },
                    toolCall: { name: 'run_command' }
                  },
                  requestedInteraction: {
                    interaction: {
                      case: 'permission',
                      value: {
                        resource: {
                          action: 'Terminal Command execution',
                          target: 'git status --short'
                        }
                      }
                    }
                  }
                }
              }
            ]
          }
        }
      }),
      handleCascadeUserInteraction: async () => ({ success: true })
    };

    const mockExtension = { isActive: true, exports: { getRpcClient: async () => mockRpcClient } };
    const autoSubmitService = createIdeAutoSubmit({
      getExtension: () => mockExtension
    });

    // Attach service to bridge
    bridge.attachAutoSubmitEngine(autoSubmitService);

    // Trigger tick in auto submit service
    await autoSubmitService.tick();

    // Allow event listener microtasks and queue delivery
    await sleep(80);

    assert.strictEqual(sentMessages.length, 1, '6.1A: Telegram message dispatched through end-to-end chain');
    const sent = sentMessages[0];
    assert.strictEqual(sent.chat_id, 12345, '6.1B: sent to authorized chat');
    assert.ok(sent.text.includes('⚡ [Auto-Submit] Approved: Terminal Command execution'), '6.1C: action header present');
    assert.ok(sent.text.includes('• Target: git status --short'), '6.1D: target present');
    assert.ok(sent.text.includes('• Scope: Allow Once (Single-use)'), '6.1E: single-use scope indicator present');

    autoSubmitService.dispose();
    await bridge.stop();
    notifier.dispose();
    console.log('  ✓ 6.1 End-to-end event chain from RPC approval to Telegram message delivery verified');
  }

  console.log('\n=============================================================');
  console.log('✅ ALL PHASE 04 TESTS PASSED SUCCESSFULLY!');
  console.log('=============================================================');
}

runTests().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:\n', err);
  process.exit(1);
});
