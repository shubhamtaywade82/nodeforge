import * as path from "node:path";

export type TestRunnerKind = "node" | "jest" | "vitest";

export interface TestDebugTarget {
  readonly runner: TestRunnerKind;
  readonly workspaceRoot: string;
  readonly file?: string;
  readonly fullName?: string;
}

export interface TestDebugConfiguration {
  readonly name: string;
  readonly type: "node";
  readonly request: "launch";
  readonly runtimeExecutable: string;
  readonly runtimeArgs: string[];
  readonly cwd: string;
  readonly console: "integratedTerminal";
  readonly autoAttachChildProcesses: true;
  readonly skipFiles: string[];
  readonly env: Record<string, string>;
}

/** Entry point of a locally installed runner. Debug never falls back to downloading one. */
export function runnerEntryPath(runner: "vitest" | "jest", workspaceRoot: string): string {
  return runner === "vitest"
    ? path.join(workspaceRoot, "node_modules", "vitest", "vitest.mjs")
    : path.join(workspaceRoot, "node_modules", "jest", "bin", "jest.js");
}

export function buildTestDebugConfiguration(target: TestDebugTarget): TestDebugConfiguration {
  const common = {
    type: "node" as const,
    request: "launch" as const,
    cwd: target.workspaceRoot,
    console: "integratedTerminal" as const,
    autoAttachChildProcesses: true as const,
    skipFiles: ["<node_internals>/**"],
    env: {} as Record<string, string>
  };

  if (target.runner === "node") {
    const runtimeArgs = ["--inspect-brk", "--test"];
    if (target.file) runtimeArgs.push(target.file);
    if (target.fullName) {
      runtimeArgs.push("--test-name-pattern", "^" + escapeRegExp(target.fullName) + "$");
    }

    return {
      ...common,
      name: target.fullName
        ? "Debug node:test: " + target.fullName
        : target.file
          ? "Debug node:test: " + path.basename(target.file)
          : "Debug node:test: workspace",
      runtimeExecutable: "node",
      runtimeArgs
    };
  }

  const runnerEntry = runnerEntryPath(target.runner, target.workspaceRoot);

  const runtimeArgs = ["--inspect-brk", runnerEntry];

  if (target.runner === "vitest") {
    runtimeArgs.push("run");
    if (target.file) runtimeArgs.push(target.file);
    if (target.fullName) runtimeArgs.push("-t", target.fullName);
  } else {
    if (target.file) runtimeArgs.push(target.file);
    runtimeArgs.push("--runInBand");
    if (target.fullName) runtimeArgs.push("-t", target.fullName);
  }

  return {
    ...common,
    name: target.fullName
      ? "Debug " + target.runner + ": " + target.fullName
      : target.file
        ? "Debug " + target.runner + ": " + path.basename(target.file)
        : "Debug " + target.runner + ": workspace",
    runtimeExecutable: "node",
    runtimeArgs
  };
}

const REGEX_SPECIALS = new Set([
  "\\", "^", "$", ".", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|"
]);

function escapeRegExp(value: string): string {
  let escaped = "";
  for (const character of value) {
    escaped += REGEX_SPECIALS.has(character) ? "\\" + character : character;
  }
  return escaped;
}
