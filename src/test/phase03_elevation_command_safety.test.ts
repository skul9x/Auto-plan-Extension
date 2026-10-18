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
      env: {
        appRoot: undefined
      },
      ConfigurationTarget: { Global: 1, Workspace: 2 }
    };
  }
  return originalRequire.apply(this, arguments as any);
};

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import {
  buildLinuxElevationCommand,
  buildWindowsElevationCommand,
  decodeWindowsElevationScript,
  quotePosixShell,
  writeFileElevated,
  writeFileElevatedAsync,
  ElevationLockedError,
  getIsElevationInProgress,
  setIsElevationInProgress
} from '../workbenchInjector';

async function runPhase03ElevationCommandSafetyTests(): Promise<void> {
  console.log('=== Running Phase 03: Elevated Shell Command Injection Hardening Tests ===\n');

  const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoplan-p03-test-'));

  try {
    // ----------------------------------------------------------------------
    // Test 1: quotePosixShell Core Quoting and Escaping
    // ----------------------------------------------------------------------
    console.log('[Test 1] Verifying quotePosixShell POSIX shell argument escaping...');
    {
      // Normal path
      assert.strictEqual(quotePosixShell('/simple/path.html'), "'/simple/path.html'");

      // Single quotes escaping
      const singleQuotePath = "/path/with'quote/file.html";
      assert.strictEqual(quotePosixShell(singleQuotePath), "'/path/with'\\''quote/file.html'");

      // Multiple single quotes
      assert.strictEqual(quotePosixShell("a'b'c"), "'a'\\''b'\\''c'");

      // Dollar sign and subexpression characters are strictly preserved
      assert.strictEqual(quotePosixShell('/path/$(whoami)/file'), "'/path/$(whoami)/file'");
      assert.strictEqual(quotePosixShell('/path/`whoami`/file'), "'/path/`whoami`/file'");
      assert.strictEqual(quotePosixShell('/path/$HOME/file'), "'/path/$HOME/file'");

      // Null byte rejection
      assert.throws(
        () => quotePosixShell('/path/\0/evil.html'),
        /Path cannot contain null bytes/,
        'quotePosixShell must reject paths containing null bytes'
      );

      console.log('  ✓ quotePosixShell safely escapes single quotes and rejects null bytes');
    }

    // ----------------------------------------------------------------------
    // Test 2: Linux Polkit Elevation Command Syntax & Positional Parameters
    // ----------------------------------------------------------------------
    console.log('\n[Test 2] Verifying Linux Polkit elevation command structure & positional parameters...');
    {
      const tmpPath = '/tmp/autoplan-temp-123.tmp';
      const targetPath = '/usr/share/code/resources/app/out/workbench.html';
      const cmd = buildLinuxElevationCommand(tmpPath, targetPath);

      // Verify command header and positional parameter structure
      assert.ok(
        cmd.startsWith("pkexec bash -c 'cp \"$1\" \"$2\" && chmod 644 \"$2\"' _ "),
        `Linux command must use single-quoted bash script with positional parameters. Got: ${cmd}`
      );

      // Verify no double quotes are wrapping the bash -c string
      assert.ok(
        !cmd.startsWith('pkexec bash -c "'),
        'Linux command must NOT use double quotes for bash -c script'
      );

      // Verify both arguments are single quoted
      assert.ok(cmd.includes(`'${tmpPath}'`), 'Source temp path must be single-quoted');
      assert.ok(cmd.includes(`'${targetPath}'`), 'Target path must be single-quoted');

      // Verify null byte rejection
      assert.throws(
        () => buildLinuxElevationCommand('/tmp/safe.tmp', '/opt/app/\0workbench.html'),
        /Path cannot contain null bytes/,
        'buildLinuxElevationCommand must reject null bytes in paths'
      );

      console.log('  ✓ Linux elevation command uses single-quoted bash -c with $1 and $2 positional arguments');
    }

    // ----------------------------------------------------------------------
    // Test 3: Linux Command Immunity Against Malicious Shell Injection Payloads
    // ----------------------------------------------------------------------
    console.log('\n[Test 3] Verifying Linux elevation command immunity against malicious shell payloads...');
    {
      const canaryFile = path.join(testTempDir, 'canary_pwned.txt');
      if (fs.existsSync(canaryFile)) {
        fs.unlinkSync(canaryFile);
      }

      const maliciousPaths = [
        `/path/to/$(touch ${canaryFile})/workbench.html`,
        `/path/to/\`touch ${canaryFile}\`/workbench.html`,
        `/path/'test';touch ${canaryFile};/workbench.html`,
        `/path/"test";touch ${canaryFile};/workbench.html`,
        `/path/$USER/workbench.html`,
        `/path/\${USER}/workbench.html`,
        `/path/with spaces/and "double" quotes/workbench.html`,
        `/path/with\\backslashes\\and'quotes/workbench.html`,
        `/path/with;semicolons&ampersands|pipes>redirects<file.html`,
        `/path/with\nnewlines\tand\ttabs/workbench.html`
      ];

      for (const malPath of maliciousPaths) {
        const cmd = buildLinuxElevationCommand('/tmp/source.tmp', malPath);

        // Verify script is single-quoted
        assert.ok(
          cmd.startsWith("pkexec bash -c 'cp \"$1\" \"$2\" && chmod 644 \"$2\"' _ "),
          `Command for path "${malPath}" must retain positional template`
        );

        // Verify no raw unescaped single quote breaks out
        // Verify argsPart exactly matches the safely quoted positional parameters
        const argsPart = cmd.slice(cmd.indexOf('_') + 1).trim();
        const expectedArgs = `${quotePosixShell('/tmp/source.tmp')} ${quotePosixShell(malPath)}`;
        assert.strictEqual(
          argsPart,
          expectedArgs,
          `Arguments in command must exactly match quoted positional arguments: ${argsPart}`
        );

        // Verify canary was never created simply by building the command
        assert.strictEqual(fs.existsSync(canaryFile), false, 'Canary file must not be created during command generation');
      }

      console.log('  ✓ All malicious shell syntax patterns cleanly quoted without breakout');
    }

    // ----------------------------------------------------------------------
    // Test 4: Live Execution of Positional Bash Pattern on Linux
    // ----------------------------------------------------------------------
    console.log('\n[Test 4] Testing live execution of positional bash copying on Linux...');
    {
      const canaryName = 'live_canary.txt';
      const canaryFile = path.join(testTempDir, canaryName);
      if (fs.existsSync(canaryFile)) {
        fs.unlinkSync(canaryFile);
      }

      // Create actual source temp file
      const srcFile = path.join(testTempDir, 'real_source.tmp');
      const testContent = '<!-- AUTO-PLAN DOM BRIDGE TEST CONTENT -->';
      fs.writeFileSync(srcFile, testContent, 'utf8');

      // Create tricky target paths containing shell metacharacters
      const trickyTargetSubdir = path.join(testTempDir, "subdir_with spaces and 'quotes'");
      fs.mkdirSync(trickyTargetSubdir, { recursive: true });

      const trickyTargets = [
        path.join(testTempDir, 'target_$(whoami).html'),
        path.join(testTempDir, 'target_`whoami`.html'),
        path.join(testTempDir, 'target_$VAR_NOT_EXIST.html'),
        path.join(testTempDir, `target_$(touch ${canaryName}).html`),
        path.join(testTempDir, `target_'test';touch ${canaryName};'.html`),
        path.join(trickyTargetSubdir, `workbench_final's.html`)
      ];

      for (const target of trickyTargets) {
        // Build the command and execute the bash portion directly (simulating pkexec dispatch without root password)
        const fullCmd = buildLinuxElevationCommand(srcFile, target);
        // Replace 'pkexec bash -c' with 'bash -c' to test unprivileged execution locally
        const testCmd = fullCmd.replace(/^pkexec bash -c/, 'bash -c');

        // Execute the command in shell
        execSync(testCmd, { cwd: testTempDir, timeout: 5000 });

        // 1. Verify target was actually created
        assert.ok(fs.existsSync(target), `Target file must be created at literal path: ${target}`);

        // 2. Verify target has expected content
        assert.strictEqual(fs.readFileSync(target, 'utf8'), testContent, 'Target content must match source');

        // 3. Verify target has 0o644 permissions (read/write for owner, read for others)
        const stats = fs.statSync(target);
        assert.strictEqual(stats.mode & 0o777, 0o644, 'Target file permissions must be 0o644');

        // 4. Verify canary file was NEVER created (proving $(touch ...) was NOT evaluated)
        assert.strictEqual(
          fs.existsSync(canaryFile),
          false,
          `Injected command executed! Canary file was created: ${canaryFile}`
        );
      }

      console.log('  ✓ Live bash execution correctly copies files with shell metacharacters without evaluating commands');
    }

    // ----------------------------------------------------------------------
    // Test 5: Windows UAC Elevation Command Structure & Base64 UTF-16LE Encoding
    // ----------------------------------------------------------------------
    console.log('\n[Test 5] Verifying Windows UAC elevation command structure & Base64 UTF-16LE payload...');
    {
      const winTmp = 'C:\\Users\\Admin\\AppData\\Local\\Temp\\autoplan.tmp';
      const winTarget = 'C:\\Program Files\\Microsoft VS Code\\resources\\app\\out\\workbench.html';
      const cmd = buildWindowsElevationCommand(winTmp, winTarget);

      // Verify outer powershell command flags
      assert.ok(cmd.includes('powershell.exe'), 'Windows command must call powershell.exe');
      assert.ok(cmd.includes('-NoProfile'), 'Windows command must use -NoProfile');
      assert.ok(cmd.includes('-NonInteractive'), 'Windows command must use -NonInteractive');
      assert.ok(cmd.includes('-ExecutionPolicy Bypass'), 'Windows command must use -ExecutionPolicy Bypass');
      assert.ok(cmd.includes('Start-Process powershell -Verb runAs'), 'Windows command must use Start-Process with -Verb runAs');
      assert.ok(cmd.includes('-EncodedCommand'), 'Elevated process must receive -EncodedCommand');
      assert.ok(cmd.includes('-Wait'), 'Windows command must wait for child process');

      // Decode the Base64 UTF-16LE payload
      const decodedScript = decodeWindowsElevationScript(cmd);
      assert.ok(decodedScript !== null, 'Windows elevation script must be decodable');
      assert.ok(decodedScript.includes('Copy-Item'), 'Decoded script must use Copy-Item');
      assert.ok(decodedScript.includes('-LiteralPath'), 'Decoded script must use -LiteralPath for source');
      assert.ok(decodedScript.includes('-Destination'), 'Decoded script must specify -Destination');
      assert.ok(decodedScript.includes('-Force'), 'Decoded script must use -Force');
      assert.ok(decodedScript.includes(`'${winTmp}'`), 'Decoded script must single-quote source path');
      assert.ok(decodedScript.includes(`'${winTarget}'`), 'Decoded script must single-quote target path');

      // Verify null byte rejection on Windows command builder
      assert.throws(
        () => buildWindowsElevationCommand('C:\\src.tmp', 'C:\\dest\\\0evil.html'),
        /Path cannot contain null bytes/,
        'buildWindowsElevationCommand must reject null bytes'
      );

      console.log('  ✓ Windows elevation command uses Start-Process runAs with UTF-16LE Base64-encoded script');
    }

    // ----------------------------------------------------------------------
    // Test 6: Windows Elevation Immunity with Tricky & Malicious Paths
    // ----------------------------------------------------------------------
    console.log('\n[Test 6] Verifying Windows elevation handling of tricky paths (spaces, quotes, $, brackets)...');
    {
      const trickyWindowsCases = [
        {
          name: 'Spaces in directory and file names',
          tmp: 'C:\\Users\\John Doe\\AppData\\Local\\Temp\\autoplan 123.tmp',
          target: 'C:\\Program Files\\Antigravity IDE\\resources\\app\\workbench.html',
          expectedTmpInScript: "'C:\\Users\\John Doe\\AppData\\Local\\Temp\\autoplan 123.tmp'",
          expectedTargetInScript: "'C:\\Program Files\\Antigravity IDE\\resources\\app\\workbench.html'"
        },
        {
          name: 'Single quotes in paths (must be escaped as double single-quotes)',
          tmp: "C:\\Users\\O'Connor\\Temp\\file.tmp",
          target: "C:\\Program Files\\John's Code\\workbench.html",
          expectedTmpInScript: "'C:\\Users\\O''Connor\\Temp\\file.tmp'",
          expectedTargetInScript: "'C:\\Program Files\\John''s Code\\workbench.html'"
        },
        {
          name: 'PowerShell variables and environment variables',
          tmp: 'C:\\Temp\\$env_USER\\file.tmp',
          target: 'C:\\App\\$app_data\\workbench.html',
          expectedTmpInScript: "'C:\\Temp\\$env_USER\\file.tmp'",
          expectedTargetInScript: "'C:\\App\\$app_data\\workbench.html'"
        },
        {
          name: 'PowerShell subexpression command injection attempt',
          tmp: 'C:\\Temp\\$(calc.exe)\\file.tmp',
          target: 'C:\\App\\$(Get-Process)\\workbench.html',
          expectedTmpInScript: "'C:\\Temp\\$(calc.exe)\\file.tmp'",
          expectedTargetInScript: "'C:\\App\\$(Get-Process)\\workbench.html'"
        },
        {
          name: 'Square brackets (wildcard prevention via -LiteralPath)',
          tmp: 'C:\\Temp\\[test_v1]\\file.tmp',
          target: 'C:\\App\\[release_2.0]\\workbench.html',
          expectedTmpInScript: "'C:\\Temp\\[test_v1]\\file.tmp'",
          expectedTargetInScript: "'C:\\App\\[release_2.0]\\workbench.html'"
        },
        {
          name: 'Backticks and escape characters',
          tmp: 'C:\\Temp\\`n`r`t\\file.tmp',
          target: 'C:\\App\\`a`b\\workbench.html',
          expectedTmpInScript: "'C:\\Temp\\`n`r`t\\file.tmp'",
          expectedTargetInScript: "'C:\\App\\`a`b\\workbench.html'"
        },
        {
          name: 'Double quotes and semicolons',
          tmp: 'C:\\Temp\\"quoted";Remove-Item C:\\;\\file.tmp',
          target: 'C:\\App\\"safe";Start-Process calc;\\workbench.html',
          expectedTmpInScript: "'C:\\Temp\\\"quoted\";Remove-Item C:\\;\\file.tmp'",
          expectedTargetInScript: "'C:\\App\\\"safe\";Start-Process calc;\\workbench.html'"
        }
      ];

      for (const testCase of trickyWindowsCases) {
        const cmd = buildWindowsElevationCommand(testCase.tmp, testCase.target);

        // Verify the outer command contains no raw unescaped path fragments
        // The outer command contains only Base64 alphanumeric characters for the payload
        const match = cmd.match(/-EncodedCommand\s+([A-Za-z0-9+/=]+)/);
        assert.ok(match, `Encoded command payload missing for case "${testCase.name}"`);

        // Decode script
        const decoded = decodeWindowsElevationScript(cmd);
        assert.ok(decoded !== null, `Failed decoding script for case "${testCase.name}"`);

        // Check literal presence of -LiteralPath and -Destination with properly escaped single quotes
        assert.ok(
          decoded.includes(`-LiteralPath ${testCase.expectedTmpInScript}`),
          `LiteralPath mismatch for case "${testCase.name}":\nDecoded: ${decoded}\nExpected: ${testCase.expectedTmpInScript}`
        );
        assert.ok(
          decoded.includes(`-Destination ${testCase.expectedTargetInScript}`),
          `Destination mismatch for case "${testCase.name}":\nDecoded: ${decoded}\nExpected: ${testCase.expectedTargetInScript}`
        );

        // Verify that PowerShell command substitutions $() are strictly inside single quotes
        // and cannot expand
        assert.ok(
          decoded.startsWith('Copy-Item -LiteralPath \''),
          `Script must strictly start with Copy-Item -LiteralPath ' for case "${testCase.name}"`
        );
      }

      console.log('  ✓ Windows elevation properly escapes single quotes, binds -LiteralPath, and prevents variable expansion');
    }

    // ----------------------------------------------------------------------
    // Test 7: writeFileElevated & writeFileElevatedAsync Validation & Locking
    // ----------------------------------------------------------------------
    console.log('\n[Test 7] Verifying writeFileElevated & async wrappers error handling & mutex locking...');
    {
      const normalFile = path.join(testTempDir, 'normal_write.txt');
      const testData = 'Direct write test';

      // 1. Direct write works without elevation when file is writable
      writeFileElevated(normalFile, testData);
      assert.strictEqual(fs.readFileSync(normalFile, 'utf8'), testData);

      // 2. Direct async write works
      const asyncFile = path.join(testTempDir, 'async_write.txt');
      await writeFileElevatedAsync(asyncFile, testData);
      assert.strictEqual(fs.readFileSync(asyncFile, 'utf8'), testData);

      // 3. Null bytes are rejected synchronously
      assert.throws(
        () => writeFileElevated(path.join(testTempDir, 'bad\0file.txt'), 'content'),
        /File path cannot contain null bytes/,
        'writeFileElevated must reject null bytes'
      );

      // 4. Null bytes are rejected asynchronously
      await assert.rejects(
        async () => {
          await writeFileElevatedAsync(path.join(testTempDir, 'bad\0async.txt'), 'content');
        },
        /File path cannot contain null bytes/,
        'writeFileElevatedAsync must reject null bytes'
      );

      // 5. Elevation lock mutex prevents concurrent elevation requests
      setIsElevationInProgress(true);
      try {
        // Attempting write with mock EACCES while locked
        const unwriteablePath = '/root/forbidden-test-autoplan.html';
        assert.throws(
          () => writeFileElevated(unwriteablePath, 'content'),
          (err: any) => err instanceof ElevationLockedError,
          'writeFileElevated must throw ElevationLockedError when elevation is in progress'
        );

        await assert.rejects(
          async () => {
            await writeFileElevatedAsync(unwriteablePath, 'content');
          },
          (err: any) => err instanceof ElevationLockedError,
          'writeFileElevatedAsync must throw ElevationLockedError when elevation is in progress'
        );
      } finally {
        setIsElevationInProgress(false);
      }

      assert.strictEqual(getIsElevationInProgress(), false, 'Elevation mutex flag must be false after completion');
      console.log('  ✓ File write wrappers enforce path safety, permission checks, and elevation mutex locks');
    }

    // ----------------------------------------------------------------------
    // Test 8: End-to-End Cross-Platform Matrix Regression Verification
    // ----------------------------------------------------------------------
    console.log('\n[Test 8] Verifying backward-compatible cross-platform contract...');
    {
      const linuxCmd = buildLinuxElevationCommand('/tmp/a.tmp', '/usr/share/code/workbench.html');
      assert.ok(linuxCmd.includes('pkexec'), 'Must retain pkexec');
      assert.ok(linuxCmd.includes('/tmp/a.tmp'), 'Must retain source path');
      assert.ok(linuxCmd.includes('/usr/share/code/workbench.html'), 'Must retain destination path');

      const winCmd = buildWindowsElevationCommand('C:\\a.tmp', 'C:\\Program Files\\VSCode\\workbench.html');
      assert.ok(winCmd.includes('powershell'), 'Must retain powershell');
      assert.ok(winCmd.includes('runAs'), 'Must retain runAs');

      console.log('  ✓ Elevation command contracts fulfill cross-platform compatibility expectations');
    }

    console.log('\n======================================================================');
    console.log('🎉 ALL PHASE 03 ELEVATION COMMAND SAFETY TESTS PASSED! (100% SUCCESS)');
    console.log('======================================================================\n');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }
}

// Run test suite
runPhase03ElevationCommandSafetyTests().catch((err) => {
  console.error('\n❌ Phase 03 Test Suite Failed:', err);
  process.exit(1);
});
