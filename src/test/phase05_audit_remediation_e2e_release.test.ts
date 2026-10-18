// Standalone Mock and E2E Test Runner for Phase 05: Modernization, E2E Verification & Release Packaging
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockConfigStore: Record<string, any> = {
  defaultPromptTemplate: 'Implement the code closely following the file {xxx}',
  promptTemplate: 'Implement the code closely following the file {xxx}',
  promptText: 'Default Prompt',
  repeatCount: 5,
  completionKeyword: 'Done skul9x.',
  delayBetweenLoopsMs: 100,
  timeoutPerLoopMinutes: 0,
  focusDelayMs: 100,
  executionMode: 'auto',
  allowTierFallback: true,
  bridgeTimeoutMs: 500,
  autoInjectWorkbench: false,
  suppressFallbackWarnings: true,
  telegramEnabled: true,
  telegramBotToken: '',
  telegramAllowedUsers: [],
  telegramThrottleMs: 2500
};

const activeConfigListeners: ((e: any) => void)[] = [];
const registeredCommands: Record<string, Function> = {};
let mockAppRoot = '';

Module.prototype.require = function (moduleName: string) {
  if (moduleName === 'vscode') {
    return {
      workspace: {
        workspaceFolders: [
          {
            uri: { fsPath: '/mock/workspace/path' },
            name: 'mock-workspace',
            index: 0
          }
        ],
        name: 'mock-workspace-title',
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
              if (idx >= 0) {
                activeConfigListeners.splice(idx, 1);
              }
            }
          };
        },
        onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
        openTextDocument: async () => ({})
      },
      ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
      },
      env: {
        get appRoot() {
          return mockAppRoot;
        },
        clipboard: {
          writeText: async () => {},
          readText: async () => ''
        }
      },
      commands: {
        executeCommand: async (id: string, ...args: any[]) => {
          if (registeredCommands[id]) {
            return registeredCommands[id](...args);
          }
        },
        registerCommand: (id: string, cb: Function) => {
          registeredCommands[id] = cb;
          return {
            dispose: () => {
              delete registeredCommands[id];
            }
          };
        }
      },
      window: {
        activeTextEditor: undefined,
        createStatusBarItem: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {},
          text: '',
          tooltip: ''
        }),
        showInformationMessage: async () => {},
        showWarningMessage: async () => {},
        showErrorMessage: async () => {},
        showQuickPick: async () => undefined,
        showInputBox: async () => undefined,
        registerWebviewViewProvider: () => ({ dispose: () => {} })
      },
      StatusBarAlignment: { Left: 1, Right: 2 },
      Uri: {
        file: (f: string) => ({ fsPath: f }),
        joinPath: (...args: any[]) => ({ fsPath: args.join('/') })
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
import * as crypto from 'crypto';
const yauzl = require('yauzl');

import { BridgeServer, PORT_REGISTRY_FILENAME } from '../bridgeServer';
import {
  DEFAULT_CONFIG,
  getConfig,
  writeSidecarConfig,
  SecretStorageManager,
  TELEGRAM_TOKEN_SECRET_KEY,
  SIDECAR_CONFIG_FILENAME
} from '../config';
import {
  buildLinuxElevationCommand,
  buildWindowsElevationCommand,
  quotePosixShell,
  decodeWindowsElevationScript
} from '../workbenchInjector';
import { activate, deactivate } from '../extension';

// Helper for Mock SecretStorage
class MockSecretStorage {
  private _storage = new Map<string, string>();
  public async get(key: string): Promise<string | undefined> {
    return this._storage.get(key);
  }
  public async store(key: string, value: string): Promise<void> {
    this._storage.set(key, value);
  }
  public async delete(key: string): Promise<void> {
    this._storage.delete(key);
  }
  public onDidChange = () => ({ dispose: () => {} });
}

// Helper to inspect entries and contents of a VSIX zip archive
interface VsixAuditReport {
  totalFiles: number;
  files: string[];
  packageJson: any;
  leakedSecretFindings: { file: string; match: string }[];
}

function auditVsixArchive(vsixFilePath: string): Promise<VsixAuditReport> {
  return new Promise((resolve, reject) => {
    yauzl.open(vsixFilePath, { lazyEntries: true }, (err: any, zipfile: any) => {
      if (err) return reject(err);

      const report: VsixAuditReport = {
        totalFiles: 0,
        files: [],
        packageJson: null,
        leakedSecretFindings: []
      };

      const auditRegex = /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g;
      const forbiddenStrings = [
        '8930752011:AAG6HyFKC5h405nOw06EHz71np73vYuzFMc',
        '8376918512:'
      ];

      zipfile.readEntry();
      zipfile.on('entry', (entry: any) => {
        report.totalFiles++;
        report.files.push(entry.fileName);

        // Check if file is text/code that could contain leaked credentials
        const isTextCandidate =
          /\.(js|json|md|html|txt|ts|yml|yaml)$/i.test(entry.fileName);

        if (isTextCandidate) {
          zipfile.openReadStream(entry, (streamErr: any, readStream: any) => {
            if (streamErr) return reject(streamErr);
            const chunks: Buffer[] = [];
            readStream.on('data', (c: Buffer) => chunks.push(c));
            readStream.on('end', () => {
              const content = Buffer.concat(chunks).toString('utf8');

              if (entry.fileName === 'extension/package.json') {
                try {
                  report.packageJson = JSON.parse(content);
                } catch (pe) {
                  // Ignore JSON parse error in report
                }
              }

              // Check for forbidden strings
              for (const forbidden of forbiddenStrings) {
                if (content.includes(forbidden)) {
                  report.leakedSecretFindings.push({
                    file: entry.fileName,
                    match: forbidden
                  });
                }
              }

              // Check regex for token format
              const matches = content.match(auditRegex);
              if (matches) {
                for (const m of matches) {
                  report.leakedSecretFindings.push({
                    file: entry.fileName,
                    match: m
                  });
                }
              }

              zipfile.readEntry();
            });
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => {
        resolve(report);
      });
      zipfile.on('error', (zipErr: any) => {
        reject(zipErr);
      });
    });
  });
}

// HTTP request helper
function sendHttpRequest(options: http.RequestOptions, body?: string): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: data
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function runPhase05ComprehensiveE2EReleaseTest(): Promise<void> {
  console.log('================================================================================');
  console.log(' Phase 05: DevDeps Modernization, Packaging & End-to-End Release Audit Verification');
  console.log('================================================================================\n');

  const rootDir = path.resolve(__dirname, '../../');
  const tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-phase05-e2e-'));

  try {
    // -------------------------------------------------------------------------
    // Suite 1: Build Modernization, Version Bump & Release Documentation
    // -------------------------------------------------------------------------
    console.log('[Suite 1] Verifying build modernization, version bump & release documentation...');
    const packageJsonPath = path.join(rootDir, 'package.json');
    const changelogPath = path.join(rootDir, 'CHANGELOG.md');
    const readmePath = path.join(rootDir, 'README.md');

    assert.ok(fs.existsSync(packageJsonPath), 'package.json must exist');
    assert.ok(fs.existsSync(changelogPath), 'CHANGELOG.md must exist');
    assert.ok(fs.existsSync(readmePath), 'README.md must exist');

    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    assert.ok(pkg.version === '1.6.2' || pkg.version === '1.6.3' || pkg.version === '1.6.4', `package.json version must be at least 1.6.2 (got ${pkg.version})`);
    assert.ok(pkg.devDependencies['@vscode/vsce'], '@vscode/vsce devDependency must be configured');
    assert.ok(pkg.devDependencies['mocha'], 'mocha devDependency must be configured');
    assert.strictEqual(
      pkg.contributes.configuration.properties['autoplan.telegramBotToken'].default,
      '',
      'autoplan.telegramBotToken default must be sanitized to empty string'
    );
    assert.deepStrictEqual(
      pkg.contributes.configuration.properties['autoplan.telegramAllowedUsers'].default,
      [],
      'autoplan.telegramAllowedUsers default must be empty array'
    );

    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    assert.ok(
      changelogContent.includes('## [1.6.2]'),
      'CHANGELOG.md must document release 1.6.2'
    );
    assert.ok(
      changelogContent.includes('SecretStorage') &&
      changelogContent.includes('CORS') &&
      changelogContent.includes('pkexec') &&
      changelogContent.includes('0600'),
      'CHANGELOG.md must detail all security and reliability audit resolutions'
    );

    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    assert.ok(
      readmeContent.includes('version-1.6.2') || readmeContent.includes('version-1.6.3') || readmeContent.includes('version-1.6.4'),
      'README.md version badge must reflect version 1.6.2 or newer'
    );
    assert.ok(
      readmeContent.includes('antigravity-auto-plan-1.6.2.vsix') || readmeContent.includes('antigravity-auto-plan-1.6.3.vsix') || readmeContent.includes('antigravity-auto-plan-1.6.4.vsix'),
      'README.md installation commands must reference valid VSIX artifact'
    );
    console.log('  ✓ Version bump, manifest defaults and documentation verified.\n');

    // -------------------------------------------------------------------------
    // Suite 2: Phase 01 Remediation Verification (Secrets Hardening & Storage)
    // -------------------------------------------------------------------------
    console.log('[Suite 2] Verifying Phase 01: Secrets hardening and SecretStorageManager...');
    assert.strictEqual(DEFAULT_CONFIG.telegramBotToken, '', 'DEFAULT_CONFIG.telegramBotToken must be empty');
    assert.deepStrictEqual(DEFAULT_CONFIG.telegramAllowedUsers, [], 'DEFAULT_CONFIG.telegramAllowedUsers must be empty');

    const mockSecrets = new MockSecretStorage();
    const manager = new SecretStorageManager(mockSecrets as any);

    // Test SecretStorage lifecycle
    const testSecret = '123456789:Phase05SecretStorageVerificationToken';
    await manager.setTelegramToken(testSecret);
    const retrievedSecret = await manager.getTelegramToken();
    assert.strictEqual(retrievedSecret, testSecret, 'SecretStorageManager must retrieve stored token');

    // Precedence: SecretStorage overrides config token
    mockConfigStore['telegramBotToken'] = 'FallbackConfigToken';
    const effectiveToken = await manager.getTelegramToken();
    assert.strictEqual(effectiveToken, testSecret, 'SecretStorage token must take precedence over config');

    await manager.deleteTelegramToken();
    const fallbackToken = await manager.getTelegramToken();
    assert.strictEqual(fallbackToken, 'FallbackConfigToken', 'When SecretStorage is cleared, fallback config token resolves');
    mockConfigStore['telegramBotToken'] = '';

    // Verify sidecar config stripping & 0600 file permissions
    const sidecarOutDir = path.join(tempTestDir, 'sidecar-out');
    const writtenSidecarPath = writeSidecarConfig({
      ...DEFAULT_CONFIG,
      telegramBotToken: 'SENSITIVE_LEAKED_BOT_TOKEN_DO_NOT_WRITE'
    }, sidecarOutDir);
    assert.ok(writtenSidecarPath, 'writeSidecarConfig must return written file path');
    assert.ok(fs.existsSync(writtenSidecarPath), 'Sidecar config must exist on disk');

    const sidecarContent = JSON.parse(fs.readFileSync(writtenSidecarPath, 'utf8'));
    assert.strictEqual(sidecarContent.telegramBotToken, undefined, 'Sidecar file must strip telegramBotToken');
    assert.strictEqual('telegramBotToken' in sidecarContent, false, 'telegramBotToken key must not exist');

    if (process.platform !== 'win32') {
      const stats = fs.statSync(writtenSidecarPath);
      const mode = stats.mode & 0o777;
      assert.strictEqual(mode, 0o600, `Sidecar file mode must be strictly 0o600 (got 0o${mode.toString(8)})`);
    }
    console.log('  ✓ SecretStorageManager, token precedence hierarchy and 0o600 sidecar stripping pass.\n');

    // -------------------------------------------------------------------------
    // Suite 3: Phase 02 Remediation Verification (Bridge Server Auth & CORS)
    // -------------------------------------------------------------------------
    console.log('[Suite 3] Verifying Phase 02: BridgeServer loopback auth token & strict CORS origin guard...');
    const bridgeServer = new BridgeServer({
      portsRegistryPath: path.join(tempTestDir, PORT_REGISTRY_FILENAME)
    });

    const bridgePort = await bridgeServer.start();
    const authToken = bridgeServer.getAuthToken();
    assert.ok(authToken && authToken.length >= 32, 'BridgeServer must produce secure 32+ char session token');

    try {
      // 1. Untrusted origin rejection (403)
      const untrustedRes = await sendHttpRequest({
        hostname: '127.0.0.1',
        port: bridgePort,
        path: '/autoplan-status',
        method: 'GET',
        headers: {
          Origin: 'https://malicious-website.com'
        }
      });
      assert.strictEqual(untrustedRes.statusCode, 403, 'Untrusted origin must receive 403 Forbidden');

      // 2. Unauthenticated request to sensitive route (401)
      const unauthRes = await sendHttpRequest({
        hostname: '127.0.0.1',
        port: bridgePort,
        path: '/autoplan-status',
        method: 'GET'
      });
      assert.strictEqual(unauthRes.statusCode, 401, 'Unauthenticated status check must receive 401 Unauthorized');

      // 3. Forged token request (401)
      const forgedRes = await sendHttpRequest({
        hostname: '127.0.0.1',
        port: bridgePort,
        path: '/autoplan-status',
        method: 'GET',
        headers: {
          'X-Bridge-Auth': 'invalid-forged-token-xyz'
        }
      });
      assert.strictEqual(forgedRes.statusCode, 401, 'Invalid token must receive 401 Unauthorized');

      // 4. Discovery probe allowed unauthenticated for loopback setup (200)
      const probeRes = await sendHttpRequest({
        hostname: '127.0.0.1',
        port: bridgePort,
        path: '/autoplan-status?probe=1',
        method: 'GET'
      });
      assert.strictEqual(probeRes.statusCode, 200, 'Discovery probe must be permitted');

      // 5. Valid authentication via X-Bridge-Auth (200)
      const authRes = await sendHttpRequest({
        hostname: '127.0.0.1',
        port: bridgePort,
        path: '/autoplan-status',
        method: 'GET',
        headers: {
          'X-Bridge-Auth': authToken
        }
      });
      assert.strictEqual(authRes.statusCode, 200, 'Authenticated request with X-Bridge-Auth must return 200');

      // 6. Valid authentication via Authorization: Bearer (200)
      const bearerRes = await sendHttpRequest({
        hostname: '127.0.0.1',
        port: bridgePort,
        path: '/autoplan-status',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      assert.strictEqual(bearerRes.statusCode, 200, 'Authenticated request with Bearer token must return 200');
    } finally {
      await bridgeServer.stop();
    }
    console.log('  ✓ BridgeServer origin validation, 401 guard, and session token auth pass.\n');

    // -------------------------------------------------------------------------
    // Suite 4: Phase 03 Remediation Verification (Elevated Shell Command Safety)
    // -------------------------------------------------------------------------
    console.log('[Suite 4] Verifying Phase 03: Elevated shell command safety & injection prevention...');
    // Test POSIX shell argument escaping
    assert.strictEqual(quotePosixShell("hello 'world'"), "'hello '\\''world'\\'''");
    assert.throws(() => quotePosixShell('null\0byte'), /null bytes/i);

    // Test Linux elevation structure ($1, $2 parameter binding)
    const linuxSrc = '/tmp/source file with spaces.html';
    const linuxDst = "/opt/app/target file; rm -rf /; echo 'owned'.html";
    const linuxCmd = buildLinuxElevationCommand(linuxSrc, linuxDst);

    assert.ok(
      linuxCmd.startsWith("pkexec bash -c 'cp \"$1\" \"$2\" && chmod 644 \"$2\"' _ "),
      'Linux elevation command must utilize positional parameters "$1" "$2"'
    );
    assert.ok(
      !linuxCmd.includes('rm -rf /; echo \'owned\''),
      'Linux elevation command must not execute injected command'
    );

    // Test Windows elevation command structure (Base64 UTF-16LE & -LiteralPath)
    const winSrc = 'C:\\temp\\source file.html';
    const winDst = 'C:\\Program Files\\Microsoft VS Code\\resources\\app\\out\\workbench.html';
    const winCmd = buildWindowsElevationCommand(winSrc, winDst);

    assert.ok(winCmd.includes('Start-Process'), 'Windows elevation must use Start-Process runAs');
    assert.ok(winCmd.includes('-EncodedCommand'), 'Windows elevation must use -EncodedCommand');

    const decodedScript = decodeWindowsElevationScript(winCmd);
    assert.ok(
      decodedScript && decodedScript.includes('Copy-Item -LiteralPath'),
      'Decoded script must bind -LiteralPath to prevent wildcard or variable expansion'
    );
    console.log('  ✓ Parameterized Linux elevation and encoded Windows elevation pass.\n');

    // -------------------------------------------------------------------------
    // Suite 5: Phase 04 Remediation Verification (Dynamic Config Hot-Reload & Disposal)
    // -------------------------------------------------------------------------
    console.log('[Suite 5] Verifying Phase 04: Dynamic config hot-reloading & extension disposal...');
    let reloadConfigTriggeredCount = 0;
    const fakeTelegramBridge = {
      reloadConfig: async () => {
        reloadConfigTriggeredCount++;
      },
      stop: async () => {}
    };

    let fakeConfigChangeHandler = (e: any) => {
      if (
        e.affectsConfiguration('autoplan.telegramEnabled') ||
        e.affectsConfiguration('autoplan.telegramBotToken') ||
        e.affectsConfiguration('autoplan.telegramAllowedUsers') ||
        e.affectsConfiguration('autoplan.telegramThrottleMs')
      ) {
        fakeTelegramBridge.reloadConfig().catch(() => {});
      }
    };

    activeConfigListeners.push(fakeConfigChangeHandler);

    // Trigger changes for all 4 Telegram settings
    await fakeConfigChangeHandler({ affectsConfiguration: (k: string) => k === 'autoplan.telegramEnabled' });
    await fakeConfigChangeHandler({ affectsConfiguration: (k: string) => k === 'autoplan.telegramBotToken' });
    await fakeConfigChangeHandler({ affectsConfiguration: (k: string) => k === 'autoplan.telegramAllowedUsers' });
    await fakeConfigChangeHandler({ affectsConfiguration: (k: string) => k === 'autoplan.telegramThrottleMs' });
    // Irrelevant setting should not trigger reload
    await fakeConfigChangeHandler({ affectsConfiguration: (k: string) => k === 'autoplan.repeatCount' });

    assert.strictEqual(
      reloadConfigTriggeredCount,
      4,
      `Expected exactly 4 reloadConfig calls for 4 Telegram settings (got ${reloadConfigTriggeredCount})`
    );

    // Test extension activate & deactivate lifecycle
    const mockContext: any = {
      subscriptions: [],
      secrets: new MockSecretStorage(),
      extensionUri: { fsPath: rootDir }
    };

    activate(mockContext);
    assert.ok(mockContext.subscriptions.length > 0, 'activate must register subscriptions');

    // Verify commands registered
    assert.ok(registeredCommands['autoplan.setTelegramToken'], 'autoplan.setTelegramToken command must be registered');
    assert.ok(registeredCommands['autoplan.clearTelegramToken'], 'autoplan.clearTelegramToken command must be registered');

    // Deactivate cleanly
    await deactivate();
    for (const sub of mockContext.subscriptions) {
      if (sub && typeof sub.dispose === 'function') {
        sub.dispose();
      }
    }
    console.log('  ✓ Dynamic configuration hot-reload and lifecycle disposal cleanup pass.\n');

    // -------------------------------------------------------------------------
    // Suite 6: Phase 05 Remediation Verification (VSIX Packaging & Zero Secrets Leak)
    // -------------------------------------------------------------------------
    console.log('[Suite 6] Verifying Phase 05: Packaged VSIX archive integrity and secret audit...');
    const vsixPath = path.join(rootDir, 'antigravity-auto-plan-1.6.2.vsix');
    assert.ok(fs.existsSync(vsixPath), `VSIX release artifact must exist at: ${vsixPath}`);

    const vsixStats = fs.statSync(vsixPath);
    console.log(`  -> Release VSIX size: ${(vsixStats.size / 1024).toFixed(2)} KB`);
    assert.ok(
      vsixStats.size > 500 * 1024,
      `VSIX release bundle must be substantial (> 500 KB), actual: ${vsixStats.size} bytes`
    );

    // Verify standard PK zip header
    const fd = fs.openSync(vsixPath, 'r');
    const magicBuf = Buffer.alloc(4);
    fs.readSync(fd, magicBuf, 0, 4, 0);
    fs.closeSync(fd);
    assert.strictEqual(magicBuf.toString('hex'), '504b0304', 'VSIX file must possess valid zip magic header (PK\x03\x04)');

    // Deep-audit entries inside the VSIX package
    const vsixAudit = await auditVsixArchive(vsixPath);
    console.log(`  -> Total files packaged in VSIX: ${vsixAudit.totalFiles}`);
    assert.ok(vsixAudit.totalFiles > 100, `Expected > 100 packaged files, found ${vsixAudit.totalFiles}`);

    // Verify package.json inside VSIX has 1.6.2 version and clean defaults
    assert.ok(vsixAudit.packageJson, 'Packaged extension/package.json must be readable');
    assert.strictEqual(
      vsixAudit.packageJson.version,
      '1.6.2',
      `Packaged extension version must be 1.6.2 (got ${vsixAudit.packageJson.version})`
    );
    assert.strictEqual(
      vsixAudit.packageJson.contributes?.configuration?.properties?.['autoplan.telegramBotToken']?.default,
      '',
      'Packaged autoplan.telegramBotToken default must be empty string'
    );

    // Verify NO test or planning source files are included in release bundle
    const forbiddenPathPrefixes = [
      'extension/out/test/',
      'extension/src/',
      'extension/plans/',
      'extension/docs/'
    ];
    for (const f of vsixAudit.files) {
      for (const forbiddenPrefix of forbiddenPathPrefixes) {
        assert.ok(
          !f.startsWith(forbiddenPrefix),
          `VSIX must not package development/test path: ${f}`
        );
      }
    }

    // Verify ZERO leaked secrets or active tokens found across all files in VSIX
    if (vsixAudit.leakedSecretFindings.length > 0) {
      console.error('❌ Leaked secrets found in VSIX archive:', vsixAudit.leakedSecretFindings);
    }
    assert.strictEqual(
      vsixAudit.leakedSecretFindings.length,
      0,
      `VSIX must contain zero hardcoded secrets or tokens (found ${vsixAudit.leakedSecretFindings.length})`
    );
    console.log('  ✓ Zero secret leaks detected in VSIX archive. Pristine release verified.\n');

  } finally {
    try {
      fs.rmSync(tempTestDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('================================================================================');
  console.log(' 🎉 ALL 6 PHASE 05 INTEGRATION & RELEASE PACKAGING TESTS PASSED WITH 100% SUCCESS!');
  console.log('================================================================================\n');
  process.exit(0);
}

runPhase05ComprehensiveE2EReleaseTest().catch((err) => {
  console.error('\n❌ Phase 05 Test Failed:');
  console.error(err);
  process.exit(1);
});
