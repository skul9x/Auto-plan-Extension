// Standalone mock for 'vscode' module if run directly via Node
const Module = require('module');
const originalRequire = Module.prototype.require;

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
      window: {
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {}
        }),
        registerWebviewViewProvider: () => ({ dispose: () => {} }),
        showInformationMessage: async () => {},
        showWarningMessage: async () => {},
        showErrorMessage: async () => {}
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 },
      StatusBarAlignment: { Left: 1, Right: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Bot, Context } from 'grammy';
import { getConfig, getTelegramConfig, DEFAULT_CONFIG } from '../config';
import { TelegramBridge, isProcessAlive } from '../telegramBridge';
import { PortRegistryData } from '../bridgeServer';
import { DebugLogger } from '../debugLogger';

/**
 * Creates a mock GrammY bot initialized with offline botInfo and message capturing.
 */
function createMockBot(token: string = '123456:TEST_TOKEN'): {
  bot: Bot;
  sentMessages: any[];
} {
  const bot = new Bot(token, {
    botInfo: {
      id: 8930752011,
      is_bot: true,
      first_name: 'AutoPlanTestBot',
      username: 'autoplan_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false
    } as any
  });

  const sentMessages: any[] = [];

  // Intercept all outgoing API requests without network calls
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === 'sendMessage') {
      const anyPayload = payload as any;
      sentMessages.push(anyPayload);
      return {
        ok: true,
        result: {
          message_id: Math.floor(Math.random() * 10000) + 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: anyPayload.chat_id, type: 'private', first_name: 'Chat' },
          text: anyPayload.text
        }
      } as any;
    }
    return { ok: true, result: {} } as any;
  });

  return { bot, sentMessages };
}

