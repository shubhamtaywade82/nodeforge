import * as path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

export interface NodeTestAdapterOptions {
  nodePath?: string;
  patterns?: string[];
  timeoutMs?: number;
}

export interface NodeTestRunResult {
  suite: TestSuite;
  result: TestRunResult;
  rawStdout: string;
  rawStderr: string;
  durationMs: number;
  exitCode: number | null;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const RESULT_MARKER = "__NODEFORGE_NODE_TEST_RESULT__";

interface DriverCase {
  testId?: number;
  name: string;
  file?: string;
  line?: number;
  column?: number;
  passed: boolean;
  skip?: boolean | string;
  todo?: boolean | string;
  durationMs?: number;
  error?: { message?: string; stack?: string };
}

interface DriverEnvelope {
  cases: DriverCase[];
  error?: string;
}

const REPORTER_SOURCE = [
  "export default async function* reporter(source) {",
  "  const cases = new Map();",
  "  function key(data) {",
  "    return String(data?.file ?? data?.entryFile ?? \"\") + \"::\" + String(data?.testId ?? data?.testNumber ?? data?.name ?? \"(unnamed)\");",
  "  }",
  "  function isSuite(data) {",
  "    return (data?.details?.type ?? data?.type) === \"suite\";",
  "  }",
  "  function record(data, passed) {",
  "    if (isSuite(data)) return;",
  "    const id = key(data);",
  "    const current = cases.get(id) ?? {};",
  "    const error = data?.details?.error;",
  "    cases.set(id, {",
  "      ...current,",
  "      testId: data?.testNumber ?? data?.testId,",
  "      name: data?.name ?? current.name ?? \"(unnamed)\",",
  "      file: data?.file ?? data?.entryFile ?? current.file,",
  "      line: data?.line ?? current.line,",
  "      column: data?.column ?? current.column,",
  "      passed,",
  "      skip: data?.skip ?? current.skip,",
  "      todo: data?.todo ?? current.todo,",
  "      durationMs: data?.details?.duration_ms ?? current.durationMs,",
  "      error: error ? { message: error?.message ?? String(error), stack: error?.stack } : current.error",
  "    });",
  "  }",
  "  for await (const event of source) {",
  "    if (event.type === \"test:pass\") record(event.data, true);",
  "    else if (event.type === \"test:fail\") record(event.data, false);",
  "  }",
  "  const envelope = { cases: [...cases.values()] };",
  "  yield " + JSON.stringify("__NODEFORGE_NODE_TEST_RESULT__") + " + JSON.stringify(envelope);",
  "}"
].join("\n");

export class NodeTestAdapter {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly options: NodeTestAdapterOptions = {}
  ) {}

  async run(workspaceRoot: string, signal?: AbortSignal, test?: TestCase): Promise<NodeTestRunResult> {
    const node = this.options.nodePath ?? (await resolveExecutable("node"));
    if (!node) throw new FileNotFoundError("node");

    const reporterDir = await mkdtemp(path.join(tmpdir(), "nodeforge-node-test-"));
    const reporterPath = path.join(reporterDir, "reporter.mjs");

    try {
      await writeFile(reporterPath, REPORTER_SOURCE, "utf8");

      const files = test ? [path.resolve(test.file)] : (this.options.patterns ?? []).map((file) =>
        path.isAbsolute(file) ? file : path.resolve(workspaceRoot, file)
      );
      const args = ["--test", "--test-reporter=" + reporterPath];

      const testName = test?.fullName ?? test?.name;
      if (testName) {
        args.push("--test-name-pattern", "^" + escapeRegExp(testName) + "$");
      }
      args.push(...files);

      const request: CommandRequest = {
        command: node,
        args,
        cwd: workspaceRoot,
        timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal
      };

      const execution = await this.runner.run(request);
      const stdout = execution.stdout ?? "";
      const stderr = execution.stderr ?? "";
      const parsed = parseNodeTestOutput(stdout, workspaceRoot);

      return {
        suite: parsed.suite,
        result: parsed.result,
        rawStdout: stdout,
        rawStderr: stderr,
        durationMs: execution.durationMs,
        exitCode: execution.exitCode ?? null
      };
    } finally {
      await rm(reporterDir, { recursive: true, force: true });
    }
  }

  static async hasConfig(workspaceRoot: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    try {
      const raw = await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8");
      const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
      return Object.values(pkg.scripts ?? {}).some((script) => /\bnode\s+--test\b/.test(script));
    } catch {
      return false;
    }
  }
}

export function parseNodeTestOutput(
  stdout: string,
  workspaceRoot: string
): { suite: TestSuite; result: TestRunResult } {
  const markerIndex = stdout.lastIndexOf(RESULT_MARKER);
  if (markerIndex < 0) {
    throw new AdapterParseError("node-test", "Missing NodeForge test result envelope.");
  }

  let envelope: DriverEnvelope;
  try {
    envelope = JSON.parse(stdout.slice(markerIndex + RESULT_MARKER.length)) as DriverEnvelope;
  } catch (err) {
    throw new AdapterParseError(
      "node-test",
      "Failed to parse result envelope: " + (err instanceof Error ? err.message : String(err))
    );
  }

  if (!Array.isArray(envelope.cases)) {
    throw new AdapterParseError("node-test", "Expected a result envelope with a cases array.");
  }

  const cases: TestCase[] = envelope.cases.map((item, index) => {
    const file = item.file
      ? path.isAbsolute(item.file)
        ? item.file
        : path.resolve(workspaceRoot, item.file)
      : workspaceRoot;
    const status = mapStatus(item);
    return {
      id: "node-test:" + file + ":" + (item.testId ?? index) + ":" + item.name,
      name: item.name,
      fullName: item.name,
      file,
      line: item.line,
      status,
      durationMs: item.durationMs,
      error: item.error?.message || item.error?.stack
        ? {
            message: item.error.message ?? "Node.js test failed",
            stack: item.error.stack,
            location:
              item.line !== undefined
                ? { file, line: item.line, column: item.column }
                : undefined
          }
        : undefined
    };
  });

  const rootSuite: TestSuite = {
    id: "node-test:root",
    name: "node:test",
    suites: [],
    tests: cases
  };

  const counts: Record<TestStatus, number> = {
    passed: cases.filter((item) => item.status === "passed").length,
    failed: cases.filter((item) => item.status === "failed").length,
    skipped: cases.filter((item) => item.status === "skipped").length,
    todo: cases.filter((item) => item.status === "todo").length,
    running: 0,
    errored: cases.filter((item) => item.status === "errored").length
  };

  return {
    suite: rootSuite,
    result: {
      id: "node-test:all",
      status: counts.failed > 0 || counts.errored > 0 ? "failed" : "passed",
      durationMs: 0,
      counts,
      cases,
      failures: cases.flatMap((item) => item.error ? [item.error] : [])
    }
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\function mapStatus(item: DriverCase): TestStatus {
");
}

function mapStatus(item: DriverCase): TestStatus {
  if (item.skip) return "skipped";
  if (item.todo) return "todo";
  return item.passed ? "passed" : "failed";
}
