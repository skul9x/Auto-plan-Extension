// Standalone test suite for Phase 01: DebugLogger Subsystem & Output Channel
const Module = require('module');
const originalRequire = Module.prototype.require;

interface MockOutputChannel {
  name: string;
  options?: any;
  lines: string[];
  shown: boolean;
  preserveFocus?: boolean;
  disposed: boolean;
  appendLine: (line: string) => void;
  append: (text: string) => void;
  show: (preserveFocus?: boolean) => void;
  dispose: () => void;
}

let lastCreatedChannel: MockOutputChannel | null = null;
let mockConfigStore: Record<string, any> = {};

// Intercept 'vscode' imports before importing test modules
Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      window: {
        createOutputChannel: (name: string, options?: any) => {
          const channel: MockOutputChannel = {
            name,
            options,
            lines: [],
            shown: false,
            preserveFocus: undefined,
            disposed: false,
            appendLine(line: string) {
              this.lines.push(line);
            },
            append(text: string) {
              this.lines.push(text);
            },
            show(preserveFocus?: boolean) {
              this.shown = true;
              this.preserveFocus = preserveFocus;
            },
            dispose() {
              this.disposed = true;
            }
          };
          lastCreatedChannel = channel;
          return channel;
        }
      },
      workspace: {
        getConfiguration: (section?: string) => ({
          get: (key: string, defaultValue: any) => {
            return mockConfigStore[key] !== undefined ? mockConfigStore[key] : defaultValue;
          },
          update: async (key: string, value: any) => {
            mockConfigStore[key] = value;
          }
        })
      },
      env: {
        appName: 'Antigravity IDE Test Host',
        appRoot: '/mock/antigravity/app/root'
      },
      version: '1.85.0-test'
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DebugLogger,
  debugLogger,
  sanitizePrompt,
  LogEntry,
  LogLevel,
  LogComponent
} from '../debugLogger';
import { getConfig } from '../config';
import { TAG_START, TAG_END, BACKUP_SUFFIX } from '../workbenchInjector';

