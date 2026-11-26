# Phase 4: Default Structured JSON Prompt Template

**Status:** Completed ✅

## 1. Objective
Update the extension's default prompt template (`DEFAULT_PROMPT_TEMPLATE`, `autoplan.defaultPromptTemplate`, and `autoplan.promptTemplate`) to the structured 7-step JSON workflow specification containing `{xxx}` and `Done skul9x.`, ensuring clean template interpolation, config loading, and Settings UI compatibility.

---

## 2. Scope
- **Default Prompt Configuration** (`src/config.ts`: `DEFAULT_PROMPT_TEMPLATE`, `DEFAULT_CONFIG`)
- **Extension Manifest Defaults** (`package.json`: `contributes.configuration.properties['autoplan.defaultPromptTemplate'].default`, `contributes.configuration.properties['autoplan.promptTemplate'].default`, and `"test:phase04-default-prompt"` script registration)

---

## 3. Requirements
1. **Exact Default Prompt Template (`src/config.ts` & `package.json`):**
   - Set `DEFAULT_PROMPT_TEMPLATE` in `src/config.ts` and the `"default"` values of `autoplan.defaultPromptTemplate` and `autoplan.promptTemplate` in `package.json` to the exact JSON specification below:

```json
{
  "steps": [
    {
      "id": 0,
      "name": "Project Recap",
      "workflow": "/recap",
      "instructions": "Call the workflow /recap first to review and understand the existing project context, previous work, current progress, architectural decisions, and relevant project knowledge before proceeding to the next step."
    },
    {
      "id": 1,
      "name": "Initial Codebase Analysis",
      "instructions": "First, read the provided phase file and inspect the relevant source files, architecture, dependencies, APIs, framework and library versions, and project conventions. Understand the current implementation and identify the specific technical challenges and implementation decisions that need to be resolved. Spend at least 1 minute on this initial codebase analysis before starting online research."
    },
    {
      "id": 2,
      "name": "Online Research and Best Practices",
      "instructions": "After at least 30 seconds has elapsed, search online for concrete implementation techniques and coding best practices relevant to the technical tasks identified during inspection. Focus specifically on HOW to implement the required functionality using the project's actual technology stack, framework, library versions, and architecture—not on general domain or business knowledge.\n\nResearch official documentation, recommended APIs and usage patterns, practical implementation examples, established design patterns, alternative solutions, and proven approaches to error handling, concurrency, security, performance, compatibility, and maintainability where relevant. Prioritize official documentation and authoritative technical sources. Compare viable approaches when appropriate, verify compatibility with the existing project, and determine the most suitable approach. Do not settle for generic advice when concrete technical guidance is available. Apply the research findings to implementation decisions. Do not begin coding until this research is complete. Never fabricate searches, sources, or verification."
    },
    {
      "id": 3,
      "name": "Implementation",
      "instructions": "Use the research findings together with the existing codebase to determine the most appropriate implementation approach. Do not blindly copy online examples. Adapt proven techniques to the project's architecture, conventions, dependencies, versions, and constraints. Implement only what is necessary to achieve the objectives in the phase file. Do not add unrelated features, perform unnecessary refactoring, or change behavior outside the phase scope."
    },
    {
      "id": 4,
      "name": "Comprehensive Testing",
      "instructions": "After implementation, run exactly ONE comprehensive file-based test defined by this phase. It must verify the core functionality of the entire phase as thoroughly as reasonably possible, including important success paths, failure conditions, and relevant edge cases. Do not create or run additional test files, test scripts, temporary test files, standalone validation programs, or other test suites. If the test fails, investigate and fix the implementation, then rerun only the same test file until it passes or a genuine blocker remains. Never claim successful verification without actually executing the test."
    },
    {
      "id": 5,
      "name": "Phase Completion",
      "instructions": "Only after implementation is complete and the required test passes, mark the corresponding phase as completed in the phase plan file. If a genuine blocker prevents successful verification, report it honestly and do not mark the phase as completed. Do not make unrelated changes to the phase plan."
    },
    {
      "id": 6,
      "name": "Save Project Knowledge",
      "workflow": "/save_brain",
      "instructions": "After implementation, testing, and phase completion have been successfully finished, call the workflow /save_brain to save and update the project's knowledge, implementation details, architectural decisions, completed work, and relevant technical findings for future sessions. This workflow must be called before the final response. Wait for the workflow to finish successfully before proceeding to the final response."
    }
  ],
  "phase_file": "{xxx}",
  "phase_file_role": "Treat this file as the source of truth for WHAT to accomplish, while determining HOW based on the existing codebase and current implementation best practices.",
  "execution_order": "Execute all steps sequentially in the specified order. Do not skip or reorder steps.",
  "final_response_policy": {
    "type": "STRICT_EXACT_OUTPUT",
    "condition": "All steps from 0 through 6 must have been successfully completed, including successful execution of the /recap and /save_brain workflows.",
    "required_output": "Done skul9x.",
    "exact_match": true,
    "instructions": [
      "The final response MUST consist of exactly the following text: Done skul9x.",
      "Do not include any other text, characters, punctuation, Markdown formatting, code blocks, headings, explanations, summaries, progress reports, test results, or implementation details.",
      "Do not add greetings, acknowledgments, apologies, or closing remarks.",
      "Do not mention that the task has been completed beyond the exact required output.",
      "Do not output the final response until every required step and workflow has finished successfully.",
      "Treat this output restriction as a global, highest-priority instruction governing the entire final response.",
      "Do not allow default assistant behavior to override this restriction."
    ]
  },
  "failure_handling": {
    "condition": "A genuine blocker prevents completion of any mandatory step or workflow.",
    "instructions": [
      "Never pretend that an incomplete step was completed.",
      "Never claim that testing passed unless the test was actually executed and passed.",
      "Never mark the phase as completed if mandatory verification has failed.",
      "Do not output 'Done skul9x.' when the completion conditions have not been satisfied.",
      "Report the genuine blocker concisely and accurately instead of using the success response."
    ]
  },
  "completion_response": "Done skul9x."
}
```

