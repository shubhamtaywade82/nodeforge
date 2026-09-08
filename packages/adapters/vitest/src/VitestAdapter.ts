/**
 * Vitest adapter.
 *
 * Runs the project's own Vitest via `vitest run --reporter=json` and parses
 * the JSON output into the NodeForge test contracts (`TestSuite`, `TestCase`,
 * `TestRunResult`).
 *
 * The Vitest JSON reporter is intentionally compatible with Jest's JSON
 * reporter (same field names: `numTotalTests`, `testResults`, etc.), so the
 * parsing logic here is nearly identical to the Jest adapter. Differences:
 *   - Vitest runs from the workspace root, not per-test-file.
 *   - Vitest's `name` field on a test is its title only (no ancestor titles);
 *     the `fullName` field joins ancestors with space separators.
 *   - Vitest's `assertionResults` use `title` and `fullName` (like Jest).
 *
 * Output shape (from `vitest run --reporter=json`):
 *
 *   {
 *     "numTotalTests": N,
 *     "numPassedTests": N,
 *     "numFailedTests": N,
 *     "numPendingTests": N,
 *     "testResults": [
 *       {
 *         "name": "/abs/path/to/file.test.ts",
 *         "status": "passed" | "failed",
 *         "message": "",
 *         "assertionResults": [
 *           {
 *             "fullName": "describe block test name",
 *             "status": "passed" | "failed",
 *             "duration": 1.23,
 *             "failureMessages": ["..."]
 *           }
 *         ]
 *       }
 *     ]
 *   }
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

export interface VitestAdapterOptions {
  /** Override the path to the Vitest binary. If unset, adapter resolves from the workspace. */
  vitestPath?: string;
  /** Glob patterns to limit which tests run. Defaults to [] (run all). */
  patterns?: string[];
  /** Hard timeout for the vitest run, in ms. Defaults to 120_000. */
  timeoutMs?: number;
  /** Extra args to pass to vitest (e.g. ["--no-coverage"]). */
  extraArgs?: string[];
}

export interface VitestRunResult {
  /** Top-level suite containing all discovered suites (one per test file). */
  suite: TestSuite;
  /** Aggregated result of the run. */
  result: TestRunResult;
  /** Raw vitest stdout (the JSON payload). */
  rawStdout: string;
  rawStderr: string;
  durationMs: number;
  exitCode: number | null;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export class VitestAdapter {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly options: VitestAdapterOptions = {}
  ) {}

  /**
   * Run `vitest run --reporter=json` for the given workspace root.
   *
   * Resolution order for the Vitest binary:
   *   1. `<root>/node_modules/.bin/vitest`
   *   2. `<root>/node_modules/vitest/vitest.mjs`
   *   3. PATH lookup via `resolveExecutable("vitest")`
   *
   * Vitest exits 0 if all tests pass, 1 if any test fails. We treat exit 1
   * as "tests ran, here are the failures".
   */
  async run(workspaceRoot: string, signal?: AbortSignal): Promise<VitestRunResult> {
    const vitestBin = this.options.vitestPath ?? (await resolveVitestBinary(workspaceRoot));
    if (!vitestBin) {
      throw new FileNotFoundError("vitest");
    }

    const args = ["run", "--reporter=json"];
    if (this.options.patterns && this.options.patterns.length > 0) {
      args.push(...this.options.patterns);
    }
    if (this.options.extraArgs) {
      args.push(...this.options.extraArgs);
    }

    const request: CommandRequest = {
      command: vitestBin,
      args,
      cwd: workspaceRoot,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      signal
    };

    const result = await this.runner.run(request);

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const exitCode = result.exitCode ?? null;

    const { suite, summary } = parseVitestJsonOutput(stdout, workspaceRoot);

    const runResult: TestRunResult = {
      id: "vitest:all",
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
   * Returns true if a vitest config or vitest dependency exists in `workspaceRoot`.
   */
  static async hasConfig(workspaceRoot: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    const candidates = ["vitest.config.ts", "vitest.config.js", "vitest.config.mts", "vitest.config.mjs", "vite.config.ts", "vite.config.js"];
    for (const c of candidates) {
      try {
        await fs.access(path.join(workspaceRoot, c));
        return true;
      } catch {
        // continue
      }
    }
    // Fall back to vitest being in node_modules (some projects configure via package.json).
    try {
      await fs.access(path.join(workspaceRoot, "node_modules", "vitest"));
      return true;
    } catch {
      return false;
    }
  }
}

async function resolveVitestBinary(workspaceRoot: string): Promise<string | undefined> {
  const localBin = path.join(workspaceRoot, "node_modules", ".bin", "vitest");
  try {
    const fs = await import("node:fs/promises");
    await fs.access(localBin);
    return localBin;
  } catch {
    // next
  }

  const directPath = path.join(workspaceRoot, "node_modules", "vitest", "vitest.mjs");
  try {
    const fs = await import("node:fs/promises");
    await fs.access(directPath);
    return directPath;
  } catch {
    // fall through to PATH
  }

  return resolveExecutable("vitest");
}

// JSON shape produced by `vitest run --reporter=json` (Vitest 2.x).
// Field names mirror Jest's JSON reporter for compatibility.
interface VitestJsonResult {
  numTotalTestSuites?: number;
  numPassedTestSuites?: number;
  numFailedTestSuites?: number;
  numPendingTestSuites?: number;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  success?: boolean;
  startTime?: number;
  testResults?: VitestFileResult[];
}

interface VitestFileResult {
  name: string;
  status: "passed" | "failed";
  message?: string;
  assertionResults?: VitestAssertionResult[];
}

interface VitestAssertionResult {
  fullName?: string;
  title?: string;
  ancestorTitles?: string[];
  status: "passed" | "failed" | "skipped" | "todo" | "pending";
  duration?: number;
  failureMessages?: string[];
  location?: { line: number; column: number };
}

interface ParsedSummary {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
}

/**
 * Parse `vitest run --reporter=json` stdout into a normalized `TestSuite`
 * tree. Each test file becomes a top-level `TestSuite`; `describe` blocks are
 * inferred from the `fullName` (which joins ancestors with spaces).
 */
export function parseVitestJsonOutput(
  stdout: string,
  workspaceRoot: string
): { suite: TestSuite; summary: ParsedSummary } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {
      suite: { id: "vitest:root", name: "vitest", suites: [], tests: [] },
      summary: {
        numTotalTests: 0,
        numPassedTests: 0,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0
      }
    };
  }

