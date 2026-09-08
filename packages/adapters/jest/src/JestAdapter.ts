/**
 * Jest adapter.
 *
 * Runs the project's own Jest via `jest --json` and parses the JSON output
 * into the NodeForge test contracts (`TestSuite`, `TestCase`, `TestRunResult`).
 *
 * The Jest JSON reporter output is documented at:
 * https://jestjs.io/docs/cli#--json
 *
 * Vitest's JSON reporter is intentionally compatible with Jest's, so this
 * adapter and the Vitest adapter share the same parsing logic. Differences
 * are limited to binary resolution and CLI invocation.
 *
 * Output shape (from `jest --json`):
 *
 *   {
 *     "numTotalTests": N,
 *     "numPassedTests": N,
 *     "numFailedTests": N,
 *     "numPendingTests": N,
 *     "success": boolean,
 *     "testResults": [
 *       {
 *         "name": "/abs/path/to/file.test.ts",
 *         "status": "passed" | "failed",
 *         "message": "",
 *         "assertionResults": [
 *           {
 *             "ancestorTitles": ["describe block"],
 *             "fullName": "describe block test name",
 *             "title": "test name",
 *             "status": "passed" | "failed",
 *             "duration": 5,
 *             "failureMessages": ["..."]
 *           }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Jest uniquely provides `ancestorTitles` as an explicit array — we prefer
 * that over inferring from `fullName` when available.
 */

import * as path from "node:path";
import {
  AdapterParseError,
  FileNotFoundError,
  type CommandRequest,
  type TestCase,
  type TestRunResult,
  type TestStatus,
  type TestSuite
} from "@nodeforge/contracts";
import { ProcessRunner, resolveExecutable } from "@nodeforge/runner";

export interface JestAdapterOptions {
  /** Override the path to the Jest binary. If unset, adapter resolves from the workspace. */
  jestPath?: string;
  /** Glob patterns to limit which tests run. Defaults to [] (run all). */
  patterns?: string[];
  /** Hard timeout for the jest run, in ms. Defaults to 120_000. */
  timeoutMs?: number;
  /** Extra args to pass to jest (e.g. ["--coverage"]). */
  extraArgs?: string[];
}

export interface JestRunResult {
  suite: TestSuite;
  result: TestRunResult;
  rawStdout: string;
  rawStderr: string;
  durationMs: number;
  exitCode: number | null;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class JestAdapter {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly options: JestAdapterOptions = {}
  ) {}

  /**
   * Run `jest --json` for the given workspace root.
   *
   * Resolution order for the Jest binary:
   *   1. `<root>/node_modules/.bin/jest`
   *   2. `<root>/node_modules/jest/bin/jest.js`
   *   3. PATH lookup via `resolveExecutable("jest")`
   *
   * Jest exits 0 if all tests pass, 1 if any test fails. We treat exit 1
   * as "tests ran, here are the failures".
   */
  async run(workspaceRoot: string, signal?: AbortSignal): Promise<JestRunResult> {
    const jestBin = this.options.jestPath ?? (await resolveJestBinary(workspaceRoot));
    if (!jestBin) {
      throw new FileNotFoundError("jest");
    }

    const args = ["--json"];
    if (this.options.patterns && this.options.patterns.length > 0) {
      args.push(...this.options.patterns);
    }
    if (this.options.extraArgs) {
      args.push(...this.options.extraArgs);
    }

    const request: CommandRequest = {
      command: jestBin,
      args,
      cwd: workspaceRoot,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal
    };

    const result = await this.runner.run(request);

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const exitCode = result.exitCode ?? null;

    const { suite, summary } = parseJestJsonOutput(stdout, workspaceRoot);

    const runResult: TestRunResult = {
      id: "jest:all",
      status: summary.numFailedTests > 0 ? "failed" : "passed",
      durationMs: result.durationMs,
      counts: {
        passed: summary.numPassedTests,
        failed: summary.numFailedTests,
        skipped: summary.numPendingTests,
        todo: summary.numTodoTests,
        running: 0,
        errored: 0
      },
      failures: [],
      stdout,
      stderr
    };

    return {
      suite,
      result: runResult,
      rawStdout: stdout,
      rawStderr: stderr,
      durationMs: result.durationMs,
      exitCode
    };
  }

  /**
   * Returns true if a jest config or jest dependency exists in `workspaceRoot`.
   */
  static async hasConfig(workspaceRoot: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    const candidates = [
      "jest.config.js",
      "jest.config.mjs",
      "jest.config.cjs",
      "jest.config.ts",
      "jest.json"
    ];
    for (const c of candidates) {
      try {
        await fs.access(path.join(workspaceRoot, c));
        return true;
      } catch {
        // continue
      }
    }
    // Fall back to a `jest` field in package.json.
    try {
      const pkgRaw = await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8");
      const pkg = JSON.parse(pkgRaw) as { jest?: unknown };
      if (pkg.jest !== undefined) return true;
    } catch {
      // ignore
    }
    // Fall back to jest being installed.
    try {
      await fs.access(path.join(workspaceRoot, "node_modules", "jest"));
      return true;
    } catch {
      return false;
    }
  }
}

async function resolveJestBinary(workspaceRoot: string): Promise<string | undefined> {
  const localBin = path.join(workspaceRoot, "node_modules", ".bin", "jest");
  try {
    const fs = await import("node:fs/promises");
    await fs.access(localBin);
    return localBin;
  } catch {
    // next
  }

  const directPath = path.join(workspaceRoot, "node_modules", "jest", "bin", "jest.js");
  try {
    const fs = await import("node:fs/promises");
    await fs.access(directPath);
    return directPath;
  } catch {
    // fall through to PATH
  }

  return resolveExecutable("jest");
}

