# Phase 03: Elevated Shell Command Injection Hardening

Status: ✅ Completed
Dependencies: phase-02-bridge-server-auth-and-cors.md

## Objective
Harden privileged write operations (`pkexec` on Linux and `PowerShell Start-Process -Verb runAs` on Windows) against command injection and shell variable expansion. Ensure file paths with special characters, spaces, dollar signs (`$`), command substitutions (`$()`), and backticks (`` ` ``) cannot alter the executed command or trigger unintended root actions.

## Requirements
### Functional
- [x] Refactor `buildLinuxElevationCommand` in `src/workbenchInjector.ts`:
  - Eliminate string interpolation inside double quotes (`"..."`).
  - Use single-quoted shell script with positional arguments (`$1`, `$2`):
    ```sh
    pkexec bash -c 'cp "$1" "$2" && chmod 644 "$2"' _ "$tmpPath" "$targetPath"
    ```
  - Ensure path arguments with characters like `$`, `\`, `'`, `"`, `` ` `` are passed cleanly without expansion by the root shell.
- [x] Refactor `buildWindowsElevationCommand` in `src/workbenchInjector.ts`:
  - Prevent PowerShell script block variable expansion by using Base64-encoded command arguments or strict `-LiteralPath` parameter binding.
- [x] Update `writeFileElevated` and `writeFileElevatedAsync` to pass arguments safely.

### Non-Functional
- [x] Security: Absolute immunity against command injection and variable expansion when writing workbench files with root/admin privileges.
- [x] Cross-Platform: Works consistently across Debian/Ubuntu, Linux Mint, Fedora, Arch, and Windows 10/11.

## Files to Create/Modify
- `src/workbenchInjector.ts` - Refactor `buildLinuxElevationCommand`, `buildWindowsElevationCommand`, and execution wrappers.
- `src/test/phase03_elevation_command_safety.test.ts` - Comprehensive file-based test for Phase 03.

## Test Criteria
- Exactly one file-based test: `src/test/phase03_elevation_command_safety.test.ts`.
- [x] Verifies `buildLinuxElevationCommand` generates command with positional parameters without expanding `$()` or backticks.
- [x] Tests paths containing malicious shell syntax (`/path/to/$(whoami)/workbench.html`, `/path/'test';rm -rf;/file`) to ensure no command execution or syntax corruption.
- [x] Verifies Windows elevation command construction handles tricky paths containing spaces, single quotes, and dollar signs.

---
Next Phase: phase-04-config-hot-reload-and-disposal.md