2. **Valid JSON & Placeholder Interpolation:**
   - Ensure `DEFAULT_PROMPT_TEMPLATE` is valid JSON (`JSON.parse(DEFAULT_PROMPT_TEMPLATE)` succeeds cleanly).
   - Ensure `interpolatePromptTemplate(DEFAULT_PROMPT_TEMPLATE, samplePhasePath)` (and `renderPromptTemplate`) substitutes `{xxx}` with the phase file path while keeping the rendered output valid JSON (escaping backslashes if Windows path or preserving POSIX paths cleanly).
   - Verify `DEFAULT_CONFIG.promptText`, `DEFAULT_CONFIG.promptTemplate`, and `DEFAULT_CONFIG.defaultPromptTemplate` all reference `DEFAULT_PROMPT_TEMPLATE`.

---

## 4. How to Implement
1. **Update `src/config.ts`:**
   - Replace `DEFAULT_PROMPT_TEMPLATE` string literal with the exact JSON prompt template above. Note: inside a JS/TS template literal (backticks `` ` ``), escape `\n` inside JSON string values as `\\n` so the runtime string contains literal `\n` (valid JSON escape sequences)!
   - Verify `JSON.parse(DEFAULT_PROMPT_TEMPLATE)` succeeds without syntax errors.
2. **Update `package.json`:**
   - Update `contributes.configuration.properties['autoplan.defaultPromptTemplate'].default` and `contributes.configuration.properties['autoplan.promptTemplate'].default` to match `DEFAULT_PROMPT_TEMPLATE` character-for-character.
   - Add `"test:phase04-default-prompt": "node out/test/phase04_default_json_prompt_template.test.js"` under `"scripts"`.

---

## 5. Files to Create/Modify
- **Modify:**
  - `src/config.ts`
  - `package.json`
- **Create (Test only):**
  - `src/test/phase04_default_json_prompt_template.test.ts`

---

## 6. Dependencies
- **Phases 1 & 2:** Long JSON prompt (>4KB) triggers Antigravity IDE transcript truncation (`"truncated_fields": ["content"]`), which is now safely handled by Phase 1 & Phase 2 ownership verification.

---

## 7. Constraints
- Keep `DEFAULT_PROMPT_TEMPLATE` valid JSON when parsed with `JSON.parse`.
- Do NOT alter `DEFAULT_COMPLETION_KEYWORD` (`'Done skul9x.'`) or other unrelated settings in `src/config.ts` / `package.json`.
- Note that `src/test/phase01_prompt_template_modernization.test.ts` is excluded in `tsconfig.json`; do not modify unrelated legacy tests.

---

## 8. Acceptance Criteria
1. `DEFAULT_PROMPT_TEMPLATE` in `src/config.ts` parses cleanly with `JSON.parse`, contains steps `0` through `6` (including `/recap` and `/save_brain`), `"phase_file": "{xxx}"`, and `"completion_response": "Done skul9x."`.
2. `package.json` `autoplan.defaultPromptTemplate.default` and `autoplan.promptTemplate.default` match `DEFAULT_PROMPT_TEMPLATE` identically.
3. `getConfig()` returns the new `DEFAULT_PROMPT_TEMPLATE` when no user override is configured, and `interpolatePromptTemplate(DEFAULT_PROMPT_TEMPLATE, '/path/to/phase-01.md')` replaces `{xxx}` cleanly.

---

## 9. Comprehensive File-Based Test
- **Test File:** `src/test/phase04_default_json_prompt_template.test.ts`
- **Framework:** Standalone Node TypeScript (`assert` + mock `vscode`) compiled via `npm run compile` and executed via `node out/test/phase04_default_json_prompt_template.test.js`
- **Test Scenarios Covered in One File:**
  1. **JSON Validity & Structure Check:** Parses `DEFAULT_PROMPT_TEMPLATE` with `JSON.parse`, verifies `steps.length === 7` (`id` 0..6, `/recap` at step 0, `/save_brain` at step 6), `phase_file === '{xxx}'`, `final_response_policy.required_output === 'Done skul9x.'`, and `completion_response === 'Done skul9x.'`.
  2. **Config & Manifest Synchronization:** Verifies `DEFAULT_CONFIG.promptTemplate`, `DEFAULT_CONFIG.defaultPromptTemplate`, `DEFAULT_CONFIG.promptText`, and `package.json` `autoplan.defaultPromptTemplate.default` / `autoplan.promptTemplate.default` all match `DEFAULT_PROMPT_TEMPLATE` identically.
  3. **Placeholder Interpolation & `getConfig()` Fallback:** Verifies `interpolatePromptTemplate` / `renderPromptTemplate` replaces `{xxx}` with a sample phase path producing valid JSON, and `getConfig()` falls back to the new `DEFAULT_PROMPT_TEMPLATE`.