// JSON shape produced by `jest --json`.
interface JestJsonResult {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  success?: boolean;
  testResults?: JestFileResult[];
}

interface JestFileResult {
  name: string;
  status: "passed" | "failed";
  message?: string;
  assertionResults?: JestAssertionResult[];
}

interface JestAssertionResult {
  ancestorTitles?: string[];
  fullName?: string;
  title?: string;
  status: "passed" | "failed" | "skipped" | "todo" | "pending";
  duration?: number;
  failureMessages?: string[];
  location?: { line: number; column: number } | null;
}

interface ParsedSummary {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
}

/**
 * Parse `jest --json` stdout into a normalized `TestSuite` tree.
 *
 * Each test file becomes a top-level `TestSuite`. Jest uniquely provides
 * `ancestorTitles` as an explicit array on each assertion result; we use
 * that to build nested describe-block suites when present, and fall back to
 * splitting `fullName` on spaces when `ancestorTitles` is absent (which is
 * what Vitest's output looks like).
 */
export function parseJestJsonOutput(
  stdout: string,
  workspaceRoot: string
): { suite: TestSuite; summary: ParsedSummary } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {
      suite: { id: "jest:root", name: "jest", suites: [], tests: [] },
      summary: {
        numTotalTests: 0,
        numPassedTests: 0,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0
      }
    };
  }

  let parsed: JestJsonResult;
  try {
    parsed = JSON.parse(trimmed) as JestJsonResult;
  } catch (err) {
    throw new AdapterParseError("jest", `Failed to parse JSON output: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.testResults)) {
    throw new AdapterParseError("jest", "Expected an object with a 'testResults' array");
  }

  const fileSuites: TestSuite[] = parsed.testResults.map((fileResult) =>
    fileResultToSuite(fileResult, workspaceRoot)
  );

  const rootSuite: TestSuite = {
    id: "jest:root",
    name: "jest",
    suites: fileSuites,
    tests: []
  };

  return {
    suite: rootSuite,
    summary: {
      numTotalTests: parsed.numTotalTests ?? 0,
      numPassedTests: parsed.numPassedTests ?? 0,
      numFailedTests: parsed.numFailedTests ?? 0,
      numPendingTests: parsed.numPendingTests ?? 0,
      numTodoTests: parsed.numTodoTests ?? 0
    }
  };
}

function fileResultToSuite(fileResult: JestFileResult, workspaceRoot: string): TestSuite {
  const absFile = path.isAbsolute(fileResult.name)
    ? fileResult.name
    : path.resolve(workspaceRoot, fileResult.name);

  const tests: TestCase[] = [];
  // Nested describe suites, keyed by their full ancestor path (e.g. "describe1 > describe2").
  const suitesByName = new Map<string, TestSuite>();

  for (const a of fileResult.assertionResults ?? []) {
    const title = a.title ?? a.fullName ?? "(unnamed)";
    const ancestors = a.ancestorTitles ?? [];

    // When ancestors exist, build/reuse the nested suite chain.
    let parentSuite: TestSuite | undefined;
    if (ancestors.length > 0) {
      const chain: TestSuite[] = [];
      let cumulativeName = "";
      for (const anc of ancestors) {
        cumulativeName = cumulativeName ? `${cumulativeName} > ${anc}` : anc;
        let existing = suitesByName.get(cumulativeName);
        if (!existing) {
          existing = {
            id: `jest:${absFile}:suite:${cumulativeName}`,
            name: anc,
            file: absFile,
            suites: [],
            tests: []
          };
          suitesByName.set(cumulativeName, existing);
          // Attach to parent (or to file-level suite if this is the first level).
          if (chain.length > 0) {
            chain[chain.length - 1]!.suites.push(existing);
          }
        }
        chain.push(existing);
      }
      parentSuite = chain[chain.length - 1];
    }

    const test: TestCase = {
      id: `jest:${absFile}:${a.fullName ?? title}`,
      name: title,
      file: absFile,
      line: a.location?.line ?? undefined,
      status: mapStatus(a.status),
      durationMs: typeof a.duration === "number" ? a.duration : undefined,
      error:
        a.failureMessages && a.failureMessages.length > 0
          ? { message: a.failureMessages[0]! }
          : undefined
    };

    if (parentSuite) {
      parentSuite.tests.push(test);
    } else {
      tests.push(test);
    }
  }

  // Collect top-level suites (those with no parent in the chain).
  const topLevelSuiteNames = new Set<string>();
  for (const a of fileResult.assertionResults ?? []) {
    const ancestors = a.ancestorTitles ?? [];
    if (ancestors.length > 0) {
      topLevelSuiteNames.add(ancestors[0]!);
    }
  }
  const topLevelSuites: TestSuite[] = [];
  for (const name of topLevelSuiteNames) {
    const suite = suitesByName.get(name);
    if (suite) topLevelSuites.push(suite);
  }

  return {
    id: `jest:${absFile}`,
    name: path.relative(workspaceRoot, absFile) || absFile,
    file: absFile,
    suites: topLevelSuites,
    tests
  };
}

function mapStatus(s: string): TestStatus {
  switch (s) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "skipped":
    case "pending":
      return "skipped";
    case "todo":
      return "todo";
    default:
      return "errored";
  }
}
