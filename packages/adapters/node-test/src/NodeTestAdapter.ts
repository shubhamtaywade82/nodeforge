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

const DRIVER_SOURCE = [
  "import { once } from \"node:events\";",
  "import { run } from \"node:test\";",
  "const config = __CONFIG__;",
  "const cases = [];",
  "let streamError;",
  "const stream = run(config.files.length > 0 ? { files: config.files } : {});",
  "stream.on(\"test:complete\", (data) => {",
  "  const type = data?.details?.type ?? data?.type;",
  "  if (type === \"suite\") return;",
  "  const error = data?.details?.error;",
  "  cases.push({",
  "    testId: data?.testNumber ?? data?.testId,",
  "    name: data?.name ?? \"(unnamed)\",",
  "    file: data?.file,",
  "    line: data?.line,",
  "    column: data?.column,",
  "    passed: data?.details?.passed === true,",
  "    skip: data?.skip,",
  "    todo: data?.todo,",
  "    durationMs: data?.details?.duration_ms,",
  "    error: error ? { message: error?.message ?? String(error), stack: error?.stack } : undefined",
  "  });",
  "});",
  "stream.on(\"error\", (error) => { streamError = error instanceof Error ? error.message : String(error); });",
  "stream.resume();",
  "await once(stream, \"end\");",
  "const envelope = { cases, error: streamError };",
  "const status = streamError || cases.some((item) => !item.passed && !item.skip && !item.todo) ? 1 : 0;",
  "process.stdout.write(" + JSON.stringify(RESULT_MARKER) + " + JSON.stringify(envelope), () => process.exit(status));"
].join("\n");

export class NodeTestAdapter {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly options: NodeTestAdapterOptions = {}
  ) {}

  async run(workspaceRoot: string, signal?: AbortSignal, test?: TestCase): Promise<NodeTestRunResult> {
    const node = this.options.nodePath ?? (await resolveExecutable("node"));
    if (!node) throw new FileNotFoundError("node");

    const config = {
      files: test ? [test.file] : (this.options.patterns ?? [])
    };

    const request: CommandRequest = {
      command: node,
      args: ["--input-type=module", "-e", DRIVER_SOURCE.replace("__CONFIG__", JSON.stringify(config))],
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

function mapStatus(item: DriverCase): TestStatus {
  if (item.skip) return "skipped";
  if (item.todo) return "todo";
  return item.passed ? "passed" : "failed";
}