async function runPhase01TestSuite() {
  console.log('=== Running Phase 01: DebugLogger Subsystem & Output Channel Verification Test ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-logger-phase01-'));

  try {
    // --------------------------------------------------------------------------
    // Test 1: Configuration integration for debug logger options
    // --------------------------------------------------------------------------
    console.log('[Test 1] Verifying Debug Logger Configuration Defaults...');
    {
      mockConfigStore = {};
      const cfg = getConfig();
      assert.strictEqual(cfg.enableVerboseBridgeLogs, false, 'Default enableVerboseBridgeLogs should be false');
      assert.strictEqual(cfg.maxLogEntries, 500, 'Default maxLogEntries should be 500');
      assert.strictEqual(cfg.autoOpenBridgeLogOnError, false, 'Default autoOpenBridgeLogOnError should be false');

      mockConfigStore['enableVerboseBridgeLogs'] = true;
      mockConfigStore['maxLogEntries'] = 1000;
      mockConfigStore['autoOpenBridgeLogOnError'] = true;

      const updatedCfg = getConfig();
      assert.strictEqual(updatedCfg.enableVerboseBridgeLogs, true);
      assert.strictEqual(updatedCfg.maxLogEntries, 1000);
      assert.strictEqual(updatedCfg.autoOpenBridgeLogOnError, true);
      console.log('  ✔ Configuration fields properly retrieved and typed.');
    }

    // --------------------------------------------------------------------------
    // Test 2: Prompt sanitization & truncation
    // --------------------------------------------------------------------------
    console.log('[Test 2] Verifying Prompt Sanitization & Truncation...');
    {
      const shortPrompt = 'Implement simple feature';
      assert.strictEqual(sanitizePrompt(shortPrompt, 100), 'Implement simple feature');

      const multilinePrompt = 'Line 1\nLine 2\r\nLine 3';
      const sanitizedMulti = sanitizePrompt(multilinePrompt, 100);
      assert.strictEqual(sanitizedMulti, 'Line 1 Line 2 Line 3', 'Newlines must be collapsed into spaces');

      const longPrompt = 'A'.repeat(200);
      const truncated = sanitizePrompt(longPrompt, 50);
      assert.ok(truncated.startsWith('A'.repeat(50)), 'Should truncate at maxLength');
      assert.ok(truncated.includes('... (200 chars)'), 'Should report total char length');
      console.log('  ✔ Prompt sanitization behaves as expected.');
    }

    // --------------------------------------------------------------------------
    // Test 3: Log Entry Creation Across All Levels & Components
    // --------------------------------------------------------------------------
    console.log('[Test 3] Verifying Log Entry Creation across all levels and components...');
    {
      const logger = new DebugLogger(100);
      const components: LogComponent[] = [
        'SERVER',
        'CLIENT',
        'DISPATCHER',
        'INJECTOR',
        'DOM',
        'ORCHESTRATOR',
        'SETTINGS'
      ];

      // 1. Debug
      const dEntry = logger.debug('SERVER', 'Test debug message', { port: 48860 });
      assert.strictEqual(dEntry.level, 'DEBUG');
      assert.strictEqual(dEntry.component, 'SERVER');
      assert.strictEqual(dEntry.message, 'Test debug message');
      assert.deepStrictEqual(dEntry.details, { port: 48860 });
      assert.ok(typeof dEntry.id === 'string' && dEntry.id.length > 0);
      assert.ok(typeof dEntry.timestamp === 'number');
      assert.ok(typeof dEntry.isoTime === 'string');

      // 2. Info
      const iEntry = logger.info('CLIENT', 'Test info message');
      assert.strictEqual(iEntry.level, 'INFO');
      assert.strictEqual(iEntry.component, 'CLIENT');

      // 3. Warn with string error
      const wEntry = logger.warn('DISPATCHER', 'Test warn message', { tier: 1 }, 'Fallback warning');
      assert.strictEqual(wEntry.level, 'WARN');
      assert.strictEqual(wEntry.component, 'DISPATCHER');
      assert.strictEqual(wEntry.error, 'Fallback warning');

      // 4. Error with Error instance
      const errObj = new Error('Simulated injection failure');
      const eEntry = logger.error('INJECTOR', 'Test error message', { path: '/tmp/wb.html' }, errObj);
      assert.strictEqual(eEntry.level, 'ERROR');
      assert.strictEqual(eEntry.component, 'INJECTOR');
      assert.ok(eEntry.error && eEntry.error.includes('Simulated injection failure'));
      assert.ok(eEntry.error && eEntry.error.includes('Error: Simulated injection failure'));

      // 5. Test remaining components
      for (const comp of components) {
        const ent = logger.log('INFO', comp, `Heartbeat from ${comp}`);
        assert.strictEqual(ent.component, comp);
      }

      assert.strictEqual(logger.getEntries().length, 4 + components.length);
      console.log('  ✔ All log levels, components, and error types recorded accurately.');
    }

    // --------------------------------------------------------------------------
    // Test 4: Ring Buffer Eviction & Capacity Management
    // --------------------------------------------------------------------------
    console.log('[Test 4] Verifying Ring Buffer Eviction & Capacity Management...');
    {
      const logger = new DebugLogger(5);
      assert.strictEqual(logger.getCapacity(), 5);

      // Add 8 entries (sequence 1 to 8)
      for (let i = 1; i <= 8; i++) {
        logger.info('SERVER', `Message ${i}`);
      }

      const entries = logger.getEntries();
      assert.strictEqual(entries.length, 5, 'Ring buffer should not exceed capacity of 5');
      // Oldest 3 (1, 2, 3) must be evicted; remaining should be 4, 5, 6, 7, 8
      assert.strictEqual(entries[0].message, 'Message 4', 'Oldest entry in buffer should be Message 4');
      assert.strictEqual(entries[4].message, 'Message 8', 'Newest entry in buffer should be Message 8');

      // Test getRecentEntries
      const recent3 = logger.getRecentEntries(3);
      assert.strictEqual(recent3.length, 3);
      assert.strictEqual(recent3[0].message, 'Message 6');
      assert.strictEqual(recent3[2].message, 'Message 8');

      // Test setCapacity shrinking
      logger.setCapacity(3);
      assert.strictEqual(logger.getCapacity(), 3);
      assert.strictEqual(logger.getEntries().length, 3);
      assert.strictEqual(logger.getEntries()[0].message, 'Message 6');

      // Test clear()
      logger.clear();
      assert.strictEqual(logger.getEntries().length, 0);
      assert.strictEqual(logger.getRecentEntries().length, 0);
      console.log('  ✔ FIFO ring buffer eviction and capacity adjustments verified.');
    }

    // --------------------------------------------------------------------------
    // Test 5: Real-time Subscription Listener (onLog)
    // --------------------------------------------------------------------------
    console.log('[Test 5] Verifying Subscription Mechanism (onLog)...');
    {
      const logger = new DebugLogger(50);
      const received: LogEntry[] = [];

      const sub = logger.onLog((entry) => {
        received.push(entry);
      });

      logger.info('DOM', 'First subscribed event');
      logger.warn('SETTINGS', 'Second subscribed event');

      assert.strictEqual(received.length, 2);
      assert.strictEqual(received[0].message, 'First subscribed event');
      assert.strictEqual(received[1].message, 'Second subscribed event');

      // Dispose subscription
      sub.dispose();
      logger.info('DOM', 'Third event after disposal');
      assert.strictEqual(received.length, 2, 'Listener should not receive entries after disposal');
      console.log('  ✔ Subscription and disposal mechanism working.');
    }

    // --------------------------------------------------------------------------
    // Test 6: Output Channel Integration & Formatting
    // --------------------------------------------------------------------------
    console.log('[Test 6] Verifying VS Code Output Channel Streaming & Formatting...');
    {
      lastCreatedChannel = null;
      const logger = new DebugLogger(50);

      // Initially channel is lazy
      assert.strictEqual(lastCreatedChannel, null);

      logger.info('SERVER', 'Server initialized on port 48860', { pid: 12345 });
      assert.ok(lastCreatedChannel !== null, 'Output channel should be lazily instantiated');
      const channel: MockOutputChannel = lastCreatedChannel as any;
      assert.strictEqual(channel.name, DebugLogger.OUTPUT_CHANNEL_NAME);
      assert.strictEqual(channel.lines.length, 1);

      const line = channel.lines[0];
      // Expected format: [YYYY-MM-DDTHH:mm:ss.sssZ] [LEVEL] [COMPONENT] Message {details}
      assert.ok(line.includes('[INFO] [SERVER] Server initialized on port 48860 {"pid":12345}'));
      assert.ok(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/.test(line), 'Timestamp should be valid ISO format');

      // Test showOutputChannel
      logger.showOutputChannel(true);
      assert.strictEqual(channel.shown, true);
      assert.strictEqual(channel.preserveFocus, true);

      // Test dispose
      logger.dispose();
      assert.strictEqual(channel.disposed, true);
      console.log('  ✔ Output Channel lazily created, formatted, revealed, and disposed properly.');
    }

    // --------------------------------------------------------------------------
    // Test 7: Environment Diagnostic Report Compilation
    // --------------------------------------------------------------------------
    console.log('[Test 7] Verifying Environment & System Diagnostic Report Generation...');
    {
      const logger = new DebugLogger(50);

      // Mock BridgeServer instance
      const mockServer = {
        getPort: () => 48860,
        getActiveWindowKey: () => 'win_test_999',
        getConnectedClients: () => [
          { windowKey: 'win_test_999', userAgent: 'Electron 25', registeredAt: Date.now() }
        ]
      };

      const envReport = logger.buildEnvironmentReport(mockServer);

      assert.strictEqual(envReport.os.platform, process.platform);
      assert.strictEqual(envReport.os.arch, process.arch);
      assert.strictEqual(envReport.runtime.node, process.versions?.node || process.version);
      assert.strictEqual(envReport.vscode.appName, 'Antigravity IDE Test Host');
      assert.strictEqual(envReport.vscode.version, '1.85.0-test');
      assert.strictEqual(envReport.server.activePort, 48860);
      assert.strictEqual(envReport.server.activeWindowKey, 'win_test_999');
      assert.strictEqual(envReport.server.connectedClientsCount, 1);
      assert.strictEqual(envReport.server.connectedClients[0].windowKey, 'win_test_999');
      assert.strictEqual(envReport.config.executionMode, 'auto');
      console.log('  ✔ buildEnvironmentReport() successfully captures system, runtime, and server state.');
    }

    // --------------------------------------------------------------------------
    // Test 8: Diagnostic Report Markdown Serialization & File Export
    // --------------------------------------------------------------------------
    console.log('[Test 8] Verifying Diagnostic Report Markdown Export & Disk Persistence...');
    {
      const logger = new DebugLogger(50);

      logger.info('SERVER', 'Bound to port 48860');
      logger.info('CLIENT', 'Client win_test_1 connected');
      logger.warn('DISPATCHER', 'Retrying command submission', { attempt: 2 });
      logger.error('DOM', 'Element #submit not found', undefined, new Error('Selector lookup timeout'));

      const mockServer = {
        getPort: () => 48860,
        getActiveWindowKey: () => 'win_test_1',
        getConnectedClients: () => [{ windowKey: 'win_test_1' }]
      };

      const markdown = logger.exportDiagnosticReportToString(50, mockServer);

      // Verify Markdown Sections
      assert.ok(markdown.includes('# Auto-Plan DOM Bridge Diagnostic Report'), 'Report must have main header');
      assert.ok(markdown.includes('## 1. Environment & System Information'), 'Must include Environment section');
      assert.ok(markdown.includes('## 2. Component Health Status Checklist'), 'Must include Checklist section');
      assert.ok(markdown.includes('## 3. Recent Log Traces'), 'Must include Recent Logs section');
      assert.ok(markdown.includes('Bound to port 48860'));
      assert.ok(markdown.includes('Element #submit not found'));
      assert.ok(markdown.includes('Selector lookup timeout'));

      // Test export to disk in a nested directory
      const exportPath = path.join(tempDir, 'subfolder', 'deep', 'diagnostics.md');
      const returnedPath = await logger.exportLogToFile(exportPath, 50, mockServer);

      assert.strictEqual(returnedPath, exportPath);
      assert.ok(fs.existsSync(exportPath), 'Exported file must exist on disk');

      const fileContent = fs.readFileSync(exportPath, 'utf8');
      assert.strictEqual(fileContent, markdown, 'File content must match generated markdown string');
      console.log('  ✔ exportDiagnosticReportToString() and exportLogToFile() fully verified.');
    }

    // --------------------------------------------------------------------------
    // Test 9: Singleton Instance Export
    // --------------------------------------------------------------------------
    console.log('[Test 9] Verifying Singleton debugLogger Export...');
    {
      assert.ok(debugLogger instanceof DebugLogger, 'Default export debugLogger must be an instance of DebugLogger');
      debugLogger.info('ORCHESTRATOR', 'Singleton verification test message');
      const recent = debugLogger.getRecentEntries(1);
      assert.strictEqual(recent.length, 1);
      assert.strictEqual(recent[0].message, 'Singleton verification test message');
      debugLogger.clear();
      assert.strictEqual(debugLogger.getEntries().length, 0);
      console.log('  ✔ Singleton export debugLogger verified.');
    }

    console.log('\n================================================================');
    console.log('🎉 ALL PHASE 01 DEBUG LOGGER TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('================================================================\n');
  } finally {
    // Cleanup temporary files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

runPhase01TestSuite().catch((err) => {
  console.error('\n❌ Phase 01 Test Suite Failed:', err);
  process.exit(1);
});