  let parsed: VitestJsonResult;
  try {
    parsed = JSON.parse(trimmed) as VitestJsonResult;
  } catch (err) {
    throw new AdapterParseError("vitest", `Failed to parse JSON output: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.testResults)) {
    throw new AdapterParseError("vitest", "Expected an object with a 'testResults' array");
  }

  const fileSuites: TestSuite[] = parsed.testResults.map((fileResult) =>
    fileResultToSuite(fileResult, workspaceRoot)
  );

  const rootSuite: TestSuite = {
    id: "vitest:root",
    name: "vitest",
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

function fileResultToSuite(fileResult: VitestFileResult, workspaceRoot: string): TestSuite {
  const absFile = path.isAbsolute(fileResult.name)
    ? fileResult.name
    : path.resolve(workspaceRoot, fileResult.name);

  // Group assertion results into describe-blocks.
  //
  // Vitest's JSON output does NOT include an explicit `ancestorTitles` array
  // (only Jest does). Instead, `fullName` is the concatenation of ancestor
  // titles + the test title, joined by spaces. To recover the describe block,
  // we strip the test title from the end of `fullName` — what's left is the
  // ancestor chain joined by spaces.
  //
  // Edge case: when a test has no describe block, `fullName` equals `title`,
  // so the ancestor is the empty string. We use empty-ancestor as the signal
  // that the test belongs at the file level.
  const tests: TestCase[] = [];
  const suitesByName = new Map<string, TestSuite>();

  for (const a of fileResult.assertionResults ?? []) {
    const fullName = a.fullName ?? a.title ?? "(unnamed)";
    const title = a.title ?? fullName.split(" ").pop() ?? fullName;

    // If `ancestorTitles` is present (rare in Vitest output, common in Jest
    // format), use the first ancestor as the describe name. Otherwise, derive
    // the ancestor by stripping `title` from the end of `fullName`.
    let ancestor: string;
    if (a.ancestorTitles && a.ancestorTitles.length > 0) {
      ancestor = a.ancestorTitles.join(" ");
    } else if (fullName.length > title.length && fullName.endsWith(title)) {
      // Strip the trailing `title` and the separator space.
      ancestor = fullName.slice(0, fullName.length - title.length).trim();
    } else {
      ancestor = "";
    }

    const test: TestCase = {
      id: `vitest:${absFile}:${fullName}`,
      name: title,
      file: absFile,
      line: a.location?.line,
      status: mapStatus(a.status),
      durationMs: typeof a.duration === "number" ? Math.round(a.duration) : undefined,
      error:
        a.failureMessages && a.failureMessages.length > 0
          ? { message: a.failureMessages[0]! }
          : undefined
    };

    if (ancestor) {
      let suite = suitesByName.get(ancestor);
      if (!suite) {
        suite = {
          id: `vitest:${absFile}:suite:${ancestor}`,
          name: ancestor,
          file: absFile,
          suites: [],
          tests: []
        };
        suitesByName.set(ancestor, suite);
      }
      suite.tests.push(test);
    } else {
      tests.push(test);
    }
  }

  return {
    id: `vitest:${absFile}`,
    name: path.relative(workspaceRoot, absFile) || absFile,
    file: absFile,
    suites: Array.from(suitesByName.values()),
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
