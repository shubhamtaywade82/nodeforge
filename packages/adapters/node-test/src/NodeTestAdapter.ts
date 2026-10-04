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

interface DriverNode {
  testId: number;
  name: string;
  type: "suite" | "test";
  parentId?: number;
  file?: string;
  line?: number;
  column?: number;
}

interface DriverCase extends DriverNode {
  type: "test";
  passed: boolean;
  skip?: boolean | string;
  todo?: boolean | string;
  durationMs?: number;
  error?: { message?: string; stack?: string };
}

interface DriverEnvelope {
  cases: DriverCase[];
  nodes?: DriverNode[];
  error?: string;
}

const REPORTER_SOURCE = [
  "export default async function* reporter(source) {",
"  const nodes = new Map();",
"  const cases = new Map();",
"  function fileOf(data) { return data?.file ?? data?.entryFile; }",
"  function key(data) {",
"    return String(fileOf(data) ?? \"\") + \"::\" + String(data?.testId ?? data?.testNumber ?? data?.name ?? \"(unnamed)\");",
"  }",
"  function typeOf(data) { return data?.details?.type ?? data?.type; }",
"  function recordNode(data) {",
"    const type = typeOf(data);",
"    if (type !== \"suite\" && type !== \"test\") return;",
"    const testId = data?.testId ?? data?.testNumber;",
"    if (typeof testId !== \"number\") return;",
"    const id = key(data);",
"    const current = nodes.get(id) ?? {};",
"    nodes.set(id, {",
"      ...current,",
"      testId,",
"      name: data?.name ?? current.name ?? \"(unnamed)\",",
"      type,",
"      parentId: data?.parentId ?? current.parentId,",
"      file: fileOf(data) ?? current.file,",
"      line: data?.line ?? current.line,",
"      column: data?.column ?? current.column",
"    });",
"  }",
"  function record(data, passed) {",
"    recordNode(data);",
"    if (typeOf(data) !== \"test\") return;",
"    const id = key(data);",
"    const current = cases.get(id) ?? {};",
"    const error = data?.details?.error;",
"    cases.set(id, {",
"      ...current,",
"      testId: data?.testId ?? data?.testNumber,",
"      name: data?.name ?? current.name ?? \"(unnamed)\",",
"      type: \"test\",",
"      parentId: data?.parentId ?? current.parentId,",
"      file: fileOf(data) ?? current.file,",
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
"    if (event.type === \"test:enqueue\" || event.type === \"test:start\") recordNode(event.data);",
"    else if (event.type === \"test:pass\") record(event.data, true);",
"    else if (event.type === \"test:fail\") record(event.data, false);",
"  }",
"  yield \"__NODEFORGE_NODE_TEST_RESULT__\" + JSON.stringify({ cases: [...cases.values()], nodes: [...nodes.values()] });",
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

      const testName = test && !test.id.startsWith("file:") ? (test.fullName ?? test.name) : undefined;
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
        result: {
          ...parsed.result,
          id: test?.id ?? parsed.result.id,
          durationMs: execution.durationMs,
          stdout,
          stderr
        },
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

  const nodes = (envelope.nodes ?? []).filter((node) => typeof node.testId === "number");
  const nodesByFile = new Map<string, Map<number, DriverNode>>();

  for (const node of nodes) {
    const file = resolveNodeFile(node.file, workspaceRoot);
    let byId = nodesByFile.get(file);
    if (!byId) {
      byId = new Map<number, DriverNode>();
      nodesByFile.set(file, byId);
    }
    byId.set(node.testId, node);
  }

  const suiteRootsByFile = new Map<string, TestSuite>();
  const suiteItems = new Map<string, TestSuite>();

  for (const node of nodes) {
    if (node.type !== "suite") continue;
    const file = resolveNodeFile(node.file, workspaceRoot);
    const suite: TestSuite = {
      id: `node-test:${file}:suite:${node.testId}`,
      name: node.name,
      file,
      suites: [],
      tests: []
    };
    suiteItems.set(suite.id, suite);

    if (!suiteRootsByFile.has(file)) {
      suiteRootsByFile.set(file, createFileSuite(file, workspaceRoot));
    }
  }

  for (const node of nodes) {
    if (node.type !== "suite") continue;
    const file = resolveNodeFile(node.file, workspaceRoot);
    const suite = suiteItems.get(`node-test:${file}:suite:${node.testId}`);
    const root = suiteRootsByFile.get(file);
    if (!suite || !root) continue;

    const parent = node.parentId !== undefined
      ? suiteItems.get(`node-test:${file}:suite:${node.parentId}`)
      : undefined;
    (parent ?? root).suites.push(suite);
  }

  const cases: TestCase[] = envelope.cases.map((item, index) => {
    const file = resolveNodeFile(item.file, workspaceRoot);
    const byId = nodesByFile.get(file);
    const fullName = buildNodeTestFullName(item, byId);
    const status = mapStatus(item);

    return {
      id: `node-test:${file}:${fullName || item.testId || index}`,
      name: item.name,
      fullName,
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

  envelope.cases.forEach((item, index) => {
    const test = cases[index];
    if (!test) return;

    let root = suiteRootsByFile.get(test.file);
    if (!root) {
      root = createFileSuite(test.file, workspaceRoot);
      suiteRootsByFile.set(test.file, root);
    }

    const parentSuite = item.parentId !== undefined
      ? suiteItems.get(`node-test:${test.file}:suite:${item.parentId}`)
      : undefined;
    (parentSuite ?? root).tests.push(test);
  });

  const rootSuite: TestSuite = {
    id: "node-test:root",
    name: "node:test",
    suites: [...suiteRootsByFile.values()],
    tests: []
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

function resolveNodeFile(file: string | undefined, workspaceRoot: string): string {
  if (!file) return workspaceRoot;
  return path.isAbsolute(file) ? file : path.resolve(workspaceRoot, file);
}

function createFileSuite(file: string, workspaceRoot: string): TestSuite {
  return {
    id: `node-test:file:${file}`,
    name: path.relative(workspaceRoot, file) || file,
    file,
    suites: [],
    tests: []
  };
}

function buildNodeTestFullName(
  item: DriverCase,
  byId: Map<number, DriverNode> | undefined
): string {
  const names = [item.name];
  let parentId = item.parentId;
  const seen = new Set<number>();

  while (parentId !== undefined && byId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }

  return names.join(" > ");
}


function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function mapStatus(item: DriverCase): TestStatus {
  if (item.skip) return "skipped";
  if (item.todo) return "todo";
  return item.passed ? "passed" : "failed";
}
