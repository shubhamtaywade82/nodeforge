/**
 * Pure routing logic for the `@nodeforge` chat participant.
 *
 * No `vscode` import: everything here is unit-testable. The VS Code wiring
 * lives in `NodeForgeChatParticipant.ts`.
 */

export const NODEFORGE_TOOL_PREFIX = "nodeforge_";

/** Tools that only read workspace files and are safe in Restricted Mode. */
export const RESTRICTED_MODE_TOOLS: ReadonlySet<string> = new Set([
  "nodeforge_get_project_context",
  "nodeforge_read_file",
  "nodeforge_search_code"
]);

export interface ParticipantCommand {
  readonly name: string;
  readonly description: string;
  readonly toolNames: readonly string[];
  readonly instruction: string;
}

export const PARTICIPANT_COMMANDS: readonly ParticipantCommand[] = [
  {
    name: "context",
    description: "Describe the detected Node.js/TypeScript stack",
    toolNames: ["nodeforge_get_project_context"],
    instruction: "Summarize the detected stack and call out anything unusual or missing."
  },
  {
    name: "diagnostics",
    description: "Run compiler and lint checks and explain the findings",
    toolNames: [
      "nodeforge_get_diagnostics",
      "nodeforge_run_typecheck",
      "nodeforge_run_linter",
      "nodeforge_read_file",
      "nodeforge_search_code"
    ],
    instruction:
      "Collect diagnostics, group them by root cause, and propose the smallest fix for each group. Do not edit files unless asked."
  },
  {
    name: "tests",
    description: "Run the test suite and analyze failures",
    toolNames: ["nodeforge_get_tests", "nodeforge_read_file", "nodeforge_search_code"],
    instruction: "Run the tests and explain each failure with the most likely cause and a concrete fix. Read the failing code before diagnosing; do not edit files unless asked."
  },
  {
    name: "deps",
    description: "Audit dependencies and the import graph",
    toolNames: ["nodeforge_get_dependency_report", "nodeforge_get_dependency_graph"],
    instruction:
      "Report vulnerable or outdated packages, then unused, missing, and circular dependencies. Rank by risk."
  },
  {
    name: "db",
    description: "Inspect the database schema",
    toolNames: ["nodeforge_get_database_schema"],
    instruction: "Describe the schema, relations, and any modelling risks."
  },
  {
    name: "git",
    description: "Review the current Git changes",
    toolNames: ["nodeforge_get_git_diff", "nodeforge_read_file", "nodeforge_search_code"],
    instruction: "Review the diff for correctness, regressions, and missing tests."
  },
  {
    name: "fix",
    description: "Diagnose and fix problems with small, verified edits",
    toolNames: [
      "nodeforge_get_diagnostics",
      "nodeforge_run_typecheck",
      "nodeforge_run_linter",
      "nodeforge_get_tests",
      "nodeforge_get_git_diff",
      "nodeforge_read_file",
      "nodeforge_search_code",
      "nodeforge_apply_patch",
      "nodeforge_validate_workspace"
    ],
    instruction:
      "Reproduce the problem with the diagnostic or test tools, read the relevant source, then fix it with the smallest exact-match patch. Copy oldText exactly from a fresh read. After patching, re-run the narrowest check and report the real result. A patch that returns ok=false changed nothing."
  },
  {
    name: "addtests",
    description: "Add tests for a file or behavior and verify them",
    toolNames: [
      "nodeforge_get_project_context",
      "nodeforge_read_file",
      "nodeforge_search_code",
      "nodeforge_apply_patch",
      "nodeforge_get_tests"
    ],
    instruction:
      "Detect the test runner, read the code under test and one or two existing tests to match conventions, then create or extend a test file with apply_patch (an empty oldText creates a new file). Run the tests and fix failures. Report only what actually ran."
  },
  {
    name: "validate",
    description: "Run the full validation pipeline (typecheck, lint, tests)",
    toolNames: [
      "nodeforge_validate_workspace",
      "nodeforge_run_typecheck",
      "nodeforge_run_linter",
      "nodeforge_get_tests"
    ],
    instruction: "Validate the workspace and report a pass/fail verdict with the blocking issues first."
  }
];

export function findParticipantCommand(name: string | undefined): ParticipantCommand | undefined {
  if (!name) return undefined;
  return PARTICIPANT_COMMANDS.find((c) => c.name === name);
}

export interface ToolInfo {
  readonly name: string;
}

/**
 * Chooses which registered language-model tools the participant may offer.
 * Only NodeForge tools are ever exposed; a slash command narrows the set and
 * Restricted Mode narrows it further to read-only inspection.
 */
export function selectTools<T extends ToolInfo>(
  registered: readonly T[],
  command: ParticipantCommand | undefined,
  trusted: boolean
): T[] {
  return registered.filter((tool) => {
    if (!tool.name.startsWith(NODEFORGE_TOOL_PREFIX)) return false;
    if (command && !command.toolNames.includes(tool.name)) return false;
    if (!trusted && !RESTRICTED_MODE_TOOLS.has(tool.name)) return false;
    return true;
  });
}

export function clampToolRounds(value: unknown, fallback = 8): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(24, Math.max(1, n));
}

export function buildSystemPrompt(command: ParticipantCommand | undefined, trusted: boolean): string {
  const lines = [
    "You are NodeForge, an engineering assistant for Node.js and TypeScript workspaces.",
    "Ground every claim in tool output. Never invent file paths, diagnostics, or test results.",
    "Prefer the smallest correct change. Do not run scripts that mutate the workspace unless the user asked."
  ];
  if (!trusted) {
    lines.push(
      "The workspace is in Restricted Mode: only read-only inspection is available. Tell the user to trust the workspace to run diagnostics or tests."
    );
  }
  if (command) lines.push(command.instruction);
  return lines.join("\n");
}
