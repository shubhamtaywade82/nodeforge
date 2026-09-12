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
      "Run ESLint with --fix, then show remaining diagnostics and suggest manual fixes for issues that couldn't be auto-fixed.",
    arguments: [],
    message: `Run the following NodeForge tools in sequence to fix lint errors in this workspace:

1. Call the "applyEslintFix" tool to auto-fix what can be fixed automatically.
2. Call the "getDiagnostics" tool to see what diagnostics remain.
3. For each remaining ESLint diagnostic, analyze the issue and suggest a manual fix. Consider the rule name, the code context, and the severity.
4. Present a summary: how many issues were auto-fixed, how many remain, and your recommended manual fixes for each remaining issue.`
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
   - If typecheck failed: call "runTypeCheck" to get the specific errors, then fix each one.
   - If lint failed: call "applyEslintFix" to auto-fix, then "getDiagnostics" to see remaining issues.
   - If tests failed: call "getTestResults" to see which tests failed and why, then fix the code or the test.
   - If audit found vulnerabilities: recommend upgrades (but don't fail the overall validation).
3. After making fixes, call "validateWorkspace" again to confirm the workspace is now healthy.
4. Present a summary of what was fixed and the final validation status.`
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
      "Analyze a source file and generate a test file for it using the detected test runner (Vitest or Jest).",
    arguments: [
      {
        name: "filePath",
        description: "The path to the source file to generate tests for.",
        required: true
      }
    ],
    message: `Generate tests for the file at {{filePath}}.

1. Call "getProjectContext" to determine which test runner (Vitest or Jest) and assertion library this project uses.
2. Read the source file to understand its exports, functions, and behavior.
3. Look at existing test files in the project to match the testing style and conventions.
4. Generate a test file that covers:
   - Happy path for each exported function
   - Edge cases (empty inputs, null, undefined, boundary values)
   - Error cases (invalid inputs that should throw)
5. Present the generated test file and explain the test cases. Note: do NOT write the file to disk — just present it for the user to review and save.`
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
   - Show the relevant code snippet (file + line)
   - Suggest a specific fix, considering the rule name and context
3. Group diagnostics by file and present them in a clear, actionable format.
4. If there are auto-fixable issues, mention that the "applyEslintFix" tool can fix them automatically.`
  }
];

export function findPromptByName(name: string): McpPrompt | undefined {
  return PROMPTS.find((p) => p.name === name);
}
