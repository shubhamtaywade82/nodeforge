/**
 * MCP prompts — pre-built engineering workflows that agents can invoke.
 *
 * Each prompt is a template message with optional {{argument}} placeholders
 * that get substituted when the prompt is retrieved via prompts/get.
 *
 * The prompts guide the agent through common Node.js/TypeScript engineering
 * tasks, leveraging NodeForge's tools to gather context and take action.
 */

export interface McpPrompt {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required: boolean;
  }>;
  message: string;
}

export const PROMPTS: McpPrompt[] = [
  {
    name: "fix-lint-errors",
    description:
      "Run ESLint with --fix, then fix the remaining diagnostics by hand (reading the code and applying small exact-match patches).",
    arguments: [],
    message: `Run the following NodeForge tools in sequence to fix lint errors in this workspace:

1. Call the "applyEslintFix" tool to auto-fix what can be fixed automatically.
2. Call the "getDiagnostics" tool to see what diagnostics remain.
3. For each remaining ESLint diagnostic, call "readFile" on the reported file and a line range around it, analyze the issue (rule name, code context, severity), and fix it with "applyPatch" using the smallest exact-match edit. If "applyPatch" returns ok=false, re-read the file and retry. Never claim a file was changed unless "applyPatch" returned ok=true.
4. Call "getDiagnostics" again to confirm the result.
5. Present a summary: how many issues were auto-fixed, how many you fixed by hand, and any that remain with the reason.`
  },
  {
    name: "audit-and-upgrade-deps",
    description:
      "Run a full dependency audit: check for vulnerabilities, outdated packages, and unused dependencies. Recommend an upgrade plan.",
    arguments: [],
    message: `Run the following NodeForge tools in sequence to audit this workspace's dependencies:

1. Call the "getDependencyReport" tool to check for known vulnerabilities and outdated packages.
2. Call the "getDependencyGraph" tool to find unused dependencies (declared but never imported).
3. Analyze the results:
   - For each vulnerability: recommend whether to upgrade, patch, or replace the package. Consider severity and whether a fix is available.
   - For each outdated package: recommend whether to upgrade based on the version diff (patch/minor/major).
   - For each unused dependency: recommend removal, but note any that are likely false positives (CLI tools, config plugins, @types/*).
4. Present an upgrade plan in priority order: critical vulnerabilities first, then high, then moderate, then unused deps cleanup.`
  },
  {
    name: "validate-and-fix",
    description:
      "Run a full workspace validation (typecheck + lint + tests + audit), identify failures, and fix them one by one.",
    arguments: [],
    message: `Run the following NodeForge workflow to validate and fix this workspace:

1. Call the "validateWorkspace" tool to run typecheck + lint + tests + audit in one pass.
2. Analyze the result:
   - If typecheck failed: call "runTypeCheck" to get the specific errors. For each one, call "readFile" on the reported file and line range, then fix it with "applyPatch" (copy "oldText" exactly from the file; make the smallest change).
   - If lint failed: call "applyEslintFix" to auto-fix, then "getDiagnostics" to see remaining issues, and fix those with "readFile" + "applyPatch".
   - If tests failed: call "getTestResults" to see which tests failed and why, use "searchCode" and "readFile" to find the code under test, then fix the code or the test with "applyPatch".
   - If audit found vulnerabilities: recommend upgrades (but don't fail the overall validation).
3. If "applyPatch" returns ok=false, read the message, re-read the file, and retry with corrected text. Never claim a file was changed unless "applyPatch" returned ok=true.
4. After making fixes, call "validateWorkspace" again to confirm the workspace is now healthy.
5. Present a summary of what was fixed and the final validation status.`
  },
  {
    name: "onboard-to-project",
    description:
      "Get a comprehensive overview of this project: what it uses, how it's structured, and how to get started.",
    arguments: [],
    message: `Run the following NodeForge tools to build a comprehensive onboarding guide for this project:

1. Call "getProjectContext" to understand the project shape (runtime, package manager, linter, formatter, test runner, ORM, Docker, CI).
2. Call "getGitState" to see the current branch and whether there are uncommitted changes.
3. Call "getDockerConfig" if Docker is present, to understand the container setup.
4. Call "getDatabaseSchema" if an ORM is present, to understand the data model.
5. Call "getGitHubWorkflows" if CI is present, to understand the build/test/deploy pipeline.

Then present a structured onboarding document covering:
- **Tech Stack**: runtime, language, package manager, and key tools.
- **Getting Started**: how to install deps, run the dev server, run tests.
- **Architecture**: what the project does, how it's organized, and key patterns.
- **CI/CD**: how the project is built, tested, and deployed.
- **Database**: what ORM is used and the schema overview (if applicable).
- **Docker**: how the project is containerized (if applicable).`
  },
  {
    name: "add-test-for",
    description:
      "Analyze a source file and generate a test file for it using the detected test runner (Vitest, Jest, or Node test runner).",
    arguments: [
      {
        name: "filePath",
        description: "The path to the source file to generate tests for.",
        required: true
      }
    ],
    message: `Generate tests for the file at {{filePath}}.

1. Call "getProjectContext" to determine which test runner (Vitest, Jest, or Node test runner) and assertion library this project uses.
2. Call "readFile" with the path {{filePath}} to understand its exports, functions, and behavior.
3. Call "searchCode" (for example for the module name or its exports) to find existing tests, then "readFile" one or two of them to match the testing style and conventions.
4. Design a test file that covers:
   - Happy path for each exported function
   - Edge cases (empty inputs, null, undefined, boundary values)
   - Error cases (invalid inputs that should throw)
5. Create the test file with "applyPatch" using an edit whose "oldText" is "" and whose "path" is the new test file path next to the project's existing tests. If the file already exists, extend it with exact-match edits instead. Writing requires the user's approval.
6. Call "getTestResults" to run the tests, and fix failures with "readFile" + "applyPatch". Report the final result accurately.`
  },
  {
    name: "explain-errors",
    description:
      "Run typecheck + lint and explain every diagnostic in plain English, with suggested fixes for each.",
    arguments: [],
    message: `Run the following NodeForge tools to explain all errors in this workspace:

1. Call "getDiagnostics" to get all TypeScript + ESLint/Biome findings.
2. For each diagnostic:
   - Identify the source (TypeScript, ESLint, Biome)
   - Explain what the error means in plain English
   - Show the relevant code snippet (use "readFile" with the file and a line range around the diagnostic)
   - Suggest a specific fix, considering the rule name and context
3. Group diagnostics by file and present them in a clear, actionable format.
4. If there are auto-fixable issues, mention that the "applyEslintFix" tool can fix them automatically.`
  }
];

export function findPromptByName(name: string): McpPrompt | undefined {
  return PROMPTS.find((p) => p.name === name);
}
