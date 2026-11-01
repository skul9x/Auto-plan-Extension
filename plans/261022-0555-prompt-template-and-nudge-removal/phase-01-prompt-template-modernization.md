# Phase 01: Prompt Template Modernization & Schema Defaults

Status: ✅ Completed
Test: `src/test/phase01_prompt_template_modernization.test.ts`

## Objective
Update the core default phase prompt template and extension schema defaults across the codebase so that newly generated phase prompts adhere strictly to the 5-step research, architecture inspection, single-test verification, and token-saving completion protocol specified in `newprompt.txt`.

## Scope
- Configuration constants and default object representations in `src/config.ts`.
- Extension contribution manifests in `package.json` for default prompt template properties.
- Dynamic prompt placeholder and fallback bindings in settings UI initialization.
- Backward compatibility for existing custom templates while ensuring fresh setups receive the modernized default prompt.

## Requirements
1. **Core Configuration Synchronization**:
   - Update `DEFAULT_PROMPT_TEMPLATE` in `src/config.ts` to match the exact content of `newprompt.txt`.
   - Ensure `DEFAULT_CONFIG.promptTemplate` and `DEFAULT_CONFIG.defaultPromptTemplate` reference the modernized `DEFAULT_PROMPT_TEMPLATE`.
   - Preserve dynamic template variables (`{xxx}`, `{path}`, `{file}`) for phase file path interpolation.
2. **VS Code Manifest Defaults**:
   - Update `autoplan.defaultPromptTemplate` and `autoplan.promptTemplate` in `package.json` to have their default string values match the updated template.
   - Ensure newline characters and quote escapes in JSON format maintain syntactic validity.
3. **Settings Dashboard Integration**:
   - Ensure the Settings Webview (`media/settings/` and `src/settingsProvider.ts`) reflects the updated default template whenever configuration values are retrieved, reset, or previewed.
4. **Keyword Alignment**:
   - Confirm that the completion keyword `Done skul9x.` continues to align seamlessly with `DEFAULT_COMPLETION_KEYWORD`.

## Constraints
- Do not hardcode absolute file paths into the prompt template; retain `{xxx}` for dynamic replacement during phase dispatch.
- Preserve the exact wording, numbered sequence (steps 1 through 5), and completion message from `newprompt.txt`.
- Do not alter or break unrelated configuration settings.

## Dependencies
- Source reference: `newprompt.txt`.
- Target files: `src/config.ts`, `package.json`, `media/settings/settings.html`, `media/settings/settings.js`.

## Acceptance Criteria
- `DEFAULT_PROMPT_TEMPLATE` in `src/config.ts` matches the text in `newprompt.txt`.
- `package.json` properties `autoplan.defaultPromptTemplate` and `autoplan.promptTemplate` have defaults matching `DEFAULT_PROMPT_TEMPLATE`.
- Dynamic placeholder replacement (`{xxx}`, `{path}`, `{file}`) correctly resolves a sample phase path into the full multi-step prompt string without truncation or formatting distortion.
- Webview settings provider returns the updated template as fallback when configuration is unpopulated.

## Comprehensive File-Based Test
- **File**: `src/test/phase01_prompt_template_modernization.test.ts`
- **Scope**:
  - Validates `DEFAULT_PROMPT_TEMPLATE` against `newprompt.txt` contents.
  - Validates `package.json` configuration defaults for `autoplan.defaultPromptTemplate` and `autoplan.promptTemplate`.
  - Validates prompt interpolation logic (`interpolatePromptTemplate`) using `{xxx}`, `{path}`, and `{file}` placeholders with the new multi-step prompt.
  - Validates SettingsProvider initial state and IPC payload for prompt template defaults.