async function runPhase01TelegramBridgeLifecycleTest() {
  console.log('================================================================');
  console.log(' Phase 01: Core Telegram Bridge & Lifecycle Engine Comprehensive Test');
  console.log('================================================================\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-tg-phase01-'));
  const testRegistryPath = path.join(testTempDir, 'ag-autoplan-ports.json');
  const testLogger = new DebugLogger(100);

  try {
    // -------------------------------------------------------------------------
    // Test Suite 1: Configuration Loading & Defaults
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Verifying configuration loading and validation...');
    {
      // 1.1 Verify default values in DEFAULT_CONFIG and getConfig()
      const defaultConfig = getConfig();
      assert.strictEqual(defaultConfig.telegramEnabled, true, 'Default telegramEnabled should be true');
      assert.strictEqual(
        defaultConfig.telegramBotToken,
        '8930752011:AAG6HyFKC5h405nOw06EHz71np73vYuzFMc',
        'Default telegramBotToken should match plan spec'
      );
      assert.deepStrictEqual(defaultConfig.telegramAllowedUsers, [], 'Default allowedUsers should be empty array');
      assert.strictEqual(defaultConfig.telegramThrottleMs, 2500, 'Default throttleMs should be 2500');

      const tgConfig = getTelegramConfig();
      assert.strictEqual(tgConfig.enabled, true, 'getTelegramConfig().enabled should match default');
      assert.strictEqual(tgConfig.botToken, '8930752011:AAG6HyFKC5h405nOw06EHz71np73vYuzFMc');
      assert.strictEqual(tgConfig.throttleMs, 2500);

      // 1.2 Verify custom overrides via mock config store
      mockConfigStore['telegramEnabled'] = false;
      mockConfigStore['telegramBotToken'] = '999999:CUSTOM_TOKEN_XYZ';
      mockConfigStore['telegramAllowedUsers'] = [12345678, '87654321'];
      mockConfigStore['telegramThrottleMs'] = 3000;

      const overriddenTg = getTelegramConfig();
      assert.strictEqual(overriddenTg.enabled, false, 'Overridden enabled should be false');
      assert.strictEqual(overriddenTg.botToken, '999999:CUSTOM_TOKEN_XYZ', 'Overridden token should match');
      assert.deepStrictEqual(overriddenTg.allowedUsers, [12345678, '87654321'], 'Overridden allowedUsers should match');
      assert.strictEqual(overriddenTg.throttleMs, 3000, 'Overridden throttleMs should be 3000');

      // Reset mock config store for subsequent suites
      delete mockConfigStore['telegramEnabled'];
      delete mockConfigStore['telegramBotToken'];
      delete mockConfigStore['telegramAllowedUsers'];
      delete mockConfigStore['telegramThrottleMs'];
      console.log('  ✓ Configuration loading, schema defaults, and overrides verified successfully.');
    }

    // -------------------------------------------------------------------------
    // Test Suite 2: Security Whitelist Authorization Middleware
    // -------------------------------------------------------------------------
    console.log('\n[Suite 2] Verifying security whitelist authorization middleware...');
    {
      const { bot, sentMessages } = createMockBot('mock_token_for_auth_tests');
      const bridge = new TelegramBridge({
        token: 'mock_token_for_auth_tests',
        enabled: true,
        allowedUsers: [100001, '200002'],
        registryPath: testRegistryPath,
        windowKey: 'win_auth_test',
        logger: testLogger
      });

      // Register the bridge authorization middleware on the test bot
      bot.use(bridge.createAuthMiddleware());

      let downstreamExecuted = false;
      let lastAuthorizedUserId: number | null = null;
      bot.use(async (ctx: Context) => {
        downstreamExecuted = true;
        lastAuthorizedUserId = ctx.from?.id || null;
      });

      // 2.1 Test authorized user with numeric ID (100001)
      downstreamExecuted = false;
      sentMessages.length = 0;
      await bot.handleUpdate({
        update_id: 1,
        message: {
          message_id: 101,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 100001, type: 'private', first_name: 'Alice' },
          from: { id: 100001, is_bot: false, first_name: 'Alice' },
          text: '/status'
        }
      });
      assert.strictEqual(downstreamExecuted, true, 'Downstream middleware MUST be executed for numeric whitelisted user');
      assert.strictEqual(lastAuthorizedUserId, 100001);
      assert.strictEqual(sentMessages.length, 0, 'No denial message should be sent to authorized user');
      console.log('  ✓ Whitelisted numeric ID 100001 successfully authorized.');

      // 2.2 Test authorized user with string ID in whitelist ('200002')
      downstreamExecuted = false;
      sentMessages.length = 0;
      await bot.handleUpdate({
        update_id: 2,
        message: {
          message_id: 102,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 200002, type: 'private', first_name: 'Bob' },
          from: { id: 200002, is_bot: false, first_name: 'Bob' },
          text: '/plan'
        }
      });
      assert.strictEqual(downstreamExecuted, true, 'Downstream middleware MUST be executed for string whitelisted user');
      assert.strictEqual(lastAuthorizedUserId, 200002);
      assert.strictEqual(sentMessages.length, 0, 'No denial message should be sent to string whitelisted user');
      console.log('  ✓ Whitelisted string ID 200002 successfully authorized.');

      // 2.3 Test unauthorized user (ID: 999999)
      downstreamExecuted = false;
      sentMessages.length = 0;
      await bot.handleUpdate({
        update_id: 3,
        message: {
          message_id: 103,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 999999, type: 'private', first_name: 'Mallory' },
          from: { id: 999999, is_bot: false, first_name: 'Mallory', username: 'mallory_attacker' },
          text: '/start malicious prompt injection'
        }
      });
      assert.strictEqual(downstreamExecuted, false, 'Downstream middleware MUST NOT be executed for unauthorized user');
      assert.strictEqual(sentMessages.length, 1, 'Exactly one denial response must be sent');
      assert.strictEqual(
        sentMessages[0].text,
        '⛔ Unauthorized: Your Telegram ID 999999 is not permitted.',
        'Denial message must match exact spec format'
      );
      assert.strictEqual(sentMessages[0].chat_id, 999999);
      console.log('  ✓ Unauthorized ID 999999 strictly rejected with formatted denial notice.');

      // 2.4 Test dynamic whitelist update via setAllowedUsers
      bridge.setAllowedUsers([999999]);
      downstreamExecuted = false;
      sentMessages.length = 0;
      await bot.handleUpdate({
        update_id: 4,
        message: {
          message_id: 104,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 999999, type: 'private', first_name: 'Mallory' },
          from: { id: 999999, is_bot: false, first_name: 'Mallory' },
          text: '/status'
        }
      });
      assert.strictEqual(downstreamExecuted, true, 'User 999999 should now be allowed after setAllowedUsers');
      assert.strictEqual(sentMessages.length, 0);
      console.log('  ✓ Dynamic setAllowedUsers update correctly permits newly whitelisted user.');

      // 2.5 Test update without from (e.g. channel post) safely handled
      downstreamExecuted = false;
      sentMessages.length = 0;
      await bot.handleUpdate({
        update_id: 5,
        channel_post: {
          message_id: 105,
          date: Math.floor(Date.now() / 1000),
          chat: { id: -100123456789, type: 'channel' },
          text: 'broadcast'
        }
      } as any);
      assert.strictEqual(downstreamExecuted, false, 'Updates without user sender must not proceed downstream');
      assert.strictEqual(sentMessages.length, 0);
      console.log('  ✓ Non-user updates (e.g. channel posts) safely ignored without errors.');
    }

    // -------------------------------------------------------------------------
    // Test Suite 3: Multi-Window Leader Election Guard
    // -------------------------------------------------------------------------
    console.log('\n[Suite 3] Verifying multi-window leader election guard...');
    {
      const bridgeAlpha = new TelegramBridge({
        token: 'test_token',
        enabled: true,
        registryPath: testRegistryPath,
        windowKey: 'win_alpha',
        heartbeatIntervalMs: 100,
        standbyIntervalMs: 100,
        leaderStaleTimeoutMs: 500,
        logger: testLogger
      });

      const bridgeBeta = new TelegramBridge({
        token: 'test_token',
        enabled: true,
        registryPath: testRegistryPath,
        windowKey: 'win_beta',
        heartbeatIntervalMs: 100,
        standbyIntervalMs: 100,
        leaderStaleTimeoutMs: 500,
        logger: testLogger
      });

      // 3.1 Initial state: no leader exists in registry
      assert.strictEqual(fs.existsSync(testRegistryPath), false, 'Registry should not exist initially');

      // 3.2 Alpha claims leadership
      const alphaAcquired = bridgeAlpha.tryAcquireLeadership();
      assert.strictEqual(alphaAcquired, true, 'Alpha MUST acquire leadership when registry is empty');

      const rawRegistry = fs.readFileSync(testRegistryPath, 'utf8');
      const data: PortRegistryData = JSON.parse(rawRegistry);
      assert.strictEqual(data.telegramLeader?.pid, process.pid, 'Leader PID should be current process');
      assert.strictEqual(data.telegramLeader?.windowKey, 'win_alpha', 'Leader windowKey should be win_alpha');
      console.log('  ✓ Alpha successfully elected as leader in ag-autoplan-ports.json.');

      // 3.3 Beta attempts to acquire leadership while Alpha is active
      const betaAcquired = bridgeBeta.tryAcquireLeadership();
      assert.strictEqual(betaAcquired, false, 'Beta MUST NOT acquire leadership when Alpha is active leader');
      console.log('  ✓ Beta correctly suppressed from becoming leader while Alpha holds ownership.');

      // 3.4 Alpha releases leadership (simulating window close or deactivation)
      bridgeAlpha.releaseLeadership();
      const afterReleaseRaw = fs.readFileSync(testRegistryPath, 'utf8');
      const afterReleaseData: PortRegistryData = JSON.parse(afterReleaseRaw);
      assert.strictEqual(afterReleaseData.telegramLeader, undefined, 'telegramLeader must be cleared after release');

      // 3.5 Beta takeover after Alpha release
      const betaTakeover = bridgeBeta.tryAcquireLeadership();
      assert.strictEqual(betaTakeover, true, 'Beta MUST acquire leadership after Alpha releases');
      const betaRegistry = JSON.parse(fs.readFileSync(testRegistryPath, 'utf8'));
      assert.strictEqual(betaRegistry.telegramLeader?.windowKey, 'win_beta');
      console.log('  ✓ Beta successfully executed election takeover following Alpha release.');

      // 3.6 Dead PID / Stale leader recovery
      // Simulate an ungraceful crash leaving a dead PID (e.g., PID 999999999)
      const staleData: PortRegistryData = {
        version: 1,
        ports: {},
        telegramLeader: {
          pid: 999999999, // Non-existent PID
          windowKey: 'win_crashed',
          acquiredAt: Date.now() - 60000,
          updatedAt: Date.now() - 60000
        }
      };
      fs.writeFileSync(testRegistryPath, JSON.stringify(staleData, null, 2), 'utf8');

      // Verify helper correctly detects PID 999999999 as dead
      assert.strictEqual(isProcessAlive(999999999), false, 'Non-existent PID 999999999 must report dead');

      // Alpha attempts takeover over dead PID
      const alphaRecovers = bridgeAlpha.tryAcquireLeadership();
      assert.strictEqual(alphaRecovers, true, 'Alpha must evict dead PID and take over leadership');
      const recoveredData = JSON.parse(fs.readFileSync(testRegistryPath, 'utf8'));
      assert.strictEqual(recoveredData.telegramLeader?.windowKey, 'win_alpha');
      console.log('  ✓ Dead leader PID eviction and automatic recovery verified.');

      bridgeAlpha.releaseLeadership();
    }

    // -------------------------------------------------------------------------
    // Test Suite 4: Clean Startup, Polling, and Graceful Shutdown Lifecycle
    // -------------------------------------------------------------------------
    console.log('\n[Suite 4] Verifying clean startup, lifecycle integration, and shutdown...');
    {
      let mockStartCalled = false;
      let mockStopCalled = false;
      let botInstance: Bot | null = null;

      const mockBotFactory = (token: string) => {
        const { bot } = createMockBot(token);
        botInstance = bot;
        // Intercept bot.start and bot.stop to track calls
        bot.start = async () => {
          mockStartCalled = true;
          // Returns promise that resolves when stopped
          return new Promise<void>((resolve) => {
            const origStop = bot.stop.bind(bot);
            bot.stop = async () => {
              mockStopCalled = true;
              await origStop();
              resolve();
            };
          });
        };
        return bot;
      };

      const lifecycleBridge = new TelegramBridge({
        token: '8930752011:AAG6HyFKC5h405nOw06EHz71np73vYuzFMc',
        enabled: true,
        allowedUsers: [12345],
        registryPath: testRegistryPath,
        windowKey: 'win_lifecycle',
        heartbeatIntervalMs: 50,
        standbyIntervalMs: 50,
        leaderStaleTimeoutMs: 200,
        botFactory: mockBotFactory,
        logger: testLogger
      });

      // 4.1 Start bridge
      await lifecycleBridge.start();
      assert.strictEqual(lifecycleBridge.getIsRunning(), true, 'Bridge should be running after start()');
      assert.strictEqual(lifecycleBridge.getIsLeader(), true, 'Bridge should be designated leader');
      assert.strictEqual(mockStartCalled, true, 'bot.start() MUST have been invoked for leader');
      assert.strictEqual(lifecycleBridge.getIsPolling(), true, 'isPolling must be true while polling');

      // Wait 120ms to allow heartbeat ticks to write to registry
      await new Promise((r) => setTimeout(r, 120));
      const heartbeatData = JSON.parse(fs.readFileSync(testRegistryPath, 'utf8'));
      assert.strictEqual(heartbeatData.telegramLeader?.windowKey, 'win_lifecycle');
      assert.ok(heartbeatData.telegramLeader?.updatedAt > heartbeatData.telegramLeader?.acquiredAt);
      console.log('  ✓ Clean startup, bot initialization, and periodic heartbeat verified.');

      // 4.2 Graceful shutdown
      await lifecycleBridge.stop();
      assert.strictEqual(lifecycleBridge.getIsRunning(), false, 'Bridge should not be running after stop()');
      assert.strictEqual(lifecycleBridge.getIsLeader(), false, 'Leader flag should be false after stop()');
      assert.strictEqual(lifecycleBridge.getIsPolling(), false, 'isPolling should be false after stop()');
      assert.strictEqual(mockStopCalled, true, 'bot.stop() MUST have been called during stop()');

      // Verify registry lock was cleaned up
      const afterStopData = JSON.parse(fs.readFileSync(testRegistryPath, 'utf8'));
      assert.strictEqual(afterStopData.telegramLeader, undefined, 'Leadership lock must be removed after stop()');
      console.log('  ✓ Graceful shutdown (bot.stop(), lock release, timers cleared) verified.');
    }

    // -------------------------------------------------------------------------
    // Test Suite 5: Standby Follower Instance Suppression
    // -------------------------------------------------------------------------
    console.log('\n[Suite 5] Verifying standby follower instance behavior...');
    {
      let leaderBotStarted = false;
      let followerBotStarted = false;

      const leaderBridge = new TelegramBridge({
        token: 'token_leader',
        enabled: true,
        registryPath: testRegistryPath,
        windowKey: 'win_primary',
        heartbeatIntervalMs: 50,
        standbyIntervalMs: 50,
        leaderStaleTimeoutMs: 300,
        botFactory: (token) => {
          const { bot } = createMockBot(token);
          bot.start = async () => {
            leaderBotStarted = true;
          };
          return bot;
        },
        logger: testLogger
      });

      const followerBridge = new TelegramBridge({
        token: 'token_follower',
        enabled: true,
        registryPath: testRegistryPath,
        windowKey: 'win_secondary',
        heartbeatIntervalMs: 50,
        standbyIntervalMs: 50,
        leaderStaleTimeoutMs: 300,
        botFactory: (token) => {
          const { bot } = createMockBot(token);
          bot.start = async () => {
            followerBotStarted = true;
          };
          return bot;
        },
        logger: testLogger
      });

      await leaderBridge.start();
      assert.strictEqual(leaderBridge.getIsLeader(), true);
      assert.strictEqual(leaderBotStarted, true);

      await followerBridge.start();
      assert.strictEqual(followerBridge.getIsLeader(), false, 'Follower bridge must NOT be leader');
      assert.strictEqual(followerBotStarted, false, 'Follower bot polling MUST NOT be started while in standby');
      console.log('  ✓ Secondary window gracefully standby without initiating bot polling.');

      // Stop leader -> Follower takes over automatically via standby timer
      await leaderBridge.stop();

      // Wait for follower standby polling interval to detect vacant leadership
      await new Promise((r) => setTimeout(r, 120));
      assert.strictEqual(followerBridge.getIsLeader(), true, 'Follower should have transitioned to leader');
      assert.strictEqual(followerBotStarted, true, 'Follower bot polling should have started after takeover');
      console.log('  ✓ Secondary window automatically transitioned to leader upon primary shutdown.');

      await followerBridge.stop();
    }

    // -------------------------------------------------------------------------
    // Test Suite 6: Error Isolation & Disabled State Resilience
    // -------------------------------------------------------------------------
    console.log('\n[Suite 6] Verifying error isolation and disabled state resilience...');
    {
      // 6.1 Disabled bridge
      const disabledBridge = new TelegramBridge({
        token: 'test_token',
        enabled: false,
        registryPath: testRegistryPath,
        logger: testLogger
      });
      await disabledBridge.start();
      assert.strictEqual(disabledBridge.getIsRunning(), false, 'Disabled bridge should not run');
      assert.strictEqual(disabledBridge.getBot(), null, 'Bot should not be created when disabled');
      console.log('  ✓ Disabled bridge does not initialize bot or acquire locks.');

      // 6.2 Missing token
      const noTokenBridge = new TelegramBridge({
        token: '',
        enabled: true,
        registryPath: testRegistryPath,
        logger: testLogger
      });
      await noTokenBridge.start();
      assert.strictEqual(noTokenBridge.getIsRunning(), false, 'Bridge with empty token should not run');
      console.log('  ✓ Missing token handled gracefully without throwing.');

      // 6.3 Global error boundary isolation
      const { bot } = createMockBot('error_test_token');
      const bridge = new TelegramBridge({
        token: 'error_test_token',
        enabled: true,
        allowedUsers: [123],
        registryPath: testRegistryPath,
        botFactory: () => bot,
        logger: testLogger
      });

      bridge.initBot();
      // Add a faulty middleware that throws an error
      bot.use(async () => {
        throw new Error('Simulated internal middleware failure');
      });

      // Sending update should not crash process because bot.catch isolates it
      let didCrash = false;
      try {
        await (bot as any).handleUpdates([
          {
            update_id: 99,
            message: {
              message_id: 991,
              date: Math.floor(Date.now() / 1000),
              chat: { id: 123, type: 'private', first_name: 'Tester' },
              from: { id: 123, is_bot: false, first_name: 'Tester' },
              text: '/trigger_error'
            }
          }
        ]);
      } catch {
        didCrash = true;
      }
      assert.strictEqual(didCrash, false, 'Global error boundary must prevent middleware errors from crashing process');
      console.log('  ✓ Bot error boundary successfully isolated middleware exceptions.');

      await bridge.stop();
    }

    console.log('\n================================================================');
    console.log(' ALL Phase 01 Telegram Bridge & Lifecycle Tests PASSED!');
    console.log('================================================================\n');
  } finally {
    // Cleanup temporary directory
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {}
  }
}

// Execute test
runPhase01TelegramBridgeLifecycleTest()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Phase 01 test FAILED with error:', err);
    process.exit(1);
  });
